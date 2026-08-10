/**
 * Shared palette. Lives here rather than in App.tsx so screens split out of it
 * (Settings, and anything after) stay visually identical without importing
 * from the component that renders them.
 */
export const C = {
  void: '#111111',
  layer: '#1a1a1a',
  card: '#1e1e1e',
  cardAlt: '#242424',
  input: '#161616',
  edge: 'rgba(255,255,255,0.06)',
  edgeBright: 'rgba(255,255,255,0.11)',
  text: '#f2f2f2',
  muted: '#888888',
  faint: '#444444',
  accent: '#22C55E',
  accentLt: '#4ADE80',
  green: '#4ADE80',
  greenBg: 'rgba(74,222,128,0.10)',
  danger: '#FF6B6B',
};
