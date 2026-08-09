mod clipboard;
mod crypto;
mod discovery;
mod protocol;
mod server;
mod settings;

use clipboard::EchoSuppressor;
use protocol::{PairingOffer, DEFAULT_PORT, PROTOCOL_VERSION};
use serde::Serialize;
use server::{now, InboundClip, OutgoingClip, ServerState};
use settings::Settings;
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
    origin: String,
    device_name: String,
    received_at: u64,
}

struct App {
    server: Arc<ServerState>,
    history: Mutex<Vec<ClipEntry>>,
    suppressor: EchoSuppressor,
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
            history.retain(|e| e.id != entry.id);
            history.insert(0, entry);
            history.truncate(limit);
        }
    }
}

fn rank(adapter: &str, ip: &Ipv4Addr) -> u8 {
    let name = adapter.to_ascii_lowercase();
    let virtualised = [
        "vethernet", "wsl", "docker", "vmware", "virtualbox",
        "hyper-v", "tailscale", "zerotier", "radmin",
        "tap", "tun", "utun", "bridge",
    ]
    .iter()
    .any(|needle| name.contains(needle));

    let base = match ip.octets() {
        [192, 168, ..] => 0,
        [10, ..] => 1,
        [172, second, ..] if (16..=31).contains(&second) => 2,
        _ => 3,
    };
    if virtualised { base + 10 } else { base }
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
            .and_then(|s| { s.connect("8.8.8.8:80")?; s.local_addr() })
            .map(|addr| vec![addr.ip().to_string()])
            .unwrap_or_else(|_| vec!["127.0.0.1".into()]);
    }
    hosts
}

// ─── Tauri commands ──────────────────────────────────────────────────────────

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
    let s = app.server.settings.lock().map_err(|_| "settings unavailable")?;
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
    let parsed = Shortcut::from_str(&hotkey)
        .map_err(|_| format!("'{hotkey}' is not a valid shortcut."))?;

    let previous = {
        let s = state.server.settings.lock().map_err(|_| "settings unavailable")?;
        s.hotkey.clone()
    };

    app.global_shortcut().register(parsed).map_err(|_| {
        format!("Windows would not give ClipLink '{hotkey}'. Another app likely owns it.")
    })?;

    if let Ok(old) = Shortcut::from_str(&previous) {
        let _ = app.global_shortcut().unregister(old);
    }

    let mut s = state.server.settings.lock().map_err(|_| "settings unavailable")?;
    s.hotkey = hotkey;
    s.save(&state.server.settings_dir).map_err(|e| e.to_string())
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
    let mut s = state.server.settings.lock().map_err(|_| "settings unavailable")?;
    s.launch_at_startup = enabled;
    s.save(&state.server.settings_dir).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_history_limit(state: State<'_, App>, limit: usize) -> Result<(), String> {
    let clamped = limit.clamp(10, 500);
    {
        let mut s = state.server.settings.lock().map_err(|_| "settings unavailable")?;
        s.history_limit = clamped;
        s.save(&state.server.settings_dir).map_err(|e| e.to_string())?;
    }
    // Trim existing history to the new limit
    if let Ok(mut history) = state.history.lock() {
        history.truncate(clamped);
    }
    Ok(())
}

#[tauri::command]
fn clear_history(state: State<'_, App>) -> Result<(), String> {
    state.history.lock().map_err(|_| "history unavailable")?.clear();
    Ok(())
}

#[tauri::command]
fn unpair_device(
    app: tauri::AppHandle,
    state: State<'_, App>,
    device_id: String,
) -> Result<(), String> {
    let mut s = state.server.settings.lock().map_err(|_| "settings unavailable")?;
    s.remove_device(&device_id);
    s.save(&state.server.settings_dir).map_err(|e| e.to_string())?;
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
    if trimmed.is_empty() { return Err("Name cannot be empty.".into()); }
    {
        let mut s = state.server.settings.lock().map_err(|_| "settings unavailable")?;
        if let Some(d) = s.paired_devices.iter_mut().find(|d| d.device_id == device_id) {
            d.device_name = trimmed;
        }
        s.save(&state.server.settings_dir).map_err(|e| e.to_string())?;
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
    let _ = app.server.outgoing.send(OutgoingClip {
        id: uuid_v4(),
        origin: app.server.device_id.clone(),
        content_type: "text/plain".into(),
        text,
        sent_at: now(),
    });
    Ok(())
}

fn uuid_v4() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn toggle_overlay(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window(OVERLAY) else { return; };
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
    } else {
        let _ = window.show();
        let _ = window.set_focus();
    }
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
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec![])))
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
            get_settings,
            set_hotkey,
            set_launch_at_startup,
            set_history_limit,
            clear_history,
            unpair_device,
            rename_device,
            get_history,
            copy_to_clipboard,
        ])
        .setup(|app| {
            let settings_dir = app.path().app_data_dir()?;
            let settings = Settings::load(&settings_dir);
            let hotkey = settings.hotkey.clone();
            let launch_at_startup = settings.launch_at_startup;

            let suppressor = EchoSuppressor::default();
            let server = Arc::new(ServerState::new(settings, settings_dir));

            // mDNS advertisement — phones discover this PC by service name,
            // so reconnection works even after the IP changes.
            let mdns = discovery::advertise(
                &server.device_id,
                &server.device_name(),
                DEFAULT_PORT,
            );
            if mdns.is_none() {
                eprintln!("ClipLink: mDNS advertisement unavailable — phones will use stored IP.");
            }

            // Inbound: phone copied something.
            let handle = app.handle().clone();
            let inbound_state = Arc::clone(&server);
            let inbound_suppressor = suppressor.clone();
            let paired_handle = app.handle().clone();
            server::start(Arc::clone(&server), move |clip: InboundClip| {
                if let Err(e) = clipboard::apply_text(&clip.text, &inbound_suppressor) {
                    eprintln!("ClipLink: {e}");
                    return;
                }

                let device_name = inbound_state
                    .settings.lock().ok()
                    .and_then(|s| s.paired_devices.iter().find(|d| d.device_id == clip.origin)
                        .map(|d| d.device_name.clone()))
                    .unwrap_or_else(|| "Android phone".into());

                let entry = ClipEntry {
                    id: uuid_v4(),
                    text: clip.text,
                    origin: clip.origin,
                    device_name,
                    received_at: now(),
                };

                if let Some(state) = handle.try_state::<App>() {
                    state.record(entry.clone());
                }
                let _ = handle.emit("clip", entry);
            }, move |device: settings::PairedDevice| {
                let _ = paired_handle.emit("device_paired", device);
            });

            // Outbound: this PC copied something.
            let handle = app.handle().clone();
            let outbound_state = Arc::clone(&server);
            clipboard::watch(suppressor.clone(), move |text| {
                let entry = ClipEntry {
                    id: uuid_v4(),
                    text: text.clone(),
                    origin: outbound_state.device_id.clone(),
                    device_name: outbound_state.device_name(),
                    received_at: now(),
                };

                let _ = outbound_state.outgoing.send(OutgoingClip {
                    id: entry.id.clone(),
                    origin: outbound_state.device_id.clone(),
                    content_type: "text/plain".into(),
                    text,
                    sent_at: now(),
                });

                if let Some(state) = handle.try_state::<App>() {
                    state.record(entry.clone());
                }
                let _ = handle.emit("clip", entry);
            });

            app.manage(App {
                server,
                history: Mutex::new(Vec::new()),
                suppressor,
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
                    } = event {
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
