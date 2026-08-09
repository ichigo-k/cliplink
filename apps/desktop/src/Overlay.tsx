import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Laptop, Pin, PinOff, Search, Smartphone, Trash2 } from 'lucide-react';
import { oneLine, timeAgo, type ClipEntry } from './types';

let cached: ReturnType<typeof getCurrentWindow> | null | undefined;
function overlayWindow() {
  if (cached === undefined) {
    try { cached = getCurrentWindow(); }
    catch { cached = null; }
  }
  return cached;
}

export default function Overlay() {
  const [history, setHistory] = useState<ClipEntry[]>([]);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const [thisDevice, setThisDevice] = useState('');
  const [hoveredId, setHoveredId] = useState<string | null>(null);
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
      setHoveredId(null);
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
    const all = q ? history.filter(c => c.text.toLowerCase().includes(q)) : history;
    return all.slice(0, 40);
  }, [history, query]);

  useEffect(() => {
    setCursor(c => Math.min(c, Math.max(0, results.length - 1)));
  }, [results.length]);

  useEffect(() => {
    list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  // ── Actions ──────────────────────────────────────────────────────────────

  const paste = useCallback(async (entry: ClipEntry | undefined) => {
    if (!entry) return;
    // paste_from_overlay: writes clipboard, hides window, then fires Ctrl+V
    await invoke('paste_from_overlay', { text: entry.text }).catch(() => { });
  }, []);

  const togglePin = useCallback(async (e: React.MouseEvent, entry: ClipEntry) => {
    e.stopPropagation();
    const cmd = entry.pinned ? 'unpin_entry' : 'pin_entry';
    await invoke(cmd, { id: entry.id }).catch(() => { });
    refresh();
  }, [refresh]);

  const deleteEntry = useCallback(async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await invoke('delete_entry', { id }).catch(() => { });
    setHistory(prev => prev.filter(c => c.id !== id));
  }, []);

  // ── Keyboard nav ─────────────────────────────────────────────────────────

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); overlayWindow()?.hide(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(c + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); paste(results[cursor]); }
    else if (e.key === 'Delete' && hoveredId) {
      e.preventDefault();
      const entry = results.find(r => r.id === hoveredId);
      if (entry) deleteEntry(e as unknown as React.MouseEvent, hoveredId);
    }
  }

  // ── Grouping ──────────────────────────────────────────────────────────────

  const pinnedItems = results.filter(c => c.pinned);
  const unpinnedItems = results.filter(c => !c.pinned);

  // ── Render ───────────────────────────────────────────────────────────────

  function renderClip(entry: ClipEntry, globalIdx: number) {
    const isActive = globalIdx === cursor;
    const isLocal = entry.origin === thisDevice;
    const isHovered = hoveredId === entry.id;

    return (
      <div
        key={entry.id}
        className={`clip ${isActive ? 'active' : ''} ${entry.pinned ? 'pinned' : ''}`}
        onMouseEnter={() => { setCursor(globalIdx); setHoveredId(entry.id); }}
        onMouseLeave={() => setHoveredId(null)}
        onClick={() => paste(entry)}
        role="button"
        tabIndex={-1}
        title={entry.text}
      >
        {/* Pin indicator stripe */}
        {entry.pinned && <div className="clip-pin-stripe" />}

        <div className="clip-inner">
          <div className="clip-body">
            <span className="clip-text">{oneLine(entry.text, 70)}</span>
            <span className="clip-meta">
              <span className="clip-origin-tag">
                {isLocal ? <Laptop size={9} /> : <Smartphone size={9} />}
                {entry.deviceName}
              </span>
              <i>·</i>
              {timeAgo(entry.receivedAt)}
            </span>
          </div>

          {/* Action buttons — appear on hover */}
          <div className={`clip-actions ${isHovered || isActive ? 'visible' : ''}`}>
            <button
              className={`clip-action-btn ${entry.pinned ? 'pinned' : ''}`}
              onClick={ev => togglePin(ev, entry)}
              title={entry.pinned ? 'Unpin' : 'Pin'}
              tabIndex={-1}
            >
              {entry.pinned ? <PinOff size={11} /> : <Pin size={11} />}
            </button>
            <button
              className="clip-action-btn danger"
              onClick={ev => deleteEntry(ev, entry.id)}
              title="Delete"
              tabIndex={-1}
            >
              <Trash2 size={11} />
            </button>
          </div>
        </div>
      </div>
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
        <Search size={12} />
        <input
          ref={search}
          value={query}
          onChange={e => { setQuery(e.target.value); setCursor(0); }}
          placeholder="Search history…"
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
          /* Flat when searching */
          results.map((entry, i) => renderClip(entry, i))
        ) : (
          <>
            {/* Pinned section */}
            {pinnedItems.length > 0 && (
              <>
                <p className="flyout-section">
                  <Pin size={9} style={{ display: 'inline', marginRight: 4 }} />
                  Pinned
                </p>
                {pinnedItems.map((entry, i) => renderClip(entry, i))}
              </>
            )}

            {/* Recent section */}
            {unpinnedItems.length > 0 && (
              <>
                {pinnedItems.length > 0 && (
                  <p className="flyout-section">Recent</p>
                )}
                {unpinnedItems.map((entry, i) =>
                  renderClip(entry, pinnedItems.length + i)
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* ── Footer ── */}
      <footer className="flyout-foot">
        <span><kbd>↑</kbd><kbd>↓</kbd></span>
        <span><kbd>↵</kbd> paste</span>
        <span><kbd>esc</kbd> close</span>
      </footer>
    </div>
  );
}
