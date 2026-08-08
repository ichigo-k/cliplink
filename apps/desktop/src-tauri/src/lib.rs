use rand::{distributions::Alphanumeric, Rng};
use serde::Serialize;
use std::{net::UdpSocket, time::{SystemTime, UNIX_EPOCH}};
use tauri::{menu::{Menu, MenuItem}, tray::TrayIconBuilder, Manager};

#[derive(Serialize)]
struct Pairing {
    device_id: String,
    device_name: String,
    host: String,
    port: u16,
    nonce: String,
    expires_at: u64,
}

fn local_ip() -> String {
    UdpSocket::bind("0.0.0.0:0").and_then(|s| { s.connect("8.8.8.8:80")?; s.local_addr() }).map(|a| a.ip().to_string()).unwrap_or_else(|_| "127.0.0.1".into())
}

#[tauri::command]
fn create_pairing() -> Pairing {
    let nonce: String = rand::thread_rng().sample_iter(&Alphanumeric).take(32).map(char::from).collect();
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs();
    Pairing { device_id: format!("win-{}", &nonce[..8]), device_name: "This Windows PC".into(), host: local_ip(), port: 47123, nonce, expires_at: now + 300 }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![create_pairing])
        .setup(|app| {
            let show = MenuItem::with_id(app, "show", "Open ClipLink", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            TrayIconBuilder::new().menu(&menu).tooltip("ClipLink").on_menu_event(|app, event| match event.id.as_ref() { "show" => { if let Some(w) = app.get_webview_window("main") { let _ = w.show(); let _ = w.set_focus(); } }, "quit" => app.exit(0), _ => {} }).build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| if let tauri::WindowEvent::CloseRequested { api, .. } = event { api.prevent_close(); let _ = window.hide(); })
        .run(tauri::generate_context!()).expect("error while running ClipLink");
}
