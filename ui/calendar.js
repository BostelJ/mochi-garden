// A small activity calendar under the garden path, like GitHub's: one square per day for the last
// WEEKS weeks, a column a week (Sunday on top), greener the more tokens that day used. The app
// tallies every transcript per UTC hour and model family (usage.rs) and keeps that record after
// Claude Code deletes old transcripts; here the hours become your local days.

export const WEEKS = 20;

/** @type {{ hours: Record<string, Record<string, number>> | null }} */
export const Days = { hours: null };

/** @param {Record<string, Record<string, number>> | null} hours */
export function onDays(hours) {
  if (!hours) return;
  Days.hours = hours;
  renderCalendar();
}

/** @param {Date} d */
export function dayKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// "2026-11-11T19" (UTC) -> the local day it falls in, summed per family.
/** @param {Record<string, Record<string, number>>} hours */
export function localDays(hours) {
  /** @type {Map<string, Record<string, number>>} */
  const days = new Map();
  for (const [h, fams] of Object.entries(hours || {})) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})$/.exec(h);
    if (!m) continue;
    const key = dayKey(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4])));
    const day = days.get(key) || {};
    for (const [f, n] of Object.entries(fams)) day[f] = (day[f] || 0) + n;
    days.set(key, day);
  }
  return days;
}

/** @param {Record<string, number> | undefined} day */
export const total = (day) => Object.values(day || {}).reduce((a, b) => a + b, 0);

// The squares, oldest first: WEEKS columns of seven, the last column holding today.
export function grid(now = new Date(), weeks = WEEKS) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay() - 7 * (weeks - 1));
  const out = [];
  for (let i = 0; i < weeks * 7; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    out.push({ date: d, key: dayKey(d), future: d > now });
  }
  return out;
}

// How green: 0 for a day with nothing, then 1-4 by quartile of the days that had something.
/** @param {number[]} totals */
export function levels(totals) {
  const busy = totals.filter((n) => n > 0).sort((a, b) => a - b);
  const q = (k) => busy[Math.min(busy.length - 1, Math.floor(busy.length * k))];
  const cuts = busy.length ? [q(0.25), q(0.5), q(0.75)] : [];
  return (/** @type {number} */ n) => (n <= 0 ? 0 : 1 + cuts.filter((c) => n > c).length);
}

/** @param {number} n */
export function short(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return Math.round(n / 1e3) + 'k';
  return String(n);
}

export function calendarHtml(now = new Date()) {
  const days = localDays(Days.hours || {});
  const cells = grid(now);
  const level = levels(cells.map((c) => total(days.get(c.key))));
  const today = dayKey(now);
  const squares = cells
    .map((c) => {
      if (c.future) return '<i class="future"></i>';
      const day = days.get(c.key);
      const n = total(day);
      const label = c.date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
      const split = Object.entries(day || {})
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([f, v]) => `${f} ${short(v)}`)
        .join(' · ');
      const title = n ? `${label}: ${short(n)} tokens\n${split}` : `${label}: nothing`;
      return `<i class="l${level(n)}${c.key === today ? ' today' : ''}" title="${title}"></i>`;
    })
    .join('');
  const caption = Days.hours
    ? `<span>last ${WEEKS} weeks</span><span>today ${short(total(days.get(today)))}</span>`
    : '<span>counting your days…</span>';
  return `<div class="cap">${caption}</div><div class="cal">${squares}</div>`;
}

export function renderCalendar() {
  const el = document.getElementById('path-cal');
  if (!el) return;
  el.innerHTML = calendarHtml();
}
