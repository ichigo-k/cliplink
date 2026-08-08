// Without this, Windows attaches a console to the process: a terminal window
// appears behind the app, and closing it kills ClipLink. Release builds only,
// so `cargo run` still prints to the terminal during development.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    cliplink_lib::run()
}
