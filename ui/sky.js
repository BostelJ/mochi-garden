// The sky over the garden. What's left of the 5-hour window is the time of day: a fresh window is
// morning, then midday, golden hour, dusk, and night when it's spent (fireflies, lanterns glowing).
// What's left of the week is the season: spring, summer, autumn, winter. Resets bring a sunrise
// and a burst of spring.

// Light: a multiply tint over the scene, by fraction of the 5-hour window left.
const LIGHT = [
  [1.0, [236, 242, 255]], // early morning, cool
  [0.8, [255, 255, 255]],
  [0.5, [255, 255, 255]], // midday
  [0.3, [255, 218, 170]], // golden hour
  [0.15, [236, 168, 172]], // dusk
  [0.06, [120, 118, 176]], // twilight
  [0.0, [74, 82, 140]], // night
];

// Season: grass palettes by fraction of the week left.
const SEASONS = [
  [1.0, { base: '#a7c274', specks: ['#b2ca80', '#9cb768', '#a0bb6c', '#b0c87e'], tuft: '#6f9447', tuftHi: '#86a957' }], // spring
  [0.62, { base: '#94bb5c', specks: ['#a3c86a', '#88ad52', '#8cb256', '#9fc465'], tuft: '#5d8a38', tuftHi: '#78a347' }], // summer
  [0.36, { base: '#c0b067', specks: ['#ccb96f', '#b49f57', '#c7a85a', '#d0bf78'], tuft: '#9a7d3c', tuftHi: '#b38f45' }], // autumn
  [0.14, { base: '#d9e0de', specks: ['#eef2f2', '#c9d3d2', '#f6f8f8', '#bfcac6'], tuft: '#9aa9a3', tuftHi: '#b7c3be' }], // winter
  [0.0, { base: '#e4eaea', specks: ['#f4f7f7', '#d6dede', '#ffffff', '#cdd6d6'], tuft: '#a9b6b1', tuftHi: '#c3cdc9' }],
];

const Sky = { particles: [], grassKey: null };

// With no numbers yet, it's a calm late-morning spring day.
function fiveLeft() {
  return current('five') ? left('five') : 0.65;
}
function weekLeft() {
  return current('week') ? left('week') : 0.85;
}

function lerp(a, b, k) {
  return a + (b - a) * k;
}
function lerpRgb(a, b, k) {
  return a.map((v, i) => Math.round(lerp(v, b[i], k)));
}
function hexRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}
function rgbHex(c) {
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
}

// Piecewise-linear lookup over [value, payload] stops sorted high to low.
function stopsAt(stops, v, mix) {
  for (let i = 0; i < stops.length - 1; i++) {
    const [a, pa] = stops[i], [b, pb] = stops[i + 1];
    if (v <= a && v >= b) return mix(pa, pb, a === b ? 0 : (a - v) / (a - b));
  }
  return v > stops[0][0] ? stops[0][1] : stops[stops.length - 1][1];
}

function seasonPalette(w) {
  return stopsAt(SEASONS, w, (a, b, k) => ({
    base: rgbHex(lerpRgb(hexRgb(a.base), hexRgb(b.base), k)),
    specks: a.specks.map((s, i) => rgbHex(lerpRgb(hexRgb(s), hexRgb(b.specks[i]), k))),
    tuft: rgbHex(lerpRgb(hexRgb(a.tuft), hexRgb(b.tuft), k)),
    tuftHi: rgbHex(lerpRgb(hexRgb(a.tuftHi), hexRgb(b.tuftHi), k)),
  }));
}

function seasonName(w) {
  return w > 0.7 ? 'spring' : w > 0.45 ? 'summer' : w > 0.2 ? 'autumn' : 'winter';
}

// Bar colours for the side panel: sun gold fading to dusk; the season's colour.
function fiveColour() {
  const r = fiveLeft();
  return r > 0.35 ? '#f2c14e' : r > 0.12 ? '#e98a6b' : '#8f8fd6';
}
function seasonColour() {
  return { spring: '#f29ac2', summer: '#8db580', autumn: '#e0913c', winter: '#bfdbe8' }[seasonName(weekLeft())];
}

// The grass is re-rendered when the season moves on (in small steps, so it shifts gradually).
function seasonGrass() {
  const key = Math.round(weekLeft() * 25) + ':' + Garden.cols + 'x' + Garden.rows;
  if (key !== Sky.grassKey) {
    Sky.grassKey = key;
    Garden.grass = drawGrass(Garden.cols, Garden.rows, seasonPalette(weekLeft()));
    renderUsageBar();
  }
}

// Weather -----------------------------------------------------------------------------------

function updateSky(dt, t) {
  checkResets(t);
  seasonGrass();
  const v = viewRect(); // weather only where you're looking
  const season = seasonName(weekLeft());
  const night = Math.max(0, Math.min(1, (0.2 - fiveLeft()) / 0.2));
  const spring = Usage.springAt && t - Usage.springAt < 6;
  // How much of each drifts through: petals in spring, the odd butterfly in summer, leaves in
  // autumn, snow in winter, fireflies at night; a flurry of petals when the week resets.
  const want = {
    petal: spring ? 90 : season === 'spring' ? 14 : 0,
    butterfly: season === 'summer' && night < 0.5 ? 3 : 0,
    leaf: season === 'autumn' ? 16 : 0,
    snow: season === 'winter' ? 60 : 0,
    firefly: Math.round(night * 28),
  };
  for (const [kind, n] of Object.entries(want)) {
    const have = Sky.particles.filter((p) => p.kind === kind).length;
    for (let i = have; i < n; i++) Sky.particles.push(newParticle(kind, v, have === 0 && kind !== 'petal'));
  }
  for (const p of Sky.particles) {
    p.age += dt;
    if (p.kind === 'firefly' || p.kind === 'butterfly') {
      p.x += Math.cos(p.age * p.f + p.ph) * p.v * dt;
      p.y += Math.sin(p.age * p.f * 0.7 + p.ph) * p.v * 0.7 * dt;
    } else {
      p.x += (p.vx + Math.sin(p.age * p.f + p.ph) * p.sway) * dt;
      p.y += p.vy * dt;
    }
  }
  Sky.particles = Sky.particles.filter((p) => p.age < p.life && p.y < v.y + v.h + 6 && (want[p.kind] || 0) >= 0 && !(p.kind !== 'petal' && !want[p.kind] && p.age > 1));
}

function newParticle(kind, v, anywhere) {
  const p = { kind, age: 0, ph: Math.random() * 6, f: 1 + Math.random() * 2 };
  if (kind === 'firefly' || kind === 'butterfly') {
    Object.assign(p, { x: v.x + Math.random() * v.w, y: v.y + Math.random() * v.h, v: kind === 'firefly' ? 6 : 14, life: 8 + Math.random() * 8 });
  } else {
    const fall = { petal: 10, leaf: 13, snow: 9 }[kind];
    Object.assign(p, {
      x: v.x + Math.random() * (v.w + 40) - 20,
      y: v.y + (anywhere ? Math.random() * v.h : -4 - Math.random() * 30),
      vx: kind === 'leaf' ? 6 : 3,
      vy: fall * (0.7 + Math.random() * 0.6),
      sway: kind === 'snow' ? 4 : 10,
      life: 40,
      colour: kind === 'petal' ? (Math.random() < 0.5 ? '#f6b8cf' : '#fbd6e3') : kind === 'leaf' ? ['#d9822b', '#c0533f', '#e9b44c'][Math.floor(Math.random() * 3)] : '#ffffff',
    });
  }
  return p;
}

function drawWeather(g, t) {
  for (const p of Sky.particles) {
    const x = Math.round(p.x), y = Math.round(p.y);
    if (p.kind === 'firefly') {
      const on = Math.sin(t * 3 + p.ph * 3) > -0.2;
      if (!on) continue;
      g.fillStyle = '#f6f2a0';
      g.fillRect(x, y, 1, 1);
      g.fillStyle = 'rgba(246, 242, 160, 0.35)';
      g.fillRect(x - 1, y, 3, 1);
      g.fillRect(x, y - 1, 1, 3);
    } else if (p.kind === 'butterfly') {
      const flap = Math.sin(t * 14 + p.ph) > 0;
      g.fillStyle = '#f2c14e';
      g.fillRect(x - 1, y, 1, flap ? 2 : 1);
      g.fillRect(x + 1, y, 1, flap ? 2 : 1);
      g.fillStyle = '#3a2218';
      g.fillRect(x, y, 1, 2);
    } else if (p.kind === 'snow') {
      g.fillStyle = p.colour;
      g.fillRect(x, y, 1, 1);
    } else {
      g.fillStyle = p.colour;
      g.fillRect(x, y, 2, 1);
      if (Math.sin(p.age * p.f + p.ph) > 0) g.fillRect(x + 1, y + 1, 1, 1); // tumbling
    }
  }
}

// Light ----------------------------------------------------------------------------------------

function drawSkyLight(ctx, w, h, t) {
  const r = fiveLeft();
  const tint = stopsAt(LIGHT, r, (a, b, k) => lerpRgb(a, b, k));
  ctx.save();
  if (tint.some((v) => v < 255)) {
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = `rgb(${tint.join(',')})`;
    ctx.fillRect(0, 0, w, h);
  }
  // The sun's warm side: it rises on the left and sets on the right as the window is used.
  const sunAlpha = r > 0.1 ? stopsAt([[1, 0.16], [0.6, 0.06], [0.3, 0.22], [0.12, 0.16], [0.1, 0]], r, lerp) : 0;
  if (sunAlpha > 0) {
    const sx = Math.round(w * (0.05 + 0.9 * (1 - r))), sy = -h * 0.2, a = sunAlpha.toFixed(3);
    const sun = cachedLayer('sun', `${sx}:${a}`, w, h, (g) => {
      const grad = g.createRadialGradient(sx, sy, 0, sx, sy, Math.max(w, h) * 0.9);
      grad.addColorStop(0, `rgba(255, 214, 140, ${a})`);
      grad.addColorStop(1, 'rgba(255, 214, 140, 0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
    });
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(sun, 0, 0, w, h);
  }
  // At night the plots' lanterns glow.
  const night = Math.max(0, Math.min(1, (0.2 - r) / 0.2));
  if (night > 0) {
    ctx.globalCompositeOperation = 'lighter';
    const S = Garden.S;
    // the lanterns and campfires the gardens' sessions built
    for (const p of Garden.plots) {
      if (p.x == null) continue;
      for (const pc of p.pieces || []) {
        if ((pc.k !== 'lantern' && pc.k !== 'campfire') || pc.b < 1) continue;
        const lamp = pc.k === 'lantern' ? -6 : 10; // the lantern's lamp hangs high; a campfire burns low
        const lx = ((p.x + pc.x) * TILE + 8 - Garden.cam.x) * S, ly = ((p.y + pc.y) * TILE + lamp - Garden.cam.y) * S;
        const flicker = 0.85 + 0.15 * Math.sin(t * 7 + p.seed + pc.x);
        const grad = ctx.createRadialGradient(lx, ly, 0, lx, ly, 28 * S);
        grad.addColorStop(0, `rgba(255, 200, 110, ${0.45 * night * flicker})`);
        grad.addColorStop(1, 'rgba(255, 200, 110, 0)');
        ctx.fillStyle = grad;
        ctx.fillRect(lx - 28 * S, ly - 28 * S, 56 * S, 56 * S);
      }
    }
    // and the town square's string lights, bulb by bulb (town.js)
    for (const b of typeof townLightSpots === 'function' ? townLightSpots() : []) {
      const lx = (b.x - Garden.cam.x) * S, ly = (b.y - Garden.cam.y) * S;
      const grad = ctx.createRadialGradient(lx, ly, 0, lx, ly, 10 * S);
      grad.addColorStop(0, `rgba(255, 210, 130, ${0.35 * night})`);
      grad.addColorStop(1, 'rgba(255, 210, 130, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(lx - 10 * S, ly - 10 * S, 20 * S, 20 * S);
    }
  }
  // A new 5-hour window: a sunrise sweeps across.
  if (Usage.sunriseAt && t - Usage.sunriseAt < 3) {
    const k = (t - Usage.sunriseAt) / 3;
    const x = w * (k * 1.4 - 0.2);
    const grad = ctx.createLinearGradient(x - w * 0.3, 0, x + w * 0.3, 0);
    grad.addColorStop(0, 'rgba(255, 220, 150, 0)');
    grad.addColorStop(0.5, `rgba(255, 220, 150, ${0.35 * (1 - k)})`);
    grad.addColorStop(1, 'rgba(255, 220, 150, 0)');
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.restore();
}
