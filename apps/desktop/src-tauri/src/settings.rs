//! On-disk state: identity, hotkey, paired phones, user preferences,
//! and persisted clipboard history.

use crate::crypto::Identity;
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub const DEFAULT_HOTKEY: &str = "CommandOrControl+Shift+V";
pub const DEFAULT_HISTORY_LIMIT: usize = 50;

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PairedDevice {
    pub device_id: String,
    pub device_name: String,
    pub public_key: String,
    pub paired_at: u64,
    #[serde(default)]
    pub last_host: Option<String>,
    #[serde(default)]
    pub last_seen: Option<u64>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub hotkey: String,
    pub device_name: String,
    pub secret_key: String,
    pub paired_devices: Vec<PairedDevice>,
    #[serde(default)]
    pub launch_at_startup: bool,
    #[serde(default = "default_history_limit")]
    pub history_limit: usize,
}

fn default_history_limit() -> usize {
    DEFAULT_HISTORY_LIMIT
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            hotkey: DEFAULT_HOTKEY.into(),
            device_name: hostname().unwrap_or_else(|| "This Windows PC".into()),
            secret_key: B64.encode(Identity::generate().to_bytes()),
            paired_devices: Vec::new(),
            launch_at_startup: false,
            history_limit: DEFAULT_HISTORY_LIMIT,
        }
    }
}

impl Settings {
    pub fn load(dir: &Path) -> Self {
        let parsed = std::fs::read_to_string(Self::path(dir))
            .ok()
            .and_then(|raw| serde_json::from_str::<Settings>(&raw).ok());

        match parsed {
            Some(settings) => settings,
            None => {
                let fresh = Settings::default();
                let _ = fresh.save(dir);
                fresh
            }
        }
    }

    pub fn save(&self, dir: &Path) -> std::io::Result<()> {
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
        self.paired_devices
            .retain(|d| d.device_id != device.device_id);
        self.paired_devices.push(device);
    }

    pub fn update_last_seen(&mut self, device_id: &str, host: &str, now: u64) {
        if let Some(d) = self
            .paired_devices
            .iter_mut()
            .find(|d| d.device_id == device_id)
        {
            d.last_host = Some(host.to_string());
            d.last_seen = Some(now);
        }
    }

    pub fn remove_device(&mut self, device_id: &str) {
        self.paired_devices.retain(|d| d.device_id != device_id);
    }

    fn path(dir: &Path) -> PathBuf {
        dir.join("settings.json")
    }
}

// ─── Persisted history ────────────────────────────────────────────────────────

/// A clipboard entry as stored on disk. Image data URLs are large so we cap
/// the number of image entries separately in practice via history_limit.
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PersistedEntry {
    pub id: String,
    pub text: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub image_data_url: String,
    pub origin: String,
    pub device_name: String,
    pub received_at: u64,
    #[serde(default)]
    pub pinned: bool,
    /// "text/plain", "text/html", "image/png", etc.
    #[serde(default = "default_content_type")]
    pub content_type: String,
}

fn default_content_type() -> String {
    "text/plain".into()
}

pub struct HistoryStore {
    path: PathBuf,
}

impl HistoryStore {
    pub fn new(dir: &Path) -> Self {
        Self {
            path: dir.join("history.json"),
        }
    }

    pub fn load(&self) -> Vec<PersistedEntry> {
        std::fs::read_to_string(&self.path)
            .ok()
            .and_then(|raw| serde_json::from_str::<Vec<PersistedEntry>>(&raw).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, entries: &[PersistedEntry]) {
        if let Ok(json) = serde_json::to_string(entries) {
            let _ = std::fs::write(&self.path, json);
        }
    }
}

fn hostname() -> Option<String> {
    std::env::var("COMPUTERNAME")
        .ok()
        .filter(|name| !name.is_empty())
}
