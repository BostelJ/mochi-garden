// Terminal only's sidebar: what a session is doing, and sessions grouped by project.
//   npm test
import './setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { ago, doingOf, groupTabs, projectFlavour, projectName, shortPath } = await import('../ui/sidebar.js');

test('a tool becomes a few words about what the session is doing', () => {
  assert.equal(doingOf('Bash', { command: 'npm   test', description: 'Run the tests' }), 'Run the tests');
  assert.equal(doingOf('Bash', { command: 'npm\n  test' }), '$ npm test');
  assert.equal(doingOf('Read', { file_path: '/a/b/sessions.js' }), 'reading sessions.js');
  assert.equal(doingOf('Edit', { file_path: 'C:\\code\\ui\\style.css' }), 'writing style.css');
  assert.equal(doingOf('Grep', { pattern: 'renderList' }), 'searching for renderList');
  assert.equal(doingOf('mcp__garden__build', {}), 'tending its garden');
  assert.equal(doingOf('mcp__Roblox_Studio__execute_luau', {}), 'using Roblox Studio');
  assert.equal(doingOf(undefined, undefined), 'thinking…');
});

test('projects are named after their folder, a home folder as ~', () => {
  assert.equal(projectName('/Users/josh/code/skyline'), 'skyline');
  assert.equal(projectName('/Users/josh/code/skyline/'), 'skyline');
  assert.equal(projectName('/Users/josh'), '~');
  assert.equal(projectName('C:\\Users\\josh'), '~');
  assert.equal(projectName(null), '~');
  assert.equal(shortPath('/Users/josh/code/skyline'), '~/code/skyline');
});

test('sessions group by folder, in the order each project first appears', () => {
  const tab = (cwd) => ({ plot: { cwd } });
  const groups = groupTabs([tab('/c/a'), tab('/c/b'), tab('/c/a'), tab(null)]);
  assert.deepEqual(groups.map((g) => [g.name, g.tabs.length]), [['a', 2], ['b', 1], ['~', 1]]);
});

test('a project keeps its colour', () => {
  assert.equal(projectFlavour('skyline'), projectFlavour('skyline'));
});

test('ages in the fewest characters', () => {
  assert.equal(ago(5000), 'now');
  assert.equal(ago(4 * 60e3), '4m');
  assert.equal(ago(2 * 3600e3 + 5), '2h');
  assert.equal(ago(3 * 86400e3), '3d');
});
