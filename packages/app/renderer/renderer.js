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
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
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
  const ends = rows.map((r) => (r.closedAt ? Date.parse(r.closedAt) : horizon)).filter(Number.isFinite);
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
    const e = r.closedAt ? Date.parse(r.closedAt) : now;
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
  sel.innerHTML = snap.runs.map((r) =>
    `<option value="${esc(r.id)}" ${r.id === snap.selected ? 'selected' : ''}>${esc(r.id)} · ${r.events}</option>`).join('')
    || '<option>no runs</option>';

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

function render(next) {
  snap = next;
  renderChrome();
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
