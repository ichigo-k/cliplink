"use client";

import { useEffect, useRef, type ReactNode } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger);
}

/**
 * Every section is introduced the same way: a numbered mono label on a rule
 * that draws itself in, then a headline that wipes up from its own baseline.
 */
export default function SectionHeader({
  index,
  label,
  title,
  blurb,
  aside,
}: {
  index: string;
  label: string;
  title: ReactNode;
  blurb?: ReactNode;
  aside?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

      const tl = gsap.timeline({
        defaults: { ease: "expo.out" },
        scrollTrigger: { trigger: ref.current, start: "top 84%" },
      });

      tl.from(".sh-rule", { scaleX: 0, duration: 1.1, transformOrigin: "left center" })
        .from(".sh-tag", { opacity: 0, y: 10, duration: 0.6, stagger: 0.08 }, 0.12)
        .from(
          ".sh-title",
          {
            yPercent: 18,
            opacity: 0,
            duration: 1.05,
            clipPath: "inset(0% 0% 100% 0%)",
          },
          0.18
        )
        .from(".sh-body", { opacity: 0, y: 16, duration: 0.8 }, 0.42);
    }, ref);

    return () => ctx.revert();
  }, []);

  return (
    <div ref={ref}>
      <span className="sh-rule block h-px w-full bg-[var(--hairline-strong)]" />

      <div className="mt-6 flex items-baseline gap-4">
        <span className="sh-tag eyebrow text-signal-400">{index}</span>
        <span className="sh-tag eyebrow text-ink-500">{label}</span>
      </div>

      <div className="mt-6 grid gap-5 sm:mt-8 sm:gap-6 lg:grid-cols-12 lg:gap-10">
        <h2
          className="sh-title font-display text-[clamp(1.6rem,7vw,2.75rem)] font-semibold leading-[1.05] tracking-[-0.035em] text-balance-tight text-ink-50 lg:col-span-7"
          style={{ clipPath: "inset(0% 0% 0% 0%)" }}
        >
          {title}
        </h2>
        {(blurb || aside) && (
          <div className="sh-body lg:col-span-5 lg:pt-1.5">
            {blurb && (
              <p className="max-w-md text-[14.5px] leading-relaxed text-ink-400 sm:text-[15px]">
                {blurb}
              </p>
            )}
            {aside}
          </div>
        )}
      </div>
    </div>
  );
}
