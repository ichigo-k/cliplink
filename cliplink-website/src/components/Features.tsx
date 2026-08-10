"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { Shield, WifiOff, Zap, QrCode, RefreshCw, Key } from "lucide-react";
import SectionHeader from "./SectionHeader";

if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger);
}

const FEATURES = [
  {
    icon: WifiOff,
    title: "Works offline",
    body: "Your PC talks to your phone across the LAN. Unplug the internet and nothing changes.",
    tag: "LAN",
  },
  {
    icon: Shield,
    title: "No account",
    body: "Nothing to sign up for, nothing to breach. Your identity is a key pair on your own disk.",
    tag: "ZERO-ACCOUNT",
  },
  {
    icon: QrCode,
    title: "Pair in seconds",
    body: "Scan the QR on your desktop once. The phone remembers it from then on.",
    tag: "X25519",
  },
  {
    icon: Key,
    title: "Encrypted end to end",
    body: "Every clip is sealed before it leaves the device. Nothing readable crosses the wire.",
    tag: "AEAD",
  },
  {
    icon: RefreshCw,
    title: "No echo loops",
    body: "Synced pastes are fingerprinted, so they never bounce back as a fresh copy.",
    tag: "SHA-256",
  },
  {
    icon: Zap,
    title: "Never press sync",
    body: "The tray app watches the clipboard and pushes changes the moment they appear.",
    tag: "500MS",
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
          stagger: 0.07,
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
              Six decisions that keep your
              <br className="hidden sm:block" /> clipboard{" "}
              <span className="text-signal-400">yours</span>.
            </>
          }
          blurb="Small on purpose. Everything here exists so no other machine ever sees what you copy."
        />

        {/* A single ruled grid — cells share hairlines instead of floating as cards */}
        <div className="feature-grid mt-10 grid sm:mt-16 grid-cols-1 border-t border-l hairline sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, body, tag }, i) => (
            <article
              key={title}
              className="feature-cell group relative border-b border-r hairline p-6 transition-colors duration-300 hover:bg-ink-900/50 sm:p-7 lg:p-9"
            >
              {/* accent bar that draws in on hover */}
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
