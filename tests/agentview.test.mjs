// A helper's conversation, as lines to show (terminal only's helper view).
//   npm test
import './setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { linesOf } = await import('../ui/agentview.js');

test('its brief, what it said, its tools and what came back', () => {
  const lines = linesOf([
    { type: 'user', content: 'Find which chart library the app uses.' },
    { type: 'user', content: '<system-reminder>not for showing</system-reminder>' },
    { type: 'assistant', content: [{ type: 'thinking' }, { type: 'text', text: 'Looking at package.json.' }, { type: 'tool_use', name: 'Read', input: { file_path: '/app/package.json' } }] },
    { type: 'user', content: [{ type: 'tool_result', content: { text: '{\n  "name": "app",\n  "deps": 1\n}', lines: 40, more: true } }] },
    { type: 'assistant', content: [{ type: 'tool_use', name: 'mcp__garden__build', input: {} }] },
    { type: 'user', content: [{ type: 'tool_result', is_error: true, content: { text: 'no coins', lines: 1 } }] },
  ], true);
  assert.deepEqual(lines.map((l) => l.k), ['prompt', 'say', 'tool', 'result', 'tool', 'error']);
  assert.equal(lines[2].text, 'Read(/app/package.json)');
  assert.equal(lines[3].text, '{\n  "name": "app",\n  "deps": 1\n… +37 lines');
  assert.equal(lines[4].text, 'garden: build()');
});

test('its report reads as a report, without the delivery receipt', () => {
  const lines = linesOf([
    { type: 'assistant', content: [{ type: 'tool_use', name: 'SubagentHandback', input: { message: 'It uses Chart.js 4.' } }] },
    { type: 'user', content: [{ type: 'tool_result', content: { text: '{"success":true}', lines: 1 } }] },
  ], false);
  assert.deepEqual(lines, [{ k: 'report', text: 'It uses Chart.js 4.' }]);
});

test('a long brief is cut to its first lines', () => {
  const brief = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n');
  const [first] = linesOf([{ type: 'user', content: brief }], true);
  assert.equal(first.text.split('\n').length, 9);
  assert.match(first.text, /… \+22 lines$/);
});
