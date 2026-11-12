// The usage bars: which limits show, from what Claude Code's status line and the app's live check
// report, and which reports count.
//   npm test
import './setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { Usage, onUsage, onLiveUsage, current, models, resetHeld, lastHeard, usageBarHtml } = await import('../ui/usage.js');
const later = Date.now() / 1000 + 3600;
const five_hour = { used_percentage: 40, resets_at: later }, seven_day = { used_percentage: 16, resets_at: later * 2 };

function fresh() {
  for (const k of ['five', 'week', 'models', 'reset']) delete Usage[k];
  lastHeard.clear();
}

test('before any report, both bars wait', () => {
  fresh();
  const html = usageBarHtml();
  assert.match(html, /5h —/);
  assert.match(html, /week —/);
});

test('a plan with both limits shows both', () => {
  onUsage({ five_hour, seven_day }, 0);
  const html = usageBarHtml();
  assert.match(html, />5h<\/span><span class="track"/);
  assert.match(html, />week<\/span><span class="track"/);
});

test('a report of the week alone means no 5-hour limit: its bar goes, remembered numbers too', () => {
  onUsage({ five_hour, seven_day }, 0);
  onUsage({ seven_day }, 1);
  assert.equal(current('five'), null);
  const html = usageBarHtml();
  assert.doesNotMatch(html, /5h/);
  assert.match(html, />week<\/span><span class="track"/);
});

test('a report with no limits at all changes nothing', () => {
  onUsage({ five_hour, seven_day }, 0);
  onUsage({}, 1);
  assert.equal(current('five').used, 40);
});

test('a tab repeating its old numbers does not undo a fresher tab', () => {
  fresh();
  const week = (used) => ({ seven_day: { used_percentage: used, resets_at: later * 2 } });
  onUsage(week(40), 0, 'idle'); // nothing known yet: the first word counts
  assert.equal(current('week').used, 40);
  onUsage(week(40), 0, 'busy'); // the busy tab starts out with the same old copy
  onUsage(week(50), 0, 'busy'); // then its own reply brings fresh numbers
  assert.equal(current('week').used, 50);
  // every 15 s both status lines repeat themselves: the idle one's 40 must not come back
  for (let i = 0; i < 4; i++) {
    onUsage(week(40), 0, 'idle');
    onUsage(week(50), 0, 'busy');
    assert.equal(current('week').used, 50);
  }
  // until the idle tab gets a reply of its own: a change is news again
  onUsage(week(52), 0, 'idle');
  assert.equal(current('week').used, 52);
});

test("a new tab's first report, maybe days old, doesn't override what's known", () => {
  fresh();
  onUsage({ seven_day: { used_percentage: 50, resets_at: later * 2 } }, 0, 'a');
  onUsage({ seven_day: { used_percentage: 12, resets_at: later * 2 } }, 0, 'new');
  assert.equal(current('week').used, 50);
});

test('a report of a window that has already ended is ignored', () => {
  fresh();
  onUsage({ seven_day: { used_percentage: 50, resets_at: later * 2 } }, 0, 'a');
  onUsage({ seven_day: { used_percentage: 10, resets_at: later * 2 } }, 0, 'b');
  onUsage({ seven_day: { used_percentage: 90, resets_at: Date.now() / 1000 - 60 } }, 0, 'b');
  assert.equal(current('week').used, 50);
});

const iso = (s) => new Date(s * 1000).toISOString();
const liveReport = (week, fable) => ({
  rate_limits: { five_hour: null, seven_day: { utilization: week, resets_at: iso(later * 2) }, model_scoped: [{ display_name: 'Fable', utilization: fable, resets_at: iso(later * 2) }] },
  reset: { held: true, checkedAt: Date.now() - 3600e3, validUntil: Date.now() + 86400e3 },
});

test('the live check always counts, and brings the Fable bar', () => {
  fresh();
  onUsage({ seven_day: { used_percentage: 40, resets_at: later * 2 } }, 0, 'stale');
  onLiveUsage(liveReport(50, 97), 0);
  assert.equal(current('week').used, 50);
  assert.equal(current('five'), null); // this plan has no 5-hour window
  assert.equal(models()[0].name, 'Fable');
  assert.equal(models()[0].used, 97);
  // the stale tab repeating itself still doesn't count
  onUsage({ seven_day: { used_percentage: 40, resets_at: later * 2 } }, 0, 'stale');
  assert.equal(current('week').used, 50);
  const html = usageBarHtml();
  assert.match(html, />fable<\/span><span class="track"><span class="fill" style="width:3%/);
  assert.match(html, /weekly Fable limit/);
});

test('an unused reset shows while Claude Code\'s check of it is fresh', () => {
  fresh();
  onLiveUsage(liveReport(50, 97), 0);
  assert.equal(resetHeld(), true);
  assert.match(usageBarHtml(), /reset ready/);
  assert.equal(resetHeld(Date.now() + 2 * 86400e3), false); // past validUntil
  Usage.reset = { held: false, checkedAt: Date.now(), validUntil: Date.now() + 86400e3 };
  assert.doesNotMatch(usageBarHtml(), /reset ready/);
  Usage.reset = { held: true, checkedAt: Date.now() - 4 * 86400e3, validUntil: Date.now() + 86400e3 };
  assert.equal(resetHeld(), false); // checked too long ago to trust
});

test('a live check that fails sends nothing and changes nothing', () => {
  fresh();
  onLiveUsage(liveReport(50, 97), 0);
  onLiveUsage(null, 0);
  assert.equal(current('week').used, 50);
});
