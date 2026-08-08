/**
 * The TypeScript half of ClipLink's pairing crypto. Must stay byte-compatible
 * with `apps/desktop/src-tauri/src/crypto.rs` — if the KDF info string, nonce
 * length, or framing changes on one side, pairing silently fails to decrypt.
 *
 * Pure-JS (noble) rather than a native module, so it works in Expo Go without
 * a custom dev client.
 */
import { x25519 } from '@noble/curves/ed25519';
import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import { randomBytes } from '@noble/hashes/utils';
import { base64 } from '@scure/base';

const NONCE_LEN = 24;
const KDF_INFO = new TextEncoder().encode('cliplink-v1-session');

export type Identity = { secretKey: Uint8Array; publicKeyB64: string };

export function generateIdentity(): Identity {
  const secretKey = x25519.utils.randomPrivateKey();
  return { secretKey, publicKeyB64: base64.encode(x25519.getPublicKey(secretKey)) };
}

export function identityFromB64(secretB64: string): Identity {
  const secretKey = base64.decode(secretB64);
  return { secretKey, publicKeyB64: base64.encode(x25519.getPublicKey(secretKey)) };
}

export function secretToB64(identity: Identity): string {
  return base64.encode(identity.secretKey);
}

/**
 * Derives the key shared with the peer. The raw X25519 output goes through
 * HKDF because Diffie-Hellman results are not uniformly distributed and must
 * not be used as a cipher key directly.
 */
export function sessionKey(identity: Identity, peerPublicB64: string): Uint8Array {
  const shared = x25519.getSharedSecret(identity.secretKey, base64.decode(peerPublicB64));
  return hkdf(sha256, shared, undefined, KDF_INFO, 32);
}

/** Seals plaintext as base64(nonce ‖ ciphertext ‖ tag). */
export function seal(key: Uint8Array, plaintext: string): string {
  const nonce = randomBytes(NONCE_LEN);
  const ciphertext = xchacha20poly1305(key, nonce).encrypt(new TextEncoder().encode(plaintext));

  const framed = new Uint8Array(nonce.length + ciphertext.length);
  framed.set(nonce);
  framed.set(ciphertext, nonce.length);
  return base64.encode(framed);
}

/** Returns null rather than throwing — a bad payload is a re-pair prompt, not a crash. */
export function open(key: Uint8Array, sealedB64: string): string | null {
  try {
    const framed = base64.decode(sealedB64);
    if (framed.length <= NONCE_LEN) return null;

    const plaintext = xchacha20poly1305(key, framed.slice(0, NONCE_LEN)).decrypt(framed.slice(NONCE_LEN));
    return new TextDecoder().decode(plaintext);
  } catch {
    return null;
  }
}

export function hashHex(text: string): string {
  return Array.from(sha256(new TextEncoder().encode(text)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
