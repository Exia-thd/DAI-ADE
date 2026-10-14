/**
 * Token reporting. Every test here exists because a plausible-looking number is
 * worse than no number: someone decides how to spend a budget on these figures,
 * and nothing in the UI tells them which ones were measured.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { readUsage } = require('../packages/emitter/src/transcript.js');
const emitter = require('../packages/emitter/src/emit.js');
const { RunIndex } = require('../packages/shell/src/store/runIndex.js');
const { makeEvent } = require('../packages/shared/src/events.js');

function transcript(lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ade-cost-'));
  const file = path.join(dir, 'transcript.jsonl');
  fs.writeFileSync(file, lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n');
  return file;
}

const assistant = (usage, model = 'claude-opus-5') => ({ type: 'assistant', message: { model, usage } });

test('generated tokens add up; context is the latest reading, not a sum', () => {
  const file = transcript([
    assistant({ input_tokens: 500, cache_read_input_tokens: 9_000, output_tokens: 300 }),
    assistant({ input_tokens: 400, cache_read_input_tokens: 14_000, output_tokens: 700 }),
  ]);
  const usage = readUsage(file);

  assert.equal(usage.outputTokens, 1000, 'each generated token was produced once');
  // Summing input would report 23,900 for a conversation that never held more
  // than 14,400 tokens, because every request resends what came before.
  assert.equal(usage.contextTokens, 14_400);
  assert.equal(usage.messages, 2);
  assert.equal(usage.model, 'claude-opus-5');
});

test('cache creation counts towards the context, because it is in the context', () => {
  const file = transcript([
    assistant({ input_tokens: 200, cache_read_input_tokens: 1_000, cache_creation_input_tokens: 800, output_tokens: 10 }),
  ]);
  assert.equal(readUsage(file).contextTokens, 2_000);
});

test('the model reported is the one that produced the last message', () => {
  const file = transcript([
    assistant({ input_tokens: 10, output_tokens: 5 }, 'claude-haiku-5-5'),
    assistant({ input_tokens: 10, output_tokens: 5 }, 'claude-opus-5'),
  ]);
  assert.equal(readUsage(file).model, 'claude-opus-5');
});

test('a transcript with no usage, or no transcript at all, reports nothing', () => {
  assert.equal(readUsage(transcript([{ type: 'user', message: { content: 'hello' } }])), null);
  assert.equal(readUsage(path.join(os.tmpdir(), 'ade-cost-missing', 'nope.jsonl')), null);
});

test('a torn last line does not lose the lines before it', () => {
  // The transcript is being appended to while it is read, so the tail can be
  // half a line. Dropping the whole file over it would make cost reporting
  // flicker to nothing exactly when a session is busiest.
  const file = transcript([
    assistant({ input_tokens: 100, output_tokens: 40 }),
    '{"type":"assistant","message":{"usage":{"output_to',
  ]);
  assert.equal(readUsage(file).outputTokens, 40);
});

test('cost is reported when a unit of work closes, not while it runs', () => {
  const file = transcript([assistant({ input_tokens: 100, cache_read_input_tokens: 900, output_tokens: 60 })]);

  const open = emitter.buildAll({ hook_event_name: 'UserPromptSubmit', session_id: 's', transcript_path: file });
  assert.equal(open.length, 1, 'a turn that just started has nothing to report');

  const close = emitter.buildAll({ hook_event_name: 'Stop', session_id: 's', transcript_path: file });
  assert.equal(close.length, 2);
  assert.equal(close[1].type, 'COST_UPDATE');
  assert.equal(close[1].payload.outputTokens, 60);
  assert.equal(close[1].payload.contextTokens, 1_000);
  // Attributed to the actor that did the work, on its own span: a cost with no
  // owner cannot be shown on an agent.
  assert.deepEqual(close[1].actor, close[0].actor);
  assert.equal(close[1].span_id, close[0].span_id);
});

test('an unreadable transcript never costs the hook its event', () => {
  const events = emitter.buildAll({
    hook_event_name: 'Stop', session_id: 's', transcript_path: 'C:/nowhere/at/all.jsonl',
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'TURN_ENDED');
});

test('the agent map keeps output and context apart', () => {
  const index = new RunIndex();
  const base = { run_id: 'r', actor: { kind: 'root', id: 'sess' } };
  for (const e of [
    { ...base, type: 'RUN_STARTED', span_id: 'sp_root', parent_span_id: null },
    { ...base, type: 'TURN_STARTED', span_id: 'sp_t1', parent_span_id: 'sp_root' },
    { ...base, type: 'COST_UPDATE', span_id: 'sp_t1', parent_span_id: 'sp_root',
      payload: { outputTokens: 300, contextTokens: 9_000, model: 'claude-opus-5' } },
    { ...base, type: 'TURN_STARTED', span_id: 'sp_t2', parent_span_id: 'sp_root' },
    { ...base, type: 'COST_UPDATE', span_id: 'sp_t2', parent_span_id: 'sp_root',
      payload: { outputTokens: 450, contextTokens: 21_000, model: 'claude-opus-5' } },
  ]) index.add(makeEvent(e));

  const agent = index.agents('*')[0];
  assert.equal(agent.tokens, 750, 'two turns generated 750 tokens between them');
  assert.equal(agent.contextTokens, 21_000, 'the context is 21k now, not 30k');
  assert.equal(agent.model, 'claude-opus-5');
});

test('an agent nobody reported a cost for shows no cost', () => {
  const index = new RunIndex();
  index.add(makeEvent({ type: 'RUN_STARTED', run_id: 'r', span_id: 'sp_root', parent_span_id: null,
    actor: { kind: 'root', id: 'sess' } }));
  const agent = index.agents('*')[0];
  // Null, never 0: a node reading "0 out" says the agent generated nothing,
  // which is a claim the stream never made.
  assert.equal(agent.tokens, null);
  assert.equal(agent.contextTokens, null);
});
