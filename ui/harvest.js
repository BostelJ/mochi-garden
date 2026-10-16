// The weekly harvest: the garden keeps a tally for the current weekly-limit window (tokens grown,
// sessions tended, crops ripened, which mochi worked hardest). When the week turns over, every
// mochi hops, spring petals fly, and a little summary card shows how the week went.

// Which week this is: the weekly limit's reset time when known, otherwise the calendar week.
function weekKey() {
  const w = Usage.week;
  if (w?.resetsAt && Date.now() / 1000 < w.resetsAt) return 'r' + Math.round(w.resetsAt / 3600); // to the hour
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
  return 'c' + d.toISOString().slice(0, 10);
}

function weekStats() {
  if (!Garden.week) Garden.week = { key: weekKey(), tokens: 0, ripe: 0, per: {}, sessions: [] };
  return Garden.week;
}

function noteWeekTokens(p, n) {
  if (!n || Usage.demo) return;
  const w = weekStats();
  w.tokens += n;
  w.per[p.id] = (w.per[p.id] || 0) + n;
  if (!w.sessions.includes(p.id)) w.sessions.push(p.id);
  Garden.dirty = true;
}

function noteRipe() {
  if (Usage.demo) return;
  weekStats().ripe++;
  Garden.dirty = true;
}

// Checked every so often: has the week turned over since the tally started?
function checkHarvest() {
  const w = weekStats();
  const key = weekKey();
  if (w.key === key) return;
  // Switching between calendar and limit-window keys (usage numbers just arrived) is not a new week.
  if (w.key[0] !== key[0]) {
    w.key = key;
    return;
  }
  Garden.week = { key, tokens: 0, ripe: 0, per: {}, sessions: [] };
  Garden.dirty = true;
  if (w.tokens > 0) showHarvest(w);
}

function showHarvest(w) {
  const t = performance.now() / 1000;
  Garden.partyAt = t; // every mochi hops (garden.js)
  Usage.springAt = t; // and spring petals fly (sky.js)
  const best = Object.entries(w.per).sort((a, b) => b[1] - a[1])[0];
  const bestPlot = best && (Garden.allPlots || Garden.plots).find((p) => p.id === best[0]);
  const lines = [
    `${fmtTokens(w.tokens)} grown`,
    `${w.sessions.length} session${w.sessions.length === 1 ? '' : 's'} tended`,
    `${w.ripe} crop${w.ripe === 1 ? '' : 's'} ripened`,
  ];
  if (bestPlot) {
    const row = document.createElement('span');
    const face = document.createElement('canvas');
    face.width = 13;
    face.height = 11;
    face.className = 'face';
    face.getContext('2d').drawImage(mochiSprite(bestPlot.flavour, 'idle'), 0, 0);
    row.append(face, ` hardest worker: ${bestPlot.name || bestPlot.title || 'a mochi'} (${fmtTokens(best[1])})`);
    lines.push(row);
  }
  harvestChime();
  showModal({ title: 'the week\'s harvest', lines, buttons: [['ok', 'lovely']] });
}

function harvestChime() {
  if (!Sound.on) return;
  [523.25, 659.25, 783.99, 1046.5, 1318.5, 1568].forEach((f, i) => tone(f, i * 0.09, { gain: 0.045, dur: 0.4, type: 'triangle' }));
}
