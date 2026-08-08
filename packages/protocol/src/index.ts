export const PROTOCOL_VERSION = 1;
export const DEFAULT_PORT = 47123;
export const SYNC_PATH = '/v1/sync';
export const MAX_PAYLOAD_BYTES = 1024 * 1024;
export const HEARTBEAT_INTERVAL_MS = 20_000;
export const IDLE_TIMEOUT_MS = 60_000;

export type ErrorCode =
  | 'nonce_expired'
  | 'nonce_unknown'
  | 'version_unsupported'
  | 'not_paired'
  | 'decrypt_failed'
  | 'payload_too_large';

export type PairingOffer = {
  app: 'ClipLink';
  version: number;
  deviceId: string;
  deviceName: string;
  host: string;
  port: number;
  nonce: string;
  publicKey: string;
  expiresAt: number;
};

export type Hello = {
  type: 'hello';
  nonce: string;
  deviceId: string;
  deviceName: string;
  publicKey: string;
};

export type HelloAck = {
  type: 'hello-ack';
  deviceId: string;
  deviceName: string;
  publicKey: string;
};

export type Clip = {
  type: 'clip';
  id: string;
  origin: string;
  contentType: string;
  hash: string;
  sentAt: number;
  payload: string;
};

export type Ping = { type: 'ping' };
export type ProtocolError = { type: 'error'; code: ErrorCode; message: string };

export type Message = Hello | HelloAck | Clip | Ping | ProtocolError;

/**
 * Validates a scanned QR payload. Returns the offer, or a reason it was
 * rejected — the caller shows that reason to the user, so it is phrased for
 * humans rather than logs.
 */
export function parsePairingOffer(raw: string, now = Date.now()): { ok: true; offer: PairingOffer } | { ok: false; reason: string } {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "That QR code isn't a ClipLink pairing code." };
  }

  const o = data as Partial<PairingOffer>;
  if (o?.app !== 'ClipLink') return { ok: false, reason: "That QR code isn't a ClipLink pairing code." };
  if (o.version !== PROTOCOL_VERSION) return { ok: false, reason: 'This phone and PC are running different ClipLink versions. Update both.' };
  if (!o.host || !o.port || !o.nonce || !o.publicKey || !o.deviceId) return { ok: false, reason: 'That pairing code is incomplete. Refresh it on your PC.' };
  if (typeof o.expiresAt === 'number' && o.expiresAt * 1000 < now) return { ok: false, reason: 'That pairing code expired. Refresh it on your PC.' };

  return { ok: true, offer: o as PairingOffer };
}

export function socketUrl(offer: Pick<PairingOffer, 'host' | 'port'>): string {
  return `ws://${offer.host}:${offer.port}${SYNC_PATH}`;
}

export function isMessage(value: unknown): value is Message {
  return typeof value === 'object' && value !== null && typeof (value as Message).type === 'string';
}

/**
 * Tracks hashes of content this device just wrote to its own clipboard, so the
 * clipboard watcher can tell "the user copied this" apart from "we applied this
 * from the other device" and not echo it back. See the loop-prevention section
 * of README.md.
 */
export class EchoSuppressor {
  private readonly seen = new Map<string, number>();

  constructor(private readonly ttlMs = 5_000) {}

  suppress(hash: string, now = Date.now()): void {
    this.seen.set(hash, now + this.ttlMs);
  }

  /** True if this change came from us. Consumes the entry. */
  shouldIgnore(hash: string, now = Date.now()): boolean {
    const expiry = this.seen.get(hash);
    if (expiry === undefined) return false;
    this.seen.delete(hash);
    return expiry >= now;
  }
}
