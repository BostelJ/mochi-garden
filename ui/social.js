// Mochi social life: a mochi with nothing to do (session open, not typing, no farm work) now and
// then wanders off to visit a neighbour's plot or the town square, hangs out for a few seconds
// with little hearts, and heads home. A prompt calls it straight back to its desk.

import { Garden, TILE, atHome } from './garden.js';
import { prop } from './sprites.js';

export const VISIT_EVERY = 45; // seconds, on average, between visits for an idle mochi

export function visitTarget(p, dt, t) {
  const m = p.m;
  if (!p.live || p.activity !== 'idle' || !p.built) {
    m.visit = null;
    return null;
  }
  if (!m.visit) {
    if (!atHome(p) || Math.random() > dt / VISIT_EVERY) return null;
    const others = Garden.plots.filter((o) => o !== p && o.x != null && o.m && o.activity !== 'leaving');
    const choices = [...others.map((o) => ({ plot: o })), ...(Garden.square ? [{ square: true }] : [])];
    if (!choices.length) return null;
    m.visit = { ...choices[Math.floor(Math.random() * choices.length)], dx: Math.random() * 10 - 5, until: null };
  }
  const v = m.visit;
  // the neighbour packed up and left: head home
  if (v.plot && (!v.plot.m || v.plot.activity === 'leaving')) {
    m.visit = null;
    return null;
  }
  let x, y;
  if (v.square) {
    [x, y] = [(Garden.square.x + 3) * TILE + v.dx * 2, (Garden.square.y + 2) * TILE + 4];
  } else {
    // stand beside the neighbour, wherever it is
    [x, y] = [v.plot.m.x + 13 + v.dx * 0.4, v.plot.m.y + 2];
  }
  if (Math.hypot(m.x - x, m.y - y) < 1.5) {
    if (v.until == null) {
      v.until = t + 5 + Math.random() * 4;
      if (v.plot?.m) v.plot.m.greetAt = t; // the neighbour says hi back
    }
    m.heartAt = t;
    if (t > v.until) m.visit = null;
  }
  return m.visit ? { x, y } : null;
}

export const HEART = ['.p.p.', 'ppppp', 'ppppp', '.ppp.', '..p..'];

// Little hearts over a mochi that's visiting, or being visited.
export function drawHearts(g, p, x, y, t) {
  const m = p.m;
  const on = (m.heartAt && t - m.heartAt < 0.2) || (m.greetAt && t - m.greetAt < 2.5);
  if (!on || p.bubble) return;
  const k = (t * 0.8 + p.seed) % 1;
  g.globalAlpha = 1 - k;
  g.drawImage(prop('heart', HEART.map((r) => r.replace(/p/g, 'r'))), x + 9, y - 6 - Math.round(k * 6));
  g.globalAlpha = 1;
}
