// Render the wardrobe (ui/wardrobe.js) on mochis to a labelled PNG sheet, without the app:
// node tools/render_wardrobe.mjs <out.png>
// Uses @napi-rs/canvas as the browser canvas; the UI scripts run as classic scripts sharing globals.
import { readFileSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';
import { createCanvas } from '@napi-rs/canvas';
import { asScript } from './ui-script.mjs';

const ui = (f) => new URL('../ui/' + f, import.meta.url);
globalThis.document = { createElement: () => createCanvas(1, 1), hidden: true };
const run = (file) => vm.runInThisContext(asScript(readFileSync(ui(file), 'utf8')), { filename: file });
run('sprites.js');
run('wardrobe.js');
const { WEAR, WEAR_ORDER, WEAR_COLOURS, drawWear, mochiSprite } = vm.runInThisContext('({ WEAR, WEAR_ORDER, WEAR_COLOURS, drawWear, mochiSprite })');

const S = 6, CW = 28, CH = 32, LABEL = 5; // scale, cell size in world px, label room
const items = Object.keys(WEAR);
const colourable = items.filter((k) => WEAR[k].colour);

// rows of cells: { label, flavour, pose, wear: [[item, colour]] }
const sections = [];
const sec = (title, cells) => sections.push({ title, cells });
sec('every item, default colour (terracotta, idle)', items.map((k) => ({ label: k, wear: [[k]] })));
sec('colour variants', colourable.flatMap((k) => ['navy', 'white', 'green'].map((c) => ({ label: `${k} ${c}`, wear: [[k, c]] }))));
sec('outfits', [
  ['wizardhat+cape+glasses', [['cape', 'navy'], ['glasses'], ['wizardhat']]],
  ['crown+bowtie+monocle', [['bowtie', 'black'], ['monocle'], ['crown']]],
  ['catears+bell', [['bell'], ['catears']]],
  ['beanie+scarf', [['scarf'], ['beanie']]],
  ['strawhat+bandana', [['bandana', 'blue'], ['strawhat']]],
  ['tophat+mustache+bowtie', [['bowtie'], ['mustache'], ['tophat']]],
  ['halo+wings', [['wings'], ['halo']]],
  ['headphones+backpack', [['backpack'], ['headphones']]],
  ['sprout+leaf', [['leaf'], ['sprout']]],
  ['flowercrown+lei+freckles', [['lei'], ['freckles'], ['flowercrown']]],
  ['chefhat+sunglasses', [['sunglasses'], ['chefhat']]],
  ['partyhat+bowtie', [['bowtie', 'yellow'], ['partyhat', 'pink']]],
].flatMap(([label, wear]) => ['idle', 'back', 'sleep'].map((pose) => ({ label: `${label} ${pose}`, wear, pose }))));
sec('from behind (back pose)', items.map((k) => ({ label: k, wear: [[k]], pose: 'back' })));
sec('asleep', items.map((k) => ({ label: k, wear: [[k]], pose: 'sleep' })));
for (const f of ['matcha', 'ube', 'vanilla', 'mango']) sec(`on ${f}`, items.map((k) => ({ label: k, wear: [[k]], flavour: f })));

const PER_ROW = 18, TITLE = 6;
let H = 0;
for (const s of sections) H += TITLE + Math.ceil(s.cells.length / PER_ROW) * (CH + LABEL);
const W = PER_ROW * CW;

const cv = createCanvas(W, H), g = cv.getContext('2d');
g.fillStyle = '#a7c274';
g.fillRect(0, 0, W, H);
const specks = ['#b2ca80', '#9cb768', '#a0bb6c', '#b0c87e'];
for (let i = 0; i < (W * H) / 14; i++) {
  g.fillStyle = specks[i % 4];
  g.fillRect(Math.floor(Math.random() * W), Math.floor(Math.random() * H), 1, 1);
}

const labels = [], titles = [];
let y0 = 0;
for (const s of sections) {
  titles.push({ text: s.title, y: y0 });
  if (process.env.SECTIONS) console.log(s.title, y0 * S);
  y0 += TITLE;
  s.cells.forEach((c, i) => {
    const cx = (i % PER_ROW) * CW, cy = y0 + Math.floor(i / PER_ROW) * (CH + LABEL);
    const x = cx + 7, y = cy + 14, pose = c.pose || 'idle', fl = c.flavour || 'terracotta';
    const order = pose === 'back' ? WEAR_ORDER.fromBehind : WEAR_ORDER;
    const slotOf = (k) => WEAR[k].slot;
    const wearIn = (slots) => slots.forEach((slot) => c.wear.filter(([k]) => slotOf(k) === slot).forEach(([k, col]) => drawWear(g, k, col, x, y, pose)));
    g.fillStyle = 'rgba(40, 50, 20, 0.25)';
    g.fillRect(x + 2, y + 10, 9, 2);
    wearIn(order.under);
    g.drawImage(mochiSprite(fl, pose), x, y + (pose === 'sleep' ? 3 : 0));
    wearIn(order.over);
    labels.push({ text: c.label, x: cx, y: cy + CH });
  });
  y0 += Math.ceil(s.cells.length / PER_ROW) * (CH + LABEL);
}

const out = createCanvas(W * S, H * S), o = out.getContext('2d');
o.imageSmoothingEnabled = false;
o.drawImage(cv, 0, 0, W * S, H * S);
o.textBaseline = 'top';
o.font = 'bold 22px Consolas, monospace';
o.fillStyle = '#3a2218';
for (const t of titles) o.fillText(t.text, 8, t.y * S + 8);
o.font = '15px Consolas, monospace';
for (const l of labels) {
  const parts = l.text.length > 19 ? [l.text.slice(0, l.text.lastIndexOf(' ', 19) > 0 ? l.text.lastIndexOf(' ', 19) : 19), l.text.slice(l.text.lastIndexOf(' ', 19) > 0 ? l.text.lastIndexOf(' ', 19) + 1 : 19)] : [l.text];
  parts.forEach((p, i) => {
    o.fillStyle = 'rgba(58, 34, 24, 0.75)';
    o.fillRect(l.x * S + 4, l.y * S - 10 + i * 16, o.measureText(p).width + 6, 16);
    o.fillStyle = '#fff7e0';
    o.fillText(p, l.x * S + 7, l.y * S - 9 + i * 16);
  });
}
writeFileSync(process.argv[2], out.toBuffer('image/png'));
console.log('->', process.argv[2], W * S + 'x' + H * S, Object.keys(WEAR).length, 'items', Object.keys(WEAR_COLOURS).length, 'colours');
