import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Clipboard, Laptop, RefreshCw, Settings, Smartphone } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { oneLine, timeAgo, type ClipEntry, type Pairing, type SettingsView } from './types';

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

/** Builds a Tauri accelerator from a keypress, or null if it is not usable. */
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
  else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Insert', 'Delete'].includes(code))
    key = code;

  // A bare key would be swallowed system-wide, so require a modifier.
  if (!key || mods.length === 0) return null;
  return [...mods, key].join('+');
}

/** Renders "CommandOrControl+Shift+V" as "Ctrl Shift V". */
function prettyKeys(hotkey: string): string[] {
  return hotkey
    .split('+')
    .map(part => (part === 'CommandOrControl' ? 'Ctrl' : part === 'Super' ? 'Win' : part));
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

  const payload = useMemo(() => JSON.stringify({ app: 'ClipLink', version: 1, ...pairing }), [pairing]);
  const secondsLeft = pairing.expiresAt ? pairing.expiresAt - now : 0;
  const expired = pairing.expiresAt > 0 && secondsLeft <= 0;
  const connected = (settings?.pairedDevices.length ?? 0) > 0;

  const refreshPairing = useCallback(() => {
    invoke<Pairing>('create_pairing').then(setPairing).catch(() => {});
  }, []);

  const refreshSettings = useCallback(() => {
    invoke<SettingsView>('get_settings').then(setSettings).catch(() => {});
  }, []);

  useEffect(() => {
    refreshPairing();
    refreshSettings();
    invoke<ClipEntry[]>('get_history').then(setHistory).catch(() => {});

    const stop = listen<ClipEntry>('clip', e => {
      setHistory(prev => [e.payload, ...prev.filter(c => c.id !== e.payload.id)].slice(0, 50));
      refreshSettings();
    });
    const tick = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);

    return () => {
      stop.then(fn => fn());
      clearInterval(tick);
    };
  }, [refreshPairing, refreshSettings]);

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
    } catch {
      /* the backend surfaces its own failure */
    }
  }

  async function captureHotkey(e: React.KeyboardEvent) {
    e.preventDefault();
    const combo = accelerator(e);
    if (!combo) return;

    setRecording(false);
    setHotkeyError('');
    try {
      await invoke('set_hotkey', { hotkey: combo });
      setSettings(s => (s ? { ...s, hotkey: combo } : s));
    } catch (err) {
      setHotkeyError(String(err));
    }
  }

  return (
    <div className="app">
      <nav className="rail">
        <div className="wordmark">
          <img src="/icon.png" alt="" width={22} height={22} />
          ClipLink
        </div>

        <div className="rail-nav">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
              <Icon size={16} />
              {label}
            </button>
          ))}
        </div>

        <div className={`rail-status ${connected ? 'on' : ''}`}>
          <i />
          <div>
            <strong>{connected ? 'Connected' : 'Waiting for a phone'}</strong>
            <span>
              {pairing.host}:{pairing.port}
            </span>
          </div>
        </div>
      </nav>

      <main>
        {tab === 'devices' && (
          <section className="page">
            <header className="page-head">
              <h1>Devices</h1>
              <p>Scan this code in the ClipLink app on your phone. Both devices must share a Wi-Fi network.</p>
            </header>

            <div className="split">
              <div className="panel qr-panel">
                <div className={`qr ${expired ? 'stale' : ''}`}>
                  <QRCodeSVG value={payload} size={188} bgColor="transparent" fgColor="currentColor" />
                </div>
                <div className="qr-foot">
                  <span className="muted">
                    {expired
                      ? 'This code has expired.'
                      : secondsLeft > 0
                        ? `Expires in ${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`
                        : ' '}
                  </span>
                  <button className="btn" onClick={refreshPairing}>
                    <RefreshCw size={14} />
                    New code
                  </button>
                </div>
              </div>

              <div className="panel">
                <h2>Paired</h2>
                {settings?.pairedDevices.length ? (
                  <ul className="rows">
                    {settings.pairedDevices.map(d => (
                      <li key={d.deviceId}>
                        <Smartphone size={15} />
                        <div>
                          <strong>{d.deviceName}</strong>
                          <span className="muted">Paired {timeAgo(d.pairedAt)} ago</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted">No phones yet.</p>
                )}

                <h2 className="spaced">How it works</h2>
                <p className="muted">
                  Anything you copy here reaches your phone automatically. Android blocks background clipboard
                  reads, so going the other way needs a tap on <strong>Send my clipboard</strong> in the app.
                </p>
              </div>
            </div>
          </section>
        )}

        {tab === 'clipboard' && (
          <section className="page">
            <header className="page-head">
              <h1>Clipboard</h1>
              <p>
                Copied on either device, newest first. Press{' '}
                {settings ? prettyKeys(settings.hotkey).map(k => <kbd key={k}>{k}</kbd>) : 'the shortcut'} anywhere
                for the quick panel.
              </p>
            </header>

            {history.length === 0 ? (
              <div className="panel empty">
                <Clipboard size={20} />
                <p>Copy something on this PC or your phone and it will show up here.</p>
              </div>
            ) : (
              <ul className="clips">
                {history.map(entry => (
                  <li key={entry.id}>
                    <button onClick={() => copyBack(entry)}>
                      <span className="clip-text">{oneLine(entry.text, 120)}</span>
                      <span className="clip-meta">
                        {entry.origin === pairing.deviceId ? <Laptop size={12} /> : <Smartphone size={12} />}
                        {entry.deviceName}
                        <i>·</i>
                        {timeAgo(entry.receivedAt)} ago
                        {copied === entry.id && (
                          <em className="copied">
                            <Check size={12} /> copied
                          </em>
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {tab === 'settings' && (
          <section className="page">
            <header className="page-head">
              <h1>Settings</h1>
            </header>

            <div className="panel setting">
              <div>
                <h2>Quick panel shortcut</h2>
                <p className="muted">Opens the compact clipboard panel over whatever you are doing.</p>
              </div>
              <button
                className={`hotkey ${recording ? 'recording' : ''}`}
                onClick={() => {
                  setRecording(true);
                  setHotkeyError('');
                }}
                onBlur={() => setRecording(false)}
                onKeyDown={recording ? captureHotkey : undefined}
              >
                {recording ? (
                  'Press keys…'
                ) : settings ? (
                  prettyKeys(settings.hotkey).map(k => <kbd key={k}>{k}</kbd>)
                ) : (
                  '—'
                )}
              </button>
              {hotkeyError && <p className="error">{hotkeyError}</p>}
              <p className="muted note">Win+K and Win+V belong to Windows and cannot be reassigned.</p>
            </div>

            <div className="panel setting">
              <div>
                <h2>Updates</h2>
                <p className="muted">ClipLink installs signed releases from GitHub.</p>
              </div>
              <button className="btn" onClick={checkUpdate}>
                <RefreshCw size={14} />
                Check now
              </button>
              {update && <p className="muted note">{update}</p>}
            </div>

            <div className="panel setting">
              <div>
                <h2>This device</h2>
                <p className="muted">
                  {settings?.deviceName ?? '—'} · {pairing.host}:{pairing.port}
                </p>
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
