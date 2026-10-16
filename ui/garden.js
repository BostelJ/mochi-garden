// The garden: a big tile meadow (the world) drawn at native pixel size on an offscreen canvas,
// seen through a camera that frames the plots: close in on your first mochi, easing out as the
// garden grows. Signs and labels are drawn over it at screen resolution so text stays sharp.
// Reads `Garden.plots` (owned by app.js) and moves each plot's mochi.

import { outfitOf } from './build.js';
import { closeCard, positionCard } from './cards.js';
import { drawDesk, updateTypewriter } from './desk.js';
import { drawDirt, drawFarmBack, drawLandTexts, farmJob, landBounds, landFits, landIndex, landItems, occupancy, sheetSprite, stepDirt, workFarmJob } from './farm.js';
import { drawHelperLabels, drawHelpers, updateHelpers } from './helpers.js';
import { activeStreak, drawFlame, drawStreakGlow } from './rewards.js';
import { Seeds, drawFlyingSeeds, drawGroundSeeds, stepSeeds, updateSeeds } from './seeds.js';
import { drawSkyLight, drawWeather, seasonPalette, updateSky, weekLeft } from './sky.js';
import { drawHearts, visitTarget } from './social.js';
import { BUBBLE_ASK, BUBBLE_BANG, FLAVOURS, PLANK, ZZZ, mochiSprite, prop } from './sprites.js';
import { Quality } from './state.js';
import { listen } from './tauri.js';
import { SQUARE_H, SQUARE_W, drawSquareGround, drawTownLights, drawTownSign, ensureSquare, townItems } from './town.js';
import { Usage } from './usage.js';
import { WEAR, WEAR_ORDER, drawWear } from './wardrobe.js';

export const TILE = 16;
export const PLOT_W = 6; // tiles
export const PLOT_H = 4;
export const WORLD_COLS = 80;
export const WORLD_ROWS = 56;

// Lifetime-token thresholds for the things that come with age (the farm itself grows from seeds).
export const GROWTH = { lantern: 400e3, scarf: 600e3, beanie: 1.5e6, straw: 4e6 };

export const ZOOM_MAX = 12; // device px per art px
export const ZOOM_MIN = 3;

export const Garden = {
  plots: [],
  S: 5, // current zoom: screen px per art pixel
  cols: WORLD_COLS,
  rows: WORLD_ROWS,
  cam: { x: 0, y: 0, zoom: 5 }, // x/y: world px at the view's top-left
  dirt: [], // dirt flying off a digging mochi
  onPick: null,
};

export function hash(x, y, salt = 0) {
  let h = (x * 374761393 + y * 668265263 + salt * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function initGarden(canvas, onPick) {
  Garden.canvas = canvas;
  Garden.ctx = canvas.getContext('2d');
  Garden.off = document.createElement('canvas');
  Garden.off.width = WORLD_COLS * TILE;
  Garden.off.height = WORLD_ROWS * TILE;
  Garden.octx = Garden.off.getContext('2d');
  Garden.onPick = onPick;
  new ResizeObserver(resizeGarden).observe(canvas.parentElement);
  canvas.addEventListener('click', (ev) => {
    const plot = plotAt(ev.offsetX, ev.offsetY);
    if (plot && Garden.onPick) Garden.onPick(plot);
    else closeCard();
  });
  canvas.addEventListener('mousemove', (ev) => {
    Garden.mouse = { x: ev.offsetX, y: ev.offsetY };
    canvas.style.cursor = plotAt(ev.offsetX, ev.offsetY) ? 'pointer' : 'default';
  });
  canvas.addEventListener('mouseleave', () => (Garden.mouse = null));
  resizeGarden();
  const target = cameraTarget();
  Object.assign(Garden.cam, target);
  // Chunky pixel art doesn't need the display's refresh rate (144 Hz here): 30 fps while
  // anything moves, 15 when the garden is just breathing, and nothing at all while the window
  // is hidden in the tray or minimized (WebView2 keeps the page "visible" then, so the app says).
  let last = performance.now(), timer = 0, raf = 0;
  const frame = (now) => {
    raf = 0;
    if (Garden.hidden) return;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    updateGarden(dt, now / 1000);
    drawGarden(now / 1000);
    positionCard();
    // [ quality ] on: every display frame (app.js Quality)
    if (Quality.on) return void (raf = requestAnimationFrame(frame));
    const gap = 1000 / (gardenBusy(now / 1000) ? 30 : 15);
    timer = setTimeout(() => (raf = requestAnimationFrame(frame)), Math.max(0, gap - (performance.now() - now) - 4));
  };
  Garden.wake = () => {
    if (raf || Garden.hidden) return;
    clearTimeout(timer);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  listen('main-visible', ({ payload }) => {
    Garden.hidden = !payload;
    if (!Garden.hidden) {
      last = performance.now();
      Garden.wake();
    }
  });
}

// Anything moving (or about to) gets the full frame rate.
export function gardenBusy(t) {
  if (Garden.active || Garden.camMoving || Seeds.list.length || Garden.dirt.length) return true;
  if (Garden.partyAt && t - Garden.partyAt < 4) return true;
  if ((Usage.sunriseAt && t - Usage.sunriseAt < 3) || (Usage.springAt && t - Usage.springAt < 6)) return true;
  return false;
}

export function resizeGarden() {
  const wrap = Garden.canvas.parentElement;
  const dpr = window.devicePixelRatio || 1;
  Garden.dpr = dpr;
  Garden.viewW = wrap.clientWidth;
  Garden.viewH = wrap.clientHeight;
  Garden.canvas.width = Math.round(Garden.viewW * dpr);
  Garden.canvas.height = Math.round(Garden.viewH * dpr);
  if (!Garden.grass) Garden.grass = drawGrass(WORLD_COLS, WORLD_ROWS);
}

// Camera ---------------------------------------------------------------------------------

// Frame every placed plot (and any mochi still walking in) with a margin, at the largest whole
// zoom that fits, so a lone first mochi fills the view and a big garden eases out to show it all.
export function cameraTarget() {
  const W = WORLD_COLS * TILE, H = WORLD_ROWS * TILE;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of Garden.plots) {
    const b = landBounds(p);
    if (!b) continue;
    x0 = Math.min(x0, b.x0 * TILE);
    y0 = Math.min(y0, (Math.min(b.y0, p.y) - 1) * TILE); // its sign and tall things stand above
    x1 = Math.max(x1, (Math.max(b.x1 + 1, p.x + PLOT_W + (p.name ? 2 : 0))) * TILE); // a named mochi's sign runs wider
    y1 = Math.max(y1, (Math.max(b.y1, p.y + PLOT_H - 1) + 2) * TILE); // helpers line up below
  }
  if (Garden.square) {
    const sq = Garden.square;
    [x0, y0] = [Math.min(x0, sq.x * TILE), Math.min(y0, (sq.y - 1) * TILE)];
    [x1, y1] = [Math.max(x1, (sq.x + SQUARE_W) * TILE), Math.max(y1, (sq.y + SQUARE_H) * TILE)];
  }
  if (x0 === Infinity) [x0, y0, x1, y1] = [W / 2 - 3 * TILE, H / 2 - 2 * TILE, W / 2 + 3 * TILE, H / 2 + 2 * TILE];
  // Snug around a lone plot, roomier as the garden grows.
  const n = Garden.plots.filter((p) => p.x != null).length;
  const mx = (1.5 + Math.min(2.5, n * 0.5)) * TILE, my = (1 + Math.min(1.5, n * 0.3)) * TILE;
  const bw = x1 - x0 + 2 * mx, bh = y1 - y0 + 2 * my;
  // Whole device pixels per art pixel, so the art stays crisp on any display scaling.
  const dpr = Garden.dpr || 1;
  const dev = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.floor(Math.min((Garden.viewW * dpr) / bw, (Garden.viewH * dpr) / bh))));
  const zoom = dev / dpr;
  const vw = Garden.viewW / zoom, vh = Garden.viewH / zoom;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  return {
    x: Math.max(0, Math.min(W - vw, cx - vw / 2)),
    y: Math.max(0, Math.min(H - vh, cy - vh / 2)),
    zoom,
  };
}

export function updateCamera(dt) {
  const target = cameraTarget(), cam = Garden.cam;
  const k = 1 - Math.exp(-dt * 2.2);
  // Ease the zoom, keeping the target's centre steady while it changes.
  const tcx = target.x + Garden.viewW / target.zoom / 2, tcy = target.y + Garden.viewH / target.zoom / 2;
  const ccx = cam.x + Garden.viewW / cam.zoom / 2, ccy = cam.y + Garden.viewH / cam.zoom / 2;
  cam.zoom += (target.zoom - cam.zoom) * k;
  if (Math.abs(cam.zoom - target.zoom) < 0.001) cam.zoom = target.zoom;
  const ncx = ccx + (tcx - ccx) * k, ncy = ccy + (tcy - ccy) * k;
  cam.x = ncx - Garden.viewW / cam.zoom / 2;
  cam.y = ncy - Garden.viewH / cam.zoom / 2;
  Garden.S = cam.zoom;
  Garden.camMoving = cam.zoom !== target.zoom || Math.abs(tcx - ncx) + Math.abs(tcy - ncy) > 0.05;
}

// The part of the world in view, in world px.
export function viewRect() {
  const c = Garden.cam;
  return { x: c.x, y: c.y, w: Garden.viewW / c.zoom, h: Garden.viewH / c.zoom };
}

export function toWorld(cssX, cssY) {
  return { x: Garden.cam.x + cssX / Garden.cam.zoom, y: Garden.cam.y + cssY / Garden.cam.zoom };
}

// Meadow ---------------------------------------------------------------------------------

// `pal` comes from the season (sky.js): base colour, speck colours, tuft colours.
export function drawGrass(cols, rows, pal = seasonPalette(weekLeft())) {
  const c = document.createElement('canvas');
  c.width = cols * TILE;
  c.height = rows * TILE;
  const g = c.getContext('2d');
  // One base colour everywhere (per-tile shades read as a checkerboard); texture comes from specks.
  const specks = pal.specks;
  g.fillStyle = pal.base;
  g.fillRect(0, 0, c.width, c.height);
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      const ox = tx * TILE, oy = ty * TILE;
      for (let i = 0; i < 18; i++) {
        g.fillStyle = specks[Math.floor(hash(tx, ty, i + 1) * specks.length)];
        g.fillRect(ox + Math.floor(hash(tx, ty, i + 40) * TILE), oy + Math.floor(hash(tx, ty, i + 80) * TILE), 1, 1);
      }
      const r = hash(tx, ty, 999);
      const px = ox + 3 + Math.floor(hash(tx, ty, 7) * 9), py = oy + 3 + Math.floor(hash(tx, ty, 8) * 9);
      if (r < 0.13) {
        // grass tuft
        g.fillStyle = pal.tuft;
        g.fillRect(px, py + 2, 1, 2); g.fillRect(px + 2, py + 1, 1, 3); g.fillRect(px + 4, py + 2, 1, 2);
        g.fillStyle = pal.tuftHi;
        g.fillRect(px + 1, py + 3, 1, 1); g.fillRect(px + 3, py + 3, 1, 1);
      } else if (r < 0.165) {
        // tiny daisy
        g.fillStyle = '#ffffff';
        g.fillRect(px, py + 1, 3, 1); g.fillRect(px + 1, py, 1, 3);
        g.fillStyle = '#f2c14e';
        g.fillRect(px + 1, py + 1, 1, 1);
      } else if (r < 0.185) {
        // pebble
        g.fillStyle = '#8d8b86';
        g.fillRect(px, py + 1, 4, 2); g.fillRect(px + 1, py, 2, 1);
        g.fillStyle = '#b3b1ab';
        g.fillRect(px + 1, py + 1, 1, 1);
      }
    }
  }
  return c;
}

// Placement ------------------------------------------------------------------------------

// The first plot goes in the middle of the world; each new one settles near the others, with
// room around it to grow (a garden is whatever shape its session builds: farm.js, build.js), so
// the garden grows outward and the camera eases out to keep it all in view.
/** @param {Plot} plot */
export function placePlot(plot) {
  plot.pieces = plot.pieces || [];
  const others = Garden.plots.filter((p) => p !== plot && p.x != null);
  const cx = Math.floor(WORLD_COLS / 2 - PLOT_W / 2), cy = Math.floor(WORLD_ROWS / 2 - PLOT_H / 2);
  if (!others.length && !Garden.square) {
    [plot.x, plot.y] = [cx, cy];
    return;
  }
  const near = others.length ? others : [{ x: Garden.square.x, y: Garden.square.y }];
  const mx = near.reduce((s, p) => s + p.x, 0) / near.length, my = near.reduce((s, p) => s + p.y, 0) / near.length;
  // room to grow first; when the world is crowded, settle for less
  for (const gap of [4, 2, 1]) {
    const grid = occupancy(plot, gap);
    let best = null, bestScore = Infinity;
    for (let y = 2; y < WORLD_ROWS - 3; y++) {
      for (let x = 1; x < WORLD_COLS - 2; x++) {
        // Close to the garden's middle, wider than tall (the view is), with a little randomness.
        const score = Math.hypot((x - mx) * 0.8, (y - my) * 1.3) + Math.random() * 2.5;
        if (score < bestScore && landFits(plot, x, y, grid)) [best, bestScore] = [{ x, y }, score];
      }
    }
    if (best) {
      [plot.x, plot.y] = [best.x, best.y];
      return;
    }
  }
  [plot.x, plot.y] = [cx, cy];
}

// A packed-away garden coming back keeps its old spot unless something has moved in since.
/** @param {Plot} plot */
export function returnPlot(plot) {
  if (plot.x == null) return;
  if (!landFits(plot, plot.x, plot.y, occupancy(plot, 1))) placePlot(plot);
}

// Asleep at its desk: an open tab whose claude has stopped (not one walking in or packing up).
/** @param {Plot} p */
export function isAsleep(p) {
  return !p.live && p.activity !== 'arriving' && p.activity !== 'leaving';
}

// Where a plot's mochi sits: behind its desk; asleep, it naps beside it.
/** @param {Plot} plot */
export function homeSpot(plot) {
  const asleep = isAsleep(plot);
  // in front of the desk, facing the typewriter (asleep: slumped a little lower)
  return asleep ? { x: plot.x * TILE + 18, y: plot.y * TILE + 37 } : { x: plot.x * TILE + 18, y: plot.y * TILE + 33 };
}

/** @param {Plot} p */
export function atHome(p) {
  return p.x != null && p.m && !p.m.walking && Math.hypot(p.m.x - homeSpot(p).x, p.m.y - homeSpot(p).y) < 1;
}

export function plotAt(cssX, cssY) {
  const { x: lx, y: ly } = toWorld(cssX, cssY);
  for (const p of Garden.plots) {
    const m = p.m;
    if (m && Math.abs(lx - (m.x + 6)) < 9 && Math.abs(ly - (m.y + 5)) < 9) return p;
  }
  const tx = Math.floor(lx / TILE), ty = Math.floor(ly / TILE);
  for (const p of Garden.plots) {
    if (p.x != null && landIndex(p).has(tx - p.x + ',' + (ty - p.y))) return p;
  }
  return null;
}

// Behaviour ------------------------------------------------------------------------------

/** @param {Plot} plot */
export function spawnMochi(plot, fromEdge) {
  if (fromEdge) {
    // walks in from the left edge of whatever is in view
    const v = viewRect();
    const y = v.y + v.h * (0.4 + Math.random() * 0.2);
    plot.m = { x: v.x - 14, y, tx: v.x - 14, ty: y, phase: 0, prints: [] };
  } else if (plot.x != null) {
    const h = homeSpot(plot);
    plot.m = { x: h.x, y: h.y, tx: h.x, ty: h.y, phase: 0, prints: [] };
  }
}

export function updateGarden(dt, t) {
  updateCamera(dt);
  Garden.active = false;
  if (!Garden.squareCheck || t - Garden.squareCheck > 1) {
    Garden.squareCheck = t;
    ensureSquare();
  }
  const gone = [];
  for (const p of Garden.plots) {
    if (!p.m) spawnMochi(p, false);
    const m = p.m;
    if (!m) continue;
    // Target: off the left edge of the view when its session has ended (then the plot is put
    // away); else a farm job when it has one and isn't typing, else home; before it has a plot,
    // a waiting spot in the middle of the view.
    const leaving = p.activity === 'leaving';
    const job = p.x != null && !leaving ? farmJob(p) : null;
    const visit = !job && p.x != null && !leaving ? visitTarget(p, dt, t) : null;
    if (leaving) {
      const v = viewRect();
      [m.tx, m.ty] = [Math.min(m.tx, v.x - 16), m.y];
      if (Math.hypot(m.tx - m.x, m.ty - m.y) <= 0.5) gone.push(p);
    } else if (job) [m.tx, m.ty] = [job.x, job.y];
    else if (visit) [m.tx, m.ty] = [visit.x, visit.y];
    else if (p.x != null) [m.tx, m.ty] = [homeSpot(p).x, homeSpot(p).y];
    else {
      if (!m.wait) {
        const v = viewRect();
        m.wait = { x: v.x + v.w * (0.35 + Math.random() * 0.3), y: v.y + v.h * (0.4 + Math.random() * 0.2) };
      }
      [m.tx, m.ty] = [m.wait.x, m.wait.y];
    }
    const dx = m.tx - m.x, dy = m.ty - m.y, d = Math.hypot(dx, dy);
    m.walking = d > 0.5;
    if (m.walking || job || p.activity === 'working' || p.activity === 'arriving' || p.helpers?.some((h) => h.state !== 'gone')) Garden.active = true;
    if (m.walking) {
      const step = Math.min(d, (p.activity === 'leaving' ? 44 : 26) * dt); // off home briskly
      m.x += (dx / d) * step;
      m.y += (dy / d) * step;
      m.phase += dt * 9;
      if (Math.floor(m.phase / Math.PI) !== m.lastHop) {
        m.lastHop = Math.floor(m.phase / Math.PI);
        m.prints.push({ x: m.x + 6, y: m.y + 11, t });
      }
    } else if (job) workFarmJob(p, job, dt, t);
    m.prints = m.prints.filter((f) => t - f.t < 6);
    // The desk builds while the first answer is being written.
    if (!p.built && p.x != null && !m.walking && p.activity === 'working') p.build = Math.min(0.9, (p.build || 0) + dt * 0.06);
    if (p.built) p.build = 1;
    updateTypewriter(p, dt, t);
    updateSeeds(p, dt, t);
    updateHelpers(p, dt, t);
  }
  for (const p of gone) {
    p.away = true;
    p.m = null;
    p.activity = 'sleep';
    Garden.plots.splice(Garden.plots.indexOf(p), 1);
    Garden.dirty = true;
  }
  stepSeeds(dt, t);
  stepDirt(dt);
  updateSky(dt, t);
}

// Drawing --------------------------------------------------------------------------------

export function drawGarden(t) {
  const { octx: g, off, ctx, dpr, cam } = Garden;
  const S = cam.zoom;
  g.imageSmoothingEnabled = false;
  // Only the part of the meadow in view is ever shown, so only that part is repainted.
  const v = viewRect();
  const gx = Math.max(0, Math.floor(v.x) - 1), gy = Math.max(0, Math.floor(v.y) - 1);
  const gw = Math.min(off.width - gx, Math.ceil(v.w) + 3), gh = Math.min(off.height - gy, Math.ceil(v.h) + 3);
  g.drawImage(Garden.grass, gx, gy, gw, gh, gx, gy, gw, gh);

  drawSquareGround(g);
  const plots = Garden.plots.filter((p) => p.x != null);
  for (const p of plots) drawFarmBack(g, p, t);

  // Footprints, then everything with depth sorted by y.
  g.fillStyle = 'rgba(80, 60, 40, 0.35)';
  for (const p of Garden.plots) for (const f of p.m?.prints || []) g.fillRect(Math.round(f.x), Math.round(f.y), 2, 1);
  drawGroundSeeds(g, t);

  const items = [];
  for (const p of plots) items.push({ y: (p.y + 2) * TILE + 9, draw: () => drawDesk(g, p, t) });
  for (const p of plots) items.push(...landItems(g, p, t));
  for (const p of Garden.plots) if (p.m) items.push({ y: p.m.y + 11, draw: () => drawMochi(g, p, t) });
  for (const it of townItems(t)) items.push({ y: it.y, draw: () => it.draw(g) });
  items.sort((a, b) => a.y - b.y).forEach((i) => i.draw());
  drawTownLights(g, t);
  for (const p of plots) drawHelpers(g, p, t);
  drawDirt(g);
  drawFlyingSeeds(g, t);
  drawWeather(g, t);

  // Through the camera, crisp; then mist and light over the scene in screen space.
  ctx.imageSmoothingEnabled = false;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (v.x < 0 || v.y < 0 || v.x + v.w > off.width || v.y + v.h > off.height) {
    ctx.fillStyle = '#a7c274';
    ctx.fillRect(0, 0, Garden.canvas.width, Garden.canvas.height);
  }
  ctx.drawImage(off, v.x, v.y, v.w, v.h, 0, 0, Garden.canvas.width, Garden.canvas.height);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawMist(ctx, Garden.viewW, Garden.viewH);
  drawSkyLight(ctx, Garden.viewW, Garden.viewH, t);
  // World-anchored overlays: world px * S, shifted by the camera.
  ctx.setTransform(dpr, 0, 0, dpr, -cam.x * S * dpr, -cam.y * S * dpr);
  for (const p of plots) drawStreakGlow(ctx, p, t);
  for (const p of plots) drawLandTexts(ctx, p);
  for (const p of plots) drawSign(ctx, p);
  drawTownSign(ctx);
  for (const p of plots) drawHelperLabels(ctx, p);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// Clothes it chose (build.js dress), or what its age earned it; back items go under the body.
/** @param {Plot} p */
export function drawOutfit(g, p, x, y, pose, layer) {
  const o = outfitOf(p);
  // seen from behind, a cape or backpack covers the body instead of peeking out from under it
  const order = pose === 'back' ? WEAR_ORDER.fromBehind : WEAR_ORDER;
  for (const slot of order[layer]) if (o[slot] && WEAR[o[slot].i]) drawWear(g, o[slot].i, o[slot].c, x, y, pose);
}

/** @param {Plot} p */
export function drawMochi(g, p, t) {
  const m = p.m;
  const asleep = isAsleep(p);
  let x = Math.round(m.x), y = Math.round(m.y);
  const effort = p.effort || 0;
  if (m.walking) y -= Math.round(Math.abs(Math.sin(m.phase)) * 3);
  else if (m.digHop) y -= m.digHop; // bouncing on the soil it's digging
  else if (Garden.partyAt && t - Garden.partyAt < 4 && !asleep) y -= Math.round(Math.abs(Math.sin(t * 9 + p.seed)) * 4); // harvest!
  else if (!asleep) {
    const typing = p.tw && t - p.tw.keyAt < 0.06;
    if (typing) y += 1; // leans into each keystroke
    else if (p.activity !== 'working') y -= Math.sin(t * 2 + p.seed) > 0.6 ? 1 : 0;
    if (m.pop && t - m.pop < 0.07) y -= 1; // hops as each seed pops out
    if (effort > 10) x += Math.sin(t * 55) > 0 ? 1 : 0; // straining when the seeds really fly
  }
  // shadow
  g.fillStyle = 'rgba(40, 50, 20, 0.25)';
  g.fillRect(Math.round(m.x) + 2, Math.round(m.y) + 10, 9, 2);

  if (asleep) {
    drawOutfit(g, p, x, y, 'sleep', 'under');
    g.drawImage(mochiSprite(p.flavour, 'sleep'), x, y + 3);
    drawOutfit(g, p, x, y, 'sleep', 'over');
    const zy = Math.round((t * 4) % 6);
    g.drawImage(prop('zzz', ZZZ), x + 11, y - 3 - zy);
    return;
  }
  // typing at the desk it faces the typewriter; done, asking or anywhere else, it faces you
  let facing = p.built && p.activity === 'working' && !p.bubble && atHome(p) ? 'back' : 'idle';
  // just dressed: a quick twirl to show it off
  const twirl = m.dressedAt && t - m.dressedAt < 0.9;
  if (twirl) {
    facing = Math.floor((t - m.dressedAt) * 9) % 2 ? 'back' : 'idle';
    y -= Math.round(Math.sin(((t - m.dressedAt) / 0.9) * Math.PI) * 3);
  }
  drawOutfit(g, p, x, y, facing, 'under');
  g.drawImage(mochiSprite(p.flavour, facing), x, y);
  drawOutfit(g, p, x, y, facing, 'over');

  if (effort > 16) {
    // a sweat drop sliding down its side
    const k = (t * 1.6 + p.seed) % 1;
    g.fillStyle = '#9fd3f2';
    g.fillRect(x + 11, y + 1 + Math.round(k * 4), 1, 2);
    g.fillStyle = '#ffffff';
    g.fillRect(x + 11, y + 1 + Math.round(k * 4), 1, 1);
  }
  if (!m.walking && p.activity === 'working' && !p.built && Math.sin(t * 10) > 0) g.drawImage(prop('plank', PLANK), x + 11, y + 4); // hammering
  drawHearts(g, p, x, y, t);
  // carrying a crop to a neighbour, held up over its head
  const carry = p.errands?.[0];
  if (carry) {
    const spr = sheetSprite(carry.k === 'gold' ? 'pumpkin' : carry.k, 4);
    if (spr) g.drawImage(spr, 0, 4, 16, 18, x - 1, y - 12, 16, 18);
  }
  // eating: the crop shrinks in front of it, crumbs fly, hearts
  if (m.eatAt && t - m.eatAt < 1.4) {
    const k = (t - m.eatAt) / 1.4;
    const spr = sheetSprite(m.eatK === 'gold' ? 'pumpkin' : m.eatK, 4);
    const h = Math.round(18 * (1 - k));
    if (spr && h > 0) g.drawImage(spr, 0, 22 - h, 16, h, x - 1, y + 9 - h, 16, h);
    if (Math.sin(t * 30) > 0.3) {
      g.fillStyle = '#f2d9a6';
      g.fillRect(x + 2 + Math.round(Math.random() * 9), y + 7 + Math.round(Math.random() * 3), 1, 1);
    }
    m.heartAt = t - 0.1;
  }
  if (p.bubble) {
    const bob = Math.sin(t * 4) > 0 ? 1 : 0;
    g.drawImage(prop(p.bubble === '?' ? 'ask' : 'bang', p.bubble === '?' ? BUBBLE_ASK : BUBBLE_BANG), x + 8, y - 11 - bob);
  }
  if (p.selected && !p.bubble) {
    // small white marker over the head of the session you're looking at
    g.fillStyle = '#ffffff';
    g.fillRect(x + 4, y - 6, 5, 1);
    g.fillRect(x + 5, y - 5, 3, 1);
    g.fillRect(x + 6, y - 4, 1, 1);
  }
}

// Signs stand above the farm half of the plot, clear of the mochi's bubble.
/** @param {Plot} p */
export function signX(p) {
  return (p.x + 3) * TILE + 1;
}

// The sign is the seed packet the plot grew from, in the mochi's flavour, on a stake: a cream
// zigzag fold on top, the title, then a cream band with tokens and the streak flame. Text has a
// floor in screen px, so the packet is sized from the text, not just from S.
export const SIGN_FONT = "'Cascadia Mono', Consolas, 'SF Mono', Menlo, monospace";
export const SIGN_INK = '#3a2218';
export const SIGN_CREAM = '#fff6e2';
export const signBigPx = (S) => Math.max(9, 4 * S);
export const signSmallPx = (S) => Math.max(8, 3.4 * S);

/** @param {Plot} p */
export function drawSign(ctx, p) {
  const S = Garden.S;
  const px = signX(p) * S, py = (p.y * TILE + 1) * S;
  const big = `bold ${signBigPx(S)}px ${SIGN_FONT}`;
  const maxW = ((p.x + PLOT_W) * TILE + 6) * S - px - 6 * S; // never far past the plot
  ctx.font = big;
  // a mochi that named itself has its name in big letters, and what it's working on below
  const fit = (s, w) => {
    if (ctx.measureText(s).width <= w) return s;
    while (s.length > 1 && ctx.measureText(s + '…').width > w) s = s.slice(0, -1);
    return s.trimEnd() + '…';
  };
  const title = fit(p.name || p.title || (p.built ? 'session' : '...'), maxW);
  let tokens = p.tokens ? fmtTokens(p.tokens) : '';
  if (p.name && p.title) {
    ctx.font = `${signSmallPx(S)}px ${SIGN_FONT}`;
    tokens = fit(p.title, maxW * 1.3 - ctx.measureText(tokens + ' · ').width) + (tokens ? ' · ' + tokens : ''); // the packet may widen for it
    ctx.font = big;
  }
  const streak = activeStreak(p) >= 3 ? `x${activeStreak(p)}` : '';
  const f = FLAVOURS[p.flavour] || FLAVOURS.terracotta;
  const small = `${signSmallPx(S)}px ${SIGN_FONT}`;
  const smallBold = `bold ${signSmallPx(S)}px ${SIGN_FONT}`;
  ctx.font = small;
  const tw = tokens ? ctx.measureText(tokens).width : 0;
  ctx.font = smallBold;
  const sw = streak ? ctx.measureText(streak).width + 6 * S : 0; // flame + count after the tokens
  ctx.font = big;
  const w = Math.max(ctx.measureText(title).width, tw + sw) + 8 * S;
  const sub = tokens || streak;
  const bandTop = 3.6 * S + signBigPx(S) * 1.15, bandH = signSmallPx(S) * 1.1 + 0.8 * S;
  const h = sub ? bandTop + bandH + S : bandTop + 0.6 * S;
  const bx = Math.round(px), by = Math.round(py - h);
  // stake
  ctx.fillStyle = SIGN_INK;
  ctx.fillRect(bx + w / 2 - 1.5 * S, by + h - 2 * S, 3 * S, 7 * S);
  ctx.fillStyle = '#c48d55';
  ctx.fillRect(bx + w / 2 - 0.5 * S, by + h - 2 * S, S, 6 * S);
  // packet: outline with its corner pixels knocked out, flavour body, shade down the right
  ctx.fillStyle = SIGN_INK;
  ctx.fillRect(bx, by - S, w, h + 2 * S);
  ctx.fillRect(bx - S, by, w + 2 * S, h);
  ctx.fillStyle = f.b;
  ctx.fillRect(bx, by, w, h);
  ctx.fillStyle = f.s;
  ctx.fillRect(bx + w - S, by, S, h);
  // the folded top with a zigzag edge
  ctx.fillStyle = SIGN_CREAM;
  ctx.fillRect(bx, by, w, 2 * S);
  for (let i = 0; i < w / S; i += 2) ctx.fillRect(bx + i * S, by + 2 * S, S, S);
  if (sub) ctx.fillRect(bx + S, by + bandTop, w - 2 * S, bandH);
  // title: dark ink on light flavours (vanilla, mango), cream on the rest
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(f.b.slice(i, i + 2), 16) / 255);
  ctx.fillStyle = 0.299 * r + 0.587 * g + 0.114 * b > 0.72 ? SIGN_INK : '#fffaf0';
  ctx.textBaseline = 'top';
  ctx.fillText(title, bx + 3 * S, by + 3.6 * S);
  const ly = by + bandTop + 0.5 * S;
  if (tokens) {
    ctx.fillStyle = '#5a3a20';
    ctx.font = small;
    ctx.fillText(tokens, bx + 3 * S, ly);
  }
  if (streak) {
    const fx = bx + 3 * S + tw + (tokens ? 2 * S : 0);
    drawFlame(ctx, fx, ly + 0.2 * S, Math.max(1, Math.round(S * 0.9)));
    ctx.fillStyle = '#b8381f';
    ctx.font = smallBold;
    ctx.fillText(streak, fx + 4 * S, ly);
  }
}

export function drawMist(ctx, w, h) {
  const mist = cachedLayer('mist', '', w, h, (g) => {
    const r = Math.max(w, h) * 0.75;
    const grad = g.createRadialGradient(w / 2, h / 2, r * 0.55, w / 2, h / 2, r);
    grad.addColorStop(0, 'rgba(244, 241, 226, 0)');
    grad.addColorStop(1, 'rgba(244, 241, 226, 0.75)');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  });
  ctx.drawImage(mist, 0, 0, w, h);
}

// Full-view gradient layers (mist, sunlight) only change when the view resizes or the light
// moves, so each is painted once into a canvas and reused instead of re-rasterized every frame.
export const layerCache = new Map();
export function cachedLayer(name, key, w, h, paint) {
  const dpr = Garden.dpr || 1;
  const k = `${key}|${w}x${h}@${dpr}`;
  let l = layerCache.get(name);
  if (!l || l.key !== k) {
    const c = l?.canvas || document.createElement('canvas');
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    paint(g);
    l = { key: k, canvas: c };
    layerCache.set(name, l);
  }
  return l.canvas;
}

export function fmtTokens(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M tokens';
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'k tokens';
  return n + ' tokens';
}
