"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { ArrowUp, ArrowUpRight, Download } from "lucide-react";
import { GithubIcon, LogoMark, Wordmark } from "./brand";
import { NAV, SITE, scrollToSection } from "@/lib/site";

if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger);
}

const RESOURCES = [
  { label: "Releases", href: SITE.releases },
  { label: "Issues", href: SITE.issues },
  { label: "Contributing", href: SITE.contribution },
  { label: "Protocol docs", href: `${SITE.repo}/tree/main/docs` },
  { label: "License", href: `${SITE.repo}/blob/main/LICENSE` },
];

export default function Footer() {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

      // CTA lifts in
      gsap.from(".ft-cta", {
        opacity: 0,
        y: 40,
        duration: 1,
        ease: "expo.out",
        scrollTrigger: { trigger: ".ft-cta", start: "top 88%" },
      });

      gsap.from(".ft-col", {
        opacity: 0,
        y: 20,
        duration: 0.7,
        stagger: 0.08,
        ease: "expo.out",
        scrollTrigger: { trigger: ".ft-cols", start: "top 90%" },
      });

      // The oversized wordmark rises out of the baseline as you reach the end,
      // scrubbed so it tracks the scroll rather than firing once.
      gsap.fromTo(
        ".ft-mark span",
        { yPercent: 105, opacity: 0 },
        {
          yPercent: 0,
          opacity: 1,
          ease: "none",
          stagger: 0.04,
          scrollTrigger: {
            trigger: ".ft-mark",
            start: "top 95%",
            end: "bottom bottom",
            scrub: 0.8,
          },
        }
      );
    }, ref);

    return () => ctx.revert();
  }, []);

  return (
    <footer ref={ref} className="relative overflow-hidden">
      {/* ── closing call to action ── */}
      <div className="shell">
        <div className="ft-cta relative mx-auto mt-4 mb-16 overflow-hidden rounded-2xl border hairline bg-ink-950 px-6 py-12 text-center sm:px-12 sm:py-16">
          <span className="pointer-events-none absolute -top-40 left-1/2 h-80 w-80 -translate-x-1/2 rounded-full bg-signal-500/12 blur-[100px]" />
          <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-signal-500/50 to-transparent" />

          <p className="eyebrow relative text-signal-400">Ready when you are</p>
          <h2 className="relative mx-auto mt-5 max-w-2xl font-display text-[clamp(1.7rem,6vw,2.6rem)] font-semibold leading-[1.05] tracking-[-0.035em] text-ink-50">
            Your next paste is already
            <br className="hidden sm:block" /> on the other device.
          </h2>

          <div className="relative mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <button
              onClick={() => scrollToSection("downloads")}
              className="group inline-flex w-full items-center justify-center gap-2 rounded-lg bg-signal-500 px-7 py-3.5 text-[15px] font-semibold text-canvas transition-colors hover:bg-signal-400 sm:w-auto cursor-pointer"
            >
              <Download className="h-4 w-4 transition-transform group-hover:translate-y-0.5" />
              Download {SITE.version}
            </button>
            <a
              href={SITE.repo}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg border hairline-strong px-7 py-3.5 text-[15px] font-medium text-ink-200 transition-colors hover:border-signal-500/50 hover:text-ink-50 sm:w-auto"
            >
              <GithubIcon className="h-4 w-4" />
              Star on GitHub
            </a>
          </div>
        </div>
      </div>

      {/* ── link columns ── */}
      <div className="shell">
        <div className="ft-cols grid gap-10 border-t hairline pt-12 sm:grid-cols-2 lg:grid-cols-12">
          <div className="ft-col lg:col-span-5">
            <div className="flex items-center gap-2.5">
              <LogoMark className="h-7 w-7" />
              <Wordmark className="text-[15px]" />
            </div>
            <p className="mt-4 max-w-xs text-[13.5px] leading-relaxed text-ink-400">
              A clipboard bridge for people who&apos;d rather not upload what they copy.
            </p>

            <div className="mt-6 inline-flex items-center gap-2.5 rounded-full border hairline bg-ink-950/60 px-3 py-1.5">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full rounded-full bg-signal-400 opacity-70 animate-ping" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-signal-400" />
              </span>
              <span className="font-mono text-[11px] text-ink-400">
                {SITE.version} · shipping
              </span>
            </div>
          </div>

          <nav className="ft-col lg:col-span-3">
            <p className="eyebrow text-ink-600">Sections</p>
            <ul className="mt-5 space-y-3">
              {NAV.map((item) => (
                <li key={item.id}>
                  <button
                    onClick={() => scrollToSection(item.id)}
                    className="group flex items-baseline gap-3 text-[13.5px] text-ink-400 transition-colors hover:text-signal-400 cursor-pointer"
                  >
                    <span className="font-mono text-[10px] text-ink-700 transition-colors group-hover:text-signal-500">
                      {item.index}
                    </span>
                    {item.label}
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          <nav className="ft-col lg:col-span-4">
            <p className="eyebrow text-ink-600">Project</p>
            <ul className="mt-5 space-y-3">
              {RESOURCES.map((r) => (
                <li key={r.label}>
                  <a
                    href={r.href}
                    target={r.href.startsWith("http") ? "_blank" : undefined}
                    rel={r.href.startsWith("http") ? "noopener noreferrer" : undefined}
                    className="group inline-flex items-center gap-1.5 text-[13.5px] text-ink-400 transition-colors hover:text-signal-400"
                  >
                    {r.label}
                    <ArrowUpRight className="h-3 w-3 opacity-0 transition-all group-hover:-translate-y-0.5 group-hover:opacity-100" />
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        {/* ── legal strip ── */}
        <div className="mt-12 flex flex-col gap-4 border-t hairline py-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-mono text-[11px] text-ink-600">
            © {new Date().getFullYear()} ClipLink contributors · Community License · no analytics
            on this page
          </p>
          <button
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            className="group inline-flex items-center gap-2 self-start font-mono text-[11px] text-ink-500 transition-colors hover:text-signal-400 sm:self-auto cursor-pointer"
          >
            Back to top
            <ArrowUp className="h-3 w-3 transition-transform group-hover:-translate-y-0.5" />
          </button>
        </div>
      </div>

      {/* ── oversized sign-off ── */}
      <div className="ft-mark shell pointer-events-none select-none" aria-hidden="true">
        <p className="flex overflow-hidden font-display text-[19vw] font-semibold leading-[0.78] tracking-[-0.06em] text-ink-100/18 lg:text-[13.5rem]">
          {"ClipLink".split("").map((ch, i) => (
            <span key={i} className="inline-block">
              {ch}
            </span>
          ))}
        </p>
      </div>
    </footer>
  );
}
