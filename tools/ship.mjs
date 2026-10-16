// npm run ship: build Mochi Garden and install it into the running app.
// Builds into src-tauri/target-ship (so a running exe never blocks the build), stages the result
// in the app's data folder and hands it to the app, which installs it and restarts once no mochi
// is busy (src-tauri/src/update.rs, ui/update.js). If the app isn't running, it installs now.
//   node tools/ship.mjs [--no-build]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mac = process.platform === 'darwin';
const targetDir = path.join(root, 'src-tauri', 'target-ship');
const dataDir =
  process.env.MOCHI_DATA_DIR ||
  (mac
    ? path.join(os.homedir(), 'Library', 'Application Support', 'MochiGarden')
    : path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'MochiGarden'));

if (!process.argv.includes('--no-build')) {
  // Windows only needs the exe (the page is built into it); a Mac needs the .app bundle.
  const args = ['tauri', 'build', ...(mac ? ['--bundles', 'app'] : ['--no-bundle'])];
  const r = spawnSync('npx', args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, CARGO_TARGET_DIR: targetDir },
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const built = mac
  ? path.join(targetDir, 'release', 'bundle', 'macos', 'Mochi Garden.app')
  : path.join(targetDir, 'release', 'mochi-garden.exe');
if (!fs.existsSync(built)) fail(`no build at ${built}`);

let info = null;
try {
  info = JSON.parse(fs.readFileSync(path.join(dataDir, 'app.json'), 'utf8'));
} catch {}

// Stage a copy, so the next build can't change it before the app gets round to installing it.
const staged = path.join(dataDir, 'update', String(Date.now()), path.basename(built));
fs.mkdirSync(path.dirname(staged), { recursive: true });
fs.cpSync(built, staged, { recursive: true });

if (info?.port && running(info.pid)) {
  try {
    const res = await fetch(`http://127.0.0.1:${info.port}/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: info.token, path: staged }),
    });
    if (!res.ok) fail(`the app said no: ${res.status} ${await res.text()}`);
    console.log('Update handed to Mochi Garden: it installs and restarts once your mochis are idle.');
    process.exit(0);
  } catch (e) {
    if (running(info.pid)) fail(`couldn't reach the app on port ${info.port}: ${e.message}`);
  }
}

// Not running: put it in place now (where it last ran, else the installer's default spot).
const defaultInstall = mac
  ? '/Applications/Mochi Garden.app'
  : path.join(process.env.LOCALAPPDATA || '', 'Mochi Garden', 'mochi-garden.exe');
const target = info?.install || (fs.existsSync(defaultInstall) ? defaultInstall : null);
if (!target) {
  fail(
    mac
      ? `Mochi Garden hasn't run on this Mac yet: drag ${built} into /Applications and open it once.`
      : 'Mochi Garden has never run here: install it with `npx tauri build --bundles nsis` and the setup exe.'
  );
}
fs.rmSync(target, { recursive: true, force: true });
fs.cpSync(staged, target, { recursive: true });
fs.rmSync(path.join(dataDir, 'update'), { recursive: true, force: true });
console.log(`Installed to ${target} (the app wasn't running).`);

function running(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

function fail(msg) {
  console.error(`ship: ${msg}`);
  process.exit(1);
}
