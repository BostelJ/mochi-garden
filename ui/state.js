// What the app knows right now: every plot (persisted), the open tabs, and which tab is in front.
// A plot is one Claude Code session's place in the garden; a tab is a live terminal attached to a
// plot. Only open sessions are in the garden (Garden.plots): when one ends its mochi packs up and
// walks off, and its plot (farm, coins, streak) is kept, so resuming that session brings it back.

import { pref } from './rewards.js';

/** @type {Plot[]} every plot, open or packed away (persist.js saves them) */
export const plots = [];
/** @type {Map<string, Tab>} tab id -> the live terminal and its plot */
export const tabs = new Map();
/** The tab in front (a property, since other modules change it). */
export const ui = { activeTab: /** @type {string | null} */ (null) };

export const $ = (sel) => document.querySelector(sel);
export const uuid = () => crypto.randomUUID();

/** @param {Plot} plot */
export function tabOfPlot(plot) {
  for (const t of tabs.values()) if (t.plot === plot) return t;
  return null;
}

export const Tray = { on: pref('mg.tray', true) };
// [ quality ]: the garden at the display's full refresh rate instead of 30/15 fps (garden.js).
export const Quality = { on: pref('mg.quality', false) };
// [ free time ]: sessions get a free moment after a turn of real work (hooks.rs free_time).
export const FreeTime = { on: pref('mg.freetime', true) };
