/**
 * The renderer is a pure function of the snapshot.
 *
 * No state of its own beyond "which span is selected" — everything drawn comes
 * from the last snapshot the main process sent. That is what lets a finished
 * run and a live one use the same code: replay is just snapshots arriving in a
 * different order.
 *
 * Vanilla rather than React + a bundler, deliberately, at this milestone. The
 * repo has no build step and the views here are two lists and a bar chart;
 * adding a toolchain buys nothing yet. The moment to introduce one is M4, when
 * the diff viewer and terminal arrive — both of which bring their own bundled
 * dependencies anyway.
 */

'use strict';

const $ = (id) => document.getElementById(id);

let snap = null;
let selectedSpan = null;

/* -------------------------------------------------------------- helpers -- */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * Dynamic geometry goes into a stylesheet we own, not onto elements.
 *
 * Setting `el.style.left` works under `style-src 'self'` — the value applies —
 * but Chromium still reports a policy violation for the style attribute it has
 * to create, once per element per render. Six bars became 318 console errors,
 * which in a tool whose job is surfacing problems would bury every real one.
 * insertRule touches no attribute and raises nothing.
 */
const geometry = (() => {
  // A <style> element cannot be used here at all: style-src 'self' treats a
  // dynamically created one as an inline stylesheet and blocks it, leaving
  // `.sheet` null. A constructed CSSStyleSheet is not inline markup, so it is
  // allowed, and adoptedStyleSheets attaches it without touching the DOM.
  let sheet = null;
  try {
    sheet = new CSSStyleSheet();
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  } catch {
    sheet = null; // very old engine: fall back to per-element styling below
  }
  const pending = [];
  return {
    reset() {
      if (!sheet) return;
      while (sheet.cssRules.length) sheet.deleteRule(0);
      pending.length = 0;
    },
    set(spanId, left, width) {
      const l = `${left.toFixed(3)}%`;
      const w = `${width.toFixed(3)}%`;
      if (!sheet) { pending.push([spanId, l, w]); return; }
      // Span ids are [A-Za-z0-9_] by construction, so they need no escaping.
      sheet.insertRule(`.bar[data-span="${spanId}"]{left:${l};width:${w}}`, sheet.cssRules.length);
    },
    /** Only reached when constructed stylesheets are unavailable. */
    flushFallback(root) {
      for (const [id, l, w] of pending.splice(0)) {
        const el = root.querySelector(`.bar[data-span="${id}"]`);
        if (el) { el.style.left = l; el.style.width = w; }
      }
    },
  };
})();

const fmtDur = (ms) => {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  // Round first, then split. Rounding the remainder on its own produced
  // "39m 60s" on the screenshot: the seconds carried but the minutes did not.
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}m ${total % 60}s`;
};

const clock = (iso) => String(iso ?? '').slice(11, 23);

const BAD = new Set(['TOOL_BLOCKED', 'TOOL_FAILED', 'WORKER_FAILED', 'VERIFY_FAILED', 'GATE_REJECTED', 'RULE_VIOLATION']);

/** Flatten the span tree into lanes, preserving depth for indentation. */
function lanes(nodes, depth = 0, out = []) {
  for (const n of nodes) {
    out.push({ ...n, depth });
    lanes(n.children, depth + 1, out);
  }
  return out;
}

function findSpan(nodes, id) {
  for (const n of nodes) {
    if (n.id === id) return n;
    const hit = findSpan(n.children, id);
    if (hit) return hit;
  }
  return null;
}

/* ----------------------------------------------------------------- flow -- */

function renderFlow() {
  const host = $('flow');
  const rows = lanes(snap.tree);
  if (!rows.length) { host.innerHTML = '<p class="dim">no spans yet</p>'; return; }

  // An open span has no end, so it has to be drawn to some horizon. Using
  // wall-clock "now" is right for a live run and badly wrong for a finished
  // one: a session whose root span never got a RUN_ENDED stretched the axis
  // from the run's start to the present, which squeezed every real span —
  // turns of 453ms and 721ms — down to 0.4% of the width. Replay and live
  // share this code, so the horizon has to depend on which one this is.
  const last = Date.parse(snap.summary.endedAt ?? snap.summary.startedAt);
  const isLive = Number.isFinite(last) && Date.now() - last < 30_000;
  const horizon = isLive ? Date.now() : last;

  const starts = rows.map((r) => Date.parse(r.openedAt ?? snap.summary.startedAt)).filter(Number.isFinite);
  const ends = rows.map((r) => Date.parse(r.closedAt || r.lastEventAt || new Date(horizon).toISOString())).filter(Number.isFinite);
  const t0 = Math.min(...starts, Date.parse(snap.summary.startedAt));
  const t1 = Math.max(...ends, t0 + 1);
  const span = Math.max(1, t1 - t0);
  const now = horizon;

  // Geometry is applied through the CSSOM, never a style="" attribute. The
  // renderer runs under style-src 'self' with no unsafe-inline, which blocks
  // inline style attributes outright — the first version of this used them and
  // every bar silently collapsed to zero width at the left edge, so the
  // timeline rendered as a column of dots and still looked plausible.
  host.textContent = '';
  geometry.reset();
  const frag = document.createDocumentFragment();

  for (const r of rows) {
    const s = Date.parse(r.openedAt ?? new Date(t0).toISOString());
    // An unclosed span ends where its own activity ended, unless the run is
    // genuinely live - then it grows to the horizon. There is no session-end
    // hook, so without this every run is drawn as still open and stretches the
    // axis to the present, squashing every real span into a sliver.
    const fallback = !isLive && r.lastEventAt ? Date.parse(r.lastEventAt) : now;
    const e = r.closedAt ? Date.parse(r.closedAt) : fallback;
    const kind = r.actor.kind === 'root' && r.type === 'TURN_STARTED' ? 'turn' : r.actor.kind;
    const title = `${r.actor.kind}:${r.actor.id} · ${r.type || ''} · ${fmtDur(r.durationMs)}`;

    const lane = document.createElement('div');
    lane.className = 'lane';

    const label = document.createElement('div');
    label.className = 'label';
    label.title = title;
    label.classList.add(`d${Math.min(r.depth, 8)}`);
    const k = document.createElement('span');
    k.className = 'k';
    k.textContent = `${r.actor.kind}:`;
    label.append(k, document.createTextNode(r.actor.id));

    const track = document.createElement('div');
    track.className = 'track';
    const bar = document.createElement('div');
    bar.className = ['bar', kind,
      r.status === 'failed' ? 'failed' : '',
      r.status === 'open' ? 'open' : '',
      r.id === selectedSpan ? 'sel' : ''].filter(Boolean).join(' ');
    bar.dataset.span = r.id;
    bar.title = title;
    geometry.set(r.id, ((s - t0) / span) * 100, Math.max(0.4, ((e - s) / span) * 100));
    bar.addEventListener('click', () => select(r.id));
    track.append(bar);

    lane.append(label, track);
    frag.append(lane);
  }

  const axis = document.createElement('div');
  axis.className = 'axis';
  const ticks = document.createElement('div');
  ticks.className = 'ticks';
  for (const label of ['0s', fmtDur(Math.round(span / 2)), fmtDur(span)]) {
    const t = document.createElement('span');
    t.textContent = label;
    ticks.append(t);
  }
  axis.append(document.createElement('div'), ticks);
  frag.append(axis);
  host.append(frag);
  geometry.flushFallback(host);
}

/* --------------------------------------------------------------- roster -- */

function renderRoster() {
  const host = $('roster');
  if (!snap.tree.length) { host.innerHTML = '<p class="dim">no spans yet</p>'; return; }
  // Same CSP constraint as the Flow pane: indentation is set through the
  // CSSOM, not a style attribute, or every row renders flush left and the
  // parent/child relationship the Roster exists to show disappears.
  host.textContent = '';
  const frag = document.createDocumentFragment();

  const walk = (nodes, depth) => {
    for (const n of nodes) {
      const row = document.createElement('div');
      row.className = `node${n.id === selectedSpan ? ' sel' : ''}`;
      row.dataset.span = n.id;
      row.classList.add(`d${Math.min(depth, 8)}`);
      row.addEventListener('click', () => select(n.id));

      const inner = document.createElement('div');
      inner.className = 'row';

      const mark = document.createElement('span');
      mark.className = `mark ${n.status === 'failed' ? 'bad' : n.status === 'open' ? 'wait' : 'ok'}`;
      mark.textContent = n.status === 'failed' ? '✖' : n.status === 'open' ? '○' : '✔';

      const who = document.createElement('span');
      who.className = 'who';
      who.textContent = `${n.actor.kind}:${n.actor.id}`;

      const type = document.createElement('span');
      type.className = 'type';
      type.textContent = n.type || '';

      const dur = document.createElement('span');
      dur.className = 'dur';
      dur.textContent = fmtDur(n.durationMs);

      inner.append(mark, who, type, dur);
      row.append(inner);
      frag.append(row);
      walk(n.children, depth + 1);
    }
  };
  walk(snap.tree, 0);
  host.append(frag);
}

/* ------------------------------------------------------------ inspector -- */

function renderInspector() {
  const host = $('inspector');
  const hint = $('inspectorHint');
  if (!selectedSpan) { host.innerHTML = '<p class="dim">select a span in Flow or Roster</p>'; hint.textContent = 'select a span'; return; }

  const node = findSpan(snap.tree, selectedSpan);
  const events = snap.events.filter((e) => e.span_id === selectedSpan);
  hint.textContent = `${events.length} event(s) in view`;

  if (!node && !events.length) { host.innerHTML = '<p class="dim">that span is outside the loaded window</p>'; return; }

  const kv = node ? `<div class="kv">
      <div class="k">span</div><div class="v">${esc(node.id)}</div>
      <div class="k">actor</div><div class="v">${esc(node.actor.kind)}:${esc(node.actor.id)}</div>
      <div class="k">opened</div><div class="v">${esc(node.type || '—')} at ${esc(clock(node.openedAt))}</div>
      <div class="k">status</div><div class="v">${esc(node.status)}${node.closedBy ? ' · ' + esc(node.closedBy) : ''}</div>
      <div class="k">duration</div><div class="v">${fmtDur(node.durationMs)}</div>
    </div>` : '';

  const body = events.map((e) => `<div class="evrow">
      <div class="t">${esc(clock(e.ts))} · ${esc(e.type)}</div>
      <pre>${esc(JSON.stringify(e.payload, null, 2))}</pre>
    </div>`).join('') || '<p class="dim">no payload in the loaded window</p>';

  host.innerHTML = kv + body;
}

/* --------------------------------------------------------------- stream -- */

function renderStream() {
  const host = $('stream');
  const atBottom = host.scrollHeight - host.scrollTop - host.clientHeight < 40;
  const rows = snap.events.slice(-250).reverse();
  $('streamHint').textContent = snap.truncated
    ? `newest ${rows.length} of ${snap.summary?.events ?? 0}`
    : `${rows.length} event(s)`;

  host.innerHTML = rows.map((e) => {
    const detail = e.payload?.tool ?? (e.payload?.prompt ? JSON.stringify(e.payload.prompt) : (e.payload?.hook ?? ''));
    return `<div class="line ${BAD.has(e.type) ? 'bad' : ''}" data-span="${esc(e.span_id)}">
      <span class="ts">${esc(clock(e.ts))}</span>
      <span class="ty">${esc(e.type)}</span>
      <span class="de">${esc(String(detail).slice(0, 120))}</span>
    </div>`;
  }).join('') || '<p class="dim">no events yet</p>';

  host.querySelectorAll('.line').forEach((el) =>
    el.addEventListener('click', () => select(el.dataset.span)));
  if (atBottom) host.scrollTop = 0; // newest first, so "bottom" is the top
}

/* ------------------------------------------------------------- counters -- */

function renderCounters() {
  const s = snap.summary;
  if (!s) { $('counters').innerHTML = ''; return; }
  const items = [
    ['events', s.events], ['spans', `${s.spans - s.openSpans}/${s.spans}`],
    ['tools', s.tools], ['blocked', s.blocked, s.blocked > 0],
    ['failed', s.failed, s.failed > 0], ['workers', s.workers],
    ['evidence', s.evidence], ['elapsed', fmtDur(s.durationMs)],
  ];
  $('counters').innerHTML = items.map(([l, v, bad]) =>
    `<div class="counter ${bad ? 'bad' : ''}"><span class="v">${esc(v)}</span><span class="l">${esc(l)}</span></div>`).join('');
}

/* ----------------------------------------------------------------- shell -- */

function renderChrome() {
  $('project').textContent = snap.project || 'no project';
  $('project').title = snap.eventsDir || '';
  const sel = $('runSelect');
  sel.textContent = '';
  if (snap.runs.length > 1) {
    const all = document.createElement('option');
    all.value = '*';
    all.textContent = `All runs (${snap.runs.length}) · ${snap.runs.reduce((n, r) => n + r.events, 0)}`;
    all.selected = snap.selected === '*';
    sel.append(all);
  }
  for (const r of snap.runs) {
    const o = document.createElement('option');
    o.value = r.id;
    o.textContent = `${r.id} · ${r.events}`;
    o.selected = r.id === snap.selected;
    sel.append(o);
  }
  if (!snap.runs.length) {
    const o = document.createElement('option');
    o.textContent = 'no runs';
    sel.append(o);
  }

  const live = $('live');
  const files = snap.stats?.files ?? 0;
  live.classList.toggle('on', files > 0);
  live.querySelector('span').textContent = files > 0 ? `tailing ${files}` : 'idle';

  $('empty').classList.toggle('show', !snap.project || snap.runs.length === 0);
}

function select(spanId) {
  selectedSpan = spanId;
  renderFlow(); renderRoster(); renderInspector();
}

/**
 * With nothing selected the Inspector is a dead panel on every load. Opening on
 * the first failure instead means the pane answers the question people actually
 * arrive with - what went wrong - and falls back to the first span when nothing
 * did.
 */
function defaultSelection() {
  if (selectedSpan || !snap || !snap.tree.length) return;
  const flat = lanes(snap.tree);
  const failed = flat.find((n) => n.status === 'failed');
  selectedSpan = (failed || flat[0]).id;
}

function render(next) {
  snap = next;
  defaultSelection();
  renderChrome();
  renderFeatures();
  renderChat();
  renderGate();
  if (view === 'workspaces') renderWorkspaces();
  if (view === 'agents') { renderAgentsView(); renderAgentDetail(); }
  if (view === 'mcp') { renderMcp(); renderMcpTools(); }
  renderCounters();
  renderFlow();
  renderRoster();
  renderInspector();
  renderStream();
}

/* ------------------------------------------------------------------ wire -- */

$('openBtn').addEventListener('click', async () => {
  selectedSpan = null;
  render(await window.ade.openProject());
});
$('runSelect').addEventListener('change', async (e) => {
  selectedSpan = null;
  render(await window.ade.selectRun(e.target.value));
});

window.ade.onSnapshot(render);
window.ade.onInvalid((d) => console.warn('invalid event', d));
window.ade.getSnapshot().then(render);

// An open span's bar should keep growing while the run is live, even in the
// gaps between events.
setInterval(() => { if (snap?.summary?.openSpans) renderFlow(); }, 1000);

/* ======================================================= the workflow half = */

let view = 'observe';
let selectedWorkspace = null;

function setView(next) {
  view = next;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.dataset.view === next));
  $('grid').hidden = next !== 'observe';
  $('agents').hidden = next !== 'agents';
  $('workspaces').hidden = next !== 'workspaces';
  $('mcp').hidden = next !== 'mcp';
  $('counters').hidden = next !== 'observe';
  renderGate();
  if (next === 'workspaces') renderWorkspaces();
  if (next === 'agents') { renderAgentsView(); renderAgentDetail(); }
  if (next === 'mcp') { renderMcp(); renderMcpTools(); }
}

document.querySelectorAll('.tab').forEach((t) =>
  t.addEventListener('click', () => setView(t.dataset.view)));

function stateTags(ws) {
  if (!ws.managed) return [['', 'not managed here']];
  if (ws.statusError) return [['dirty', ws.statusError]];
  const s = ws.status;
  if (!s) return [];
  const tags = [];
  if (s.ahead) tags.push(['ahead', `${s.ahead} commit${s.ahead === 1 ? '' : 's'}`]);
  if (s.uncommitted.length) tags.push(['dirty', `${s.uncommitted.length} uncommitted`]);
  if (!tags.length) tags.push(['clean', 'clean']);
  return tags;
}

function renderWorkspaces() {
  const host = $('wsList');
  const list = (snap && snap.workspaces) || [];
  host.textContent = '';
  if (!list.length) {
    const p = document.createElement('p');
    p.className = 'dim';
    p.textContent = snap && snap.project ? 'no worktrees yet' : 'open a project first';
    host.append(p);
    return;
  }

  for (const ws of list) {
    const card = document.createElement('div');
    card.className = `ws${ws.isMain ? ' main' : ''}${ws.taskId === selectedWorkspace ? ' sel' : ''}`;

    const top = document.createElement('div');
    top.className = 'ws-top';

    const id = document.createElement('span');
    id.className = 'ws-id';
    id.textContent = ws.isMain ? '(main)' : (ws.taskId || ws.path);

    const branch = document.createElement('span');
    branch.className = 'ws-branch';
    branch.textContent = ws.branch || ws.head || '';

    const state = document.createElement('span');
    state.className = 'ws-state';
    for (const pair of stateTags(ws)) {
      const tag = document.createElement('span');
      tag.className = `tag ${pair[0]}`;
      tag.textContent = pair[1];
      state.append(tag, document.createTextNode(' '));
    }

    top.append(id, branch, state);
    card.append(top);

    const objective = ws.contract && ws.contract.objective;
    if (objective) {
      const o = document.createElement('div');
      o.className = 'ws-obj';
      o.textContent = objective;
      card.append(o);
    }

    if (ws.managed) {
      card.addEventListener('click', () => selectWorkspace(ws.taskId));

      const actions = document.createElement('div');
      actions.className = 'ws-actions';

      const diffBtn = document.createElement('button');
      diffBtn.className = 'btn';
      diffBtn.textContent = 'Diff';
      diffBtn.addEventListener('click', (e) => { e.stopPropagation(); selectWorkspace(ws.taskId); });

      const rmBtn = document.createElement('button');
      rmBtn.className = 'btn';
      rmBtn.textContent = 'Remove';
      rmBtn.addEventListener('click', (e) => { e.stopPropagation(); removeWorkspace(ws); });

      actions.append(diffBtn, rmBtn);
      card.append(actions);
    }
    host.append(card);
  }
}

async function selectWorkspace(taskId) {
  selectedWorkspace = taskId;
  renderWorkspaces();
  $('wsDiffHint').textContent = taskId;
  $('wsDiff').textContent = '';
  try {
    renderDiff(await window.ade.worktreeDiff(taskId));
  } catch (err) {
    showWsError(err.message);
  }
}

function renderDiff(text) {
  const host = $('wsDiff');
  host.textContent = '';
  if (!text || !text.trim()) {
    const note = document.createElement('div');
    note.className = 'empty-note';
    note.textContent = 'No changes against the commit this task started from.';
    host.append(note);
    return;
  }
  const frag = document.createDocumentFragment();
  for (const line of text.split('\n')) {
    const el = document.createElement('span');
    let cls = 'dl';
    if (line.startsWith('+++') || line.startsWith('---') ||
        line.startsWith('diff ') || line.startsWith('index ')) cls += ' meta';
    else if (line.startsWith('@@')) cls += ' hunk';
    else if (line.startsWith('+')) cls += ' add';
    else if (line.startsWith('-')) cls += ' del';
    el.className = cls;
    el.textContent = line || ' ';
    frag.append(el);
  }
  host.append(frag);
}

function showWsError(message) {
  const box = $('wsError');
  box.textContent = message;
  box.hidden = false;
  setTimeout(() => { box.hidden = true; }, 8000);
}

async function removeWorkspace(ws) {
  const dirty = ws.status ? ws.status.uncommitted.length : 0;
  // Never discard an agent's work on one click. The engine refuses a dirty
  // worktree outright; this is where someone decides to override that, so it
  // has to be a decision rather than a stray click on a row.
  if (dirty && !confirm(`${ws.taskId} has ${dirty} uncommitted change(s).\nRemove it and discard them?`)) return;
  try {
    await window.ade.worktreeRemove(ws.taskId, Boolean(dirty), true);
    if (selectedWorkspace === ws.taskId) {
      selectedWorkspace = null;
      $('wsDiff').textContent = '';
      $('wsDiffHint').textContent = 'select a worktree';
    }
    render(await window.ade.refreshWorkspaces());
  } catch (err) {
    showWsError(err.message);
  }
}

$('wsCreate').addEventListener('click', async () => {
  const taskId = $('wsId').value.trim();
  if (!taskId) return showWsError('a task id is required');
  try {
    await window.ade.worktreeCreate(taskId, $('wsObjective').value.trim());
    $('wsId').value = '';
    $('wsObjective').value = '';
    render(await window.ade.refreshWorkspaces());
    selectWorkspace(taskId);
  } catch (err) {
    showWsError(err.message);
  }
});

/* ------------------------------------------------------- the gate banner -- */

/**
 * A gate is waiting when the run holds a GATE_REQUESTED whose span never closed.
 *
 * Derived from the event stream rather than asked of the harness on a timer.
 * The stream is already here, and polling a short-lived MCP server several
 * times a second to ask the same question would spawn a process per poll.
 */
function pendingGate() {
  if (!snap || !snap.events) return null;
  const open = new Map();
  for (const e of snap.events) {
    if (e.type === 'GATE_REQUESTED') open.set(e.span_id, e);
    else if (e.type === 'GATE_APPROVED' || e.type === 'GATE_REJECTED') open.delete(e.span_id);
  }
  const all = [...open.values()];
  return all.length ? all[all.length - 1] : null;
}

function renderGate() {
  const bar = $('gatebar');
  const gate = view === 'observe' ? pendingGate() : null;
  bar.hidden = !gate;
  if (!gate) return;
  const name = (gate.payload && gate.payload.gate) || 'a gate';
  $('gatetext').textContent = `${name} is waiting for a decision.`;
}

/**
 * Record a decision on the gate the banner is currently showing.
 *
 * The gate name travels with the decision rather than being looked up in the
 * main process: the harness tool requires it, and taking it from what the
 * person was looking at means the decision cannot land on a different gate
 * that became pending while they were reading.
 */
async function decideGate(approved) {
  const gate = pendingGate();
  const name = gate && gate.payload && gate.payload.gate;
  if (!name) { $('gatemsg').textContent = 'nothing is waiting'; return; }

  const approveBtn = $('approveBtn');
  const rejectBtn = $('rejectBtn');
  approveBtn.disabled = true;
  rejectBtn.disabled = true;
  $('gatemsg').textContent = approved ? 'approving...' : 'rejecting...';

  const out = await window.ade.decideGate(name, approved);
  $('gatemsg').textContent = out.ok ? (approved ? 'approved' : 'rejected') : out.error;
  approveBtn.disabled = false;
  rejectBtn.disabled = false;
  if (out.ok) setTimeout(() => { $('gatemsg').textContent = ''; }, 4000);
}

$('approveBtn').addEventListener('click', () => decideGate(true));
$('rejectBtn').addEventListener('click', () => decideGate(false));

/* ============================================================ the agent map = */

let selectedAgent = null;

function ago(ms) {
  if (ms == null) return '';
  if (ms < 1000) return 'just now';
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  return `${Math.round(ms / 3_600_000)}h ago`;
}

function tag(kind, text) {
  const el = document.createElement('span');
  el.className = `tag ${kind}`;
  el.textContent = text;
  return el;
}

function renderAgents() {
  const host = $('agentList');
  const agents = (snap && snap.agents) || [];
  host.textContent = '';

  const working = agents.filter((a) => a.status === 'working').length;
  $('agentsHint').textContent = agents.length
    ? `${working} working, ${agents.length - working} idle`
    : 'who is working, and on what';

  if (!agents.length) {
    const p = document.createElement('p');
    p.className = 'dim';
    p.textContent = snap && snap.project ? 'no agents seen yet' : 'open a project first';
    host.append(p);
    return;
  }

  for (const agent of agents) {
    const card = document.createElement('div');
    card.className = `agent ${agent.status}${agent.key === selectedAgent ? ' sel' : ''}`;
    card.addEventListener('click', () => { selectedAgent = agent.key; renderAgentsView(); renderAgentDetail(); });

    const head = document.createElement('div');
    head.className = 'a-head';

    const dot = document.createElement('span');
    dot.className = 'a-dot';

    const name = document.createElement('span');
    name.className = 'a-name';
    name.textContent = agentLabel(agent);
    name.title = agent.id;

    const kind = document.createElement('span');
    kind.className = `a-kind ${agent.kind}`;
    kind.textContent = agent.tier || (agent.kind === 'root' ? 'session' : agent.kind);

    const when = document.createElement('span');
    when.className = 'a-when';
    when.textContent = agent.status === 'working' ? 'working'
      : (agent.status === 'done' ? 'finished' : ago(agent.idleMs));

    head.append(dot, name, kind, when);
    card.append(head);

    if (agent.prompt) {
      const prompt = document.createElement('div');
      prompt.className = 'a-prompt';
      prompt.textContent = agent.prompt.replace(/^"|"$/g, '');
      card.append(prompt);
    }

    if (agent.doing) {
      const doing = document.createElement('div');
      doing.className = 'a-doing';
      const t = document.createElement('span');
      t.className = 't';
      t.textContent = agent.doing.tool;
      const d = document.createElement('span');
      d.className = 'd';
      d.textContent = agent.doing.detail || '';
      d.title = agent.doing.detail || '';
      doing.append(t, d);
      if (agent.doing.live) {
        const live = document.createElement('span');
        live.className = 'live';
        live.textContent = 'running';
        doing.append(live);
      }
      card.append(doing);
    }

    const stats = document.createElement('div');
    stats.className = 'a-stats';
    if (agent.attributable) {
      stats.append(tag('ahead', `${agent.tools} tool${agent.tools === 1 ? '' : 's'}`));
      if (agent.blocked) stats.append(tag('dirty', `${agent.blocked} blocked`));
      if (agent.failedTools) stats.append(tag('dirty', `${agent.failedTools} failed`));
      if (agent.turns) stats.append(tag('clean', `${agent.turns} turn${agent.turns === 1 ? '' : 's'}`));
    } else {
      // Saying "0 tools" would read as "this agent did nothing", which is not
      // what the stream says — it says nothing about which sub-agent ran them.
      stats.append(tag('', 'tools counted on its session'));
    }
    card.append(stats);
    host.append(card);
  }
}

/** Three states now, because SessionEnd and the Task result close things. */
function statusText(agent) {
  if (agent.status === 'working') return 'working';
  if (agent.status === 'done') return `finished, ${ago(agent.idleMs)}`;
  return `idle, last seen ${ago(agent.idleMs)}`;
}

function renderAgentDetail() {
  const host = $('agentDetail');
  const agents = (snap && snap.agents) || [];
  const agent = agents.find((a) => a.key === selectedAgent);
  host.textContent = '';

  if (!agent) {
    $('agentDetailHint').textContent = 'select an agent';
    const p = document.createElement('p');
    p.className = 'dim';
    p.textContent = 'select an agent to see what it has been doing';
    host.append(p);
    return;
  }
  $('agentDetailHint').textContent = `${agent.kind}:${agent.id}`;

  const kv = document.createElement('div');
  kv.className = 'kv';
  const rows = [
    ['status', statusText(agent)],
    ['kind', agent.tier ? `${agent.kind} (${agent.tier})` : agent.kind],
    ['run', agent.runId],
    ['started', String(agent.startedAt || '').slice(11, 19)],
    ['last seen', String(agent.lastSeenAt || '').slice(11, 19)],
  ];
  if (agent.attributable) {
    rows.push(['tool calls', String(agent.tools)]);
    if (agent.blocked) rows.push(['blocked', String(agent.blocked)]);
    if (agent.failedTools) rows.push(['failed', String(agent.failedTools)]);
  }
  for (const [k, v] of rows) {
    const kEl = document.createElement('div');
    kEl.className = 'k';
    kEl.textContent = k;
    const vEl = document.createElement('div');
    vEl.className = 'v';
    vEl.textContent = v;
    kv.append(kEl, vEl);
  }
  host.append(kv);

  if (agent.prompt) {
    const h = document.createElement('div');
    h.className = 'a-idle';
    h.textContent = 'working on';
    const q = document.createElement('pre');
    q.textContent = agent.prompt.replace(/^"|"$/g, '');
    host.append(h, q);
  }

  // Its own events, newest first: the detail nobody can get from a card.
  const events = ((snap && snap.events) || [])
    .filter((e) => e.actor && `${e.actor.kind}:${e.actor.id}` === `${agent.kind}:${agent.id}`)
    .slice(-40).reverse();
  if (events.length) {
    const h = document.createElement('div');
    h.className = 'a-idle';
    h.textContent = `${events.length} recent event(s)`;
    host.append(h);
    for (const e of events) {
      const row = document.createElement('div');
      row.className = 'evrow';
      const t = document.createElement('div');
      t.className = 't';
      t.textContent = `${String(e.ts).slice(11, 19)} · ${e.type}`;
      row.append(t);
      const detail = e.payload && (e.payload.tool || e.payload.gate || e.payload.hook);
      if (detail) {
        const d = document.createElement('div');
        d.style.fontFamily = 'var(--mono)';
        d.style.fontSize = '.68rem';
        d.textContent = String(detail);
        row.append(d);
      }
      host.append(row);
    }
  }
}

/* ================================================== the agent map, as a graph = */

let agentLayout = 'graph';

const NODE_W = 304;
// Three lines, not two: at 58px the model, the elapsed time and both token
// figures were competing for one line and the screenshot came back reading
// "10.5k in contex...". A number that is cut off is worse than one that is
// absent, because it still looks like information.
const NODE_H = 78;
const GAP_Y = 12;
const GAP_X = 78;

function fmtTokens(n) {
  if (!n) return null;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function fmtElapsed(ms) {
  if (ms == null) return null;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

/**
 * Lay the agents out as a left-to-right tree.
 *
 * Positions are computed here rather than left to the browser because the
 * connectors have to meet the boxes exactly: an elbow drawn to where a box
 * roughly is looks like a bug, and CSS cannot tell SVG where a flexed box
 * landed without a second measuring pass.
 */
function layoutAgents(agents) {
  const byKey = new Map(agents.map((a) => [a.key, a]));
  const children = new Map();
  const roots = [];
  for (const agent of agents) {
    if (agent.parentKey && byKey.has(agent.parentKey)) {
      if (!children.has(agent.parentKey)) children.set(agent.parentKey, []);
      children.get(agent.parentKey).push(agent);
    } else {
      roots.push(agent);
    }
  }

  const placed = [];
  const edges = [];
  let y = 0;

  const place = (agent, depth) => {
    const kids = children.get(agent.key) || [];
    if (!kids.length) {
      const node = { agent, x: depth * (NODE_W + GAP_X), y, depth };
      placed.push(node);
      y += NODE_H + GAP_Y;
      return node;
    }
    const kidNodes = kids.map((kid) => place(kid, depth + 1));
    // The parent sits level with the middle of its children, which is what
    // makes the fan read as one group rather than a list.
    const mid = (kidNodes[0].y + kidNodes[kidNodes.length - 1].y) / 2;
    const node = { agent, x: depth * (NODE_W + GAP_X), y: mid, depth };
    placed.push(node);
    for (const kid of kidNodes) edges.push({ from: node, to: kid });
    // `y` already stands past the last child - each leaf advanced it. Advancing
    // again by the number of children left a hole the size of the subtree under
    // every group, which the first render showed as a page of white space.
    return node;
  };

  for (const root of roots) {
    place(root, 0);
    y += GAP_Y * 2;
  }
  return { placed, edges };
}

function renderAgentGraph() {
  const host = $('agentList');
  const agents = (snap && snap.agents) || [];
  host.textContent = '';
  host.className = 'agent-graph';

  if (!agents.length) {
    const p = document.createElement('p');
    p.className = 'dim';
    p.textContent = snap && snap.project ? 'no agents seen yet' : 'open a project first';
    host.append(p);
    return;
  }

  const { placed, edges } = layoutAgents(agents);
  const width = Math.max(...placed.map((n) => n.x)) + NODE_W + 24;
  const height = Math.max(...placed.map((n) => n.y)) + NODE_H + 24;

  const canvas = document.createElement('div');
  canvas.className = 'graph-canvas';
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.classList.add('graph-edges');
  for (const edge of edges) {
    const x1 = edge.from.x + NODE_W;
    const y1 = edge.from.y + NODE_H / 2;
    const x2 = edge.to.x;
    const y2 = edge.to.y + NODE_H / 2;
    const mid = x1 + (x2 - x1) / 2;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', `M ${x1} ${y1} H ${mid} V ${y2} H ${x2}`);
    path.setAttribute('class', edge.to.agent.status === 'working' ? 'edge live' : 'edge');
    svg.append(path);
  }
  canvas.append(svg);

  for (const node of placed) {
    const agent = node.agent;
    const box = document.createElement('div');
    box.className = `gnode ${agent.status}${agent.key === selectedAgent ? ' sel' : ''}`;
    box.style.left = `${node.x}px`;
    box.style.top = `${node.y}px`;
    // Set from the same constants the connectors are drawn with. They used to
    // be stated again in the stylesheet, and when the node grew to fit its
    // third line only the layout knew: every connector started 36px clear of
    // the box it came from, so the graph looked like loose boxes and stray
    // dashes. Geometry gets one source of truth.
    box.style.width = `${NODE_W}px`;
    box.style.height = `${NODE_H}px`;
    box.addEventListener('click', () => { selectedAgent = agent.key; renderAgentsView(); renderAgentDetail(); });

    const head = document.createElement('div');
    head.className = 'g-head';
    const dot = document.createElement('span');
    dot.className = 'a-dot';
    const name = document.createElement('span');
    name.className = 'g-name';
    name.textContent = agentLabel(agent);
    name.title = agent.id;
    head.append(dot, name);

    if (agent.tier) {
      const tier = document.createElement('span');
      tier.className = `a-kind ${agent.kind}`;
      tier.textContent = agent.tier;
      head.append(tier);
    }
    box.append(head);

    // Only facts the stream actually carries. Tokens are absent unless
    // something reported them, and an absent number stays absent.
    const line = (cls, text) => {
      const el = document.createElement('div');
      el.className = cls;
      el.textContent = text;
      el.title = text;
      box.append(el);
    };

    const who = [];
    if (agent.model) who.push(agent.model);
    const elapsed = fmtElapsed(agent.elapsedMs);
    if (elapsed) who.push(elapsed);
    if (who.length) line('g-sub', who.join(' · '));

    // Two different numbers, never conflated: what the agent generated, and how
    // much context it is carrying. Adding them together would be meaningless.
    const cost = [];
    const context = fmtTokens(agent.contextTokens);
    if (context) cost.push(`${context} ctx`);
    const tokens = fmtTokens(agent.tokens);
    if (tokens) cost.push(`${tokens} out`);
    if (agent.doing) cost.push(agent.doing.live ? `${agent.doing.tool} running` : agent.doing.tool);
    if (cost.length) line('g-cost', cost.join(' · '));

    canvas.append(box);
  }

  host.append(canvas);
}

/** The Agents pane, in whichever layout is selected. */
function renderAgentsView() {
  const agents = (snap && snap.agents) || [];
  const working = agents.filter((a) => a.status === 'working').length;
  const done = agents.filter((a) => a.status === 'done').length;
  const parts = [`${agents.length} agent${agents.length === 1 ? '' : 's'}`, `${working} working`];
  if (done) parts.push(`${done} finished`);
  $('agentsHint').textContent = agents.length
    ? `${parts.join(' · ')} · click one for details`
    : 'who is working, and on what';
  document.querySelectorAll('.layout-btn').forEach((b) =>
    b.classList.toggle('on', b.dataset.layout === agentLayout));
  if (agentLayout === 'graph') renderAgentGraph();
  else { $('agentList').className = 'agent-list'; renderAgents(); }
}

document.querySelectorAll('.layout-btn').forEach((b) =>
  b.addEventListener('click', () => { agentLayout = b.dataset.layout; renderAgentsView(); }));

/* ============================================================ feature tabs = */

/**
 * One tab per feature in flight.
 *
 * Several features are normally in development at once, each in its own
 * worktree, and until now they all poured into a single stream: four sessions
 * interleaved in one timeline reads as noise. Selecting a feature narrows every
 * pane together - flow, agents, counters, stream - so "what is happening on
 * checkout-v2" is one click instead of a filter held in someone's head.
 */
function renderFeatures() {
  const host = $('features');
  const features = (snap && snap.features) || [];
  host.textContent = '';
  // With nothing branched there is only one place work can happen, and a lone
  // tab that cannot be switched away from is furniture.
  host.hidden = !features.some((f) => f.id && f.id !== '(main)');
  if (host.hidden) return;

  const active = (snap && snap.activeFeature) ?? null;
  const total = features.reduce((n, f) => n + f.events, 0);

  const mk = (id, label, sub, events) => {
    const b = document.createElement('button');
    b.className = `ftab${active === id ? ' on' : ''}`;
    if (sub) b.title = sub;
    const name = document.createElement('span');
    name.className = 'f-name';
    name.textContent = label;
    const count = document.createElement('span');
    count.className = 'f-count';
    count.textContent = String(events);
    b.append(name, count);
    b.addEventListener('click', async () => {
      selectedSpan = null;
      selectedAgent = null;
      selectedWorkspace = id && id !== '(main)' ? id : null;
      render(await window.ade.selectFeature(id));
    });
    return b;
  };

  host.append(mk(null, 'All features', 'every worktree at once', total));
  for (const f of features) {
    const label = f.id === '(main)' ? 'main' : f.id;
    const tab = mk(f.id, label, f.objective || '', f.events);
    if (f.uncommitted) {
      const dot = document.createElement('span');
      dot.className = 'f-dirty';
      dot.title = `${f.uncommitted} uncommitted file(s)`;
      tab.append(dot);
    }
    host.append(tab);
  }
}

/* =================================================================== chat = */

/**
 * The composer, and what came back.
 *
 * Before this the window could only watch: you could see a feature stall and
 * then had to leave for a terminal to do anything about it. The box sends into
 * the worktree of whichever feature tab is open, so "talk to this feature" has
 * one meaning and never needs a second question.
 */
let chatCollapsed = false;
let lastChatCount = -1;
let lastChatTarget = null;

function renderChat() {
  const chat = (snap && snap.chat) || { target: '(main)', messages: [], running: false };
  const target = chat.target === '(main)' ? 'main' : chat.target;

  $('chatTarget').textContent = `→ ${target}`;
  $('chatTarget').title = chat.cwd || '';

  const status = $('chatStatus');
  status.className = `dock-status${chat.running ? ' on' : ''}`;
  status.textContent = chat.running
    ? 'agent is working…'
    // Whether the next message continues the conversation or starts a new one
    // changes what the agent knows, so it is stated rather than left to guess.
    : (chat.continues ? 'the next message continues this session' : 'the next message starts a session');

  renderRunnerControls(chat);
  $('chatStop').hidden = !chat.running;
  $('chatSend').disabled = !snap || !snap.project || chat.running;
  $('chatInput').disabled = !snap || !snap.project || chat.running;
  $('chatToggle').textContent = chatCollapsed ? 'Show' : 'Hide';
  $('dock').classList.toggle('collapsed', chatCollapsed);

  // Repaint only when there is something new. The snapshot arrives four times a
  // second and rebuilding the log under the cursor would fight the scrollbar.
  if (chat.messages.length === lastChatCount && chat.target === lastChatTarget) return;
  const atBottom = nearBottom($('chatLog'));
  lastChatCount = chat.messages.length;
  lastChatTarget = chat.target;

  const log = $('chatLog');
  log.textContent = '';
  if (!chat.messages.length) {
    const hint = document.createElement('div');
    hint.className = 'msg note';
    hint.textContent = snap && snap.project
      ? `nothing sent yet — this box runs an agent in ${target}`
      : 'open a project first';
    log.append(hint);
  }

  for (const message of chat.messages) log.append(chatRow(message));
  if (atBottom) log.scrollTop = log.scrollHeight;
}

function chatRow(message) {
  const row = document.createElement('div');
  row.className = `msg ${message.kind}`;

  if (message.kind === 'tool') {
    const name = document.createElement('b');
    name.textContent = message.tool;
    const detail = document.createElement('span');
    detail.textContent = message.input || '';
    detail.title = message.input || '';
    row.append(name, detail);
    return row;
  }

  if (message.kind === 'system') {
    row.textContent = [message.model, message.permissionMode].filter(Boolean).join(' · ');
    return row;
  }

  if (message.kind === 'result') {
    // Reported, not estimated: the cost comes from the run's own result record.
    const bits = [message.ok ? 'done' : 'failed'];
    if (message.turns) bits.push(`${message.turns} turn${message.turns === 1 ? '' : 's'}`);
    if (message.durationMs) bits.push(fmtDur(message.durationMs));
    if (message.costUsd != null) bits.push(`$${message.costUsd.toFixed(4)}`);
    row.textContent = bits.join(' · ');
    return row;
  }

  row.textContent = message.text || '';
  return row;
}

const nearBottom = (el) => el.scrollHeight - el.scrollTop - el.clientHeight < 60;

/**
 * What to call an agent on screen.
 *
 * A session Claude Code names itself is a UUID, and a node captioned
 * `581380fd-da70-4264-ac88-475e13564b7e` tells a reader nothing while taking
 * the whole line. The full id stays in the title and in the Inspector, where it
 * is the thing you actually need.
 */
function agentLabel(agent) {
  const id = String(agent.id || '');
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    ? `session ${id.slice(0, 8)}`
    : id;
}

async function sendPrompt() {
  const input = $('chatInput');
  const text = input.value.trim();
  if (!text) return;
  const feature = (snap && snap.activeFeature) ?? null;
  input.value = '';
  const result = await window.ade.sendPrompt(feature, text);
  if (!result.ok) {
    // Put the text back rather than losing it to an error banner.
    input.value = text;
    const status = $('chatStatus');
    status.className = 'dock-status bad';
    status.textContent = result.error;
  }
}

$('chatSend').addEventListener('click', sendPrompt);
$('chatStop').addEventListener('click', async () => {
  await window.ade.cancelPrompt((snap && snap.activeFeature) ?? null);
});
$('chatToggle').addEventListener('click', () => {
  chatCollapsed = !chatCollapsed;
  lastChatCount = -1;          // force a repaint when it comes back
  renderChat();
});
$('chatInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendPrompt(); }
});

/* ------------------------------------------- which agent, which model --- */

const CUSTOM_MODEL = '__custom__';

/**
 * The agent, the model, and the command line that follows from them.
 *
 * The command is printed because two of the shipped runners have never been
 * run by this project: their executable names were confirmed, their flags were
 * not. Showing exactly what will be launched turns a wrong flag into something
 * you can see and correct, instead of an error with no visible cause. It is
 * also the fastest way to answer "what is this thing actually doing".
 */
function renderRunnerControls(chat) {
  const runners = chat.runners || [];
  const runner = runners.find((r) => r.id === chat.runnerId) || runners[0];

  const rs = $('runnerSelect');
  rs.textContent = '';
  for (const entry of runners) {
    const option = document.createElement('option');
    option.value = entry.id;
    // Said on the option itself, so the choice is informed before it is made.
    const notes = [];
    if (!entry.installed) notes.push('not installed');
    else if (!entry.verified) notes.push('unverified');
    if (!entry.observable) notes.push('no events');
    option.textContent = notes.length ? `${entry.label} — ${notes.join(', ')}` : entry.label;
    option.selected = entry.id === chat.runnerId;
    rs.append(option);
  }
  rs.disabled = chat.running;

  const ms = $('modelSelect');
  ms.textContent = '';
  const models = (runner && runner.models) || [{ id: 'default', label: 'Default' }];
  const known = models.some((m) => m.id === chat.model);
  for (const model of models) {
    const option = document.createElement('option');
    option.value = model.id;
    option.textContent = model.label;
    option.selected = model.id === chat.model;
    ms.append(option);
  }
  if (!known && chat.model) {
    const option = document.createElement('option');
    option.value = chat.model;
    option.textContent = chat.model;
    option.selected = true;
    ms.append(option);
  }
  const custom = document.createElement('option');
  custom.value = CUSTOM_MODEL;
  custom.textContent = 'Custom…';
  ms.append(custom);
  ms.disabled = chat.running;

  const command = $('chatCommand');
  command.textContent = chat.command ? `$ ${chat.command}` : '';
  command.title = chat.command || '';

  renderCommandMenu(chat);
}

$('runnerSelect').addEventListener('change', async (e) => {
  render(await window.ade.setRunner((snap && snap.activeFeature) ?? null, e.target.value, null));
});

$('modelSelect').addEventListener('change', async (e) => {
  // A model id this project does not know is still a model: typed in, passed
  // through, and shown in the command line so it is obvious what was sent.
  // Typed into the window rather than a dialog, because Electron has no
  // window.prompt - calling it does nothing at all, which would have looked
  // like the Custom option being broken.
  if (e.target.value === CUSTOM_MODEL) {
    const field = $('modelCustom');
    field.hidden = false;
    field.value = '';
    field.focus();
    return;
  }
  $('modelCustom').hidden = true;
  render(await window.ade.setRunner((snap && snap.activeFeature) ?? null, null, e.target.value));
});

$('modelCustom').addEventListener('keydown', async (e) => {
  if (e.key === 'Escape') { $('modelCustom').hidden = true; return render(snap); }
  if (e.key !== 'Enter') return;
  const model = $('modelCustom').value.trim();
  if (!model) return;
  $('modelCustom').hidden = true;
  render(await window.ade.setRunner((snap && snap.activeFeature) ?? null, null, model));
});

/* ----------------------------------------------------- slash commands --- */

let cmdOpen = false;

function renderCommandMenu(chat) {
  const menu = $('cmdMenu');
  const all = chat.commands || [];
  const typed = $('chatInput').value;
  const query = cmdOpen && typed.startsWith('/') ? typed.slice(1).toLowerCase() : '';
  const matches = all.filter((c) => c.name.toLowerCase().includes(query));

  menu.hidden = !cmdOpen;
  if (!cmdOpen) return;

  menu.textContent = '';
  if (!matches.length) {
    const empty = document.createElement('div');
    empty.className = 'cmd';
    empty.textContent = all.length ? 'no command matches' : 'no commands found in .claude/commands';
    menu.append(empty);
    return;
  }

  for (const command of matches) {
    const row = document.createElement('div');
    row.className = 'cmd';
    const name = document.createElement('b');
    name.textContent = `/${command.name}`;
    const description = document.createElement('span');
    description.textContent = command.description || '';
    description.title = command.description || '';
    const scope = document.createElement('i');
    scope.textContent = command.scope;
    row.append(name, description, scope);
    row.addEventListener('click', () => {
      $('chatInput').value = `/${command.name} `;
      cmdOpen = false;
      renderCommandMenu(chat);
      $('chatInput').focus();
    });
    menu.append(row);
  }
}

$('cmdBtn').addEventListener('click', () => {
  cmdOpen = !cmdOpen;
  renderCommandMenu((snap && snap.chat) || {});
});

$('chatInput').addEventListener('input', () => {
  // Opens on a leading slash, the way it does in the agent's own prompt.
  const open = $('chatInput').value.startsWith('/');
  if (open !== cmdOpen) cmdOpen = open;
  if (cmdOpen) renderCommandMenu((snap && snap.chat) || {});
  else $('cmdMenu').hidden = true;
});

/* ==================================================================== mcp = */

/**
 * The MCP panel.
 *
 * Two questions, and they are different. "What is configured" comes from the
 * files; "does it work" only comes from connecting, so a dot here is grey until
 * something actually handshook with the server. A green light derived from a
 * line existing in a JSON file would answer nothing.
 *
 * The checkboxes are the other half: they decide what the agent launched from
 * the dock may reach. Enforced by handing that agent a config written for the
 * occasion, never by editing the project's .mcp.json or anyone's settings.
 */
let selectedServer = null;

function renderMcp() {
  const host = $('mcpList');
  const servers = (snap && snap.mcp) || [];
  const chat = (snap && snap.chat) || {};
  const selection = chat.mcpSelection;
  host.textContent = '';

  // Three states, not two. "1/3 answered" hid the difference between a server
  // that refused and one nothing has asked yet, which is the distinction this
  // panel exists to make.
  const answered = servers.filter((s) => s.check && s.check.ok === true).length;
  const failed = servers.filter((s) => s.check && s.check.ok === false).length;
  const unchecked = servers.length - answered - failed;
  const parts = [`${servers.length} declared`];
  if (answered) parts.push(`${answered} answered`);
  if (failed) parts.push(`${failed} failed`);
  if (unchecked) parts.push(`${unchecked} not checked`);
  $('mcpHint').textContent = servers.length ? parts.join(' · ') : 'what the agents can reach';

  if (!servers.length) {
    const empty = document.createElement('p');
    empty.className = 'dim';
    empty.textContent = snap && snap.project
      ? 'no MCP servers declared for this project'
      : 'open a project first';
    host.append(empty);
    return;
  }

  for (const server of servers) {
    const row = document.createElement('div');
    const state = server.check ? (server.check.ok === true ? 'ok' : (server.check.ok === false ? 'bad' : '')) : '';
    row.className = `mcp ${state}${server.name === selectedServer ? ' sel' : ''}`;
    row.addEventListener('click', () => { selectedServer = server.name; renderMcp(); renderMcpTools(); });

    const head = document.createElement('div');
    head.className = 'mcp-head';

    const dot = document.createElement('span');
    dot.className = 'mcp-dot';
    const name = document.createElement('span');
    name.className = 'mcp-name';
    name.textContent = server.name;
    head.append(dot, name, tag('', server.transport), tag('', server.scope));

    if (server.check && server.check.ok === true) {
      head.append(tag('clean', `${server.check.tools.length} tool${server.check.tools.length === 1 ? '' : 's'}`));
    }

    const acts = document.createElement('div');
    acts.className = 'mcp-acts';

    // Which servers the next agent gets. Unticked everything means "no MCP at
    // all" and is a real choice, so the absence of a selection is null rather
    // than an empty list.
    const pick = document.createElement('label');
    pick.className = 'mcp-pick';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = selection === null || selection === undefined ? true : selection.includes(server.name);
    box.disabled = !chat.mcpSupported;
    box.addEventListener('click', (e) => e.stopPropagation());
    box.addEventListener('change', async () => {
      const current = Array.isArray(selection) ? [...selection] : servers.map((s) => s.name);
      const next = box.checked
        ? [...new Set([...current, server.name])]
        : current.filter((n) => n !== server.name);
      render(await window.ade.mcpSelect((snap && snap.activeFeature) ?? null, next));
    });
    pick.append(box, document.createTextNode('give'));

    const check = document.createElement('button');
    check.className = 'btn';
    check.textContent = 'Check';
    check.addEventListener('click', async (e) => {
      e.stopPropagation();
      check.textContent = '…';
      render(await window.ade.mcpCheck(server.name) && await window.ade.getSnapshot());
    });

    acts.append(pick, check);
    if (server.scope === 'project') {
      const remove = document.createElement('button');
      remove.className = 'btn';
      remove.textContent = 'Remove';
      remove.addEventListener('click', async (e) => {
        e.stopPropagation();
        const result = await window.ade.mcpRemove(server.name);
        if (!result.ok) $('mcpHint').textContent = result.error;
        render(await window.ade.getSnapshot());
      });
      acts.append(remove);
    }
    head.append(acts);
    row.append(head);

    const cmd = document.createElement('div');
    cmd.className = 'mcp-cmd';
    cmd.textContent = server.url || [server.command, ...(server.args || [])].join(' ');
    cmd.title = `${cmd.textContent}\n${server.source}`;
    row.append(cmd);

    if (server.check && server.check.ok !== true && server.check.reason) {
      const why = document.createElement('div');
      why.className = 'mcp-why';
      // Unchecked is not the same as broken, and the colour says which.
      why.style.color = server.check.ok === null ? 'var(--faint)' : 'var(--red)';
      why.textContent = server.check.reason;
      why.title = server.check.reason;
      row.append(why);
    }

    host.append(row);
  }

  if (!chat.mcpSupported) {
    const note = document.createElement('div');
    note.className = 'mcp-note';
    note.textContent = 'The selected agent cannot be told which MCP servers to use, so these boxes do nothing for it.';
    host.append(note);
  }
}

function renderMcpTools() {
  const host = $('mcpTools');
  const servers = (snap && snap.mcp) || [];
  const server = servers.find((s) => s.name === selectedServer);
  host.textContent = '';

  if (!server) {
    $('mcpToolsHint').textContent = 'select a server';
    const p = document.createElement('p');
    p.className = 'dim';
    p.textContent = 'select a server to see what it offers';
    host.append(p);
    return;
  }

  $('mcpToolsHint').textContent = server.name;

  if (!server.check) {
    const p = document.createElement('p');
    p.className = 'dim';
    p.textContent = 'not checked yet — Check asks the server itself what it offers';
    host.append(p);
    return;
  }
  if (server.check.ok !== true) {
    const p = document.createElement('p');
    p.className = 'dim';
    p.textContent = server.check.reason || 'the server did not answer';
    host.append(p);
    return;
  }

  for (const tool of server.check.tools) {
    const row = document.createElement('div');
    row.className = 'mcp-tool';
    const name = document.createElement('b');
    // The name the agent will actually see.
    name.textContent = `mcp__${server.name}__${tool.name}`;
    const description = document.createElement('span');
    description.textContent = tool.description || '';
    row.append(name, description);
    host.append(row);
  }
}

$('mcpCheckAll').addEventListener('click', async () => {
  $('mcpHint').textContent = 'checking…';
  await window.ade.mcpCheck(null);
  render(await window.ade.getSnapshot());
});

$('mcpAdd').addEventListener('click', async () => {
  const name = $('mcpName').value.trim();
  const text = $('mcpCommand').value.trim();
  if (!name || !text) return;
  const isUrl = /^https?:\/\//i.test(text);
  const [command, ...args] = text.split(/\s+/);
  const result = await window.ade.mcpAdd(isUrl
    ? { name, url: text }
    : { name, command, args });
  if (!result.ok) { $('mcpHint').textContent = result.error; return; }
  $('mcpName').value = '';
  $('mcpCommand').value = '';
  render(await window.ade.getSnapshot());
});
