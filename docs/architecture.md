# ClipLink architecture

The Windows app owns a local pairing listener and clipboard watcher. The React Native Android app scans a short-lived QR code, verifies the pairing data, and connects directly to the Windows device over Wi-Fi.

Clipboard events include an event ID, origin device ID, content type, content hash, timestamp, and payload. Remote events are marked before writing to the system clipboard so they cannot loop back to the originating device.

Bluetooth is optional discovery/pairing assistance. Wi-Fi is the primary transport for clipboard images and file transfers.
