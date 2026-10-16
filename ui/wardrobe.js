// The wardrobe: things a session can dress its mochi in, hand-pixelled to read on a 13 px mochi.
// Each item belongs to a slot (head, neck, face, back) and is drawn relative to the mochi sprite's
// top-left (x, y) for its pose: 'idle' (facing you), 'back' (from behind, typing) or 'sleep'
// (the flattened sprite, which garden.js draws at y + 3; pass the same x, y as the awake mochi).
// Needs sprites.js (gridCanvas, FLAVOURS, shadeHex).

const WEAR_COLOURS = {
  red: '#e0665c', orange: '#f08a3c', yellow: '#f2c14e', green: '#7fb04f', mint: '#8fd6b4', teal: '#4fa3a5',
  sky: '#9fd3f2', blue: '#6f9be0', navy: '#3f5a8a', purple: '#9a6bc9', lilac: '#c3a6e6', pink: '#f29ac2',
  white: '#f6f1e4', cream: '#efe6cf', grey: '#9a9a9a', black: '#3d4045', brown: '#8a5228', tan: '#d39556', gold: '#e9b949',
};

const WEAR = {
  // head
  beanie: { slot: 'head', colour: true, dflt: 'red', desc: 'a knitted beanie' },
  strawhat: { slot: 'head', colour: true, dflt: 'red', desc: 'a straw hat (colour = its band)' },
  bow: { slot: 'head', colour: true, dflt: 'pink', desc: 'a ribbon bow' },
  flowercrown: { slot: 'head', colour: true, dflt: 'pink', desc: 'a crown of little flowers' },
  cap: { slot: 'head', colour: true, dflt: 'blue', desc: 'a baseball cap' },
  tophat: { slot: 'head', colour: true, dflt: 'black', desc: 'a tall top hat with a band' },
  wizardhat: { slot: 'head', colour: true, dflt: 'purple', desc: 'a pointy wizard hat with stars' },
  crown: { slot: 'head', colour: false, desc: 'a golden crown' },
  headphones: { slot: 'head', colour: true, dflt: 'mint', desc: 'headphones' },
  sprout: { slot: 'head', colour: false, desc: 'a little leaf sprout growing on top' },
  partyhat: { slot: 'head', colour: true, dflt: 'blue', desc: 'a party hat with confetti dots' },
  catears: { slot: 'head', colour: true, dflt: 'black', desc: 'cat ears' },
  beret: { slot: 'head', colour: true, dflt: 'red', desc: 'a floppy beret' },
  buckethat: { slot: 'head', colour: true, dflt: 'yellow', desc: 'a bucket hat' },
  chefhat: { slot: 'head', colour: false, desc: "a puffy chef's hat" },
  halo: { slot: 'head', colour: false, desc: 'a floating golden halo' },
  // neck
  scarf: { slot: 'neck', colour: true, dflt: 'yellow', desc: 'a striped scarf' },
  bowtie: { slot: 'neck', colour: true, dflt: 'navy', desc: 'a bow tie' },
  bandana: { slot: 'neck', colour: true, dflt: 'blue', desc: 'a spotted bandana' },
  bell: { slot: 'neck', colour: true, dflt: 'red', desc: 'a collar with a gold bell (colour = collar)' },
  lei: { slot: 'neck', colour: false, desc: 'a flower lei' },
  // face
  glasses: { slot: 'face', colour: true, dflt: 'black', desc: 'round glasses' },
  sunglasses: { slot: 'face', colour: false, desc: 'cool sunglasses' },
  monocle: { slot: 'face', colour: false, desc: 'a gold monocle' },
  freckles: { slot: 'face', colour: false, desc: 'freckles' },
  mustache: { slot: 'face', colour: false, desc: 'a fine mustache' },
  // back
  cape: { slot: 'back', colour: true, dflt: 'red', desc: 'a little cape' },
  backpack: { slot: 'back', colour: true, dflt: 'orange', desc: 'a backpack' },
  wings: { slot: 'back', colour: false, desc: 'little fairy wings' },
  leaf: { slot: 'back', colour: false, desc: 'a big leaf held up like an umbrella' },
};

// Draw order around the mochi body. From behind ('back' pose) a back item covers the body, so
// it's drawn over it there.
const WEAR_ORDER = { under: ['back'], over: ['neck', 'face', 'head'], fromBehind: { under: [], over: ['neck', 'back', 'head'] } };

const Wardrobe = (() => {
  const INK = '#3a2218';
  const FIXED = {
    o: INK,
    h: '#fff6c2', H: '#f8dc84', // halo glow
    y: '#f2c14e', Y: '#c9962e', V: '#f8dc84', // gold
    n: '#e9c46a', N: '#c9a24a', // straw
    x: '#ffffff', W: '#d9d0bd', // white
    p: '#f29ac2', P: '#fbd6e3', // pink
    r: '#c0533f', // red band
    G: '#7fb04f', g: '#5f8f3e', H: '#a3d977', // leaf
    e: '#3d4045', E: '#8a9099', // dark lens
    M: '#5a3a22', m: '#7a5232', // mustache
    f: '#a65a3a', // freckle
    w: '#eef8fc', v: '#b9dff0', // wing
    b: '#7fa7e8', // blue flower
  };

  // Pad a fill-only grid by a pixel and ink every empty pixel touching the shape (4-neighbour).
  // outerOnly: leave enclosed holes (a halo's middle, a lens) un-inked.
  function inked(rows, outerOnly) {
    const w = rows[0].length + 2, h = rows.length + 2;
    const at = (x, y) => (x < 1 || y < 1 || x > w - 2 || y > h - 2 ? '.' : rows[y - 1][x - 1] || '.');
    let outside = null;
    if (outerOnly) {
      outside = new Set();
      const stack = [[0, 0]];
      while (stack.length) {
        const [x, y] = stack.pop();
        const k = x + ',' + y;
        if (x < 0 || y < 0 || x >= w || y >= h || outside.has(k) || at(x, y) !== '.') continue;
        outside.add(k);
        stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
      }
    }
    const out = [];
    for (let y = 0; y < h; y++) {
      let s = '';
      for (let x = 0; x < w; x++) {
        const ch = at(x, y);
        if (ch !== '.') s += ch;
        else if (outside && !outside.has(x + ',' + y)) s += '.';
        else s += [at(x - 1, y), at(x + 1, y), at(x, y - 1), at(x, y + 1)].some((c) => c !== '.' && c !== 'o') ? 'o' : '.';
      }
      out.push(s);
    }
    return out;
  }
  const mirror = (rows) => rows.map((r) => [...r].reverse().join(''));
  const dots = (w, h, pts, ch) => {
    const g = Array.from({ length: h }, () => Array(w).fill('.'));
    for (const [x, y] of pts) g[y][x] = ch;
    return g.map((r) => r.join(''));
  };
  // A placed grid: rows drawn with their top-left at (x + dx, y + dy).
  const at = (rows, dx, dy) => ({ rows, dx, dy });

  // Ported accessories (sprites.js) ---------------------------------------------------------
  const BEANIE = ['.....ooo.....', '....oCCCo....', '..ooCCCCCoo..', '.oCCCCCCCCCo.', 'ocCcCcCcCcCco', 'ooooooooooooo'];
  const STRAW = ['....ooooo....', '...onnnnno...', '..onnnnnnno..', '..oCCCCCCCo..', 'onnnnnnnnnnno', 'ooooooooooooo'];
  const SCARF = ['.ooooooooooo.', 'ocCcCcCcCcCco', '.oooooooocCo.', '........oco..'];

  const WING = ['www..', 'wvww.', '.wvww', '..wvw', '.wwvw', '..ww.'];

  const MUSTACHE = ['M.......M', 'MmMM.MMmM', '.MMM.MMM.'];
  const ART = {
    beanie: { idle: at(BEANIE, 0, -4) },
    strawhat: { idle: at(STRAW, 0, -4) },
    bow: { idle: at(inked(['LC.Cc', 'CCcCc', 'Cc.cc']), 6, -2) },
    flowercrown: { idle: at(inked(['.C..x..C.', 'CyCxyxCyC', 'GCGgxgGCG']), 1, -2) },
    cap: { idle: at(inked(['..LLCCCc.....', '.LCCCCCCc....', '.CCCCCCCCc...', '.cccccccccccc']), -1, -3) },
    tophat: { idle: at(inked(['..LCCCCCc..', '..LCCCCCc..', '..LCCCCCc..', '..rrrrrrr..', '..LCCCCCc..', 'LCCCCCCCCCc']), 0, -5) },
    wizardhat: {
      idle: at(inked(['........Cc.', '.......LCc.', '......LCc..', '.....LCCc..', '....LCyCCc.', '...LCCCCCc.', '...LCCCyCc.', 'LLCCCCCCCCc']), 0, -7),
    },
    crown: { idle: at(inked(['V...V...V', 'yy.yyy.yy', 'yyyyyyyyy', 'YrYYbYYrY']), 1, -3) },
    headphones: {
      idle: at(inked(['.....ccccc.....', '...cc.....cc...', '..c.........c..', '.c...........c.', 'LC...........CL', 'LC...........CC', 'CC...........Cc', 'cc...........cc']), -2, -2),
      sleep: at(inked(['....ccccccc....', '..cc.......cc..', '.c...........c.', 'LC...........CL', 'CC...........Cc', 'cc...........cc']), -2, 1),
    },
    sprout: { idle: at(inked(['HG.GG', '.GgG.', '..g..']), 3, -4) },
    partyhat: { idle: at(inked(['...x...', '...C...', '..LCy..', '..yCC..', '.LCyCc.', '.yCCCy.', 'LCyCyCc']), 2, -7) },
    catears: { idle: at(inked(['..C.....C..', '.CpC...CpC.', '.CCC...CCC.']), 0, -2) },
    beret: { idle: at(inked(['......c....', '..LCCCCCc..', 'LCCCCCCCCCc', '..ccccccc..']), 0, -3) },
    buckethat: { idle: at(inked(['...LCCCc...', '..LCCCCCc..', '..ccccccc..', '.LCCCCCCCc.', 'LCCCCCCCCCc']), 0, -3) },
    chefhat: { idle: at(inked(['.xx.xxx..', 'xxxxxxxxx', 'xxxxxxxxW', '.xWxxxxW.', '.xxxxxxW.', '.xxxxxxW.', '.WWWWWWW.']), 1, -6) },
    halo: { idle: at(['...hhhhh...', '.hh.....hh.', 'Hy.......yH', '.HY.....YH.', '...YYYYY...'], 1, -7) },
    // neck
    scarf: { idle: at(SCARF, 0, 7), sleep: at(SCARF, 0, 8) },
    bowtie: { idle: at(inked(['LC.Cc', 'CCcCc', 'Cc.cc']), 3, 7), back: null },
    bandana: {
      idle: at(inked(['CCCCCCCCCCC', '...LCxCCCc.', '.....CCxc..', '......Cc...']), 0, 6),
      back: at(inked(['CCCCCCCCC', '...cCc...', '...c.c...']), 1, 6),
    },
    bell: {
      idle: at(inked(['CCCCCCCCCCC', '....Vyy....', '....yyY....']), 0, 6),
      back: at(inked(['CCCCCCCCCCC']), 0, 6),
    },
    lei: { idle: at(inked(['Pp.......pP', '.xpyP.Pypx.', '...PpxpP...']), 0, 6) },
    // face (never seen from behind)
    glasses: {
      idle: at(['.CC...CC.', 'C..CCC..C', 'C..C.C..C', '.CC...CC.'], 2, 3),
      back: null,
      sleep: null,
    },
    sunglasses: {
      idle: at(['ooooooooo', 'oEeo.oEeo', 'oeeo.oeeo', '.oo...oo.'], 2, 3),
      back: null,
      sleep: null,
    },
    monocle: { idle: at(['.yy..', 'y..y.', 'y..y.', '.yyY.', '....Y', '....Y'], 7, 3), back: null, sleep: null },
    freckles: { idle: at(dots(9, 2, [[0, 0], [2, 0], [1, 1], [8, 0], [6, 0], [7, 1]], 'f'), 2, 7), back: null, sleep: at(dots(9, 2, [[0, 0], [2, 0], [1, 1], [8, 0], [6, 0], [7, 1]], 'f'), 2, 8) },
    mustache: { idle: at(MUSTACHE, 2, 6), back: null, sleep: at(MUSTACHE, 2, 7) },
    // back (under the body, so only the edges show from the front)
    cape: {
      idle: at(inked(['..CCCCCCCCCCC..', '.CCCCCCCCCCCCC.', '.CCCCCCCCCCCCC.', 'LCCCCCCCCCCCCCc', 'LCCCCCCCCCCCCCc', 'LCCC.......CCCc', 'LCC.........CCc', 'cc...........cc']), -2, 2),
      back: at(inked(['....ccccccc....', '...LCCCCCCCc...', '..LCCCCCCCCCc..', '..LCCcCCCcCCc..', '.LCCCcCCCcCCCc.', '.LCCCcCCCcCCCc.', 'LCCCCcCCCcCCCCc', 'LCCCcCCCCCcCCCc', 'CCCCcCCCCCcCCCc', 'ccccccccccccccc']), -2, 1),
      // asleep it lies on its cape like a little rug
      sleep: at(inked(['..CCCCCCCCCCCCC..', '.CCCCCCCCCCCCCCC.', 'cCCCCCCCCCCCCCCCc', '.ccccccccccccccc.']), -3, 7),
    },
    backpack: {
      idle: at(inked(['.LCCc', 'LCCCc', 'cccyc', 'LCCCc', 'LCCCc', '.ccc.']), 9, 1),
      back: at(inked(['.LCCCCCc.', 'LCCCCCCCc', 'LCCCCCCCc', 'ccccycccc', 'LCCCCCCCc', 'LCcccccCc', 'LCcCCCcCc', '.ccccccc.']), 1, 2),
      // set down beside it for the night
      sleep: at(inked(['.LCCCc.', 'LCCCCCc', 'cccyccc', 'LCCCCCc', 'LCcccCc', '.ccccc.']), 12, 3),
    },
    wings: {
      idle: at(inked(WING.map((r) => r + '.'.repeat(9) + [...r].reverse().join(''))), -4, 0),
      back: at(inked(WING.map((r) => r + '...' + [...r].reverse().join(''))), -1, 1),
    },
    leaf: {
      idle: at(inked(['....HHGGG....', '..HHGGGGGGg..', '.HGGGGgGGGGg.', 'HGGGgGGGgGGGg', 'gggg.ggg.gggg', '.........g...', '.........g...', '.........g...', '.........g...', '.........g...']), -1, -7),
    },
  };

  // Where an item goes for a pose: explicit, null (not shown), or derived from idle (mirrored from
  // behind; lowered onto the flattened sleeping mochi).
  const SLEEP_DROP = { head: 3, neck: 1, back: 3 };
  function placement(item, pose) {
    const a = ART[item];
    if (!a) return null;
    if (pose === 'back') {
      if (a.back !== undefined) return a.back;
      if (WEAR[item].slot === 'face') return null;
      const w = a.idle.rows[0].length;
      return at(mirror(a.idle.rows), 13 - a.idle.dx - w, a.idle.dy);
    }
    if (pose === 'sleep') {
      if (a.sleep !== undefined) return a.sleep;
      const drop = SLEEP_DROP[WEAR[item].slot];
      return drop == null ? null : at(a.idle.rows, a.idle.dx, a.idle.dy + drop);
    }
    return a.idle;
  }

  const cache = new Map();
  function sprite(item, pose, hex) {
    const key = item + ':' + pose + ':' + hex;
    if (cache.has(key)) return cache.get(key);
    const pl = placement(item, pose);
    let s = null;
    if (pl) {
      const pal = { ...FIXED, C: hex, c: shadeHex(hex, -0.25), L: shadeHex(hex, 0.3) };
      s = { c: gridCanvas(pl.rows, (ch) => pal[ch]), dx: pl.dx, dy: pl.dy };
    }
    cache.set(key, s);
    return s;
  }

  function colourOf(item, colour) {
    const def = WEAR[item];
    return wearColour(colour) || wearColour(def?.dflt) || '#e0665c';
  }

  function draw(g, item, colour, x, y, pose = 'idle') {
    if (!WEAR[item]) return;
    const s = sprite(item, pose, colourOf(item, colour));
    if (s) g.drawImage(s.c, Math.round(x) + s.dx, Math.round(y) + s.dy);
  }

  function icon(item, colour) {
    const key = 'icon:' + item + ':' + colour;
    if (cache.has(key)) return cache.get(key);
    const s = WEAR[item] && sprite(item, 'idle', colourOf(item, colour));
    if (!s) return null;
    const c = document.createElement('canvas');
    c.width = s.c.width;
    c.height = s.c.height;
    c.getContext('2d').drawImage(s.c, 0, 0);
    cache.set(key, c);
    return c;
  }

  return { draw, icon };
})();

// '#rrggbb', a WEAR_COLOURS name or a FLAVOURS name -> hex (or null).
function wearColour(c) {
  if (!c) return null;
  if (c[0] === '#') return c;
  if (WEAR_COLOURS[c]) return WEAR_COLOURS[c];
  if (typeof FLAVOURS !== 'undefined' && FLAVOURS[c]) return FLAVOURS[c].b;
  return null;
}

// Draw one worn item on a mochi whose (awake) sprite top-left is at (x, y). colourHex: '#rrggbb'
// or a colour name; ignored for fixed-colour items. pose: 'idle' | 'back' | 'sleep'.
function drawWear(g, item, colourHex, x, y, pose) {
  Wardrobe.draw(g, item, colourHex, x, y, pose);
}

// The item on its own (idle view), on a small transparent canvas for menus.
function wearIcon(item, colourHex) {
  return Wardrobe.icon(item, colourHex);
}
