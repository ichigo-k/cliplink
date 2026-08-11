"use client";

import { useRef, useState, useCallback, useEffect, type CSSProperties } from "react";
import styles from "./LineSidebar.module.css";

const FALLOFF_CURVES = {
  linear: (p: number) => p,
  smooth: (p: number) => p * p * (3 - 2 * p),
  sharp: (p: number) => p * p * p,
};

export interface LineSidebarItem {
  label: string;
  /** Overrides the auto-generated zero-padded index. */
  index?: string;
}

export interface LineSidebarProps {
  items: (string | LineSidebarItem)[];
  accentColor?: string;
  textColor?: string;
  markerColor?: string;
  showIndex?: boolean;
  showMarker?: boolean;
  /** Vertical distance in px within which the cursor influences an item. */
  proximityRadius?: number;
  /** Horizontal slide in px at full proximity. */
  maxShift?: number;
  falloff?: keyof typeof FALLOFF_CURVES;
  markerLength?: number;
  markerGap?: number;
  tickScale?: number;
  scaleTick?: boolean;
  itemGap?: number;
  /** Label size in rem. */
  fontSize?: number;
  /** Follow time in ms for the proximity response. */
  smoothing?: number;
  defaultActive?: number | null;
  /** Drive the active item from outside; leave undefined to track clicks internally. */
  activeIndex?: number | null;
  onItemClick?: (index: number, label: string) => void;
  className?: string;
  "aria-label"?: string;
}

export default function LineSidebar({
  items,
  accentColor = "#A855F7",
  textColor = "#c4c4c4",
  markerColor = "#6c6c6c",
  showIndex = true,
  showMarker = true,
  proximityRadius = 100,
  maxShift = 30,
  falloff = "smooth",
  markerLength = 60,
  markerGap = 0,
  tickScale = 0.5,
  scaleTick = true,
  itemGap = 20,
  fontSize = 1.1,
  smoothing = 100,
  defaultActive = null,
  activeIndex,
  onItemClick,
  className = "",
  "aria-label": ariaLabel,
}: LineSidebarProps) {
  const listRef = useRef<HTMLUListElement>(null);
  const itemRefs = useRef<(HTMLLIElement | null)[]>([]);
  const targetsRef = useRef<number[]>([]);
  const currentRef = useRef<number[]>([]);
  const rafRef = useRef<number | null>(null);
  const lastRef = useRef(0);
  const smoothingRef = useRef(smoothing);
  const [internalActive, setInternalActive] = useState<number | null>(defaultActive);

  const controlled = activeIndex !== undefined;
  const active = controlled ? activeIndex : internalActive;
  const activeRef = useRef(active);

  // The rAF loop reads these asynchronously, so mirroring them after the commit
  // is soon enough — and keeps render itself free of ref writes.
  useEffect(() => {
    activeRef.current = active;
    smoothingRef.current = smoothing;
  });

  // One rAF loop eases every item's --effect toward its target with frame-rate
  // independent exponential smoothing, then parks itself once nothing moves.
  const runFrame = useCallback(function runFrame(now: number) {
    const dt = Math.min((now - lastRef.current) / 1000, 0.05);
    lastRef.current = now;
    const tau = Math.max(smoothingRef.current, 1) / 1000;
    const k = 1 - Math.exp(-dt / tau);

    let moving = false;
    const els = itemRefs.current;
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      if (!el) continue;
      const target = Math.max(targetsRef.current[i] || 0, activeRef.current === i ? 1 : 0);
      const cur = currentRef.current[i] || 0;
      const next = cur + (target - cur) * k;
      const settled = Math.abs(target - next) < 0.0015;
      const value = settled ? target : next;
      currentRef.current[i] = value;
      el.style.setProperty("--effect", value.toFixed(4));
      if (!settled) moving = true;
    }

    rafRef.current = moving ? requestAnimationFrame(runFrame) : null;
  }, []);

  const startLoop = useCallback(() => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    lastRef.current = performance.now();
    rafRef.current = requestAnimationFrame(runFrame);
  }, [runFrame]);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLUListElement>) => {
      const list = listRef.current;
      if (!list) return;
      const rect = list.getBoundingClientRect();
      const pointerY = e.clientY - rect.top;
      const ease = FALLOFF_CURVES[falloff] ?? FALLOFF_CURVES.linear;
      const els = itemRefs.current;
      for (let i = 0; i < els.length; i++) {
        const el = els[i];
        if (!el) continue;
        const center = el.offsetTop + el.offsetHeight / 2;
        const distance = Math.abs(pointerY - center);
        targetsRef.current[i] = ease(Math.max(0, 1 - distance / proximityRadius));
      }
      startLoop();
    },
    [falloff, proximityRadius, startLoop]
  );

  const handlePointerLeave = useCallback(() => {
    targetsRef.current = targetsRef.current.map(() => 0);
    startLoop();
  }, [startLoop]);

  const handleClick = useCallback(
    (index: number, label: string) => {
      if (!controlled) setInternalActive(index);
      onItemClick?.(index, label);
    },
    [controlled, onItemClick]
  );

  // Keyboard users get the same emphasis the cursor would give.
  const setFocusTarget = useCallback(
    (index: number, on: boolean) => {
      targetsRef.current[index] = on ? 1 : 0;
      startLoop();
    },
    [startLoop]
  );

  useEffect(() => {
    startLoop();
  }, [active, startLoop]);

  useEffect(
    () => () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    },
    []
  );

  const rootClass = [
    styles.sidebar,
    showMarker ? styles.markers : "",
    scaleTick ? styles.scaleTick : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <nav
      className={rootClass}
      aria-label={ariaLabel}
      style={
        {
          "--accent-color": accentColor,
          "--text-color": textColor,
          "--marker-color": markerColor,
          "--marker-length": `${markerLength}px`,
          "--marker-gap": `${markerGap}px`,
          "--tick-scale": tickScale,
          "--max-shift": `${maxShift}px`,
          "--item-gap": `${itemGap}px`,
          "--font-size": `${fontSize}rem`,
        } as CSSProperties
      }
    >
      <ul
        ref={listRef}
        className={styles.list}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
      >
        {items.map((entry, index) => {
          const label = typeof entry === "string" ? entry : entry.label;
          const idx =
            typeof entry === "string" ? String(index + 1).padStart(2, "0") : entry.index ?? String(index + 1).padStart(2, "0");
          return (
            <li
              key={`${label}-${index}`}
              ref={(el) => {
                itemRefs.current[index] = el;
              }}
              className={styles.item}
            >
              {showMarker && <span className={styles.marker} aria-hidden="true" />}
              <button
                type="button"
                className={styles.label}
                aria-current={active === index ? "true" : undefined}
                onClick={() => handleClick(index, label)}
                onFocus={() => setFocusTarget(index, true)}
                onBlur={() => setFocusTarget(index, false)}
              >
                {showIndex && (
                  <span className={styles.index} aria-hidden="true">
                    {idx}
                  </span>
                )}
                <span>{label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
