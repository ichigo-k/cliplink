import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Bell,
  Check,
  Clipboard,
  File,
  HardDrive,
  History,
  Keyboard,
  Laptop,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  Settings,
  Smartphone,
  Trash2,
  Unlink,
  Wifi,
  X,
  ZapOff,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { oneLine, timeAgo, formatBytes, type ClipEntry, type FileReceived, type Pairing, type PairedDevice, type PhoneNotification, type SettingsView } from './types';

const placeholder: Pairing = {
  deviceId: '',
  deviceName: 'This PC',
  host: '—',
  port: 47123,
  nonce: '',
  publicKey: '',
  expiresAt: 0,
};

const TABS = [
  { id: 'devices', label: 'Devices', icon: Smartphone },
  { id: 'clipboard', label: 'Clipboard', icon: Clipboard },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'files', label: 'Files', icon: File },
  { id: 'settings', label: 'Settings', icon: Settings },
] as const;

type PairingPhase = 'idle' | 'scanning' | 'connecting' | 'done';

/** A device counts as online if the backend heard from it in the last two minutes. */
function isOnline(d: PairedDevice, now: number): boolean {
  return typeof d.lastSeen === 'number' && now - d.lastSeen < 120;
}

function accelerator(e: React.KeyboardEvent): string | null {
  const mods: string[] = [];
  if (e.ctrlKey) mods.push('CommandOrControl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (e.metaKey) mods.push('Super');
  const code = e.code;
  let key = '';
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
  else if (/^Digit[0-9]$/.test(code)) key = code.slice(5);
  else if (/^F[0-9]{1,2}$/.test(code)) key = code;
  else if (code === 'Space') key = 'Space';
  else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Insert', 'Delete'].includes(code)) key = code;
  if (!key || mods.length === 0) return null;
  return [...mods, key].join('+');
}

function prettyKeys(hotkey: string): string[] {
  return hotkey.split('+').map(p =>
    p === 'CommandOrControl' ? 'Ctrl' : p === 'Super' ? 'Win' : p,
  );
}

export default function App() {
  const [pairing, setPairing] = useState(placeholder);
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('devices');
  const [history, setHistory] = useState<ClipEntry[]>([]);
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [update, setUpdate] = useState('');
  const [copied, setCopied] = useState('');
  const [recording, setRecording] = useState(false);
  const [hotkeyError, setHotkeyError] = useState('');
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirmUnpair, setConfirmUnpair] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<PhoneNotification[]>([]);
  const [filesReceived, setFilesReceived] = useState<FileReceived[]>([]);

  // Pairing flow state
  const [pairingPhase, setPairingPhase] = useState<PairingPhase>('idle');
  const [justPaired, setJustPaired] = useState<PairedDevice | null>(null);
  const [progress, setProgress] = useState(0);

  const payload = useMemo(() => JSON.stringify({ app: 'ClipLink', version: 1, ...pairing }), [pairing]);
  const secondsLeft = pairing.expiresAt ? pairing.expiresAt - now : 0;
  const expired = pairing.expiresAt > 0 && secondsLeft <= 0;
  const connected = (settings?.pairedDevices.length ?? 0) > 0;

  const refreshPairing = useCallback(() => { invoke<Pairing>('create_pairing').then(setPairing).catch(() => { }); }, []);
  const refreshSettings = useCallback(() => { invoke<SettingsView>('get_settings').then(setSettings).catch(() => { }); }, []);

  useEffect(() => { if (expired) refreshPairing(); }, [expired, refreshPairing]);

  useEffect(() => {
    refreshPairing();
    refreshSettings();
    invoke<ClipEntry[]>('get_history').then(setHistory).catch(() => { });

    const stopClip = listen<ClipEntry>('clip', e => {
      setHistory(prev => [e.payload, ...prev.filter(c => c.id !== e.payload.id)].slice(0, 50));
      refreshSettings();
    });

    const stopPaired = listen<PairedDevice>('device_paired', e => {
      refreshSettings();
      setJustPaired(e.payload);
      setProgress(100);
      setPairingPhase('done');
      setTimeout(() => {
        setPairingPhase('idle');
        setJustPaired(null);
        setProgress(0);
      }, 2500);
    });

    // Refresh when a device is unpaired or renamed from settings
    const stopUnpaired = listen<string>('device_unpaired', () => refreshSettings());
    const stopChanged = listen<void>('settings_changed', () => refreshSettings());

    // Phone notifications mirrored to PC
    const stopNotif = listen<PhoneNotification>('phone_notification', e => {
      setNotifications(prev => {
        // Deduplicate by key
        const filtered = prev.filter(n => n.key !== e.payload.key);
        return [e.payload, ...filtered].slice(0, 50);
      });
    });

    // Files received from phone
    const stopFile = listen<FileReceived>('file_received', e => {
      setFilesReceived(prev => [e.payload, ...prev].slice(0, 20));
    });

    const tick = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);

    return () => {
      stopClip.then(fn => fn());
      stopPaired.then(fn => fn());
      stopUnpaired.then(fn => fn());
      stopChanged.then(fn => fn());
      stopNotif.then(fn => fn());
      stopFile.then(fn => fn());
      clearInterval(tick);
    };
  }, [refreshPairing, refreshSettings]);

  // Animate a slow crawl to ~80% while in scanning/connecting phase
  useEffect(() => {
    if (pairingPhase !== 'scanning' && pairingPhase !== 'connecting') return;
    setProgress(0);
    const interval = setInterval(() => {
      setProgress(p => {
        if (p >= 78) { clearInterval(interval); return 78; }
        return p + 1.5;
      });
    }, 80);
    return () => clearInterval(interval);
  }, [pairingPhase]);

  function openPairingScreen() {
    refreshPairing();
    setProgress(0);
    setPairingPhase('scanning');
  }

  function closePairingScreen() {
    setPairingPhase('idle');
    setProgress(0);
  }

  async function checkUpdate() {
    setUpdate('Checking…');
    try {
      const u = await check();
      if (!u) return setUpdate('ClipLink is up to date.');
      setUpdate(`Downloading ${u.version}…`);
      await u.downloadAndInstall();
      await relaunch();
    } catch (e) {
      setUpdate(`Could not reach the update server. ${String(e)}`);
    }
  }

  async function copyBack(entry: ClipEntry) {
    try {
      await invoke('copy_to_clipboard', { text: entry.text });
      setCopied(entry.id);
      setTimeout(() => setCopied(''), 1400);
    } catch { /* backend surfaces its own failure */ }
  }

  async function captureHotkey(e: React.KeyboardEvent) {
    e.preventDefault();
    const combo = accelerator(e);
    if (!combo) return;
    setRecording(false);
    setHotkeyError('');
    try {
      await invoke('set_hotkey', { hotkey: combo });
      setSettings(s => s ? { ...s, hotkey: combo } : s);
    } catch (err) {
      setHotkeyError(String(err));
    }
  }

  // ─── New feature commands ────────────────────────────────────────────────

  async function toggleStartup(enabled: boolean) {
    try {
      await invoke('set_launch_at_startup', { enabled });
      setSettings(s => s ? { ...s, launchAtStartup: enabled } : s);
    } catch { /* silently ignore */ }
  }

  async function changeHistoryLimit(limit: number) {
    try {
      await invoke('set_history_limit', { limit });
      setSettings(s => s ? { ...s, historyLimit: limit } : s);
      setHistory(h => h.slice(0, limit));
    } catch { /* silently ignore */ }
  }

  async function doClearHistory() {
    try {
      await invoke('clear_history');
      setHistory([]);
    } catch { /* silently ignore */ }
  }

  async function dismissPhoneNotification(key: string) {
    try {
      await invoke('dismiss_phone_notification', { key });
      setNotifications(prev => prev.filter(n => n.key !== key));
    } catch { /* silently ignore */ }
  }

  async function doUnpairDevice(deviceId: string) {
    try {
      await invoke('unpair_device', { deviceId });
      refreshSettings();
    } catch { /* silently ignore */ }
  }

  function startRename(d: PairedDevice) {
    setConfirmUnpair(null);
    setRenamingId(d.deviceId);
    setRenameValue(d.deviceName);
  }

  async function doRenameDevice(deviceId: string) {
    const trimmed = renameValue.trim();
    if (!trimmed) { setRenamingId(null); return; }
    try {
      await invoke('rename_device', { deviceId, name: trimmed });
      setRenamingId(null);
      refreshSettings();
    } catch { /* silently ignore */ }
  }

  // ─── Pairing overlay ─────────────────────────────────────────────────────
  const showPairingModal = pairingPhase !== 'idle';

  return (
    <>
      <div className="backdrop" aria-hidden="true" />
      <div className="app">

        {/* ── Sidebar rail ── */}
        <nav className="rail">
          <div className="wordmark">
            <img src="/icon.png" alt="" width={22} height={22} />
            ClipLink
          </div>

          <div className="rail-nav">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                className={tab === id ? 'active' : ''}
                onClick={() => { setTab(id); if (id !== 'devices') closePairingScreen(); }}
                aria-current={tab === id ? 'page' : undefined}
              >
                <Icon size={15} />
                {label}
              </button>
            ))}
          </div>

          <div className={`rail-status ${connected ? 'on' : ''}`}>
            <i aria-hidden="true" />
            <div>
              <strong>{connected ? 'Connected' : 'Waiting for phone'}</strong>
              <span>{pairing.host}:{pairing.port}</span>
            </div>
          </div>
        </nav>

        {/* ── Main content ── */}
        <main>

          {/* ════ PAIRING MODAL ════ */}
          {tab === 'devices' && showPairingModal && (
            <div className="pairing-modal" aria-modal="true">

              {/* Back button — hidden when done */}
              {pairingPhase !== 'done' && (
                <button className="pairing-back" onClick={closePairingScreen}>
                  <ArrowLeft size={16} />
                  Back
                </button>
              )}

              {pairingPhase === 'done' ? (
                /* ── Success state ── */
                <div className="pairing-success">
                  <div className="pairing-success-icon">
                    <Check size={32} strokeWidth={2.5} />
                  </div>
                  <h2 className="pairing-success-title">Device connected!</h2>
                  <p className="pairing-success-sub">
                    {justPaired?.deviceName ?? 'Your phone'} is now linked.
                  </p>
                </div>
              ) : (
                /* ── QR + progress state ── */
                <div className="pairing-content">
                  <p className="pairing-label">
                    {pairingPhase === 'connecting' ? 'Connecting…' : 'Scan with the ClipLink app'}
                  </p>

                  {/* QR code */}
                  <div className={`pairing-qr ${expired ? 'stale' : ''}`}>
                    <QRCodeSVG value={payload} size={220} bgColor="#ffffff" fgColor="#0b0f0d" level="M" />
                  </div>

                  <div className="pairing-timer">
                    {expired
                      ? <span className="pairing-expired">Code expired —</span>
                      : secondsLeft > 0
                        ? `Expires in ${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`
                        : '\u00a0'}
                    {expired && (
                      <button className="pairing-refresh-btn" onClick={refreshPairing}>
                        <RefreshCw size={12} /> Refresh
                      </button>
                    )}
                  </div>

                  {/* Progress bar */}
                  <div className="pairing-progress-wrap" aria-label={`Connection progress ${Math.round(progress)}%`}>
                    <div className="pairing-progress-track">
                      <div
                        className="pairing-progress-fill"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <span className="pairing-progress-label">
                      {progress < 5 ? 'Waiting for scan…' : progress < 78 ? 'Waiting for phone…' : 'Almost there…'}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ════ DEVICES TAB — empty state (centred, full area) ════ */}
          {tab === 'devices' && !showPairingModal && !settings?.pairedDevices.length && (
            <div className="devices-empty">
              <div className="devices-empty-art">
                <div className="devices-empty-pc"><Laptop size={28} /></div>
                <div className="devices-empty-line" />
                <div className="devices-empty-phone"><Smartphone size={28} /></div>
              </div>
              <h2 className="devices-empty-title">No devices yet</h2>
              <p className="devices-empty-sub">
                Link your Android phone to share clipboard content instantly over Wi-Fi.
              </p>
              <button className="btn btn-primary devices-empty-cta" onClick={openPairingScreen}>
                <Smartphone size={15} />
                Connect a device
              </button>
            </div>
          )}

          {/* ════ DEVICES TAB — device list ════ */}
          {tab === 'devices' && !showPairingModal && !!settings?.pairedDevices.length && (
            <section className="page">
              <header className="page-head page-head-row">
                <div>
                  <h1>Devices</h1>
                  <p>
                    {settings.pairedDevices.length} paired ·{' '}
                    {settings.pairedDevices.filter(d => isOnline(d, now)).length} online
                  </p>
                </div>
                <button className="btn btn-primary" onClick={openPairingScreen}>
                  <Plus size={14} />
                  Pair device
                </button>
              </header>

              <ul className="dev-list">
                {settings.pairedDevices.map(d => {
                  const online = isOnline(d, now);
                  const renaming = renamingId === d.deviceId;
                  const confirming = confirmUnpair === d.deviceId;

                  return (
                    <li key={d.deviceId} className={`dev-row ${online ? 'online' : ''}`}>
                      <span className="dev-dot" title={online ? 'Online' : 'Offline'} />

                      <span className="dev-glyph">
                        <Smartphone size={17} />
                      </span>

                      <div className="dev-main">
                        {renaming ? (
                          <input
                            className="dev-rename"
                            value={renameValue}
                            autoFocus
                            maxLength={40}
                            aria-label="Device name"
                            onChange={e => setRenameValue(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') doRenameDevice(d.deviceId);
                              if (e.key === 'Escape') setRenamingId(null);
                            }}
                            onBlur={() => doRenameDevice(d.deviceId)}
                          />
                        ) : (
                          <button
                            className="dev-name"
                            title="Double-click to rename"
                            onDoubleClick={() => startRename(d)}
                          >
                            {d.deviceName}
                          </button>
                        )}

                        <span className="dev-meta">
                          <em className={online ? 'is-on' : ''}>
                            {online ? 'Online' : d.lastSeen ? `Last seen ${timeAgo(d.lastSeen)} ago` : 'Never connected'}
                          </em>
                          <i>·</i>
                          <span className="mono">{d.lastHost ?? 'address unknown'}</span>
                          <i>·</i>
                          paired {timeAgo(d.pairedAt)} ago
                        </span>
                      </div>

                      {confirming ? (
                        <div className="dev-confirm">
                          <span>Disconnect?</span>
                          <button
                            className="btn btn-danger"
                            onClick={() => { doUnpairDevice(d.deviceId); setConfirmUnpair(null); }}
                          >
                            Disconnect
                          </button>
                          <button className="btn" onClick={() => setConfirmUnpair(null)}>
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="dev-actions">
                          <button
                            className="icon-btn"
                            onClick={() => startRename(d)}
                            title="Rename device"
                            aria-label={`Rename ${d.deviceName}`}
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            className="icon-btn danger"
                            onClick={() => setConfirmUnpair(d.deviceId)}
                            title="Disconnect device"
                            aria-label={`Disconnect ${d.deviceName}`}
                          >
                            <Unlink size={13} />
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>

              <p className="dev-hint">
                Double-click a name to rename it. Disconnecting forgets the device&apos;s key —
                you&apos;ll need to scan a new code to pair it again.
              </p>
            </section>
          )}

          {/* ════ CLIPBOARD TAB ════ */}
          {tab === 'clipboard' && (
            <section className="page">
              <header className="page-head">
                <h1>Clipboard history</h1>
                <p>
                  Copied on either device, newest first. Press{' '}
                  {settings
                    ? prettyKeys(settings.hotkey).map(k => <kbd key={k}>{k}</kbd>)
                    : 'the shortcut'}{' '}
                  anywhere for the quick overlay.
                </p>
              </header>

              {history.length === 0 ? (
                <div className="empty">
                  <Clipboard size={22} />
                  <p>Copy something on this PC or your phone and it will appear here.</p>
                </div>
              ) : (
                <ul className="clips">
                  {history.map(entry => (
                    <li key={entry.id}>
                      <button onClick={() => copyBack(entry)}>
                        <span className="clip-text">{oneLine(entry.text, 120)}</span>
                        <span className="clip-meta">
                          {entry.origin === pairing.deviceId
                            ? <Laptop size={11} />
                            : <Smartphone size={11} />}
                          {entry.deviceName}
                          <i>·</i>
                          {timeAgo(entry.receivedAt)} ago
                          {copied === entry.id && (
                            <em className="copied"><Check size={11} /> Copied</em>
                          )}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {/* ════ NOTIFICATIONS TAB ════ */}
          {tab === 'notifications' && (
            <section className="page">
              <header className="page-head page-head-row">
                <div>
                  <h1>Notifications</h1>
                  <p>Mirrored from your phone in real time.</p>
                </div>
                {notifications.length > 0 && (
                  <button className="btn" onClick={() => setNotifications([])}>
                    <Trash2 size={13} /> Clear all
                  </button>
                )}
              </header>

              {notifications.length === 0 ? (
                <div className="empty">
                  <Bell size={22} />
                  <p>Notifications from your phone will appear here once the app is granted Notification access.</p>
                </div>
              ) : (
                <ul className="clips notif-list">
                  {notifications.map(n => (
                    <li key={n.key} className="notif-row">
                      <div className="notif-body">
                        <span className="notif-app">{n.appName}</span>
                        <span className="notif-title">{n.title}</span>
                        {n.text && <span className="notif-text">{n.text}</span>}
                        <span className="notif-time">{timeAgo(Math.floor(n.postedAt / 1000))} ago</span>
                      </div>
                      <button
                        className="icon-btn"
                        title="Dismiss on phone"
                        onClick={() => dismissPhoneNotification(n.key)}
                        aria-label="Dismiss notification on phone"
                      >
                        <X size={13} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {/* ════ FILES TAB ════ */}
          {tab === 'files' && (
            <section className="page">
              <header className="page-head page-head-row">
                <div>
                  <h1>Files</h1>
                  <p>Files received from your phone are saved to your Downloads folder.</p>
                </div>
                {filesReceived.length > 0 && (
                  <button className="btn" onClick={() => setFilesReceived([])}>
                    <Trash2 size={13} /> Clear list
                  </button>
                )}
              </header>

              {filesReceived.length === 0 ? (
                <div className="empty">
                  <File size={22} />
                  <p>Files sent from your phone will appear here. Use the ClipLink app to send files.</p>
                </div>
              ) : (
                <ul className="clips">
                  {filesReceived.map((f, i) => (
                    <li key={i}>
                      <button onClick={() => invoke('open_path', { path: f.path }).catch(() => { })}>
                        <span className="clip-text">
                          <File size={13} style={{ display: 'inline', marginRight: 6 }} />
                          {f.fileName}
                        </span>
                        <span className="clip-meta">
                          <Smartphone size={11} />
                          {f.deviceName}
                          <i>·</i>
                          {formatBytes(f.size)}
                          <i>·</i>
                          {f.mimeType}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {/* ════ SETTINGS TAB ════ */}
          {tab === 'settings' && (
            <section className="page">
              <header className="page-head">
                <h1>Settings</h1>
              </header>

              {/* Launch at startup */}
              <div className="panel setting">
                <div>
                  <h2 className="setting-label">
                    <Power size={14} />
                    Launch at startup
                  </h2>
                  <p className="muted" style={{ fontSize: 13 }}>
                    Start ClipLink automatically when Windows boots.
                  </p>
                </div>
                <button
                  className={`toggle ${settings?.launchAtStartup ? 'on' : ''}`}
                  onClick={() => toggleStartup(!settings?.launchAtStartup)}
                  aria-pressed={settings?.launchAtStartup}
                  aria-label="Toggle launch at startup"
                >
                  <span className="toggle-thumb" />
                </button>
              </div>

              {/* Hotkey */}
              <div className="panel setting">
                <div>
                  <h2 className="setting-label">
                    <Keyboard size={14} />
                    Quick panel shortcut
                  </h2>
                  <p className="muted" style={{ fontSize: 13 }}>
                    Opens the compact overlay over whatever you are doing.
                  </p>
                </div>
                <button
                  className={`hotkey ${recording ? 'recording' : ''}`}
                  onClick={() => { setRecording(true); setHotkeyError(''); }}
                  onBlur={() => setRecording(false)}
                  onKeyDown={recording ? captureHotkey : undefined}
                  aria-label="Hotkey picker"
                >
                  {recording
                    ? 'Press keys…'
                    : settings
                      ? prettyKeys(settings.hotkey).map(k => <kbd key={k}>{k}</kbd>)
                      : '—'}
                </button>
                {hotkeyError && <p className="error">{hotkeyError}</p>}
                <p className="muted note">Win+K and Win+V are reserved by Windows.</p>
              </div>

              {/* History limit */}
              <div className="panel setting setting-col">
                <div className="setting-row-top">
                  <div>
                    <h2 className="setting-label">
                      <History size={14} />
                      Clipboard history size
                    </h2>
                    <p className="muted" style={{ fontSize: 13 }}>
                      How many items to keep. Current:{' '}
                      <strong style={{ color: 'var(--text)' }}>{settings?.historyLimit ?? 50}</strong>
                    </p>
                  </div>
                  <button
                    className="btn"
                    onClick={doClearHistory}
                    title="Clear all clipboard history"
                  >
                    <Trash2 size={13} />
                    Clear history
                  </button>
                </div>
                <input
                  type="range"
                  className="range-slider"
                  min={10} max={500} step={10}
                  value={settings?.historyLimit ?? 50}
                  onChange={e => changeHistoryLimit(Number(e.target.value))}
                  aria-label="History limit"
                />
                <div className="range-labels">
                  <span>10</span><span>100</span><span>200</span><span>500</span>
                </div>
              </div>

              {/* Updates */}
              <div className="panel setting">
                <div>
                  <h2 className="setting-label">
                    <RefreshCw size={14} />
                    Updates
                  </h2>
                  <p className="muted" style={{ fontSize: 13 }}>
                    ClipLink installs signed releases from GitHub automatically.
                  </p>
                </div>
                <button className="btn" onClick={checkUpdate}>
                  <RefreshCw size={13} />
                  Check now
                </button>
                {update && <p className="muted note">{update}</p>}
              </div>

              {/* This device */}
              <div className="panel setting">
                <div>
                  <h2 className="setting-label">
                    <HardDrive size={14} />
                    This device
                  </h2>
                  <p className="muted" style={{ fontSize: 13 }}>{settings?.deviceName ?? '—'}</p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: 'var(--text-2)' }}>
                  {connected ? <Wifi size={13} /> : <ZapOff size={13} />}
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                    {pairing.host}:{pairing.port}
                  </span>
                </div>
              </div>

              {/* Devices are managed on the Devices page, not buried in here. */}
              {!!settings?.pairedDevices.length && (
                <div className="panel setting">
                  <div>
                    <h2 className="setting-label">
                      <Smartphone size={14} />
                      Paired devices
                    </h2>
                    <p className="muted" style={{ fontSize: 13 }}>
                      {settings.pairedDevices.length} device
                      {settings.pairedDevices.length === 1 ? '' : 's'} · rename or disconnect them
                      on the Devices page.
                    </p>
                  </div>
                  <button className="btn" onClick={() => setTab('devices')}>
                    <Smartphone size={13} />
                    Open Devices
                  </button>
                </div>
              )}
            </section>
          )}

        </main>
      </div>
    </>
  );
}
