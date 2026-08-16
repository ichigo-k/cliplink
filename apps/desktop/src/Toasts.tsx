/**
 * The toast window.
 *
 * A borderless, always-on-top, non-focusable window that parks in a corner and
 * shows what just arrived: a mirrored phone notification, a file that landed in
 * Downloads, or a link someone copied.
 *
 * WHY ITS OWN WINDOW:
 * The main window is usually hidden, since ClipLink lives in the tray, so
 * toasts cannot render inside it. The overlay is the paste flyout and is driven
 * by the hotkey, so it cannot be borrowed either. This window exists solely to
 * be shown for a few seconds at a time.
 *
 * WHY IT RESIZES ITSELF:
 * The window is only as tall as the stack of visible toasts, so the transparent
 * region never swallows clicks meant for whatever is underneath. Every time the
 * stack changes the window is measured, resized and repositioned; when the stack
 * empties the window hides entirely.
 *
 * WHY THERE IS A GUTTER:
 * Sizing the window to its content means anything a card paints outside its own
 * box gets cut off at the window edge, and a clipped drop shadow stops looking
 * like a shadow and starts looking like a grey slab behind the toast. GUTTER is
 * the transparent margin that gives the shadow somewhere to fall.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { listen, emit } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow, currentMonitor, LogicalSize, LogicalPosition } from '@tauri-apps/api/window';
import {
  Bell,
  CalendarDays,
  Camera,
  FileDown,
  Hash,
  Link2,
  Mail,
  MessageCircle,
  MessageSquare,
  Phone,
  Send,
  X,
  type LucideIcon,
} from 'lucide-react';
import {
  loadToastPrefs,
  type ToastPrefs,
  type ToastPosition,
  TOAST_PREFS_EVENT,
} from './toastPrefs';
import { formatBytes, type PhoneNotification, type FileReceived, type ClipEntry } from './types';

type Toast = {
  id: number;
  /** Headline: who sent it, or what happened. */
  title: string;
  /** Small print beside the headline: the app it came from, a file size. */
  meta?: string;
  body: string;
  icon: LucideIcon;
  /** Hex colour for the icon chip, so each source is recognisable at a glance. */
  accent: string;
  /** Shown as a button under the text when the toast carries something actionable. */
  action?: { label: string; run: () => void };
  /** Set while the card plays its exit animation, just before it is removed. */
  leaving?: boolean;
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

const DEFAULT_ACCENT = '#22C55E';
const FILE_ACCENT = '#60A5FA';
const LINK_ACCENT = '#C084FC';

/**
 * Presentation rules for mirrored phone notifications.
 *
 * Without these every notification is the same grey row wearing the same bell,
 * and a message from a person reads exactly like a calendar reminder. Each
 * entry gives a source its own icon, colour and display name, so a card is
 * recognisable before any of its text has been read.
 *
 * Matched against the package name first because that is the stable half: the
 * display name changes with the phone's language, "WhatsApp Business" exists,
 * and OEM skins rename things.
 */
type AppTemplate = { label: string; accent: string; icon: LucideIcon };

const APP_TEMPLATES: [RegExp, AppTemplate][] = [
  [/whatsapp/i, { label: 'WhatsApp', accent: '#25D366', icon: MessageCircle }],
  [/telegram/i, { label: 'Telegram', accent: '#2AABEE', icon: Send }],
  [/signal/i, { label: 'Signal', accent: '#3A76F0', icon: MessageCircle }],
  [/slack/i, { label: 'Slack', accent: '#E01E5A', icon: Hash }],
  [/discord/i, { label: 'Discord', accent: '#5865F2', icon: MessageCircle }],
  [/instagram/i, { label: 'Instagram', accent: '#E1306C', icon: Camera }],
  [/messenger|facebook\.orca/i, { label: 'Messenger', accent: '#0084FF', icon: MessageCircle }],
  [/messaging|\bsms\b|\bmms\b/i, { label: 'Messages', accent: '#4ADE80', icon: MessageSquare }],
  [/gmail|android\.gm$|outlook|\bmail\b/i, { label: 'Mail', accent: '#EA4335', icon: Mail }],
  [/calendar/i, { label: 'Calendar', accent: '#F59E0B', icon: CalendarDays }],
  [/dialer|incallui|\bphone\b/i, { label: 'Phone', accent: '#34D399', icon: Phone }],
];

function templateFor(n: PhoneNotification): AppTemplate {
  const haystack = `${n.packageName ?? ''} ${n.appName ?? ''}`;
  for (const [pattern, template] of APP_TEMPLATES) {
    if (pattern.test(haystack)) return template;
  }
  return { label: n.appName || 'Phone', accent: DEFAULT_ACCENT, icon: Bell };
}

/**
 * A translucent wash of the accent, for the icon chip behind it.
 *
 * Appending an alpha pair to the hex rather than reaching for color-mix, which
 * would tie the look to a WebView2 build new enough to support it.
 */
function tint(accent: string): string {
  return `${accent}29`;
}

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
  /** id to the timeout that will start this toast's exit. */
  const dismissTimers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  /** id to the timeout that unmounts it once the exit animation has played. */
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
        const template = templateFor(n);
        const sender = n.title?.trim();
        push({
          icon: template.icon,
          accent: template.accent,
          // Lead with whoever sent it. The app name is useful context but it is
          // not the thing being read, so it drops to the meta line.
          title: sender || template.label,
          meta: sender ? template.label : undefined,
          body: n.text?.trim() || 'New notification',
        });
      }),

      listen<FileReceived>('file_received', e => {
        const f = e.payload;
        push({
          icon: FileDown,
          accent: FILE_ACCENT,
          title: f.fileName,
          meta: formatBytes(f.size),
          body: 'Saved to your Downloads folder',
          action: {
            label: 'Show in folder',
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
          icon: Link2,
          accent: LINK_ACCENT,
          title: 'Link copied',
          meta: clip.deviceName || 'your phone',
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
          const Icon = toast.icon;
          return (
            <div
              key={toast.id}
              className={`toast${toast.leaving ? ' toast--leaving' : ''}`}
              style={{
                '--toast-accent': toast.accent,
                '--toast-accent-soft': tint(toast.accent),
              } as React.CSSProperties}
              onMouseEnter={() => setPaused(true)}
              onMouseLeave={() => setPaused(false)}
            >
              <span className="toast__icon" aria-hidden="true">
                <Icon size={15} strokeWidth={2.25} />
              </span>

              <div className="toast__main">
                <div className="toast__head">
                  <span className="toast__title">{toast.title}</span>
                  {toast.meta && <span className="toast__meta">{toast.meta}</span>}
                </div>

                <div className="toast__text">{toast.body}</div>

                {toast.action && (
                  <div className="toast__actions">
                    <button
                      className="toast__action"
                      onClick={() => { toast.action!.run(); dismiss(toast.id); }}
                    >
                      {toast.action.label}
                    </button>
                  </div>
                )}
              </div>

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
