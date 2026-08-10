/**
 * In-app updates, checked against GitHub releases.
 *
 * ClipLink is sideloaded, so there is no store to push updates. `expo-updates`
 * cannot help either: it ships JavaScript only, and most of what changes here
 * is native. So the app watches the releases feed and installs the APK itself.
 *
 * Downloading is deliberately separate from installing. The APK is ~100 MB, so
 * a download that already finished must never be thrown away — whether the user
 * dismissed the installer prompt a minute ago or opened the app again 50 days
 * later, `isUpdateDownloaded` sees the finished file and `installUpdate` hands
 * it straight to the system installer with no second download.
 */
import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';

const RELEASES_URL = 'https://api.github.com/repos/ichigo-k/cliplink/releases/latest';
const APK_SUFFIX = '.apk';

/**
 * Finished APKs live in documentDirectory, not cacheDirectory. Android reclaims
 * the cache directory whenever it wants storage back and does not ask, which
 * silently discarded completed downloads and made every launch re-fetch ~100 MB.
 */
const APK_DIR = `${FileSystem.documentDirectory}updates/`;

/** Remembers which version we already raised a notification for. */
const NOTIFIED_KEY = 'cliplink.notifiedUpdate';

export type AvailableUpdate = {
  version: string;
  downloadUrl: string;
  notes: string;
  /** Asset size in bytes, used to tell a finished download from a partial one. */
  size: number;
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
      assets?: { name: string; browser_download_url: string; size?: number }[];
    };

    const latest = release.tag_name?.replace(/^v/, '');
    if (!latest || compareVersions(latest, currentVersion()) <= 0) return null;

    const apk = release.assets?.find(a => a.name.endsWith(APK_SUFFIX));
    if (!apk) return null;

    return {
      version: latest,
      downloadUrl: apk.browser_download_url,
      notes: release.body ?? '',
      size: apk.size ?? 0,
    };
  } catch {
    return null;
  }
}

function apkPath(version: string): string {
  return `${APK_DIR}cliplink-${version}.apk`;
}

async function ensureApkDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(APK_DIR);
  if (!info.exists) await FileSystem.makeDirectoryAsync(APK_DIR, { intermediates: true });
}

/**
 * True when this version's APK is already on disk *and* complete.
 *
 * Size is the completeness test. An interrupted download leaves a plausible
 * file behind that installs as a corrupt package, and there is no cheaper
 * signal — so when the release does not report a size we refuse to trust what
 * is on disk and download again.
 */
export async function isUpdateDownloaded(update: AvailableUpdate): Promise<boolean> {
  if (!update.size) return false;
  const info = await FileSystem.getInfoAsync(apkPath(update.version));
  return info.exists && !info.isDirectory && info.size === update.size;
}

/** Deletes every cached APK except `keepVersion`, so old ~100 MB files don't pile up. */
async function pruneOldApks(keepVersion: string): Promise<void> {
  try {
    const keep = `cliplink-${keepVersion}.apk`;
    const names = await FileSystem.readDirectoryAsync(APK_DIR);
    await Promise.all(
      names
        .filter(name => name.endsWith(APK_SUFFIX) && name !== keep)
        .map(name => FileSystem.deleteAsync(`${APK_DIR}${name}`, { idempotent: true })),
    );
  } catch {
    // Housekeeping only — never fail an update over it.
  }
}

/**
 * Downloads the APK, reusing a finished download when there is one.
 *
 * Resolves to the local file URI. Progress is reported 0..1.
 */
export async function downloadUpdate(
  update: AvailableUpdate,
  onProgress?: (fraction: number) => void,
): Promise<string> {
  await ensureApkDir();
  const target = apkPath(update.version);

  if (await isUpdateDownloaded(update)) {
    onProgress?.(1);
    return target;
  }

  // Whatever is there is partial or from a different build of the same version.
  await FileSystem.deleteAsync(target, { idempotent: true });

  const download = FileSystem.createDownloadResumable(
    update.downloadUrl,
    target,
    {},
    progress => {
      if (!onProgress) return;
      const total = progress.totalBytesExpectedToWrite || update.size;
      if (total > 0) onProgress(progress.totalBytesWritten / total);
    },
  );

  const result = await download.downloadAsync();
  if (!result?.uri) throw new Error('The download did not complete.');

  await pruneOldApks(update.version);
  return result.uri;
}

/**
 * Hands an already-downloaded APK to the system installer.
 *
 * Android shows its own confirmation, and the first time will send the user to
 * settings to allow installs from ClipLink — that prompt is the OS's, and
 * cannot be skipped or pre-approved.
 */
export async function installUpdate(update: AvailableUpdate): Promise<void> {
  const target = apkPath(update.version);
  const info = await FileSystem.getInfoAsync(target);
  if (!info.exists) throw new Error('That update is not downloaded yet.');

  // A file:// path would crash the installer on Android 7+; it needs a
  // content:// URI backed by a FileProvider, which expo-file-system supplies.
  const contentUri = await FileSystem.getContentUriAsync(target);

  await IntentLauncher.startActivityAsync('android.intent.action.INSTALL_PACKAGE', {
    data: contentUri,
    flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
  });
}

/** Downloads if needed, then installs. */
export async function downloadAndInstall(
  update: AvailableUpdate,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  await downloadUpdate(update, onProgress);
  await installUpdate(update);
}

/** Whether ClipLink may post notifications at all. */
export async function notificationsAllowed(): Promise<boolean> {
  try {
    const { status } = await Notifications.getPermissionsAsync();
    return status === 'granted';
  } catch {
    return false;
  }
}

/** Asks for notification permission. Returns whether it ended up granted. */
export async function requestNotificationPermission(): Promise<boolean> {
  try {
    const { status } = await Notifications.requestPermissionsAsync();
    return status === 'granted';
  } catch {
    return false;
  }
}

/**
 * Fires an OS notification the moment an update is found, before the download
 * starts.
 *
 * The download runs on the JS thread with no foreground service, so closing the
 * app mid-download kills it with nothing to show for it. This is the part of the
 * flow guaranteed to land regardless of how quickly the app gets swiped away.
 *
 * Only one notification per version, otherwise every launch re-nags about an
 * update the user has already decided to ignore.
 */
export async function notifyUpdateAvailable(update: AvailableUpdate): Promise<void> {
  try {
    if (!(await notificationsAllowed())) {
      if (!(await requestNotificationPermission())) return;
    }

    const alreadyNotified = await SecureStore.getItemAsync(NOTIFIED_KEY);
    if (alreadyNotified === update.version) return;

    await Notifications.scheduleNotificationAsync({
      content: {
        title: `ClipLink v${update.version} is available`,
        body: 'Downloading now — open ClipLink to finish installing.',
      },
      trigger: null,
    });
    await SecureStore.setItemAsync(NOTIFIED_KEY, update.version);
  } catch {
    // Notification failing is not worth interrupting the update over.
  }
}
