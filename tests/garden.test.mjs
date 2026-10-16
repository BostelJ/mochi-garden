// The garden's rules: coins, building and removing, where gardens go, harvesting and dressing up.
//   npm test
import './setup.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const { Garden, placePlot, returnPlot, WORLD_COLS, WORLD_ROWS } = await import('../ui/garden.js');
const { wallet, landChanged, cropStage, COIN_START, COIN_TOKENS } = await import('../ui/farm.js');
const { buildPieces, removePieces, harvest, dress, nameMochi, receiveGift } = await import('../ui/build.js');
const { PIECES } = await import('../ui/pieces.js');

let n = 0;
/** A fresh plot with some tokens, in the garden: placed where placePlot puts it, or at `at`. */
function plot(tokens = 100_000, at = null) {
  const p = { id: 'p' + ++n, sessionId: 's' + n, flavour: 'matcha', x: null, y: null, title: 'test ' + n, tokens, seed: 1, pieces: [], wild: {}, spent: 0, coins: 1, live: true, built: true };
  Garden.plots.push(p);
  if (at) [p.x, p.y] = at;
  else placePlot(p);
  return p;
}

beforeEach(() => {
  Garden.plots.length = 0;
  Garden.square = null;
});

test('the wallet: a start, then a coin per 100 tokens, less what was spent', () => {
  assert.equal(wallet(plot(0)), COIN_START);
  assert.equal(wallet(plot(100_000)), COIN_START + 100_000 / COIN_TOKENS);
  const p = plot(100_000);
  p.spent = 300;
  assert.equal(wallet(p), COIN_START + 1000 - 300);
});

test('older gardens counted materials (40 coins each) and are converted once', () => {
  const p = plot(100_000);
  delete p.coins;
  p.spent = 5;
  assert.equal(wallet(p), COIN_START + 1000 - 200);
  assert.equal(wallet(p), COIN_START + 1000 - 200, 'not converted twice');
});

test('building spends coins and queues the piece for the mochi', () => {
  const p = plot();
  const before = wallet(p);
  const r = buildPieces(p, [{ piece: 'tree', x: 3, y: 0, variant: 'blossom' }]);
  assert.equal(r.error, false);
  assert.equal(wallet(p), before - PIECES.tree.cost);
  assert.deepEqual(p.pieces.map((pc) => [pc.k, pc.v, pc.b]), [['tree', 'blossom', 0]]);
});

test('building is refused on the desk, out of reach, for unknown pieces and when broke', () => {
  const p = plot(0);
  const r = buildPieces(p, [
    { piece: 'tree', x: 1, y: 1 },
    { piece: 'tree', x: 20, y: 0 },
    { piece: 'spaceship', x: 3, y: 0 },
    { piece: 'shed', x: 3, y: 0 },
  ]);
  assert.equal(r.error, true);
  assert.equal(p.pieces.length, 0);
  assert.match(r.text, /where your desk is/);
  assert.match(r.text, /more than 2 tiles/);
  assert.match(r.text, /no piece called "spaceship"/);
  assert.match(r.text, /costs 1,000 coins/);
});

test('reach grows as a build goes down, so a path can be laid outward in one call', () => {
  const p = plot();
  buildPieces(p, [3, 4, 5, 6, 7, 8].map((x) => ({ piece: 'path', x, y: 1 })));
  assert.equal(p.pieces.length, 6);
});

test('one ground piece and one standing piece per tile', () => {
  const p = plot();
  buildPieces(p, [{ piece: 'path', x: 3, y: 0 }, { piece: 'lantern', x: 3, y: 0 }, { piece: 'flowers', x: 3, y: 0 }]);
  assert.deepEqual(p.pieces.map((pc) => pc.k), ['path', 'lantern']);
});

test('nothing goes within a tile of a neighbour', () => {
  const a = plot(100_000, [20, 20]);
  plot(100_000, [26, 20]); // its desk covers world x 26..28
  assert.equal(buildPieces(a, [{ piece: 'path', x: 4, y: 0 }]).error, false); // world x 24: a tile clear
  assert.match(buildPieces(a, [{ piece: 'path', x: 5, y: 0 }]).text, /too close to a neighbour/); // 25: touching
});

test('removing refunds half of what a built piece cost, and all of an unbuilt one', () => {
  const p = plot();
  buildPieces(p, [{ piece: 'tree', x: 3, y: 0 }, { piece: 'well', x: 4, y: 0 }]);
  const start = wallet(p);
  p.pieces[0].b = 1; // the tree is built, the well isn't yet
  removePieces(p, [{ x: 3, y: 0 }, { x: 4, y: 0 }]);
  assert.equal(wallet(p), start + PIECES.tree.cost / 2 + PIECES.well.cost);
  assert.equal(p.pieces.length, 0);
});

test('the first garden goes in the middle; the next keeps room to grow', () => {
  const a = plot();
  assert.ok(Math.abs(a.x - WORLD_COLS / 2) < 6 && Math.abs(a.y - WORLD_ROWS / 2) < 6);
  const b = plot();
  // gap between the two 3x3 desks, in tiles
  const gap = Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) - 3;
  assert.ok(gap >= 4, `desks at ${a.x},${a.y} and ${b.x},${b.y} are only ${gap} apart`);
});

test('a garden coming back keeps its spot, unless someone moved in', () => {
  const a = plot(100_000, [30, 20]);
  returnPlot(a);
  assert.deepEqual([a.x, a.y], [30, 20]);
  Garden.plots.length = 0;
  plot(100_000, [31, 21]); // moved in while a was away
  Garden.plots.push(a);
  returnPlot(a);
  assert.notDeepEqual([a.x, a.y], [30, 20]);
});

test('a ripe crop can be eaten; an unripe one cannot', () => {
  const p = plot();
  p.pieces.push({ k: 'soil', x: 3, y: 0, b: 1, crop: { k: 'carrot', w: 70 } }, { k: 'soil', x: 4, y: 0, b: 1, crop: { k: 'turnip', w: 3 } });
  landChanged(p);
  assert.match(harvest(p, { x: 3, y: 0, then: 'eat' }).text, /ate the carrot/);
  assert.ok(cropStage(p.pieces[0].crop.w) < 4, 'a new crop starts in the bed');
  assert.match(harvest(p, { x: 4, y: 0, then: 'eat' }).text, /isn't ripe/);
});

test("a gift goes on an errand, and arrives in the neighbour's gifts", () => {
  const a = plot(), b = plot();
  b.name = 'Pip';
  b.m = { x: 0, y: 0, tx: 0, ty: 0, phase: 0, prints: [] };
  a.pieces.push({ k: 'soil', x: 3, y: 0, b: 1, crop: { k: 'strawberry', w: 70 } });
  landChanged(a);
  assert.match(harvest(a, { x: 3, y: 0, then: 'gift', to: 'pip' }).text, /over to Pip/);
  assert.deepEqual(a.errands, [{ kind: 'gift', to: b.id, k: 'strawberry' }]);
  receiveGift(a, b, 'strawberry');
  assert.deepEqual(b.gifts.map((g) => g.k), ['strawberry']);
});

test('dressing up, taking things off, and naming', () => {
  const p = plot();
  dress(p, [{ item: 'wizard hat', colour: 'purple' }, { item: 'jetpack' }], null);
  assert.equal(p.outfit.head.i, 'wizardhat');
  dress(p, null, ['head']);
  assert.equal(p.outfit.head, undefined);
  nameMochi(p, '  A very long name for a tiny mochi  ');
  assert.equal(p.name, 'A very long name for');
  nameMochi(p, '');
  assert.equal(p.name, undefined);
});

test('every piece has a price in whole 40s, a layer and a description', () => {
  for (const [k, d] of Object.entries(PIECES)) {
    assert.ok(d.cost > 0 && d.cost % 40 === 0, `${k}: ${d.cost}`);
    assert.ok(d.layer === 'ground' || d.layer === 'object', k);
    assert.ok(d.desc, k);
  }
});
