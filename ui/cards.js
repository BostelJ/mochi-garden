// Acting from the garden: click a mochi and a small card pops up beside it.
//   asking for permission ("?"): what it wants to do, with [ allow ] [ deny ]
//   asking a question ("?"):     the question, with its options as buttons
//   otherwise (idle, done "!"):  a reply box; Enter sends it as the session's next prompt
// Every card has [ open ] to jump to the terminal. Answers are typed into the session's own
// terminal (Enter picks the highlighted "Yes", Esc is "No"), so the two always agree.

const Cards = { plot: null, el: null };

// What a permission request is about, in one line.
function describeTool(name, input = {}) {
  const pick = input.command || input.file_path || input.url || input.pattern || input.path || input.query || input.description;
  return pick ? String(pick).replace(/\s+/g, ' ').slice(0, 160) : '';
}

// From hook events (app.js): remember what a "?" is about, and forget it when it's answered.
function notePending(p, ev, raw) {
  if (ev.event === 'PermissionRequest') p.pending = { kind: 'perm', tool: raw.tool_name, detail: describeTool(raw.tool_name, raw.tool_input) };
  else if (ev.event === 'PreToolUse' && raw.tool_name === 'AskUserQuestion') {
    const qs = raw.tool_input?.questions || [];
    const q = qs[0] || {};
    const simple = qs.length === 1 && !q.multiSelect;
    p.pending = { kind: 'ask', question: q.question || 'it has a question', options: simple ? (q.options || []).map((o) => o.label) : [] };
  } else if (['PostToolUse', 'Stop', 'UserPromptSubmit', 'SessionEnd'].includes(ev.event) || (ev.event === 'PreToolUse' && raw.tool_name !== 'AskUserQuestion')) p.pending = null;
  if (Cards.plot === p) renderCard();
}

function openCard(p) {
  Cards.plot = p;
  renderCard();
}

function closeCard() {
  Cards.plot = null;
  if (Cards.el) Cards.el.classList.add('hidden');
}

function renderCard() {
  const p = Cards.plot;
  if (!p) return closeCard();
  if (!Cards.el) {
    Cards.el = document.createElement('div');
    Cards.el.className = 'card hidden';
    document.getElementById('garden-wrap').appendChild(Cards.el);
  }
  const el = Cards.el;
  el.textContent = '';
  el.classList.remove('hidden');
  const t = tabOfPlot(p);
  const head = document.createElement('div');
  head.className = 'card-title';
  head.textContent = p.name ? `${p.name} · ${p.title || 'new session'}` : p.title || 'new session';
  el.appendChild(head);
  const line = (text, cls) => {
    const d = document.createElement('div');
    d.className = cls || 'card-line';
    d.textContent = text;
    el.appendChild(d);
  };
  const buttons = document.createElement('div');
  buttons.className = 'card-buttons';
  const button = (label, fn, primary) => {
    const b = document.createElement('button');
    b.textContent = `[ ${label} ]`;
    if (primary) b.className = 'primary';
    b.onclick = (e) => {
      e.stopPropagation();
      fn();
    };
    buttons.appendChild(b);
    return b;
  };
  const answer = (keys) => {
    if (!t) return;
    invoke('pty_write', { tab: t.tab, data: keys }).catch(() => {});
    p.pending = null;
    p.bubble = null;
    renderList();
    closeCard();
  };

  if (p.pending?.kind === 'perm' && t) {
    line(`wants to use ${p.pending.tool}`);
    if (p.pending.detail) line(p.pending.detail, 'card-code');
    button('allow', () => answer('\r'), true);
    button('deny', () => answer('\x1b'));
  } else if (p.pending?.kind === 'ask' && t) {
    line(p.pending.question);
    p.pending.options.slice(0, 6).forEach((label, i) => button(label, () => answer('\x1b[B'.repeat(i) + '\r'), i === 0));
  } else if (t && p.live) {
    line(p.bubble === '!' ? 'done. reply to keep it going:' : p.activity === 'working' ? 'working… (your reply will queue)' : 'reply:');
    const input = document.createElement('input');
    input.className = 'card-input';
    input.placeholder = 'type a reply, Enter to send';
    input.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && input.value.trim()) {
        const text = input.value;
        invoke('pty_write', { tab: t.tab, data: text }).catch(() => {});
        // a beat later, so Claude Code reads the Enter as "send", not as part of a paste
        setTimeout(() => invoke('pty_write', { tab: t.tab, data: '\r' }).catch(() => {}), 120);
        p.bubble = null;
        renderList();
        closeCard();
      } else if (e.key === 'Escape') closeCard();
    };
    el.appendChild(input);
    setTimeout(() => input.focus(), 40);
  } else line('asleep. open it to wake the session up.');
  button('open', () => {
    closeCard();
    pickPlot(p, true);
  });
  el.appendChild(buttons);
  positionCard();
}

// Keep the card beside its mochi as the camera moves.
function positionCard() {
  const p = Cards.plot, el = Cards.el;
  if (!p || !el || !p.m) return;
  const S = Garden.cam.zoom;
  const x = (p.m.x + 15 - Garden.cam.x) * S, y = (p.m.y - 4 - Garden.cam.y) * S;
  const w = el.offsetWidth, h = el.offsetHeight;
  const maxX = Garden.viewW - w - 8, maxY = Garden.viewH - h - 8;
  el.style.left = Math.max(8, Math.min(maxX, x)) + 'px';
  el.style.top = Math.max(8, Math.min(maxY, y - h / 2)) + 'px';
}

// The garden's frame loop keeps the card beside its mochi (garden.js calls positionCard).
