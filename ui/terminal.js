// Terminal comforts: clipboard (copy a selection, paste text, or paste a screenshot, which hands
// Claude Code its own image-paste key so it attaches the clipboard image; right-click copies or
// pastes like Windows Terminal), Ctrl/Cmd+click opens links in the default browser, and the app's
// own shortcuts, which the terminal never sees:
//   Windows: Ctrl+Shift+T new session · Ctrl+Shift+W end session · Ctrl+1..9 jump to a session
//   Mac:     Cmd+T new session · Cmd+W end session · Cmd+1..9 jump to a session
//   both:    Ctrl+Tab / Ctrl+Shift+Tab cycle · Shift+Enter new line
// (On Windows plain Ctrl+T and Ctrl+W stay with Claude Code: task list and delete-word.)

import { saveNow } from './persist.js';
import { closeTab, newSession, select } from './sessions.js';
import { tabs, ui } from './state.js';
import { invoke } from './tauri.js';

export const IS_MAC = /Mac/.test(navigator.platform);
// The app's modifier: Cmd on a Mac (Ctrl belongs to the terminal there), Ctrl on Windows.
export const mod = (e) => (IS_MAC ? e.metaKey : e.ctrlKey);
// Claude Code reads the clipboard image itself when it gets its image-paste key: Alt+V on
// Windows (Ctrl+V is the terminal's text paste there), Ctrl+V on a Mac.
export const IMAGE_PASTE_KEY = IS_MAC ? '\x16' : '\x1bv';

export function makeTerminal(el) {
  const term = new Terminal({
    fontFamily: "'Cascadia Mono', Consolas, 'SF Mono', Menlo, monospace",
    fontSize: 13,
    scrollback: 5000,
    cursorBlink: true,
    theme: { background: '#141414', foreground: '#d8d8d8', cursor: '#d8d8d8', selectionBackground: '#3a3a3a' },
    // OSC 8 hyperlinks (Claude Code prints file and web links this way)
    linkHandler: { activate: (e, uri) => openLink(e, uri), allowNonHttpProtocols: false },
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.loadAddon(new WebLinksAddon.WebLinksAddon((e, uri) => openLink(e, uri)));
  term.attachCustomKeyEventHandler((e) => {
    // Shift+Enter is a new line, not "send": xterm sends the same \r for both, so hand Claude
    // Code Meta+Enter (ESC CR), its own newline key. preventDefault stops the keypress that
    // would otherwise still send the \r.
    if (e.key === 'Enter' && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
      if (e.type === 'keydown') {
        e.preventDefault();
        term.input('\x1b\r');
      }
      return false;
    }
    if (e.type !== 'keydown') return true;
    const k = e.key.toLowerCase();
    if (isAppShortcut(e)) return false;
    if (mod(e) && k === 'c' && (IS_MAC || e.shiftKey || term.hasSelection())) {
      if (term.hasSelection()) copyText(term.getSelection());
      term.clearSelection();
      return false;
    }
    // Ctrl+V / Ctrl+Shift+V (Cmd+V): let the browser's paste event through (below).
    if (mod(e) && k === 'v') return false;
    return true;
  });
  term.open(el);
  // Text pastes as text (xterm handles it); a clipboard holding only a picture, like a fresh
  // screenshot, becomes Claude Code's image-paste key instead.
  el.addEventListener(
    'paste',
    (e) => {
      const cd = e.clipboardData;
      if (!cd || cd.getData('text/plain')) return;
      if (![...cd.items].some((i) => i.kind === 'file' && i.type.startsWith('image/'))) return;
      e.preventDefault();
      e.stopPropagation();
      term.input(IMAGE_PASTE_KEY);
    },
    true
  );
  el.addEventListener('contextmenu', async (e) => {
    e.preventDefault();
    if (term.hasSelection()) {
      copyText(term.getSelection());
      term.clearSelection();
    } else {
      try {
        const text = await navigator.clipboard.readText();
        if (text) term.paste(text);
        else if (await clipboardHasImage()) term.input(IMAGE_PASTE_KEY);
      } catch {}
    }
  });
  return { term, fit };
}

export async function clipboardHasImage() {
  try {
    const items = await navigator.clipboard.read();
    return items.some((i) => i.types.some((t) => t.startsWith('image/')));
  } catch {
    return false;
  }
}

export function openLink(e, uri) {
  if (!mod(e)) return; // Ctrl/Cmd+click, as in Windows Terminal, so selecting text never opens links
  invoke('open_url', { url: uri }).catch(() => {});
}

export function copyText(text) {
  navigator.clipboard.writeText(text).catch(() => {});
}

export function isAppShortcut(e) {
  if (e.altKey) return false;
  const k = e.key.toLowerCase();
  if (e.ctrlKey && k === 'tab') return true;
  if (!mod(e)) return false;
  if ((e.shiftKey || IS_MAC) && (k === 't' || k === 'w')) return true;
  return !e.shiftKey && /^[1-9]$/.test(e.key);
}

// Runs in the capture phase, before the terminal sees the key.
export function onAppShortcut(e) {
  if (!isAppShortcut(e)) return;
  e.preventDefault();
  e.stopPropagation();
  const k = e.key.toLowerCase();
  const ids = [...tabs.keys()];
  if (k === 't') newSession();
  else if (k === 'w') ui.activeTab && closeTab(ui.activeTab);
  else if (k === 'tab' && ids.length) {
    const i = ids.indexOf(ui.activeTab);
    select(ids[(i + (e.shiftKey ? -1 : 1) + ids.length) % ids.length]);
  } else if (ids[Number(e.key) - 1]) select(ids[Number(e.key) - 1]);
}

// A small dialog in the app's own plain style; resolves with the chosen button's key.
export function showModal({ title, lines, buttons }) {
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'modal-back';
    const box = document.createElement('div');
    box.className = 'modal';
    const h = document.createElement('div');
    h.className = 'modal-title';
    h.textContent = title;
    box.appendChild(h);
    for (const line of lines) {
      const p = document.createElement('div');
      p.className = 'modal-line';
      if (line instanceof Node) p.appendChild(line);
      else p.textContent = line;
      box.appendChild(p);
    }
    const row = document.createElement('div');
    row.className = 'modal-buttons';
    const done = (key) => {
      back.remove();
      document.removeEventListener('keydown', onKey, true);
      resolve(key);
    };
    buttons.forEach(([key, label], i) => {
      const b = document.createElement('button');
      b.textContent = `[ ${label} ]`;
      if (i === 0) b.className = 'primary';
      b.onclick = () => done(key);
      row.appendChild(b);
    });
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        done(buttons[buttons.length - 1][0]);
      } else if (e.key === 'Enter') {
        e.stopPropagation();
        e.preventDefault();
        done(buttons[0][0]);
      }
    };
    document.addEventListener('keydown', onKey, true);
    box.appendChild(row);
    back.appendChild(box);
    document.body.appendChild(back);
    row.firstChild?.focus();
  });
}

// Closing the window: with sessions open, keep them running in the tray or quit (they come back
// on the next launch either way).
export async function onCloseRequested() {
  const live = [...tabs.values()].filter((t) => t.plot.live);
  if (!live.length) {
    await saveNow();
    invoke('quit_app');
    return;
  }
  const working = live.filter((t) => t.plot.activity === 'working').length;
  const choice = await showModal({
    title: 'close mochi garden?',
    lines: [
      `${live.length} session${live.length > 1 ? 's' : ''} open${working ? `, ${working} still working` : ''}.`,
      'Keeping the garden in the tray lets your sessions carry on. Quitting ends them, and they come back the next time you open the garden.',
    ],
    buttons: [['tray', 'keep running in tray'], ['quit', 'quit'], ['cancel', 'cancel']],
  });
  if (choice === 'tray') invoke('hide_main');
  else if (choice === 'quit') {
    await saveNow();
    invoke('quit_app');
  }
}
