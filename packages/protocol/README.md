# ClipLink wire protocol v1

The desktop is the **server**. The phone is the **client**. Both must be on the
same LAN; nothing is routed through the internet.

- Transport: WebSocket over TCP, `ws://<host>:47123/v1/sync`
- Encoding: UTF-8 JSON, one message per WebSocket text frame
- Every message has a `type` field; unknown types are ignored, not fatal

## Pairing

The desktop renders a QR code encoding a `PairingOffer`. The offer is
short-lived so a screenshot of it cannot be replayed later.

```json
{
  "app": "ClipLink",
  "version": 1,
  "deviceId": "win-a1b2c3d4",
  "deviceName": "This Windows PC",
  "host": "192.168.1.8",
  "port": 47123,
  "nonce": "<32 chars>",
  "publicKey": "<base64 X25519 public key>",
  "expiresAt": 1754640000
}
```

The phone scans it, opens the WebSocket, and sends `hello` within the offer's
lifetime. The desktop rejects a `hello` whose nonce is unknown, already used, or
past `expiresAt`.

```
phone  -> hello      { nonce, deviceId, deviceName, publicKey }
desktop -> hello-ack { deviceId, deviceName, publicKey }   // or: error
```

Both sides derive a shared secret with X25519 and keep it. The desktop stores
the phone's `publicKey` as a known device, so later reconnects skip the QR step
and authenticate with the stored key instead of a nonce.

## Clipboard events

After `hello-ack`, either side may push a `clip` at any time.

```json
{
  "type": "clip",
  "id": "<uuid>",
  "origin": "<deviceId of the device where the copy happened>",
  "contentType": "text/plain",
  "hash": "<sha256 of payload, hex>",
  "sentAt": 1754640012,
  "payload": "<encrypted, base64>"
}
```

`payload` is XChaCha20-Poly1305 sealed with the derived key. `contentType`,
`hash`, and `origin` stay in the clear so a receiver can decide whether it cares
before spending work on decryption.

## Loop prevention

Without care, A copies → B applies → B's own watcher sees a change → B sends it
back → A applies → forever.

Two rules stop it:

1. A receiver never re-broadcasts a `clip` whose `origin` is not itself.
2. Before writing received content to the system clipboard, the receiver records
   that content's `hash` in a short-lived suppression set. Its clipboard watcher
   drops any change whose hash is in that set, then clears the entry.

Rule 2 is the one that matters — rule 1 alone breaks if a user re-copies the
same text by hand.

## Errors

```json
{ "type": "error", "code": "nonce_expired", "message": "Scan a fresh QR code." }
```

Codes: `nonce_expired`, `nonce_unknown`, `version_unsupported`, `not_paired`,
`decrypt_failed`, `payload_too_large`.

## Limits

- Max clip payload: 1 MB. Larger content is a file transfer, not a clipboard event.
- Heartbeat: client sends `ping` every 20s; desktop closes a socket silent for 60s.
