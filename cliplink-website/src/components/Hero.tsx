"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ArrowDown, Play } from "lucide-react";
import { GithubIcon } from "./brand";
import { SITE, scrollToSection } from "@/lib/site";

const LINES = ["Stop emailing", "yourself links.", "It's already there."];

const SPECS = [
  { k: "Transport", v: "LAN / P2P" },
  { k: "Cipher", v: "XChaCha20" },
  { k: "Accounts", v: "None" },
  { k: "License", v: "Free to use" },
];

// Cycles under the fold copy so the page always looks like it's doing something.
const SAMPLES = [
  "https://github.com/ichigo-k/cliplink",
  "otp: 448 201",
  "ssh-ed25519 AAAAC3Nza…",
  "~/projects/cliplink/apps/desktop",
  "docker compose up -d --build",
];

export default function Hero() {
  const rootRef = useRef<HTMLElement>(null);
  const sampleRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const ctx = gsap.context(() => {
      /* ---------- entrance ---------- */
      const tl = gsap.timeline({ defaults: { ease: "expo.out" } });

      if (reduced) {
        gsap.set([".hero-char", ".hero-item", ".hero-rule"], { opacity: 1, y: 0 });
      } else {
        // headline reveals character by character, rolling up out of its own line box
        tl.from(".hero-char", {
          yPercent: 115,
          rotateX: -72,
          opacity: 0,
          duration: 1.15,
          stagger: { each: 0.016, from: "start" },
        })
          .from(
            ".hero-rule",
            { scaleX: 0, duration: 1.1, transformOrigin: "left center" },
            "-=0.85"
          )
          .from(
            ".hero-item",
            { opacity: 0, y: 22, duration: 0.9, stagger: 0.09 },
            "-=0.9"
          );
      }

      /* ---------- magnetic buttons (mouse only) ---------- */
      const cleanups: (() => void)[] = [];
      const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
      if (!reduced && finePointer) {
        gsap.utils.toArray<HTMLElement>(".magnetic").forEach((el) => {
          const xTo = gsap.quickTo(el, "x", { duration: 0.5, ease: "power3.out" });
          const yTo = gsap.quickTo(el, "y", { duration: 0.5, ease: "power3.out" });

          const move = (e: PointerEvent) => {
            const r = el.getBoundingClientRect();
            xTo((e.clientX - (r.left + r.width / 2)) * 0.28);
            yTo((e.clientY - (r.top + r.height / 2)) * 0.4);
          };
          const reset = () => {
            xTo(0);
            yTo(0);
          };

          el.addEventListener("pointermove", move);
          el.addEventListener("pointerleave", reset);
          cleanups.push(() => {
            el.removeEventListener("pointermove", move);
            el.removeEventListener("pointerleave", reset);
          });
        });
      }

      /* ---------- rotating clipboard sample ---------- */
      if (!reduced && sampleRef.current) {
        const el = sampleRef.current;
        const loop = gsap.timeline({ repeat: -1, delay: 1.4 });
        SAMPLES.forEach((text, i) => {
          loop
            .set(el, { textContent: text }, i === 0 ? 0 : ">")
            .fromTo(
              el,
              { yPercent: 110, opacity: 0 },
              { yPercent: 0, opacity: 1, duration: 0.5, ease: "expo.out" }
            )
            .to(el, { yPercent: -110, opacity: 0, duration: 0.45, ease: "expo.in" }, "+=2.2");
        });
      }

      return () => cleanups.forEach((fn) => fn());
    }, rootRef);

    return () => ctx.revert();
  }, []);

  return (
    <section
      ref={rootRef}
      className="relative flex min-h-[88svh] items-center overflow-hidden pt-28 pb-16 sm:min-h-[92vh] sm:pt-32 sm:pb-20"
    >
      {/* single light source + blueprint grid, nothing else competing */}
      <div className="absolute inset-0 blueprint [mask-image:radial-gradient(70%_60%_at_50%_35%,#000_10%,transparent_78%)]" />
      <div className="absolute left-1/2 top-[-14rem] h-[640px] w-[640px] -translate-x-1/2 rounded-full bg-signal-500/[0.08] blur-[150px]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-signal-500/40 to-transparent" />

      <div className="shell relative">
        <div className="mx-auto flex w-full max-w-4xl flex-col items-center text-center">
          {/* headline — each line is locked to one row, sized to always fit */}
          <h1
            className="w-full font-display font-semibold leading-[0.95] tracking-[-0.045em] text-ink-50 text-[clamp(1.95rem,8.7vw,6.5rem)] sm:leading-[0.92] sm:tracking-[-0.05em]"
            style={{ perspective: "800px" }}
          >
            {LINES.map((line, li) => (
              <span key={line} className="block overflow-hidden pb-[0.08em]">
                <span
                  className={`inline-block whitespace-nowrap ${
                    li === 2 ? "text-ink-500" : ""
                  }`}
                >
                  {Array.from(line).map((ch, ci) => (
                    <span
                      key={`${li}-${ci}`}
                      className="hero-char inline-block will-change-transform"
                      style={{ transformOrigin: "50% 100%" }}
                    >
                      {ch === " " ? " " : ch}
                    </span>
                  ))}
                </span>
              </span>
            ))}
          </h1>

          <span className="hero-rule mt-7 block h-px w-full max-w-md bg-gradient-to-r from-transparent via-signal-500/45 to-transparent sm:mt-9" />

          <p className="hero-item mt-7 max-w-xl text-[15.5px] leading-relaxed text-ink-300 sm:mt-8 sm:text-[17px]">
            Copy on your laptop, paste on your phone. Over your own network, encrypted, with
            nothing in between.
          </p>

          {/* live sample readout */}
          <div className="hero-item mt-7 flex h-7 max-w-full items-center gap-2.5 overflow-hidden rounded-full border hairline bg-ink-950/70 px-3.5 backdrop-blur">
            <span className="eyebrow shrink-0 text-ink-600">synced</span>
            <span className="block h-4 min-w-0 flex-1 overflow-hidden">
              <span
                ref={sampleRef}
                className="block truncate whitespace-nowrap font-mono text-[11.5px] leading-4 text-signal-400"
              >
                {SAMPLES[0]}
              </span>
            </span>
          </div>

          {/* actions */}
          <div className="hero-item mt-9 flex w-full max-w-sm flex-col items-stretch gap-3 sm:mt-10 sm:w-auto sm:max-w-none sm:flex-row sm:items-center">
            <button
              onClick={() => scrollToSection("downloads")}
              className="magnetic group relative inline-flex items-center justify-center gap-2 overflow-hidden rounded-md bg-signal-500 px-6 py-4 text-[15px] font-semibold text-canvas transition-colors hover:bg-signal-400 cursor-pointer sm:px-7"
            >
              {/* sheen sweep */}
              <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/35 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
              <span className="relative">Download for Windows</span>
              <ArrowDown className="relative h-4 w-4 transition-transform group-hover:translate-y-0.5" />
            </button>

            <button
              onClick={() => scrollToSection("simulator")}
              className="magnetic group inline-flex items-center justify-center gap-2 rounded-md border hairline-strong px-6 py-4 text-[15px] font-medium text-ink-200 transition-colors hover:border-signal-500/50 hover:text-ink-50 cursor-pointer sm:px-7"
            >
              <Play className="h-3.5 w-3.5 fill-current transition-transform group-hover:scale-110" />
              Try the live demo
            </button>
          </div>

          <a
            href={SITE.repo}
            target="_blank"
            rel="noopener noreferrer"
            className="hero-item mt-7 inline-flex items-center gap-2 text-[13px] text-ink-400 transition-colors hover:text-signal-400"
          >
            <GithubIcon className="h-3.5 w-3.5" />
            Read every line on GitHub
          </a>

          {/* datasheet strip */}
          <dl className="hero-item mt-12 grid w-full max-w-3xl grid-cols-2 border-t border-l hairline sm:mt-16 sm:grid-cols-4">
            {SPECS.map((s) => (
              <div
                key={s.k}
                className="border-b border-r hairline px-3 py-4 text-center sm:px-4 sm:py-5"
              >
                <dt className="eyebrow text-ink-600">{s.k}</dt>
                <dd className="mt-2 font-display text-[14px] font-medium text-ink-100 sm:text-[15px]">
                  {s.v}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}
