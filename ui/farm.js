// Each mochi's land. A garden has no fixed shape: it's the desk corner plus whatever its session
// chose to build there (ui/build.js serves the session the tools; ui/pieces.js draws the pieces).
// When a session builds, its mochi walks out to each new piece and builds it, bouncing and
// throwing up dust. Token seeds still fall on their own: on soil they grow crops (mound, sprout,
// leaves, bud, harvest; hot-streak seeds can turn up rare ones), elsewhere wildflowers sprout.
//
// p.pieces: [{ k: piece, x, y (tiles from the plot's origin), v: variant, txt, b: built 0..1, crop }]
// The desk corner is tiles 0-2 across and down; the mochi sits in front of the desk.

const DESK_TILES = [];
for (let ty = 0; ty < 3; ty++) for (let tx = 0; tx < 3; tx++) DESK_TILES.push([tx, ty]);

const CROP_STAGES = [0, 5, 16, 36, 66]; // seeds needed for mound, sprout, leaves, bud, harvest
const CROP_KINDS = ['turnip', 'carrot', 'cabbage', 'strawberry', 'pumpkin', 'sunflower', 'wheat'];
const CROP_WEIGHTS = [18, 18, 16, 14, 10, 10, 14];

function pickCrop() {
  if (Math.random() < 0.012) return 'crystal';
  let r = Math.random() * CROP_WEIGHTS.reduce((a, b) => a + b, 0);
  for (let i = 0; i < CROP_KINDS.length; i++) if ((r -= CROP_WEIGHTS[i]) < 0) return CROP_KINDS[i];
  return 'turnip';
}

// Land ----------------------------------------------------------------------------------------

const pieceDef = (k) => PIECES[k] || { cost: 40, layer: 'object', size: [1, 1] };

function pieceTiles(pc) {
  const [w, h] = pieceDef(pc.k).size || [1, 1];
  const out = [];
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) out.push([pc.x + dx, pc.y + dy]);
  return out;
}

// What stands where, by "x,y" (plot tiles): { ground, object, desk }. Rebuilt when the land changes.
function landIndex(p) {
  if (p._land && p._landRev === p.landRev) return p._land;
  const at = new Map();
  const slot = (x, y) => at.get(x + ',' + y) || (at.set(x + ',' + y, {}), at.get(x + ',' + y));
  for (const [x, y] of DESK_TILES) slot(x, y).desk = true;
  for (const pc of p.pieces || []) {
    const layer = pieceDef(pc.k).layer === 'ground' ? 'ground' : 'object';
    for (const [x, y] of pieceTiles(pc)) slot(x, y)[layer] = pc;
  }
  p._land = at;
  p._landRev = p.landRev;
  return at;
}

function landChanged(p) {
  p.landRev = (p.landRev || 0) + 1;
  Garden.dirty = true;
}

// Every tile the garden covers, in world tiles.
function worldTiles(p) {
  if (p.x == null) return [];
  return [...landIndex(p).keys()].map((k) => {
    const [x, y] = k.split(',').map(Number);
    return [p.x + x, p.y + y];
  });
}

// The garden's extent in world tiles: x0..x1, y0..y1 inclusive.
function landBounds(p) {
  const tiles = worldTiles(p);
  if (!tiles.length) return null;
  const xs = tiles.map((t) => t[0]), ys = tiles.map((t) => t[1]);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

// A grid of the world marking every tile within `gap` of another garden (or the town square).
function occupancy(except, gap) {
  const grid = new Uint8Array(WORLD_COLS * WORLD_ROWS);
  const mark = (x, y) => {
    for (let yy = y - gap; yy <= y + gap; yy++)
      for (let xx = x - gap; xx <= x + gap; xx++) if (xx >= 0 && yy >= 0 && xx < WORLD_COLS && yy < WORLD_ROWS) grid[yy * WORLD_COLS + xx] = 1;
  };
  for (const o of Garden.plots) if (o !== except && o.x != null) for (const [x, y] of worldTiles(o)) mark(x, y);
  if (Garden.square) for (let y = 0; y < SQUARE_H; y++) for (let x = 0; x < SQUARE_W; x++) mark(Garden.square.x + x, Garden.square.y + y);
  return grid;
}

// Would the garden fit with its origin at (ox, oy), at least `gap` tiles from everything else?
function landFits(p, ox, oy, grid) {
  for (const k of landIndex(p).keys()) {
    const [x, y] = k.split(',').map(Number);
    const wx = ox + x, wy = oy + y;
    // room for the sign above and helpers below
    if (wx < 1 || wy < 2 || wx > WORLD_COLS - 2 || wy > WORLD_ROWS - 3) return false;
    if (grid[wy * WORLD_COLS + wx]) return false;
  }
  return true;
}

// Each session's wallet: some coins to start with, then one for every COIN_TOKENS tokens it uses.
// p.spent is what it has spent, in coins (p.coins marks gardens counted that way; older ones
// counted "materials", 40 coins each).
const COIN_TOKENS = 100, COIN_START = 250;
function wallet(p) {
  if (!p.coins) {
    p.spent = (p.spent || 0) * 40;
    p.coins = 1;
  }
  return COIN_START + Math.floor((p.tokens || 0) / COIN_TOKENS) - (p.spent || 0);
}

// Older gardens grew a fixed 6x4 farm: its tilled tiles become soil pieces, crops and all.
const OLD_FARM = (() => {
  const tiles = [];
  for (let ty = 0; ty < 4; ty++) for (let tx = 3; tx < 6; tx++) tiles.push([tx, ty]);
  for (let tx = 0; tx < 3; tx++) tiles.push([tx, 3]);
  return tiles.sort((a, b) => Math.hypot(a[0] - 2.6, a[1] - 1.8) - Math.hypot(b[0] - 2.6, b[1] - 1.8));
})();

function migrateLand(p) {
  if (p.pieces) return;
  p.pieces = [];
  const wild = {};
  for (let i = 0; i < (p.dug || 0); i++) {
    const [x, y] = OLD_FARM[i];
    const c = p.crops?.[i];
    p.pieces.push({ k: 'soil', x, y, b: 1, crop: c ? { k: c.k, w: c.w } : { k: pickCrop(), w: 0 } });
  }
  if (Array.isArray(p.wild)) p.wild.forEach((n, i) => n && OLD_FARM[i] && i >= (p.dug || 0) && (wild[OLD_FARM[i].join(',')] = n));
  p.wild = wild;
  p.spent = Math.min(p.pieces.length * pieceDef('soil').cost, COIN_START + Math.floor((p.tokens || 0) / COIN_TOKENS));
  p.coins = 1;
  delete p.dug;
  delete p.fenced;
  delete p.crops;
}

// Demo gardens (MOCHI_DEMO): something built, scaled to the plot's tokens.
function demoLand(p) {
  p.pieces = [];
  p.wild = {};
  const n = Math.min(14, Math.floor((p.tokens || 0) / 80e3));
  const kinds = ['soil', 'soil', 'soil', 'flowers', 'path', 'bush', 'tree', 'rock', 'lantern', 'mushrooms'];
  const spots = [[3, 0], [4, 0], [3, 1], [4, 1], [5, 1], [3, 2], [4, 2], [-1, 1], [0, 3], [1, 3], [2, 3], [5, 3], [-1, 3], [6, 0]];
  for (let i = 0; i < n; i++) {
    const [x, y] = spots[i];
    const k = i < 5 ? 'soil' : kinds[Math.floor(hash(i, n, 3) * kinds.length)];
    p.pieces.push({ k, x, y, b: 1, v: PIECES[k]?.variants?.[0], crop: k === 'soil' ? { k: pickCrop(), w: Math.floor(CROP_STAGES[4] * (0.3 + Math.random() * 0.9)) } : undefined });
  }
  landChanged(p);
}

// Building -----------------------------------------------------------------------------------

const buildSeconds = (pc) => Math.min(6, 0.9 + (pieceDef(pc.k).cost / 40) * 0.3); // bigger things take longer

// The mochi's next job: the oldest piece still waiting to be built. It goes even mid-answer.
function farmJob(p) {
  if (!p.live || !p.built || p.x == null) return null;
  const pc = (p.pieces || []).find((q) => q.b < 1);
  if (!pc) return giftJob(p);
  const [w, h] = pieceDef(pc.k).size || [1, 1];
  // stand at the piece's front edge
  return { kind: 'build', pc, x: (p.x + pc.x) * TILE + (w * TILE) / 2 - 6, y: (p.y + pc.y + h - 1) * TILE + 4 };
}

// Carrying a harvested crop over to a neighbour (build.js harvest): walk up beside them.
function giftJob(p) {
  const e = p.errands?.[0];
  if (!e) return null;
  const to = Garden.plots.find((o) => o.id === e.to && o.m && o.activity !== 'leaving');
  if (!to) {
    // they left the garden: it waits for them with their things
    const away = (Garden.allPlots || []).find((o) => o.id === e.to);
    if (away) receiveGift(p, away, e.k);
    p.errands.shift();
    return null;
  }
  return { kind: 'gift', e, to, x: to.m.x + 13, y: to.m.y + 2 };
}

function workFarmJob(p, job, dt, t) {
  if (job.kind === 'gift') {
    // handed over: hearts all round
    receiveGift(p, job.to, job.e.k);
    p.errands.shift();
    p.m.greetAt = t;
    job.to.m.greetAt = t;
    chime('done');
    return;
  }
  const m = p.m, pc = job.pc;
  if (!m.job || m.job.pc !== pc) m.job = { pc, hopAt: t };
  pc.b = Math.min(1, pc.b + dt / buildSeconds(pc));
  // bounce: a hop every 0.32s, throwing up dust (wood chips, stone chips) as it lands
  const ph = ((t - m.job.hopAt) % 0.32) / 0.32;
  m.digHop = Math.round(Math.sin(ph * Math.PI) * 3);
  if (ph < m.job.lastPh) {
    const ground = pieceDef(pc.k).layer === 'ground';
    const stone = /rock|cobble|well|path/.test(pc.k);
    for (let i = 0; i < 4; i++) {
      const c = stone ? (Math.random() < 0.5 ? '#c9c2b0' : '#8d8b86') : ground ? (Math.random() < 0.5 ? '#6f5238' : '#a07f5c') : Math.random() < 0.5 ? '#c48d55' : '#a0703f';
      Garden.dirt.push({ x: m.x + 6 + (Math.random() - 0.5) * 8, y: m.y + 10, vx: (Math.random() - 0.5) * 40, vy: -30 - Math.random() * 30, life: 0.45, age: 0, c });
    }
    digSound(!ground);
  }
  m.job.lastPh = ph;
  if (pc.b >= 1) {
    if (pc.k === 'soil' && !pc.crop) pc.crop = { k: pickCrop(), w: 0 };
    m.job = null;
    m.digHop = 0;
    Garden.dirty = true;
  }
}

function stepDirt(dt) {
  for (const d of Garden.dirt) {
    d.age += dt;
    d.vy += 160 * dt;
    d.x += d.vx * dt;
    d.y += d.vy * dt;
  }
  Garden.dirt = Garden.dirt.filter((d) => d.age < d.life);
}

function drawDirt(g) {
  for (const d of Garden.dirt) {
    g.fillStyle = d.c;
    g.fillRect(Math.round(d.x), Math.round(d.y), 1, 1);
  }
}

function digSound(wood) {
  if (!Sound.on || document.hidden) return;
  tone(wood ? 520 : 160 + Math.random() * 40, 0, { gain: 0.035, dur: 0.07, type: wood ? 'square' : 'triangle', drop: 0.6 });
}

// Seeds -------------------------------------------------------------------------------------

// Where a seed lands: mostly on soil (that's what it grows), otherwise on or around the garden.
function landingSpot(p) {
  const soil = (p.pieces || []).filter((q) => q.k === 'soil' && q.b >= 1);
  let tx, ty;
  if (soil.length && Math.random() < 0.7) ({ x: tx, y: ty } = soil[Math.floor(Math.random() * soil.length)]);
  else {
    // any tile of the garden or just around it, except under the desk
    const keys = [...landIndex(p).keys()];
    const [x, y] = keys[Math.floor(Math.random() * keys.length)].split(',').map(Number);
    [tx, ty] = [x + Math.floor(Math.random() * 3) - 1, y + Math.floor(Math.random() * 3) - 1];
    if (landIndex(p).get(tx + ',' + ty)?.desk) [tx, ty] = [3 + Math.floor(Math.random() * 2), Math.floor(Math.random() * 3)];
  }
  return { x: (p.x + tx) * TILE + 3 + Math.random() * 9, y: (p.y + ty) * TILE + 3 + Math.random() * 9 };
}

function absorbSeed(s, t) {
  const p = s.plot;
  if (!p || p.x == null || !p.pieces) return;
  const tx = Math.floor(s.tx / TILE) - p.x, ty = Math.floor(s.ty / TILE) - p.y;
  const here = landIndex(p).get(tx + ',' + ty) || {};
  if (here.desk) return;
  const pc = here.ground;
  if (pc?.k === 'soil' && pc.b >= 1) {
    const c = pc.crop || (pc.crop = { k: pickCrop(), w: 0 });
    const before = cropStage(c.w);
    c.w++;
    c.wet = t;
    if (cropStage(c.w) > before) {
      c.grew = t;
      if (cropStage(c.w) === 4) {
        bloomChime();
        noteRipe();
      }
    }
    // a hot streak can turn a ripe crop into something rare
    if (cropStage(c.w) === 4 && streakLevel(p) >= 2 && c.k !== 'gold' && c.k !== 'crystal' && Math.random() < 0.02) {
      c.k = Math.random() < 0.5 ? 'gold' : 'crystal';
      c.grew = t;
      bloomChime();
    }
  } else if (!pc) {
    // bare grass sprouts wildflowers
    p.wild = p.wild || {};
    p.wild[tx + ',' + ty] = (p.wild[tx + ',' + ty] || 0) + 1;
  }
  Garden.dirty = true;
}

function cropStage(w) {
  let s = 0;
  for (let i = 0; i < CROP_STAGES.length; i++) if (w >= CROP_STAGES[i]) s = i;
  return s;
}

// Drawing -----------------------------------------------------------------------------------

function pieceOpts(p, pc, t) {
  const land = landIndex(p), layer = pieceDef(pc.k).layer === 'ground' ? 'ground' : 'object';
  return {
    variant: pc.v,
    text: pc.txt,
    t,
    build: pc.b,
    seed: hash(p.x + pc.x, p.y + pc.y, 77),
    same: (dx, dy) => land.get(pc.x + dx + ',' + (pc.y + dy))?.[layer]?.k === pc.k,
  };
}

// Ground layer: wildflowers, ground pieces (soil, paths, water, beds) and the crops on the soil.
function drawFarmBack(g, p, t) {
  if (!p.pieces) return;
  const land = landIndex(p);
  for (const [k, n] of Object.entries(p.wild || {})) {
    if (n < 6) continue;
    const [x, y] = k.split(',').map(Number);
    const here = land.get(k);
    if (here?.ground || here?.desk) continue;
    wildPatch(g, (p.x + x) * TILE, (p.y + y) * TILE, n, p.x + x, p.y + y);
  }
  for (const pc of p.pieces) {
    if (pieceDef(pc.k).layer !== 'ground') continue;
    drawPiece(g, pc.k, (p.x + pc.x) * TILE, (p.y + pc.y) * TILE, pieceOpts(p, pc, t));
    if (pc.k === 'soil' && pc.b >= 1 && pc.crop) {
      const ox = (p.x + pc.x) * TILE, oy = (p.y + pc.y) * TILE;
      // freshly watered by a seed: darker for a moment
      if (pc.crop.wet && t - pc.crop.wet < 1.2) {
        g.fillStyle = `rgba(40, 26, 16, ${(0.28 * (1 - (t - pc.crop.wet) / 1.2)).toFixed(2)})`;
        g.fillRect(ox + 1, oy + 1, TILE - 2, TILE - 2);
      }
    }
  }
  for (const pc of p.pieces) if (pc.k === 'soil' && pc.b >= 1 && pc.crop) drawCrop(g, (p.x + pc.x) * TILE, (p.y + pc.y) * TILE, pc.crop, t);
}

// Standing pieces, for the depth sort with mochis and desks: each by the bottom of its tiles.
function landItems(g, p, t) {
  const out = [];
  for (const pc of p.pieces || []) {
    if (pieceDef(pc.k).layer === 'ground') continue;
    const h = (pieceDef(pc.k).size || [1, 1])[1];
    out.push({ y: (p.y + pc.y + h) * TILE - 2, draw: () => drawPiece(g, pc.k, (p.x + pc.x) * TILE, (p.y + pc.y) * TILE, pieceOpts(p, pc, t)) });
  }
  return out;
}

// Sign texts, drawn at screen resolution so they stay sharp (garden.js, world-anchored).
function drawLandTexts(ctx, p) {
  const S = Garden.S;
  for (const pc of p.pieces || []) {
    if (!pc.txt || !PIECES[pc.k]?.text || pc.b < 1) continue;
    const a = pieceTextAnchor(pc.k, (p.x + pc.x) * TILE, (p.y + pc.y) * TILE);
    const px = Math.max(7, 2.6 * S);
    ctx.font = `bold ${px}px ${SIGN_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let txt = pc.txt;
    const maxW = 52 * S; // room for the 24 characters a sign takes
    while (txt.length > 1 && ctx.measureText(txt).width > maxW) txt = txt.slice(0, -1);
    if (txt !== pc.txt) txt = txt.trimEnd() + '…';
    const w = ctx.measureText(txt).width + 2 * S;
    // a little card on the board, so long texts stay readable
    ctx.fillStyle = 'rgba(255, 246, 226, 0.92)';
    ctx.fillRect(a.x * S - w / 2, a.y * S - px * 0.7, w, px * 1.4);
    ctx.fillStyle = SIGN_INK;
    ctx.fillText(txt, a.x * S, a.y * S + px * 0.05);
    ctx.textAlign = 'left';
  }
}

function wildPatch(g, ox, oy, n, wx, wy) {
  const colours = ['#f29ac2', '#ffffff', '#b48ad6', '#f2c14e', '#7fa7e8'];
  const count = Math.min(5, 1 + Math.floor((n - 6) / 4));
  for (let i = 0; i < count; i++) {
    const x = ox + 2 + Math.floor(hash(wx, wy, i + 3) * 11), y = oy + 3 + Math.floor(hash(wx, wy, i + 7) * 10);
    g.fillStyle = '#5f8f3e';
    g.fillRect(x, y + 1, 1, 2);
    g.fillStyle = colours[Math.floor(hash(wx, wy, i + 11) * colours.length)];
    g.fillRect(x - 1, y, 3, 1);
    g.fillRect(x, y - 1, 1, 3);
    g.fillStyle = '#f2c14e';
    g.fillRect(x, y, 1, 1);
  }
}

// Crops ---------------------------------------------------------------------------------------

const CROP_PAL = {
  G: '#7fb04f', g: '#5f8f3e', d: '#466e2c', s: '#5f8f3e',
  w: '#f4efe4', v: '#9a5bb5', V: '#6f3f8a',
  r: '#e0665c', R: '#a83e3a', n: '#f08a3c', N: '#c0622a',
  y: '#f2c14e', Y: '#c9962e', b: '#7a4a2a', k: '#6f5238', K: '#a07f5c',
  c: '#bdf0fa', C: '#5fb8d8', o: '#3a2218',
};

const CROP_ART = {
  mound: ['.KK.', 'kkkk'],
  sprout: ['G.G', '.g.', '.g.'],
  leaves: ['G...G', 'GG.GG', '.ggg.', '..g..'],
  bud: ['..x..', '.GxG.', 'GGgGG', '.ggg.', '..g..'],
  turnip: ['..G.G..', '.GGgGG.', '..ggg..', '..vVv..', '.vwwwv.', '.wwwww.', '..www..'],
  carrot: ['.G.G.G.', '.GgGgG.', '..ggg..', '..ggg..', '..nnn..', '.nNnNn.', '..nnn..'],
  cabbage: ['..GGGG..', '.GgGGgG.', 'GgGwwGgG', 'gGGwwGGg', '.gGGGGg.', '..gggg..'],
  strawberry: ['.GG.GG..', 'GgGGgGG.', 'gGgrGgr.', '.grRgrR.', '..R..R..'],
  pumpkin: ['....s....', '...bs....', '.nNnnnNn.', 'nNnnNnnNn', 'nNnnNnnNn', 'nNnnNnnNn', '.NNNNNNN.'],
  sunflower: ['..yyy..', '.yybyy.', 'yybbbyy', '.yybyy.', '..yyy..', '...s...', '.G.s...', '.GGs.G.', '...sGG.', '...s...', '...s...'],
  wheat: ['y..y..y', 'Yy.yY.y', 'yY.Yy.Y', 'Yy.yY.y', '.s.s.s.', '.s.s.s.', '.s.s.s.', '..sss..'],
  gold: ['....s....', '...bs....', '.yYyyyYy.', 'yYyywyyYy', 'yYyyYyyYy', 'yYyyYyyYy', '.YYYYYYY.'],
  crystal: ['...c...', '..cCc..', '.cCwCc.', '..cCc..', '...c...', '...s...', '.G.s.G.', '.GGsGG.', '...s...'],
};
const BUD_COLOUR = { turnip: '#9a5bb5', carrot: '#f08a3c', cabbage: '#a3d977', strawberry: '#ffffff', pumpkin: '#f2c14e', sunflower: '#f2c14e', wheat: '#c9962e', gold: '#f2c14e', crystal: '#bdf0fa' };

const cropCache = new Map();
function cropSprite(name, budColour) {
  const key = name + (budColour || '');
  if (!cropCache.has(key)) cropCache.set(key, gridCanvas(CROP_ART[name], (ch) => (ch === 'x' ? budColour : CROP_PAL[ch])));
  return cropCache.get(key);
}

// The approved crop art (the "cute & round" concept), extracted to true pixels by
// tools/extract_crops.py: 5 growth stages across, one crop kind per row, 16x24 cells.
const CROP_SHEET = new Image();
CROP_SHEET.src = 'art/crops.png';
const sheetCache = new Map();
function sheetSprite(kind, stage) {
  const row = CROP_KINDS.indexOf(kind);
  if (row < 0 || !CROP_SHEET.complete || !CROP_SHEET.naturalWidth) return null;
  const key = kind + stage;
  if (!sheetCache.has(key)) {
    const c = document.createElement('canvas');
    [c.width, c.height] = [16, 24];
    const cg = c.getContext('2d');
    cg.drawImage(CROP_SHEET, stage * 16, row * 24, 16, 24, 0, 0, 16, 24);
    const empty = !cg.getImageData(0, 0, 16, 24).data.some((v, i) => i % 4 === 3 && v);
    sheetCache.set(key, empty ? null : c);
  }
  return sheetCache.get(key);
}

// A golden pumpkin: the pumpkin, washed gold.
function goldSprite() {
  if (sheetCache.has('gold')) return sheetCache.get('gold');
  const base = sheetSprite('pumpkin', 4);
  if (!base) return null;
  const c = document.createElement('canvas');
  [c.width, c.height] = [16, 24];
  const cg = c.getContext('2d');
  cg.drawImage(base, 0, 0);
  cg.globalCompositeOperation = 'source-atop';
  cg.fillStyle = 'rgba(255, 214, 80, 0.55)';
  cg.fillRect(0, 0, 16, 24);
  sheetCache.set('gold', c);
  return c;
}

function drawCrop(g, ox, oy, c, t) {
  const st = cropStage(c.w);
  const art = c.k === 'gold' ? (st === 4 ? goldSprite() : sheetSprite('pumpkin', st)) : sheetSprite(c.k, st);
  if (art) {
    const hop = c.grew && t - c.grew < 0.25 ? Math.round(Math.sin(((t - c.grew) / 0.25) * Math.PI) * 2) : 0;
    const x = ox, y = oy + TILE - 23 - hop;
    g.drawImage(art, x, y);
    if (c.grew && t - c.grew < 0.35) {
      g.fillStyle = '#ffffff';
      g.fillRect(x + 1, y + 6, 1, 1);
      g.fillRect(x + 14, y + 8, 1, 1);
    }
    if (c.k === 'gold' && st === 4 && Math.sin(t * 3 + ox) > 0.7) {
      g.fillStyle = '#ffffff';
      g.fillRect(x + 12, y + 10, 1, 1);
    }
    return;
  }
  // stage art the sheet lacks (and the crystal flower) is drawn from the grids above
  const name = st === 0 ? 'mound' : st === 1 ? 'sprout' : st === 2 ? 'leaves' : st === 3 ? 'bud' : c.k;
  const spr = cropSprite(name, st === 3 ? BUD_COLOUR[c.k] : null);
  // stand on the tile's lower half; a little hop when it grows a stage
  const hop = c.grew && t - c.grew < 0.25 ? Math.round(Math.sin(((t - c.grew) / 0.25) * Math.PI) * 2) : 0;
  const x = ox + Math.floor((TILE - spr.width) / 2), y = oy + TILE - 2 - spr.height - hop;
  g.drawImage(spr, x, y);
  if (c.grew && t - c.grew < 0.35) {
    g.fillStyle = '#ffffff';
    g.fillRect(x - 1, y - 1, 1, 1);
    g.fillRect(x + spr.width, y + 1, 1, 1);
  }
  if ((c.k === 'gold' || c.k === 'crystal') && st === 4 && Math.sin(t * 3 + ox) > 0.7) {
    g.fillStyle = '#ffffff';
    g.fillRect(x + spr.width - 1, y - 1, 1, 1);
  }
}
