//! studio_ndi.rs: NDI® sources on the network as a Studio camera.
//!
//! NDI cameras, phone camera apps, vMix / OBS outputs and other computers announce themselves
//! on the local network. This module finds them and receives one of them, turning each picture
//! into a JPEG for the same frame slot the native camera uses (see studio_camera.rs), so every
//! screen shows it exactly like a USB camera.
//!
//! The NDI runtime is not part of the app: it is loaded when NDI is first used, from the place
//! NDI Tools / the NDI runtime installs it. Without it the app works as before and the Studio
//! simply lists no NDI sources. NDI® is a registered trademark of Vizrt NDI AB (https://ndi.video).

use std::ffi::{c_char, c_void, CStr, CString};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

// ── The NDI C API (Processing.NDI.Lib.h), only the parts used here ─────────

#[repr(C)]
struct FindCreate {
    show_local_sources: bool,
    p_groups: *const c_char,
    p_extra_ips: *const c_char,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct Source {
    p_ndi_name: *const c_char,
    p_url_address: *const c_char,
}

#[repr(C)]
struct RecvCreateV3 {
    source_to_connect_to: Source,
    color_format: i32,
    bandwidth: i32,
    allow_video_fields: bool,
    p_ndi_recv_name: *const c_char,
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

const COLOR_BGRX_BGRA: i32 = 0;
const BANDWIDTH_HIGHEST: i32 = 100;
const FRAME_VIDEO: i32 = 1;
const FRAME_ERROR: i32 = 4;

const fn fourcc(code: &[u8; 4]) -> u32 {
    (code[0] as u32) | ((code[1] as u32) << 8) | ((code[2] as u32) << 16) | ((code[3] as u32) << 24)
}
const FOURCC_BGRA: u32 = fourcc(b"BGRA");
const FOURCC_BGRX: u32 = fourcc(b"BGRX");

type FnInitialize = unsafe extern "C" fn() -> bool;
type FnFindCreate = unsafe extern "C" fn(*const FindCreate) -> *mut c_void;
type FnFindWait = unsafe extern "C" fn(*mut c_void, u32) -> bool;
type FnFindSources = unsafe extern "C" fn(*mut c_void, *mut u32) -> *const Source;
type FnRecvCreate = unsafe extern "C" fn(*const RecvCreateV3) -> *mut c_void;
type FnRecvDestroy = unsafe extern "C" fn(*mut c_void);
type FnRecvCapture =
    unsafe extern "C" fn(*mut c_void, *mut VideoFrameV2, *mut c_void, *mut c_void, u32) -> i32;
type FnRecvFreeVideo = unsafe extern "C" fn(*mut c_void, *const VideoFrameV2);

struct Ndi {
    // Kept for the life of the app: the function pointers below point into it.
    _lib: libloading::Library,
    find_create: FnFindCreate,
    find_wait: FnFindWait,
    find_sources: FnFindSources,
    recv_create: FnRecvCreate,
    recv_destroy: FnRecvDestroy,
    recv_capture: FnRecvCapture,
    recv_free_video: FnRecvFreeVideo,
}

static NDI: OnceLock<Result<Ndi, String>> = OnceLock::new();

/// Where the NDI runtime may be on this computer.
fn library_candidates() -> Vec<std::path::PathBuf> {
    let mut out = Vec::new();
    #[cfg(target_os = "windows")]
    let file = "Processing.NDI.Lib.x64.dll";
    #[cfg(target_os = "macos")]
    let file = "libndi.dylib";
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let file = "libndi.so.6";
    // NDI Tools and the NDI runtime installers set these.
    for var in ["NDI_RUNTIME_DIR_V6", "NDI_RUNTIME_DIR_V5"] {
        if let Ok(dir) = std::env::var(var) {
            if !dir.trim().is_empty() {
                out.push(std::path::Path::new(dir.trim()).join(file));
            }
        }
    }
    // Next to the app (if a later build ships the runtime with it).
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            out.push(dir.join(file));
            #[cfg(target_os = "macos")]
            out.push(dir.join("../Frameworks").join(file));
        }
    }
    #[cfg(target_os = "macos")]
    {
        out.push("/usr/local/lib/libndi.dylib".into());
        out.push("/Library/NDI SDK for Apple/lib/macOS/libndi.dylib".into());
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        out.push("libndi.so.5".into());
        out.push("libndi.so".into());
    }
    // Last: let the system search its usual places.
    out.push(file.into());
    out
}

fn load() -> Result<Ndi, String> {
    let mut last = String::new();
    for path in library_candidates() {
        // SAFETY: loading the NDI runtime runs its initialisers; it is a plain C library.
        let lib = match unsafe { libloading::Library::new(&path) } {
            Ok(lib) => lib,
            Err(e) => {
                last = e.to_string();
                continue;
            }
        };
        // SAFETY: the symbol names and signatures match Processing.NDI.Lib.h (NDI 5 and 6).
        let loaded = unsafe {
            (|| -> Result<Ndi, String> {
                let e = |err: libloading::Error| err.to_string();
                let initialize: FnInitialize = *lib.get(b"NDIlib_initialize\0").map_err(e)?;
                let ndi = Ndi {
                    find_create: *lib.get(b"NDIlib_find_create_v2\0").map_err(e)?,
                    find_wait: *lib.get(b"NDIlib_find_wait_for_sources\0").map_err(e)?,
                    find_sources: *lib.get(b"NDIlib_find_get_current_sources\0").map_err(e)?,
                    recv_create: *lib.get(b"NDIlib_recv_create_v3\0").map_err(e)?,
                    recv_destroy: *lib.get(b"NDIlib_recv_destroy\0").map_err(e)?,
                    recv_capture: *lib.get(b"NDIlib_recv_capture_v2\0").map_err(e)?,
                    recv_free_video: *lib.get(b"NDIlib_recv_free_video_v2\0").map_err(e)?,
                    _lib: lib,
                };
                if !initialize() {
                    return Err("this computer's processor is not supported by NDI".to_string());
                }
                Ok(ndi)
            })()
        };
        match loaded {
            Ok(ndi) => {
                println!("[NDI] Runtime loaded from {}", path.display());
                return Ok(ndi);
            }
            Err(e) => last = e,
        }
    }
    Err(format!(
        "NDI is not installed on this computer. Install NDI Tools (free, from ndi.video) to use NDI sources.{}",
        if last.is_empty() { String::new() } else { format!(" ({last})") }
    ))
}

fn ndi() -> Result<&'static Ndi, String> {
    NDI.get_or_init(load).as_ref().map_err(|e| e.clone())
}

/// The loaded NDI runtime, for NDI out (studio_ndi_out.rs) to look up the sender functions.
/// NDI out is macOS-only for now, so other platforms never call it.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(crate) fn library() -> Result<&'static libloading::Library, String> {
    ndi().map(|n| &n._lib)
}

/// Why NDI can't be used here ("" when it can).
pub fn runtime_error() -> String {
    ndi().err().unwrap_or_default()
}

// ── Finding sources ──────────────────────────────────────────────────────

static SOURCES: OnceLock<Mutex<Vec<String>>> = OnceLock::new();
static FINDER_STARTED: AtomicBool = AtomicBool::new(false);

fn sources() -> &'static Mutex<Vec<String>> {
    SOURCES.get_or_init(|| Mutex::new(Vec::new()))
}

/// Keeps a list of the NDI sources on the network, refreshed in the background.
fn start_finder(ndi: &'static Ndi) {
    if FINDER_STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    thread::spawn(move || {
        let settings = FindCreate {
            show_local_sources: true,
            p_groups: std::ptr::null(),
            p_extra_ips: std::ptr::null(),
        };
        // SAFETY: settings outlives the call; the finder lives for the rest of the app.
        let finder = unsafe { (ndi.find_create)(&settings) };
        if finder.is_null() {
            FINDER_STARTED.store(false, Ordering::SeqCst);
            return;
        }
        loop {
            // SAFETY: finder is valid; the source array is only read before the next call.
            let names = unsafe {
                (ndi.find_wait)(finder, 1000);
                let mut count = 0u32;
                let list = (ndi.find_sources)(finder, &mut count);
                let mut names = Vec::new();
                if !list.is_null() {
                    for i in 0..count as usize {
                        let source = *list.add(i);
                        if !source.p_ndi_name.is_null() {
                            names.push(CStr::from_ptr(source.p_ndi_name).to_string_lossy().into_owned());
                        }
                    }
                }
                names
            };
            if let Ok(mut slot) = sources().lock() {
                *slot = names;
            }
        }
    });
}

/// The NDI sources on the network, e.g. "MEDIA-PC (vMix - Output 1)".
/// The first call waits a moment for sources to answer.
pub fn list_sources() -> Result<Vec<String>, String> {
    let ndi = ndi()?;
    let first = !FINDER_STARTED.load(Ordering::SeqCst);
    start_finder(ndi);
    if first {
        let until = Instant::now() + Duration::from_millis(1500);
        while Instant::now() < until {
            if sources().lock().map(|s| !s.is_empty()).unwrap_or(false) {
                break;
            }
            thread::sleep(Duration::from_millis(100));
        }
    }
    let mut list = sources().lock().map(|s| s.clone()).unwrap_or_default();
    list.sort();
    Ok(list)
}

// ── Receiving one source ─────────────────────────────────────────────────

/// Receives `name` until `keep_going` says stop, sending each picture as a JPEG.
/// `on_running` is called once the receiver exists. Returns an error the operator can read.
pub fn run_capture(
    name: &str,
    keep_going: impl Fn() -> bool,
    on_running: impl FnOnce(),
    mut send: impl FnMut(Vec<u8>),
) -> Result<(), String> {
    let ndi = ndi()?;
    let c_name = CString::new(name).map_err(|_| "That NDI source name is not valid.".to_string())?;
    let recv_name = CString::new("MakeChurchEazy Studio").unwrap();
    let settings = RecvCreateV3 {
        // Connecting by name: NDI finds the source's address itself.
        source_to_connect_to: Source { p_ndi_name: c_name.as_ptr(), p_url_address: std::ptr::null() },
        color_format: COLOR_BGRX_BGRA,
        bandwidth: BANDWIDTH_HIGHEST,
        allow_video_fields: false,
        p_ndi_recv_name: recv_name.as_ptr(),
    };
    // SAFETY: settings and the strings it points to outlive the call.
    let recv = unsafe { (ndi.recv_create)(&settings) };
    if recv.is_null() {
        return Err(format!("Could not connect to the NDI source “{name}”."));
    }
    on_running();

    let started = Instant::now();
    let mut got_any = false;
    let mut last_sent = Instant::now() - Duration::from_secs(1);
    let mut result = Ok(());
    while keep_going() {
        let mut frame: VideoFrameV2 = unsafe { std::mem::zeroed() };
        // SAFETY: recv is valid; audio and metadata are not wanted (null).
        let kind = unsafe {
            (ndi.recv_capture)(recv, &mut frame, std::ptr::null_mut(), std::ptr::null_mut(), 500)
        };
        if kind == FRAME_VIDEO {
            got_any = true;
            // About 30 pictures a second is plenty for a screen (sources often send 50 or 60).
            let wanted = last_sent.elapsed() >= Duration::from_millis(30);
            let rgb = if wanted { frame_to_rgb(&frame) } else { None };
            // SAFETY: the frame came from this receiver and is not used after this.
            unsafe { (ndi.recv_free_video)(recv, &frame) };
            if let Some((w, h, pixels)) = rgb {
                last_sent = Instant::now();
                let mut out = Vec::new();
                let mut enc = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 82);
                if enc.encode(&pixels, w, h, image::ExtendedColorType::Rgb8).is_ok() {
                    send(out);
                }
            }
        } else if kind == FRAME_ERROR {
            result = Err(format!("The NDI source “{name}” stopped sending."));
            break;
        } else if !got_any && started.elapsed() > Duration::from_secs(10) {
            result = Err(format!(
                "No picture from the NDI source “{name}”. Check it is on and on the same network."
            ));
            break;
        }
    }
    // SAFETY: recv is valid and not used after this.
    unsafe { (ndi.recv_destroy)(recv) };
    result
}

/// BGRX / BGRA picture to RGB, halved when it is wider than 1920 (4K sources) to keep JPEGs quick.
fn frame_to_rgb(frame: &VideoFrameV2) -> Option<(u32, u32, Vec<u8>)> {
    if frame.p_data.is_null() || frame.xres <= 0 || frame.yres <= 0 {
        return None;
    }
    if frame.fourcc != FOURCC_BGRA && frame.fourcc != FOURCC_BGRX {
        return None;
    }
    let (w, h) = (frame.xres as usize, frame.yres as usize);
    let stride = if frame.line_stride_in_bytes > 0 { frame.line_stride_in_bytes as usize } else { w * 4 };
    if stride < w * 4 {
        return None;
    }
    let step = if w > 1920 { 2 } else { 1 };
    let (ow, oh) = (w / step, h / step);
    // SAFETY: NDI gives yres rows of `stride` bytes each.
    let data = unsafe { std::slice::from_raw_parts(frame.p_data, stride * h) };
    let mut out = Vec::with_capacity(ow * oh * 3);
    for y in 0..oh {
        let row = &data[y * step * stride..];
        for x in 0..ow {
            let p = &row[x * step * 4..x * step * 4 + 4];
            out.extend_from_slice(&[p[2], p[1], p[0]]);
        }
    }
    Some((ow as u32, oh as u32, out))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn c_struct_layouts_match_the_ndi_header() {
        // 64-bit layouts of NDIlib_video_frame_v2_t / NDIlib_recv_create_v3_t / NDIlib_source_t.
        assert_eq!(std::mem::size_of::<VideoFrameV2>(), 72);
        assert_eq!(std::mem::size_of::<RecvCreateV3>(), 40);
        assert_eq!(std::mem::size_of::<Source>(), 16);
        assert_eq!(std::mem::size_of::<FindCreate>(), 24);
    }

    #[repr(C)]
    struct SendCreate {
        p_ndi_name: *const c_char,
        p_groups: *const c_char,
        clock_video: bool,
        clock_audio: bool,
    }
    type FnSendCreate = unsafe extern "C" fn(*const SendCreate) -> *mut c_void;
    type FnSendVideo = unsafe extern "C" fn(*mut c_void, *const VideoFrameV2);

    /// Publishes a red test picture as an NDI source on this computer until `stop` is set.
    fn send_test_source(name: &'static str, stop: &'static AtomicBool) {
        let ndi = ndi().expect("NDI runtime should load");
        thread::spawn(move || unsafe {
            let create: FnSendCreate = *ndi._lib.get(b"NDIlib_send_create\0").unwrap();
            let send: FnSendVideo = *ndi._lib.get(b"NDIlib_send_send_video_v2\0").unwrap();
            let c_name = CString::new(name).unwrap();
            let settings = SendCreate { p_ndi_name: c_name.as_ptr(), p_groups: std::ptr::null(), clock_video: true, clock_audio: false };
            let sender = create(&settings);
            assert!(!sender.is_null());
            let (w, h) = (640i32, 360i32);
            let mut pixels = vec![0u8; (w * h * 4) as usize];
            for p in pixels.chunks_mut(4) {
                p.copy_from_slice(&[0, 0, 255, 255]); // BGRX red
            }
            while !stop.load(Ordering::SeqCst) {
                let mut frame: VideoFrameV2 = std::mem::zeroed();
                frame.xres = w;
                frame.yres = h;
                frame.fourcc = FOURCC_BGRX;
                frame.frame_rate_n = 30;
                frame.frame_rate_d = 1;
                frame.picture_aspect_ratio = 16.0 / 9.0;
                frame.frame_format_type = 1; // progressive
                frame.timecode = i64::MAX; // "synthesize"
                frame.p_data = pixels.as_mut_ptr();
                frame.line_stride_in_bytes = w * 4;
                send(sender, &frame);
            }
        });
    }

    /// Needs the NDI runtime on this computer: `cargo test studio_ndi -- --ignored --nocapture`.
    /// Publishes its own test source, finds it on the network and receives a picture from it.
    #[test]
    #[ignore]
    fn finds_and_receives_a_source_with_the_installed_runtime() {
        static STOP: AtomicBool = AtomicBool::new(false);
        send_test_source("MCE NDI Test", &STOP);
        let mut list = Vec::new();
        let until = Instant::now() + Duration::from_secs(10);
        while Instant::now() < until {
            list = list_sources().expect("NDI runtime should load");
            if list.iter().any(|n| n.contains("MCE NDI Test")) {
                break;
            }
            thread::sleep(Duration::from_millis(300));
        }
        println!("[NDI test] sources: {list:?}");
        let first = list.iter().find(|n| n.contains("MCE NDI Test")).expect("the test source should be found");
        let got = std::sync::atomic::AtomicUsize::new(0);
        let started = Instant::now();
        let result = run_capture(
            first,
            || got.load(Ordering::SeqCst) == 0 && started.elapsed() < Duration::from_secs(12),
            || {},
            |jpeg| {
                assert!(jpeg.starts_with(&[0xFF, 0xD8]), "a JPEG picture");
                got.store(jpeg.len(), Ordering::SeqCst);
            },
        );
        STOP.store(true, Ordering::SeqCst);
        println!("[NDI test] {first}: {result:?}, first JPEG {} bytes", got.load(Ordering::SeqCst));
        assert!(result.is_ok());
        assert!(got.load(Ordering::SeqCst) > 0, "a picture should arrive");
    }
}
