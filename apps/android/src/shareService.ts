/**
 * JS bridge to the native ShareModule.
 *
 * Anything the user pushes at ClipLink through the Android share sheet arrives
 * here as a flat list of items. Text comes through inline; files arrive as a
 * file:// path pointing at a copy in our own cache, because the content:// URI
 * the sender handed us stops being readable once the share activity goes away.
 *
 * Two delivery paths, because a cold launch has no bridge yet:
 *   - drainPendingShare() — call once on mount to pick up a cold start
 *   - onShareReceived()   — fires while the app is already running
 */
import { NativeModules, DeviceEventEmitter } from 'react-native';

const { ShareModule } = NativeModules;

export type SharedItem =
    | { kind: 'text'; text: string }
    | { kind: 'file'; path: string; name: string; mime: string; size: number };

/** Largest file we will pull into memory to encrypt and send. */
export const MAX_SHARE_BYTES = 25 * 1024 * 1024;

/**
 * Returns anything the share sheet sent before JS was listening, and clears it.
 * Safe to call when the native module is missing — resolves to an empty list.
 */
export async function drainPendingShare(): Promise<SharedItem[]> {
    if (!ShareModule?.getPendingShare) return [];
    try {
        return (await ShareModule.getPendingShare()) ?? [];
    } catch {
        return [];
    }
}

/**
 * Subscribe to shares that arrive while the app is running.
 * Returns an unsubscribe function — call it in a useEffect cleanup.
 */
export function onShareReceived(cb: (items: SharedItem[]) => void): () => void {
    const sub = DeviceEventEmitter.addListener(
        'onShareReceived',
        (items: SharedItem[]) => cb(items ?? []),
    );
    return () => sub.remove();
}
