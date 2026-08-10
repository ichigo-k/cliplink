"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import {
  Monitor,
  Smartphone,
  Apple,
  Terminal,
  Download,
  Check,
  ShieldCheck,
  Cpu,
} from "lucide-react";
import SectionHeader from "./SectionHeader";
import { SITE } from "@/lib/site";
import { BUILDS, ORDER, usePlatform, type PlatformId } from "@/lib/platform";

if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger);
}

const ICONS: Record<PlatformId, typeof Monitor> = {
  windows: Monitor,
  android: Smartphone,
  "macos-arm": Apple,
  "macos-intel": Apple,
  linux: Terminal,
};

const STEPS = [
  "Install the host on your computer",
  "Open the phone app, scan the QR",
  "Copy anywhere. It's already there.",
];

export default function Downloads() {
  const current = usePlatform();
  const rootRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduced) return;

      gsap.from(".dl-hero", {
        opacity: 0,
        y: 32,
        duration: 0.9,
        ease: "expo.out",
        scrollTrigger: { trigger: ".dl-hero", start: "top 85%" },
      });

      // light sweeps across the recommended card once it's on screen
      gsap.fromTo(
        ".dl-sweep",
        { xPercent: -130 },
        {
          xPercent: 230,
          duration: 1.6,
          ease: "power2.inOut",
          delay: 0.35,
          scrollTrigger: { trigger: ".dl-hero", start: "top 80%" },
        }
      );

      gsap.from(".dl-step", {
        opacity: 0,
        x: -14,
        duration: 0.6,
        stagger: 0.1,
        ease: "expo.out",
        scrollTrigger: { trigger: ".dl-steps", start: "top 88%" },
      });

      gsap.from(".dl-row", {
        opacity: 0,
        y: 16,
        duration: 0.55,
        stagger: 0.06,
        ease: "expo.out",
        scrollTrigger: { trigger: ".dl-table", start: "top 88%" },
      });
    }, rootRef);
    return () => ctx.revert();
  }, [current]);

  // Render Windows until detection resolves so the markup never flashes empty.
  const active = BUILDS[current ?? "windows"];
  const ActiveIcon = ICONS[active.id];
  const partner = active.role === "host" ? BUILDS.android : BUILDS.windows;

  return (
    <section
      id="downloads"
      ref={rootRef}
      className="paper scroll-mt-20 border-y hairline py-16 sm:py-24 lg:py-32"
    >
      <div className="shell">
        <SectionHeader
          index="05"
          label="Get it"
          title={
            <>
              Two installs, one scan,
              <br className="hidden sm:block" /> then forget it exists.
            </>
          }
          blurb="Signed builds straight from CI. Nothing phones home."
        />

        {/* ---------------- Recommended build ---------------- */}
        <div className="dl-hero relative mt-10 overflow-hidden rounded-2xl border hairline bg-ink-950 sm:mt-14">
          <span className="dl-sweep pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 bg-gradient-to-r from-transparent via-signal-500/[0.09] to-transparent" />
          <span className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-signal-500/[0.09] blur-3xl" />

          <div className="relative grid gap-8 p-6 sm:p-9 lg:grid-cols-[1.15fr_1fr] lg:gap-14 lg:p-11">
            {/* left: the build */}
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-signal-400 opacity-70 animate-ping" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-signal-400" />
                </span>
                <span className="eyebrow text-signal-400">
                  {current ? `Detected · ${active.detail}` : "Detecting…"}
                </span>
              </div>

              <div className="mt-5 flex items-center gap-4">
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl border hairline bg-canvas">
                  <ActiveIcon className="h-5 w-5 text-signal-400" strokeWidth={1.5} />
                </span>
                <div className="min-w-0">
                  <h3 className="font-display text-2xl font-semibold tracking-[-0.03em] text-ink-50 sm:text-[1.75rem]">
                    ClipLink for {active.name}
                  </h3>
                  <p className="mt-0.5 text-[13.5px] text-ink-400">
                    {active.role === "host" ? "Runs the LAN host" : "Pairs with your computer"}
                  </p>
                </div>
              </div>

              <a
                href={active.href}
                target="_blank"
                rel="noopener noreferrer"
                className="group mt-7 flex w-full items-center justify-center gap-2.5 rounded-lg bg-signal-500 px-6 py-4 text-[15px] font-semibold text-canvas transition-colors hover:bg-signal-400 sm:w-auto sm:px-8"
              >
                <Download className="h-4 w-4 transition-transform group-hover:translate-y-0.5" />
                Download {SITE.version}
              </a>

              {/* the exact artifact you'll get */}
              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-[11.5px] text-ink-500">
                <span className="min-w-0 truncate text-ink-300">{active.file}</span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <Cpu className="h-3 w-3" />
                  {active.arch}
                </span>
              </div>

              <p className="mt-5 border-t hairline pt-5 text-[13px] text-ink-400">
                You&apos;ll also want{" "}
                <a
                  href={partner.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-signal-400 underline decoration-signal-500/40 underline-offset-2 hover:decoration-signal-400"
                >
                  ClipLink for {partner.name}
                </a>{" "}
                on the other device.
              </p>
            </div>

            {/* right: the three steps */}
            <ol className="dl-steps flex flex-col justify-center rounded-xl border hairline bg-canvas/60 p-5 sm:p-7">
              {STEPS.map((step, i) => (
                <li key={step} className="dl-step flex items-start gap-4 py-3">
                  <span className="mt-px grid h-6 w-6 shrink-0 place-items-center rounded-full border border-signal-500/30 bg-signal-950/50 font-mono text-[10px] font-bold text-signal-400">
                    {i + 1}
                  </span>
                  <span className="text-[14.5px] leading-snug text-ink-200">{step}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>

        {/* ---------------- Every platform ---------------- */}
        <div className="dl-table mt-10 sm:mt-12">
          <div className="flex items-baseline justify-between border-b hairline pb-3">
            <span className="eyebrow text-ink-500">All builds</span>
            <span className="eyebrow text-ink-600">{SITE.version}</span>
          </div>

          {ORDER.map((id) => {
            const b = BUILDS[id];
            const Icon = ICONS[id];
            const isCurrent = current === id;
            return (
              <a
                key={id}
                href={b.href}
                target="_blank"
                rel="noopener noreferrer"
                className={`dl-row group grid grid-cols-[auto_1fr_auto] items-center gap-x-4 border-b hairline py-4 transition-colors hover:bg-ink-900/50 sm:grid-cols-[auto_11rem_1fr_auto] sm:gap-x-6 ${
                  isCurrent ? "bg-signal-950/25" : ""
                }`}
              >
                <Icon
                  className={`h-4 w-4 shrink-0 transition-colors ${
                    isCurrent ? "text-signal-400" : "text-ink-500 group-hover:text-signal-400"
                  }`}
                  strokeWidth={1.5}
                />

                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-display text-[15px] font-medium tracking-[-0.02em] text-ink-100">
                    {b.name}
                  </span>
                  <span className="hidden shrink-0 font-mono text-[11px] text-ink-500 lg:inline">
                    {b.detail}
                  </span>
                  {isCurrent && (
                    <span className="flex shrink-0 items-center gap-1 rounded-full border border-signal-500/30 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-signal-400">
                      <Check className="h-2.5 w-2.5" />
                      yours
                    </span>
                  )}
                </span>

                <span className="col-span-3 mt-1 min-w-0 truncate font-mono text-[11px] text-ink-500 sm:col-span-1 sm:mt-0">
                  {b.file}
                </span>

                <Download className="col-start-3 row-start-1 h-3.5 w-3.5 shrink-0 text-ink-600 transition-colors group-hover:text-signal-400 sm:col-start-4" />
              </a>
            );
          })}
        </div>

        <p className="mt-8 flex items-start gap-3 text-[13px] leading-relaxed text-ink-500">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-signal-400" strokeWidth={1.5} />
          <span>
            Updates are signature-checked against keys built into the app. Only take builds from
            the{" "}
            <a
              href={SITE.releases}
              target="_blank"
              rel="noopener noreferrer"
              className="text-signal-400 underline decoration-signal-500/40 underline-offset-2 hover:decoration-signal-400"
            >
              official releases page
            </a>
            .
          </span>
        </p>
      </div>
    </section>
  );
}
