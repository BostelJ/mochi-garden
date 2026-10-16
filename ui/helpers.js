// Subagents as helper mochis. When a session spawns an agent, its mochi pinches off a little
// piece of itself and throws it; the piece lands, pops up as a tiny helper in the same flavour
// and works beside the plot. When the subagent finishes, the helper hops home, merges back in,
// and its tokens arrive in one burst of seeds. Helpers are live-only (not saved).

import { Garden, PLOT_H, TILE, toWorld } from './garden.js';
import { noteWeekTokens } from './harvest.js';
import { Sound, tone } from './rewards.js';
import { SEED_CAP, Seeds, spawnSeed } from './seeds.js';
import { FLAVOURS, OUTLINE, gridCanvas, spriteCache } from './sprites.js';

export const MINI = ['..ooo..', '.obbbo.', 'obebebo', 'opbbbpo', 'obbbbso', '.ossso.', '..ooo..'];
export const HELPER_GRAVITY = 420;

export function miniSprite(flavour) {
  const key = 'mini:' + flavour;
  if (spriteCache.has(key)) return spriteCache.get(key);
  const f = FLAVOURS[flavour] || FLAVOURS.terracotta;
  const c = gridCanvas(MINI, (ch) => ({ o: OUTLINE, b: f.b, s: f.s, p: f.p, e: OUTLINE })[ch]);
  spriteCache.set(key, c);
  return c;
}

// PreToolUse(Agent) tells us what the agent is for; SubagentStart follows with its id.
export function noteAgentCall(p, input) {
  p.pendingAgents = p.pendingAgents || [];
  p.pendingAgents.push((input && (input.description || input.subagent_type)) || 'helper');
}

export function spawnHelper(p, id, type, t) {
  if (!p.m || p.x == null) return;
  p.helpers = p.helpers || [];
  if (p.helpers.some((h) => h.id === id)) return;
  const label = (p.pendingAgents && p.pendingAgents.shift()) || type || 'helper';
  // Helpers line up just below their parent's plot, in the first free slot.
  const used = new Set(p.helpers.map((h) => h.slot));
  let slot = 0;
  while (used.has(slot)) slot++;
  const tx = p.x * TILE + 4 + (slot % 8) * 11, ty = (p.y + PLOT_H) * TILE + 1 + Math.floor(slot / 8) * 10;
  const sx = p.m.x + 3, sy = p.m.y - 2;
  const T = 0.75;
  p.helpers.push({
    id, label, slot, state: 'thrown', x: sx, y: sy, tx, ty,
    vx: (tx - sx) / T, vy: (ty - sy - 0.5 * HELPER_GRAVITY * T * T) / T,
    land: t + T, born: t, lastWork: t, seed: Math.random() * 6, acc: 0,
  });
  p.m.pop = t;
  p.m.throwAt = t;
  throwSound(p);
}

export function helperWorked(p, id, t) {
  const h = p.helpers && p.helpers.find((x) => x.id === id);
  if (h) h.lastWork = t;
}

export function helperDone(p, id, tokens, t) {
  const h = p.helpers && p.helpers.find((x) => x.id === id);
  if (!h) {
    if (tokens) addAgentTokens(p, tokens); // its helper never showed (e.g. app opened mid-run)
    return;
  }
  h.state = 'returning';
  h.tokens = tokens || 0;
}

// Subagent tokens live in their own transcripts, so they're tracked beside the main count.
export function addAgentTokens(p, n) {
  p.agentTokens = (p.agentTokens || 0) + n;
  p.tokens = (p.mainTokens || 0) + p.agentTokens;
  p.bank = (p.bank || 0) + n;
  noteWeekTokens(p, n);
  Garden.dirty = true;
}

export function updateHelpers(p, dt, t) {
  if (!p.helpers) return;
  for (const h of p.helpers) {
    if (h.state === 'thrown') {
      h.vy += HELPER_GRAVITY * dt;
      h.x += h.vx * dt;
      h.y += h.vy * dt;
      if (t >= h.land) {
        [h.x, h.y] = [h.tx, h.ty];
        h.state = 'working';
        h.poppedAt = t;
      }
    } else if (h.state === 'working') {
      // busy while its subagent is using tools: a little trickle of its own seeds
      if (t - h.lastWork < 25) {
        h.acc += dt * 1.5;
        while (h.acc >= 1) {
          h.acc -= 1;
          if (Seeds.list.length < SEED_CAP) spawnSeed(p, t, { x: h.x + 3, y: h.y, small: true });
          h.pop = t;
        }
      }
    } else if (h.state === 'returning' && p.m) {
      const dx = p.m.x + 3 - h.x, dy = p.m.y + 3 - h.y, d = Math.hypot(dx, dy);
      if (d < 2) {
        h.state = 'gone';
        p.m.pop = t;
        p.m.mergeAt = t;
        if (h.tokens) addAgentTokens(p, h.tokens);
        mergeSound(p);
      } else {
        const step = Math.min(d, 34 * dt);
        h.x += (dx / d) * step;
        h.y += (dy / d) * step;
        h.phase = (h.phase || 0) + dt * 12;
      }
    }
  }
  p.helpers = p.helpers.filter((h) => h.state !== 'gone');
}

export function drawHelpers(g, p, t) {
  if (!p.helpers) return;
  const spr = miniSprite(p.flavour);
  for (const h of p.helpers) {
    let x = Math.round(h.x), y = Math.round(h.y);
    if (h.state === 'thrown') {
      // the piece in flight: a little ball, spinning a sparkle
      g.drawImage(spr, x, y);
      if (Math.sin(t * 30) > 0) {
        g.fillStyle = '#ffffff';
        g.fillRect(x - 1, y - 1, 1, 1);
      }
      continue;
    }
    if (h.state === 'returning') y -= Math.round(Math.abs(Math.sin(h.phase)) * 3);
    else {
      const busy = t - h.lastWork < 25;
      if (h.poppedAt && t - h.poppedAt < 0.2) y -= Math.round(Math.sin(((t - h.poppedAt) / 0.2) * Math.PI) * 3); // pops up on landing
      else if (busy) y -= Math.sin(t * 9 + h.seed) > 0.4 ? 1 : 0;
      else y -= Math.sin(t * 2 + h.seed) > 0.8 ? 1 : 0;
      if (h.pop && t - h.pop < 0.06) y -= 1;
    }
    g.fillStyle = 'rgba(40, 50, 20, 0.25)';
    g.fillRect(Math.round(h.x) + 1, Math.round(h.y) + 6, 5, 1);
    g.drawImage(spr, x, y);
  }
}

// Each helper's task, small, under it (screen resolution).
export function drawHelperLabels(ctx, p) {
  if (!p.helpers) return;
  const S = Garden.S;
  ctx.font = `${Math.max(9, 3 * S)}px 'Cascadia Mono', Consolas, 'SF Mono', Menlo, monospace`;
  ctx.textBaseline = 'top';
  const mouse = Garden.mouse && toWorld(Garden.mouse.x, Garden.mouse.y);
  const near = (h) => mouse && Math.abs(mouse.x - (h.x + 3.5)) < 6 && Math.abs(mouse.y - (h.y + 3.5)) < 6;
  const working = p.helpers.filter((h) => h.state === 'working');
  for (const h of working) {
    if (working.length > 1 && !near(h)) continue; // one helper: always; several: on hover
    const text = h.label.length > 18 ? h.label.slice(0, 17) + '…' : h.label;
    const w = ctx.measureText(text).width;
    const x = (h.x + 3.5) * S - w / 2, y = (h.y + 8) * S;
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(58, 34, 24, 0.85)';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = '#fff7e0';
    ctx.fillText(text, x, y);
  }
}

export function throwSound(p) {
  if (!Sound.on || document.hidden) return;
  tone(440, 0, { gain: 0.04, dur: 0.18, type: 'triangle', drop: 2.2 }); // whoop up
}

export function mergeSound(p) {
  if (!Sound.on || document.hidden) return;
  tone(1046.5, 0, { gain: 0.04, dur: 0.2, type: 'triangle', drop: 0.6 });
  tone(1568, 0.08, { gain: 0.035, dur: 0.3 });
}
