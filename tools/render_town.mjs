// Render the town square (ui/town.js) at each growth stage, without the app:
// node tools/render_town.mjs <out.png> [old-town.js]
// With an old town.js, each stage is shown old | new side by side. 4x, labelled, with a mochi for scale.
// Uses @napi-rs/canvas as the browser canvas; each version runs in its own context of shared globals.
import { readFileSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';
import { createCanvas } from '@napi-rs/canvas';

const ui = (f) => new URL('../ui/' + f, import.meta.url);
const S = 4, TW = 10, TH = 8, W = TW * 16, H = TH * 16, SX = 1, SY = 2; // panel in tiles, square's tile
const GARDEN_BITS = `
const TILE = 16;
function hash(x, y, salt = 0) {
  let h = (x * 374761393 + y * 668265263 + salt * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const Garden = { plots: [{ x: 0, y: 0, tokens: 0 }], square: { x: ${SX}, y: ${SY} }, S: ${S} };
const fmtTokens = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : Math.round(n / 1e3) + 'k');
`;

function world(townSrc) {
  const ctx = vm.createContext({ document: { createElement: () => createCanvas(1, 1), hidden: true }, Math, console });
  for (const [name, src] of [['sprites.js', readFileSync(ui('sprites.js'), 'utf8')], ['garden-bits.js', GARDEN_BITS], ['pieces.js', readFileSync(ui('pieces.js'), 'utf8')], ['town.js', townSrc]]) vm.runInContext(src, ctx, { filename: name });
  return vm.runInContext('({ Garden, townItems, drawSquareGround, drawTownLights, drawTownSign, mochiSprite, TOWN, townLightSpots: typeof townLightSpots === "function" ? townLightSpots : null })', ctx);
}

// One panel: grass, the square at total tokens T, a visiting mochi, optional night tint.
function panel(w, T, night, t = 1.2) {
  w.Garden.plots[0].tokens = T;
  const cv = createCanvas(W, H), g = cv.getContext('2d');
  g.fillStyle = '#a7c274';
  g.fillRect(0, 0, W, H);
  const specks = ['#b2ca80', '#9cb768', '#a0bb6c', '#b0c87e'];
  for (let i = 0; i < (W * H) / 14; i++) {
    g.fillStyle = specks[i % 4];
    g.fillRect(Math.floor(((i * 7919) % 9973) / 9973 * W), Math.floor(((i * 104729) % 7919) / 7919 * H), 1, 1);
  }
  w.drawSquareGround(g);
  const X = SX * 16, Y = SY * 16;
  const items = w.townItems(t).map((it) => ({ y: it.y, draw: () => it.draw(g) }));
  // a mochi visiting, where social.js parks them
  const mx = X + 48, my = Y + 36, spr = w.mochiSprite('terracotta', 'idle');
  items.push({ y: my + 11, draw: () => { g.fillStyle = 'rgba(40, 50, 20, 0.25)'; g.fillRect(mx + 2, my + 10, 9, 2); g.drawImage(spr, mx, my); } });
  items.sort((a, b) => a.y - b.y).forEach((i) => i.draw());
  w.drawTownLights(g, t);
  if (night) {
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = 'rgb(120, 118, 176)';
    g.fillRect(0, 0, W, H);
    // the glow sky.js could add for each bulb (it does this for lanterns), if town.js exposes them
    g.globalCompositeOperation = 'lighter';
    for (const b of w.townLightSpots ? w.townLightSpots() : []) {
      const grad = g.createRadialGradient(b.x, b.y, 0, b.x, b.y, 10);
      grad.addColorStop(0, 'rgba(255, 210, 130, 0.35)');
      grad.addColorStop(1, 'rgba(255, 210, 130, 0)');
      g.fillStyle = grad;
      g.fillRect(b.x - 10, b.y - 10, 20, 20);
    }
    g.globalCompositeOperation = 'source-over';
  }
  const out = createCanvas(W * S, H * S), o = out.getContext('2d');
  o.imageSmoothingEnabled = false;
  o.drawImage(cv, 0, 0, W * S, H * S);
  w.drawTownSign(o);
  return out;
}

const fresh = world(readFileSync(ui('town.js'), 'utf8'));
const old = process.argv[3] ? world(readFileSync(process.argv[3], 'utf8')) : null;
const TOWN = fresh.TOWN;
const stages = [
  ['just the notice board', 400e3],
  ['+ well', TOWN.well],
  ['+ statue', TOWN.statue],
  ['+ string lights (day)', TOWN.lights],
  ['+ string lights (dusk tint, as sky.js does)', TOWN.lights, true],
  ['+ blossom tree', TOWN.tree],
  ['+ market stall (everything)', TOWN.stall],
];
const cols = old ? 2 : 1, PAD = 16, LAB = 34;
const sheet = createCanvas(cols * (W * S + PAD) + PAD, stages.length * (H * S + LAB + PAD) + PAD), sg = sheet.getContext('2d');
sg.fillStyle = '#efe6cf';
sg.fillRect(0, 0, sheet.width, sheet.height);
sg.textBaseline = 'top';
stages.forEach(([label, T, night], r) => {
  const y = PAD + r * (H * S + LAB + PAD);
  [old, fresh].filter(Boolean).forEach((w, c) => {
    const x = PAD + c * (W * S + PAD);
    sg.font = 'bold 22px Consolas, monospace';
    sg.fillStyle = '#3a2218';
    sg.fillText(`${old ? (c ? 'NEW' : 'OLD') + ' · ' : ''}${label}`, x, y + 4);
    sg.drawImage(panel(w, T, night), x, y + LAB);
  });
});
writeFileSync(process.argv[2], sheet.toBuffer('image/png'));
console.log('->', process.argv[2], sheet.width + 'x' + sheet.height);
