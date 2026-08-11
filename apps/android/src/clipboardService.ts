/**
 * JS bridge to the native ClipboardModule / ClipboardAccessibilityService.
 *
 * The accessibility service fires "onClipboardChanged" events whenever the
 * user copies text on Android. App.tsx subscribes to these events and sends
 * the text to the PC — giving true zero-tap auto-sync.
 *
 * We also expose helpers to check whether the service is enabled and to open
 * the system Accessibility Settings screen so the user can enable it.
 */
import { NativeModules, NativeEventEmitter } from 'react-native';

const { ClipboardModule } = NativeModules;

/**
 * True if our ClipboardAccessibilityService is currently active.
 * Returns false if the native module is unavailable (e.g. in Expo Go).
 */
export async function isAccessibilityServiceEnabled(): Promise<boolean> {
    if (!ClipboardModule?.isAccessibilityServiceEnabled) return false;
    try {
        return await ClipboardModule.isAccessibilityServiceEnabled();
    } catch {
        return false;
    }
}

/**
 * Opens Android's Accessibility Settings screen.
 * The user can find "ClipLink" there and toggle it on.
 */
export function openAccessibilitySettings(): void {
    ClipboardModule?.openAccessibilitySettings?.();
}

/**
 * Subscribe to clipboard-change events fired by the accessibility service.
 * The callback receives the raw clipboard text string.
 * Returns an unsubscribe function — call it in a useEffect cleanup.
 */
export function onClipboardChanged(callback: (text: string) => void): () => void {
    if (!ClipboardModule) return () => { };

    const emitter = new NativeEventEmitter(ClipboardModule);
    const sub = emitter.addListener('onClipboardChanged', callback);
    return () => sub.remove();
}
