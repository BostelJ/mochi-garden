// The town square: a shared cobbled clearing that appears once the garden has a couple of plots
// (or plenty of tokens), placed in a free spot among them, and grows with the garden's total
// lifetime tokens: a notice board, then a well, a mochi statue, string lights, a blossom tree
// and finally a market stall. Idle mochis go there to hang out.

import { occupancy } from './farm.js';
import { Garden, TILE, WORLD_COLS, WORLD_ROWS, fmtTokens, hash } from './garden.js';
import { drawPiece } from './pieces.js';
import { gridCanvas, shadeHex } from './sprites.js';

export const SQUARE_W = 8, SQUARE_H = 5;
export const TOWN = { well: 1e6, statue: 3e6, lights: 7e6, tree: 15e6, stall: 30e6 };

export function gardenTotal() {
  return (Garden.allPlots || Garden.plots).reduce((s, p) => s + (p.tokens || 0), 0);
}

export function ensureSquare() {
  if (Garden.square) return;
  const placed = Garden.plots.filter((p) => p.x != null);
  if (placed.length < 2 && gardenTotal() < 300e3) return;
  if (!placed.length) return;
  // two tiles clear of every garden (they grow; build.js keeps them a tile off the square)
  const grid = occupancy(null, 2);
  const clear = (x, y) => {
    for (let yy = y; yy < y + SQUARE_H; yy++) for (let xx = x; xx < x + SQUARE_W; xx++) if (grid[yy * WORLD_COLS + xx]) return false;
    return true;
  };
  const mx = placed.reduce((s, p) => s + p.x + 1.5, 0) / placed.length, my = placed.reduce((s, p) => s + p.y + 1.5, 0) / placed.length;
  let best = null, bestD = Infinity;
  for (let y = 2; y < WORLD_ROWS - SQUARE_H - 2; y++) {
    for (let x = 2; x < WORLD_COLS - SQUARE_W - 2; x++) {
      if (!clear(x, y)) continue;
      const d = Math.hypot(x + SQUARE_W / 2 - mx, (y + SQUARE_H / 2 - my) * 1.3);
      if (d < bestD) [best, bestD] = [{ x, y }, d];
    }
  }
  if (best) {
    Garden.square = best;
    Garden.dirty = true;
  }
}

// Ground: cobbles, the same as the buildable cobble piece, with the square's corners rounded off.
// Once the blossom tree has grown, a few of its petals lie about.
export function drawSquareGround(g) {
  const sq = Garden.square;
  if (!sq) return;
  const inside = (tx, ty) => tx >= 0 && ty >= 0 && tx < SQUARE_W && ty < SQUARE_H && !((tx === 0 || tx === SQUARE_W - 1) && (ty === 0 || ty === SQUARE_H - 1));
  for (let ty = 0; ty < SQUARE_H; ty++) {
    for (let tx = 0; tx < SQUARE_W; tx++) {
      if (!inside(tx, ty)) continue;
      drawPiece(g, 'cobble', (sq.x + tx) * TILE, (sq.y + ty) * TILE, { seed: hash(sq.x + tx, sq.y + ty, 7), same: (dx, dy) => inside(tx + dx, ty + dy), build: 1 });
    }
  }
  if (gardenTotal() >= TOWN.tree) TownArt.petals(g, sq.x * TILE, sq.y * TILE);
}

// Things standing in the square (depth-sorted with the mochis by app code via items).
// Each is drawn from its left edge and the row its base stands on.
export function townItems(t) {
  const sq = Garden.square;
  if (!sq) return [];
  const T = gardenTotal();
  const X = sq.x * TILE, Y = sq.y * TILE;
  const items = [{ y: Y + 30, draw: (g) => noticeBoard(g, X + 17, Y + 30) }];
  if (T >= TOWN.well) items.push({ y: Y + 76, draw: (g) => well(g, X + 13, Y + 76, t) });
  if (T >= TOWN.statue) items.push({ y: Y + 32, draw: (g) => statue(g, X + 50, Y + 32) });
  if (T >= TOWN.lights) for (const lx of [X + 2, X + 123]) items.push({ y: Y + 13, draw: (g) => TownArt.pole(g, lx, Y + 13) });
  if (T >= TOWN.tree) items.push({ y: Y + 38, draw: (g) => blossomTree(g, X + 86, Y + 38, t) });
  if (T >= TOWN.stall) items.push({ y: Y + 77, draw: (g) => stall(g, X + 84, Y + 77) });
  return items;
}

// String lights between two poles at the back of the square, drawn over everything.
export function drawTownLights(g, t) {
  const sq = Garden.square;
  if (!sq || gardenTotal() < TOWN.lights) return;
  const { x0, x1, yAt } = townLightString(sq);
  g.fillStyle = '#3a2218';
  let prev = yAt(x0);
  for (let x = x0; x <= x1; x++) {
    const y = yAt(x);
    g.fillRect(x, Math.min(prev, y), 1, Math.abs(y - prev) + 1);
    prev = y;
  }
  townLightSpots().forEach(({ x, y, c }, i) => {
    const lit = Math.sin(t * 1.7 + i * 2.1) > -0.7;
    TownArt.bulb(g, x - 2, y - 2, lit ? c : shadeHex(c, -0.35), lit);
  });
}

// The string the lights hang on: from one pole top to the other, sagging in the middle.
export function townLightString(sq) {
  const x0 = sq.x * TILE + 4, x1 = sq.x * TILE + 124, y0 = sq.y * TILE - 11, sag = 8;
  return { x0, x1, yAt: (x) => y0 + Math.round(sag * (1 - ((x - (x0 + x1) / 2) / ((x1 - x0) / 2)) ** 2)) };
}

// World px centre and colour of each bulb (for a night glow, like the lanterns get in sky.js).
export function townLightSpots() {
  const sq = Garden.square;
  if (!sq || gardenTotal() < TOWN.lights) return [];
  const { x0, x1, yAt } = townLightString(sq);
  const colours = ['#f2c14e', '#e0665c', '#7fb8e8', '#8fd6b4', '#f29ac2'];
  const spots = [];
  for (let i = 1; i < 11; i++) {
    const x = x0 + Math.round(((x1 - x0) * i) / 11);
    spots.push({ x: x + 1, y: yAt(x) + 3, c: colours[i % colours.length] });
  }
  return spots;
}

// Hand-pixelled sprites for the square, in the style of the buildable pieces (built lazily).
export const TownArt = (() => {
  const INK = '#3a2218';
  const PAL = {
    o: INK,
    W: '#e3ab70', w: '#d39556', m: '#b5733a', d: '#8a5228', D: '#6b4a2b', // wood
    A: '#d9825a', B: '#c0623a', C: '#8f4526', // terracotta roof
    S: '#ddd7c8', s: '#b3b1ab', z: '#8d8b86', Z: '#6b6964', // stone
    l: '#3f7fa6', L: '#5b9fc6', // water
    p: '#fbf8f0', P: '#d9d0bd', q: '#8a8478', // paper
    r: '#e0665c', R: '#a83e3a', e: '#f08a80', // red
    c: '#fbf6e6', // awning cream
    y: '#f2c14e', Y: '#c9962e', // gold / basket
    n: '#f08a3c', N: '#c0622a', u: '#f6a85c', // orange
    G: '#7fb04f', g: '#5f8f3e', H: '#a3d977', k: '#466e2c', // green
    b: '#7fa7e8', i: '#f6c6d6', j: '#f6e3a1', // pins and notes
    K: '#d4aaa6', // stone blush
  };
  const BLOSSOM = { H: '#fde4ee', G: '#f6b8cf', g: '#ee8fa3', k: '#d97a98', x: '#ffffff' };

  const grid = (w, h) => Array.from({ length: h }, () => Array(w).fill('.'));
  const rect = (gr, x, y, w, h, ch) => {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) if (gr[yy] && xx >= 0 && xx < gr[yy].length) gr[yy][xx] = ch;
  };
  const rows = (gr) => gr.map((r) => r.join(''));
  // Pad a fill-only grid by a pixel and ink every empty pixel touching the shape.
  function inked(rs) {
    const w = rs[0].length + 2, h = rs.length + 2;
    const at = (x, y) => (x < 1 || y < 1 || x > w - 2 || y > h - 2 ? '.' : rs[y - 1][x - 1] || '.');
    const out = [];
    for (let y = 0; y < h; y++) {
      let s = '';
      for (let x = 0; x < w; x++) {
        const ch = at(x, y);
        s += ch !== '.' ? ch : [at(x - 1, y), at(x + 1, y), at(x, y - 1), at(x, y + 1)].some((c) => c !== '.' && c !== 'o') ? 'o' : '.';
      }
      out.push(s);
    }
    return out;
  }
  // Leaves from overlapping round clumps, back to front, each lit from the top-left (as pieces.js).
  function foliage(w, h, clumps) {
    const own = (x, y) => {
      let k = -1;
      clumps.forEach(([cx, cy, r], i) => {
        if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) k = i;
      });
      return k;
    };
    const out = [];
    for (let y = 0; y < h; y++) {
      let s = '';
      for (let x = 0; x < w; x++) {
        const k = own(x, y);
        if (k < 0) {
          s += '.';
          continue;
        }
        const [cx, cy, r] = clumps[k];
        const nx = (x + 0.5 - cx) / r, ny = (y + 0.5 - cy) / r;
        const lit = -(nx * 0.55 + ny * 0.85);
        const under = own(x, y + 1);
        if (under > k) s += lit > 0.2 ? 'g' : 'k';
        else if (under < 0 && own(x, y + 2) < 0 && ny > 0.4) s += 'k';
        else s += lit > 0.5 ? 'H' : lit < -0.35 ? 'g' : 'G';
      }
      out.push(s);
    }
    return out;
  }

  const cache = new Map();
  const spr = (key, build, pal = PAL) => {
    if (!cache.has(key)) cache.set(key, gridCanvas(build(), (ch) => (ch in pal ? pal[ch] : PAL[ch])));
    return cache.get(key);
  };
  const px = (g, x, y, w, h, c) => {
    g.fillStyle = c;
    g.fillRect(x, y, w, h);
  };
  const shadow = (g, x, y, w) => {
    px(g, x + 1, y + 1, w - 2, 1, 'rgba(40, 50, 20, 0.25)');
    px(g, x, y, w, 1, 'rgba(40, 50, 20, 0.25)');
  };
  // Draw a sprite with its left edge at x and its bottom row on `base`.
  const put = (g, c, x, base) => g.drawImage(c, x, base - c.height + 1);

  // Notice board under a little tiled roof, notes pinned on it (24 wide).
  function boardRows() {
    const gr = grid(24, 27);
    // roof
    rect(gr, 5, 0, 14, 1, 'o');
    rect(gr, 3, 1, 18, 1, 'o');
    rect(gr, 5, 1, 14, 1, 'A');
    rect(gr, 1, 2, 22, 1, 'o');
    rect(gr, 3, 2, 18, 1, 'B');
    rect(gr, 4, 2, 4, 1, 'A');
    rect(gr, 0, 3, 24, 2, 'o');
    rect(gr, 1, 3, 22, 1, 'B');
    for (let x = 3; x < 22; x += 4) rect(gr, x, 3, 1, 1, 'C');
    rect(gr, 0, 5, 24, 1, 'o');
    // frame and board
    rect(gr, 1, 6, 22, 13, 'o');
    rect(gr, 2, 6, 20, 12, 'w');
    rect(gr, 2, 6, 1, 12, 'W');
    rect(gr, 21, 6, 1, 12, 'm');
    rect(gr, 2, 17, 20, 1, 'm');
    rect(gr, 3, 7, 18, 10, 'D');
    rect(gr, 3, 7, 18, 1, 'o');
    // notes: a long one, a yellow one, a pink one, each with a pin
    rect(gr, 4, 8, 6, 8, 'p');
    rect(gr, 9, 9, 1, 7, 'P');
    for (const y of [10, 12, 14]) rect(gr, 5, y, y === 14 ? 2 : 4, 1, 'q');
    rect(gr, 6, 8, 1, 1, 'r');
    rect(gr, 11, 9, 6, 5, 'j');
    rect(gr, 11, 13, 6, 1, 'Y');
    rect(gr, 12, 11, 4, 1, 'q');
    rect(gr, 13, 9, 1, 1, 'b');
    rect(gr, 17, 11, 3, 5, 'i');
    rect(gr, 17, 15, 3, 1, 'q');
    rect(gr, 18, 11, 1, 1, 'r');
    rect(gr, 1, 19, 22, 1, 'o');
    // posts
    for (const x of [4, 16]) {
      rect(gr, x, 19, 4, 8, 'o');
      rect(gr, x + 1, 19, 1, 7, 'w');
      rect(gr, x + 2, 19, 1, 7, 'm');
    }
    return rows(gr);
  }

  // The square's well: a round stone wall, water inside, a windlass with a bucket, a tiled roof.
  function wellRows() {
    const W = 28, gr = grid(W, 36);
    // roof (a gable seen from the front)
    for (let r = 0; r < 9; r++) {
      const half = Math.min(14, 2 + Math.round(r * 1.5)), x = 14 - half;
      rect(gr, x, r, half * 2, 1, 'o');
      if (r === 0) continue;
      rect(gr, x + 1, r, half - 1, 1, r < 3 ? 'A' : 'B');
      rect(gr, 14, r, half - 1, 1, r % 3 === 1 ? 'C' : 'B');
      if (r % 3 === 2) for (let xx = x + 2; xx < x + half * 2 - 2; xx += 3) rect(gr, xx, r, 1, 1, 'C');
    }
    rect(gr, 0, 9, W, 1, 'o');
    rect(gr, 1, 9, W - 2, 1, 'd');
    rect(gr, 0, 10, W, 1, 'o');
    // posts
    for (const x of [3, 21]) {
      rect(gr, x, 10, 4, 13, 'o');
      rect(gr, x + 1, 11, 1, 12, 'w');
      rect(gr, x + 2, 11, 1, 12, 'm');
    }
    // windlass and crank
    rect(gr, 7, 12, 14, 3, 'o');
    rect(gr, 7, 13, 14, 1, 'w');
    rect(gr, 25, 12, 2, 5, 'o');
    rect(gr, 25, 13, 1, 3, 'd');
    rect(gr, 9, 13, 1, 1, 'd');
    rect(gr, 15, 13, 1, 1, 'd');
    // rope and bucket
    rect(gr, 14, 15, 1, 3, 'o');
    rect(gr, 12, 18, 5, 4, 'o');
    rect(gr, 13, 19, 3, 2, 'm');
    rect(gr, 13, 19, 1, 1, 'W');
    rect(gr, 13, 20, 3, 1, 'z');
    // rim and water
    rect(gr, 1, 22, 26, 1, 'o');
    rect(gr, 0, 23, 28, 13, 'o');
    rect(gr, 1, 23, 26, 1, 'S');
    rect(gr, 1, 24, 3, 2, 'S');
    rect(gr, 24, 24, 3, 2, 's');
    rect(gr, 4, 24, 20, 2, 'l');
    rect(gr, 4, 24, 20, 1, 'o');
    rect(gr, 5, 25, 18, 1, 'L');
    rect(gr, 1, 26, 26, 1, 'S');
    rect(gr, 20, 26, 7, 1, 's');
    rect(gr, 0, 27, 28, 1, 'o');
    rect(gr, 1, 28, 26, 6, 'Z'); // mortar
    // the round stone wall: staggered bricks, lighter on the left, darker round the right
    for (let r = 0; r < 3; r++) {
      const y = 28 + r * 2;
      for (let b = -1; b < 6; b++) {
        const bx = 1 + b * 5 + (r % 2 ? 2 : 0);
        const x = Math.max(1, bx), w = Math.min(bx + 4, 27) - x;
        if (w <= 0) continue;
        const side = bx < 6 ? 'S' : bx > 19 ? 'z' : 's';
        rect(gr, x, y, w, 1, side);
        rect(gr, x, y + 1, w, 1, side === 'S' ? 's' : side === 's' ? 'z' : 'Z');
      }
    }
    rect(gr, 1, 34, 26, 1, 'Z');
    rect(gr, 1, 35, 26, 1, 'o');
    rect(gr, 0, 35, 1, 1, '.');
    rect(gr, 27, 35, 1, 1, '.');
    return rows(gr);
  }

  // A stone mochi on a pedestal, eyes and blush carved in.
  function statueRows() {
    const w = 20, h = 15, body = [];
    for (let y = 0; y < h; y++) {
      let s = '';
      for (let x = 0; x < w; x++) {
        const nx = (x + 0.5 - 10) / 10, ny = (y + 0.5 - 9) / 9;
        if (nx * nx + ny * ny > 1) {
          s += '.';
          continue;
        }
        const lit = -(nx * 0.5 + ny * 0.85);
        s += y >= h - 2 ? 'z' : lit > 0.45 ? 'S' : lit < -0.3 ? 'z' : 's';
      }
      body.push(s);
    }
    const gr = body.map((r) => [...r]);
    // the mochi's face: ink eyes with a catchlight, a soft blush
    for (const [x, y] of [[5, 7], [13, 7]]) {
      rect(gr, x, y, 2, 2, 'o');
      rect(gr, x + 1, y, 1, 1, 'S');
    }
    for (const [x, y] of [[3, 10], [15, 10]]) rect(gr, x, y, 2, 1, 'K');
    rect(gr, 15, 4, 2, 1, 'G');
    const m = inked(rows(gr)).map((r) => '..' + r + '..');
    // pedestal: a slab, a block with a brass plaque, a wider foot
    const ped = grid(26, 11);
    rect(ped, 1, 0, 24, 11, 'o');
    rect(ped, 2, 1, 22, 1, 'S');
    rect(ped, 2, 2, 22, 1, 's');
    rect(ped, 1, 3, 24, 1, 'o');
    rect(ped, 3, 4, 20, 4, 's');
    rect(ped, 3, 4, 2, 4, 'S');
    rect(ped, 20, 4, 3, 4, 'z');
    rect(ped, 2, 4, 1, 4, 'o');
    rect(ped, 23, 4, 1, 4, 'o');
    rect(ped, 9, 5, 8, 2, 'Y');
    rect(ped, 9, 5, 8, 1, 'y');
    rect(ped, 10, 6, 6, 1, 'Y');
    rect(ped, 0, 8, 26, 3, 'o');
    rect(ped, 1, 8, 24, 2, 's');
    rect(ped, 1, 8, 24, 1, 'S');
    rect(ped, 0, 0, 1, 3, '.');
    rect(ped, 25, 0, 1, 3, '.');
    return [...m.slice(0, -1), ...rows(ped)];
  }

  function treeRows() {
    const crown = inked(foliage(30, 22, [[15, 6, 6], [8, 8.5, 5.5], [22, 8.5, 5.5], [15, 12, 6.5], [5, 14, 4.6], [25, 14, 4.6], [10.5, 16.5, 5], [19.5, 16.5, 5]]));
    const dots = [[7, 6], [14, 3], [20, 6], [24, 11], [11, 11], [17, 13], [5, 15], [26, 17], [13, 18], [21, 19]];
    const gr = crown.map((r) => [...r]);
    for (const [x, y] of dots) if ('HGgk'.includes(gr[y + 1][x + 1])) gr[y + 1][x + 1] = 'x';
    const trunk = ['.......oddddo.......', '.......owmmdo.......', '.......owmmdo.......', '.......owmmdo.......', '.......owmmdo.......', '.......owmmdo.......', '.......owmmdo.......', '.......owmmdo.......', '.....oowwmmddoo.....', '....oowwmmmmddoo....', '....oooooooooooo....'].map((r) => '......' + r + '......');
    return { crown: rows(gr), trunk };
  }

  // Market stall: a striped, scalloped awning on posts over a counter of produce.
  function stallRows() {
    const W = 38, gr = grid(W, 34);
    const aw = grid(36, 7);
    for (let y = 0; y < 7; y++) for (let x = 0; x < 36; x++) {
      const red = Math.floor(x / 4) % 2 === 0;
      if (y === 6 && (x % 4 === 0 || x % 4 === 3)) continue; // scallops
      aw[y][x] = y === 0 ? (red ? 'e' : 'p') : y >= 5 ? (red ? 'R' : 'P') : red ? 'r' : 'c';
    }
    inked(rows(aw)).forEach((r, y) => [...r].forEach((ch, x) => ch !== '.' && (gr[y][x] = ch)));
    // back of the stall in shadow, posts
    rect(gr, 3, 9, 32, 11, 'D');
    rect(gr, 3, 9, 32, 1, 'o');
    for (const x of [2, 33]) {
      rect(gr, x, 8, 3, 13, 'o');
      rect(gr, x + 1, 8, 1, 12, 'w');
    }
    // produce: a crate of apples, a big pumpkin, a basket of carrots
    rect(gr, 5, 12, 9, 1, 'o');
    for (const x of [6, 8, 10, 12]) {
      rect(gr, x - 1, 13, 1, 2, 'o');
      rect(gr, x, 13, 2, 2, 'r');
      rect(gr, x, 13, 1, 1, 'e');
    }
    rect(gr, 13, 13, 1, 2, 'o');
    rect(gr, 5, 15, 9, 5, 'o');
    rect(gr, 6, 16, 7, 3, 'm');
    rect(gr, 6, 17, 7, 1, 'd');
    rect(gr, 16, 12, 8, 8, 'o');
    rect(gr, 17, 13, 6, 6, 'n');
    rect(gr, 17, 13, 2, 4, 'u');
    rect(gr, 19, 13, 1, 6, 'N');
    rect(gr, 22, 13, 1, 6, 'N');
    rect(gr, 16, 12, 1, 1, 'D');
    rect(gr, 23, 12, 1, 1, 'D');
    rect(gr, 19, 10, 2, 2, 'o');
    rect(gr, 19, 10, 1, 2, 'g');
    rect(gr, 25, 15, 9, 5, 'o');
    rect(gr, 26, 16, 7, 3, 'Y');
    rect(gr, 26, 17, 7, 1, 'y');
    for (const x of [26, 28, 30, 32]) {
      rect(gr, x, 13, 1, 2, 'n');
      rect(gr, x, 12, 1, 1, 'G');
      rect(gr, x + 1, 11, 1, 2, 'g');
    }
    // the counter: a top board and a planked front with a little sign
    rect(gr, 1, 20, 36, 3, 'o');
    rect(gr, 2, 21, 34, 1, 'W');
    rect(gr, 2, 23, 34, 9, 'o');
    rect(gr, 3, 23, 32, 8, 'w');
    for (const y of [25, 28]) rect(gr, 3, y, 32, 1, 'm');
    rect(gr, 3, 30, 32, 1, 'd');
    rect(gr, 14, 24, 10, 5, 'o');
    rect(gr, 15, 25, 8, 3, 'p');
    rect(gr, 16, 26, 3, 1, 'q');
    rect(gr, 20, 26, 2, 1, 'r');
    rect(gr, 2, 32, 3, 2, 'o');
    rect(gr, 33, 32, 3, 2, 'o');
    return rows(gr);
  }

  return {
    board(g, x, base) {
      shadow(g, x + 3, base, 18);
      put(g, spr('board', boardRows), x, base);
    },
    well(g, x, base, t) {
      shadow(g, x, base, 28);
      const c = spr('well', wellRows);
      put(g, c, x, base);
      // the water glints
      const top = base - c.height + 1;
      const k = Math.floor((t * 1.5) % 11);
      if (k < 7) px(g, x + 6 + k * 2, top + 25, 2, 1, '#9fd3f2');
    },
    statue(g, x, base) {
      shadow(g, x, base, 26);
      put(g, spr('statue', statueRows), x, base);
    },
    tree(g, x, base, t) {
      const { crown, trunk } = treeRows();
      const tc = spr('town-trunk', () => trunk, { w: '#a0703f', m: '#8a5f3c', d: '#6b4a2b' });
      const cc = spr('town-crown', () => crown, BLOSSOM);
      shadow(g, x + 6, base, 22);
      put(g, tc, x, base);
      g.drawImage(cc, x, base - tc.height + 5 - cc.height);
      // petals drifting down
      for (let i = 0; i < 2; i++) {
        const k = (t * 0.22 + i * 0.5) % 1;
        px(g, x + 6 + i * 16 + Math.round(Math.sin(k * 9 + i) * 2 + k * 5), base - 22 + Math.round(k * 22), 1, 1, i ? '#fbd6e3' : '#f6b8cf');
      }
    },
    stall(g, x, base) {
      shadow(g, x + 1, base, 36);
      put(g, spr('stall', stallRows), x, base);
    },
    pole(g, x, base) {
      shadow(g, x - 1, base, 5);
      px(g, x, base - 25, 3, 26, INK);
      px(g, x + 1, base - 24, 1, 24, '#d39556');
      px(g, x - 1, base - 27, 5, 3, INK);
      px(g, x, base - 26, 3, 1, '#e3ab70');
    },
    bulb(g, x, y, c, lit) {
      px(g, x + 1, y, 2, 1, INK);
      px(g, x, y + 1, 4, 3, INK);
      px(g, x + 1, y + 4, 2, 1, INK);
      px(g, x + 1, y + 1, 2, 3, c);
      if (lit) px(g, x + 1, y + 1, 1, 1, '#fffbe6');
    },
    petals(g, X, Y) {
      for (let i = 0; i < 14; i++) {
        const x = X + 82 + Math.floor(hash(i, 1, 91) * 40), y = Y + 36 + Math.floor(hash(i, 2, 91) * 22);
        px(g, x, y, i % 3 ? 1 : 2, 1, i % 2 ? '#f6b8cf' : '#fbd6e3');
      }
    },
  };
})();

export function noticeBoard(g, x, base) {
  TownArt.board(g, x, base);
}

export function well(g, x, base, t) {
  TownArt.well(g, x, base, t);
}

export function statue(g, x, base) {
  TownArt.statue(g, x, base);
}

export function blossomTree(g, x, base, t) {
  TownArt.tree(g, x, base, t);
}

export function stall(g, x, base) {
  TownArt.stall(g, x, base);
}

// The board's label, at screen resolution like the plot signs.
export function drawTownSign(ctx) {
  const sq = Garden.square;
  if (!sq) return;
  const S = Garden.S;
  const lines = ['mochi town', `${fmtTokens(gardenTotal())} · ${Garden.plots.filter((p) => p.x != null).length} mochis`];
  ctx.font = `bold ${Math.max(8, 3.4 * S)}px 'Cascadia Mono', Consolas, 'SF Mono', Menlo, monospace`;
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 6 * S;
  const x = Math.round((sq.x * TILE + 29) * S - w / 2), y = Math.round((sq.y * TILE - 6) * S);
  ctx.fillStyle = 'rgba(58, 34, 24, 0.85)';
  ctx.fillRect(x, y - 2 * S, w, 10 * S);
  ctx.fillStyle = '#fff7e0';
  ctx.textBaseline = 'top';
  ctx.fillText(lines[0], x + 3 * S, y - 1.5 * S);
  ctx.fillStyle = '#e9d8b4';
  ctx.font = `${Math.max(8, 3 * S)}px 'Cascadia Mono', Consolas, 'SF Mono', Menlo, monospace`;
  ctx.fillText(lines[1], x + 3 * S, y + 3.2 * S);
}
