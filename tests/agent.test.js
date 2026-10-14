/**
 * Giving work to an agent.
 *
 * The expensive test at the bottom runs a real session and costs real money,
 * so it is opt-in (ADE_LIVE=1). Everything above it is the part that can be
 * wrong without anyone noticing: which checkout the work lands in, whether the
 * conversation continues or silently starts over, and whether the window will
 * see any of it.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { AgentSession, runIdFor, isResumable, normalise } = require('../packages/shell/src/agent/session.js');
const { installHooks, ensureHooks, HOOK_EVENTS } = require('../packages/shell/src/agent/hooks.js');
const { eventsDir } = require('../packages/emitter/src/emit.js');

const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `ade-${name}-`));

test('the run id is known before the agent starts', () => {
  // The window has to attach the reply to a run on the map. Deriving the id
  // from the session id this module chose means it is known at the moment the
  // process is spawned, instead of being matched up afterwards by guesswork.
  const session = new AgentSession({ cwd: '.', prompt: 'x' });
  assert.match(session.sessionId, /^[0-9a-f-]{36}$/);
  assert.equal(session.runId, runIdFor(session.sessionId));
});

test('a conversation continues only when it can actually be resumed', () => {
  const uuid = '11111111-2222-4333-8444-555555555555';
  assert.equal(isResumable(uuid), true);
  // A session seen through hooks is named by whatever the runner called it.
  // Asking Claude Code to resume that would fail, so a fresh session is started
  // instead - visibly, because the window says which one the next message is.
  assert.equal(isResumable('sess-retry-budget'), false);

  const resumed = new AgentSession({ cwd: '.', prompt: 'x', resume: uuid });
  assert.equal(resumed.sessionId, uuid, 'resuming keeps the run it belongs to');
  assert.ok(resumed.args.includes('--resume'));
  assert.ok(!resumed.args.includes('--session-id'));

  const fresh = new AgentSession({ cwd: '.', prompt: 'x', resume: 'sess-retry-budget' });
  assert.notEqual(fresh.sessionId, 'sess-retry-budget');
  assert.ok(fresh.args.includes('--session-id'));
});

test('nothing a person typed is ever passed on the command line', () => {
  // On Windows the CLI is a .cmd shim and has to go through a shell, so a
  // prompt on the command line would be a prompt a shell parses. It goes in on
  // stdin instead, and this test is what keeps it there.
  const nasty = 'fix the bug" && del /q C:\\Windows\\* & echo "';
  const session = new AgentSession({ cwd: '.', prompt: nasty });
  assert.ok(!session.args.some((a) => a.includes(nasty)));
  assert.deepEqual(session.args.filter((a) => a.includes('&') || a.includes('"')), []);
});

test('the stream is read as messages, and a half-written line waits', () => {
  const session = new AgentSession({ cwd: '.', prompt: 'x' });
  const seen = [];
  session.on('message', (m) => seen.push(m));

  session.consume('{"type":"system","subtype":"init","model":"claude-opus-5","permissionMode":"acceptEdits"}\n');
  session.consume('{"type":"assistant","message":{"content":[{"type":"text","text":"on it"},');
  assert.deepEqual(seen.map((m) => m.kind), ['system'], 'half a line is not a message yet');

  session.consume('{"type":"tool_use","name":"Edit","input":{"file_path":"src/a.ts"}}]}}\n');
  session.consume('{"type":"result","is_error":false,"result":"done","total_cost_usd":0.012,"num_turns":2}\n');

  assert.deepEqual(seen.map((m) => m.kind), ['system', 'assistant', 'tool', 'result']);
  assert.equal(seen[1].text, 'on it');
  assert.equal(seen[2].tool, 'Edit');
  assert.equal(seen[2].input, 'src/a.ts');
  assert.equal(seen[3].costUsd, 0.012);
});

test('a record this does not understand is dropped, not guessed at', () => {
  assert.deepEqual(normalise({ type: 'something_new', value: 1 }), []);
  assert.deepEqual(normalise({ type: 'assistant', message: { content: [{ type: 'thinking' }] } }), []);
});

test('a missing CLI is reported as a missing CLI', async () => {
  const session = new AgentSession({ cwd: tmp('nocli'), prompt: 'x' });
  const messages = [];
  session.on('message', (m) => messages.push(m));
  const ended = new Promise((resolve) => session.on('end', resolve));

  const before = process.env.PATH;
  const beforeCli = process.env.ADE_CLAUDE_CLI;
  process.env.PATH = path.join(os.tmpdir(), 'ade-definitely-not-a-path');
  delete process.env.ADE_CLAUDE_CLI;
  try { session.start(); } finally { process.env.PATH = before; if (beforeCli) process.env.ADE_CLAUDE_CLI = beforeCli; }

  const result = await ended;
  assert.equal(result.ok, false);
  assert.equal(messages[0].kind, 'error');
  assert.match(messages[0].text, /not found/i);
});

test('hooks are installed into the project, never the user settings', () => {
  const dir = tmp('hooks');
  const result = ensureHooks(dir);
  assert.equal(result.added, HOOK_EVENTS.length);
  assert.equal(result.target, path.join(dir, '.claude', 'settings.json'));

  const written = JSON.parse(fs.readFileSync(result.target, 'utf8'));
  for (const event of HOOK_EVENTS) {
    assert.ok(written.hooks[event].some((m) => m.hooks.some((h) => h.command.includes('emit.js'))), event);
  }
  // Installing twice must not install twice: a worktree gets this run against
  // it every time a message is sent.
  assert.equal(installHooks(dir).added, 0);
});

test('settings that are not valid JSON are refused, not overwritten', () => {
  const dir = tmp('badjson');
  const target = path.join(dir, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, '{ this is not json');

  const result = ensureHooks(dir);
  assert.match(result.error, /not valid JSON/);
  assert.equal(result.written, false);
  assert.equal(fs.readFileSync(target, 'utf8'), '{ this is not json',
    'someone else owns this file; damaging it is worse than not installing');
});

test('hooks merge into existing settings instead of replacing them', () => {
  const dir = tmp('merge');
  const target = path.join(dir, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify({
    permissions: { allow: ['Bash(npm test)'] },
    hooks: { Stop: [{ matcher: '*', hooks: [{ type: 'command', command: 'node other-tool.js' }] }] },
  }));

  ensureHooks(dir);
  const written = JSON.parse(fs.readFileSync(target, 'utf8'));
  assert.deepEqual(written.permissions.allow, ['Bash(npm test)'], 'unrelated settings survive');
  const stop = written.hooks.Stop.map((m) => m.hooks[0].command);
  assert.equal(stop.length, 2, "another tool's hook is kept");
  assert.ok(stop.some((c) => c.includes('other-tool.js')));
  assert.ok(stop.some((c) => c.includes('emit.js')));
});

/* ------------------------------------------------------------------ live -- */

test('a real session answers, and the window can see it', { skip: !process.env.ADE_LIVE }, async () => {
  // Opt-in: this spends money and needs the network. It is here because every
  // test above can pass while the feature is still useless - which is exactly
  // what happened the first time, when the session answered correctly and
  // emitted not one event because the checkout had no hooks.
  const dir = tmp('live');
  ensureHooks(dir);

  const session = new AgentSession({ cwd: dir, prompt: 'Reply with exactly: PING' });
  const messages = [];
  session.on('message', (m) => messages.push(m));
  const ended = new Promise((resolve) => session.on('end', resolve));
  session.start();

  const result = await ended;
  assert.equal(result.ok, true, 'the session exited cleanly');
  assert.ok(messages.some((m) => m.kind === 'assistant' && m.text.includes('PING')));

  const file = path.join(eventsDir(dir), `${session.runId}.jsonl`);
  assert.ok(fs.existsSync(file), 'the hooks wrote to the run id predicted before launch');
  const types = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
    .map((l) => JSON.parse(l).type);
  assert.ok(types.includes('RUN_STARTED'), types.join(','));
});
