import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Laptop, Search, Smartphone } from 'lucide-react';
import { oneLine, timeAgo, type ClipEntry } from './types';

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
    invoke<ClipEntry[]>('get_history').then(setHistory).catch(() => { });
  }, []);

  useEffect(() => {
    refresh();
    invoke<{ deviceId: string }>('create_pairing')
      .then(p => setThisDevice(p.deviceId))
      .catch(() => { });

    const stopClip = listen<ClipEntry>('clip', e =>
      setHistory(prev => [e.payload, ...prev.filter(c => c.id !== e.payload.id)].slice(0, 50)),
    );

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
      /* backend surfaces its own failure */
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

  // Group by today vs earlier for a Win11-style section divider feel
  const now = Math.floor(Date.now() / 1000);
  const todayCutoff = now - 86400;
  const todayItems = results.filter(c => c.receivedAt >= todayCutoff);
  const olderItems = results.filter(c => c.receivedAt < todayCutoff);

  function renderClip(entry: ClipEntry, globalIdx: number) {
    const isActive = globalIdx === cursor;
    const isLocal = entry.origin === thisDevice;
    return (
      <button
        key={entry.id}
        data-active={isActive}
        className="clip"
        onMouseEnter={() => setCursor(globalIdx)}
        onClick={() => paste(entry)}
        tabIndex={-1}
        title={entry.text}
      >
        <div className="clip-inner">
          <div className="clip-body">
            <span className="clip-text">{oneLine(entry.text, 80)}</span>
            <span className="clip-meta">
              <span className="clip-origin-tag">
                {isLocal ? <Laptop size={10} /> : <Smartphone size={10} />}
                {entry.deviceName}
              </span>
              <i>·</i>
              {timeAgo(entry.receivedAt)}
            </span>
          </div>
        </div>
      </button>
    );
  }

  return (
    <div className="flyout" onKeyDown={onKeyDown} tabIndex={-1}>
      {/* ── Header ── */}
      <header className="flyout-head" data-tauri-drag-region>
        <span className="flyout-title">Clipboard</span>
        {history.length > 0 && (
          <span className="flyout-count">{history.length}</span>
        )}
      </header>

      {/* ── Search ── */}
      <div className="flyout-search">
        <Search size={13} />
        <input
          ref={search}
          value={query}
          onChange={e => { setQuery(e.target.value); setCursor(0); }}
          placeholder="Search clipboard history"
          spellCheck={false}
        />
      </div>

      {/* ── List ── */}
      <div className="flyout-list" ref={list}>
        {results.length === 0 ? (
          <p className="flyout-empty">
            {history.length === 0 ? 'Nothing copied yet.' : 'No matches.'}
          </p>
        ) : query ? (
          // Flat list when searching
          results.map((entry, i) => renderClip(entry, i))
        ) : (
          // Grouped: Today / Earlier
          <>
            {todayItems.length > 0 && (
              <>
                <p className="flyout-section">Today</p>
                {todayItems.map((entry, i) => renderClip(entry, i))}
              </>
            )}
            {olderItems.length > 0 && (
              <>
                <p className="flyout-section">Earlier</p>
                {olderItems.map((entry, i) => renderClip(entry, todayItems.length + i))}
              </>
            )}
          </>
        )}
      </div>

      {/* ── Footer shortcuts ── */}
      <footer className="flyout-foot">
        <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
        <span><kbd>↵</kbd> paste</span>
        <span><kbd>esc</kbd> close</span>
      </footer>
    </div>
  );
}
