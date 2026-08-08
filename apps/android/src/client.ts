import { generateIdentity, hashHex, open, seal, sessionKey, type Identity } from '@cliplink/crypto';
import { HEARTBEAT_INTERVAL_MS, socketUrl, type PairingOffer } from '@cliplink/protocol';

/** The union of fields any inbound frame may carry; `type` decides which apply. */
type InboundFrame = {
  type?: string;
  publicKey?: string;
  deviceName?: string;
  message?: string;
  origin?: string;
  payload?: string;
};

export type Status =
  | { state: 'idle' }
  | { state: 'connecting' }
  | { state: 'connected'; deviceName: string }
  | { state: 'error'; message: string };

export type ClientEvents = {
  onStatus: (status: Status) => void;
  /** Text the PC copied. The caller decides whether to write it to the clipboard. */
  onClip: (text: string) => void;
};

const RECONNECT_DELAY_MS = 3_000;

/**
 * Talks to the desktop over the LAN. Owns one socket at a time and reconnects
 * on its own, because Android drops sockets aggressively when the screen sleeps.
 */
export class SyncClient {
  private socket: WebSocket | null = null;
  private key: Uint8Array | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private reconnect: ReturnType<typeof setTimeout> | null = null;
  private closedByUs = false;
  private deviceId = '';

  constructor(
    private readonly offer: PairingOffer,
    private readonly identity: Identity,
    private readonly deviceName: string,
    private readonly events: ClientEvents,
  ) {
    this.deviceId = `android-${hashHex(identity.publicKeyB64).slice(0, 8)}`;
  }

  connect(): void {
    this.closedByUs = false;
    this.events.onStatus({ state: 'connecting' });

    const socket = new WebSocket(socketUrl(this.offer));
    this.socket = socket;

    socket.onopen = () => {
      socket.send(JSON.stringify({
        type: 'hello',
        nonce: this.offer.nonce,
        deviceId: this.deviceId,
        deviceName: this.deviceName,
        publicKey: this.identity.publicKeyB64,
      }));
    };

    socket.onmessage = event => this.handle(String(event.data));

    socket.onerror = () => {
      this.events.onStatus({
        state: 'error',
        message: `Could not reach ${this.offer.host}. Check that both devices are on the same Wi-Fi.`,
      });
    };

    socket.onclose = () => {
      this.stopHeartbeat();
      this.key = null;
      if (!this.closedByUs) this.scheduleReconnect();
    };
  }

  private handle(raw: string): void {
    let message: InboundFrame;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }

    if (message.type === 'hello-ack' && message.publicKey) {
      this.key = sessionKey(this.identity, message.publicKey);
      this.events.onStatus({ state: 'connected', deviceName: message.deviceName ?? 'Windows PC' });
      this.startHeartbeat();
      return;
    }

    if (message.type === 'error') {
      // A rejected pairing will be rejected again on retry, so stop trying.
      this.closedByUs = true;
      this.events.onStatus({ state: 'error', message: message.message ?? 'The PC refused the connection.' });
      return;
    }

    if (message.type === 'clip' && this.key && message.payload) {
      if (message.origin === this.deviceId) return;
      const text = open(this.key, message.payload);
      if (text !== null) this.events.onClip(text);
    }
  }

  /** Pushes locally copied text to the PC. No-op when not connected. */
  send(text: string): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || !this.key) return false;

    this.socket.send(JSON.stringify({
      type: 'clip',
      id: `${this.deviceId}-${Date.now()}`,
      origin: this.deviceId,
      contentType: 'text/plain',
      hash: hashHex(text),
      sentAt: Math.floor(Date.now() / 1000),
      payload: seal(this.key, text),
    }));
    return true;
  }

  close(): void {
    this.closedByUs = true;
    this.stopHeartbeat();
    if (this.reconnect) clearTimeout(this.reconnect);
    this.socket?.close();
    this.socket = null;
    this.events.onStatus({ state: 'idle' });
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeat = setInterval(() => {
      if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type: 'ping' }));
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  private scheduleReconnect(): void {
    if (this.reconnect) clearTimeout(this.reconnect);
    this.reconnect = setTimeout(() => this.connect(), RECONNECT_DELAY_MS);
  }
}

export function newIdentity(): Identity {
  return generateIdentity();
}
