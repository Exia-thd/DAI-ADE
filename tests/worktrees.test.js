/**
 * Worktrees are the isolation guarantee for parallel agents. If this layer is
 * wrong, two agents share a checkout and overwrite each other — which shows up
 * as "the model deleted my work" and gets blamed on the model.
 *
 * Every test runs against a real git repository rather than a mock, because
 * every bug worth catching here is in how git actually behaves on Windows.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const wt = require('../packages/shell/src/git/worktrees.js');

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
}

function repo(name = 'repo') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dai-ade-wt-'));
  const root = path.join(dir, name);
  fs.mkdirSync(root);
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.email', 'test@example.invalid']);
  git(root, ['config', 'user.name', 'worktree test']);
  fs.writeFileSync(path.join(root, 'app.js'), 'console.log(1);\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'first']);
  return root;
}

test('a task gets its own checkout and its own branch', () => {
  const root = repo();
  const made = wt.create(root, 'task-1', { objective: 'add retries' });

  assert.equal(made.branch, 'parallel/task-1', 'branch layout matches the harness');
  assert.ok(made.path.endsWith(path.join('.worktrees', 'task-1')), 'path layout matches the harness');
  assert.ok(fs.existsSync(path.join(made.path, 'app.js')), 'the worktree is a real checkout');

  const contract = wt.readContract(made.path);
  assert.equal(contract.objective, 'add retries');
  assert.ok(contract.base_commit, 'the contract pins where this task started');
});

test('two tasks cannot see each other', () => {
  const root = repo();
  const a = wt.create(root, 'alpha');
  const b = wt.create(root, 'beta');

  fs.writeFileSync(path.join(a.path, 'app.js'), 'ALPHA\n');
  fs.writeFileSync(path.join(b.path, 'app.js'), 'BETA\n');

  assert.equal(fs.readFileSync(path.join(a.path, 'app.js'), 'utf8'), 'ALPHA\n');
  assert.equal(fs.readFileSync(path.join(b.path, 'app.js'), 'utf8'), 'BETA\n');
  assert.equal(fs.readFileSync(path.join(root, 'app.js'), 'utf8'), 'console.log(1);\n',
    'the main checkout is untouched by either');
});

test('list marks which worktrees this tool manages', () => {
  const root = repo();
  wt.create(root, 'task-1');
  const entries = wt.list(root);

  const main = entries.find((e) => e.isMain);
  assert.ok(main, 'the main checkout is listed');
  assert.equal(main.managed, false);

  const managed = entries.find((e) => e.taskId === 'task-1');
  assert.ok(managed, 'the task worktree is listed');
  assert.equal(managed.managed, true);
  assert.equal(managed.branch, 'parallel/task-1');
});

test('status reports committed and uncommitted work against the task base', () => {
  const root = repo();
  const made = wt.create(root, 'task-2', { objective: 'x' });

  fs.writeFileSync(path.join(made.path, 'app.js'), 'committed\n');
  git(made.path, ['add', '-A']);
  git(made.path, ['commit', '-qm', 'work']);
  fs.writeFileSync(path.join(made.path, 'notes.md'), 'scratch\n');

  const s = wt.status(root, 'task-2');
  assert.equal(s.ahead, 1, 'one commit beyond the base');
  assert.ok(s.committed.some((c) => c.file === 'app.js'), 'the committed change is reported');
  assert.ok(s.uncommitted.some((c) => c.file === 'notes.md'), 'so is the untracked one');
});

test('the diff shows uncommitted work too, not just what was staged', async () => {
  const root = repo();
  const made = wt.create(root, 'task-3', { objective: 'x' });
  fs.writeFileSync(path.join(made.path, 'app.js'), 'console.log(2);\n');

  const text = await wt.diff(root, 'task-3');
  assert.match(text, /app\.js/);
  assert.match(text, /\+console\.log\(2\);/, 'a reviewer needs the work in progress, not only commits');
});

test('removing a worktree with uncommitted work refuses unless forced', () => {
  const root = repo();
  const made = wt.create(root, 'task-4');
  fs.writeFileSync(path.join(made.path, 'app.js'), 'unsaved\n');

  assert.throws(() => wt.remove(root, 'task-4'), /uncommitted/,
    'silently discarding an agent\u2019s work is the one unforgivable bug here');

  const out = wt.remove(root, 'task-4', { force: true, deleteBranch: true });
  assert.equal(out.discarded, 1, 'the caller is told how much was thrown away');
  assert.equal(fs.existsSync(made.path), false);
  assert.equal(wt.list(root).some((e) => e.taskId === 'task-4'), false);
});

test('a task id that could escape the repository is rejected', () => {
  const root = repo();
  for (const bad of ['../evil', 'a/b', '', '.hidden-ok?', 'x'.repeat(80), 'has space']) {
    assert.throws(() => wt.create(root, bad), /invalid task id|".."/,
      `should reject ${JSON.stringify(bad)}`);
  }
  assert.equal(fs.existsSync(path.join(root, '.worktrees')), false,
    'nothing is created for a rejected id');
});

test('paths with spaces survive the porcelain parse', () => {
  // `git worktree list` without --porcelain reflows paths and a tool that
  // splits on whitespace loses every worktree under "C:/My Projects".
  const root = repo('my repo');
  wt.create(root, 'task-5');
  const entries = wt.list(root);
  const managed = entries.find((e) => e.taskId === 'task-5');
  assert.ok(managed, 'a worktree under a path with a space is still listed');
  assert.ok(fs.existsSync(managed.path), 'and the path it reports is real');
});
