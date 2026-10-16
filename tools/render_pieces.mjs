// Render every buildable piece (ui/pieces.js) and variant, a few connected layouts, and the
// construction stages to a labelled PNG sheet, without the app: node tools/render_pieces.mjs <out.png>
// Uses @napi-rs/canvas as the browser canvas; the UI scripts are run as classic scripts sharing globals.
import { readFileSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';
import { createCanvas, Image, loadImage } from '@napi-rs/canvas';
import { asScript } from './ui-script.mjs';

const ui = (f) => new URL('../ui/' + f, import.meta.url);
globalThis.document = { createElement: () => createCanvas(1, 1), hidden: true };
globalThis.Image = Image;
const run = (code, name) => vm.runInThisContext(code, { filename: name });
run(asScript(readFileSync(ui('sprites.js'), 'utf8')), 'sprites.js');
// the garden.js bits pieces.js uses
run(`const TILE = 16;
function hash(x, y, salt = 0) {
  let h = (x * 374761393 + y * 668265263 + salt * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}`, 'garden-bits.js');
// art images decode asynchronously here, so load the ones the pieces use up front
const ART = { lantern_post: await loadImage(readFileSync(ui('art/lantern_post.png'))) };
globalThis.artImage = (name) => ART[name] || new Image();
run(asScript(readFileSync(ui('pieces.js'), 'utf8')), 'pieces.js');
const { PIECES, drawPiece, pieceTextAnchor, mochiSprite } = vm.runInThisContext('({ PIECES, drawPiece, pieceTextAnchor, mochiSprite })');

const T = 16, S = 4; // tile px, output scale
const t = Number(process.argv[3] || 1.3); // animation time

// Layout: rows of cells; each cell is a little garden of placements (tile coords inside the cell).
const cells = [];
const cell = (label, w, h, items, extra) => cells.push({ label, w, h, items, ...extra });
const NEWROW = () => cells.push({ newRow: true });
const sec = (title) => cells.push({ section: title });

sec('ground: single tiles, every variant');
for (const [name, def] of Object.entries(PIECES)) {
  if (def.layer !== 'ground') continue;
  for (const v of def.variants || [null]) cell(v ? `${name}/${v}` : name, 1, 1, [{ name, x: 0, y: 0, variant: v }]);
}
NEWROW();
sec('ground: connected');
const block = (name, pts, variant) => pts.map(([x, y], i) => ({ name, x, y, variant, seed: (i * 0.37) % 1 }));
const rect = (w, h) => { const p = []; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) p.push([x, y]); return p; };
cell('water 3x2 pond', 3, 2, block('water', rect(3, 2)));
cell('water L + 1', 3, 3, block('water', [[0, 0], [1, 0], [2, 0], [0, 1], [0, 2]]));
cell('path L', 3, 3, block('path', [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]]));
cell('soil 2x3', 2, 3, block('soil', rect(2, 3)));
cell('cobble 3x2', 3, 2, block('cobble', rect(3, 2)));
cell('flowers 2x2 mixed', 2, 2, block('flowers', rect(2, 2), 'mixed'));
cell('flowers row white', 3, 1, block('flowers', rect(3, 1), 'white'));
cell('clover 3x2', 3, 2, block('clover', [[0, 0], [1, 0], [0, 1], [1, 1], [2, 1]]));
NEWROW();
sec('objects: every variant (mochi for scale)');
for (const [name, def] of Object.entries(PIECES)) {
  if (def.layer !== 'object' || name === 'shed') continue;
  const [w, h] = def.size || [1, 1];
  for (const v of def.variants || [null]) cell(v ? `${name}/${v}` : name, w, h, [{ name, x: 0, y: 0, variant: v, text: name === 'sign' ? 'hello' : undefined }]);
}
cell('mochi', 1, 1, [], { mochi: true });
NEWROW();
for (const v of PIECES.shed.variants) cell(`shed/${v}`, 2, 2, [{ name: 'shed', x: 0, y: 0, variant: v }]);
NEWROW();
sec('fence runs');
cell('fence run + corner', 4, 3, block('fence', [[0, 0], [1, 0], [2, 0], [3, 0], [3, 1], [3, 2], [2, 2]]));
cell('fence square', 3, 3, block('fence', [[0, 0], [1, 0], [2, 0], [0, 1], [2, 1], [0, 2], [1, 2], [2, 2]]));
cell('scene', 6, 4, [
  ...block('path', [[0, 3], [1, 3], [2, 3], [3, 3], [3, 2], [4, 2], [5, 2]]),
  ...block('water', [[4, 0], [5, 0], [5, 1]]),
  ...block('flowers', [[0, 1], [1, 1]], 'pink'),
  ...block('flowers', [[2, 1]], 'white'),
  { name: 'tree', x: 1, y: 0, variant: 'oak', seed: 0.2 },
  { name: 'bench', x: 1, y: 2 },
  { name: 'lantern', x: 0, y: 2 },
  { name: 'bush', x: 3, y: 1, variant: 'flowering' },
  { name: 'rock', x: 5, y: 3, variant: 'mossy' },
], { mochiAt: [2.2, 2.5] });
NEWROW();
sec('construction: build 0.3 / 0.7');
for (const [name, def] of Object.entries(PIECES)) {
  const [w, h] = def.size || [1, 1];
  for (const b of [0.3, 0.7]) cell(`${name} ${b}`, w, h, [{ name, x: 0, y: 0, variant: def.variants?.[0], build: b }]);
}

// Measure
const PADX = 8, TOPROOM = 36, LABEL = 12, MAXW = 640;
let x = 0, y = 0, rowH = 0;
const placed = [], sections = [];
for (const c of cells) {
  if (c.newRow) { x = 0; y += rowH; rowH = 0; continue; }
  if (c.section) { if (x) { x = 0; y += rowH; rowH = 0; } sections.push({ title: c.section, y }); y += 10; continue; }
  const cw = c.w * T + PADX * 2, ch = c.h * T + TOPROOM + LABEL;
  if (x + cw > MAXW) { x = 0; y += rowH; rowH = 0; }
  placed.push({ ...c, ox: x + PADX, oy: y + TOPROOM, cw });
  x += cw;
  rowH = Math.max(rowH, ch);
}
const W = MAXW, H = y + rowH + 4;

// Grass
const cv = createCanvas(W, H), g = cv.getContext('2d');
g.fillStyle = '#a7c274';
g.fillRect(0, 0, W, H);
const specks = ['#b2ca80', '#9cb768', '#a0bb6c', '#b0c87e'];
for (let i = 0; i < (W * H) / 14; i++) {
  g.fillStyle = specks[i % 4];
  g.fillRect(Math.floor(Math.random() * W), Math.floor(Math.random() * H), 1, 1);
}
for (const s of sections) { g.fillStyle = '#8fae5e'; g.fillRect(0, s.y, W, 1); }

const signs = [];
for (const c of placed) {
  const at = new Map(c.items.map((it) => [it.name + ':' + it.x + ',' + it.y, true]));
  const opts = (it) => ({ variant: it.variant, text: it.text, t, seed: it.seed ?? 0.3, build: it.build ?? 1, same: (dx, dy) => at.has(it.name + ':' + (it.x + dx) + ',' + (it.y + dy)) });
  const ground = c.items.filter((it) => PIECES[it.name].layer === 'ground');
  const objs = c.items.filter((it) => PIECES[it.name].layer === 'object');
  for (const it of ground) drawPiece(g, it.name, c.ox + it.x * T, c.oy + it.y * T, opts(it));
  const draws = objs.map((it) => ({ y: c.oy + (it.y + (PIECES[it.name].size || [1, 1])[1]) * T, f: () => drawPiece(g, it.name, c.ox + it.x * T, c.oy + it.y * T, opts(it)) }));
  const m = c.mochi ? [1 / 16, 0.2] : c.mochiAt;
  if (m) {
    const spr = mochiSprite('terracotta', 'idle');
    const mx = Math.round(c.ox + m[0] * T), my = Math.round(c.oy + m[1] * T);
    draws.push({ y: my + spr.height, f: () => { g.fillStyle = 'rgba(40, 50, 20, 0.25)'; g.fillRect(mx + 2, my + 10, 9, 2); g.drawImage(spr, mx, my); } });
  }
  draws.sort((a, b) => a.y - b.y).forEach((d) => d.f());
  for (const it of objs) if (it.text) signs.push({ ...pieceTextAnchor(it.name, c.ox + it.x * T, c.oy + it.y * T), text: it.text });
}

// Scale up and label
const out = createCanvas(W * S, H * S), o = out.getContext('2d');
o.imageSmoothingEnabled = false;
o.drawImage(cv, 0, 0, W * S, H * S);
o.textBaseline = 'top';
o.font = 'bold 22px Consolas, monospace';
for (const s of sections) {
  o.fillStyle = '#3a2218';
  o.fillText(s.title, 8, s.y * S + 6);
}
o.font = '17px Consolas, monospace';
for (const c of placed) {
  const ly = (c.oy + c.h * T + 2) * S;
  o.fillStyle = 'rgba(58, 34, 24, 0.75)';
  const tw = o.measureText(c.label).width + 8;
  o.fillRect((c.ox - PADX + 2) * S, ly, tw, 22);
  o.fillStyle = '#fff7e0';
  o.fillText(c.label, (c.ox - PADX + 2) * S + 4, ly + 2);
}
o.font = 'bold 16px Consolas, monospace';
for (const s of signs) {
  const tw = o.measureText(s.text).width + 8;
  o.fillStyle = '#fbf6e6';
  o.fillRect(s.x * S - tw / 2, s.y * S - 10, tw, 20);
  o.fillStyle = '#3a2218';
  o.fillText(s.text, s.x * S - tw / 2 + 4, s.y * S - 8);
}
writeFileSync(process.argv[2], out.toBuffer('image/png'));
console.log('->', process.argv[2], W * S + 'x' + H * S);
