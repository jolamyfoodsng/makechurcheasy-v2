//! verse_ai_ndi.rs: Verse AI's own NDI® source, running next to the Studio's (studio_ndi_out.rs).
//!
//! The Verse AI output page (verse-ai-output.html) is opened in a hidden, transparent window. On a Mac,
//! ndi_out_snapshot.m takes pictures of its web view about 30 times a second, keeping the
//! transparency, and this module sends them with the NDI runtime that studio_ndi.rs loads.
//! vMix, OBS (DistroAV), NDI Studio Monitor and other NDI receivers then list
//! "COMPUTER (MakeChurchEazy – Verse AI)" and lay it over their own video.
//! Findings behind this design: docs/ndi-out-spike.md.

use serde::Serialize;
use std::sync::Mutex;

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct NdiOutStatus {
    pub running: bool,
    /// What was asked for: "alt" or "program".
    pub feed: String,
    /// The full name receivers show, e.g. "MY-MAC (MakeChurchEazy – Lower Third)".
    pub source_name: String,
    /// How many receivers are watching right now.
    pub connections: i32,
    pub error: String,
}

static LAST_ERROR: Mutex<String> = Mutex::new(String::new());

/// Prints a step, and in debug builds also appends it to $TMPDIR/makechurcheasy-verse-ai-ndi.log.
/// Only the macOS sender uses it.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn log(message: &str) {
    println!("[Verse AI NDI] {message}");
    #[cfg(debug_assertions)]
    {
        use std::io::Write;
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(std::env::temp_dir().join("makechurcheasy-verse-ai-ndi.log")) {
            let _ = writeln!(f, "{} {message}", chrono::Local::now().format("%H:%M:%S%.3f"));
        }
    }
}

#[cfg(target_os = "macos")]
mod mac {
    use super::{log, NdiOutStatus, LAST_ERROR};
    use std::ffi::{c_char, c_void, CStr, CString};
    use std::sync::atomic::{AtomicBool, AtomicI32, AtomicUsize, Ordering};
    use std::sync::mpsc::{sync_channel, Receiver, RecvTimeoutError, SyncSender};
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};
    use tauri::Manager;

    const WINDOW_LABEL: &str = "verse-ai-ndi-out";
    const WIDTH: i32 = 1920;
    const HEIGHT: i32 = 1080;
    const FPS: i32 = 30;

    // ── The NDI sender API (Processing.NDI.Lib.h), only the parts used here ──

    #[repr(C)]
    struct SendCreate {
        p_ndi_name: *const c_char,
        p_groups: *const c_char,
        clock_video: bool,
        clock_audio: bool,
    }

    #[repr(C)]
    struct Source {
        p_ndi_name: *const c_char,
        p_url_address: *const c_char,
    }

    #[repr(C)]
    struct VideoFrameV2 {
        xres: i32,
        yres: i32,
        fourcc: u32,
        frame_rate_n: i32,
        frame_rate_d: i32,
        picture_aspect_ratio: f32,
        frame_format_type: i32,
        timecode: i64,
        p_data: *mut u8,
        line_stride_in_bytes: i32,
        p_metadata: *const c_char,
        timestamp: i64,
    }

    const FOURCC_BGRA: u32 = u32::from_le_bytes(*b"BGRA");

    type FnSendCreate = unsafe extern "C" fn(*const SendCreate) -> *mut c_void;
    type FnSendDestroy = unsafe extern "C" fn(*mut c_void);
    type FnSendVideo = unsafe extern "C" fn(*mut c_void, *const VideoFrameV2);
    type FnSendConnections = unsafe extern "C" fn(*mut c_void, u32) -> i32;
    type FnSendSourceName = unsafe extern "C" fn(*mut c_void) -> *const Source;

    type FrameCb = extern "C" fn(*mut c_void, *const u8, i32, i32, i32);
    #[allow(clashing_extern_declarations)]
    extern "C" {
        fn mce_ndi_snap_start(web_view: *mut c_void, ns_window: *mut c_void, width: i32, height: i32, fps: i32, cb: FrameCb, user: *mut c_void) -> *mut c_void;
        fn mce_ndi_snap_stop(handle: *mut c_void);
    }

    struct Frame {
        data: Vec<u8>,
        width: i32,
        height: i32,
        stride: i32,
    }

    /// Where the snapshot callback (main thread) drops pictures for the sending thread.
    struct Sink {
        tx: SyncSender<Frame>,
    }

    extern "C" fn on_frame(user: *mut c_void, bgra: *const u8, width: i32, height: i32, stride: i32) {
        if user.is_null() || bgra.is_null() || width <= 0 || height <= 0 {
            return;
        }
        // SAFETY: `user` is the Sink boxed in start(), freed only after the snapshots stop;
        // `bgra` holds `height` rows of `stride` bytes for the length of this call.
        let sink = unsafe { &*(user as *const Sink) };
        let data = unsafe { std::slice::from_raw_parts(bgra, (stride * height) as usize) }.to_vec();
        // NDI still busy with the last picture: skip this one rather than queue up delay.
        let _ = sink.tx.try_send(Frame { data, width, height, stride });
    }

    struct Running {
        feed: String,
        stop: Arc<AtomicBool>,
        /// mce_ndi_snap_start's handle (0 until the main thread has started the snapshots).
        snap: Arc<AtomicUsize>,
        /// Box<Sink> as a raw pointer.
        sink: usize,
        source_name: Arc<Mutex<String>>,
        connections: Arc<AtomicI32>,
    }

    static RUNNING: Mutex<Option<Running>> = Mutex::new(None);

    fn set_error(message: &str) {
        if !message.is_empty() {
            log(&format!("error: {message}"));
        }
        if let Ok(mut e) = LAST_ERROR.lock() {
            *e = message.to_string();
        }
    }

    /// Sends what arrives on `rx` until the snapshots stop. Pictures that did not change are sent
    /// again only once a second, so a still lower third costs almost nothing.
    fn send_loop(
        lib: &'static libloading::Library,
        name: CString,
        rx: Receiver<Frame>,
        stop: Arc<AtomicBool>,
        source_name: Arc<Mutex<String>>,
        connections: Arc<AtomicI32>,
    ) {
        // SAFETY: the symbol names and signatures match Processing.NDI.Lib.h (NDI 5 and 6).
        let (create, destroy, send, count, get_name) = unsafe {
            match (
                lib.get::<FnSendCreate>(b"NDIlib_send_create\0"),
                lib.get::<FnSendDestroy>(b"NDIlib_send_destroy\0"),
                lib.get::<FnSendVideo>(b"NDIlib_send_send_video_v2\0"),
                lib.get::<FnSendConnections>(b"NDIlib_send_get_no_connections\0"),
                lib.get::<FnSendSourceName>(b"NDIlib_send_get_source_name\0"),
            ) {
                (Ok(a), Ok(b), Ok(c), Ok(d), Ok(e)) => (*a, *b, *c, *d, *e),
                _ => {
                    set_error("This NDI version can't send. Update NDI Tools from ndi.video.");
                    return;
                }
            }
        };
        // The snapshot timer sets the pace, so NDI is not asked to clock the video.
        let settings = SendCreate { p_ndi_name: name.as_ptr(), p_groups: std::ptr::null(), clock_video: false, clock_audio: false };
        // SAFETY: settings and the name it points to live through the call.
        let sender = unsafe { create(&settings) };
        if sender.is_null() {
            set_error("NDI could not start sending on this computer.");
            return;
        }
        // SAFETY: sender is valid; NDI owns the returned source.
        unsafe {
            let source = get_name(sender);
            if !source.is_null() && !(*source).p_ndi_name.is_null() {
                if let Ok(mut n) = source_name.lock() {
                    *n = CStr::from_ptr((*source).p_ndi_name).to_string_lossy().into_owned();
                }
            }
        }
        log(&format!("sending as {}", source_name.lock().map(|n| n.clone()).unwrap_or_default()));

        let mut last: Vec<u8> = Vec::new();
        let mut last_sent = Instant::now() - Duration::from_secs(10);
        loop {
            match rx.recv_timeout(Duration::from_millis(250)) {
                Ok(mut frame) => {
                    if frame.data != last || last_sent.elapsed() >= Duration::from_secs(1) {
                        let video = VideoFrameV2 {
                            xres: frame.width,
                            yres: frame.height,
                            fourcc: FOURCC_BGRA,
                            frame_rate_n: FPS,
                            frame_rate_d: 1,
                            picture_aspect_ratio: frame.width as f32 / frame.height as f32,
                            frame_format_type: 1, // progressive
                            timecode: i64::MAX,   // "synthesize"
                            p_data: frame.data.as_mut_ptr(),
                            line_stride_in_bytes: frame.stride,
                            p_metadata: std::ptr::null(),
                            timestamp: 0,
                        };
                        // SAFETY: sender is valid; the synchronous send is done with the buffer when it returns.
                        unsafe { send(sender, &video) };
                        last_sent = Instant::now();
                        last = frame.data;
                    }
                }
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => break,
            }
            if stop.load(Ordering::SeqCst) {
                break;
            }
            // SAFETY: sender is valid; a 0 ms timeout only reads the count.
            connections.store(unsafe { count(sender, 0) }, Ordering::SeqCst);
        }
        // SAFETY: sender is valid and not used after this.
        unsafe { destroy(sender) };
        connections.store(0, Ordering::SeqCst);
        println!("[Verse AI NDI] Stopped");
    }

    pub fn start(app: &tauri::AppHandle, url: &str, feed: &str, name: &str) -> Result<NdiOutStatus, String> {
        log(&format!("start {feed} {url}"));
        stop(app);
        // The old window goes away on the main thread; wait for it so the label is free again.
        for _ in 0..40 {
            if app.get_webview_window(WINDOW_LABEL).is_none() {
                break;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        set_error("");
        let lib = crate::studio_ndi::library().map_err(|e| { log(&format!("no runtime: {e}")); e })?;
        log("runtime loaded");
        let parsed: tauri::Url = url.parse().map_err(|e| format!("Bad output URL: {e}"))?;
        let c_name = CString::new(name).map_err(|_| "Bad NDI source name".to_string())?;

        // Hidden until the snapshot code has made it invisible and click-through.
        let window = tauri::WebviewWindowBuilder::new(app, WINDOW_LABEL, tauri::WebviewUrl::External(parsed))
            .title("Verse AI NDI output")
            .inner_size(WIDTH as f64, HEIGHT as f64)
            .position(0.0, 0.0)
            .decorations(false)
            .transparent(true)
            .shadow(false)
            .resizable(false)
            .skip_taskbar(true)
            .focused(false)
            .visible(false)
            .build()
            .map_err(|e| { log(&format!("window failed: {e}")); format!("The NDI output could not be opened: {e}") })?;
        log("window built");

        let (tx, rx) = sync_channel::<Frame>(1);
        let sink = Box::into_raw(Box::new(Sink { tx })) as usize;
        let stop_flag = Arc::new(AtomicBool::new(false));
        let snap = Arc::new(AtomicUsize::new(0));
        let source_name = Arc::new(Mutex::new(String::new()));
        let connections = Arc::new(AtomicI32::new(0));
        {
            let (stop_flag, source_name, connections) = (stop_flag.clone(), source_name.clone(), connections.clone());
            std::thread::Builder::new()
                .name("verse-ai-ndi".into())
                .spawn(move || send_loop(lib, c_name, rx, stop_flag, source_name, connections))
                .map_err(|e| e.to_string())?;
        }
        let snap_for_main = snap.clone();
        let started = window.with_webview(move |webview| {
            // SAFETY: main thread; the web view and window are alive; `sink` outlives the snapshots (see stop()).
            let handle = unsafe { mce_ndi_snap_start(webview.inner(), webview.ns_window(), WIDTH, HEIGHT, FPS, on_frame, sink as *mut c_void) };
            snap_for_main.store(handle as usize, Ordering::SeqCst);
            log(&format!("snapshots started: {}", !handle.is_null()));
        });
        if let Err(e) = started {
            stop_flag.store(true, Ordering::SeqCst);
            // SAFETY: the snapshots never started, so nothing else holds the sink.
            drop(unsafe { Box::from_raw(sink as *mut Sink) });
            let _ = window.destroy();
            return Err(format!("The NDI output could not start: {e}"));
        }
        *RUNNING.lock().map_err(|e| e.to_string())? = Some(Running {
            feed: feed.to_string(),
            stop: stop_flag,
            snap,
            sink,
            source_name,
            connections,
        });
        log("started");
        Ok(status())
    }

    pub fn stop(app: &tauri::AppHandle) {
        let running = RUNNING.lock().ok().and_then(|mut r| r.take());
        let Some(running) = running else {
            if let Some(w) = app.get_webview_window(WINDOW_LABEL) {
                let _ = w.destroy();
            }
            return;
        };
        running.stop.store(true, Ordering::SeqCst);
        let app2 = app.clone();
        let (snap, sink) = (running.snap, running.sink);
        // Snapshots start and stop on the main thread, queued after with_webview's start.
        let _ = app.run_on_main_thread(move || {
            let handle = snap.swap(0, Ordering::SeqCst);
            // SAFETY: main thread; handle came from mce_ndi_snap_start; after the stop no callback uses the sink.
            unsafe {
                mce_ndi_snap_stop(handle as *mut c_void);
                drop(Box::from_raw(sink as *mut Sink)); // closes the channel, so the sending thread ends
            }
            if let Some(w) = app2.get_webview_window(WINDOW_LABEL) {
                let _ = w.destroy();
            }
        });
    }

    pub fn status() -> NdiOutStatus {
        let error = LAST_ERROR.lock().map(|e| e.clone()).unwrap_or_default();
        match RUNNING.lock().ok().as_ref().and_then(|r| r.as_ref()) {
            Some(r) => NdiOutStatus {
                running: error.is_empty(),
                feed: r.feed.clone(),
                source_name: r.source_name.lock().map(|n| n.clone()).unwrap_or_default(),
                connections: r.connections.load(Ordering::SeqCst),
                error,
            },
            None => NdiOutStatus { error, ..Default::default() },
        }
    }
}

#[cfg(not(target_os = "macos"))]
const NOT_YET: &str = "Sending over NDI works on Mac for now. Windows support is coming.";

/// Starts sending `url` (the Verse AI output page) as the NDI source `name`. Replaces a running one.
#[tauri::command]
pub async fn start_verse_ai_ndi(app: tauri::AppHandle, url: String, feed: String, name: String) -> Result<NdiOutStatus, String> {
    #[cfg(target_os = "macos")]
    {
        mac::start(&app, &url, &feed, &name)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, url, feed, name);
        Err(NOT_YET.to_string())
    }
}

#[tauri::command]
pub fn stop_verse_ai_ndi(app: tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    mac::stop(&app);
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

#[tauri::command]
pub fn get_verse_ai_ndi_status() -> NdiOutStatus {
    #[cfg(target_os = "macos")]
    {
        mac::status()
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = &LAST_ERROR;
        NdiOutStatus { error: NOT_YET.to_string(), ..Default::default() }
    }
}
