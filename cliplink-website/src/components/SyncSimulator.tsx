"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import {
  Monitor,
  Send,
  Copy,
  Check,
  Wifi,
  Lock,
  ArrowRight,
  ArrowLeft,
  Bell,
  Image,
  FileText,
} from "lucide-react";
import SectionHeader from "./SectionHeader";

if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger);
}

type Origin = "pc" | "phone" | "local";
type ClipKind = "text" | "image" | "file" | "notification";

interface Clip {
  id: string;
  text: string;
  kind: ClipKind;
  time: string;
  origin: Origin;
}

const now = () =>
  new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

const KIND_ICON: Record<ClipKind, React.ElementType> = {
  text: FileText,
  image: Image,
  file: FileText,
  notification: Bell,
};

const PHONE_TABS = [
  { id: "text", label: "Text", icon: FileText },
  { id: "image", label: "Image", icon: Image },
  { id: "notification", label: "Notif", icon: Bell },
] as const;

type PhoneTab = (typeof PHONE_TABS)[number]["id"];

const NOTIF_SAMPLES = [
  { app: "WhatsApp", title: "Jamie", text: "hey, free tonight?" },
  { app: "Gmail", title: "GitHub", text: "Your PR was merged." },
  { app: "Slack", title: "#general", text: "Daily standup in 5 min" },
];

export default function SyncSimulator() {
  const [pcText, setPcText] = useState("https://github.com/ichigo-k/cliplink");
  const [phoneText, setPhoneText] = useState("otp: 448 201");
  const [autoWatch, setAutoWatch] = useState(true);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [clips, setClips] = useState<Clip[]>([
    { id: "seed", text: "pairing token verified", kind: "text", time: "12:00:04", origin: "local" },
  ]);
  const [pcInbox, setPcInbox] = useState<Clip | null>(null);
  const [phoneTab, setPhoneTab] = useState<PhoneTab>("text");
  const [notifIdx, setNotifIdx] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const packetRef = useRef<HTMLDivElement>(null);
  const pcRef = useRef<HTMLDivElement>(null);
  const phoneRef = useRef<HTMLDivElement>(null);
  const lastSentRef = useRef(pcText);

  const fly = useCallback(
    (from: HTMLElement | null, to: HTMLElement | null, land: () => void) => {
      const box = containerRef.current?.getBoundingClientRect();
      const a = from?.getBoundingClientRect();
      const b = to?.getBoundingClientRect();
      if (!box || !a || !b) { land(); return; }

      const start = { x: a.left + a.width / 2 - box.left, y: a.top + 60 - box.top };
      const end = { x: b.left + b.width / 2 - box.left, y: b.top + 60 - box.top };

      gsap.set(packetRef.current, {
        x: start.x, y: start.y, xPercent: -50, yPercent: -50,
        opacity: 1, scale: 0.7, display: "flex",
      });

      gsap.timeline({
        onComplete: () => {
          gsap.set(packetRef.current, { display: "none", opacity: 0 });
          land();
        },
      })
        .to(packetRef.current, { x: (start.x + end.x) / 2, y: Math.min(start.y, end.y) - 56, scale: 1.05, duration: 0.38, ease: "power2.out" })
        .to(packetRef.current, { x: end.x, y: end.y, scale: 0.7, duration: 0.38, ease: "power2.in" });
    },
    []
  );

  const pulse = (el: HTMLElement | null) => {
    if (!el) return;
    gsap.fromTo(
      el,
      { boxShadow: "0 0 0 1px rgba(0,217,124,0.9), 0 0 40px rgba(0,217,124,0.25)" },
      { boxShadow: "0 0 0 1px rgba(0,217,124,0), 0 0 0 rgba(0,217,124,0)", duration: 1.1 }
    );
  };

  const pushToPhone = useCallback(
    (text: string, kind: ClipKind = "text") => {
      if (busy || !text.trim()) return;
      setBusy(true);
      lastSentRef.current = text;
      fly(pcRef.current, phoneRef.current, () => {
        setClips((prev) => [{ id: `${Date.now()}`, text, kind, time: now(), origin: "pc" } satisfies Clip, ...prev].slice(0, 12));
        pulse(phoneRef.current);
        setBusy(false);
      });
    },
    [busy, fly]
  );

  const pushToPc = (text: string, kind: ClipKind = "text") => {
    if (busy || !text.trim()) return;
    setBusy(true);
    fly(phoneRef.current, pcRef.current, () => {
      lastSentRef.current = text;
      setPcText(kind === "text" ? text : pcText);
      setPcInbox({ id: `${Date.now()}`, text, kind, time: now(), origin: "phone" });
      setClips((prev) => [{ id: `${Date.now()}`, text, kind, time: now(), origin: "phone" } satisfies Clip, ...prev].slice(0, 12));
      pulse(pcRef.current);
      setBusy(false);
    });
  };

  useEffect(() => {
    const ctx = gsap.context(() => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      gsap.from(pcRef.current, { opacity: 0, xPercent: -6, rotateY: 8, duration: 1, ease: "expo.out", scrollTrigger: { trigger: containerRef.current, start: "top 82%" } });
      gsap.from(phoneRef.current, { opacity: 0, xPercent: 6, rotateY: -8, duration: 1, delay: 0.08, ease: "expo.out", scrollTrigger: { trigger: containerRef.current, start: "top 82%" } });
      gsap.to(phoneRef.current, { yPercent: -7, ease: "none", scrollTrigger: { trigger: containerRef.current, start: "top bottom", end: "bottom top", scrub: 0.7 } });
    }, containerRef);
    return () => ctx.revert();
  }, []);

  useEffect(() => {
    if (!autoWatch) return;
    const t = setTimeout(() => {
      if (pcText.trim() && pcText !== lastSentRef.current && !busy) pushToPhone(pcText, "text");
    }, 900);
    return () => clearTimeout(t);
  }, [pcText, autoWatch, busy, pushToPhone]);

  const copy = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied((c) => (c === id ? null : c)), 1400);
    } catch { /* blocked in demo */ }
  };

  const notif = NOTIF_SAMPLES[notifIdx];

  return (
    <section id="simulator" className="scroll-mt-20 py-16 sm:py-24 lg:py-32">
      <div className="shell">
        <SectionHeader
          index="02"
          label="See it move"
          title={
            <>
              Watch a clip cross the wire,
              <br className="hidden sm:block" /> right here in the page.
            </>
          }
          blurb="Type in the PC panel. The watcher pushes it to the phone automatically."
        />

        <div ref={containerRef} className="relative mt-10 grid gap-5 sm:mt-16 sm:gap-6 lg:grid-cols-[1fr_auto_360px] lg:items-stretch">

          {/* packet in flight */}
          <div ref={packetRef} className="pointer-events-none absolute z-30 hidden h-11 w-11 items-center justify-center rounded-xl bg-signal-500 text-canvas shadow-[0_0_30px_rgba(0,217,124,0.45)]">
            <Lock className="h-4 w-4" />
          </div>

          {/* ── Desktop ── */}
          <div ref={pcRef} className="grain flex flex-col overflow-hidden rounded-xl border hairline bg-ink-950">
            <div className="flex items-center justify-between border-b hairline bg-ink-900/60 px-4 py-3">
              <div className="flex items-center gap-2.5">
                <Monitor className="h-3.5 w-3.5 text-ink-400" />
                <span className="eyebrow text-ink-300">DESKTOP-PRO-X</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-signal-400 animate-blink" />
                <span className="eyebrow text-signal-400">listening :47123</span>
              </div>
            </div>

            <div className="flex flex-1 flex-col gap-4 p-5">
              <div className="flex items-center justify-between">
                <label htmlFor="pc-clip" className="eyebrow text-ink-500">system clipboard</label>
                <button onClick={() => setAutoWatch((v) => !v)} className="group flex items-center gap-2 cursor-pointer" aria-pressed={autoWatch}>
                  <span className="eyebrow text-ink-500 group-hover:text-ink-300">watcher</span>
                  <span className={`relative h-4 w-7 rounded-full transition-colors ${autoWatch ? "bg-signal-500" : "bg-ink-700"}`}>
                    <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-canvas transition-transform ${autoWatch ? "translate-x-3.5" : "translate-x-0.5"}`} />
                  </span>
                </button>
              </div>

              <textarea
                id="pc-clip"
                value={pcText}
                onChange={(e) => setPcText(e.target.value)}
                spellCheck={false}
                placeholder="Copy something…"
                className="min-h-[150px] flex-1 resize-none rounded-lg border hairline bg-canvas p-4 font-mono text-[13px] leading-relaxed text-ink-100 placeholder-ink-600 transition-colors focus:border-signal-500/60 focus:outline-none"
              />

              {pcInbox && (
                <div className="flex items-start gap-2.5 rounded-lg border border-signal-500/25 bg-signal-950/40 p-3">
                  <ArrowLeft className="mt-0.5 h-3.5 w-3.5 shrink-0 text-signal-400" />
                  <div className="min-w-0">
                    <p className="eyebrow text-signal-400">
                      {pcInbox.kind === "notification" ? "notification from phone" :
                        pcInbox.kind === "image" ? "image from phone" :
                          "received from phone"}
                    </p>
                    <p className="mt-1.5 break-all font-mono text-[12px] text-ink-200">{pcInbox.text}</p>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between border-t hairline pt-4">
                <span className="font-mono text-[11px] text-ink-500">{pcText.length} bytes · sampled every 500ms</span>
                <button
                  onClick={() => pushToPhone(pcText, "text")}
                  disabled={busy}
                  className="inline-flex items-center gap-2 rounded-md bg-signal-500 px-4 py-2 text-[13px] font-semibold text-canvas transition-colors hover:bg-signal-400 disabled:opacity-40 cursor-pointer"
                >
                  Push to phone <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>

          {/* ── Wire ── */}
          <div className="hidden flex-col items-center justify-center gap-3 px-2 lg:flex">
            <span className="w-px flex-1 bg-gradient-to-b from-transparent to-signal-500/30" />
            <div className="relative grid h-10 w-10 place-items-center rounded-full border hairline bg-ink-950">
              <Lock className="h-3.5 w-3.5 text-signal-400" />
              {busy && <span className="absolute inset-0 rounded-full border border-signal-500/60 animate-ping" />}
            </div>
            <span className="eyebrow rotate-180 text-ink-600 [writing-mode:vertical-rl]">e2e encrypted</span>
            <span className="w-px flex-1 bg-gradient-to-t from-transparent to-signal-500/30" />
          </div>

          {/* ── Phone ── */}
          <div ref={phoneRef} className="grain mx-auto flex w-full max-w-[360px] flex-col overflow-hidden rounded-[26px] border hairline bg-ink-950 p-2 lg:max-w-none">
            <div className="flex flex-1 flex-col overflow-hidden rounded-[19px] border hairline bg-canvas">
              {/* status bar */}
              <div className="relative flex items-center justify-between px-4 pb-2 pt-3">
                <span className="font-mono text-[10px] text-ink-400">9:41</span>
                <span className="absolute left-1/2 top-2.5 h-3.5 w-14 -translate-x-1/2 rounded-full bg-ink-950" />
                <span className="flex items-center gap-1.5 font-mono text-[10px] text-ink-400">
                  <Wifi className="h-3 w-3 text-signal-400" /> LAN
                </span>
              </div>

              <div className="flex items-center justify-between border-b hairline px-4 py-2.5">
                <span className="font-display text-[13px] font-medium text-ink-50">ClipLink</span>
                <span className="eyebrow text-signal-400">paired</span>
              </div>

              {/* tab bar */}
              <div className="flex border-b hairline">
                {PHONE_TABS.map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    onClick={() => setPhoneTab(id)}
                    className={`flex flex-1 items-center justify-center gap-1.5 py-2 text-[11px] font-medium transition-colors cursor-pointer ${phoneTab === id ? "border-b-2 border-signal-500 text-signal-400" : "text-ink-500 hover:text-ink-300"
                      }`}
                  >
                    <Icon className="h-3 w-3" />
                    {label}
                  </button>
                ))}
              </div>

              <div className="flex flex-1 flex-col gap-3 overflow-hidden p-3.5">

                {/* TEXT TAB */}
                {phoneTab === "text" && (
                  <div className="rounded-lg border hairline bg-ink-950 p-3">
                    <p className="eyebrow text-ink-500">send text to desktop</p>
                    <div className="mt-2.5 flex gap-2">
                      <input
                        value={phoneText}
                        onChange={(e) => setPhoneText(e.target.value)}
                        spellCheck={false}
                        placeholder="phone clipboard…"
                        className="min-w-0 flex-1 rounded-md border hairline bg-canvas px-2.5 py-2 font-mono text-[12px] text-ink-100 placeholder-ink-600 focus:border-signal-500/60 focus:outline-none"
                      />
                      <button
                        onClick={() => pushToPc(phoneText, "text")}
                        disabled={busy}
                        className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-md bg-signal-500 text-canvas transition-colors hover:bg-signal-400 disabled:opacity-40 cursor-pointer"
                        aria-label="Send to desktop"
                      >
                        <Send className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <p className="mt-2.5 text-[11px] leading-snug text-ink-500">
                      With Accessibility enabled, this sends automatically on copy.
                    </p>
                  </div>
                )}

                {/* IMAGE TAB */}
                {phoneTab === "image" && (
                  <div className="rounded-lg border hairline bg-ink-950 p-3">
                    <p className="eyebrow text-ink-500">screenshot sync</p>
                    <p className="mt-2 text-[12px] leading-snug text-ink-400">
                      Take a screenshot → ClipLink auto-sends it to your PC clipboard. Images from your PC land here too.
                    </p>
                    <button
                      onClick={() => pushToPc("[screenshot 1920×1080]", "image")}
                      disabled={busy}
                      className="mt-3 w-full rounded-md bg-ink-800 border hairline px-3 py-2 text-[12px] font-medium text-ink-200 hover:bg-ink-700 disabled:opacity-40 cursor-pointer flex items-center justify-center gap-2"
                    >
                      <Image className="h-3.5 w-3.5 text-signal-400" />
                      Simulate screenshot sync →
                    </button>
                  </div>
                )}

                {/* NOTIFICATION TAB */}
                {phoneTab === "notification" && (
                  <div className="rounded-lg border hairline bg-ink-950 p-3">
                    <p className="eyebrow text-ink-500">mirror notification</p>
                    <div className="mt-3 rounded-lg border border-ink-800 bg-canvas p-3">
                      <div className="flex items-center justify-between">
                        <span className="eyebrow text-ink-500">{notif.app}</span>
                        <span className="font-mono text-[10px] text-ink-600">now</span>
                      </div>
                      <p className="mt-1 text-[12px] font-medium text-ink-100">{notif.title}</p>
                      <p className="mt-0.5 text-[11px] text-ink-400">{notif.text}</p>
                    </div>
                    <div className="mt-3 flex gap-2">
                      <button
                        onClick={() => setNotifIdx((i) => (i + 1) % NOTIF_SAMPLES.length)}
                        className="flex-1 rounded-md border hairline bg-ink-900 px-2 py-1.5 text-[11px] text-ink-400 hover:text-ink-200 cursor-pointer"
                      >
                        Next notif
                      </button>
                      <button
                        onClick={() => pushToPc(`${notif.app}: ${notif.title} — ${notif.text}`, "notification")}
                        disabled={busy}
                        className="flex-1 rounded-md bg-signal-500 px-2 py-1.5 text-[11px] font-semibold text-canvas hover:bg-signal-400 disabled:opacity-40 cursor-pointer"
                      >
                        Mirror to PC
                      </button>
                    </div>
                  </div>
                )}

                {/* history */}
                <div className="flex min-h-0 flex-1 flex-col">
                  <p className="eyebrow mb-2 text-ink-500">history</p>
                  <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
                    {clips.map((clip) => {
                      const KindIcon = KIND_ICON[clip.kind];
                      return (
                        <li
                          key={clip.id}
                          className={`group relative rounded-lg border p-2.5 ${clip.origin === "local"
                              ? "border-[var(--hairline)] bg-ink-950"
                              : "border-signal-500/20 bg-signal-950/30"
                            }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="flex items-center gap-1.5 font-mono text-[9px] text-ink-500">
                              <KindIcon className="h-2.5 w-2.5" />
                              {clip.time}
                            </span>
                            <span className={`eyebrow ${clip.origin === "local" ? "text-ink-600" : "text-signal-400"}`}>
                              {clip.origin === "pc" ? "from pc" : clip.origin === "phone" ? "sent" : "local"}
                            </span>
                          </div>
                          <p className="mt-1.5 break-all pr-6 font-mono text-[11.5px] leading-normal text-ink-200">
                            {clip.text}
                          </p>
                          <button
                            onClick={() => copy(clip.text, clip.id)}
                            className="absolute bottom-2 right-2 grid h-6 w-6 place-items-center rounded border hairline bg-ink-950 text-ink-400 opacity-0 transition-all hover:text-signal-400 focus-visible:opacity-100 group-hover:opacity-100 cursor-pointer"
                            aria-label="Copy"
                          >
                            {copied === clip.id ? <Check className="h-3 w-3 text-signal-400" /> : <Copy className="h-3 w-3" />}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>
    </section>
  );
}
