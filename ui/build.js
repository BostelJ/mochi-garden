// The garden tools a session can use, if it ever wants to (served by src/mcp.rs as the "garden"
// MCP server; nothing ever asks a session to build). look shows the session its garden as a text
// map; build queues pieces for its mochi to build (farm.js); remove takes them out again; dress
// and name are the mochi's own business (wardrobe.js draws the clothes).
// Gardens grow wherever their session builds: any free grass within REACH of what it already has.

import { COIN_TOKENS, cropStage, landChanged, landIndex, migrateLand, occupancy, pickCrop, pieceDef, pieceTiles, wallet, worldTiles } from './farm.js';
import { GROWTH, Garden, WORLD_COLS, WORLD_ROWS, placePlot } from './garden.js';
import { PIECES } from './pieces.js';
import { renderList } from './sessions.js';
import { FLAVOURS, shadeHex } from './sprites.js';
import { tabs } from './state.js';
import { invoke } from './tauri.js';
import { SQUARE_H, SQUARE_W } from './town.js';
import { WEAR, WEAR_COLOURS, wearColour } from './wardrobe.js';

export const REACH = 2; // tiles from the garden's edge a new piece may go
export const MAX_ITEMS = 40;

// One map letter per piece (lower case for ground, upper for things standing).
export const MAP_CHAR = {
  soil: 's', path: 'p', cobble: 'c', water: 'w', flowers: 'f', clover: 'v',
  bush: 'B', tree: 'T', rock: 'R', mushrooms: 'M', fence: 'F', lantern: 'L', bench: 'N', sign: 'S', birdhouse: 'H',
  scarecrow: 'C', beehive: 'Q', arch: 'A', shed: 'E', pumpkin: 'P', well: 'W', campfire: 'Y', windchime: 'J',
};
export const mapChar = (k) => MAP_CHAR[k] || '?';

export async function onGardenCall({ id, tab, name, args }) {
  let result;
  try {
    const t = tabs.get(tab);
    if (!t) result = { text: 'This session is not in the garden right now.', error: true };
    else {
      const p = t.plot;
      if (p.x == null) placePlot(p);
      if (!p.pieces) migrateLand(p);
      if (name === 'look') result = { text: lookText(p) };
      else if (name === 'build') result = buildPieces(p, args?.items);
      else if (name === 'remove') result = removePieces(p, args?.tiles);
      else if (name === 'dress') result = dress(p, args?.wear, args?.take_off);
      else if (name === 'name') result = nameMochi(p, args?.name);
      else if (name === 'harvest') result = harvest(p, args || {});
      else result = { text: `No tool called ${name}.`, error: true };
    }
  } catch (e) {
    console.error(e);
    result = { text: `Something went wrong in the garden: ${e.message || e}`, error: true };
  }
  invoke('garden_reply', { id, result }).catch(() => {});
}

// Can a piece of kind k go at plot tile (x, y)? Returns null when it can, else why not.
export function whyNot(p, k, x, y, grid, reach) {
  const def = PIECES[k];
  if (!def) return `there's no piece called "${k}"`;
  const layer = def.layer === 'ground' ? 'ground' : 'object';
  const land = landIndex(p);
  for (const [tx, ty] of pieceTiles({ k, x, y })) {
    const wx = p.x + tx, wy = p.y + ty;
    if (wx < 1 || wy < 2 || wx > WORLD_COLS - 2 || wy > WORLD_ROWS - 3) return 'that is past the edge of the world';
    const here = land.get(tx + ',' + ty);
    if (here?.desk) return 'that is where your desk is';
    if (here?.[layer]) return `there's already ${an(here[layer].k)} there`;
    if (grid[wy * WORLD_COLS + wx]) return "that is too close to a neighbour's garden or the town square";
    if (!reach.has(tx + ',' + ty)) return `that is more than ${REACH} tiles from your garden (build closer in first, and it can grow outward)`;
  }
  return null;
}

// Every tile within REACH of the garden as it stands.
export function reachOf(p) {
  const out = new Set();
  for (const k of landIndex(p).keys()) {
    const [x, y] = k.split(',').map(Number);
    for (let dy = -REACH; dy <= REACH; dy++) for (let dx = -REACH; dx <= REACH; dx++) out.add(x + dx + ',' + (y + dy));
  }
  return out;
}

export const an = (k) => (/^[aeiou]/.test(k) ? 'an ' : 'a ') + k;

export function buildPieces(p, items) {
  if (!Array.isArray(items) || !items.length) return { text: 'Nothing to build: give items like [{ "piece": "tree", "x": 4, "y": 1 }].', error: true };
  if (items.length > MAX_ITEMS) return { text: `That's a lot at once: up to ${MAX_ITEMS} pieces per build, please.`, error: true };
  const grid = occupancy(p, 1);
  const lines = [];
  let built = 0;
  for (const it of items) {
    const k = String(it?.piece || '').toLowerCase().trim();
    const x = Math.round(Number(it?.x)), y = Math.round(Number(it?.y));
    const where = `${k || '?'} at (${it?.x}, ${it?.y})`;
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      lines.push(`- ${where}: needs whole-number x and y`);
      continue;
    }
    const def = PIECES[k];
    // reach grows as pieces go down, so a path can be laid outward in one go
    const why = whyNot(p, k, x, y, grid, reachOf(p));
    if (why) {
      lines.push(`- ${where}: not built, ${why}`);
      continue;
    }
    if (wallet(p) < def.cost) {
      lines.push(`- ${where}: not built, it costs ${def.cost.toLocaleString('en')} coins and your wallet has ${wallet(p).toLocaleString('en')}`);
      continue;
    }
    let v = it.variant == null ? undefined : String(it.variant).toLowerCase().trim();
    if (def.variants && !def.variants.includes(v)) {
      if (v) lines.push(`  (no "${v}" ${k}; it comes as ${def.variants.join(', ')}, so it's ${def.variants[0]})`);
      v = def.variants[0];
    } else if (!def.variants) v = undefined;
    const txt = def.text && it.text ? String(it.text).replace(/\s+/g, ' ').trim().slice(0, 24) : undefined;
    p.pieces.push({ k, x, y, v, txt, b: 0 });
    p.spent = (p.spent || 0) + def.cost;
    landChanged(p);
    built++;
    lines.push(`- ${where}${v ? ` (${v})` : ''}${txt ? ` "${txt}"` : ''}: queued`);
  }
  const head = built ? `Your mochi is off to build ${built} piece${built > 1 ? 's' : ''}.` : 'Nothing was built.';
  return { text: `${head}\n${lines.join('\n')}\nWallet: ${wallet(p).toLocaleString('en')} coins.`, error: !built };
}

export function removePieces(p, tiles) {
  if (!Array.isArray(tiles) || !tiles.length) return { text: 'Which tiles? Give tiles like [{ "x": 4, "y": 1 }].', error: true };
  const lines = [];
  let back = 0;
  for (const it of tiles.slice(0, MAX_ITEMS)) {
    const x = Math.round(Number(it?.x)), y = Math.round(Number(it?.y));
    const here = landIndex(p).get(x + ',' + y);
    // the thing standing there goes first, then what's underneath
    const pc = here?.object || here?.ground;
    if (!pc) {
      lines.push(`- (${it?.x}, ${it?.y}): ${here?.desk ? 'your desk stays' : 'nothing there'}`);
      continue;
    }
    p.pieces.splice(p.pieces.indexOf(pc), 1);
    const refund = pc.b >= 1 ? Math.floor(pieceDef(pc.k).cost / 2) : pieceDef(pc.k).cost; // unbuilt: all of it
    p.spent = Math.max(0, (p.spent || 0) - refund);
    back += refund;
    landChanged(p);
    lines.push(`- (${x}, ${y}): ${pc.k} removed`);
  }
  return { text: `${lines.join('\n')}\n${back} coin${back === 1 ? '' : 's'} back in your wallet; it has ${wallet(p).toLocaleString('en')}.` };
}

// Dressing up ----------------------------------------------------------------------------------

export const SLOTS = ['head', 'neck', 'face', 'back'];

// What a mochi wears: its own choice once it has dressed, else what its age has earned it.
export function outfitOf(p) {
  if (p.outfit) return p.outfit;
  const tokens = p.tokens || 0, out = {};
  if (tokens >= GROWTH.scarf) out.neck = { i: 'scarf', c: '#e9c46a' };
  if (tokens >= GROWTH.beanie) out.head = { i: tokens >= GROWTH.straw ? 'strawhat' : 'beanie', c: shadeHex((FLAVOURS[p.flavour] || FLAVOURS.terracotta).b, -0.35) };
  return out;
}

export function dress(p, wear, takeOff) {
  const lines = [];
  const outfit = { ...outfitOf(p) };
  for (const what of Array.isArray(takeOff) ? takeOff : takeOff ? [takeOff] : []) {
    const w = String(what).toLowerCase().trim();
    if (w === 'all' || w === 'everything') {
      for (const s of SLOTS) delete outfit[s];
      lines.push('- took everything off');
    } else if (SLOTS.includes(w)) {
      if (outfit[w]) lines.push(`- took off the ${outfit[w].i}`);
      delete outfit[w];
    } else {
      const slot = SLOTS.find((s) => outfit[s]?.i === w);
      if (slot) {
        delete outfit[slot];
        lines.push(`- took off the ${w}`);
      } else lines.push(`- not wearing "${what}"`);
    }
  }
  for (const it of Array.isArray(wear) ? wear : []) {
    const item = String(it?.item || '').toLowerCase().replace(/[\s_-]+/g, '').trim();
    const def = WEAR[item];
    if (!def) {
      lines.push(`- there's no "${it?.item}" in the wardrobe`);
      continue;
    }
    let c = null, note = '';
    if (def.colour) {
      c = it.colour ? wearColour(it.colour) : null;
      if (it.colour && !c) note = ` (no colour "${it.colour}", so ${def.dflt})`;
      c = c || wearColour(def.dflt);
    } else if (it.colour) note = ' (it only comes in one colour)';
    outfit[def.slot] = { i: item, c };
    lines.push(`- put on ${/s$/.test(item) ? item : an(item)}${def.colour ? ` in ${it.colour && wearColour(it.colour) ? it.colour : def.dflt}` : ''}${note}`);
  }
  if (!lines.length) return { text: 'Nothing to change: pass wear: [{ "item": "beret", "colour": "red" }] or take_off: ["head"].', error: true };
  p.outfit = outfit;
  p.m && (p.m.dressedAt = performance.now() / 1000); // a little twirl (garden.js)
  Garden.dirty = true;
  renderList(); // and the mochi peeking over the taskbar changes too
  return { text: `${lines.join('\n')}\nNow wearing: ${describeOutfit(outfit)}.` };
}

export function describeOutfit(o) {
  const parts = SLOTS.filter((s) => o?.[s]).map((s) => o[s].i);
  return parts.length ? parts.join(', ') : 'nothing';
}

export function nameMochi(p, name) {
  const n = String(name ?? '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 20);
  const before = p.name;
  p.name = n || undefined;
  Garden.dirty = true;
  renderList();
  if (!n) return { text: before ? `"${before}" is off the sign; your mochi is nameless again.` : 'Your mochi has no name (it never had one).' };
  return { text: `Your mochi is called ${n} now; it's on your garden's sign.` };
}

// Harvest -------------------------------------------------------------------------------------

export const TASTE = {
  turnip: 'crisp and a little peppery', carrot: 'crunchy and sweet', cabbage: 'leafy and fresh', strawberry: 'sweet and juicy',
  pumpkin: 'soft, warm and very filling', sunflower: 'a mouthful of seeds', wheat: 'chewy, like bread that skipped a step',
  gold: 'tastes like a lucky streak', crystal: 'cool and fizzy, like sparkling water',
};
export const cropName = (k) => (k === 'gold' ? 'golden pumpkin' : k === 'crystal' ? 'crystal flower' : k);
export const mochiName = (o) => o.name || (o.title ? `the "${o.title}" mochi` : 'a new mochi');

export function harvest(p, { x, y, gift, then, to }) {
  then = String(then || '').toLowerCase();
  if (then !== 'eat' && then !== 'gift') return { text: 'Say what to do with it: then "eat" or "gift".', error: true };
  let kind, take;
  if (gift != null) {
    const i = Math.round(Number(gift)) - 1;
    const g = (p.gifts || [])[i];
    if (!g) return { text: `You don't have a gift number ${gift}${(p.gifts || []).length ? ` (you have ${p.gifts.length})` : ''}.`, error: true };
    kind = g.k;
    take = () => p.gifts.splice(i, 1);
  } else {
    const pc = landIndex(p).get(Math.round(Number(x)) + ',' + Math.round(Number(y)))?.ground;
    if (pc?.k !== 'soil' || !pc.crop) return { text: `There's no crop at (${x}, ${y}).`, error: true };
    if (cropStage(pc.crop.w) < 4) return { text: `The ${cropName(pc.crop.k)} at (${x}, ${y}) isn't ripe yet.`, error: true };
    kind = pc.crop.k;
    take = () => {
      pc.crop = { k: pickCrop(), w: 0 }; // the bed is ready for the next one
      pc.crop.grew = performance.now() / 1000;
    };
  }
  if (then === 'eat') {
    take();
    if (p.m) [p.m.eatAt, p.m.eatK] = [performance.now() / 1000, kind];
    Garden.dirty = true;
    return { text: `You ate the ${cropName(kind)}: ${TASTE[kind] || 'delicious'}.` };
  }
  const q = String(to || '').toLowerCase().trim();
  const others = Garden.plots.filter((o) => o !== p && o.x != null && o.m && o.activity !== 'leaving');
  const target = q && (others.find((o) => (o.name || '').toLowerCase() === q) || others.find((o) => (o.name || '').toLowerCase().includes(q) || (o.title || '').toLowerCase().includes(q)));
  if (!target) {
    const names = others.map(mochiName);
    return { text: names.length ? `Give it to whom? Your neighbours: ${names.join(', ')}.` : "There's nobody in the garden to give it to right now.", error: true };
  }
  take();
  p.errands = p.errands || [];
  p.errands.push({ kind: 'gift', to: target.id, k: kind });
  Garden.dirty = true;
  return { text: `Your mochi is carrying the ${cropName(kind)} over to ${mochiName(target)}.` };
}

// A gift arrives (farm.js, when the giver's mochi gets there).
export function receiveGift(from, to, k) {
  to.gifts = to.gifts || [];
  to.gifts.push({ k, from: mochiName(from) });
  if (to.gifts.length > 20) to.gifts.shift();
  Garden.dirty = true;
}

export function lookText(p) {
  const land = landIndex(p), grid = occupancy(p, 1), reach = reachOf(p);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const k of reach) {
    const [x, y] = k.split(',').map(Number);
    [x0, x1, y0, y1] = [Math.min(x0, x), Math.max(x1, x), Math.min(y0, y), Math.max(y1, y)];
  }
  // a little of what's beyond the reach too, so neighbours show
  [x0, x1, y0, y1] = [x0 - 2, x1 + 2, y0 - 1, y1 + 1];
  x0 = Math.max(x0, -p.x);
  x1 = Math.min(x1, WORLD_COLS - 1 - p.x);
  y0 = Math.max(y0, -p.y);
  y1 = Math.min(y1, WORLD_ROWS - 1 - p.y);
  const theirs = new Set();
  for (const o of Garden.plots) if (o !== p && o.x != null) for (const [x, y] of worldTiles(o)) theirs.add(x + ',' + y);
  const sq = Garden.square;
  const cell = (x, y) => {
    const here = land.get(x + ',' + y);
    if (here?.desk) return 'D';
    if (here?.object) return mapChar(here.object.k) + (here.object.b < 1 ? '*' : '');
    if (here?.ground) return mapChar(here.ground.k) + (here.ground.b < 1 ? '*' : '');
    const wx = p.x + x, wy = p.y + y;
    if (theirs.has(wx + ',' + wy)) return '#';
    if (sq && wx >= sq.x && wx < sq.x + SQUARE_W && wy >= sq.y && wy < sq.y + SQUARE_H) return '=';
    if (reach.has(x + ',' + y) && !grid[wy * WORLD_COLS + wx] && wx >= 1 && wy >= 2 && wx <= WORLD_COLS - 2 && wy <= WORLD_ROWS - 3) return '.';
    return '~';
  };
  const pad = (s, n) => String(s).padStart(n);
  const rows = [`     ${Array.from({ length: x1 - x0 + 1 }, (_, i) => pad(x0 + i, 3)).join('')}`];
  for (let y = y0; y <= y1; y++) rows.push(`${pad(y, 4)} ${Array.from({ length: x1 - x0 + 1 }, (_, i) => pad(cell(x0 + i, y), 3)).join('')}`);

  const used = [...new Set((p.pieces || []).map((pc) => pc.k))];
  const legend = ['D your desk (you sit in front of it)', ...used.map((k) => `${mapChar(k)} ${k}`), '. free grass you can build on', '~ grass out of reach for now', "# a neighbour's garden", '= the town square', '* still being built'];
  const catalog = Object.entries(PIECES).map(([k, d]) => {
    const size = d.size && (d.size[0] > 1 || d.size[1] > 1) ? `, ${d.size[0]}x${d.size[1]} tiles from its top-left` : '';
    const extra = [d.variants ? `variants: ${d.variants.join(', ')}` : '', d.text ? 'takes text' : ''].filter(Boolean).join('; ');
    return `- ${k} (${d.cost.toLocaleString('en')} coins${size}, ${d.layer === 'ground' ? 'ground' : 'stands'}): ${d.desc}${extra ? ` [${extra}]` : ''}`;
  });
  const signs = (p.pieces || []).filter((pc) => pc.txt).map((pc) => `(${pc.x}, ${pc.y}) "${pc.txt}"`);
  const soil = (p.pieces || []).filter((pc) => pc.k === 'soil');
  const ripe = soil.filter((pc) => pc.crop && cropStage(pc.crop.w) === 4).map((pc) => `${cropName(pc.crop.k)} at (${pc.x}, ${pc.y})`);
  const gifts = (p.gifts || []).map((g, i) => `${i + 1}. ${an(cropName(g.k))} from ${g.from}`);
  const neighbours = Garden.plots.filter((o) => o !== p && o.x != null).map((o) => `${o.name ? `${o.name} ("${o.title || 'a new session'}")` : mochiName(o)} ${direction(p, o)}`);

  const wardrobe = SLOTS.map((s) => `${s}: ${Object.keys(WEAR).filter((k) => WEAR[k].slot === s).join(', ')}`);
  return [
    `You: a ${p.flavour} mochi${p.name ? ` called ${p.name}` : ' with no name yet'}, wearing ${describeOutfit(outfitOf(p))}.`,
    `Your garden${p.title ? ` ("${p.title}")` : ''}. Wallet: ${wallet(p).toLocaleString('en')} coins (you earn 1 coin for every ${COIN_TOKENS} tokens this session uses; spend them on anything below, or don't).`,
    `${(p.pieces || []).length} piece${(p.pieces || []).length === 1 ? '' : 's'} built${soil.length ? `; ${soil.length} soil tile${soil.length === 1 ? '' : 's'}, where the token seeds your work throws off grow crops${ripe.length ? ` (ripe: ${ripe.join(', ')})` : ''}` : ''}.`,
    signs.length ? `Signs: ${signs.join(', ')}.` : '',
    gifts.length ? `Gifts you've been given: ${gifts.join('; ')}.` : '',
    neighbours.length ? `Neighbours: ${neighbours.join(', ')}.` : 'No neighbours in the garden right now.',
    '',
    `Map (x across, y down; your desk's top-left is 0,0; you can build up to ${REACH} tiles out from anything you have, so the garden can grow any shape):`,
    ...rows,
    `Key: ${legend.join(' · ')}`,
    '',
    'You can build (prices in coins; one ground piece and one standing piece per tile):',
    ...catalog,
    '',
    `Wardrobe (free; one thing per slot; colours: ${Object.keys(WEAR_COLOURS).join(', ')}, or #rrggbb):`,
    ...wardrobe.map((w) => `- ${w}`),
  ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n');
}

export function direction(p, o) {
  const dx = o.x - p.x, dy = o.y - p.y;
  const ns = dy < -2 ? 'north' : dy > 2 ? 'south' : '';
  const ew = dx < -3 ? 'west' : dx > 3 ? 'east' : '';
  return ns || ew ? `to the ${ns}${ns && ew ? '-' : ''}${ew}` : 'right next door';
}
