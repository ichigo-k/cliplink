import { generateIdentity, hashHex, open, seal, sessionKey, type Identity } from '@cliplink/crypto';
import { candidateHosts, HEARTBEAT_INTERVAL_MS, socketUrlFor, type PairingOffer } from '@cliplink/protocol';

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
  | { state: 'connecting'; host: string }
  | { state: 'connected'; deviceName: string }
  | { state: 'error'; message: string; detail?: string };

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
  /** The PC may be reachable on several addresses; walk them until one works. */
  private hosts: string[] = [];
  private hostIndex = 0;
  private everConnected = false;

  constructor(
    private readonly offer: PairingOffer,
    private readonly identity: Identity,
    private readonly deviceName: string,
    private readonly events: ClientEvents,
  ) {
    this.deviceId = `android-${hashHex(identity.publicKeyB64).slice(0, 8)}`;
    this.hosts = candidateHosts(offer);
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
      // Say which addresses were tried: on a network that blocks device-to-
      // device traffic this is the only clue the user gets, and "check your
      // Wi-Fi" is actively misleading when they already did.
      const tried = this.hosts.join(', ') || this.offer.host;
      this.events.onStatus({
        state: 'error',
        message: this.everConnected
          ? `Lost the connection to ${this.offer.deviceName}. Retrying…`
          : `No answer from ${tried} on port ${this.offer.port}.`,
        detail: this.everConnected
          ? undefined
          : 'The PC is running and reachable, so this is usually the network refusing to pass traffic between devices — common on school, campus and hotel Wi-Fi. Try a phone hotspot to confirm.',
      });
    };

    socket.onclose = () => {
      this.stopHeartbeat();
      this.key = null;
      // Before a successful handshake, rotate to the next candidate address.
      if (!this.everConnected && this.hosts.length > 1) {
        this.hostIndex = (this.hostIndex + 1) % this.hosts.length;
      }
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
      this.everConnected = true;
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
