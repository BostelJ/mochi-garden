// Sign directions for the round-1 sign pick. Each draws one plot's sign in screen space, like
// drawSign in ui/garden.js (ctx already shifted by the camera; world px * Garden.S = screen px).
// Loaded by tools/signs/harness.html after the ui scripts; ?v=<key> swaps it in for drawSign.

const MONO = "'Cascadia Mono', Consolas, monospace";
const INK = '#3a2218';

// Text sizes have a floor in screen px, so boards are sized from the text, not just from S
// (zoomed out, S is small but the letters aren't).
const bigPx = (S) => Math.max(9, 4 * S);
const smallPx = (S) => Math.max(8, 3.4 * S);
const textHeight = (S, sub) => bigPx(S) * 1.1 + (sub ? smallPx(S) * 1.1 : 0);

function signText(ctx, p, font, maxW) {
  ctx.font = font;
  let title = p.title || (p.built ? 'session' : '...');
  if (ctx.measureText(title).width > maxW) {
    while (title.length > 1 && ctx.measureText(title + '…').width > maxW) title = title.slice(0, -1);
    title = title.trimEnd() + '…';
  }
  return title;
}

// A rectangle with its corner pixels knocked out, so boards read as pixel art, not UI boxes.
function notched(ctx, x, y, w, h, s, colour) {
  ctx.fillStyle = colour;
  ctx.fillRect(x + s, y, w - 2 * s, h);
  ctx.fillRect(x, y + s, w, h - 2 * s);
}

function info(p) {
  return { tokens: p.tokens ? fmtTokens(p.tokens) : '', streak: activeStreak(p) >= 3 ? `x${activeStreak(p)}` : '', f: FLAVOURS[p.flavour] || FLAVOURS.terracotta };
}

// Token count, then the streak flame and count, on one line starting at x.
function tokenLine(ctx, p, x, y, S, colour, streakColour = '#b8381f') {
  const { tokens, streak } = info(p);
  const small = `${Math.max(8, 3.4 * S)}px ${MONO}`;
  ctx.font = small;
  ctx.textBaseline = 'top';
  let w = 0;
  if (tokens) {
    ctx.fillStyle = colour;
    ctx.fillText(tokens, x, y);
    w = ctx.measureText(tokens).width;
  }
  if (streak) {
    const fx = x + w + (tokens ? 2 * S : 0);
    drawFlame(ctx, fx, y + 0.2 * S, Math.max(1, Math.round(S * 0.9)));
    ctx.fillStyle = streakColour;
    ctx.font = `bold ${Math.max(8, 3.4 * S)}px ${MONO}`;
    ctx.fillText(streak, fx + 4 * S, y);
  }
}

function tokenLineWidth(ctx, p, S) {
  const { tokens, streak } = info(p);
  ctx.font = `${Math.max(8, 3.4 * S)}px ${MONO}`;
  const tw = tokens ? ctx.measureText(tokens).width : 0;
  ctx.font = `bold ${Math.max(8, 3.4 * S)}px ${MONO}`;
  const sw = streak ? ctx.measureText(streak).width + 6 * S : 0;
  return tw + sw;
}

// --- A: pixel letters ------------------------------------------------------------------------
// The same honey plank, but every letter is drawn in true art pixels (a 3x5 font), so the sign is
// part of the pixel world instead of crisp screen text on top of it.

const GLYPHS = {
  A: ['.#.', '#.#', '###', '#.#', '#.#'], B: ['##.', '#.#', '##.', '#.#', '##.'], C: ['.##', '#..', '#..', '#..', '.##'],
  D: ['##.', '#.#', '#.#', '#.#', '##.'], E: ['###', '#..', '##.', '#..', '###'], F: ['###', '#..', '##.', '#..', '#..'],
  G: ['.##', '#..', '#.#', '#.#', '.##'], H: ['#.#', '#.#', '###', '#.#', '#.#'], I: ['###', '.#.', '.#.', '.#.', '###'],
  J: ['..#', '..#', '..#', '#.#', '.#.'], K: ['#.#', '#.#', '##.', '#.#', '#.#'], L: ['#..', '#..', '#..', '#..', '###'],
  M: ['#...#', '##.##', '#.#.#', '#...#', '#...#'], N: ['#..#', '##.#', '#.##', '#..#', '#..#'], O: ['.#.', '#.#', '#.#', '#.#', '.#.'],
  P: ['##.', '#.#', '##.', '#..', '#..'], Q: ['.#.', '#.#', '#.#', '##.', '.##'], R: ['##.', '#.#', '##.', '#.#', '#.#'],
  S: ['.##', '#..', '.#.', '..#', '##.'], T: ['###', '.#.', '.#.', '.#.', '.#.'], U: ['#.#', '#.#', '#.#', '#.#', '###'],
  V: ['#.#', '#.#', '#.#', '#.#', '.#.'], W: ['#...#', '#...#', '#.#.#', '##.##', '#...#'], X: ['#.#', '#.#', '.#.', '#.#', '#.#'],
  Y: ['#.#', '#.#', '.#.', '.#.', '.#.'], Z: ['###', '..#', '.#.', '#..', '###'],
  0: ['###', '#.#', '#.#', '#.#', '###'], 1: ['.#.', '##.', '.#.', '.#.', '###'], 2: ['##.', '..#', '.#.', '#..', '###'],
  3: ['##.', '..#', '.#.', '..#', '##.'], 4: ['#.#', '#.#', '###', '..#', '..#'], 5: ['###', '#..', '##.', '..#', '##.'],
  6: ['.##', '#..', '###', '#.#', '###'], 7: ['###', '..#', '.#.', '.#.', '.#.'], 8: ['###', '#.#', '###', '#.#', '###'],
  9: ['###', '#.#', '###', '..#', '##.'], '.': ['.', '.', '.', '.', '#'], ',': ['.', '.', '.', '#', '#'], ' ': ['..', '..', '..', '..', '..'],
  '-': ['...', '...', '###', '...', '...'], '/': ['..#', '..#', '.#.', '#..', '#..'], ':': ['.', '#', '.', '#', '.'],
  '!': ['#', '#', '#', '.', '#'], '?': ['##.', '..#', '.#.', '...', '.#.'], "'": ['#', '#', '.', '.', '.'],
  '(': ['.#', '#.', '#.', '#.', '.#'], ')': ['#.', '.#', '.#', '.#', '#.'], '&': ['.#.', '#.#', '.#.', '#.#', '.##'],
};

function glyph(ch) {
  return GLYPHS[ch.toUpperCase()] || GLYPHS['?'];
}

// Width in art pixels (1 px between letters).
function pixelWidth(text) {
  let w = 0;
  for (const ch of text) w += glyph(ch)[0].length + 1;
  return Math.max(0, w - 1);
}

function pixelFit(text, maxArt) {
  if (pixelWidth(text) <= maxArt) return text;
  while (text.length > 1 && pixelWidth(text + '..') > maxArt) text = text.slice(0, -1);
  return text.trimEnd() + '..';
}

function pixelText(ctx, text, x, y, s, colour) {
  ctx.fillStyle = colour;
  for (const ch of text) {
    const g = glyph(ch);
    g.forEach((row, j) => [...row].forEach((c, i) => c === '#' && ctx.fillRect(x + i * s, y + j * s, s, s)));
    x += (g[0].length + 1) * s;
  }
}

function signPixel(ctx, p) {
  const S = Garden.S;
  const ax = signX(p) - 2, ay = p.y * TILE + 1; // art px
  const maxArt = (p.x + PLOT_W) * TILE + 6 - ax - 4;
  const title = pixelFit(p.title || (p.built ? 'session' : '...'), maxArt);
  const { tokens, streak } = info(p);
  const room = maxArt - (streak ? pixelWidth(streak.toUpperCase()) + 6 : 0);
  const num = tokens.replace(' tokens', '').toUpperCase();
  const subFit = !tokens ? '' : pixelWidth(num + ' TOKENS') <= Math.max(room, pixelWidth(title) - (streak ? pixelWidth(streak) + 6 : 0)) ? num + ' TOKENS' : num;
  const wArt = Math.max(pixelWidth(title), pixelWidth(subFit) + (streak ? pixelWidth(streak) + 6 : 0)) + 4;
  const hArt = tokens || streak ? 15 : 9;
  const x = Math.round(ax * S), y = Math.round((ay - hArt) * S), w = wArt * S, h = hArt * S;
  // two legs into the plot
  for (const lx of [2, wArt - 4]) {
    ctx.fillStyle = INK;
    ctx.fillRect(x + lx * S, y + h, 3 * S, 4 * S);
    ctx.fillStyle = '#6b4a2b';
    ctx.fillRect(x + (lx + 1) * S, y + h, S, 3 * S);
  }
  notched(ctx, x - S, y - S, w + 2 * S, h + 2 * S, S, INK);
  ctx.fillStyle = '#c48d55';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#d9a46a'; // top light
  ctx.fillRect(x, y, w, S);
  ctx.fillStyle = '#a0703f'; // plank seam + bottom shade
  ctx.fillRect(x, y + 8 * S, w, S);
  ctx.fillRect(x, y + h - S, w, S);
  // flavour nail heads
  const { f } = info(p);
  ctx.fillStyle = f.b;
  ctx.fillRect(x + S, y + 2 * S, S, S);
  ctx.fillRect(x + w - 2 * S, y + 2 * S, S, S);
  pixelText(ctx, title, x + 2 * S, y + 2 * S, S, INK);
  if (tokens || streak) {
    pixelText(ctx, subFit, x + 2 * S, y + 10 * S, S, '#5a3a20');
    if (streak) {
      const fx = x + (2 + pixelWidth(subFit) + 2) * S;
      drawFlame(ctx, fx, y + 10 * S, S);
      pixelText(ctx, streak.toUpperCase(), fx + 4 * S, y + 10 * S, S, '#b8381f');
    }
  }
}

// --- B: hanging sign -------------------------------------------------------------------------
// A post with an arm, and the board swinging gently from two little chains.

function signHanging(ctx, p) {
  const S = Garden.S;
  const t = performance.now() / 1000;
  const px = (signX(p) - 4) * S, ground = (p.y * TILE + 4) * S;
  const big = `bold ${Math.max(9, 4 * S)}px ${MONO}`;
  const maxW = ((p.x + PLOT_W) * TILE + 6) * S - px - 10 * S;
  const title = signText(ctx, p, big, maxW);
  const { tokens, streak, f } = info(p);
  ctx.font = big;
  const w = Math.max(ctx.measureText(title).width, tokenLineWidth(ctx, p, S)) + 7 * S;
  const h = textHeight(S, tokens || streak) + 2.6 * S;
  const armY = ground - h - 9 * S;
  // post and arm
  ctx.fillStyle = INK;
  ctx.fillRect(px - S, armY - S, 3 * S, ground - armY + S);
  ctx.fillRect(px - S, armY - S, w + 6 * S, 3 * S);
  ctx.fillStyle = '#6b4a2b';
  ctx.fillRect(px, armY, S, ground - armY);
  ctx.fillRect(px, armY, w + 4 * S, S);
  ctx.fillStyle = f.b; // a flavour cap on the post
  ctx.fillRect(px - S, armY - 3 * S, 3 * S, 2 * S);
  // board hangs from the arm, swaying a pixel
  const sway = Math.round(Math.sin(t * 1.3 + p.seed) * 0.6) * S;
  const bx = px + 3 * S + sway, by = armY + 5 * S;
  ctx.fillStyle = '#7b7b7b'; // chains
  for (const cx of [bx + 2 * S, bx + w - 3 * S]) {
    ctx.fillRect(cx, armY + 2 * S, S, S);
    ctx.fillRect(cx, armY + 4 * S, S, S);
    ctx.fillStyle = '#4a4a4a';
    ctx.fillRect(cx, armY + 3 * S, S, S);
    ctx.fillStyle = '#7b7b7b';
  }
  notched(ctx, bx - S, by - S, w + 2 * S, h + 2 * S, S, INK);
  ctx.fillStyle = '#c48d55';
  ctx.fillRect(bx, by, w, h);
  ctx.fillStyle = '#a0703f';
  ctx.fillRect(bx, by + h - S, w, S);
  // a painted flavour stripe down the left edge
  ctx.fillStyle = f.b;
  ctx.fillRect(bx, by, 2 * S, h - S);
  ctx.fillStyle = INK;
  ctx.textBaseline = 'top';
  ctx.font = big;
  ctx.fillText(title, bx + 4 * S, by + 1.3 * S);
  if (tokens || streak) tokenLine(ctx, p, bx + 4 * S, by + 1.3 * S + bigPx(S) * 1.1, S, '#5a3a20');
}

// --- C: parchment ----------------------------------------------------------------------------
// A cream notice pinned in a dark wooden frame, with a ribbon in the mochi's colour.

function signParchment(ctx, p) {
  const S = Garden.S;
  const px = signX(p) * S, py = (p.y * TILE + 1) * S;
  const big = `bold ${Math.max(9, 4 * S)}px ${MONO}`;
  const maxW = ((p.x + PLOT_W) * TILE + 6) * S - px - 8 * S;
  const title = signText(ctx, p, big, maxW);
  const { tokens, streak, f } = info(p);
  ctx.font = big;
  const w = Math.max(ctx.measureText(title).width, tokenLineWidth(ctx, p, S)) + 11 * S;
  const h = textHeight(S, tokens || streak) + 5.4 * S;
  const bx = Math.round(px), by = Math.round(py - h);
  // two short posts
  for (const lx of [2 * S, w - 5 * S]) {
    ctx.fillStyle = INK;
    ctx.fillRect(bx + lx, by + h, 3 * S, 4 * S);
    ctx.fillStyle = '#6b4a2b';
    ctx.fillRect(bx + lx + S, by + h, S, 3 * S);
  }
  // frame
  notched(ctx, bx - S, by - S, w + 2 * S, h + 2 * S, S, INK);
  ctx.fillStyle = '#6b4a2b';
  ctx.fillRect(bx, by, w, h);
  ctx.fillStyle = '#8a6038';
  ctx.fillRect(bx, by, w, S);
  // paper
  ctx.fillStyle = '#f4ead2';
  ctx.fillRect(bx + 2 * S, by + 2 * S, w - 4 * S, h - 4 * S);
  ctx.fillStyle = '#e2d3b0';
  ctx.fillRect(bx + 2 * S, by + h - 3 * S, w - 4 * S, S);
  // ribbon hanging from the top-left corner, in the mochi's colour
  const rx = bx + 3 * S, rTop = by - 2 * S, rBot = by + h + 3 * S;
  ctx.fillStyle = INK;
  ctx.fillRect(rx - S, rTop - S, 5 * S, rBot - rTop);
  ctx.fillRect(rx - S, rBot - S, 2 * S, 2 * S);
  ctx.fillRect(rx + 2 * S, rBot - S, 2 * S, 2 * S);
  ctx.fillStyle = f.b;
  ctx.fillRect(rx, rTop, 3 * S, rBot - rTop - S);
  ctx.fillRect(rx, rBot - S, S, S); // forked tail
  ctx.fillRect(rx + 2 * S, rBot - S, S, S);
  ctx.fillStyle = f.s;
  ctx.fillRect(rx + 2 * S, rTop, S, rBot - rTop - S);
  ctx.fillStyle = INK;
  ctx.textBaseline = 'top';
  ctx.font = big;
  ctx.fillText(title, bx + 7.5 * S, by + 2.6 * S);
  if (tokens || streak) tokenLine(ctx, p, bx + 7.5 * S, by + 2.6 * S + bigPx(S) * 1.1, S, '#7a5a3a');
}

// --- D: seed packet --------------------------------------------------------------------------
// The sign is the seed packet the plot grew from, in the mochi's flavour, stuck on a stake.

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function signPacket(ctx, p) {
  const S = Garden.S;
  const px = signX(p) * S, py = (p.y * TILE + 1) * S;
  const big = `bold ${Math.max(9, 4 * S)}px ${MONO}`;
  const maxW = ((p.x + PLOT_W) * TILE + 6) * S - px - 6 * S;
  const title = signText(ctx, p, big, maxW);
  const { tokens, streak, f } = info(p);
  ctx.font = big;
  const w = Math.max(ctx.measureText(title).width, tokenLineWidth(ctx, p, S)) + 8 * S;
  const sub = tokens || streak;
  const bandTop = 3.6 * S + bigPx(S) * 1.15, bandH = smallPx(S) * 1.1 + 0.8 * S;
  const h = sub ? bandTop + bandH + S : bandTop + 0.6 * S;
  const bx = Math.round(px), by = Math.round(py - h);
  const light = luminance(f.b) > 0.72;
  const ink = light ? INK : '#fffaf0';
  // stake
  ctx.fillStyle = INK;
  ctx.fillRect(bx + w / 2 - 1.5 * S, by + h - 2 * S, 3 * S, 7 * S);
  ctx.fillStyle = '#c48d55';
  ctx.fillRect(bx + w / 2 - 0.5 * S, by + h - 2 * S, S, 6 * S);
  // packet
  notched(ctx, bx - S, by - S, w + 2 * S, h + 2 * S, S, INK);
  ctx.fillStyle = f.b;
  ctx.fillRect(bx, by, w, h);
  ctx.fillStyle = f.s; // shade down the right side
  ctx.fillRect(bx + w - S, by, S, h);
  // the folded top with a zigzag edge
  ctx.fillStyle = '#fff6e2';
  ctx.fillRect(bx, by, w, 2 * S);
  for (let i = 0; i < w / S; i += 2) ctx.fillRect(bx + i * S, by + 2 * S, S, S);
  // cream label band for the numbers
  if (sub) {
    ctx.fillStyle = '#fff6e2';
    ctx.fillRect(bx + S, by + bandTop, w - 2 * S, bandH);
  }
  ctx.fillStyle = ink;
  ctx.textBaseline = 'top';
  ctx.font = big;
  ctx.fillText(title, bx + 3 * S, by + 3.6 * S);
  if (sub) tokenLine(ctx, p, bx + 3 * S, by + bandTop + 0.5 * S, S, '#5a3a20');
}

// --- E: minimal tag --------------------------------------------------------------------------
// No wood at all: a small dark tag like the side panel, a flavour dot, pointing down at the plot.

function signTag(ctx, p) {
  const S = Garden.S;
  const px = signX(p) * S, py = (p.y * TILE - 1) * S;
  const big = `bold ${Math.max(9, 4 * S)}px ${MONO}`;
  const maxW = ((p.x + PLOT_W) * TILE + 6) * S - px - 10 * S;
  const title = signText(ctx, p, big, maxW);
  const { tokens, streak, f } = info(p);
  ctx.font = big;
  const w = Math.max(ctx.measureText(title).width, tokenLineWidth(ctx, p, S)) + 11.5 * S;
  const h = textHeight(S, tokens || streak) + 2.4 * S;
  const bx = Math.round(px), by = Math.round(py - h);
  ctx.globalAlpha = 0.88;
  notched(ctx, bx, by, w, h, S, '#1b1916');
  ctx.fillRect(bx + 3 * S, by + h, 3 * S, S); // pointer
  ctx.fillRect(bx + 4 * S, by + h + S, S, S);
  ctx.globalAlpha = 1;
  // flavour dot: a tiny pixel mochi ball
  ctx.fillStyle = f.b;
  ctx.fillRect(bx + 3 * S, by + 1.8 * S, 3 * S, 3 * S);
  ctx.fillRect(bx + 2.5 * S, by + 2.3 * S, 4 * S, 2 * S);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(bx + 3.5 * S, by + 2.3 * S, S * 0.8, S * 0.8);
  ctx.fillStyle = '#f2ece0';
  ctx.textBaseline = 'top';
  ctx.font = big;
  ctx.fillText(title, bx + 8 * S, by + 1.2 * S);
  if (tokens || streak) tokenLine(ctx, p, bx + 8 * S, by + 1.2 * S + bigPx(S) * 1.1, S, '#9a9387', '#ff8a5c');
}

const SIGN_VARIANTS = { current: null, pixel: signPixel, hanging: signHanging, parchment: signParchment, packet: signPacket, tag: signTag };
