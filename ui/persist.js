// Saving and loading the garden (%APPDATA%/MochiGarden/garden.json, via lib.rs).

import { migrateLand } from './farm.js';
import { Garden, PLOT_H, PLOT_W, WORLD_COLS, WORLD_ROWS } from './garden.js';
import { plots, tabs } from './state.js';
import { invoke } from './tauri.js';

export const SAVED = ['id', 'sessionId', 'flavour', 'x', 'y', 'title', 'tokens', 'agentTokens', 'built', 'created', 'cwd', 'streak', 'lastStop', 'wild', 'spent', 'coins', 'name', 'outfit', 'gifts'];
export let saveTimer = null;
export function gardenJson() {
  const data = plots
    .filter((p) => p.sessionId && (p.x != null || p.tokens))
    .map((p) => ({ ...Object.fromEntries(SAVED.map((k) => [k, p[k]])), pieces: (p.pieces || []).map((pc) => ({ k: pc.k, x: pc.x, y: pc.y, v: pc.v, txt: pc.txt, crop: pc.crop && { k: pc.crop.k, w: pc.crop.w } })) }));
  // sessions open right now, so they come back on the next launch
  const open = [...tabs.values()].filter((t) => t.plot.live && t.plot.sessionId).map((t) => t.plot.id);
  return JSON.stringify({ version: 2, world: [WORLD_COLS, WORLD_ROWS], plots: data, open, square: Garden.square || null, week: Garden.week || null }, null, 1);
}
export function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => invoke('save_garden', { json: gardenJson() }).catch(console.error), 800);
}
export async function saveNow() {
  clearTimeout(saveTimer);
  await invoke('save_garden', { json: gardenJson() }).catch(console.error);
}
export let restoreIds = [];

export async function load() {
  try {
    const data = JSON.parse(await invoke('load_garden'));
    restoreIds = data.open || [];
    // Only the sessions that were open come back into the garden; the rest stay packed away.
    for (const p of data.plots || []) plots.push({ ...p, mainTokens: (p.tokens || 0) - (p.agentTokens || 0), live: false, activity: 'sleep', seed: Math.random() * 6, away: !restoreIds.includes(p.id) });
    // Gardens from before the bigger world: move the plots, as a group, into its middle.
    const placed = plots.filter((p) => p.x != null);
    if (!data.world && placed.length) {
      const x0 = Math.min(...placed.map((p) => p.x)), x1 = Math.max(...placed.map((p) => p.x + PLOT_W));
      const y0 = Math.min(...placed.map((p) => p.y)), y1 = Math.max(...placed.map((p) => p.y + PLOT_H));
      const dx = Math.round(WORLD_COLS / 2 - (x0 + x1) / 2), dy = Math.round(WORLD_ROWS / 2 - (y0 + y1) / 2);
      for (const p of placed) [p.x, p.y] = [p.x + dx, p.y + dy];
    }
    // ...and gardens from the fixed-farm days keep their soil and crops as pieces (farm.js).
    for (const p of plots) {
      migrateLand(p);
      for (const pc of p.pieces) pc.b = 1; // anything half-built when the garden closed is finished
    }
    Garden.square = data.square || null;
    Garden.week = data.week || null;
  } catch (e) {
    console.error(e);
  }
}
