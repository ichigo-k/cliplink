mod clipboard;
mod crypto;
mod protocol;
mod server;
mod settings;

use clipboard::EchoSuppressor;
use protocol::{PairingOffer, DEFAULT_PORT, PROTOCOL_VERSION};
use server::{now, InboundClip, OutgoingClip, ServerState};
use settings::Settings;
use serde::Serialize;
use std::{
    net::UdpSocket,
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

/// Finds the LAN address a phone can actually reach.
///
/// Connecting a UDP socket to a public address sends no packets — it just asks
/// the routing table which interface would be used, which is more reliable than
/// picking the first entry from a host lookup.
fn local_ip() -> String {
    UdpSocket::bind("0.0.0.0:0")
        .and_then(|s| {
            s.connect("8.8.8.8:80")?;
            s.local_addr()
        })
        .map(|addr| addr.ip().to_string())
        .unwrap_or_else(|_| "127.0.0.1".into())
}

#[tauri::command]
fn create_pairing(app: State<'_, App>) -> PairingOffer {
    let (nonce, expires_at) = app.server.issue_nonce();

    PairingOffer {
        app: "ClipLink",
        version: PROTOCOL_VERSION,
        device_id: app.server.device_id.clone(),
        device_name: app.server.device_name(),
        host: local_ip(),
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
    let settings = app.server.settings.lock().map_err(|_| "settings unavailable")?;
    Ok(SettingsView {
        hotkey: settings.hotkey.clone(),
        device_name: settings.device_name.clone(),
        paired_devices: settings.paired_devices.clone(),
    })
}

#[tauri::command]
fn set_hotkey(app: tauri::AppHandle, state: State<'_, App>, hotkey: String) -> Result<(), String> {
    let parsed = Shortcut::from_str(&hotkey).map_err(|_| format!("'{hotkey}' is not a valid shortcut."))?;

    let previous = {
        let settings = state.server.settings.lock().map_err(|_| "settings unavailable")?;
        settings.hotkey.clone()
    };

    // Take the new binding before dropping the old one, so a rejected shortcut
    // does not leave the user with no way to open the window.
    app.global_shortcut()
        .register(parsed)
        .map_err(|_| format!("Windows would not give ClipLink '{hotkey}'. Another app likely owns it."))?;

    if let Ok(old) = Shortcut::from_str(&previous) {
        let _ = app.global_shortcut().unregister(old);
    }

    let mut settings = state.server.settings.lock().map_err(|_| "settings unavailable")?;
    settings.hotkey = hotkey;
    settings.save(&state.server.settings_dir).map_err(|e| e.to_string())
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

fn toggle_window(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else { return };

    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
    } else {
        let _ = window.show();
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
                        toggle_window(app);
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
            let server = Arc::new(ServerState::new(settings, settings_dir, suppressor.clone()));

            // Inbound: phone copied something.
            let handle = app.handle().clone();
            let inbound_state = Arc::clone(&server);
            let inbound_suppressor = suppressor.clone();
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

            TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("ClipLink")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        // Closing hides to the tray; ClipLink is only useful while it is running.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running ClipLink");
}
