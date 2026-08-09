import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Clipboard,
  HardDrive,
  Keyboard,
  Laptop,
  RefreshCw,
  Settings,
  Smartphone,
  Wifi,
  ZapOff,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { oneLine, timeAgo, type ClipEntry, type Pairing, type PairedDevice, type SettingsView } from './types';

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
  { id: 'settings', label: 'Settings', icon: Settings },
] as const;

type PairingPhase = 'idle' | 'scanning' | 'connecting' | 'done';

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

  // Pairing flow state
  const [pairingPhase, setPairingPhase] = useState<PairingPhase>('idle');
  const [justPaired, setJustPaired] = useState<PairedDevice | null>(null);
  // Fake progress: we animate 0→80% while waiting, then jump to 100% on device_paired
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

    // ← the fix: listen for the pairing event the backend now emits
    const stopPaired = listen<PairedDevice>('device_paired', e => {
      refreshSettings();
      setJustPaired(e.payload);
      setProgress(100);
      setPairingPhase('done');
      // Auto-dismiss back to normal view after 2.5 s
      setTimeout(() => {
        setPairingPhase('idle');
        setJustPaired(null);
        setProgress(0);
      }, 2500);
    });

    const tick = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);

    return () => {
      stopClip.then(fn => fn());
      stopPaired.then(fn => fn());
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

  // ─── Pairing overlay (fullscreen modal over devices tab) ─────────────────
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
              <header className="page-head">
                <h1>Devices</h1>
              </header>
              <ul className="device-list">
                {settings.pairedDevices.map(d => (
                  <li key={d.deviceId} className="device-card">
                    <div className="device-icon">
                      <Smartphone size={20} />
                    </div>
                    <div className="device-info">
                      <strong>{d.deviceName}</strong>
                      <span>Paired {timeAgo(d.pairedAt)} ago</span>
                    </div>
                    <div className="device-badge on">
                      <i />
                      Connected
                    </div>
                  </li>
                ))}
              </ul>
              <div className="device-connect-row">
                <button className="btn btn-primary" onClick={openPairingScreen}>
                  <Smartphone size={14} />
                  Connect another device
                </button>
              </div>
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

          {/* ════ SETTINGS TAB ════ */}
          {tab === 'settings' && (
            <section className="page">
              <header className="page-head">
                <h1>Settings</h1>
              </header>

              {/* Hotkey */}
              <div className="panel setting">
                <div>
                  <h2 style={{ fontSize: 14, textTransform: 'none', letterSpacing: 0, color: 'var(--text)' }}>
                    <Keyboard size={14} style={{ marginRight: 7, verticalAlign: 'middle', opacity: 0.7 }} />
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

              {/* Updates */}
              <div className="panel setting">
                <div>
                  <h2 style={{ fontSize: 14, textTransform: 'none', letterSpacing: 0, color: 'var(--text)' }}>
                    <RefreshCw size={14} style={{ marginRight: 7, verticalAlign: 'middle', opacity: 0.7 }} />
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

              {/* Device info */}
              <div className="panel setting">
                <div>
                  <h2 style={{ fontSize: 14, textTransform: 'none', letterSpacing: 0, color: 'var(--text)' }}>
                    <HardDrive size={14} style={{ marginRight: 7, verticalAlign: 'middle', opacity: 0.7 }} />
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
            </section>
          )}

        </main>
      </div>
    </>
  );
}
