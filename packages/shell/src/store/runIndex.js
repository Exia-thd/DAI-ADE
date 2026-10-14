/**
 * The run index — the model every view reads.
 *
 * Events arrive as a flat stream; the Flow timeline and the Roster both need a
 * tree with durations. Building that here, once, keeps the renderer a pure
 * function of state and means a replayed run and a live run go through exactly
 * the same code path. That equivalence is what makes "scrub back through a
 * finished run" fall out for free instead of being a second implementation.
 *
 * Kept in memory on purpose at this milestone. A SQLite index is the right
 * answer once a single run outgrows what a view can hold, but introducing a
 * native dependency before there is a measured need would buy a Windows
 * rebuild problem and nothing else.
 */

'use strict';

/** Events that open a span, and the event that closes each. */
const SPAN_CLOSERS = {
  RUN_STARTED: ['RUN_ENDED'],
  TURN_STARTED: ['TURN_ENDED'],
  TOOL_PROPOSED: ['TOOL_EXECUTED', 'TOOL_FAILED', 'TOOL_BLOCKED'],
  WORKER_SPAWNED: ['WORKER_DELIVERED', 'WORKER_MERGED', 'WORKER_FAILED'],
  PHASE_ENTERED: ['PHASE_EXITED'],
  GATE_REQUESTED: ['GATE_APPROVED', 'GATE_REJECTED'],
  ESCALATION_REQUESTED: ['ESCALATION_RESULT'],
  // A verification opens when its record is written and closes on the verdict.
  // Without this pair every bridged evidence record stayed "open" forever, so
  // a finished run showed a column of unresolved spans.
  EVIDENCE_WRITTEN: ['VERIFY_PASSED', 'VERIFY_FAILED'],
};

const OPENERS = new Set(Object.keys(SPAN_CLOSERS));
const CLOSER_TO_OPENER = new Map();
for (const [opener, closers] of Object.entries(SPAN_CLOSERS)) {
  for (const c of closers) CLOSER_TO_OPENER.set(c, opener);
}

/** A closed span whose last event says the work did not succeed. */
const FAILURE_CLOSERS = new Set(['TOOL_FAILED', 'TOOL_BLOCKED', 'WORKER_FAILED', 'GATE_REJECTED', 'VERIFY_FAILED']);

class RunIndex {
  constructor() {
    /** @type {Map<string, object>} run_id -> run */
    this.runs = new Map();
    this.seen = new Set(); // event ids, for dedupe across ingestion paths
  }

  /**
   * Add one event. Returns true if it was new.
   *
   * Dedupe is on event id rather than a sequence number because the same event
   * legitimately arrives twice: once over the live path and once when the file
   * holding it is tailed. The file is the record; the duplicate is the hint.
   */
  add(event) {
    if (this.seen.has(event.id)) return false;
    this.seen.add(event.id);

    const run = this.run(event.run_id);
    run.events.push(event);
    if (!run.startedAt || event.ts < run.startedAt) run.startedAt = event.ts;
    if (!run.endedAt || event.ts > run.endedAt) run.endedAt = event.ts;

    this.applySpan(run, event);
    this.applyCounters(run, event);
    return true;
  }

  run(runId) {
    let run = this.runs.get(runId);
    if (!run) {
      run = {
        id: runId,
        startedAt: null,
        endedAt: null,
        events: [],
        spans: new Map(),
        counters: { tools: 0, blocked: 0, failed: 0, workers: 0, evidence: 0, cost: 0 },
      };
      this.runs.set(runId, run);
    }
    return run;
  }

  applySpan(run, event) {
    const id = event.span_id;
    let span = run.spans.get(id);
    if (!span) {
      span = {
        id,
        parent: event.parent_span_id,
        actor: event.actor,
        type: OPENERS.has(event.type) ? event.type : null,
        openedAt: null,
        closedAt: null,
        status: 'open',
        events: [],
      };
      run.spans.set(id, span);
    }
    span.events.push(event);

    if (OPENERS.has(event.type)) {
      span.type = event.type;
      // Keep the earliest opener: a span re-opened by a duplicate hook should
      // not have its start time pushed forward.
      if (!span.openedAt || event.ts < span.openedAt) span.openedAt = event.ts;
      if (span.status === 'open') span.actor = event.actor;
    }
    if (CLOSER_TO_OPENER.has(event.type)) {
      // A closer with no opener is a real case, not corruption: a guardrail
      // refusal is bridged from the harness even when the tool call it stopped
      // never produced a proposal event — being stopped is why. Treat it as an
      // instant at its own timestamp rather than leaving openedAt null, which
      // rendered as a span of unknown duration that no view could place.
      if (!span.openedAt) {
        span.openedAt = event.ts;
        span.instantaneous = true;
        if (!span.type) span.type = CLOSER_TO_OPENER.get(event.type);
      }
      span.closedAt = event.ts;
      span.status = FAILURE_CLOSERS.has(event.type) ? 'failed' : 'closed';
      span.closedBy = event.type;
    }
  }

  applyCounters(run, event) {
    const c = run.counters;
    switch (event.type) {
      case 'TOOL_PROPOSED': c.tools++; break;
      case 'TOOL_BLOCKED': c.blocked++; break;
      case 'TOOL_FAILED': c.failed++; break;
      case 'WORKER_SPAWNED': c.workers++; break;
      case 'EVIDENCE_WRITTEN': c.evidence++; break;
      case 'COST_UPDATE':
        if (typeof event.payload?.cost === 'number') c.cost += event.payload.cost;
        break;
      default: break;
    }
  }

  /**
   * The agent map: one entry per actor that does work, with what it is doing.
   *
   * Built from spans rather than events because an actor's current activity is
   * its most recent unfinished span — and when everything it started has
   * finished, the last one it closed is still the honest answer to "what was it
   * doing", which an event list cannot give you without re-deriving all of this.
   *
   * `idleMs` is measured against the newest event in the whole index, not the
   * wall clock: a run replayed from disk hours later is not idle, it is over,
   * and marking a finished run's agents as "stalled" would be a lie told
   * confidently.
   */
  agents(runId = null) {
    const runs = runId && runId !== '*' ? [runId] : [...this.runs.keys()];
    const newest = Math.max(
      0,
      ...runs.map((id) => Date.parse(this.runs.get(id)?.endedAt ?? 0) || 0),
    );

    const out = [];
    for (const id of runs) {
      const run = this.runs.get(id);
      if (!run) continue;

      // Actors that do work: the session itself and anything it spawned. Tools
      // are what an agent does, not an agent.
      const actors = new Map();
      for (const span of run.spans.values()) {
        if (!span.actor || span.actor.kind === 'tool') continue;
        // Phases and gates arrive from the harness as root actors. They are
        // pipeline state, not agents: they do no work and have no activity.
        if (/^(phase|gate):/.test(String(span.actor.id))) continue;
        const key = `${span.actor.kind}:${span.actor.id}`;
        if (!actors.has(key)) actors.set(key, { actor: span.actor, spans: [] });
        actors.get(key).spans.push(span);
      }

      for (const [key, entry] of actors) {
        const spans = entry.spans.sort((a, b) =>
          String(a.openedAt ?? '').localeCompare(String(b.openedAt ?? '')));
        const open = spans.filter((sp) => sp.status === 'open');
        const events = spans.flatMap((sp) => sp.events);
        if (!events.length) continue;
        events.sort((a, b) => a.ts.localeCompare(b.ts));
        const last = events[events.length - 1];

        // What it is doing: the newest tool span whose parent is one of this
        // actor's spans. Open first, then the most recent closed one.
        // Sub-agents own none: PreToolUse does not say which sub-agent is
        // running, so tool calls belong to the turn. `attributable` says so
        // rather than reporting a zero that reads as "did nothing".
        const owned = new Set(spans.map((sp) => sp.id));
        const toolSpans = [...run.spans.values()]
          .filter((sp) => sp.actor && sp.actor.kind === 'tool' && owned.has(sp.parent))
          .sort((a, b) => String(a.openedAt ?? '').localeCompare(String(b.openedAt ?? '')));
        const activeTool = toolSpans.filter((sp) => sp.status === 'open').pop();
        const lastTool = activeTool || toolSpans[toolSpans.length - 1] || null;

        // Tokens and model come from COST_UPDATE, which the harness emits and
        // hooks cannot: a hook payload carries no usage. Both stay null when
        // nothing reported them - a node showing a confident 0 tokens would be
        // read as "this agent used none", which is not what the stream says.
        let tokens = 0;
        let contextTokens = null;
        let model = entry.actor.model ?? null;
        for (const event of events) {
          if (event.type !== 'COST_UPDATE') continue;
          const p = event.payload || {};
          // Generated tokens accumulate; a context size does not - it is a
          // measurement of one moment, so the newest reading replaces the last
          // rather than being added to it.
          tokens += Number(p.outputTokens) || 0;
          if (Number.isFinite(Number(p.contextTokens))) contextTokens = Number(p.contextTokens);
          if (p.model) model = p.model;
        }

        const elapsedMs = Date.parse(last.ts) - Date.parse(spans[0].openedAt ?? events[0].ts);
        const idleMs = newest ? newest - Date.parse(last.ts) : 0;
        // There is no session-end hook, so a session's root span is open
        // forever and "has an open span" can never mean "still working".
        // Recency is the only honest signal, and `done` is never claimed
        // because nothing in the stream says a session finished.
        const status = idleMs < 120_000 ? 'working' : 'idle';
        const hadFailure = spans.some((sp) => sp.status === 'failed')
          || toolSpans.some((sp) => sp.status === 'failed');

        out.push({
          key: `${id}/${key}`,
          runId: id,
          kind: entry.actor.kind,
          id: entry.actor.id,
          tier: entry.actor.tier ?? null,
          model,
          tokens: tokens || null,
        contextTokens,
          elapsedMs: Number.isFinite(elapsedMs) ? elapsedMs : null,
          parentKey: parentAgentKey(run, spans, id),
          status,
          hadFailure,
          attributable: entry.actor.kind !== 'worker',
          startedAt: spans[0].openedAt ?? events[0].ts,
          lastSeenAt: last.ts,
          idleMs,
          turns: spans.filter((sp) => sp.type === 'TURN_STARTED').length,
          tools: toolSpans.length,
          blocked: toolSpans.filter((sp) => sp.closedBy === 'TOOL_BLOCKED').length,
          failedTools: toolSpans.filter((sp) => sp.closedBy === 'TOOL_FAILED').length,
          doing: lastTool
            ? {
                tool: lastTool.actor.id,
                live: Boolean(activeTool),
                detail: describeTool(lastTool),
                since: lastTool.openedAt,
              }
            : null,
          prompt: lastPrompt(spans),
        });
      }
    }

    const rank = { working: 0, idle: 1 };
    return out.sort((a, b) =>
      (rank[a.status] - rank[b.status]) || String(b.lastSeenAt).localeCompare(String(a.lastSeenAt)));
  }

  /** Spans as a tree, for the Roster and the Flow lanes. */
  tree(runId) {
    const run = this.runs.get(runId);
    if (!run) return [];
    const byParent = new Map();
    for (const span of run.spans.values()) {
      const key = span.parent ?? '__root__';
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key).push(span);
    }
    const build = (key) =>
      (byParent.get(key) ?? [])
        .sort((a, b) => String(a.openedAt ?? '').localeCompare(String(b.openedAt ?? '')))
        .map((span) => ({
          id: span.id,
          actor: span.actor,
          type: span.type,
          status: span.status,
          openedAt: span.openedAt,
          closedAt: span.closedAt,
          durationMs: span.openedAt && span.closedAt ? Date.parse(span.closedAt) - Date.parse(span.openedAt) : null,
          // When a span never closes, this is the last thing that happened in
          // it. There is no session-end hook, so every run would otherwise be
          // drawn as still open and stretch the timeline to the present,
          // squashing every real span into a sliver.
          lastEventAt: span.events.length ? span.events[span.events.length - 1].ts : null,
          instantaneous: !!span.instantaneous,
          eventCount: span.events.length,
          children: build(span.id),
        }));
    return build('__root__');
  }

  summary(runId) {
    const run = this.runs.get(runId);
    if (!run) return null;
    let open = 0;
    for (const s of run.spans.values()) if (s.status === 'open') open++;
    return {
      id: run.id,
      startedAt: run.startedAt,
      endedAt: run.endedAt,
      durationMs: run.startedAt && run.endedAt ? Date.parse(run.endedAt) - Date.parse(run.startedAt) : 0,
      events: run.events.length,
      spans: run.spans.size,
      openSpans: open,
      ...run.counters,
    };
  }

  /**
   * Every run at once, as one tree.
   *
   * Parallel work is the normal case: four features in flight is four agent
   * sessions, and a window that shows one at a time cannot answer "what is
   * running right now" — the question an ADE exists to answer. Each run becomes
   * a top-level lane; spans keep their own parentage underneath.
   */
  treeAll() {
    const out = [];
    for (const runId of this.runs.keys()) {
      const children = this.tree(runId);
      if (!children.length) continue;
      const opened = children.map((c) => c.openedAt).filter(Boolean).sort()[0] ?? null;
      const closedTimes = children.map((c) => c.closedAt);
      const closed = closedTimes.every(Boolean) ? closedTimes.sort().slice(-1)[0] : null;
      out.push({
        id: runId,
        actor: { kind: 'root', id: runId },
        type: 'RUN_STARTED',
        status: closed ? 'closed' : 'open',
        openedAt: opened,
        closedAt: closed,
        durationMs: opened && closed ? Date.parse(closed) - Date.parse(opened) : null,
        instantaneous: false,
        eventCount: this.runs.get(runId).events.length,
        lastEventAt: this.runs.get(runId).endedAt,
        children,
      });
    }
    return out.sort((a, b) => String(a.openedAt ?? '').localeCompare(String(b.openedAt ?? '')));
  }

  /** The counters of every run added together. */
  summaryAll() {
    const all = this.list();
    if (!all.length) return null;
    const sum = (key) => all.reduce((n, r) => n + (r[key] || 0), 0);
    const starts = all.map((r) => r.startedAt).filter(Boolean).sort();
    const ends = all.map((r) => r.endedAt).filter(Boolean).sort();
    return {
      id: '*',
      startedAt: starts[0] ?? null,
      endedAt: ends[ends.length - 1] ?? null,
      durationMs: starts.length && ends.length ? Date.parse(ends[ends.length - 1]) - Date.parse(starts[0]) : 0,
      events: sum('events'), spans: sum('spans'), openSpans: sum('openSpans'),
      tools: sum('tools'), blocked: sum('blocked'), failed: sum('failed'),
      workers: sum('workers'), evidence: sum('evidence'), cost: sum('cost'),
      runs: all.length,
    };
  }

  list() {
    return [...this.runs.keys()].map((id) => this.summary(id)).sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
  }
}

/**
 * Which agent spawned this one, as a key into the same list.
 *
 * A sub-agent's span hangs off a turn, and the turn belongs to the session, so
 * the edge the map needs is one level further up than the span tree gives.
 */
function parentAgentKey(run, spans, runId) {
  for (const span of spans) {
    let parent = span.parent ? run.spans.get(span.parent) : null;
    // Walk up past turns, which are the session acting, not a separate actor.
    while (parent && parent.actor && parent.actor.kind === 'tool') {
      parent = parent.parent ? run.spans.get(parent.parent) : null;
    }
    if (!parent || !parent.actor) continue;
    const key = `${runId}/${parent.actor.kind}:${parent.actor.id}`;
    if (key !== `${runId}/${span.actor.kind}:${span.actor.id}`) return key;
  }
  return null;
}

/** A one-line description of what a tool call is actually touching. */
function describeTool(span) {
  const payload = span.events.map((e) => e.payload).find((p) => p && p.input);
  const input = payload && payload.input;
  if (!input || typeof input !== 'object') return null;
  if (input.truncated) return `${input.bytes} bytes`;
  for (const field of ['command', 'file_path', 'file', 'path', 'pattern', 'query', 'url']) {
    if (typeof input[field] === 'string') return input[field];
  }
  const first = Object.values(input).find((v) => typeof v === 'string');
  return first ?? null;
}

/** The most recent prompt this actor was working on. */
function lastPrompt(spans) {
  let found = null;
  for (const span of spans) {
    for (const event of span.events) {
      if (event.type === 'TURN_STARTED' && event.payload && event.payload.prompt) {
        const prompt = event.payload.prompt;
        found = typeof prompt === 'string' ? prompt : (prompt.preview ?? null);
      }
    }
  }
  return found;
}

module.exports = { RunIndex, SPAN_CLOSERS };
