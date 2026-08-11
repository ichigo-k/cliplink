"use client";

import { useRef, useState, useEffect, useCallback, type CSSProperties, type ReactNode } from "react";
import { motion, useInView } from "motion/react";
import styles from "./AnimatedList.module.css";

function AnimatedItem({
  children,
  delay = 0,
  index,
  amount,
  once,
  duration,
  onMouseEnter,
  onClick,
}: {
  children: ReactNode;
  delay?: number;
  index: number;
  amount: number;
  once: boolean;
  duration: number;
  onMouseEnter?: () => void;
  onClick?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount, once });
  return (
    <motion.div
      ref={ref}
      className={styles.row}
      data-index={index}
      onMouseEnter={onMouseEnter}
      onClick={onClick}
      initial={{ scale: 0.7, opacity: 0 }}
      animate={inView ? { scale: 1, opacity: 1 } : { scale: 0.7, opacity: 0 }}
      transition={{ duration, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}

export interface AnimatedListProps<T> {
  items: T[];
  /** Falls back to rendering the item as text. */
  renderItem?: (item: T, index: number, selected: boolean) => ReactNode;
  getKey?: (item: T, index: number) => string | number;
  onItemSelect?: (item: T, index: number) => void;
  showGradients?: boolean;
  /** Arrow / Enter navigation, scoped to the list — it never hijacks page keys. */
  enableArrowNavigation?: boolean;
  className?: string;
  displayScrollbar?: boolean;
  initialSelectedIndex?: number;
  /** Any CSS length; the list scrolls past it. */
  maxHeight?: string;
  /** Fill the flex parent's height instead of using `maxHeight`. */
  fill?: boolean;
  padding?: string;
  itemGap?: string;
  /** Colour the top and bottom fades dissolve into. */
  fadeColor?: string;
  /**
   * Fraction of a row that must be visible before it animates in. Keep this low
   * for a list inside a short scroller — at 0.5 a row taller than half the
   * visible area can never qualify and stays hidden.
   */
  amount?: number;
  /** Settle once a row has appeared, instead of fading it back out. */
  once?: boolean;
  /** Set false for a page-level list that should not become its own scroller. */
  scroll?: boolean;
  /**
   * Seconds added per row so the list reveals in sequence. Upstream applies one
   * flat delay to every row, which lands as a single blink rather than a list
   * arriving. Capped so a long list never leaves the last rows waiting.
   */
  stagger?: number;
  /** Seconds each row takes to arrive. */
  duration?: number;
}

export default function AnimatedList<T>({
  items,
  renderItem,
  getKey,
  onItemSelect,
  showGradients = true,
  enableArrowNavigation = true,
  className = "",
  displayScrollbar = true,
  initialSelectedIndex = -1,
  maxHeight,
  fill = false,
  padding,
  itemGap,
  fadeColor,
  amount = 0.5,
  once = false,
  scroll = true,
  stagger = 0,
  duration = 0.2,
}: AnimatedListProps<T>) {
  const listRef = useRef<HTMLDivElement>(null);
  const [selectedIndex, setSelectedIndex] = useState(initialSelectedIndex);
  const [keyboardNav, setKeyboardNav] = useState(false);
  const [topGradientOpacity, setTopGradientOpacity] = useState(0);
  const [bottomGradientOpacity, setBottomGradientOpacity] = useState(0);

  const handleItemMouseEnter = useCallback((index: number) => setSelectedIndex(index), []);

  const handleItemClick = useCallback(
    (item: T, index: number) => {
      setSelectedIndex(index);
      onItemSelect?.(item, index);
    },
    [onItemSelect]
  );

  // Both fades are derived from scroll position, so a list that does not
  // overflow — or has not been scrolled yet — shows neither.
  const measureFades = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    setTopGradientOpacity(Math.min(scrollTop / 50, 1));
    const bottomDistance = scrollHeight - (scrollTop + clientHeight);
    setBottomGradientOpacity(scrollHeight <= clientHeight ? 0 : Math.min(bottomDistance / 50, 1));
  }, []);

  useEffect(() => {
    measureFades();
    const el = listRef.current;
    if (!el) return;
    const ro = new ResizeObserver(measureFades);
    ro.observe(el);
    return () => ro.disconnect();
  }, [items, measureFades]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (!enableArrowNavigation) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setKeyboardNav(true);
        setSelectedIndex((prev) => Math.min(prev + 1, items.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setKeyboardNav(true);
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === "Enter") {
        if (selectedIndex >= 0 && selectedIndex < items.length) {
          e.preventDefault();
          onItemSelect?.(items[selectedIndex], selectedIndex);
        }
      }
    },
    [enableArrowNavigation, items, selectedIndex, onItemSelect]
  );

  useEffect(() => {
    if (!keyboardNav || selectedIndex < 0 || !listRef.current) return;
    const container = listRef.current;
    const selectedItem = container.querySelector<HTMLElement>(`[data-index="${selectedIndex}"]`);
    if (selectedItem) {
      const extraMargin = 50;
      const containerScrollTop = container.scrollTop;
      const containerHeight = container.clientHeight;
      const itemTop = selectedItem.offsetTop;
      const itemBottom = itemTop + selectedItem.offsetHeight;
      if (itemTop < containerScrollTop + extraMargin) {
        container.scrollTo({ top: itemTop - extraMargin, behavior: "smooth" });
      } else if (itemBottom > containerScrollTop + containerHeight - extraMargin) {
        container.scrollTo({ top: itemBottom - containerHeight + extraMargin, behavior: "smooth" });
      }
    }
    setKeyboardNav(false);
  }, [selectedIndex, keyboardNav]);

  const style = {
    ...(maxHeight ? { "--al-max-height": maxHeight } : {}),
    ...(padding ? { "--al-padding": padding } : {}),
    ...(itemGap ? { "--al-item-gap": itemGap } : {}),
    ...(fadeColor ? { "--al-fade": fadeColor } : {}),
    ...(scroll ? {} : { "--al-overflow": "visible" }),
  } as CSSProperties;

  return (
    <div
      className={`${styles.container} ${fill ? styles.fill : ""} ${className}`.trim()}
      style={style}
    >
      <div
        ref={listRef}
        className={`${styles.list} ${displayScrollbar ? "" : styles.noScrollbar}`.trim()}
        onScroll={measureFades}
        onKeyDown={handleKeyDown}
        tabIndex={enableArrowNavigation ? 0 : undefined}
      >
        {items.map((item, index) => (
          <AnimatedItem
            key={getKey ? getKey(item, index) : index}
            delay={stagger ? Math.min(index * stagger, 0.6) : 0.1}
            index={index}
            amount={amount}
            once={once}
            duration={duration}
            onMouseEnter={() => handleItemMouseEnter(index)}
            onClick={() => handleItemClick(item, index)}
          >
            {renderItem ? renderItem(item, index, selectedIndex === index) : String(item)}
          </AnimatedItem>
        ))}
      </div>
      {showGradients && (
        <>
          <div className={styles.topGradient} style={{ opacity: topGradientOpacity }} />
          <div className={styles.bottomGradient} style={{ opacity: bottomGradientOpacity }} />
        </>
      )}
    </div>
  );
}
