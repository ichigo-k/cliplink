//! The LAN sync server. The desktop listens; phones connect to it.
//!
//! Binds `0.0.0.0` so any device on the same network can reach it, which is the
//! whole point — but it also means the nonce check in `handshake` is the only
//! thing standing between a stranger on the same Wi-Fi and your clipboard.

use crate::{
    crypto::{hash_hex, Identity},
    protocol::{
        Clip, FileAck, FileChunk, FileStart, HelloAck, Inbound, ProtocolError, DEFAULT_PORT,
        MAX_FILE_CHUNK_BYTES, MAX_IMAGE_PAYLOAD_BYTES, MAX_TEXT_PAYLOAD_BYTES, PAIRING_TTL_SECS,
    },
    settings::{PairedDevice, Settings},
};
use futures_util::{SinkExt, StreamExt};
use rand::{distributions::Alphanumeric, Rng};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};
use tokio::{net::TcpListener, sync::broadcast};
use tokio_tungstenite::tungstenite::Message as WsMessage;

/// A local copy on its way out.
#[derive(Clone)]
pub struct OutgoingClip {
    pub id: String,
    pub origin: String,
    pub content_type: String,
    pub text: String,
    pub image_png: Option<Vec<u8>>,
    pub sent_at: u64,
}

/// A file transfer initiated from the PC to phone(s).
#[derive(Clone)]
pub struct OutgoingFile {
    pub transfer_id: String,
    pub file_name: String,
    pub data: Vec<u8>,
    pub mime_type: String,
}

/// Everything the broadcast channel can carry.
#[derive(Clone)]
pub enum OutgoingMessage {
    Clip(OutgoingClip),
    File(OutgoingFile),
    /// Dismiss a notification on the phone (sent from the PC).
    NotificationDismiss {
        key: String,
    },
}

/// A decrypted clip that arrived from a phone.
pub struct InboundClip {
    pub origin: String,
    pub content_type: String,
    pub text: String,
    pub plain: String,
    pub image_png: Option<Vec<u8>>,
}

/// A complete file that arrived from a phone (all chunks assembled).
pub struct InboundFile {
    pub origin: String,
    pub file_name: String,
    pub mime_type: String,
    pub data: Vec<u8>,
}

pub struct ServerState {
    pub device_id: String,
    pub identity: Identity,
    pub settings: Mutex<Settings>,
    pub settings_dir: PathBuf,
    pub pending_nonces: Mutex<HashMap<String, u64>>,
    pub outgoing: broadcast::Sender<OutgoingMessage>,
    pub host_resolver: Arc<dyn Fn() -> Vec<String> + Send + Sync>,
}

impl ServerState {
    pub fn new(
        settings: Settings,
        settings_dir: PathBuf,
        host_resolver: Arc<dyn Fn() -> Vec<String> + Send + Sync>,
    ) -> Self {
        let identity = settings.identity();
        let device_id = format!(
            "win-{}",
            &hash_hex(identity.public_key_b64().as_bytes())[..8]
        );
        let (outgoing, _) = broadcast::channel::<OutgoingMessage>(64);

        ServerState {
            device_id,
            identity,
            settings: Mutex::new(settings),
            settings_dir,
            pending_nonces: Mutex::new(HashMap::new()),
            outgoing,
            host_resolver,
        }
    }

    pub fn device_name(&self) -> String {
        self.settings
            .lock()
            .map(|s| s.device_name.clone())
            .unwrap_or_else(|_| "This Windows PC".into())
    }

    /// Mints a single-use nonce for a QR code and forgets any that have expired.
    pub fn issue_nonce(&self) -> (String, u64) {
        let nonce: String = rand::thread_rng()
            .sample_iter(&Alphanumeric)
            .take(32)
            .map(char::from)
            .collect();
        let expires_at = now() + PAIRING_TTL_SECS;

        if let Ok(mut pending) = self.pending_nonces.lock() {
            pending.retain(|_, expiry| *expiry > now());
            pending.insert(nonce.clone(), expires_at);
        }
        (nonce, expires_at)
    }

    fn claim_nonce(&self, nonce: &str) -> bool {
        let Ok(mut pending) = self.pending_nonces.lock() else {
            return false;
        };
        pending.remove(nonce).is_some_and(|expiry| expiry > now())
    }

    fn is_known_device(&self, public_key: &str) -> bool {
        self.settings
            .lock()
            .map(|s| s.paired_devices.iter().any(|d| d.public_key == public_key))
            .unwrap_or(false)
    }

    pub fn remember_device(&self, device: PairedDevice) -> PairedDevice {
        if let Ok(mut settings) = self.settings.lock() {
            settings.remember(device.clone());
            let _ = settings.save(&self.settings_dir);
        }
        device
    }
}

/// Spawns the accept loop. Returns immediately; the listener runs until exit.
pub fn start<F, G, H, N>(
    state: Arc<ServerState>,
    on_clip: F,
    on_file: H,
    on_notification: N,
    on_paired: G,
) where
    F: Fn(InboundClip) + Send + Sync + 'static,
    G: Fn(PairedDevice) + Send + Sync + 'static,
    H: Fn(InboundFile) + Send + Sync + 'static,
    N: Fn(crate::protocol::PhoneNotification) + Send + Sync + 'static,
{
    let on_clip = Arc::new(on_clip);
    let on_file = Arc::new(on_file);
    let on_notification = Arc::new(on_notification);
    let on_paired = Arc::new(on_paired);

    std::thread::spawn(move || {
        let runtime = match tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
        {
            Ok(runtime) => runtime,
            Err(e) => {
                eprintln!("ClipLink: could not start the async runtime: {e}");
                return;
            }
        };

        runtime.block_on(async move {
            let listener = match TcpListener::bind(("0.0.0.0", DEFAULT_PORT)).await {
                Ok(listener) => listener,
                Err(e) => {
                    eprintln!("ClipLink: port {DEFAULT_PORT} is unavailable ({e}). Is ClipLink already running?");
                    return;
                }
            };

            while let Ok((stream, peer)) = listener.accept().await {
                let state           = Arc::clone(&state);
                let on_clip         = Arc::clone(&on_clip);
                let on_file         = Arc::clone(&on_file);
                let on_notification = Arc::clone(&on_notification);
                let on_paired       = Arc::clone(&on_paired);
                let peer_ip         = peer.ip().to_string();

                tokio::spawn(async move {
                    if let Err(e) = serve(stream, peer_ip, state, on_clip, on_file, on_notification, on_paired).await {
                        eprintln!("ClipLink: session with {peer} ended: {e}");
                    }
                });
            }
        });
    });
}

async fn serve(
    stream: tokio::net::TcpStream,
    peer_ip: String,
    state: Arc<ServerState>,
    on_clip: Arc<impl Fn(InboundClip) + Send + Sync + 'static>,
    on_file: Arc<impl Fn(InboundFile) + Send + Sync + 'static>,
    on_notification: Arc<impl Fn(crate::protocol::PhoneNotification) + Send + Sync + 'static>,
    on_paired: Arc<impl Fn(PairedDevice) + Send + Sync + 'static>,
) -> Result<(), String> {
    let ws = tokio_tungstenite::accept_async(stream)
        .await
        .map_err(|e| e.to_string())?;
    let (mut write, mut read) = ws.split();

    // Handshake first.
    let first = read
        .next()
        .await
        .ok_or("closed before handshake")?
        .map_err(|e| e.to_string())?;
    let hello = match serde_json::from_str::<Inbound>(first.to_text().map_err(|e| e.to_string())?) {
        Ok(Inbound::Hello(hello)) => hello,
        _ => return Err("first frame was not a hello".into()),
    };

    let authorised = state.claim_nonce(&hello.nonce) || state.is_known_device(&hello.public_key);
    if !authorised {
        let refusal = ProtocolError::new(
            "nonce_expired",
            "That pairing code expired. Refresh it on your PC.",
        );
        let _ = write
            .send(WsMessage::text(
                serde_json::to_string(&refusal).unwrap_or_default(),
            ))
            .await;
        return Err(format!("rejected pairing attempt from {}", hello.device_id));
    }

    let key = state
        .identity
        .session_key(&hello.public_key)
        .map_err(|_| "bad public key")?;

    let paired_device = state.remember_device(PairedDevice {
        device_id: hello.device_id.clone(),
        device_name: hello.device_name.clone(),
        public_key: hello.public_key.clone(),
        paired_at: now(),
        last_host: Some(peer_ip.clone()),
        last_seen: Some(now()),
    });
    if let Ok(mut s) = state.settings.lock() {
        s.update_last_seen(&hello.device_id, &peer_ip, now());
        let _ = s.save(&state.settings_dir);
    }
    on_paired(paired_device);

    let ack = HelloAck {
        kind: "hello-ack",
        device_id: state.device_id.clone(),
        device_name: state.device_name(),
        public_key: state.identity.public_key_b64(),
        hosts: (state.host_resolver)(),
    };
    write
        .send(WsMessage::text(
            serde_json::to_string(&ack).map_err(|e| e.to_string())?,
        ))
        .await
        .map_err(|e| e.to_string())?;

    let mut outgoing = state.outgoing.subscribe();

    // In-progress file transfers: transfer_id → (meta, assembled chunks)
    struct FileBuffer {
        meta: FileStart,
        chunks: HashMap<u32, Vec<u8>>,
    }
    let mut file_buffers: HashMap<String, FileBuffer> = HashMap::new();

    loop {
        tokio::select! {
            frame = read.next() => {
                let Some(frame) = frame else { return Ok(()) };
                let frame = frame.map_err(|e| e.to_string())?;
                if frame.is_close() { return Ok(()); }
                let Ok(text) = frame.to_text() else { continue };

                match serde_json::from_str::<Inbound>(text) {
                    Ok(Inbound::Clip(clip)) => {
                        if clip.origin == state.device_id { continue; }
                        let Ok(plaintext) = key.open(&clip.payload) else {
                            let err = ProtocolError::new("decrypt_failed", "Could not decrypt. Re-pair.");
                            let _ = write.send(WsMessage::text(serde_json::to_string(&err).unwrap_or_default())).await;
                            continue;
                        };
                        let is_image = clip.content_type.starts_with("image/");
                        let is_html  = clip.content_type == "text/html";
                        if is_image {
                            on_clip(InboundClip { origin: clip.origin, content_type: clip.content_type, text: String::new(), plain: String::new(), image_png: Some(plaintext) });
                        } else if is_html {
                            #[derive(serde::Deserialize)]
                            struct HtmlPayload { html: String, #[serde(default)] plain: String }
                            if let Ok(hp) = serde_json::from_slice::<HtmlPayload>(&plaintext) {
                                on_clip(InboundClip { origin: clip.origin, content_type: clip.content_type, text: hp.html, plain: hp.plain, image_png: None });
                            }
                        } else if let Ok(t) = String::from_utf8(plaintext) {
                            on_clip(InboundClip { origin: clip.origin, content_type: clip.content_type, text: t, plain: String::new(), image_png: None });
                        }
                    }

                    Ok(Inbound::FileStart(fs)) => {
                        file_buffers.insert(fs.transfer_id.clone(), FileBuffer { meta: fs, chunks: HashMap::new() });
                    }

                    Ok(Inbound::FileChunk(fc)) => {
                        if fc.chunk_index == 0 && !file_buffers.contains_key(&fc.transfer_id) {
                            continue; // FileStart never arrived — ignore
                        }
                        let total = fc.total_chunks;
                        let tid = fc.transfer_id.clone();

                        if let Ok(chunk_bytes) = key.open(&fc.payload) {
                            if let Some(buf) = file_buffers.get_mut(&tid) {
                                buf.chunks.insert(fc.chunk_index, chunk_bytes);

                                // All chunks received — reassemble and deliver
                                if buf.chunks.len() as u32 == total {
                                    let mut data: Vec<u8> = Vec::new();
                                    for i in 0..total {
                                        if let Some(c) = buf.chunks.get(&i) {
                                            data.extend_from_slice(c);
                                        } else {
                                            // Missing chunk — send ack with error
                                            let ack = FileAck { transfer_id: tid.clone(), ok: false, error: Some(format!("missing chunk {i}")) };
                                            let _ = write.send(WsMessage::text(serde_json::to_string(&ack).unwrap_or_default())).await;
                                            file_buffers.remove(&tid);
                                            break;
                                        }
                                    }
                                    if let Some(buf) = file_buffers.remove(&tid) {
                                        let ack = FileAck { transfer_id: tid.clone(), ok: true, error: None };
                                        let _ = write.send(WsMessage::text(serde_json::to_string(&ack).unwrap_or_default())).await;
                                        on_file(InboundFile {
                                            origin: hello.device_id.clone(),
                                            file_name: buf.meta.file_name,
                                            mime_type: buf.meta.mime_type,
                                            data,
                                        });
                                    }
                                }
                            }
                        }
                    }

                    Ok(Inbound::Ping) => {
                        let _ = write.send(WsMessage::text(r#"{"type":"ping"}"#)).await;
                    }
                    Ok(Inbound::Notification(n)) => {
                        on_notification(n);
                    }
                    Ok(Inbound::NotificationDismiss(_)) | Ok(Inbound::FileAck(_)) | Ok(Inbound::Unknown) => {
                        // FileAck from phone: transfer complete, nothing to do server-side
                        // NotificationDismiss from phone: shouldn't arrive here (PC sends these)
                    }
                    _ => continue,
                }
            }

            msg = outgoing.recv() => {
                let Ok(msg) = msg else { continue };
                match msg {
                    OutgoingMessage::Clip(clip) => {
                        let (raw_bytes, size_cap) = if let Some(ref png) = clip.image_png {
                            (png.as_slice(), MAX_IMAGE_PAYLOAD_BYTES)
                        } else {
                            (clip.text.as_bytes(), MAX_TEXT_PAYLOAD_BYTES)
                        };
                        if raw_bytes.len() > size_cap { continue; }
                        let Ok(payload) = key.seal(raw_bytes) else { continue };
                        let frame = Clip {
                            kind: "clip".into(),
                            id: clip.id,
                            origin: clip.origin,
                            content_type: clip.content_type,
                            hash: hash_hex(raw_bytes),
                            sent_at: clip.sent_at,
                            payload,
                        };
                        if write.send(WsMessage::text(serde_json::to_string(&frame).map_err(|e| e.to_string())?)).await.is_err() {
                            return Ok(());
                        }
                    }

                    OutgoingMessage::File(outfile) => {
                        let chunks: Vec<&[u8]> = outfile.data.chunks(MAX_FILE_CHUNK_BYTES).collect();
                        let total = chunks.len() as u32;

                        // Send file-start
                        let start = FileStart {
                            transfer_id: outfile.transfer_id.clone(),
                            file_name: outfile.file_name.clone(),
                            file_size: outfile.data.len() as u64,
                            mime_type: outfile.mime_type.clone(),
                            total_chunks: total,
                        };
                        if write.send(WsMessage::text(serde_json::to_string(&start).map_err(|e| e.to_string())?)).await.is_err() {
                            return Ok(());
                        }

                        // Send each chunk
                        for (i, chunk) in chunks.iter().enumerate() {
                            let Ok(payload) = key.seal(chunk) else { continue };
                            let fc = FileChunk {
                                transfer_id: outfile.transfer_id.clone(),
                                chunk_index: i as u32,
                                total_chunks: total,
                                payload,
                            };
                            if write.send(WsMessage::text(serde_json::to_string(&fc).map_err(|e| e.to_string())?)).await.is_err() {
                                return Ok(());
                            }
                        }
                    }
                    OutgoingMessage::NotificationDismiss { key } => {
                        let frame = serde_json::json!({
                            "type": "notification-dismiss",
                            "key": key,
                        });
                        if write.send(WsMessage::text(frame.to_string())).await.is_err() {
                            return Ok(());
                        }
                    }
                }
            }
        }
    }
}

pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
