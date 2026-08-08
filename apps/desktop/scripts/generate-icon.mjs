/**
 * Draws ClipLink's source icon as a 1024x1024 PNG.
 *
 * Written by hand rather than committed as a binary blob so the mark can be
 * tweaked in a reviewable diff. Run `npx tauri icon src-tauri/icons/source.png`
 * afterwards to derive the .ico/.icns/png set the bundler needs.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const SIZE = 1024;
const SAMPLES = 3; // supersampling factor per axis, for smooth edges

const INK = [16, 37, 30]; // deep green background
const ACCENT = [28, 126, 88]; // brand green
const PAPER = [248, 252, 250];

/** Signed distance to a rounded rectangle, negative inside. */
function roundedRect(px, py, cx, cy, w, h, r) {
  const dx = Math.abs(px - cx) - (w / 2 - r);
  const dy = Math.abs(py - cy) - (h / 2 - r);
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  return outside + Math.min(Math.max(dx, dy), 0) - r;
}

function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

/** Colour and coverage of one sample point. */
function sample(x, y) {
  const bg = roundedRect(x, y, 512, 512, 1024, 1024, 230);
  if (bg > 0) return null;

  // Clipboard body, with the top tab cut in as a separate rounded rect.
  const body = roundedRect(x, y, 512, 545, 470, 560, 70);
  const tab = roundedRect(x, y, 512, 250, 250, 150, 55);

  if (body < 0) {
    // Two text lines, suggesting copied content.
    const line1 = roundedRect(x, y, 512, 520, 300, 46, 23);
    const line2 = roundedRect(x, y, 470, 640, 216, 46, 23);
    if (line1 < 0 || line2 < 0) return ACCENT;
    return PAPER;
  }
  if (tab < 0) return PAPER;

  // Background gradient runs top-left to bottom-right.
  return mix(INK, ACCENT, (x + y) / (SIZE * 2));
}

const pixels = Buffer.alloc(SIZE * SIZE * 4);

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    let r = 0;
    let g = 0;
    let b = 0;
    let hits = 0;

    for (let sy = 0; sy < SAMPLES; sy++) {
      for (let sx = 0; sx < SAMPLES; sx++) {
        const c = sample(x + (sx + 0.5) / SAMPLES, y + (sy + 0.5) / SAMPLES);
        if (!c) continue;
        r += c[0];
        g += c[1];
        b += c[2];
        hits++;
      }
    }

    const total = SAMPLES * SAMPLES;
    const i = (y * SIZE + x) * 4;
    if (hits === 0) continue; // fully transparent corner

    pixels[i] = Math.round(r / hits);
    pixels[i + 1] = Math.round(g / hits);
    pixels[i + 2] = Math.round(b / hits);
    pixels[i + 3] = Math.round((hits / total) * 255);
  }
}

// --- Minimal PNG encoder (truecolour + alpha, no interlacing) ---

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);

  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));

  return Buffer.concat([length, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // colour type: RGBA
// bytes 10-12 stay zero: deflate, adaptive filtering, no interlace

// Each scanline is prefixed with its filter type; 0 means "none".
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  const at = y * (SIZE * 4 + 1);
  raw[at] = 0;
  pixels.copy(raw, at + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = resolve(process.argv[2] ?? 'src-tauri/icons/source.png');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, png);
console.log(`Wrote ${out} (${SIZE}x${SIZE}, ${(png.length / 1024).toFixed(1)} KiB)`);
