#!/usr/bin/env node
/**
 * `ade` — the headless half of the ADE.
 *
 * Everything the window will show is computed here, so the data path can be
 * exercised and tested without Electron. That separation is deliberate: the
 * renderer should be a pure function of the run index, and the fastest way to
 * guarantee that is to make the index usable with no renderer at all.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { RunDirectoryTailer } = require('./ingest/tailer.js');
const { RunIndex } = require('./store/runIndex.js');
const { eventsDir } = require('../../emitter/src/emit.js');
const worktrees = require('./git/worktrees.js');

const C = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  blue: (s) => `\x1b[34m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  amber: (s) => `\x1b[33m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
};

const TYPE_COLOUR = {
  TOOL_BLOCKED: C.red, TOOL_FAILED: C.red, WORKER_FAILED: C.red, VERIFY_FAILED: C.red, RULE_VIOLATION: C.red,
  GATE_REQUESTED: C.amber, GATE_REJECTED: C.amber,
  WORKER_SPAWNED: C.cyan, WORKER_DELIVERED: C.cyan, WORKER_MERGED: C.cyan,
  EVIDENCE_WRITTEN: C.green, VERIFY_PASSED: C.green, GATE_APPROVED: C.green,
};

function projectRoot(argv) {
  const i = argv.indexOf('--project');
  return path.resolve(i >= 0 && argv[i + 1] ? argv[i + 1] : process.cwd());
}

/* ------------------------------------------------------------------ tail -- */

function cmdTail(argv) {
  const root = projectRoot(argv);
  const dir = eventsDir(root);
  const index = new RunIndex();

  console.log(C.bold('dai-ade') + C.dim(`  tailing ${dir}`));
  if (!fs.existsSync(dir)) {
    console.log(C.dim('  (no events yet — run `ade install-hooks` and start a session)'));
  }

  const tailer = new RunDirectoryTailer(dir, { intervalMs: 150 });
  tailer.on('run', (id) => console.log(C.dim(`\n── run ${id} ──`)));
  tailer.on('invalid', (d) => console.log(C.red(`  ! ${d.reason} in ${d.file}`)));
  tailer.on('event', (e) => {
    if (!index.add(e)) return;
    const paint = TYPE_COLOUR[e.type] || ((s) => s);
    const when = e.ts.slice(11, 23);
    const who = `${e.actor.kind}:${e.actor.id}`.slice(0, 22).padEnd(22);
    const detail = e.payload?.tool
      ? e.payload.tool
      : e.payload?.prompt
        ? String(JSON.stringify(e.payload.prompt)).slice(0, 60)
        : '';
    console.log(`${C.dim(when)}  ${paint(e.type.padEnd(18))} ${C.dim(who)} ${detail}`);
  });
  tailer.start();

  const report = () => {
    const runs = index.list();
    if (!runs.length) return;
    const r = runs[0];
    process.stderr.write(
      C.dim(`\n  ${r.events} events · ${r.spans} spans (${r.openSpans} open) · ` +
            `${r.tools} tools · ${r.blocked} blocked · ${r.failed} failed · ${r.workers} workers\n`)
    );
  };
  process.on('SIGINT', () => { tailer.stop(); report(); process.exit(0); });
}

/* ------------------------------------------------------------------ runs -- */

function loadAll(root) {
  const dir = eventsDir(root);
  const index = new RunIndex();
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')); } catch { return index; }
  const { validateEvent } = require('../../shared/src/events.js');
  for (const name of files) {
    const text = fs.readFileSync(path.join(dir, name), 'utf8');
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const result = validateEvent(JSON.parse(line));
        if (result.ok) index.add(result.event);
      } catch { /* a torn final line is expected while a run is live */ }
    }
  }
  return index;
}

function cmdRuns(argv) {
  const index = loadAll(projectRoot(argv));
  const runs = index.list();
  if (!runs.length) return console.log(C.dim('no runs recorded yet'));
  console.log(C.bold('run'.padEnd(16)) + ['events', 'spans', 'tools', 'blocked', 'failed', 'workers', 'started'].map((h) => C.bold(h.padStart(9))).join(''));
  for (const r of runs) {
    console.log(
      r.id.padEnd(16) +
      String(r.events).padStart(9) + String(r.spans).padStart(9) +
      String(r.tools).padStart(9) +
      (r.blocked ? C.red(String(r.blocked).padStart(9)) : String(0).padStart(9)) +
      (r.failed ? C.red(String(r.failed).padStart(9)) : String(0).padStart(9)) +
      String(r.workers).padStart(9) +
      C.dim('  ' + String(r.startedAt ?? '').slice(0, 19))
    );
  }
}

function cmdTree(argv) {
  const index = loadAll(projectRoot(argv));
  const runId = argv.find((a) => a.startsWith('run_')) || index.list()[0]?.id;
  if (!runId) return console.log(C.dim('no runs recorded yet'));
  console.log(C.bold(runId));
  const walk = (nodes, depth) => {
    for (const n of nodes) {
      const mark = n.status === 'failed' ? C.red('✖') : n.status === 'open' ? C.amber('○') : C.green('✔');
      const dur = n.durationMs == null ? C.dim('—') : C.dim(`${n.durationMs}ms`);
      console.log(`${'  '.repeat(depth + 1)}${mark} ${C.cyan(n.actor.kind)}:${n.actor.id} ${C.dim(n.type || '')} ${dur}`);
      walk(n.children, depth + 1);
    }
  };
  walk(index.tree(runId), 0);
}

/* ------------------------------------------------------------- worktrees -- */

function cmdWork(argv) {
  const root = projectRoot(argv);
  const sub = argv[1];

  if (sub === 'new') {
    const taskId = argv[2];
    if (!taskId) return console.error(C.red('usage: ade work new <task-id> [--objective "..."]'));
    const oi = argv.indexOf('--objective');
    const made = worktrees.create(root, taskId, { objective: oi >= 0 ? argv[oi + 1] : undefined });
    console.log(C.green('created ') + C.bold(made.taskId));
    console.log(C.dim(`  ${made.path}`));
    console.log(C.dim(`  branch ${made.branch} from ${made.base}`));
    return;
  }

  if (sub === 'rm') {
    const taskId = argv[2];
    if (!taskId) return console.error(C.red('usage: ade work rm <task-id> [--force] [--delete-branch]'));
    const out = worktrees.remove(root, taskId, {
      force: argv.includes('--force'),
      deleteBranch: argv.includes('--delete-branch'),
    });
    console.log(C.green('removed ') + out.taskId +
      (out.discarded ? C.red(`  (${out.discarded} change(s) discarded)`) : ''));
    return;
  }

  if (sub === 'diff') {
    const taskId = argv[2];
    if (!taskId) return console.error(C.red('usage: ade work diff <task-id>'));
    return worktrees.diff(root, taskId).then((text) => {
      // Coloured the way git would, so a diff reads the same here as in the
      // terminal the reviewer already knows.
      for (const line of text.split('\n')) {
        if (line.startsWith('+++') || line.startsWith('---')) console.log(C.bold(line));
        else if (line.startsWith('+')) console.log(C.green(line));
        else if (line.startsWith('-')) console.log(C.red(line));
        else if (line.startsWith('@@')) console.log(C.cyan(line));
        else console.log(line);
      }
    });
  }

  const entries = worktrees.list(root);
  if (!entries.length) return console.log(C.dim('no worktrees (not a git repository?)'));
  console.log(C.bold('task'.padEnd(18)) + C.bold('branch'.padEnd(26)) + C.bold('state'));
  for (const e of entries) {
    if (e.isMain) {
      console.log(C.dim('(main)'.padEnd(18) + String(e.branch || e.head || '').padEnd(26) + 'the repository itself'));
      continue;
    }
    let state = e.managed ? '' : C.dim('not managed here');
    if (e.managed) {
      try {
        const s = worktrees.status(root, e.taskId);
        const bits = [];
        if (s.ahead) bits.push(C.cyan(`${s.ahead} commit(s)`));
        if (s.uncommitted.length) bits.push(C.amber(`${s.uncommitted.length} uncommitted`));
        if (!bits.length) bits.push(C.dim('clean'));
        state = bits.join(' · ');
      } catch (err) { state = C.red(err.message); }
    }
    console.log((e.taskId || path.basename(e.path)).padEnd(18) + String(e.branch || '').padEnd(26) + state);
    const objective = e.contract && e.contract.objective;
    if (objective) console.log(C.dim('  ' + objective));
  }
}

/* --------------------------------------------------------- install-hooks -- */

const HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'SubagentStart', 'SubagentStop', 'Stop'];

/**
 * Install the emitter into the PROJECT settings only.
 *
 * Never `~/.claude/settings.json`. Those hooks commonly belong to another tool
 * already, one the user may not control; Claude Code merges user and project
 * hooks, so adding ours at project level composes alongside instead of fighting
 * for ownership. Clobbering another tool's hook chain to install your own
 * observability is how you break the editor.
 */
function cmdInstallHooks(argv) {
  const root = projectRoot(argv);
  const target = path.join(root, '.claude', 'settings.json');
  const emitPath = path.resolve(__dirname, '..', '..', 'emitter', 'src', 'emit.js').replace(/\\/g, '/');
  const command = `node "${emitPath}"`;

  let settings = {};
  if (fs.existsSync(target)) {
    try { settings = JSON.parse(fs.readFileSync(target, 'utf8')); }
    catch { return console.error(C.red(`${target} is not valid JSON — refusing to touch it`)); }
  }
  settings.hooks = settings.hooks || {};

  let added = 0;
  for (const event of HOOK_EVENTS) {
    const matchers = (settings.hooks[event] = settings.hooks[event] || []);
    const already = matchers.some((m) => (m.hooks || []).some((h) => String(h.command || '').includes('emit.js')));
    if (already) continue;
    matchers.push({ matcher: '*', hooks: [{ type: 'command', command }] });
    added++;
  }

  if (!added) return console.log(C.dim('emitter already installed in ' + target));
  if (argv.includes('--dry-run')) {
    return console.log(JSON.stringify(settings, null, 2));
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(settings, null, 2) + '\n');
  console.log(C.green(`installed into ${added} hook event(s)`) + C.dim(` in ${target}`));
  console.log(C.dim('restart the session for hooks to take effect'));
}

/* ---------------------------------------------------------------- doctor -- */

function cmdDoctor(argv) {
  const root = projectRoot(argv);
  const dir = eventsDir(root);
  const rows = [];
  const ok = (k, v) => rows.push([C.green('ok  '), k, v]);
  const warn = (k, v) => rows.push([C.amber('warn'), k, v]);

  rows.push([C.dim('    '), 'project', root]);

  const major = Number(process.versions.node.split('.')[0]);
  (major >= 20 ? ok : warn)('node', process.version);

  if (fs.existsSync(dir)) {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
    ok('event store', `${dir} (${files.length} run file(s))`);
  } else {
    warn('event store', `${dir} does not exist yet`);
  }

  const projectSettings = path.join(root, '.claude', 'settings.json');
  if (fs.existsSync(projectSettings)) {
    const text = fs.readFileSync(projectSettings, 'utf8');
    (text.includes('emit.js') ? ok : warn)('project hooks', text.includes('emit.js') ? 'emitter installed' : 'emitter NOT installed — run `ade install-hooks`');
  } else {
    warn('project hooks', 'no .claude/settings.json — run `ade install-hooks`');
  }

  // Report, do not touch: these belong to another tool.
  const userSettings = path.join(require('os').homedir(), '.claude', 'settings.json');
  if (fs.existsSync(userSettings)) {
    const text = fs.readFileSync(userSettings, 'utf8');
    // Report, never rewrite: a user-level hook chain belongs to whatever tool
    // installed it, and this one composes beside it at project level.
    const mine = text.includes('emit.js');
    const other = mine ? 'present (includes this emitter)' : 'owned by another tool (left alone by design)';
    rows.push([C.dim('    '), 'user hooks', C.dim(other)]);
  }

  const index = loadAll(root);
  const runs = index.list();
  rows.push([C.dim('    '), 'runs indexed', String(runs.length)]);
  if (runs[0]) rows.push([C.dim('    '), 'latest run', `${runs[0].id} · ${runs[0].events} events`]);

  for (const [status, key, value] of rows) console.log(`  ${status}  ${C.bold(key.padEnd(14))} ${value}`);
}

/* ------------------------------------------------------------------ main -- */

const USAGE = `${C.bold('ade')} — DAI Agent Development Environment

  ade doctor           what is wired up, and what is not
  ade install-hooks    install the event emitter into THIS project's .claude/settings.json
  ade tail             follow the live event stream
  ade runs             one line per recorded run
  ade tree [run_id]    the spawn tree for a run

  ade work             worktrees, one per parallel task
  ade work new <id>    create one  [--objective "..."]
  ade work diff <id>   review what it changed
  ade work rm <id>     remove it   [--force] [--delete-branch]

  --project <dir>      operate on another project (default: cwd)
  --dry-run            install-hooks: print the result instead of writing
`;

function main() {
  const [, , cmd, ...rest] = process.argv;
  const argv = [cmd, ...rest];
  switch (cmd) {
    case 'tail': return cmdTail(argv);
    case 'runs': return cmdRuns(argv);
    case 'tree': return cmdTree(argv);
    case 'work': return cmdWork(argv);
    case 'install-hooks': return cmdInstallHooks(argv);
    case 'doctor': return cmdDoctor(argv);
    default: return console.log(USAGE);
  }
}

// Run when invoked directly. `bin/ade.js` requires this module instead, so it
// has to call main() itself: require.main is the bin script there, not this
// file, and the first version of that wrapper silently did nothing at all.
if (require.main === module) main();
module.exports = { main, loadAll, cmdDoctor, cmdWork, HOOK_EVENTS };
