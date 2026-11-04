// A helper's conversation. Clicking a subagent in terminal only's garden path shows what it's
// been doing, read-only, in the terminal's place: its brief, what it said, the tools it used and
// what came back, following along live from its transcript (lib.rs agent_log). Clicking any
// session, [ back ] or Esc returns to the terminal.

import { describeTool } from './cards.js';
import { renderPath } from './sidebar.js';
import { $, tabs, ui } from './state.js';
import { invoke } from './tauri.js';

/** @type {{ tab: string, id: string, label: string, next: number, shown: number, timer: any, el: HTMLElement, missing?: boolean } | null} */
export let AgentView = null;
export const agentOpen = () => AgentView;

// A transcript's messages as lines to show: { k: prompt | say | tool | result | error | report, text }.
// `first`: nothing has been shown yet, so a plain user message is the helper's brief.
export function linesOf(entries, first) {
  const out = [];
  let skipNext = false;
  for (const e of entries || []) {
    const c = e.content;
    if (e.type === 'user') {
      if (typeof c === 'string') {
        if (!c.startsWith('<')) out.push({ k: 'prompt', text: c.trim() });
        continue;
      }
      for (const item of Array.isArray(c) ? c : []) {
        if (item.type === 'text' && item.text && !item.text.startsWith('<')) out.push({ k: 'prompt', text: item.text.trim() });
        else if (item.type === 'tool_result') {
          if (skipNext) {
            skipNext = false;
            continue;
          }
          const r = item.content || {};
          const body = typeof r === 'string' ? r : r.text || '';
          const total = typeof r === 'string' ? body.split('\n').length : r.lines || 0;
          const shown = body.split('\n').filter((l) => l.trim()).slice(0, 3);
          let text = shown.join('\n') || '(nothing)';
          if (total > shown.length) text += `\n… +${total - shown.length} lines`;
          out.push({ k: item.is_error ? 'error' : 'result', text });
        }
      }
    } else if (e.type === 'assistant') {
      for (const item of Array.isArray(c) ? c : []) {
        if (item.type === 'text' && item.text?.trim()) out.push({ k: 'say', text: item.text.trim() });
        else if (item.type === 'tool_use' && item.name === 'SubagentHandback') {
          out.push({ k: 'report', text: String(item.input?.message || '').trim() || '(handed back)' });
          skipNext = true; // its "delivered" receipt
        } else if (item.type === 'tool_use') {
          const what = item.input?.summary ? '' : describeTool(item.name, item.input || {});
          out.push({ k: 'tool', text: `${toolName(item.name)}(${what.slice(0, 120)})` });
        }
      }
    }
  }
  // its brief can run long: the first few lines are enough to say what it was sent to do
  if (first && out[0]?.k === 'prompt') {
    const lines = out[0].text.split('\n');
    if (lines.length > 8) out[0].text = lines.slice(0, 8).join('\n') + `\n… +${lines.length - 8} lines`;
  }
  return out;
}

const toolName = (n) => (n || '').replace(/^mcp__([^_]+(?:_[^_]+)*)__/, '$1: ');

/** The helper `id` of the session in `tab`: show its conversation. */
export function openAgent(tab, id) {
  const t = tabs.get(tab);
  const h = t && [...(t.plot.helpers || []), ...(t.plot.doneHelpers || [])].find((x) => x.id === id);
  if (!t || !h) return;
  closeAgent(true);
  const el = document.createElement('div');
  el.className = 'agentview';
  el.tabIndex = 0;
  el.onkeydown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeAgent();
    }
  };
  $('#terms').appendChild(el);
  $('#terms').classList.add('agent-open');
  AgentView = { tab, id, label: h.label || 'helper', next: 0, shown: 0, timer: null, el };
  el.appendChild(line('note', 'reading its conversation…'));
  poll();
  AgentView.timer = setInterval(poll, 700);
  el.focus();
  renderPath();
}

/** Back to the terminal. `quiet`: another view is about to open, so don't refocus. */
export function closeAgent(quiet) {
  if (!AgentView) return;
  clearInterval(AgentView.timer);
  AgentView.el.remove();
  AgentView = null;
  $('#terms').classList.remove('agent-open');
  if (quiet) return;
  const t = tabs.get(ui.activeTab);
  if (t) requestAnimationFrame(() => (t.fit.fit(), t.term.focus()));
  renderPath();
}

function line(k, text) {
  const d = document.createElement('div');
  d.className = 'av-line ' + k;
  d.textContent = text;
  return d;
}

let busy = false;
async function poll() {
  const v = AgentView;
  const t = v && tabs.get(v.tab);
  if (!v || !t || busy) return;
  busy = true;
  try {
    const r = await invoke('agent_log', { sessionId: t.plot.sessionId, agentId: v.id, from: v.next });
    if (AgentView !== v || !r) return;
    if (r.missing) {
      if (!v.missing) v.el.firstChild.textContent = 'its conversation hasn\'t been written down yet…';
      v.missing = true;
      return;
    }
    const lines = linesOf(r.entries, v.shown === 0);
    v.next = r.next;
    if (!lines.length) return;
    const atEnd = v.el.scrollHeight - v.el.scrollTop - v.el.clientHeight < 40;
    if (v.shown === 0) v.el.textContent = '';
    for (const l of lines) v.el.appendChild(line(l.k, l.text));
    v.shown += lines.length;
    if (atEnd || v.shown === lines.length) v.el.scrollTop = v.el.scrollHeight;
  } catch {
  } finally {
    busy = false;
  }
}
