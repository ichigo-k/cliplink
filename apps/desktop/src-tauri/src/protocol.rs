//! Rust mirror of `packages/protocol`. Keep the two in step — the field names
//! here are the wire format, so renaming one without the other breaks pairing.

use serde::{Deserialize, Serialize};

pub const PROTOCOL_VERSION: u32 = 1;
pub const DEFAULT_PORT: u16 = 47123;
pub const MAX_TEXT_PAYLOAD_BYTES: usize = 1024 * 1024;
pub const MAX_IMAGE_PAYLOAD_BYTES: usize = 5 * 1024 * 1024;
pub const MAX_FILE_CHUNK_BYTES: usize = 256 * 1024;
pub const MAX_PAYLOAD_BYTES: usize = MAX_IMAGE_PAYLOAD_BYTES;
pub const PAIRING_TTL_SECS: u64 = 300;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PairingOffer {
    pub app: &'static str,
    pub version: u32,
    pub device_id: String,
    pub device_name: String,
    /// Best guess, kept for older phones that only read a single host.
    pub host: String,
    /// Every address worth trying, most likely first.
    pub hosts: Vec<String>,
    pub port: u16,
    pub nonce: String,
    pub public_key: String,
    pub expires_at: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Hello {
    pub nonce: String,
    pub device_id: String,
    pub device_name: String,
    pub public_key: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HelloAck {
    #[serde(rename = "type")]
    pub kind: &'static str,
    pub device_id: String,
    pub device_name: String,
    pub public_key: String,
    /// Current host list — sent on every handshake so reconnecting phones
    /// always update their IP cache even if the PC's address changed.
    pub hosts: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Clip {
    #[serde(rename = "type")]
    pub kind: String,
    pub id: String,
    pub origin: String,
    pub content_type: String,
    pub hash: String,
    pub sent_at: u64,
    pub payload: String,
}

/// An inbound frame.
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum Inbound {
    Hello(Hello),
    Clip(Clip),
    Ping,
    FileStart(FileStart),
    FileChunk(FileChunk),
    FileAck(FileAck),
    Notification(PhoneNotification),
    NotificationDismiss(NotificationDismiss),
    #[serde(other)]
    Unknown,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FileStart {
    pub transfer_id: String,
    pub file_name: String,
    pub file_size: u64,
    pub mime_type: String,
    pub total_chunks: u32,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FileChunk {
    pub transfer_id: String,
    pub chunk_index: u32,
    pub total_chunks: u32,
    pub payload: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FileAck {
    pub transfer_id: String,
    pub ok: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PhoneNotification {
    pub key: String,
    pub package_name: String,
    pub app_name: String,
    pub title: String,
    pub text: String,
    pub posted_at: u64,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NotificationDismiss {
    pub key: String,
}

#[derive(Serialize)]
pub struct ProtocolError {
    #[serde(rename = "type")]
    pub kind: &'static str,
    pub code: &'static str,
    pub message: &'static str,
}

impl ProtocolError {
    pub fn new(code: &'static str, message: &'static str) -> Self {
        ProtocolError {
            kind: "error",
            code,
            message,
        }
    }
}
