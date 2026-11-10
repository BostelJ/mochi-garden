// The usage bars: which limits show, from what Claude Code's status line reports.
//   npm test
import './setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { Usage, onUsage, current, usageBarHtml } = await import('../ui/usage.js');
const later = Date.now() / 1000 + 3600;
const five_hour = { used_percentage: 40, resets_at: later }, seven_day = { used_percentage: 16, resets_at: later * 2 };

test('before any report, both bars wait', () => {
  delete Usage.five;
  delete Usage.week;
  const html = usageBarHtml();
  assert.match(html, /5h —/);
  assert.match(html, /week —/);
});

test('a plan with both limits shows both', () => {
  onUsage({ five_hour, seven_day }, 0);
  const html = usageBarHtml();
  assert.match(html, /5h<span/);
  assert.match(html, /week<span/);
});

test('a report of the week alone means no 5-hour limit: its bar goes, remembered numbers too', () => {
  onUsage({ five_hour, seven_day }, 0);
  onUsage({ seven_day }, 1);
  assert.equal(current('five'), null);
  const html = usageBarHtml();
  assert.doesNotMatch(html, /5h/);
  assert.match(html, /week<span/);
});

test('a report with no limits at all changes nothing', () => {
  onUsage({ five_hour, seven_day }, 0);
  onUsage({}, 1);
  assert.equal(current('five').used, 40);
});
