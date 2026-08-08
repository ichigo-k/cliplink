# ClipLink architecture

The Windows app is the server. It listens on `0.0.0.0:47123`, watches the
clipboard, and shows a QR code. The Android app is the client: it scans the
code, connects over the LAN, and holds the socket open.

See `packages/protocol/README.md` for the wire format.

## Pairing

The QR code carries a short-lived nonce and the PC's X25519 public key. The
phone connects, sends `hello` with its own public key, and both sides derive a
shared secret through HKDF-SHA256. Clip payloads are sealed with
XChaCha20-Poly1305.

The desktop stores each phone's public key after a successful pair, so
reconnecting later does not need another QR scan. The nonce is single-use and
expires after five minutes, which is what stops someone who photographed your
screen from pairing an hour later.

## Direction asymmetry

The two directions are not symmetric, and this is a platform constraint rather
than a design choice.

**PC → phone is automatic.** A background thread polls the Windows clipboard
every 500 ms and pushes changes to every connected phone.

**Phone → PC needs a tap.** Since Android 10, an app can only read the clipboard
while it holds input focus; `getPrimaryClip()` returns null from the background.
Google closed this deliberately to stop clipboard-sniffing apps. So the phone
sends on an explicit user action — a button in the app, and (planned) a share
sheet target and Quick Settings tile.

The alternatives were rejected: an accessibility service works but is routinely
refused a Play Store listing, and the ADB `READ_CLIPBOARD_IN_BACKGROUND` grant
does not survive on every ROM.

## Loop prevention

Without a guard, a copy on A applies to B, whose own watcher then sends it back
to A, forever. Two rules stop it:

1. A receiver ignores any clip whose `origin` is itself.
2. Before writing received text to the system clipboard, the receiver records
   that text's SHA-256 in a five-second suppression set. Its clipboard watcher
   drops one change matching that hash, then forgets it.

Rule 2 carries the weight. Rule 1 alone breaks as soon as a user re-copies the
same text by hand — which must sync, and does, because the suppression entry is
consumed on first use.

## Not built yet

File transfer, clipboard images, and Bluetooth-assisted discovery. Text sync is
the whole of the current scope.
