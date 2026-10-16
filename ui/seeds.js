// Token seeds: a working mochi pops tiny glowing seeds out of its head. They arc onto its plot,
// bounce, twinkle and sink into the soil. New tokens land in the plot's `bank` (app.js) and are
// paid out over a few seconds, so one big reply becomes a long spray rather than one blip.

import { absorbSeed, landingSpot } from './farm.js';
import { seedPop, streakLevel } from './rewards.js';
import { FLAVOURS, FLAVOUR_ORDER } from './sprites.js';

export const SEED_GRAVITY = 420; // logical px / s^2
export const SEED_TRICKLE = 1.2; // seeds per second while a mochi is working, even between token reads
export const TOKENS_PER_SEED = 120; // above the trickle, one seed per this many tokens paid out...
export const SEED_RATE_MAX = 40; // ...up to this many seeds per second
export const SEED_CAP = 700; // most seeds alive at once across the garden

export const Seeds = { list: [] };

/** @param {Plot} p */
export function updateSeeds(p, dt, t) {
  const m = p.m;
  const placed = p.x != null && m && !m.walking;
  if (!p.live) p.bank = 0;
  // Pay the bank out: a third of it per second, never slower than 60 tokens/s so it empties.
  let flow = 0;
  if (placed && p.bank > 0) {
    const pay = Math.min(p.bank, Math.max((p.bank * dt) / 3, 60 * dt));
    p.bank -= pay;
    flow = pay / dt;
  }
  const working = p.live && p.activity === 'working';
  const boost = 1 + 0.25 * streakLevel(p); // a hot streak pops more seeds per token
  const rate = placed ? (working ? SEED_TRICKLE : 0) + Math.min(SEED_RATE_MAX, (flow * boost) / TOKENS_PER_SEED) : 0;
  p.effort = (p.effort || 0) + (rate - (p.effort || 0)) * Math.min(1, dt * 3);
  p.seedAcc = (p.seedAcc || 0) + rate * dt + (placed && p.burst ? p.burst : 0); // a streak-up bursts
  if (placed) p.burst = 0;
  while (p.seedAcc >= 1) {
    p.seedAcc -= 1;
    if (Seeds.list.length < SEED_CAP) spawnSeed(p, t);
    m.pop = t;
    seedPop(p);
  }
}

// `from` is a helper mochi's position when the seed is its own (seeds.js callers pass nothing).
/** @param {Plot} p */
export function spawnSeed(p, t, from) {
  const m = p.m;
  const sx = from ? from.x : m.x + 6, sy = from ? from.y : m.y + 1;
  const { x: tx, y: ty } = landingSpot(p); // farm.js: mostly onto dug soil
  // Ballistic arc that lands exactly on the target.
  const T = 0.6 + Math.random() * 0.35;
  const vx = (tx - sx) / T;
  const vy = (ty - sy - 0.5 * SEED_GRAVITY * T * T) / T;
  const level = streakLevel(p);
  Seeds.list.push({ x: sx, y: sy, vx, vy, tx, ty, colour: seedColour(p, level), trail: level >= 2 ? [] : null, plot: p, born: t, land: t + T, state: 'fly', rest: 0.35 + Math.random() * 0.5 });
}

// Streak 0: mostly gold with the mochi's colour; 1+: almost all gold; 3: every flavour.
/** @param {Plot} p */
export function seedColour(p, level) {
  const f = FLAVOURS[p.flavour] || FLAVOURS.terracotta;
  const r = Math.random();
  if (level >= 3 && r < 0.6) return FLAVOURS[FLAVOUR_ORDER[Math.floor(Math.random() * FLAVOUR_ORDER.length)]].b;
  const gold = level >= 1 ? 0.8 : 0.55;
  return r < gold ? '#ffd45c' : r < 0.9 ? f.b : '#fff6d8';
}

export function stepSeeds(dt, t) {
  for (const s of Seeds.list) {
    if (s.state === 'fly') {
      s.vy += SEED_GRAVITY * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      if (s.trail) {
        s.trail.push({ x: Math.round(s.x + 1), y: Math.round(s.y + 1), t });
        if (s.trail.length > 6) s.trail.shift();
      }
      if (t >= s.land) {
        s.x = s.tx;
        s.y = s.ty;
        s.state = 'ground';
        s.landedAt = t;
      }
    } else if (s.state === 'ground' && t - s.landedAt > 0.15 + s.rest) {
      s.state = 'sink';
      s.sinkAt = t;
      absorbSeed(s, t);
    }
  }
  Seeds.list = Seeds.list.filter((s) => s.state !== 'sink' || t - s.sinkAt < 0.45);
}

// A seed is a 4x4 outlined gem with a white highlight, so it reads against the grass.
export function drawGem(g, x, y, colour) {
  g.fillStyle = '#3a2218';
  g.fillRect(x + 1, y, 2, 1);
  g.fillRect(x + 1, y + 3, 2, 1);
  g.fillRect(x, y + 1, 1, 2);
  g.fillRect(x + 3, y + 1, 1, 2);
  g.fillStyle = colour;
  g.fillRect(x + 1, y + 1, 2, 2);
  g.fillStyle = '#ffffff';
  g.fillRect(x + 1, y + 1, 1, 1);
}

// Seeds on the ground sit under benches and mochis; seeds in the air fly over everything.
export function drawGroundSeeds(g, t) {
  for (const s of Seeds.list) {
    if (s.state === 'fly') continue;
    const x = Math.round(s.x), y = Math.round(s.y);
    if (s.state === 'ground') {
      const age = t - s.landedAt;
      const hop = age < 0.15 ? Math.round(Math.sin((age / 0.15) * Math.PI) * 2) : 0; // one little bounce
      g.fillStyle = 'rgba(58, 34, 24, 0.3)';
      g.fillRect(x + 1, y + 4, 3, 1);
      drawGem(g, x, y - hop, s.colour);
    } else {
      const k = (t - s.sinkAt) / 0.45;
      if (k < 0.45) {
        // sinking into the soil: only its top half still showing
        g.fillStyle = '#3a2218';
        g.fillRect(x + 1, y + 2, 2, 1);
        g.fillRect(x, y + 3, 4, 1);
        g.fillStyle = s.colour;
        g.fillRect(x + 1, y + 3, 2, 1);
      } else {
        // the twinkle as it's absorbed
        const r = k < 0.75 ? 2 : 1;
        g.fillStyle = '#ffffff';
        g.fillRect(x + 1, y + 2, 1, 1);
        g.fillRect(x + 1 - r, y + 2, 1, 1);
        g.fillRect(x + 1 + r, y + 2, 1, 1);
        g.fillRect(x + 1, y + 2 - r, 1, 1);
        g.fillRect(x + 1, y + 2 + r, 1, 1);
      }
    }
  }
}

export function drawFlyingSeeds(g, t) {
  for (const s of Seeds.list) {
    if (s.state !== 'fly') continue;
    if (s.trail) {
      // hot-streak sparkle trail
      for (const d of s.trail) {
        const a = 1 - (t - d.t) / 0.18;
        if (a <= 0) continue;
        g.fillStyle = `rgba(255, 246, 200, ${a.toFixed(2)})`;
        g.fillRect(d.x, d.y, 1, 1);
      }
    }
    drawGem(g, Math.round(s.x), Math.round(s.y), s.colour);
  }
}
