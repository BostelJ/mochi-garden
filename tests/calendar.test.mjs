// The day calendar under the garden path: hours become local days, squares by week, greens by quartile.
//   npm test
import './setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { localDays, grid, levels, short, total, dayKey, calendarHtml, onDays, WEEKS } = await import('../ui/calendar.js');

test('UTC hours land in the local day they fall in, summed per model family', () => {
  const at = new Date(2026, 10, 11, 23, 0); // 11pm local on Nov 11
  const h = at.toISOString().slice(0, 13);
  const next = new Date(2026, 10, 12, 1, 0).toISOString().slice(0, 13);
  const days = localDays({ [h]: { fable: 10, opus: 5 }, [next]: { fable: 1 } });
  assert.deepEqual(days.get('2026-11-11'), { fable: 10, opus: 5 });
  assert.deepEqual(days.get('2026-11-12'), { fable: 1 });
  assert.equal(total(days.get('2026-11-11')), 15);
});

test('the grid is whole weeks from a Sunday, ending in the week of today', () => {
  const now = new Date(2026, 10, 11, 12); // a Wednesday
  const cells = grid(now);
  assert.equal(cells.length, WEEKS * 7);
  assert.equal(cells[0].date.getDay(), 0);
  const today = cells.findIndex((c) => c.key === dayKey(now));
  assert.equal(today, cells.length - 7 + 3);
  assert.ok(cells.slice(today + 1).every((c) => c.future));
  assert.ok(cells.slice(0, today + 1).every((c) => !c.future));
});

test('greens go by quartile of the days that had anything', () => {
  const level = levels([0, 0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(level(0), 0);
  assert.equal(level(1), 1);
  assert.equal(level(8), 4);
  assert.equal(levels([0, 0])(0), 0);
});

test('token counts read short', () => {
  assert.equal(short(950), '950');
  assert.equal(short(12_400), '12k');
  assert.equal(short(3_200_000), '3.2M');
  assert.equal(short(2_000_000_000), '2B');
});

test('the calendar says it is counting until the first record arrives, then draws the days', () => {
  assert.match(calendarHtml(), /counting/);
  const now = new Date();
  onDays({ [new Date(now.getTime() - 3600e3).toISOString().slice(0, 13)]: { fable: 2_500_000 } });
  const html = calendarHtml(now);
  assert.match(html, /today/);
  assert.equal((html.match(/<i /g) || []).length + (html.match(/<i>/g) || []).length, WEEKS * 7);
});
