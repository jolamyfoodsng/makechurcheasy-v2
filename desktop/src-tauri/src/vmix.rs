/*!
 * vmix.rs — send requests to vMix's HTTP API for the Dock.
 *
 * vMix's Web Controller answers `GET http://<host>:<port>/api/?Function=...`
 * but refuses requests made by web pages ("Browser script access not permitted"),
 * so the Dock page cannot ask it directly. Two ways in, both only ever
 * requesting vMix's `/api` path:
 *   - the `vmix_request` command, when the Dock runs inside the app;
 *   - `GET /api/vmix?host=&port=&q=` on the local overlay server, when the
 *     Dock runs as a web page (e.g. in a browser beside vMix). Only requests
 *     from this computer are relayed.
 */

use serde::Serialize;
use std::time::Duration;

const VMIX_TIMEOUT: Duration = Duration::from_millis(2500);

#[derive(Serialize)]
pub struct VmixResponse {
    status: u16,
    body: String,
}

fn valid_host(host: &str) -> bool {
    !host.is_empty()
        && host
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_')
}

/// `query` is everything after `/api`: empty for the state XML, or
/// `/?Function=...`. Errors start with "timeout:" or "unreachable:".
fn vmix_get(host: &str, port: u16, query: &str) -> Result<VmixResponse, String> {
    let host = host.trim();
    if !valid_host(host) {
        return Err("unreachable: invalid vMix host".to_string());
    }
    if !(query.is_empty() || query.starts_with("/?")) {
        return Err("unreachable: invalid vMix request".to_string());
    }
    let url = format!("http://{}:{}/api{}", host, port, query);
    let client = reqwest::blocking::Client::builder()
        .timeout(VMIX_TIMEOUT)
        .build()
        .map_err(|e| format!("unreachable: {}", e))?;
    let response = client.get(&url).send().map_err(|e| {
        if e.is_timeout() {
            format!("timeout: {}", e)
        } else {
            format!("unreachable: {}", e)
        }
    })?;
    let status = response.status().as_u16();
    let body = response.text().unwrap_or_default();
    Ok(VmixResponse { status, body })
}

#[tauri::command]
pub async fn vmix_request(host: String, port: u16, query: String) -> Result<VmixResponse, String> {
    tauri::async_runtime::spawn_blocking(move || vmix_get(&host, port, &query))
        .await
        .map_err(|e| format!("unreachable: {}", e))?
}

/// Answer `/api/vmix` on the overlay server. Runs on its own thread so a slow
/// or missing vMix never holds up overlay requests. The reply is JSON:
/// `{"status":200,"body":"..."}` or `{"error":"timeout: ..."}`.
pub fn relay_overlay_request(request: tiny_http::Request) {
    std::thread::spawn(move || {
        let json_header =
            tiny_http::Header::from_bytes("Content-Type", "application/json; charset=utf-8").unwrap();
        let cors = tiny_http::Header::from_bytes("Access-Control-Allow-Origin", "*").unwrap();

        let from_this_computer = request
            .remote_addr()
            .map(|addr| addr.ip().is_loopback())
            .unwrap_or(false);
        if !from_this_computer {
            let resp = tiny_http::Response::from_string(r#"{"error":"unreachable: vMix relay is for this computer only"}"#)
                .with_status_code(403)
                .with_header(json_header)
                .with_header(cors);
            let _ = request.respond(resp);
            return;
        }

        let mut host = String::new();
        let mut port: u16 = 0;
        let mut query = String::new();
        let raw_query = request.url().split_once('?').map(|(_, q)| q).unwrap_or("");
        for pair in raw_query.split('&') {
            let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
            let value = urlencoding::decode(value).map(|v| v.into_owned()).unwrap_or_default();
            match key {
                "host" => host = value,
                "port" => port = value.parse().unwrap_or(0),
                "q" => query = value,
                _ => {}
            }
        }

        let result = if port == 0 {
            Err("unreachable: invalid vMix port".to_string())
        } else {
            vmix_get(&host, port, &query)
        };
        let body = match result {
            Ok(reply) => serde_json::to_string(&reply).unwrap_or_else(|_| "{}".to_string()),
            Err(error) => serde_json::json!({ "error": error }).to_string(),
        };
        let resp = tiny_http::Response::from_string(body)
            .with_header(json_header)
            .with_header(cors);
        let _ = request.respond(resp);
    });
}

/// The Dock window churches with vMix keep beside vMix (see `vmixDockWindow.ts`).
pub const VMIX_DOCK_WINDOW_LABEL: &str = "mce-vmix-dock";

/// Open the Dock in its own window, or bring it forward if it is already open.
///
/// Built here rather than from JS because on Windows every WebView2 window must
/// start with the main window's browser arguments; a window without them opens
/// and closes again straight away. It is async because building a window from
/// a synchronous command can deadlock on Windows.
#[tauri::command]
pub async fn open_vmix_dock_window(app: tauri::AppHandle, always_on_top: bool) -> Result<(), String> {
    use tauri::Manager;

    if let Some(existing) = app.get_webview_window(VMIX_DOCK_WINDOW_LABEL) {
        let _ = existing.unminimize();
        let _ = existing.show();
        let _ = existing.set_focus();
        return Ok(());
    }

    // The app's own `/dock` route. The Dock reads "vMix mode" from its saved
    // setting, which the app writes before opening this window.
    #[allow(unused_mut)]
    let mut builder = tauri::WebviewWindowBuilder::new(
        &app,
        VMIX_DOCK_WINDOW_LABEL,
        tauri::WebviewUrl::App("dock".into()),
    )
    .title("MakeChurchEazy Dock")
    .inner_size(520.0, 860.0)
    .min_inner_size(360.0, 480.0)
    .resizable(true)
    .focused(true)
    .always_on_top(always_on_top);
    #[cfg(windows)]
    {
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
    builder
        .build()
        .map(|_| ())
        .map_err(|e| format!("The Dock window could not be opened: {e}"))
}

/// Save an image one of MakeChurchEazy's vMix titles uses (PNG, sent as base64)
/// and return its full path for the title file.
#[tauri::command]
pub fn write_vmix_title_image(name: String, png_base64: String) -> Result<String, String> {
    use base64::Engine as _;
    let safe: String = name
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect();
    if safe.is_empty() || png_base64.len() > 2 * 1024 * 1024 {
        return Err("Invalid vMix title image".to_string());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(png_base64.trim())
        .map_err(|e| format!("Invalid vMix title image: {e}"))?;
    let dir = crate::app_dir()?.join("vmix-titles");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Could not create the vMix titles folder: {e}"))?;
    let path = dir.join(format!("{safe}.png"));
    std::fs::write(&path, bytes).map_err(|e| format!("Could not save the vMix title image: {e}"))?;
    Ok(path.to_string_lossy().into_owned())
}

/// Save one of MakeChurchEazy's vMix title designs (GT XML) and return its full
/// path, which `AddInput Title|<path>` gives to vMix. vMix reads the file from
/// disk, so it has to run on this computer.
#[tauri::command]
pub fn write_vmix_title_file(name: String, xml: String) -> Result<String, String> {
    let safe: String = name
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect();
    if safe.is_empty() || xml.len() > 512 * 1024 {
        return Err("Invalid vMix title".to_string());
    }
    let dir = crate::app_dir()?.join("vmix-titles");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Could not create the vMix titles folder: {e}"))?;
    let path = dir.join(format!("{safe}.gtxml"));
    std::fs::write(&path, xml).map_err(|e| format!("Could not save the vMix title: {e}"))?;
    Ok(path.to_string_lossy().into_owned())
}

/// Find one of vMix's own built-in titles (e.g. "Title 28- Scripture and Verse
/// Blue.gtzip") in vMix's install folder on this computer, for `AddInput Title|<path>`.
/// Returns None when vMix isn't installed here (vMix on another computer).
#[tauri::command]
pub fn vmix_builtin_title_path(file_name: String) -> Option<String> {
    let name = file_name.trim();
    let safe = !name.is_empty()
        && name.ends_with(".gtzip")
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || " -_.()'".contains(c));
    if !safe {
        return None;
    }
    let mut roots: Vec<std::path::PathBuf> = Vec::new();
    for var in ["ProgramFiles(x86)", "ProgramFiles", "ProgramW6432"] {
        if let Ok(dir) = std::env::var(var) {
            roots.push(std::path::PathBuf::from(dir).join("vMix"));
        }
    }
    roots
        .into_iter()
        .map(|root| root.join("titles").join("GT Title").join(name))
        .find(|path| path.is_file())
        .map(|path| path.to_string_lossy().into_owned())
}
