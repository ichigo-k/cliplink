mod clipboard;
mod crypto;
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
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

const HISTORY_LIMIT: usize = 50;
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
}

impl App {
    fn record(&self, entry: ClipEntry) {
        if let Ok(mut history) = self.history.lock() {
            history.insert(0, entry);
            history.truncate(HISTORY_LIMIT);
        }
    }
}

/// Ranks an address by how likely a phone on the same Wi-Fi can reach it.
/// Lower is better.
fn rank(adapter: &str, ip: &Ipv4Addr) -> u8 {
    let name = adapter.to_ascii_lowercase();

    // These adapters are real and routable from this PC, but they lead to a
    // virtual machine or tunnel, not to the phone on the sofa.
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

/// Every address a phone might reach this PC on, most likely first.
///
/// A single address is not enough. VPNs, WSL, Hyper-V and Docker all add
/// adapters, and the one that routes to the internet is frequently not the one
/// sharing a network with the phone — so the QR code carries the whole list and
/// the phone tries each in turn.
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
        // Last resort: ask the routing table which interface reaches the
        // internet. Sends no packets — a connected UDP socket just resolves a
        // route.
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SettingsView {
    hotkey: String,
    device_name: String,
    paired_devices: Vec<settings::PairedDevice>,
}

#[tauri::command]
fn get_settings(app: State<'_, App>) -> Result<SettingsView, String> {
    let settings = app
        .server
        .settings
        .lock()
        .map_err(|_| "settings unavailable")?;
    Ok(SettingsView {
        hotkey: settings.hotkey.clone(),
        device_name: settings.device_name.clone(),
        paired_devices: settings.paired_devices.clone(),
    })
}

#[tauri::command]
fn set_hotkey(app: tauri::AppHandle, state: State<'_, App>, hotkey: String) -> Result<(), String> {
    let parsed =
        Shortcut::from_str(&hotkey).map_err(|_| format!("'{hotkey}' is not a valid shortcut."))?;

    let previous = {
        let settings = state
            .server
            .settings
            .lock()
            .map_err(|_| "settings unavailable")?;
        settings.hotkey.clone()
    };

    // Take the new binding before dropping the old one, so a rejected shortcut
    // does not leave the user with no way to open the window.
    app.global_shortcut().register(parsed).map_err(|_| {
        format!("Windows would not give ClipLink '{hotkey}'. Another app likely owns it.")
    })?;

    if let Ok(old) = Shortcut::from_str(&previous) {
        let _ = app.global_shortcut().unregister(old);
    }

    let mut settings = state
        .server
        .settings
        .lock()
        .map_err(|_| "settings unavailable")?;
    settings.hotkey = hotkey;
    settings
        .save(&state.server.settings_dir)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_history(app: State<'_, App>) -> Vec<ClipEntry> {
    app.history.lock().map(|h| h.clone()).unwrap_or_default()
}

/// Puts a history entry back on the clipboard and pushes it to the phone.
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

/// The hotkey summons the compact flyout, not the full app. The full window is
/// for pairing and settings and is reached from the tray menu.
fn toggle_overlay(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window(OVERLAY) else {
        return;
    };

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
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    // Fires on both press and release; without this guard the
                    // window toggles twice per keypress and appears not to open.
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
            get_history,
            copy_to_clipboard
        ])
        .setup(|app| {
            let settings_dir = app.path().app_data_dir()?;
            let settings = Settings::load(&settings_dir);
            let hotkey = settings.hotkey.clone();

            let suppressor = EchoSuppressor::default();
            let server = Arc::new(ServerState::new(settings, settings_dir));

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
                    .settings
                    .lock()
                    .ok()
                    .and_then(|s| s.paired_devices.iter().find(|d| d.device_id == clip.origin).map(|d| d.device_name.clone()))
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
                // A phone just paired — notify the frontend immediately so the
                // devices list refreshes without waiting for the first clip.
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

            app.manage(App { server, history: Mutex::new(Vec::new()), suppressor });

            match Shortcut::from_str(&hotkey) {
                Ok(shortcut) => {
                    if app.global_shortcut().register(shortcut).is_err() {
                        eprintln!("ClipLink: '{hotkey}' is taken by another app. Pick a different one in Settings.");
                    }
                }
                Err(_) => eprintln!("ClipLink: '{hotkey}' is not a valid shortcut."),
            }

            let show = MenuItem::with_id(app, "show", "Open ClipLink", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            let mut tray = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("ClipLink")
                // Left click toggles, matching the hotkey. Without this the only
                // way in is the context menu, which is not discoverable.
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

            // Without an explicit icon the tray entry renders blank. The window
            // is hidden at startup and skips the taskbar, so a blank tray icon
            // leaves no visible way to reach ClipLink at all.
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }

            tray.build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| match event {
            // Closing hides to the tray; ClipLink is only useful while running.
            tauri::WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let _ = window.hide();
            }
            // The flyout dismisses when you click away, the way the Windows
            // clipboard panel does. Only the overlay: the main window should
            // stay put when it loses focus.
            tauri::WindowEvent::Focused(false) if window.label() == OVERLAY => {
                let _ = window.hide();
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running ClipLink");
}
