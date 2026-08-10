"use client";

import { useState, useEffect } from "react";
import { Menu, X } from "lucide-react";
import { GithubIcon, LogoMark, Wordmark } from "./brand";
import { NAV, SITE, scrollToSection } from "@/lib/site";

export default function Header() {
  const [isOpen, setIsOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 12);
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setProgress(max > 0 ? Math.min(1, window.scrollY / max) : 0);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Highlight whichever section owns the upper third of the viewport.
  useEffect(() => {
    const sections = NAV.map((n) => document.getElementById(n.id)).filter(
      (el): el is HTMLElement => Boolean(el)
    );
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setActive(visible.target.id);
      },
      { rootMargin: "-20% 0px -70% 0px", threshold: 0 }
    );
    sections.forEach((s) => observer.observe(s));
    return () => observer.disconnect();
  }, []);

  // While the sheet is up: lock the page behind it, close on Escape, and bail
  // out if the viewport grows into the desktop layout.
  useEffect(() => {
    if (!isOpen) return;
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";

    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setIsOpen(false);
    const mq = window.matchMedia("(min-width: 1024px)");
    const onWide = () => mq.matches && setIsOpen(false);

    window.addEventListener("keydown", onKey);
    mq.addEventListener("change", onWide);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener("keydown", onKey);
      mq.removeEventListener("change", onWide);
    };
  }, [isOpen]);

  const go = (id: string) => {
    setIsOpen(false);
    // Wait for the scroll lock to lift before moving the page.
    requestAnimationFrame(() => requestAnimationFrame(() => scrollToSection(id)));
  };

  return (
    <header className="fixed inset-x-0 top-0 z-50">
      <div
        className={`transition-colors duration-300 ${
          scrolled
            ? "bg-canvas/80 backdrop-blur-xl border-b hairline"
            : "border-b border-transparent"
        }`}
      >
        <div className="shell">
          <div className="flex h-16 items-center justify-between gap-6">
            {/* Brand */}
            <button
              onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
              className="group flex items-center gap-2.5 cursor-pointer"
              aria-label="Back to top"
            >
              <LogoMark className="w-8 h-8 transition-transform duration-300 group-hover:-rotate-6" />
              <Wordmark className="text-[17px]" />
            </button>

            {/* Desktop nav */}
            <nav className="hidden lg:flex items-center gap-1">
              {NAV.map((item) => {
                const isActive = active === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => go(item.id)}
                    className={`relative px-3 py-2 text-[13px] font-medium transition-colors cursor-pointer ${
                      isActive ? "text-ink-50" : "text-ink-400 hover:text-ink-100"
                    }`}
                  >
                    {item.label}
                    <span
                      className={`absolute inset-x-3 -bottom-px h-px bg-signal-400 origin-left transition-transform duration-300 ${
                        isActive ? "scale-x-100" : "scale-x-0"
                      }`}
                    />
                  </button>
                );
              })}
            </nav>

            {/* Actions */}
            <div className="hidden lg:flex items-center gap-2">
              <a
                href={SITE.repo}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 rounded-md border hairline px-3 py-2 text-[13px] font-medium text-ink-300 hover:text-ink-50 hover:bg-ink-900 transition-colors"
              >
                <GithubIcon className="w-4 h-4" />
                <span>Source</span>
              </a>
              <button
                onClick={() => go("downloads")}
                className="rounded-md bg-signal-500 px-4 py-2 text-[13px] font-semibold text-canvas hover:bg-signal-400 transition-colors cursor-pointer"
              >
                Download
              </button>
            </div>

            {/* Mobile toggle */}
            <button
              onClick={() => setIsOpen((v) => !v)}
              className="lg:hidden -mr-2 p-2 text-ink-300 hover:text-ink-50 transition-colors"
              aria-label={isOpen ? "Close menu" : "Open menu"}
              aria-expanded={isOpen}
            >
              {isOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Reading progress */}
        <div
          className="h-px bg-signal-500 origin-left transition-transform duration-150"
          style={{ transform: `scaleX(${progress})` }}
        />
      </div>

      {/* Mobile sheet — a real panel, not a max-height accordion */}
      <div
        className={`fixed inset-x-0 bottom-0 top-16 z-40 lg:hidden ${
          isOpen ? "pointer-events-auto" : "pointer-events-none"
        }`}
        aria-hidden={!isOpen}
      >
        <button
          tabIndex={-1}
          aria-hidden="true"
          onClick={() => setIsOpen(false)}
          className={`absolute inset-0 h-full w-full bg-canvas/70 backdrop-blur-sm transition-opacity duration-300 ${
            isOpen ? "opacity-100" : "opacity-0"
          }`}
        />

        <div
          className={`absolute inset-x-0 top-0 max-h-full overflow-y-auto border-b hairline bg-canvas/98 backdrop-blur-xl transition-all duration-300 ease-[var(--ease-out-expo)] ${
            isOpen ? "translate-y-0 opacity-100" : "-translate-y-3 opacity-0"
          }`}
        >
          <div className="shell py-3 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
            {NAV.map((item) => (
              <button
                key={item.id}
                onClick={() => go(item.id)}
                className="flex w-full items-center gap-4 border-b hairline py-4 text-left text-[16px] font-medium text-ink-200 transition-colors active:text-signal-400"
              >
                <span className="eyebrow text-ink-600">{item.index}</span>
                <span className="flex-1">{item.label}</span>
                {active === item.id && (
                  <span className="h-1.5 w-1.5 rounded-full bg-signal-400" />
                )}
              </button>
            ))}

            <div className="mt-5 flex flex-col gap-2.5">
              <button
                onClick={() => go("downloads")}
                className="rounded-md bg-signal-500 py-3.5 text-[15px] font-semibold text-canvas"
              >
                Download {SITE.version}
              </button>
              <a
                href={SITE.repo}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setIsOpen(false)}
                className="flex items-center justify-center gap-2 rounded-md border hairline py-3.5 text-[15px] font-medium text-ink-200"
              >
                <GithubIcon className="w-4 h-4" />
                View source
              </a>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
