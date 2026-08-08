//! The LAN sync server. The desktop listens; phones connect to it.
//!
//! Binds `0.0.0.0` so any device on the same network can reach it, which is the
//! whole point — but it also means the nonce check in `handshake` is the only
//! thing standing between a stranger on the same Wi-Fi and your clipboard.

use crate::{
    clipboard::EchoSuppressor,
    crypto::{hash_hex, Identity},
    protocol::{Clip, HelloAck, Inbound, ProtocolError, DEFAULT_PORT, MAX_PAYLOAD_BYTES, PAIRING_TTL_SECS},
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

/// A local copy on its way out. Held as plaintext because every connected phone
/// has a different session key and must be sealed for individually.
#[derive(Clone)]
pub struct OutgoingClip {
    pub id: String,
    pub origin: String,
    pub content_type: String,
    pub text: String,
    pub sent_at: u64,
}

/// A decrypted clip that arrived from a phone.
pub struct InboundClip {
    pub origin: String,
    pub text: String,
}

pub struct ServerState {
    pub device_id: String,
    pub identity: Identity,
    pub settings: Mutex<Settings>,
    pub settings_dir: PathBuf,
    pub pending_nonces: Mutex<HashMap<String, u64>>,
    pub outgoing: broadcast::Sender<OutgoingClip>,
    pub suppressor: EchoSuppressor,
}

impl ServerState {
    pub fn new(settings: Settings, settings_dir: PathBuf, suppressor: EchoSuppressor) -> Self {
        let identity = settings.identity();
        let device_id = format!("win-{}", &hash_hex(identity.public_key_b64().as_bytes())[..8]);
        let (outgoing, _) = broadcast::channel(64);

        ServerState {
            device_id,
            identity,
            settings: Mutex::new(settings),
            settings_dir,
            pending_nonces: Mutex::new(HashMap::new()),
            outgoing,
            suppressor,
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
        let nonce: String = rand::thread_rng().sample_iter(&Alphanumeric).take(32).map(char::from).collect();
        let expires_at = now() + PAIRING_TTL_SECS;

        if let Ok(mut pending) = self.pending_nonces.lock() {
            pending.retain(|_, expiry| *expiry > now());
            pending.insert(nonce.clone(), expires_at);
        }
        (nonce, expires_at)
    }

    fn claim_nonce(&self, nonce: &str) -> bool {
        let Ok(mut pending) = self.pending_nonces.lock() else { return false };
        pending.remove(nonce).is_some_and(|expiry| expiry > now())
    }

    fn is_known_device(&self, public_key: &str) -> bool {
        self.settings
            .lock()
            .map(|s| s.paired_devices.iter().any(|d| d.public_key == public_key))
            .unwrap_or(false)
    }

    fn remember_device(&self, device: PairedDevice) {
        if let Ok(mut settings) = self.settings.lock() {
            settings.remember(device);
            let _ = settings.save(&self.settings_dir);
        }
    }
}

/// Spawns the accept loop. Returns immediately; the listener runs until exit.
pub fn start<F>(state: Arc<ServerState>, on_clip: F)
where
    F: Fn(InboundClip) + Send + Sync + 'static,
{
    let on_clip = Arc::new(on_clip);

    std::thread::spawn(move || {
        let runtime = match tokio::runtime::Builder::new_multi_thread().enable_all().build() {
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
                let state = Arc::clone(&state);
                let on_clip = Arc::clone(&on_clip);

                tokio::spawn(async move {
                    if let Err(e) = serve(stream, state, on_clip).await {
                        eprintln!("ClipLink: session with {peer} ended: {e}");
                    }
                });
            }
        });
    });
}

async fn serve(
    stream: tokio::net::TcpStream,
    state: Arc<ServerState>,
    on_clip: Arc<impl Fn(InboundClip) + Send + Sync + 'static>,
) -> Result<(), String> {
    let ws = tokio_tungstenite::accept_async(stream).await.map_err(|e| e.to_string())?;
    let (mut write, mut read) = ws.split();

    // Handshake first. Anything other than a valid `hello` closes the socket.
    let first = read.next().await.ok_or("closed before handshake")?.map_err(|e| e.to_string())?;
    let hello = match serde_json::from_str::<Inbound>(first.to_text().map_err(|e| e.to_string())?) {
        Ok(Inbound::Hello(hello)) => hello,
        _ => return Err("first frame was not a hello".into()),
    };

    let authorised = state.claim_nonce(&hello.nonce) || state.is_known_device(&hello.public_key);
    if !authorised {
        let refusal = ProtocolError::new("nonce_expired", "That pairing code expired. Refresh it on your PC.");
        let _ = write.send(WsMessage::text(serde_json::to_string(&refusal).unwrap_or_default())).await;
        return Err(format!("rejected pairing attempt from {}", hello.device_id));
    }

    let key = state.identity.session_key(&hello.public_key).map_err(|_| "bad public key")?;

    state.remember_device(PairedDevice {
        device_id: hello.device_id.clone(),
        device_name: hello.device_name.clone(),
        public_key: hello.public_key.clone(),
        paired_at: now(),
    });

    let ack = HelloAck {
        kind: "hello-ack",
        device_id: state.device_id.clone(),
        device_name: state.device_name(),
        public_key: state.identity.public_key_b64(),
    };
    write
        .send(WsMessage::text(serde_json::to_string(&ack).map_err(|e| e.to_string())?))
        .await
        .map_err(|e| e.to_string())?;

    let mut outgoing = state.outgoing.subscribe();

    loop {
        tokio::select! {
            // Something arrived from the phone.
            frame = read.next() => {
                let Some(frame) = frame else { return Ok(()) };
                let frame = frame.map_err(|e| e.to_string())?;
                if frame.is_close() {
                    return Ok(());
                }
                let Ok(text) = frame.to_text() else { continue };

                match serde_json::from_str::<Inbound>(text) {
                    Ok(Inbound::Clip(clip)) => {
                        // Our own clip echoed back; dropping it here is the
                        // second half of the loop guard.
                        if clip.origin == state.device_id {
                            continue;
                        }
                        let Ok(plaintext) = key.open(&clip.payload) else {
                            let err = ProtocolError::new("decrypt_failed", "Could not decrypt that clip. Re-pair the devices.");
                            let _ = write.send(WsMessage::text(serde_json::to_string(&err).unwrap_or_default())).await;
                            continue;
                        };
                        if let Ok(text) = String::from_utf8(plaintext) {
                            on_clip(InboundClip { origin: clip.origin, text });
                        }
                    }
                    Ok(Inbound::Ping) => {
                        let _ = write.send(WsMessage::text(r#"{"type":"ping"}"#)).await;
                    }
                    _ => continue,
                }
            }

            // Something was copied on this PC.
            clip = outgoing.recv() => {
                let Ok(clip) = clip else { continue };
                if clip.text.len() > MAX_PAYLOAD_BYTES {
                    continue;
                }
                let Ok(payload) = key.seal(clip.text.as_bytes()) else { continue };

                let frame = Clip {
                    kind: "clip".into(),
                    id: clip.id,
                    origin: clip.origin,
                    content_type: clip.content_type,
                    hash: hash_hex(clip.text.as_bytes()),
                    sent_at: clip.sent_at,
                    payload,
                };
                if write.send(WsMessage::text(serde_json::to_string(&frame).map_err(|e| e.to_string())?)).await.is_err() {
                    return Ok(());
                }
            }
        }
    }
}

pub fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs()
}
