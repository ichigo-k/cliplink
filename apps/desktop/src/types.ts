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
