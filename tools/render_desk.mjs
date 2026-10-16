// Render the hand-pixelled desk + typewriter (ui/desk.js) to a PNG, without the app, to check the
// pixels: node tools/render_desk.mjs <out.png>
// A tiny canvas stand-in records fillRect calls into a pixel buffer.
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { asScript } from './ui-script.mjs';

const W = 60, H = 48, OX = 8, OY = 14;
const buf = new Uint8Array(W * H * 4);
const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const g = {
  fillStyle: '#000000', globalAlpha: 1,
  fillRect(x, y, w, h) {
    const [r, gg, b] = hex(this.fillStyle);
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      const i = (yy * W + xx) * 4;
      buf.set([r, gg, b, 255], i);
    }
  },
  save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, drawImage() {},
};
const src = asScript(readFileSync(new URL('../ui/desk.js', import.meta.url), 'utf8'));
const api = new Function('TILE', 'atHome', 'prop', 'PLANK', 'Sound', 'tone', 'document', src + '; return { drawDeskBody, drawTypewriter };');
const { drawDeskBody, drawTypewriter } = api(16, () => true, () => null, null, { on: false }, () => {}, { hidden: true });
// grass behind, so the outline reads like in the game
g.fillStyle = '#a7c274';
g.fillRect(0, 0, W, H);
drawDeskBody(g, OX, OY);
drawTypewriter(g, { tw: { col: 6, line: 2, key: 3, keyAt: 1e9, dingAt: -1 } }, OX + 12, OY + 5, 0);

// PNG at 10x
const S = 10, w = W * S, h = H * S;
const raw = Buffer.alloc((w * 4 + 1) * h);
for (let y = 0; y < h; y++) {
  raw[y * (w * 4 + 1)] = 0;
  for (let x = 0; x < w; x++) {
    const i = ((Math.floor(y / S) * W) + Math.floor(x / S)) * 4;
    buf.copy ? 0 : 0;
    raw.set(buf.subarray(i, i + 4), y * (w * 4 + 1) + 1 + x * 4);
  }
}
const crc = (b) => { let c = ~0; for (const v of b) { c ^= v; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
writeFileSync(process.argv[2], Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
console.log('->', process.argv[2]);
