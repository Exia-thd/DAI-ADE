/**
 * The agent map. Each test pins a claim the view makes on screen, because a
 * dashboard that is confidently wrong is worse than no dashboard: nobody
 * double-checks a green dot.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { RunIndex } = require('../packages/shell/src/store/runIndex.js');
const { makeEvent } = require('../packages/shared/src/events.js');

const AT = (secondsAgo) => new Date(Date.now() - secondsAgo * 1000).toISOString();

function build(events) {
  const index = new RunIndex();
  for (const e of events) index.add(makeEvent(e));
  return index;
}

const session = (id, ts, type = 'RUN_STARTED', span = 'sp_root') => ({
  type, run_id: id, span_id: span, parent_span_id: type === 'RUN_STARTED' ? null : 'sp_root',
  actor: { kind: 'root', id: `sess-${id}` }, ts,
});

test('an agent is working when it was active recently, idle when it was not', () => {
  const index = build([
    session('r1', AT(600)),
    session('r1', AT(600), 'TURN_STARTED', 'sp_turn_old'),
    session('r1', AT(590), 'TURN_ENDED', 'sp_turn_old'),
    session('r2', AT(20)),
    session('r2', AT(20), 'TURN_STARTED', 'sp_turn_new'),
  ]);

  const byId = Object.fromEntries(index.agents('*').map((a) => [a.id, a]));
  assert.equal(byId['sess-r2'].status, 'working');
  assert.equal(byId['sess-r1'].status, 'idle', 'ten minutes quiet is not working');
  // `done` is never claimed: nothing in the stream says a session ended.
  assert.ok(!index.agents('*').some((a) => a.status === 'done'));
});

test('idleness is measured against the stream, not the wall clock', () => {
  // A run replayed from disk a year later is finished, not stalled. Measuring
  // against Date.now would mark every historical agent as long-dead and make
  // the view useless for anything but this minute.
  const old = '2024-01-01T10:00:00.000Z';
  const index = build([
    { type: 'RUN_STARTED', run_id: 'r', span_id: 'sp_root', parent_span_id: null,
      actor: { kind: 'root', id: 'sess-old' }, ts: old },
    { type: 'TURN_STARTED', run_id: 'r', span_id: 'sp_t', parent_span_id: 'sp_root',
      actor: { kind: 'root', id: 'sess-old' }, ts: '2024-01-01T10:00:30.000Z' },
  ]);
  assert.equal(index.agents('*')[0].status, 'working',
    'the newest event in the index is "now" for a replayed run');
});

test('the map says what an agent is doing, and whether it is still running', () => {
  const index = build([
    session('r', AT(60)),
    session('r', AT(60), 'TURN_STARTED', 'sp_turn'),
    { type: 'TOOL_PROPOSED', run_id: 'r', span_id: 'sp_tool', parent_span_id: 'sp_turn',
      actor: { kind: 'tool', id: 'Bash' }, ts: AT(50),
      payload: { tool: 'Bash', input: { command: 'npm run lint' } } },
  ]);
  const agent = index.agents('*').find((a) => a.kind === 'root');
  assert.equal(agent.doing.tool, 'Bash');
  assert.equal(agent.doing.detail, 'npm run lint', 'the command is what someone wants to read');
  assert.equal(agent.doing.live, true, 'an unfinished tool call is still running');
  assert.equal(agent.tools, 1);
});

test('a finished tool call is still the answer to "what was it doing"', () => {
  const index = build([
    session('r', AT(400)),
    session('r', AT(400), 'TURN_STARTED', 'sp_turn'),
    { type: 'TOOL_PROPOSED', run_id: 'r', span_id: 'sp_tool', parent_span_id: 'sp_turn',
      actor: { kind: 'tool', id: 'Edit' }, ts: AT(390),
      payload: { tool: 'Edit', input: { file_path: 'src/auth/session.ts' } } },
    { type: 'TOOL_EXECUTED', run_id: 'r', span_id: 'sp_tool', parent_span_id: 'sp_turn',
      actor: { kind: 'tool', id: 'Edit' }, ts: AT(388), payload: { tool: 'Edit' } },
  ]);
  const agent = index.agents('*').find((a) => a.kind === 'root');
  assert.equal(agent.doing.tool, 'Edit');
  assert.equal(agent.doing.detail, 'src/auth/session.ts');
  assert.equal(agent.doing.live, false);
});

test('blocked and failed tool calls are counted against the agent', () => {
  const index = build([
    session('r', AT(30)),
    session('r', AT(30), 'TURN_STARTED', 'sp_turn'),
    { type: 'TOOL_PROPOSED', run_id: 'r', span_id: 'sp_a', parent_span_id: 'sp_turn',
      actor: { kind: 'tool', id: 'Bash' }, ts: AT(28), payload: { tool: 'Bash' } },
    { type: 'TOOL_BLOCKED', run_id: 'r', span_id: 'sp_a', parent_span_id: 'sp_turn',
      actor: { kind: 'tool', id: 'Bash' }, ts: AT(27), payload: { pattern: 'rm -rf' } },
    { type: 'TOOL_PROPOSED', run_id: 'r', span_id: 'sp_b', parent_span_id: 'sp_turn',
      actor: { kind: 'tool', id: 'Bash' }, ts: AT(26), payload: { tool: 'Bash' } },
    { type: 'TOOL_FAILED', run_id: 'r', span_id: 'sp_b', parent_span_id: 'sp_turn',
      actor: { kind: 'tool', id: 'Bash' }, ts: AT(25), payload: { tool: 'Bash' } },
  ]);
  const agent = index.agents('*').find((a) => a.kind === 'root');
  assert.equal(agent.blocked, 1);
  assert.equal(agent.failedTools, 1);
  assert.equal(agent.hadFailure, true);
});

test('a sub-agent is listed with its type, and does not claim zero tools', () => {
  const index = build([
    session('r', AT(40)),
    session('r', AT(40), 'TURN_STARTED', 'sp_turn'),
    { type: 'WORKER_SPAWNED', run_id: 'r', span_id: 'sp_w', parent_span_id: 'sp_turn',
      actor: { kind: 'worker', id: 'explore-billing', tier: 'Explore' }, ts: AT(38),
      payload: {} },
  ]);
  const worker = index.agents('*').find((a) => a.kind === 'worker');
  assert.equal(worker.tier, 'Explore');
  // PreToolUse does not name the sub-agent, so tool calls belong to the turn.
  // Reporting 0 would read as "this agent did nothing", which is a lie.
  assert.equal(worker.attributable, false);
});

test('a sub-agent that reported its own work is counted on its own work', () => {
  const index = build([
    session('r', AT(40)),
    session('r', AT(40), 'TURN_STARTED', 'sp_turn'),
    { type: 'WORKER_SPAWNED', run_id: 'r', span_id: 'sp_w', parent_span_id: 'sp_turn',
      actor: { kind: 'worker', id: 'Audit the retry path', tier: 'Explore' }, ts: AT(38), payload: {} },
    { type: 'WORKER_DELIVERED', run_id: 'r', span_id: 'sp_w', parent_span_id: 'sp_turn',
      actor: { kind: 'worker', id: 'Audit the retry path', tier: 'Explore' }, ts: AT(20),
      payload: { totalTokens: 10_776, toolUses: 4, durationMs: 3_142 } },
  ]);
  const worker = index.agents('*').find((a) => a.kind === 'worker');
  assert.equal(worker.attributable, true, 'the Task result attributes the work');
  assert.equal(worker.tools, 4);
  assert.equal(worker.totalTokens, 10_776);
  assert.equal(worker.elapsedMs, 3_142, 'its own duration, not the span it sat in');
  assert.equal(worker.status, 'done', 'the result says it finished');
});

test('a session is done only when the stream says it ended', () => {
  const live = build([session('r', AT(10))]);
  assert.equal(live.agents('*')[0].status, 'working');

  const ended = build([
    session('r', AT(60)),
    { type: 'RUN_ENDED', run_id: 'r', span_id: 'sp_root', parent_span_id: null,
      actor: { kind: 'root', id: 'sess-r' }, ts: AT(10) },
  ]);
  assert.equal(ended.agents('*')[0].status, 'done');
});

test('phases and gates are not agents', () => {
  const index = build([
    session('r', AT(30)),
    { type: 'PHASE_ENTERED', run_id: 'r', span_id: 'sp_ph', parent_span_id: 'sp_root',
      actor: { kind: 'root', id: 'phase:build' }, ts: AT(29), payload: { phase: 'build' } },
    { type: 'GATE_REQUESTED', run_id: 'r', span_id: 'sp_g', parent_span_id: 'sp_root',
      actor: { kind: 'root', id: 'gate:gate3' }, ts: AT(28), payload: { gate: 'gate3' } },
  ]);
  const ids = index.agents('*').map((a) => a.id);
  assert.deepEqual(ids, ['sess-r'], 'pipeline state is not an actor that does work');
});

test('working agents sort above idle ones', () => {
  const index = build([
    session('old', AT(900)),
    session('new', AT(5)),
  ]);
  assert.deepEqual(index.agents('*').map((a) => a.status), ['working', 'idle']);
});
