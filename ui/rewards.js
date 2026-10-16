// Rewards for keeping mochis busy: streaks (reply soon after a mochi finishes and its streak
// grows; let it sit and the streak lapses) and the little sounds of the garden.

import { landBounds } from './farm.js';
import { Garden, PLOT_W, TILE } from './garden.js';
import { FLAVOUR_ORDER } from './sprites.js';

export const STREAK_GAP_MS = 8 * 60 * 1000;

/** @param {Plot} p */
export function activeStreak(p) {
  if (!p.streak) return 0;
  if (p.live && p.activity === 'working') return p.streak;
  if (p.lastStop && Date.now() - p.lastStop < STREAK_GAP_MS) return p.streak;
  return 0;
}

// 0 none, 1 warm (x3: golden seeds), 2 hot (x5: sparkle trails, glowing plot), 3 blazing (x8: every colour).
/** @param {Plot} p */
export function streakLevel(p) {
  const s = activeStreak(p);
  return s >= 8 ? 3 : s >= 5 ? 2 : s >= 3 ? 1 : 0;
}

// Called when a prompt is sent; returns true when the streak just reached a new level.
/** @param {Plot} p */
export function bumpStreak(p) {
  const before = streakLevel(p);
  const now = Date.now();
  p.streak = p.lastStop && now - p.lastStop < STREAK_GAP_MS ? (p.streak || 0) + 1 : 1;
  const up = streakLevel(p) > before;
  if (up) {
    p.burst = 10 + 6 * streakLevel(p);
    streakChime(streakLevel(p));
  }
  return up;
}

/** @param {Plot} p */
export function drawStreakGlow(ctx, p, t) {
  const level = streakLevel(p);
  if (level < 2 || p.x == null) return;
  const S = Garden.S;
  const b = landBounds(p);
  const cx = ((b.x0 + b.x1 + 1) / 2) * TILE * S, cy = ((b.y0 + b.y1 + 1) / 2) * TILE * S;
  const r = Math.max(PLOT_W * 0.75, (b.x1 - b.x0 + 1) * 0.6, (b.y1 - b.y0 + 1) * 0.6) * TILE * S;
  const a = (level === 3 ? 0.2 : 0.13) + 0.05 * Math.sin(t * 3 + p.seed);
  const grad = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r);
  grad.addColorStop(0, `rgba(255, 214, 110, ${a.toFixed(3)})`);
  grad.addColorStop(1, 'rgba(255, 214, 110, 0)');
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = grad;
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  ctx.restore();
}

// A tiny pixel flame for the sign, `s` = screen px per art pixel.
export function drawFlame(ctx, x, y, s) {
  const rows = ['.o.', 'oyo', 'oro', '.o.'];
  const col = { o: '#e0665c', y: '#ffd45c', r: '#ff9a3c' };
  rows.forEach((row, j) => [...row].forEach((ch, i) => {
    if (ch === '.') return;
    ctx.fillStyle = col[ch];
    ctx.fillRect(x + i * s, y + j * s, s, s);
  }));
}

// Sound ---------------------------------------------------------------------------------

export const Sound = { on: pref('mg.sound', true), ctx: null, lastPop: 0, lastBloom: 0 };

export function pref(key, dflt) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? dflt : v === 'on';
  } catch {
    return dflt;
  }
}

export function setPref(key, on) {
  try {
    localStorage.setItem(key, on ? 'on' : 'off');
  } catch {}
}

export function audio() {
  try {
    Sound.ctx = Sound.ctx || new AudioContext();
    if (Sound.ctx.state === 'suspended') Sound.ctx.resume();
    return Sound.ctx;
  } catch {
    return null;
  }
}

export function tone(freq, at, { gain = 0.05, dur = 0.35, type = 'sine', drop = 1 } = {}) {
  const a = audio();
  if (!a) return;
  const o = a.createOscillator(), gn = a.createGain();
  const t0 = a.currentTime + at;
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (drop !== 1) o.frequency.exponentialRampToValueAtTime(freq * drop, t0 + dur * 0.6);
  gn.gain.setValueAtTime(0, t0);
  gn.gain.linearRampToValueAtTime(gain, t0 + 0.005);
  gn.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(gn).connect(a.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

// Pentatonic, so any run of pops sounds pleasant; each flavour is transposed into its own key.
export const POP_SCALE = [523.25, 587.33, 659.25, 783.99, 880, 1046.5];
export const FLAVOUR_KEY = [1, 1.122, 0.891, 1.26, 0.794, 1.059, 0.944, 1.189];

/** @param {Plot} p */
export function seedPop(p) {
  if (!Sound.on || document.hidden) return;
  const now = performance.now();
  if (now - Sound.lastPop < 38) return; // a fountain becomes a patter, not a buzz
  Sound.lastPop = now;
  const key = FLAVOUR_KEY[Math.max(0, FLAVOUR_ORDER.indexOf(p.flavour))] || 1;
  const octave = streakLevel(p) >= 2 ? 2 : 1;
  const f = POP_SCALE[Math.floor(Math.random() * POP_SCALE.length)] * key * octave;
  tone(f, 0, { gain: 0.03 / (1 + (p.effort || 0) / 12), dur: 0.09, type: 'triangle', drop: 0.82 });
}

export function bloomChime() {
  if (!Sound.on || document.hidden) return;
  const now = performance.now();
  if (now - Sound.lastBloom < 300) return;
  Sound.lastBloom = now;
  tone(1567.98, 0, { gain: 0.025, dur: 0.25 });
  tone(2093, 0.06, { gain: 0.02, dur: 0.3 });
}

export function streakChime(level) {
  if (!Sound.on) return;
  const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5].slice(0, 2 + level);
  notes.forEach((f, i) => tone(f, i * 0.07, { gain: 0.045, dur: 0.3, type: 'triangle' }));
}
