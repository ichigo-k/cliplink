"use client";

import { useState, useCallback, useEffect, useRef, type ReactNode } from "react";
import {
  motion,
  useMotionValue,
  useAnimationFrame,
  useTransform,
  useReducedMotion,
} from "motion/react";
import styles from "./GradientText.module.css";

export interface GradientTextProps {
  children: ReactNode;
  className?: string;
  colors?: string[];
  /** Duration of one animation cycle, in seconds. */
  animationSpeed?: number;
  showBorder?: boolean;
  direction?: "horizontal" | "vertical" | "diagonal";
  pauseOnHover?: boolean;
  /** Reverse at the end of a cycle instead of looping back to the start. */
  yoyo?: boolean;
  /** Render as a word inside running text rather than as its own block. */
  inline?: boolean;
  /** Colour used when the visitor has asked for reduced motion. */
  staticColor?: string;
}

export default function GradientText({
  children,
  className = "",
  colors = ["#5227FF", "#FF9FFC", "#B497CF"],
  animationSpeed = 8,
  showBorder = false,
  direction = "horizontal",
  pauseOnHover = false,
  yoyo = true,
  inline = false,
  staticColor,
}: GradientTextProps) {
  const [hoverPaused, setHoverPaused] = useState(false);
  // The stylesheet drops the gradient entirely under reduced motion, so there
  // is nothing for the frame loop to drive — stop it rather than spin it.
  const reduced = useReducedMotion();
  const isPaused = hoverPaused || Boolean(reduced);
  const progress = useMotionValue(0);
  const elapsedRef = useRef(0);
  const lastTimeRef = useRef<number | null>(null);

  const animationDuration = animationSpeed * 1000;

  useAnimationFrame((time) => {
    if (isPaused) {
      lastTimeRef.current = null;
      return;
    }

    if (lastTimeRef.current === null) {
      lastTimeRef.current = time;
      return;
    }

    const deltaTime = time - lastTimeRef.current;
    lastTimeRef.current = time;
    elapsedRef.current += deltaTime;

    if (yoyo) {
      const fullCycle = animationDuration * 2;
      const cycleTime = elapsedRef.current % fullCycle;

      if (cycleTime < animationDuration) {
        progress.set((cycleTime / animationDuration) * 100);
      } else {
        progress.set(100 - ((cycleTime - animationDuration) / animationDuration) * 100);
      }
    } else {
      // Keep climbing so the duplicated end colour makes the loop seamless.
      progress.set((elapsedRef.current / animationDuration) * 100);
    }
  });

  useEffect(() => {
    elapsedRef.current = 0;
    progress.set(0);
  }, [animationSpeed, progress, yoyo]);

  const backgroundPosition = useTransform(progress, (p) =>
    direction === "vertical" ? `50% ${p}%` : `${p}% 50%`
  );

  const handleMouseEnter = useCallback(() => {
    if (pauseOnHover) setHoverPaused(true);
  }, [pauseOnHover]);

  const handleMouseLeave = useCallback(() => {
    if (pauseOnHover) setHoverPaused(false);
  }, [pauseOnHover]);

  const gradientAngle =
    direction === "horizontal"
      ? "to right"
      : direction === "vertical"
        ? "to bottom"
        : "to bottom right";

  // Repeating the first colour at the tail makes the wrap-around invisible.
  const gradientColors = [...colors, colors[0]].join(", ");

  const gradientStyle = {
    backgroundImage: `linear-gradient(${gradientAngle}, ${gradientColors})`,
    backgroundSize:
      direction === "horizontal"
        ? "300% 100%"
        : direction === "vertical"
          ? "100% 300%"
          : "300% 300%",
    backgroundRepeat: "repeat",
  } as const;

  const rootClass = [
    styles.root,
    inline ? styles.inline : "",
    showBorder ? styles.withBorder : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const Wrapper = inline ? motion.span : motion.div;
  const Inner = inline ? motion.span : motion.div;

  return (
    <Wrapper
      className={rootClass}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{ ["--gt-static" as string]: staticColor ?? colors[0] }}
    >
      {showBorder && (
        <motion.div className={styles.overlay} style={{ ...gradientStyle, backgroundPosition }} />
      )}
      <Inner className={styles.text} style={{ ...gradientStyle, backgroundPosition }}>
        {children}
      </Inner>
    </Wrapper>
  );
}
