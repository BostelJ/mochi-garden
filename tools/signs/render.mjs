// Render each sign direction in the real garden with headless Edge (driven over CDP):
//   node tools/signs/render.mjs <out dir> [variant ...]
// Writes <variant>_close.png (three plots at the camera's real zoom) and <variant>_far.png
// (the eight-plot demo garden, zoomed out) per variant.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9447;
const out = resolve(process.argv[2] || '.');
const variants = process.argv.slice(3).length ? process.argv.slice(3) : ['current', 'pixel', 'hanging', 'parchment', 'packet', 'tag'];
// harness.html + the app's own script list (minus its inline error hook), as harness.gen.html
const ui = readFileSync(resolve(import.meta.dirname, '../../ui/index.html'), 'utf8');
const scripts = [...ui.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => `<script src="../../ui/${m[1]}"></script>`).join('\n');
const gen = resolve(import.meta.dirname, 'harness.gen.html');
writeFileSync(gen, readFileSync(resolve(import.meta.dirname, 'harness.html'), 'utf8').replace(/<!-- UI_SCRIPTS.*-->/, scripts));
const page = pathToFileURL(gen).href;
mkdirSync(out, { recursive: true });

const edge = spawn(EDGE, [
  '--headless=new', '--hide-scrollbars', `--user-data-dir=${join(tmpdir(), 'mochi-signs-edge')}`,
  '--allow-file-access-from-files', `--remote-debugging-port=${PORT}`, 'about:blank',
], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    await sleep(200);
    try {
      target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page');
    } catch {}
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (pending.has(msg.id)) pending.get(msg.id)(msg.result), pending.delete(msg.id);
  };
  const send = (method, params = {}) => new Promise((r) => (pending.set(++id, r), ws.send(JSON.stringify({ id, method, params }))));
  await send('Emulation.setDeviceMetricsOverride', { width: 1050, height: 860, deviceScaleFactor: 1.875, mobile: false });
  for (const v of variants) {
    for (const scene of ['close', 'far']) {
      await send('Page.navigate', { url: `${page}?v=${v}&scene=${scene}` });
      await sleep(5000); // the camera eases in and the mochis settle at their desks
      const st = await send('Runtime.evaluate', { expression: 'JSON.stringify({ errors: window.__errors, plots: Garden.plots.length, S: Garden.S, scene: __signQuery.get(\'scene\'), titles: Garden.plots.map((p) => p.title) })', returnByValue: true });
      console.log(v, scene, st?.result?.value);
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      const file = join(out, `${v}_${scene}.png`);
      writeFileSync(file, Buffer.from(shot.data, 'base64'));
      console.log('->', file);
    }
  }
  ws.close();
} finally {
  edge.kill();
}
