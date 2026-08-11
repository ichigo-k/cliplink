"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import {
  Shield,
  WifiOff,
  Zap,
  QrCode,
  RefreshCw,
  Key,
  Image,
  FileText,
  Bell,
  FolderOpen,
  Link,
  Wifi,
} from "lucide-react";
import SectionHeader from "./SectionHeader";
import Accent from "./Accent";

if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger);
}

const FEATURES = [
  {
    icon: Zap,
    title: "Auto-sync clipboard",
    body: "Copy anything on either device and it lands on the other instantly. No tapping, no sharing. The accessibility service watches for changes.",
    tag: "BACKGROUND",
  },
  {
    icon: Image,
    title: "Images & screenshots",
    body: "Screenshots, snips, and copied images sync in both directions. Take a screenshot on your phone, paste it on your PC.",
    tag: "PNG",
  },
  {
    icon: FileText,
    title: "Rich text",
    body: "HTML clipboard content syncs with formatting intact. Copy from a browser or Word, paste with styles preserved.",
    tag: "HTML",
  },
  {
    icon: FolderOpen,
    title: "File transfer",
    body: "Send any file from phone to PC or PC to phone over your LAN. Files land in your Downloads folder automatically.",
    tag: "CHUNKED",
  },
  {
    icon: Bell,
    title: "Notification mirror",
    body: "Phone notifications appear on your PC in real time. Dismiss from either side and both clear.",
    tag: "2-WAY",
  },
  {
    icon: Link,
    title: "URL handoff",
    body: "Copy a URL on your PC and it opens on your phone automatically. No more forwarding links to yourself.",
    tag: "DEEP-LINK",
  },
  {
    icon: Wifi,
    title: "Network-aware reconnect",
    body: "Switch Wi-Fi networks and ClipLink finds your PC again in seconds via mDNS. No stored IP required.",
    tag: "mDNS",
  },
  {
    icon: Key,
    title: "End-to-end encrypted",
    body: "Every clip, image, and file is sealed with XChaCha20-Poly1305 before it leaves the device. Nothing readable crosses the wire.",
    tag: "AEAD",
  },
  {
    icon: Shield,
    title: "No account, no cloud",
    body: "Your identity is a key pair on your own disk. No servers, no sign-up, nothing to breach.",
    tag: "ZERO-ACCOUNT",
  },
  {
    icon: QrCode,
    title: "Pair in seconds",
    body: "Scan the QR on your desktop once. The phone remembers and reconnects automatically from then on.",
    tag: "X25519",
  },
  {
    icon: RefreshCw,
    title: "No echo loops",
    body: "Synced content is fingerprinted so it never bounces back as a fresh copy.",
    tag: "SHA-256",
  },
  {
    icon: WifiOff,
    title: "Works offline",
    body: "Everything runs over your local network. Unplug the internet and nothing changes.",
    tag: "LAN",
  },
];

export default function Features() {
  const rootRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.fromTo(
        ".feature-cell",
        { opacity: 0, y: 28 },
        {
          opacity: 1,
          y: 0,
          duration: 0.7,
          stagger: 0.06,
          ease: "expo.out",
          scrollTrigger: { trigger: ".feature-grid", start: "top 82%" },
        }
      );
    }, rootRef);
    return () => ctx.revert();
  }, []);

  return (
    <section
      id="features"
      ref={rootRef}
      className="paper scroll-mt-20 border-y hairline py-16 sm:py-24 lg:py-32"
    >
      <div className="shell">
        <SectionHeader
          index="01"
          label="What it does"
          title={
            <>
              Everything your devices share,
              <br className="hidden sm:block" />{" "}
              <Accent>without the cloud.</Accent>
            </>
          }
          blurb="Clipboard, images, files, notifications, URLs: all of it over your own network, encrypted."
        />

        <div className="feature-grid mt-10 grid sm:mt-16 grid-cols-1 border-t border-l hairline sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, body, tag }, i) => (
            <article
              key={title}
              className="feature-cell group relative border-b border-r hairline p-6 transition-colors duration-300 hover:bg-ink-900/50 sm:p-7 lg:p-9"
            >
              <span className="absolute left-0 top-0 h-px w-full origin-left scale-x-0 bg-signal-500 transition-transform duration-500 ease-[var(--ease-out-expo)] group-hover:scale-x-100" />

              <div className="flex items-start justify-between">
                <Icon
                  className="h-5 w-5 text-ink-400 transition-colors duration-300 group-hover:text-signal-400"
                  strokeWidth={1.5}
                />
                <span className="eyebrow text-ink-600 transition-colors group-hover:text-ink-400">
                  {tag}
                </span>
              </div>

              <h3 className="mt-7 font-display text-[18px] sm:text-[19px] font-medium tracking-[-0.02em] text-ink-50">
                {title}
              </h3>
              <p className="mt-3 text-[14.5px] leading-relaxed text-ink-400">{body}</p>

              <span className="mt-7 block eyebrow text-ink-700">
                {String(i + 1).padStart(2, "0")}
              </span>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
