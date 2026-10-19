// The Mac's icons, from the same pixel grid as ui/sprites.js (tools/icon.py draws the Windows ones):
// - src-tauri/icons/icon.icns: the terracotta mochi on a sage tile, but shaped like a Mac app icon
//   (a rounded square inside the icon grid's margin, with a soft shadow), not a full-bleed square.
// - src-tauri/icons/tray-mac.png: the menu bar icon, a template image (black where drawn, the eyes
//   cut out) that macOS tints for a light or dark menu bar. 42x36 px: the mochi at 3x, and macOS
//   shows it 18pt tall, so on a Retina screen every art pixel is a whole number of screen pixels.
// node tools/icon_mac.mjs
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createCanvas } from '@napi-rs/canvas';
import { MOCHI, EYE_PIXELS, OUTLINE } from '../ui/sprites.js';

const icons = new URL('../src-tauri/icons/', import.meta.url).pathname;
const COLOURS = { o: OUTLINE, b: '#d97757', s: '#b85c3e', p: '#f49aab', e: OUTLINE, w: '#ffffff' };
const eyes = new Map(EYE_PIXELS.map(([x, y, ch]) => [`${x},${y}`, ch]));

// Every art pixel of the mochi: [x, y, ch] (ch 'e'/'w' are eyes, which are body colour elsewhere).
function pixels() {
  const out = [];
  MOCHI.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === '.') return;
    out.push([x, y, eyes.get(`${x},${y}`) || (ch === 'e' || ch === 'w' ? 'b' : ch)]);
  }));
  return out;
}

function appIcon(size) {
  const c = createCanvas(size, size);
  const g = c.getContext('2d');
  const k = size / 1024;
  // Apple's macOS icon grid: an 824 px rounded square centred on the 1024 canvas
  const inset = 100 * k, side = 824 * k, r = 185 * k;
  g.shadowColor = 'rgba(0, 0, 0, 0.28)';
  g.shadowBlur = 24 * k;
  g.shadowOffsetY = 10 * k;
  g.fillStyle = '#a6c172';
  g.beginPath();
  g.roundRect(inset, inset, side, side, r);
  g.fill();
  g.shadowColor = 'transparent';
  const S = Math.max(1, Math.round(44 * k));
  const ox = Math.round((size - 13 * S) / 2), oy = Math.round((size - 11 * S) / 2 + 14 * k);
  for (const [x, y, ch] of pixels()) {
    g.fillStyle = COLOURS[ch];
    g.fillRect(ox + x * S, oy + y * S, S, S);
  }
  return c.toBuffer('image/png');
}

function trayIcon() {
  const S = 3, c = createCanvas(42, 36);
  const g = c.getContext('2d');
  g.fillStyle = '#000000';
  for (const [x, y, ch] of pixels()) {
    if (ch === 'e' || ch === 'w') continue; // the eyes stay see-through
    g.fillRect(1 + x * S, 2 + y * S, S, S);
  }
  return c.toBuffer('image/png');
}

const set = mkdtempSync(join(tmpdir(), 'mochi-icon-')) + '/icon.iconset';
execFileSync('mkdir', [set]);
for (const pt of [16, 32, 128, 256, 512]) {
  writeFileSync(`${set}/icon_${pt}x${pt}.png`, appIcon(pt));
  writeFileSync(`${set}/icon_${pt}x${pt}@2x.png`, appIcon(pt * 2));
}
execFileSync('iconutil', ['-c', 'icns', set, '-o', icons + 'icon.icns']);
rmSync(join(set, '..'), { recursive: true });
writeFileSync(icons + 'tray-mac.png', trayIcon());
console.log('wrote icon.icns and tray-mac.png');
