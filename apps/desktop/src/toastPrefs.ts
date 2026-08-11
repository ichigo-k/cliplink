/**
 * Toast preferences, shared between the settings pane and the toast window.
 *
 * These live in localStorage rather than settings.json because both windows are
 * the same web origin and therefore share the store, which makes reading them
 * synchronous on first paint — the toast window needs its position before it
 * can show anything, and an async round-trip would make the first toast of a
 * session flash in the wrong corner.
 *
 * Changes are broadcast over a Tauri event so the toast window applies them
 * without a restart; localStorage is the durable copy.
 */

export type ToastPosition =
    | 'top-left'
    | 'top-center'
    | 'top-right'
    | 'bottom-left'
    | 'bottom-center'
    | 'bottom-right';

export type ToastPrefs = {
    enabled: boolean;
    position: ToastPosition;
    /** How long a toast stays on screen. */
    durationMs: number;
};

export const TOAST_POSITIONS: { value: ToastPosition; label: string }[] = [
    { value: 'top-left', label: 'Top left' },
    { value: 'top-center', label: 'Top center' },
    { value: 'top-right', label: 'Top right' },
    { value: 'bottom-left', label: 'Bottom left' },
    { value: 'bottom-center', label: 'Bottom center' },
    { value: 'bottom-right', label: 'Bottom right' },
];

/** Offered in the settings pane, in seconds. */
export const TOAST_DURATIONS = [3, 5, 8, 12];

export const TOAST_PREFS_EVENT = 'toast_prefs_changed';

const STORAGE_KEY = 'cliplink.toastPrefs';

export const DEFAULT_TOAST_PREFS: ToastPrefs = {
    enabled: true,
    position: 'bottom-right',
    durationMs: 5000,
};

export function loadToastPrefs(): ToastPrefs {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return DEFAULT_TOAST_PREFS;
        const parsed = JSON.parse(raw) as Partial<ToastPrefs>;
        return {
            enabled: parsed.enabled ?? DEFAULT_TOAST_PREFS.enabled,
            position: parsed.position ?? DEFAULT_TOAST_PREFS.position,
            // Clamp so a hand-edited value cannot pin a toast on screen forever.
            durationMs: Math.min(Math.max(parsed.durationMs ?? 5000, 1500), 30000),
        };
    } catch {
        return DEFAULT_TOAST_PREFS;
    }
}

export function saveToastPrefs(prefs: ToastPrefs): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch {
        // A full or blocked store is not worth interrupting the user over.
    }
}
