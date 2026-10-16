// Dev and demo helpers: MOCHI_AUTOSTART's test prompt and MOCHI_DEMO's garden.

import { demoLand } from './farm.js';
import { Garden, placePlot } from './garden.js';
import { helperDone, helperWorked, noteAgentCall, spawnHelper } from './helpers.js';
import { plots, uuid } from './state.js';
import { emitTo, invoke } from './tauri.js';
import { Usage, onUsage } from './usage.js';

// Dev runs: watch the terminal's output, answer the folder-trust dialog if it shows, and type
// the test prompt once Claude's input box is up and output has gone quiet.
export const devWatch = new Map(); // tab -> { text, onText }
export function devTypePrompt(tab, prompt) {
  const send = (data) => invoke('pty_write', { tab, data });
  let trusted = false, typed = false, quiet = null;
  devWatch.set(tab, {
    text: '',
    onText(all) {
      if (typed) return;
      if (!trusted && /trust this folder/i.test(all)) {
        trusted = true;
        setTimeout(() => send('\x1b[B'), 400);
        setTimeout(() => send('\r'), 900);
        return;
      }
      clearTimeout(quiet);
      quiet = setTimeout(() => {
        if (typed || /trust this folder/i.test(all.slice(-2000)) && !trusted) return;
        typed = true;
        send(prompt);
        setTimeout(() => send('\r'), 700);
      }, 2500);
    },
  });
}

// MOCHI_DEMO=1: one plot per growth stage, for looking at the art. No session id, so never saved.
export function demoGarden(only) {
  Usage.demo = true; // fake usage below must not overwrite the real remembered numbers
  /** @type {[string, string, number, Plot['activity'], Plot['bubble']][]} */
  const demo = [
    ['terracotta', 'fix login redirect', 4e3, 'working', null],
    ['matcha', 'shop page icons', 90e3, 'idle', '!'],
    ['strawberry', 'csv import', 220e3, 'working', null],
    ['ube', 'flaky test hunt', 450e3, 'idle', '?'],
    ['mango', 'api rate limiter', 700e3, 'working', null],
    ['soda', 'docs cleanup', 1.1e6, 'idle', null],
    ['sesame', 'old notes', 1.6e6, 'sleep', null],
    ['vanilla', 'dark mode', 4.2e6, 'working', null],
  ];
  for (const [flavour, title, tokens, activity, bubble] of demo) {
    /** @type {Plot} */
    const p = { id: uuid(), x: null, y: null, sessionId: null, flavour, title, tokens, built: true, live: activity !== 'sleep', activity, bubble, seed: Math.random() * 6, pieces: [] };
    plots.push(p);
    Garden.plots.push(p);
    placePlot(p);
    demoLand(p);
  }
  // MOCHI_DEMO_ONLY=<title>: just that plot, for a close look
  if (only) {
    const keep = plots.filter((p) => p.title === only);
    plots.length = 0;
    plots.push(...keep);
    Garden.plots.length = 0;
    Garden.plots.push(...keep);
    Garden.squareCheck = 1e12;
  }
  // the idle mochis still have their last couple of pieces to build, so building can be seen
  for (const p of plots.filter((p) => p.activity === 'idle' && p.live && !p.sessionId)) p.pieces.slice(-2).forEach((pc) => (pc.b = 0));
  // Usage to look at: a third of the week gone, the 5-hour window nearly spent; then it resets.
  const now = Date.now() / 1000;
  onUsage({ five_hour: { used_percentage: 86, resets_at: now + 3600 * 1.3 }, seven_day: { used_percentage: 38, resets_at: now + 86400 * 3.4 } }, 0);
  setTimeout(() => onUsage({ five_hour: { used_percentage: 3, resets_at: now + 3600 * 5 } }, performance.now() / 1000), 9000);
  // Helpers: the heavy worker throws two, which come home with their tokens a bit later.
  setTimeout(() => {
    const w = plots.find((p) => p.title === 'api rate limiter');
    if (!w) return;
    noteAgentCall(w, { description: 'find reference art' });
    spawnHelper(w, 'demo-a', 'Explore', performance.now() / 1000);
    setTimeout(() => {
      noteAgentCall(w, { description: 'check icon sizes' });
      spawnHelper(w, 'demo-b', 'general-purpose', performance.now() / 1000);
    }, 1200);
    const work = setInterval(() => ['demo-a', 'demo-b'].forEach((id) => helperWorked(w, id, performance.now() / 1000)), 2000);
    setTimeout(() => helperDone(w, 'demo-a', 40000, performance.now() / 1000), 12000);
    setTimeout(() => (helperDone(w, 'demo-b', 25000, performance.now() / 1000), clearInterval(work)), 16000);
  }, 2500);
  // Streaks to look at: csv import x3 (warm), api rate limiter x5 (hot), dark mode x9 (blazing).
  const streaks = { 'csv import': 3, 'api rate limiter': 5, 'dark mode': 9 };
  for (const p of plots) if (streaks[p.title]) [p.streak, p.lastStop] = [streaks[p.title], Date.now()];
  // Fake token flow for the working ones: a light trickle, a steady worker, and a heavy burster.
  const [light, steady, heavy] = plots.filter((p) => p.activity === 'working' && !p.sessionId);
  setInterval(() => {
    if (light) light.bank = (light.bank || 0) + 40;
    if (steady) steady.bank = (steady.bank || 0) + 600;
    if (heavy && Math.random() < 0.12) heavy.bank = (heavy.bank || 0) + 25000;
    // and the same flow to the tray overlay, which only shows it while this window is unfocused
    emitTo('overlay', 'tokens', { tab: 'demo', delta: 1200 }).catch(() => {});
  }, 400);
}
