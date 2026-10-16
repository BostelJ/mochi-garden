// The mochi's desk and typewriter, hand-pixelled in the style of the approved concept (the
// "cozy desk + cream typewriter": honey-wood desk with a drawer, a potted plant, a heart mug, a
// cream rounded typewriter). While a session works the mochi sits in front of it, seen from
// behind, typing: keys press, the carriage slides along the line, the paper fills line by line,
// and at the end of a line there's a ding and the carriage returns. A full page flutters away.

import { TILE, atHome } from './garden.js';
import { Sound, tone } from './rewards.js';
import { PLANK, prop } from './sprites.js';

export const LINE_CHARS = 11;
export const PAGE_LINES = 5;
export const DESK_W = 40, DESK_H = 30;

export const DK = {
  o: '#3a2218', // outline
  w1: '#d39556', w2: '#b5733a', w3: '#8a5228', // wood: light, mid, dark
  knob: '#f2c14e',
  pot: '#c0623a', potDk: '#8f4526', potHi: '#d9825a',
  leaf: '#7fb04f', leafDk: '#4f7a34', leafHi: '#a3d977',
  mug: '#f6f1e4', mugDk: '#d9d0bd', heart: '#e0665c', tea: '#8a5228',
  cream: '#efe6cf', creamHi: '#fbf6e6', creamDk: '#d4c7a6', key: '#3d4045', keyHi: '#9a9484',
  roller: '#5f6369', knobDk: '#2b2b2b', paper: '#fbf8f0', paperEdge: '#c9c1ad', ink: '#8a8478',
};

// The desk stands in the plot's desk corner; its bottom-left, in world px.
export function deskOrigin(p) {
  return { x: p.x * TILE + 4, y: p.y * TILE + 40 };
}

export function updateTypewriter(p, dt, t) {
  p.tw = p.tw || { col: 0, line: 0, key: 0, keyAt: -1, acc: 0, dingAt: -1, pages: [] };
  const tw = p.tw;
  const typing = p.built && p.live && p.activity === 'working' && atHome(p);
  if (typing) {
    tw.acc += (5 + Math.min(12, (p.effort || 0) * 0.7)) * dt; // faster when it's working hard
    while (tw.acc >= 1) {
      tw.acc -= 1;
      if (t - tw.dingAt < 0.25) continue; // carriage still returning
      tw.col++;
      tw.key = Math.floor(Math.random() * 11);
      tw.keyAt = t;
      clack();
      if (tw.col >= LINE_CHARS) {
        tw.col = 0;
        tw.dingAt = t;
        ding();
        tw.line++;
        if (tw.line >= PAGE_LINES) {
          tw.line = 0;
          const d = deskOrigin(p);
          tw.pages.push({ x: d.x + 18, y: d.y - DESK_H - 6, t, drift: Math.random() < 0.5 ? -1 : 1 });
        }
      }
    }
  }
  tw.pages = tw.pages.filter((pg) => t - pg.t < 2.2);
}

export function drawDesk(g, p, t) {
  const d = deskOrigin(p);
  const x = d.x, y = d.y - DESK_H;
  if (!p.built) {
    // the desk goes up from the floor while the first answer is written, planks beside it
    const rows = Math.ceil((p.build || 0) * DESK_H);
    if (rows > 0) {
      g.save();
      g.beginPath();
      g.rect(x - 2, d.y - rows, DESK_W + 4, rows);
      g.clip();
      drawDeskBody(g, x, y);
      g.restore();
    }
    const plank = prop('plank', PLANK);
    g.drawImage(plank, x + 30, d.y - 3);
    if ((p.build || 0) < 0.5) g.drawImage(plank, x + 31, d.y - 6);
    return;
  }
  drawDeskBody(g, x, y);
  drawTypewriter(g, p, x + 12, y + 5, t);
  for (const pg of p.tw?.pages || []) {
    const k = (t - pg.t) / 2.2;
    const fx = Math.round(pg.x + pg.drift * k * 18 + Math.sin(k * 9) * 3), fy = Math.round(pg.y - k * 26);
    g.globalAlpha = 1 - k;
    px(g, fx, fy, 6, Math.sin(k * 12) > 0 ? 7 : 5, DK.paper);
    px(g, fx + 1, fy + 1, 4, 1, DK.ink);
    px(g, fx + 1, fy + 3, 3, 1, DK.ink);
    g.globalAlpha = 1;
  }
}

export function px(g, x, y, w, h, c) {
  g.fillStyle = c;
  g.fillRect(x, y, w, h);
}

// A filled rectangle with its four corner pixels cut, for rounded pixel shapes.
export function rounded(g, x, y, w, h, c) {
  px(g, x + 1, y, w - 2, h, c);
  px(g, x, y + 1, w, h - 2, c);
}

// Desk (40 x 30, top-left at x, y): the plant and mug on top, the typewriter is drawn separately.
export function drawDeskBody(g, x, y) {
  // legs
  for (const lx of [x + 3, x + 33]) {
    px(g, lx, y + 22, 4, 8, DK.o);
    px(g, lx + 1, y + 22, 2, 7, DK.w2);
    px(g, lx + 1, y + 22, 1, 7, DK.w1);
  }
  // body with the drawer
  px(g, x + 1, y + 15, 38, 9, DK.o);
  px(g, x + 2, y + 15, 36, 7, DK.w2);
  px(g, x + 2, y + 21, 36, 1, DK.w3);
  px(g, x + 11, y + 16, 18, 5, DK.o);
  px(g, x + 12, y + 17, 16, 3, DK.w1);
  px(g, x + 12, y + 19, 16, 1, DK.w2);
  px(g, x + 19, y + 18, 2, 1, DK.knob);
  // top slab, overhanging the body
  px(g, x, y + 11, DESK_W, 5, DK.o);
  px(g, x + 1, y + 12, DESK_W - 2, 2, DK.w1);
  px(g, x + 1, y + 14, DESK_W - 2, 1, DK.w2);
  px(g, x + 4, y + 12, 9, 1, '#e3ab70'); // shine on the wood
  // potted plant, back left
  px(g, x + 3, y + 7, 7, 5, DK.o);
  px(g, x + 4, y + 7, 5, 4, DK.pot);
  px(g, x + 3, y + 6, 7, 2, DK.o);
  px(g, x + 4, y + 7, 5, 1, DK.potHi);
  px(g, x + 4, y + 10, 5, 1, DK.potDk);
  // the plant: a bushy little cluster over the pot
  const LEAVES = ['....H....', '..G.GH.G.', '.GHGgGGG.', 'GGgGGGgHG', '.gGGgGGg.', '..gGGGg..', '...ggg...'];
  LEAVES.forEach((row, ly) => [...row].forEach((ch, lx) => {
    if (ch !== '.') px(g, x + 1 + lx, y - 1 + ly, 1, 1, { G: DK.leaf, g: DK.leafDk, H: DK.leafHi }[ch]);
  }));
  px(g, x + 3, y + 6, 7, 1, DK.o); // pot rim over the stems
  px(g, x + 4, y + 7, 5, 1, DK.potHi);
  // heart mug, back right
  px(g, x + 30, y + 6, 7, 6, DK.o);
  px(g, x + 31, y + 7, 5, 4, DK.mug);
  px(g, x + 31, y + 10, 5, 1, DK.mugDk);
  px(g, x + 31, y + 7, 5, 1, DK.tea);
  px(g, x + 37, y + 7, 2, 1, DK.o);
  px(g, x + 38, y + 8, 1, 2, DK.o);
  px(g, x + 37, y + 10, 2, 1, DK.o);
  px(g, x + 32, y + 8, 1, 1, DK.heart);
  px(g, x + 34, y + 8, 1, 1, DK.heart);
  px(g, x + 32, y + 9, 3, 1, DK.heart);
}

// Cream typewriter (16 x 8 body at x, y) with its carriage, roller and paper above.
export function drawTypewriter(g, p, x, y, t) {
  const tw = p.tw || { col: 0, line: 0, keyAt: -1, dingAt: -1 };
  // the carriage slides left as the line fills and snaps back on the ding
  const returning = t - tw.dingAt < 0.25;
  const col = returning ? LINE_CHARS * (1 - (t - tw.dingAt) / 0.25) : tw.col;
  const shift = -Math.round(col * 0.35);
  // paper in the roller: taller with each finished line, the typed lines as grey ticks
  const ph = 4 + tw.line * 2, pxl = x + 3 + shift, py = y - 3 - ph;
  px(g, pxl - 1, py, 12, ph, DK.paperEdge);
  px(g, pxl, py, 10, ph, DK.paper);
  for (let l = 0; l < tw.line; l++) px(g, pxl + 1, py + 1 + l * 2, 7 - (l % 3), 1, DK.ink);
  const cur = Math.round((tw.col / LINE_CHARS) * 7);
  if (cur > 0) px(g, pxl + 1, py + 1 + tw.line * 2, cur, 1, DK.ink);
  // roller bar with a knob at each end
  px(g, x - 1 + shift, y - 3, 18, 3, DK.o);
  px(g, x + shift, y - 2, 16, 1, DK.roller);
  px(g, x - 3 + shift, y - 3, 2, 3, DK.knobDk);
  px(g, x + 17 + shift, y - 3, 2, 3, DK.knobDk);
  // body
  rounded(g, x, y, 16, 8, DK.o);
  rounded(g, x + 1, y + 1, 14, 6, DK.cream);
  px(g, x + 2, y + 1, 5, 1, DK.creamHi);
  px(g, x + 2, y + 6, 12, 1, DK.creamDk);
  // keys: two rows and a space bar; the one just struck goes down
  const keys = [];
  for (let i = 0; i < 6; i++) keys.push([x + 3 + i * 2, y + 2]);
  for (let i = 0; i < 5; i++) keys.push([x + 4 + i * 2, y + 4]);
  // (the space bar sits a row lower, so the keys don't read as a face)
  keys.forEach(([kx, ky], i) => {
    const down = t - tw.keyAt < 0.07 && tw.key === i;
    px(g, kx, ky + (down ? 1 : 0), 1, 1, down ? DK.keyHi : DK.key);
  });
  px(g, x + 5, y + 6, 6, 1, DK.key);
  // the bell
  if (t - tw.dingAt < 0.3) {
    px(g, x + 19, y - 6, 1, 2, DK.knob);
    px(g, x + 21, y - 5, 2, 1, DK.knob);
  }
}

export let lastClack = 0;
export function clack() {
  if (!Sound.on || document.hidden) return;
  const now = performance.now();
  if (now - lastClack < 55) return;
  lastClack = now;
  tone(1500 + Math.random() * 600, 0, { gain: 0.012, dur: 0.025, type: 'square', drop: 0.5 });
}

export function ding() {
  if (!Sound.on || document.hidden) return;
  tone(2637, 0, { gain: 0.028, dur: 0.6 });
}
