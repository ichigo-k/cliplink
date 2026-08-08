//! On-disk state: this PC's identity, the configurable hotkey, and the phones
//! that have already paired.

use crate::crypto::Identity;
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Win+K and Win+V are deliberately not options — Windows 11 reserves them for
/// Cast and clipboard history, and a third-party app cannot take them.
pub const DEFAULT_HOTKEY: &str = "CommandOrControl+Shift+V";

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PairedDevice {
    pub device_id: String,
    pub device_name: String,
    pub public_key: String,
    pub paired_at: u64,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub hotkey: String,
    pub device_name: String,
    pub secret_key: String,
    pub paired_devices: Vec<PairedDevice>,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            hotkey: DEFAULT_HOTKEY.into(),
            device_name: hostname().unwrap_or_else(|| "This Windows PC".into()),
            secret_key: B64.encode(Identity::generate().to_bytes()),
            paired_devices: Vec::new(),
        }
    }
}

impl Settings {
    pub fn load(dir: &PathBuf) -> Self {
        let parsed = std::fs::read_to_string(Self::path(dir))
            .ok()
            .and_then(|raw| serde_json::from_str::<Settings>(&raw).ok());

        match parsed {
            Some(settings) => settings,
            None => {
                // First run, or the file was corrupted. Either way a fresh
                // identity is the only safe recovery — reusing a half-read key
                // would silently break every existing pairing.
                let fresh = Settings::default();
                let _ = fresh.save(dir);
                fresh
            }
        }
    }

    pub fn save(&self, dir: &PathBuf) -> std::io::Result<()> {
        std::fs::create_dir_all(dir)?;
        std::fs::write(Self::path(dir), serde_json::to_string_pretty(self)?)
    }

    pub fn identity(&self) -> Identity {
        B64.decode(&self.secret_key)
            .ok()
            .and_then(|bytes| <[u8; 32]>::try_from(bytes).ok())
            .map(Identity::from_bytes)
            .unwrap_or_else(Identity::generate)
    }

    pub fn remember(&mut self, device: PairedDevice) {
        self.paired_devices.retain(|d| d.device_id != device.device_id);
        self.paired_devices.push(device);
    }

    fn path(dir: &PathBuf) -> PathBuf {
        dir.join("settings.json")
    }
}

fn hostname() -> Option<String> {
    std::env::var("COMPUTERNAME").ok().filter(|name| !name.is_empty())
}
