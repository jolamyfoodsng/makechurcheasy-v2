/**
 * assemblyai_stream.rs — Background-safe AssemblyAI realtime STT capture.
 *
 * Captures microphone audio via cpal and streams PCM frames to AssemblyAI's
 * realtime WebSocket API. Because this runs entirely in the Tauri backend
 * (outside the WebView), it is immune to browser throttling, App Nap,
 * and AudioContext suspension when the app loses focus.
 *
 * Tauri commands:
 *   start_assemblyai_stream — begin mic capture → realtime STT → transcript events
 *   stop_assemblyai_stream  — tear down the capture/transcription pipeline
 *   set_assemblyai_stream_speed — update the active stream timing profile
 *   set_microphone_gain     — update user gain (0.0–3.0) at runtime
 *
 * Tauri events emitted:
 *   "assemblyai-transcript"  { text, end_of_turn, audio_start, audio_end }
 *   "assemblyai-status"      { status: "connected" | "error" | "stopped" }
 *   "assemblyai-audio-level" { level: f32 }  (for the input meter)
 */
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Device, SampleFormat, StreamConfig};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tokio::time::{interval, timeout, MissedTickBehavior};
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::Message;

/// Wall-clock time for the log lines, so a stop can be matched to what the app logged.
fn ts() -> String {
    chrono::Local::now().format("%H:%M:%S%.3f").to_string()
}

/// User-controlled gain multiplier, stored as f32 bits in an AtomicU32.
/// Positioned AFTER AGC so it doesn't fight the auto-gain.
/// 1.0 = unity (100%), 0.0 = muted (0%), 5.0 = max boost (500%).
static USER_GAIN: AtomicU32 = AtomicU32::new(f32_to_bits(1.0));

const REALTIME_WS_URL: &str = "wss://streaming.assemblyai.com/v3/ws";
const REALTIME_MODEL: &str = "universal-streaming-english";
/// Admin-selected model (Admin → Settings → Controls). Empty = REALTIME_MODEL.
static SPEECH_MODEL_OVERRIDE: std::sync::Mutex<String> = std::sync::Mutex::new(String::new());

fn realtime_model() -> String {
    let chosen = SPEECH_MODEL_OVERRIDE
        .lock()
        .map(|m| m.clone())
        .unwrap_or_default();
    let valid = matches!(
        chosen.as_str(),
        "universal-streaming-english" | "universal-streaming-multilingual"
    );
    if valid {
        chosen
    } else {
        REALTIME_MODEL.to_string()
    }
}
const TARGET_RATE: u32 = 16_000;
const CHUNK_MS: u64 = 50;
const WS_CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const WS_HEARTBEAT_INTERVAL: Duration = Duration::from_secs(5);
const WS_IDLE_TIMEOUT: Duration = Duration::from_secs(60);
const WS_WRITE_TIMEOUT: Duration = Duration::from_secs(5);
const WS_CLOSE_TIMEOUT: Duration = Duration::from_secs(2);
const MAX_AUDIO_QUEUE_DROPS: u32 = 20;
// Bible vocabulary boosts recognition without guessing a book in the parser.
const REALTIME_KEYTERMS: &[&str] = &[
    "verse",
    "next verse",
    "previous verse",
    "chapter",
    "next chapter",
    "scripture",
    "Holy Bible",
    "Genesis",
    "Exodus",
    "Leviticus",
    "Numbers",
    "Deuteronomy",
    "Joshua",
    "Judges",
    "Ruth",
    "1 Samuel",
    "2 Samuel",
    "1 Kings",
    "2 Kings",
    "1 Chronicles",
    "2 Chronicles",
    "Ezra",
    "Nehemiah",
    "Esther",
    "Job",
    "Psalms",
    "Proverbs",
    "Ecclesiastes",
    "Song of Solomon",
    "Isaiah",
    "Jeremiah",
    "Lamentations",
    "Ezekiel",
    "Daniel",
    "Hosea",
    "Joel",
    "Amos",
    "Obadiah",
    "Jonah",
    "Micah",
    "Nahum",
    "Habakkuk",
    "Zephaniah",
    "Haggai",
    "Zechariah",
    "Malachi",
    "Matthew",
    "Mark",
    "Luke",
    "John",
    "Acts",
    "Romans",
    "1 Corinthians",
    "2 Corinthians",
    "Galatians",
    "Ephesians",
    "Philippians",
    "Colossians",
    "1 Thessalonians",
    "2 Thessalonians",
    "1 Timothy",
    "2 Timothy",
    "Titus",
    "Philemon",
    "Hebrews",
    "James",
    "1 Peter",
    "2 Peter",
    "1 John",
    "2 John",
    "3 John",
    "Jude",
    "Revelation",
    "First Samuel",
    "Second Samuel",
    "First Kings",
    "Second Kings",
    "First Chronicles",
    "Second Chronicles",
    "First Cor",
    "Second Cor",
    "First Corinthians",
    "Second Corinthians",
    "First Thessalonians",
    "Second Thessalonians",
    "First Timothy",
    "Second Timothy",
    "First Peter",
    "Second Peter",
    "First John",
    "Second John",
    "Third John",
    "KJV",
    "NIV",
    "NLT",
    "ESV",
    "NKJV",
    "The Message",
    "Amplified",
];

// ── State ────────────────────────────────────────────────────────────────────

struct StreamBox(Option<cpal::Stream>);
unsafe impl Send for StreamBox {}
unsafe impl Sync for StreamBox {}

#[derive(Clone, Copy)]
struct RealtimeProfile {
    label: &'static str,
    min_turn_silence_ms: u32,
    max_turn_silence_ms: u32,
}

fn realtime_profile(detection_speed: Option<&str>) -> RealtimeProfile {
    match detection_speed {
        Some("sharp") => RealtimeProfile {
            label: "sharp",
            min_turn_silence_ms: 200,
            max_turn_silence_ms: 1_000,
        },
        Some("fast") => RealtimeProfile {
            label: "fast",
            min_turn_silence_ms: 100,
            max_turn_silence_ms: 700,
        },
        Some("accurate") => RealtimeProfile {
            label: "accurate",
            min_turn_silence_ms: 700,
            max_turn_silence_ms: 1_800,
        },
        _ => RealtimeProfile {
            label: "balanced",
            min_turn_silence_ms: 300,
            max_turn_silence_ms: 1_200,
        },
    }
}

/// Managed state for the AssemblyAI realtime STT capture pipeline.
pub struct AssemblyAiStreamState {
    /// cpal mic stream — dropped to stop capture.
    stream: Arc<Mutex<StreamBox>>,
    /// Sends `()` to signal the WS forwarding task to shut down.
    shutdown_tx: Mutex<Option<tokio::sync::oneshot::Sender<()>>>,
    /// Sends runtime timing-profile changes to the WS forwarding task.
    profile_tx: Mutex<Option<mpsc::Sender<RealtimeProfile>>>,
    /// Handle for the async WS task so we can await / abort it.
    task_handle: Mutex<Option<JoinHandle<()>>>,
    is_streaming: Arc<Mutex<bool>>,
}

impl AssemblyAiStreamState {
    pub fn is_streaming(&self) -> bool {
        self.is_streaming.lock().map(|g| *g).unwrap_or(false)
    }
}

impl Default for AssemblyAiStreamState {
    fn default() -> Self {
        Self {
            stream: Arc::new(Mutex::new(StreamBox(None))),
            shutdown_tx: Mutex::new(None),
            profile_tx: Mutex::new(None),
            task_handle: Mutex::new(None),
            is_streaming: Arc::new(Mutex::new(false)),
        }
    }
}

// ── Payloads ─────────────────────────────────────────────────────────────────

#[derive(Serialize, Clone)]
struct TranscriptPayload {
    text: String,
    end_of_turn: bool,
    audio_start: f64,
    audio_end: f64,
}

#[derive(Serialize, Clone)]
struct StatusPayload {
    status: String,
}

#[derive(Serialize, Clone)]
struct LevelPayload {
    level: f32,
}

#[derive(Deserialize)]
struct RealtimeWord {
    start: Option<f64>,
    end: Option<f64>,
}

#[derive(Deserialize)]
struct RealtimeTranscriptMessage {
    #[serde(rename = "type")]
    message_type: String,
    transcript: Option<String>,
    end_of_turn: Option<bool>,
    words: Option<Vec<RealtimeWord>>,
    error: Option<String>,
    message: Option<String>,
}

// ── Atomic f32 helpers ───────────────────────────────────────────────────────

/// Store an f32 as its raw bit pattern in an AtomicU32.
const fn f32_to_bits(v: f32) -> u32 {
    v.to_bits()
}

/// Load an f32 from its raw bit pattern in an AtomicU32.
const fn f32_from_bits(bits: u32) -> f32 {
    f32::from_bits(bits)
}

// ── Commands ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn start_assemblyai_stream(
    app: AppHandle,
    api_key: String,
    state: State<'_, AssemblyAiStreamState>,
    device_id: Option<String>,
    detection_speed: Option<String>,
    speech_model: Option<String>,
) -> Result<(), String> {
    if let Ok(mut model) = SPEECH_MODEL_OVERRIDE.lock() {
        *model = speech_model.unwrap_or_default();
    }
    // Guard against double-start
    {
        let guard = state.is_streaming.lock().map_err(|e| e.to_string())?;
        if *guard {
            return Ok(());
        }
    }

    // Channel: audio capture → WS sender task.
    // Each item is 50 ms, so 128 items provide about 6.4 s of headroom.
    // The ready gate below prevents startup audio from consuming this queue
    // while the WebSocket is still negotiating.
    let (audio_tx, audio_rx) = mpsc::channel::<Vec<u8>>(128);
    let audio_ready = Arc::new(AtomicBool::new(false));
    let audio_drop_count = Arc::new(AtomicU32::new(0));
    let (profile_tx, profile_rx) = mpsc::channel::<RealtimeProfile>(4);
    let profile = realtime_profile(detection_speed.as_deref());

    // One-shot: signal the WS task to shut down.
    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();

    // ── 1. Start cpal mic capture ────────────────────────────────────────────
    let host = cpal::default_host();

    let device: Device = if let Some(ref id) = device_id {
        let found = host
            .input_devices()
            .map_err(|e| format!("Failed to enumerate devices: {e}"))?
            .find(|d| d.name().ok().as_ref() == Some(id));
        match found {
            Some(d) => d,
            None => {
                eprintln!(
                    "[AssemblyAI Stream] Device '{id}' not found — using default input device"
                );
                host.default_input_device()
                    .ok_or_else(|| "No default input device found".to_string())?
            }
        }
    } else {
        host.default_input_device()
            .ok_or_else(|| "No default input device found".to_string())?
    };

    let supported_config = device
        .default_input_config()
        .map_err(|e| format!("Failed to get default input config: {e}"))?;

    let sample_format = supported_config.sample_format();
    let native_rate = supported_config.sample_rate().0;
    let channels = supported_config.channels() as usize;

    let stream_config = StreamConfig {
        channels: supported_config.channels(),
        sample_rate: supported_config.sample_rate(),
        buffer_size: cpal::BufferSize::Default,
    };

    let target_rate: u32 = TARGET_RATE;
    let chunk_target: usize = ((target_rate as u64 * CHUNK_MS) / 1000) as usize;

    let app_clone = app.clone();
    let audio_tx_clone = audio_tx.clone();
    let audio_ready_clone = Arc::clone(&audio_ready);
    let audio_drop_count_clone = Arc::clone(&audio_drop_count);

    // Accumulator lives inside the audio callback closure.
    let stream = match sample_format {
        SampleFormat::F32 => device.build_input_stream(
            &stream_config,
            move |data: &[f32], _: &cpal::InputCallbackInfo| {
                process_and_send_f32(
                    data,
                    channels,
                    native_rate,
                    target_rate,
                    chunk_target,
                    &audio_tx_clone,
                    &audio_ready_clone,
                    &audio_drop_count_clone,
                    &app_clone,
                );
            },
            |err| eprintln!("[AssemblyAI Stream] cpal error: {err}"),
            None,
        ),
        SampleFormat::I16 => device.build_input_stream(
            &stream_config,
            move |data: &[i16], _: &cpal::InputCallbackInfo| {
                let float_data: Vec<f32> = data.iter().map(|&s| s as f32 / 32768.0).collect();
                process_and_send_f32(
                    &float_data,
                    channels,
                    native_rate,
                    target_rate,
                    chunk_target,
                    &audio_tx_clone,
                    &audio_ready_clone,
                    &audio_drop_count_clone,
                    &app_clone,
                );
            },
            |err| eprintln!("[AssemblyAI Stream] cpal error: {err}"),
            None,
        ),
        SampleFormat::U16 => device.build_input_stream(
            &stream_config,
            move |data: &[u16], _: &cpal::InputCallbackInfo| {
                let float_data: Vec<f32> = data
                    .iter()
                    .map(|&s| (s as f32 - 32768.0) / 32768.0)
                    .collect();
                process_and_send_f32(
                    &float_data,
                    channels,
                    native_rate,
                    target_rate,
                    chunk_target,
                    &audio_tx_clone,
                    &audio_ready_clone,
                    &audio_drop_count_clone,
                    &app_clone,
                );
            },
            |err| eprintln!("[AssemblyAI Stream] cpal error: {err}"),
            None,
        ),
        _ => return Err(format!("Unsupported sample format: {sample_format:?}")),
    }
    .map_err(|e| format!("Failed to build audio stream: {e}"))?;

    stream
        .play()
        .map_err(|e| format!("Failed to start audio stream: {e}"))?;

    // Store stream and state.
    {
        let mut s = state.stream.lock().map_err(|e| e.to_string())?;
        s.0 = Some(stream);
    }
    {
        let mut sd = state.shutdown_tx.lock().map_err(|e| e.to_string())?;
        *sd = Some(shutdown_tx);
    }
    {
        let mut p = state.profile_tx.lock().map_err(|e| e.to_string())?;
        *p = Some(profile_tx);
    }
    {
        let mut c = state.is_streaming.lock().map_err(|e| e.to_string())?;
        *c = true;
    }
    // A new session starts with a fresh silence clock.
    crate::voice_guard::mark_activity();

    // ── 2. Spawn the STT task (Cloudflare HTTP or AssemblyAI) ─────────────────
    let is_http_endpoint = api_key.starts_with("http://") || api_key.starts_with("https://");
    let engine_label = if is_http_endpoint {
        "Cloudflare Whisper"
    } else {
        "AssemblyAI"
    };

    let realtime_app = app.clone();
    let task_stream = Arc::clone(&state.stream);
    let task_is_streaming = Arc::clone(&state.is_streaming);
    let task_audio_ready = Arc::clone(&audio_ready);
    let task = tokio::spawn(async move {
        let result = if is_http_endpoint {
            run_cloudflare_transcriber(
                realtime_app.clone(),
                api_key,
                audio_rx,
                shutdown_rx,
                profile_rx,
                Arc::clone(&task_audio_ready),
                Arc::clone(&audio_drop_count),
            )
            .await
        } else {
            run_realtime_transcriber(
                realtime_app.clone(),
                api_key,
                audio_rx,
                shutdown_rx,
                profile_rx,
                profile,
                Arc::clone(&task_audio_ready),
                Arc::clone(&audio_drop_count),
            )
            .await
        };

        task_audio_ready.store(false, Ordering::Release);
        match &result {
            Ok(()) => println!("[Voice Stream ({engine_label})] {} transcriber task ended normally (stop requested, or the speech service closed the connection)", ts()),
            Err(error) => println!("[Voice Stream ({engine_label})] {} transcriber task ended with an error: {error}", ts()),
        }

        // A network close can end the WebSocket without an explicit stop command.
        // Release the microphone and start guard so the UI can reconnect immediately.
        if let Ok(mut stream) = task_stream.lock() {
            stream.0 = None;
        }
        if let Ok(mut is_streaming) = task_is_streaming.lock() {
            *is_streaming = false;
        }

        if let Err(error) = result {
            eprintln!("[Voice Stream ({engine_label})] Stream failed: {error}");
            let _ = realtime_app.emit(
                "assemblyai-status",
                StatusPayload {
                    status: format!("error: {error}"),
                },
            );
        } else {
            let _ = realtime_app.emit(
                "assemblyai-status",
                StatusPayload {
                    status: "stopped".to_string(),
                },
            );
            println!("[Voice Stream ({engine_label})] Capture task ended");
        }
    });

    {
        let mut h = state.task_handle.lock().map_err(|e| e.to_string())?;
        *h = Some(task);
    }

    println!(
        "[Voice Stream ({engine_label})] Started — profile {}, native rate {native_rate} Hz, {channels} ch",
        profile.label
    );
    Ok(())
}

// ── Cloudflare Workers AI Whisper Transcriber ────────────────────────────────

fn compute_chunk_rms(chunk: &[u8]) -> f32 {
    if chunk.len() < 2 {
        return 0.0;
    }
    let mut sum_sq = 0.0f32;
    let samples_count = chunk.len() / 2;
    for i in (0..chunk.len()).step_by(2) {
        let sample = i16::from_le_bytes([chunk[i], chunk[i + 1]]) as f32 / 32768.0;
        sum_sq += sample * sample;
    }
    (sum_sq / samples_count as f32).sqrt()
}

fn pcm_to_wav(pcm_bytes: &[u8], sample_rate: u32, channels: u16, bits_per_sample: u16) -> Vec<u8> {
    let mut header = Vec::with_capacity(44 + pcm_bytes.len());
    let byte_rate = sample_rate * channels as u32 * (bits_per_sample as u32 / 8);
    let block_align = channels * (bits_per_sample / 8);
    let data_len = pcm_bytes.len() as u32;
    let file_len = 36 + data_len;

    header.extend_from_slice(b"RIFF");
    header.extend_from_slice(&file_len.to_le_bytes());
    header.extend_from_slice(b"WAVE");
    header.extend_from_slice(b"fmt ");
    header.extend_from_slice(&16u32.to_le_bytes()); // Subchunk1Size (16 for PCM)
    header.extend_from_slice(&1u16.to_le_bytes());  // AudioFormat (1 = PCM)
    header.extend_from_slice(&channels.to_le_bytes());
    header.extend_from_slice(&sample_rate.to_le_bytes());
    header.extend_from_slice(&byte_rate.to_le_bytes());
    header.extend_from_slice(&block_align.to_le_bytes());
    header.extend_from_slice(&bits_per_sample.to_le_bytes());
    header.extend_from_slice(b"data");
    header.extend_from_slice(&data_len.to_le_bytes());
    header.extend_from_slice(pcm_bytes);
    header
}

fn dispatch_cloudflare_phrase(
    app: &AppHandle,
    client: &reqwest::Client,
    endpoint_url: &str,
    pcm_bytes: &[u8],
) {
    let wav_data = pcm_to_wav(pcm_bytes, TARGET_RATE, 1, 16);
    let app_clone = app.clone();
    let client_clone = client.clone();
    let endpoint = endpoint_url.to_string();

    tokio::spawn(async move {
        let resp_result = client_clone
            .post(&endpoint)
            .header("Content-Type", "audio/wav")
            .body(wav_data)
            .send()
            .await;

        match resp_result {
            Ok(resp) => {
                if resp.status().is_success() {
                    #[derive(Deserialize)]
                    struct CfResponse {
                        text: Option<String>,
                    }
                    if let Ok(data) = resp.json::<CfResponse>().await {
                        if let Some(text) = data.text {
                            let trimmed = text.trim();
                            if !trimmed.is_empty() {
                                println!("[Cloudflare STT] Transcript: {}", trimmed);
                                crate::voice_guard::mark_activity();
                                let payload = TranscriptPayload {
                                    text: trimmed.to_string(),
                                    end_of_turn: true,
                                    audio_start: 0.0,
                                    audio_end: 0.0,
                                };
                                let _ = app_clone.emit("assemblyai-transcript", payload);
                            }
                        }
                    }
                } else {
                    eprintln!("[Cloudflare STT] Endpoint returned status: {}", resp.status());
                }
            }
            Err(e) => {
                eprintln!("[Cloudflare STT] Dispatch error: {e}");
            }
        }
    });
}

async fn run_cloudflare_transcriber(
    app: AppHandle,
    endpoint_url: String,
    mut audio_rx: mpsc::Receiver<Vec<u8>>,
    mut shutdown_rx: tokio::sync::oneshot::Receiver<()>,
    mut profile_rx: mpsc::Receiver<RealtimeProfile>,
    audio_ready: Arc<AtomicBool>,
    _audio_drop_count: Arc<AtomicU32>,
) -> Result<(), String> {
    let _ = app.emit(
        "assemblyai-status",
        StatusPayload {
            status: "connected".to_string(),
        },
    );
    audio_ready.store(true, Ordering::Release);
    println!("[Cloudflare STT] Connected to endpoint: {}", endpoint_url);

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

    let mut speech_buffer: Vec<u8> = Vec::with_capacity(TARGET_RATE as usize * 2 * 4);
    let mut is_speech_active = false;
    let mut last_speech_time = Instant::now();
    let mut phrase_start_time = Instant::now();

    // 16kHz 16-bit mono = 32,000 bytes/sec
    // 50ms chunk = 1600 bytes
    // 220ms of silence after speech triggers phrase finalize (fast, responsive)
    const SILENCE_FINALIZE_MS: u128 = 220;
    // 3.0s max phrase length (keeps chunks bite-sized for fast inference)
    const MAX_PHRASE_DURATION_MS: u128 = 3000;
    // 250ms minimum audio to avoid transient clicks/pops
    const MIN_PHRASE_BYTES: usize = 1600 * 5;
    // RMS threshold for voice activity
    const SPEECH_RMS_THRESHOLD: f32 = 0.015;

    loop {
        tokio::select! {
            _ = &mut shutdown_rx => {
                println!("[Cloudflare STT] Shutdown signal received");
                break;
            }
            Some(_) = profile_rx.recv() => {
                // Speed profile update; no-op for Cloudflare VAD
            }
            maybe_chunk = audio_rx.recv() => {
                match maybe_chunk {
                    Some(chunk) => {
                        let rms = compute_chunk_rms(&chunk);
                        let is_voiced = rms >= SPEECH_RMS_THRESHOLD;
                        let now = Instant::now();

                        if is_voiced {
                            if !is_speech_active {
                                is_speech_active = true;
                                phrase_start_time = now;
                            }
                            last_speech_time = now;
                            speech_buffer.extend_from_slice(&chunk);

                            if now.duration_since(phrase_start_time).as_millis() >= MAX_PHRASE_DURATION_MS {
                                if speech_buffer.len() >= MIN_PHRASE_BYTES {
                                    dispatch_cloudflare_phrase(&app, &client, &endpoint_url, &speech_buffer);
                                }
                                speech_buffer.clear();
                                is_speech_active = false;
                            }
                        } else if is_speech_active {
                            // Retain up to 150ms of trailing silence for smooth natural word ending
                            if now.duration_since(last_speech_time).as_millis() <= 150 {
                                speech_buffer.extend_from_slice(&chunk);
                            }

                            if now.duration_since(last_speech_time).as_millis() >= SILENCE_FINALIZE_MS {
                                if speech_buffer.len() >= MIN_PHRASE_BYTES {
                                    dispatch_cloudflare_phrase(&app, &client, &endpoint_url, &speech_buffer);
                                }
                                speech_buffer.clear();
                                is_speech_active = false;
                            }
                        }
                    }
                    None => {
                        break;
                    }
                }
            }
        }
    }

    Ok(())
}

async fn run_realtime_transcriber(
    app: AppHandle,
    api_key: String,
    mut audio_rx: mpsc::Receiver<Vec<u8>>,
    mut shutdown_rx: tokio::sync::oneshot::Receiver<()>,
    mut profile_rx: mpsc::Receiver<RealtimeProfile>,
    initial_profile: RealtimeProfile,
    audio_ready: Arc<AtomicBool>,
    audio_drop_count: Arc<AtomicU32>,
) -> Result<(), String> {
    let (endpoint, header_key) =
        apply_realtime_credential(&build_realtime_endpoint(&initial_profile), &api_key);
    let mut request = endpoint
        .as_str()
        .into_client_request()
        .map_err(|e| format!("Failed to create realtime request: {e}"))?;
    if let Some(header_key) = header_key {
        let auth = HeaderValue::from_str(&header_key)
            .map_err(|e| format!("Invalid AssemblyAI API key header: {e}"))?;
        request.headers_mut().insert("Authorization", auth);
    }

    let (ws_stream, _) = timeout(WS_CONNECT_TIMEOUT, connect_async(request))
        .await
        .map_err(|_| "Realtime WebSocket connection timed out".to_string())?
        .map_err(|e| format!("Realtime WebSocket connection failed: {e}"))?;
    let (mut write, mut read) = ws_stream.split();

    // The TCP/WebSocket handshake only proves that the socket opened. Keep
    // the UI in Connecting… and hold audio until AssemblyAI sends its Begin
    // message, which confirms that the realtime session is ready to receive
    // audio. This prevents a false Listening/Connected state during startup.
    println!("[AssemblyAI Realtime] {} WebSocket opened; waiting for Begin", ts());
    let opened_at = Instant::now();
    let mut begin_wait_warned = false;

    let mut last_server_activity = Instant::now();
    let mut heartbeat = interval(WS_HEARTBEAT_INTERVAL);
    heartbeat.set_missed_tick_behavior(MissedTickBehavior::Delay);
    // `interval` fires immediately on its first tick; consume that tick so
    // the first heartbeat is sent after the connection has had time to settle.
    heartbeat.tick().await;

    loop {
        if audio_drop_count.load(Ordering::Relaxed) >= MAX_AUDIO_QUEUE_DROPS {
            return Err(
                "Realtime WebSocket fell behind the microphone; restarting the speech connection."
                    .to_string(),
            );
        }

        tokio::select! {
            _ = &mut shutdown_rx => {
                println!("[AssemblyAI Realtime] {} Shutdown signal received (the app asked to stop) after {:.1}s", ts(), opened_at.elapsed().as_secs_f32());
                let terminate = serde_json::json!({ "type": "Terminate" }).to_string();
                let _ = timeout(WS_CLOSE_TIMEOUT, write.send(Message::Text(terminate.into()))).await;
                let _ = timeout(WS_CLOSE_TIMEOUT, write.close()).await;
                break;
            }
            maybe_pcm = audio_rx.recv() => {
                let Some(pcm_bytes) = maybe_pcm else {
                    break;
                };
                timeout(
                    WS_WRITE_TIMEOUT,
                    write.send(Message::Binary(pcm_bytes.into())),
                )
                    .await
                    .map_err(|_| "Realtime WebSocket audio send timed out".to_string())?
                    .map_err(|e| format!("Failed to send realtime audio: {e}"))?;
            }
            maybe_profile = profile_rx.recv() => {
                if let Some(next_profile) = maybe_profile {
                    timeout(
                        WS_WRITE_TIMEOUT,
                        send_realtime_profile_update(&mut write, &next_profile),
                    )
                        .await
                        .map_err(|_| "Realtime WebSocket profile update timed out".to_string())??;
                    println!("[AssemblyAI Realtime] Profile updated to {}", next_profile.label);
                }
            }
            _ = heartbeat.tick() => {
                if !begin_wait_warned && !audio_ready.load(Ordering::Acquire) && opened_at.elapsed() > Duration::from_secs(8) {
                    begin_wait_warned = true;
                    println!("[AssemblyAI Realtime] {} still waiting for Begin after {:.1}s (no audio is sent until it arrives)", ts(), opened_at.elapsed().as_secs_f32());
                }
                if last_server_activity.elapsed() > WS_IDLE_TIMEOUT {
                    return Err(format!(
                        "Realtime WebSocket stalled: no server response for {} seconds",
                        WS_IDLE_TIMEOUT.as_secs(),
                    ));
                }

                timeout(
                    WS_WRITE_TIMEOUT,
                    write.send(Message::Ping(Vec::new().into())),
                )
                    .await
                    .map_err(|_| "Realtime WebSocket heartbeat timed out".to_string())?
                    .map_err(|e| format!("Failed to send realtime heartbeat: {e}"))?;
            }
            maybe_message = read.next() => {
                let Some(message) = maybe_message else {
                    println!("[AssemblyAI Realtime] {} connection ended without a close message after {:.1}s (Begin received: {})", ts(), opened_at.elapsed().as_secs_f32(), audio_ready.load(Ordering::Acquire));
                    break;
                };
                last_server_activity = Instant::now();
                match message {
                    Ok(Message::Text(text)) => {
                        if handle_realtime_message(&app, text.as_ref())?
                            && !audio_ready.swap(true, Ordering::AcqRel)
                        {
                            println!("[AssemblyAI Realtime] {} Begin received after {} ms; microphone audio now flows", ts(), opened_at.elapsed().as_millis());
                        }
                    }
                    Ok(Message::Binary(bytes)) => {
                        if let Ok(text) = std::str::from_utf8(bytes.as_ref()) {
                            if handle_realtime_message(&app, text)?
                                && !audio_ready.swap(true, Ordering::AcqRel)
                            {
                                println!("[AssemblyAI Realtime] {} Begin received after {} ms; microphone audio now flows", ts(), opened_at.elapsed().as_millis());
                            }
                        }
                    }
                    Ok(Message::Ping(payload)) => {
                        timeout(WS_WRITE_TIMEOUT, write.send(Message::Pong(payload)))
                            .await
                            .map_err(|_| "Realtime WebSocket pong timed out".to_string())?
                            .map_err(|e| format!("Failed to send realtime pong: {e}"))?;
                    }
                    Ok(Message::Close(frame)) => {
                        match frame {
                            Some(frame) => println!("[AssemblyAI Realtime] {} WebSocket closed by the speech service: {} {} (after {:.1}s)", ts(), frame.code, frame.reason, opened_at.elapsed().as_secs_f32()),
                            None => println!("[AssemblyAI Realtime] {} WebSocket closed by the speech service with no code (after {:.1}s)", ts(), opened_at.elapsed().as_secs_f32()),
                        }
                        break;
                    }
                    Ok(_) => {}
                    Err(error) => {
                        return Err(format!("Realtime WebSocket read failed: {error}"));
                    }
                }
            }
        }
    }

    Ok(())
}

/// Prefix the desktop puts on a short-lived token minted by our API
/// (see `api/src/lib/assemblyAiToken.ts`).
const REALTIME_TOKEN_PREFIX: &str = "token:";

/// Release builds never hold the AssemblyAI API key: the app receives a one-minute
/// token and AssemblyAI takes it as a `token` query parameter. A credential
/// without the prefix is a raw API key (local development only) and is sent as the
/// Authorization header as before. Returns the URL to open and the header value, if any.
fn apply_realtime_credential(endpoint: &str, credential: &str) -> (String, Option<String>) {
    match credential.strip_prefix(REALTIME_TOKEN_PREFIX) {
        Some(token) => {
            let sep = if endpoint.contains('?') { '&' } else { '?' };
            (
                format!("{endpoint}{sep}token={}", urlencoding::encode(token)),
                None,
            )
        }
        None => (endpoint.to_string(), Some(credential.to_string())),
    }
}

fn build_realtime_endpoint(profile: &RealtimeProfile) -> String {
    let params = [
        ("speech_model", realtime_model()),
        ("encoding", "pcm_s16le".to_string()),
        ("sample_rate", TARGET_RATE.to_string()),
        ("include_partial_turns", "true".to_string()),
        ("format_turns", "true".to_string()),
        ("min_turn_silence", profile.min_turn_silence_ms.to_string()),
        ("max_turn_silence", profile.max_turn_silence_ms.to_string()),
        (
            "keyterms_prompt",
            serde_json::json!(REALTIME_KEYTERMS).to_string(),
        ),
        ("session_heartbeat", "true".to_string()),
    ];

    let query = params
        .iter()
        .map(|(key, value)| format!("{key}={}", urlencoding::encode(value)))
        .collect::<Vec<_>>()
        .join("&");

    format!("{REALTIME_WS_URL}?{query}")
}

async fn send_realtime_profile_update<S>(
    write: &mut S,
    profile: &RealtimeProfile,
) -> Result<(), String>
where
    S: SinkExt<Message> + Unpin,
    <S as futures_util::Sink<Message>>::Error: std::fmt::Display,
{
    let update = serde_json::json!({
        "type": "UpdateConfiguration",
        "keyterms_prompt": REALTIME_KEYTERMS,
        "min_turn_silence": profile.min_turn_silence_ms,
        "max_turn_silence": profile.max_turn_silence_ms,
    })
    .to_string();

    write
        .send(Message::Text(update.into()))
        .await
        .map_err(|e| format!("Failed to update realtime profile: {e}"))
}

// Do not force a turn to end after a word count. A partial may stop inside
// a book name or number ("seventeen" was finalized as "seven" in live tests).
// Let the configured silence detection determine when the speech is complete.
fn realtime_transcript_payload(message: &RealtimeTranscriptMessage) -> Option<TranscriptPayload> {
    let text = message.transcript.as_deref()?.trim();
    if text.is_empty() {
        return None;
    }
    let (audio_start, audio_end) = extract_realtime_word_range(&message.words);
    Some(TranscriptPayload {
        text: text.to_string(),
        end_of_turn: message.end_of_turn.unwrap_or(false),
        audio_start,
        audio_end,
    })
}

/// Handle a provider message and return whether it confirmed session readiness.
fn handle_realtime_message(app: &AppHandle, raw: &str) -> Result<bool, String> {
    let message: RealtimeTranscriptMessage = serde_json::from_str(raw)
        .map_err(|e| format!("Failed to parse realtime message: {e}: {raw}"))?;

    match message.message_type.as_str() {
        "Turn" => {
            if let Some(payload) = realtime_transcript_payload(&message) {
                crate::voice_guard::mark_activity();
                let _ = app.emit("assemblyai-transcript", payload);
            }
        }
        "Begin" => {
            let _ = app.emit(
                "assemblyai-status",
                StatusPayload {
                    status: "connected".to_string(),
                },
            );
            return Ok(true);
        }
        "Heartbeat" => {
            // Server liveness heartbeat confirmed; keep session alive.
        }
        "Termination" => {
            println!("[AssemblyAI Realtime] {} Termination message received from the speech service", ts());
            let _ = app.emit(
                "assemblyai-status",
                StatusPayload {
                    status: "stopped".to_string(),
                },
            );
        }
        "Error" => {
            let detail = message
                .error
                .or(message.message)
                .unwrap_or_else(|| "unknown realtime error".to_string());
            eprintln!("[AssemblyAI Realtime] {} Error message from the speech service: {detail}", ts());
            let _ = app.emit(
                "assemblyai-status",
                StatusPayload {
                    status: format!("error: {detail}"),
                },
            );
        }
        other => {
            println!("[AssemblyAI Realtime] {} unhandled message type: {other}", ts());
        }
    }

    Ok(false)
}

fn extract_realtime_word_range(words: &Option<Vec<RealtimeWord>>) -> (f64, f64) {
    let Some(words) = words else {
        return (0.0, 0.0);
    };
    let start = words.iter().find_map(|word| word.start).unwrap_or(0.0);
    let end = words
        .iter()
        .rev()
        .find_map(|word| word.end)
        .unwrap_or(start);
    (start, end)
}

#[tauri::command]
pub async fn stop_assemblyai_stream(state: State<'_, AssemblyAiStreamState>) -> Result<(), String> {
    println!("[Voice Stream] stop_assemblyai_stream command received from frontend");
    // Drop the mic stream — stops cpal callbacks immediately.
    {
        let mut s = state.stream.lock().map_err(|e| e.to_string())?;
        s.0 = None;
    }

    // Signal the WS task to shut down.
    {
        let mut sd = state.shutdown_tx.lock().map_err(|e| e.to_string())?;
        if let Some(tx) = sd.take() {
            let _ = tx.send(());
        }
    }
    {
        let mut p = state.profile_tx.lock().map_err(|e| e.to_string())?;
        *p = None;
    }

    // Wait for the WS task to finish.
    // Take the handle out of the Mutex so we don't hold the guard across .await.
    let handle = {
        let mut h = state.task_handle.lock().map_err(|e| e.to_string())?;
        h.take()
    };
    if let Some(handle) = handle {
        let _ = handle.await;
    }

    {
        let mut c = state.is_streaming.lock().map_err(|e| e.to_string())?;
        *c = false;
    }

    println!("[Voice Stream] Stopped");
    Ok(())
}

/// Update the user-controlled microphone gain at runtime (0.0–5.0).
/// This multiplier is applied AFTER the auto-gain, so it acts as a post-AGC
/// trim control that doesn't fight the dynamic range compression.
#[tauri::command]
pub fn set_microphone_gain(gain: f32) {
    let clamped = gain.clamp(0.0, 5.0);
    USER_GAIN.store(f32_to_bits(clamped), Ordering::Relaxed);
    println!("[Voice Stream] User gain set to {clamped:.2}");
}

#[tauri::command]
pub async fn set_assemblyai_stream_speed(
    state: State<'_, AssemblyAiStreamState>,
    detection_speed: String,
) -> Result<(), String> {
    let profile = realtime_profile(Some(detection_speed.as_str()));
    let sender = {
        let guard = state.profile_tx.lock().map_err(|e| e.to_string())?;
        guard.clone()
    };

    if let Some(sender) = sender {
        sender
            .send(profile)
            .await
            .map_err(|e| format!("Failed to update AssemblyAI realtime profile: {e}"))?;
    }

    Ok(())
}

#[tauri::command]
pub fn is_assemblyai_streaming(state: State<'_, AssemblyAiStreamState>) -> bool {
    state.is_streaming()
}

// ── Audio processing ─────────────────────────────────────────────────────────

/// Persistent audio state across callbacks (DC offset, gain, noise gate).
struct AudioState {
    /// High-pass filter state (single-pole IIR).
    hp_prev: f32,
    /// Running RMS for auto-gain normalization.
    rms_ema: f32,
    /// Noise gate: true = gate is open (audio passing).
    gate_open: bool,
    /// Gate hold counter — keeps gate open for N chunks after level drops.
    gate_hold: u32,
}

impl AudioState {
    fn new() -> Self {
        Self {
            hp_prev: 0.0,
            rms_ema: 0.001,
            gate_open: false,
            gate_hold: 0,
        }
    }
}

/// Accumulates audio samples, preprocesses (DC removal + auto-gain + noise
/// gate), resamples, converts to PCM16, and sends to the channel.  Runs in
/// the cpal audio thread — must be fast.
fn process_and_send_f32(
    data: &[f32],
    channels: usize,
    native_rate: u32,
    target_rate: u32,
    chunk_target: usize,
    audio_tx: &mpsc::Sender<Vec<u8>>,
    audio_ready: &AtomicBool,
    audio_drop_count: &AtomicU32,
    app: &AppHandle,
) {
    use std::cell::RefCell;
    thread_local! {
        static ACCUMULATOR: RefCell<Vec<f32>> = RefCell::new(Vec::with_capacity(8192));
        static STATE: RefCell<AudioState> = RefCell::new(AudioState::new());
    }

    // Do not fill the bounded queue while the WebSocket is connecting. Clear
    // any callback-local state so a reconnect starts with fresh audio.
    if !audio_ready.load(Ordering::Acquire) {
        ACCUMULATOR.with(|acc| acc.borrow_mut().clear());
        STATE.with(|state| *state.borrow_mut() = AudioState::new());
        // Log (at most every 5 s) that the microphone is delivering but nothing is sent yet.
        thread_local! {
            static WAIT_COUNT: std::cell::Cell<u32> = std::cell::Cell::new(0);
            static WAIT_LOGGED: std::cell::Cell<Option<Instant>> = std::cell::Cell::new(None);
        }
        WAIT_COUNT.with(|c| c.set(c.get() + 1));
        let due = WAIT_LOGGED.with(|t| t.get().map(|at| at.elapsed() >= Duration::from_secs(5)).unwrap_or(true));
        if due {
            WAIT_LOGGED.with(|t| t.set(Some(Instant::now())));
            println!("[Voice Stream] {} microphone is delivering audio ({} callbacks) but the speech service has not sent Begin yet, so nothing is sent", ts(), WAIT_COUNT.with(|c| c.get()));
        }
        return;
    }

    // Mix down to mono
    let mono: Vec<f32> = if channels > 1 {
        data.chunks(channels)
            .map(|frame| frame.iter().sum::<f32>() / channels as f32)
            .collect()
    } else {
        data.to_vec()
    };

    // ── Preprocessing ────────────────────────────────────────────────────
    STATE.with(|st| {
        let mut st = st.borrow_mut();

        // 1) DC offset removal — single-pole high-pass at ~20 Hz
        let hp_alpha = 0.998;
        let mut prev_input = mono[0];
        let mut filtered = Vec::with_capacity(mono.len());
        for &s in &mono {
            // y[n] = alpha * (y[n-1] + x[n] - x[n-1])
            let out = hp_alpha * (st.hp_prev + s - prev_input);
            prev_input = s;
            st.hp_prev = out;
            filtered.push(out);
        }

        // 2) Running RMS for auto-gain (EMA, ~50 ms attack)
        let rms_alpha = 0.01;
        let target_rms = 0.08;
        let chunk_rms: f32 = {
            let sum: f32 = filtered.iter().map(|s| s * s).sum();
            (sum / filtered.len() as f32).sqrt().max(1e-6)
        };
        st.rms_ema = (rms_alpha * chunk_rms + (1.0 - rms_alpha) * st.rms_ema).max(0.005);
        let agc_gain = (target_rms / st.rms_ema).min(6.0).max(0.6);

        // Read user gain from the atomic (lock-free, thread-safe).
        // Positioned AFTER AGC so it doesn't fight the dynamic range compression.
        let user_gain = f32_from_bits(USER_GAIN.load(Ordering::Relaxed));
        let effective_gain = agc_gain * user_gain;

        // 3) Noise gate with ~600ms hold time to preserve soft syllables
        let gate_threshold = 0.0003;
        if chunk_rms > gate_threshold {
            st.gate_open = true;
            st.gate_hold = 6; // ~600 ms hold
        } else if st.gate_hold > 0 {
            st.gate_hold -= 1;
        } else {
            st.gate_open = false;
        }

        // Apply effective gain with clean headroom and transparent soft limiter only near peak
        let processed: Vec<f32> = if st.gate_open {
            filtered
                .iter()
                .map(|&s| {
                    let scaled = s * effective_gain;
                    if scaled.abs() > 0.85 {
                        scaled.signum() * (0.85 + (scaled.abs() - 0.85).tanh() * 0.14)
                    } else {
                        scaled
                    }
                })
                .collect()
        } else {
            // Soft attenuation during silence
            filtered
                .iter()
                .map(|&s| (s * effective_gain * 0.1).clamp(-1.0, 1.0))
                .collect()
        };

        // ── Resample ─────────────────────────────────────────────────────
        let resampled = if native_rate != target_rate {
            resample(&processed, native_rate, target_rate)
        } else {
            processed
        };

        ACCUMULATOR.with(|acc| {
            let mut acc = acc.borrow_mut();
            acc.extend_from_slice(&resampled);

            while acc.len() >= chunk_target {
                let chunk: Vec<f32> = acc.drain(..chunk_target).collect();

                // RMS level for the input meter
                let sum: f32 = chunk.iter().map(|s| s * s).sum();
                let rms = (sum / chunk.len() as f32).sqrt();
                let level = (rms * 5.0).min(1.0);

                // Convert to PCM16 little-endian bytes
                let pcm16_bytes: Vec<u8> = chunk
                    .iter()
                    .flat_map(|&s| {
                        let clamped = s.max(-1.0).min(1.0);
                        let sample = (clamped * 32767.0) as i16;
                        sample.to_le_bytes()
                    })
                    .collect();

                if let Err(tokio::sync::mpsc::error::TrySendError::Full(_)) =
                    audio_tx.try_send(pcm16_bytes)
                {
                    audio_drop_count.fetch_add(1, Ordering::Relaxed);
                }
                // Every 10 s: proof that audio is really reaching the speech service.
                thread_local! {
                    static SENT_COUNT: std::cell::Cell<u32> = std::cell::Cell::new(0);
                    static SENT_LOGGED: std::cell::Cell<Option<Instant>> = std::cell::Cell::new(None);
                }
                SENT_COUNT.with(|c| c.set(c.get() + 1));
                let due = SENT_LOGGED.with(|t| t.get().map(|at| at.elapsed() >= Duration::from_secs(10)).unwrap_or(true));
                if due {
                    SENT_LOGGED.with(|t| t.set(Some(Instant::now())));
                    println!(
                        "[Voice Stream] {} mic audio flowing: {} chunks sent so far on this thread (rms {rms:.4}, level {level:.3}, queue drops {})",
                        ts(),
                        SENT_COUNT.with(|c| c.get()),
                        audio_drop_count.load(Ordering::Relaxed),
                    );
                }
                let _ = app.emit("assemblyai-audio-level", LevelPayload { level });
            }
        });
    });
}

/// Windowed-sinc resampler — much better quality than linear interpolation.
/// Uses a 64-point Blackman-windowed sinc kernel for anti-aliasing.
fn resample(input: &[f32], from_rate: u32, to_rate: u32) -> Vec<f32> {
    if input.is_empty() || from_rate == to_rate {
        return input.to_vec();
    }

    let ratio = from_rate as f64 / to_rate as f64;
    let output_len = (input.len() as f64 / ratio).ceil() as usize;
    let sinc_len: i32 = 64; // kernel half-width
    let mut output = Vec::with_capacity(output_len);

    for i in 0..output_len {
        let pos = i as f64 * ratio;
        let center = pos as i32;
        let frac = (pos - center as f64) as f32;

        // Sum Blackman-windowed sinc over kernel
        let mut sample = 0.0f32;
        let mut kernel_sum = 0.0f32;
        for k in -sinc_len..=sinc_len {
            let idx = center + k;
            if idx >= 0 && (idx as usize) < input.len() {
                let x = k as f32 + frac; // fractional offset
                let window = blackman_window(k, sinc_len);
                let sinc_val = sinc(x);
                let contribution = input[idx as usize] * sinc_val * window;
                sample += contribution;
                kernel_sum += sinc_val * window;
            }
        }
        // Normalize kernel
        if kernel_sum.abs() > 1e-10 {
            sample /= kernel_sum;
        }
        output.push(sample.max(-1.0).min(1.0));
    }
    output
}

/// Sinc function: sin(pi * x) / (pi * x)
#[inline]
fn sinc(x: f32) -> f32 {
    if x.abs() < 1e-10 {
        1.0
    } else {
        let pi_x = std::f32::consts::PI * x;
        pi_x.sin() / pi_x
    }
}

/// Blackman window: 0.42 - 0.5 * cos(2*pi*n/N) + 0.08 * cos(4*pi*n/N)
#[inline]
fn blackman_window(n: i32, half_len: i32) -> f32 {
    let n_f = n as f32;
    let n_f = (n_f + half_len as f32) / (2.0 * half_len as f32); // normalize to [0, 1]
    0.42 - 0.5 * (2.0 * std::f32::consts::PI * n_f).cos()
        + 0.08 * (4.0 * std::f32::consts::PI * n_f).cos()
}

#[cfg(test)]
mod tests {

    #[test]
    fn token_credentials_go_in_the_url_not_a_header() {
        let (url, header) = apply_realtime_credential("wss://x/v3/ws?a=1", "token:abc/def+1");
        assert_eq!(url, "wss://x/v3/ws?a=1&token=abc%2Fdef%2B1");
        assert_eq!(header, None);
        let (url, _) = apply_realtime_credential("wss://x/v3/ws", "token:t");
        assert_eq!(url, "wss://x/v3/ws?token=t");
    }

    #[test]
    fn raw_keys_still_use_the_authorization_header() {
        let (url, header) = apply_realtime_credential("wss://x/v3/ws?a=1", "rawkey");
        assert_eq!(url, "wss://x/v3/ws?a=1");
        assert_eq!(header.as_deref(), Some("rawkey"));
    }
    use super::*;

    #[test]
    fn a_formatted_partial_reference_stays_provisional() {
        let message: RealtimeTranscriptMessage = serde_json::from_value(serde_json::json!({
            "type": "Turn",
            "transcript": "Second Corinthians chapter five verse seven",
            "end_of_turn": false,
            "turn_is_formatted": true,
            "words": [{ "start": 0, "end": 1500 }]
        }))
        .unwrap();
        let payload = realtime_transcript_payload(&message).unwrap();
        assert!(!payload.end_of_turn);
        assert_eq!(payload.audio_end, 1500.0);
    }

    #[test]
    fn a_completed_reference_preserves_the_providers_number() {
        let message: RealtimeTranscriptMessage = serde_json::from_value(serde_json::json!({
            "type": "Turn",
            "transcript": " Second Corinthians chapter 5 verse 17. ",
            "end_of_turn": true
        }))
        .unwrap();
        let payload = realtime_transcript_payload(&message).unwrap();
        assert!(payload.end_of_turn);
        assert_eq!(payload.text, "Second Corinthians chapter 5 verse 17.");
    }

    #[test]
    fn all_profiles_send_the_complete_bible_vocabulary_within_provider_limits() {
        let books: serde_json::Value =
            serde_json::from_str(include_str!("../../public/bible-kjv.json")).unwrap();
        for speed in ["sharp", "fast", "balanced", "accurate"] {
            let endpoint = build_realtime_endpoint(&realtime_profile(Some(speed)));
            let url = reqwest::Url::parse(&endpoint).unwrap();
            let params: std::collections::HashMap<_, _> = url.query_pairs().into_owned().collect();
            let terms: Vec<String> = serde_json::from_str(&params["keyterms_prompt"]).unwrap();
            assert_eq!(params["speech_model"], "universal-streaming-english");
            assert_eq!(params["format_turns"], "true");
            assert!(!params.contains_key("mode"));
            assert!(!params.contains_key("prompt"));
            assert!(!params.contains_key("interruption_delay"));
            assert!(terms.len() <= 100);
            assert!(terms.iter().all(|term| term.chars().count() <= 50));
            for book in books.as_object().unwrap().keys() {
                assert!(terms.contains(book), "Missing Bible book: {book}");
            }
            for alias in [
                "First Cor",
                "Second Cor",
                "First Kings",
                "Second Kings",
                "Third John",
            ] {
                assert!(terms.iter().any(|term| term == alias));
            }
        }
    }
}
