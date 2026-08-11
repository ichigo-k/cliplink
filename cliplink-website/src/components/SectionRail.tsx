"use client";

import { useEffect, useState } from "react";
import LineSidebar from "./reactbits/LineSidebar";
import { NAV, scrollToSection } from "@/lib/site";

// Sections rendered on the light `.paper` band. The rail is fixed, so it floats
// over whichever band happens to be under it and has to repaint to match.
const PAPER_SECTIONS = new Set<string>(["features", "contributors", "downloads"]);

const PALETTE = {
  dark: { accent: "#14ef8e", text: "#6d7876", marker: "#2a3231" },
  paper: { accent: "#01774a", text: "#59635f", marker: "#c3cac7" },
};

const ITEMS = NAV.map((n) => ({ label: n.label, index: n.index }));

/**
 * A proximity-reactive index of the page, parked in the left margin. It only
 * appears once the viewport is wide enough to hold it clear of the content
 * column, and it mirrors — rather than replaces — the header nav.
 */
export default function SectionRail() {
  const [active, setActive] = useState<number | null>(null);
  const [onPaper, setOnPaper] = useState(false);

  useEffect(() => {
    const sections = NAV.map((n) => document.getElementById(n.id)).filter(
      (el): el is HTMLElement => Boolean(el)
    );
    if (!sections.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (!visible) return;
        const id = visible.target.id;
        setActive(NAV.findIndex((n) => n.id === id));
        setOnPaper(PAPER_SECTIONS.has(id));
      },
      { rootMargin: "-45% 0px -45% 0px", threshold: 0 }
    );

    sections.forEach((s) => observer.observe(s));
    return () => observer.disconnect();
  }, []);

  const palette = onPaper ? PALETTE.paper : PALETTE.dark;

  return (
    // At 2xl the page margin plus the shell's own inline padding leaves room for
    // the rail — labels and their hover shift included — clear of the text.
    <div className="pointer-events-none fixed left-4 top-1/2 z-40 hidden -translate-y-1/2 2xl:block">
      <div className="pointer-events-auto">
        <LineSidebar
          aria-label="Sections"
          items={ITEMS}
          activeIndex={active}
          onItemClick={(i) => scrollToSection(NAV[i].id)}
          accentColor={palette.accent}
          textColor={palette.text}
          markerColor={palette.marker}
          markerLength={28}
          markerGap={8}
          tickScale={0.45}
          maxShift={14}
          itemGap={22}
          fontSize={0.78}
          proximityRadius={92}
          smoothing={110}
        />
      </div>
    </div>
  );
}
