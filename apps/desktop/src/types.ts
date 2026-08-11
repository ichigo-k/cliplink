export type Pairing = {
  deviceId: string;
  deviceName: string;
  host: string;
  port: number;
  nonce: string;
  publicKey: string;
  expiresAt: number;
};

export type ClipEntry = {
  id: string;
  text: string;
  /** data:image/png;base64,… — present for image clips */
  imageDataUrl?: string;
  /** "text/plain" | "text/html" | "image/png" */
  contentType?: string;
  origin: string;
  deviceName: string;
  receivedAt: number;
  pinned?: boolean;
};

export type PairedDevice = {
  deviceId: string;
  deviceName: string;
  publicKey: string;
  pairedAt: number;
  lastHost?: string;
  lastSeen?: number;
};

export type SettingsView = {
  hotkey: string;
  deviceName: string;
  pairedDevices: PairedDevice[];
  launchAtStartup: boolean;
  historyLimit: number;
};

/** A notification mirrored from the phone. */
export type PhoneNotification = {
  key: string;
  packageName: string;
  appName: string;
  title: string;
  text: string;
  postedAt: number;
};

/** Emitted when the phone sends a file to the PC. */
export type FileReceived = {
  fileName: string;
  mimeType: string;
  size: number;
  path: string;
  deviceName: string;
};

export function timeAgo(seconds: number): string {
  const delta = Math.max(0, Math.floor(Date.now() / 1000) - seconds);
  if (delta < 45) return 'just now';
  if (delta < 3600) return `${Math.floor(delta / 60)}m`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h`;
  return `${Math.floor(delta / 86400)}d`;
}

/** Collapses whitespace so multi-line clips stay one row in a list. */
export function oneLine(text: string, max = 90): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/** Format bytes to human-readable string. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
