"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { ClipboardCheck, FolderOpen, Bell, Lock } from "lucide-react";
import CardSwap, { Card } from "./reactbits/CardSwap";
import { scrollToSection } from "@/lib/site";

if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger);
}

const CARDS = [
  {
    icon: ClipboardCheck,
    tag: "clipboard",
    title: "Copy on the phone",
    body: "otp: 448 201",
    meta: "sealed · 24 bytes · 41 ms",
  },
  {
    icon: FolderOpen,
    tag: "file",
    title: "Drop a file",
    body: "quarterly-report.pdf",
    meta: "chunked · 2.4 MB · → Downloads",
  },
  {
    icon: Bell,
    tag: "notification",
    title: "Mirror a notification",
    body: "GitHub: Your PR was merged.",
    meta: "2-way · dismiss syncs both",
  },
];

/**
 * The band between the ticker and the feature grid: a plain-language claim on
 * the left, and a stack of the three payload kinds shuffling itself on the
 * right so the page has something moving above the fold-and-a-half.
 */
export default function Spotlight() {
  const rootRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      gsap.from(".sp-copy > *", {
        opacity: 0,
        y: 20,
        duration: 0.8,
        stagger: 0.08,
        ease: "expo.out",
        scrollTrigger: { trigger: rootRef.current, start: "top 82%" },
      });
    }, rootRef);
    return () => ctx.revert();
  }, []);

  return (
    <section ref={rootRef} className="relative overflow-hidden py-16 sm:py-20 lg:py-28">
      <div className="pointer-events-none absolute right-[8%] top-1/2 h-[420px] w-[420px] -translate-y-1/2 rounded-full bg-signal-500/[0.06] blur-[130px]" />

      <div className="shell relative">
        <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-8">
          <div className="sp-copy max-w-lg">
            <span className="eyebrow text-ink-500">One pipe, three payloads</span>

            <h2 className="mt-5 font-display text-[clamp(1.5rem,6vw,2.4rem)] font-semibold leading-[1.06] tracking-[-0.035em] text-balance-tight text-ink-50">
              Copy here.
              <br />
              Paste there.
            </h2>

            <p className="mt-5 max-w-md text-[14.5px] leading-relaxed text-ink-400 sm:text-[15px]">
              Text, images, files and notifications all ride the same encrypted
              LAN connection. No relay in the middle, no upload step, no
              &ldquo;send to myself&rdquo; chat thread.
            </p>

            <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-2.5">
              <span className="flex items-center gap-2 font-mono text-[11px] text-ink-500">
                <Lock className="h-3 w-3 text-signal-400" />
                XChaCha20-Poly1305
              </span>
              <button
                onClick={() => scrollToSection("simulator")}
                className="text-[13px] font-medium text-signal-400 transition-colors hover:text-signal-300 cursor-pointer"
              >
                Try the live demo →
              </button>
            </div>
          </div>

          {/* Stage the stack anchors to its bottom-right. Kept tall enough that
              the cards clear the section's own padding, and inset from the right
              on narrow screens so the receding cards, which step rightwards,
              don't run off the edge. */}
          <div className="relative me-16 h-[280px] sm:me-14 sm:h-[340px] lg:me-8 lg:h-[400px]">
            <CardSwap
              width={330}
              height={210}
              cardDistance={46}
              verticalDistance={54}
              delay={4200}
              skewAmount={5}
              pauseOnHover
            >
              {CARDS.map(({ icon: Icon, tag, title, body, meta }) => (
                <Card key={tag} className="overflow-hidden">
                  <div className="flex h-full flex-col p-5">
                    <div className="flex items-center justify-between">
                      <span className="grid h-8 w-8 place-items-center rounded-lg border border-signal-500/25 bg-signal-950/50">
                        <Icon className="h-3.5 w-3.5 text-signal-400" strokeWidth={1.5} />
                      </span>
                      <span className="eyebrow text-ink-600">{tag}</span>
                    </div>

                    <h3 className="mt-5 font-display text-[15px] font-medium tracking-[-0.02em] text-ink-50">
                      {title}
                    </h3>

                    <p className="mt-2 truncate rounded-md border hairline bg-canvas px-2.5 py-2 font-mono text-[12px] text-signal-300">
                      {body}
                    </p>

                    <span className="mt-auto pt-4 font-mono text-[10.5px] text-ink-600">
                      {meta}
                    </span>
                  </div>
                </Card>
              ))}
            </CardSwap>
          </div>
        </div>
      </div>
    </section>
  );
}
