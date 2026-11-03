// The app's keys, which the terminal never sees: anything else has to reach Claude Code.
//   npm test
import './setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { IS_MAC, isAppShortcut } = await import('../ui/terminal.js');

// The app's modifier follows the platform these tests run on: Cmd on a Mac, Ctrl elsewhere.
const mod = IS_MAC ? { metaKey: true } : { ctrlKey: true };
const key = (k, mods = {}) => ({ key: k, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods });

test('the modifier plus Shift+Enter belongs to the app: terminal only', () => {
  assert.equal(isAppShortcut(key('Enter', { ...mod, shiftKey: true })), true);
});

test('every other Enter stays with the terminal', () => {
  assert.equal(isAppShortcut(key('Enter')), false);
  assert.equal(isAppShortcut(key('Enter', { shiftKey: true })), false); // a new line in the prompt
  assert.equal(isAppShortcut(key('Enter', mod)), false);
  assert.equal(isAppShortcut(key('Enter', { ...mod, shiftKey: true, altKey: true })), false);
});
