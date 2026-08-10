"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger);
}

const ITEMS = [
  "no cloud relay",
  "no account",
  "no telemetry",
  "no subscription",
  "QR pairing in 4 seconds",
  "XChaCha20-Poly1305",
  "works on airplane wifi",
  "free for non-commercial use",
];

export default function Ticker() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

      // Base crawl, then let scrolling shove it: fast scroll speeds the belt up
      // and flips its direction, and it eases back to a drift when you stop.
      const loop = gsap.to(".tk-belt", {
        xPercent: -50,
        duration: 34,
        ease: "none",
        repeat: -1,
      });

      const speed = { value: 1 };
      let idle: ReturnType<typeof setTimeout>;

      ScrollTrigger.create({
        trigger: document.body,
        start: "top top",
        end: "bottom bottom",
        onUpdate: (self) => {
          const v = self.getVelocity();
          const boost = gsap.utils.clamp(-6, 6, 1 + v / 420);
          gsap.to(speed, {
            value: boost,
            duration: 0.25,
            overwrite: true,
            onUpdate: () => loop.timeScale(speed.value),
          });

          clearTimeout(idle);
          idle = setTimeout(() => {
            gsap.to(speed, {
              value: 1,
              duration: 1.1,
              ease: "power2.out",
              onUpdate: () => loop.timeScale(speed.value),
            });
          }, 140);
        },
      });

      return () => clearTimeout(idle);
    }, ref);

    return () => ctx.revert();
  }, []);

  return (
    <div ref={ref} className="relative overflow-hidden border-y hairline bg-ink-950/40 py-3">
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-24 bg-gradient-to-r from-canvas to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-24 bg-gradient-to-l from-canvas to-transparent" />
      <div className="tk-belt flex w-max">
        {[0, 1].map((copy) => (
          <ul key={copy} className="flex shrink-0 items-center" aria-hidden={copy === 1}>
            {ITEMS.map((item) => (
              <li key={item} className="flex items-center gap-6 px-6">
                <span className="eyebrow whitespace-nowrap text-ink-400">{item}</span>
                <span className="h-1 w-1 rounded-full bg-signal-500/60" />
              </li>
            ))}
          </ul>
        ))}
      </div>
    </div>
  );
}
