// Your Claude usage, read from Claude Code's status line (rate_limits) and remembered across
// launches. The garden shows it as sky (sky.js): the 5-hour window is the time of day, the week is
// the season. The side panel shows the exact numbers as two smooth bars.

const Usage = load();

function load() {
  try {
    return JSON.parse(localStorage.getItem('mg.usage')) || {};
  } catch {
    return {};
  }
}

// rate_limits: { five_hour: { used_percentage, resets_at }, seven_day: {...} }
function onUsage(limits, t) {
  for (const [key, name] of [['five_hour', 'five'], ['seven_day', 'week']]) {
    const w = limits[key];
    if (!w || w.used_percentage == null) continue;
    const before = current(name);
    Usage[name] = { used: w.used_percentage, resetsAt: w.resets_at };
    // A big jump back up is a new window: celebrate it.
    if (before && before.used - w.used_percentage > 25) refill(name, t);
  }
  if (!Usage.demo) {
    try {
      localStorage.setItem('mg.usage', JSON.stringify({ five: Usage.five, week: Usage.week }));
    } catch {}
  }
  renderUsageBar();
}

// The window as of now: once its reset time passes it's full again (until the next report).
function current(name) {
  const w = Usage[name];
  if (!w) return null;
  if (w.resetsAt && Date.now() / 1000 > w.resetsAt) return { used: 0, resetsAt: null, lapsed: true };
  return w;
}

function left(name) {
  const w = current(name);
  return w ? Math.max(0, Math.min(1, 1 - w.used / 100)) : 1;
}

// A new 5-hour window is a sunrise; a new week is spring.
function refill(name, t) {
  if (name === 'five') Usage.sunriseAt = t;
  else Usage.springAt = t;
  renderUsageBar();
}

// Noticing resets while the app sits open, even with no session reporting.
const lapsedSeen = {};
function checkResets(t) {
  for (const name of ['five', 'week']) {
    const lapsed = !!current(name)?.lapsed;
    if (lapsed && !lapsedSeen[name]) refill(name, t);
    lapsedSeen[name] = lapsed;
  }
}

// The side panel's line: two smooth bars of what's left, coloured like the sky they stand for.
function renderUsageBar() {
  const el = document.getElementById('usage');
  if (!el) return;
  const when = (w, long) => {
    if (!w?.resetsAt) return '';
    const d = new Date(w.resetsAt * 1000);
    const opts = long ? { hour: 'numeric' } : { hour: 'numeric', minute: '2-digit' }; // the week only needs the day and hour
    const time = d.toLocaleTimeString([], opts).toLowerCase().replace(' ', '');
    return long ? `${d.toLocaleDateString([], { weekday: 'short' })} ${time}` : time;
  };
  const part = (name, label, colour) => {
    const w = current(name);
    if (!w) return `<span class="u none" title="Shows up after a session's first reply">${label} —</span>`;
    const pct = Math.round(left(name) * 100);
    const resets = when(w, name === 'week');
    return (
      `<span class="u" title="${pct}% of your ${name === 'five' ? '5-hour' : 'weekly'} limit left${resets ? ', refills ' + resets : ''}">` +
      `${label}<span class="track"><span class="fill" style="width:${pct}%;background:${colour}"></span></span>` +
      `${pct}%<span class="when">${resets}</span></span>`
    );
  };
  el.innerHTML = part('five', '5h', fiveColour()) + part('week', 'week', seasonColour());
}
