"use client";

import type { ReactNode } from "react";
import GradientText from "./reactbits/GradientText";

// Theme variables rather than literals, so the same component reads as a bright
// green on the dark bands and as the darker, accessible green on `.paper`.
const RAMP = [
  "var(--color-signal-400)",
  "var(--color-signal-300)",
  "var(--color-signal-600)",
];

/**
 * The highlighted phrase in a section headline. Replaces a flat
 * `text-signal-400` span with the same colour drifting across the word.
 */
export default function Accent({ children }: { children: ReactNode }) {
  return (
    <GradientText
      inline
      colors={RAMP}
      animationSpeed={7}
      staticColor="var(--color-signal-400)"
    >
      {children}
    </GradientText>
  );
}
