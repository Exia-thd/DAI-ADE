/**
 * M0 acceptance: the ingestion path has to be trustworthy before any UI is
 * worth building. Each test here pins one failure that would otherwise show up
 * as "the timeline is sometimes missing things", which is the hardest class of
 * bug to notice in an observability tool — it looks like the system under
 * observation was quiet.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { makeEvent, validateEvent, newId } = require('../packages/shared/src/events.js');
const { JsonlTailer } = require('../packages/shell/src/ingest/tailer.js');
const { RunIndex } = require('../packages/shell/src/store/runIndex.js');
const emitter = require('../packages/emitter/src/emit.js');

function tmpFile(name = 'events.jsonl') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dai-ade-'));
  return { dir, file: path.join(dir, name) };
}

function event(overrides = {}) {
  return makeEvent({
    type: 'TOOL_PROPOSED',
    run_id: 'run_test',
    span_id: `sp_${Math.random().toString(36).slice(2, 8)}`,
    parent_span_id: 'sp_root',
    actor: { kind: 'tool', id: 'Bash' },
    payload: { tool: 'Bash' },
    ...overrides,
  });
}

const settle = (ms = 420) => new Promise((r) => setTimeout(r, ms));

test('a line torn by a concurrent write is not lost', async () => {
  const { file } = tmpFile();
  fs.writeFileSync(file, '');
  const seen = [];
  const tailer = new JsonlTailer(file, { intervalMs: 30 }).start();
  tailer.on('event', (e) => seen.push(e));

  const whole = JSON.stringify(event()) + '\n';
  const split = Math.floor(whole.length / 2);
  // Write the first half, let a poll land in the middle of the line, then
  // finish it. A tailer that splits on '\n' without carrying the remainder
  // drops this event and reports nothing wrong.
  fs.appendFileSync(file, whole.slice(0, split));
  await settle(120);
  assert.equal(seen.length, 0, 'half a line must not be emitted as an event');
  fs.appendFileSync(file, whole.slice(split));
  await settle(150);

  tailer.stop();
  assert.equal(seen.length, 1, 'the completed line must arrive exactly once');
  assert.equal(tailer.stats.invalid, 0, 'a torn line is not a parse error');
});

test('500 events appended while tailing all arrive, in order, once', async () => {
  const { file } = tmpFile();
  fs.writeFileSync(file, '');
  const seen = [];
  const tailer = new JsonlTailer(file, { intervalMs: 20 }).start();
  tailer.on('event', (e) => seen.push(e));

  const written = [];
  for (let i = 0; i < 500; i++) {
    const e = event({ payload: { tool: 'Bash', i } });
    written.push(e);
    fs.appendFileSync(file, JSON.stringify(e) + '\n');
    if (i % 50 === 0) await settle(25); // interleave writes with polls
  }
  await settle(400);
  tailer.stop();

  assert.equal(seen.length, 500, `expected 500 events, got ${seen.length}`);
  assert.deepEqual(seen.map((e) => e.payload.i), written.map((e) => e.payload.i), 'order must be preserved');
  assert.equal(new Set(seen.map((e) => e.id)).size, 500, 'no duplicates');
  assert.equal(tailer.stats.invalid, 0);
});

test('truncation restarts the read instead of emitting garbage', async () => {
  const { file } = tmpFile();
  fs.writeFileSync(file, JSON.stringify(event()) + '\n');
  const seen = [];
  const tailer = new JsonlTailer(file, { intervalMs: 25 }).start();
  tailer.on('event', (e) => seen.push(e));
  await settle(120);
  assert.equal(seen.length, 1);

  fs.writeFileSync(file, JSON.stringify(event()) + '\n'); // replaced, smaller or equal
  await settle(200);
  tailer.stop();
  assert.ok(tailer.stats.invalid === 0, 'a replaced file must not produce parse errors');
});

test('a malformed line is reported, not silently skipped', async () => {
  const { file } = tmpFile();
  fs.writeFileSync(file, '');
  const invalid = [];
  const tailer = new JsonlTailer(file, { intervalMs: 25 }).start();
  tailer.on('invalid', (d) => invalid.push(d));
  fs.appendFileSync(file, 'not json at all\n');
  fs.appendFileSync(file, JSON.stringify({ v: 1, id: 'x' }) + '\n'); // schema-invalid
  await settle(200);
  tailer.stop();

  assert.equal(invalid.length, 2);
  assert.equal(invalid[0].reason, 'unparseable');
  assert.equal(invalid[1].reason, 'schema');
});

test('the same event from two ingestion paths is stored once', () => {
  const index = new RunIndex();
  const e = event();
  assert.equal(index.add(e), true);
  assert.equal(index.add({ ...e }), false, 'a replayed copy must be ignored');
  assert.equal(index.summary('run_test').events, 1);
});

test('spans pair into a tree with durations', () => {
  const index = new RunIndex();
  const base = { run_id: 'run_tree', parent_span_id: 'sp_root' };
  index.add(makeEvent({ ...base, type: 'RUN_STARTED', span_id: 'sp_root', parent_span_id: null,
    actor: { kind: 'root', id: 's1' }, ts: '2026-10-05T10:00:00.000Z' }));
  index.add(makeEvent({ ...base, type: 'WORKER_SPAWNED', span_id: 'sp_w1',
    actor: { kind: 'worker', id: 'w1' }, ts: '2026-10-05T10:00:01.000Z' }));
  index.add(makeEvent({ ...base, type: 'TOOL_PROPOSED', span_id: 'sp_t1',
    actor: { kind: 'tool', id: 'Bash' }, ts: '2026-10-05T10:00:02.000Z' }));
  index.add(makeEvent({ ...base, type: 'TOOL_BLOCKED', span_id: 'sp_t1',
    actor: { kind: 'tool', id: 'Bash' }, ts: '2026-10-05T10:00:03.000Z' }));
  index.add(makeEvent({ ...base, type: 'WORKER_DELIVERED', span_id: 'sp_w1',
    actor: { kind: 'worker', id: 'w1' }, ts: '2026-10-05T10:00:09.000Z' }));

  const tree = index.tree('run_tree');
  assert.equal(tree.length, 1, 'one root span');
  const children = tree[0].children;
  assert.equal(children.length, 2, 'worker and tool hang off the root');

  const worker = children.find((c) => c.actor.kind === 'worker');
  assert.equal(worker.status, 'closed');
  assert.equal(worker.durationMs, 8000);

  const tool = children.find((c) => c.actor.kind === 'tool');
  assert.equal(tool.status, 'failed', 'a blocked tool call is a failed span');
  assert.equal(tool.durationMs, 1000);

  const summary = index.summary('run_tree');
  assert.equal(summary.blocked, 1);
  assert.equal(summary.workers, 1);
});

test('emitter maps real hook payloads onto the taxonomy', () => {
  const pre = emitter.build({
    hook_event_name: 'PreToolUse', session_id: 'sess-abc', cwd: 'C:/p',
    tool_name: 'Bash', tool_input: { command: 'ls' },
  });
  assert.equal(pre.type, 'TOOL_PROPOSED');
  assert.equal(pre.actor.kind, 'tool');
  assert.ok(validateEvent(pre).ok);

  const post = emitter.build({
    hook_event_name: 'PostToolUse', session_id: 'sess-abc', cwd: 'C:/p',
    tool_name: 'Bash', tool_input: { command: 'ls' }, tool_response: { ok: true },
  });
  assert.equal(post.type, 'TOOL_EXECUTED');
  assert.equal(post.span_id, pre.span_id, 'Pre and Post must pair into one span');

  const failed = emitter.build({
    hook_event_name: 'PostToolUse', session_id: 'sess-abc',
    tool_name: 'Bash', tool_input: { command: 'nope' }, tool_response: { is_error: true },
  });
  assert.equal(failed.type, 'TOOL_FAILED', 'an errored response is not an execution');

  const spawned = emitter.build({
    hook_event_name: 'SubagentStart', session_id: 'sess-abc', agent_type: 'Explore', subagent_id: 'sub-1',
  });
  assert.equal(spawned.type, 'WORKER_SPAWNED');
  assert.equal(spawned.actor.kind, 'worker');
});

test('emitter never throws on hostile or empty input', () => {
  for (const payload of [{}, { hook_event_name: 'Unknown' }, { hook_event_name: 'PreToolUse' },
    { hook_event_name: 'PreToolUse', tool_input: { deep: { a: [1, 2, { b: null }] } } }]) {
    assert.doesNotThrow(() => emitter.build(payload));
  }
  // Circular arguments must summarise rather than blow up the hook.
  const circular = { a: 1 };
  circular.self = circular;
  assert.doesNotThrow(() => emitter.summarise(circular));
});

test('huge tool arguments are summarised, not copied into the stream', () => {
  const big = { command: 'x'.repeat(50_000) };
  const e = emitter.build({ hook_event_name: 'PreToolUse', session_id: 's', tool_name: 'Bash', tool_input: big });
  const size = JSON.stringify(e).length;
  assert.ok(size < 2000, `event should stay small, was ${size} bytes`);
  assert.equal(e.payload.input.truncated, true);
  assert.ok(e.payload.input.bytes > 50_000, 'the original size is still reported');
});

test('event ids sort in generation order', () => {
  const ids = [];
  for (let i = 0; i < 200; i++) ids.push(newId());
  assert.deepEqual(ids, [...ids].sort(), 'ids must be lexicographically time-ordered');
  assert.equal(new Set(ids).size, 200, 'ids must be unique within a millisecond');
});

test('tool calls nest under their own turn, not the session', () => {
  // Several turns per session is the normal case. When both shared one root
  // span the tree claimed the session lasted as long as its final prompt, and
  // "which turn did this tool call belong to" had no answer.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dai-ade-turns-'));
  const fire = (p) => emitter.build({ session_id: 's', cwd: dir, ...p });
  const write = (e) => {
    if (!e) return;
    const d = path.join(dir, '.dai-ade', 'events');
    fs.mkdirSync(d, { recursive: true });
    fs.appendFileSync(path.join(d, `${e.run_id}.jsonl`), JSON.stringify(e) + '\n');
  };

  const index = new RunIndex();
  const seq = [
    { hook_event_name: 'SessionStart' },
    { hook_event_name: 'UserPromptSubmit', prompt: 'one' },
    { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { f: 'a' } },
    { hook_event_name: 'Stop' },
    { hook_event_name: 'UserPromptSubmit', prompt: 'two' },
    { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { c: 'b' } },
    { hook_event_name: 'Stop' },
  ];
  for (const p of seq) { const e = fire(p); write(e); if (e) index.add(e); }

  const runId = index.list()[0].id;
  const tree = index.tree(runId);
  assert.equal(tree.length, 1, 'one session root');
  const turns = tree[0].children;
  assert.equal(turns.length, 2, 'two distinct turn spans under the session');
  assert.equal(turns[0].children.length, 1, 'turn one owns exactly its own tool call');
  assert.equal(turns[1].children.length, 1, 'turn two owns exactly its own tool call');
  assert.equal(turns[0].children[0].actor.id, 'Read');
  assert.equal(turns[1].children[0].actor.id, 'Bash');
  assert.notEqual(turns[0].id, turns[1].id, 'turns must not share a span id');
});

test('shortHash only ever emits base32 characters', () => {
  // The first version re-seeded with a signed XOR, so any input whose hash
  // exceeded 2^31 indexed the alphabet with a negative number and produced the
  // literal string "undefined" — identical for every such input, which made
  // unrelated spans collide. Windows paths hit it immediately.
  const { shortHash } = require('../packages/shared/src/events.js');
  const B = String.fromCharCode(92); // a backslash, written so no tool can eat it
  const inputs = [
    `C:${B}Users${B}thdat${B}AppData${B}Local${B}Temp${B}ade-real`,
    'C:/Users/thdat/Downloads/forgewright/dai-nexus',
    '', 'a', 'sess-abc:Bash:{"command":"ls"}',
  ];
  for (let i = 0; i < 5000; i++) inputs.push(`path/to/project-${i}${B}x`);

  const alphabet = /^[0-9A-HJKMNP-TV-Z]+$/;
  const seen = new Map();
  for (const input of inputs) {
    for (const len of [8, 10, 12, 25]) {
      const h = shortHash(input, len);
      assert.equal(h.length, len, `length for ${JSON.stringify(input)}`);
      assert.ok(alphabet.test(h), `${JSON.stringify(input)} -> ${JSON.stringify(h)}`);
    }
    const key = shortHash(input, 12);
    assert.ok(!seen.has(key) || seen.get(key) === input,
      `collision: ${JSON.stringify(input)} and ${JSON.stringify(seen.get(key))}`);
    seen.set(key, input);
  }
});

test('a closer with no opener is an instant, not an unplaceable span', () => {
  const index = new RunIndex();
  index.add(makeEvent({
    type: 'TOOL_BLOCKED', run_id: 'run_blk', span_id: 'sp_b1', parent_span_id: null,
    actor: { kind: 'tool', id: 'Bash' }, ts: '2026-10-05T10:00:00.000Z',
    payload: { pattern: 'rm -rf' },
  }));
  const node = index.tree('run_blk')[0];
  assert.equal(node.status, 'failed');
  assert.equal(node.durationMs, 0, 'an instant has a duration, not null');
  assert.equal(node.instantaneous, true);
  assert.equal(node.type, 'TOOL_PROPOSED', 'it is still a tool-call span');
});

test('an evidence record opens and closes one verification span', () => {
  const index = new RunIndex();
  const base = { run_id: 'run_ev', span_id: 'sp_ev', parent_span_id: null, actor: { kind: 'tool', id: 'verify' } };
  index.add(makeEvent({ ...base, type: 'EVIDENCE_WRITTEN', ts: '2026-10-05T10:00:00.000Z' }));
  index.add(makeEvent({ ...base, type: 'VERIFY_PASSED', ts: '2026-10-05T10:00:02.000Z' }));
  const node = index.tree('run_ev')[0];
  assert.equal(node.status, 'closed', 'a verdict closes the verification');
  assert.equal(node.durationMs, 2000);
});
