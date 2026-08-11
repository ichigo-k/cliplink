/**
 * Fetches the latest GitHub release for ClipLink and maps the attached
 * assets to the platform build definitions.
 *
 * This runs server-side (Next.js server components / Route Handlers) and is
 * cached by Next.js with a 5-minute revalidation window so the page always
 * shows the latest release without hammering the API on every request.
 */

import type { PlatformId } from "./platform";

const REPO = "ichigo-k/cliplink";
const API = `https://api.github.com/repos/${REPO}/releases/latest`;

export interface ReleaseAsset {
    name: string;
    browser_download_url: string;
    size: number;
}

export interface GitHubRelease {
    tag_name: string;
    name: string;
    published_at: string;
    html_url: string;
    assets: ReleaseAsset[];
}

export interface ResolvedBuild {
    id: PlatformId;
    name: string;
    detail: string;
    arch: string;
    role: "host" | "companion";
    file: string;
    href: string;
    size: number;
}

/** File-name patterns that identify each platform's artifact. */
const MATCHERS: Record<PlatformId, RegExp> = {
    windows: /x64-setup\.exe$/i,
    "macos-arm": /aarch64\.dmg$/i,
    "macos-intel": /x64\.dmg$/i,
    linux: /amd64\.AppImage$/i,
    android: /\.apk$/i,
};

const META: Record<PlatformId, Pick<ResolvedBuild, "id" | "name" | "detail" | "arch" | "role">> = {
    windows: { id: "windows", name: "Windows", detail: "Windows 10 & 11", arch: "x64", role: "host" },
    "macos-arm": { id: "macos-arm", name: "macOS", detail: "Apple Silicon", arch: "arm64", role: "host" },
    "macos-intel": { id: "macos-intel", name: "macOS", detail: "Intel Mac", arch: "x86_64", role: "host" },
    linux: { id: "linux", name: "Linux", detail: "AppImage & .deb", arch: "x86_64", role: "host" },
    android: { id: "android", name: "Android", detail: "Android 9+", arch: "arm64", role: "companion" },
};

export const PLATFORM_ORDER: PlatformId[] = [
    "windows",
    "android",
    "macos-arm",
    "macos-intel",
    "linux",
];

export interface ReleaseInfo {
    version: string;
    publishedAt: string;
    releasePage: string;
    builds: Record<PlatformId, ResolvedBuild>;
}

/**
 * Fallback when the API is unavailable (rate-limited, offline, etc.).
 * Points everything at the releases page so links still work.
 */
function fallback(version = "latest"): ReleaseInfo {
    const releasePage = `https://github.com/${REPO}/releases/latest`;
    const builds = Object.fromEntries(
        PLATFORM_ORDER.map((id) => [
            id,
            { ...META[id], file: "—", href: releasePage, size: 0 },
        ])
    ) as Record<PlatformId, ResolvedBuild>;
    return { version, publishedAt: "", releasePage, builds };
}

export async function fetchLatestRelease(): Promise<ReleaseInfo> {
    try {
        const res = await fetch(API, {
            headers: {
                Accept: "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
                // Set a User-Agent so GitHub doesn't block anonymous requests
                "User-Agent": "cliplink-website",
            },
            // Next.js: cache for 5 minutes, then revalidate in the background
            next: { revalidate: 300 },
        });

        if (!res.ok) {
            console.warn(`ClipLink release fetch failed: ${res.status} ${res.statusText}`);
            return fallback();
        }

        const release: GitHubRelease = await res.json();
        const version = release.tag_name ?? "latest";
        const releasePage = release.html_url;

        const builds = Object.fromEntries(
            PLATFORM_ORDER.map((id) => {
                const pattern = MATCHERS[id];
                const asset = release.assets.find((a) => pattern.test(a.name));
                return [
                    id,
                    {
                        ...META[id],
                        file: asset?.name ?? "—",
                        href: asset?.browser_download_url ?? releasePage,
                        size: asset?.size ?? 0,
                    } satisfies ResolvedBuild,
                ];
            })
        ) as Record<PlatformId, ResolvedBuild>;

        return {
            version,
            publishedAt: release.published_at,
            releasePage,
            builds,
        };
    } catch (err) {
        console.error("ClipLink release fetch threw:", err);
        return fallback();
    }
}
