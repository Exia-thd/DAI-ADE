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

  list() {
    return [...this.runs.keys()].map((id) => this.summary(id)).sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
  }
}

module.exports = { RunIndex, SPAN_CLOSERS };
