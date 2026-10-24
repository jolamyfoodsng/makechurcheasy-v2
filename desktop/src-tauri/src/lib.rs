// Tauri Rust backend — MakeChurchEazy
// Commands:
//   save_bg_image      — persist background image to disk (for OBS image_source)
//   save_upload_file   — persist uploaded logo to disk
//   delete_upload_file — remove a user-uploaded media file from managed storage
//   save_countdown_asset — save countdown background asset to managed storage
//   delete_countdown_asset — delete countdown background asset by assetId
//   cleanup_unused_countdown_assets — remove orphaned countdown assets
//   load_app_data      — read app_data.json (or return "{}" if missing)
//   save_app_data      — write app_data.json
//   get_overlay_port   — return the port of the local overlay HTTP server
//   load_dock_data     — read dock-shared JSON from the uploads directory
// On startup, a lightweight HTTP server is spawned on a localhost port
// to serve overlay HTML files (Bible, Worship, Lower Third) so that OBS
// browser sources can access them. Tauri's internal protocol (tauri:// or
// https://tauri.localhost) is NOT reachable by OBS/CEF, so we need a real
// localhost server.

mod assemblyai_stream;
mod voice_guard;
#[cfg(any(target_os = "windows", target_os = "macos"))]
mod audio_capture;
mod device_fingerprint;
mod license_verify;
mod dock_settings;
#[cfg(target_os = "macos")]
mod local_llm;
#[cfg(not(target_os = "macos"))]
mod local_llm_stub;
mod media_refs;
mod mobile_companion;
mod obs_move_plugin;
mod overlay_relay;
mod presentation_remote;
mod sandbox_migration;
mod studio_camera;
mod studio_ndi;
mod studio_ndi_out;
mod verse_ai_ndi;
#[cfg(not(target_os = "macos"))]
use local_llm_stub as local_llm;

use chrono::Utc;
use hmac::{Hmac, Mac};
use quick_xml::de::from_str as from_xml_str;
use scraper::{Html, Selector};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap};
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom, Write};
use std::net::{SocketAddr, TcpStream, UdpSocket};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU16, Ordering};
use std::sync::{mpsc, Arc, Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{image::Image, Emitter, Manager};
use uuid::Uuid;

/// The port the overlay server is running on (set at startup).
/// Always canonical port 45678 so OBS custom browser docks and overlays never change.
static OVERLAY_PORT: AtomicU16 = AtomicU16::new(45678);

/// In-memory auth session for the OBS dock.
/// Written by POST /api/auth/session, read by GET /api/auth/status.
/// Avoids file-sync race conditions on app startup.
static AUTH_SESSION: OnceLock<Mutex<Option<String>>> = OnceLock::new();
static DOCK_NOTES_COMMAND_QUEUE: OnceLock<Mutex<Vec<String>>> = OnceLock::new();

const LOCAL_SEND_MAX_FILE_BYTES: u64 = 4 * 1024 * 1024 * 1024;

#[derive(Clone)]
struct LocalSendUploadFile {
    file_name: String,
    file_type: String,
    size: u64,
    sha256: Option<String>,
    token: String,
    destination: String,
}

struct LocalSendUploadSession {
    created_at: Instant,
    files: HashMap<String, LocalSendUploadFile>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalShareDeviceInfo {
    alias: String,
    version: String,
    device_model: String,
    device_type: String,
    fingerprint: String,
    host: String,
    port: u16,
    protocol: String,
    download: bool,
    transfer_token: String,
    base_url: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalShareFileInput {
    file_path: String,
    #[serde(default)]
    file_name: Option<String>,
    #[serde(default)]
    file_type: Option<String>,
    #[serde(default)]
    temporary: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalShareFileMetadata {
    id: String,
    file_name: String,
    file_type: String,
    file_size: u64,
    file_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalShareTransferProgress {
    file_id: String,
    file_name: String,
    bytes_sent: u64,
    total_bytes: u64,
    completed_files: usize,
    total_files: usize,
    status: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalShareSentFile {
    file_id: String,
    file_name: String,
    file_size: u64,
    display_path: String,
}

struct LocalShareProgressReader {
    file: File,
    file_id: String,
    file_name: String,
    total_bytes: u64,
    bytes_sent: u64,
    completed_files: usize,
    total_files: usize,
    app_handle: tauri::AppHandle,
    last_emit: Instant,
}

impl Read for LocalShareProgressReader {
    fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
        let count = self.file.read(buffer)?;
        self.bytes_sent += count as u64;

        if count > 0 && self.last_emit.elapsed() >= Duration::from_millis(180) {
            let _ = self.app_handle.emit(
                "local-share-progress",
                LocalShareTransferProgress {
                    file_id: self.file_id.clone(),
                    file_name: self.file_name.clone(),
                    bytes_sent: self.bytes_sent,
                    total_bytes: self.total_bytes,
                    completed_files: self.completed_files,
                    total_files: self.total_files,
                    status: "sending".to_string(),
                },
            );
            self.last_emit = Instant::now();
        }

        Ok(count)
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReceivedFileRecord {
    pending_id: String,
    file_name: String,
    stored_file_name: String,
    file_size: u64,
    file_type: String,
    sha256: String,
    received_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReceivedFileActionResult {
    pending_id: String,
    file_name: String,
    stored_file_name: String,
    file_size: u64,
    file_type: String,
    sha256: String,
    file_path: String,
}

fn dev_window_icon() -> Option<Image<'static>> {
    None
}

// ── macOS App Nap prevention ─────────────────────────────────────────────────
// When MakeChurchEazy is transcribing in the background, macOS may throttle the app
// via App Nap. This creates an IOKit power assertion to prevent that.

#[cfg(target_os = "macos")]
mod app_nap {
    use std::sync::atomic::{AtomicU32, Ordering};

    // IOKit power management constants — names match Apple's API
    #[allow(non_upper_case_globals)]
    const kIOPMAssertionTypePreventUserIdleSystemSleep: &str = "PreventUserIdleSystemSleep";

    #[link(name = "IOKit", kind = "framework")]
    extern "C" {
        fn IOPMAssertionCreateWithName(
            assertion_type: *const core::ffi::c_void,
            assertion_level: u32,
            reason: *const core::ffi::c_void,
            assertion_id: *mut u32,
        ) -> i32;
        fn IOPMAssertionRelease(assertion_id: u32) -> i32;
    }

    static ASSERTION_ID: AtomicU32 = AtomicU32::new(0);

    /// Create a power assertion that prevents macOS from putting the app into
    /// App Nap.  Safe to call multiple times — only the first call has effect.
    pub fn prevent_app_nap() {
        if ASSERTION_ID.load(Ordering::Relaxed) != 0 {
            return; // already held
        }

        // Create CFString for the assertion type
        let assertion_type = cf_string_from_str(kIOPMAssertionTypePreventUserIdleSystemSleep);
        let reason = cf_string_from_str("MakeChurchEazy — live transcription active");
        let mut id: u32 = 0;

        let result = unsafe {
            IOPMAssertionCreateWithName(
                assertion_type as *const _,
                255, // kIOPMAssertionLevelMax
                reason as *const _,
                &mut id,
            )
        };

        // Release the CFStrings — IOKit retains them internally
        unsafe {
            cf_release(assertion_type);
            cf_release(reason);
        }

        if result == 0 && id != 0 {
            ASSERTION_ID.store(id, Ordering::Relaxed);
            println!("[AppNap] Power assertion created (id={id}) — App Nap disabled");
        } else {
            eprintln!("[AppNap] Failed to create power assertion (err={result})");
        }
    }

    /// Release the power assertion, re-enabling App Nap.
    #[allow(dead_code)]
    pub fn allow_app_nap() {
        let id = ASSERTION_ID.swap(0, Ordering::Relaxed);
        if id != 0 {
            unsafe {
                IOPMAssertionRelease(id);
            }
            println!("[AppNap] Power assertion released (id={id}) — App Nap re-enabled");
        }
    }

    // ── CoreFoundation helpers ───────────────────────────────────────────────

    type CFStringRef = *const core::ffi::c_void;
    type CFTypeRef = *const core::ffi::c_void;

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFStringCreateWithCString(
            allocator: CFStringRef,
            c_str: *const core::ffi::c_char,
            encoding: u32,
        ) -> CFStringRef;
        fn CFRelease(cf: CFTypeRef);
    }

    #[allow(non_upper_case_globals)]
    const kCFStringEncodingUTF8: u32 = 0x08000100;

    fn cf_string_from_str(s: &str) -> CFStringRef {
        let cstr = std::ffi::CString::new(s).unwrap();
        unsafe { CFStringCreateWithCString(std::ptr::null(), cstr.as_ptr(), kCFStringEncodingUTF8) }
    }

    unsafe fn cf_release(cf: CFTypeRef) {
        if !cf.is_null() {
            CFRelease(cf);
        }
    }
}

/// The app handle, so the local overlay server can open a native "Save as" dialog for pages that
/// run outside the Tauri webview (the OBS Dock).
static SAVE_DIALOG_APP: OnceLock<tauri::AppHandle> = OnceLock::new();

static LM_STATE: OnceLock<Mutex<String>> = OnceLock::new();
/// Presentation Studio program state: (revision, JSON). Written by the app, read by studio-output.html.
static STUDIO_STATE: OnceLock<Mutex<(u64, String)>> = OnceLock::new();
/// Verse AI output state: (revision, JSON). Same shape of server as STUDIO_STATE, kept apart from it.
static VERSE_AI_STATE: OnceLock<Mutex<(u64, String)>> = OnceLock::new();
/// Presentation Studio live camera: (frame number, newest JPEG). The Studio POSTs frames of the camera
/// it already has open; studio-output.html (projector window, TV, OBS) GETs the newest one, so the
/// camera is opened only once (many cameras and capture cards allow a single user).
static STUDIO_CAMERA_FRAME: OnceLock<Mutex<(u64, Vec<u8>)>> = OnceLock::new();

/// Wakes every open camera stream (`api/studio-camera/stream`) when a new picture arrives.
static STUDIO_CAMERA_SIGNAL: OnceLock<std::sync::Condvar> = OnceLock::new();

fn studio_camera_frame() -> &'static Mutex<(u64, Vec<u8>)> {
    STUDIO_CAMERA_FRAME.get_or_init(|| Mutex::new((0, Vec::new())))
}

fn studio_camera_signal() -> &'static std::sync::Condvar {
    STUDIO_CAMERA_SIGNAL.get_or_init(std::sync::Condvar::new)
}

/// Stores the newest native camera picture where `api/studio-camera` serves it (empty = camera off).
fn publish_studio_camera_frame(bytes: Vec<u8>) {
    if let Ok(mut state) = studio_camera_frame().lock() {
        state.0 += 1;
        state.1 = bytes;
    }
    studio_camera_signal().notify_all();
}

/// The live camera as one long MJPEG response (multipart/x-mixed-replace): each new picture is
/// written the moment it exists, like a video stream, instead of every window asking for it again
/// and again. Runs on its own thread, so a video or a page being served never holds it up.
#[cfg(test)]
mod studio_camera_stream_tests {
    use super::*;

    #[test]
    fn writes_each_new_picture_as_one_mjpeg_part() {
        publish_studio_camera_frame(vec![0xFF, 0xD8, 1, 2, 3]);
        let start = studio_camera_frame().lock().unwrap().0 - 1;
        let mut stream = StudioCameraStream { seq: start, chunk: Vec::new(), pos: 0, sent_any: false, opened: Instant::now() };
        let mut buf = [0u8; 4096];
        let n = stream.read(&mut buf).unwrap();
        let text = String::from_utf8_lossy(&buf[..n]).to_string();
        assert!(text.starts_with("--mceframe\r\nContent-Type: image/jpeg\r\nContent-Length: 5\r\n"), "{text}");
        assert!(buf[..n].ends_with(&[0xFF, 0xD8, 1, 2, 3, b'\r', b'\n']));
        // The next picture wakes the waiting stream at once.
        std::thread::spawn(|| {
            std::thread::sleep(Duration::from_millis(50));
            publish_studio_camera_frame(vec![9, 9]);
        });
        let started = Instant::now();
        let n = stream.read(&mut buf).unwrap();
        assert!(started.elapsed() < Duration::from_millis(1000));
        assert!(buf[..n].ends_with(&[9, 9, b'\r', b'\n']));
        // Camera off after pictures were sent: the stream ends so the window knows.
        publish_studio_camera_frame(Vec::new());
        assert_eq!(stream.read(&mut buf).unwrap(), 0);
    }
}

struct StudioCameraStream {
    seq: u64,
    chunk: Vec<u8>,
    pos: usize,
    sent_any: bool,
    opened: Instant,
}

impl Read for StudioCameraStream {
    fn read(&mut self, out: &mut [u8]) -> std::io::Result<usize> {
        loop {
            if self.pos < self.chunk.len() {
                let n = (self.chunk.len() - self.pos).min(out.len());
                out[..n].copy_from_slice(&self.chunk[self.pos..self.pos + n]);
                self.pos += n;
                return Ok(n);
            }
            let lock_err = |_| std::io::Error::new(std::io::ErrorKind::Other, "camera frame lock");
            let mut state = studio_camera_frame().lock().map_err(lock_err)?;
            // Wait for a newer picture. After 2 s the last one is sent again: that keeps the
            // connection alive, and a window that has gone away is noticed when the write fails.
            let deadline = Instant::now() + Duration::from_secs(2);
            while state.0 <= self.seq {
                let now = Instant::now();
                if now >= deadline {
                    break;
                }
                state = studio_camera_signal()
                    .wait_timeout(state, deadline - now)
                    .map_err(|_| std::io::Error::new(std::io::ErrorKind::Other, "camera frame wait"))?
                    .0;
            }
            if state.1.is_empty() {
                // Camera off. Before the first picture, wait a while (it may still be opening);
                // after pictures were sent, end the stream so the window knows.
                if self.sent_any || self.opened.elapsed() > Duration::from_secs(20) {
                    return Ok(0);
                }
                self.seq = state.0;
                continue;
            }
            self.seq = state.0;
            let jpeg = state.1.clone();
            drop(state);
            if let Ok(mut last) = STUDIO_CAMERA_WANTED.get_or_init(|| Mutex::new(None)).lock() {
                *last = Some(Instant::now());
            }
            let mut chunk = format!(
                "--mceframe\r\nContent-Type: image/jpeg\r\nContent-Length: {}\r\nX-Frame-Seq: {}\r\n\r\n",
                jpeg.len(),
                self.seq
            )
            .into_bytes();
            chunk.extend_from_slice(&jpeg);
            chunk.extend_from_slice(b"\r\n");
            self.chunk = chunk;
            self.pos = 0;
            self.sent_any = true;
        }
    }
}
/// When a screen window last asked for a camera picture (the Studio sends fewer while nobody does).
static STUDIO_CAMERA_WANTED: OnceLock<Mutex<Option<Instant>>> = OnceLock::new();
/// Small mailbox the Studio and the screen windows use to set up the live camera video link:
/// (last message number, [(number, who it is for, message as JSON text)]).
static STUDIO_RTC_MAILBOX: OnceLock<Mutex<(u64, Vec<(u64, String, String)>)>> = OnceLock::new();
/// Live rundown/timer state shared between the OBS Dock (controller) and the
/// presenter screen (rundown-presenter.html), possibly on another LAN device.
static RUNDOWN_STATE: OnceLock<Mutex<String>> = OnceLock::new();
static LM_COMMAND_QUEUE: OnceLock<Mutex<Vec<String>>> = OnceLock::new();
/// Navigation commands have a second consumer: the Bible tab running in the
/// OBS CEF process. Keep a copy separate from the main-app LM queue so the
/// Tauri service cannot drain the command before the OBS dock sees it.
static LM_BIBLE_NAVIGATION_QUEUE: OnceLock<Mutex<Vec<String>>> = OnceLock::new();
pub(crate) static PRESENTATION_STATE: OnceLock<Mutex<BTreeMap<String, PresentationStateEnvelope>>> =
    OnceLock::new();
pub(crate) static PRESENTATION_VIEWERS: OnceLock<Mutex<BTreeMap<String, BTreeMap<String, u64>>>> =
    OnceLock::new();
const ONLINE_LYRICS_RESULT_LIMIT: usize = 18;
const ONLINE_LYRICS_USER_AGENT: &str =
    "MakeChurchEasy/1.0 (+https://localhost; worship-online-lyrics)";
const TEMPLATE_VIDEO_PREFIX: &str = "template_videos/";
const TEMPLATE_VIDEO_URL_TTL_SECONDS: u32 = 900;
const TEMPLATE_VIDEO_LIST_TTL_SECONDS: u32 = 300;

type HmacSha256 = Hmac<Sha256>;

const PRESENTATION_VIEWER_TTL_MS: u64 = 15_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PresentationStateEnvelope {
    pub(crate) session_id: String,
    pub(crate) fullscreen: Option<serde_json::Value>,
    pub(crate) lower_third: Option<serde_json::Value>,
    /// Broadcast graphic over everything else ({ url, version }). Kept when a
    /// publish leaves it out, so Bible / media / worship don't clear it.
    #[serde(default)]
    pub(crate) graphic: Option<serde_json::Value>,
    pub(crate) updated_at: u64,
}

/// Merge a published presentation state with the previous one for the session:
/// - no "graphic" key in the body -> keep the previous graphic;
/// - "graphicOnly": true -> keep the previous fullscreen / lower-third content.
pub(crate) fn merge_presentation_state(
    raw_body: &str,
    payload: &mut PresentationStateEnvelope,
    previous: Option<&PresentationStateEnvelope>,
) {
    let Some(previous) = previous else {
        return;
    };
    let raw: serde_json::Value = serde_json::from_str(raw_body).unwrap_or(serde_json::Value::Null);
    let graphic_only = raw
        .get("graphicOnly")
        .and_then(|value| value.as_bool())
        .unwrap_or(false);
    if graphic_only {
        payload.fullscreen = previous.fullscreen.clone();
        payload.lower_third = previous.lower_third.clone();
    }
    if raw.get("graphic").is_none() {
        payload.graphic = previous.graphic.clone();
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PresentationViewerHeartbeat {
    pub(crate) session_id: String,
    pub(crate) viewer_id: String,
}

pub(crate) fn now_unix_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

pub(crate) fn presentation_viewer_count(session_id: &str) -> usize {
    let registry = PRESENTATION_VIEWERS.get_or_init(|| Mutex::new(BTreeMap::new()));
    let now = now_unix_millis();
    let mut guard = match registry.lock() {
        Ok(guard) => guard,
        Err(_) => return 0,
    };

    if let Some(viewers) = guard.get_mut(session_id) {
        viewers.retain(|_, seen_at| now.saturating_sub(*seen_at) <= PRESENTATION_VIEWER_TTL_MS);
        let count = viewers.len();
        if count == 0 {
            guard.remove(session_id);
        }
        return count;
    }

    0
}

/// True if the directory contains the overlay HTML entrypoint(s).
fn has_overlay_assets(dir: &std::path::Path) -> bool {
    dir.join("mce-bible-overlay.html").is_file() || dir.join("mce-worship-overlay.html").is_file()
}

/// Resolve where bundled overlay HTML files were placed.
///
/// Depending on platform/packaging mode, Tauri may place resources in different
/// locations relative to resource_dir():
///   - resource_dir/                   ← flat resources
///   - resource_dir/_up_/dist/         ← array-style resources with ../ prefix
///   - exe_dir/                        ← Windows NSIS: alongside the exe
fn resolve_bundled_overlay_dir(resource_dir: &std::path::Path) -> Option<std::path::PathBuf> {
    // Also try the directory containing the executable itself, which on
    // Windows NSIS is the install root and may hold resources directly.
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()));

    let mut candidates = vec![
        resource_dir.to_path_buf(),
        resource_dir.join("dist"),
        resource_dir.join("_up_"),
        resource_dir.join("_up_").join("dist"),
        resource_dir.join("resources"),
    ];

    if let Some(ref exe) = exe_dir {
        if exe != resource_dir {
            candidates.push(exe.clone());
            candidates.push(exe.join("dist"));
            candidates.push(exe.join("_up_"));
            candidates.push(exe.join("_up_").join("dist"));
            candidates.push(exe.join("resources"));
        }
    }

    for dir in &candidates {
        let found = has_overlay_assets(dir);
        println!(
            "[Overlay Resolve] {:?} → {}",
            dir,
            if found { "FOUND" } else { "miss" }
        );
    }

    candidates.into_iter().find(|dir| has_overlay_assets(dir))
}

/// Dev fallback: locate `<project>/public` from the running executable.
fn resolve_dev_public_dir() -> Option<std::path::PathBuf> {
    let exe = std::env::current_exe().ok()?;
    // exe is typically: <project>/src-tauri/target/{debug|release}/<binary>
    let project_root = exe
        .parent() // .../target/{debug|release}
        .and_then(|p| p.parent()) // .../target
        .and_then(|p| p.parent()) // .../src-tauri
        .and_then(|p| p.parent()); // .../<project>

    if let Some(root) = project_root {
        let public_dir = root.join("public");
        if has_overlay_assets(&public_dir) {
            return Some(public_dir);
        }
    }

    // Last-resort paths during local development.
    let cwd_public = std::path::PathBuf::from("public");
    if has_overlay_assets(&cwd_public) {
        return Some(cwd_public);
    }
    let parent_public = std::path::PathBuf::from("../public");
    if has_overlay_assets(&parent_public) {
        return Some(parent_public);
    }

    None
}

/// Base directory: ~/Documents/MakeChurchEasy/
fn app_dir() -> Result<std::path::PathBuf, String> {
    let home = dirs::home_dir().ok_or("Could not determine home directory")?;
    let dir = home.join("Documents").join("MakeChurchEasy");
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create app directory: {}", e))?;
    Ok(dir)
}

/// Convert a user-provided filename into a safe basename for local storage.
/// Rejects empty names and strips any path components.
fn sanitize_filename_for_storage(file_name: &str) -> Result<String, String> {
    let base = Path::new(file_name)
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("Invalid file name")?;

    let safe = base
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '.' || ch == '_' || ch == '-' {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>();

    let trimmed = safe.trim_matches('.');
    if trimmed.is_empty() || trimmed == "." || trimmed == ".." {
        return Err("Invalid file name".to_string());
    }

    Ok(trimmed.to_string())
}

/// Validate an existing upload basename without rewriting it. Legacy uploads
/// may contain spaces, so deletion must target the exact stored filename.
fn validate_upload_basename(file_name: &str) -> Result<String, String> {
    let trimmed = file_name.trim();
    let base = Path::new(trimmed)
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("Invalid upload file name")?;
    if trimmed.is_empty()
        || trimmed == "."
        || trimmed == ".."
        || trimmed.contains('/')
        || trimmed.contains('\\')
        || trimmed.contains('\0')
        || base != trimmed
    {
        return Err("Invalid upload file name".to_string());
    }
    Ok(trimmed.to_string())
}

fn local_share_fingerprint(token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn local_share_device_info(host: Option<String>) -> Result<LocalShareDeviceInfo, String> {
    let transfer_token =
        tauri::async_runtime::block_on(mobile_companion::get_or_create_pairing_token());
    let host = host
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| get_local_ip().unwrap_or_else(|| "127.0.0.1".to_string()));
    let port = OVERLAY_PORT.load(Ordering::Relaxed);
    let port = if port == 0 { 45678 } else { port };
    let hostname = hostname::get()
        .map(|value| value.to_string_lossy().trim().to_string())
        .unwrap_or_default();
    let hostname = if hostname.is_empty() {
        "This computer".to_string()
    } else {
        hostname
    };

    Ok(LocalShareDeviceInfo {
        alias: format!("MakeChurchEazy · {hostname}"),
        version: "2.0".to_string(),
        device_model: std::env::consts::OS.to_string(),
        device_type: "desktop".to_string(),
        fingerprint: local_share_fingerprint(&transfer_token),
        host: host.clone(),
        port,
        protocol: "http".to_string(),
        download: true,
        transfer_token,
        base_url: format!("http://{}:{}", host, port),
    })
}

fn mime_type_for_file_name(file_name: &str) -> String {
    let extension = Path::new(file_name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    match extension.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        "mp4" => "video/mp4",
        "mov" => "video/quicktime",
        "m4v" => "video/x-m4v",
        "webm" => "video/webm",
        "avi" => "video/x-msvideo",
        "mkv" => "video/x-matroska",
        "wmv" => "video/x-ms-wmv",
        "flv" => "video/x-flv",
        "pdf" => "application/pdf",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        _ => "application/octet-stream",
    }
    .to_string()
}

fn local_share_file_metadata(
    file_path: &Path,
    id: String,
) -> Result<LocalShareFileMetadata, String> {
    let metadata = fs::metadata(file_path)
        .map_err(|error| format!("Could not read file {}: {error}", file_path.display()))?;
    if !metadata.is_file() {
        return Err(format!("{} is not a file", file_path.display()));
    }

    let file_name = file_path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| {
            format!(
                "Could not determine the file name for {}",
                file_path.display()
            )
        })?
        .to_string();

    Ok(LocalShareFileMetadata {
        id,
        file_type: mime_type_for_file_name(&file_name),
        file_name,
        file_size: metadata.len(),
        file_path: file_path.to_string_lossy().to_string(),
    })
}

fn local_send_pairing_token_matches(request: &tiny_http::Request) -> bool {
    let candidate = overlay_header_value(request, "X-Device-Token").unwrap_or_default();
    if candidate.trim().is_empty() {
        return false;
    }

    let expected = tauri::async_runtime::block_on(mobile_companion::get_or_create_pairing_token());
    candidate.trim() == expected
}

fn local_send_query_value(url_path: &str, name: &str) -> Option<String> {
    url_path
        .split_once('?')
        .map(|(_, query)| query)
        .and_then(|query| {
            query.split('&').find_map(|part| {
                let (key, value) = part.split_once('=')?;
                if key != name {
                    return None;
                }
                Some(urlencoding::decode(value).unwrap_or_default().into_owned())
            })
        })
}

fn local_send_storage_path(
    destination: &str,
    file_name: &str,
) -> Result<(PathBuf, String, Option<String>), String> {
    let safe_name = sanitize_filename_for_storage(file_name)?;
    let transfer_id = uuid::Uuid::new_v4().simple().to_string();

    if destination == "receiver" {
        let receiver_dir = app_dir()?.join("receiver");
        fs::create_dir_all(&receiver_dir)
            .map_err(|error| format!("Could not create receiver folder: {error}"))?;
        let stored_name = format!("pending_{transfer_id}_{safe_name}");
        return Ok((
            receiver_dir.join(&stored_name),
            stored_name,
            Some(transfer_id),
        ));
    }

    if destination == "mce" {
        let uploads_dir = app_dir()?.join("uploads");
        fs::create_dir_all(&uploads_dir)
            .map_err(|error| format!("Could not create MCE uploads folder: {error}"))?;
        let stored_name = format!("mobile_{transfer_id}_{safe_name}");
        return Ok((uploads_dir.join(&stored_name), stored_name, None));
    }

    let downloads_dir = dirs::download_dir()
        .or_else(|| dirs::home_dir().map(|home| home.join("Downloads")))
        .ok_or_else(|| "Could not determine the laptop Downloads folder".to_string())?
        .join("MakeChurchEasy")
        .join("Received");
    fs::create_dir_all(&downloads_dir)
        .map_err(|error| format!("Could not create the laptop receive folder: {error}"))?;

    let mut stored_name = safe_name.clone();
    let initial_path = downloads_dir.join(&stored_name);
    if initial_path.exists() {
        let path = Path::new(&safe_name);
        let stem = path
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("file");
        let extension = path.extension().and_then(|value| value.to_str());
        stored_name = match extension {
            Some(extension) => format!("{stem}_{transfer_id}.{extension}"),
            None => format!("{stem}_{transfer_id}"),
        };
    }

    Ok((downloads_dir.join(&stored_name), stored_name, None))
}

fn local_send_mce_file_supported(file_name: &str, file_type: &str) -> bool {
    if file_type.starts_with("image/") || file_type.starts_with("video/") {
        return true;
    }
    let extension = Path::new(file_name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    matches!(extension.as_str(), "pdf" | "docx" | "pptx")
}

fn received_files_dir() -> Result<PathBuf, String> {
    let directory = app_dir()?.join("receiver");
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Could not create receiver folder: {error}"))?;
    Ok(directory)
}

fn received_file_record_path(pending_id: &str) -> Result<PathBuf, String> {
    if pending_id.is_empty()
        || !pending_id
            .chars()
            .all(|character| character.is_ascii_alphanumeric())
    {
        return Err("Invalid received file id".to_string());
    }

    Ok(received_files_dir()?.join(format!("pending_{pending_id}.json")))
}

fn received_file_source_path(record: &ReceivedFileRecord) -> Result<PathBuf, String> {
    let safe_name = sanitize_filename_for_storage(&record.stored_file_name)?;
    Ok(received_files_dir()?.join(safe_name))
}

fn read_received_file_records() -> Result<Vec<ReceivedFileRecord>, String> {
    let directory = received_files_dir()?;
    let mut records = fs::read_dir(&directory)
        .map_err(|error| format!("Could not read receiver folder: {error}"))?
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| {
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) != Some("json") {
                return None;
            }
            fs::read_to_string(path)
                .ok()
                .and_then(|content| serde_json::from_str::<ReceivedFileRecord>(&content).ok())
        })
        .filter(|record| {
            received_file_source_path(record)
                .map(|path| path.is_file())
                .unwrap_or(false)
        })
        .collect::<Vec<_>>();

    records.sort_by(|left, right| right.received_at.cmp(&left.received_at));
    Ok(records)
}

fn find_received_file(pending_id: &str) -> Result<ReceivedFileRecord, String> {
    read_received_file_records()?
        .into_iter()
        .find(|record| record.pending_id == pending_id)
        .ok_or_else(|| "Received file is no longer waiting".to_string())
}

fn remove_received_file(record: &ReceivedFileRecord) -> Result<(), String> {
    let source_path = received_file_source_path(record)?;
    let record_path = received_file_record_path(&record.pending_id)?;
    if source_path.exists() {
        fs::remove_file(&source_path)
            .map_err(|error| format!("Could not remove received file: {error}"))?;
    }
    if record_path.exists() {
        fs::remove_file(&record_path)
            .map_err(|error| format!("Could not remove received file record: {error}"))?;
    }
    Ok(())
}

fn unique_folder_target(folder: &Path, file_name: &str) -> Result<PathBuf, String> {
    let safe_name = sanitize_filename_for_storage(file_name)?;
    let initial = folder.join(&safe_name);
    if !initial.exists() {
        return Ok(initial);
    }

    let path = Path::new(&safe_name);
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("file");
    let extension = path.extension().and_then(|value| value.to_str());
    let suffix = uuid::Uuid::new_v4().simple().to_string();
    let candidate = match extension {
        Some(extension) => folder.join(format!("{stem}_{suffix}.{extension}")),
        None => folder.join(format!("{stem}_{suffix}")),
    };
    Ok(candidate)
}

#[derive(Clone)]
struct TemplateVideoR2Config {
    account_id: String,
    bucket: String,
    access_key_id: String,
    secret_access_key: String,
    public_base_url: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TemplateVideoAsset {
    id: String,
    file_name: String,
    video_url: String,
    cloudflare_key: String,
    size: Option<u64>,
    modified: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SavedBackgroundVideoFile {
    file_path: String,
    relative_url: String,
}

#[derive(Debug, Deserialize)]
struct R2ListBucketResult {
    #[serde(rename = "Contents", default)]
    contents: Vec<R2ListBucketObject>,
}

#[derive(Debug, Deserialize)]
struct R2ListBucketObject {
    #[serde(rename = "Key")]
    key: String,
    #[serde(rename = "LastModified")]
    last_modified: Option<String>,
    #[serde(rename = "Size")]
    size: Option<u64>,
}

fn load_template_video_r2_config() -> Result<TemplateVideoR2Config, String> {
    let account_id = std::env::var("CLOUDFLARE_R2_ACCOUNT_ID")
        .map_err(|_| "Missing CLOUDFLARE_R2_ACCOUNT_ID".to_string())?;
    let bucket = std::env::var("CLOUDFLARE_R2_BUCKET")
        .map_err(|_| "Missing CLOUDFLARE_R2_BUCKET".to_string())?;
    let access_key_id = std::env::var("CLOUDFLARE_R2_ACCESS_KEY_ID")
        .map_err(|_| "Missing CLOUDFLARE_R2_ACCESS_KEY_ID".to_string())?;
    let secret_access_key = std::env::var("CLOUDFLARE_R2_SECRET_ACCESS_KEY")
        .map_err(|_| "Missing CLOUDFLARE_R2_SECRET_ACCESS_KEY".to_string())?;
    let public_base_url = std::env::var("CLOUDFLARE_TEMPLATE_VIDEOS_PUBLIC_BASE_URL")
        .ok()
        .or_else(|| std::env::var("CLOUDFLARE_R2_PUBLIC_BASE_URL").ok())
        .map(|value| value.trim().trim_end_matches('/').to_string())
        .filter(|value| !value.is_empty());

    Ok(TemplateVideoR2Config {
        account_id,
        bucket,
        access_key_id,
        secret_access_key,
        public_base_url,
    })
}

fn hex_encode(bytes: &[u8]) -> String {
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push_str(&format!("{:02x}", byte));
    }
    output
}

fn sha256_hex(input: &[u8]) -> String {
    let digest = Sha256::digest(input);
    hex_encode(&digest)
}

fn hmac_sha256(key: &[u8], data: &str) -> Result<Vec<u8>, String> {
    let mut mac =
        HmacSha256::new_from_slice(key).map_err(|e| format!("HMAC init failed: {}", e))?;
    mac.update(data.as_bytes());
    Ok(mac.finalize().into_bytes().to_vec())
}

fn encode_query_component(value: &str) -> String {
    urlencoding::encode(value).into_owned()
}

fn encode_path_segments(path: &str) -> String {
    path.split('/')
        .filter(|segment| !segment.is_empty())
        .map(|segment| urlencoding::encode(segment).into_owned())
        .collect::<Vec<_>>()
        .join("/")
}

fn build_public_template_video_url(base: &str, key: &str) -> String {
    let trimmed = base.trim_end_matches('/');
    let suffix = if trimmed.ends_with("/template_videos") || trimmed.ends_with("template_videos") {
        key.strip_prefix(TEMPLATE_VIDEO_PREFIX).unwrap_or(key)
    } else {
        key
    };
    format!("{}/{}", trimmed, encode_path_segments(suffix))
}

fn build_r2_presigned_get_url(
    config: &TemplateVideoR2Config,
    object_key: Option<&str>,
    extra_query: &[(String, String)],
    expires_in: u32,
) -> Result<String, String> {
    let now = Utc::now();
    let amz_date = now.format("%Y%m%dT%H%M%SZ").to_string();
    let date_stamp = now.format("%Y%m%d").to_string();
    let region = "auto";
    let service = "s3";
    let host = format!("{}.r2.cloudflarestorage.com", config.account_id);
    let canonical_uri = if let Some(key) = object_key {
        format!(
            "/{}/{}",
            encode_path_segments(&config.bucket),
            encode_path_segments(key)
        )
    } else {
        format!("/{}", encode_path_segments(&config.bucket))
    };

    let credential_scope = format!("{}/{}/{}/aws4_request", date_stamp, region, service);
    let mut query = BTreeMap::new();
    for (key, value) in extra_query {
        query.insert(key.clone(), value.clone());
    }
    query.insert(
        "X-Amz-Algorithm".to_string(),
        "AWS4-HMAC-SHA256".to_string(),
    );
    query.insert(
        "X-Amz-Credential".to_string(),
        format!("{}/{}", config.access_key_id, credential_scope),
    );
    query.insert("X-Amz-Date".to_string(), amz_date.clone());
    query.insert("X-Amz-Expires".to_string(), expires_in.to_string());
    query.insert("X-Amz-SignedHeaders".to_string(), "host".to_string());

    let canonical_query = query
        .iter()
        .map(|(key, value)| {
            format!(
                "{}={}",
                encode_query_component(key),
                encode_query_component(value)
            )
        })
        .collect::<Vec<_>>()
        .join("&");

    let canonical_headers = format!("host:{}\n", host);
    let canonical_request = format!(
        "GET\n{}\n{}\n{}\nhost\nUNSIGNED-PAYLOAD",
        canonical_uri, canonical_query, canonical_headers
    );
    let string_to_sign = format!(
        "AWS4-HMAC-SHA256\n{}\n{}\n{}",
        amz_date,
        credential_scope,
        sha256_hex(canonical_request.as_bytes())
    );

    let k_date = hmac_sha256(
        format!("AWS4{}", config.secret_access_key).as_bytes(),
        &date_stamp,
    )?;
    let k_region = hmac_sha256(&k_date, region)?;
    let k_service = hmac_sha256(&k_region, service)?;
    let k_signing = hmac_sha256(&k_service, "aws4_request")?;
    let signature = hex_encode(&hmac_sha256(&k_signing, &string_to_sign)?);

    Ok(format!(
        "https://{}{}?{}&X-Amz-Signature={}",
        host, canonical_uri, canonical_query, signature
    ))
}

fn list_template_video_assets_internal() -> Result<Vec<TemplateVideoAsset>, String> {
    let config = load_template_video_r2_config()?;
    let list_url = build_r2_presigned_get_url(
        &config,
        None,
        &[
            ("list-type".to_string(), "2".to_string()),
            ("prefix".to_string(), TEMPLATE_VIDEO_PREFIX.to_string()),
        ],
        TEMPLATE_VIDEO_LIST_TTL_SECONDS,
    )?;

    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| format!("Failed to create template video client: {}", e))?;
    let response = client
        .get(&list_url)
        .send()
        .map_err(|e| format!("Failed to list template videos: {}", e))?;
    if !response.status().is_success() {
        return Err(format!(
            "Template video listing failed with status {}",
            response.status()
        ));
    }

    let xml = response
        .text()
        .map_err(|e| format!("Failed to read template video listing: {}", e))?;
    let parsed: R2ListBucketResult = from_xml_str(&xml)
        .map_err(|e| format!("Failed to parse template video listing XML: {}", e))?;

    let mut assets = Vec::new();
    for object in parsed.contents {
        let Some(file_name) = object
            .key
            .strip_prefix(TEMPLATE_VIDEO_PREFIX)
            .filter(|value| !value.is_empty() && !value.contains('/'))
        else {
            continue;
        };

        if !file_name.to_ascii_lowercase().ends_with(".mp4") {
            continue;
        }

        let video_url = if let Some(ref public_base_url) = config.public_base_url {
            build_public_template_video_url(public_base_url, &object.key)
        } else {
            build_r2_presigned_get_url(
                &config,
                Some(&object.key),
                &[],
                TEMPLATE_VIDEO_URL_TTL_SECONDS,
            )?
        };

        assets.push(TemplateVideoAsset {
            id: file_name.to_string(),
            file_name: file_name.to_string(),
            video_url,
            cloudflare_key: object.key.clone(),
            size: object.size,
            modified: object.last_modified.clone(),
        });
    }

    assets.sort_by(|left, right| {
        left.file_name
            .to_lowercase()
            .cmp(&right.file_name.to_lowercase())
    });
    Ok(assets)
}

/// Returns true when a relative path is safe to join under a known base directory.
fn is_safe_relative_path(path: &Path) -> bool {
    !path.components().any(|component| {
        matches!(
            component,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        )
    })
}

fn overlay_content_type_for_extension(extension: Option<&str>) -> &'static str {
    match extension {
        Some("html") => "text/html; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("js") => "application/javascript; charset=utf-8",
        Some("json") => "application/json; charset=utf-8",
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("svg") => "image/svg+xml",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("mp4") => "video/mp4",
        Some("webm") => "video/webm",
        Some("mov") => "video/quicktime",
        Some("mp3") => "audio/mpeg",
        Some("wav") => "audio/wav",
        Some("ogg") => "audio/ogg",
        Some("woff") => "font/woff",
        Some("woff2") => "font/woff2",
        Some("ttf") => "font/ttf",
        Some("otf") => "font/otf",
        _ => "application/octet-stream",
    }
}

fn overlay_header(name: &str, value: &str) -> tiny_http::Header {
    tiny_http::Header::from_bytes(name, value).unwrap()
}

fn overlay_header_value(request: &tiny_http::Request, name: &'static str) -> Option<String> {
    request
        .headers()
        .iter()
        .find(|header| header.field.equiv(name))
        .map(|header| header.value.as_str().to_string())
}

fn overlay_session_value() -> Option<serde_json::Value> {
    let mem_store = AUTH_SESSION.get_or_init(|| Mutex::new(None));
    let raw = {
        let guard = mem_store.lock().unwrap();
        guard.clone()
    }?;

    let value: serde_json::Value = serde_json::from_str(&raw).ok()?;
    let has_user = value
        .get("user")
        .and_then(|user| user.get("id"))
        .and_then(serde_json::Value::as_str)
        .map(|id| !id.trim().is_empty())
        .unwrap_or(false);
    let has_device = value
        .get("deviceId")
        .and_then(serde_json::Value::as_str)
        .map(|device_id| !device_id.trim().is_empty())
        .unwrap_or(false);
    let expires_at = value.get("expiresAt").and_then(serde_json::Value::as_i64)?;
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;
    if !has_user || !has_device || now_ms >= expires_at {
        return None;
    }

    Some(value)
}

fn overlay_auth_status_json() -> String {
    match overlay_session_value() {
        Some(mut value) => {
            if let Some(obj) = value.as_object_mut() {
                obj.insert("authenticated".to_string(), serde_json::Value::Bool(true));
            }
            serde_json::to_string(&value)
                .unwrap_or_else(|_| r#"{"authenticated":true}"#.to_string())
        }
        None => r#"{"authenticated":false,"deviceId":null}"#.to_string(),
    }
}

fn overlay_has_active_auth_session() -> bool {
    overlay_session_value().is_some()
}

fn overlay_is_allowed_app_document(clean_path: &str) -> bool {
    // The local iPhone/iPad PWA is a paired client, not an OBS document, so
    // Safari must be able to load it before auth state is restored inside the
    // desktop webview.
    if clean_path == "mobile" || clean_path == "mobile/" || clean_path.starts_with("mobile/") {
        return true;
    }

    matches!(
        clean_path,
        ""
            | "index.html"
            // Load the OBS Dock shell immediately; DockAuthGate checks the
            // signed-in desktop session and retries while the session handoff
            // is completing. Blocking this request here races that recovery.
            | "dock"
            | "dock.html"
            | "lm-dock"
            | "lm-dock.html"
            // OBS/projection renderers must load even before the dock auth
            // session is restored. They receive content through local overlay
            // packets; blocking their HTML turns browser sources into a 401.
            | "mce-bible-overlay.html"
            | "mce-worship-overlay.html"
            | "mce-note.html"
            | "mce-media-overlay.html"
            | "lower-third-overlay.html"
            | "bible-overlay-bg.html"
            | "bible-overlay-lower-third.html"
            | "countdown-overlay.html"
            | "countdown-bg-overlay.html"
            | "rundown-presenter.html"
            | "pre-service-countdown.html"
            | "pre-service-media.html"
            | "live-tool-overlay.html"
            | "time-overlay.html"
            | "mce-template-overlay.html"
            | "presentation.html"
            // Presentation Studio projector window (loads the three overlay pages).
            | "studio-output.html"
            // Verse AI's own output page (its NDI source).
            | "verse-ai-output.html"
    )
}

fn overlay_blocked_html_page() -> &'static str {
    r#"<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Authentication Required</title>
    <style>
      :root { color-scheme: dark; }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
        font-family: Inter, "Open Sans", system-ui, sans-serif;
        background: #0f172a;
        color: #e2e8f0;
      }
      .panel {
        width: min(420px, 100%);
        padding: 28px;
        border: 1px solid rgba(148, 163, 184, 0.22);
        border-radius: 12px;
        background: rgba(15, 23, 42, 0.92);
        box-shadow: 0 28px 80px rgba(2, 6, 23, 0.45);
      }
      h1 {
        margin: 0 0 12px;
        font-size: 1.4rem;
        line-height: 1.2;
      }
      p {
        margin: 0 0 16px;
        color: #cbd5e1;
        line-height: 1.5;
      }
      button {
        border: 0;
        border-radius: 10px;
        padding: 11px 16px;
        font: inherit;
        font-weight: 600;
        color: #eff6ff;
        background: #2563eb;
        cursor: pointer;
      }
      .hint {
        margin-top: 14px;
        margin-bottom: 0;
        font-size: 0.92rem;
        color: #94a3b8;
      }
    </style>
  </head>
  <body>
    <main class="panel">
      <h1>Authentication Required</h1>
      <p>Please open the MakeChurchEazy desktop app and log in first.</p>
      <button type="button" onclick="window.location.reload()">Refresh</button>
      <p class="hint">This page will start working again after the desktop app restores the local session.</p>
    </main>
  </body>
</html>"#
}

fn respond_overlay_auth_blocked(request: tiny_http::Request) {
    let resp = tiny_http::Response::from_string(overlay_blocked_html_page())
        .with_status_code(401)
        .with_header(overlay_header("Content-Type", "text/html; charset=utf-8"))
        .with_header(overlay_header("Access-Control-Allow-Origin", "*"))
        .with_header(overlay_header(
            "Cache-Control",
            "no-store, no-cache, must-revalidate, max-age=0",
        ))
        .with_header(overlay_header("Pragma", "no-cache"))
        .with_header(overlay_header("Expires", "0"));
    let _ = request.respond(resp);
}

fn parse_byte_range(range_header: &str, file_size: u64) -> Result<(u64, u64), ()> {
    if file_size == 0 {
        return Err(());
    }

    let range_value = range_header.trim().strip_prefix("bytes=").ok_or(())?;
    if range_value.contains(',') {
        return Err(());
    }

    let (start_raw, end_raw) = range_value.split_once('-').ok_or(())?;

    if start_raw.is_empty() {
        let suffix_len = end_raw.parse::<u64>().map_err(|_| ())?;
        if suffix_len == 0 {
            return Err(());
        }

        let length = suffix_len.min(file_size);
        return Ok((file_size - length, file_size - 1));
    }

    let start = start_raw.parse::<u64>().map_err(|_| ())?;
    if start >= file_size {
        return Err(());
    }

    let end = if end_raw.is_empty() {
        file_size - 1
    } else {
        end_raw.parse::<u64>().map_err(|_| ())?.min(file_size - 1)
    };

    if end < start {
        return Err(());
    }

    Ok((start, end))
}

fn respond_overlay_file_request(request: tiny_http::Request, file_path: &Path, content_type: &str) {
    let range_header = overlay_header_value(&request, "Range");
    let file = match File::open(file_path) {
        Ok(file) => file,
        Err(_) => {
            let _ = request.respond(
                tiny_http::Response::from_string("Internal Server Error")
                    .with_status_code(500)
                    .with_header(
                        tiny_http::Header::from_bytes("Access-Control-Allow-Origin", "*").unwrap(),
                    ),
            );
            return;
        }
    };

    let file_size = match file.metadata() {
        Ok(metadata) => metadata.len(),
        Err(_) => {
            let _ = request.respond(
                tiny_http::Response::from_string("Internal Server Error")
                    .with_status_code(500)
                    .with_header(
                        tiny_http::Header::from_bytes("Access-Control-Allow-Origin", "*").unwrap(),
                    ),
            );
            return;
        }
    };

    if let Some(range_header) = range_header {
        match parse_byte_range(&range_header, file_size) {
            Ok((start, end)) => {
                let mut file = file;
                let content_length = end - start + 1;
                let Some(content_length_usize) = usize::try_from(content_length).ok() else {
                    let _ = request.respond(
                        tiny_http::Response::from_string("Internal Server Error")
                            .with_status_code(500)
                            .with_header(
                                tiny_http::Header::from_bytes("Access-Control-Allow-Origin", "*")
                                    .unwrap(),
                            ),
                    );
                    return;
                };

                if file.seek(SeekFrom::Start(start)).is_err() {
                    let _ = request.respond(
                        tiny_http::Response::from_string("Internal Server Error")
                            .with_status_code(500)
                            .with_header(
                                tiny_http::Header::from_bytes("Access-Control-Allow-Origin", "*")
                                    .unwrap(),
                            ),
                    );
                    return;
                }

                let response = tiny_http::Response::new(
                    tiny_http::StatusCode(206),
                    Vec::new(),
                    file.take(content_length),
                    Some(content_length_usize),
                    None,
                )
                .with_header(overlay_header("Content-Type", content_type))
                .with_header(
                    tiny_http::Header::from_bytes(
                        "Content-Range",
                        format!("bytes {}-{}/{}", start, end, file_size),
                    )
                    .unwrap(),
                )
                .with_header(
                    tiny_http::Header::from_bytes("Content-Length", content_length.to_string())
                        .unwrap(),
                )
                .with_header(overlay_header("Accept-Ranges", "bytes"))
                .with_header(overlay_header("Access-Control-Allow-Origin", "*"))
                .with_header(overlay_header(
                    "Cache-Control",
                    "no-store, no-cache, must-revalidate, max-age=0",
                ))
                .with_header(overlay_header("Pragma", "no-cache"))
                .with_header(overlay_header("Expires", "0"));
                let _ = request.respond(response);
            }
            Err(_) => {
                let response = tiny_http::Response::empty(416)
                    .with_header(
                        tiny_http::Header::from_bytes(
                            "Content-Range",
                            format!("bytes */{}", file_size),
                        )
                        .unwrap(),
                    )
                    .with_header(overlay_header("Accept-Ranges", "bytes"))
                    .with_header(overlay_header("Access-Control-Allow-Origin", "*"))
                    .with_header(overlay_header(
                        "Cache-Control",
                        "no-store, no-cache, must-revalidate, max-age=0",
                    ))
                    .with_header(overlay_header("Pragma", "no-cache"))
                    .with_header(overlay_header("Expires", "0"));
                let _ = request.respond(response);
            }
        }
        return;
    }

    let response = tiny_http::Response::from_file(file)
        .with_header(overlay_header("Content-Type", content_type))
        .with_header(overlay_header("Accept-Ranges", "bytes"))
        .with_header(overlay_header("Access-Control-Allow-Origin", "*"))
        .with_header(overlay_header(
            "Cache-Control",
            "no-store, no-cache, must-revalidate, max-age=0",
        ))
        .with_header(overlay_header("Pragma", "no-cache"))
        .with_header(overlay_header("Expires", "0"));
    let _ = request.respond(response);
}

/// Copy text directly to the system clipboard using native OS utilities (pbcopy on macOS, clip on Windows)
#[tauri::command]
fn copy_to_clipboard(text: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use std::process::{Command, Stdio};
        let mut child = Command::new("pbcopy")
            .stdin(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn pbcopy: {}", e))?;
        if let Some(mut stdin) = child.stdin.take() {
            use std::io::Write;
            let _ = stdin.write_all(text.as_bytes());
        }
        let _ = child.wait();
        return Ok(());
    }
    #[cfg(target_os = "windows")]
    {
        use std::process::{Command, Stdio};
        let mut child = hide_console(&mut Command::new("clip"))
            .stdin(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn clip: {}", e))?;
        if let Some(mut stdin) = child.stdin.take() {
            use std::io::Write;
            let _ = stdin.write_all(text.as_bytes());
        }
        let _ = child.wait();
        return Ok(());
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        Ok(())
    }
}

/// Save a background image to ~/Documents/MakeChurchEasy/backgrounds/
/// Accepts raw image bytes and a hash-based filename.
/// Returns the absolute path to the saved file.
#[tauri::command]
fn save_bg_image(file_name: String, file_data: Vec<u8>) -> Result<String, String> {
    let bg_dir = app_dir()?.join("backgrounds");
    fs::create_dir_all(&bg_dir)
        .map_err(|e| format!("Failed to create backgrounds directory: {}", e))?;

    let safe_file_name = sanitize_filename_for_storage(&file_name)?;
    let file_path = bg_dir.join(&safe_file_name);

    // Skip write if the file already exists (content-addressed by hash name)
    if file_path.exists() {
        let abs_path = file_path
            .to_str()
            .ok_or("File path contains invalid UTF-8")?
            .to_string();
        println!("[Tauri] BG image already exists: {}", abs_path);
        return Ok(abs_path);
    }

    fs::write(&file_path, &file_data)
        .map_err(|e| format!("Failed to write bg image '{}': {}", safe_file_name, e))?;

    let abs_path = file_path
        .to_str()
        .ok_or("File path contains invalid UTF-8")?
        .to_string();

    println!(
        "[Tauri] Saved BG image: {} ({} bytes)",
        abs_path,
        file_data.len()
    );
    Ok(abs_path)
}

/// Save an uploaded file to ~/Documents/MakeChurchEasy/uploads/
/// Returns the absolute path to the saved file.
#[tauri::command]
fn save_upload_file(file_name: String, file_data: Vec<u8>) -> Result<String, String> {
    write_upload_file(&file_name, &file_data)
}

/// Same as `save_upload_file`, but the file arrives as the raw request body instead of a JSON
/// list of numbers, which is many times faster for large videos. The name is sent URL-encoded
/// in the `x-file-name` header.
#[tauri::command]
fn save_upload_file_raw(request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let tauri::ipc::InvokeBody::Raw(file_data) = request.body() else {
        return Err("Expected the file as raw bytes".into());
    };
    let encoded_name = request
        .headers()
        .get("x-file-name")
        .and_then(|value| value.to_str().ok())
        .ok_or("Missing x-file-name header")?;
    let file_name = urlencoding::decode(encoded_name)
        .map_err(|e| format!("Invalid file name: {}", e))?
        .into_owned();
    write_upload_file(&file_name, file_data)
}

fn write_upload_file(file_name: &str, file_data: &[u8]) -> Result<String, String> {
    let uploads_dir = app_dir()?.join("uploads");
    fs::create_dir_all(&uploads_dir)
        .map_err(|e| format!("Failed to create uploads directory: {}", e))?;

    let safe_file_name = sanitize_filename_for_storage(file_name)?;
    let file_path = uploads_dir.join(&safe_file_name);
    fs::write(&file_path, file_data)
        .map_err(|e| format!("Failed to write file '{}': {}", safe_file_name, e))?;
    let prepared_video = uploads_dir.join(studio_video_cache_name(&safe_file_name));
    if prepared_video.is_file() {
        fs::remove_file(&prepared_video)
            .map_err(|error| format!("Failed to refresh prepared Studio video: {error}"))?;
    }

    let abs_path = file_path
        .to_str()
        .ok_or("File path contains invalid UTF-8")?
        .to_string();

    println!(
        "[Tauri] Saved upload: {} ({} bytes)",
        abs_path,
        file_data.len()
    );
    Ok(abs_path)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StudioVideoPreparation {
    file_name: String,
    converted: bool,
}

fn studio_ffmpeg_platform_dir() -> Result<&'static str, String> {
    #[cfg(target_os = "windows")]
    {
        return Ok("windows-x64");
    }
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        return Ok("macos-arm64");
    }
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    {
        return Ok("macos-x64");
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        Err("Studio video preparation is supported on Windows and macOS.".to_string())
    }
}

fn studio_ffmpeg_path(app: &tauri::AppHandle, executable: &str) -> Result<PathBuf, String> {
    let platform_dir = studio_ffmpeg_platform_dir()?;
    let mut roots = Vec::new();
    if let Ok(resource_dir) = app.path().resource_dir() {
        roots.push(resource_dir);
    }
    roots.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")));

    for root in roots {
        for prefix in [Path::new("ffmpeg"), Path::new("resources/ffmpeg")] {
            let candidate = root
                .join(prefix)
                .join(platform_dir)
                .join("bin")
                .join(executable);
            if candidate.is_file() {
                return Ok(candidate);
            }
        }
    }

    Err(format!("The bundled FFmpeg runtime is missing ({platform_dir}/{executable}). Reinstall or update MakeChurchEazy, then try again."))
}

/// Keep helper processes (PowerShell, clip, wmic, …) from flashing a console
/// window on Windows. No-op elsewhere.
fn hide_console(command: &mut std::process::Command) -> &mut std::process::Command {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

fn studio_video_cache_name(file_name: &str) -> String {
    let digest = Sha256::digest(file_name.as_bytes());
    let hex = format!("{digest:x}");
    format!("studio_video_{}.mp4", &hex[..24])
}

#[cfg(target_os = "windows")]
fn studio_ffmpeg_command(executable: &Path) -> std::process::Command {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let mut command = std::process::Command::new(executable);
    command.creation_flags(CREATE_NO_WINDOW);
    command
}

#[cfg(not(target_os = "windows"))]
fn studio_ffmpeg_command(executable: &Path) -> std::process::Command {
    std::process::Command::new(executable)
}

fn studio_video_is_browser_compatible(ffprobe: &Path, input: &Path) -> bool {
    let output = match studio_ffmpeg_command(ffprobe)
        .args([
            "-v", "error", "-show_entries", "format=format_name:stream=codec_type,codec_name,pix_fmt",
            "-of", "json",
        ])
        .arg(input)
        .output()
    {
        Ok(output) if output.status.success() => output,
        _ => return false,
    };

    let Ok(metadata) = serde_json::from_slice::<serde_json::Value>(&output.stdout) else {
        return false;
    };
    let format = metadata
        .get("format")
        .and_then(|value| value.get("format_name"))
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default();
    // MP4/MOV, WebM and Matroska containers all play directly in the webview.
    let is_mp4 = format
        .split(',')
        .any(|name| matches!(name, "mp4" | "webm" | "matroska"));
    let streams = metadata.get("streams").and_then(serde_json::Value::as_array);
    let Some(streams) = streams else { return false };
    let video = streams.iter().find(|stream| {
        stream.get("codec_type").and_then(serde_json::Value::as_str) == Some("video")
    });
    let audio = streams.iter().find(|stream| {
        stream.get("codec_type").and_then(serde_json::Value::as_str) == Some("audio")
    });
    let Some(video) = video else { return false };
    let video_codec = video.get("codec_name").and_then(serde_json::Value::as_str);
    let pixel_format = video.get("pix_fmt").and_then(serde_json::Value::as_str);
    let audio_supported = audio
        .map(|stream| {
            matches!(
                stream.get("codec_name").and_then(serde_json::Value::as_str),
                Some("aac" | "mp3" | "opus" | "vorbis" | "flac")
            )
        })
        .unwrap_or(true);

    is_mp4
        && match video_codec {
            Some("h264") => matches!(pixel_format, Some("yuv420p" | "yuvj420p")),
            Some("vp8" | "vp9" | "av1") => true,
            _ => false,
        }
        && audio_supported
}

fn prepare_studio_video(
    uploads_dir: &Path,
    file_name: &str,
    ffmpeg: &Path,
    ffprobe: &Path,
) -> Result<StudioVideoPreparation, String> {
    let input = if media_refs::is_reference_name(file_name) {
        media_refs::resolve_reference_name(file_name).ok_or_else(|| {
            "The original video file could not be found. Locate it again from the Media library, then try once more.".to_string()
        })?
    } else {
        uploads_dir.join(file_name)
    };
    if !input.is_file() {
        return Err("The selected video file is no longer in the media library. Import it again, then try once more.".to_string());
    }
    if studio_video_is_browser_compatible(ffprobe, &input) {
        return Ok(StudioVideoPreparation { file_name: file_name.to_string(), converted: false });
    }

    let output_name = studio_video_cache_name(file_name);
    let output = uploads_dir.join(&output_name);
    if output.is_file() && fs::metadata(&output).map(|metadata| metadata.len() > 0).unwrap_or(false) {
        return Ok(StudioVideoPreparation { file_name: output_name, converted: true });
    }

    let temporary_name = format!("studio_video_{}_working.mp4", Uuid::new_v4().simple());
    let temporary_output = uploads_dir.join(temporary_name);
    #[cfg(target_os = "macos")]
    let encoder = "h264_videotoolbox";
    #[cfg(target_os = "windows")]
    let encoder = "h264_mf";
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let encoder = "h264";

    let command_output = studio_ffmpeg_command(ffmpeg)
        .args(["-hide_banner", "-loglevel", "error", "-y", "-i"])
        .arg(&input)
        .args([
            "-map", "0:v:0", "-map", "0:a?", "-sn", "-dn", "-c:v", encoder,
            "-b:v", "12000k", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
            "-movflags", "+faststart",
        ])
        .arg(&temporary_output)
        .output()
        .map_err(|error| format!("FFmpeg could not start: {error}"))?;

    if !command_output.status.success() {
        let _ = fs::remove_file(&temporary_output);
        let detail = String::from_utf8_lossy(&command_output.stderr).trim().to_string();
        return Err(if detail.is_empty() {
            "FFmpeg could not convert this video to a format supported by Studio.".to_string()
        } else {
            format!("FFmpeg could not prepare this video: {detail}")
        });
    }
    if !temporary_output.is_file() || fs::metadata(&temporary_output).map(|metadata| metadata.len() == 0).unwrap_or(true) {
        let _ = fs::remove_file(&temporary_output);
        return Err("FFmpeg finished without creating a playable video.".to_string());
    }

    if output.exists() {
        let _ = fs::remove_file(&temporary_output);
    } else {
        fs::rename(&temporary_output, &output)
            .map_err(|error| format!("Could not save the prepared Studio video: {error}"))?;
    }
    Ok(StudioVideoPreparation { file_name: output_name, converted: true })
}

/// Prepare a local library video for inline Studio playback using FFmpeg's platform H.264 encoder.
#[tauri::command]
async fn prepare_studio_video_for_program(
    app: tauri::AppHandle,
    file_name: String,
) -> Result<StudioVideoPreparation, String> {
    let safe_file_name = validate_upload_basename(&file_name)?;
    let uploads_dir = app_dir()?.join("uploads");
    let ffmpeg = studio_ffmpeg_path(&app, if cfg!(target_os = "windows") { "ffmpeg.exe" } else { "ffmpeg" })?;
    let ffprobe = studio_ffmpeg_path(&app, if cfg!(target_os = "windows") { "ffprobe.exe" } else { "ffprobe" })?;

    tauri::async_runtime::spawn_blocking(move || {
        prepare_studio_video(&uploads_dir, &safe_file_name, &ffmpeg, &ffprobe)
    })
    .await
    .map_err(|error| format!("Studio video preparation stopped unexpectedly: {error}"))?
}

/// Delete a user-uploaded file from ~/Documents/MakeChurchEasy/uploads/.
/// Missing files are treated as success so repeated delete requests are safe.
#[tauri::command]
fn delete_upload_file(file_name: String) -> Result<(), String> {
    let uploads_dir = app_dir()?.join("uploads");
    let safe_file_name = validate_upload_basename(&file_name)?;
    let file_path = uploads_dir.join(&safe_file_name);
    if file_path.exists() {
        if !file_path.is_file() {
            return Err("The selected upload is not a file".to_string());
        }
        fs::remove_file(&file_path)
            .map_err(|e| format!("Failed to delete upload '{}': {}", safe_file_name, e))?;
    }
    let prepared_video = uploads_dir.join(studio_video_cache_name(&safe_file_name));
    if prepared_video.is_file() {
        fs::remove_file(&prepared_video)
            .map_err(|error| format!("Failed to delete prepared Studio video: {error}"))?;
    }
    // Referenced media: drop the pointer only. The original stays put.
    media_refs::unregister_reference_name(&safe_file_name)?;
    println!("[Tauri] Deleted upload: {}", file_path.display());
    Ok(())
}

/// Save a browser drag-and-drop selection to a temporary local path so the
/// native sender can stream it without keeping the whole file in memory.
#[tauri::command]
fn save_share_temp_file(file_name: String, file_data: Vec<u8>) -> Result<String, String> {
    if file_data.len() as u64 > LOCAL_SEND_MAX_FILE_BYTES {
        return Err("This file is larger than the 4 GB transfer limit".to_string());
    }

    let directory = app_dir()?.join("share-temp");
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Could not create the temporary share folder: {error}"))?;
    let safe_name = sanitize_filename_for_storage(&file_name)?;
    let stored_name = format!("{}_{}", uuid::Uuid::new_v4().simple(), safe_name);
    let path = directory.join(stored_name);
    fs::write(&path, file_data)
        .map_err(|error| format!("Could not prepare {} for sharing: {error}", file_name))?;
    Ok(path.to_string_lossy().to_string())
}

/// Read file metadata from paths returned by the native file picker.
#[tauri::command]
fn get_local_share_file_metadata(
    file_paths: Vec<String>,
) -> Result<Vec<LocalShareFileMetadata>, String> {
    let mut files = Vec::with_capacity(file_paths.len());
    for (index, file_path) in file_paths.iter().enumerate() {
        let path = PathBuf::from(file_path.trim());
        files.push(local_share_file_metadata(&path, format!("file-{index}"))?);
    }
    Ok(files)
}

fn probe_local_share_device(
    client: &reqwest::blocking::Client,
    host: &str,
    port: u16,
    local_fingerprint: &str,
) -> Option<LocalShareDeviceInfo> {
    let base_url = format!("http://{}:{}", host, port);
    let response = client
        .get(format!("{base_url}/api/localsend/v2/info"))
        .send()
        .ok()?;
    if !response.status().is_success() {
        return None;
    }

    let mut device = response.json::<LocalShareDeviceInfo>().ok()?;
    if device.fingerprint == local_fingerprint {
        return None;
    }
    device.host = host.to_string();
    device.port = port;
    device.base_url = base_url;
    Some(device)
}

/// Find other MakeChurchEazy desktop instances on the current /24 LAN.
/// Discovery stays native and asynchronous so the UI never hangs.
#[tauri::command]
async fn discover_local_share_devices() -> Result<Vec<LocalShareDeviceInfo>, String> {
    tokio::task::spawn_blocking(move || {
        let local_ip = get_local_ip()
            .ok_or_else(|| "Could not determine this computer's LAN address".to_string())?;
        let subnet = subnet_prefix_from_ip(&local_ip)
            .ok_or_else(|| format!("Unsupported LAN address: {local_ip}"))?;
        let local_suffix = local_ip
            .split('.')
            .last()
            .and_then(|value| value.parse::<u8>().ok());
        let local_fingerprint = local_share_device_info(Some(local_ip.clone()))?.fingerprint;
        let port = {
            let current = OVERLAY_PORT.load(Ordering::Relaxed);
            if current == 0 {
                45678
            } else {
                current
            }
        };

        let client = reqwest::blocking::Client::builder()
            .connect_timeout(Duration::from_millis(150))
            .timeout(Duration::from_millis(300))
            .build()
            .map_err(|e| e.to_string())?;
        let client = std::sync::Arc::new(client);

        let (tx, rx) = mpsc::channel::<LocalShareDeviceInfo>();
        let mut handles = Vec::new();
        let chunk_size = 8usize;

        for chunk_start in (1u16..=254u16).step_by(chunk_size) {
            let tx = tx.clone();
            let subnet = subnet.clone();
            let local_fingerprint = local_fingerprint.clone();
            let local_suffix = local_suffix;
            let client = std::sync::Arc::clone(&client);
            let chunk_end = (chunk_start + chunk_size as u16 - 1).min(254);

            handles.push(std::thread::spawn(move || {
                for suffix in chunk_start..=chunk_end {
                    if Some(suffix as u8) == local_suffix {
                        continue;
                    }
                    let host = format!("{}.{}", subnet, suffix);
                    // Fast TCP pre-check (35ms) before firing HTTP
                    if host_is_reachable(&host, port, 35) {
                        if let Some(device) =
                            probe_local_share_device(&client, &host, port, &local_fingerprint)
                        {
                            let _ = tx.send(device);
                        }
                    }
                }
            }));
        }

        drop(tx);
        for handle in handles {
            let _ = handle.join();
        }

        let mut devices = rx.try_iter().collect::<Vec<_>>();
        devices.sort_by(|left, right| left.alias.to_lowercase().cmp(&right.alias.to_lowercase()));
        devices.dedup_by(|left, right| left.fingerprint == right.fingerprint);
        Ok(devices)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn share_request_error(status: reqwest::StatusCode, body: &str) -> String {
    let message = serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|value| {
            value
                .get("error")
                .and_then(|error| error.as_str())
                .map(str::to_string)
        })
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| body.trim().to_string());
    if message.is_empty() {
        format!("Share request failed ({})", status.as_u16())
    } else {
        message
    }
}

fn emit_local_share_progress(
    app_handle: &tauri::AppHandle,
    file_id: &str,
    file_name: &str,
    bytes_sent: u64,
    total_bytes: u64,
    completed_files: usize,
    total_files: usize,
    status: &str,
) {
    let _ = app_handle.emit(
        "local-share-progress",
        LocalShareTransferProgress {
            file_id: file_id.to_string(),
            file_name: file_name.to_string(),
            bytes_sent,
            total_bytes,
            completed_files,
            total_files,
            status: status.to_string(),
        },
    );
}

/// Stream selected files to another MakeChurchEazy desktop over the LAN.
/// The receiver exposes the same metadata/upload endpoints as LocalSend's
/// default HTTP transfer flow, while the pairing token prevents anonymous
/// uploads from arbitrary devices on the network.
#[tauri::command]
fn send_local_share_files(
    app_handle: tauri::AppHandle,
    peer_base_url: String,
    peer_token: String,
    files: Vec<LocalShareFileInput>,
) -> Result<Vec<LocalShareSentFile>, String> {
    if files.is_empty() {
        return Err("Choose at least one file to send".to_string());
    }
    if peer_token.trim().is_empty() {
        return Err("The selected computer is missing its transfer key. Refresh nearby devices and try again.".to_string());
    }

    let base_url = peer_base_url.trim().trim_end_matches('/').to_string();
    if !base_url.starts_with("http://") && !base_url.starts_with("https://") {
        return Err("The selected computer has an invalid network address".to_string());
    }

    let mut prepared_files = Vec::with_capacity(files.len());
    let mut metadata_files = serde_json::Map::new();
    for (index, input) in files.iter().enumerate() {
        let path = PathBuf::from(input.file_path.trim());
        let metadata = fs::metadata(&path)
            .map_err(|error| format!("Could not read {}: {error}", path.display()))?;
        if !metadata.is_file() {
            return Err(format!("{} is not a file", path.display()));
        }
        if metadata.len() > LOCAL_SEND_MAX_FILE_BYTES {
            return Err(format!(
                "{} is larger than the 4 GB transfer limit",
                path.display()
            ));
        }

        let file_name = input
            .file_name
            .clone()
            .filter(|value| !value.trim().is_empty())
            .or_else(|| {
                path.file_name()
                    .and_then(|value| value.to_str())
                    .map(str::to_string)
            })
            .ok_or_else(|| format!("Could not determine the file name for {}", path.display()))?;
        let file_id = format!("share-{}-{}", index, uuid::Uuid::new_v4().simple());
        let file_type = input
            .file_type
            .clone()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| mime_type_for_file_name(&file_name));

        metadata_files.insert(
            file_id.clone(),
            serde_json::json!({
                "id": file_id,
                "fileName": file_name,
                "size": metadata.len(),
                "fileType": file_type,
            }),
        );
        prepared_files.push((
            file_id,
            path,
            file_name,
            file_type,
            metadata.len(),
            input.temporary,
        ));
    }

    let mut sender_info = serde_json::to_value(local_share_device_info(None)?)
        .map_err(|error| format!("Could not prepare this computer's share identity: {error}"))?;
    if let Some(info) = sender_info.as_object_mut() {
        info.remove("transferToken");
        info.remove("baseUrl");
    }

    let client = reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(3))
        .timeout(Duration::from_secs(60 * 60))
        .build()
        .map_err(|error| format!("Could not start the local transfer: {error}"))?;
    let prepare_payload = serde_json::json!({
        "info": sender_info,
        "destination": "receiver",
        "files": metadata_files,
    });
    let prepare_response = client
        .post(format!("{base_url}/api/localsend/v2/prepare-upload"))
        .header("X-Device-Token", peer_token.trim())
        .json(&prepare_payload)
        .send()
        .map_err(|error| format!("Could not reach the selected computer: {error}"))?;
    let prepare_status = prepare_response.status();
    let prepare_body = prepare_response
        .text()
        .map_err(|error| format!("Could not read the receiver response: {error}"))?;
    if !prepare_status.is_success() {
        return Err(share_request_error(prepare_status, &prepare_body));
    }

    let prepare_json =
        serde_json::from_str::<serde_json::Value>(&prepare_body).map_err(|error| {
            format!("The selected computer returned invalid transfer metadata: {error}")
        })?;
    let session_id = prepare_json
        .get("sessionId")
        .and_then(|value| value.as_str())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "The selected computer did not create a transfer session".to_string())?;
    let file_tokens = prepare_json
        .get("files")
        .and_then(|value| value.as_object())
        .ok_or_else(|| "The selected computer did not return file transfer keys".to_string())?;

    let total_files = prepared_files.len();
    let mut completed_files = 0usize;
    let mut sent_files = Vec::with_capacity(total_files);
    for (file_id, path, file_name, file_type, file_size, temporary) in prepared_files {
        let token = file_tokens
            .get(&file_id)
            .and_then(|value| value.as_str())
            .ok_or_else(|| format!("The receiver did not accept {file_name}"))?;
        emit_local_share_progress(
            &app_handle,
            &file_id,
            &file_name,
            0,
            file_size,
            completed_files,
            total_files,
            "sending",
        );

        let file = File::open(&path)
            .map_err(|error| format!("Could not open {}: {error}", path.display()))?;
        let reader = LocalShareProgressReader {
            file,
            file_id: file_id.clone(),
            file_name: file_name.clone(),
            total_bytes: file_size,
            bytes_sent: 0,
            completed_files,
            total_files,
            app_handle: app_handle.clone(),
            last_emit: Instant::now(),
        };
        let upload_url = format!(
            "{base_url}/api/localsend/v2/upload?sessionId={}&fileId={}&token={}",
            urlencoding::encode(session_id),
            urlencoding::encode(&file_id),
            urlencoding::encode(token),
        );
        let upload_response = client
            .post(upload_url)
            .header("X-Device-Token", peer_token.trim())
            .header("Content-Type", file_type.as_str())
            .body(reqwest::blocking::Body::sized(reader, file_size))
            .send()
            .map_err(|error| format!("Could not send {file_name}: {error}"))?;
        let upload_status = upload_response.status();
        let upload_body = upload_response.text().unwrap_or_default();
        if !upload_status.is_success() {
            let _ = client
                .post(format!(
                    "{base_url}/api/localsend/v2/cancel?sessionId={}",
                    urlencoding::encode(session_id)
                ))
                .header("X-Device-Token", peer_token.trim())
                .send();
            return Err(format!(
                "Could not send {file_name}: {}",
                share_request_error(upload_status, &upload_body)
            ));
        }

        completed_files += 1;
        if temporary {
            let _ = fs::remove_file(&path);
        }
        emit_local_share_progress(
            &app_handle,
            &file_id,
            &file_name,
            file_size,
            file_size,
            completed_files,
            total_files,
            "complete",
        );
        sent_files.push(LocalShareSentFile {
            file_id,
            file_name,
            file_size,
            display_path: "MakeChurchEazy Receiver".to_string(),
        });
    }

    Ok(sent_files)
}

/// List files that arrived from the mobile companion and are waiting for a
/// desktop destination decision.
#[tauri::command]
fn list_received_files() -> Result<Vec<ReceivedFileRecord>, String> {
    read_received_file_records()
}

/// Copy a received file to a folder chosen by the desktop operator, then clear
/// it from the Receiver inbox.
#[tauri::command]
fn save_received_file_to_folder(
    pending_id: String,
    folder_path: String,
) -> Result<ReceivedFileActionResult, String> {
    let record = find_received_file(&pending_id)?;
    let folder = PathBuf::from(folder_path.trim());
    if !folder.is_dir() {
        return Err("Choose an existing folder on this desktop.".to_string());
    }

    let source_path = received_file_source_path(&record)?;
    let target_path = unique_folder_target(&folder, &record.file_name)?;
    fs::copy(&source_path, &target_path)
        .map_err(|error| format!("Could not save the received file to that folder: {error}"))?;
    remove_received_file(&record)?;

    Ok(ReceivedFileActionResult {
        pending_id: record.pending_id,
        file_name: record.file_name,
        stored_file_name: target_path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_string(),
        file_size: record.file_size,
        file_type: record.file_type,
        sha256: record.sha256,
        file_path: target_path.to_string_lossy().to_string(),
    })
}

/// Move a received file into the managed MCE uploads folder. The Dock then
/// registers the returned file in its existing Media library path.
fn save_received_file_to_mce_internal(
    pending_id: &str,
) -> Result<ReceivedFileActionResult, String> {
    let record = find_received_file(pending_id)?;
    if !local_send_mce_file_supported(&record.file_name, &record.file_type) {
        return Err(
            "This file type cannot be added to the MCE Media library. Use Save to folder instead."
                .to_string(),
        );
    }

    let uploads_dir = app_dir()?.join("uploads");
    fs::create_dir_all(&uploads_dir)
        .map_err(|error| format!("Could not create MCE uploads folder: {error}"))?;
    let safe_name = sanitize_filename_for_storage(&record.file_name)?;
    let stored_name = format!("mobile_{}_{}", record.pending_id, safe_name);
    let source_path = received_file_source_path(&record)?;
    let target_path = uploads_dir.join(&stored_name);
    fs::copy(&source_path, &target_path)
        .map_err(|error| format!("Could not add the received file to MCE: {error}"))?;
    remove_received_file(&record)?;

    Ok(ReceivedFileActionResult {
        pending_id: record.pending_id,
        file_name: record.file_name,
        stored_file_name: stored_name,
        file_size: record.file_size,
        file_type: record.file_type,
        sha256: record.sha256,
        file_path: target_path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn save_received_file_to_mce(pending_id: String) -> Result<ReceivedFileActionResult, String> {
    save_received_file_to_mce_internal(&pending_id)
}

/// Save a countdown background asset to ~/Documents/MakeChurchEasy/uploads/countdowns/
/// The caller generates the assetId (nanoid) and passes it along with the original file name.
#[tauri::command]
fn save_countdown_asset(
    asset_id: String,
    file_name: String,
    file_data: Vec<u8>,
) -> Result<String, String> {
    let countdowns_dir = app_dir()?.join("uploads").join("countdowns");
    fs::create_dir_all(&countdowns_dir)
        .map_err(|e| format!("Failed to create countdowns directory: {}", e))?;

    let safe_file_name = sanitize_filename_for_storage(&file_name)?;
    let ext = Path::new(&safe_file_name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("bin");
    let stored_name = format!("{}.{}", asset_id, ext);
    let file_path = countdowns_dir.join(&stored_name);
    fs::write(&file_path, &file_data)
        .map_err(|e| format!("Failed to write countdown asset '{}': {}", stored_name, e))?;

    let abs_path = file_path
        .to_str()
        .ok_or("File path contains invalid UTF-8")?
        .to_string();

    println!(
        "[Tauri] Saved countdown asset: {} ({} bytes)",
        abs_path,
        file_data.len()
    );
    Ok(abs_path)
}

/// Delete a countdown background asset by assetId from ~/Documents/MakeChurchEasy/uploads/countdowns/
#[tauri::command]
fn delete_countdown_asset(asset_id: String) -> Result<(), String> {
    let countdowns_dir = app_dir()?.join("uploads").join("countdowns");
    if !countdowns_dir.exists() {
        return Ok(());
    }

    let entries = fs::read_dir(&countdowns_dir)
        .map_err(|e| format!("Failed to read countdowns directory: {}", e))?;

    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with(&format!("{}.", asset_id)) {
            fs::remove_file(entry.path())
                .map_err(|e| format!("Failed to delete countdown asset '{}': {}", name, e))?;
            println!("[Tauri] Deleted countdown asset: {}", name);
            return Ok(());
        }
    }

    // Not found — not an error, asset may have already been cleaned up
    Ok(())
}

/// Clean up unused countdown assets.
/// `used_asset_ids` is a list of assetIds that are still referenced by active countdowns.
/// Any file in the countdowns/ folder not matching a used assetId is deleted.
#[tauri::command]
fn cleanup_unused_countdown_assets(used_asset_ids: Vec<String>) -> Result<u32, String> {
    let countdowns_dir = app_dir()?.join("uploads").join("countdowns");
    if !countdowns_dir.exists() {
        return Ok(0);
    }

    let entries = fs::read_dir(&countdowns_dir)
        .map_err(|e| format!("Failed to read countdowns directory: {}", e))?;

    let mut deleted = 0u32;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        // Asset files are named <assetId>.<ext> — extract the ID before the first dot
        let file_asset_id = name.split('.').next().unwrap_or("");
        if !file_asset_id.is_empty() && !used_asset_ids.contains(&file_asset_id.to_string()) {
            fs::remove_file(entry.path())
                .map_err(|e| format!("Failed to cleanup asset '{}': {}", name, e))?;
            println!("[Tauri] Cleaned up unused countdown asset: {}", name);
            deleted += 1;
        }
    }

    Ok(deleted)
}

/// Save a remote template background video to the local uploads/backgrounds/videos/
/// folder and return the absolute path plus the overlay-relative URL.
#[tauri::command]
fn save_background_video_file(
    file_name: String,
    file_data: Vec<u8>,
) -> Result<SavedBackgroundVideoFile, String> {
    let videos_dir = app_dir()?
        .join("uploads")
        .join("backgrounds")
        .join("videos");
    fs::create_dir_all(&videos_dir)
        .map_err(|e| format!("Failed to create background videos directory: {}", e))?;

    let safe_file_name = sanitize_filename_for_storage(&file_name)?;
    let file_path = videos_dir.join(&safe_file_name);
    fs::write(&file_path, &file_data).map_err(|e| {
        format!(
            "Failed to write background video '{}': {}",
            safe_file_name, e
        )
    })?;

    let abs_path = file_path
        .to_str()
        .ok_or("Background video path contains invalid UTF-8")?
        .to_string();
    let relative_url = format!(
        "/uploads/backgrounds/videos/{}",
        encode_path_segments(&safe_file_name)
    );

    println!(
        "[Tauri] Saved background video: {} ({} bytes)",
        abs_path,
        file_data.len()
    );

    Ok(SavedBackgroundVideoFile {
        file_path: abs_path,
        relative_url,
    })
}

/// Load app_data.json — returns file contents or "{}" if it doesn't exist.
#[tauri::command]
fn load_app_data() -> Result<String, String> {
    let path = app_dir()?.join("app_data.json");

    if !path.exists() {
        println!("[Tauri] app_data.json not found — returning empty object");
        return Ok("{}".to_string());
    }

    let contents =
        fs::read_to_string(&path).map_err(|e| format!("Failed to read app_data.json: {}", e))?;

    println!("[Tauri] Loaded app_data.json ({} bytes)", contents.len());
    Ok(contents)
}

/// Save app_data.json — writes the JSON string to disk.
#[tauri::command]
fn save_app_data(data: String) -> Result<(), String> {
    let path = app_dir()?.join("app_data.json");

    fs::write(&path, &data).map_err(|e| format!("Failed to write app_data.json: {}", e))?;

    println!("[Tauri] Saved app_data.json ({} bytes)", data.len());
    Ok(())
}

/// Return the overlay server port so the frontend can build URLs.
#[tauri::command]
fn get_overlay_port() -> u16 {
    OVERLAY_PORT.load(Ordering::Relaxed)
}

/// Return this desktop's LAN identity for the Media sharing surface.
#[tauri::command]
async fn get_local_share_info() -> Result<LocalShareDeviceInfo, String> {
    tokio::task::spawn_blocking(move || local_share_device_info(None))
        .await
        .map_err(|e| e.to_string())?
}

fn get_local_ip_for_target(target_host: Option<&str>) -> Option<String> {
    let target = target_host
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("8.8.8.8");
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect(format!("{}:80", target)).ok()?;
    let addr = socket.local_addr().ok()?;
    Some(addr.ip().to_string())
}

/// Return a LAN-accessible overlay base URL for remote OBS browser sources.
#[tauri::command]
fn get_lan_overlay_info(target_host: Option<String>) -> Result<serde_json::Value, String> {
    let port = OVERLAY_PORT.load(Ordering::Relaxed);
    if port == 0 {
        return Err("Overlay server is not running".to_string());
    }

    let ip = get_local_ip_for_target(target_host.as_deref())
        .or_else(get_local_ip)
        .ok_or_else(|| "Could not determine this computer's LAN IP".to_string())?;
    Ok(serde_json::json!({
        "ip": ip,
        "port": port,
        "baseUrl": format!("http://{}:{}", ip, port),
    }))
}

/// Return a LAN URL for the Vite development Dock. This is intentionally
/// unavailable to packaged/release builds; the production app uses its own
/// embedded overlay server instead.
#[tauri::command]
fn get_dev_dock_base_url() -> Result<String, String> {
    if !cfg!(debug_assertions) {
        return Err("The development Dock URL is only available in debug builds".to_string());
    }

    // The Vite dev server, so the Dock hot-reloads while developing.
    Ok("http://localhost:1420".to_string())
}

/// Prepare a local media file for remote OBS by ensuring it is served from the
/// MakeChurchEazy uploads directory, then return its LAN URL.
#[tauri::command]
fn prepare_remote_media_url(
    file_path: String,
    file_name: String,
    target_host: Option<String>,
) -> Result<String, String> {
    let port = OVERLAY_PORT.load(Ordering::Relaxed);
    if port == 0 {
        return Err("Overlay server is not running".to_string());
    }

    let trimmed = file_path.trim();
    if trimmed.is_empty() {
        return Err("Media file path is required".to_string());
    }

    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        return Ok(trimmed.to_string());
    }

    let uploads_dir = app_dir()?.join("uploads");
    fs::create_dir_all(&uploads_dir)
        .map_err(|error| format!("Failed to create uploads directory: {}", error))?;

    let decoded_path = if trimmed.starts_with("file://") {
        urlencoding::decode(trimmed.trim_start_matches("file://"))
            .map(|value| value.to_string())
            .unwrap_or_else(|_| trimmed.trim_start_matches("file://").to_string())
    } else {
        trimmed.to_string()
    };

    let source_path = Path::new(&decoded_path);
    let safe_name = source_path
        .file_name()
        .and_then(|value| value.to_str())
        .or_else(|| {
            Path::new(file_name.trim())
                .file_name()
                .and_then(|value| value.to_str())
        })
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "Could not determine media file name".to_string())?
        .replace(['/', '\\'], "_");

    let served_path = uploads_dir.join(&safe_name);

    if source_path.exists() {
        let source_canonical = source_path.canonicalize().ok();
        let served_canonical = served_path.canonicalize().ok();
        if source_canonical != served_canonical {
            fs::copy(source_path, &served_path)
                .map_err(|error| format!("Failed to prepare media for remote OBS: {}", error))?;
        }
    } else if !served_path.exists() {
        return Err(format!("Media file is not available: {}", trimmed));
    }

    let ip = get_local_ip_for_target(target_host.as_deref())
        .or_else(get_local_ip)
        .ok_or_else(|| "Could not determine this computer's LAN IP".to_string())?;
    Ok(format!(
        "http://{}:{}/uploads/{}",
        ip,
        port,
        urlencoding::encode(&safe_name)
    ))
}

/// Return device hostname and OS (legacy — kept for backward compat).
#[tauri::command]
fn get_device_info() -> Result<serde_json::Value, String> {
    let hostname = hostname::get()
        .map(|h| h.to_string_lossy().to_string())
        .unwrap_or_else(|_| "Unknown Device".to_string());

    let os = std::env::consts::OS;

    Ok(serde_json::json!({
        "hostname": hostname,
        "os": os,
    }))
}

/// Return full hardware profile for the performance detection system.
#[tauri::command]
fn get_system_hardware_info() -> Result<serde_json::Value, String> {
    use sysinfo::System;

    let mut sys = System::new_all();
    sys.refresh_all();

    // CPU
    let cpu_model = sys
        .cpus()
        .first()
        .map(|c| c.brand().to_string())
        .unwrap_or_else(|| "Unknown CPU".to_string());
    let cpu_cores = sys.cpus().len() as u32;

    // RAM
    let total_ram_mb = sys.total_memory() / (1024 * 1024);
    let available_ram_mb = sys.available_memory() / (1024 * 1024);

    // GPU — sysinfo 0.35+ removed video_cards(); use platform detection
    let gpu_name = detect_gpu_name();

    // OS version
    let os_version = System::long_os_version().unwrap_or_else(|| "Unknown".to_string());
    let os_name = System::name().unwrap_or_else(|| std::env::consts::OS.to_string());
    let arch = std::env::consts::ARCH;

    // Hostname
    let hostname = hostname::get()
        .map(|h| h.to_string_lossy().to_string())
        .unwrap_or_else(|_| "Unknown Device".to_string());

    Ok(serde_json::json!({
        "hostname": hostname,
        "os": os_name,
        "osVersion": os_version,
        "arch": arch,
        "cpuModel": cpu_model,
        "cpuCores": cpu_cores,
        "totalRAMMB": total_ram_mb,
        "availableRAMMB": available_ram_mb,
        "gpuName": gpu_name,
    }))
}

/// Detect GPU name via platform-specific commands.
fn detect_gpu_name() -> String {
    #[cfg(target_os = "macos")]
    {
        if let Ok(output) = std::process::Command::new("system_profiler")
            .args(["SPDisplaysDataType"])
            .output()
        {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                if let Some(rest) = line.strip_prefix("          Chipset Model: ") {
                    return rest.trim().to_string();
                }
                if let Some(rest) = line.strip_prefix("          Chip: ") {
                    return rest.trim().to_string();
                }
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        // Try wmic for GPU name on Windows
        if let Ok(output) = hide_console(&mut std::process::Command::new("wmic"))
            .args(["path", "win32_videocontroller", "get", "name"])
            .output()
        {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines().skip(1) {
                let trimmed = line.trim();
                if !trimmed.is_empty() && trimmed != "Name" {
                    return trimmed.to_string();
                }
            }
        }
    }

    "Unknown GPU".to_string()
}

/// Periodic memory check — returns available/total RAM for runtime tier adjustment.
#[tauri::command]
fn get_memory_usage() -> Result<serde_json::Value, String> {
    use sysinfo::System;

    let mut sys = System::new();
    sys.refresh_memory();

    let total_mb = sys.total_memory() / (1024 * 1024);
    let available_mb = sys.available_memory() / (1024 * 1024);
    let used_mb = total_mb - available_mb;
    let fraction = if total_mb > 0 {
        (available_mb as f64 / total_mb as f64 * 100.0).round() / 100.0
    } else {
        1.0
    };

    Ok(serde_json::json!({
        "totalMB": total_mb,
        "availableMB": available_mb,
        "usedMB": used_mb,
        "availableFraction": fraction,
    }))
}

fn resolve_dock_data_path(name: &str) -> Result<(String, std::path::PathBuf), String> {
    let safe = name
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect::<String>();
    if safe.is_empty() {
        return Err("Invalid data name".to_string());
    }

    let uploads_dir = app_dir()?.join("uploads");
    fs::create_dir_all(&uploads_dir).map_err(|e| format!("Failed to create uploads dir: {}", e))?;
    Ok((safe.clone(), uploads_dir.join(format!("{}.json", safe))))
}

fn write_dock_data(name: &str, data: &str) -> Result<(), String> {
    let (safe, path) = resolve_dock_data_path(name)?;
    fs::write(&path, data).map_err(|e| format!("Failed to write dock data: {}", e))?;
    println!("[Tauri] Saved dock data '{}' ({} bytes)", safe, data.len());
    Ok(())
}

/// Save dock-shared data to a JSON file in the uploads directory.
/// The overlay server can then serve it to the dock page.
/// `name` is the filename (e.g. "worship-songs"), `.json` is appended.
#[tauri::command]
fn save_dock_data(name: String, data: String) -> Result<(), String> {
    write_dock_data(&name, &data)
}

/// Load dock-shared data from the uploads directory.
/// Returns an empty string when the file has not been written yet.
#[tauri::command]
fn load_dock_data(name: String) -> Result<String, String> {
    let (safe, path) = resolve_dock_data_path(&name)?;
    if !path.exists() {
        return Ok(String::new());
    }

    let contents = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read dock data '{}': {}", safe, e))?;
    if !safe.starts_with("dock-voice-bible-") && !safe.starts_with("dock-worship-song-save") {
        println!(
            "[Tauri] Loaded dock data '{}' ({} bytes)",
            safe,
            contents.len()
        );
    }
    Ok(contents)
}

/// Load all native Dock settings for a user/device scope.
#[tauri::command]
fn load_dock_settings(scope: Option<String>) -> Result<String, String> {
    dock_settings::load_settings(scope.as_deref().unwrap_or("device"))
}

/// Persist one native Dock setting. Values are JSON so existing Dock
/// preferences can move over without losing their shape.
#[tauri::command]
fn save_dock_setting(
    scope: Option<String>,
    key: String,
    value: serde_json::Value,
) -> Result<(), String> {
    dock_settings::save_setting(scope.as_deref().unwrap_or("device"), &key, &value)
}

/// Remove one native Dock setting.
#[tauri::command]
fn delete_dock_setting(scope: Option<String>, key: String) -> Result<(), String> {
    dock_settings::delete_setting(scope.as_deref().unwrap_or("device"), &key)
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct OnlineLyricsSearchResult {
    id: String,
    source_id: String,
    source_name: String,
    title: String,
    artist: String,
    url: String,
    preview: String,
    lyrics: String,
    thumbnail_url: Option<String>,
    #[serde(skip_serializing)]
    score: i32,
}

#[derive(Deserialize)]
struct WpRenderedField {
    rendered: String,
}

#[derive(Deserialize)]
struct WpPost {
    link: String,
    title: WpRenderedField,
    content: WpRenderedField,
    #[serde(default)]
    jetpack_featured_media_url: Option<String>,
}

#[derive(Deserialize)]
struct BloggerFeedResponse {
    feed: BloggerFeed,
}

#[derive(Deserialize)]
struct BloggerFeed {
    #[serde(default)]
    entry: Vec<BloggerEntry>,
}

#[derive(Deserialize)]
struct BloggerTextValue {
    #[serde(rename = "$t")]
    value: String,
}

#[derive(Deserialize)]
struct BloggerLink {
    rel: String,
    href: String,
}

#[derive(Deserialize)]
struct BloggerThumbnail {
    url: String,
}

#[derive(Deserialize)]
struct BloggerEntry {
    title: BloggerTextValue,
    content: BloggerTextValue,
    #[serde(default)]
    link: Vec<BloggerLink>,
    #[serde(rename = "media$thumbnail")]
    thumbnail: Option<BloggerThumbnail>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LrcLibTrack {
    id: i64,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    track_name: Option<String>,
    #[serde(default)]
    artist_name: Option<String>,
    #[serde(default)]
    instrumental: bool,
    #[serde(default)]
    plain_lyrics: Option<String>,
    #[serde(default)]
    synced_lyrics: Option<String>,
}

fn build_online_lyrics_client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(4))
        .timeout(Duration::from_secs(8))
        .redirect(reqwest::redirect::Policy::limited(5))
        .user_agent(ONLINE_LYRICS_USER_AGENT)
        .build()
        .map_err(|err| format!("Failed to create lyrics search client: {}", err))
}

fn parse_selector(selector: &str) -> Result<Selector, String> {
    Selector::parse(selector).map_err(|err| format!("Invalid selector '{}': {:?}", selector, err))
}

fn clean_inline_text(text: &str) -> String {
    text.replace('\u{00a0}', " ")
        .replace("&nbsp;", " ")
        .replace('\u{2018}', "'")
        .replace('\u{2019}', "'")
        .replace('\u{201c}', "\"")
        .replace('\u{201d}', "\"")
        .replace('\u{2013}', "-")
        .replace('\u{2014}', "-")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string()
}

fn normalize_text_block(text: &str) -> String {
    let mut lines = Vec::new();
    let mut last_blank = false;

    for raw_line in text.lines() {
        let cleaned = clean_inline_text(raw_line);
        if cleaned.is_empty() {
            if !last_blank && !lines.is_empty() {
                lines.push(String::new());
            }
            last_blank = true;
            continue;
        }

        lines.push(cleaned);
        last_blank = false;
    }

    lines.join("\n").trim().to_string()
}

fn html_fragment_to_text(fragment: &str) -> String {
    let normalized_html = fragment
        .replace("<br />", "\n")
        .replace("<br/>", "\n")
        .replace("<br>", "\n")
        .replace("</p>", "\n\n")
        .replace("</div>", "\n\n")
        .replace("</li>", "\n")
        .replace("</h1>", "\n")
        .replace("</h2>", "\n")
        .replace("</h3>", "\n")
        .replace("</h4>", "\n")
        .replace("</h5>", "\n")
        .replace("</h6>", "\n");

    let fragment = Html::parse_fragment(&normalized_html);
    let text = fragment.root_element().text().collect::<Vec<_>>().join("");
    normalize_text_block(&text)
}

fn strip_ascii_ci_prefix(text: &str, prefix: &str) -> String {
    let text = text.trim();
    if let Some(candidate) = text.get(..prefix.len()) {
        if candidate.eq_ignore_ascii_case(prefix) {
            return text
                .get(prefix.len()..)
                .unwrap_or_default()
                .trim()
                .to_string();
        }
    }

    text.to_string()
}

fn strip_ascii_ci_suffix(text: &str, suffix: &str) -> String {
    let text = text.trim();
    if let Some(start) = text.len().checked_sub(suffix.len()) {
        if let Some(candidate) = text.get(start..) {
            if candidate.eq_ignore_ascii_case(suffix) {
                return text.get(..start).unwrap_or_default().trim().to_string();
            }
        }
    }

    text.to_string()
}

fn split_ascii_ci_once<'a>(text: &'a str, separators: &[&str]) -> Option<(&'a str, &'a str)> {
    let lower = text.to_ascii_lowercase();

    for separator in separators {
        let separator_lower = separator.to_ascii_lowercase();
        if let Some(index) = lower.find(&separator_lower) {
            let after_index = index + separator.len();
            return Some((&text[..index], &text[after_index..]));
        }
    }

    None
}

fn cleanup_song_title(raw_title: &str) -> String {
    let mut title = clean_inline_text(raw_title);

    for prefix in [
        "[Download & Lyrics] ",
        "[Download + Lyrics] ",
        "Download & Lyrics ",
        "Download + Lyrics ",
    ] {
        title = strip_ascii_ci_prefix(&title, prefix);
    }

    for suffix in [
        "| Nigerian Gospel Lyrics",
        "| African Gospel Lyrics",
        "| New-age Gospel Lyrics",
        "• New-age Gospel Lyrics",
    ] {
        title = strip_ascii_ci_suffix(&title, suffix);
    }

    for suffix in [
        " (Mp3 & Lyrics)",
        " (Mp3 + Lyrics)",
        " Mp3 & Lyrics",
        " Mp3 + Lyrics",
        "Lyrics in-Full",
        "Lyrics in Full",
        "Full Lyrics and Video",
        "Full Lyrics",
        "Lyrics",
    ] {
        title = strip_ascii_ci_suffix(&title, suffix);
    }

    title
        .trim_matches(|ch: char| matches!(ch, '-' | ':' | '|' | ' '))
        .trim()
        .to_string()
}

fn cleanup_artist_name(raw_artist: &str) -> String {
    let mut artist = clean_inline_text(raw_artist);

    for prefix in ["a song by ", "song by ", "by "] {
        artist = strip_ascii_ci_prefix(&artist, prefix);
    }

    artist
        .trim_matches(|ch: char| matches!(ch, '-' | ':' | '|' | ' '))
        .trim()
        .to_string()
}

fn extract_field_from_lines(text: &str, field_names: &[&str]) -> Option<String> {
    for line in text.lines().take(10) {
        let cleaned = clean_inline_text(line);
        if cleaned.is_empty() {
            continue;
        }

        let lower = cleaned.to_ascii_lowercase();
        for field_name in field_names {
            let normalized_field = field_name.to_ascii_lowercase();
            if lower.starts_with(&normalized_field) {
                if let Some((_, value)) = cleaned.split_once(':') {
                    let value = clean_inline_text(value);
                    if !value.is_empty() {
                        return Some(value);
                    }
                }
            }
        }
    }

    None
}

fn extract_title_artist_from_content_markers(raw_content_text: &str) -> Option<(String, String)> {
    let mut download_fallback = None;

    for line in raw_content_text.lines().take(100) {
        let cleaned = clean_inline_text(line);
        if cleaned.is_empty() {
            continue;
        }

        let lyrics_line = strip_ascii_ci_prefix(&cleaned, "lyrics:");
        if lyrics_line != cleaned {
            if let Some((title, artist)) = split_ascii_ci_once(&lyrics_line, &[" by "]) {
                let title = cleanup_song_title(title);
                let artist = cleanup_artist_name(artist);
                if !title.is_empty() {
                    return Some((title, artist));
                }
            }
        }

        let download_line = strip_ascii_ci_prefix(&cleaned, "download ");
        if download_line != cleaned {
            if let Some((title, artist)) = split_ascii_ci_once(
                &download_line,
                &[" Mp3 Audio by ", " MP3 Audio by ", " Audio by ", " Mp3 by "],
            ) {
                let title = cleanup_song_title(title);
                let artist = cleanup_artist_name(artist);
                if !title.is_empty() && download_fallback.is_none() {
                    download_fallback = Some((title, artist));
                }
            }
        }
    }

    download_fallback
}

fn extract_title_artist(raw_title: &str, raw_content_text: &str) -> (String, String) {
    let content_title = extract_field_from_lines(raw_content_text, &["song title", "song tittle"]);
    let content_artist = extract_field_from_lines(raw_content_text, &["artist"]);
    let content_marker_pair = extract_title_artist_from_content_markers(raw_content_text);

    let normalized_title = clean_inline_text(raw_title);
    let (mut title, mut artist) = if let Some((before, after)) = split_ascii_ci_once(
        &normalized_title,
        &[
            " Lyrics in-Full: a song by ",
            " Lyrics in Full: a song by ",
            " Lyrics by ",
            " lyrics by ",
            " - ",
        ],
    ) {
        (cleanup_song_title(before), cleanup_artist_name(after))
    } else {
        (cleanup_song_title(&normalized_title), String::new())
    };

    if let Some((marker_title, marker_artist)) = content_marker_pair {
        title = marker_title;
        if !marker_artist.is_empty() {
            artist = marker_artist;
        }
    }

    if let Some(content_title) = content_title {
        title = cleanup_song_title(&content_title);
    }

    if let Some(content_artist) = content_artist {
        artist = cleanup_artist_name(&content_artist);
    }

    (title, artist)
}

fn should_break_lyrics(line: &str) -> bool {
    let lower = line.to_ascii_lowercase();
    matches!(
        lower.as_str(),
        "the video" | "video" | "watch the video" | "watch video" | "related" | "more" | "print"
    ) || lower.contains("thanks for visiting")
        || lower.contains("have a blessed week")
        || lower.contains("property and copyright")
        || lower.contains("personal and educational purpose only")
        || lower.contains("contact us to dmca")
        || lower.starts_with("discover more from")
        || lower.starts_with("subscribe to get")
        || lower.starts_with("share on ")
        || lower.starts_with("email a link")
        || lower.starts_with("like loading")
}

fn should_drop_lyrics_line(line: &str) -> bool {
    let lower = line.to_ascii_lowercase();
    lower.starts_with("song title:")
        || lower.starts_with("song tittle:")
        || lower.starts_with("artist:")
        || lower.starts_with("album:")
        || lower.starts_with("lyrics:")
        || lower == "the full lyrics"
        || lower == "full lyrics"
        || lower == "contents:"
        || lower == "toggle"
        || lower.starts_with("read also")
        || lower.starts_with("share this")
        || lower.starts_with("download")
        || lower.contains("(opens in new window)")
        || lower.contains("download here")
        || lower.contains("get mp3 audio")
        || lower.contains("stream, and share")
        || lower.contains("ceenaija")
        || matches!(
            lower.as_str(),
            "share"
                | "tweet"
                | "pin"
                | "whatsapp"
                | "telegram"
                | "facebook"
                | "email"
                | "pinterest"
                | "tumblr"
                | "x"
        )
}

fn prune_lyrics_text(text: &str) -> String {
    let normalized = normalize_text_block(text);
    let normalized_lines = normalized.lines().collect::<Vec<_>>();
    let start_index = normalized_lines
        .iter()
        .position(|line| {
            let lower = clean_inline_text(line).to_ascii_lowercase();
            lower == "lyrics" || lower.starts_with("lyrics:")
        })
        .map(|index| index + 1)
        .unwrap_or(0);
    let mut lines = Vec::new();
    let mut last_blank = false;

    for line in normalized_lines.into_iter().skip(start_index) {
        if should_break_lyrics(line) {
            break;
        }
        if should_drop_lyrics_line(line) {
            continue;
        }

        if line.trim().is_empty() {
            if !last_blank && !lines.is_empty() {
                lines.push(String::new());
            }
            last_blank = true;
            continue;
        }

        lines.push(line.trim().to_string());
        last_blank = false;
    }

    lines.join("\n").trim().to_string()
}

fn build_preview(text: &str) -> String {
    let joined = text
        .lines()
        .map(clean_inline_text)
        .filter(|line| !line.is_empty())
        .take(3)
        .collect::<Vec<_>>()
        .join(" ");

    let preview = joined.trim();
    let mut chars = preview.chars();
    let mut output = chars.by_ref().take(187).collect::<String>();
    if chars.next().is_some() {
        output.push_str("...");
    }

    output
}

fn strip_lrc_timestamps(text: &str) -> String {
    text.lines()
        .filter_map(|raw_line| {
            let mut line = raw_line.trim();

            while line.starts_with('[') {
                let Some(close) = line.find(']') else {
                    break;
                };
                let tag = &line[1..close];
                let mut tag_parts = tag.split(':');
                let first = tag_parts.next().unwrap_or_default();
                let second = tag_parts.next().unwrap_or_default();
                let is_timestamp = tag_parts.next().is_none()
                    && !first.is_empty()
                    && first.chars().all(|ch| ch.is_ascii_digit())
                    && second.len() >= 2
                    && second.chars().all(|ch| ch.is_ascii_digit() || ch == '.');
                let is_metadata = matches!(
                    first.to_ascii_lowercase().as_str(),
                    "ar" | "ti" | "al" | "by" | "offset"
                );

                if !is_timestamp && !is_metadata {
                    break;
                }
                line = line[close + 1..].trim_start();
            }

            let cleaned = clean_inline_text(line);
            (!cleaned.is_empty()).then_some(cleaned)
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn tokenize_query(query: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();

    for ch in query.chars() {
        if ch.is_ascii_alphanumeric() {
            current.push(ch.to_ascii_lowercase());
        } else if !current.is_empty() {
            tokens.push(current.clone());
            current.clear();
        }
    }

    if !current.is_empty() {
        tokens.push(current);
    }

    tokens
        .into_iter()
        .filter(|token| {
            token.len() > 1
                && !matches!(
                    token.as_str(),
                    "lyrics"
                        | "lyric"
                        | "song"
                        | "songs"
                        | "full"
                        | "video"
                        | "download"
                        | "the"
                        | "and"
                        | "feat"
                        | "ft"
                        | "with"
                        | "for"
                        | "from"
                        | "by"
                )
        })
        .collect()
}

fn fuzzy_prefix(token: &str, min_len: usize, max_len: usize) -> Option<String> {
    let char_count = token.chars().count();
    if char_count < min_len {
        return None;
    }

    Some(token.chars().take(char_count.min(max_len)).collect())
}

fn build_online_lyrics_search_queries(query: &str) -> Vec<String> {
    let tokens = tokenize_query(query);
    let mut queries = vec![clean_inline_text(query)];

    if tokens.len() >= 2 {
        let fuzzy_tokens = tokens
            .iter()
            .filter_map(|token| fuzzy_prefix(token, 3, 4))
            .collect::<Vec<_>>();
        if fuzzy_tokens.len() >= 2 {
            queries.push(fuzzy_tokens.join(" "));
        }

        let mixed_prefix_tokens = tokens
            .iter()
            .enumerate()
            .filter_map(|(index, token)| {
                if index == 0 {
                    fuzzy_prefix(token, 3, 3)
                } else {
                    fuzzy_prefix(token, 3, 4)
                }
            })
            .collect::<Vec<_>>();
        if mixed_prefix_tokens.len() >= 2 {
            queries.push(mixed_prefix_tokens.join(" "));
        }
    }

    if tokens.len() == 1 {
        if let Some(prefix) = fuzzy_prefix(&tokens[0], 3, 5) {
            queries.push(prefix);
        }
    }

    queries
        .into_iter()
        .filter(|query| query.chars().count() >= 3)
        .fold(Vec::new(), |mut unique, query| {
            if !unique
                .iter()
                .any(|item: &String| item.eq_ignore_ascii_case(&query))
            {
                unique.push(query);
            }
            unique
        })
}

fn levenshtein_distance(left: &str, right: &str) -> usize {
    if left == right {
        return 0;
    }

    let left_chars = left.chars().collect::<Vec<_>>();
    let right_chars = right.chars().collect::<Vec<_>>();

    if left_chars.is_empty() {
        return right_chars.len();
    }
    if right_chars.is_empty() {
        return left_chars.len();
    }

    let mut previous = (0..=right_chars.len()).collect::<Vec<_>>();
    let mut current = vec![0; right_chars.len() + 1];

    for (left_index, left_char) in left_chars.iter().enumerate() {
        current[0] = left_index + 1;

        for (right_index, right_char) in right_chars.iter().enumerate() {
            let substitution_cost = if left_char == right_char { 0 } else { 1 };
            current[right_index + 1] = (previous[right_index + 1] + 1)
                .min(current[right_index] + 1)
                .min(previous[right_index] + substitution_cost);
        }

        std::mem::swap(&mut previous, &mut current);
    }

    previous[right_chars.len()]
}

fn fuzzy_token_match_score(query_token: &str, candidate_tokens: &[String]) -> i32 {
    candidate_tokens
        .iter()
        .map(|candidate| {
            if candidate == query_token {
                return 34;
            }
            if candidate.starts_with(query_token) || query_token.starts_with(candidate) {
                return 24;
            }

            let distance = levenshtein_distance(query_token, candidate);
            let max_len = query_token.chars().count().max(candidate.chars().count());
            if max_len >= 5 && distance <= 2 {
                18
            } else if max_len >= 4 && distance <= 1 {
                14
            } else {
                0
            }
        })
        .max()
        .unwrap_or(0)
}

fn compute_result_score(
    query: &str,
    title: &str,
    artist: &str,
    preview: &str,
    lyrics: &str,
) -> i32 {
    let title_lower = title.to_ascii_lowercase();
    let artist_lower = artist.to_ascii_lowercase();
    let preview_lower = preview.to_ascii_lowercase();
    let lyrics_lower = lyrics.to_ascii_lowercase();
    let query_lower = query.trim().to_ascii_lowercase();
    let title_tokens = tokenize_query(title);
    let artist_tokens = tokenize_query(artist);
    let preview_tokens = tokenize_query(preview);
    let lyrics_tokens = tokenize_query(&lyrics.lines().take(24).collect::<Vec<_>>().join(" "));
    let mut score = 0;

    if !query_lower.is_empty() && title_lower.contains(&query_lower) {
        score += 220;
    }
    if !query_lower.is_empty() && artist_lower.contains(&query_lower) {
        score += 70;
    }

    for token in tokenize_query(query) {
        if title_lower.contains(&token) {
            score += 34;
        } else {
            score += fuzzy_token_match_score(&token, &title_tokens);
        }
        if artist_lower.contains(&token) {
            score += 22;
        } else {
            score += fuzzy_token_match_score(&token, &artist_tokens) / 2;
        }
        if preview_lower.contains(&token) {
            score += 12;
        } else {
            score += fuzzy_token_match_score(&token, &preview_tokens) / 3;
        }
        if lyrics_lower.contains(&token) {
            score += 8;
        } else {
            score += fuzzy_token_match_score(&token, &lyrics_tokens) / 4;
        }
    }

    if !artist.is_empty() {
        score += 12;
    }
    if lyrics.len() > 140 {
        score += 18;
    }
    if lyrics.len() > 480 {
        score += 10;
    }

    for penalty in [
        "biography",
        "songs lyrics",
        "songs and lyrics",
        "lyricspedia",
        "ultimate list",
        "top 15",
        "top 10",
        "album",
        "albums",
        "artists",
        "full biography",
    ] {
        if title_lower.contains(penalty) {
            score -= 120;
        }
    }

    score
}

fn build_result(
    source_id: &str,
    source_name: &str,
    raw_title: &str,
    raw_content: &str,
    url: &str,
    thumbnail_url: Option<String>,
    query: &str,
) -> Option<OnlineLyricsSearchResult> {
    let content_text = html_fragment_to_text(raw_content);
    let lyrics = prune_lyrics_text(&content_text);
    let (title, artist) = extract_title_artist(raw_title, &content_text);
    let preview_source = if !lyrics.is_empty() {
        &lyrics
    } else {
        &content_text
    };
    let preview = build_preview(preview_source);
    let score = compute_result_score(query, &title, &artist, &preview, &lyrics);

    if title.is_empty()
        || url.trim().is_empty()
        || (lyrics.len() < 40 && preview.len() < 24)
        || score < 24
    {
        return None;
    }

    Some(OnlineLyricsSearchResult {
        id: format!("{}:{}", source_id, url),
        source_id: source_id.to_string(),
        source_name: source_name.to_string(),
        title,
        artist,
        url: url.to_string(),
        preview,
        lyrics,
        thumbnail_url,
        score,
    })
}

fn search_wordpress_source(
    client: &reqwest::blocking::Client,
    source_id: &str,
    source_name: &str,
    api_url: &str,
    query: &str,
) -> Result<Vec<OnlineLyricsSearchResult>, String> {
    let response = client
        .get(api_url)
        .query(&[
            ("search", query),
            ("per_page", "6"),
            ("_fields", "link,title,content,jetpack_featured_media_url"),
        ])
        .send()
        .map_err(|err| format!("{} search failed: {}", source_name, err))?
        .error_for_status()
        .map_err(|err| format!("{} search failed: {}", source_name, err))?;

    let posts: Vec<WpPost> = response
        .json()
        .map_err(|err| format!("{} search decode failed: {}", source_name, err))?;

    let mut results = posts
        .into_iter()
        .filter_map(|post| {
            build_result(
                source_id,
                source_name,
                &html_fragment_to_text(&post.title.rendered),
                &post.content.rendered,
                &post.link,
                post.jetpack_featured_media_url,
                query,
            )
        })
        .collect::<Vec<_>>();

    results.sort_by(|left, right| right.score.cmp(&left.score));
    Ok(results)
}

fn search_african_gospel_lyrics(
    client: &reqwest::blocking::Client,
    query: &str,
) -> Result<Vec<OnlineLyricsSearchResult>, String> {
    let response = client
        .get("https://africangospellyrics.com/")
        .query(&[("s", query)])
        .send()
        .map_err(|err| format!("African Gospel Lyrics search failed: {}", err))?
        .error_for_status()
        .map_err(|err| format!("African Gospel Lyrics search failed: {}", err))?;

    let search_html = response
        .text()
        .map_err(|err| format!("African Gospel Lyrics search decode failed: {}", err))?;
    let search_doc = Html::parse_document(&search_html);
    let post_selector = parse_selector("div.post")?;
    let title_selector = parse_selector("h2.post-title a")?;
    let content_selector = parse_selector("div.post-content")?;

    let mut results = Vec::new();

    for post in search_doc.select(&post_selector).take(4) {
        let Some(link) = post.select(&title_selector).next() else {
            continue;
        };

        let url = link.value().attr("href").unwrap_or("").trim().to_string();
        if url.is_empty() {
            continue;
        }

        let title = clean_inline_text(&link.text().collect::<Vec<_>>().join(" "));
        let Ok(detail_response) = client.get(&url).send() else {
            continue;
        };
        let Ok(detail_response) = detail_response.error_for_status() else {
            continue;
        };
        let Ok(detail_html) = detail_response.text() else {
            continue;
        };
        let detail_doc = Html::parse_document(&detail_html);
        let raw_content = detail_doc
            .select(&content_selector)
            .next()
            .map(|node| node.inner_html())
            .unwrap_or_default();

        if let Some(result) = build_result(
            "africangospellyrics",
            "African Gospel Lyrics",
            &title,
            &raw_content,
            &url,
            None,
            query,
        ) {
            results.push(result);
        }
    }

    results.sort_by(|left, right| right.score.cmp(&left.score));
    Ok(results)
}

fn search_godlyrics(
    client: &reqwest::blocking::Client,
    query: &str,
) -> Result<Vec<OnlineLyricsSearchResult>, String> {
    let response = client
        .get("https://www.godlyrics.com.ng/feeds/posts/default")
        .query(&[("q", query), ("alt", "json")])
        .send()
        .map_err(|err| format!("GodLyrics search failed: {}", err))?
        .error_for_status()
        .map_err(|err| format!("GodLyrics search failed: {}", err))?;

    let payload: BloggerFeedResponse = response
        .json()
        .map_err(|err| format!("GodLyrics search decode failed: {}", err))?;

    let mut results = payload
        .feed
        .entry
        .into_iter()
        .filter_map(|entry| {
            let url = entry
                .link
                .iter()
                .find(|link| link.rel == "alternate")
                .map(|link| link.href.clone())?;

            build_result(
                "godlyrics",
                "GodLyrics",
                &entry.title.value,
                &entry.content.value,
                &url,
                entry.thumbnail.map(|thumbnail| thumbnail.url),
                query,
            )
        })
        .collect::<Vec<_>>();

    results.sort_by(|left, right| right.score.cmp(&left.score));
    Ok(results)
}

fn search_lrclib(
    client: &reqwest::blocking::Client,
    query: &str,
) -> Result<Vec<OnlineLyricsSearchResult>, String> {
    let response = client
        .get("https://lrclib.net/api/search")
        .query(&[("q", query)])
        .send()
        .map_err(|err| format!("LRCLIB search failed: {}", err))?
        .error_for_status()
        .map_err(|err| format!("LRCLIB search failed: {}", err))?;

    let tracks: Vec<LrcLibTrack> = response
        .json()
        .map_err(|err| format!("LRCLIB search decode failed: {}", err))?;

    let mut results = tracks
        .into_iter()
        .filter_map(|track| {
            if track.instrumental {
                return None;
            }

            let plain_lyrics = prune_lyrics_text(&track.plain_lyrics.unwrap_or_default());
            let synced_lyrics = prune_lyrics_text(&strip_lrc_timestamps(
                &track.synced_lyrics.unwrap_or_default(),
            ));
            let lyrics = if plain_lyrics.is_empty() {
                synced_lyrics
            } else {
                plain_lyrics
            };
            let title = clean_inline_text(
                track
                    .track_name
                    .as_deref()
                    .or(track.name.as_deref())
                    .unwrap_or_default(),
            );
            let artist = clean_inline_text(track.artist_name.as_deref().unwrap_or_default());
            let preview = build_preview(&lyrics);
            let score = compute_result_score(query, &title, &artist, &preview, &lyrics);

            if title.is_empty() || lyrics.len() < 40 || score < 12 {
                return None;
            }

            Some(OnlineLyricsSearchResult {
                id: format!("lrclib:{}", track.id),
                source_id: "lrclib".to_string(),
                source_name: "LRCLIB".to_string(),
                title,
                artist,
                url: format!("https://lrclib.net/api/get/{}", track.id),
                preview,
                lyrics,
                thumbnail_url: None,
                score,
            })
        })
        .collect::<Vec<_>>();

    results.sort_by(|left, right| right.score.cmp(&left.score));
    Ok(results)
}

fn append_source_results(
    results: &mut Vec<OnlineLyricsSearchResult>,
    source_results: Result<Vec<OnlineLyricsSearchResult>, String>,
) {
    match source_results {
        Ok(mut items) => results.append(&mut items),
        Err(err) => eprintln!("[OnlineLyrics] {}", err),
    }
}

fn finish_online_lyrics_results(
    mut results: Vec<OnlineLyricsSearchResult>,
) -> Vec<OnlineLyricsSearchResult> {
    let mut seen_urls = Vec::<String>::new();
    results.retain(|result| {
        let url_key = result.url.to_ascii_lowercase();
        if seen_urls.iter().any(|url| url == &url_key) {
            return false;
        }
        seen_urls.push(url_key);
        true
    });
    results.sort_by(|left, right| right.score.cmp(&left.score));
    results.truncate(ONLINE_LYRICS_RESULT_LIMIT);
    results
}

fn search_online_song_lyrics_blocking(
    query: String,
) -> Result<Vec<OnlineLyricsSearchResult>, String> {
    let trimmed_query = clean_inline_text(query.trim());
    if trimmed_query.chars().count() < 3 {
        return Ok(Vec::new());
    }

    let client = build_online_lyrics_client()?;
    let mut results = Vec::new();
    let search_queries = build_online_lyrics_search_queries(&trimmed_query);

    // Search every provider for every normalized query. LRCLIB is useful for
    // structured metadata, while the regional lyric sites often contain
    // Nigerian and other African songs that LRCLIB does not have. Returning
    // as soon as one provider responds hid those better matches from users.
    for search_query in &search_queries {
        std::thread::scope(|scope| {
            let lrclib_client = client.clone();
            let lrclib_query = search_query.clone();
            let lrclib = scope.spawn(move || search_lrclib(&lrclib_client, &lrclib_query));

            let gospel_client = client.clone();
            let gospel_query = search_query.clone();
            let gospellyrics = scope.spawn(move || {
                search_wordpress_source(
                    &gospel_client,
                    "gospellyricsng",
                    "GospellyricsNG",
                    "https://gospellyricsng.com/wp-json/wp/v2/posts",
                    &gospel_query,
                )
            });

            let gospel_songs_client = client.clone();
            let gospel_songs_query = search_query.clone();
            let gospel_songs = scope.spawn(move || {
                search_wordpress_source(
                    &gospel_songs_client,
                    "gospelsongs",
                    "GospelSongs.com.ng",
                    "https://gospelsongs.com.ng/wp-json/wp/v2/posts",
                    &gospel_songs_query,
                )
            });

            let ceenaija_client = client.clone();
            let ceenaija_query = search_query.clone();
            let ceenaija = scope.spawn(move || {
                search_wordpress_source(
                    &ceenaija_client,
                    "ceenaija",
                    "CeeNaija",
                    "https://www.ceenaija.com/wp-json/wp/v2/posts",
                    &ceenaija_query,
                )
            });

            let ng_client = client.clone();
            let ng_query = search_query.clone();
            let nglyrics = scope.spawn(move || {
                search_wordpress_source(
                    &ng_client,
                    "nglyrics",
                    "NgLyrics",
                    "https://www.nglyrics.net/wp-json/wp/v2/posts",
                    &ng_query,
                )
            });

            let godlyrics_client = client.clone();
            let godlyrics_query = search_query.clone();
            let godlyrics =
                scope.spawn(move || search_godlyrics(&godlyrics_client, &godlyrics_query));

            let african_client = client.clone();
            let african_query = search_query.clone();
            let african =
                scope.spawn(move || search_african_gospel_lyrics(&african_client, &african_query));

            for source_results in [
                lrclib
                    .join()
                    .unwrap_or_else(|_| Err("LRCLIB search worker panicked".to_string())),
                gospellyrics
                    .join()
                    .unwrap_or_else(|_| Err("GospellyricsNG search worker panicked".to_string())),
                ceenaija
                    .join()
                    .unwrap_or_else(|_| Err("CeeNaija search worker panicked".to_string())),
                gospel_songs.join().unwrap_or_else(|_| {
                    Err("GospelSongs.com.ng search worker panicked".to_string())
                }),
                nglyrics
                    .join()
                    .unwrap_or_else(|_| Err("NgLyrics search worker panicked".to_string())),
                godlyrics
                    .join()
                    .unwrap_or_else(|_| Err("GodLyrics search worker panicked".to_string())),
                african.join().unwrap_or_else(|_| {
                    Err("African Gospel Lyrics search worker panicked".to_string())
                }),
            ] {
                append_source_results(&mut results, source_results);
            }
        });
    }

    Ok(finish_online_lyrics_results(results))
}

#[tauri::command]
async fn search_online_song_lyrics(query: String) -> Result<Vec<OnlineLyricsSearchResult>, String> {
    tauri::async_runtime::spawn_blocking(move || search_online_song_lyrics_blocking(query))
        .await
        .map_err(|err| format!("Lyrics search task failed: {}", err))?
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EasyWorshipRawRecord {
    pub rowid: i64,
    pub title: String,
    pub author: Option<String>,
    pub copyright: Option<String>,
    pub administrator: Option<String>,
    pub reference_number: Option<String>,
    pub words_rtf: String,
}

// ── EasyWorship song library ─────────────────────────────────────────────
//
// EasyWorship 6 and 7 keep each profile's songs in two SQLite files in the same folder:
// Songs.db (titles, authors, CCLI numbers) and SongWords.db (the lyrics as RTF). On Windows that
// folder is usually C:\Users\Public\Documents\Softouch\EasyWorship\<Profile>\v6.1\Databases\Data,
// and C:\ProgramData\Softouch\EasyWorship.v7\Profiles\<Profile>.ewp says where each profile lives
// (AppInstDataDir). The files are only ever opened read-only, so EasyWorship can stay open.

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct EasyWorshipLibrary {
    /// The profile name ("Default"), or the folder's name.
    name: String,
    /// The folder that holds Songs.db and SongWords.db.
    data_dir: String,
    song_count: i64,
}

fn is_easyworship_songs_db(name: &str) -> bool {
    let n = name.to_lowercase();
    // "Songs.db", and copies such as "Songs (1).db".
    n.ends_with(".db") && n.starts_with("songs") && !n.starts_with("songwords")
}

fn is_easyworship_words_db(name: &str) -> bool {
    let n = name.to_lowercase();
    n.ends_with(".db") && n.starts_with("songwords")
}

/// Songs.db and SongWords.db side by side in `dir` (exact names first, then copies like "Songs (1).db").
fn easyworship_files_in(dir: &Path) -> Option<(PathBuf, PathBuf)> {
    let entries: Vec<PathBuf> = fs::read_dir(dir).ok()?.flatten().map(|e| e.path()).filter(|p| p.is_file()).collect();
    let pick = |test: fn(&str) -> bool, exact: &str| -> Option<PathBuf> {
        let matching: Vec<&PathBuf> = entries
            .iter()
            .filter(|p| p.file_name().map(|n| test(&n.to_string_lossy())).unwrap_or(false))
            .collect();
        matching
            .iter()
            .find(|p| p.file_name().map(|n| n.to_string_lossy().eq_ignore_ascii_case(exact)).unwrap_or(false))
            .or_else(|| matching.first())
            .map(|p| (*p).clone())
    };
    Some((pick(is_easyworship_songs_db, "Songs.db")?, pick(is_easyworship_words_db, "SongWords.db")?))
}

/// The folder at or under `dir` that holds an EasyWorship song library (Songs.db + SongWords.db).
/// Looks through at most a few thousand folders, so picking a big folder (a whole drive) stays quick.
fn find_easyworship_data_dir(dir: &Path, depth: usize) -> Option<(PathBuf, PathBuf, PathBuf)> {
    let mut budget = 4000usize;
    find_easyworship_data_dir_within(dir, depth, &mut budget)
}

fn find_easyworship_data_dir_within(dir: &Path, depth: usize, budget: &mut usize) -> Option<(PathBuf, PathBuf, PathBuf)> {
    if depth > 7 || *budget == 0 {
        return None;
    }
    *budget -= 1;
    if let Some((songs, words)) = easyworship_files_in(dir) {
        return Some((dir.to_path_buf(), songs, words));
    }
    let mut subdirs: Vec<PathBuf> = fs::read_dir(dir).ok()?.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect();
    // EasyWorship's own folders first ("Databases", "Data", "v6.1"); hidden, system and code folders never.
    const SKIP: [&str; 9] = ["node_modules", "library", "appdata", "windows", "program files", "program files (x86)", "$recycle.bin", "system volume information", "target"];
    subdirs.retain(|p| {
        let n = p.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
        !n.is_empty() && !n.starts_with('.') && !SKIP.contains(&n.as_str())
    });
    subdirs.sort_by_key(|p| {
        let n = p.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
        if n == "databases" || n == "data" || n.starts_with("v6") || n.starts_with("v7") { 0 } else { 1 }
    });
    subdirs.into_iter().find_map(|sub| find_easyworship_data_dir_within(&sub, depth + 1, budget))
}

fn open_easyworship_db(path: &Path) -> Result<rusqlite::Connection, String> {
    rusqlite::Connection::open_with_flags(
        path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| format!("Could not open {}: {}", path.display(), e))
}

fn count_easyworship_songs(songs_path: &Path) -> Result<i64, String> {
    let conn = open_easyworship_db(songs_path)?;
    conn.query_row("SELECT COUNT(*) FROM song", [], |row| row.get(0))
        .map_err(|_| "This Songs.db is not an EasyWorship 6 or 7 song library.".to_string())
}

fn easyworship_library_at(dir: &Path, name_hint: Option<&str>) -> Result<EasyWorshipLibrary, String> {
    let (data_dir, songs, _) = find_easyworship_data_dir(dir, 0).ok_or_else(|| {
        "No EasyWorship song library was found in this folder. Choose the folder that holds Songs.db and SongWords.db \
         (in EasyWorship it's usually Documents\\Softouch\\EasyWorship\\Default\\v6.1\\Databases\\Data), or a folder above it."
            .to_string()
    })?;
    let song_count = count_easyworship_songs(&songs)?;
    let name = name_hint.map(|s| s.to_string()).unwrap_or_else(|| {
        // "...\EasyWorship\Default\v6.1\Databases\Data" -> "Default"
        data_dir
            .ancestors()
            .filter_map(|a| a.file_name().map(|n| n.to_string_lossy().to_string()))
            .find(|n| !matches!(n.to_lowercase().as_str(), "data" | "databases") && !n.to_lowercase().starts_with("v6") && !n.to_lowercase().starts_with("v7"))
            .unwrap_or_else(|| "EasyWorship".to_string())
    });
    Ok(EasyWorshipLibrary { name, data_dir: data_dir.to_string_lossy().to_string(), song_count })
}

/// Where EasyWorship libraries usually are on this computer (profiles first).
fn easyworship_candidate_roots() -> Vec<(PathBuf, Option<String>)> {
    let mut roots: Vec<(PathBuf, Option<String>)> = Vec::new();
    // Profiles: C:\ProgramData\Softouch\EasyWorship.v7\Profiles\*.ewp → AppInstDataDir
    if let Ok(program_data) = std::env::var("PROGRAMDATA") {
        let softouch = PathBuf::from(program_data).join("Softouch");
        if let Ok(apps) = fs::read_dir(&softouch) {
            for app in apps.flatten() {
                let profiles = app.path().join("Profiles");
                let Ok(files) = fs::read_dir(&profiles) else { continue };
                for file in files.flatten() {
                    let path = file.path();
                    if path.extension().map(|e| e.eq_ignore_ascii_case("ewp")).unwrap_or(false) {
                        let text = fs::read(&path).map(|b| String::from_utf8_lossy(&b).to_string()).unwrap_or_default();
                        if let Some(dir) = text.lines().find_map(|l| l.trim().strip_prefix("AppInstDataDir=")) {
                            let name = path.file_stem().map(|n| n.to_string_lossy().to_string());
                            roots.push((PathBuf::from(dir.trim()), name));
                        }
                    }
                }
            }
        }
    }
    // The shared documents folder EasyWorship uses by default, one folder per profile.
    let mut documents: Vec<PathBuf> = Vec::new();
    if let Ok(public) = std::env::var("PUBLIC") {
        documents.push(PathBuf::from(public).join("Documents"));
    }
    if let Some(home) = dirs::document_dir() {
        documents.push(home);
    }
    for docs in documents {
        for brand in ["Softouch\\EasyWorship", "Softouch/EasyWorship", "EasyWorship"] {
            let base = docs.join(brand);
            if let Ok(profiles) = fs::read_dir(&base) {
                for profile in profiles.flatten() {
                    if profile.path().is_dir() {
                        roots.push((profile.path(), Some(profile.file_name().to_string_lossy().to_string())));
                    }
                }
            }
        }
    }
    roots
}

/// The EasyWorship song libraries found on this computer, with how many songs each holds.
#[tauri::command]
fn find_easyworship_libraries() -> Vec<EasyWorshipLibrary> {
    let mut seen = std::collections::HashSet::new();
    let mut found = Vec::new();
    for (root, name) in easyworship_candidate_roots() {
        if !root.is_dir() {
            continue;
        }
        if let Ok(lib) = easyworship_library_at(&root, name.as_deref()) {
            let key = fs::canonicalize(&lib.data_dir).map(|p| p.to_string_lossy().to_lowercase()).unwrap_or_else(|_| lib.data_dir.to_lowercase());
            if seen.insert(key) {
                found.push(lib);
            }
        }
    }
    found
}

/// Checks a folder (or a Songs.db file) the operator picked: where the library is and how many songs it has.
#[tauri::command]
fn inspect_easyworship_folder(folder_path: String) -> Result<EasyWorshipLibrary, String> {
    let picked = PathBuf::from(folder_path.trim());
    let dir = if picked.is_file() { picked.parent().unwrap_or(&picked).to_path_buf() } else { picked };
    if !dir.is_dir() {
        return Err("That folder can't be opened. Check it still exists and try again.".to_string());
    }
    easyworship_library_at(&dir, None)
}

/// Reads every song with its lyrics from an EasyWorship library (read-only).
#[tauri::command]
fn read_easyworship_db_folder(folder_path: String) -> Result<Vec<EasyWorshipRawRecord>, String> {
    let picked = PathBuf::from(folder_path.trim());
    let dir = if picked.is_file() { picked.parent().unwrap_or(&picked).to_path_buf() } else { picked };
    let (_, songs_path, words_path) = find_easyworship_data_dir(&dir, 0).ok_or_else(|| {
        "No EasyWorship song library was found in this folder (it needs Songs.db and SongWords.db).".to_string()
    })?;

    // The lyrics, by song.
    let words_conn = open_easyworship_db(&words_path)?;
    let mut words_by_song: HashMap<i64, String> = HashMap::new();
    {
        let mut stmt = words_conn
            .prepare("SELECT song_id, words FROM word")
            .map_err(|_| "This SongWords.db is not an EasyWorship 6 or 7 lyrics file.".to_string())?;
        let rows = stmt
            .query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, Option<String>>(1)?)))
            .map_err(|e| format!("Could not read the lyrics: {}", e))?;
        for (song_id, words) in rows.flatten() {
            if let Some(words) = words.filter(|w| !w.trim().is_empty()) {
                words_by_song.entry(song_id).or_insert(words);
            }
        }
    }

    let conn = open_easyworship_db(&songs_path)?;
    let mut stmt = conn
        .prepare("SELECT rowid, title, author, copyright, administrator, reference_number FROM song ORDER BY title COLLATE NOCASE ASC")
        .map_err(|_| "This Songs.db is not an EasyWorship 6 or 7 song library.".to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2).ok().flatten(),
                row.get::<_, Option<String>>(3).ok().flatten(),
                row.get::<_, Option<String>>(4).ok().flatten(),
                row.get::<_, Option<String>>(5).ok().flatten(),
            ))
        })
        .map_err(|e| format!("Could not read the songs: {}", e))?;

    let mut records = Vec::new();
    for (rowid, title, author, copyright, administrator, reference_number) in rows.flatten() {
        // A song with no lyrics has nothing to show, so it is left out.
        let Some(words_rtf) = words_by_song.remove(&rowid) else { continue };
        records.push(EasyWorshipRawRecord {
            rowid,
            title: title.unwrap_or_default(),
            author,
            copyright,
            administrator,
            reference_number,
            words_rtf,
        });
    }
    Ok(records)
}

// ── EasyWorship pictures, videos and themes ──────────────────────────────
//
// A profile keeps its media in <Profile>\Resources\Images and \Videos, with titles in
// Databases\Data\Media.db (path "<images>" / "<videos>" means those folders). Themes are listed in
// Themes.db (song themes are presentation_type 13, scripture themes 14) and laid out in
// PresentationLayouts.db: the BACKGROUND element's foreground resource is the picture or video,
// and its background resource the solid colour behind it.

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct EasyWorshipMediaFile {
    title: String,
    path: String,
    /// "image" or "video".
    kind: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct EasyWorshipTheme {
    title: String,
    /// "song" or "scripture".
    kind: String,
    /// The picture or video behind the words, when there is one and the file exists.
    media_path: Option<String>,
    /// "#rrggbb" when the background is a solid colour.
    color: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct EasyWorshipAssets {
    media: Vec<EasyWorshipMediaFile>,
    themes: Vec<EasyWorshipTheme>,
}

const EW_IMAGE_EXTENSIONS: [&str; 7] = ["jpg", "jpeg", "png", "bmp", "gif", "webp", "tif"];
const EW_VIDEO_EXTENSIONS: [&str; 10] = ["mp4", "mov", "wmv", "avi", "mpg", "mpeg", "m4v", "mkv", "webm", "flv"];

fn easyworship_media_kind(path: &Path) -> Option<&'static str> {
    let ext = path.extension()?.to_string_lossy().to_lowercase();
    if EW_IMAGE_EXTENSIONS.contains(&ext.as_str()) {
        Some("image")
    } else if EW_VIDEO_EXTENSIONS.contains(&ext.as_str()) {
        Some("video")
    } else {
        None
    }
}

/// The child of `dir` named `name`, whatever its case ("Resources", "resources").
fn child_dir_ci(dir: &Path, name: &str) -> Option<PathBuf> {
    fs::read_dir(dir)
        .ok()?
        .flatten()
        .map(|e| e.path())
        .find(|p| p.is_dir() && p.file_name().map(|n| n.to_string_lossy().eq_ignore_ascii_case(name)).unwrap_or(false))
}

/// "<images>foo.jpg", "<videos>", or a full path, as a file on disk.
fn resolve_easyworship_media_path(resources: Option<&Path>, folder: &str, filename: &str) -> Option<PathBuf> {
    let joined = format!("{}{}", folder, filename);
    let resolved = if let Some(rest) = joined.strip_prefix('<') {
        let (tag, file) = rest.split_once('>')?;
        let sub = match tag.to_lowercase().as_str() {
            "images" => "Images",
            "videos" => "Videos",
            "audio" => "Audio",
            "shared" | "sharedmedia" => "SharedMedia",
            _ => return None,
        };
        child_dir_ci(resources?, sub)?.join(file.trim_start_matches(['\\', '/']))
    } else if !folder.is_empty() {
        PathBuf::from(folder).join(filename)
    } else {
        PathBuf::from(filename)
    };
    resolved.is_file().then_some(resolved)
}

/// Reads the pictures, videos and themes of the EasyWorship profile around `folder_path` (read-only).
#[tauri::command]
fn read_easyworship_assets(folder_path: String) -> Result<EasyWorshipAssets, String> {
    let picked = PathBuf::from(folder_path.trim());
    let dir = if picked.is_file() { picked.parent().unwrap_or(&picked).to_path_buf() } else { picked };
    let data_dir = find_easyworship_data_dir(&dir, 0).map(|(d, _, _)| d).unwrap_or_else(|| dir.clone());
    // "<Profile>\v6.1\Databases\Data" → "<Profile>\Resources"
    let resources = data_dir.ancestors().find_map(|a| child_dir_ci(a, "Resources"));
    let resources = resources.as_deref();
    let db = |name: &str| -> Option<rusqlite::Connection> {
        let path = fs::read_dir(&data_dir)
            .ok()?
            .flatten()
            .map(|e| e.path())
            .find(|p| p.file_name().map(|n| n.to_string_lossy().eq_ignore_ascii_case(name)).unwrap_or(false))?;
        open_easyworship_db(&path).ok()
    };

    // Pictures and videos: Media.db first (it has the titles), then anything else in the folders.
    let mut media: Vec<EasyWorshipMediaFile> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let mut add_media = |title: String, path: PathBuf, media: &mut Vec<EasyWorshipMediaFile>| {
        let Some(kind) = easyworship_media_kind(&path) else { return };
        let key = path.to_string_lossy().to_lowercase();
        if seen.insert(key) {
            let title = if title.trim().is_empty() {
                path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default()
            } else {
                title.trim().to_string()
            };
            media.push(EasyWorshipMediaFile { title, path: path.to_string_lossy().to_string(), kind: kind.to_string() });
        }
    };
    if let Some(conn) = db("Media.db") {
        if let Ok(mut stmt) = conn.prepare("SELECT title, path, filename FROM media ORDER BY title COLLATE NOCASE") {
            let rows = stmt.query_map([], |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?.unwrap_or_default(),
                    row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                    row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                ))
            });
            if let Ok(rows) = rows {
                for (title, folder, filename) in rows.flatten() {
                    if let Some(path) = resolve_easyworship_media_path(resources, &folder, &filename) {
                        add_media(title, path, &mut media);
                    }
                }
            }
        }
    }
    if let Some(resources) = resources {
        for sub in ["Images", "Videos"] {
            let Some(folder) = child_dir_ci(resources, sub) else { continue };
            let mut files: Vec<PathBuf> = fs::read_dir(&folder).map(|r| r.flatten().map(|e| e.path()).filter(|p| p.is_file()).collect()).unwrap_or_default();
            files.sort();
            for path in files {
                add_media(String::new(), path, &mut media);
            }
        }
    }

    // Themes: the title from Themes.db, the background from PresentationLayouts.db.
    let mut themes: Vec<EasyWorshipTheme> = Vec::new();
    if let (Some(list), Some(layouts)) = (db("Themes.db"), db("PresentationLayouts.db")) {
        let items: Vec<(String, i64, i64)> = list
            .prepare("SELECT title, presentation_type, presentation_id FROM file_item WHERE presentation_type IN (13, 14) ORDER BY title COLLATE NOCASE")
            .and_then(|mut stmt| {
                stmt.query_map([], |row| Ok((row.get::<_, Option<String>>(0)?.unwrap_or_default(), row.get(1)?, row.get(2)?)))
                    .map(|rows| rows.flatten().collect())
            })
            .unwrap_or_default();
        for (title, presentation_type, presentation_id) in items {
            let background: Option<(Option<i64>, Option<i64>)> = layouts
                .query_row(
                    "SELECT e.foreground_resource_id, e.background_resource_id FROM element e JOIN slide s ON s.rowid = e.slide_id \
                     WHERE s.presentation_id = ?1 AND e.element_uid = 'BACKGROUND' ORDER BY s.order_index LIMIT 1",
                    [presentation_id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .ok();
            let (foreground, back) = background.unwrap_or((None, None));
            let media_path = foreground.and_then(|id| {
                layouts
                    .query_row(
                        "SELECT original_filename FROM resource_image WHERE resource_id = ?1 \
                         UNION ALL SELECT original_filename FROM resource_video WHERE resource_id = ?1 LIMIT 1",
                        [id],
                        |row| row.get::<_, Option<String>>(0),
                    )
                    .ok()
                    .flatten()
                    .and_then(|name| resolve_easyworship_media_path(resources, "", &name))
            });
            if let Some(path) = &media_path {
                add_media(String::new(), path.clone(), &mut media);
            }
            // EasyWorship colours are stored as 0x00BBGGRR.
            let color = back
                .and_then(|id| layouts.query_row("SELECT color FROM resource_color WHERE resource_id = ?1", [id], |row| row.get::<_, i64>(0)).ok())
                .map(|c| format!("#{:02x}{:02x}{:02x}", c & 0xff, (c >> 8) & 0xff, (c >> 16) & 0xff));
            themes.push(EasyWorshipTheme {
                title: if title.trim().is_empty() { "EasyWorship theme".to_string() } else { title.trim().to_string() },
                kind: if presentation_type == 14 { "scripture" } else { "song" }.to_string(),
                media_path: media_path.map(|p| p.to_string_lossy().to_string()),
                color,
            });
        }
    }

    Ok(EasyWorshipAssets { media, themes })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The sample EasyWorship library in the repo (eazyworship/), with copied names like "Songs (1).db".
    #[test]
    fn reads_the_sample_easyworship_library_read_only() {
        let sample = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../eazyworship");
        if !sample.join("Songs (1).db").exists() {
            eprintln!("sample EasyWorship library not found; skipping");
            return;
        }
        // Found from a folder above it too (the repo root, with its big code folders skipped).
        let above = inspect_easyworship_folder(sample.parent().unwrap().to_string_lossy().to_string()).expect("from above");
        assert!(above.data_dir.ends_with("eazyworship"), "{}", above.data_dir);
        let lib = inspect_easyworship_folder(sample.to_string_lossy().to_string()).expect("library");
        assert_eq!(lib.song_count, 223);
        let records = read_easyworship_db_folder(sample.to_string_lossy().to_string()).expect("songs");
        assert!(records.len() > 200 && records.len() <= 223, "{} songs", records.len());
        assert!(records.iter().all(|r| r.words_rtf.starts_with("{\\rtf")));
        // Picking the Songs.db file itself works the same.
        let by_file = read_easyworship_db_folder(sample.join("Songs (1).db").to_string_lossy().to_string()).expect("by file");
        assert_eq!(by_file.len(), records.len());
    }

    /// EasyWorship's own Default profile, when EasyWorship is installed on this computer.
    #[test]
    fn reads_easyworship_pictures_videos_and_themes() {
        let Ok(public) = std::env::var("PUBLIC") else { return };
        let profile = PathBuf::from(public).join("Documents").join("Softouch").join("Easyworship").join("Default");
        if !profile.join("Resources").is_dir() {
            eprintln!("EasyWorship's Default profile not found; skipping");
            return;
        }
        let assets = read_easyworship_assets(profile.to_string_lossy().to_string()).expect("assets");
        assert!(assets.media.iter().all(|m| Path::new(&m.path).is_file()));
        assert!(assets.media.iter().any(|m| m.kind == "image") && assets.media.iter().any(|m| m.kind == "video"));
        assert!(assets.themes.iter().any(|t| t.kind == "song" && t.media_path.is_some()), "{:?}", assets.themes);
        // Every theme picture or video is also in the media list.
        for theme in &assets.themes {
            if let Some(path) = &theme.media_path {
                assert!(assets.media.iter().any(|m| &m.path == path), "{path}");
            }
        }
        // Picking the database folder finds the same profile.
        let from_data = read_easyworship_assets(profile.join("v6.1").join("Databases").join("Data").to_string_lossy().to_string()).expect("from data");
        assert_eq!(from_data.media.len(), assets.media.len());
    }

    #[test]
    fn explains_a_folder_without_an_easyworship_library() {
        let empty = std::env::temp_dir().join(format!("mce-ew-empty-{}", std::process::id()));
        let _ = fs::create_dir_all(&empty);
        let err = inspect_easyworship_folder(empty.to_string_lossy().to_string()).unwrap_err();
        assert!(err.contains("Songs.db and SongWords.db"), "{err}");
        let _ = fs::remove_dir_all(&empty);
    }

    #[test]
    fn cleanup_song_title_handles_accented_utf8() {
        assert_eq!(cleanup_song_title("Ore Òfé Shá Lyrics"), "Ore Òfé Shá");
    }

    #[test]
    fn build_preview_truncates_utf8_safely() {
        let preview = build_preview(&"Òfé Shá ".repeat(80));

        assert!(preview.ends_with("..."));
        assert!(preview.is_char_boundary(preview.len()));
    }

    #[test]
    fn strip_lrc_timestamps_keeps_lyrics_and_drops_metadata() {
        let lyrics = strip_lrc_timestamps(
            "[ar:Artist]\n[ti:Song]\n[00:01.20][00:02.30]Amazing grace\n[00:04.00]How sweet the sound",
        );

        assert_eq!(lyrics, "Amazing grace\nHow sweet the sound");
    }

    #[test]
    fn fuzzy_search_query_handles_misspelled_title() {
        let queries = build_online_lyrics_search_queries("onidhe iyanf");

        assert!(queries.iter().any(|query| query == "oni iyan"));
        assert!(compute_result_score("onidhe iyanf", "Onise Iyanu", "", "", "") > 24);
    }

    #[test]
    fn ceenaija_content_markers_extract_song_and_lyrics() {
        let text = normalize_text_block(
            "Download Number One Mp3 Audio by Dunsin Oyekan Ft. John Wilds\n\
             Biography copy\n\
             Lyrics: Number One by Dunsin Oyekan\n\
             First things first, You are not another option\n\
             You will always be my Number One",
        );
        let (title, artist) =
            extract_title_artist("Dunsin Oyekan - Number One (Mp3 & Lyrics)", &text);
        let lyrics = prune_lyrics_text(&text);

        assert_eq!(title, "Number One");
        assert_eq!(artist, "Dunsin Oyekan");
        assert!(lyrics.starts_with("First things first"));
        assert!(!lyrics.contains("Biography copy"));
    }

    #[test]
    fn prune_lyrics_removes_subscription_and_share_footer() {
        let text = normalize_text_block(
            "Lyrics:\n\
             You are worthy oh God\n\
             No eyes have seen it\n\
             Discover more from African Gospel Lyrics\n\
             Subscribe to get the latest posts sent to your email.\n\
             Type your email...\n\
             Share on Facebook (Opens in new window)\n\
             Facebook\n\
             Related",
        );
        let lyrics = prune_lyrics_text(&text);

        assert_eq!(lyrics, "You are worthy oh God\nNo eyes have seen it");
        assert!(!lyrics.contains("Discover more"));
        assert!(!lyrics.contains("Facebook"));
        assert!(!lyrics.contains("Related"));
    }
}

// ─── Transcript Library Commands ─────────────────────────────────────────────
// These commands manage the Transcript Library, a completely separate feature
// from Live Speech-to-Scripture. Storage: ~/Documents/MakeChurchEasy/transcripts/

fn transcripts_dir() -> Result<std::path::PathBuf, String> {
    let dir = app_dir()?.join("transcripts");
    fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create transcripts directory: {}", e))?;
    Ok(dir)
}

#[tauri::command]
fn load_transcripts() -> Result<String, String> {
    let dir = transcripts_dir()?;
    let mut transcripts: Vec<serde_json::Value> = Vec::new();

    if dir.exists() {
        if let Ok(entries) = fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()) == Some("json") {
                    if let Ok(contents) = fs::read_to_string(&path) {
                        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&contents) {
                            transcripts.push(val);
                        }
                    }
                }
            }
        }
    }

    transcripts.sort_by(|a, b| {
        let a_date = a.get("createdAt").and_then(|v| v.as_str()).unwrap_or("");
        let b_date = b.get("createdAt").and_then(|v| v.as_str()).unwrap_or("");
        b_date.cmp(a_date)
    });

    serde_json::to_string(&transcripts)
        .map_err(|e| format!("Failed to serialize transcripts: {}", e))
}

#[tauri::command]
fn save_transcript(transcript: serde_json::Value) -> Result<(), String> {
    let dir = transcripts_dir()?;
    let id = transcript
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or("Transcript missing id")?;

    let safe_name = id
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>();

    let path = dir.join(format!("{}.json", safe_name));
    let json = serde_json::to_string_pretty(&transcript)
        .map_err(|e| format!("Failed to serialize transcript: {}", e))?;

    fs::write(&path, json)
        .map_err(|e| format!("Failed to write transcript '{}': {}", safe_name, e))?;

    Ok(())
}

#[tauri::command]
fn delete_transcript(id: String) -> Result<(), String> {
    let dir = transcripts_dir()?;
    let safe_name = id
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>();

    let path = dir.join(format!("{}.json", safe_name));
    if path.exists() {
        fs::remove_file(&path)
            .map_err(|e| format!("Failed to delete transcript '{}': {}", safe_name, e))?;
    }
    Ok(())
}

#[tauri::command]
fn get_transcript_stats() -> Result<String, String> {
    let dir = transcripts_dir()?;
    let mut total_sessions: u64 = 0;
    let mut total_duration: u64 = 0;
    let mut total_scriptures: u64 = 0;

    if dir.exists() {
        if let Ok(entries) = fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()) == Some("json") {
                    if let Ok(contents) = fs::read_to_string(&path) {
                        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&contents) {
                            total_sessions += 1;
                            total_duration += val
                                .get("durationSeconds")
                                .and_then(|v| v.as_u64())
                                .unwrap_or(0);
                            total_scriptures += val
                                .get("scriptures")
                                .and_then(|v| v.as_array())
                                .map(|a| a.len() as u64)
                                .unwrap_or(0);
                        }
                    }
                }
            }
        }
    }

    let h = total_duration / 3600;
    let m = (total_duration % 3600) / 60;
    let total_duration_formatted = if h > 0 {
        format!("{}h {}m", h, m)
    } else {
        format!("{}m", m)
    };

    let stats = serde_json::json!({
        "totalSessions": total_sessions,
        "totalDurationFormatted": total_duration_formatted,
        "totalScriptures": total_scriptures,
        "usedThisMonth": total_duration_formatted
    });

    serde_json::to_string(&stats).map_err(|e| format!("Failed to serialize stats: {}", e))
}

const OPENCODE_BASE_URL: &str = "https://opencode.ai/zen/v1";
const OPENCODE_MODEL: &str = "mimo-v2.5-free";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorshipImportAiStatus {
    ai_configured: bool,
    model: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorshipImportReviewRequest {
    songs: Vec<WorshipImportReviewSongInput>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorshipImportReviewSongInput {
    id: String,
    title: String,
    hymn_number: Option<String>,
    language: Option<String>,
    confidence: f64,
    raw_text: String,
    warnings: Vec<String>,
    section_hints: Vec<WorshipImportReviewSectionHint>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorshipImportReviewSectionHint {
    label: String,
    #[serde(rename = "type")]
    section_type: String,
    content: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorshipImportReviewResponse {
    songs: Vec<WorshipImportReviewSongOutput>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorshipImportReviewSongOutput {
    id: String,
    title: Option<String>,
    hymn_number: Option<String>,
    confidence: Option<f64>,
    warnings: Option<Vec<String>>,
    review_notes: Option<Vec<String>>,
    sections: Option<Vec<WorshipImportReviewSectionOutput>>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorshipImportReviewSectionOutput {
    #[serde(rename = "type")]
    section_type: Option<String>,
    label: Option<String>,
    number: Option<String>,
    content: Option<String>,
    warnings: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorshipImportStructureRequest {
    chunk_index: usize,
    total_chunks: usize,
    text: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorshipImportStructureResponse {
    songs: Vec<WorshipImportStructureSong>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorshipImportStructureSong {
    title: String,
    hymn_number: Option<String>,
    warnings: Option<Vec<String>>,
    sections: Vec<WorshipImportStructureSection>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorshipImportStructureSection {
    #[serde(rename = "type")]
    section_type: String,
    label: Option<String>,
    number: Option<String>,
    content: String,
}

fn get_opencode_api_key() -> Result<String, String> {
    if let Ok(value) = std::env::var("OPENCODE_API_KEY") {
        if !value.trim().is_empty() {
            return Ok(value);
        }
    }

    for candidate in opencode_dotenv_candidates() {
        if let Some(value) = read_env_file_value(&candidate, "OPENCODE_API_KEY") {
            return Ok(value);
        }
    }

    if let Some(value) = option_env!("OPENCODE_API_KEY") {
        if !value.trim().is_empty() {
            return Ok(value.to_string());
        }
    }

    Err("OPENCODE_API_KEY environment variable not set. \
         Set it in your shell, .env, or GitHub Actions release secret."
        .to_string())
}

fn opencode_dotenv_candidates() -> Vec<std::path::PathBuf> {
    let mut candidates = Vec::new();

    if let Ok(current_dir) = std::env::current_dir() {
        candidates.push(current_dir.join(".env"));
        candidates.push(current_dir.join("../.env"));
        candidates.push(current_dir.join("../../.env"));
    }

    candidates
}

fn read_env_file_value(path: &std::path::Path, key: &str) -> Option<String> {
    let content = std::fs::read_to_string(path).ok()?;

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        let (name, value) = trimmed.split_once('=')?;
        if name.trim() != key {
            continue;
        }

        let normalized = value
            .trim()
            .trim_matches('"')
            .trim_matches('\'')
            .trim()
            .to_string();

        if !normalized.is_empty() {
            return Some(normalized);
        }
    }

    None
}

fn build_opencode_client(timeout_secs: u64) -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(timeout_secs))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))
}

fn extract_json_payload(text: &str) -> &str {
    let trimmed = text.trim();
    if trimmed.starts_with('{') && trimmed.ends_with('}') {
        return trimmed;
    }

    let start = trimmed.find('{');
    let end = trimmed.rfind('}');
    match (start, end) {
        (Some(s), Some(e)) if s < e => &trimmed[s..=e],
        _ => trimmed,
    }
}

fn build_worship_import_review_prompt(
    request: &WorshipImportReviewRequest,
) -> Result<String, String> {
    let payload = serde_json::to_string_pretty(request)
        .map_err(|e| format!("Failed to serialize review request: {}", e))?;

    Ok(format!(
        "You are a worship document review assistant.\n\
         Your job is to structure already-extracted worship songs for import.\n\
         HARD RULES:\n\
         - Do NOT write new lyrics.\n\
         - Do NOT translate.\n\
         - Do NOT summarize.\n\
         - Do NOT paraphrase.\n\
         - Do NOT normalize spelling.\n\
         - Do NOT fix OCR errors by changing words. If you suspect OCR issues, keep the original text and mention them in warnings.\n\
         - Use ONLY text that already exists in each song's rawText or sectionHints.\n\
         - Keep section content verbatim except for grouping existing lines into the right section.\n\
         - Never move lines from one song into another song.\n\
         - If uncertain, preserve the local structure and lower confidence.\n\n\
         TASK:\n\
         For each input song, identify title, hymnNumber, and sections such as verse, chorus, refrain, bridge, pre-chorus, tag, intro, outro, or other.\n\
         Detect broken stanza boundaries, repeated choruses, page continuations, and likely OCR mistakes.\n\
         Return structured JSON only.\n\n\
         RESPONSE SCHEMA:\n\
         {{\n\
           \"songs\": [\n\
             {{\n\
               \"id\": \"same as input\",\n\
               \"title\": \"string\",\n\
               \"hymnNumber\": \"string or omitted\",\n\
               \"confidence\": 0.0,\n\
               \"warnings\": [\"string\"],\n\
               \"reviewNotes\": [\"string\"],\n\
               \"sections\": [\n\
                 {{\n\
                   \"type\": \"verse|chorus|refrain|bridge|pre-chorus|tag|intro|outro|other\",\n\
                   \"label\": \"display label\",\n\
                   \"number\": \"optional section number\",\n\
                   \"content\": \"exact lyric text from the input only\",\n\
                   \"warnings\": [\"string\"]\n\
                 }}\n\
               ]\n\
             }}\n\
           ]\n\
         }}\n\n\
         INPUT SONGS:\n{payload}"
    ))
}

fn build_worship_import_system_prompt() -> &'static str {
    r#"You are a worship document parser.

ABSOLUTE RULES - VIOLATION WILL TERMINATE THE SESSION:
- Output EXACTLY ONE valid JSON object. Nothing before. Nothing after. No code fences. No markdown. No ``` . Just raw JSON.
- Do NOT write new lyrics.
- Do NOT translate.
- Do NOT summarize.
- Do NOT paraphrase.
- Do NOT normalize spelling.
- Do NOT fix OCR errors by changing words. If you suspect OCR issues, keep the original text and mention them in warnings.
- Use ONLY text that already exists in the input.
- Keep section content verbatim.
- Escape all JSON string content correctly, including quotes, backslashes, and lyric line breaks.
- Put lyric line breaks inside JSON strings as \n, not as literal unescaped newlines.
- If a title is unclear, use the first line as title and add a warning.
- If no hymn number is present, omit it.
- One object per song.
- Identify sections as: verse, chorus, refrain, bridge, pre-chorus, tag, intro, outro, other, stanza, response, solo, congregation, men, women, all, leader, choir.

RESPONSE MUST BE EXACTLY THIS FORMAT:
{"songs":[{"title":"Song title","hymnNumber":"optional","warnings":[],"sections":[{"type":"verse","label":"Verse 1","number":"1","content":"exact lyric text"}]}]}

Return valid JSON only. No markdown. No code fences. No explanation. Just JSON."#
}

fn build_worship_import_user_prompt(request: &WorshipImportStructureRequest) -> String {
    let chunk_context = if request.total_chunks > 1 {
        format!(
            "\nThis is chunk {} of {}. Songs may be split across chunks. Only extract songs that appear complete in this chunk.",
            request.chunk_index + 1,
            request.total_chunks
        )
    } else {
        String::new()
    };

    format!(
        "You are processing church worship documents.\n\
These documents may originate from:\n\
- Hymn books\n\
- Worship sheets\n\
- Choir documents\n\
- Sunday service song lists\n\
- CCC hymn books\n\
- Anglican hymn books\n\
- Methodist hymn books\n\
- Catholic hymn books\n\
- Redeemed Christian Church hymn books\n\
- Assemblies of God hymn books\n\
- Hand-typed church documents\n\
- OCR-scanned PDFs\n\
- Historical church publications\n\
The formatting may be inconsistent.\n\
Do not assume modern song formatting.\n\
Many documents use:\n\
- Stanza\n\
- Verse\n\
- Chorus\n\
- Refrain\n\
- Response\n\
- Solo\n\
- Congregation\n\
- Men\n\
- Women\n\
- All\n\
- Leader\n\
- Choir\n\
These should be preserved whenever possible.\n\
Some hymn books use numbering formats such as:\n\
1.\n\
2.\n\
3.\n\
or\n\
I.\n\
II.\n\
III.\n\
or\n\
(1)\n\
(2)\n\
(3)\n\
These often indicate verses.\n\
Do not automatically treat every numbered section as a new song.\n\
A song may span multiple pages.\n\
A hymn number often appears near the title.\n\
Examples:\n\
101 Amazing Grace\n\
Hymn 101\n\
No. 101\n\
101.\n\
101\n\
However page numbers may appear similarly.\n\
Be conservative.\n\
When uncertain, preserve rather than guess.\n\
Documents may contain:\n\
- Page numbers\n\
- Running headers\n\
- Running footers\n\
- Copyright notices\n\
- Publisher information\n\
- Index pages\n\
- Table of contents pages\n\
These are not songs.\n\
Exclude them only when confidence is very high.\n\
If confidence is low, preserve the text and add a warning.\n\
Many scanned hymn books contain OCR mistakes.\n\
Examples:\n\
G0D instead of GOD\n\
L0RD instead of LORD\n\
rn instead of m\n\
l instead of I\n\
Only correct errors when the intended text is obvious.\n\
Otherwise preserve the original.\n\
Church documents frequently repeat choruses.\n\
Repeated text does not necessarily mean duplication.\n\
Do not remove repeated sections.\n\
Preserve all meaningful content.\n\n\
Since many Nigerian churches use CCC books:\n\
Documents may contain bilingual content.\n\
Examples:\n\
English + Yoruba\n\
English + Twi\n\
English + French\n\
Do not separate bilingual sections into different songs.\n\
Keep them together when they clearly belong to the same hymn.\n\
Examples:\n\
Verse 1 (English)\n\
Verse 1 (Yoruba)\n\
should remain inside the same song.\n\
Do not translate.\n\
Do not merge languages.\n\
Preserve original ordering.{}\n\n\
INPUT TEXT:\n{}",
        chunk_context, request.text
    )
}

#[tauri::command]
fn get_worship_import_ai_status() -> WorshipImportAiStatus {
    WorshipImportAiStatus {
        ai_configured: get_opencode_api_key()
            .map(|value| !value.trim().is_empty())
            .unwrap_or(false),
        model: OPENCODE_MODEL.to_string(),
    }
}

#[tauri::command]
fn structure_worship_import_chunk(
    request: WorshipImportStructureRequest,
) -> Result<WorshipImportStructureResponse, String> {
    let api_key = get_opencode_api_key()?;
    let client = build_opencode_client(45)?;
    let system_prompt = build_worship_import_system_prompt();
    let user_prompt = build_worship_import_user_prompt(&request);

    let request_body = serde_json::json!({
        "model": OPENCODE_MODEL,
        "messages": [
            { "role": "system", "content": system_prompt },
            { "role": "user", "content": user_prompt }
        ],
        "temperature": 0.0,
        "max_tokens": 32768,
        "response_format": { "type": "json_object" }
    });

    let mut resp = client
        .post(format!("{}/chat/completions", OPENCODE_BASE_URL))
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&request_body)
        .send()
        .map_err(|e| format!("Worship import structure request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().unwrap_or_default();

        if status.as_u16() == 400 && text.to_lowercase().contains("response_format") {
            let fallback_body = serde_json::json!({
                "model": OPENCODE_MODEL,
                "messages": [
                    { "role": "system", "content": system_prompt },
                    { "role": "user", "content": user_prompt }
                ],
                "temperature": 0.0,
                "max_tokens": 32768
            });

            resp = client
                .post(format!("{}/chat/completions", OPENCODE_BASE_URL))
                .header("Content-Type", "application/json")
                .header("Authorization", format!("Bearer {}", api_key))
                .json(&fallback_body)
                .send()
                .map_err(|e| format!("Worship import structure retry failed: {}", e))?;

            if !resp.status().is_success() {
                let retry_status = resp.status();
                let retry_text = resp.text().unwrap_or_default();
                return Err(format!(
                    "OpenCode API returned {}: {}",
                    retry_status, retry_text
                ));
            }
        } else {
            return Err(format!("OpenCode API returned {}: {}", status, text));
        }
    }

    let data: serde_json::Value = resp
        .json()
        .map_err(|e| format!("Failed to parse worship structure response: {}", e))?;

    let content = data
        .get("choices")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_str())
        .ok_or("Worship import structure returned empty content")?;

    let payload = extract_json_payload(content);
    serde_json::from_str::<WorshipImportStructureResponse>(payload)
        .map_err(|e| format!("Failed to parse worship import structure JSON: {}", e))
}

#[tauri::command]
fn review_worship_import_batch(
    request: WorshipImportReviewRequest,
) -> Result<WorshipImportReviewResponse, String> {
    let api_key = get_opencode_api_key()?;
    let prompt = build_worship_import_review_prompt(&request)?;
    let client = build_opencode_client(120)?;

    let body = serde_json::json!({
        "model": OPENCODE_MODEL,
        "messages": [
            { "role": "system", "content": "Return valid JSON only. Never generate or rewrite lyrics." },
            { "role": "user", "content": prompt }
        ],
        "temperature": 0.0
    });

    let resp = client
        .post(format!("{}/chat/completions", OPENCODE_BASE_URL))
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&body)
        .send()
        .map_err(|e| format!("Worship import review request failed: {}", e))?;

    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().unwrap_or_default();
        return Err(format!(
            "Worship import review API returned {}: {}",
            status, text
        ));
    }

    let data: serde_json::Value = resp
        .json()
        .map_err(|e| format!("Failed to parse worship review response: {}", e))?;

    let content = data
        .get("choices")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_str())
        .ok_or("Worship import review returned empty content")?;

    let payload = extract_json_payload(content);
    serde_json::from_str::<WorshipImportReviewResponse>(payload)
        .map_err(|e| format!("Failed to parse worship import review JSON: {}", e))
}

#[tauri::command]
fn translate_transcript(
    transcript_text: String,
    target_language: String,
) -> Result<String, String> {
    let api_key = get_opencode_api_key()?;

    let prompt = format!(
        "Translate the following sermon transcript into {target_language}.\n\
         STRICT REQUIREMENTS:\n\
         - Produce fluent, natural, native-quality {target_language}.\n\
         - Use the official writing system and orthography of {target_language}.\n\
         - Preserve ALL language-specific characters, accents, diacritics, tone marks, vowel marks, underdots, cedillas, umlauts, tildes, ligatures, and other orthographic symbols required for correct writing.\n\
         - Never transliterate into plain ASCII.\n\
         - Never remove, simplify, or replace language-specific characters.\n\
         - Use the spelling conventions used by educated native speakers, published literature, news media, and religious texts in {target_language}.\n\
         - Maintain the original meaning, tone, and intent.\n\
         - Preserve speaker labels exactly.\n\
         - Preserve all timestamps (HH:MM:SS) exactly as they appear.\n\
         - Preserve Bible references exactly.\n\
         - Preserve verse numbers exactly.\n\
         - Preserve paragraph breaks and formatting where possible.\n\
         - Do not summarize.\n\
         - Do not omit content.\n\
         - Do not explain the translation.\n\
         - Do not add translator notes.\n\
         - Do not add commentary.\n\
         - Output ONLY the translated transcript.\n\n\
         QUALITY CHECK BEFORE RESPONDING:\n\
         Verify that the translation uses the correct native orthography for {target_language} and includes all required language-specific characters and diacritics where appropriate. If the language normally uses accented or marked characters, they must be present in the final output.\n\n\
         EXAMPLES OF CORRECT ORTHOGRAPHY:\n\
         English: God is good.\n\
         French: Dieu est bon.\n\
         Spanish: Dios es bueno.\n\
         Portuguese: Deus é bom.\n\
         Yoruba: Ọlọ́run dára.\n\
         Vietnamese: Chúa thật tốt.\n\
         Use the same level of orthographic accuracy for the target language.\n\n\
         Transcript:\n{transcript_text}"
    );

    let client = build_opencode_client(120)?;

    let body = serde_json::json!({
        "model": OPENCODE_MODEL,
        "messages": [{ "role": "user", "content": prompt }],
        "temperature": 0.3
    });

    let resp = client
        .post(format!("{}/chat/completions", OPENCODE_BASE_URL))
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&body)
        .send()
        .map_err(|e| format!("Translation request failed: {}", e))?;

    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().unwrap_or_default();
        return Err(format!("Translation API returned {}: {}", status, text));
    }

    let data: serde_json::Value = resp
        .json()
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    let content = data
        .get("choices")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_str())
        .ok_or("Translation returned empty content")?
        .to_string();

    Ok(content)
}

/// Fix WinAnsi-mapped Twi/Akan text extracted from PDFs.
///
/// Mobile app PDFs use custom fonts (Capecoast, Wogyaf, TwiTimes) with WinAnsi
/// encoding that map ASCII codes to Twi glyphs:
///   - '4' (0x34) → ɔ (U+0254)
///   - '1' (0x31) → ɛ (U+025B)
///   - '$' (0x24) → ɛ (U+025B)  (at word start)
///   - '!' (0x21) → Ɔ (U+0186)  (at word start, capital ɔ)
///
/// pdftotext extracts the raw ASCII codes, not the visual glyphs.
/// This function replaces them when they appear in word-internal positions.
fn fix_winansi_twi(text: String) -> String {
    let chars: Vec<char> = text.chars().collect();
    let len = chars.len();
    let mut result = String::with_capacity(text.len());

    for i in 0..len {
        let ch = chars[i];
        if ch == '4' || ch == '1' {
            // Adjacent to lowercase letter → inside a Twi word
            let prev_lower = i > 0 && chars[i - 1].is_ascii_lowercase();
            let next_lower = i + 1 < len && chars[i + 1].is_ascii_lowercase();
            if prev_lower || next_lower {
                result.push(if ch == '4' { 'ɔ' } else { 'ɛ' });
                continue;
            }
        } else if ch == '$' {
            // '$' at start of word followed by lowercase → Twi 'ɛ'
            let next_lower = i + 1 < len && chars[i + 1].is_ascii_lowercase();
            let prev_not_letter = i == 0 || !chars[i - 1].is_ascii_alphabetic();
            if next_lower && prev_not_letter {
                result.push('ɛ');
                continue;
            }
        } else if ch == '!' {
            // '!' at start of word followed by lowercase → Twi 'Ɔ' (capital)
            let next_lower = i + 1 < len && chars[i + 1].is_ascii_lowercase();
            let prev_not_letter = i == 0 || !chars[i - 1].is_ascii_alphabetic();
            if next_lower && prev_not_letter {
                result.push('\u{0186}'); // Ɔ
                continue;
            }
        }
        result.push(ch);
    }
    result
}

#[tauri::command]
fn extract_text_from_pdf(file_data: Vec<u8>) -> Result<String, String> {
    use std::io::Write;
    let mut tmp =
        tempfile::NamedTempFile::new().map_err(|e| format!("Failed to create temp file: {}", e))?;
    tmp.write_all(&file_data)
        .map_err(|e| format!("Failed to write temp file: {}", e))?;
    let path = tmp.into_temp_path();

    // pdftotext (Poppler) handles CMap/Unicode encodings correctly for
    // African-language fonts (Twi, Yoruba, Igbo) where the pdf-extract
    // crate corrupts ɛ→1 and ɔ→4 by falling back to raw glyph indices.
    //
    // Tauri-packaged apps have a minimal PATH, so we probe known install
    // locations on macOS and Linux before relying on bare PATH lookup.
    let pdftotext_candidates: &[&str] = &[
        "pdftotext",                   // PATH lookup (dev mode)
        "/opt/homebrew/bin/pdftotext", // Homebrew — Apple Silicon
        "/usr/local/bin/pdftotext",    // Homebrew — Intel Mac
        "/usr/bin/pdftotext",          // system / apt install
        "/usr/bin/pdftotext",          // Linux package manager
        "/snap/bin/pdftotext",         // Linux snap
    ];

    let mut last_error = String::new();

    if let Some(path_str) = path.to_str() {
        for candidate in pdftotext_candidates {
            eprintln!("[pdf-extract] trying: {} on file {}", candidate, path_str);
            match hide_console(&mut std::process::Command::new(candidate))
                .arg("-layout")
                .arg("-enc")
                .arg("UTF-8")
                .arg(path_str)
                .arg("-")
                .output()
            {
                Ok(output) => {
                    if output.status.success() {
                        let text = String::from_utf8_lossy(&output.stdout).to_string();
                        if !text.trim().is_empty() {
                            eprintln!(
                                "[pdf-extract] SUCCESS with {} — {} bytes",
                                candidate,
                                text.len()
                            );
                            return Ok(fix_winansi_twi(text));
                        }
                        last_error = format!("{} produced empty output", candidate);
                        eprintln!("[pdf-extract] {} produced empty output", candidate);
                    } else {
                        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
                        last_error = format!(
                            "{} failed (exit {:?}): {}",
                            candidate,
                            output.status.code(),
                            stderr
                        );
                        eprintln!("[pdf-extract] {} failed: {}", candidate, stderr);
                    }
                }
                Err(e) => {
                    last_error = format!("{} not found: {}", candidate, e);
                    eprintln!("[pdf-extract] {} not found: {}", candidate, e);
                }
            }
        }
    }

    eprintln!(
        "[pdf-extract] all pdftotext candidates failed ({}), falling back to pdf-extract crate",
        last_error
    );

    // pdf-extract fallback — known to corrupt non-Latin Unicode characters
    // when PDF fonts use non-standard glyph names. Last resort only.
    pdf_extract::extract_text(&path)
        .map(fix_winansi_twi)
        .map_err(|e| format!("PDF extraction failed: {}", e))
}

// ── Layout-aware PDF extraction (lopdf) ────────────────────────────────────

/// Minimal PDF content stream parser — produces lopdf Operations from raw bytes.
/// Handles only the operators needed for text extraction (BT, ET, Tf, Tm, Td, TD, Tj, TJ, T*)
/// plus enough of the operand grammar to reach them.
fn parse_content_stream(raw: &[u8]) -> Vec<lopdf::content::Operation> {
    let mut ops = Vec::new();
    let mut operands: Vec<lopdf::Object> = Vec::new();
    let bytes = raw;
    let len = bytes.len();
    let mut i = 0;

    while i < len {
        let b = bytes[i];
        match b {
            // Skip whitespace
            b' ' | b'\t' | b'\r' | b'\n' | b'\x0C' => {
                i += 1;
            }
            // Skip comments (% to end of line)
            b'%' => {
                while i < len && bytes[i] != b'\n' {
                    i += 1;
                }
            }
            // Integer or real number
            b'0'..=b'9' | b'-' | b'+' | b'.' => {
                let start = i;
                i += 1;
                while i < len && matches!(bytes[i], b'0'..=b'9' | b'.' | b'-' | b'+') {
                    i += 1;
                }
                let s = std::str::from_utf8(&bytes[start..i]).unwrap_or("0");
                if s.contains('.') {
                    if let Ok(v) = s.parse::<f64>() {
                        operands.push(lopdf::Object::Real(v as f32));
                    }
                } else if let Ok(v) = s.parse::<i64>() {
                    operands.push(lopdf::Object::Integer(v));
                }
            }
            // Name object (/Something)
            b'/' => {
                i += 1;
                let start = i;
                while i < len {
                    match bytes[i] {
                        b' ' | b'\t' | b'\r' | b'\n' | b'/' | b'(' | b')' | b'<' | b'>' | b'['
                        | b']' | b'{' | b'}' => break,
                        _ => {
                            i += 1;
                        }
                    }
                }
                let name = bytes[start..i].to_vec();
                operands.push(lopdf::Object::Name(name));
            }
            // Literal string (text in parentheses)
            b'(' => {
                i += 1;
                let mut s = Vec::new();
                let mut depth = 0i32;
                while i < len {
                    match bytes[i] {
                        b'(' => {
                            depth += 1;
                            s.push(b'(');
                            i += 1;
                        }
                        b')' => {
                            if depth > 0 {
                                depth -= 1;
                                s.push(b')');
                                i += 1;
                            } else {
                                i += 1;
                                break;
                            }
                        }
                        b'\\' => {
                            i += 1;
                            if i < len {
                                match bytes[i] {
                                    b'n' => s.push(b'\n'),
                                    b'r' => s.push(b'\r'),
                                    b't' => s.push(b'\t'),
                                    b'\\' => s.push(b'\\'),
                                    b'(' => s.push(b'('),
                                    b')' => s.push(b')'),
                                    d @ b'0'..=b'7' => {
                                        let mut oct = (d - b'0') as u32;
                                        i += 1;
                                        for _ in 0..2 {
                                            if i < len && matches!(bytes[i], b'0'..=b'7') {
                                                oct = oct * 8 + (bytes[i] - b'0') as u32;
                                                i += 1;
                                            } else {
                                                break;
                                            }
                                        }
                                        s.push(oct as u8);
                                        continue; // already advanced i
                                    }
                                    other => s.push(other),
                                }
                                i += 1;
                            }
                        }
                        _ => {
                            s.push(bytes[i]);
                            i += 1;
                        }
                    }
                }
                operands.push(lopdf::Object::String(s, lopdf::StringFormat::Literal));
            }
            // Hex string <AABB>
            b'<' => {
                i += 1;
                let mut hex = Vec::new();
                while i < len && bytes[i] != b'>' {
                    hex.push(bytes[i]);
                    i += 1;
                }
                if i < len {
                    i += 1;
                } // skip >
                  // Pad to even length
                if hex.len() % 2 != 0 {
                    hex.push(b'0');
                }
                let mut bytes_out = Vec::new();
                for chunk in hex.chunks(2) {
                    if let Ok(h) = std::str::from_utf8(chunk) {
                        if let Ok(b) = u8::from_str_radix(h, 16) {
                            bytes_out.push(b);
                        }
                    }
                }
                operands.push(lopdf::Object::String(
                    bytes_out,
                    lopdf::StringFormat::Hexadecimal,
                ));
            }
            // Array [...]
            b'[' => {
                i += 1;
                let mut arr = Vec::new();
                // Parse array elements recursively (simplified — only strings and numbers)
                while i < len && bytes[i] != b']' {
                    match bytes[i] {
                        b' ' | b'\t' | b'\r' | b'\n' => {
                            i += 1;
                        }
                        b'(' => {
                            // literal string inside array
                            i += 1;
                            let mut s = Vec::new();
                            while i < len && bytes[i] != b')' {
                                if bytes[i] == b'\\' && i + 1 < len {
                                    i += 1;
                                    match bytes[i] {
                                        b'n' => s.push(b'\n'),
                                        b'r' => s.push(b'\r'),
                                        b'\\' => s.push(b'\\'),
                                        b'(' => s.push(b'('),
                                        b')' => s.push(b')'),
                                        other => s.push(other),
                                    }
                                } else {
                                    s.push(bytes[i]);
                                }
                                i += 1;
                            }
                            if i < len {
                                i += 1;
                            }
                            arr.push(lopdf::Object::String(s, lopdf::StringFormat::Literal));
                        }
                        b'0'..=b'9' | b'-' | b'+' | b'.' => {
                            let start = i;
                            i += 1;
                            while i < len && matches!(bytes[i], b'0'..=b'9' | b'.' | b'-' | b'+') {
                                i += 1;
                            }
                            let s = std::str::from_utf8(&bytes[start..i]).unwrap_or("0");
                            if s.contains('.') {
                                if let Ok(v) = s.parse::<f64>() {
                                    arr.push(lopdf::Object::Real(v as f32));
                                }
                            } else if let Ok(v) = s.parse::<i64>() {
                                arr.push(lopdf::Object::Integer(v));
                            }
                        }
                        _ => {
                            i += 1;
                        } // skip unknown in arrays
                    }
                }
                if i < len {
                    i += 1;
                } // skip ]
                operands.push(lopdf::Object::Array(arr));
            }
            // Boolean true / false
            b't' if i + 3 < len && &bytes[i..i + 4] == b"true" => {
                operands.push(lopdf::Object::Boolean(true));
                i += 4;
            }
            b'f' if i + 4 < len && &bytes[i..i + 5] == b"false" => {
                operands.push(lopdf::Object::Boolean(false));
                i += 5;
            }
            // Operator (keyword)
            b'A'..=b'Z' | b'a'..=b'z' => {
                let start = i;
                while i < len && matches!(bytes[i], b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'*')
                {
                    i += 1;
                }
                let op = std::str::from_utf8(&bytes[start..i]).unwrap_or("");
                ops.push(lopdf::content::Operation {
                    operator: op.to_string(),
                    operands: operands.drain(..).collect(),
                });
            }
            // Object reference (obj gen R) — skip
            _ => {
                i += 1;
            }
        }
    }
    ops
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PdfTextElement {
    text: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    font_size: f64,
    is_bold: bool,
    page: u32,
}

/// Decode a PDF string object to UTF-8, trying raw bytes first then Latin-1 fallback.
fn decode_pdf_string(obj: &lopdf::Object) -> Option<String> {
    if let lopdf::Object::String(bytes, _format) = obj {
        if let Ok(s) = String::from_utf8(bytes.clone()) {
            return Some(s);
        }
        // Latin-1 fallback — every byte maps to a valid codepoint
        Some(bytes.iter().map(|&b| b as char).collect())
    } else {
        None
    }
}

/// Build a map of font_name → is_bold from a page's resource dictionary.
fn build_page_font_map(
    doc: &lopdf::Document,
    page_id: lopdf::ObjectId,
) -> std::collections::HashMap<String, bool> {
    let mut font_map = std::collections::HashMap::new();
    let Ok(page) = doc.get_object(page_id) else {
        return font_map;
    };
    let Ok(page_dict) = page.as_dict() else {
        return font_map;
    };
    let Ok(resources) = page_dict.get(b"Resources") else {
        return font_map;
    };
    let Ok(resources_dict) = resources.as_dict() else {
        return font_map;
    };
    let Ok(fonts) = resources_dict.get(b"Font") else {
        return font_map;
    };
    let Ok(font_dict) = fonts.as_dict() else {
        return font_map;
    };

    for (name, font_ref) in font_dict.iter() {
        let name_str = String::from_utf8_lossy(name).to_string();
        // Font dict values can be direct dicts or references — resolve either way
        let font_obj_result = match font_ref {
            lopdf::Object::Reference(id) => doc.get_object(*id),
            other => Ok(other),
        };
        if let Ok(font_obj) = font_obj_result {
            if let Ok(font) = font_obj.as_dict() {
                let is_bold = font
                    .get(b"BaseFont")
                    .and_then(|bf| bf.as_name())
                    .map(|n| {
                        let lower = String::from_utf8_lossy(n).to_lowercase();
                        lower.contains("bold")
                    })
                    .unwrap_or(false);
                font_map.insert(name_str, is_bold);
            }
        }
    }
    font_map
}

/// Extract text elements with position metadata from a page's content stream.
fn extract_page_text_elements(
    operations: &[lopdf::content::Operation],
    font_map: &std::collections::HashMap<String, bool>,
    page_num: u32,
    page_height: f64,
) -> Vec<PdfTextElement> {
    let mut elements = Vec::new();
    // Current text matrix [a, b, c, d, e, f]
    let mut tm = [1.0f64, 0.0, 0.0, 1.0, 0.0, 0.0];
    let mut font_size = 12.0f64;
    let mut is_bold = false;
    let mut buf = String::new();
    let mut line_x = 0.0f64;
    let mut line_y = 0.0f64;

    let flush = |buf: &mut String,
                 elements: &mut Vec<PdfTextElement>,
                 line_x: f64,
                 line_y: f64,
                 font_size: f64,
                 is_bold: bool,
                 page_num: u32,
                 page_height: f64| {
        if !buf.is_empty() {
            let text = fix_winansi_twi(buf.clone());
            let char_count = text.chars().count() as f64;
            elements.push(PdfTextElement {
                text,
                x: line_x,
                y: page_height - line_y, // flip to top-down coordinates
                width: char_count * font_size * 0.6,
                height: font_size * 1.2,
                font_size,
                is_bold,
                page: page_num,
            });
            buf.clear();
        }
    };

    for op in operations {
        match op.operator.as_str() {
            "BT" => {
                // Begin text — flush any pending text
                flush(
                    &mut buf,
                    &mut elements,
                    line_x,
                    line_y,
                    font_size,
                    is_bold,
                    page_num,
                    page_height,
                );
                tm = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0];
                line_x = 0.0;
                line_y = 0.0;
            }
            "ET" => {
                flush(
                    &mut buf,
                    &mut elements,
                    line_x,
                    line_y,
                    font_size,
                    is_bold,
                    page_num,
                    page_height,
                );
            }
            "Tf" => {
                // Set font: [name, size]
                if let Some(lopdf::Object::Name(name)) = op.operands.first() {
                    let name_str = String::from_utf8_lossy(name).to_string();
                    if let Some(&bold) = font_map.get(&name_str) {
                        is_bold = bold;
                    }
                }
                if let Some(size_obj) = op.operands.get(1) {
                    font_size = match size_obj {
                        lopdf::Object::Integer(i) => *i as f64,
                        lopdf::Object::Real(r) => *r as f64,
                        _ => font_size,
                    };
                }
            }
            "Tm" => {
                // Set text matrix: [a, b, c, d, e, f]
                if op.operands.len() >= 6 {
                    for i in 0..6 {
                        if let Some(obj) = op.operands.get(i) {
                            tm[i] = match obj {
                                lopdf::Object::Integer(v) => *v as f64,
                                lopdf::Object::Real(v) => *v as f64,
                                _ => tm[i],
                            };
                        }
                    }
                    flush(
                        &mut buf,
                        &mut elements,
                        line_x,
                        line_y,
                        font_size,
                        is_bold,
                        page_num,
                        page_height,
                    );
                    line_x = tm[4];
                    line_y = tm[5];
                }
            }
            "Td" | "TD" => {
                // Relative text move: [tx, ty]
                if op.operands.len() >= 2 {
                    let tx = match &op.operands[0] {
                        lopdf::Object::Integer(v) => *v as f64,
                        lopdf::Object::Real(v) => *v as f64,
                        _ => 0.0,
                    };
                    let ty = match &op.operands[1] {
                        lopdf::Object::Integer(v) => *v as f64,
                        lopdf::Object::Real(v) => *v as f64,
                        _ => 0.0,
                    };
                    // For non-rotated text (b=c=0, a=d=1), Td adds directly
                    line_x += tx * tm[0] + ty * tm[2];
                    line_y += tx * tm[1] + ty * tm[3];
                    flush(
                        &mut buf,
                        &mut elements,
                        line_x,
                        line_y,
                        font_size,
                        is_bold,
                        page_num,
                        page_height,
                    );
                }
            }
            "Tj" => {
                // Show text string
                if let Some(text_obj) = op.operands.first() {
                    if let Some(text) = decode_pdf_string(text_obj) {
                        if buf.is_empty() {
                            line_x = tm[4];
                            line_y = tm[5];
                        }
                        buf.push_str(&text);
                    }
                }
            }
            "TJ" => {
                // Show text with individual glyph positioning: array of strings and numbers
                if let Some(lopdf::Object::Array(items)) = op.operands.first() {
                    for item in items {
                        match item {
                            lopdf::Object::String(..) => {
                                if let Some(text) = decode_pdf_string(item) {
                                    if buf.is_empty() {
                                        line_x = tm[4];
                                        line_y = tm[5];
                                    }
                                    buf.push_str(&text);
                                }
                            }
                            lopdf::Object::Integer(offset) => {
                                // Large negative offset → kerning gap, flush segment
                                if *offset < -100 && !buf.is_empty() {
                                    flush(
                                        &mut buf,
                                        &mut elements,
                                        line_x,
                                        line_y,
                                        font_size,
                                        is_bold,
                                        page_num,
                                        page_height,
                                    );
                                }
                            }
                            lopdf::Object::Real(offset) => {
                                if (*offset as f64) < -100.0 && !buf.is_empty() {
                                    flush(
                                        &mut buf,
                                        &mut elements,
                                        line_x,
                                        line_y,
                                        font_size,
                                        is_bold,
                                        page_num,
                                        page_height,
                                    );
                                }
                            }
                            _ => {}
                        }
                    }
                }
            }
            "T*" => {
                // Move to next line (vertical tab) — default leading = font_size
                if !buf.is_empty() {
                    flush(
                        &mut buf,
                        &mut elements,
                        line_x,
                        line_y,
                        font_size,
                        is_bold,
                        page_num,
                        page_height,
                    );
                }
                line_y -= font_size;
            }
            _ => {}
        }
    }

    // Flush any remaining text
    flush(
        &mut buf,
        &mut elements,
        line_x,
        line_y,
        font_size,
        is_bold,
        page_num,
        page_height,
    );
    elements
}

/// Extract text elements with full position and font metadata from a PDF.
///
/// Returns a JSON-serializable array of `{ text, x, y, width, height, fontSize, isBold, page }`.
/// Coordinates use top-down y (y=0 at top of page). Font sizes are in PDF points (1/72 inch).
#[tauri::command]
fn extract_text_elements_from_pdf(file_data: Vec<u8>) -> Result<Vec<PdfTextElement>, String> {
    let doc = lopdf::Document::load_mem(&file_data)
        .map_err(|e| format!("Failed to parse PDF with lopdf: {}", e))?;

    let pages = doc.get_pages();
    let mut all_elements = Vec::new();

    for (&page_num, &page_id) in pages.iter() {
        // Get page height from MediaBox
        let page_height = {
            let mut h = 792.0; // default letter size
            if let Ok(page) = doc.get_object(page_id) {
                if let Ok(dict) = page.as_dict() {
                    if let Ok(mb) = dict.get(b"MediaBox") {
                        if let Ok(arr) = mb.as_array() {
                            if arr.len() >= 4 {
                                h = match &arr[3] {
                                    lopdf::Object::Integer(v) => *v as f64,
                                    lopdf::Object::Real(v) => *v as f64,
                                    _ => h,
                                };
                            }
                        }
                    }
                }
            }
            h
        };

        let font_map = build_page_font_map(&doc, page_id);

        // Decode content stream using our custom parser
        let raw_content = match doc.get_page_content(page_id) {
            Ok(bytes) => bytes,
            Err(_) => continue,
        };
        let operations = parse_content_stream(&raw_content);

        let elements = extract_page_text_elements(&operations, &font_map, page_num, page_height);
        all_elements.extend(elements);
    }

    Ok(all_elements)
}

fn bind_overlay_tcp_listener(port: u16) -> std::io::Result<std::net::TcpListener> {
    use socket2::{Domain, Protocol, Socket, Type};
    let socket = Socket::new(Domain::IPV4, Type::STREAM, Some(Protocol::TCP))?;
    let _ = socket.set_reuse_address(true);
    #[cfg(all(unix, not(any(target_os = "solaris", target_os = "illumos"))))]
    {
        let _ = socket.set_reuse_port(true);
    }
    let addr: std::net::SocketAddr = format!("0.0.0.0:{}", port)
        .parse()
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidInput, e))?;
    socket.bind(&addr.into())?;
    socket.listen(128)?;
    Ok(socket.into())
}

fn kill_process_on_port(port: u16) {
    let current_pid = std::process::id();
    #[cfg(unix)]
    {
        if let Ok(output) = std::process::Command::new("lsof")
            .args(["-ti", &format!(":{}", port)])
            .output()
        {
            let pids_str = String::from_utf8_lossy(&output.stdout);
            for line in pids_str.lines() {
                if let Ok(pid) = line.trim().parse::<u32>() {
                    if pid != current_pid && pid > 0 {
                        eprintln!(
                            "[Overlay Server] Killing stale process {} holding port {}",
                            pid, port
                        );
                        let _ = std::process::Command::new("kill")
                            .args(["-9", &pid.to_string()])
                            .output();
                    }
                }
            }
        }
    }
    #[cfg(windows)]
    {
        let cmd = format!("Get-NetTCPConnection -LocalPort {} -ErrorAction SilentlyContinue | Where-Object {{ $_.OwningProcess -ne {} }} | ForEach-Object {{ Stop-Process -Id $_.OwningProcess -Force }}", port, current_pid);
        let _ = hide_console(&mut std::process::Command::new("powershell"))
            .args(["-NoProfile", "-Command", &cmd])
            .output();
    }
}

fn is_overlay_server_already_running(port: u16) -> bool {
    let addr_str = format!("127.0.0.1:{}", port);
    let Ok(addr) = addr_str.parse::<std::net::SocketAddr>() else {
        return false;
    };
    if let Ok(mut stream) =
        std::net::TcpStream::connect_timeout(&addr, std::time::Duration::from_millis(400))
    {
        let _ = stream.set_read_timeout(Some(std::time::Duration::from_millis(400)));
        let _ = stream.set_write_timeout(Some(std::time::Duration::from_millis(400)));
        let req = format!(
            "GET /health HTTP/1.1\r\nHost: {}\r\nConnection: close\r\n\r\n",
            addr_str
        );
        if std::io::Write::write_all(&mut stream, req.as_bytes()).is_ok() {
            let mut response = Vec::new();
            let _ = std::io::Read::read_to_end(&mut stream, &mut response);
            let resp = String::from_utf8_lossy(&response);
            return resp.contains("MakeChurchEazy") || resp.contains("MakeChurchEasy") || resp.contains("200 OK");
        }
    }
    false
}

/// Start a tiny HTTP server that serves files from the frontend dist folder.
/// Port 45678 is strictly canonical so OBS custom browser docks, browser sources,
/// and mobile apps never have their connection URLs change.
/// Returns 45678.
fn start_overlay_server(resource_dir: std::path::PathBuf) -> u16 {
    const CANONICAL_OVERLAY_PORT: u16 = 45678;

    // Resolve the uploads directory for serving user-uploaded files
    let uploads_dir = app_dir().ok().map(|d| d.join("uploads"));

    // In dev mode, resource_dir points to <project>/public/ but Vite multi-page
    // entry points (dock.html) live in the project root. Resolve the project
    // root so we can use it as a fallback when a file isn't found in resource_dir.
    let project_root_dir: Option<std::path::PathBuf> = {
        // resource_dir is <project>/public in dev — parent is the project root
        let parent = resource_dir.parent().map(|p| p.to_path_buf());
        // Only use this fallback if the parent contains dock.html (i.e. we're in dev)
        parent.filter(|p| p.join("dock.html").is_file())
    };

    // Attempt to bind port 45678 with SO_REUSEADDR and SO_REUSEPORT.
    // Retry briefly to allow any socket from a recent restart to clear TIME_WAIT.
    let mut bound_listener = None;
    for attempt in 0..5 {
        match bind_overlay_tcp_listener(CANONICAL_OVERLAY_PORT) {
            Ok(listener) => {
                bound_listener = Some(listener);
                break;
            }
            Err(e) => {
                if attempt == 0 {
                    // Reclaim port from any stale/zombie instance before retrying
                    kill_process_on_port(CANONICAL_OVERLAY_PORT);
                }
                if attempt < 4 {
                    std::thread::sleep(std::time::Duration::from_millis(150));
                } else {
                    eprintln!(
                        "[Overlay Server] Port {} bind failed after {} retries: {}",
                        CANONICAL_OVERLAY_PORT,
                        attempt + 1,
                        e
                    );
                }
            }
        }
    }

    let server = match bound_listener {
        Some(listener) => match tiny_http::Server::from_listener(listener, None) {
            Ok(s) => s,
            Err(e) => {
                eprintln!(
                    "[Overlay Server] Failed to initialize tiny_http from listener: {}",
                    e
                );
                OVERLAY_PORT.store(CANONICAL_OVERLAY_PORT, Ordering::Relaxed);
                return CANONICAL_OVERLAY_PORT;
            }
        },
        None => {
            // Port 45678 could not be bound directly.
            // Check if another MakeChurchEazy instance is already running and serving port 45678.
            if is_overlay_server_already_running(CANONICAL_OVERLAY_PORT) {
                println!(
                    "[Overlay Server] Port {} is already active and serving MakeChurchEazy. Keeping canonical URLs http://127.0.0.1:{}",
                    CANONICAL_OVERLAY_PORT, CANONICAL_OVERLAY_PORT
                );
            } else {
                eprintln!(
                    "[Overlay Server] Port {} unavailable, keeping canonical port {} so OBS connection URLs remain fixed.",
                    CANONICAL_OVERLAY_PORT, CANONICAL_OVERLAY_PORT
                );
            }
            OVERLAY_PORT.store(CANONICAL_OVERLAY_PORT, Ordering::Relaxed);
            return CANONICAL_OVERLAY_PORT;
        }
    };

    OVERLAY_PORT.store(CANONICAL_OVERLAY_PORT, Ordering::Relaxed);
    println!(
        "[Overlay Server] Serving files from {:?} on http://127.0.0.1:{}",
        resource_dir, CANONICAL_OVERLAY_PORT
    );

    let local_send_sessions: Arc<Mutex<HashMap<String, LocalSendUploadSession>>> =
        Arc::new(Mutex::new(HashMap::new()));

    std::thread::spawn(move || {
        for mut request in server.incoming_requests() {
            let url_path = request.url().to_string();
            // Strip query string and leading slash
            let clean = url_path.split('?').next().unwrap_or(&url_path);
            let clean = clean.trim_start_matches('/');

            // Friendly default route: allow opening the base URL directly
            // (http://<lan-ip>:<port>/) from another laptop to verify reachability.
            if clean.is_empty() || clean == "health" {
                let body = if clean == "health" {
                    r#"{"ok":true,"service":"MakeChurchEazy overlay server"}"#.to_string()
                } else {
                    format!(
                        r#"<!doctype html>
<html><head><meta charset="utf-8"><title>MakeChurchEazy Overlay Server</title>
<style>body{{margin:0;min-height:100vh;display:grid;place-items:center;background:#0F172A;color:#F8FAFC;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}}main{{max-width:680px;padding:32px;border:1px solid #334155;border-radius:16px;background:#111827}}h1{{margin:0 0 12px;font-size:28px}}p{{margin:0 0 12px;color:#CBD5E1;line-height:1.6}}code{{display:block;margin-top:8px;padding:10px 12px;border-radius:10px;background:#1F2937;color:#93C5FD}}</style>
</head><body><main>
<h1>MakeChurchEazy overlay server is running</h1>
<p>This address is reachable. OBS browser sources should load specific overlay files from this server.</p>
<p>Test Bible overlay:</p>
<code>http://&lt;this-ip&gt;:{}/mce-bible-overlay.html</code>
<p>Health check:</p>
<code>http://&lt;this-ip&gt;:{}/health</code>
</main></body></html>"#,
                        CANONICAL_OVERLAY_PORT, CANONICAL_OVERLAY_PORT
                    )
                };
                let content_type = if clean == "health" {
                    "application/json; charset=utf-8"
                } else {
                    "text/html; charset=utf-8"
                };
                let header = tiny_http::Header::from_bytes("Content-Type", content_type).unwrap();
                let cors =
                    tiny_http::Header::from_bytes("Access-Control-Allow-Origin", "*").unwrap();
                let resp = tiny_http::Response::from_string(body)
                    .with_header(header)
                    .with_header(cors);
                let _ = request.respond(resp);
                continue;
            }

            // Security: don't allow path traversal
            if clean.contains("..") {
                let resp = tiny_http::Response::from_string("Forbidden").with_status_code(403);
                let _ = request.respond(resp);
                continue;
            }

            // LocalSend-style discovery endpoint. It intentionally exposes
            // only this app's LAN transfer identity; uploads still require
            // the per-device transfer token returned here.
            if clean == "api/localsend/v2/info" && request.method() == &tiny_http::Method::Get {
                let info = local_share_device_info(None);
                let response = match info {
                    Ok(info) => tiny_http::Response::from_string(
                        serde_json::to_string(&info).unwrap_or_else(|_| {
                            r#"{"error":"Could not serialize device info"}"#.to_string()
                        }),
                    )
                    .with_header(overlay_header(
                        "Content-Type",
                        "application/json; charset=utf-8",
                    ))
                    .with_header(overlay_header("Access-Control-Allow-Origin", "*")),
                    Err(error) => tiny_http::Response::from_string(
                        serde_json::json!({ "error": error }).to_string(),
                    )
                    .with_status_code(500)
                    .with_header(overlay_header(
                        "Content-Type",
                        "application/json; charset=utf-8",
                    ))
                    .with_header(overlay_header("Access-Control-Allow-Origin", "*")),
                };
                let _ = request.respond(response);
                continue;
            }

            // Accept the standard LocalSend registration shape as a friendly
            // compatibility path for clients that probe this desktop.
            if clean == "api/localsend/v2/register" && request.method() == &tiny_http::Method::Post
            {
                let mut ignored_body = String::new();
                let _ = request.as_reader().read_to_string(&mut ignored_body);
                let response = match local_share_device_info(None) {
                    Ok(info) => tiny_http::Response::from_string(
                        serde_json::to_string(&info).unwrap_or_else(|_| {
                            r#"{"error":"Could not serialize device info"}"#.to_string()
                        }),
                    )
                    .with_header(overlay_header(
                        "Content-Type",
                        "application/json; charset=utf-8",
                    ))
                    .with_header(overlay_header("Access-Control-Allow-Origin", "*")),
                    Err(error) => tiny_http::Response::from_string(
                        serde_json::json!({ "error": error }).to_string(),
                    )
                    .with_status_code(500)
                    .with_header(overlay_header(
                        "Content-Type",
                        "application/json; charset=utf-8",
                    ))
                    .with_header(overlay_header("Access-Control-Allow-Origin", "*")),
                };
                let _ = request.respond(response);
                continue;
            }

            // Receiver inbox metadata for the desktop Media page. Files remain
            // in the inbox until the operator chooses Save to folder or Save
            // to MCE through the native desktop surface.
            if clean == "api/receiver/pending" && request.method() == &tiny_http::Method::Get {
                let records = read_received_file_records().unwrap_or_default();
                let response = serde_json::json!({ "files": records });
                let resp = tiny_http::Response::from_string(response.to_string())
                    .with_header(overlay_header(
                        "Content-Type",
                        "application/json; charset=utf-8",
                    ))
                    .with_header(overlay_header("Access-Control-Allow-Origin", "*"));
                let _ = request.respond(resp);
                continue;
            }

            if clean == "api/receiver/download" && request.method() == &tiny_http::Method::Get {
                let pending_id = local_send_query_value(&url_path, "pendingId").unwrap_or_default();
                let record = match find_received_file(&pending_id) {
                    Ok(record) => record,
                    Err(error) => {
                        let resp = tiny_http::Response::from_string(
                            serde_json::json!({ "error": error }).to_string(),
                        )
                        .with_status_code(404)
                        .with_header(overlay_header(
                            "Content-Type",
                            "application/json; charset=utf-8",
                        ))
                        .with_header(overlay_header("Access-Control-Allow-Origin", "*"));
                        let _ = request.respond(resp);
                        continue;
                    }
                };
                let source_path = match received_file_source_path(&record) {
                    Ok(path) => path,
                    Err(error) => {
                        let resp = tiny_http::Response::from_string(
                            serde_json::json!({ "error": error }).to_string(),
                        )
                        .with_status_code(404)
                        .with_header(overlay_header("Access-Control-Allow-Origin", "*"));
                        let _ = request.respond(resp);
                        continue;
                    }
                };
                let file = match File::open(source_path) {
                    Ok(file) => file,
                    Err(error) => {
                        let resp = tiny_http::Response::from_string(
                            serde_json::json!({ "error": format!("Could not open received file: {error}") }).to_string(),
                        )
                        .with_status_code(404)
                        .with_header(overlay_header("Access-Control-Allow-Origin", "*"));
                        let _ = request.respond(resp);
                        continue;
                    }
                };
                let content_type = overlay_header(
                    "Content-Type",
                    if record.file_type.trim().is_empty() {
                        "application/octet-stream"
                    } else {
                        record.file_type.as_str()
                    },
                );
                let cors = overlay_header("Access-Control-Allow-Origin", "*");
                let _ = request.respond(
                    tiny_http::Response::from_file(file)
                        .with_header(content_type)
                        .with_header(cors),
                );
                continue;
            }

            if clean == "api/receiver/save-to-mce" && request.method() == &tiny_http::Method::Post {
                let pending_id = local_send_query_value(&url_path, "pendingId").unwrap_or_default();
                let response = match save_received_file_to_mce_internal(&pending_id) {
                    Ok(result) => tiny_http::Response::from_string(
                        serde_json::to_string(&result).unwrap_or_else(|_| {
                            r#"{"error":"Could not serialize result"}"#.to_string()
                        }),
                    )
                    .with_header(overlay_header(
                        "Content-Type",
                        "application/json; charset=utf-8",
                    ))
                    .with_header(overlay_header("Access-Control-Allow-Origin", "*")),
                    Err(error) => tiny_http::Response::from_string(
                        serde_json::json!({ "error": error }).to_string(),
                    )
                    .with_status_code(400)
                    .with_header(overlay_header(
                        "Content-Type",
                        "application/json; charset=utf-8",
                    ))
                    .with_header(overlay_header("Access-Control-Allow-Origin", "*")),
                };
                let _ = request.respond(response);
                continue;
            }

            if clean == "api/receiver/complete" && request.method() == &tiny_http::Method::Post {
                let pending_id = local_send_query_value(&url_path, "pendingId").unwrap_or_default();
                let response = match find_received_file(&pending_id)
                    .and_then(|record| remove_received_file(&record))
                {
                    Ok(()) => tiny_http::Response::from_string(r#"{"ok":true}"#),
                    Err(error) => tiny_http::Response::from_string(
                        serde_json::json!({ "error": error }).to_string(),
                    )
                    .with_status_code(400),
                }
                .with_header(overlay_header(
                    "Content-Type",
                    "application/json; charset=utf-8",
                ))
                .with_header(overlay_header("Access-Control-Allow-Origin", "*"));
                let _ = request.respond(response);
                continue;
            }

            // LocalSend-inspired mobile transfer API.
            // The mobile app is already paired with the desktop, so the existing
            // pairing token acts as the transfer PIN. Metadata is negotiated first,
            // then the file body is streamed directly to disk without base64 or
            // cloud storage.
            if clean == "api/localsend/v2/prepare-upload" {
                let cors = || overlay_header("Access-Control-Allow-Origin", "*");
                if request.method() == &tiny_http::Method::Options {
                    let resp = tiny_http::Response::from_string("")
                        .with_header(cors())
                        .with_header(overlay_header(
                            "Access-Control-Allow-Methods",
                            "POST, OPTIONS",
                        ))
                        .with_header(overlay_header(
                            "Access-Control-Allow-Headers",
                            "Content-Type, X-Device-Token",
                        ));
                    let _ = request.respond(resp);
                    continue;
                }

                if request.method() != &tiny_http::Method::Post {
                    let resp = tiny_http::Response::from_string("Method not allowed")
                        .with_status_code(405)
                        .with_header(cors());
                    let _ = request.respond(resp);
                    continue;
                }

                if !local_send_pairing_token_matches(&request) {
                    let resp =
                        tiny_http::Response::from_string(r#"{"error":"Invalid device token"}"#)
                            .with_status_code(403)
                            .with_header(cors());
                    let _ = request.respond(resp);
                    continue;
                }

                let mut body = String::new();
                if request.as_reader().read_to_string(&mut body).is_err() || body.trim().is_empty()
                {
                    let resp = tiny_http::Response::from_string(
                        r#"{"error":"Upload metadata is required"}"#,
                    )
                    .with_status_code(400)
                    .with_header(cors());
                    let _ = request.respond(resp);
                    continue;
                }

                let payload = match serde_json::from_str::<serde_json::Value>(&body) {
                    Ok(value) => value,
                    Err(_) => {
                        let resp = tiny_http::Response::from_string(
                            r#"{"error":"Invalid upload metadata"}"#,
                        )
                        .with_status_code(400)
                        .with_header(cors());
                        let _ = request.respond(resp);
                        continue;
                    }
                };
                let destination = payload
                    .get("destination")
                    .and_then(|value| value.as_str())
                    .unwrap_or("laptop")
                    .trim()
                    .to_lowercase();
                if destination != "receiver" && destination != "laptop" && destination != "mce" {
                    let resp = tiny_http::Response::from_string(
                        r#"{"error":"destination must be receiver, laptop, or mce"}"#,
                    )
                    .with_status_code(400)
                    .with_header(cors());
                    let _ = request.respond(resp);
                    continue;
                }

                let files = match payload.get("files").and_then(|value| value.as_object()) {
                    Some(files) if !files.is_empty() => files,
                    _ => {
                        let resp = tiny_http::Response::from_string(
                            r#"{"error":"At least one file is required"}"#,
                        )
                        .with_status_code(400)
                        .with_header(cors());
                        let _ = request.respond(resp);
                        continue;
                    }
                };

                let session_id = uuid::Uuid::new_v4().simple().to_string();
                let mut session_files = HashMap::new();
                let mut response_files = serde_json::Map::new();
                let mut rejected = None;

                for (fallback_id, metadata) in files {
                    let file_id = metadata
                        .get("id")
                        .and_then(|value| value.as_str())
                        .unwrap_or(fallback_id)
                        .trim()
                        .to_string();
                    let file_name = metadata
                        .get("fileName")
                        .and_then(|value| value.as_str())
                        .unwrap_or("")
                        .trim()
                        .to_string();
                    let size = metadata
                        .get("size")
                        .and_then(|value| value.as_u64())
                        .unwrap_or(0);

                    if file_id.is_empty() || file_name.is_empty() {
                        rejected = Some("Every file needs an id and fileName".to_string());
                        break;
                    }
                    if size > LOCAL_SEND_MAX_FILE_BYTES {
                        rejected = Some(format!(
                            "{} is larger than the 4 GB transfer limit",
                            file_name
                        ));
                        break;
                    }

                    let token = uuid::Uuid::new_v4().simple().to_string();
                    let file_type = metadata
                        .get("fileType")
                        .and_then(|value| value.as_str())
                        .unwrap_or("application/octet-stream")
                        .to_string();
                    if destination == "mce"
                        && !local_send_mce_file_supported(&file_name, &file_type)
                    {
                        rejected = Some(format!(
                            "{} is not an MCE library file. Use Save to laptop for this type.",
                            file_name
                        ));
                        break;
                    }
                    let sha256 = metadata
                        .get("sha256")
                        .and_then(|value| value.as_str())
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .map(str::to_string);

                    session_files.insert(
                        file_id.clone(),
                        LocalSendUploadFile {
                            file_name,
                            file_type,
                            size,
                            sha256,
                            token: token.clone(),
                            destination: destination.clone(),
                        },
                    );
                    response_files.insert(file_id, serde_json::Value::String(token));
                }

                if let Some(error) = rejected {
                    let resp = tiny_http::Response::from_string(
                        serde_json::json!({ "error": error }).to_string(),
                    )
                    .with_status_code(400)
                    .with_header(cors());
                    let _ = request.respond(resp);
                    continue;
                }

                if let Ok(mut sessions) = local_send_sessions.lock() {
                    sessions.retain(|_, session| {
                        session.created_at.elapsed() < Duration::from_secs(3600)
                    });
                    sessions.insert(
                        session_id.clone(),
                        LocalSendUploadSession {
                            created_at: Instant::now(),
                            files: session_files,
                        },
                    );
                }

                let response = serde_json::json!({
                    "sessionId": session_id,
                    "files": response_files,
                    "destination": destination,
                });
                let resp = tiny_http::Response::from_string(response.to_string())
                    .with_header(overlay_header(
                        "Content-Type",
                        "application/json; charset=utf-8",
                    ))
                    .with_header(cors());
                let _ = request.respond(resp);
                continue;
            }

            if clean == "api/localsend/v2/upload" {
                let cors = || overlay_header("Access-Control-Allow-Origin", "*");
                if request.method() == &tiny_http::Method::Options {
                    let resp = tiny_http::Response::from_string("")
                        .with_header(cors())
                        .with_header(overlay_header(
                            "Access-Control-Allow-Methods",
                            "POST, OPTIONS",
                        ))
                        .with_header(overlay_header(
                            "Access-Control-Allow-Headers",
                            "Content-Type, X-Device-Token",
                        ));
                    let _ = request.respond(resp);
                    continue;
                }

                if request.method() != &tiny_http::Method::Post
                    || !local_send_pairing_token_matches(&request)
                {
                    let resp =
                        tiny_http::Response::from_string(r#"{"error":"Invalid upload request"}"#)
                            .with_status_code(403)
                            .with_header(cors());
                    let _ = request.respond(resp);
                    continue;
                }

                let session_id = local_send_query_value(&url_path, "sessionId").unwrap_or_default();
                let file_id = local_send_query_value(&url_path, "fileId").unwrap_or_default();
                let transfer_token = local_send_query_value(&url_path, "token").unwrap_or_default();
                let file = local_send_sessions.lock().ok().and_then(|sessions| {
                    sessions
                        .get(&session_id)
                        .and_then(|session| session.files.get(&file_id))
                        .cloned()
                });

                let Some(file) = file else {
                    let resp =
                        tiny_http::Response::from_string(r#"{"error":"Upload session not found"}"#)
                            .with_status_code(403)
                            .with_header(cors());
                    let _ = request.respond(resp);
                    continue;
                };
                if transfer_token != file.token {
                    let resp =
                        tiny_http::Response::from_string(r#"{"error":"Invalid file token"}"#)
                            .with_status_code(403)
                            .with_header(cors());
                    let _ = request.respond(resp);
                    continue;
                }

                let (destination_path, stored_name, pending_id) =
                    match local_send_storage_path(&file.destination, &file.file_name) {
                        Ok(path) => path,
                        Err(error) => {
                            let resp = tiny_http::Response::from_string(
                                serde_json::json!({ "error": error }).to_string(),
                            )
                            .with_status_code(500)
                            .with_header(cors());
                            let _ = request.respond(resp);
                            continue;
                        }
                    };
                let mut output = match File::create(&destination_path) {
                    Ok(file) => file,
                    Err(error) => {
                        let resp = tiny_http::Response::from_string(
                            serde_json::json!({ "error": format!("Could not create destination file: {error}") }).to_string(),
                        )
                        .with_status_code(500)
                        .with_header(cors());
                        let _ = request.respond(resp);
                        continue;
                    }
                };

                let mut hasher = Sha256::new();
                let mut total = 0_u64;
                let mut too_large = false;
                let stream_result: Result<(), String> =
                    (|| {
                        let mut buffer = [0_u8; 64 * 1024];
                        loop {
                            let count = request.as_reader().read(&mut buffer).map_err(|error| {
                                format!("Could not read uploaded file: {error}")
                            })?;
                            if count == 0 {
                                break;
                            }
                            total += count as u64;
                            if total > LOCAL_SEND_MAX_FILE_BYTES {
                                too_large = true;
                                return Err("Uploaded file is larger than the 4 GB transfer limit"
                                    .to_string());
                            }
                            output.write_all(&buffer[..count]).map_err(|error| {
                                format!("Could not save uploaded file: {error}")
                            })?;
                            hasher.update(&buffer[..count]);
                        }
                        Ok(())
                    })();

                if let Err(error) = stream_result {
                    let _ = fs::remove_file(&destination_path);
                    let status = if too_large { 413 } else { 500 };
                    let resp = tiny_http::Response::from_string(
                        serde_json::json!({ "error": error }).to_string(),
                    )
                    .with_status_code(status)
                    .with_header(cors());
                    let _ = request.respond(resp);
                    continue;
                }

                let checksum = format!("{:x}", hasher.finalize());
                if total != file.size
                    || file
                        .sha256
                        .as_deref()
                        .is_some_and(|expected| expected != checksum)
                {
                    let _ = fs::remove_file(&destination_path);
                    let resp = tiny_http::Response::from_string(
                        r#"{"error":"Uploaded file failed size or checksum validation"}"#,
                    )
                    .with_status_code(422)
                    .with_header(cors());
                    let _ = request.respond(resp);
                    continue;
                }

                if file.destination == "receiver" {
                    let Some(pending_id) = pending_id.clone() else {
                        let _ = fs::remove_file(&destination_path);
                        let resp = tiny_http::Response::from_string(
                            r#"{"error":"Could not create received file id"}"#,
                        )
                        .with_status_code(500)
                        .with_header(cors());
                        let _ = request.respond(resp);
                        continue;
                    };
                    let record = ReceivedFileRecord {
                        pending_id,
                        file_name: file.file_name.clone(),
                        stored_file_name: stored_name.clone(),
                        file_size: total,
                        file_type: file.file_type.clone(),
                        sha256: checksum.clone(),
                        received_at: Utc::now().to_rfc3339(),
                    };
                    let record_path = match received_file_record_path(&record.pending_id) {
                        Ok(path) => path,
                        Err(error) => {
                            let _ = fs::remove_file(&destination_path);
                            let resp = tiny_http::Response::from_string(
                                serde_json::json!({ "error": error }).to_string(),
                            )
                            .with_status_code(500)
                            .with_header(cors());
                            let _ = request.respond(resp);
                            continue;
                        }
                    };
                    let record_json = match serde_json::to_vec_pretty(&record) {
                        Ok(json) => json,
                        Err(error) => {
                            let _ = fs::remove_file(&destination_path);
                            let resp = tiny_http::Response::from_string(
                                serde_json::json!({ "error": format!("Could not prepare received file record: {error}") }).to_string(),
                            )
                            .with_status_code(500)
                            .with_header(cors());
                            let _ = request.respond(resp);
                            continue;
                        }
                    };
                    if let Err(error) = fs::write(&record_path, record_json) {
                        let _ = fs::remove_file(&destination_path);
                        let resp = tiny_http::Response::from_string(
                            serde_json::json!({ "error": format!("Could not save received file record: {error}") }).to_string(),
                        )
                        .with_status_code(500)
                        .with_header(cors());
                        let _ = request.respond(resp);
                        continue;
                    }
                }

                if let Ok(mut sessions) = local_send_sessions.lock() {
                    if let Some(session) = sessions.get_mut(&session_id) {
                        session.files.remove(&file_id);
                        if session.files.is_empty() {
                            sessions.remove(&session_id);
                        }
                    }
                }

                let display_path = if file.destination == "receiver" {
                    "MakeChurchEazy Receiver".to_string()
                } else if file.destination == "mce" {
                    "MakeChurchEazy media library".to_string()
                } else {
                    format!("Downloads/MakeChurchEasy/Received/{stored_name}")
                };
                let response = serde_json::json!({
                    "fileName": file.file_name,
                    "storedFileName": stored_name,
                    "fileSize": total,
                    "fileType": file.file_type,
                    "destination": file.destination,
                    "displayPath": display_path,
                    "pendingId": pending_id,
                    "sha256": checksum,
                });
                let resp = tiny_http::Response::from_string(response.to_string())
                    .with_header(overlay_header(
                        "Content-Type",
                        "application/json; charset=utf-8",
                    ))
                    .with_header(cors());
                let _ = request.respond(resp);
                continue;
            }

            if clean == "api/localsend/v2/cancel" && request.method() == &tiny_http::Method::Post {
                if !local_send_pairing_token_matches(&request) {
                    let resp =
                        tiny_http::Response::from_string(r#"{"error":"Invalid device token"}"#)
                            .with_status_code(403)
                            .with_header(overlay_header("Access-Control-Allow-Origin", "*"));
                    let _ = request.respond(resp);
                    continue;
                }
                if let Some(session_id) = local_send_query_value(&url_path, "sessionId") {
                    if let Ok(mut sessions) = local_send_sessions.lock() {
                        sessions.remove(&session_id);
                    }
                }
                let resp = tiny_http::Response::from_string(r#"{"ok":true}"#)
                    .with_header(overlay_header(
                        "Content-Type",
                        "application/json; charset=utf-8",
                    ))
                    .with_header(overlay_header("Access-Control-Allow-Origin", "*"));
                let _ = request.respond(resp);
                continue;
            }

            // API: save a complete Dock session export to the user's Downloads folder.
            // The Dock can run inside OBS's embedded browser, where Blob downloads can
            // create a zero-byte file. Writing through the local server keeps the export
            // reliable in that environment.
            // Native "Save as" for pages outside the Tauri webview (the OBS Dock). The body is the raw
            // file; the user picks the folder and name, and we write it there.
            if clean == "api/save-file-dialog" && request.method() == &tiny_http::Method::Options {
                let resp = tiny_http::Response::from_string("")
                    .with_header(overlay_header("Access-Control-Allow-Origin", "*"))
                    .with_header(overlay_header("Access-Control-Allow-Methods", "POST, OPTIONS"))
                    .with_header(overlay_header("Access-Control-Allow-Headers", "Content-Type"));
                let _ = request.respond(resp);
                continue;
            }

            if clean == "api/save-file-dialog" && request.method() == &tiny_http::Method::Post {
                let requested_name = url_path
                    .find('?')
                    .and_then(|index| {
                        url_path[index + 1..]
                            .split('&')
                            .find(|part| part.starts_with("filename="))
                            .map(|part| part[9..].to_string())
                    })
                    .map(|value| urlencoding::decode(&value).unwrap_or_default().into_owned())
                    .unwrap_or_else(|| "makechurch-easy-session.zip".to_string());
                // The dialog blocks until the user answers, so it gets its own thread and the
                // overlay server keeps serving everything else meanwhile.
                std::thread::spawn(move || {
                    let reply = |status: u16, json: String, request: tiny_http::Request| {
                        let resp = tiny_http::Response::from_string(json)
                            .with_status_code(status)
                            .with_header(overlay_header("Content-Type", "application/json; charset=utf-8"))
                            .with_header(overlay_header("Access-Control-Allow-Origin", "*"));
                        let _ = request.respond(resp);
                    };
                    let mut request = request;
                    let mut body: Vec<u8> = Vec::new();
                    if std::io::Read::read_to_end(request.as_reader(), &mut body).is_err() || body.is_empty() {
                        reply(400, r#"{"error":"A file body is required"}"#.to_string(), request);
                        return;
                    }
                    let safe_name = match sanitize_filename_for_storage(&requested_name) {
                        Ok(name) => name,
                        Err(error) => {
                            reply(400, serde_json::json!({ "error": error }).to_string(), request);
                            return;
                        }
                    };
                    let Some(app) = SAVE_DIALOG_APP.get() else {
                        reply(503, r#"{"error":"The app is not ready to show a save dialog"}"#.to_string(), request);
                        return;
                    };
                    use tauri_plugin_dialog::DialogExt;
                    let is_zip = safe_name.to_lowercase().ends_with(".zip");
                    let mut dialog = app.dialog().file().set_file_name(&safe_name);
                    if let Some(downloads) = dirs::download_dir() {
                        dialog = dialog.set_directory(downloads);
                    }
                    dialog = if is_zip {
                        dialog.add_filter("Session bundle", &["zip"])
                    } else {
                        dialog.add_filter("JSON files", &["json"])
                    };
                    let Some(picked) = dialog.blocking_save_file() else {
                        reply(200, r#"{"cancelled":true}"#.to_string(), request);
                        return;
                    };
                    let path = match picked.into_path() {
                        Ok(path) => path,
                        Err(error) => {
                            reply(500, serde_json::json!({ "error": format!("{}", error) }).to_string(), request);
                            return;
                        }
                    };
                    match fs::write(&path, &body) {
                        Ok(()) => reply(
                            200,
                            serde_json::json!({ "path": path.to_string_lossy(), "bytes": body.len() }).to_string(),
                            request,
                        ),
                        Err(error) => reply(
                            500,
                            serde_json::json!({ "error": format!("Could not save the file: {}", error) }).to_string(),
                            request,
                        ),
                    }
                });
                continue;
            }

            if clean == "api/save-dock-session" && request.method() == &tiny_http::Method::Options {
                let resp = tiny_http::Response::from_string("")
                    .with_header(overlay_header("Access-Control-Allow-Origin", "*"))
                    .with_header(overlay_header(
                        "Access-Control-Allow-Methods",
                        "POST, OPTIONS",
                    ))
                    .with_header(overlay_header(
                        "Access-Control-Allow-Headers",
                        "Content-Type",
                    ));
                let _ = request.respond(resp);
                continue;
            }

            if clean == "api/save-dock-session" && request.method() == &tiny_http::Method::Post {
                let mut body = String::new();
                if request.as_reader().read_to_string(&mut body).is_err() || body.trim().is_empty()
                {
                    let resp = tiny_http::Response::from_string(
                        r#"{"error":"A Dock session JSON body is required"}"#,
                    )
                    .with_status_code(400);
                    let _ = request.respond(resp);
                    continue;
                }

                let is_dock_session = serde_json::from_str::<serde_json::Value>(&body)
                    .ok()
                    .and_then(|value| {
                        value
                            .get("_format")
                            .and_then(|format| format.as_str())
                            .map(|format| format == "makechurch-easy-dock-session")
                    })
                    .unwrap_or(false);
                if !is_dock_session {
                    let resp = tiny_http::Response::from_string(
                        r#"{"error":"Invalid MakeChurchEazy Dock session"}"#,
                    )
                    .with_status_code(400);
                    let _ = request.respond(resp);
                    continue;
                }

                let requested_name = url_path
                    .find('?')
                    .and_then(|index| {
                        url_path[index + 1..]
                            .split('&')
                            .find(|part| part.starts_with("filename="))
                            .map(|part| &part[9..])
                    })
                    .map(|value| urlencoding::decode(value).unwrap_or_default().into_owned())
                    .unwrap_or_else(|| "makechurch-easy-dock-session.json".to_string());
                let safe_name = match sanitize_filename_for_storage(&requested_name) {
                    Ok(name) => name,
                    Err(error) => {
                        let json = serde_json::json!({ "error": error }).to_string();
                        let resp = tiny_http::Response::from_string(json).with_status_code(400);
                        let _ = request.respond(resp);
                        continue;
                    }
                };
                let downloads_dir = match dirs::download_dir()
                    .or_else(|| dirs::home_dir().map(|home| home.join("Downloads")))
                {
                    Some(path) => path,
                    None => {
                        let resp = tiny_http::Response::from_string(
                            r#"{"error":"Could not determine the Downloads folder"}"#,
                        )
                        .with_status_code(500);
                        let _ = request.respond(resp);
                        continue;
                    }
                };

                if let Err(error) = fs::create_dir_all(&downloads_dir) {
                    let json = serde_json::json!({
                        "error": format!("Could not create Downloads folder: {}", error)
                    })
                    .to_string();
                    let resp = tiny_http::Response::from_string(json).with_status_code(500);
                    let _ = request.respond(resp);
                    continue;
                }

                let destination = downloads_dir.join(safe_name);
                match fs::write(&destination, body.as_bytes()) {
                    Ok(()) => {
                        let path = destination.to_string_lossy().to_string();
                        println!(
                            "[Overlay API] Saved Dock session: {} ({} bytes)",
                            path,
                            body.len()
                        );
                        let json = serde_json::json!({
                            "path": path,
                            "bytes": body.len()
                        })
                        .to_string();
                        let resp = tiny_http::Response::from_string(json)
                            .with_header(overlay_header(
                                "Content-Type",
                                "application/json; charset=utf-8",
                            ))
                            .with_header(overlay_header("Access-Control-Allow-Origin", "*"));
                        let _ = request.respond(resp);
                    }
                    Err(error) => {
                        let json = serde_json::json!({
                            "error": format!("Could not save Dock session: {}", error)
                        })
                        .to_string();
                        let resp = tiny_http::Response::from_string(json).with_status_code(500);
                        let _ = request.respond(resp);
                    }
                }
                continue;
            }

            // API: save a media file to the user's Downloads folder.
            // When running inside OBS's embedded browser (CEF), synthetic `<a download>`
            // clicks and Blob downloads do not save to disk. This endpoint copies an uploaded
            // file or writes provided binary/data to the user's Downloads folder.
            if clean == "api/save-to-downloads" && request.method() == &tiny_http::Method::Options {
                let resp = tiny_http::Response::from_string("")
                    .with_header(overlay_header("Access-Control-Allow-Origin", "*"))
                    .with_header(overlay_header(
                        "Access-Control-Allow-Methods",
                        "POST, OPTIONS",
                    ))
                    .with_header(overlay_header(
                        "Access-Control-Allow-Headers",
                        "Content-Type",
                    ));
                let _ = request.respond(resp);
                continue;
            }

            if clean == "api/save-to-downloads" && request.method() == &tiny_http::Method::Post {
                let is_json = request.headers().iter().any(|h| {
                    h.field.equiv("Content-Type") && h.value.as_str().contains("application/json")
                });

                let query_filename = url_path
                    .find('?')
                    .and_then(|index| {
                        url_path[index + 1..]
                            .split('&')
                            .find(|part| part.starts_with("filename="))
                            .map(|part| &part[9..])
                    })
                    .map(|value| urlencoding::decode(value).unwrap_or_default().into_owned());

                let mut requested_name = query_filename.unwrap_or_default();
                let mut upload_source_name: Option<String> = None;
                let mut binary_data: Option<Vec<u8>> = None;

                if is_json {
                    let mut body_str = String::new();
                    if request.as_reader().read_to_string(&mut body_str).is_ok()
                        && !body_str.trim().is_empty()
                    {
                        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&body_str) {
                            if let Some(name) = parsed.get("fileName").and_then(|v| v.as_str()) {
                                if !name.trim().is_empty() {
                                    requested_name = name.to_string();
                                }
                            }
                            if let Some(u_file) = parsed.get("uploadFile").and_then(|v| v.as_str())
                            {
                                if !u_file.trim().is_empty() {
                                    upload_source_name = Some(u_file.to_string());
                                }
                            }
                            if let Some(d_url) = parsed.get("dataUrl").and_then(|v| v.as_str()) {
                                if let Some(comma_pos) = d_url.find(',') {
                                    use base64::Engine as _;
                                    let b64 = &d_url[comma_pos + 1..];
                                    if let Ok(bytes) =
                                        base64::engine::general_purpose::STANDARD.decode(b64.trim())
                                    {
                                        binary_data = Some(bytes);
                                    }
                                }
                            }
                        }
                    }
                } else {
                    let mut reader = request.as_reader();
                    let mut buf = Vec::new();
                    if std::io::Read::read_to_end(&mut reader, &mut buf).is_ok() && !buf.is_empty()
                    {
                        binary_data = Some(buf);
                    }
                }

                if requested_name.trim().is_empty() {
                    requested_name = upload_source_name
                        .as_deref()
                        .unwrap_or("media_download")
                        .to_string();
                }

                let safe_name = match sanitize_filename_for_storage(&requested_name) {
                    Ok(name) => name,
                    Err(error) => {
                        let json = serde_json::json!({ "error": error }).to_string();
                        let resp = tiny_http::Response::from_string(json).with_status_code(400);
                        let _ = request.respond(resp);
                        continue;
                    }
                };

                let downloads_dir = match dirs::download_dir()
                    .or_else(|| dirs::home_dir().map(|home| home.join("Downloads")))
                {
                    Some(path) => path,
                    None => {
                        let resp = tiny_http::Response::from_string(
                            r#"{"error":"Could not determine the Downloads folder"}"#,
                        )
                        .with_status_code(500);
                        let _ = request.respond(resp);
                        continue;
                    }
                };

                if let Err(error) = fs::create_dir_all(&downloads_dir) {
                    let json = serde_json::json!({
                        "error": format!("Could not create Downloads folder: {}", error)
                    })
                    .to_string();
                    let resp = tiny_http::Response::from_string(json).with_status_code(500);
                    let _ = request.respond(resp);
                    continue;
                }

                let mut destination = downloads_dir.join(&safe_name);
                if destination.exists() {
                    let path_obj = std::path::Path::new(&safe_name);
                    let stem = path_obj
                        .file_stem()
                        .and_then(|s| s.to_str())
                        .unwrap_or("media");
                    let ext = path_obj.extension().and_then(|s| s.to_str()).unwrap_or("");
                    for counter in 1..1000 {
                        let candidate = if ext.is_empty() {
                            format!("{} ({})", stem, counter)
                        } else {
                            format!("{} ({}).{}", stem, counter, ext)
                        };
                        let p = downloads_dir.join(candidate);
                        if !p.exists() {
                            destination = p;
                            break;
                        }
                    }
                }

                let final_filename = destination
                    .file_name()
                    .and_then(|f| f.to_str())
                    .unwrap_or(&safe_name)
                    .to_string();

                let mut saved_bytes = 0usize;
                let mut copy_success = false;

                if let (Some(source_file_name), Some(uploads)) =
                    (upload_source_name.as_ref(), uploads_dir.as_ref())
                {
                    let clean_source = sanitize_filename_for_storage(source_file_name)
                        .unwrap_or_else(|_| source_file_name.clone());
                    let src_path = uploads.join(&clean_source);
                    if src_path.exists() && src_path.is_file() {
                        if let Ok(bytes) = fs::copy(&src_path, &destination) {
                            saved_bytes = bytes as usize;
                            copy_success = true;
                        }
                    }
                }

                if !copy_success {
                    if let Some(bytes) = binary_data {
                        if fs::write(&destination, &bytes).is_ok() {
                            saved_bytes = bytes.len();
                            copy_success = true;
                        }
                    }
                }

                if copy_success {
                    let path_str = destination.to_string_lossy().to_string();
                    println!(
                        "[Overlay API] Saved media file to downloads: {} ({} bytes)",
                        path_str, saved_bytes
                    );
                    let json = serde_json::json!({
                        "ok": true,
                        "path": path_str,
                        "fileName": final_filename,
                        "bytes": saved_bytes
                    })
                    .to_string();
                    let resp = tiny_http::Response::from_string(json)
                        .with_header(overlay_header(
                            "Content-Type",
                            "application/json; charset=utf-8",
                        ))
                        .with_header(overlay_header("Access-Control-Allow-Origin", "*"));
                    let _ = request.respond(resp);
                } else {
                    let json = serde_json::json!({
                        "error": "Failed to save file to downloads. Source file was not found or write failed."
                    })
                    .to_string();
                    let resp = tiny_http::Response::from_string(json).with_status_code(500);
                    let _ = request.respond(resp);
                }
                continue;
            }

            // API: delete one exact user-uploaded file from the shared uploads
            // folder. The OBS Dock cannot call Tauri directly, so this is the
            // HTTP fallback used by the same media deletion path.
            if clean == "api/delete-upload" {
                let cors = || overlay_header("Access-Control-Allow-Origin", "*");
                if request.method() == &tiny_http::Method::Options {
                    let resp = tiny_http::Response::from_string("")
                        .with_header(cors())
                        .with_header(overlay_header(
                            "Access-Control-Allow-Methods",
                            "DELETE, OPTIONS",
                        ))
                        .with_header(overlay_header(
                            "Access-Control-Allow-Headers",
                            "Content-Type",
                        ));
                    let _ = request.respond(resp);
                    continue;
                }
                if request.method() != &tiny_http::Method::Delete {
                    let resp = tiny_http::Response::from_string("Method not allowed")
                        .with_status_code(405)
                        .with_header(cors());
                    let _ = request.respond(resp);
                    continue;
                }

                let response = match local_send_query_value(&url_path, "fileName")
                    .ok_or_else(|| "fileName is required".to_string())
                    .and_then(|file_name| validate_upload_basename(&file_name))
                {
                    Ok(file_name) => match uploads_dir.as_ref() {
                        Some(directory) => {
                            let path = directory.join(&file_name);
                            if path.exists() && !path.is_file() {
                                Err("The selected upload is not a file".to_string())
                            } else if path.exists() {
                                fs::remove_file(&path)
                                    .map(|_| serde_json::json!({ "ok": true, "deleted": true }))
                                    .map_err(|error| format!("Failed to delete upload: {error}"))
                            } else {
                                Ok(serde_json::json!({ "ok": true, "deleted": false }))
                            }
                        }
                        None => Err("Uploads directory is unavailable".to_string()),
                    },
                    Err(error) => Err(error),
                };

                let (status, body) = match response {
                    Ok(payload) => (200, payload),
                    Err(error) => (400, serde_json::json!({ "error": error })),
                };
                let resp = tiny_http::Response::from_string(body.to_string())
                    .with_status_code(status)
                    .with_header(overlay_header(
                        "Content-Type",
                        "application/json; charset=utf-8",
                    ))
                    .with_header(cors())
                    .with_header(overlay_header(
                        "Cache-Control",
                        "no-store, no-cache, must-revalidate, max-age=0",
                    ));
                let _ = request.respond(resp);
                continue;
            }

            // API: list uploaded files as JSON array
            if clean == "api/uploads" {
                let mut files: Vec<(String, Duration)> = Vec::new();
                if let Some(ref udir) = uploads_dir {
                    if udir.exists() {
                        if let Ok(entries) = fs::read_dir(udir) {
                            for entry in entries.flatten() {
                                if let Ok(ft) = entry.file_type() {
                                    if ft.is_file() {
                                        if let Some(name) = entry.file_name().to_str() {
                                            // Multiview frame/pattern assets are implementation
                                            // details for OBS, not user media.
                                            if name.starts_with("mv-frame-")
                                                || name.starts_with("mv-pattern-")
                                            {
                                                continue;
                                            }
                                            let modified = entry
                                                .metadata()
                                                .and_then(|metadata| metadata.modified())
                                                .ok()
                                                .and_then(|time| {
                                                    time.duration_since(UNIX_EPOCH).ok()
                                                })
                                                .unwrap_or_default();
                                            files.push((name.to_string(), modified));
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                // Keep the endpoint useful for the Dock's Newly Uploaded
                // view even for legacy files whose names do not contain a
                // generated timestamp.
                files.sort_by(|(a_name, a_time), (b_name, b_time)| {
                    b_time.cmp(a_time).then_with(|| a_name.cmp(b_name))
                });
                let files: Vec<String> = files.into_iter().map(|(name, _)| name).collect();
                let json = serde_json::to_string(&files).unwrap_or_else(|_| "[]".to_string());
                let header = tiny_http::Header::from_bytes(
                    "Content-Type",
                    "application/json; charset=utf-8",
                )
                .unwrap();
                let cors =
                    tiny_http::Header::from_bytes("Access-Control-Allow-Origin", "*").unwrap();
                let resp = tiny_http::Response::from_string(json)
                    .with_header(header)
                    .with_header(cors)
                    .with_header(overlay_header(
                        "Cache-Control",
                        "no-store, no-cache, must-revalidate, max-age=0",
                    ))
                    .with_header(overlay_header("Pragma", "no-cache"))
                    .with_header(overlay_header("Expires", "0"));
                let _ = request.respond(resp);
                continue;
            }

            // API: return the absolute path to the uploads directory
            if clean == "api/uploads-dir" {
                let dir_path = uploads_dir
                    .as_ref()
                    .and_then(|d| d.to_str())
                    .unwrap_or("")
                    .to_string();
                let json = serde_json::json!({ "path": dir_path }).to_string();
                let header = tiny_http::Header::from_bytes(
                    "Content-Type",
                    "application/json; charset=utf-8",
                )
                .unwrap();
                let cors =
                    tiny_http::Header::from_bytes("Access-Control-Allow-Origin", "*").unwrap();
                let resp = tiny_http::Response::from_string(json)
                    .with_header(header)
                    .with_header(cors)
                    .with_header(overlay_header(
                        "Cache-Control",
                        "no-store, no-cache, must-revalidate, max-age=0",
                    ))
                    .with_header(overlay_header("Pragma", "no-cache"))
                    .with_header(overlay_header("Expires", "0"));
                let _ = request.respond(resp);
                continue;
            }

            // API: check whether a local file exists.
            // GET /api/file-exists?path=/absolute/path/to/file
            if clean == "api/file-exists" {
                let file_path = url_path
                    .find('?')
                    .and_then(|i| {
                        url_path[i + 1..]
                            .split('&')
                            .find(|p| p.starts_with("path="))
                            .map(|p| &p[5..])
                    })
                    .map(|v| urlencoding::decode(v).unwrap_or_default().into_owned())
                    .unwrap_or_default();
                let exists = !file_path.is_empty() && std::path::Path::new(&file_path).is_file();
                let json = serde_json::json!({ "exists": exists }).to_string();
                let header = tiny_http::Header::from_bytes(
                    "Content-Type",
                    "application/json; charset=utf-8",
                )
                .unwrap();
                let cors =
                    tiny_http::Header::from_bytes("Access-Control-Allow-Origin", "*").unwrap();
                let resp = tiny_http::Response::from_string(json)
                    .with_header(header)
                    .with_header(cors);
                let _ = request.respond(resp);
                continue;
            }

            // API: list template background videos from Cloudflare R2.
            if clean == "api/template-videos" {
                match list_template_video_assets_internal() {
                    Ok(items) => {
                        let json =
                            serde_json::to_string(&items).unwrap_or_else(|_| "[]".to_string());
                        let header = tiny_http::Header::from_bytes(
                            "Content-Type",
                            "application/json; charset=utf-8",
                        )
                        .unwrap();
                        let cors =
                            tiny_http::Header::from_bytes("Access-Control-Allow-Origin", "*")
                                .unwrap();
                        let resp = tiny_http::Response::from_string(json)
                            .with_header(header)
                            .with_header(cors);
                        let _ = request.respond(resp);
                    }
                    Err(error) => {
                        let json = serde_json::json!({ "error": error }).to_string();
                        let header = tiny_http::Header::from_bytes(
                            "Content-Type",
                            "application/json; charset=utf-8",
                        )
                        .unwrap();
                        let cors =
                            tiny_http::Header::from_bytes("Access-Control-Allow-Origin", "*")
                                .unwrap();
                        let resp = tiny_http::Response::from_string(json)
                            .with_status_code(500)
                            .with_header(header)
                            .with_header(cors);
                        let _ = request.respond(resp);
                    }
                }
                continue;
            }

            // API: save a base64-encoded media file to disk, return absolute path
            // POST /api/save-media with JSON body { "fileName": "...", "dataUrl": "data:...;base64,..." }
            if clean == "api/save-media" && request.method() == &tiny_http::Method::Post {
                let mut body = String::new();
                if let Err(_) = request.as_reader().read_to_string(&mut body) {
                    let resp =
                        tiny_http::Response::from_string("Bad Request").with_status_code(400);
                    let _ = request.respond(resp);
                    continue;
                }
                let parsed: Result<serde_json::Value, _> = serde_json::from_str(&body);
                match parsed {
                    Ok(val) => {
                        let file_name = val.get("fileName").and_then(|v| v.as_str()).unwrap_or("");
                        let data_url = val.get("dataUrl").and_then(|v| v.as_str()).unwrap_or("");

                        if file_name.is_empty() || data_url.is_empty() {
                            let resp = tiny_http::Response::from_string(
                                r#"{"error":"fileName and dataUrl required"}"#,
                            )
                            .with_status_code(400);
                            let _ = request.respond(resp);
                            continue;
                        }

                        // Decode data-URL: "data:<mime>;base64,<data>"
                        let base64_data = if let Some(pos) = data_url.find(",") {
                            &data_url[pos + 1..]
                        } else {
                            data_url
                        };

                        use base64::Engine as _;
                        match base64::engine::general_purpose::STANDARD.decode(base64_data) {
                            Ok(bytes) => {
                                let file_bytes: &[u8] = &bytes;
                                if let Some(ref udir) = uploads_dir {
                                    let _ = fs::create_dir_all(udir);
                                    let safe_name = Path::new(file_name)
                                        .file_name()
                                        .and_then(|n| n.to_str())
                                        .unwrap_or(file_name);
                                    let dest = udir.join(safe_name);
                                    match fs::write(&dest, file_bytes) {
                                        Ok(_) => {
                                            let abs = dest.to_str().unwrap_or("").to_string();
                                            println!(
                                                "[Overlay API] Saved media: {} ({} bytes)",
                                                abs,
                                                bytes.len()
                                            );
                                            let json =
                                                serde_json::json!({ "path": abs }).to_string();
                                            let header = tiny_http::Header::from_bytes(
                                                "Content-Type",
                                                "application/json; charset=utf-8",
                                            )
                                            .unwrap();
                                            let cors = tiny_http::Header::from_bytes(
                                                "Access-Control-Allow-Origin",
                                                "*",
                                            )
                                            .unwrap();
                                            let resp = tiny_http::Response::from_string(json)
                                                .with_header(header)
                                                .with_header(cors);
                                            let _ = request.respond(resp);
                                        }
                                        Err(e) => {
                                            let json = serde_json::json!({ "error": format!("Write failed: {}", e) }).to_string();
                                            let resp = tiny_http::Response::from_string(json)
                                                .with_status_code(500);
                                            let _ = request.respond(resp);
                                        }
                                    }
                                } else {
                                    let resp = tiny_http::Response::from_string(
                                        r#"{"error":"uploads dir not available"}"#,
                                    )
                                    .with_status_code(500);
                                    let _ = request.respond(resp);
                                }
                            }
                            Err(e) => {
                                let json = serde_json::json!({ "error": format!("Base64 decode failed: {}", e) }).to_string();
                                let resp =
                                    tiny_http::Response::from_string(json).with_status_code(400);
                                let _ = request.respond(resp);
                            }
                        }
                        continue;
                    }
                    Err(_) => {
                        let resp = tiny_http::Response::from_string(r#"{"error":"Invalid JSON"}"#)
                            .with_status_code(400);
                        let _ = request.respond(resp);
                        continue;
                    }
                }
            }

            // API: save arbitrary dock JSON payloads to uploads/<name>.json
            // POST /api/save-dock-data with JSON body { "name": "...", "data": "..." }
            if clean == "api/save-dock-data" && request.method() == &tiny_http::Method::Post {
                let mut body = String::new();
                if request.as_reader().read_to_string(&mut body).is_err() {
                    let resp =
                        tiny_http::Response::from_string("Bad Request").with_status_code(400);
                    let _ = request.respond(resp);
                    continue;
                }

                let parsed: Result<serde_json::Value, _> = serde_json::from_str(&body);
                match parsed {
                    Ok(val) => {
                        let name = val.get("name").and_then(|v| v.as_str()).unwrap_or("");
                        let data = val.get("data").and_then(|v| v.as_str()).unwrap_or("");

                        if name.is_empty() {
                            let resp =
                                tiny_http::Response::from_string(r#"{"error":"name is required"}"#)
                                    .with_status_code(400);
                            let _ = request.respond(resp);
                            continue;
                        }

                        match write_dock_data(name, data) {
                            Ok(_) => {
                                let header = tiny_http::Header::from_bytes(
                                    "Content-Type",
                                    "application/json; charset=utf-8",
                                )
                                .unwrap();
                                let cors = tiny_http::Header::from_bytes(
                                    "Access-Control-Allow-Origin",
                                    "*",
                                )
                                .unwrap();
                                let resp = tiny_http::Response::from_string(r#"{"ok":true}"#)
                                    .with_header(header)
                                    .with_header(cors);
                                let _ = request.respond(resp);
                            }
                            Err(err) => {
                                let json = serde_json::json!({ "error": err }).to_string();
                                let resp =
                                    tiny_http::Response::from_string(json).with_status_code(500);
                                let _ = request.respond(resp);
                            }
                        }
                    }
                    Err(_) => {
                        let resp = tiny_http::Response::from_string(r#"{"error":"Invalid JSON"}"#)
                            .with_status_code(400);
                        let _ = request.respond(resp);
                    }
                }
                continue;
            }

            // API: native SQLite-backed Dock settings.
            // The OBS Dock cannot use Tauri IPC, so it talks to the same
            // localhost server that serves dock.html. Settings never need to
            // be persisted in the OBS browser's localStorage.
            if clean == "api/dock-settings" {
                let content_type = tiny_http::Header::from_bytes(
                    "Content-Type",
                    "application/json; charset=utf-8",
                )
                .unwrap();
                let cors =
                    tiny_http::Header::from_bytes("Access-Control-Allow-Origin", "*").unwrap();
                let methods = tiny_http::Header::from_bytes(
                    "Access-Control-Allow-Methods",
                    "GET, POST, DELETE, OPTIONS",
                )
                .unwrap();
                let allowed_headers =
                    tiny_http::Header::from_bytes("Access-Control-Allow-Headers", "Content-Type")
                        .unwrap();

                if request.method() == &tiny_http::Method::Options {
                    let resp = tiny_http::Response::from_string("")
                        .with_header(cors)
                        .with_header(methods)
                        .with_header(allowed_headers);
                    let _ = request.respond(resp);
                    continue;
                }

                let query_value = |name: &str| -> Option<String> {
                    url_path
                        .split_once('?')
                        .map(|(_, query)| query)
                        .and_then(|query| {
                            query.split('&').find_map(|part| {
                                let (key, value) = part.split_once('=')?;
                                if key != name {
                                    return None;
                                }
                                Some(urlencoding::decode(value).unwrap_or_default().into_owned())
                            })
                        })
                };

                if request.method() == &tiny_http::Method::Get {
                    let scope = query_value("scope").unwrap_or_else(|| "device".to_string());
                    match dock_settings::load_settings(&scope) {
                        Ok(body) => {
                            let resp = tiny_http::Response::from_string(body)
                                .with_header(content_type)
                                .with_header(cors);
                            let _ = request.respond(resp);
                        }
                        Err(error) => {
                            let body = serde_json::json!({ "error": error }).to_string();
                            let resp = tiny_http::Response::from_string(body)
                                .with_status_code(500)
                                .with_header(content_type)
                                .with_header(cors);
                            let _ = request.respond(resp);
                        }
                    }
                    continue;
                }

                let mut body = String::new();
                if request.as_reader().read_to_string(&mut body).is_err() || body.trim().is_empty()
                {
                    let resp = tiny_http::Response::from_string(
                        r#"{"error":"A Dock settings JSON body is required"}"#,
                    )
                    .with_status_code(400)
                    .with_header(content_type)
                    .with_header(cors);
                    let _ = request.respond(resp);
                    continue;
                }

                let parsed = serde_json::from_str::<serde_json::Value>(&body);
                let payload = match parsed {
                    Ok(value) => value,
                    Err(_) => {
                        let resp = tiny_http::Response::from_string(
                            r#"{"error":"Invalid Dock settings JSON"}"#,
                        )
                        .with_status_code(400)
                        .with_header(content_type)
                        .with_header(cors);
                        let _ = request.respond(resp);
                        continue;
                    }
                };

                let scope = payload
                    .get("scope")
                    .and_then(|value| value.as_str())
                    .map(str::to_string)
                    .or_else(|| query_value("scope"))
                    .unwrap_or_else(|| "device".to_string());
                let key = payload
                    .get("key")
                    .and_then(|value| value.as_str())
                    .unwrap_or("");
                let value = payload
                    .get("value")
                    .cloned()
                    .unwrap_or(serde_json::Value::Null);

                if key.trim().is_empty() {
                    let resp = tiny_http::Response::from_string(
                        r#"{"error":"Dock setting key is required"}"#,
                    )
                    .with_status_code(400)
                    .with_header(content_type)
                    .with_header(cors);
                    let _ = request.respond(resp);
                    continue;
                }

                let result = if request.method() == &tiny_http::Method::Delete {
                    dock_settings::delete_setting(&scope, key)
                } else if request.method() == &tiny_http::Method::Post {
                    dock_settings::save_setting(&scope, key, &value)
                } else {
                    Err("Dock settings method not allowed".to_string())
                };

                match result {
                    Ok(()) => {
                        let response_body = serde_json::json!({ "ok": true }).to_string();
                        let resp = tiny_http::Response::from_string(response_body)
                            .with_header(content_type)
                            .with_header(cors);
                        let _ = request.respond(resp);
                    }
                    Err(error) => {
                        let response_body = serde_json::json!({ "error": error }).to_string();
                        let status = if request.method() == &tiny_http::Method::Post
                            || request.method() == &tiny_http::Method::Delete
                        {
                            500
                        } else {
                            405
                        };
                        let resp = tiny_http::Response::from_string(response_body)
                            .with_status_code(status)
                            .with_header(content_type)
                            .with_header(cors);
                        let _ = request.respond(resp);
                    }
                }
                continue;
            }

            // API: save dock favorites — POST /api/save-dock-favorites with JSON body [...]
            // This allows the dock CEF browser to persist favorites back to the
            // overlay server even when it can't use Tauri invoke.
            if clean == "api/save-dock-favorites" && request.method() == &tiny_http::Method::Post {
                let mut body = String::new();
                if request.as_reader().read_to_string(&mut body).is_err() {
                    let resp =
                        tiny_http::Response::from_string("Bad Request").with_status_code(400);
                    let _ = request.respond(resp);
                    continue;
                }
                // Validate it's valid JSON array
                let parsed: Result<Vec<String>, _> = serde_json::from_str(&body);
                match parsed {
                    Ok(_) => {
                        if let Some(ref udir) = uploads_dir {
                            let _ = fs::create_dir_all(udir);
                            let path = udir.join("dock-lt-favorites.json");
                            match fs::write(&path, &body) {
                                Ok(_) => {
                                    println!(
                                        "[Overlay API] Saved dock-lt-favorites ({} bytes)",
                                        body.len()
                                    );
                                    let header = tiny_http::Header::from_bytes(
                                        "Content-Type",
                                        "application/json; charset=utf-8",
                                    )
                                    .unwrap();
                                    let cors = tiny_http::Header::from_bytes(
                                        "Access-Control-Allow-Origin",
                                        "*",
                                    )
                                    .unwrap();
                                    let resp = tiny_http::Response::from_string(r#"{"ok":true}"#)
                                        .with_header(header)
                                        .with_header(cors);
                                    let _ = request.respond(resp);
                                }
                                Err(e) => {
                                    let json = format!(r#"{{"error":"Write failed: {}"}}"#, e);
                                    let resp = tiny_http::Response::from_string(json)
                                        .with_status_code(500);
                                    let _ = request.respond(resp);
                                }
                            }
                        } else {
                            let resp = tiny_http::Response::from_string(
                                r#"{"error":"uploads dir not available"}"#,
                            )
                            .with_status_code(500);
                            let _ = request.respond(resp);
                        }
                    }
                    Err(_) => {
                        let resp =
                            tiny_http::Response::from_string(r#"{"error":"Invalid JSON array"}"#)
                                .with_status_code(400);
                        let _ = request.respond(resp);
                    }
                }
                continue;
            }

            // API: the Studio camera opened natively (one capture for every window).
            if clean.starts_with("api/studio-cam/") {
                studio_camera::handle(request, clean, publish_studio_camera_frame);
                continue;
            }

            // API: Presentation Studio camera picture (JPEG frames). POST = the Studio sends its newest
            // frame (an empty body means the camera is off). GET ?since=<n> = the newest frame, or
            // 204 when nothing newer than <n> exists. The frame number is in the X-Frame-Seq header.
            // API: the live camera as one continuous stream (see StudioCameraStream).
            if clean == "api/studio-camera/stream" {
                let headers = vec![
                    tiny_http::Header::from_bytes("Content-Type", "multipart/x-mixed-replace; boundary=mceframe").unwrap(),
                    tiny_http::Header::from_bytes("Cache-Control", "no-store").unwrap(),
                    tiny_http::Header::from_bytes("Access-Control-Allow-Origin", "*").unwrap(),
                    tiny_http::Header::from_bytes("Access-Control-Expose-Headers", "X-Frame-Seq").unwrap(),
                ];
                let stream = StudioCameraStream { seq: 0, chunk: Vec::new(), pos: 0, sent_any: false, opened: Instant::now() };
                std::thread::spawn(move || {
                    let response = tiny_http::Response::new(tiny_http::StatusCode(200), headers, stream, None, None);
                    let _ = request.respond(response);
                });
                continue;
            }

            if clean == "api/studio-camera" {
                let frame = studio_camera_frame();
                let cors =
                    tiny_http::Header::from_bytes("Access-Control-Allow-Origin", "*").unwrap();

                if request.method() == &tiny_http::Method::Options {
                    let resp = tiny_http::Response::from_string("")
                        .with_header(
                            tiny_http::Header::from_bytes(
                                "Access-Control-Allow-Methods",
                                "GET, POST, OPTIONS",
                            )
                            .unwrap(),
                        )
                        .with_header(
                            tiny_http::Header::from_bytes(
                                "Access-Control-Allow-Headers",
                                "Content-Type",
                            )
                            .unwrap(),
                        )
                        .with_header(cors);
                    let _ = request.respond(resp);
                    continue;
                }

                if request.method() == &tiny_http::Method::Post {
                    let mut body: Vec<u8> = Vec::new();
                    if request.as_reader().read_to_end(&mut body).is_err() {
                        let resp =
                            tiny_http::Response::from_string("Bad Request").with_status_code(400);
                        let _ = request.respond(resp);
                        continue;
                    }
                    if let Ok(mut state) = frame.lock() {
                        state.0 += 1;
                        state.1 = body;
                    }
                    studio_camera_signal().notify_all();
                    let wanted = STUDIO_CAMERA_WANTED
                        .get_or_init(|| Mutex::new(None))
                        .lock()
                        .map(|last| {
                            last.map(|at| at.elapsed() < Duration::from_secs(2))
                                .unwrap_or(false)
                        })
                        .unwrap_or(false);
                    let resp = tiny_http::Response::from_string(format!(
                        r#"{{"ok":true,"wanted":{}}}"#,
                        wanted
                    ))
                    .with_header(cors);
                    let _ = request.respond(resp);
                    continue;
                }

                // GET
                if let Ok(mut last) = STUDIO_CAMERA_WANTED
                    .get_or_init(|| Mutex::new(None))
                    .lock()
                {
                    *last = Some(Instant::now());
                }
                let since = request.url().split_once('?').and_then(|(_, query)| {
                    query
                        .split('&')
                        .find_map(|pair| pair.strip_prefix("since="))
                        .and_then(|v| v.parse::<u64>().ok())
                });
                let (seq, bytes) = frame
                    .lock()
                    .map(|state| match since {
                        Some(seen) if seen >= state.0 => (state.0, Vec::new()),
                        _ => (state.0, state.1.clone()),
                    })
                    .unwrap_or((0, Vec::new()));
                let seq_header =
                    tiny_http::Header::from_bytes("X-Frame-Seq", seq.to_string()).unwrap();
                let expose = tiny_http::Header::from_bytes(
                    "Access-Control-Expose-Headers",
                    "X-Frame-Seq",
                )
                .unwrap();
                let no_store =
                    tiny_http::Header::from_bytes("Cache-Control", "no-store").unwrap();
                if bytes.is_empty() {
                    let resp = tiny_http::Response::from_data(Vec::<u8>::new())
                        .with_status_code(204)
                        .with_header(seq_header)
                        .with_header(expose)
                        .with_header(cors)
                        .with_header(no_store);
                    let _ = request.respond(resp);
                } else {
                    let resp = tiny_http::Response::from_data(bytes)
                        .with_header(
                            tiny_http::Header::from_bytes("Content-Type", "image/jpeg").unwrap(),
                        )
                        .with_header(seq_header)
                        .with_header(expose)
                        .with_header(cors)
                        .with_header(no_store);
                    let _ = request.respond(resp);
                }
                continue;
            }

            // API: live camera video link. The Studio and each screen window leave short JSON
            // messages here for each other (offer / answer / network candidates).
            // POST {"to": "<id>", ...}  stores a message.  GET ?to=<id>&since=<n>  reads them.
            if clean == "api/studio-rtc" {
                let mailbox = STUDIO_RTC_MAILBOX.get_or_init(|| Mutex::new((0, Vec::new())));
                let cors =
                    tiny_http::Header::from_bytes("Access-Control-Allow-Origin", "*").unwrap();
                let json_header = tiny_http::Header::from_bytes(
                    "Content-Type",
                    "application/json; charset=utf-8",
                )
                .unwrap();
                let no_store =
                    tiny_http::Header::from_bytes("Cache-Control", "no-store").unwrap();

                if request.method() == &tiny_http::Method::Options {
                    let resp = tiny_http::Response::from_string("")
                        .with_header(
                            tiny_http::Header::from_bytes(
                                "Access-Control-Allow-Methods",
                                "GET, POST, OPTIONS",
                            )
                            .unwrap(),
                        )
                        .with_header(
                            tiny_http::Header::from_bytes(
                                "Access-Control-Allow-Headers",
                                "Content-Type",
                            )
                            .unwrap(),
                        )
                        .with_header(cors);
                    let _ = request.respond(resp);
                    continue;
                }

                if request.method() == &tiny_http::Method::Post {
                    let mut body = String::new();
                    if request.as_reader().read_to_string(&mut body).is_err() || body.len() > 200_000
                    {
                        let resp =
                            tiny_http::Response::from_string("Bad Request").with_status_code(400);
                        let _ = request.respond(resp);
                        continue;
                    }
                    let to = serde_json::from_str::<serde_json::Value>(&body)
                        .ok()
                        .and_then(|value| value.get("to").and_then(|v| v.as_str()).map(String::from));
                    let Some(to) = to else {
                        let resp =
                            tiny_http::Response::from_string("Bad Request").with_status_code(400);
                        let _ = request.respond(resp);
                        continue;
                    };
                    if let Ok(mut state) = mailbox.lock() {
                        state.0 += 1;
                        let number = state.0;
                        state.1.push((number, to, body));
                        // Keep it small: only recent messages matter.
                        if state.1.len() > 300 {
                            let drop = state.1.len() - 300;
                            state.1.drain(0..drop);
                        }
                    }
                    let resp = tiny_http::Response::from_string(r#"{"ok":true}"#)
                        .with_header(json_header)
                        .with_header(cors)
                        .with_header(no_store);
                    let _ = request.respond(resp);
                    continue;
                }

                // GET
                let query = request.url().split_once('?').map(|(_, q)| q.to_string()).unwrap_or_default();
                let mut to = String::new();
                let mut since: u64 = 0;
                for pair in query.split('&') {
                    if let Some(value) = pair.strip_prefix("to=") {
                        to = urlencoding::decode(value).unwrap_or_default().into_owned();
                    } else if let Some(value) = pair.strip_prefix("since=") {
                        since = value.parse::<u64>().unwrap_or(0);
                    }
                }
                let (last, messages) = mailbox
                    .lock()
                    .map(|state| {
                        let list: Vec<String> = state
                            .1
                            .iter()
                            .filter(|(number, target, _)| *number > since && *target == to)
                            .map(|(_, _, body)| body.clone())
                            .collect();
                        (state.0, list)
                    })
                    .unwrap_or((0, Vec::new()));
                let payload = format!(r#"{{"seq":{},"messages":[{}]}}"#, last, messages.join(","));
                let resp = tiny_http::Response::from_string(payload)
                    .with_header(json_header)
                    .with_header(cors)
                    .with_header(no_store);
                let _ = request.respond(resp);
                continue;
            }

            // API: Presentation Studio program state. The app POSTs the whole state
            // (with a numeric "revision"); studio-output.html GETs it, passing
            // ?since=<revision> so an unchanged state answers with a tiny body.
            if clean == "api/studio-state" {
                let studio_state =
                    STUDIO_STATE.get_or_init(|| Mutex::new((0, "{}".to_string())));
                let header = tiny_http::Header::from_bytes(
                    "Content-Type",
                    "application/json; charset=utf-8",
                )
                .unwrap();
                let cors =
                    tiny_http::Header::from_bytes("Access-Control-Allow-Origin", "*").unwrap();
                let no_store =
                    tiny_http::Header::from_bytes("Cache-Control", "no-store").unwrap();

                if request.method() == &tiny_http::Method::Options {
                    let resp = tiny_http::Response::from_string("")
                        .with_header(
                            tiny_http::Header::from_bytes(
                                "Access-Control-Allow-Methods",
                                "GET, POST, OPTIONS",
                            )
                            .unwrap(),
                        )
                        .with_header(
                            tiny_http::Header::from_bytes(
                                "Access-Control-Allow-Headers",
                                "Content-Type",
                            )
                            .unwrap(),
                        )
                        .with_header(cors);
                    let _ = request.respond(resp);
                    continue;
                }

                if request.method() == &tiny_http::Method::Post {
                    let mut body = String::new();
                    if request.as_reader().read_to_string(&mut body).is_err() {
                        let resp =
                            tiny_http::Response::from_string("Bad Request").with_status_code(400);
                        let _ = request.respond(resp);
                        continue;
                    }
                    let revision = serde_json::from_str::<serde_json::Value>(&body)
                        .ok()
                        .and_then(|v| v.get("revision").and_then(|r| r.as_u64()))
                        .unwrap_or(0);
                    if let Ok(mut state) = studio_state.lock() {
                        if revision >= state.0 {
                            *state = (revision, body);
                        }
                    }
                    let resp = tiny_http::Response::from_string(r#"{"ok":true}"#)
                        .with_header(header)
                        .with_header(cors);
                    let _ = request.respond(resp);
                    continue;
                }

                // GET
                let since = request
                    .url()
                    .split_once('?')
                    .and_then(|(_, query)| {
                        query
                            .split('&')
                            .find_map(|pair| pair.strip_prefix("since="))
                            .and_then(|v| v.parse::<u64>().ok())
                    });
                let json = studio_state
                    .lock()
                    .map(|state| match since {
                        Some(seen) if seen >= state.0 => {
                            format!(r#"{{"unchanged":true,"revision":{}}}"#, state.0)
                        }
                        _ => state.1.clone(),
                    })
                    .unwrap_or_else(|_| "{}".to_string());
                let resp = tiny_http::Response::from_string(json)
                    .with_header(header)
                    .with_header(cors)
                    .with_header(no_store);
                let _ = request.respond(resp);
                continue;
            }

            // API: Verse AI output state. The app POSTs the whole state
            // (with a numeric "revision"); verse-ai-output.html GETs it, passing
            // ?since=<revision> so an unchanged state answers with a tiny body.
            if clean == "api/verse-ai-state" {
                let verse_ai_state =
                    VERSE_AI_STATE.get_or_init(|| Mutex::new((0, "{}".to_string())));
                let header = tiny_http::Header::from_bytes(
                    "Content-Type",
                    "application/json; charset=utf-8",
                )
                .unwrap();
                let cors =
                    tiny_http::Header::from_bytes("Access-Control-Allow-Origin", "*").unwrap();
                let no_store =
                    tiny_http::Header::from_bytes("Cache-Control", "no-store").unwrap();

                if request.method() == &tiny_http::Method::Options {
                    let resp = tiny_http::Response::from_string("")
                        .with_header(
                            tiny_http::Header::from_bytes(
                                "Access-Control-Allow-Methods",
                                "GET, POST, OPTIONS",
                            )
                            .unwrap(),
                        )
                        .with_header(
                            tiny_http::Header::from_bytes(
                                "Access-Control-Allow-Headers",
                                "Content-Type",
                            )
                            .unwrap(),
                        )
                        .with_header(cors);
                    let _ = request.respond(resp);
                    continue;
                }

                if request.method() == &tiny_http::Method::Post {
                    let mut body = String::new();
                    if request.as_reader().read_to_string(&mut body).is_err() {
                        let resp =
                            tiny_http::Response::from_string("Bad Request").with_status_code(400);
                        let _ = request.respond(resp);
                        continue;
                    }
                    let revision = serde_json::from_str::<serde_json::Value>(&body)
                        .ok()
                        .and_then(|v| v.get("revision").and_then(|r| r.as_u64()))
                        .unwrap_or(0);
                    if let Ok(mut state) = verse_ai_state.lock() {
                        if revision >= state.0 {
                            *state = (revision, body);
                        }
                    }
                    let resp = tiny_http::Response::from_string(r#"{"ok":true}"#)
                        .with_header(header)
                        .with_header(cors);
                    let _ = request.respond(resp);
                    continue;
                }

                // GET
                let since = request
                    .url()
                    .split_once('?')
                    .and_then(|(_, query)| {
                        query
                            .split('&')
                            .find_map(|pair| pair.strip_prefix("since="))
                            .and_then(|v| v.parse::<u64>().ok())
                    });
                let json = verse_ai_state
                    .lock()
                    .map(|state| match since {
                        Some(seen) if seen >= state.0 => {
                            format!(r#"{{"unchanged":true,"revision":{}}}"#, state.0)
                        }
                        _ => state.1.clone(),
                    })
                    .unwrap_or_else(|_| "{}".to_string());
                let resp = tiny_http::Response::from_string(json)
                    .with_header(header)
                    .with_header(cors)
                    .with_header(no_store);
                let _ = request.respond(resp);
                continue;
            }

            // API: LM state relay — GET returns current state, POST updates it
            // Used for cross-process communication between Tauri app and OBS dock
            if clean == "api/lm-state" {
                let lm_state = LM_STATE.get_or_init(|| Mutex::new("{}".to_string()));
                let header = tiny_http::Header::from_bytes(
                    "Content-Type",
                    "application/json; charset=utf-8",
                )
                .unwrap();
                let cors =
                    tiny_http::Header::from_bytes("Access-Control-Allow-Origin", "*").unwrap();

                if request.method() == &tiny_http::Method::Options {
                    let resp = tiny_http::Response::from_string("")
                        .with_header(
                            tiny_http::Header::from_bytes(
                                "Access-Control-Allow-Methods",
                                "GET, POST, OPTIONS",
                            )
                            .unwrap(),
                        )
                        .with_header(
                            tiny_http::Header::from_bytes(
                                "Access-Control-Allow-Headers",
                                "Content-Type",
                            )
                            .unwrap(),
                        )
                        .with_header(cors);
                    let _ = request.respond(resp);
                    continue;
                }

                if request.method() == &tiny_http::Method::Post {
                    let mut body = String::new();
                    if request.as_reader().read_to_string(&mut body).is_err() {
                        let resp =
                            tiny_http::Response::from_string("Bad Request").with_status_code(400);
                        let _ = request.respond(resp);
                        continue;
                    }
                    if let Ok(mut state) = lm_state.lock() {
                        *state = body;
                    }
                    let resp = tiny_http::Response::from_string(r#"{"ok":true}"#)
                        .with_header(header)
                        .with_header(cors);
                    let _ = request.respond(resp);
                    continue;
                }

                // GET
                let json = lm_state
                    .lock()
                    .map(|s| s.clone())
                    .unwrap_or_else(|_| "{}".to_string());
                let resp = tiny_http::Response::from_string(json)
                    .with_header(header)
                    .with_header(cors);
                let _ = request.respond(resp);
                continue;
            }

            // API: Rundown state relay — GET returns the live rundown state, POST
            // replaces it. The Dock posts on every control change; the presenter
            // screen polls it. State carries a value snapshot + timestamp, so the
            // presenter computes the running time locally.
            if clean == "api/rundown-state" {
                let rundown_state = RUNDOWN_STATE.get_or_init(|| Mutex::new("{}".to_string()));
                let header = tiny_http::Header::from_bytes(
                    "Content-Type",
                    "application/json; charset=utf-8",
                )
                .unwrap();
                let cors =
                    tiny_http::Header::from_bytes("Access-Control-Allow-Origin", "*").unwrap();
                let no_store =
                    tiny_http::Header::from_bytes("Cache-Control", "no-store").unwrap();

                if request.method() == &tiny_http::Method::Options {
                    let resp = tiny_http::Response::from_string("")
                        .with_header(
                            tiny_http::Header::from_bytes(
                                "Access-Control-Allow-Methods",
                                "GET, POST, OPTIONS",
                            )
                            .unwrap(),
                        )
                        .with_header(
                            tiny_http::Header::from_bytes(
                                "Access-Control-Allow-Headers",
                                "Content-Type",
                            )
                            .unwrap(),
                        )
                        .with_header(cors);
                    let _ = request.respond(resp);
                    continue;
                }

                if request.method() == &tiny_http::Method::Post {
                    let mut body = String::new();
                    if request
                        .as_reader()
                        .take(65_536)
                        .read_to_string(&mut body)
                        .is_err()
                    {
                        let resp =
                            tiny_http::Response::from_string("Bad Request").with_status_code(400);
                        let _ = request.respond(resp);
                        continue;
                    }
                    if serde_json::from_str::<serde_json::Value>(&body).is_err() {
                        let resp = tiny_http::Response::from_string(r#"{"error":"Invalid JSON"}"#)
                            .with_status_code(400)
                            .with_header(cors);
                        let _ = request.respond(resp);
                        continue;
                    }
                    if let Ok(mut state) = rundown_state.lock() {
                        *state = body;
                    }
                    let resp = tiny_http::Response::from_string(r#"{"ok":true}"#)
                        .with_header(header)
                        .with_header(cors)
                        .with_header(no_store);
                    let _ = request.respond(resp);
                    continue;
                }

                let json = rundown_state
                    .lock()
                    .map(|s| s.clone())
                    .unwrap_or_else(|_| "{}".to_string());
                let resp = tiny_http::Response::from_string(json)
                    .with_header(header)
                    .with_header(cors)
                    .with_header(no_store);
                let _ = request.respond(resp);
                continue;
            }

            // API: LM command relay — POST enqueues a command, GET drains all pending commands
            // Used by the dock (OBS CEF) to send commands to the main app cross-process
            if clean == "api/lm-command" {
                let queue = LM_COMMAND_QUEUE.get_or_init(|| Mutex::new(Vec::new()));
                let bible_navigation_queue =
                    LM_BIBLE_NAVIGATION_QUEUE.get_or_init(|| Mutex::new(Vec::new()));
                let header = tiny_http::Header::from_bytes(
                    "Content-Type",
                    "application/json; charset=utf-8",
                )
                .unwrap();
                let cors =
                    tiny_http::Header::from_bytes("Access-Control-Allow-Origin", "*").unwrap();

                if request.method() == &tiny_http::Method::Options {
                    let resp = tiny_http::Response::from_string("")
                        .with_header(
                            tiny_http::Header::from_bytes(
                                "Access-Control-Allow-Methods",
                                "GET, POST, OPTIONS",
                            )
                            .unwrap(),
                        )
                        .with_header(
                            tiny_http::Header::from_bytes(
                                "Access-Control-Allow-Headers",
                                "Content-Type",
                            )
                            .unwrap(),
                        )
                        .with_header(cors);
                    let _ = request.respond(resp);
                    continue;
                }

                if request.method() == &tiny_http::Method::Post {
                    let mut body = String::new();
                    if request.as_reader().read_to_string(&mut body).is_err() {
                        let resp =
                            tiny_http::Response::from_string("Bad Request").with_status_code(400);
                        let _ = request.respond(resp);
                        continue;
                    }
                    let is_bible_navigation = serde_json::from_str::<serde_json::Value>(&body)
                        .ok()
                        .and_then(|value| {
                            value
                                .get("type")
                                .and_then(|kind| kind.as_str())
                                .map(|kind| kind == "lm:navigate")
                        })
                        .unwrap_or(false);
                    if is_bible_navigation {
                        if let Ok(mut q) = bible_navigation_queue.lock() {
                            // Cap at 50 commands to prevent unbounded growth.
                            if q.len() < 50 {
                                q.push(body.clone());
                            }
                        }
                    }
                    if let Ok(mut q) = queue.lock() {
                        // Cap at 50 commands to prevent unbounded growth
                        if q.len() < 50 {
                            q.push(body);
                        }
                    }
                    let resp = tiny_http::Response::from_string(r#"{"ok":true}"#)
                        .with_header(header)
                        .with_header(cors);
                    let _ = request.respond(resp);
                    continue;
                }

                // GET — drain all pending commands
                let json = if let Ok(mut q) = queue.lock() {
                    let cmds: Vec<String> = q.drain(..).collect();
                    serde_json::to_string(&cmds).unwrap_or_else(|_| "[]".to_string())
                } else {
                    "[]".to_string()
                };
                let resp = tiny_http::Response::from_string(json)
                    .with_header(header)
                    .with_header(cors);
                let _ = request.respond(resp);
                continue;
            }

            // API: Bible navigation relay — GET drains navigation commands for
            // the Bible tab running in OBS CEF. The command is mirrored from
            // /api/lm-command on POST, so the main-app LM service and the OBS
            // dock can consume the same click independently.
            if clean == "api/lm-bible-navigation" {
                let queue = LM_BIBLE_NAVIGATION_QUEUE.get_or_init(|| Mutex::new(Vec::new()));
                let header = tiny_http::Header::from_bytes(
                    "Content-Type",
                    "application/json; charset=utf-8",
                )
                .unwrap();
                let cors =
                    tiny_http::Header::from_bytes("Access-Control-Allow-Origin", "*").unwrap();

                if request.method() == &tiny_http::Method::Options {
                    let resp = tiny_http::Response::from_string("")
                        .with_header(
                            tiny_http::Header::from_bytes(
                                "Access-Control-Allow-Methods",
                                "GET, OPTIONS",
                            )
                            .unwrap(),
                        )
                        .with_header(cors);
                    let _ = request.respond(resp);
                    continue;
                }

                let json = if let Ok(mut q) = queue.lock() {
                    let cmds: Vec<String> = q.drain(..).collect();
                    serde_json::to_string(&cmds).unwrap_or_else(|_| "[]".to_string())
                } else {
                    "[]".to_string()
                };
                let resp = tiny_http::Response::from_string(json)
                    .with_header(header)
                    .with_header(cors);
                let _ = request.respond(resp);
                continue;
            }

            // API: Dock notes command relay — POST enqueues an append command,
            // GET drains all pending commands. Used when LM and Notes docks run
            // in separate browser processes or localhost origins.
            if clean == "api/dock-notes-command" {
                let queue = DOCK_NOTES_COMMAND_QUEUE.get_or_init(|| Mutex::new(Vec::new()));
                let header = tiny_http::Header::from_bytes(
                    "Content-Type",
                    "application/json; charset=utf-8",
                )
                .unwrap();
                let cors =
                    tiny_http::Header::from_bytes("Access-Control-Allow-Origin", "*").unwrap();

                if request.method() == &tiny_http::Method::Options {
                    let resp = tiny_http::Response::from_string("")
                        .with_header(
                            tiny_http::Header::from_bytes(
                                "Access-Control-Allow-Methods",
                                "GET, POST, OPTIONS",
                            )
                            .unwrap(),
                        )
                        .with_header(
                            tiny_http::Header::from_bytes(
                                "Access-Control-Allow-Headers",
                                "Content-Type",
                            )
                            .unwrap(),
                        )
                        .with_header(cors);
                    let _ = request.respond(resp);
                    continue;
                }

                if request.method() == &tiny_http::Method::Post {
                    let mut body = String::new();
                    if request.as_reader().read_to_string(&mut body).is_err() {
                        let resp =
                            tiny_http::Response::from_string("Bad Request").with_status_code(400);
                        let _ = request.respond(resp);
                        continue;
                    }

                    match serde_json::from_str::<serde_json::Value>(&body) {
                        Ok(value) => {
                            let has_command_id = value
                                .get("commandId")
                                .and_then(|v| v.as_str())
                                .map(|v| !v.trim().is_empty())
                                .unwrap_or(false);
                            let has_text = value
                                .get("text")
                                .and_then(|v| v.as_str())
                                .map(|v| !v.trim().is_empty())
                                .unwrap_or(false);

                            if !has_command_id || !has_text {
                                let resp = tiny_http::Response::from_string(
                                    r#"{"error":"Invalid dock notes command"}"#,
                                )
                                .with_status_code(400)
                                .with_header(header)
                                .with_header(cors);
                                let _ = request.respond(resp);
                                continue;
                            }

                            if let Ok(mut q) = queue.lock() {
                                if q.len() < 100 {
                                    q.push(body);
                                }
                            }
                            let resp = tiny_http::Response::from_string(r#"{"ok":true}"#)
                                .with_header(header)
                                .with_header(cors);
                            let _ = request.respond(resp);
                            continue;
                        }
                        Err(_) => {
                            let resp =
                                tiny_http::Response::from_string(r#"{"error":"Invalid JSON"}"#)
                                    .with_status_code(400)
                                    .with_header(header)
                                    .with_header(cors);
                            let _ = request.respond(resp);
                            continue;
                        }
                    }
                }

                let json = if let Ok(mut q) = queue.lock() {
                    let cmds: Vec<String> = q.drain(..).collect();
                    serde_json::to_string(&cmds).unwrap_or_else(|_| "[]".to_string())
                } else {
                    "[]".to_string()
                };
                let resp = tiny_http::Response::from_string(json)
                    .with_header(header)
                    .with_header(cors);
                let _ = request.respond(resp);
                continue;
            }

            // API: Presentation state relay — GET returns current session state,
            // POST updates it. Used by Presentation Console + presentation.html.
            if clean == "api/presentation-state" {
                let header = tiny_http::Header::from_bytes(
                    "Content-Type",
                    "application/json; charset=utf-8",
                )
                .unwrap();
                let cors =
                    tiny_http::Header::from_bytes("Access-Control-Allow-Origin", "*").unwrap();

                if request.method() == &tiny_http::Method::Options {
                    let resp = tiny_http::Response::from_string("")
                        .with_header(
                            tiny_http::Header::from_bytes(
                                "Access-Control-Allow-Methods",
                                "GET, POST, OPTIONS",
                            )
                            .unwrap(),
                        )
                        .with_header(
                            tiny_http::Header::from_bytes(
                                "Access-Control-Allow-Headers",
                                "Content-Type",
                            )
                            .unwrap(),
                        )
                        .with_header(cors);
                    let _ = request.respond(resp);
                    continue;
                }

                if request.method() == &tiny_http::Method::Post {
                    let mut body = String::new();
                    if request.as_reader().read_to_string(&mut body).is_err() {
                        let resp =
                            tiny_http::Response::from_string("Bad Request").with_status_code(400);
                        let _ = request.respond(resp);
                        continue;
                    }

                    match serde_json::from_str::<PresentationStateEnvelope>(&body) {
                        Ok(mut payload) => {
                            if payload.session_id.trim().is_empty() {
                                let resp = tiny_http::Response::from_string(
                                    r#"{"error":"sessionId is required"}"#,
                                )
                                .with_status_code(400)
                                .with_header(header)
                                .with_header(cors);
                                let _ = request.respond(resp);
                                continue;
                            }

                            if payload.updated_at == 0 {
                                payload.updated_at = now_unix_millis();
                            }
                            let session_id = payload.session_id.clone();

                            let state_store =
                                PRESENTATION_STATE.get_or_init(|| Mutex::new(BTreeMap::new()));
                            if let Ok(mut state) = state_store.lock() {
                                let previous = state.get(&session_id).cloned();
                                merge_presentation_state(&body, &mut payload, previous.as_ref());
                                state.insert(session_id.clone(), payload.clone());
                            }
                            presentation_remote::broadcast_presentation_state(&payload);

                            let viewer_count = presentation_viewer_count(&session_id);
                            let resp = tiny_http::Response::from_string(
                                serde_json::json!({
                                    "ok": true,
                                    "viewerCount": viewer_count,
                                })
                                .to_string(),
                            )
                            .with_header(header)
                            .with_header(cors);
                            let _ = request.respond(resp);
                        }
                        Err(err) => {
                            let resp = tiny_http::Response::from_string(
                                serde_json::json!({
                                    "error": format!("Invalid presentation state: {}", err),
                                })
                                .to_string(),
                            )
                            .with_status_code(400)
                            .with_header(header)
                            .with_header(cors);
                            let _ = request.respond(resp);
                        }
                    }
                    continue;
                }

                let session_id = if let Some(qpos) = url_path.find('?') {
                    let qs = &url_path[qpos + 1..];
                    qs.split('&')
                        .find_map(|pair| {
                            let (key, value) = pair.split_once('=')?;
                            if key == "sessionId" {
                                Some(urlencoding::decode(value).unwrap_or_default().into_owned())
                            } else {
                                None
                            }
                        })
                        .unwrap_or_default()
                } else {
                    String::new()
                };

                if session_id.trim().is_empty() {
                    let resp =
                        tiny_http::Response::from_string(r#"{"error":"sessionId is required"}"#)
                            .with_status_code(400)
                            .with_header(header)
                            .with_header(overlay_header(
                                "Cache-Control",
                                "no-store, no-cache, must-revalidate, max-age=0",
                            ))
                            .with_header(overlay_header("Pragma", "no-cache"))
                            .with_header(cors);
                    let _ = request.respond(resp);
                    continue;
                }

                let state_store = PRESENTATION_STATE.get_or_init(|| Mutex::new(BTreeMap::new()));
                let state = state_store
                    .lock()
                    .ok()
                    .and_then(|store| store.get(&session_id).cloned());
                let viewer_count = presentation_viewer_count(&session_id);
                let resp = tiny_http::Response::from_string(
                    serde_json::json!({
                        "state": state,
                        "viewerCount": viewer_count,
                    })
                    .to_string(),
                )
                .with_header(header)
                .with_header(overlay_header(
                    "Cache-Control",
                    "no-store, no-cache, must-revalidate, max-age=0",
                ))
                .with_header(overlay_header("Pragma", "no-cache"))
                .with_header(cors);
                let _ = request.respond(resp);
                continue;
            }

            // API: Presentation viewer heartbeat — POST updates last-seen,
            // GET returns current viewer count for a session.
            if clean == "api/presentation-viewer" {
                let header = tiny_http::Header::from_bytes(
                    "Content-Type",
                    "application/json; charset=utf-8",
                )
                .unwrap();
                let cors =
                    tiny_http::Header::from_bytes("Access-Control-Allow-Origin", "*").unwrap();

                if request.method() == &tiny_http::Method::Options {
                    let resp = tiny_http::Response::from_string("")
                        .with_header(
                            tiny_http::Header::from_bytes(
                                "Access-Control-Allow-Methods",
                                "GET, POST, OPTIONS",
                            )
                            .unwrap(),
                        )
                        .with_header(
                            tiny_http::Header::from_bytes(
                                "Access-Control-Allow-Headers",
                                "Content-Type",
                            )
                            .unwrap(),
                        )
                        .with_header(cors);
                    let _ = request.respond(resp);
                    continue;
                }

                if request.method() == &tiny_http::Method::Post {
                    let mut body = String::new();
                    if request.as_reader().read_to_string(&mut body).is_err() {
                        let resp =
                            tiny_http::Response::from_string("Bad Request").with_status_code(400);
                        let _ = request.respond(resp);
                        continue;
                    }

                    match serde_json::from_str::<PresentationViewerHeartbeat>(&body) {
                        Ok(payload) => {
                            if payload.session_id.trim().is_empty()
                                || payload.viewer_id.trim().is_empty()
                            {
                                let resp = tiny_http::Response::from_string(
                                    r#"{"error":"sessionId and viewerId are required"}"#,
                                )
                                .with_status_code(400)
                                .with_header(header)
                                .with_header(cors);
                                let _ = request.respond(resp);
                                continue;
                            }

                            let registry =
                                PRESENTATION_VIEWERS.get_or_init(|| Mutex::new(BTreeMap::new()));
                            if let Ok(mut viewers) = registry.lock() {
                                let session = viewers
                                    .entry(payload.session_id.clone())
                                    .or_insert_with(BTreeMap::new);
                                session.insert(payload.viewer_id, now_unix_millis());
                            }

                            let viewer_count = presentation_viewer_count(&payload.session_id);
                            let resp = tiny_http::Response::from_string(
                                serde_json::json!({
                                    "ok": true,
                                    "viewerCount": viewer_count,
                                })
                                .to_string(),
                            )
                            .with_header(header)
                            .with_header(cors);
                            let _ = request.respond(resp);
                        }
                        Err(err) => {
                            let resp = tiny_http::Response::from_string(
                                serde_json::json!({
                                    "error": format!("Invalid viewer heartbeat: {}", err),
                                })
                                .to_string(),
                            )
                            .with_status_code(400)
                            .with_header(header)
                            .with_header(cors);
                            let _ = request.respond(resp);
                        }
                    }
                    continue;
                }

                let session_id = if let Some(qpos) = url_path.find('?') {
                    let qs = &url_path[qpos + 1..];
                    qs.split('&')
                        .find_map(|pair| {
                            let (key, value) = pair.split_once('=')?;
                            if key == "sessionId" {
                                Some(urlencoding::decode(value).unwrap_or_default().into_owned())
                            } else {
                                None
                            }
                        })
                        .unwrap_or_default()
                } else {
                    String::new()
                };

                if session_id.trim().is_empty() {
                    let resp =
                        tiny_http::Response::from_string(r#"{"error":"sessionId is required"}"#)
                            .with_status_code(400)
                            .with_header(header)
                            .with_header(cors);
                    let _ = request.respond(resp);
                    continue;
                }

                let viewer_count = presentation_viewer_count(&session_id);
                let resp = tiny_http::Response::from_string(
                    serde_json::json!({ "viewerCount": viewer_count }).to_string(),
                )
                .with_header(header)
                .with_header(cors);
                let _ = request.respond(resp);
                continue;
            }

            // API: Open URL in system default browser
            // POST /api/open-url  { "url": "https://..." }
            // Used by the OBS dock (CEF) to open links in the real browser.
            if clean == "api/open-url" {
                let header = tiny_http::Header::from_bytes(
                    "Content-Type",
                    "application/json; charset=utf-8",
                )
                .unwrap();
                let cors =
                    tiny_http::Header::from_bytes("Access-Control-Allow-Origin", "*").unwrap();

                if request.method() == &tiny_http::Method::Options {
                    let resp = tiny_http::Response::from_string("")
                        .with_header(
                            tiny_http::Header::from_bytes(
                                "Access-Control-Allow-Methods",
                                "POST, OPTIONS",
                            )
                            .unwrap(),
                        )
                        .with_header(cors);
                    let _ = request.respond(resp);
                    continue;
                }

                if request.method() == &tiny_http::Method::Post {
                    let mut body = String::new();
                    if request.as_reader().read_to_string(&mut body).is_err() {
                        let resp = tiny_http::Response::from_string(r#"{"error":"Bad Request"}"#)
                            .with_status_code(400);
                        let _ = request.respond(resp);
                        continue;
                    }
                    let url: String = serde_json::from_str::<serde_json::Value>(&body)
                        .ok()
                        .and_then(|v| v.get("url").and_then(|u| u.as_str()).map(String::from))
                        .unwrap_or_default();

                    let ok = if url.starts_with("http://") || url.starts_with("https://") {
                        #[cfg(target_os = "macos")]
                        {
                            std::process::Command::new("open").arg(&url).spawn().is_ok()
                        }
                        #[cfg(target_os = "windows")]
                        {
                            hide_console(&mut std::process::Command::new("cmd"))
                                .args(["/c", "start", "", &url])
                                .spawn()
                                .is_ok()
                        }
                        #[cfg(target_os = "linux")]
                        {
                            std::process::Command::new("xdg-open")
                                .arg(&url)
                                .spawn()
                                .is_ok()
                        }
                    } else {
                        false
                    };

                    let resp_body = if ok {
                        r#"{"ok":true}"#
                    } else {
                        r#"{"ok":false,"error":"Failed to open URL"}"#
                    };
                    let resp = tiny_http::Response::from_string(resp_body)
                        .with_header(header)
                        .with_header(cors)
                        .with_status_code(if ok { 200 } else { 400 });
                    let _ = request.respond(resp);
                    continue;
                }

                let resp = tiny_http::Response::from_string(r#"{"error":"Method not allowed"}"#)
                    .with_status_code(405)
                    .with_header(header)
                    .with_header(cors);
                let _ = request.respond(resp);
                continue;
            }

            // API: Proxy a remote URL (GET only)
            // GET /api/proxy?url=https://... — fetches a remote URL and streams it back
            // Used by the OBS dock to download files without CORS issues.
            if clean == "api/proxy" {
                let cors =
                    tiny_http::Header::from_bytes("Access-Control-Allow-Origin", "*").unwrap();

                if request.method() == &tiny_http::Method::Options {
                    let resp = tiny_http::Response::from_string("")
                        .with_header(
                            tiny_http::Header::from_bytes(
                                "Access-Control-Allow-Methods",
                                "GET, OPTIONS",
                            )
                            .unwrap(),
                        )
                        .with_header(cors);
                    let _ = request.respond(resp);
                    continue;
                }

                // Extract ?url= parameter (use url_path which retains the query string — clean already had it stripped)
                let url = if let Some(qpos) = url_path.find('?') {
                    let qs = &url_path[qpos + 1..];
                    qs.split('&')
                        .find_map(|p| {
                            let (k, v) = p.split_once('=')?;
                            if k == "url" {
                                Some(urlencoding::decode(v).unwrap_or_default().into_owned())
                            } else {
                                None
                            }
                        })
                        .unwrap_or_default()
                } else {
                    String::new()
                };

                if !url.starts_with("http://") && !url.starts_with("https://") {
                    let resp = tiny_http::Response::from_string(r#"{"error":"Invalid URL"}"#)
                        .with_status_code(400)
                        .with_header(cors);
                    let _ = request.respond(resp);
                    continue;
                }

                // Fetch the remote URL server-side (no CORS) and stream back
                match reqwest::blocking::get(&url) {
                    Ok(resp) => {
                        let ct = resp
                            .headers()
                            .get("content-type")
                            .and_then(|v| v.to_str().ok())
                            .unwrap_or("application/octet-stream")
                            .to_string();
                        let bytes = resp.bytes().unwrap_or_default();
                        let ct_header =
                            tiny_http::Header::from_bytes("Content-Type", ct.as_str()).unwrap();
                        let resp = tiny_http::Response::from_data(bytes.to_vec())
                            .with_header(ct_header)
                            .with_header(cors);
                        let _ = request.respond(resp);
                    }
                    Err(_) => {
                        let resp =
                            tiny_http::Response::from_string(r#"{"error":"Proxy fetch failed"}"#)
                                .with_status_code(502)
                                .with_header(cors);
                        let _ = request.respond(resp);
                    }
                }
                continue;
            }

            // API: Clipboard text for the OBS Dock — GET /api/dock/clipboard-text
            // OBS's browser dock has no clipboard-read permission, and OBS takes
            // Ctrl/Cmd+V for itself, so the Dock's paste shortcut asks the app.
            // Loopback only, same-origin only (no CORS header), text only.
            if clean == "api/dock/clipboard-text" && request.method() == &tiny_http::Method::Get {
                let is_loopback = request
                    .remote_addr()
                    .map(|addr| addr.ip().is_loopback())
                    .unwrap_or(false);
                let origin_ok = match overlay_header_value(&request, "Origin") {
                    None => true,
                    Some(origin) => {
                        let origin = origin.trim_end_matches('/');
                        origin.starts_with("http://127.0.0.1:") || origin.starts_with("http://localhost:")
                    }
                };
                let content_type = overlay_header("Content-Type", "application/json; charset=utf-8");
                if !is_loopback || !origin_ok {
                    let resp = tiny_http::Response::from_string("{\"error\":\"forbidden\"}")
                        .with_status_code(403)
                        .with_header(content_type);
                    let _ = request.respond(resp);
                    continue;
                }
                #[cfg(not(any(target_os = "android", target_os = "ios")))]
                let text_result: Result<String, String> = arboard::Clipboard::new()
                    .and_then(|mut clipboard| clipboard.get_text())
                    .map_err(|error| error.to_string());
                #[cfg(any(target_os = "android", target_os = "ios"))]
                let text_result: Result<String, String> = Err("unsupported".to_string());
                let body = match text_result {
                    Ok(text) => serde_json::json!({ "text": text }),
                    Err(error) => serde_json::json!({ "text": "", "error": error }),
                };
                let resp = tiny_http::Response::from_string(body.to_string())
                    .with_header(content_type)
                    .with_header(overlay_header("Cache-Control", "no-store"));
                let _ = request.respond(resp);
                continue;
            }

            // API: Auth status — GET /api/auth/status
            // Returns the full stored session (user with plan, deviceId, expiresAt).
            // The dock reads the plan from here for entitlement checks.
            if clean == "api/auth/status" {
                let header = tiny_http::Header::from_bytes(
                    "Content-Type",
                    "application/json; charset=utf-8",
                )
                .unwrap();
                let cors =
                    tiny_http::Header::from_bytes("Access-Control-Allow-Origin", "*").unwrap();
                let json = overlay_auth_status_json();

                let resp = tiny_http::Response::from_string(json)
                    .with_header(header)
                    .with_header(cors);
                let _ = request.respond(resp);
                continue;
            }

            // API: Save auth session — POST /api/auth/session
            // Body: JSON with user/deviceId/expiresAt, or empty body to clear.
            // Stores in memory only — no filesystem. The dock reads this via
            // GET /api/auth/status and verifies against the live backend.
            if clean == "api/auth/session" {
                let header = tiny_http::Header::from_bytes(
                    "Content-Type",
                    "application/json; charset=utf-8",
                )
                .unwrap();
                let cors =
                    tiny_http::Header::from_bytes("Access-Control-Allow-Origin", "*").unwrap();

                if request.method() == &tiny_http::Method::Options {
                    let resp = tiny_http::Response::from_string("")
                        .with_header(
                            tiny_http::Header::from_bytes(
                                "Access-Control-Allow-Methods",
                                "POST, OPTIONS",
                            )
                            .unwrap(),
                        )
                        .with_header(
                            tiny_http::Header::from_bytes(
                                "Access-Control-Allow-Headers",
                                "Content-Type",
                            )
                            .unwrap(),
                        )
                        .with_header(cors);
                    let _ = request.respond(resp);
                    continue;
                }

                let mut body = String::new();
                let has_body = request.as_reader().read_to_string(&mut body).is_ok()
                    && !body.trim().is_empty();
                let is_clear = body.contains(r#""clear""#);

                let mem_store = AUTH_SESSION.get_or_init(|| Mutex::new(None));
                {
                    let mut guard = mem_store.lock().unwrap();
                    if has_body && !is_clear {
                        *guard = Some(body);
                    } else {
                        *guard = None;
                    }
                }

                let resp = tiny_http::Response::from_string(r#"{"ok":true}"#)
                    .with_header(header)
                    .with_header(cors);
                let _ = request.respond(resp);
                continue;
            }

            // YouTube requires an HTTP Referer (or equivalent app identity)
            // for embedded playback. The desktop WebView uses Tauri's
            // custom protocol, so serve a tiny local HTTP wrapper around the
            // YouTube iframe. The wrapper's HTTP origin gives YouTube the
            // required referrer while keeping the tutorial inside onboarding.
            if clean == "youtube-tutorial" {
                let query = url_path
                    .split_once('?')
                    .map(|(_, value)| value)
                    .unwrap_or_default();
                let mut video_id = String::new();
                let mut start_at = 0u64;
                for pair in query.split('&') {
                    let Some((key, value)) = pair.split_once('=') else {
                        continue;
                    };
                    let decoded = urlencoding::decode(value).unwrap_or_default().into_owned();
                    match key {
                        "video" => video_id = decoded,
                        "start" => start_at = decoded.parse::<u64>().unwrap_or(0),
                        _ => {}
                    }
                }

                let valid_video_id = !video_id.is_empty()
                    && video_id.chars().all(|character| {
                        character.is_ascii_alphanumeric() || character == '-' || character == '_'
                    });
                if !valid_video_id {
                    let resp = tiny_http::Response::from_string("Invalid tutorial video")
                        .with_status_code(400)
                        .with_header(overlay_header("Access-Control-Allow-Origin", "*"));
                    let _ = request.respond(resp);
                    continue;
                }

                let youtube_url = format!(
                    "https://www.youtube-nocookie.com/embed/{}?autoplay=1&mute=1&playsinline=1&rel=0&modestbranding=1&start={}",
                    video_id, start_at
                );
                let body = format!(
                    r#"<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="strict-origin-when-cross-origin">
  <title>MakeChurchEazy Tutorial</title>
  <style>
    html, body {{ width: 100%; height: 100%; margin: 0; background: #020617; overflow: hidden; }}
    iframe {{ display: block; width: 100%; height: 100%; border: 0; }}
  </style>
</head>
<body>
  <iframe
    src="{}"
    title="MakeChurchEazy tutorial"
    allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
    referrerpolicy="strict-origin-when-cross-origin"
    allowfullscreen
  ></iframe>
</body>
</html>"#,
                    youtube_url
                );
                let resp = tiny_http::Response::from_string(body)
                    .with_header(overlay_header("Content-Type", "text/html; charset=utf-8"))
                    .with_header(overlay_header(
                        "Content-Security-Policy",
                        "default-src 'none'; style-src 'unsafe-inline'; frame-src https://www.youtube-nocookie.com https://www.youtube.com;",
                    ))
                    .with_header(overlay_header("Access-Control-Allow-Origin", "*"));
                let _ = request.respond(resp);
                continue;
            }

            // Resolve file path — check uploads dir for /uploads/* requests,
            // otherwise serve from the resource dir (public/)
            let mut file_path = if clean == "mobile" || clean == "mobile/" {
                resource_dir.join("mobile").join("index.html")
            } else if clean.starts_with("uploads/") {
                if let Some(ref udir) = uploads_dir {
                    // Strip the "uploads/" prefix and serve from uploads dir
                    let rel = clean.strip_prefix("uploads/").unwrap_or(clean);
                    let rel_path = Path::new(rel);
                    if !is_safe_relative_path(rel_path) {
                        let resp = tiny_http::Response::from_string("Forbidden")
                            .with_status_code(403)
                            .with_header(
                                tiny_http::Header::from_bytes("Access-Control-Allow-Origin", "*")
                                    .unwrap(),
                            );
                        let _ = request.respond(resp);
                        continue;
                    }
                    match media_refs::resolve_reference_name(rel) {
                        Some(original) if media_refs::is_reference_name(rel) => original,
                        _ => udir.join(rel_path),
                    }
                } else {
                    resource_dir.join(clean)
                }
            } else {
                resource_dir.join(clean)
            };

            // Flutter's client-side routes must resolve back to the PWA entry
            // point when opened directly from Safari or from a Home Screen
            // shortcut (for example /mobile/connection).
            if clean.starts_with("mobile/") && (!file_path.exists() || !file_path.is_file()) {
                let mobile_index = resource_dir.join("mobile").join("index.html");
                if mobile_index.is_file() {
                    file_path = mobile_index;
                }
            }

            // Extensionless URL resolution: if the file doesn't exist and
            // has no extension, try appending .html (e.g. /dock → dock.html)
            if !file_path.exists() && file_path.extension().is_none() {
                let with_html = file_path.with_extension("html");
                if with_html.exists() && with_html.is_file() {
                    file_path = with_html;
                }
            }

            // Dev fallback: if the file wasn't found in resource_dir (public/)
            // but a matching Vite multi-page entry exists in the project root
            // (e.g. dock.html), redirect to the Vite dev server so it can
            // properly transform TSX/CSS imports.
            if !file_path.exists() || !file_path.is_file() {
                if let Some(ref root) = project_root_dir {
                    let mut root_candidate = root.join(clean);
                    if !root_candidate.exists() && root_candidate.extension().is_none() {
                        let with_html = root_candidate.with_extension("html");
                        if with_html.exists() && with_html.is_file() {
                            root_candidate = with_html;
                        }
                    }
                    if root_candidate.exists() && root_candidate.is_file() {
                        let is_html_entry = root_candidate
                            .extension()
                            .and_then(|ext| ext.to_str())
                            .map(|ext| ext.eq_ignore_ascii_case("html"))
                            .unwrap_or(false);
                        if is_html_entry
                            && !overlay_is_allowed_app_document(clean)
                            && !overlay_has_active_auth_session()
                        {
                            respond_overlay_auth_blocked(request);
                            continue;
                        }

                        // Redirect to Vite dev server so it handles
                        // module transforms, HMR, etc. Always use 127.0.0.1 to stay static and avoid IPv6 ::1 rejection on macOS.
                        let redirect_url = format!("http://127.0.0.1:1420/{}", clean);
                        let header = overlay_header("Location", redirect_url.as_str());
                        let cors = overlay_header("Access-Control-Allow-Origin", "*");
                        let resp =
                            tiny_http::Response::from_string("Redirecting to Vite dev server")
                                .with_status_code(302)
                                .with_header(header)
                                .with_header(cors)
                                .with_header(overlay_header(
                                    "Cache-Control",
                                    "no-store, no-cache, must-revalidate, max-age=0",
                                ))
                                .with_header(overlay_header("Pragma", "no-cache"))
                                .with_header(overlay_header("Expires", "0"));
                        let _ = request.respond(resp);
                        continue;
                    }
                }
            }

            if file_path.exists() && file_path.is_file() {
                let content_type = overlay_content_type_for_extension(
                    file_path.extension().and_then(|e| e.to_str()),
                );
                if content_type.starts_with("text/html")
                    && !overlay_is_allowed_app_document(clean)
                    && !overlay_has_active_auth_session()
                {
                    respond_overlay_auth_blocked(request);
                    continue;
                }
                // Stream on its own thread: a playing video keeps its response
                // open for minutes and must not stall every other request.
                std::thread::spawn(move || {
                    respond_overlay_file_request(request, &file_path, content_type);
                });
            } else if Path::new(clean).extension().is_some() {
                // Request has a file extension (e.g. .json, .png) but the
                // file doesn't exist — return 404 instead of SPA fallback.
                let resp = tiny_http::Response::from_string("Not Found")
                    .with_status_code(404)
                    .with_header(
                        tiny_http::Header::from_bytes("Access-Control-Allow-Origin", "*").unwrap(),
                    );
                let _ = request.respond(resp);
            } else {
                // SPA fallback: for client-side routes (no extension), serve
                // index.html so React Router can handle them. Note: dedicated
                // HTML files (like dock.html) are resolved above via the .html
                // extension fallback, so this only triggers for true SPA routes.
                let index_path = resource_dir.join("index.html");
                if index_path.exists() && index_path.is_file() {
                    match fs::read(&index_path) {
                        Ok(data) => {
                            let header = overlay_header("Content-Type", "text/html; charset=utf-8");
                            let cors = overlay_header("Access-Control-Allow-Origin", "*");
                            let resp = tiny_http::Response::from_data(data)
                                .with_header(header)
                                .with_header(cors)
                                .with_header(overlay_header(
                                    "Cache-Control",
                                    "no-store, no-cache, must-revalidate, max-age=0",
                                ))
                                .with_header(overlay_header("Pragma", "no-cache"))
                                .with_header(overlay_header("Expires", "0"));
                            let _ = request.respond(resp);
                        }
                        Err(_) => {
                            let resp = tiny_http::Response::from_string("Internal Server Error")
                                .with_status_code(500)
                                .with_header(
                                    tiny_http::Header::from_bytes(
                                        "Access-Control-Allow-Origin",
                                        "*",
                                    )
                                    .unwrap(),
                                );
                            let _ = request.respond(resp);
                        }
                    }
                } else {
                    let resp = tiny_http::Response::from_string("Not Found")
                        .with_status_code(404)
                        .with_header(
                            tiny_http::Header::from_bytes("Access-Control-Allow-Origin", "*")
                                .unwrap(),
                        );
                    let _ = request.respond(resp);
                }
            }
        }
    });

    CANONICAL_OVERLAY_PORT
}

// ── Dynamic App Icon ─────────────────────────────────────────────────────────
// Changes the macOS dock icon at runtime to reflect application state
// (OBS connection, Speech-to-Scripture listening).
//
// The actual AppKit calls live in `macos_icon.m` (compiled via build.rs / `cc`)
// so that Objective-C exceptions are caught by @try/@catch *before* they can
// cross any Rust `catch_unwind` boundary (which would abort the process with
// "Rust cannot catch foreign exceptions").

#[cfg(target_os = "macos")]
mod app_icon {
    use std::fs;
    use std::path::PathBuf;
    use tauri::Manager;

    extern "C" {
        /// Defined in macos_icon.m.  Returns true on success.
        fn mce_set_app_icon(data: *const u8, len: usize) -> bool;
    }

    fn candidate_icon_names(filename: &str) -> Vec<String> {
        let mut names = Vec::new();

        #[cfg(debug_assertions)]
        if let Some((stem, ext)) = filename.rsplit_once('.') {
            names.push(format!("{stem}-dev.{ext}"));
        }

        names.push(filename.to_string());
        names
    }

    /// Resolve the absolute path to an icon file inside `app_icons/`.
    ///
    /// Resolution order:
    ///   1. `<resource_dir>/app_icons/<filename>`   (bundled production app)
    ///   2. `<project>/public/app_icons/<filename>`  (Vite dev server)
    fn resolve_icon_path(app: &tauri::AppHandle, filename: &str) -> Option<PathBuf> {
        let icon_names = candidate_icon_names(filename);

        // Bundled production path
        if let Ok(resource_dir) = app.path().resource_dir() {
            let candidate_dirs = [
                resource_dir.join("app_icons"),
                resource_dir.join("resources").join("app_icons"),
                resource_dir.join("dist").join("app_icons"),
                resource_dir.join("_up_").join("dist").join("app_icons"),
            ];

            for dir in &candidate_dirs {
                for icon_name in &icon_names {
                    let path = dir.join(icon_name);
                    println!(
                        "[AppIcon] Checking bundled path: {:?} exists={}",
                        path,
                        path.exists()
                    );
                    if path.exists() {
                        return Some(path);
                    }
                }
            }
        }

        // Dev fallback — walk up from executable to project root
        if let Ok(exe) = std::env::current_exe() {
            if let Some(project_root) = exe
                .parent() // target/{debug|release}
                .and_then(|p| p.parent()) // target
                .and_then(|p| p.parent()) // src-tauri
                .and_then(|p| p.parent())
            // project root
            {
                for icon_name in &icon_names {
                    let path = project_root
                        .join("public")
                        .join("app_icons")
                        .join(icon_name);
                    println!(
                        "[AppIcon] Checking dev fallback: {:?} exists={}",
                        path,
                        path.exists()
                    );
                    if path.exists() {
                        return Some(path);
                    }
                }
            }
        }

        println!(
            "[AppIcon] Icon not found: {} (candidates: {:?})",
            filename, icon_names
        );
        None
    }

    /// Tauri command: set the macOS dock icon from a bundled icon file.
    ///
    /// `icon_name` should be one of the known filenames (e.g. "app_icon_general.png").
    /// Returns `Ok(true)` on success, `Ok(false)` if the file was not found,
    /// or `Err(...)` if the native API call failed.
    #[tauri::command]
    pub async fn set_app_icon(app: tauri::AppHandle, icon_name: String) -> Result<bool, String> {
        println!(
            "[AppIcon] set_app_icon called with icon_name: {}",
            icon_name
        );

        let path = resolve_icon_path(&app, &icon_name)
            .ok_or_else(|| format!("Icon file not found: {}", icon_name))?;

        let data = fs::read(&path)
            .map_err(|e| format!("Failed to read icon file {}: {}", path.display(), e))?;

        // Validate with the `image` crate as an extra safety net.
        image::load_from_memory(&data)
            .map_err(|e| format!("Invalid image data in {}: {}", path.display(), e))?;

        // Call the ObjC helper (in macos_icon.m) which has @try/@catch.
        // This runs on the Tokio worker thread, but that's fine — the helper
        // is a plain C function that won't propagate ObjC exceptions into Rust.
        let success = unsafe { mce_set_app_icon(data.as_ptr(), data.len()) };

        if success {
            println!("[AppIcon] Icon set successfully: {}", icon_name);
            Ok(true)
        } else {
            println!(
                "[AppIcon] mce_set_app_icon returned false for: {}",
                icon_name
            );
            Ok(false)
        }
    }
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
async fn set_app_icon(_icon_name: String) -> Result<bool, String> {
    // Dynamic icon switching not supported on this platform
    Ok(false)
}

// ── Mobile Companion Commands ───────────────────────────────────────────────

/// Return stable pairing info for the QR code.
#[tauri::command]
async fn get_mobile_pairing_info() -> Result<serde_json::Value, String> {
    let token = mobile_companion::get_or_create_pairing_token().await;
    let port = mobile_companion::mobile_server_port();

    // Get local IP addresses
    let local_ip = get_local_ip().unwrap_or_else(|| "127.0.0.1".to_string());

    Ok(serde_json::json!({
        "version": 1,
        "ip": local_ip,
        "port": port,
        "wsPort": port,
        "apiPort": OVERLAY_PORT.load(Ordering::Relaxed),
        "pairingToken": token,
    }))
}

#[tauri::command]
async fn complete_mobile_command(
    command_id: String,
    ok: bool,
    payload: Option<serde_json::Value>,
    error: Option<String>,
) -> Result<(), String> {
    mobile_companion::complete_mobile_command(
        command_id,
        mobile_companion::MobileCommandCompletion {
            ok,
            payload: payload.unwrap_or(serde_json::Value::Null),
            error,
        },
    )
    .await
}

#[tauri::command]
async fn set_mobile_access_policy(
    allowed: bool,
    plan: String,
    reason: Option<String>,
) -> Result<(), String> {
    mobile_companion::set_mobile_access_policy(allowed, plan, reason).await;
    Ok(())
}

/// Called by the dock when it connects to OBS — provides credentials
/// so the mobile companion server can also connect to OBS.
#[tauri::command]
async fn save_obs_connection_for_mobile(url: String, password: String) -> Result<(), String> {
    mobile_companion::set_obs_connection(mobile_companion::ObsConnectionInfo { url, password })
        .await;
    Ok(())
}

/// Get the current mobile server status.
#[tauri::command]
async fn get_mobile_server_status() -> Result<serde_json::Value, String> {
    let port = mobile_companion::mobile_server_port();
    let token = mobile_companion::get_pairing_token().await;
    let state = mobile_companion::get_mobile_state().await;

    Ok(serde_json::json!({
        "running": port > 0,
        "port": port,
        "hasToken": token.is_some(),
        "obsConnected": state.obs_connected,
        "currentSong": state.current_song,
        "currentScripture": state.current_scripture,
    }))
}

/// Get the LAN-accessible presentation viewer URL and transport details.
#[tauri::command]
async fn get_presentation_remote_info(session_id: String) -> Result<serde_json::Value, String> {
    let session_id = session_id.trim();
    if session_id.is_empty() {
        return Err("sessionId is required".to_string());
    }

    let http_port = presentation_remote::http_port();
    let ws_port = presentation_remote::ws_port();
    if http_port == 0 {
        return Err("Presentation viewer server is not running".to_string());
    }

    let encoded_session = urlencoding::encode(session_id);
    let local_ip = get_local_ip().unwrap_or_else(|| "127.0.0.1".to_string());
    let local_link = format!("http://127.0.0.1:{}/p/{}", http_port, encoded_session);
    let link = format!("http://{}:{}/p/{}", local_ip, http_port, encoded_session);

    Ok(serde_json::json!({
        "running": http_port > 0 && ws_port > 0,
        "ip": local_ip,
        "httpPort": http_port,
        "wsPort": ws_port,
        "link": link,
        "localLink": local_link,
    }))
}

/// Get local IP addresses (first non-loopback IPv4).
fn get_local_ip() -> Option<String> {
    if let Ok(socket) = UdpSocket::bind("0.0.0.0:0") {
        for target in [
            "8.8.8.8:80",
            "1.1.1.1:80",
            "192.168.1.1:80",
            "10.0.0.1:80",
            "172.16.0.1:80",
        ] {
            if socket.connect(target).is_ok() {
                if let Ok(addr) = socket.local_addr() {
                    let ip = addr.ip();
                    if !ip.is_loopback() && !ip.is_unspecified() {
                        return Some(ip.to_string());
                    }
                }
            }
        }
    }
    None
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RemoteObsCandidate {
    host: String,
    port: u16,
    url: String,
    label: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RemoteObsDiscoveryResult {
    local_ip: String,
    subnet: String,
    port: u16,
    candidates: Vec<RemoteObsCandidate>,
}

fn host_is_reachable(host: &str, port: u16, timeout_ms: u64) -> bool {
    let socket_addr = match format!("{}:{}", host, port).parse::<SocketAddr>() {
        Ok(addr) => addr,
        Err(_) => return false,
    };

    TcpStream::connect_timeout(&socket_addr, Duration::from_millis(timeout_ms)).is_ok()
}

fn subnet_prefix_from_ip(ip: &str) -> Option<String> {
    let mut parts = ip.split('.');
    let a = parts.next()?;
    let b = parts.next()?;
    let c = parts.next()?;
    let d = parts.next()?;
    if parts.next().is_some() || d.parse::<u8>().is_err() {
        return None;
    }
    Some(format!("{}.{}.{}", a, b, c))
}

/// Discover likely OBS WebSocket servers on the same /24 LAN subnet.
///
/// This intentionally checks only the local subnet and the selected port.
/// The final OBS authentication still happens in the frontend when the user
/// clicks a candidate and supplies the OBS password if required.
#[tauri::command]
async fn discover_remote_obs_hosts(port: Option<u16>) -> Result<RemoteObsDiscoveryResult, String> {
    let port = port.unwrap_or(4455);
    let local_ip =
        get_local_ip().ok_or_else(|| "Could not determine this computer's LAN IP".to_string())?;
    let subnet = subnet_prefix_from_ip(&local_ip)
        .ok_or_else(|| format!("Unsupported LAN IP address: {}", local_ip))?;
    let local_suffix = local_ip
        .split('.')
        .last()
        .and_then(|value| value.parse::<u8>().ok());

    let (tx, rx) = mpsc::channel::<RemoteObsCandidate>();
    let mut handles = Vec::new();
    let timeout_ms = 260;
    let chunk_size = 16usize;

    for chunk_start in (1u16..=254u16).step_by(chunk_size) {
        let tx = tx.clone();
        let subnet = subnet.clone();
        let local_suffix = local_suffix;
        let chunk_end = (chunk_start + chunk_size as u16 - 1).min(254);

        handles.push(std::thread::spawn(move || {
            for suffix in chunk_start..=chunk_end {
                if Some(suffix as u8) == local_suffix {
                    continue;
                }

                let host = format!("{}.{}", subnet, suffix);
                if host_is_reachable(&host, port, timeout_ms) {
                    let _ = tx.send(RemoteObsCandidate {
                        label: format!("OBS candidate at {}", host),
                        url: format!("ws://{}:{}", host, port),
                        host,
                        port,
                    });
                }
            }
        }));
    }

    drop(tx);

    for handle in handles {
        let _ = handle.join();
    }

    let mut candidates: Vec<RemoteObsCandidate> = rx.try_iter().collect();
    candidates.sort_by(|a, b| {
        let a_suffix = a
            .host
            .split('.')
            .last()
            .and_then(|value| value.parse::<u16>().ok())
            .unwrap_or(0);
        let b_suffix = b
            .host
            .split('.')
            .last()
            .and_then(|value| value.parse::<u16>().ok())
            .unwrap_or(0);
        a_suffix.cmp(&b_suffix)
    });

    Ok(RemoteObsDiscoveryResult {
        local_ip,
        subnet: format!("{}.0/24", subnet),
        port,
        candidates,
    })
}

#[tauri::command]
fn close_app_confirmed(app: tauri::AppHandle) {
    app.exit(0);
}

/// Set by the frontend while an app update is downloading or downloaded and
/// waiting to install. The main-window close handler then asks the frontend
/// (warn about the download, or install the update on the way out) instead of
/// exiting immediately.
static UPDATE_CLOSE_GUARD: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

#[tauri::command]
fn set_update_close_guard(active: bool) {
    UPDATE_CLOSE_GUARD.store(active, std::sync::atomic::Ordering::SeqCst);
}

/// Where the running app bundle lives and whether the in-app updater can
/// replace it. The Tauri updater swaps the bundle with a plain rename, which
/// fails on a read-only location (opened straight from the DMG, or macOS App
/// Translocation after launching from Downloads) without ever asking for an
/// admin password.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateInstallLocation {
    bundle_path: String,
    /// "ok" | "translocated" | "disk_image" | "not_writable"
    status: String,
    /// The bundle belongs to another user; macOS will ask for an admin password.
    needs_admin: bool,
}

#[tauri::command]
fn get_update_install_location() -> Result<UpdateInstallLocation, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let mut bundle = exe.clone();
    if cfg!(target_os = "macos") {
        if let Some(app) = exe.ancestors().find(|p| p.extension().map_or(false, |e| e == "app")) {
            bundle = app.to_path_buf();
        }
    }
    let bundle_path = bundle.display().to_string();
    let mut location = UpdateInstallLocation { bundle_path: bundle_path.clone(), status: "ok".into(), needs_admin: false };
    if !cfg!(target_os = "macos") {
        return Ok(location);
    }
    if bundle_path.contains("/AppTranslocation/") {
        location.status = "translocated".into();
        return Ok(location);
    }
    if bundle_path.starts_with("/Volumes/") {
        location.status = "disk_image".into();
        return Ok(location);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let Some(parent) = bundle.parent() else { return Ok(location) };
        let probe = parent.join(format!(".mce-update-probe-{}", std::process::id()));
        match std::fs::OpenOptions::new().write(true).create_new(true).open(&probe) {
            Ok(_) => {
                let my_uid = std::fs::metadata(&probe).map(|m| m.uid()).ok();
                let _ = std::fs::remove_file(&probe);
                let owner = std::fs::metadata(&bundle).map(|m| m.uid()).ok();
                location.needs_admin = matches!((my_uid, owner), (Some(a), Some(b)) if a != b);
            }
            Err(e) if e.raw_os_error() == Some(30) => location.status = "disk_image".into(), // EROFS
            Err(_) => location.needs_admin = true,
        }
    }
    Ok(location)
}

/// Opens an installer the updater downloaded into the temp folder (DMG, EXE,
/// MSI...). The JS shell `open` cannot do this: its default scope only allows
/// http(s)/mailto/tel, so the installer fallback always failed with
/// "Update failed" (that is what stranded v3.33 users).
#[tauri::command]
fn open_downloaded_installer(path: String) -> Result<(), String> {
    let file = std::fs::canonicalize(&path).map_err(|e| format!("Installer not found: {e}"))?;
    let temp = std::fs::canonicalize(std::env::temp_dir()).map_err(|e| e.to_string())?;
    if !file.starts_with(&temp) {
        return Err("Refusing to open an installer outside the temp folder".into());
    }
    let ext = file.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    if !["dmg", "exe", "msi", "appimage", "deb"].contains(&ext.as_str()) {
        return Err(format!("Unsupported installer type: .{ext}"));
    }
    #[cfg(target_os = "macos")]
    let mut cmd = std::process::Command::new("open");
    #[cfg(target_os = "windows")]
    let mut cmd = std::process::Command::new("explorer");
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut cmd = std::process::Command::new("xdg-open");
    cmd.arg(&file).spawn().map_err(|e| format!("Could not open the installer: {e}"))?;
    Ok(())
}

/// Appends one line to the app's updater log so a failed update can be
/// diagnosed on a user's machine (macOS: ~/Library/Logs/com.makechurcheasy.desktop/updater.log).
#[tauri::command]
fn append_update_log(app: tauri::AppHandle, line: String) -> Result<(), String> {
    use std::io::Write;
    let dir = app.path().app_log_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("updater.log");
    // Keep the file small: start over past 1 MB.
    if std::fs::metadata(&path).map(|m| m.len() > 1_000_000).unwrap_or(false) {
        let _ = std::fs::remove_file(&path);
    }
    let mut file = std::fs::OpenOptions::new().create(true).append(true).open(&path).map_err(|e| e.to_string())?;
    let line: String = line.chars().take(4000).collect();
    writeln!(file, "{} {}", Utc::now().to_rfc3339(), line.replace('\n', " ")).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
/// Opens a Presentation Studio projector window from Rust.
///
/// Windows created from JavaScript get WebView2 settings that differ from the
/// main window's `additionalBrowserArgs`, and WebView2 refuses to run two
/// differently-configured webviews on the same profile, so on some PCs the
/// projector window died a second after opening. Building it here with the
/// main window's exact browser arguments lets it share the main window's
/// WebView2 profile and browser process (which also uses less memory).
#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn open_studio_projector(
    app: tauri::AppHandle,
    label: String,
    url: String,
    title: String,
    width: f64,
    height: f64,
    x: Option<f64>,
    y: Option<f64>,
    decorations: bool,
    visible: bool,
    focus: bool,
    always_on_top: bool,
) -> Result<(), String> {
    if !label.starts_with("studio-projector-") {
        return Err("Invalid projector label".to_string());
    }
    let parsed: tauri::Url = url.parse().map_err(|e| format!("Bad projector URL: {e}"))?;
    let mut builder =
        tauri::WebviewWindowBuilder::new(&app, &label, tauri::WebviewUrl::External(parsed))
            .title(title)
            .inner_size(width, height)
            .min_inner_size(320.0, 180.0)
            .resizable(true)
            .decorations(decorations)
            .visible(visible)
            .focused(focus)
            .always_on_top(always_on_top);
    builder = match (x, y) {
        (Some(x), Some(y)) => builder.position(x, y),
        _ => builder.center(),
    };
    #[cfg(windows)]
    {
        // Custom WebView2 arguments replace Wry's defaults; keep its no-gesture media policy.
        let main_args = app
            .config()
            .app
            .windows
            .iter()
            .find(|w| w.label == "main")
            .and_then(|w| w.additional_browser_args.clone());
        if let Some(args) = main_args {
            builder = builder.additional_browser_args(&args);
        }
    }
    builder.build().map_err(|e| {
        eprintln!("[Studio] Projector window {} failed: {}", label, e);
        format!("The projector could not be opened: {e}")
    })?;
    println!("[Studio] Projector window {} opened", label);
    Ok(())
}

pub fn run() {
    // Load .env file so Rust commands can read env vars (e.g. OPENCODE_API_KEY)
    dotenvy::dotenv().ok();

    // Must run before any webview is created (it moves WebView storage too).
    sandbox_migration::migrate_from_sandbox_container("com.makechurcheasy.desktop");

    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let _ = SAVE_DIALOG_APP.set(app.handle().clone());
            // Resolve the directory where overlay HTML files live.
            //
            // Bundled app:
            //   resource_dir() may be:
            //   - .../Contents/Resources/
            //   - .../Contents/Resources/dist/
            //   - .../Contents/Resources/_up_/dist/
            //
            // Local dev:
            //   fall back to <project>/public/.
            let resource_dir = app
                .path()
                .resource_dir()
                .unwrap_or_else(|_| std::path::PathBuf::from("."));

            match local_llm::seed_local_llm_model_from_bundle(&resource_dir) {
                Ok(true) => println!("[Tauri] Local LLM model ready."),
                Ok(false) => println!("[Tauri] No bundled local LLM model found."),
                Err(error) => eprintln!("[Tauri] Failed to seed local LLM model: {}", error),
            }

            // In debug/dev mode, serve the live project `public/` directory
            // first. A stale copied `target/**/dist` directory can otherwise
            // win this lookup and make OBS keep rendering an older overlay
            // (including the removed loading screen and verse transition).
            let serve_dir = if cfg!(debug_assertions) {
                resolve_dev_public_dir()
                    .or_else(|| resolve_bundled_overlay_dir(&resource_dir))
                    .unwrap_or(resource_dir.clone())
            } else {
                resolve_bundled_overlay_dir(&resource_dir)
                    .or_else(resolve_dev_public_dir)
                    .unwrap_or(resource_dir.clone())
            };

            println!("[Tauri] Overlay resource dir : {:?}", resource_dir);
            println!("[Tauri] Overlay serve dir    : {:?}", serve_dir);
            println!("[Tauri] serve dir exists?     {}", serve_dir.exists());
            println!(
                "[Tauri] has overlay assets?   {}",
                has_overlay_assets(&serve_dir)
            );

            // Log what files are actually in the serve directory
            if serve_dir.exists() {
                if let Ok(entries) = fs::read_dir(&serve_dir) {
                    let names: Vec<String> = entries
                        .filter_map(|e| e.ok())
                        .map(|e| e.file_name().to_string_lossy().to_string())
                        .collect();
                    println!(
                        "[Tauri] serve dir contents ({} entries): {:?}",
                        names.len(),
                        &names[..names.len().min(20)]
                    );
                }
            }

            let overlay_port = start_overlay_server(serve_dir);
            println!("[Tauri] Overlay server started on port {}", overlay_port);

            let presentation_uploads_dir = app_dir().ok().map(|dir| dir.join("uploads"));
            let presentation_http_port =
                presentation_remote::start_presentation_http_server(presentation_uploads_dir);
            println!(
                "[Tauri] Presentation viewer server started on port {}",
                presentation_http_port
            );

            app.manage(audio_capture::AudioCaptureState::default());
            app.manage(assemblyai_stream::AssemblyAiStreamState::default());
            // Stops Voice AI when the screen turns off or nobody confirms after a long silence.
            voice_guard::init(app.handle());

            if let Some(window) = app.get_webview_window("main") {
                if let Some(icon) = dev_window_icon() {
                    let _ = window.set_icon(icon);
                }
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
                println!("[Tauri] Main window 'main' found and shown.");
            } else {
                eprintln!("[Tauri] Main window 'main' not found via get_webview_window, checking all windows...");
                for (lbl, win) in app.webview_windows() {
                    println!("[Tauri] Showing window: {}", lbl);
                    let _ = win.unminimize();
                    let _ = win.show();
                    let _ = win.set_focus();
                }
            }

            #[cfg(all(target_os = "macos", debug_assertions))]
            {
                let app_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(error) =
                        app_icon::set_app_icon(app_handle, "app_icon_general.png".to_string()).await
                    {
                        eprintln!("[AppIcon] Failed to apply dev startup icon: {}", error);
                    }
                });
            }

            // Prevent macOS App Nap — keeps audio capture and transcription
            // running reliably when the app is in the background.
            #[cfg(target_os = "macos")]
            app_nap::prevent_app_nap();

            // Start the mobile companion WebSocket server
            let mobile_port = 8765u16;
            let mobile_app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let _ = mobile_companion::get_or_create_pairing_token().await;
                if let Err(e) =
                    mobile_companion::start_mobile_server(
                        mobile_port,
                        overlay_port,
                        mobile_app_handle,
                    )
                    .await
                {
                    eprintln!("[MobileCompanion] Server failed: {}", e);
                }
            });
            println!(
                "[Tauri] Mobile companion server starting on port {}",
                mobile_port
            );

            tauri::async_runtime::spawn(async move {
                if let Err(error) =
                    presentation_remote::start_presentation_ws_server(Some(8766)).await
                {
                    eprintln!("[PresentationRemote] WebSocket server failed: {}", error);
                }
            });
            println!("[Tauri] Presentation WebSocket server starting on port 8766");

            // Start the overlay relay for instant dock-to-overlay communication
            tauri::async_runtime::spawn(async move {
                if let Err(error) = overlay_relay::start_overlay_relay(17891).await {
                    eprintln!("[OverlayRelay] Server failed: {}", error);
                }
            });
            println!("[Tauri] Overlay relay starting on port 17891");

            // macOS menu-bar controls for the main MakeChurchEazy window.
            let show_item = tauri::menu::MenuItem::with_id(
                app,
                "show-main-window",
                "Show MakeChurchEazy",
                true,
                None::<&str>,
            )?;
            let settings_item = tauri::menu::MenuItem::with_id(
                app,
                "show-settings",
                "Show Settings",
                true,
                None::<&str>,
            )?;
            let separator = tauri::menu::PredefinedMenuItem::separator(app)?;
            let quit_item = tauri::menu::MenuItem::with_id(
                app,
                "quit-makechurcheasy",
                "Quit MakeChurchEazy",
                true,
                None::<&str>,
            )?;
            let tray_menu = tauri::menu::Menu::with_items(
                app,
                &[&show_item, &settings_item, &separator, &quit_item],
            )?;

            #[cfg(target_os = "windows")]
            let tray_icon = Image::from_bytes(include_bytes!("../icons/16x16.png"))
                .expect("bundled MakeChurchEazy tray icon must be valid PNG");
            // macOS template icons keep only the alpha channel, so the opaque app
            // icon would show as a solid white square. Use the glyph-only version.
            #[cfg(target_os = "macos")]
            let tray_icon = Image::from_bytes(include_bytes!("../icons/tray-template.png"))
                .expect("bundled MakeChurchEazy tray icon must be valid PNG");
            #[cfg(not(any(target_os = "windows", target_os = "macos")))]
            let tray_icon = Image::from_bytes(include_bytes!("../icons/32x32.png"))
                .expect("bundled MakeChurchEazy tray icon must be valid PNG");
            let _tray = tauri::tray::TrayIconBuilder::with_id("makechurcheasy-tray")
                .icon(tray_icon)
                .icon_as_template(cfg!(target_os = "macos"))
                .tooltip("MakeChurchEazy")
                .menu(&tray_menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show-main-window" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.unminimize();
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "show-settings" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.unminimize();
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                        let _ = app.emit("open-settings", ());
                    }
                    "quit-makechurcheasy" => {
                        let is_streaming = app
                            .try_state::<assemblyai_stream::AssemblyAiStreamState>()
                            .map(|s| s.is_streaming())
                            .unwrap_or(false);
                        if is_streaming {
                            if let Some(main_win) = app.get_webview_window("main") {
                                let _ = main_win.unminimize();
                                let _ = main_win.show();
                                let _ = main_win.set_focus();
                                let _ = main_win.emit("verse-ai-close-requested", ());
                                return;
                            }
                        }
                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    if UPDATE_CLOSE_GUARD.load(std::sync::atomic::Ordering::SeqCst) {
                        api.prevent_close();
                        let _ = window.emit("update-close-requested", ());
                        return;
                    }

                    let is_streaming = window
                        .app_handle()
                        .try_state::<assemblyai_stream::AssemblyAiStreamState>()
                        .map(|s| s.is_streaming())
                        .unwrap_or(false);

                    if is_streaming {
                        api.prevent_close();
                        let _ = window.emit("verse-ai-close-requested", ());
                        return;
                    }

                    // When the user clicks the close button on the main window,
                    // quit the entire app (including tray). Without this handler
                    // Tauri 2 just hides the window when a system tray is present.
                    window.app_handle().exit(0);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            copy_to_clipboard,
            open_studio_projector,
            studio_ndi_out::start_studio_ndi_out,
            studio_ndi_out::stop_studio_ndi_out,
            studio_ndi_out::get_studio_ndi_out_status,
            verse_ai_ndi::start_verse_ai_ndi,
            verse_ai_ndi::stop_verse_ai_ndi,
            verse_ai_ndi::get_verse_ai_ndi_status,
            save_bg_image,
            save_upload_file,
            save_upload_file_raw,
            prepare_studio_video_for_program,
            delete_upload_file,
            media_refs::register_media_references,
            media_refs::unregister_media_reference,
            media_refs::relink_media_reference,
            media_refs::check_media_references,
            media_refs::get_media_reference,
            media_refs::copy_media_reference_into_library,
            media_refs::probe_media_reference,
            save_share_temp_file,
            get_local_share_file_metadata,
            discover_local_share_devices,
            send_local_share_files,
            list_received_files,
            save_received_file_to_folder,
            save_received_file_to_mce,
            save_countdown_asset,
            delete_countdown_asset,
            cleanup_unused_countdown_assets,
            save_background_video_file,
            load_app_data,
            save_app_data,
            get_overlay_port,
            get_local_share_info,
            get_lan_overlay_info,
            get_dev_dock_base_url,
            prepare_remote_media_url,
            get_device_info,
            get_system_hardware_info,
            get_memory_usage,
            save_dock_data,
            load_dock_data,
            load_dock_settings,
            save_dock_setting,
            delete_dock_setting,
            search_online_song_lyrics,
            read_easyworship_db_folder,
            read_easyworship_assets,
            find_easyworship_libraries,
            inspect_easyworship_folder,
            load_transcripts,
            save_transcript,
            delete_transcript,
            get_transcript_stats,
            get_worship_import_ai_status,
            structure_worship_import_chunk,
            review_worship_import_batch,
            translate_transcript,
            extract_text_from_pdf,
            extract_text_elements_from_pdf,
            device_fingerprint::get_device_fingerprint,
            license_verify::verify_license,
            license_verify::license_clock_note,
            license_verify::license_clock_read,
            audio_capture::list_audio_devices,
            audio_capture::start_audio_capture,
            audio_capture::stop_audio_capture,
            assemblyai_stream::start_assemblyai_stream,
            assemblyai_stream::stop_assemblyai_stream,
            assemblyai_stream::is_assemblyai_streaming,
            assemblyai_stream::set_microphone_gain,
            assemblyai_stream::set_assemblyai_stream_speed,
            voice_guard::voice_guard_keep_alive,
            close_app_confirmed,
            set_update_close_guard,
            get_update_install_location,
            open_downloaded_installer,
            append_update_log,
            local_llm::get_local_llm_runtime_status,
            local_llm::install_local_llm_model,
            local_llm::generate_local_llm_text,
            obs_move_plugin::get_obs_move_plugin_status,
            obs_move_plugin::install_obs_move_plugin,
            get_mobile_pairing_info,
            complete_mobile_command,
            set_mobile_access_policy,
            save_obs_connection_for_mobile,
            get_mobile_server_status,
            get_presentation_remote_info,
            discover_remote_obs_hosts,
            #[cfg(target_os = "macos")]
            app_icon::set_app_icon,
            #[cfg(not(target_os = "macos"))]
            set_app_icon
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
