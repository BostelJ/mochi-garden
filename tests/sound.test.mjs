// [ sound ]: some, all, mute, and which sounds each one lets through.
//   npm test
import './setup.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const saved = new Map();
globalThis.localStorage = { getItem: (k) => saved.get(k) ?? null, setItem: (k, v) => saved.set(k, v) };

// Counts the notes played, with no audio behind them.
let notes = 0;
globalThis.AudioContext = class {
  state = 'running';
  currentTime = 0;
  destination = {};
  createOscillator() {
    notes++;
    return { frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (n) => n, start() {}, stop() {} };
  }
  createGain() {
    return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (n) => n };
  }
};

const { Sound, nextSoundMode, soundPref, streakChime } = await import('../ui/rewards.js');
const { chime } = await import('../ui/sessions.js');

const plays = (fn) => {
  notes = 0;
  fn();
  return notes > 0;
};

beforeEach(() => saved.clear());

test('clicking cycles some, all, mute, and each choice is saved', () => {
  Sound.mode = 'some';
  for (const mode of ['all', 'mute', 'some']) {
    nextSoundMode();
    assert.equal(Sound.mode, mode);
    assert.equal(soundPref(), mode);
  }
});

test('all plays everything', () => {
  Sound.mode = 'all';
  for (const kind of ['done', 'ask', 'gift']) assert.equal(plays(() => chime(kind)), true, kind);
  assert.equal(plays(() => streakChime(1)), true);
});

test('some plays only the ding when a session finishes', () => {
  Sound.mode = 'some';
  assert.equal(plays(() => chime('done')), true);
  for (const kind of ['ask', 'gift']) assert.equal(plays(() => chime(kind)), false, kind);
  assert.equal(plays(() => streakChime(1)), false);
});

test('mute plays nothing', () => {
  Sound.mode = 'mute';
  for (const kind of ['done', 'ask', 'gift']) assert.equal(plays(() => chime(kind)), false, kind);
  assert.equal(plays(() => streakChime(1)), false);
});

test('the old on/off setting carries over, and all is the default', () => {
  assert.equal(soundPref(), 'all');
  saved.set('mg.sound', 'on');
  assert.equal(soundPref(), 'all');
  saved.set('mg.sound', 'off');
  assert.equal(soundPref(), 'mute');
});
