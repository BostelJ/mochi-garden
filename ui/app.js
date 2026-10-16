// Sessions, terminals and hook events. A plot is one Claude Code session's place in the
// garden (persisted); a tab is a live terminal attached to a plot. Only open sessions are in the
// garden (Garden.plots): when one ends its mochi packs up and walks off, and its plot (farm,
// tokens, streak) is kept, so resuming that session brings it back.

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const plots = []; // persisted: { id, sessionId, flavour, x, y, title, tokens, built, created }
const tabs = new Map(); // tab id -> { tab, plot, term, fit, el, li }
let activeTab = null;

const $ = (sel) => document.querySelector(sel);
const uuid = () => crypto.randomUUID();

// Persistence ------------------------------------------------------------------------------

const SAVED = ['id', 'sessionId', 'flavour', 'x', 'y', 'title', 'tokens', 'agentTokens', 'built', 'created', 'cwd', 'streak', 'lastStop', 'wild', 'spent', 'name', 'outfit', 'gifts'];
let saveTimer = null;
function gardenJson() {
  const data = plots
    .filter((p) => p.sessionId && (p.x != null || p.tokens))
    .map((p) => ({ ...Object.fromEntries(SAVED.map((k) => [k, p[k]])), pieces: (p.pieces || []).map((pc) => ({ k: pc.k, x: pc.x, y: pc.y, v: pc.v, txt: pc.txt, crop: pc.crop && { k: pc.crop.k, w: pc.crop.w } })) }));
  // sessions open right now, so they come back on the next launch
  const open = [...tabs.values()].filter((t) => t.plot.live && t.plot.sessionId).map((t) => t.plot.id);
  return JSON.stringify({ version: 2, world: [WORLD_COLS, WORLD_ROWS], plots: data, open, square: Garden.square || null, week: Garden.week || null }, null, 1);
}
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => invoke('save_garden', { json: gardenJson() }).catch(console.error), 800);
}
async function saveNow() {
  clearTimeout(saveTimer);
  await invoke('save_garden', { json: gardenJson() }).catch(console.error);
}
let restoreIds = [];

async function load() {
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

// Sessions ---------------------------------------------------------------------------------

function nextFlavour() {
  const used = new Set(plots.filter((p) => p.live).map((p) => p.flavour));
  const free = FLAVOUR_ORDER.filter((f) => !used.has(f));
  const pool = free.length ? free : FLAVOUR_ORDER;
  return plots.length === 0 ? 'terracotta' : pool[Math.floor(Math.random() * pool.length)];
}

// A new mochi walking in for a session that has no plot yet.
function makePlot(cwd) {
  const plot = { id: uuid(), sessionId: null, flavour: nextFlavour(), x: null, y: null, title: null, tokens: 0, built: false, created: Date.now(), seed: Math.random() * 6, cwd: cwd || null, pieces: [], wild: {}, spent: 0 };
  plots.push(plot);
  Garden.plots.push(plot);
  spawnMochi(plot, true);
  return plot;
}

function dropPlot(p) {
  for (const list of [plots, Garden.plots]) if (list.includes(p)) list.splice(list.indexOf(p), 1);
}

// The session ended: its mochi packs up and walks off (garden.js), and its plot is put away.
function sendAway(p) {
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
function bringBack(p) {
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
function switchSession(t, id, existing) {
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
  next.selected = activeTab === t.tab;
  return next;
}

async function newSession(resumePlot, cwd) {
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

function closeTab(tab) {
  const t = tabs.get(tab);
  if (!t) return;
  invoke('pty_kill', { tab }).catch(() => {});
  t.term.dispose();
  t.el.remove();
  tabs.delete(tab);
  sendAway(t.plot);
  if (activeTab === tab) {
    activeTab = null;
    const next = [...tabs.keys()].pop();
    if (next) select(next);
  }
  renderList();
  save();
}

// Fit the terminal to its panel and make sure the PTY (and so Claude Code's layout) has the same size.
function syncSize(t) {
  if (!t || !tabs.has(t.tab)) return;
  if (t.el.classList.contains('active')) t.fit.fit();
  invoke('pty_resize', { tab: t.tab, cols: t.term.cols, rows: t.term.rows }).catch(() => {});
}

function select(tab) {
  activeTab = tab;
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
function markSeen() {
  const t = tabs.get(activeTab);
  if (t && document.hasFocus() && t.plot.bubble === '!') {
    t.plot.bubble = null;
    renderList();
  }
}

function tabOfPlot(plot) {
  for (const t of tabs.values()) if (t.plot === plot) return t;
  return null;
}

// Clicking a mochi opens its terminal and, unless the click came from the card itself, the card
// for acting right there in the garden.
function pickPlot(plot, fromCard) {
  const t = tabOfPlot(plot);
  if (t) select(t.tab);
  else if (plot.sessionId) newSession(plot);
  if (t && !fromCard) openCard(plot);
}

// Hook events --------------------------------------------------------------------------------

function onHook(ev) {
  const t = tabs.get(ev.tab);
  if (!t) return;
  const raw = ev.raw || {};
  if (ev.session_id && ev.session_id !== t.plot.sessionId) switchSession(t, ev.session_id, raw.source === 'resume');
  const p = t.plot;
  p.lastEvent = Date.now();
  if (!ev.synthetic) p.lastHook = Date.now();
  if (raw.cwd && !p.cwd) p.cwd = raw.cwd;
  if (ev.title) p.title = ev.title;
  else if (raw.session_title && !p.title) p.title = raw.session_title;

  const bubbleBefore = p.bubble;
  const now = performance.now() / 1000;
  // Tool use inside a subagent is its helper's work, not the parent's (which may be done and
  // waiting with a "!"), so it only wakes the helper.
  if (raw.agent_id && (ev.event === 'PreToolUse' || ev.event === 'PostToolUse')) {
    helperWorked(p, raw.agent_id, now);
    if (ev.tokens != null) applyTokens(p, ev.tokens, ev.first || p.adopting);
    p.adopting = false;
    return;
  }
  notePending(p, ev, raw);
  switch (ev.event) {
    case 'UserPromptSubmit':
      if (p.x == null) placePlot(p);
      if (!p.title && raw.prompt) p.title = raw.prompt.replace(/\s+/g, ' ').trim().slice(0, 40);
      bumpStreak(p);
      p.activity = 'working';
      p.bubble = null;
      break;
    case 'SubagentStart':
      spawnHelper(p, raw.agent_id, raw.agent_type, now);
      break;
    case 'SubagentStop':
      helperDone(p, raw.agent_id, ev.agent_tokens, now);
      break;
    case 'PreToolUse':
      if (raw.tool_name === 'Agent') noteAgentCall(p, raw.tool_input);
      p.activity = 'working';
      p.bubble = raw.tool_name === 'AskUserQuestion' ? '?' : null;
      if (p.bubble) chime('ask');
      break;
    case 'PostToolUse':
      p.activity = 'working';
      if (p.bubble === '?') p.bubble = null;
      break;
    case 'PermissionRequest':
      p.bubble = '?';
      chime('ask');
      break;
    case 'Notification': {
      const kind = `${raw.notification_type || ''} ${raw.message || ''}`;
      if (/permission|elicitation|question|approve|input/i.test(kind) && !/idle/i.test(raw.notification_type || '')) {
        p.bubble = '?';
        chime('ask');
      }
      break;
    }
    case 'Stop':
      p.built = true;
      p.activity = 'idle';
      p.lastStop = Date.now();
      if (activeTab !== ev.tab || !document.hasFocus()) {
        p.bubble = '!';
        chime('done');
      } else p.bubble = null;
      break;
    case 'SessionEnd':
      p.activity = 'sleep';
      p.bubble = null;
      p.helpers = [];
      break;
  }
  if (ev.tokens != null) {
    applyTokens(p, ev.tokens, ev.first || p.adopting);
    p.adopting = false;
  }
  const attention = !!p.bubble && p.bubble !== bubbleBefore;
  updateTaskbar(attention);
  renderList();
  save();
}

// Sessions the tab's own hooks can't hear ------------------------------------------------------
// After /resume a tab can be showing a different session, and if that one is a background job (or
// running in another terminal) it does its work in its own process, whose hooks don't reach us.
// The tab's status line says which session it shows; Claude Code's session registry (hooks.rs)
// says whether that session is busy or idle and what it's called; its transcript has the tokens.

function followSession(ev) {
  const t = tabs.get(ev.tab);
  if (!t || !ev.session_id || ev.session_id === t.plot.sessionId) return;
  // an existing conversation: its mochi goes straight to a plot with its desk already built
  const p = switchSession(t, ev.session_id, true);
  if (p.activity === 'arriving' && p.x != null) p.activity = 'idle';
  invoke('watch_session', { tab: t.tab, sessionId: ev.session_id, transcript: ev.transcript_path || null }).catch(() => {});
  renderList();
  save();
}

function onRegistry(list) {
  const byId = new Map((list || []).map((r) => [r.sessionId, r]));
  let changed = false;
  for (const t of tabs.values()) {
    const p = t.plot;
    const r = byId.get(p.sessionId);
    if (!r) continue;
    // A brand-new background job is "named" after its own id until it gets a real name.
    const placeholder = r.nameSource === 'derived' || (!r.nameSource && (r.name === r.jobId || String(r.sessionId || '').startsWith(r.name)));
    if (!p.title && r.name && !placeholder) {
      p.title = r.name;
      changed = true;
    }
    // Only stand in for hooks when this tab's hooks have been quiet for a while.
    if (Date.now() - (p.lastHook || 0) < 15000 || !p.live) continue;
    if (r.status === 'busy' && p.activity !== 'working') onHook({ tab: t.tab, event: 'UserPromptSubmit', raw: {}, synthetic: true });
    else if (r.status === 'idle' && p.activity === 'working') onHook({ tab: t.tab, event: 'Stop', raw: {}, synthetic: true });
  }
  if (changed) {
    renderList();
    save();
  }
}

// Taskbar button: a working glow while any mochi works, a flash when one needs you.
let taskbarWorking = null;
function updateTaskbar(attention) {
  const working = plots.some((p) => p.live && p.activity === 'working');
  if (working === taskbarWorking && !attention) return;
  taskbarWorking = working;
  invoke('taskbar_state', { working, attention }).catch(() => {});
}

// The tray overlay: whether it's on, and every open session's mochi to peek over the taskbar.
let overlaySent = '';
function sendOverlaySettings() {
  const mochis = [...tabs.values()]
    .filter((t) => t.plot.live)
    .map(({ tab, plot: p }) => ({ tab, flavour: p.flavour, activity: p.activity, bubble: p.bubble, outfit: outfitOf(p), title: p.name ? `${p.name} · ${p.title || 'new session'}` : p.title }));
  const msg = JSON.stringify({ enabled: Tray.on, mochis });
  if (msg === overlaySent) return;
  overlaySent = msg;
  window.__TAURI__.event.emitTo('overlay', 'overlay-settings', JSON.parse(msg)).catch(() => {});
}
const Tray = { on: pref('mg.tray', true) };
// [ quality ]: the garden at the display's full refresh rate instead of 30/15 fps (garden.js).
const Quality = { on: pref('mg.quality', false) };

// New tokens go into the mochi's bank, which garden.js pays out as seeds over the next few
// seconds. The first read of a transcript (a resumed session's whole history) only sets the total.
// `total` is the main transcript's count; subagents' tokens are added on top (helpers.js).
function applyTokens(p, total, first) {
  const main = p.mainTokens || 0;
  if (!first && total > main) {
    p.bank = (p.bank || 0) + (total - main);
    noteWeekTokens(p, total - main);
  }
  p.mainTokens = Math.max(main, total);
  p.tokens = p.mainTokens + (p.agentTokens || 0);
}

function onTokens(ev) {
  const t = tabs.get(ev.tab);
  if (!t) return;
  // the first read of a session just adopted (followSession) sets its total without a seed burst
  applyTokens(t.plot, ev.tokens, !!t.plot.adopting);
  t.plot.adopting = false;
  if (ev.title) t.plot.title = ev.title;
  save();
}

// Sounds: tiny synthesized chimes (rewards.js), no audio files.
function chime(kind) {
  if (!Sound.on) return;
  const notes = kind === 'done' ? [880, 1318.5] : [987.8, 783.99, 987.8];
  notes.forEach((f, i) => tone(f, i * 0.11, { gain: 0.07, dur: 0.35 }));
}

// Session list ---------------------------------------------------------------------------------

function statusOf(p) {
  if (!p.live) return ['ended', ''];
  if (p.bubble === '?') return ['needs you', 'asking'];
  if (p.bubble === '!') return ['done', 'done'];
  const helpers = (p.helpers || []).length;
  if (p.activity === 'working' || helpers) return [(p.built ? 'working' : 'building') + (helpers ? ` +${helpers}` : ''), 'working'];
  if (p.activity === 'arriving') return ['new', ''];
  return ['idle', ''];
}

function renderList() {
  const list = $('#list');
  list.textContent = '';
  for (const t of tabs.values()) {
    const p = t.plot;
    const li = document.createElement('li');
    li.classList.toggle('active', t.tab === activeTab);
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

// Wiring ----------------------------------------------------------------------------------------

// Dev runs: watch the terminal's output, answer the folder-trust dialog if it shows, and type
// the test prompt once Claude's input box is up and output has gone quiet.
const devWatch = new Map(); // tab -> { text, onText }
function devTypePrompt(tab, prompt) {
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
function demoGarden(only) {
  Usage.demo = true; // fake usage below must not overwrite the real remembered numbers
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
    const p = { id: uuid(), sessionId: null, flavour, title, tokens, built: true, live: activity !== 'sleep', activity, bubble, seed: Math.random() * 6, pieces: [] };
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
    window.__TAURI__.event.emitTo('overlay', 'tokens', { tab: 'demo', delta: 1200 }).catch(() => {});
  }, 400);
}

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
    window.__TAURI__.event.emitTo('overlay', 'main-focus', f).catch(() => {});
  }, 500);
  setInterval(() => {
    if (Garden.dirty) {
      Garden.dirty = false;
      save();
    }
  }, 5000);
  window.addEventListener('keydown', onAppShortcut, true);
  window.addEventListener('focus', markSeen);
  new ResizeObserver(() => tabs.get(activeTab)?.fit.fit()).observe($('#terms'));

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
  await listen('overlay-ready', () => ((overlaySent = ''), sendOverlaySettings()));
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
    if (dev.prompt) devTypePrompt(activeTab, dev.prompt);
  }
}

main();
