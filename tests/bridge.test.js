/**
 * The bridge reads harness-native formats. These tests pin the shapes as they
 * were measured in a real .daiharness directory, so a format drift shows up
 * here rather than as a quietly empty Flow pane.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const bridge = require('../packages/shell/src/ingest/harnessBridge.js');
const { validateEvent } = require('../packages/shared/src/events.js');
const { RunIndex } = require('../packages/shell/src/store/runIndex.js');

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dai-ade-bridge-'));
  fs.mkdirSync(path.join(dir, '.daiharness', 'telemetry'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.daiharness', 'verify'), { recursive: true });
  return dir;
}

const line = (obj) => JSON.stringify(obj);

test('a guardrail refusal becomes TOOL_BLOCKED with the pattern that matched', () => {
  const dir = project();
  fs.writeFileSync(path.join(dir, '.daiharness', 'telemetry', 'events-202610.jsonl'),
    [
      line({ ts: '2026-10-05T10:00:00Z', event: 'test.event', data: { ok: true } }),
      line({ ts: '2026-10-05T10:00:01Z', event: 'policy.deny', data: { tool: 'Bash', pattern: 'rm -rf', mode: 'strict' } }),
      line({ ts: '2026-10-05T10:00:02Z', event: 'policy.warn', data: { tool: 'run_command', pattern: 'chmod 777', mode: 'permissive' } }),
    ].join('\n') + '\n');

  const events = bridge.fromTelemetry(dir, { runId: 'run_x', parent: null });
  assert.equal(events.length, 2, 'only policy events are bridged, not test noise');
  assert.ok(events.every((e) => validateEvent(e).ok));

  const deny = events[0];
  assert.equal(deny.type, 'TOOL_BLOCKED');
  assert.equal(deny.actor.id, 'Bash');
  assert.equal(deny.payload.pattern, 'rm -rf', 'the matched pattern is the point of the event');
  assert.equal(deny.payload.mode, 'strict');
  assert.equal(deny.payload.severity, 'deny');
  assert.equal(events[1].payload.severity, 'warn');
});

test('an evidence record becomes WRITTEN plus a PASS or FAIL', () => {
  const dir = project();
  const record = {
    schema_version: '2', exit_code: 0, tier: 'unit', risk: 'hard', phase: 'verification',
    turn: 7, tree_sha: 'TREE:abc', timestamp_utc: '2026-10-05T11:00:00Z',
    command: ['python', '-m', 'pytest', 'tests/x.py'],
    acceptance_criteria: [{ id: 'a1', claim: 'x' }, { id: 'a2', claim: 'y' }],
    limitations: ['hard-completion-unverified'],
    reviewer: { status: 'pending' },
  };
  fs.writeFileSync(path.join(dir, '.daiharness', 'verify', 'r1.json'), line(record));

  const events = bridge.fromEvidence(dir, { runId: 'run_x', parent: null });
  assert.equal(events.length, 2);
  assert.deepEqual(events.map((e) => e.type), ['EVIDENCE_WRITTEN', 'VERIFY_PASSED']);
  assert.deepEqual(events[0].payload.acceptance, ['a1', 'a2']);
  assert.equal(events[0].payload.command, 'python -m pytest tests/x.py');
  assert.equal(events[0].payload.reviewer_status, 'pending', 'review-1 is not independent approval');
  assert.equal(events[0].span_id, events[1].span_id, 'both describe one verification');

  // A non-zero exit is a failure even though the record exists.
  fs.writeFileSync(path.join(dir, '.daiharness', 'verify', 'r2.json'), line({ ...record, exit_code: 1 }));
  const after = bridge.fromEvidence(dir, { runId: 'run_x', parent: null });
  assert.ok(after.some((e) => e.type === 'VERIFY_FAILED'));
});

test('phases and gates come out of the pipeline snapshot', () => {
  const dir = project();
  fs.writeFileSync(path.join(dir, '.daiharness', 'pipeline-state.json'), line({
    goal: 'build a todo API', mode: 'FULL_BUILD', status: 'running', phase_index: 2,
    phases: [
      { key: 'interpret', status: 'passed' },
      { key: 'build', status: 'running' },
      { key: 'ship', status: 'pending' },
    ],
    pending_gate: 'gate3_build',
    gates: { gate1_brd: { approved: true, summary: 'BRD ready', ts: 1785485317.1 } },
  }));

  const events = bridge.fromPipeline(dir, { runId: 'run_x', parent: null });
  const types = events.map((e) => e.type);
  assert.ok(types.includes('PHASE_EXITED'), 'a passed phase has exited');
  assert.ok(types.includes('PHASE_ENTERED'), 'a running phase has been entered');
  assert.equal(events.filter((e) => e.type.startsWith('PHASE_')).length, 2, 'pending phases are not events yet');
  assert.ok(types.includes('GATE_APPROVED'));
  assert.ok(types.includes('GATE_REQUESTED'), 'the pending gate is what a view must surface');
  assert.ok(events.every((e) => validateEvent(e).ok));
});

test('syncing twice writes nothing the second time', () => {
  const dir = project();
  fs.writeFileSync(path.join(dir, '.daiharness', 'telemetry', 'e.jsonl'),
    line({ ts: '2026-10-05T10:00:01Z', event: 'policy.deny', data: { tool: 'Bash', pattern: 'p', mode: 'strict' } }) + '\n');

  const first = bridge.sync(dir);
  assert.equal(first.written, 1);
  const second = bridge.sync(dir);
  assert.equal(second.written, 0, 'derived ids make a re-read free');

  const file = path.join(dir, '.dai-ade', 'events', `${first.runId}.jsonl`);
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);

  const index = new RunIndex();
  index.add(JSON.parse(lines[0]));
  assert.equal(index.summary(first.runId).blocked, 1);
});

test('a project without a harness is left alone', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dai-ade-nohar-'));
  assert.equal(bridge.detect(dir), false);
  assert.equal(bridge.sync(dir).written, 0);
  assert.equal(fs.existsSync(path.join(dir, '.dai-ade')), false,
    'nothing is created in a project with no harness');
});

test('bridged events attach to a live session when one is running', () => {
  const dir = project();
  const events = path.join(dir, '.dai-ade', 'events');
  fs.mkdirSync(events, { recursive: true });
  fs.writeFileSync(path.join(events, 'run_live.turn'), 'sp_turn_ABC');
  fs.writeFileSync(path.join(dir, '.daiharness', 'telemetry', 'e.jsonl'),
    line({ ts: '2026-10-05T10:00:01Z', event: 'policy.deny', data: { tool: 'Bash', pattern: 'p' } }) + '\n');

  const ctx = bridge.correlate(dir);
  assert.equal(ctx.runId, 'run_live');
  assert.equal(ctx.parent, 'sp_turn_ABC',
    'a refusal belongs on the timeline of the turn it interrupted');

  const res = bridge.sync(dir);
  assert.equal(res.runId, 'run_live');
  assert.equal(res.written, 1);
});
