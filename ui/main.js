// Mochi Garden's page: loads the garden, wires up the buttons and Claude Code's events, and
// reopens the sessions that were open last time.

import { onGardenCall } from './build.js';
import { demoGarden, devTypePrompt, devWatch } from './demo.js';
import { followSession, onHook, onRegistry, onTokens } from './events.js';
import { Garden, initGarden } from './garden.js';
import { checkHarvest } from './harvest.js';
import { load, restoreIds, save } from './persist.js';
import { Sound, setPref } from './rewards.js';
import { closeTab, markSeen, newSession, pickPlot, resendOverlay, renderList, select, sendAway, sendOverlaySettings, syncSize } from './sessions.js';
import { $, Quality, Tray, plots, tabOfPlot, tabs, ui } from './state.js';
import { emitTo, invoke, listen } from './tauri.js';
import { onAppShortcut, onCloseRequested } from './terminal.js';
import { onUpdateFailed, onUpdateReady } from './update.js';
import { onUsage, renderUsageBar } from './usage.js';

// Every module's exports on window.mochi, for poking at the garden from the devtools console
// (tools/console.py), e.g. mochi.plots or mochi.buildPieces(...).
import * as m_build from './build.js';
import * as m_cards from './cards.js';
import * as m_demo from './demo.js';
import * as m_events from './events.js';
import * as m_farm from './farm.js';
import * as m_garden from './garden.js';
import * as m_harvest from './harvest.js';
import * as m_persist from './persist.js';
import * as m_pieces from './pieces.js';
import * as m_rewards from './rewards.js';
import * as m_sessions from './sessions.js';
import * as m_sprites from './sprites.js';
import * as m_state from './state.js';
import * as m_terminal from './terminal.js';
import * as m_town from './town.js';
import * as m_usage from './usage.js';
import * as m_wardrobe from './wardrobe.js';
import * as m_helpers from './helpers.js';
import * as m_seeds from './seeds.js';
import * as m_social from './social.js';
import * as m_sky from './sky.js';
import * as m_desk from './desk.js';
import * as m_update from './update.js';
/** @type {any} */ (globalThis).mochi = Object.assign({}, m_build, m_cards, m_demo, m_events, m_farm, m_garden, m_harvest, m_persist, m_pieces, m_rewards, m_sessions, m_sprites, m_state, m_terminal, m_town, m_usage, m_wardrobe, m_helpers, m_seeds, m_social, m_sky, m_desk, m_update);

async function main() {
  await load();
  Garden.allPlots = plots;
  Garden.plots = plots.filter((p) => !p.away);
  initGarden($('#garden'), pickPlot);
  $('#new').onclick = () => newSession();
  $('#new2').onclick = () => newSession();
  const toggle = (btn, obj, key, after) => {
    const show = () => btn.classList.toggle('off', !obj.on);
    btn.onclick = () => {
      obj.on = !obj.on;
      setPref(key, obj.on);
      show();
      after?.();
    };
    show();
  };
  toggle($('#snd'), Sound, 'mg.sound');
  toggle($('#tray'), Tray, 'mg.tray', sendOverlaySettings);
  toggle($('#quality'), Quality, 'mg.quality', () => Garden.wake?.());
  // Tell the tray overlay whether we're the window in front (it shows seeds only when we're not).
  // Polled, because a window that starts unfocused never fires a focus change.
  let focusSent = null;
  setInterval(() => {
    const f = document.hasFocus();
    if (f === focusSent) return;
    focusSent = f;
    emitTo('overlay', 'main-focus', f).catch(() => {});
  }, 500);
  setInterval(() => {
    if (Garden.dirty) {
      Garden.dirty = false;
      save();
    }
  }, 5000);
  window.addEventListener('keydown', onAppShortcut, true);
  window.addEventListener('focus', markSeen);
  new ResizeObserver(() => tabs.get(ui.activeTab)?.fit.fit()).observe($('#terms'));

  await listen('pty-data', ({ payload }) => {
    const t = tabs.get(payload.tab);
    if (!t) return;
    const bin = atob(payload.data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    t.term.write(bytes);
    const w = devWatch.get(payload.tab);
    if (w) {
      w.text += new TextDecoder().decode(bytes).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, ' ');
      w.onText(w.text);
    }
  });
  await listen('pty-exit', ({ payload: tab }) => {
    const t = tabs.get(tab);
    if (!t) return;
    // /exit and friends: the tab closes and the mochi packs up. One that died right away keeps
    // its tab open, so whatever claude printed can be read.
    if (Date.now() - t.started > 5000) return closeTab(tab);
    sendAway(t.plot);
    t.term.write('\r\n\x1b[90m[claude exited]\x1b[0m\r\n');
    renderList();
    save();
  });
  await listen('claude-hook', ({ payload }) => onHook(payload));
  await listen('tokens', ({ payload }) => onTokens(payload));
  await listen('status-session', ({ payload }) => followSession(payload));
  // /resume into a session already running in the background: follow that one (hooks.rs follow_attach)
  await listen('attach', ({ payload }) => followSession(payload));
  await listen('registry', ({ payload }) => onRegistry(payload));
  // a session using its garden tools (build.js, src/mcp.rs)
  await listen('garden-call', ({ payload }) => onGardenCall(payload));
  document.fonts?.ready.then(() => tabs.forEach((t) => syncSize(t)));
  await listen('usage', ({ payload }) => onUsage(payload.rate_limits, performance.now() / 1000));
  await listen('close-requested', onCloseRequested);
  // a mochi peeking over the taskbar was clicked (overlay.html), or the overlay (re)loaded
  await listen('overlay-ready', resendOverlay);
  await listen('open-tab', ({ payload: tab }) => tabs.has(tab) && select(tab));
  await listen('update-ready', onUpdateReady);
  await listen('update-failed', onUpdateFailed);
  setInterval(checkHarvest, 30000);
  setTimeout(checkHarvest, 5000);
  renderUsageBar();
  renderList();

  const dev = await invoke('dev_env');
  if (dev.demo) demoGarden(dev.demo_only);
  // Sessions that were open when the garden last closed come back (resumed where they left off).
  for (const id of restoreIds) {
    const p = plots.find((q) => q.id === id);
    if (p?.sessionId && !tabOfPlot(p)) await newSession(p);
  }
  if (dev.autostart) {
    await newSession(null, dev.cwd);
    if (dev.prompt) devTypePrompt(ui.activeTab, dev.prompt);
  }
}

main();
