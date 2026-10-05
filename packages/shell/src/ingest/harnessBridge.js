/**
 * Harness bridge — turns what the DAI Harness already writes into ade-event/v1.
 *
 * The plan's M2 was going to patch the harness to emit events. It does not need
 * patching: `policy_check.py` already records every guardrail refusal,
 * `run_check.py` already writes evidence records, and the pipeline already
 * keeps its phase and gate state on disk. All three are harness-native formats
 * that nothing was reading.
 *
 * Reading them instead of changing them matters for the installer too: the ADE
 * can be installed beside a harness without modifying that repository, so
 * updating one never breaks the other.
 *
 * Hooks see a tool *proposed* and *executed*. Only the harness knows a call was
 * **refused** and which deny pattern matched — `TOOL_BLOCKED` is the event no
 * black-box agent supervisor can produce, and it comes from here.
 *
 * Idempotence: every event id is derived from the artefact that produced it, so
 * re-reading a file after a restart regenerates identical ids and the store
 * dedupes them. The bridge can run as often as it likes.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { makeEvent, shortHash } = require('../../../shared/src/events.js');

const HARNESS_DIR = '.daiharness';
const ROOT_SPAN = 'sp_root';

/** Deterministic id for an event derived from a harness artefact. */
function derivedId(...parts) {
  // Same material in, same id out — that is what makes re-reads free.
  return `H${shortHash(parts.join('\u0000'), 25)}`;
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

/* ---------------------------------------------------------- correlation -- */

/**
 * Which run these belong to.
 *
 * If a Claude session is live in this project the emitter has left a turn
 * pointer, and attaching to that run puts a blocked tool call on the same
 * timeline as the call that was blocked. With no session, harness activity
 * still deserves a home, so it gets a stable per-project run of its own.
 *
 * Stated plainly because it is a real limitation: this correlates by *time and
 * project*, not by identity. A guardrail refusal that happens while two
 * sessions are live in one checkout can land on the wrong one.
 */
function correlate(project) {
  const dir = path.join(project, '.dai-ade', 'events');
  let newest = null;
  try {
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.turn')) continue;
      const file = path.join(dir, name);
      const stat = fs.statSync(file);
      if (!newest || stat.mtimeMs > newest.mtimeMs) {
        newest = { mtimeMs: stat.mtimeMs, runId: name.replace(/\.turn$/, ''), file };
      }
    }
  } catch { /* no store yet */ }

  if (newest) {
    let span = null;
    try { span = fs.readFileSync(newest.file, 'utf8').trim() || null; } catch { /* ignore */ }
    return { runId: newest.runId, parent: span || ROOT_SPAN };
  }
  return { runId: `run_harness_${shortHash(path.resolve(project), 8)}`, parent: null };
}

/* -------------------------------------------------------------- sources -- */

/** Guardrail refusals, from the harness's own telemetry JSONL. */
function fromTelemetry(project, ctx) {
  const dir = path.join(project, HARNESS_DIR, 'telemetry');
  const events = [];
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')); } catch { return events; }

  for (const name of files) {
    let text;
    try { text = fs.readFileSync(path.join(dir, name), 'utf8'); } catch { continue; }
    let line = 0;
    for (const raw of text.split('\n')) {
      line++;
      if (!raw.trim()) continue;
      let rec;
      try { rec = JSON.parse(raw); } catch { continue; }
      const kind = rec.event;
      if (kind !== 'policy.deny' && kind !== 'policy.warn' && kind !== 'rule.violation') continue;

      const data = rec.data || {};
      const tool = data.tool || 'unknown';
      events.push(makeEvent({
        id: derivedId('telemetry', name, line, rec.ts, kind),
        ts: rec.ts || new Date().toISOString(),
        type: kind === 'rule.violation' ? 'RULE_VIOLATION' : 'TOOL_BLOCKED',
        run_id: ctx.runId,
        // A refusal is its own span: the tool call it refers to may never have
        // produced a hook event at all, precisely because it was stopped.
        span_id: `sp_blk_${shortHash(`${name}:${line}`, 10)}`,
        parent_span_id: ctx.parent,
        actor: { kind: 'tool', id: tool },
        payload: {
          source: 'harness.telemetry',
          tool,
          pattern: data.pattern ?? null,
          mode: data.mode ?? null,
          severity: kind === 'policy.warn' ? 'warn' : 'deny',
        },
      }));
    }
  }
  return events;
}

/** Evidence records written by run_check.py — whether "done" was ever proven. */
function fromEvidence(project, ctx) {
  const dir = path.join(project, HARNESS_DIR, 'verify');
  const events = [];
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { return events; }

  for (const name of files) {
    const record = readJson(path.join(dir, name));
    if (!record) continue;
    const ts = record.timestamp_utc || new Date().toISOString();
    const span = `sp_ev_${shortHash(name, 10)}`;
    const passed = record.exit_code === 0;
    const acceptance = (record.acceptance_criteria || []).map((a) => a.id);

    const common = {
      run_id: ctx.runId,
      span_id: span,
      parent_span_id: ctx.parent,
      actor: { kind: 'tool', id: 'verify' },
    };
    const payload = {
      source: 'harness.verify',
      record: name,
      schema_version: record.schema_version ?? null,
      tier: record.tier ?? null,
      risk: record.risk ?? null,
      phase: record.phase ?? null,
      turn: record.turn ?? null,
      exit_code: record.exit_code ?? null,
      acceptance,
      command: Array.isArray(record.command) ? record.command.join(' ') : null,
      tree_sha: record.tree_sha ?? null,
      limitations: record.limitations ?? [],
      // review-1 self-authored evidence is not independent approval; the view
      // should be able to say so without re-deriving the rule.
      reviewer_status: record.reviewer?.status ?? 'none',
    };

    events.push(makeEvent({ ...common, id: derivedId('verify', name, 'written'), ts, type: 'EVIDENCE_WRITTEN', payload }));
    events.push(makeEvent({
      ...common,
      id: derivedId('verify', name, passed ? 'pass' : 'fail'),
      ts,
      type: passed ? 'VERIFY_PASSED' : 'VERIFY_FAILED',
      payload,
    }));
  }
  return events;
}

/**
 * Phases and gates from the pipeline state file.
 *
 * This is a *snapshot*, not a log, so the bridge can only report the state it
 * finds. A phase that opened and closed between two reads is invisible — which
 * is why the id includes the status: a phase seen as running and later as
 * passed produces two distinct events rather than one that silently changes.
 */
function fromPipeline(project, ctx) {
  const file = path.join(project, HARNESS_DIR, 'pipeline-state.json');
  const state = readJson(file);
  if (!state) return [];

  let mtime;
  try { mtime = fs.statSync(file).mtime.toISOString(); } catch { mtime = new Date().toISOString(); }

  const events = [];
  for (const phase of state.phases || []) {
    if (!phase.key || phase.status === 'pending') continue;
    const done = phase.status === 'passed' || phase.status === 'failed';
    events.push(makeEvent({
      id: derivedId('phase', phase.key, phase.status),
      ts: mtime,
      type: done ? 'PHASE_EXITED' : 'PHASE_ENTERED',
      run_id: ctx.runId,
      span_id: `sp_ph_${shortHash(phase.key, 10)}`,
      parent_span_id: ctx.parent,
      actor: { kind: 'root', id: `phase:${phase.key}` },
      payload: { source: 'harness.pipeline', phase: phase.key, status: phase.status, mode: state.mode ?? null, goal: state.goal ?? null },
    }));
  }

  for (const [name, gate] of Object.entries(state.gates || {})) {
    const ts = typeof gate.ts === 'number' ? new Date(gate.ts * 1000).toISOString() : mtime;
    events.push(makeEvent({
      id: derivedId('gate', name, String(gate.approved)),
      ts,
      type: gate.approved ? 'GATE_APPROVED' : 'GATE_REQUESTED',
      run_id: ctx.runId,
      span_id: `sp_gate_${shortHash(name, 10)}`,
      parent_span_id: ctx.parent,
      actor: { kind: 'root', id: `gate:${name}` },
      payload: { source: 'harness.pipeline', gate: name, approved: !!gate.approved, summary: gate.summary ?? null },
    }));
  }

  if (state.pending_gate) {
    events.push(makeEvent({
      id: derivedId('gate-pending', String(state.pending_gate), mtime),
      ts: mtime,
      type: 'GATE_REQUESTED',
      run_id: ctx.runId,
      span_id: `sp_gate_${shortHash(String(state.pending_gate), 10)}`,
      parent_span_id: ctx.parent,
      actor: { kind: 'root', id: `gate:${state.pending_gate}` },
      payload: { source: 'harness.pipeline', gate: state.pending_gate, approved: false, pending: true },
    }));
  }
  return events;
}

/* ---------------------------------------------------------------- sync --- */

/** True when this project looks like it has a harness to bridge. */
function detect(project) {
  return fs.existsSync(path.join(project, HARNESS_DIR));
}

/**
 * Read every harness source and append whatever is not already in the store.
 * Returns the number of newly written events.
 */
function sync(project) {
  if (!detect(project)) return { written: 0, reason: 'no .daiharness directory' };
  const ctx = correlate(project);
  const produced = [
    ...fromTelemetry(project, ctx),
    ...fromEvidence(project, ctx),
    ...fromPipeline(project, ctx),
  ];
  if (!produced.length) return { written: 0, reason: 'nothing to bridge', runId: ctx.runId };

  const dir = path.join(project, '.dai-ade', 'events');
  const file = path.join(dir, `${ctx.runId}.jsonl`);
  fs.mkdirSync(dir, { recursive: true });

  // Ids are derived, so "already written" is answerable without a database.
  const known = new Set();
  try {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { known.add(JSON.parse(line).id); } catch { /* torn tail */ }
    }
  } catch { /* first run */ }

  const fresh = produced.filter((e) => !known.has(e.id));
  if (fresh.length) {
    fs.appendFileSync(file, fresh.map((e) => JSON.stringify(e)).join('\n') + '\n');
  }
  return { written: fresh.length, total: produced.length, runId: ctx.runId };
}

module.exports = { sync, detect, correlate, fromTelemetry, fromEvidence, fromPipeline, derivedId };
