/**
 * In-app updates, checked against GitHub releases.
 *
 * ClipLink is sideloaded, so there is no store to push updates. `expo-updates`
 * cannot help either: it ships JavaScript only, and most of what changes here
 * is native. So the app watches the releases feed and installs the APK itself.
 */
import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import Constants from 'expo-constants';

const RELEASES_URL = 'https://api.github.com/repos/ichigo-k/cliplink/releases/latest';
const APK_SUFFIX = '.apk';

export type AvailableUpdate = {
  version: string;
  downloadUrl: string;
  notes: string;
};

export function currentVersion(): string {
  return Constants.expoConfig?.version ?? '0.0.0';
}

/** Compares dotted numeric versions. Positive when `a` is newer than `b`. */
function compareVersions(a: string, b: string): number {
  const parse = (v: string) => v.replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  const left = parse(a);
  const right = parse(b);

  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Returns the newer release, or null when up to date or unreachable.
 *
 * Never throws: an update check failing is not worth interrupting the user
 * over, and this runs on launch.
 */
export async function checkForUpdate(): Promise<AvailableUpdate | null> {
  try {
    const response = await fetch(RELEASES_URL, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!response.ok) return null;

    const release = (await response.json()) as {
      tag_name?: string;
      body?: string;
      assets?: { name: string; browser_download_url: string }[];
    };

    const latest = release.tag_name?.replace(/^v/, '');
    if (!latest || compareVersions(latest, currentVersion()) <= 0) return null;

    const apk = release.assets?.find(a => a.name.endsWith(APK_SUFFIX));
    if (!apk) return null;

    return { version: latest, downloadUrl: apk.browser_download_url, notes: release.body ?? '' };
  } catch {
    return null;
  }
}

/**
 * Downloads the APK and hands it to the system installer.
 *
 * Android shows its own confirmation, and the first time will send the user to
 * settings to allow installs from ClipLink — that prompt is the OS's, and
 * cannot be skipped or pre-approved.
 */
export async function downloadAndInstall(
  update: AvailableUpdate,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  const target = `${FileSystem.cacheDirectory}cliplink-${update.version}.apk`;

  // A partial file from an interrupted attempt would install as a corrupt APK.
  const existing = await FileSystem.getInfoAsync(target);
  if (existing.exists) await FileSystem.deleteAsync(target, { idempotent: true });

  const download = FileSystem.createDownloadResumable(
    update.downloadUrl,
    target,
    {},
    progress => {
      if (!onProgress || !progress.totalBytesExpectedToWrite) return;
      onProgress(progress.totalBytesWritten / progress.totalBytesExpectedToWrite);
    },
  );

  const result = await download.downloadAsync();
  if (!result?.uri) throw new Error('The download did not complete.');

  // A file:// path would crash the installer on Android 7+; it needs a
  // content:// URI backed by a FileProvider, which expo-file-system supplies.
  const contentUri = await FileSystem.getContentUriAsync(result.uri);

  await IntentLauncher.startActivityAsync('android.intent.action.INSTALL_PACKAGE', {
    data: contentUri,
    flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
  });
}
