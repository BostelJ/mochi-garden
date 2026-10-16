// Self-update (src-tauri/src/update.rs): when `npm run ship` hands the app a new build, a bar
// says so and the update installs itself once the garden is quiet: no mochi working or asking,
// and nothing typed for a little while (so a half-written prompt is never lost). Open sessions
// come back after the restart. [ install now ] skips the wait.

import { saveNow } from './persist.js';
import { tabs } from './state.js';
import { currentWindow, invoke } from './tauri.js';

export const UPDATE_QUIET_MS = 5000; // nothing busy for this long...
export const UPDATE_TYPING_MS = 20000; // ...and no keys pressed for this long
export let updateWaiting = false;
export let updateQuietSince = null;
export let lastKeyAt = 0;

window.addEventListener('keydown', () => (lastKeyAt = Date.now()), true);
setInterval(tryUpdate, 1000);

// A local build from `npm run ship` (no payload) or a newer release ({ version }).
export function onUpdateReady(ev) {
  updateWaiting = true;
  updateQuietSince = null;
  const v = ev?.payload?.version;
  updateBar(`${v ? `v${v} ` : 'update '}ready · installs when your mochis are idle`, true);
}

export function onUpdateFailed(ev) {
  updateBar(`update failed: ${ev?.payload || 'unknown error'} · it'll try again later`, false);
}

export function updateBar(text, withButton) {
  let bar = document.getElementById('update');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'update';
    document.getElementById('usage').after(bar);
  }
  bar.textContent = '';
  const msg = document.createElement('span');
  msg.textContent = text;
  bar.appendChild(msg);
  if (withButton) {
    const b = document.createElement('button');
    b.textContent = '[ install now ]';
    b.onclick = installUpdate;
    bar.appendChild(b);
  }
}

export function mochisBusy() {
  return [...tabs.values()].some((t) => t.plot.live && (t.plot.activity === 'working' || t.plot.bubble === '?'));
}

export function tryUpdate() {
  if (!updateWaiting) return;
  if (mochisBusy() || Date.now() - lastKeyAt < UPDATE_TYPING_MS) {
    updateQuietSince = null;
    return;
  }
  updateQuietSince ??= Date.now();
  if (Date.now() - updateQuietSince >= UPDATE_QUIET_MS) installUpdate();
}

export async function installUpdate() {
  updateWaiting = false;
  updateBar('updating…', false);
  await saveNow();
  let hidden = false;
  try {
    hidden = !(await currentWindow().isVisible());
  } catch {}
  try {
    await invoke('apply_update', { hidden });
  } catch (e) {
    updateBar(`update failed: ${e}`, false);
  }
}
