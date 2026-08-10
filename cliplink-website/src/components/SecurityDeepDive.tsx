"use client";

import { Fragment, useState } from "react";
import { Key, Lock, ShieldCheck, Copy, Check } from "lucide-react";
import SectionHeader from "./SectionHeader";

type Tab = "handshake" | "payload" | "suppression";

const TABS: { id: Tab; label: string; file: string }[] = [
  { id: "handshake", label: "Handshake", file: "pairing_request.json" },
  { id: "payload", label: "Payload", file: "sync_frame.json" },
  { id: "suppression", label: "Suppression", file: "loop_guard.ts" },
];

const SNIPPETS: Record<Tab, string> = {
  handshake: `{
  "type": "pair_request",
  "device": "Pixel-8-Pro",
  "pubkey": "x25519:8f7f2d01c9…",
  "nonce": "a7e8b912c3f4e5a6",
  "sig": "ed25519:3e8a71…"
}`,
  payload: `{
  "type": "clip",
  "nonce": "9ef8a1c2b3d4e5f6…",
  "ct": "8f731a5cde90f331…",
  "tag": "3e71ba89fd2217c0"
}`,
  suppression: `// Remember what we write, so the watcher
// can tell our own paste from a real copy.
const recent = new Set<string>()

function onIncoming(text: string) {
  const h = sha256(text)
  recent.add(h)
  setTimeout(() => recent.delete(h), 5000)
  writeClipboard(text)
}

function onCopy(text: string) {
  if (recent.delete(sha256(text))) return
  broadcast(text)
}`,
};

const PILLARS = [
  {
    icon: Key,
    title: "Keys never travel",
    body: "The QR code carries a public key and a nonce that expires in five minutes. A photo of the screen is worthless afterwards.",
    meta: "X25519 · ephemeral",
  },
  {
    icon: Lock,
    title: "Every clip is sealed",
    body: "Authenticated encryption with a 192-bit random nonce. Tampering fails loudly instead of silently.",
    meta: "XChaCha20-Poly1305",
  },
  {
    icon: ShieldCheck,
    title: "Nobody in the middle",
    body: "Keys are pinned to disk on first scan. No directory, no relay, nothing to revoke on someone else's server.",
    meta: "TOFU · pinned",
  },
];

/** Tiny token colouriser — enough for JSON and a short TS snippet. */
function highlight(code: string) {
  const pattern =
    /(\/\/[^\n]*)|("(?:[^"\\]|\\.)*")|(\b\d+\b)|(\b(?:const|function|return|if|new|Set|setTimeout|string|void)\b)/g;
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;

  while ((m = pattern.exec(code))) {
    if (m.index > last) out.push(<Fragment key={i++}>{code.slice(last, m.index)}</Fragment>);
    const [text, comment, str, num] = m;
    const cls = comment
      ? "text-ink-600 italic"
      : str
      ? "text-signal-300"
      : num
      ? "text-signal-500"
      : "text-ink-100";
    out.push(
      <span key={i++} className={cls}>
        {text}
      </span>
    );
    last = m.index + text.length;
  }
  out.push(<Fragment key={i++}>{code.slice(last)}</Fragment>);
  return out;
}

export default function SecurityDeepDive() {
  const [tab, setTab] = useState<Tab>("handshake");
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(SNIPPETS[tab]);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* ignore */
    }
  };

  const active = TABS.find((t) => t.id === tab)!;

  return (
    <section id="security" className="scroll-mt-20 py-16 sm:py-24 lg:py-32">
      <div className="shell">
        <SectionHeader
          index="03"
          label="Why it's safe"
          title={
            <>
              We assume your network
              <br className="hidden sm:block" /> is already{" "}
              <span className="text-signal-400">hostile</span>.
            </>
          }
          blurb="Café wifi, a shared router, a colleague's laptop — all treated the same. Authenticate, encrypt, trust nothing else."
        />

        <div className="mt-10 grid gap-10 sm:mt-16 lg:grid-cols-12 lg:gap-14">
          {/* Pillars */}
          <div className="lg:col-span-5">
            <ol className="border-t hairline">
              {PILLARS.map(({ icon: Icon, title, body, meta }, i) => (
                <li key={title} className="group border-b hairline py-6 sm:py-7">
                  <div className="flex items-baseline gap-4">
                    <span className="eyebrow text-ink-600">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2.5">
                        <Icon className="h-4 w-4 text-signal-400" strokeWidth={1.5} />
                        <h3 className="font-display text-[17px] font-medium tracking-[-0.02em] text-ink-50">
                          {title}
                        </h3>
                      </div>
                      <p className="mt-3 text-[14.5px] leading-relaxed text-ink-400">{body}</p>
                      <p className="mt-3 eyebrow text-ink-600">{meta}</p>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          {/* Terminal */}
          <div className="lg:col-span-7">
            <div className="grain sticky top-24 overflow-hidden rounded-xl border hairline bg-ink-950">
              <div className="flex items-center justify-between border-b hairline bg-ink-900/50 px-3 py-2">
                <div className="flex gap-1">
                  {TABS.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setTab(t.id)}
                      className={`rounded px-2.5 py-1.5 text-[11px] font-medium transition-colors cursor-pointer ${
                        tab === t.id
                          ? "bg-signal-500/12 text-signal-300"
                          : "text-ink-500 hover:text-ink-200"
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                <button
                  onClick={copy}
                  className="grid h-7 w-7 place-items-center rounded text-ink-500 transition-colors hover:text-signal-400 cursor-pointer"
                  aria-label="Copy snippet"
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              </div>

              <div className="relative overflow-hidden">
                {/* faint scanline keeps the panel alive without shouting */}
                <span className="pointer-events-none absolute inset-x-0 top-0 z-10 h-16 bg-gradient-to-b from-signal-500/[0.06] to-transparent animate-scanline" />
                <div className="flex">
                  {/* gutter */}
                  <div className="shrink-0 select-none border-r hairline px-2.5 py-5 text-right font-mono text-[10.5px] leading-[1.7] text-ink-700 sm:px-3 sm:text-[11px] sm:leading-[1.65]">
                    {SNIPPETS[tab].split("\n").map((_, i) => (
                      <div key={i}>{i + 1}</div>
                    ))}
                  </div>
                  {/* min-w-0 is what lets the code scroll inside the panel
                      instead of stretching it past the viewport */}
                  <pre className="min-w-0 flex-1 overflow-x-auto px-3.5 py-5 font-mono text-[11.5px] leading-[1.7] text-ink-300 sm:px-4 sm:text-[12.5px] sm:leading-[1.65]">
                    <code>{highlight(SNIPPETS[tab])}</code>
                  </pre>
                </div>
              </div>

              <div className="flex items-center justify-between border-t hairline px-4 py-2.5">
                <span className="font-mono text-[11px] text-ink-600">{active.file}</span>
                <span className="eyebrow text-ink-600">rust + typescript</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
