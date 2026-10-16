// Buildable garden pieces: the catalog each session can build from, and their hand-pixelled art.
// Ground pieces fill their tiles (drawn in the ground pass); object pieces stand with their base on
// the bottom row of their tiles and may reach upward (drawn y-sorted with the mochis).
// Needs sprites.js (gridCanvas, FLAVOURS, shadeHex, artImage, ready) and garden.js (TILE, hash).

import { hash } from './garden.js';
import { FLAVOURS, FLAVOUR_ORDER, artImage, gridCanvas, ready, shadeHex } from './sprites.js';

export const PIECES = {
  // ground
  soil: { cost: 80, layer: 'ground', connects: true, desc: 'tilled soil bed; token seeds grow crops in it' },
  path: { cost: 40, layer: 'ground', connects: true, desc: 'gravel path with stepping stones' },
  cobble: { cost: 80, layer: 'ground', connects: true, desc: 'cobblestone paving' },
  water: { cost: 120, layer: 'ground', connects: true, desc: 'pond water; neighbouring tiles join into one pond' },
  flowers: { cost: 80, layer: 'ground', connects: true, variants: ['pink', 'white', 'purple', 'yellow', 'blue', 'red', 'mixed'], desc: 'a dense flower bed' },
  clover: { cost: 40, layer: 'ground', connects: true, desc: 'a lush patch of clover' },
  // objects (`above`: how many px the art can reach above its tiles; art may also overhang its
  // tiles sideways by a few px: the lantern's lamp ~7px right, the arch 2px each side)
  bush: { cost: 120, layer: 'object', variants: ['green', 'berry', 'flowering'], above: 0, desc: 'a round leafy bush' },
  tree: { cost: 320, layer: 'object', variants: ['oak', 'pine', 'blossom', 'fruit'], above: 13, desc: 'a tree' },
  rock: { cost: 40, layer: 'object', variants: ['small', 'mossy'], above: 0, desc: 'a rock' },
  mushrooms: { cost: 40, layer: 'object', variants: ['red', 'brown'], above: 0, desc: 'a little cluster of mushrooms' },
  fence: { cost: 40, layer: 'object', connects: true, above: 0, desc: 'post-and-rail fence; joins up with neighbouring fence tiles' },
  lantern: { cost: 200, layer: 'object', above: 16, desc: 'a lantern on a post' },
  bench: { cost: 200, layer: 'object', size: [2, 1], above: 0, desc: 'a wooden garden bench (2 tiles wide)' },
  sign: { cost: 120, layer: 'object', text: true, above: 0, desc: 'a wooden sign that shows a short text' },
  birdhouse: { cost: 200, layer: 'object', above: 8, desc: 'a birdhouse on a pole' },
  scarecrow: { cost: 200, layer: 'object', above: 9, desc: 'a friendly scarecrow' },
  beehive: { cost: 240, layer: 'object', above: 5, desc: 'a straw beehive with bees buzzing about' },
  arch: { cost: 320, layer: 'object', above: 14, desc: 'a rose arch' },
  shed: { cost: 1000, layer: 'object', size: [2, 2], variants: typeof FLAVOUR_ORDER !== 'undefined' ? FLAVOUR_ORDER.slice() : Object.keys(FLAVOURS), above: 6, desc: 'a tiny garden shed (2x2 tiles); variant = roof colour' },
  pumpkin: { cost: 80, layer: 'object', above: 0, desc: 'a big decorative pumpkin' },
  well: { cost: 480, layer: 'object', above: 7, desc: 'a little stone well' },
  campfire: { cost: 160, layer: 'object', above: 4, desc: 'a crackling campfire' },
  windchime: { cost: 120, layer: 'object', above: 7, desc: 'a wind chime hanging from a little post' },
};

export const PieceArt = (() => {
  const T = 16;
  const INK = '#3a2218';
  const BASE = {
    o: INK,
    W: '#e3ab70', w: '#d39556', m: '#b5733a', d: '#8a5228', // wood (the desk's)
    H: '#a3d977', G: '#7fb04f', g: '#5f8f3e', k: '#466e2c', // leaves
    S: '#ddd7c8', s: '#b3b1ab', z: '#8d8b86', Z: '#6b6964', // stone
    c: '#f6f1e4', C: '#d9d0bd', // cream
    r: '#e0665c', R: '#a83e3a', A: '#f08a80', // red
    y: '#f2c14e', Y: '#c9962e', V: '#f6d77a', // yellow / straw
    n: '#f08a3c', N: '#c0622a', u: '#f6a85c', // orange
    b: '#7fa7e8', B: '#5f84c4', // blue
    p: '#f29ac2', P: '#fbd6e3', q: '#d9739f', // pink
    l: '#5b9fc6', L: '#9fd3f2', // water / glass
    e: '#3d4045', E: '#5f6369', // iron
    x: '#ffffff',
  };
  const SHADOW = 'rgba(40, 50, 20, 0.25)';

  const cache = new Map();
  // A sprite from a pixel grid; `map` overrides the base palette.
  function spr(key, rows, map, flip) {
    const k = key + (flip ? ':f' : '');
    if (!cache.has(k)) {
      const rr = flip ? rows.map((r) => [...r].reverse().join('')) : rows;
      cache.set(k, gridCanvas(rr, (ch) => (map && ch in map ? map[ch] : BASE[ch])));
    }
    return cache.get(k);
  }
  // Pad a fill-only grid by one pixel and ink every empty pixel touching the shape (4-neighbour).
  function inked(rows) {
    const w = rows[0].length + 2, h = rows.length + 2;
    const at = (x, y) => (x < 1 || y < 1 || x > w - 2 || y > h - 2 ? '.' : rows[y - 1][x - 1]);
    const out = [];
    for (let y = 0; y < h; y++) {
      let s = '';
      for (let x = 0; x < w; x++) {
        const ch = at(x, y);
        if (ch !== '.') s += ch;
        else s += [at(x - 1, y), at(x + 1, y), at(x, y - 1), at(x, y + 1)].some((c) => c !== '.' && c !== 'o') ? 'o' : '.';
      }
      out.push(s);
    }
    return out;
  }
  const px = (g, x, y, w, h, c) => {
    g.fillStyle = c;
    g.fillRect(x, y, w, h);
  };
  const shadow = (g, x, y, w) => {
    px(g, x + 1, y, w - 2, 1, SHADOW);
    px(g, x, y - 1, w, 1, SHADOW);
  };
  const flipOf = (o) => (o.seed || 0) > 0.5;

  // Ground ---------------------------------------------------------------------------------

  // Neighbour flags of a ground tile: n s w e and the four diagonals.
  function nbOf(o) {
    const same = o.same || (() => false);
    return { n: same(0, -1), s: same(0, 1), w: same(-1, 0), e: same(1, 0), nw: same(-1, -1), ne: same(1, -1), sw: same(-1, 1), se: same(1, 1) };
  }
  const nbKey = (nb) => ['n', 's', 'w', 'e', 'nw', 'ne', 'sw', 'se'].map((k) => (nb[k] ? 1 : 0)).join('');

  // A ground tile built pixel by pixel (cached): colourAt(x, y) -> colour or null.
  function tileCanvas(key, colourAt) {
    if (cache.has(key)) return cache.get(key);
    const c = document.createElement('canvas');
    c.width = T;
    c.height = T;
    const g = c.getContext('2d');
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
      const col = colourAt(x, y);
      if (col) px(g, x, y, 1, 1, col);
    }
    cache.set(key, c);
    return c;
  }

  // Is (x, y) (tile px, may be just outside) inside a patch that stays `ins` px in from open sides,
  // with rounded outer corners, notched inner corners, and (rough) a slightly wobbly edge.
  function patchMask(nb, ins, rough, salt) {
    const inside = (x, y) => {
      const t = nb.n ? 0 : ins.n, b = nb.s ? 0 : ins.s, l = nb.w ? 0 : ins.w, r = nb.e ? 0 : ins.e;
      let wob = 0;
      if (rough) wob = hash(x, y, salt) < 0.3 ? 1 : 0;
      if (!nb.n && y < t + (wob && y === t ? 1 : 0)) return false;
      if (!nb.s && y > T - 1 - b - (wob && y === T - 1 - b ? 1 : 0)) return false;
      if (!nb.w && x < l + (wob && x === l ? 1 : 0)) return false;
      if (!nb.e && x > T - 1 - r - (wob && x === T - 1 - r ? 1 : 0)) return false;
      // rounded outer corners
      const cr = 2;
      if (!nb.n && !nb.w && x - l + y - t < cr) return false;
      if (!nb.n && !nb.e && T - 1 - r - x + y - t < cr) return false;
      if (!nb.s && !nb.w && x - l + T - 1 - b - y < cr) return false;
      if (!nb.s && !nb.e && T - 1 - r - x + T - 1 - b - y < cr) return false;
      // inner corners where the diagonal tile is missing
      if (nb.n && nb.w && !nb.nw && x < ins.w && y < ins.n) return false;
      if (nb.n && nb.e && !nb.ne && x > T - 1 - ins.e && y < ins.n) return false;
      if (nb.s && nb.w && !nb.sw && x < ins.w && y > T - 1 - ins.s) return false;
      if (nb.s && nb.e && !nb.se && x > T - 1 - ins.e && y > T - 1 - ins.s) return false;
      return true;
    };
    return (x, y) => {
      if (x < 0 || y < 0 || x >= T || y >= T) {
        // outside the tile: patch continues only into a same-piece neighbour
        const dx = x < 0 ? -1 : x >= T ? 1 : 0, dy = y < 0 ? -1 : y >= T ? 1 : 0;
        // (it looks like our own edge pixel there, as the neighbour's matching edge would)
        const k = (dy < 0 ? 'n' : dy > 0 ? 's' : '') + (dx < 0 ? 'w' : dx > 0 ? 'e' : '');
        return !!nb[k] && inside(Math.min(T - 1, Math.max(0, x)), Math.min(T - 1, Math.max(0, y)));
      }
      return inside(x, y);
    };
  }

  const SOIL = { base: '#8b6a4a', furrow: '#6f5238', ridge: '#a07f5c', edge: '#5a412c' };
  function soil(g, ox, oy, o) {
    const nb = nbOf(o);
    const c = tileCanvas('soil' + nbKey(nb), (x, y) => {
      if ((y === 0 && !nb.n) || (y === T - 1 && !nb.s) || (x === 0 && !nb.w) || (x === T - 1 && !nb.e)) return SOIL.edge;
      if ([2, 6, 10, 14].includes(y)) return SOIL.ridge;
      if ([3, 7, 11, 15].includes(y)) return SOIL.furrow;
      return SOIL.base;
    });
    g.drawImage(c, ox, oy);
  }

  const PATH = { base: '#d8c9a3', dk: '#c2b089', lt: '#e7dcbf', edge: '#a38d64', stone: '#c9c2b0', stoneHi: '#e2ddd0', stoneDk: '#9d9584' };
  function path(g, ox, oy, o) {
    const nb = nbOf(o);
    const b = Math.floor((o.seed || 0) * 4);
    const ins = { n: 1, s: 1, w: 1, e: 1 };
    const c = tileCanvas('path' + nbKey(nb) + b, (x, y) => {
      const m = patchMask(nb, ins, true, 31 + b);
      if (!m(x, y)) return null;
      if (!m(x, y - 1) || !m(x - 1, y) || !m(x + 1, y) || !m(x, y + 1)) return PATH.edge;
      // a flat stepping stone, set a little differently on each tile
      const sx = 3 + (b % 2) * 3, sy = 4 + (b >> 1) * 3, ix = x - sx, iy = y - sy;
      if (ix >= 0 && ix < 8 && iy >= 0 && iy < 6 && !((ix === 0 || ix === 7) && (iy === 0 || iy === 5))) {
        if (iy === 5 || (ix === 7 && iy > 0) || (iy === 4 && (ix === 0 || ix === 7))) return PATH.stoneDk;
        if (iy === 0 || (ix === 0 && iy < 4)) return PATH.stoneHi;
        return PATH.stone;
      }
      const h = hash(x, y, 77 + b);
      return h < 0.12 ? PATH.dk : h < 0.22 ? PATH.lt : PATH.base;
    });
    g.drawImage(c, ox, oy);
  }

  const COB = { base: '#b9b2a2', a: '#d3cdbd', b: '#c9c2b0', c: '#ddd7c8', line: '#a39b8a', edge: '#8d8579' };
  function cobble(g, ox, oy, o) {
    const nb = nbOf(o);
    const b = Math.floor((o.seed || 0) * 4);
    const ins = { n: 1, s: 1, w: 1, e: 1 };
    const c = tileCanvas('cobble' + nbKey(nb) + b, (x, y) => {
      const m = patchMask(nb, ins, false, 0);
      if (!m(x, y)) return null;
      if (!m(x, y - 1) || !m(x - 1, y) || !m(x + 1, y) || !m(x, y + 1)) return COB.edge;
      // offset rows of 3x3 stones with a shadow line under each, like the town square
      const r = Math.floor(y / 4), iy = y % 4;
      const xx = (x - (r % 2) * 2 + 16) % 16, cc = Math.floor(xx / 4), ix = xx % 4;
      if (ix === 3) return COB.base;
      if (iy === 3) return COB.line;
      const h = hash(cc + b * 5, r, 3);
      return h < 0.33 ? COB.a : h < 0.66 ? COB.b : COB.c;
    });
    g.drawImage(c, ox, oy);
  }

  const WATER = { deep: '#3f7fa6', mid: '#5b9fc6', lt: '#8cc7e6', hi: '#d4f0fb', earth: '#8b6a4a', earthDk: '#6f5238', pad: '#7fb04f', padDk: '#5f8f3e' };
  function water(g, ox, oy, o) {
    const nb = nbOf(o);
    const ins = { n: 4, s: 1, w: 2, e: 2 };
    const m = patchMask(nb, ins, false, 0);
    const c = tileCanvas('water' + nbKey(nb), (x, y) => {
      if (m(x, y)) {
        if (!m(x, y - 1) || !m(x, y - 2)) return WATER.deep; // the bank's shadow on the water
        if (!m(x - 1, y)) return WATER.deep;
        if (!m(x, y + 1) || !m(x + 1, y)) return WATER.lt;
        return WATER.mid;
      }
      // bank: an earth face above the water (we see the far bank's side), ink elsewhere
      if (m(x, y + 1)) return WATER.earthDk;
      if (m(x, y + 2)) return WATER.earth;
      if (m(x, y + 3) || m(x, y - 1) || m(x - 1, y) || m(x + 1, y)) return INK;
      if (m(x - 1, y + 1) || m(x + 1, y + 1) || m(x - 1, y - 1) || m(x + 1, y - 1)) return INK;
      return null;
    });
    g.drawImage(c, ox, oy);
    const s = o.seed || 0, t = o.t || 0;
    // a lily pad on some tiles
    if (s > 0.62) {
      const lx = ox + 4 + Math.floor(s * 37) % 6, ly = oy + 7 + Math.floor(s * 53) % 4;
      if (m(lx - ox - 1, ly - oy) && m(lx - ox + 4, ly - oy + 2)) {
        px(g, lx, ly, 4, 2, WATER.pad);
        px(g, lx + 1, ly - 1, 2, 1, WATER.pad);
        px(g, lx + 2, ly, 1, 1, WATER.mid);
        px(g, lx, ly + 1, 4, 1, WATER.padDk);
        if (s > 0.85) px(g, lx + 1, ly - 1, 1, 1, '#f29ac2');
      }
    }
    // shimmer: a couple of short glints that come and go
    for (let i = 0; i < 2; i++) {
      const ph = t * 0.6 + s * 7 + i * 0.5;
      const k = ph - Math.floor(ph);
      if (k > 0.55) continue;
      const cyc = Math.floor(ph);
      const gx = 3 + Math.floor(hash(cyc, i, 11 + Math.floor(s * 97)) * 9), gy = 5 + Math.floor(hash(cyc, i, 23 + Math.floor(s * 97)) * 8);
      const w = k < 0.12 || k > 0.43 ? 1 : 3;
      if (m(gx - 1, gy) && m(gx + 3, gy) && m(gx, gy - 2)) px(g, ox + gx + (w === 1 ? 1 : 0), oy + gy, w, 1, i ? WATER.hi : WATER.lt);
    }
  }

  const FLOWER_COL = {
    pink: ['#f29ac2', '#d9739f', '#f2c14e'], white: ['#ffffff', '#d9d0bd', '#f2c14e'], purple: ['#b48ad6', '#8a6cb5', '#f2c14e'],
    yellow: ['#f2c14e', '#c9962e', '#a0602c'], blue: ['#7fa7e8', '#5f84c4', '#fbf6e6'], red: ['#e0665c', '#a83e3a', '#f2c14e'],
  };
  const MIXED = ['pink', 'white', 'purple', 'yellow', 'blue', 'red'];
  const BED = { base: '#5f8f3e', dk: '#4f7a34', lt: '#6f9e45', edge: '#466e2c' };
  function flowers(g, ox, oy, o) {
    const nb = nbOf(o);
    const v = FLOWER_COL[o.variant] || o.variant === 'mixed' ? o.variant : 'pink';
    const b = Math.floor((o.seed || 0) * 4);
    const ins = { n: 1, s: 1, w: 1, e: 1 };
    const m = patchMask(nb, ins, true, 51 + b);
    const key = 'flowers' + nbKey(nb) + v + b;
    if (!cache.has(key)) {
      const pix = {};
      for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
        if (!m(x, y)) continue;
        const h = hash(x, y, 61 + b);
        pix[x + ',' + y] = !m(x, y + 1) ? BED.edge : h < 0.25 ? BED.dk : h < 0.4 ? BED.lt : BED.base;
      }
      // flowers on a jittered 3x3 grid: a plus of petals, a centre, a darker lower petal
      for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) {
        const fx = 2 + i * 5 + Math.floor(hash(i, j, 70 + b) * 2) + (j % 2), fy = 2 + j * 5 + Math.floor(hash(i, j, 80 + b) * 2);
        const pts = [[0, -1], [-1, 0], [1, 0], [0, 1], [0, 0]];
        if (!m(fx, fy) || !pts.every(([dx, dy]) => fx + dx >= 0 && fx + dx < T && fy + dy >= 0 && fy + dy < T)) continue;
        const kind = v === 'mixed' ? MIXED[Math.floor(hash(i + b * 3, j, 90) * MIXED.length)] : v;
        const [pet, petDk, ctr] = FLOWER_COL[kind];
        pix[fx + ',' + (fy - 1)] = pet;
        pix[fx - 1 + ',' + fy] = pet;
        pix[fx + 1 + ',' + fy] = pet;
        pix[fx + ',' + (fy + 1)] = petDk;
        pix[fx + ',' + fy] = ctr;
        if (m(fx, fy + 2)) pix[fx + ',' + (fy + 2)] = BED.edge;
      }
      cache.set(key, tileCanvas(key + ':c', (x, y) => pix[x + ',' + y] || null));
    }
    g.drawImage(cache.get(key), ox, oy);
  }

  const CLOVER = { base: '#7aa44d', dk: '#6b9443', lt: '#89b158', leaf: '#4f7a34', leafLt: '#6f9e45', leafHi: '#a3d977', bloom: '#fbf6e6', bloomTip: '#f29ac2' };
  function clover(g, ox, oy, o) {
    const nb = nbOf(o);
    const b = Math.floor((o.seed || 0) * 4);
    const m = patchMask(nb, { n: 1, s: 1, w: 1, e: 1 }, true, 41 + b);
    const key = 'clover' + nbKey(nb) + b;
    if (!cache.has(key)) {
      const pix = {};
      for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
        if (!m(x, y)) continue;
        const h = hash(x, y, 43 + b);
        pix[x + ',' + y] = !m(x, y + 1) || !m(x - 1, y) ? CLOVER.dk : h < 0.2 ? CLOVER.dk : h < 0.32 ? CLOVER.lt : CLOVER.base;
      }
      // trefoils: three leaves round a stem pixel
      const spots = [[3, 3], [10, 2], [7, 6], [13, 6], [3, 9], [10, 10], [6, 13], [13, 13]];
      spots.forEach(([cx, cy], i) => {
        cx += Math.floor(hash(i, b, 47) * 2);
        if (![[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]].every(([dx, dy]) => m(cx + dx, cy + dy))) return;
        pix[cx - 1 + ',' + cy] = CLOVER.leafLt;
        pix[cx + 1 + ',' + cy] = CLOVER.leaf;
        pix[cx + ',' + (cy - 1)] = CLOVER.leafHi;
        pix[cx + ',' + cy] = CLOVER.leaf;
        pix[cx + ',' + (cy + 1)] = CLOVER.leaf;
      });
      // a clover bloom or two
      for (const [cx, cy] of b % 2 ? [[7, 4]] : [[4, 7], [11, 12]]) {
        if (![[0, 0], [1, 0], [0, 1], [1, 1], [0, 2]].every(([dx, dy]) => m(cx + dx, cy + dy))) continue;
        pix[cx + ',' + cy] = CLOVER.bloom;
        pix[cx + 1 + ',' + cy] = CLOVER.bloomTip;
        pix[cx + ',' + (cy + 1)] = CLOVER.bloom;
        pix[cx + 1 + ',' + (cy + 1)] = CLOVER.bloom;
        pix[cx + ',' + (cy + 2)] = CLOVER.leaf;
      }
      cache.set(key, tileCanvas(key + ':c', (x, y) => pix[x + ',' + y] || null));
    }
    g.drawImage(cache.get(key), ox, oy);
  }

  // Objects ---------------------------------------------------------------------------------

  // Draw a sprite standing on the tile: centred on cx, its bottom row at `base`.
  function stand(g, c, cx, base) {
    g.drawImage(c, Math.round(cx - c.width / 2), base - c.height + 1);
  }

  // Foliage from overlapping round clumps, listed back to front: each clump is lit from the top-left
  // and shaded where a nearer clump overlaps it; `base` rows show through where there are no leaves.
  function foliage(w, h, clumps, base) {
    const own = (x, y) => {
      let k = -1;
      clumps.forEach(([cx, cy, r], i) => {
        if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) k = i;
      });
      return k;
    };
    const rows = [];
    for (let y = 0; y < h; y++) {
      let s = '';
      for (let x = 0; x < w; x++) {
        const k = own(x, y);
        if (k < 0) {
          s += base ? base[y][x] || '.' : '.';
          continue;
        }
        const [cx, cy, r] = clumps[k];
        const nx = (x + 0.5 - cx) / r, ny = (y + 0.5 - cy) / r;
        const lit = -(nx * 0.55 + ny * 0.85);
        const under = own(x, y + 1);
        if (under > k) s += lit > 0.2 ? 'g' : 'k'; // in the shadow of a nearer clump
        else if (under < 0 && own(x, y + 2) < 0 && ny > 0.4) s += 'k'; // the underside
        else s += lit > 0.5 ? 'H' : lit < -0.35 ? 'g' : 'G';
      }
      rows.push(s);
    }
    return rows;
  }
  // Swap the leaf pixels at `pts` for an accent (berries, fruit, flowers).
  const accent = (rows, pts, ch = 'x') =>
    rows.map((r, y) => [...r].map((c, x) => (pts.some(([a, b]) => a === x && b === y) && 'HGgk'.includes(c) ? ch : c)).join(''));

  const BUSH_LEAVES = foliage(10, 7, [[5, 2.7, 2.7], [2.6, 4.2, 2.5], [7.4, 4.2, 2.5], [3.7, 5.3, 2.4], [6.5, 5.4, 2.4]]);
  const BUSH_DOTS = [[2, 2], [6, 1], [8, 4], [4, 4], [6, 6], [1, 5], [8, 2]];
  const BUSH_ROWS = { green: inked(BUSH_LEAVES), berry: inked(accent(BUSH_LEAVES, BUSH_DOTS)), flowering: inked(accent(BUSH_LEAVES, BUSH_DOTS)) };
  const BUSH_X = { green: {}, berry: { x: '#c0533f' }, flowering: { x: '#fbd6e3' } };
  function bush(g, ox, oy, o) {
    const v = BUSH_ROWS[o.variant] ? o.variant : 'green';
    shadow(g, ox + 2, oy + 15, 12);
    stand(g, spr('bush' + v, BUSH_ROWS[v], BUSH_X[v], flipOf(o)), ox + 8, oy + 14);
  }

  const CROWN = foliage(14, 15, [[7, 3.4, 3.4], [3.8, 5.6, 3], [10.2, 5.6, 3], [7, 7.6, 3.6], [2.9, 9.4, 2.8], [11.1, 9.4, 2.8], [5, 11.6, 3.1], [9.4, 11.8, 3.1]]);
  const CROWN_DOTS = [[4, 5], [9, 3], [11, 7], [6, 9], [3, 11], [10, 12], [7, 13]];
  const OAK = inked(CROWN);
  const FRUIT = inked(accent(CROWN, CROWN_DOTS));
  const BLOSSOM = inked(accent(CROWN, [[5, 3], [10, 5], [3, 8], [8, 8], [11, 11], [5, 12]]));
  const TRUNK = ['.oddddo.', '.oddddo.', '.owmmdo.', '.owmmdo.', '.owmmdo.', '.owmmdo.', '.owmmdo.', '.owmmdo.', '.owmmdo.', 'owwmmddo', 'oooooooo'];

  // Pine: stacked tiers (listed bottom first; each upper tier's skirt hangs over the one below).
  const PINE = (() => {
    const w = 14, h = 22, tiers = [[13, 21, 7], [8, 15, 5.6], [4, 10, 4.2], [0, 5, 2.6]];
    const half = (y, [t, b, hw]) => 0.6 + (hw - 0.6) * (y - t) / (b - t);
    const own = (x, y) => {
      let k = -1;
      tiers.forEach((tr, i) => {
        if (y >= tr[0] && y <= tr[1] && Math.abs(x + 0.5 - w / 2) <= half(y, tr)) k = i;
      });
      return k;
    };
    const rows = [];
    for (let y = 0; y < h; y++) {
      let r = '';
      for (let x = 0; x < w; x++) {
        const k = own(x, y);
        if (k < 0) r += '.';
        else if (own(x, y - 1) > k) r += 'k';
        else {
          const nx = (x + 0.5 - w / 2) / half(y, tiers[k]);
          r += y === tiers[k][1] ? 'g' : nx < -0.3 ? 'H' : nx > 0.4 ? 'g' : 'G';
        }
      }
      rows.push(r);
    }
    return [...inked(rows), '......owdo......', '......owdo......', '.....owmddo.....', '.....oooooo.....'];
  })();
  const BARK = { w: '#a0703f', m: '#8a5f3c', d: '#6b4a2b' };
  const TREE_PAL = {
    oak: {},
    fruit: { x: '#e0665c' },
    blossom: { H: '#fde4ee', G: '#f6b8cf', g: '#ee8fa3', k: '#d97a98', x: '#ffffff' },
    pine: { H: '#6fa04a', G: '#4f8a3e', g: '#3d6b34', k: '#2f5229' },
  };
  function tree(g, ox, oy, o) {
    const v = TREE_PAL[o.variant] ? o.variant : 'oak';
    const f = flipOf(o), t = o.t || 0, s = o.seed || 0;
    shadow(g, ox + 1, oy + 15, 14);
    if (v === 'pine') {
      const c = spr('tree-pine', PINE, { ...TREE_PAL.pine, ...BARK }, f);
      g.drawImage(c, ox, oy + 15 - c.height);
      return;
    }
    const trunk = spr('trunk', TRUNK, BARK);
    g.drawImage(trunk, ox + 4, oy + 15 - trunk.height);
    const crown = spr('crown' + v, v === 'fruit' ? FRUIT : v === 'blossom' ? BLOSSOM : OAK, TREE_PAL[v], f);
    const cy = oy + 15 - trunk.height + 4 - crown.height;
    g.drawImage(crown, ox, cy);
    // now and then a petal or a leaf drifts down
    const k = (t * 0.22 + s) % 1;
    if (k < 0.6) {
      const kk = k / 0.6;
      px(g, ox + (f ? 12 : 3) + Math.round(Math.sin(kk * 9) * 2 + kk * (f ? -5 : 5)), cy + 12 + Math.round(kk * 10), 1, 1, v === 'blossom' ? '#f6b8cf' : '#7fb04f');
    }
  }


  const ROCK_SMALL = [
    '...oooo...',
    '..oSSssoo.',
    '.oSssssszo',
    'oSssssszzo',
    'ozsszzzzZo',
    '.oZZZZZZo.',
    '..oooooo..',
  ];
  const ROCK_MOSSY = [
    '.....ooooo....',
    '...ooHGGGHoo..',
    '..oHGGsGGGsGo.',
    '.oSsGssssGsszo',
    'oSsssssszzzzzo',
    'oSssssszzzzgZo',
    'ozzsszzzzZgGZo',
    '.oZZZZZZZZZZo.',
    '..oooooooooo..',
  ];
  function rock(g, ox, oy, o) {
    const mossy = o.variant === 'mossy';
    const c = spr('rock' + (mossy ? 'm' : 's'), mossy ? ROCK_MOSSY : ROCK_SMALL, null, flipOf(o));
    shadow(g, ox + 8 - (c.width >> 1), oy + 15, c.width);
    stand(g, c, ox + 8, oy + 14);
  }

  const MUSH_BIG = [
    '..ooooo..',
    '.oAxAaao.',
    'oAAAaaxao',
    'oaxaaaabo',
    'ooooooooo',
    '..occCo..',
    '..occCo..',
    '..ooooo..',
  ];
  const MUSH_SMALL = ['.ooo.', 'oAxao', 'oaabo', 'ooooo', '.oco.', '.ooo.'];
  const MUSH_PAL = {
    red: { A: '#f08a80', a: '#e0665c', b: '#a83e3a', x: '#ffffff' },
    brown: { A: '#e3ab70', a: '#b5733a', b: '#8a5228', x: '#f6f1e4' },
  };
  function mushrooms(g, ox, oy, o) {
    const v = MUSH_PAL[o.variant] ? o.variant : 'red';
    const f = flipOf(o);
    const big = spr('mushB' + v, MUSH_BIG, MUSH_PAL[v], f), small = spr('mushS' + v, MUSH_SMALL, MUSH_PAL[v], f);
    shadow(g, ox + 2, oy + 15, 12);
    stand(g, big, ox + (f ? 10 : 6), oy + 14);
    stand(g, small, ox + (f ? 3 : 13), oy + 14);
  }

  // Fence: a post on every tile, rails to same-piece neighbours, in the approved fence's woods.
  const FW = { o: INK, l: '#f5b062', m: '#c27439', d: '#a05a2c', t1: '#81b852', t2: '#5f9a44', t3: '#357236' };
  function fence(g, ox, oy, o) {
    const same = o.same || (() => false);
    const top = oy + 0, base = oy + 14; // post: 6 wide, rows top..base
    const rail = (x0, x1) => {
      // two rails like the approved fence segment
      px(g, x0, top + 3, x1 - x0, 5, INK);
      px(g, x0, top + 4, x1 - x0, 1, FW.l);
      px(g, x0, top + 5, x1 - x0, 2, FW.m);
      px(g, x0, top + 9, x1 - x0, 4, INK);
      px(g, x0, top + 10, x1 - x0, 1, FW.l);
      px(g, x0, top + 11, x1 - x0, 1, FW.d);
    };
    if (same(-1, 0)) rail(ox, ox + 6);
    if (same(1, 0)) rail(ox + 10, ox + 16);
    if (same(0, 1)) {
      // a rail running toward the viewer, down to the next post
      px(g, ox + 6, top + 6, 4, 16, INK);
      px(g, ox + 7, top + 6, 1, 16, FW.l);
      px(g, ox + 8, top + 6, 1, 16, FW.m);
    }
    // post
    px(g, ox + 5, top, 6, base - top + 1, INK);
    px(g, ox + 6, top + 1, 4, base - top - 1, FW.m);
    px(g, ox + 6, top + 1, 1, base - top - 1, FW.d);
    px(g, ox + 9, top + 1, 1, base - top - 1, FW.d);
    px(g, ox + 6, top + 1, 4, 1, FW.l);
    px(g, ox + 7, top + 2, 2, 1, FW.l);
    px(g, ox + 7, top + 5, 1, 3, FW.l);
    // grass tufts at its foot
    px(g, ox + 4, base - 1, 1, 2, FW.t2);
    px(g, ox + 3, base, 1, 1, FW.t1);
    px(g, ox + 11, base - 1, 1, 2, FW.t1);
    px(g, ox + 12, base, 1, 1, FW.t3);
    px(g, ox + 6, base, 1, 1, FW.t1);
    px(g, ox + 9, base, 1, 1, FW.t2);
  }

  let lanternImg = null;
  function lantern(g, ox, oy, o) {
    if (!lanternImg) lanternImg = artImage('lantern_post');
    if (!ready(lanternImg)) return;
    const x = ox - 1, y = oy + 16 - lanternImg.height;
    g.drawImage(lanternImg, x, y);
    // the flame flickers: a pixel brightens or dims now and then
    const t = o.t || 0, f = Math.sin(t * 9 + (o.seed || 0) * 30) + Math.sin(t * 23.7);
    if (f > 1.1) px(g, x + 18, y + 16, 1, 1, '#fffbe6');
    else if (f < -1.2) px(g, x + 18, y + 17, 1, 1, '#f2b84e');
  }

  const BENCH = (() => {
    const r = (a, n, b) => a + n + b;
    const rep = (ch, n) => ch.repeat(n);
    return [
      r('.', rep('o', 26), '.'),
      r('.oW', rep('w', 22), 'mo.'),
      r('.o', rep('m', 23), 'do.'),
      r('.', rep('o', 26), '.'),
      r('..odo', rep('.', 18), 'odo..'),
      rep('o', 28),
      r('oW', rep('w', 25), 'o'),
      r('o', rep('w', 25), 'mo'),
      r('o', rep('d', 26), 'o'),
      r('o', rep('w', 25), 'mo'),
      r('o', rep('m', 25), 'do'),
      rep('o', 28),
      r('.odo', rep('.', 20), 'odo.'),
      r('.odo', rep('.', 20), 'odo.'),
      r('.ooo', rep('.', 20), 'ooo.'),
    ];
  })();
  function bench(g, ox, oy) {
    shadow(g, ox + 2, oy + 15, 28);
    g.drawImage(spr('bench', BENCH), ox + 2, oy + 15 - BENCH.length);
  }

  const SIGN = [
    '.oooooooooooo.',
    'oWWwwwwwwwwwmo',
    'owzwwwwwwwwzmo',
    'owwwwwwwwwwwmo',
    'owwwwwwwwwwwmo',
    'ommmmmmmmmmmdo',
    '.oooooooooooo.',
    '.....omdo.....',
    '.....omdo.....',
    '.....omdo.....',
    '.....omdo.....',
    '.....omdo.....',
    '.....oooo.....',
  ];
  function sign(g, ox, oy) {
    shadow(g, ox + 5, oy + 15, 6);
    g.drawImage(spr('sign', SIGN), ox + 1, oy + 15 - SIGN.length);
  }

  const BIRDHOUSE = [
    '.....oo.....',
    '....oAro....',
    '...oAArRo...',
    '..oAArrrRo..',
    '.oAArrrrrRo.',
    'oooooooooooo',
    '.oWwwwwwwmo.',
    '.owwwoowwmo.',
    '.owwwoowwmo.',
    '.owwwwdddmo.',
    '.ommmmmmmdo.',
    '.oooooooooo.',
    '....owmo....',
    '....owmo....',
    '....owmo....',
    '....owmo....',
    '....owmo....',
    '....owmo....',
    '....owmo....',
    '....owmo....',
    '....owmo....',
    '...oowmoo...',
    '...oooooo...',
  ];
  function birdhouse(g, ox, oy, o) {
    shadow(g, ox + 5, oy + 15, 6);
    stand(g, spr('birdhouse', BIRDHOUSE), ox + 8, oy + 14);
    // now and then a bird peeks out
    if (Math.sin((o.t || 0) * 0.7 + (o.seed || 0) * 20) > 0.7) {
      const y = oy + 14 - BIRDHOUSE.length + 1;
      px(g, ox + 7, y + 7, 2, 2, '#7fa7e8');
      px(g, ox + 7, y + 7, 1, 1, INK);
    }
  }

  const SCARECROW = [
    '.....oooooo.....',
    '.....oVyyYo.....',
    '.....oyyyYo.....',
    '....orrrrrRo....',
    '..oVyyyyyyyyYo..',
    '..oooooooooooo..',
    '....occcccCo....',
    '....ococcoCo....',
    '....opcccpCo....',
    '....oooooooo....',
    'ooooobbbbbbBoooo',
    'Vybbbbbbbbbbbbyo',
    'oyBbbbBbbbbbBBYo',
    'ooooobbbybbBoooo',
    '....obbbbbbBo...',
    '....oBBBBBBBo...',
    '....oooooooo....',
    '.......owmo.....',
    '.......owmo.....',
    '.......owmo.....',
    '.......owmo.....',
    '.......owmo.....',
    '......oowmoo....',
    '......oooooo....',
  ];
  function scarecrow(g, ox, oy) {
    shadow(g, ox + 4, oy + 15, 8);
    g.drawImage(spr('scarecrow', SCARECROW, { n: INK }), ox, oy + 15 - SCARECROW.length);
  }

  const HIVE = [
    '....oooo....',
    '...oVyyYo...',
    '..oVyyyyYo..',
    '..oYYYYYYo..',
    '.oVyyyyyyYo.',
    '.oYYYYYYYYo.',
    'oVyyyyyyyyYo',
    'oVyyyooyyyYo',
    'oYYYYooYYYYo',
    'oooooooooooo',
    '.oWwwwwwwmo.',
    '.oooooooooo.',
    '..odo..odo..',
    '..ooo..ooo..',
  ];
  function beehive(g, ox, oy, o) {
    shadow(g, ox + 3, oy + 15, 10);
    const c = spr('hive', HIVE);
    stand(g, c, ox + 8, oy + 14);
    // two bees drifting in loops around it
    const t = o.t || 0, s = (o.seed || 0) * 10;
    for (let i = 0; i < 2; i++) {
      const a = t * (1.1 + i * 0.4) + s + i * 2.5;
      const bx = Math.round(ox + 8 + Math.cos(a) * (7 + i) + Math.sin(a * 2.3) * 1.5);
      const by = Math.round(oy + 1 - i * 2 + Math.sin(a * 1.7) * 3);
      px(g, bx, by, 2, 1, '#f2c14e');
      px(g, bx + (Math.cos(a) > 0 ? 1 : 0), by, 1, 1, INK);
      if (Math.sin(t * 30 + i) > 0) px(g, bx, by - 1, 1, 1, '#ffffff');
    }
  }

  // Rose arch: two posts and an arched top under a leafy climbing rose.
  const ARCH = (() => {
    const w = 18, h = 28, base = [];
    for (let y = 0; y < h; y++) {
      let s = '';
      for (let x = 0; x < w; x++) {
        const d = Math.hypot(x + 0.5 - 9, y + 0.5 - 9);
        if (y >= 9 && (x === 1 || x === 14)) s += 'w';
        else if (y >= 9 && (x === 2 || x === 15)) s += 'm';
        else if (y >= 9 && (x === 3 || x === 16)) s += 'd';
        else if (y < 9 && d >= 6 && d < 8.6) s += d < 7.2 ? 'd' : 'm';
        else s += '.';
      }
      base.push(s);
    }
    const clumps = [];
    for (let a = 0; a <= 12; a++) {
      const th = Math.PI + (a / 12) * Math.PI;
      clumps.push([9 + Math.cos(th) * 7.2, 9 + Math.sin(th) * 7.2 + (a % 2 ? 0.6 : 0), 2.5]);
    }
    for (const [y, r] of [[12, 2.3], [15.5, 2.2], [19, 2.1], [23, 1.8]]) {
      clumps.push([2.4 + (y % 2 ? 0.4 : 0), y, r], [15.6 - (y % 2 ? 0.3 : 0), y + 1.5, r]);
    }
    const rows = foliage(w, h, clumps, base).map((r) => [...r]);
    // roses: a 2x2 bloom with a light petal
    for (const [x, y] of [[3, 4], [8, 1], [13, 3], [1, 11], [15, 14], [2, 18], [14, 21]]) {
      rows[y][x] = 'A';
      rows[y][x + 1] = 'r';
      rows[y + 1][x] = 'r';
      rows[y + 1][x + 1] = 'R';
    }
    return inked(rows.map((r) => r.join('')));
  })();
  function arch(g, ox, oy) {
    shadow(g, ox - 1, oy + 15, 6);
    shadow(g, ox + 12, oy + 15, 6);
    g.drawImage(spr('arch', ARCH), ox - 2, oy + 16 - ARCH.length);
  }


  // Garden shed (2x2 tiles): plank walls, a door, a window with a flower box, a roof in a flavour.
  function shed(g, ox, oy, o) {
    const f = FLAVOURS[o.variant] || FLAVOURS[Object.keys(FLAVOURS)[0]];
    const roof = { hi: shadeHex(f.b, 0.3), b: f.b, s: f.s, dk: shadeHex(f.s, -0.25) };
    const x = ox, y = oy;
    shadow(g, x + 2, y + 32, 28);
    // walls
    px(g, x + 3, y + 14, 26, 18, INK);
    px(g, x + 4, y + 14, 24, 17, '#d39556');
    for (let r = 0; r < 6; r++) px(g, x + 4, y + 16 + r * 3, 24, 1, '#b5733a');
    px(g, x + 4, y + 30, 24, 1, '#8a5228');
    // door
    px(g, x + 7, y + 19, 9, 13, INK);
    px(g, x + 8, y + 20, 7, 11, '#8a5228');
    px(g, x + 8, y + 20, 7, 1, '#b5733a');
    px(g, x + 11, y + 20, 1, 11, '#6b4a2b');
    px(g, x + 13, y + 25, 1, 1, '#f2c14e');
    // stone step
    px(g, x + 6, y + 31, 11, 2, INK);
    px(g, x + 7, y + 31, 9, 1, '#b3b1ab');
    // window with a cross frame and a shine
    px(g, x + 18, y + 18, 8, 7, INK);
    px(g, x + 19, y + 19, 6, 5, '#9fd3f2');
    px(g, x + 21, y + 19, 1, 5, INK);
    px(g, x + 19, y + 21, 6, 1, INK);
    px(g, x + 19, y + 19, 1, 1, '#ffffff');
    px(g, x + 22, y + 22, 1, 1, '#d4f0fb');
    // flower box
    px(g, x + 17, y + 25, 10, 3, INK);
    px(g, x + 18, y + 26, 8, 1, '#b5733a');
    for (let i = 0; i < 4; i++) {
      px(g, x + 18 + i * 2, y + 24, 1, 1, i % 2 ? '#f2c14e' : '#f29ac2');
      px(g, x + 19 + i * 2, y + 24, 1, 1, '#5f8f3e');
    }
    // roof: a shingled slab overhanging the walls, narrowing to the ridge
    const ry = y - 3;
    for (let r = 0; r < 18; r++) {
      const inset = Math.max(0, 3 - Math.floor(r / 2));
      const lx = x + inset, w = 32 - inset * 2;
      px(g, lx, ry + r, w, 1, INK);
      if (r === 0 || r === 17) continue;
      const col = r === 1 ? roof.hi : r === 16 ? roof.dk : r % 4 === 0 ? roof.s : roof.b;
      px(g, lx + 1, ry + r, w - 2, 1, col);
      if (r > 1 && r < 16 && r % 4 === 2) for (let i = 0; i < 6; i++) px(g, lx + 3 + ((i * 5 + (r % 8 === 2 ? 0 : 2)) % (w - 4)), ry + r, 1, 2, roof.s);
    }
    px(g, x + 6, ry + 2, 6, 1, roof.hi);
    // chimney
    px(g, x + 22, ry - 3, 5, 6, INK);
    px(g, x + 23, ry - 2, 3, 4, '#b3b1ab');
    px(g, x + 23, ry - 2, 3, 1, '#ddd7c8');
  }

  const PUMPKIN = inked([
    '......dGG.....',
    '......dGgG....',
    '..uunnNnnnNn..',
    '.uunnnNnnnnNn.',
    'uunnnNnnnnnNnN',
    'unnnnNnnnnnNnN',
    'unnnnNnnnnnNNN',
    'nnnnnNnnnnnNNN',
    '.NnnnNNnnnNNN.',
    '..NNNNNNNNNN..',
  ]);
  function pumpkin(g, ox, oy, o) {
    shadow(g, ox + 1, oy + 15, 14);
    stand(g, spr('pumpkin', PUMPKIN, null, flipOf(o)), ox + 8, oy + 14);
  }

  const WELL = [
    '......oooo......',
    '....ooWWwmoo....',
    '..ooWWwwwwmmoo..',
    '.oWWwwwwwwwwmmo.',
    'oddddddddddddddo',
    'oooooooooooooooo',
    '..owo...o...owo.',
    '..owo...o...owo.',
    '..owo..oooo.owo.',
    '..owo..owmo.owo.',
    '..owo..oddo.owo.',
    '..owo..oooo.owo.',
    '.oooooooooooooo.',
    'oSSSSSSSSSSSSSSo',
    'oSsollllllllosSo',
    'ozsSSSSSSSSSSszo',
    'oooooooooooooooo',
    'osSSzsSSzsSSzszo',
    'ozzzzzzzzzzzzzZo',
    'oSszsSSzsSszsSzo',
    'ozzzzzzzzzzzzzZo',
    '.oZZZZZZZZZZZZo.',
    '..oooooooooooo..',
  ];
  function well(g, ox, oy, o) {
    shadow(g, ox + 1, oy + 16, 14);
    const c = spr('well', WELL, { l: '#3f7fa6' });
    const x = ox, y = oy + 15 - WELL.length + 1;
    g.drawImage(c, x, y);
    // the water glints
    const k = Math.floor(((o.t || 0) * 2 + (o.seed || 0) * 7) % 9);
    if (k < 4) px(g, x + 5 + k * 2, y + 14, 2, 1, '#9fd3f2');
  }

  const FIRE_STONES = [
    '...ooo.ooo....',
    '..oSsoosSso...',
    '.oSzo.....oso.',
    'osszo.....ozzo',
    'oSzo.......oso',
    '.oso.....oSzo.',
    '..oosSsosszoo.',
    '....ooooooo...',
  ];
  const FLAMES = [
    ['...o....', '..oyo...', '..oyyo.o', '.oyVyooy', '.onVVyyo', 'onyVVyno', 'onnyynno', '.oNnnNo.'],
    ['....o...', '...oyo..', 'o..oyyo.', 'yo.oyVyo', 'oyyVVyno', 'onyVVyno', 'onnyynno', '.oNnnNo.'],
    ['..o.....', '.oyo..o.', '.oyyooyo', '.oyVyyyo', 'onyVVyo.', 'onyVVyno', 'onnyynno', '.oNnnNo.'],
  ];
  function campfire(g, ox, oy, o) {
    shadow(g, ox + 1, oy + 15, 14);
    const st = spr('fire-stones', FIRE_STONES);
    const x = ox + 1, y = oy + 15 - st.height;
    g.drawImage(st, x, y);
    // crossed logs
    px(g, x + 3, y + 3, 8, 3, INK);
    px(g, x + 4, y + 4, 6, 1, '#8a5228');
    px(g, x + 4, y + 2, 2, 4, INK);
    px(g, x + 8, y + 2, 2, 4, INK);
    px(g, x + 5, y + 3, 1, 1, '#b5733a');
    px(g, x + 8, y + 3, 1, 1, '#b5733a');
    const t = o.t || 0;
    const fr = Math.floor(t * 7 + (o.seed || 0) * 3) % 3;
    g.drawImage(spr('flame' + fr, FLAMES[fr]), x + 3, y - 4);
    // a spark rising
    const k = (t * 0.9 + (o.seed || 0)) % 1;
    if (k < 0.7) px(g, x + 6 + Math.round(Math.sin(k * 8) * 2), y - 5 - Math.round(k * 9), 1, 1, k < 0.35 ? '#f6d77a' : '#f08a3c');
  }

  function windchime(g, ox, oy, o) {
    const base = oy + 14, top = oy - 7;
    shadow(g, ox + 3, oy + 15, 6);
    // a wooden post with an arm and a brace, like the lantern post
    px(g, ox + 3, top, 4, base - top + 1, INK);
    px(g, ox + 4, top + 1, 1, base - top - 1, '#d39556');
    px(g, ox + 5, top + 1, 1, base - top - 1, '#b5733a');
    px(g, ox + 6, top, 8, 3, INK);
    px(g, ox + 6, top + 1, 7, 1, '#d39556');
    px(g, ox + 7, top + 3, 2, 1, INK);
    px(g, ox + 7, top + 4, 1, 1, INK);
    px(g, ox + 7, top + 3, 1, 1, '#b5733a');
    // string, a little wooden top, and tubes that swing a pixel apart
    const t = o.t || 0;
    const sw = Math.sin(t * 1.6 + (o.seed || 0) * 20) > 0.5 ? 1 : 0;
    const cx = ox + 11;
    px(g, cx, top + 3, 1, 2, INK);
    px(g, cx - 3 + sw, top + 5, 7, 2, INK);
    px(g, cx - 2 + sw, top + 5, 5, 1, '#b5733a');
    [7, 9, 8, 6].forEach((len, i) => {
      const tx = cx - 3 + i * 2 + sw + (i > 1 && Math.sin(t * 2.3 + i) > 0.7 ? 1 : 0);
      px(g, tx, top + 7, 1, len, i % 2 ? '#b3b1ab' : '#ddd7c8');
      px(g, tx, top + 7 + len, 1, 1, '#8d8b86');
    });
    // the clapper and its wind-catcher
    px(g, cx + sw, top + 7, 1, 10, INK);
    px(g, cx - 1 + sw, top + 17, 3, 3, INK);
    px(g, cx + sw, top + 18, 1, 1, '#7fa7e8');
  }

  const DRAW = { soil, path, cobble, water, flowers, clover, bush, tree, rock, mushrooms, fence, lantern, bench, sign, birdhouse, scarecrow, beehive, arch, shed, pumpkin, well, campfire, windchime };

  // Construction ------------------------------------------------------------------------------

  const SW = 72, SH = 96, SX = 20, SY = 48; // scratch canvas and where a piece's tile goes on it
  let scratch = null;
  function scratchCanvas() {
    if (!scratch) {
      const c = document.createElement('canvas');
      c.width = SW;
      c.height = SH;
      scratch = { c, g: c.getContext('2d') };
    }
    scratch.g.clearRect(0, 0, SW, SH);
    return scratch;
  }

  const PLANKS = ['oooooooo', 'oWwwwwmo', 'oooooooo', '.oooooooo', '.owwwwmdo', '.oooooooo'];
  const STONES = ['.ooo.ooo.', 'oSsoozsso', 'oszooZzzo', '.ooooooo.'];
  const SAPLING = ['.o.oo.', 'oHoGGo', 'oGgGgo', '.oggo.', '..od..', '..od..', '..oo..'];
  const TUFT = inked(foliage(7, 4, [[3.5, 2.2, 2.2], [1.9, 2.9, 1.7], [5.1, 2.9, 1.7]]));
  const YOUNG_TREE = (() => {
    const crown = inked(foliage(8, 7, [[4, 3, 3], [2.4, 4.6, 2.3], [5.6, 4.6, 2.3]]));
    return [...crown.slice(0, -1), ...crown.slice(-1).map((r) => r.slice(0, 3) + 'oddo' + r.slice(7)), '...owdo...', '...owdo...', '...owdo...', '...oooo...'];
  })();
  const PLANTS = new Set(['bush', 'tree', 'pumpkin', 'mushrooms']);
  const STONY = new Set(['rock', 'well', 'campfire', 'cobble', 'path']);

  // The top row of a piece's finished art on the scratch canvas (cached), so a reveal spans the art.
  const artTops = new Map();
  function artTop(name, o, s) {
    const key = name + ':' + (o.variant || '');
    if (!artTops.has(key)) {
      const d = s.g.getImageData(0, 0, SW, SH).data;
      let top = SY;
      for (let y = 0; y < SH; y++) {
        let hit = false;
        for (let x = 0; x < SW && !hit; x++) hit = d[(y * SW + x) * 4 + 3] > 0;
        if (hit) {
          top = y;
          break;
        }
      }
      artTops.set(key, top);
    }
    return artTops.get(key);
  }

  // Bare earth, marked out for a ground piece (cached per neighbour shape).
  function earth(nb, dark) {
    const m = patchMask(nb, { n: 1, s: 1, w: 1, e: 1 }, false, 0);
    return tileCanvas('earth' + nbKey(nb) + (dark ? 'd' : ''), (x, y) => {
      if (!m(x, y)) return null;
      if (!m(x, y - 1) || !m(x - 1, y) || !m(x + 1, y) || !m(x, y + 1)) return SOIL.edge;
      const h = hash(x, y, 101);
      if (h < 0.08) return SOIL.ridge;
      if (h < 0.16 || dark) return SOIL.furrow;
      return SOIL.base;
    });
  }

  function drawBuilding(g, name, ox, oy, o, b) {
    const def = PIECES[name];
    const [tw, th] = def.size || [1, 1];
    if (def.layer === 'ground') {
      // marked-out earth, then the finished tile laid over it in a rough diagonal sweep
      g.drawImage(earth(nbOf(o), name === 'water'), ox, oy);
      const s = scratchCanvas();
      DRAW[name](s.g, SX, SY, { ...o, build: 1 });
      const salt = Math.floor((o.seed || 0) * 50);
      for (let cy = 0; cy < 4; cy++) for (let cx = 0; cx < 4; cx++) {
        const at = (cx + cy) / 7 * 0.8 + hash(cx, cy, 5 + salt) * 0.2;
        if (at < b) g.drawImage(s.c, SX + cx * 4, SY + cy * 4, 4, 4, ox + cx * 4, oy + cy * 4, 4, 4);
      }
      return;
    }
    // objects go up from the ground; plants start as a sapling
    const plant = PLANTS.has(name);
    if (plant) {
      // plants grow: a sapling, then a young one, then (when finished) the full plant
      const pal = name === 'tree' ? TREE_PAL[o.variant] || {} : {};
      const c = b < 0.4 ? spr('sapling', SAPLING) : name === 'tree' ? spr('young' + o.variant, YOUNG_TREE, { ...pal, ...BARK }) : spr('tuft', TUFT);
      shadow(g, ox + 8 - (c.width >> 1), oy + 15, c.width);
      stand(g, c, ox + 8, oy + 14);
      return;
    }
    const s = scratchCanvas();
    DRAW[name](s.g, SX, SY, { ...o, build: 1, t: 0 });
    const bottom = SY + th * T + 1;
    const rows = Math.max(1, Math.ceil((bottom - artTop(name, o, s)) * b));
    g.drawImage(s.c, 0, bottom - rows, SW, rows, ox - SX, oy + th * T + 1 - rows, SW, rows);
    {
      // a little pile of materials beside it, shrinking as it's used up
      const stony = STONY.has(name);
      const pile = spr(stony ? 'pile-stones' : 'pile-planks', stony ? STONES : PLANKS);
      const show = b < 0.6 ? pile.height : Math.ceil(pile.height / 2);
      g.drawImage(pile, 0, pile.height - show, pile.width, show, ox + tw * T - 4, oy + th * T - show, pile.width, show);
    }
  }

  function draw(g, name, ox, oy, o = {}) {
    if (!DRAW[name]) return;
    ox = Math.round(ox);
    oy = Math.round(oy);
    const b = o.build == null ? 1 : Math.max(0, o.build);
    if (b >= 1) DRAW[name](g, ox, oy, o);
    else drawBuilding(g, name, ox, oy, o, b);
  }

  function anchor(name, ox, oy) {
    if (name === 'sign') return { x: ox + 8, y: oy + 5 };
    const [w] = PIECES[name]?.size || [1, 1];
    return { x: ox + (w * T) / 2, y: oy };
  }

  // A standalone picture of a piece (for menus/cards): finished, on transparent, trimmed to fit.
  function icon(name, variant) {
    const key = 'icon:' + name + ':' + (variant || '');
    if (cache.has(key)) return cache.get(key);
    const def = PIECES[name];
    if (!def) return null;
    if (name === 'lantern' && !(lanternImg && ready(lanternImg))) {
      lanternImg = lanternImg || artImage('lantern_post');
      return null; // not loaded yet: ask again later
    }
    const [tw, th] = def.size || [1, 1];
    const above = def.above || 0;
    const c = document.createElement('canvas');
    c.width = tw * T + 16;
    c.height = th * T + above + 4;
    DRAW[name](c.getContext('2d'), 8, above + 2, { variant: variant || def.variants?.[0], t: 0, seed: 0.3, build: 1, same: () => false });
    cache.set(key, c);
    return c;
  }

  return { draw, anchor, icon };
})();

// Draw one placed piece whose top-left tile is at world px (ox, oy). o: { variant, text, t, same(dx, dy), seed, build }.
export function drawPiece(g, name, ox, oy, o) {
  PieceArt.draw(g, name, ox, oy, o);
}

// World px centre of a sign's board, where the caller draws its text.
export function pieceTextAnchor(name, ox, oy) {
  return PieceArt.anchor(name, ox, oy);
}

// A finished piece on a small transparent canvas (for menus); lantern needs its art loaded.
export function pieceIcon(name, variant) {
  return PieceArt.icon(name, variant);
}
