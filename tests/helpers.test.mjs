// Helpers whose SubagentStop never comes (a subagent that died on an API error) still go home.
//   npm test
import './setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = { __TAURI__: { core: { invoke: async () => null }, event: { listen: async () => () => {}, emitTo: async () => {} } } };
globalThis.localStorage = { getItem: () => null, setItem: () => {} };

const { spawnHelper, helperDone, helperEnded, endedAgents, updateHelpers, HELPER_STALE } = await import('../ui/helpers.js');

const plotOf = () => ({ id: 'p1', x: 10, y: 10, m: { x: 100, y: 100 } });

test('a task notice that an agent stopped names it, and a running one does not', () => {
  const prompt = `<task-notification>
<task-id>ae1c52419f6307710</task-id>
<status>failed</status>
</task-notification>
<task-notification><task-id>abc</task-id><status>completed</status></task-notification>
<task-notification><task-id>still</task-id><status>running</status></task-notification>`;
  assert.deepEqual(endedAgents(prompt), ['ae1c52419f6307710', 'abc']);
  assert.deepEqual(endedAgents('just a prompt'), []);
});

test('a failed notice sends its helper home, and never takes tokens SubagentStop already gave', () => {
  const p = plotOf();
  spawnHelper(p, 'dead', 'general-purpose', 0);
  spawnHelper(p, 'done', 'general-purpose', 0);
  updateHelpers(p, 1, 1);
  helperDone(p, 'done', 500, 2);
  helperEnded(p, 'dead', 3);
  helperEnded(p, 'done', 3);
  assert.equal(p.helpers.find((h) => h.id === 'dead').state, 'returning');
  assert.equal(p.helpers.find((h) => h.id === 'done').tokens, 500);
});

test('a helper silent for longer than HELPER_STALE heads home by itself', () => {
  const p = plotOf();
  spawnHelper(p, 'quiet', 'general-purpose', 0);
  updateHelpers(p, 1, 1);
  updateHelpers(p, 0.016, 60);
  assert.equal(p.helpers[0].state, 'working');
  updateHelpers(p, 0.016, HELPER_STALE + 5);
  assert.equal(p.helpers[0].state, 'returning');
});
