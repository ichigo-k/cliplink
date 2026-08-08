//! Rust mirror of `packages/protocol`. Keep the two in step — the field names
//! here are the wire format, so renaming one without the other breaks pairing.

use serde::{Deserialize, Serialize};

pub const PROTOCOL_VERSION: u32 = 1;
pub const DEFAULT_PORT: u16 = 47123;
pub const MAX_PAYLOAD_BYTES: usize = 1024 * 1024;
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

/// An inbound frame. Unknown `type` values deserialize to `Unknown` and are
/// dropped rather than closing the socket, so a newer phone talking to an older
/// PC degrades instead of failing outright.
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum Inbound {
    Hello(Hello),
    Clip(Clip),
    Ping,
    #[serde(other)]
    Unknown,
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
