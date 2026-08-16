/**
 * The toast window.
 *
 * A borderless, always-on-top, non-focusable window that parks in a corner and
 * shows what just arrived: a mirrored phone notification, a file that landed in
 * Downloads, or a link someone copied.
 *
 * WHY ITS OWN WINDOW:
 * The main window is usually hidden — ClipLink lives in the tray — so toasts
 * cannot render inside it. The overlay is the paste flyout and is driven by the
 * hotkey, so it cannot be borrowed either. This window exists solely to be shown
 * for a few seconds at a time.
 *
 * WHY IT RESIZES ITSELF:
 * The window is only as tall as the stack of visible toasts, so the transparent
 * region never swallows clicks meant for whatever is underneath. Every time the
 * stack changes the window is measured, resized and repositioned; when the stack
 * empties the window hides entirely.
 *
 * WHY THERE IS A GUTTER:
 * Sizing the window to its content means anything a card paints outside its own
 * box gets cut off at the window edge — and a clipped drop shadow stops looking
 * like a shadow and starts looking like a grey slab behind the toast. GUTTER is
 * the transparent margin that gives the shadow somewhere to fall.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { listen, emit } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow, currentMonitor, LogicalSize, LogicalPosition } from '@tauri-apps/api/window';
import { Bell, FileDown, Link2, X } from 'lucide-react';
import {
  loadToastPrefs,
  type ToastPrefs,
  type ToastPosition,
  TOAST_PREFS_EVENT,
} from './toastPrefs';
import { formatBytes, type PhoneNotification, type FileReceived, type ClipEntry } from './types';

type ToastKind = 'notification' | 'file' | 'link';

type Toast = {
  id: number;
  kind: ToastKind;
  title: string;
  body: string;
  /** Shown as a button when the toast carries something actionable. */
  action?: { label: string; run: () => void };
  /** Set while the card plays its exit animation, just before it is removed. */
  leaving?: boolean;
};

const ICONS: Record<ToastKind, typeof Bell> = {
  notification: Bell,
  file: FileDown,
  link: Link2,
};

/** Distance from the screen edge to the visible card, in logical pixels. */
const MARGIN = 16;
/** Kept clear at the bottom so a toast never sits under the Windows taskbar. */
const TASKBAR_ALLOWANCE = 56;
/** More than this on screen at once is noise; the oldest fall off. */
const MAX_VISIBLE = 4;
/** Visible width of a card. */
const CARD_WIDTH = 360;
/** Transparent room around the cards. Must match --toast-gutter in styles.css. */
const GUTTER = 28;
/** Must match the toast-out animation in styles.css. */
const EXIT_MS = 160;

/** Hands a URL or file path to the OS. `open_path` covers both. */
function openWithSystem(target: string): void {
  void invoke('open_path', { path: target }).catch(() => { });
}

/** Pulls the first http(s) URL out of copied text, if it is essentially just a link. */
function extractUrl(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length > 2048) return null;
  const match = trimmed.match(/https?:\/\/[^\s<>"']+/);
  if (!match) return null;
  // Only offer to open when the clip is a link, not prose that mentions one.
  return trimmed === match[0] ? match[0] : null;
}

export default function Toasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [prefs, setPrefs] = useState<ToastPrefs>(loadToastPrefs);
  /** True while the pointer is over a card, which holds the countdown. */
  const [paused, setPaused] = useState(false);
  const nextId = useRef(1);
  /** id → the timeout that will start this toast's exit. */
  const dismissTimers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  /** id → the timeout that unmounts it once the exit animation has played. */
  const removalTimers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const stackRef = useRef<HTMLDivElement>(null);

  /** Starts the exit animation. Removal happens once it has played out. */
  const dismiss = useCallback((id: number) => {
    setToasts(prev =>
      // Already on the way out: a second click must not restart the exit.
      prev.some(t => t.id === id && !t.leaving)
        ? prev.map(t => (t.id === id ? { ...t, leaving: true } : t))
        : prev,
    );
  }, []);

  const push = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = nextId.current++;
    setToasts(prev => [...prev, { ...toast, id }].slice(-MAX_VISIBLE));
  }, []);

  /* ── Auto-dismiss, reconciled against what is actually on screen ──
   *
   * Arming the timer inside push() meant a toast dropped by the MAX_VISIBLE cap
   * left its timeout running, to fire later against an id that no longer
   * existed. Deriving the timers from the rendered list instead makes that
   * unrepresentable: no toast, no timer.
   */
  useEffect(() => {
    const live = new Set(toasts.filter(t => !t.leaving).map(t => t.id));

    for (const [id, timer] of dismissTimers.current) {
      if (paused || !live.has(id)) {
        clearTimeout(timer);
        dismissTimers.current.delete(id);
      }
    }
    if (paused) return;

    // Read the duration at arm time so a settings change takes effect
    // immediately rather than on the next app start.
    const ms = loadToastPrefs().durationMs;
    for (const id of live) {
      if (dismissTimers.current.has(id)) continue;
      dismissTimers.current.set(id, setTimeout(() => dismiss(id), ms));
    }
  }, [toasts, paused, dismiss]);

  /* ── Unmount a card once its exit animation has finished ── */
  useEffect(() => {
    for (const toast of toasts) {
      if (!toast.leaving || removalTimers.current.has(toast.id)) continue;
      removalTimers.current.set(
        toast.id,
        setTimeout(() => {
          removalTimers.current.delete(toast.id);
          setToasts(prev => prev.filter(t => t.id !== toast.id));
        }, EXIT_MS),
      );
    }
  }, [toasts]);

  /* ── Preferences, kept in sync with the settings window ── */
  useEffect(() => {
    const stop = listen<ToastPrefs>(TOAST_PREFS_EVENT, e => setPrefs(e.payload));
    return () => { stop.then(f => f()); };
  }, []);

  /* ── Sources ── */
  useEffect(() => {
    if (!prefs.enabled) return;

    const stops = [
      listen<PhoneNotification>('phone_notification', e => {
        const n = e.payload;
        push({
          kind: 'notification',
          title: n.appName || 'Phone',
          body: [n.title, n.text].filter(Boolean).join(' — ') || 'New notification',
        });
      }),

      listen<FileReceived>('file_received', e => {
        const f = e.payload;
        push({
          kind: 'file',
          title: 'File received',
          body: `${f.fileName} · ${formatBytes(f.size)}`,
          action: {
            label: 'Show',
            run: () => openWithSystem(f.path),
          },
        });
      }),

      listen<ClipEntry>('clip', e => {
        const clip = e.payload;
        // Only surface clips that came from the phone; the PC's own copies are
        // not news to the person who just made them.
        if (clip.origin === 'local') return;
        const url = extractUrl(clip.text ?? '');
        if (!url) return;
        push({
          kind: 'link',
          title: `Link from ${clip.deviceName || 'your phone'}`,
          body: url,
          action: {
            label: 'Open in browser',
            run: () => openWithSystem(url),
          },
        });
      }),
    ];

    return () => { stops.forEach(s => s.then(f => f())); };
  }, [prefs.enabled, push]);

  /* ── Size and place the window around whatever is currently showing ── */
  useLayoutEffect(() => {
    const win = getCurrentWindow();

    if (toasts.length === 0) {
      void win.hide();
      return;
    }

    let cancelled = false;

    void (async () => {
      // scrollHeight rather than a bounding rect: cards are mid-animation here
      // and a rect would measure them scaled.
      const height = Math.ceil(stackRef.current?.scrollHeight ?? 0) + GUTTER * 2;
      const width = CARD_WIDTH + GUTTER * 2;
      if (cancelled) return;

      await win.setSize(new LogicalSize(width, height));

      const monitor = await currentMonitor();
      if (cancelled || !monitor) {
        await win.show();
        return;
      }

      const scale = monitor.scaleFactor || 1;
      // Monitor geometry is physical; everything else here is logical.
      const screenW = monitor.size.width / scale;
      const screenH = monitor.size.height / scale;
      const originX = monitor.position.x / scale;
      const originY = monitor.position.y / scale;

      const { x, y } = place(prefs.position, {
        screenW, screenH, originX, originY, width, height,
      });

      await win.setPosition(new LogicalPosition(Math.round(x), Math.round(y)));
      if (!cancelled) await win.show();
    })();

    return () => { cancelled = true; };
  }, [toasts, prefs.position]);

  /* ── Drop pending timers if the window is torn down ── */
  useEffect(() => {
    const dismissing = dismissTimers.current;
    const removing = removalTimers.current;
    return () => {
      dismissing.forEach(clearTimeout);
      dismissing.clear();
      removing.forEach(clearTimeout);
      removing.clear();
    };
  }, []);

  return (
    <div className="toast-root" data-position={prefs.position}>
      <div className="toast-stack" ref={stackRef}>
        {toasts.map(toast => {
          const Icon = ICONS[toast.kind];
          return (
            <div
              key={toast.id}
              className={`toast toast--${toast.kind}${toast.leaving ? ' toast--leaving' : ''}`}
              onMouseEnter={() => setPaused(true)}
              onMouseLeave={() => setPaused(false)}
            >
              <span className="toast__icon" aria-hidden="true">
                <Icon size={14} strokeWidth={2.25} />
              </span>

              <div className="toast__body">
                <div className="toast__title">{toast.title}</div>
                <div className="toast__text">{toast.body}</div>
              </div>

              {toast.action && (
                <button
                  className="toast__action"
                  onClick={() => { toast.action!.run(); dismiss(toast.id); }}
                >
                  {toast.action.label}
                </button>
              )}

              <button
                className="toast__close"
                onClick={() => dismiss(toast.id)}
                aria-label="Dismiss"
              >
                <X size={12} strokeWidth={2.5} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Screen coordinates for one of the six anchor points. */
function place(
  position: ToastPosition,
  m: {
    screenW: number; screenH: number;
    originX: number; originY: number;
    width: number; height: number;
  },
): { x: number; y: number } {
  // The window carries GUTTER of transparent padding on every side, so it is
  // pushed that much further out than the card is meant to sit. MARGIN then
  // measures from the screen edge to the card, not to the window.
  const left = m.originX + MARGIN - GUTTER;
  const right = m.originX + m.screenW - m.width - MARGIN + GUTTER;
  const centerX = m.originX + (m.screenW - m.width) / 2;
  const top = m.originY + MARGIN - GUTTER;
  const bottom = m.originY + m.screenH - m.height - TASKBAR_ALLOWANCE + GUTTER;

  switch (position) {
    case 'top-left': return { x: left, y: top };
    case 'top-center': return { x: centerX, y: top };
    case 'top-right': return { x: right, y: top };
    case 'bottom-left': return { x: left, y: bottom };
    case 'bottom-center': return { x: centerX, y: bottom };
    case 'bottom-right':
    default: return { x: right, y: bottom };
  }
}

/** Broadcast a preference change to the toast window. */
export function publishToastPrefs(prefs: ToastPrefs): void {
  void emit(TOAST_PREFS_EVENT, prefs);
}
