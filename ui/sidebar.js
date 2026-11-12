// Terminal only's garden path: with the garden out of sight, the sessions line up down the left,
// grouped by the project they work in. Each project is a little sprout pot in its own colour
// (with its git branch); its sessions hang off a vine below it, each one its mochi's face: hopping
// while it works, a "?" when it needs you, a "!" when it's done, asleep once it has ended, with a
// line for what it's doing right now. A session's subagents hang off it as its tiny helpers.
// Above the terminal, a bar says which session you're in and where.

import { AgentView, closeAgent, openAgent } from './agentview.js';
import { renderCalendar } from './calendar.js';
import { closeTab, newSession, select, statusOf, toggleTerminalOnly } from './sessions.js';
import { FLAVOURS, FLAVOUR_ORDER, OUTLINE, gridCanvas, miniSprite, mochiSprite } from './sprites.js';
import { $, tabs, ui } from './state.js';
import { invoke } from './tauri.js';

// What a session is doing, in a few words, from the tool it's about to use (hooks: PreToolUse).
export function doingOf(name, input) {
  input = input || {};
  const base = (s) => String(s || '').split(/[\\/]/).pop();
  const one = (s, n = 70) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
  switch (name) {
    case 'Bash':
      return input.description ? one(input.description) : '$ ' + one(input.command);
    case 'Read':
      return 'reading ' + base(input.file_path);
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
      return 'writing ' + base(input.file_path);
    case 'NotebookEdit':
      return 'writing ' + base(input.notebook_path);
    case 'Grep':
      return 'searching for ' + one(input.pattern, 40);
    case 'Glob':
      return 'looking for ' + one(input.pattern, 40);
    case 'WebSearch':
      return 'searching the web';
    case 'WebFetch':
      return 'reading the web';
    case 'Agent':
    case 'Task':
      return 'sending out a helper';
    case 'TodoWrite':
      return 'writing a to-do list';
    case 'AskUserQuestion':
      return 'has a question for you';
  }
  if (!name) return 'thinking…';
  if (name.startsWith('mcp__garden__')) return 'tending its garden';
  if (name.startsWith('mcp__')) return 'using ' + (name.split('__')[1] || name).replace(/[_-]/g, ' ');
  return 'using ' + name;
}

// A folder as a project's name: its last part (a home folder is "~").
export function projectName(cwd) {
  if (!cwd) return '~';
  const parts = String(cwd).split(/[\\/]+/).filter(Boolean);
  const home = /^(\/Users|\/home|[A-Za-z]:[\\/]Users)[\\/][^\\/]+[\\/]?$/.test(cwd);
  return home || !parts.length ? '~' : parts[parts.length - 1];
}

// A folder shortened for showing: the home folder as "~".
export function shortPath(cwd) {
  if (!cwd) return '~';
  return String(cwd).replace(/^(\/Users|\/home)\/[^/]+/, '~').replace(/^[A-Za-z]:\\Users\\[^\\]+/, '~');
}

// The open tabs by project, in the order each project first appears.
/** @param {Iterable<Tab>} list */
export function groupTabs(list) {
  /** @type {Map<string, { key: string, name: string, tabs: Tab[] }>} */
  const groups = new Map();
  for (const t of list) {
    const key = t.plot.cwd || '';
    if (!groups.has(key)) groups.set(key, { key, name: projectName(key), tabs: [] });
    groups.get(key).tabs.push(t);
  }
  return [...groups.values()];
}

// How long ago, in the fewest characters: now, 4m, 2h, 3d.
export function ago(ms) {
  const s = Math.max(0, ms) / 1000;
  if (s < 60) return 'now';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  if (s < 86400) return Math.floor(s / 3600) + 'h';
  return Math.floor(s / 86400) + 'd';
}

// A project's colour: one of the mochi flavours, the same one every time for the same name.
export function projectFlavour(name) {
  let h = 0;
  for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return FLAVOUR_ORDER[h % FLAVOUR_ORDER.length];
}

// A sprout in a little pot, the pot in the project's colour.
export const POT = [
  '..LL...LL..',
  '.LlLL.LLlL.',
  '..LLLsLLL..',
  '.....s.....',
  '.ooooooooo.',
  'oBBBBBBBBBo',
  '.oBBBBBBBo.',
  '.oBBBBBBso.',
  '..ossssso..',
  '...ooooo...',
];
const potCache = new Map();
export function potSprite(flavour) {
  if (potCache.has(flavour)) return potCache.get(flavour);
  const f = FLAVOURS[flavour] || FLAVOURS.matcha;
  const c = gridCanvas(POT, (ch) => ({ L: '#7fb069', l: '#b6dc8f', s: f.s, o: OUTLINE, B: f.b })[ch]);
  // 's' is the pot's shade; the two above the pot are the sprout's stem, which is green
  const g = c.getContext('2d');
  g.fillStyle = '#5e8f4a';
  g.fillRect(5, 2, 1, 2);
  potCache.set(flavour, c);
  return c;
}

// A strip of grass along the bottom of the path, with a few flowers in the mochi flavours.
let grassStrip = null;
export function grassSprite() {
  if (grassStrip) return grassStrip;
  const W = 160, H = 9;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  let r = 7;
  const rnd = () => ((r = (r * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  g.fillStyle = '#4f7a3a';
  g.fillRect(0, 5, W, 4);
  g.fillStyle = '#3f6630';
  g.fillRect(0, 8, W, 1);
  for (let x = 0; x < W; x++) {
    const h = rnd() < 0.5 ? 1 : rnd() < 0.6 ? 2 : 3;
    g.fillStyle = rnd() < 0.5 ? '#6f9e55' : '#5f8f49';
    g.fillRect(x, 5 - h, 1, h);
  }
  for (let x = 4; x < W - 3; x += 9 + Math.floor(rnd() * 14)) {
    const f = FLAVOURS[FLAVOUR_ORDER[Math.floor(rnd() * FLAVOUR_ORDER.length)]];
    g.fillStyle = f.b;
    g.fillRect(x, 1, 1, 1);
    g.fillRect(x - 1, 2, 3, 1);
    g.fillRect(x, 3, 1, 1);
    g.fillStyle = '#fff3c4';
    g.fillRect(x, 2, 1, 1);
  }
  grassStrip = c;
  return c;
}

// Git branches, read from each project's .git (lib.rs git_branch) and refreshed now and then.
/** @type {Map<string, { name: string | null, at: number }>} */
const branches = new Map();
function branchOf(cwd) {
  if (!cwd) return null;
  const b = branches.get(cwd);
  if (!b || Date.now() - b.at > 20000) {
    const was = b ? b.name : null;
    branches.set(cwd, { name: was, at: Date.now() });
    invoke('git_branch', { cwd })
      .then((name) => {
        name = name || null;
        const e = branches.get(cwd);
        if (e) e.name = name;
        if (name !== was) renderPath();
      })
      .catch(() => {});
  }
  return b ? b.name : null;
}

// Projects folded shut, remembered across launches.
const folded = new Set(loadFolded());
function loadFolded() {
  try {
    return JSON.parse(localStorage.getItem('mg.folded') || '[]');
  } catch {
    return [];
  }
}
function toggleFold(key) {
  if (folded.has(key)) folded.delete(key);
  else folded.add(key);
  try {
    localStorage.setItem('mg.folded', JSON.stringify([...folded]));
  } catch {}
  renderPath();
}

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

function spriteCanvas(src, w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d').drawImage(src, 0, 0);
  return c;
}

// The faces keep hopping in step through a redraw (the list is rebuilt on every hook): each
// animation starts as far into its loop as the clock says.
const PERIODS = { working: 640, asking: 900, idle: 4200 };
function inStep(node, kind) {
  const ms = PERIODS[kind];
  if (ms) node.style.animationDelay = `-${Math.round(performance.now() % ms)}ms`;
}

/** @param {Plot} p */
function faceOf(p, kind) {
  const wrap = el('span', 'face');
  const asleep = !p.live || p.activity === 'sleep';
  const c = spriteCanvas(mochiSprite(p.flavour, asleep ? 'sleep' : 'idle'), 13, 11);
  inStep(c, kind === 'done' ? '' : kind);
  wrap.appendChild(c);
  if (p.bubble) {
    const b = el('i', 'bub', p.bubble);
    inStep(b, 'asking');
    wrap.appendChild(b);
  }
  return wrap;
}

// working, asking, done, idle or ended
/** @param {Plot} p */
export function kindOf(p) {
  const [label, cls] = statusOf(p);
  return cls || (label === 'ended' ? 'ended' : 'idle');
}

// What to say under a session's title, if anything.
/** @param {Plot} p */
function lineOf(p, kind) {
  if (kind === 'asking') {
    const q = p.pending;
    if (q?.kind === 'ask') return q.question;
    if (q?.kind === 'perm') return `may it ${q.tool === 'Bash' ? 'run' : 'use'}: ${q.detail || q.tool}?`;
    return 'needs you';
  }
  if (kind === 'working') return p.doing || 'thinking…';
  if (kind === 'done') return 'done! have a look';
  return null;
}

/** @param {Tab} t */
function sessionNode(t, last) {
  const p = t.plot;
  const kind = kindOf(p);
  const li = el('li', 'node' + (last ? ' last' : ''));
  li.appendChild(el('i', 'leaf'));
  const row = el('div', `sess ${kind}` + (t.tab === ui.activeTab && !AgentView ? ' active' : ''));
  row.style.setProperty('--fl', (FLAVOURS[p.flavour] || FLAVOURS.terracotta).b);
  row.appendChild(faceOf(p, kind));
  row.appendChild(el('span', 't', p.name ? `${p.name} · ${p.title || 'new session'}` : p.title || 'new session'));
  const meta = el('span', 'meta');
  // the face and the line under the title say how it's doing; here, just since when
  const since = kind === 'working' || kind === 'asking' ? 0 : Date.now() - (p.lastStop || p.lastEvent || t.started);
  const age = el('span', 'ago', ago(since));
  age.title = { working: 'working', asking: 'needs you', done: 'done', ended: 'ended' }[kind] || 'idle';
  meta.appendChild(age);
  const x = el('button', 'x', '×');
  x.title = 'End this session (its mochi packs up; resume the session to bring it back)';
  x.onclick = (e) => {
    e.stopPropagation();
    closeTab(t.tab);
  };
  meta.appendChild(x);
  row.appendChild(meta);
  const line = lineOf(p, kind);
  if (line) row.appendChild(el('span', 'doing', line));
  row.title = [p.title, shortPath(p.cwd)].filter(Boolean).join('\n');
  row.onclick = () => select(t.tab);
  li.appendChild(row);

  // its helpers: the ones still out working, then the ones finished since the last prompt
  const out = (p.helpers || []).filter((h) => h.state !== 'returning' && h.state !== 'gone');
  const back = (p.doneHelpers || []).filter((d) => !out.some((h) => h.id === d.id)).map((d) => ({ ...d, done: true }));
  /** @type {{ id: string, label: string, done?: boolean, doing?: string }[]} */
  const helpers = [...out, ...back];
  if (helpers.length) {
    const ul = el('ul', 'vine helpers');
    helpers.forEach((h, i) => {
      const hl = el('li', 'node' + (i === helpers.length - 1 ? ' last' : ''));
      hl.appendChild(el('i', 'leaf'));
      const hr = el('div', 'sess helper ' + (h.done ? 'done' : 'working'));
      const face = el('span', 'face');
      const c = spriteCanvas(miniSprite(p.flavour), 7, 7);
      if (!h.done) inStep(c, 'working');
      face.appendChild(c);
      hr.appendChild(face);
      hr.appendChild(el('span', 't', h.label || 'helper'));
      hr.appendChild(el('span', 'doing', h.done ? 'done · click to read' : h.doing || 'helping out'));
      if (AgentView?.tab === t.tab && AgentView.id === h.id) hr.classList.add('active');
      hr.title = 'Show what this helper is doing (Esc to go back)';
      hr.onclick = () => {
        select(t.tab);
        openAgent(t.tab, h.id);
      };
      hl.appendChild(hr);
      ul.appendChild(hl);
    });
    li.appendChild(ul);
  }
  return li;
}

let built = false;
function build() {
  if (built) return;
  built = true;
  const nav = $('#path');
  const head = el('div', 'head');
  const logo = spriteCanvas(mochiSprite('terracotta', 'idle'), 13, 11);
  logo.className = 'logo';
  head.append(logo, el('b', 'name', 'mochi garden'), el('span', 'n'));
  const tools = el('span', 'tools');
  const add = el('button', 'add', '[+]');
  add.title = 'New Claude Code session (Ctrl+T)';
  add.onclick = () => newSession();
  const back = el('button', 'back', '[garden]');
  back.onclick = () => toggleTerminalOnly();
  tools.append(add, back);
  head.appendChild(tools);
  const groups = el('div', 'groups');
  const grass = spriteCanvas(grassSprite(), 160, 9);
  grass.className = 'grass';
  const foot = el('div', 'foot');
  const cal = el('div', '');
  cal.id = 'path-cal';
  const usage = el('div', '');
  usage.id = 'path-usage';
  foot.append(cal, usage);
  nav.append(head, groups, grass, foot);
  renderCalendar();
}

export function renderPath() {
  const nav = $('#path');
  if (!nav || !nav.appendChild) return;
  build();
  const n = nav.querySelector('.head .n');
  if (n) n.textContent = String(tabs.size);
  const back = nav.querySelector('.head .back');
  if (back) back.title = $('#terminal-only')?.title || 'Back to the garden';
  const box = nav.querySelector('.groups');
  if (!box) return; // no page (the tests)
  box.textContent = '';
  for (const g of groupTabs(tabs.values())) {
    const sec = el('section', 'grp');
    const fl = projectFlavour(g.name);
    sec.style.setProperty('--pf', FLAVOURS[fl].b);
    const h = el('div', 'grp-h');
    const shut = folded.has(g.key);
    h.appendChild(el('span', 'chev', shut ? '▸' : '▾'));
    const pot = spriteCanvas(potSprite(fl), 11, 10);
    h.appendChild(pot);
    h.appendChild(el('span', 'name', g.name));
    const branch = branchOf(g.key);
    if (branch) h.appendChild(el('span', 'branch', branch));
    const busy = g.tabs.filter((t) => statusOf(t.plot)[1]).length;
    h.appendChild(el('span', 'count', shut ? `${g.tabs.length}${busy ? ' ·' + busy + '!' : ''}` : ''));
    const add = el('button', 'add', '+');
    add.title = `New session in ${shortPath(g.key)}`;
    add.onclick = (e) => {
      e.stopPropagation();
      newSession(null, g.key || undefined);
    };
    h.appendChild(add);
    h.title = shortPath(g.key) + (branch ? ` · ${branch}` : '');
    h.onclick = () => toggleFold(g.key);
    sec.appendChild(h);
    if (!shut) {
      const ul = el('ul', 'vine');
      g.tabs.forEach((t, i) => ul.appendChild(sessionNode(t, i === g.tabs.length - 1)));
      sec.appendChild(ul);
    }
    sec.classList.toggle('shut', shut);
    box.appendChild(sec);
  }
  if (!tabs.size) box.appendChild(el('p', 'none', 'no sessions yet: [ + ] plants one'));
  renderTermBar();
}

// The bar above the terminal: which session, where, and how it's doing.
function renderTermBar() {
  const bar = $('#termbar');
  if (!bar || !bar.appendChild) return;
  bar.textContent = '';
  const t = tabs.get(ui.activeTab);
  if (!t) return;
  const p = t.plot;
  if (AgentView && AgentView.tab === t.tab) return renderHelperBar(bar, t);
  const kind = kindOf(p);
  bar.appendChild(faceOf(p, kind));
  const text = el('span', 'text');
  text.appendChild(el('span', 't', p.name ? `${p.name} · ${p.title || 'new session'}` : p.title || 'new session'));
  const branch = branchOf(p.cwd);
  text.appendChild(el('span', 'where', shortPath(p.cwd) + (branch ? ` · ${branch}` : '')));
  bar.appendChild(text);
  const word = { asking: 'needs you', done: 'done', ended: 'ended', working: 'working' }[kind] || 'idle';
  const chip = el('span', `chip ${kind}`);
  chip.append(el('i', 'dot'), el('span', '', word));
  bar.appendChild(chip);
}

// The bar while a helper's conversation is showing: whose helper, and the way back.
/** @param {HTMLElement} bar @param {Tab} t */
function renderHelperBar(bar, t) {
  const p = t.plot;
  const h = (p.helpers || []).find((x) => x.id === AgentView.id);
  const working = !!h && h.state !== 'returning' && h.state !== 'gone';
  const face = el('span', 'face helper-face' + (working ? ' working' : ''));
  const c = spriteCanvas(miniSprite(p.flavour), 7, 7);
  inStep(c, working ? 'working' : '');
  face.appendChild(c);
  bar.appendChild(face);
  const text = el('span', 'text');
  text.appendChild(el('span', 't', AgentView.label));
  text.appendChild(el('span', 'where', `a helper of ${p.name || p.title || 'new session'} · read-only`));
  bar.appendChild(text);
  const back = el('button', 'back', '[ back ]');
  back.title = 'Back to the session (Esc)';
  back.onclick = () => closeAgent();
  bar.appendChild(back);
  const chip = el('span', `chip ${working ? 'working' : 'done'}`);
  chip.append(el('i', 'dot'), el('span', '', working ? (h.doing || 'working') : 'done'));
  bar.appendChild(chip);
}
