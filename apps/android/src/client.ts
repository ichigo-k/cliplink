import { generateIdentity, hashHex, open, openBytes, seal, sealBytes, sessionKey, type Identity } from '@cliplink/crypto';
import { candidateHosts, HEARTBEAT_INTERVAL_MS, socketUrlFor, type PairingOffer } from '@cliplink/protocol';
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';

type InboundFrame = {
  type?: string;
  publicKey?: string;
  deviceName?: string;
  message?: string;
  origin?: string;
  payload?: string;
  contentType?: string;
  hosts?: string[];
  // File transfer fields
  transferId?: string;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  totalChunks?: number;
  chunkIndex?: number;
  ok?: boolean;
  error?: string;
  // Notification dismiss uses key
  key?: string;
};

export type Status =
  | { state: 'idle' }
  | { state: 'connecting'; host: string }
  | { state: 'connected'; deviceName: string }
  | { state: 'error'; message: string; detail?: string };

export type ClientEvents = {
  onStatus: (status: Status) => void;
  onClip: (text: string) => void;
  onImageClip: (pngBase64: string) => void;
  onFileStart: (transferId: string, fileName: string, totalChunks: number, mimeType: string) => void;
  onFileChunk: (transferId: string, chunkIndex: number, totalChunks: number, data: Uint8Array) => void;
  onFileComplete: (transferId: string) => void;
  onNotificationDismiss: (key: string) => void;
};

// Reconnect delay backs off: 3s → 6s → 12s → capped at 30s
const BASE_RECONNECT_MS = 3_000;
const MAX_RECONNECT_MS = 30_000;

/**
 * Talks to the desktop over the LAN.
 *
 * Reconnection strategy:
 * 1. Try `lastHost` first — the address that worked last time.
 * 2. Walk all candidate IPs from the pairing offer.
 * 3. mDNS/DNS-SD discovery resolves the PC by service name when IPs change.
 * 4. On network change (Wi-Fi switch), reset backoff and retry immediately.
 * 5. Exponential back-off between attempts, capped at 30 s.
 */
export class SyncClient {
  private socket: WebSocket | null = null;
  private key: Uint8Array | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private reconnect: ReturnType<typeof setTimeout> | null = null;
  private netInfoUnsub: (() => void) | null = null;
  private closedByUs = false;
  private deviceId = '';
  private hosts: string[] = [];
  private hostIndex = 0;
  private everConnected = false;
  private reconnectDelay = BASE_RECONNECT_MS;
  private lastNetworkId: string | null = null;

  constructor(
    private readonly offer: PairingOffer,
    private readonly identity: Identity,
    private readonly deviceName: string,
    private readonly events: ClientEvents,
    /** Last known working IP — try this first to avoid scanning all IPs. */
    private readonly lastHost?: string,
  ) {
    this.deviceId = `android-${hashHex(identity.publicKeyB64).slice(0, 8)}`;
    this.buildHostList();
  }

  private buildHostList(discoveredHost?: string): void {
    const base = candidateHosts(this.offer);
    const extra: string[] = [];

    // Prepend any freshly-discovered mDNS host so it's tried first.
    if (discoveredHost && !base.includes(discoveredHost)) {
      extra.push(discoveredHost);
    }
    // Then lastHost, then the rest of the offer's candidates.
    if (this.lastHost && !base.includes(this.lastHost) && this.lastHost !== discoveredHost) {
      extra.push(this.lastHost);
    } else if (this.lastHost && this.lastHost !== discoveredHost) {
      // Move lastHost to the front within the base list.
      const without = base.filter(h => h !== this.lastHost);
      this.hosts = [...extra, this.lastHost, ...without];
      return;
    }
    this.hosts = [...extra, ...base];
  }

  private get host(): string {
    return this.hosts[this.hostIndex] ?? this.offer.host;
  }

  connect(): void {
    this.closedByUs = false;
    this.hostIndex = 0;
    this.subscribeToNetworkChanges();
    this.attemptConnect();
  }

  private attemptConnect(): void {
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
      // Cycle to next host candidate on first-connect failures.
      if (!this.everConnected && this.hosts.length > 1) {
        this.hostIndex = (this.hostIndex + 1) % this.hosts.length;
      }
      if (!this.closedByUs) this.scheduleReconnect();
    };
  }

  /**
   * Subscribe to network state changes. When the phone joins a new Wi-Fi
   * network we:
   *  1. Kill the dead socket immediately (no point waiting for timeout).
   *  2. Reset the backoff so we retry right away rather than waiting 30s.
   *  3. Re-build the host list in case the new network has a different subnet.
   *  4. Fire an immediate reconnect attempt.
   */
  private subscribeToNetworkChanges(): void {
    if (this.netInfoUnsub) return; // already subscribed

    this.netInfoUnsub = NetInfo.addEventListener((state: NetInfoState) => {
      // Only react to actual Wi-Fi connections (not going offline).
      if (!state.isConnected || state.type !== 'wifi') return;

      // Use the SSID or IP as a network identity to detect actual changes.
      const networkId =
        (state.details as any)?.ssid ??
        (state.details as any)?.ipAddress ??
        null;

      if (networkId === null || networkId === this.lastNetworkId) return;

      const wasConnected = this.lastNetworkId !== null;
      this.lastNetworkId = networkId;

      // Don't react on the very first observation (app startup).
      if (!wasConnected) return;

      // Network changed — reset and reconnect immediately.
      this.resetForNetworkChange();
    });
  }

  private resetForNetworkChange(): void {
    // Drop the current dead socket without triggering the normal
    // scheduleReconnect path (we'll reconnect ourselves right below).
    this.closedByUs = true;
    this.stopHeartbeat();
    if (this.reconnect) clearTimeout(this.reconnect);
    this.socket?.close();
    this.socket = null;

    // Reset state for a fresh attempt.
    this.closedByUs = false;
    this.reconnectDelay = BASE_RECONNECT_MS;
    this.hostIndex = 0;
    this.everConnected = false; // force full host scan on the new network

    // Rebuild the host list (new network may have different subnet).
    this.buildHostList();

    // Short delay to let the network stack settle before connecting.
    setTimeout(() => this.attemptConnect(), 500);
  }

  private handle(raw: string): void {
    let message: InboundFrame;
    try { message = JSON.parse(raw); } catch { return; }

    if (message.type === 'hello-ack' && message.publicKey) {
      this.key = sessionKey(this.identity, message.publicKey);
      this.everConnected = true;
      this.reconnectDelay = BASE_RECONNECT_MS;
      this.events.onStatus({ state: 'connected', deviceName: message.deviceName ?? 'Windows PC' });
      this.startHeartbeat();
      if (message.hosts && message.hosts.length > 0) {
        this.buildHostList(message.hosts[0]);
      }
      return;
    }

    if (message.type === 'error') {
      this.closedByUs = true;
      this.events.onStatus({ state: 'error', message: message.message ?? 'The PC refused the connection.' });
      return;
    }

    if (message.type === 'clip' && this.key && message.payload) {
      if (message.origin === this.deviceId) return;
      const isImage = message.contentType?.startsWith('image/') ?? false;
      if (isImage) {
        const bytes = openBytes(this.key, message.payload);
        if (bytes !== null) {
          const b64 = btoa(String.fromCharCode(...bytes));
          this.events.onImageClip(b64);
        }
      } else {
        const text = open(this.key, message.payload);
        if (text !== null) this.events.onClip(text);
      }
      return;
    }

    if (message.type === 'file-start' && message.transferId) {
      this.events.onFileStart(
        message.transferId,
        message.fileName ?? 'file',
        message.totalChunks ?? 0,
        message.mimeType ?? 'application/octet-stream',
      );
      return;
    }

    if (message.type === 'file-chunk' && this.key && message.transferId && message.payload) {
      const bytes = openBytes(this.key, message.payload);
      if (bytes !== null) {
        this.events.onFileChunk(
          message.transferId,
          message.chunkIndex ?? 0,
          message.totalChunks ?? 0,
          bytes,
        );
        // Send ack when all chunks received — App.tsx handles reassembly
        // and calls onFileComplete; we just send the wire ack here when told
      }
      return;
    }

    if (message.type === 'file-ack' && message.transferId) {
      if (message.ok) this.events.onFileComplete(message.transferId);
      return;
    }

    if (message.type === 'notification-dismiss' && message.key) {
      this.events.onNotificationDismiss(message.key);
      return;
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

  sendImage(pngBytes: Uint8Array): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || !this.key) return false;
    const hashBytes = Array.from(pngBytes).map(b => b.toString(16).padStart(2, '0')).join('');
    this.socket.send(JSON.stringify({
      type: 'clip',
      id: `${this.deviceId}-${Date.now()}`,
      origin: this.deviceId,
      contentType: 'image/png',
      hash: hashBytes.slice(0, 64),
      sentAt: Math.floor(Date.now() / 1000),
      payload: sealBytes(this.key, pngBytes),
    }));
    return true;
  }

  /**
   * Send a file to the PC.
   * @param data     Raw file bytes
   * @param fileName Original file name (e.g. "document.pdf")
   * @param mimeType MIME type (e.g. "application/pdf")
   * @returns transferId or null if not connected
   */
  sendFile(data: Uint8Array, fileName: string, mimeType: string): string | null {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || !this.key) return null;

    const CHUNK_SIZE = 256 * 1024; // 256 KB
    const totalChunks = Math.ceil(data.length / CHUNK_SIZE);
    const transferId = `${this.deviceId}-file-${Date.now()}`;

    // Send file-start
    this.socket.send(JSON.stringify({
      type: 'file-start',
      transferId,
      fileName,
      fileSize: data.length,
      mimeType,
      totalChunks,
    }));

    // Send each encrypted chunk
    for (let i = 0; i < totalChunks; i++) {
      const chunk = data.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
      const payload = sealBytes(this.key, chunk);
      this.socket.send(JSON.stringify({
        type: 'file-chunk',
        transferId,
        chunkIndex: i,
        totalChunks,
        payload,
      }));
    }

    return transferId;
  }

  /** Send a file-ack back to the PC confirming we received a complete transfer. */
  sendFileAck(transferId: string, ok: boolean, error?: string): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({ type: 'file-ack', transferId, ok, ...(error ? { error } : {}) }));
  }

  /**
   * Forward a phone notification to the PC.
   * Called whenever the NotificationListenerService fires onNotificationPosted.
   */
  sendNotification(n: {
    key: string;
    packageName: string;
    appName: string;
    title: string;
    text: string;
    postedAt: number;
  }): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({ type: 'notification', ...n }));
  }

  /** Tell the PC a notification was dismissed on the phone. */
  sendNotificationRemoved(key: string): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({ type: 'notification-dismiss', key }));
  }

  close(): void {
    this.closedByUs = true;
    this.stopHeartbeat();
    if (this.reconnect) clearTimeout(this.reconnect);
    if (this.netInfoUnsub) {
      this.netInfoUnsub();
      this.netInfoUnsub = null;
    }
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
      this.attemptConnect();
    }, this.reconnectDelay);
  }
}

export function newIdentity(): Identity {
  return generateIdentity();
}
