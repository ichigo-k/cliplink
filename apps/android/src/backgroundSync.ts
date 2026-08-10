/**
 * Keeps the app's JS runtime alive when Android backgrounds ClipLink.
 *
 * Without this the OS suspends the JS bridge within seconds of the app
 * losing focus — the WebSocket dies, no messages land, and clips pushed
 * from the PC don't reach the phone's clipboard until you re-open the
 * app. `react-native-background-actions` starts an Android foreground
 * service (dataSync type, with a persistent notification), which lets
 * our existing SyncClient keep running in the same JS context.
 *
 * The task itself is a no-op infinite wait; the *service* is what
 * matters. Clipboard writes happen from onClip in App.tsx as usual and
 * work from the background because setPrimaryClip has no restriction
 * (only reads are gated on Android 10+).
 */
import BackgroundActions from 'react-native-background-actions';

const sleep = (ms: number) => new Promise<void>(res => setTimeout(res, ms));

const keepAlive = async () => {
  // Loop until the service is stopped. We don't do work here — the app's
  // main JS runtime is doing the actual sync; we just need to be alive.
  while (BackgroundActions.isRunning()) {
    await sleep(30_000);
  }
};

const OPTIONS = {
  taskName: 'ClipLink',
  taskTitle: 'ClipLink is syncing',
  taskDesc: 'Connected to your PC',
  taskIcon: { name: 'ic_launcher', type: 'mipmap' },
  color: '#22C55E',
  linkingURI: 'cliplink://',
  foregroundServiceType: ['dataSync'] as Array<'dataSync'>,
  parameters: {},
};

export async function startBackgroundSync(): Promise<void> {
  if (BackgroundActions.isRunning()) return;
  try {
    await BackgroundActions.start(keepAlive, OPTIONS);
  } catch {
    // POST_NOTIFICATIONS denied, or OEM killed the service — degrade
    // silently. The app still works while foregrounded.
  }
}

export async function stopBackgroundSync(): Promise<void> {
  if (!BackgroundActions.isRunning()) return;
  try { await BackgroundActions.stop(); } catch { /* noop */ }
}

export async function updateBackgroundStatus(deviceName: string): Promise<void> {
  if (!BackgroundActions.isRunning()) return;
  try {
    await BackgroundActions.updateNotification({ taskDesc: `Connected to ${deviceName}` });
  } catch { /* noop */ }
}
