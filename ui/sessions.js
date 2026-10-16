// Opening, ending and switching sessions, and the session list beside the garden.

import { outfitOf } from './build.js';
import { Cards, closeCard, openCard } from './cards.js';
import { Garden, placePlot, returnPlot, spawnMochi } from './garden.js';
import { save } from './persist.js';
import { Sound, tone } from './rewards.js';
import { FLAVOUR_ORDER, mochiSprite } from './sprites.js';
import { $, Tray, plots, tabOfPlot, tabs, ui, uuid } from './state.js';
import { emitTo, invoke } from './tauri.js';
import { makeTerminal } from './terminal.js';

export function nextFlavour() {
  const used = new Set(plots.filter((p) => p.live).map((p) => p.flavour));
  const free = FLAVOUR_ORDER.filter((f) => !used.has(f));
  const pool = free.length ? free : FLAVOUR_ORDER;
  return plots.length === 0 ? 'terracotta' : pool[Math.floor(Math.random() * pool.length)];
}

// A new mochi walking in for a session that has no plot yet.
export function makePlot(cwd) {
  const plot = { id: uuid(), sessionId: null, flavour: nextFlavour(), x: null, y: null, title: null, tokens: 0, built: false, created: Date.now(), seed: Math.random() * 6, cwd: cwd || null, pieces: [], wild: {}, spent: 0, coins: 1 };
  plots.push(plot);
  Garden.plots.push(plot);
  spawnMochi(plot, true);
  return plot;
}

export function dropPlot(p) {
  for (const list of [plots, Garden.plots]) if (list.includes(p)) list.splice(list.indexOf(p), 1);
}

// The session ended: its mochi packs up and walks off (garden.js), and its plot is put away.
export function sendAway(p) {
  p.live = false;
  p.bubble = null;
  p.selected = false;
  p.helpers = [];
  if (Cards.plot === p) closeCard();
  // never got a prompt: it wanders off without planting anything
  if (p.x == null) return dropPlot(p);
  p.activity = 'leaving';
}

// A packed-away session resumed: its mochi walks back in to its old spot (or a free one nearby).
export function bringBack(p) {
  if (!p.away) return;
  p.away = false;
  returnPlot(p);
  p.m = null;
  spawnMochi(p, true);
  Garden.plots.push(p);
}

// The tab now shows a different conversation (/resume, /clear, --continue, a background job):
// the one it showed packs away, and this one's own plot comes back, or a new mochi arrives for
// it. `existing`: a conversation with history, whose mochi goes straight to a built desk.
export function switchSession(t, id, existing) {
  const old = t.plot;
  if (!old.sessionId) {
    old.sessionId = id;
    return old;
  }
  const stored = plots.find((p) => p !== old && p.sessionId === id && !tabOfPlot(p));
  let next;
  if (stored) {
    if (old.x == null) dropPlot(old);
    else sendAway(old);
    bringBack(stored);
    next = stored;
    next.activity = 'idle';
  } else {
    if (old.x == null) next = old; // nothing planted yet: this mochi takes the new conversation
    else {
      sendAway(old);
      next = makePlot(old.cwd);
      next.activity = 'arriving';
    }
    next.title = null; // its own name arrives from the hooks, registry or transcript
    next.mainTokens = 0;
    next.tokens = next.agentTokens = 0;
    if (existing) {
      if (next.x == null) placePlot(next);
      next.built = true;
    }
  }
  next.sessionId = id;
  next.live = true;
  next.bubble = null;
  next.adopting = true; // its first token read sets the total without a seed burst
  t.plot = next;
  next.selected = ui.activeTab === t.tab;
  return next;
}

export async function newSession(resumePlot, cwd) {
  const tab = uuid();
  let plot = resumePlot;
  if (plot) bringBack(plot);
  else plot = makePlot(cwd);
  plot.live = true;
  plot.activity = resumePlot ? 'idle' : 'arriving';
  plot.bubble = null;

  const el = document.createElement('div');
  el.className = 'term';
  $('#terms').appendChild(el);
  const { term, fit } = makeTerminal(el);
  const t = { tab, plot, term, fit, el, li: null, started: Date.now() };
  tabs.set(tab, t);
  select(tab);
  fit.fit();

  term.onData((data) => invoke('pty_write', { tab, data }).catch(() => {}));
  term.onResize(({ cols, rows }) => invoke('pty_resize', { tab, cols, rows }).catch(() => {}));
  try {
    const r = await invoke('start_session', { tab, resume: resumePlot?.sessionId ?? null, cwd: plot.cwd ?? null, cols: term.cols, rows: term.rows });
    // A session with nothing to resume starts fresh under a new id (lib.rs start_session).
    if (r.session_id && r.session_id !== plot.sessionId) {
      if (plot.sessionId) plot.title = null;
      plot.sessionId = r.session_id;
    }
    // The panel often settles (and the font loads) while claude is starting; a resize sent before
    // the PTY existed was dropped, so send the real size now that it does.
    syncSize(t);
    setTimeout(() => syncSize(t), 400);
  } catch (e) {
    term.write(`\r\n\x1b[31mCould not start claude: ${e}\x1b[0m\r\n`);
  }
  renderList();
  save();
  term.focus();
}

export function closeTab(tab) {
  const t = tabs.get(tab);
  if (!t) return;
  invoke('pty_kill', { tab }).catch(() => {});
  t.term.dispose();
  t.el.remove();
  tabs.delete(tab);
  sendAway(t.plot);
  if (ui.activeTab === tab) {
    ui.activeTab = null;
    const next = [...tabs.keys()].pop();
    if (next) select(next);
  }
  renderList();
  save();
}

// Fit the terminal to its panel and make sure the PTY (and so Claude Code's layout) has the same size.
export function syncSize(t) {
  if (!t || !tabs.has(t.tab)) return;
  if (t.el.classList.contains('active')) t.fit.fit();
  invoke('pty_resize', { tab: t.tab, cols: t.term.cols, rows: t.term.rows }).catch(() => {});
}

export function select(tab) {
  ui.activeTab = tab;
  for (const [id, t] of tabs) {
    const on = id === tab;
    t.el.classList.toggle('active', on);
    t.plot.selected = on;
    if (on) {
      requestAnimationFrame(() => {
        syncSize(t);
        t.term.focus();
      });
    }
  }
  markSeen();
  renderList();
}

// The "!" clears once you are actually looking at that session.
export function markSeen() {
  const t = tabs.get(ui.activeTab);
  if (t && document.hasFocus() && t.plot.bubble === '!') {
    t.plot.bubble = null;
    renderList();
  }
}

// Clicking a mochi opens its terminal and, unless the click came from the card itself, the card
// for acting right there in the garden.
export function pickPlot(plot, fromCard) {
  const t = tabOfPlot(plot);
  if (t) select(t.tab);
  else if (plot.sessionId) newSession(plot);
  if (t && !fromCard) openCard(plot);
}

// Taskbar button: a working glow while any mochi works, a flash when one needs you.
export let taskbarWorking = null;
export function updateTaskbar(attention) {
  const working = plots.some((p) => p.live && p.activity === 'working');
  if (working === taskbarWorking && !attention) return;
  taskbarWorking = working;
  invoke('taskbar_state', { working, attention }).catch(() => {});
}

// The tray overlay: whether it's on, and every open session's mochi to peek over the taskbar.
let overlaySent = '';
// The overlay (re)loaded: send it everything again.
export function resendOverlay() {
  overlaySent = '';
  sendOverlaySettings();
}
export function sendOverlaySettings() {
  const mochis = [...tabs.values()]
    .filter((t) => t.plot.live)
    .map(({ tab, plot: p }) => ({ tab, flavour: p.flavour, activity: p.activity, bubble: p.bubble, outfit: outfitOf(p), title: p.name ? `${p.name} · ${p.title || 'new session'}` : p.title }));
  const msg = JSON.stringify({ enabled: Tray.on, mochis });
  if (msg === overlaySent) return;
  overlaySent = msg;
  emitTo('overlay', 'overlay-settings', JSON.parse(msg)).catch(() => {});
}
// Sounds: tiny synthesized chimes (rewards.js), no audio files.
export function chime(kind) {
  if (!Sound.on) return;
  const notes = kind === 'done' ? [880, 1318.5] : [987.8, 783.99, 987.8];
  notes.forEach((f, i) => tone(f, i * 0.11, { gain: 0.07, dur: 0.35 }));
}

// Session list ---------------------------------------------------------------------------------

export function statusOf(p) {
  if (!p.live) return ['ended', ''];
  if (p.bubble === '?') return ['needs you', 'asking'];
  if (p.bubble === '!') return ['done', 'done'];
  const helpers = (p.helpers || []).length;
  if (p.activity === 'working' || helpers) return [(p.built ? 'working' : 'building') + (helpers ? ` +${helpers}` : ''), 'working'];
  if (p.activity === 'arriving') return ['new', ''];
  return ['idle', ''];
}

export function renderList() {
  const list = $('#list');
  list.textContent = '';
  for (const t of tabs.values()) {
    const p = t.plot;
    const li = document.createElement('li');
    li.classList.toggle('active', t.tab === ui.activeTab);
    const face = document.createElement('canvas');
    face.width = 13;
    face.height = 11;
    face.getContext('2d').drawImage(mochiSprite(p.flavour, 'idle'), 0, 0);
    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = p.name ? `${p.name} · ${p.title || 'new session'}` : p.title || 'new session';
    const [label, cls] = statusOf(p);
    const status = document.createElement('span');
    status.className = 'status ' + cls;
    status.textContent = (p.bubble ? p.bubble + ' ' : '') + label;
    const close = document.createElement('button');
    close.className = 'close';
    close.textContent = 'x';
    close.title = 'End this session (its mochi packs up; resume the session to bring it back)';
    close.onclick = (e) => {
      e.stopPropagation();
      closeTab(t.tab);
    };
    li.append(face, title, status, close);
    li.onclick = () => select(t.tab);
    list.appendChild(li);
  }
  $('#count').textContent = `SESSIONS (${tabs.size})`;
  sendOverlaySettings();
  $('#empty').classList.toggle('hidden', tabs.size > 0);
}
