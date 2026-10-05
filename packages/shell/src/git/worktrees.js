/**
 * Worktrees — the unit of parallel work.
 *
 * Several agents working at once need somewhere each that the others cannot
 * overwrite. A git worktree gives that for free: one checkout per task, one
 * branch per task, one diff per task, and a merge that is an ordinary git
 * operation rather than a bespoke reconciliation.
 *
 * The layout here is not invented. The harness already runs parallel workers
 * through `scripts/lite/worktree_manager.py`, which uses `.worktrees/<task_id>`
 * on branch `parallel/<task_id>` with a `CONTRACT.json` describing the worker's
 * scope. This module speaks the same layout, so a worktree created from the UI
 * and one created by the harness are the same thing and both tools list both.
 *
 * Interop over coupling: these are plain git calls, so the ADE needs no Python
 * and keeps working if the harness is absent — it just has no contracts to show.
 */

'use strict';

const { execFile, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const WORKTREE_BASE = '.worktrees';
const BRANCH_PREFIX = 'parallel/';

/** A task id has to be safe in a branch name and a path. */
const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;

function assertTaskId(taskId) {
  if (!TASK_ID.test(String(taskId || ''))) {
    throw new Error(
      `invalid task id ${JSON.stringify(taskId)}: letters, digits, dot, dash and underscore only`,
    );
  }
  // `..` would escape the worktree base, and git refuses it in a ref anyway.
  if (String(taskId).includes('..')) throw new Error('task id may not contain ".."');
}

function git(repo, args, options = {}) {
  return execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    maxBuffer: options.maxBuffer ?? 32 * 1024 * 1024,
    windowsHide: true,
  });
}

function gitAsync(repo, args) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve(stdout)));
  });
}

function repoRoot(dir) {
  return git(dir, ['rev-parse', '--show-toplevel']).trim();
}

function currentBranch(dir) {
  return git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
}

function worktreePath(repo, taskId) {
  return path.join(repo, WORKTREE_BASE, taskId);
}

function branchName(taskId) {
  return `${BRANCH_PREFIX}${taskId}`;
}

/* ----------------------------------------------------------------- list --- */

/**
 * Every worktree git knows about, with the ones this tool manages marked.
 *
 * `--porcelain` is parsed rather than the human output: the human format drops
 * fields and reflows paths with spaces, which is how a worktree under
 * "C:/My Projects" becomes invisible to a tool that split on whitespace.
 */
function list(repo) {
  let raw;
  try { raw = git(repo, ['worktree', 'list', '--porcelain']); } catch { return []; }

  const entries = [];
  let current = null;
  for (const line of raw.split('\n')) {
    const text = line.trimEnd();
    if (text.startsWith('worktree ')) {
      if (current) entries.push(current);
      current = { path: text.slice(9), branch: null, head: null, bare: false, detached: false, locked: false };
    } else if (!current) {
      continue;
    } else if (text.startsWith('HEAD ')) {
      current.head = text.slice(5);
    } else if (text.startsWith('branch ')) {
      current.branch = text.slice(7).replace(/^refs\/heads\//, '');
    } else if (text === 'bare') {
      current.bare = true;
    } else if (text === 'detached') {
      current.detached = true;
    } else if (text.startsWith('locked')) {
      current.locked = true;
    }
  }
  if (current) entries.push(current);

  const root = path.resolve(repo);
  return entries.map((entry) => {
    const resolved = path.resolve(entry.path);
    const managed = resolved.startsWith(path.join(root, WORKTREE_BASE) + path.sep);
    const taskId = managed ? path.basename(resolved) : null;
    return {
      ...entry,
      path: resolved,
      isMain: resolved === root,
      managed,
      taskId,
      contract: managed ? readContract(resolved) : null,
    };
  });
}

/** The worker's declared scope, when the harness wrote one. */
function readContract(worktree) {
  try {
    return JSON.parse(fs.readFileSync(path.join(worktree, 'CONTRACT.json'), 'utf8'));
  } catch {
    return null;
  }
}

/* --------------------------------------------------------------- create --- */

/**
 * Create a worktree for a task, optionally with a contract.
 *
 * The branch is created from `base` (default: the repository's current branch)
 * rather than from whatever HEAD happens to be, so two tasks started minutes
 * apart start from the same place and their diffs stay comparable.
 */
function create(repo, taskId, options = {}) {
  assertTaskId(taskId);
  const root = repoRoot(repo);
  const target = worktreePath(root, taskId);
  if (fs.existsSync(target)) throw new Error(`worktree already exists: ${target}`);

  const base = options.base || currentBranch(root);
  const branch = branchName(taskId);

  const existingBranch = git(root, ['branch', '--list', branch]).trim();
  const args = existingBranch
    ? ['worktree', 'add', target, branch]
    : ['worktree', 'add', '-b', branch, target, base];
  git(root, args);

  if (options.objective) {
    const contract = {
      task_id: taskId,
      objective: options.objective,
      outputs: options.outputs || [],
      forbidden: options.forbidden || [],
      base_commit: git(root, ['rev-parse', base]).trim(),
      created_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    };
    fs.writeFileSync(path.join(target, 'CONTRACT.json'), JSON.stringify(contract, null, 2) + '\n');
  }

  return { taskId, path: target, branch, base };
}

/* --------------------------------------------------------------- remove --- */

/**
 * Remove a worktree. Refuses to discard uncommitted work unless told to.
 *
 * `git worktree remove` already refuses a dirty tree, but the error is terse
 * and the obvious next move is to reach for --force. Checking first means the
 * caller can be shown what would be lost instead of a flag that loses it.
 */
function remove(repo, taskId, options = {}) {
  assertTaskId(taskId);
  const root = repoRoot(repo);
  const target = worktreePath(root, taskId);
  if (!fs.existsSync(target)) throw new Error(`no worktree at ${target}`);

  const dirty = git(target, ['status', '--porcelain']).trim();
  if (dirty && !options.force) {
    const files = dirty.split('\n').length;
    throw new Error(`${taskId} has ${files} uncommitted change(s); pass force to discard them`);
  }

  git(root, options.force ? ['worktree', 'remove', '--force', target] : ['worktree', 'remove', target]);

  if (options.deleteBranch) {
    try { git(root, ['branch', '-D', branchName(taskId)]); } catch { /* already gone */ }
  }
  return { taskId, removed: target, discarded: dirty ? dirty.split('\n').length : 0 };
}

/* --------------------------------------------------------------- status --- */

/** What a task has actually changed, against the commit it started from. */
function status(repo, taskId) {
  assertTaskId(taskId);
  const root = repoRoot(repo);
  const target = worktreePath(root, taskId);
  if (!fs.existsSync(target)) throw new Error(`no worktree at ${target}`);

  const contract = readContract(target);
  const base = contract?.base_commit || git(root, ['rev-parse', 'HEAD']).trim();

  const uncommitted = git(target, ['status', '--porcelain'])
    .split('\n').filter(Boolean)
    .map((line) => ({ state: line.slice(0, 2).trim(), file: line.slice(3) }));

  let committed = [];
  try {
    committed = git(target, ['diff', '--name-status', `${base}...HEAD`])
      .split('\n').filter(Boolean)
      .map((line) => {
        const [state, ...rest] = line.split('\t');
        return { state, file: rest.join('\t') };
      });
  } catch { /* base unreachable from this worktree */ }

  let ahead = 0;
  try { ahead = parseInt(git(target, ['rev-list', '--count', `${base}..HEAD`]).trim(), 10) || 0; } catch { /* ignore */ }

  return { taskId, path: target, branch: branchName(taskId), base, contract, uncommitted, committed, ahead };
}

/** The unified diff for review. Async: a large diff should not block the UI. */
async function diff(repo, taskId, options = {}) {
  assertTaskId(taskId);
  const root = repoRoot(repo);
  const target = worktreePath(root, taskId);
  const contract = readContract(target);
  const base = options.base || contract?.base_commit || 'HEAD';
  const args = ['diff', `--unified=${options.context ?? 3}`];
  if (options.file) args.push('--', options.file);
  // Working tree against the base: what a reviewer wants is everything this
  // task has done, committed or not, not just what it has got round to staging.
  return gitAsync(target, ['diff', base, ...args.slice(1)]);
}

module.exports = {
  WORKTREE_BASE, BRANCH_PREFIX,
  list, create, remove, status, diff,
  worktreePath, branchName, readContract, repoRoot, currentBranch, assertTaskId,
};
