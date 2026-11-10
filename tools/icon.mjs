// The app's icons, drawn from the same pixel grids as ui/sprites.js. The art is a terminal prompt
// on the app's own dark: a ">" and the terracotta mochi where the cursor would be, standing on a
// gold cursor with a sprout on its head, two dim lines of earlier output above.
// - src-tauri/icons/icon.icns: the Mac's, shaped like a Mac app icon (a rounded square inside the
//   icon grid's margin, with a soft shadow). Written on a Mac only (it needs iconutil).
// - src-tauri/icons/icon.ico and the PNGs beside it: Windows', the same art on a rounded square
//   that fills the whole image.
// - src-tauri/icons/tray-mac.png: the menu bar icon, a template image (black where drawn, the eyes
//   cut out) that macOS tints for a light or dark menu bar. 42x36 px: the mochi at 3x, and macOS
//   shows it 18pt tall, so on a Retina screen every art pixel is a whole number of screen pixels.
// node tools/icon.mjs
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createCanvas } from '@napi-rs/canvas';
import { MOCHI, EYE_PIXELS, OUTLINE, FLAVOURS, shadeHex } from '../ui/sprites.js';

const icons = new URL('../src-tauri/icons/', import.meta.url).pathname;
const F = FLAVOURS.terracotta;
const COLOURS = { o: OUTLINE, b: F.b, s: F.s, p: F.p, e: OUTLINE, w: '#ffffff', h: shadeHex(F.b, 0.32) };
const eyes = new Map(EYE_PIXELS.map(([x, y, ch]) => [`${x},${y}`, ch]));
const SHINE = new Set(['3,2', '4,2', '2,3']); // a highlight on the crown, only in the app icon

// Every art pixel of the mochi: [x, y, ch] (ch 'e'/'w' are eyes, which are body colour elsewhere).
function pixels() {
  const out = [];
  MOCHI.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === '.') return;
    out.push([x, y, eyes.get(`${x},${y}`) || (ch === 'e' || ch === 'w' ? 'b' : ch)]);
  }));
  return out;
}

// The app icon's art, one canvas pixel per art pixel.
const N = 25;
const SPROUT = ['HHT.....HHT', 'TTTt...TTTt', '.TTtt.tTTt.', '...ttstt...', '.....s.....'];
const LEAF = { H: '#b4dc78', T: '#86b854', t: '#6a9a45', s: '#5f8f3e' };
function art() {
  const c = createCanvas(N, N);
  const g = c.getContext('2d');
  const rect = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
  rect(0, 0, N, N, '#171513'); // the session list's dark (ui/style.css #path)
  for (let y = 1; y < N; y += 2) rect(0, y, N, 1, '#1c1917'); // faint scan lines
  // two lines of earlier output
  rect(2, 3, 2, 1, '#4a6a38'); rect(5, 3, 4, 1, '#3a342e');
  rect(2, 5, 5, 1, '#3a342e');
  // the prompt, its upper arm lit
  for (let i = 0; i < 9; i++) rect(2 + (i < 5 ? i : 8 - i), 9 + i, 2, 1, i < 5 ? '#b5d07e' : '#93b562');
  // the cursor, and the mochi standing on it
  rect(10, 19, 13, 1, '#f6d27a');
  rect(10, 20, 13, 1, '#e3aa40');
  for (const [x, y, ch] of pixels()) rect(10 + x, 8 + y, 1, 1, COLOURS[SHINE.has(`${x},${y}`) ? 'h' : ch]);
  SPROUT.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== '.') rect(11 + x, 3 + y, 1, 1, LEAF[ch]); }));
  return c;
}

// The art on a rounded square, 1024 px. The square's side is a whole number of art pixels.
function master(mac) {
  const c = createCanvas(1024, 1024);
  const g = c.getContext('2d');
  // Mac: Apple's icon grid, a square of about 824 px centred on the 1024 canvas. Windows: edge to edge.
  const P = mac ? 33 : 40, side = N * P, inset = Math.floor((1024 - side) / 2), r = side * (mac ? 185 / 824 : 0.2);
  const square = () => { g.beginPath(); g.roundRect(inset, inset, side, side, r); };
  if (mac) {
    // only the shadow: the square itself is cut back out, so nothing dark shows at its soft edge
    g.shadowColor = 'rgba(0, 0, 0, 0.3)';
    g.shadowBlur = 24;
    g.shadowOffsetY = 10;
    square(); g.fill();
    g.shadowColor = 'transparent';
    g.globalCompositeOperation = 'destination-out';
    square(); g.fill();
    g.globalCompositeOperation = 'source-over';
  }
  square(); g.clip();
  g.imageSmoothingEnabled = false;
  g.drawImage(art(), inset, inset, side, side);
  return c;
}

// A smaller copy: halved while it can be, then one smooth step, so small sizes stay clean.
function png(src, size) {
  let cur = src;
  const smooth = (w) => {
    const c = createCanvas(w, w), g = c.getContext('2d');
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(cur, 0, 0, w, w);
    cur = c;
  };
  while (cur.width / 2 >= size) smooth(cur.width / 2);
  if (cur.width !== size) smooth(size);
  return cur.toBuffer('image/png');
}

// A .ico holding PNG images.
function ico(src, sizes) {
  const images = sizes.map((s) => png(src, s));
  const head = Buffer.alloc(6 + 16 * sizes.length);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(sizes.length, 4);
  let at = head.length;
  sizes.forEach((s, i) => {
    const e = 6 + 16 * i;
    head.writeUInt8(s % 256, e); // 256 is written as 0
    head.writeUInt8(s % 256, e + 1);
    head.writeUInt16LE(1, e + 4);
    head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(images[i].length, e + 8);
    head.writeUInt32LE(at, e + 12);
    at += images[i].length;
  });
  return Buffer.concat([head, ...images]);
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

const win = master(false);
const WIN_PNGS = {
  '32x32': 32, '64x64': 64, '128x128': 128, '128x128@2x': 256, icon: 512, StoreLogo: 50,
  Square30x30Logo: 30, Square44x44Logo: 44, Square71x71Logo: 71, Square89x89Logo: 89, Square107x107Logo: 107,
  Square142x142Logo: 142, Square150x150Logo: 150, Square284x284Logo: 284, Square310x310Logo: 310,
};
for (const [name, size] of Object.entries(WIN_PNGS)) writeFileSync(`${icons}${name}.png`, png(win, size));
writeFileSync(icons + 'icon.ico', ico(win, [16, 24, 32, 48, 64, 256]));
writeFileSync(icons + 'tray-mac.png', trayIcon());

if (process.platform === 'darwin') {
  const mac = master(true);
  const set = mkdtempSync(join(tmpdir(), 'mochi-icon-')) + '/icon.iconset';
  execFileSync('mkdir', [set]);
  for (const pt of [16, 32, 128, 256, 512]) {
    writeFileSync(`${set}/icon_${pt}x${pt}.png`, png(mac, pt));
    writeFileSync(`${set}/icon_${pt}x${pt}@2x.png`, png(mac, pt * 2));
  }
  execFileSync('iconutil', ['-c', 'icns', set, '-o', icons + 'icon.icns']);
  rmSync(join(set, '..'), { recursive: true });
  console.log('wrote icon.icns, icon.ico, the PNGs and tray-mac.png');
} else {
  console.log('wrote icon.ico, the PNGs and tray-mac.png (icon.icns is only written on a Mac)');
}
