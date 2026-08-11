export const SITE = {
  repo: "https://github.com/ichigo-k/cliplink",
  issues: "https://github.com/ichigo-k/cliplink/issues",
  releases: "https://github.com/ichigo-k/cliplink/releases/latest",
  contribution: "/contribution",
  /** Fallback only — the live version comes from `fetchLatestRelease()`. */
  version: "v0.1.19",
} as const;

export const NAV = [
  { id: "features", label: "Features", index: "01" },
  { id: "simulator", label: "Demo", index: "02" },
  { id: "security", label: "Security", index: "03" },
  { id: "contributors", label: "Contributors", index: "04" },
  { id: "downloads", label: "Download", index: "05" },
] as const;

/** Smooth-scroll to a section, accounting for the fixed header. */
export function scrollToSection(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const top = el.getBoundingClientRect().top + window.scrollY - 72;
  window.scrollTo({ top, behavior: "smooth" });
}
