import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Clipboard, Files, History, Keyboard, Laptop, Link2, RefreshCw, Settings, ShieldCheck, Smartphone, Wifi } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

type Pairing = { deviceId: string; deviceName: string; host: string; port: number; nonce: string; publicKey: string; expiresAt: number };
type ClipEntry = { id: string; text: string; origin: string; deviceName: string; receivedAt: number };
type PairedDevice = { deviceId: string; deviceName: string; publicKey: string; pairedAt: number };
type SettingsView = { hotkey: string; deviceName: string; pairedDevices: PairedDevice[] };

/** Shown before the backend answers, so the layout does not jump on first paint. */
const placeholder: Pairing = { deviceId: "", deviceName: "This PC", host: "…", port: 47123, nonce: "", publicKey: "", expiresAt: 0 };

/** Builds a Tauri accelerator from a keypress, or null if it is not a usable shortcut. */
function accelerator(e: React.KeyboardEvent): string | null {
  const mods: string[] = [];
  if (e.ctrlKey) mods.push("CommandOrControl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  if (e.metaKey) mods.push("Super");

  const code = e.code;
  let key = "";
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
  else if (/^Digit[0-9]$/.test(code)) key = code.slice(5);
  else if (/^F[0-9]{1,2}$/.test(code)) key = code;
  else if (code === "Space") key = "Space";
  else if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown", "Insert", "Delete"].includes(code)) key = code;

  // A bare key would swallow that key system-wide, so require a modifier.
  if (!key || mods.length === 0) return null;
  return [...mods, key].join("+");
}

function timeAgo(seconds: number): string {
  const delta = Math.max(0, Math.floor(Date.now() / 1000) - seconds);
  if (delta < 60) return "Just now";
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
  return `${Math.floor(delta / 86400)}d ago`;
}

export default function App() {
  const [pairing, setPairing] = useState(placeholder);
  const [tab, setTab] = useState("pair");
  const [history, setHistory] = useState<ClipEntry[]>([]);
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [update, setUpdate] = useState("");
  const [copied, setCopied] = useState("");
  const [recording, setRecording] = useState(false);
  const [hotkeyError, setHotkeyError] = useState("");
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  const payload = useMemo(() => JSON.stringify({ app: "ClipLink", version: 1, ...pairing }), [pairing]);
  const secondsLeft = pairing.expiresAt ? pairing.expiresAt - now : 0;
  const expired = pairing.expiresAt > 0 && secondsLeft <= 0;

  const refreshPairing = useCallback(() => {
    invoke<Pairing>("create_pairing").then(setPairing).catch(() => {});
  }, []);

  useEffect(() => {
    refreshPairing();
    invoke<ClipEntry[]>("get_history").then(setHistory).catch(() => {});
    invoke<SettingsView>("get_settings").then(setSettings).catch(() => {});

    // The backend pushes every clip, whichever device it came from.
    const stop = listen<ClipEntry>("clip", e => setHistory(prev => [e.payload, ...prev.filter(c => c.id !== e.payload.id)].slice(0, 50)));
    const tick = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);

    return () => { stop.then(fn => fn()); clearInterval(tick); };
  }, [refreshPairing]);

  async function checkUpdate() {
    setUpdate("Checking…");
    try {
      const u = await check();
      if (!u) return setUpdate("You're up to date");
      setUpdate(`Downloading ${u.version}…`);
      await u.downloadAndInstall();
      await relaunch();
    } catch {
      setUpdate("Release feed will activate when ClipLink is published");
    }
  }

  async function copyBack(entry: ClipEntry) {
    try {
      await invoke("copy_to_clipboard", { text: entry.text });
      setCopied(entry.id);
      setTimeout(() => setCopied(""), 1500);
    } catch { /* the backend already surfaced the failure */ }
  }

  async function captureHotkey(e: React.KeyboardEvent) {
    e.preventDefault();
    const combo = accelerator(e);
    if (!combo) return;

    setRecording(false);
    setHotkeyError("");
    try {
      await invoke("set_hotkey", { hotkey: combo });
      setSettings(s => (s ? { ...s, hotkey: combo } : s));
    } catch (err) {
      setHotkeyError(String(err));
    }
  }

  return <div className="shell">
    <aside>
      <div className="brand"><b><Link2 />ClipLink</b><span>Private device bridge</span></div>
      <nav>
        <button className={tab === "pair" ? "active" : ""} onClick={() => setTab("pair")}><Smartphone />Pair device</button>
        <button className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}><History />Clipboard</button>
        <button className={tab === "files" ? "active" : ""} onClick={() => setTab("files")}><Files />Files</button>
        <button className={tab === "settings" ? "active" : ""} onClick={() => setTab("settings")}><Settings />Settings</button>
      </nav>
      <div className="privacy"><ShieldCheck /><div><b>Local & encrypted</b><span>Your data stays on your devices.</span></div></div>
    </aside>

    <main>
      <header>
        <div>
          <small>CLIPLINK DESKTOP</small>
          <h1>{tab === "pair" ? "Connect your phone" : tab === "history" ? "Clipboard history" : tab === "files" ? "File transfer" : "Settings"}</h1>
        </div>
        <label><i />{settings?.pairedDevices.length ? `${settings.pairedDevices.length} device${settings.pairedDevices.length > 1 ? "s" : ""} paired` : "Ready on local Wi-Fi"}</label>
      </header>

      {tab === "pair" && <section className="grid">
        <div className="card">
          <em>1</em>
          <h2>Scan to pair</h2>
          <p>Open ClipLink on Android and scan this code. No account, internet, or cloud required.</p>
          <div className="qr" style={expired ? { opacity: 0.25 } : undefined}><QRCodeSVG value={payload} size={190} /></div>
          <p className="hint">{expired ? "This code expired." : secondsLeft > 0 ? `Expires in ${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}` : ""}</p>
          <button className="action" onClick={refreshPairing}><RefreshCw />Refresh code</button>
        </div>
        <div className="card">
          <em>2</em>
          <h2>Start copying</h2>
          <p>Text copied on this PC appears on your phone automatically. From the phone, use Share → ClipLink.</p>
          <div className="route"><div><Laptop />This PC</div><span>••••••</span><div><Smartphone />Android</div></div>
          <div className="network"><Wifi /><div><b>{pairing.host}:{pairing.port}</b><span>Direct local connection</span></div></div>
        </div>
      </section>}

      {tab === "history" && <section className="card">
        <h2>Recent clipboard</h2>
        {history.length === 0
          ? <p>Nothing yet. Copy something on this PC or your phone and it will appear here.</p>
          : history.map(entry => <article key={entry.id} onClick={() => copyBack(entry)} className="clickable">
              {copied === entry.id ? <Check /> : <Clipboard />}
              <div>
                <b>{entry.text.length > 120 ? `${entry.text.slice(0, 120)}…` : entry.text}</b>
                <span>{entry.deviceName} · {timeAgo(entry.receivedAt)}{copied === entry.id ? " · Copied" : ""}</span>
              </div>
            </article>)}
      </section>}

      {tab === "files" && <section className="card empty">
        <Files />
        <h2>Not built yet</h2>
        <p>File transfer is planned. Clipboard text sync works today.</p>
      </section>}

      {tab === "settings" && <section className="grid">
        <div className="card">
          <em><Keyboard /></em>
          <h2>Show ClipLink</h2>
          <p>Press this shortcut anywhere in Windows to open and hide ClipLink.</p>
          <button className="action hotkey" onClick={() => { setRecording(true); setHotkeyError(""); }} onKeyDown={recording ? captureHotkey : undefined}>
            {recording ? "Press a key combination…" : settings?.hotkey ?? "…"}
          </button>
          {hotkeyError && <p className="error">{hotkeyError}</p>}
          <p className="hint">Win+K and Win+V are reserved by Windows and cannot be used.</p>
        </div>
        <div className="card">
          <em><Smartphone /></em>
          <h2>Paired devices</h2>
          {settings?.pairedDevices.length
            ? settings.pairedDevices.map(d => <article key={d.deviceId}><Smartphone /><div><b>{d.deviceName}</b><span>Paired {timeAgo(d.pairedAt)}</span></div></article>)
            : <p>No devices yet. Scan the pairing code from your phone.</p>}
        </div>
        <div className="card setting">
          <div><h2>Automatic updates</h2><p>Receive signed ClipLink releases.</p></div>
          <button className="action" onClick={checkUpdate}><RefreshCw />Check now</button>
          {update && <p>{update}</p>}
        </div>
      </section>}
    </main>
  </div>;
}
