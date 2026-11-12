// Your Claude usage, read from Claude Code's status line (rate_limits) and the app's own live
// check (usage.rs), and remembered across launches. The garden shows it as sky (sky.js): the
// 5-hour window is the time of day, the week is the season. The side panel shows the exact numbers
// as smooth bars: 5-hour, week, and each per-model weekly window (Fable's), plus a mark when
// Claude Code says you hold an unused limit reset. A plan with no 5-hour limit has only the week:
// no 5-hour bar, and the sky stays a calm late morning.

import { fiveColour, seasonColour } from './sky.js';

export const Usage = loadUsage();

export function loadUsage() {
  try {
    return JSON.parse(localStorage.getItem('mg.usage')) || {};
  } catch {
    return {};
  }
}

function remember() {
  if (Usage.demo) return;
  try {
    localStorage.setItem('mg.usage', JSON.stringify({ five: Usage.five, week: Usage.week, models: Usage.models, reset: Usage.reset }));
  } catch {}
}

// What each tab's status line said last, per window. A tab's numbers are what its own claude
// heard on its last reply, and the status line repeats them every 15 s, so a tab left alone keeps
// reporting old numbers between the fresh ones of the tab you're using. Only a change is news.
/** @type {Map<string, Record<string, string>>} */
export const lastHeard = new Map();

// rate_limits: { five_hour: { used_percentage, resets_at }, seven_day: {...} }. A plan with no
// 5-hour limit reports the week alone: the 5-hour window remembered from before is then forgotten.
// `tab` is the tab whose status line it came from (none: take it as it is, e.g. the demo).
/** @param {any} limits @param {number} t @param {string} [tab] */
export function onUsage(limits, t, tab) {
  const has = (key) => limits[key]?.used_percentage != null;
  if (has('seven_day') && !has('five_hour')) delete Usage.five;
  const heard = tab == null ? null : lastHeard.get(tab) || {};
  if (tab != null && heard) lastHeard.set(tab, heard);
  const now = Date.now() / 1000;
  for (const [key, name] of [['five_hour', 'five'], ['seven_day', 'week']]) {
    const w = limits[key];
    if (!w || w.used_percentage == null) continue;
    if (heard) {
      const said = `${w.used_percentage}@${w.resets_at}`;
      const before = heard[name];
      heard[name] = said;
      if (w.resets_at && w.resets_at < now) continue; // a window that's already over
      const known = current(name);
      // A tab's first report may be days old (a new claude starts from a cached copy): it only
      // counts when nothing better is known.
      if (known && !known.lapsed && (before === undefined || before === said)) continue;
    }
    take(name, w.used_percentage, w.resets_at, t);
  }
  remember();
  renderUsageBar();
}

function take(name, used, resetsAt, t) {
  const before = current(name);
  Usage[name] = { used, resetsAt };
  // A big jump back up is a new window: celebrate it.
  if (before && before.used - used > 25) refill(name, t);
}

// The app's live check (usage.rs): the server's numbers right now, so they always count, and the
// per-model windows the status line doesn't carry. Times arrive as ISO strings.
/** @param {any} live @param {number} t */
export function onLiveUsage(live, t) {
  if (!live) return;
  const r = live.rate_limits || {};
  const secs = (iso) => (iso ? Math.round(Date.parse(iso) / 1000) || null : null);
  if (r.seven_day?.utilization != null && r.five_hour?.utilization == null) delete Usage.five;
  for (const [key, name] of [['five_hour', 'five'], ['seven_day', 'week']]) {
    const w = r[key];
    if (w?.utilization != null) take(name, w.utilization, secs(w.resets_at), t);
  }
  if (Array.isArray(r.model_scoped)) {
    Usage.models = r.model_scoped
      .filter((m) => m?.display_name && m.utilization != null)
      .map((m) => ({ name: String(m.display_name), used: m.utilization, resetsAt: secs(m.resets_at) }));
  }
  if (live.reset !== undefined) Usage.reset = live.reset;
  remember();
  renderUsageBar();
}

// The window as of now: once its reset time passes it's full again (until the next report).
/** @param {string} name */
export function current(name) {
  return asOfNow(Usage[name]);
}

function asOfNow(w) {
  if (!w) return null;
  if (w.resetsAt && Date.now() / 1000 > w.resetsAt) return { ...w, used: 0, resetsAt: null, lapsed: true };
  return w;
}

/** @param {string} name */
export function left(name) {
  return leftOf(current(name));
}

function leftOf(w) {
  return w ? Math.max(0, Math.min(1, 1 - w.used / 100)) : 1;
}

/** The per-model weekly windows as of now (Fable's). */
export function models() {
  return (Usage.models || []).map(asOfNow);
}

// Claude Code re-checks the unused reset at most every three days and trusts its answer until
// `validUntil`; past either, it's not known any more.
export function resetHeld(now = Date.now()) {
  const r = Usage.reset;
  return !!r?.held && now < r.validUntil && now - r.checkedAt < 3 * 86400e3;
}

// A new 5-hour window is a sunrise; a new week is spring.
export function refill(name, t) {
  if (name === 'five') Usage.sunriseAt = t;
  else Usage.springAt = t;
  renderUsageBar();
}

// Noticing resets while the app sits open, even with no session reporting.
export const lapsedSeen = {};
export function checkResets(t) {
  for (const name of ['five', 'week']) {
    const lapsed = !!current(name)?.lapsed;
    if (lapsed && !lapsedSeen[name]) refill(name, t);
    lapsedSeen[name] = lapsed;
  }
}

// The side panel's line: smooth bars of what's left, coloured like the sky they stand for.
export function renderUsageBar() {
  const els = ['usage', 'path-usage'].map((id) => document.getElementById(id)).filter(Boolean);
  if (!els.length) return;
  const html = usageBarHtml();
  for (const el of els) el.innerHTML = html;
}

// A per-model window's bar: a dusky violet, apart from the sky's colours.
export const MODEL_COLOUR = '#a58fd6';

export function usageBarHtml() {
  const when = (w, long) => {
    if (!w?.resetsAt) return '';
    const d = new Date(w.resetsAt * 1000);
    /** @type {Intl.DateTimeFormatOptions} */
    const opts = long ? { hour: 'numeric' } : { hour: 'numeric', minute: '2-digit' }; // the week only needs the day and hour
    const time = d.toLocaleTimeString([], opts).toLowerCase().replace(' ', '');
    return long ? `${d.toLocaleDateString([], { weekday: 'short' })} ${time}` : time;
  };
  const bar = (w, label, colour, what, long) => {
    const pct = Math.round(leftOf(w) * 100);
    const resets = when(w, long);
    return (
      `<span class="u" title="${pct}% of your ${what} left${resets ? ', refills ' + resets : ''}">` +
      `<span class="k">${label}</span><span class="track"><span class="fill" style="width:${pct}%;background:${colour}"></span></span>` +
      `${pct}%<span class="when">${resets}</span></span>`
    );
  };
  const part = (name, label, colour) => {
    const w = current(name);
    if (!w) return `<span class="u none" title="Shows up after a session's first reply">${label} —</span>`;
    return bar(w, label, colour, name === 'five' ? '5-hour limit' : 'weekly limit', name === 'week');
  };
  // Only the week known: a plan with no 5-hour limit, so no 5-hour bar.
  const five = current('five') || !current('week') ? part('five', '5h', fiveColour()) : '';
  const each = models()
    .map((m) => bar(m, esc(m.name.toLowerCase()), MODEL_COLOUR, `weekly ${esc(m.name)} limit`, true))
    .join('');
  const reset = resetHeld()
    ? `<span class="u reset" title="Claude Code says you have an unused limit reset (checked ${new Date(Usage.reset.checkedAt).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}). It's offered when you reach a limit.">↺ reset ready</span>`
    : '';
  return five + part('week', 'week', seasonColour()) + each + reset;
}

/** @param {string} s */
function esc(s) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] || c);
}
