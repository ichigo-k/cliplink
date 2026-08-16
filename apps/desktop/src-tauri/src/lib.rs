mod clipboard;
mod crypto;
mod discovery;
mod protocol;
mod server;
mod settings;

use clipboard::EchoSuppressor;
use protocol::{PairingOffer, DEFAULT_PORT, PROTOCOL_VERSION};
use serde::Serialize;
use server::{
    now, InboundClip, InboundFile, OutgoingClip, OutgoingFile, OutgoingMessage, ServerState,
};
use settings::{HistoryStore, Settings};
use std::{
    net::{IpAddr, Ipv4Addr, UdpSocket},
    str::FromStr,
    sync::{Arc, Mutex},
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager, State,
};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_autostart::ManagerExt as AutostartManagerExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

const MAIN: &str = "main";
const OVERLAY: &str = "overlay";

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ClipEntry {
    id: String,
    text: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    image_data_url: String,
    /// "text/plain", "text/html", "image/png", etc.
    #[serde(default)]
    content_type: String,
    origin: String,
    device_name: String,
    received_at: u64,
    #[serde(default)]
    pinned: bool,
}

impl From<settings::PersistedEntry> for ClipEntry {
    fn from(p: settings::PersistedEntry) -> Self {
        ClipEntry {
            id: p.id,
            text: p.text,
            image_data_url: p.image_data_url,
            content_type: p.content_type,
            origin: p.origin,
            device_name: p.device_name,
            received_at: p.received_at,
            pinned: p.pinned,
        }
    }
}

impl From<&ClipEntry> for settings::PersistedEntry {
    fn from(e: &ClipEntry) -> Self {
        settings::PersistedEntry {
            id: e.id.clone(),
            text: e.text.clone(),
            image_data_url: e.image_data_url.clone(),
            content_type: e.content_type.clone(),
            origin: e.origin.clone(),
            device_name: e.device_name.clone(),
            received_at: e.received_at,
            pinned: e.pinned,
        }
    }
}

struct App {
    server: Arc<ServerState>,
    history: Mutex<Vec<ClipEntry>>,
    suppressor: EchoSuppressor,
    history_store: HistoryStore,
    /// Keep the mDNS daemon alive for the process lifetime.
    _mdns: Option<mdns_sd::ServiceDaemon>,
}

impl App {
    fn record(&self, entry: ClipEntry) {
        let limit = self
            .server
            .settings
            .lock()
            .map(|s| s.history_limit)
            .unwrap_or(settings::DEFAULT_HISTORY_LIMIT);
        if let Ok(mut history) = self.history.lock() {
            history.retain(|e| {
                if e.id == entry.id {
                    return false;
                }
                if !entry.text.is_empty() && e.text == entry.text {
                    return false;
                }
                if !entry.image_data_url.is_empty() && e.image_data_url == entry.image_data_url {
                    return false;
                }
                true
            });
            let insert_pos = history.iter().position(|e| !e.pinned).unwrap_or(0);
            history.insert(insert_pos, entry);
            let pinned_count = history.iter().filter(|e| e.pinned).count();
            let max_unpinned = limit.saturating_sub(pinned_count);
            let mut unpinned_seen = 0usize;
            history.retain(|e| {
                if e.pinned {
                    return true;
                }
                unpinned_seen += 1;
                unpinned_seen <= max_unpinned
            });
            // Persist after every change
            let persisted: Vec<_> = history.iter().map(settings::PersistedEntry::from).collect();
            self.history_store.save(&persisted);
        }
    }
}

fn rank(adapter: &str, ip: &Ipv4Addr) -> u8 {
    let name = adapter.to_ascii_lowercase();
    let virtualised = [
        "vethernet",
        "wsl",
        "docker",
        "vmware",
        "virtualbox",
        "hyper-v",
        "tailscale",
        "zerotier",
        "radmin",
        "tap",
        "tun",
        "utun",
        "bridge",
    ]
    .iter()
    .any(|needle| name.contains(needle));

    let base = match ip.octets() {
        [192, 168, ..] => 0,
        [10, ..] => 1,
        [172, second, ..] if (16..=31).contains(&second) => 2,
        _ => 3,
    };
    if virtualised {
        base + 10
    } else {
        base
    }
}

fn candidate_hosts() -> Vec<String> {
    let mut found: Vec<(u8, String)> = local_ip_address::list_afinet_netifas()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|(adapter, ip)| match ip {
            IpAddr::V4(v4) if !v4.is_loopback() && !v4.is_link_local() => {
                Some((rank(&adapter, &v4), v4.to_string()))
            }
            _ => None,
        })
        .collect();

    found.sort();
    found.dedup_by(|a, b| a.1 == b.1);

    let hosts: Vec<String> = found.into_iter().map(|(_, ip)| ip).collect();
    if hosts.is_empty() {
        return UdpSocket::bind("0.0.0.0:0")
            .and_then(|s| {
                s.connect("8.8.8.8:80")?;
                s.local_addr()
            })
            .map(|addr| vec![addr.ip().to_string()])
            .unwrap_or_else(|_| vec!["127.0.0.1".into()]);
    }
    hosts
}

// ─── Tauri commands ──────────────────────────────────────────────────────────

/// Returns the PC's current LAN addresses. The Android app can call this
/// after reconnecting to refresh its host cache — useful when the PC's IP
/// changed since the original pairing.
#[tauri::command]
fn get_current_hosts(_app: State<'_, App>) -> Vec<String> {
    candidate_hosts()
}

#[tauri::command]
fn create_pairing(app: State<'_, App>) -> PairingOffer {
    let (nonce, expires_at) = app.server.issue_nonce();
    let hosts = candidate_hosts();
    PairingOffer {
        app: "ClipLink",
        version: PROTOCOL_VERSION,
        device_id: app.server.device_id.clone(),
        device_name: app.server.device_name(),
        host: hosts.first().cloned().unwrap_or_else(|| "127.0.0.1".into()),
        hosts,
        port: DEFAULT_PORT,
        nonce,
        public_key: app.server.identity.public_key_b64(),
        expires_at,
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SettingsView {
    hotkey: String,
    device_name: String,
    paired_devices: Vec<settings::PairedDevice>,
    launch_at_startup: bool,
    history_limit: usize,
}

#[tauri::command]
fn get_settings(app: State<'_, App>) -> Result<SettingsView, String> {
    let s = app
        .server
        .settings
        .lock()
        .map_err(|_| "settings unavailable")?;
    Ok(SettingsView {
        hotkey: s.hotkey.clone(),
        device_name: s.device_name.clone(),
        paired_devices: s.paired_devices.clone(),
        launch_at_startup: s.launch_at_startup,
        history_limit: s.history_limit,
    })
}

#[tauri::command]
fn set_hotkey(app: tauri::AppHandle, state: State<'_, App>, hotkey: String) -> Result<(), String> {
    let parsed =
        Shortcut::from_str(&hotkey).map_err(|_| format!("'{hotkey}' is not a valid shortcut."))?;

    let previous = {
        let s = state
            .server
            .settings
            .lock()
            .map_err(|_| "settings unavailable")?;
        s.hotkey.clone()
    };

    app.global_shortcut().register(parsed).map_err(|_| {
        format!("Windows would not give ClipLink '{hotkey}'. Another app likely owns it.")
    })?;

    if let Ok(old) = Shortcut::from_str(&previous) {
        let _ = app.global_shortcut().unregister(old);
    }

    let mut s = state
        .server
        .settings
        .lock()
        .map_err(|_| "settings unavailable")?;
    s.hotkey = hotkey;
    s.save(&state.server.settings_dir)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn set_launch_at_startup(
    app: tauri::AppHandle,
    state: State<'_, App>,
    enabled: bool,
) -> Result<(), String> {
    let autostart = app.autolaunch();
    if enabled {
        autostart.enable().map_err(|e| e.to_string())?;
    } else {
        autostart.disable().map_err(|e| e.to_string())?;
    }
    let mut s = state
        .server
        .settings
        .lock()
        .map_err(|_| "settings unavailable")?;
    s.launch_at_startup = enabled;
    s.save(&state.server.settings_dir)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn set_history_limit(state: State<'_, App>, limit: usize) -> Result<(), String> {
    let clamped = limit.clamp(10, 500);
    {
        let mut s = state
            .server
            .settings
            .lock()
            .map_err(|_| "settings unavailable")?;
        s.history_limit = clamped;
        s.save(&state.server.settings_dir)
            .map_err(|e| e.to_string())?;
    }
    // Trim existing history to the new limit
    if let Ok(mut history) = state.history.lock() {
        history.truncate(clamped);
    }
    Ok(())
}

#[tauri::command]
fn clear_history(state: State<'_, App>) -> Result<(), String> {
    let mut history = state.history.lock().map_err(|_| "history unavailable")?;
    history.clear();
    state.history_store.save(&[]);
    Ok(())
}

/// Open a file path in the system's default handler (Explorer/Finder).
#[tauri::command]
fn open_path(path: String) -> Result<(), String> {
    open::that(&path).map_err(|e| e.to_string())
}

/// Dismiss a notification on the paired phone (triggered from the PC's UI).
#[tauri::command]
fn dismiss_phone_notification(state: State<'_, App>, key: String) -> Result<(), String> {
    let _ = state
        .server
        .outgoing
        .send(server::OutgoingMessage::NotificationDismiss { key });
    Ok(())
}

/// Send a file from the PC to all connected phones.
/// `path` is the absolute path on the PC's filesystem.
#[tauri::command]
fn send_file(state: State<'_, App>, path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    let file_name = p
        .file_name()
        .ok_or("invalid path")?
        .to_string_lossy()
        .to_string();
    let data = std::fs::read(p).map_err(|e| format!("Cannot read file: {e}"))?;
    let mime_type = mime_guess::from_path(p).first_or_octet_stream().to_string();

    let _ = state
        .server
        .outgoing
        .send(OutgoingMessage::File(OutgoingFile {
            transfer_id: uuid_v4(),
            file_name,
            data,
            mime_type,
        }));
    Ok(())
}

fn persist_history(state: &App) {
    if let Ok(history) = state.history.lock() {
        let persisted: Vec<_> = history.iter().map(settings::PersistedEntry::from).collect();
        state.history_store.save(&persisted);
    }
}

#[tauri::command]
fn unpair_device(
    app: tauri::AppHandle,
    state: State<'_, App>,
    device_id: String,
) -> Result<(), String> {
    let mut s = state
        .server
        .settings
        .lock()
        .map_err(|_| "settings unavailable")?;
    s.remove_device(&device_id);
    s.save(&state.server.settings_dir)
        .map_err(|e| e.to_string())?;
    drop(s);
    let _ = app.emit("device_unpaired", &device_id);
    Ok(())
}

#[tauri::command]
fn rename_device(
    app: tauri::AppHandle,
    state: State<'_, App>,
    device_id: String,
    name: String,
) -> Result<(), String> {
    let trimmed = name.trim().to_string();
    if trimmed.is_empty() {
        return Err("Name cannot be empty.".into());
    }
    {
        let mut s = state
            .server
            .settings
            .lock()
            .map_err(|_| "settings unavailable")?;
        if let Some(d) = s
            .paired_devices
            .iter_mut()
            .find(|d| d.device_id == device_id)
        {
            d.device_name = trimmed;
        }
        s.save(&state.server.settings_dir)
            .map_err(|e| e.to_string())?;
    }
    let _ = app.emit("settings_changed", ());
    Ok(())
}

#[tauri::command]
fn get_history(app: State<'_, App>) -> Vec<ClipEntry> {
    app.history.lock().map(|h| h.clone()).unwrap_or_default()
}

#[tauri::command]
fn copy_to_clipboard(app: State<'_, App>, text: String) -> Result<(), String> {
    clipboard::apply_text(&text, &app.suppressor)?;
    let _ = app
        .server
        .outgoing
        .send(OutgoingMessage::Clip(OutgoingClip {
            id: uuid_v4(),
            origin: app.server.device_id.clone(),
            content_type: "text/plain".into(),
            text,
            image_png: None,
            sent_at: now(),
        }));
    Ok(())
}

/// Called from the overlay — writes to clipboard, hides the window, then
/// simulates Ctrl+V so the text pastes straight into the previously active app.
#[tauri::command]
fn paste_from_overlay(
    app_handle: tauri::AppHandle,
    state: State<'_, App>,
    text: String,
) -> Result<(), String> {
    clipboard::apply_text(&text, &state.suppressor)?;
    let _ = state
        .server
        .outgoing
        .send(OutgoingMessage::Clip(OutgoingClip {
            id: uuid_v4(),
            origin: state.server.device_id.clone(),
            content_type: "text/plain".into(),
            text,
            image_png: None,
            sent_at: now(),
        }));
    if let Some(win) = app_handle.get_webview_window(OVERLAY) {
        let _ = win.hide();
    }
    std::thread::spawn(|| {
        std::thread::sleep(std::time::Duration::from_millis(100));
        use enigo::{Direction, Enigo, Key, Keyboard, Settings};
        if let Ok(mut e) = Enigo::new(&Settings::default()) {
            let _ = e.key(Key::Control, Direction::Press);
            let _ = e.key(Key::Unicode('v'), Direction::Click);
            let _ = e.key(Key::Control, Direction::Release);
        }
    });
    Ok(())
}

#[tauri::command]
fn pin_entry(state: State<'_, App>, id: String) -> Result<(), String> {
    if let Ok(mut h) = state.history.lock() {
        if let Some(e) = h.iter_mut().find(|e| e.id == id) {
            e.pinned = true;
        }
        if let Some(pos) = h.iter().position(|e| e.id == id) {
            let item = h.remove(pos);
            h.insert(0, item);
        }
    }
    persist_history(&state);
    Ok(())
}

#[tauri::command]
fn unpin_entry(state: State<'_, App>, id: String) -> Result<(), String> {
    if let Ok(mut h) = state.history.lock() {
        if let Some(e) = h.iter_mut().find(|e| e.id == id) {
            e.pinned = false;
        }
        if let Some(pos) = h.iter().position(|e| e.id == id) {
            let item = h.remove(pos);
            let insert_pos = h.iter().position(|e| !e.pinned).unwrap_or(0);
            h.insert(insert_pos, item);
        }
    }
    persist_history(&state);
    Ok(())
}

#[tauri::command]
fn delete_entry(state: State<'_, App>, id: String) -> Result<(), String> {
    if let Ok(mut h) = state.history.lock() {
        h.retain(|e| e.id != id);
    }
    persist_history(&state);
    Ok(())
}

fn uuid_v4() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn toggle_overlay(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window(OVERLAY) else {
        return;
    };
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
        return;
    }

    // Position near the cursor, keeping the panel fully on-screen.
    if let Ok(cursor) = window.cursor_position() {
        if let Ok(monitor) = window.current_monitor() {
            let monitor = monitor.unwrap_or_else(|| {
                window
                    .available_monitors()
                    .ok()
                    .and_then(|m| m.into_iter().next())
                    .unwrap()
            });
            let scale = monitor.scale_factor();
            let msize = monitor.size();
            let mpos = monitor.position();

            // Panel dimensions in physical pixels
            let pw = (360.0 * scale) as i32;
            let ph = (480.0 * scale) as i32;

            // Place below-right of cursor with a small offset
            let mut x = cursor.x as i32 + 12;
            let mut y = cursor.y as i32 + 12;

            // Clamp so the panel never goes off the right or bottom edge
            let right_limit = mpos.x + msize.width as i32 - pw;
            let bottom_limit = mpos.y + msize.height as i32 - ph;
            if x > right_limit {
                x = cursor.x as i32 - pw - 12;
            } // flip left
            if y > bottom_limit {
                y = cursor.y as i32 - ph - 12;
            } // flip up

            use tauri::PhysicalPosition;
            let _ = window.set_position(PhysicalPosition::new(x, y));
        }
    }

    let _ = window.show();
    let _ = window.set_focus();
}

fn open_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be the first plugin registered: it decides whether this process
        // has any business continuing at all, and that answer should not depend
        // on how much of the app happened to be initialised before it ran.
        //
        // ClipLink lives in the tray with its main window hidden, so launching
        // it again is never a request for a second copy — it is someone looking
        // for the copy they already have. Surface that one and let this process
        // die; the plugin exits it as soon as this callback returns.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            open_main(app);
        }))
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        toggle_overlay(app);
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            create_pairing,
            get_current_hosts,
            get_settings,
            set_hotkey,
            set_launch_at_startup,
            set_history_limit,
            clear_history,
            unpair_device,
            rename_device,
            get_history,
            copy_to_clipboard,
            paste_from_overlay,
            send_file,
            open_path,
            dismiss_phone_notification,
            pin_entry,
            unpin_entry,
            delete_entry,
        ])
        .setup(|app| {
            let settings_dir = app.path().app_data_dir()?;
            let settings = Settings::load(&settings_dir);
            let hotkey = settings.hotkey.clone();
            let launch_at_startup = settings.launch_at_startup;

            let suppressor = EchoSuppressor::default();
            let server = Arc::new(ServerState::new(
                settings,
                settings_dir.clone(),
                Arc::new(candidate_hosts),
            ));

            // Load persisted clipboard history from disk
            let history_store = HistoryStore::new(&settings_dir);
            let persisted_history: Vec<ClipEntry> = history_store
                .load()
                .into_iter()
                .map(ClipEntry::from)
                .collect();

            // mDNS advertisement — phones discover this PC by service name,
            // so reconnection works even after the IP changes.
            let mdns = discovery::advertise(&server.device_id, &server.device_name(), DEFAULT_PORT);
            if mdns.is_none() {
                eprintln!("ClipLink: mDNS advertisement unavailable — phones will use stored IP.");
            }

            // Inbound: phone copied something.
            let handle = app.handle().clone();
            let inbound_state = Arc::clone(&server);
            let inbound_suppressor = suppressor.clone();
            let paired_handle = app.handle().clone();
            let file_handle = app.handle().clone();
            let file_state = Arc::clone(&server);
            let notif_handle = app.handle().clone();
            server::start(
                Arc::clone(&server),
                move |clip: InboundClip| {
                    let is_image = clip.content_type.starts_with("image/");
                    let is_html = clip.content_type == "text/html";

                    if is_image {
                        if let Some(ref png) = clip.image_png {
                            if let Err(e) = clipboard::apply_image(png, &inbound_suppressor) {
                                eprintln!("ClipLink: {e}");
                                return;
                            }
                        }
                    } else if is_html {
                        if let Err(e) =
                            clipboard::apply_html(&clip.text, &clip.plain, &inbound_suppressor)
                        {
                            eprintln!("ClipLink: {e}");
                            return;
                        }
                    } else {
                        // Check if it's a URL — open in browser automatically
                        let text = clip.text.trim();
                        let is_url = text.starts_with("http://") || text.starts_with("https://");
                        if is_url {
                            let url = text.to_string();
                            std::thread::spawn(move || {
                                let _ = open::that(&url);
                            });
                        }
                        if let Err(e) = clipboard::apply_text(&clip.text, &inbound_suppressor) {
                            eprintln!("ClipLink: {e}");
                            return;
                        }
                    }

                    let device_name = inbound_state
                        .settings
                        .lock()
                        .ok()
                        .and_then(|s| {
                            s.paired_devices
                                .iter()
                                .find(|d| d.device_id == clip.origin)
                                .map(|d| d.device_name.clone())
                        })
                        .unwrap_or_else(|| "Android phone".into());

                    let image_data_url = clip
                        .image_png
                        .as_deref()
                        .map(clipboard::png_to_data_url)
                        .unwrap_or_default();

                    let display_text = if is_html {
                        // Store plain fallback for history display
                        clip.plain.clone()
                    } else {
                        clip.text.clone()
                    };

                    let entry = ClipEntry {
                        id: uuid_v4(),
                        text: display_text,
                        image_data_url,
                        content_type: clip.content_type,
                        origin: clip.origin,
                        device_name,
                        received_at: now(),
                        pinned: false,
                    };

                    if let Some(state) = handle.try_state::<App>() {
                        state.record(entry.clone());
                    }
                    let _ = handle.emit("clip", entry);
                },
                move |file: InboundFile| {
                    // Save the received file to the user's Downloads folder
                    let downloads = dirs_next::download_dir()
                        .or_else(dirs_next::home_dir)
                        .unwrap_or_else(|| std::path::PathBuf::from("."));
                    let dest = downloads.join(&file.file_name);
                    if let Err(e) = std::fs::write(&dest, &file.data) {
                        eprintln!("ClipLink: could not save file {}: {e}", file.file_name);
                        return;
                    }
                    let device_name = file_state
                        .settings
                        .lock()
                        .ok()
                        .and_then(|s| {
                            s.paired_devices
                                .iter()
                                .find(|d| d.device_id == file.origin)
                                .map(|d| d.device_name.clone())
                        })
                        .unwrap_or_else(|| "Android phone".into());
                    let _ = file_handle.emit(
                        "file_received",
                        serde_json::json!({
                            "fileName": file.file_name,
                            "mimeType": file.mime_type,
                            "size": file.data.len(),
                            "path": dest.to_string_lossy(),
                            "deviceName": device_name,
                        }),
                    );
                },
                move |notif: crate::protocol::PhoneNotification| {
                    // Forward the phone notification to the frontend as a Tauri event.
                    // The frontend can display it as a Windows notification toast.
                    let _ = notif_handle.emit("phone_notification", &notif);
                },
                move |device: settings::PairedDevice| {
                    let _ = paired_handle.emit("device_paired", device);
                },
            );

            // Outbound: this PC copied something.
            let handle = app.handle().clone();
            let outbound_state = Arc::clone(&server);
            clipboard::watch(suppressor.clone(), move |content| {
                use clipboard::ClipboardContent;

                let (text, image_png, content_type) = match &content {
                    ClipboardContent::Text(t) => (t.clone(), None, "text/plain".to_string()),
                    ClipboardContent::Image(png) => {
                        (String::new(), Some(png.clone()), "image/png".to_string())
                    }
                };

                // Display text for history
                let display_text = match &content {
                    ClipboardContent::Text(t) => t.clone(),
                    ClipboardContent::Image(_) => String::new(),
                };

                let image_data_url = image_png
                    .as_deref()
                    .map(clipboard::png_to_data_url)
                    .unwrap_or_default();

                let id = uuid_v4();
                let entry = ClipEntry {
                    id: id.clone(),
                    text: display_text,
                    image_data_url,
                    content_type: content_type.clone(),
                    origin: outbound_state.device_id.clone(),
                    device_name: outbound_state.device_name(),
                    received_at: now(),
                    pinned: false,
                };

                let _ = outbound_state
                    .outgoing
                    .send(OutgoingMessage::Clip(OutgoingClip {
                        id,
                        origin: outbound_state.device_id.clone(),
                        content_type: content_type.clone(),
                        text,
                        image_png,
                        sent_at: now(),
                    }));

                if let Some(state) = handle.try_state::<App>() {
                    state.record(entry.clone());
                }
                let _ = handle.emit("clip", entry);
            });

            app.manage(App {
                server,
                history: Mutex::new(persisted_history),
                suppressor,
                history_store,
                _mdns: mdns,
            });

            // Hotkey
            match Shortcut::from_str(&hotkey) {
                Ok(shortcut) => {
                    if app.global_shortcut().register(shortcut).is_err() {
                        eprintln!("ClipLink: '{hotkey}' is taken by another app.");
                    }
                }
                Err(_) => eprintln!("ClipLink: '{hotkey}' is not a valid shortcut."),
            }

            // Honour the stored autostart preference on every launch.
            let autostart = app.autolaunch();
            let is_enabled = autostart.is_enabled().unwrap_or(false);
            if launch_at_startup && !is_enabled {
                let _ = autostart.enable();
            } else if !launch_at_startup && is_enabled {
                let _ = autostart.disable();
            }

            // Tray
            let show = MenuItem::with_id(app, "show", "Open ClipLink", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            let mut tray = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("ClipLink")
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click {
                        button: tauri::tray::MouseButton::Left,
                        button_state: tauri::tray::MouseButtonState::Up,
                        ..
                    } = event
                    {
                        toggle_overlay(tray.app_handle());
                    }
                })
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => open_main(app),
                    "quit" => app.exit(0),
                    _ => {}
                });

            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let _ = window.hide();
            }
            tauri::WindowEvent::Focused(false) if window.label() == OVERLAY => {
                let _ = window.hide();
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running ClipLink");
}
