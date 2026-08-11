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
 *
 * IMPORTANT: The service must start as soon as the app is paired and
 * stay running through all connection state changes (connecting, error,
 * reconnecting). Stopping it on disconnect is what causes the "need to
 * re-open the app" bug — the JS bridge gets suspended mid-reconnect.
 * Call startBackgroundSync() once when paired, stopBackgroundSync()
 * only when the user explicitly unpairs or the app component unmounts.
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

const BASE_OPTIONS = {
  taskName: 'ClipLink',
  taskTitle: 'ClipLink',
  taskDesc: 'Waiting to connect…',
  taskIcon: { name: 'ic_launcher', type: 'mipmap' },
  color: '#22C55E',
  linkingURI: 'cliplink://',
  foregroundServiceType: ['dataSync'] as Array<'dataSync'>,
  parameters: {},
};

export async function startBackgroundSync(): Promise<void> {
  if (BackgroundActions.isRunning()) return;
  try {
    await BackgroundActions.start(keepAlive, BASE_OPTIONS);
  } catch {
    // POST_NOTIFICATIONS denied, or OEM killed the service — degrade
    // silently. The app still works while foregrounded.
  }
}

export async function stopBackgroundSync(): Promise<void> {
  if (!BackgroundActions.isRunning()) return;
  try { await BackgroundActions.stop(); } catch { /* noop */ }
}

/**
 * Update the persistent notification to reflect the current connection state.
 * This gives the user visibility without needing to open the app.
 */
export async function updateBackgroundStatus(
  state: 'connecting' | 'connected' | 'reconnecting' | 'error',
  detail?: string,
): Promise<void> {
  if (!BackgroundActions.isRunning()) return;
  let taskDesc: string;
  switch (state) {
    case 'connected':
      taskDesc = `Connected to ${detail ?? 'your PC'} ✓`;
      break;
    case 'connecting':
      taskDesc = 'Connecting to your PC…';
      break;
    case 'reconnecting':
      taskDesc = 'Connection lost — reconnecting…';
      break;
    case 'error':
      taskDesc = detail ?? 'Could not reach your PC';
      break;
  }
  try {
    await BackgroundActions.updateNotification({ taskDesc });
  } catch { /* noop */ }
}
