import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Laptop, Search, Smartphone } from 'lucide-react';
import { oneLine, timeAgo, type ClipEntry } from './types';

/**
 * Resolved lazily. `main.tsx` imports this module for every window, so calling
 * getCurrentWindow() at module scope would run outside Tauri too — where it
 * throws and takes the whole app down with a blank screen.
 */
let cached: ReturnType<typeof getCurrentWindow> | null | undefined;

function overlayWindow() {
  if (cached === undefined) {
    try {
      cached = getCurrentWindow();
    } catch {
      cached = null;
    }
  }
  return cached;
}

export default function Overlay() {
  const [history, setHistory] = useState<ClipEntry[]>([]);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const [thisDevice, setThisDevice] = useState('');
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  const refresh = useCallback(() => {
    invoke<ClipEntry[]>('get_history').then(setHistory).catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    invoke<{ deviceId: string }>('create_pairing')
      .then(p => setThisDevice(p.deviceId))
      .catch(() => {});

    const stopClip = listen<ClipEntry>('clip', e =>
      setHistory(prev => [e.payload, ...prev.filter(c => c.id !== e.payload.id)].slice(0, 50)),
    );

    // Reopening should feel like a fresh panel, not wherever we left off.
    const stopFocus = overlayWindow()?.onFocusChanged(({ payload: focused }) => {
      if (!focused) return;
      refresh();
      setQuery('');
      setCursor(0);
      search.current?.focus();
    });

    search.current?.focus();
    return () => {
      stopClip.then(fn => fn());
      stopFocus?.then(fn => fn());
    };
  }, [refresh]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q ? history.filter(c => c.text.toLowerCase().includes(q)) : history;
    return matched.slice(0, 40);
  }, [history, query]);

  // A filter that shortens the list must not leave the cursor past the end.
  useEffect(() => {
    setCursor(c => Math.min(c, Math.max(0, results.length - 1)));
  }, [results.length]);

  useEffect(() => {
    list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  const paste = useCallback(async (entry: ClipEntry | undefined) => {
    if (!entry) return;
    try {
      await invoke('copy_to_clipboard', { text: entry.text });
    } catch {
      /* the backend surfaces its own failure */
    }
    await overlayWindow()?.hide();
  }, []);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      overlayWindow()?.hide();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor(c => Math.min(c + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor(c => Math.max(c - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      paste(results[cursor]);
    }
  }

  return (
    <div className="flyout" onKeyDown={onKeyDown}>
      <header className="flyout-head" data-tauri-drag-region>
        <span className="flyout-title">Clipboard</span>
        <span className="flyout-count">{history.length ? `${history.length} items` : ''}</span>
      </header>

      <div className="flyout-search">
        <Search size={14} />
        <input
          ref={search}
          value={query}
          onChange={e => {
            setQuery(e.target.value);
            setCursor(0);
          }}
          placeholder="Search clipboard"
          spellCheck={false}
        />
      </div>

      <div className="flyout-list" ref={list}>
        {results.length === 0 ? (
          <p className="flyout-empty">
            {history.length === 0 ? 'Nothing copied yet.' : 'No matches.'}
          </p>
        ) : (
          results.map((entry, i) => (
            <button
              key={entry.id}
              data-active={i === cursor}
              className="clip"
              onMouseEnter={() => setCursor(i)}
              onClick={() => paste(entry)}
              tabIndex={-1}
            >
              <span className="clip-text">{oneLine(entry.text)}</span>
              <span className="clip-meta">
                {entry.origin === thisDevice ? <Laptop size={11} /> : <Smartphone size={11} />}
                {entry.deviceName}
                <i>·</i>
                {timeAgo(entry.receivedAt)}
              </span>
            </button>
          ))
        )}
      </div>

      <footer className="flyout-foot">
        <span>
          <kbd>↑</kbd>
          <kbd>↓</kbd> move
        </span>
        <span>
          <kbd>↵</kbd> copy
        </span>
        <span>
          <kbd>esc</kbd> close
        </span>
      </footer>
    </div>
  );
}
