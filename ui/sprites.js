// Pixel art for Mochi Garden, drawn from hand-made pixel grids so every sprite is exact.
// Grids: '.' empty, 'o' outline, 'b' body, 's' body shade, 'w' white, 'e' eye, 'p' blush.

export const OUTLINE = '#3a2218';

// The approved mochi: a round ~13x11 ball, no limbs, no mouth, shiny 2x2 eyes, blush.
export const MOCHI = [
  '....ooooo....',
  '..oobbbbboo..',
  '.obbbbbbbbbo.',
  '.obbbbbbbbbo.',
  'obbeebbbeebbo',
  'obbeebbbeebbo',
  'obppbbbbbppbo',
  'obbbbbbbbbbso',
  '.obbbbbbbsso.',
  '..oosssssoo..',
  '....ooooo....',
];
// Eyes: dark 2x2 with a white catchlight top-right.
/** @type {[number, number, string][]} */
export const EYE_PIXELS = [[3, 4, 'e'], [4, 4, 'w'], [3, 5, 'e'], [4, 5, 'e'], [8, 4, 'e'], [9, 4, 'w'], [8, 5, 'e'], [9, 5, 'e']];

// Asleep: flattened, eyes closed as short lines.
export const MOCHI_SLEEP = [
  '...ooooooo...',
  '.oobbbbbbboo.',
  'obbbbbbbbbbbo',
  'obeebbbbbeebo',
  'obppbbbbbppbo',
  'obbbbbbbbbbso',
  '.oossssssssoo',
  '...ooooooo...',
];

export const FLAVOURS = {
  terracotta: { b: '#d97757', s: '#b85c3e', p: '#f49aab' },
  matcha: { b: '#8db580', s: '#6e9864', p: '#f2a3ad' },
  strawberry: { b: '#ee8fa3', s: '#d06f86', p: '#e5607e' },
  ube: { b: '#a98bd1', s: '#8a6cb5', p: '#f2a3c4' },
  mango: { b: '#f2c14e', s: '#d9a43a', p: '#f29a8b' },
  sesame: { b: '#a19d98', s: '#807b76', p: '#f0a2ad' },
  vanilla: { b: '#f3ebdd', s: '#d9cdb8', p: '#f4a7b3' },
  soda: { b: '#7fb8e8', s: '#5f99cc', p: '#f3a6bd' },
};
export const FLAVOUR_ORDER = ['terracotta', 'matcha', 'strawberry', 'ube', 'mango', 'soda', 'vanilla', 'sesame'];

export function gridCanvas(rows, colourOf) {
  const c = document.createElement('canvas');
  c.width = rows[0].length;
  c.height = rows.length;
  const g = c.getContext('2d');
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const col = colourOf(ch);
      if (!col) return;
      g.fillStyle = col;
      g.fillRect(x, y, 1, 1);
    });
  });
  return c;
}

export const spriteCache = new Map();
export function mochiSprite(flavour, pose) {
  const key = flavour + ':' + pose;
  if (spriteCache.has(key)) return spriteCache.get(key);
  const f = FLAVOURS[flavour] || FLAVOURS.terracotta;
  const colour = (ch) =>
    ({ o: OUTLINE, b: f.b, s: f.s, p: f.p, e: OUTLINE, w: '#ffffff' })[ch];
  let c;
  if (pose === 'sleep') {
    c = gridCanvas(MOCHI_SLEEP, colour);
  } else if (pose === 'back') {
    // seen from behind (typing at its desk): no face, a soft highlight on the crown
    c = gridCanvas(MOCHI, (ch) => colour(ch === 'e' || ch === 'w' || ch === 'p' ? 'b' : ch));
    const g = c.getContext('2d');
    g.fillStyle = shadeHex(f.b, 0.25);
    g.fillRect(4, 2, 3, 1);
    g.fillRect(3, 3, 2, 1);
  } else {
    c = gridCanvas(MOCHI, (ch) => colour(ch === 'e' ? 'b' : ch));
    const g = c.getContext('2d');
    for (const [x, y, ch] of EYE_PIXELS) {
      g.fillStyle = colour(ch);
      g.fillRect(x, y, 1, 1);
    }
  }
  spriteCache.set(key, c);
  return c;
}

// Props --------------------------------------------------------------------------------

export const PALETTE = {
  o: OUTLINE, w: '#ffffff', W: '#f6f1e4',
  g: '#8f9399', G: '#5f6369', k: '#3d4045', // laptop
  d: '#a0703f', D: '#6b4a2b', l: '#c48d55', // wood
  n: '#8b6a4a', N: '#6f5238', // dirt
  t: '#5f8f3e', T: '#7fb04f', // leaves
  r: '#e0665c', y: '#f2c14e', v: '#b48ad6', // flowers
  L: '#f6d77a', // lantern glow
};
export const pal = (ch) => PALETTE[ch];

export const LAPTOP = ['..oooooo', '.ogggggo', '.ogGGGgo', '.ogggggo', 'oookkkoo', 'okkkkkko', 'oooooooo'];

export const BUBBLE_BANG = ['.ooooooo.', 'oWWWWWWWo', 'oWWWoWWWo', 'oWWWoWWWo', 'oWWWoWWWo', 'oWWWWWWWo', 'oWWWoWWWo', '.ooooooo.', '..oo.....', '..o......'];
export const BUBBLE_ASK = ['.ooooooo.', 'oWWWWWWWo', 'oWWoooWWo', 'oWWWWoWWo', 'oWWWooWWo', 'oWWWWWWWo', 'oWWWoWWWo', '.ooooooo.', '..oo.....', '..o......'];
export const ZZZ = ['oooo', '..o.', '.o..', 'oooo'];

// Bench, two tiles wide, built in stages: legs, frame, seat planks.
export const BENCH = [
  '..oooooooooooooooooooo..',
  '.oddddddddddddddddddddo.',
  '.olllllllllllllllllllllo',
  '.oddddddddddddddddddddo.',
  '..oooooooooooooooooooo..',
  '...oDo............oDo...',
  '...oDo............oDo...',
  '...oDo............oDo...',
  '...ooo............ooo...',
];

export const SIGN_POST = ['oDo', 'oDo', 'oDo', 'oDo', 'oDo', 'oDo', 'ooo'];
export const SEEDLING = ['.T.T.', 'oTtTo', '..t..', '..t..'];
export const FLOWER = ['.r.', 'ryr', '.r.', '.t.'];
export const LANTERN = ['.ooo.', 'oLLLo', 'oLyLo', 'oLLLo', '.ooo.', '..D..', '..D..', '.ooo.'];
export const PLANK = ['oooooooo', 'olllllld', 'oooooooo'];

export const propCache = new Map();
export function prop(name, rows) {
  if (!propCache.has(name)) propCache.set(name, gridCanvas(rows, pal));
  return propCache.get(name);
}

// Accessories earned with maturity, drawn over the mochi (13 px wide sprite space).
export const SCARF = { rows: ['.ooooooooooo.', 'ocCcCcCcCcCco', '.oooooooocCo.', '........oco..'], y: 7 };
export const BEANIE = { rows: ['.....ooo.....', '....oCCCo....', '..ooCCCCCoo..', '.oCCCCCCCCCo.', 'ocCcCcCcCcCco', 'ooooooooooooo'], y: -4 };
export const STRAW = { rows: ['....ooooo....', '...oyyyyyo...', '..oyyyyyyyo..', '..orrrrrrro..', 'oyyyyyyyyyyyo', 'ooooooooooooo'], y: -4 };

export function accessorySprite(acc, colour) {
  const key = 'acc:' + acc + ':' + colour;
  if (spriteCache.has(key)) return spriteCache.get(key);
  const def = { scarf: SCARF, beanie: BEANIE, straw: STRAW }[acc];
  const dark = shadeHex(colour, -0.25);
  const c = gridCanvas(def.rows, (ch) => ({ o: OUTLINE, C: colour, c: dark, y: '#e9c46a', r: '#c0533f' })[ch]);
  spriteCache.set(key, c);
  return c;
}

export function shadeHex(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v) => Math.max(0, Math.min(255, Math.round(v + (amt < 0 ? v * amt : (255 - v) * amt))));
  const r = ch(n >> 16), g = ch((n >> 8) & 255), b = ch(n & 255);
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}

// Art extracted from approved concept sheets (tools/extract_*.py), loaded from ui/art.
export function artImage(name) {
  const img = new Image();
  img.src = `art/${name}.png`;
  return img;
}
export const ready = (img) => img.complete && img.naturalWidth > 0;
