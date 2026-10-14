/**
 * Which agent runs, on which model, with which command line.
 *
 * Two of the shipped runners have never been executed by this project — their
 * executable names were confirmed against the npm registry, their flags were
 * not. These tests pin the things that must be true regardless: that the
 * command line is built the way it is displayed, that an unverified or
 * unobservable runner says so, and that a prompt never reaches a shell.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const runners = require('../packages/shell/src/agent/runners.js');
const commands = require('../packages/shell/src/agent/commands.js');
const { AgentSession } = require('../packages/shell/src/agent/session.js');

const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `ade-${name}-`));

test('the built-in runners are the ones that were actually looked up', () => {
  const ids = runners.list(null).map((r) => r.id);
  assert.deepEqual(ids, ['claude-code', 'codex', 'gemini']);

  const byId = Object.fromEntries(runners.list(null).map((r) => [r.id, r]));
  assert.equal(byId.codex.command, 'codex');
  assert.equal(byId.gemini.command, 'gemini');

  // Only the runner this project runs is claimed as verified, and only it is
  // claimed to produce events. Shipping a definition is not the same as having
  // tested it, and the window shows the difference.
  assert.equal(byId['claude-code'].verified, true);
  assert.equal(byId['claude-code'].observable, true);
  for (const id of ['codex', 'gemini']) {
    assert.equal(byId[id].verified, false, id);
    assert.equal(byId[id].observable, false, id);
  }
});

test('the command line is built from the runner, not hardcoded', () => {
  const claude = runners.get(null, 'claude-code');

  const fresh = runners.buildArgs(claude, { model: 'default', session: 'S1', resume: false, permissionMode: 'acceptEdits' });
  assert.deepEqual(fresh, ['-p', '--output-format', 'stream-json', '--verbose',
    '--permission-mode', 'acceptEdits', '--session-id', 'S1']);
  assert.ok(!fresh.includes('--model'), 'the default model passes no flag at all');

  const picked = runners.buildArgs(claude, { model: 'opus', session: 'S1', resume: true, permissionMode: 'plan' });
  assert.ok(picked.includes('--model') && picked.includes('opus'));
  assert.ok(picked.includes('--resume') && picked.includes('S1'));
  assert.ok(!picked.includes('--session-id'), 'resuming does not also ask for a new id');
  assert.ok(picked.includes('plan'), 'the permission mode is substituted, not fixed');
});

test('a value cannot grow into a second argument', () => {
  // Substitution is per whole argument. If it were string concatenation, a
  // model id of "x --dangerously-skip-permissions" would become a flag.
  const claude = runners.get(null, 'claude-code');
  const args = runners.buildArgs(claude, {
    model: 'x --dangerously-skip-permissions', session: 'S', resume: false, permissionMode: 'acceptEdits',
  });
  assert.ok(args.includes('x --dangerously-skip-permissions'), 'it stays one argument');
  assert.equal(args.filter((a) => a === '--dangerously-skip-permissions').length, 0);
});

test('a runner is declared in a project, and replaces a built-in by id', () => {
  const project = tmp('runners');
  fs.mkdirSync(path.join(project, '.dai-ade'), { recursive: true });
  fs.writeFileSync(path.join(project, '.dai-ade', 'runners.json'), JSON.stringify({
    runners: [
      { id: 'house-agent', label: 'House agent', command: 'house', args: ['run'], observable: false },
      { id: 'codex', label: 'Codex CLI', command: 'codex', args: ['exec', '--json', '-'], verified: true },
    ],
  }));

  const list = runners.list(project);
  const house = list.find((r) => r.id === 'house-agent');
  assert.equal(house.label, 'House agent');
  assert.equal(house.promptVia, 'stdin', 'stdin is the default, because it is the safe one');
  assert.equal(house.format, 'text', 'only a runner that says so is read as a stream');

  const codex = list.find((r) => r.id === 'codex');
  assert.deepEqual(codex.args, ['exec', '--json', '-'], 'the built-in definition is correctable');
  assert.equal(codex.verified, true);
});

test('a runner entry missing an id or a command is ignored, not half-loaded', () => {
  assert.equal(runners.normalise({ label: 'no id' }, 'x'), null);
  assert.equal(runners.normalise({ id: 'x' }, 'x'), null);
});

test('a prompt is never passed as an argument to a shell-launched executable', async () => {
  // On Windows these CLIs are .cmd shims and must go through a shell. A prompt
  // on the command line would be parsed by that shell, so this refuses rather
  // than escaping and hoping.
  const runner = runners.normalise(
    { id: 'argy', label: 'Argy', command: 'argy', args: [], promptVia: 'arg' }, 'test',
  );
  const session = new AgentSession({ cwd: tmp('argy'), prompt: 'x" && del *', runner });
  const refusal = session.prepare(true);
  assert.equal(refusal.ok, false);
  assert.match(refusal.error, /stdin/);
  assert.equal(session.prepare(false).ok, true, 'without a shell it is safe, and allowed');
});

test('a file-delivered prompt is written, and its path substituted', () => {
  const runner = runners.normalise(
    { id: 'filey', label: 'Filey', command: 'filey', args: ['--in', '{promptFile}'], promptVia: 'file' }, 'test',
  );
  const session = new AgentSession({ cwd: tmp('filey'), prompt: 'the brief', runner });
  assert.equal(session.prepare(true).ok, true);
  assert.equal(fs.readFileSync(session.promptFile, 'utf8'), 'the brief');
  assert.ok(session.args.includes(session.promptFile));
});

/* --------------------------------------------------------- commands ------ */

test('slash commands are read from the project and from the person', () => {
  const project = tmp('cmds');
  const dir = path.join(project, '.claude', 'commands', 'review');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(project, '.claude', 'commands', 'ship.md'),
    '---\ndescription: Run the release checks\n---\nDo the thing.\n');
  fs.writeFileSync(path.join(dir, 'api.md'), '# API review\n\nCheck the public surface.\n');

  const list = commands.list(project);
  const byName = Object.fromEntries(list.map((c) => [c.name, c]));

  assert.equal(byName.ship.description, 'Run the release checks', 'frontmatter wins');
  // A directory namespaces the command, which is how the runner reads them.
  assert.ok(byName['review:api'], Object.keys(byName).join(','));
  assert.equal(byName['review:api'].description, 'Check the public surface.',
    'with no frontmatter, the first real line says what it does');
  assert.equal(byName.ship.scope, 'project');
});

test('a command only the session knows about is still offered', () => {
  // Built-ins and plugin commands exist in no file on disk; the session's first
  // record is the only place they are named. Listed without a description
  // rather than left out.
  const list = commands.list(tmp('seen'), ['compact', 'security-review']);
  const names = list.map((c) => c.name);
  assert.ok(names.includes('compact'));
  assert.ok(names.includes('security-review'));
  assert.equal(list.find((c) => c.name === 'compact').scope, 'session');
});
