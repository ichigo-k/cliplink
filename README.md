# ClipLink

> Your clipboard. Your devices. One private bridge.

ClipLink is an offline-first, open-source bridge for synchronizing clipboard content and transferring files between a Windows PC and Android phone.

## Principles

- No account required
- No cloud service required
- Pair devices with a QR code
- Transfer directly over the local network
- Keep user data on the user's devices

## Repository layout

- `apps/windows` — Windows tray application
- `apps/android` — React Native/Expo Android companion application
- `packages/protocol` — shared pairing and sync protocol
- `packages/crypto` — shared security design and implementation notes
- `docs` — architecture and contributor documentation

## Current status

Project scaffold. The first prototype will implement QR pairing and text clipboard synchronization.

## License

ClipLink will use the MIT License.
