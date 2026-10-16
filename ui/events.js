// Claude Code's events for each tab: hooks (hooks.rs), token counts read from transcripts, the
// session registry, and sessions followed through the status line.

import { notePending } from './cards.js';
import { placePlot } from './garden.js';
import { noteWeekTokens } from './harvest.js';
import { helperDone, helperWorked, noteAgentCall, spawnHelper } from './helpers.js';
import { save } from './persist.js';
import { bumpStreak } from './rewards.js';
import { chime, renderList, switchSession, updateTaskbar } from './sessions.js';
import { tabs, ui } from './state.js';
import { invoke } from './tauri.js';

export function onHook(ev) {
  const t = tabs.get(ev.tab);
  if (!t) return;
  const raw = ev.raw || {};
  if (ev.session_id && ev.session_id !== t.plot.sessionId) switchSession(t, ev.session_id, raw.source === 'resume');
  const p = t.plot;
  p.lastEvent = Date.now();
  if (!ev.synthetic) p.lastHook = Date.now();
  if (raw.cwd && !p.cwd) p.cwd = raw.cwd;
  if (ev.title) p.title = ev.title;
  else if (raw.session_title && !p.title) p.title = raw.session_title;

  const bubbleBefore = p.bubble;
  const now = performance.now() / 1000;
  // Tool use inside a subagent is its helper's work, not the parent's (which may be done and
  // waiting with a "!"), so it only wakes the helper.
  if (raw.agent_id && (ev.event === 'PreToolUse' || ev.event === 'PostToolUse')) {
    helperWorked(p, raw.agent_id, now);
    if (ev.tokens != null) applyTokens(p, ev.tokens, ev.first || p.adopting);
    p.adopting = false;
    return;
  }
  notePending(p, ev, raw);
  switch (ev.event) {
    case 'UserPromptSubmit':
      if (p.x == null) placePlot(p);
      if (!p.title && raw.prompt) p.title = raw.prompt.replace(/\s+/g, ' ').trim().slice(0, 40);
      bumpStreak(p);
      p.activity = 'working';
      p.bubble = null;
      break;
    case 'SubagentStart':
      spawnHelper(p, raw.agent_id, raw.agent_type, now);
      break;
    case 'SubagentStop':
      helperDone(p, raw.agent_id, ev.agent_tokens, now);
      break;
    case 'PreToolUse':
      if (raw.tool_name === 'Agent') noteAgentCall(p, raw.tool_input);
      p.activity = 'working';
      p.bubble = raw.tool_name === 'AskUserQuestion' ? '?' : null;
      if (p.bubble) chime('ask');
      break;
    case 'PostToolUse':
      p.activity = 'working';
      if (p.bubble === '?') p.bubble = null;
      break;
    case 'PermissionRequest':
      p.bubble = '?';
      chime('ask');
      break;
    case 'Notification': {
      const kind = `${raw.notification_type || ''} ${raw.message || ''}`;
      if (/permission|elicitation|question|approve|input/i.test(kind) && !/idle/i.test(raw.notification_type || '')) {
        p.bubble = '?';
        chime('ask');
      }
      break;
    }
    case 'Stop':
      p.built = true;
      p.activity = 'idle';
      p.lastStop = Date.now();
      if (ui.activeTab !== ev.tab || !document.hasFocus()) {
        p.bubble = '!';
        chime('done');
      } else p.bubble = null;
      break;
    case 'SessionEnd':
      p.activity = 'sleep';
      p.bubble = null;
      p.helpers = [];
      break;
  }
  if (ev.tokens != null) {
    applyTokens(p, ev.tokens, ev.first || p.adopting);
    p.adopting = false;
  }
  const attention = !!p.bubble && p.bubble !== bubbleBefore;
  updateTaskbar(attention);
  renderList();
  save();
}

// Sessions the tab's own hooks can't hear ------------------------------------------------------
// After /resume a tab can be showing a different session, and if that one is a background job (or
// running in another terminal) it does its work in its own process, whose hooks don't reach us.
// The tab's status line says which session it shows; Claude Code's session registry (hooks.rs)
// says whether that session is busy or idle and what it's called; its transcript has the tokens.

export function followSession(ev) {
  const t = tabs.get(ev.tab);
  if (!t || !ev.session_id || ev.session_id === t.plot.sessionId) return;
  // an existing conversation: its mochi goes straight to a plot with its desk already built
  const p = switchSession(t, ev.session_id, true);
  if (p.activity === 'arriving' && p.x != null) p.activity = 'idle';
  invoke('watch_session', { tab: t.tab, sessionId: ev.session_id, transcript: ev.transcript_path || null }).catch(() => {});
  renderList();
  save();
}

export function onRegistry(list) {
  const byId = new Map((list || []).map((r) => [r.sessionId, r]));
  let changed = false;
  for (const t of tabs.values()) {
    const p = t.plot;
    const r = byId.get(p.sessionId);
    if (!r) continue;
    // A brand-new background job is "named" after its own id until it gets a real name.
    const placeholder = r.nameSource === 'derived' || (!r.nameSource && (r.name === r.jobId || String(r.sessionId || '').startsWith(r.name)));
    if (!p.title && r.name && !placeholder) {
      p.title = r.name;
      changed = true;
    }
    // Only stand in for hooks when this tab's hooks have been quiet for a while.
    if (Date.now() - (p.lastHook || 0) < 15000 || !p.live) continue;
    if (r.status === 'busy' && p.activity !== 'working') onHook({ tab: t.tab, event: 'UserPromptSubmit', raw: {}, synthetic: true });
    else if (r.status === 'idle' && p.activity === 'working') onHook({ tab: t.tab, event: 'Stop', raw: {}, synthetic: true });
  }
  if (changed) {
    renderList();
    save();
  }
}

// New tokens go into the mochi's bank, which garden.js pays out as seeds over the next few
// seconds. The first read of a transcript (a resumed session's whole history) only sets the total.
// `total` is the main transcript's count; subagents' tokens are added on top (helpers.js).
/** @param {Plot} p */
export function applyTokens(p, total, first) {
  const main = p.mainTokens || 0;
  if (!first && total > main) {
    p.bank = (p.bank || 0) + (total - main);
    noteWeekTokens(p, total - main);
  }
  p.mainTokens = Math.max(main, total);
  p.tokens = p.mainTokens + (p.agentTokens || 0);
}

export function onTokens(ev) {
  const t = tabs.get(ev.tab);
  if (!t) return;
  // the first read of a session just adopted (followSession) sets its total without a seed burst
  applyTokens(t.plot, ev.tokens, !!t.plot.adopting);
  t.plot.adopting = false;
  if (ev.title) t.plot.title = ev.title;
  save();
}
