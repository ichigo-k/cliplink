# ClipLink

> Your clipboard. Your devices. One private bridge.

ClipLink is an offline-first, source-available bridge for synchronizing clipboard content and transferring files between a Windows PC and Android phone.

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

ClipLink uses the [ClipLink Community License](LICENSE) — source-available, not
OSI open source.

- **Free** for personal, educational, non-profit, and any other non-commercial
  use. Fork it, modify it, redistribute it, send patches.
- **Paid** if you make money with it: 5% of gross revenue, or negotiated terms.
  Nothing is owed below US$1,000 of attributable revenue per year.
- **Star the repo** if you fork or clone it and you have a GitHub account.

See [LICENSE](LICENSE) for the exact terms.
