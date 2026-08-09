import { generateIdentity, hashHex, open, seal, sessionKey, type Identity } from '@cliplink/crypto';
import { candidateHosts, HEARTBEAT_INTERVAL_MS, socketUrlFor, type PairingOffer } from '@cliplink/protocol';

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
  | { state: 'connecting'; host: string }
  | { state: 'connected'; deviceName: string }
  | { state: 'error'; message: string; detail?: string };

export type ClientEvents = {
  onStatus: (status: Status) => void;
  onClip: (text: string) => void;
};

// Reconnect delay backs off: 3s → 6s → 12s → capped at 30s
const BASE_RECONNECT_MS = 3_000;
const MAX_RECONNECT_MS = 30_000;

/**
 * Talks to the desktop over the LAN.
 *
 * Reconnection strategy (no re-pairing needed):
 * 1. Try `lastHost` first if provided — the address that worked last time.
 * 2. Then walk all candidate IPs from the pairing offer.
 * 3. Exponential back-off between attempts, capped at 30 s.
 *
 * This means a paired phone reconnects automatically whenever the PC is
 * reachable, even after sleep/wake or IP changes.
 */
export class SyncClient {
  private socket: WebSocket | null = null;
  private key: Uint8Array | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private reconnect: ReturnType<typeof setTimeout> | null = null;
  private closedByUs = false;
  private deviceId = '';
  private hosts: string[] = [];
  private hostIndex = 0;
  private everConnected = false;
  private reconnectDelay = BASE_RECONNECT_MS;

  constructor(
    private readonly offer: PairingOffer,
    private readonly identity: Identity,
    private readonly deviceName: string,
    private readonly events: ClientEvents,
    /** Last known working IP — try this first to avoid scanning all IPs. */
    private readonly lastHost?: string,
  ) {
    this.deviceId = `android-${hashHex(identity.publicKeyB64).slice(0, 8)}`;
    // Put lastHost at the front so reconnect is instant when IP hasn't changed
    const base = candidateHosts(offer);
    if (lastHost && !base.includes(lastHost)) {
      this.hosts = [lastHost, ...base];
    } else if (lastHost) {
      this.hosts = [lastHost, ...base.filter(h => h !== lastHost)];
    } else {
      this.hosts = base;
    }
  }

  private get host(): string {
    return this.hosts[this.hostIndex] ?? this.offer.host;
  }

  connect(): void {
    this.closedByUs = false;
    this.events.onStatus({ state: 'connecting', host: this.host });

    const socket = new WebSocket(socketUrlFor(this.host, this.offer.port));
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
      const tried = this.hosts.join(', ') || this.offer.host;
      this.events.onStatus({
        state: 'error',
        message: this.everConnected
          ? `Lost the connection to ${this.offer.deviceName}. Retrying…`
          : `No answer from ${tried} on port ${this.offer.port}.`,
        detail: this.everConnected
          ? undefined
          : 'Usually the network blocks device-to-device traffic (school / hotel Wi-Fi). Try a phone hotspot.',
      });
    };

    socket.onclose = () => {
      this.stopHeartbeat();
      this.key = null;
      if (!this.everConnected && this.hosts.length > 1) {
        this.hostIndex = (this.hostIndex + 1) % this.hosts.length;
      }
      if (!this.closedByUs) this.scheduleReconnect();
    };
  }

  private handle(raw: string): void {
    let message: InboundFrame;
    try { message = JSON.parse(raw); } catch { return; }

    if (message.type === 'hello-ack' && message.publicKey) {
      this.key = sessionKey(this.identity, message.publicKey);
      this.everConnected = true;
      this.reconnectDelay = BASE_RECONNECT_MS; // reset back-off on success
      this.events.onStatus({ state: 'connected', deviceName: message.deviceName ?? 'Windows PC' });
      this.startHeartbeat();
      return;
    }

    if (message.type === 'error') {
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
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({ type: 'ping' }));
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  private scheduleReconnect(): void {
    if (this.reconnect) clearTimeout(this.reconnect);
    this.reconnect = setTimeout(() => {
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_RECONNECT_MS);
      this.connect();
    }, this.reconnectDelay);
  }
}

export function newIdentity(): Identity {
  return generateIdentity();
}
