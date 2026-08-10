import { useSyncExternalStore } from "react";
import { SITE } from "./site";

export type PlatformId = "windows" | "macos-arm" | "macos-intel" | "linux" | "android";

export interface Build {
  id: PlatformId;
  /** Short name for buttons: "Windows" */
  name: string;
  /** Full name for headings: "Windows 10 & 11" */
  detail: string;
  /** Exact artifact the release publishes. */
  file: string;
  arch: string;
  role: "host" | "companion";
  href: string;
}

const V = SITE.version.replace(/^v/, "");

// Filenames follow Tauri's bundle naming for productName "ClipLink"; links point
// at the release page rather than a direct asset so they can't rot between tags.
export const BUILDS: Record<PlatformId, Build> = {
  windows: {
    id: "windows",
    name: "Windows",
    detail: "Windows 10 & 11",
    file: `ClipLink_${V}_x64-setup.exe`,
    arch: "x64",
    role: "host",
    href: SITE.releases,
  },
  "macos-arm": {
    id: "macos-arm",
    name: "macOS",
    detail: "Apple Silicon",
    file: `ClipLink_${V}_aarch64.dmg`,
    arch: "arm64",
    role: "host",
    href: SITE.releases,
  },
  "macos-intel": {
    id: "macos-intel",
    name: "macOS",
    detail: "Intel Mac",
    file: `ClipLink_${V}_x64.dmg`,
    arch: "x86_64",
    role: "host",
    href: SITE.releases,
  },
  linux: {
    id: "linux",
    name: "Linux",
    detail: "AppImage & .deb",
    file: `ClipLink_${V}_amd64.AppImage`,
    arch: "x86_64",
    role: "host",
    href: SITE.releases,
  },
  android: {
    id: "android",
    name: "Android",
    detail: "Android 9 and up",
    file: "app-release.apk",
    arch: "arm64",
    role: "companion",
    href: SITE.releases,
  },
};

export const ORDER: PlatformId[] = [
  "windows",
  "android",
  "macos-arm",
  "macos-intel",
  "linux",
];

/**
 * Best guess at the visitor's platform. Uses userAgentData when the browser
 * offers it (the only reliable way to tell Apple Silicon from Intel) and falls
 * back to the user-agent string. Windows is the default because it's the only
 * host build that's fully shipped.
 */
export function detectPlatform(): PlatformId {
  if (typeof navigator === "undefined") return "windows";

  const ua = navigator.userAgent;
  const data = (
    navigator as Navigator & { userAgentData?: { platform?: string } }
  ).userAgentData;
  const platform = (data?.platform || navigator.platform || "").toLowerCase();

  if (/android/i.test(ua)) return "android";
  if (/win/i.test(platform) || /windows/i.test(ua)) return "windows";

  if (/mac/i.test(platform) || /mac os x/i.test(ua)) {
    // iPads report as Mac; treat their touch-capable UA as Apple Silicon.
    const appleSilicon =
      navigator.maxTouchPoints > 1 || /arm|apple m/i.test(ua) || isAppleSilicon();
    return appleSilicon ? "macos-arm" : "macos-intel";
  }

  if (/linux|x11|cros/i.test(platform) || /linux/i.test(ua)) return "linux";
  return "windows";
}

/**
 * Read the platform without a setState-in-effect round trip. The server (and the
 * hydration pass) sees null so markup matches; the client resolves immediately
 * after. Snapshots are primitives, so React's identity check is satisfied.
 */
export function usePlatform(): PlatformId | null {
  return useSyncExternalStore(
    () => () => {},
    detectPlatform,
    () => null
  );
}

/** WebGL renderer string is the only hint Safari gives about the chip. */
function isAppleSilicon(): boolean {
  try {
    const gl = document.createElement("canvas").getContext("webgl");
    const ext = gl?.getExtension("WEBGL_debug_renderer_info");
    const renderer = ext
      ? String(gl?.getParameter(ext.UNMASKED_RENDERER_WEBGL))
      : "";
    return /apple\s+m\d/i.test(renderer);
  } catch {
    return false;
  }
}
