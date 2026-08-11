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
  ArrowRight,
  QrCode,
  Clock,
} from "lucide-react";
import SectionHeader from "./SectionHeader";
import Accent from "./Accent";
import { SITE } from "@/lib/site";
import { usePlatform, type PlatformId } from "@/lib/platform";
import type { ReleaseInfo, ResolvedBuild } from "@/lib/release";
import { PLATFORM_ORDER } from "@/lib/release";

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
  { n: "1", text: "Install the desktop app on your PC" },
  { n: "2", text: "Install the Android app on your phone" },
  { n: "3", text: "Scan the QR code shown in the desktop app" },
  { n: "4", text: "Copy anything. It's already on the other device." },
];

function formatBytes(bytes: number): string {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short", day: "numeric", year: "numeric",
    });
  } catch { return ""; }
}

interface Props {
  release: ReleaseInfo;
}

export default function Downloads({ release }: Props) {
  const current = usePlatform();
  const rootRef = useRef<HTMLElement>(null);

  const { version, publishedAt, releasePage, builds } = release;

  useEffect(() => {
    const ctx = gsap.context(() => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

      gsap.from(".dl-card", {
        opacity: 0, y: 28, duration: 0.8, stagger: 0.1,
        ease: "expo.out",
        scrollTrigger: { trigger: ".dl-cards", start: "top 84%" },
      });

      gsap.fromTo(".dl-sweep", { xPercent: -130 }, {
        xPercent: 230, duration: 1.7, ease: "power2.inOut", delay: 0.4,
        scrollTrigger: { trigger: ".dl-cards", start: "top 80%" },
      });

      gsap.from(".dl-step", {
        opacity: 0, x: -12, duration: 0.55, stagger: 0.09,
        ease: "expo.out",
        scrollTrigger: { trigger: ".dl-steps", start: "top 88%" },
      });

      gsap.from(".dl-row", {
        opacity: 0, y: 14, duration: 0.5, stagger: 0.05,
        ease: "expo.out",
        scrollTrigger: { trigger: ".dl-table", start: "top 88%" },
      });
    }, rootRef);
    return () => ctx.revert();
  }, []);

  const pcBuild = builds[current && current !== "android" ? current : "windows"];
  const androidBuild = builds.android;
  const PcIcon = ICONS[pcBuild.id];

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
              Two installs.{" "}
              <Accent>One scan.</Accent>
            </>
          }
          blurb="Signed builds from CI. Nothing phones home."
        />

        {/* ── Version badge ── */}
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-1.5 rounded-full border border-signal-500/30 bg-signal-950/40 px-3 py-1 font-mono text-[11px] font-bold text-signal-400">
            {version}
          </span>
          {publishedAt && (
            <span className="flex items-center gap-1.5 font-mono text-[11px] text-ink-500">
              <Clock className="h-3 w-3" />
              Released {formatDate(publishedAt)}
            </span>
          )}
        </div>

        {/* ── Two download cards ── */}
        <div className="dl-cards mt-8 grid gap-4 sm:grid-cols-2 sm:gap-5">

          {/* PC card */}
          <div className="dl-card relative overflow-hidden rounded-2xl border border-signal-500/30 bg-ink-950">
            <span className="dl-sweep pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 bg-gradient-to-r from-transparent via-signal-500/[0.11] to-transparent" />
            <span className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-signal-500/[0.08] blur-3xl" />

            <div className="relative flex flex-col gap-6 p-6 sm:p-8">
              <div className="flex items-start justify-between">
                <div className="grid h-11 w-11 place-items-center rounded-xl border border-signal-500/30 bg-signal-950/60">
                  <PcIcon className="h-5 w-5 text-signal-400" strokeWidth={1.5} />
                </div>
                <span className="flex items-center gap-1.5 rounded-full border border-signal-500/25 bg-signal-950/40 px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-signal-400">
                  <Monitor className="h-2.5 w-2.5" />
                  Desktop host
                </span>
              </div>

              <div>
                <h3 className="font-display text-[1.35rem] font-semibold tracking-tight text-ink-50 sm:text-[1.5rem]">
                  ClipLink for {pcBuild.detail}
                </h3>
                <p className="mt-1.5 text-[13.5px] text-ink-400">
                  Runs silently in your tray. Watches your clipboard and syncs to paired phones.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 font-mono text-[11px] text-ink-500">
                <span className="flex items-center gap-1.5">
                  <Cpu className="h-3 w-3" />{pcBuild.arch}
                </span>
                <span className="truncate text-ink-400">{pcBuild.file}</span>
                {pcBuild.size > 0 && (
                  <span className="text-ink-600">{formatBytes(pcBuild.size)}</span>
                )}
              </div>

              <a
                href={pcBuild.href}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex w-full items-center justify-center gap-2.5 rounded-lg bg-signal-500 px-5 py-3.5 text-[14.5px] font-semibold text-canvas transition-colors hover:bg-signal-400"
              >
                <Download className="h-4 w-4 transition-transform group-hover:translate-y-0.5" />
                Download {version}
                <ArrowRight className="ml-auto h-4 w-4 opacity-60 transition-transform group-hover:translate-x-0.5" />
              </a>
            </div>
          </div>

          {/* Android card */}
          <div className="dl-card relative overflow-hidden rounded-2xl border hairline bg-ink-950">
            <div className="relative flex flex-col gap-6 p-6 sm:p-8">
              <div className="flex items-start justify-between">
                <div className="grid h-11 w-11 place-items-center rounded-xl border hairline bg-canvas/10">
                  <Smartphone className="h-5 w-5 text-ink-300" strokeWidth={1.5} />
                </div>
                <span className="flex items-center gap-1.5 rounded-full border hairline bg-ink-900 px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-ink-400">
                  <Smartphone className="h-2.5 w-2.5" />
                  Android companion
                </span>
              </div>

              <div>
                <h3 className="font-display text-[1.35rem] font-semibold tracking-tight text-ink-50 sm:text-[1.5rem]">
                  ClipLink for Android
                </h3>
                <p className="mt-1.5 text-[13.5px] text-ink-400">
                  Pairs with your desktop over Wi-Fi. Syncs clipboard, images, files, and mirrors notifications.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 font-mono text-[11px] text-ink-500">
                <span className="flex items-center gap-1.5">
                  <Cpu className="h-3 w-3" />{androidBuild.arch}
                </span>
                <span className="text-ink-400">{androidBuild.file}</span>
                {androidBuild.size > 0 && (
                  <span className="text-ink-600">{formatBytes(androidBuild.size)}</span>
                )}
                <span className="text-ink-600">Android 9+</span>
              </div>

              <a
                href={androidBuild.href}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex w-full items-center justify-center gap-2.5 rounded-lg border hairline bg-canvas/5 px-5 py-3.5 text-[14.5px] font-semibold text-ink-100 transition-colors hover:border-signal-500/40 hover:bg-signal-950/30 hover:text-ink-50"
              >
                <Download className="h-4 w-4 transition-transform group-hover:translate-y-0.5" />
                Download APK
                <ArrowRight className="ml-auto h-4 w-4 opacity-40 transition-transform group-hover:translate-x-0.5" />
              </a>
            </div>
          </div>
        </div>

        {/* ── Setup steps ── */}
        <div className="dl-steps mt-5 rounded-2xl border hairline bg-canvas/40 p-6 sm:p-8">
          <div className="flex items-center gap-2 mb-5">
            <QrCode className="h-4 w-4 text-signal-400" strokeWidth={1.5} />
            <span className="eyebrow text-ink-400">Setup in 60 seconds</span>
          </div>
          <ol className="grid gap-0 sm:grid-cols-2 sm:gap-x-10 lg:grid-cols-4">
            {STEPS.map(({ n, text }) => (
              <li key={n} className="dl-step flex items-start gap-3.5 py-3 sm:py-2">
                <span className="mt-px grid h-6 w-6 shrink-0 place-items-center rounded-full border border-signal-500/30 bg-signal-950/50 font-mono text-[10px] font-bold text-signal-400">
                  {n}
                </span>
                <span className="text-[13.5px] leading-snug text-ink-300">{text}</span>
              </li>
            ))}
          </ol>
        </div>

        {/* ── All builds table ── */}
        <div className="dl-table mt-10 sm:mt-12">
          <div className="flex items-baseline justify-between border-b hairline pb-3">
            <span className="eyebrow text-ink-500">All builds</span>
            <span className="eyebrow text-ink-600">{version}</span>
          </div>

          {PLATFORM_ORDER.map((id) => {
            const b: ResolvedBuild = builds[id];
            const Icon = ICONS[id];
            const isCurrent = current === id;
            return (
              <a
                key={id}
                href={b.href}
                target="_blank"
                rel="noopener noreferrer"
                className={`dl-row group grid grid-cols-[auto_1fr_auto] items-center gap-x-4 border-b hairline py-4 transition-colors hover:bg-ink-900/50 sm:grid-cols-[auto_10rem_1fr_auto] sm:gap-x-6 ${isCurrent ? "bg-signal-950/25" : ""
                  }`}
              >
                <Icon
                  className={`h-4 w-4 shrink-0 transition-colors ${isCurrent ? "text-signal-400" : "text-ink-500 group-hover:text-signal-400"
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
                      you
                    </span>
                  )}
                </span>

                <span className="col-span-3 mt-1 flex min-w-0 items-center gap-3 sm:col-span-1 sm:mt-0">
                  <span className="truncate font-mono text-[11px] text-ink-500">{b.file}</span>
                  {b.size > 0 && (
                    <span className="shrink-0 font-mono text-[10px] text-ink-700">
                      {formatBytes(b.size)}
                    </span>
                  )}
                </span>

                <Download className="col-start-3 row-start-1 h-3.5 w-3.5 shrink-0 text-ink-600 transition-colors group-hover:text-signal-400 sm:col-start-4" />
              </a>
            );
          })}
        </div>

        {/* ── Security note ── */}
        <p className="mt-8 flex items-start gap-3 text-[13px] leading-relaxed text-ink-500">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-signal-400" strokeWidth={1.5} />
          <span>
            All builds are signature-checked against keys baked into the app.
            Only install from the{" "}
            <a
              href={releasePage || SITE.releases}
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
