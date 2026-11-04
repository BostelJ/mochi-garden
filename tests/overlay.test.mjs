// What the garden tells the tray overlay: each open session's mochi, with its helpers beside it.
//   npm test
import './setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// A stand-in Tauri bridge that keeps what was sent to the overlay (tauri.js reads it on import).
const sent = [];
globalThis.window = { __TAURI__: { core: { invoke: async () => null }, event: { listen: async () => () => {}, emitTo: async (to, ev, payload) => sent.push({ to, ev, payload }) } } };
globalThis.localStorage = { getItem: () => null, setItem: () => {} };

const { tabs } = await import('../ui/state.js');
const { resendOverlay } = await import('../ui/sessions.js');
const { spawnHelper, helperDone } = await import('../ui/helpers.js');

const lastMochis = () => sent.filter((s) => s.to === 'overlay' && s.ev === 'overlay-settings').at(-1).payload.mochis;

test("a session's working helpers go to the overlay beside it, and drop off once they head home", () => {
  const plot = { id: 'p1', flavour: 'ube', live: true, activity: 'working', x: 10, y: 10, m: { x: 100, y: 100 }, title: 'dark mode', pendingAgents: ['check contrast'] };
  tabs.set('t1', { tab: 't1', plot });
  spawnHelper(plot, 'a1', 'Explore', 0);
  spawnHelper(plot, 'a2', 'general-purpose', 0);
  resendOverlay();
  assert.deepEqual(lastMochis()[0].helpers, [{ id: 'a1', label: 'check contrast' }, { id: 'a2', label: 'general-purpose' }]);
  helperDone(plot, 'a1', 500, 1);
  resendOverlay();
  assert.deepEqual(lastMochis()[0].helpers, [{ id: 'a2', label: 'general-purpose' }]);
  tabs.clear();
});
