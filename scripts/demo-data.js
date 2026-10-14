#!/usr/bin/env node
/**
 * Build a demo project: several features in parallel worktrees, several agent
 * sessions, sub-agents, guardrail refusals, evidence and a waiting gate.
 *
 *   node scripts/demo-data.js [dir]
 *
 * Everything is written through the real emitter and the real bridge, so what
 * the window shows is produced by the same code a live session produces it
 * with. A screenshot made from this is a screenshot of the product, not of a
 * mock-up — which matters, because a mock-up is the one thing you must never
 * show someone who is deciding whether to fund the real thing.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const emitter = require('../packages/emitter/src/emit.js');
const bridge = require('../packages/shell/src/ingest/harnessBridge.js');
const worktrees = require('../packages/shell/src/git/worktrees.js');

const root = path.resolve(process.argv[2] || path.join(require('os').tmpdir(), 'dai-ade-demo'));

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
}

/* ------------------------------------------------------------- the repo --- */

fs.rmSync(root, { recursive: true, force: true });
fs.mkdirSync(root, { recursive: true });
git(root, ['init', '-q', '-b', 'main']);
git(root, ['config', 'user.email', 'demo@example.invalid']);
git(root, ['config', 'user.name', 'DAI ADE demo']);

const files = {
  'src/billing/charge.ts': 'export async function charge(cardId: string, amount: number) {\n  return gateway.submit(cardId, amount);\n}\n',
  'src/billing/retry.ts': 'export function shouldRetry(result: Result) {\n  return result.declined;\n}\n',
  'src/auth/session.ts': 'export function createSession(userId: string) {\n  return { userId, issuedAt: Date.now() };\n}\n',
  'src/api/routes.ts': 'export const routes = [\n  { path: "/charge", handler: "charge" },\n];\n',
  'src/search/index.ts': 'export function search(q: string) {\n  return store.query(q);\n}\n',
  'docs/billing.md': '# Billing\n\nRetry a declined card at most twice.\n',
  'package.json': JSON.stringify({ name: 'payments-service', version: '2.4.0' }, null, 2) + '\n',
};
for (const [file, body] of Object.entries(files)) {
  fs.mkdirSync(path.join(root, path.dirname(file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), body);
}
git(root, ['add', '-A']);
git(root, ['commit', '-qm', 'payments service']);

/* ---------------------------------------------------- features in flight -- */

const FEATURES = [
  { id: 'retry-budget', objective: 'Cap declined-card retries at two',
    file: 'src/billing/retry.ts',
    body: 'const MAX_RETRIES = 2;\n\nexport function shouldRetry(result: Result, attempt: number) {\n  return result.declined && attempt < MAX_RETRIES;\n}\n', commit: true },
  { id: 'idempotent-charge', objective: 'Make charge idempotent with a request key',
    file: 'src/billing/charge.ts',
    body: 'export async function charge(cardId: string, amount: number, key: string) {\n  if (await seen(key)) return cached(key);\n  return gateway.submit(cardId, amount, key);\n}\n', commit: true },
  { id: 'session-rotation', objective: 'Rotate session tokens every 15 minutes',
    file: 'src/auth/session.ts',
    body: 'export function createSession(userId: string) {\n  return { userId, issuedAt: Date.now(), rotateAfter: 900_000 };\n}\n', commit: false },
  { id: 'search-ranking', objective: 'Fuse keyword and semantic ranking',
    file: 'src/search/index.ts',
    body: 'export function search(q: string) {\n  return rrf(bm25(q), semantic(q));\n}\n', commit: false },
];

for (const feature of FEATURES) {
  const made = worktrees.create(root, feature.id, { objective: feature.objective });
  const target = path.join(made.path, feature.file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, feature.body);
  if (feature.commit) {
    git(made.path, ['add', '-A']);
    git(made.path, ['commit', '-qm', feature.objective.toLowerCase()]);
    fs.appendFileSync(target, '\n// TODO: cover the boundary case\n');
  }
}

/* ------------------------------------------------------------- sessions --- */

/**
 * Drive the real emitter with the payloads Claude Code sends. Timestamps are
 * nudged backwards so the timeline has visible shape instead of every span
 * landing in the same millisecond.
 */
let clock = Date.now() - 23 * 60 * 1000;
function at(seconds) {
  clock += seconds * 1000;
  return clock;
}

function emit(payload, advanceSeconds = 2) {
  const when = at(advanceSeconds);
  const event = emitter.build({ cwd: root, ...payload });
  if (!event) return;
  // The timestamp is rewritten rather than faked through Date.now: makeEvent
  // builds it with `new Date()`, so overriding Date.now left every span in the
  // same millisecond and a 23-minute session measured 38ms on the timeline.
  event.ts = new Date(when).toISOString();
  const dir = path.join(root, '.dai-ade', 'events');
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(path.join(dir, `${event.run_id}.jsonl`), JSON.stringify(event) + '\n');
}

function toolCall(session, tool, input, { seconds = 3, failed = false } = {}) {
  emit({ hook_event_name: 'PreToolUse', session_id: session, tool_name: tool, tool_input: input }, 1);
  emit({
    hook_event_name: 'PostToolUse', session_id: session, tool_name: tool, tool_input: input,
    tool_response: failed ? { is_error: true, error: 'exit status 1' } : { ok: true },
  }, seconds);
}

const SESSIONS = [
  {
    id: 'sess-retry-budget', prompt: 'Cap declined-card retries at two and prove it',
    turns: [
      { tools: [['Read', { file: 'docs/billing.md' }], ['Grep', { pattern: 'shouldRetry' }]],
        agents: [{ id: 'explore-billing', type: 'Explore' }] },
      { tools: [['Edit', { file: 'src/billing/retry.ts' }], ['Bash', { command: 'npm test -- retry' }]],
        agents: [] },
      { tools: [['Bash', { command: 'npm run lint' }, { failed: true }], ['Edit', { file: 'src/billing/retry.ts' }]],
        agents: [] },
    ],
  },
  {
    id: 'sess-idempotency', prompt: 'Make charge idempotent with a request key',
    turns: [
      { tools: [['Read', { file: 'src/billing/charge.ts' }]],
        agents: [{ id: 'plan-idempotency', type: 'Plan' }, { id: 'explore-gateway', type: 'Explore' }] },
      { tools: [['Edit', { file: 'src/billing/charge.ts' }], ['Bash', { command: 'npm test -- charge' }]],
        agents: [] },
    ],
  },
  {
    id: 'sess-session-rotation', prompt: 'Rotate session tokens every 15 minutes',
    turns: [
      { tools: [['Read', { file: 'src/auth/session.ts' }], ['Edit', { file: 'src/auth/session.ts' }]],
        agents: [{ id: 'review-auth', type: 'code-review' }] },
    ],
  },
  {
    id: 'sess-search-ranking', prompt: 'Fuse keyword and semantic ranking',
    turns: [
      { tools: [['Grep', { pattern: 'bm25' }], ['Read', { file: 'src/search/index.ts' }]],
        agents: [{ id: 'explore-search', type: 'Explore' }, { id: 'general-bench', type: 'general-purpose' }] },
      { tools: [['Edit', { file: 'src/search/index.ts' }], ['Bash', { command: 'npm run bench' }]],
        agents: [],
        // Left mid-turn on purpose: the bridge attaches harness events to the
        // session that is open, which is where a waiting gate belongs.
        leaveOpen: true },
    ],
  },
];

// Parallel work overlaps. Rewinding the clock a little before each session
// makes the runs interleave on the timeline the way four features in flight
// actually do, rather than forming one queue.
SESSIONS.forEach((session, n) => {
  clock -= (SESSIONS.length - n) * 4 * 60 * 1000;
  emit({ hook_event_name: 'SessionStart', session_id: session.id }, 4);
  for (const turn of session.turns) {
    emit({ hook_event_name: 'UserPromptSubmit', session_id: session.id, prompt: session.prompt }, 2);
    for (const agent of turn.agents) {
      emit({ hook_event_name: 'SubagentStart', session_id: session.id, subagent_id: agent.id, agent_type: agent.type }, 2);
    }
    for (const [tool, input, options] of turn.tools) {
      toolCall(session.id, tool, input, options || {});
    }
    for (const agent of turn.agents) {
      emit({ hook_event_name: 'SubagentStop', session_id: session.id, subagent_id: agent.id, agent_type: agent.type }, 5);
    }
    if (!turn.leaveOpen) emit({ hook_event_name: 'Stop', session_id: session.id }, 2);
  }
});

/* ------------------------------------------------------ harness evidence -- */

const harnessDir = path.join(root, '.daiharness');
fs.mkdirSync(path.join(harnessDir, 'telemetry'), { recursive: true });
fs.mkdirSync(path.join(harnessDir, 'verify'), { recursive: true });

const stamp = (minutesAgo) => new Date(Date.now() - minutesAgo * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z');

fs.writeFileSync(path.join(harnessDir, 'telemetry', 'events-202610.jsonl'),
  [
    { ts: stamp(18), event: 'policy.deny', data: { tool: 'Bash', pattern: 'rm[[:space:]]+-rf', mode: 'strict' } },
    { ts: stamp(14), event: 'policy.deny', data: { tool: 'Bash', pattern: 'git[[:space:]]+push[[:space:]]+--force', mode: 'strict' } },
    { ts: stamp(9),  event: 'policy.deny', data: { tool: 'Write', pattern: '\\.env$', mode: 'strict' } },
    { ts: stamp(4),  event: 'policy.warn', data: { tool: 'Bash', pattern: 'chmod[[:space:]]+777', mode: 'permissive' } },
  ].map((e) => JSON.stringify(e)).join('\n') + '\n');

const evidence = [
  { name: 'retry-budget', exit: 0, ids: ['retry-cap-enforced', 'declined-card-path'], cmd: ['npm', 'test', '--', 'retry'] },
  { name: 'idempotent-charge', exit: 0, ids: ['charge-idempotent', 'duplicate-key-rejected'], cmd: ['npm', 'test', '--', 'charge'] },
  { name: 'search-ranking', exit: 1, ids: ['fusion-reports-degraded-branch'], cmd: ['npm', 'run', 'bench'] },
];
evidence.forEach((record, i) => {
  fs.writeFileSync(path.join(harnessDir, 'verify', `${record.name}.json`), JSON.stringify({
    schema_version: '2', exit_code: record.exit, tier: 'unit', risk: 'standard',
    phase: 'verification', turn: i + 1, tree_sha: `TREE:${record.name}`,
    timestamp_utc: stamp(12 - i * 3), command: record.cmd,
    acceptance_criteria: record.ids.map((id) => ({ id, claim: id.replace(/-/g, ' ') })),
    limitations: [], reviewer: { status: 'pending' },
  }, null, 2));
});

fs.writeFileSync(path.join(harnessDir, 'pipeline-state.json'), JSON.stringify({
  goal: 'Ship the billing hardening set', mode: 'FULL_BUILD', status: 'blocked_on_gate', phase_index: 2,
  phases: [
    { key: 'interpret', status: 'passed' },
    { key: 'define', status: 'passed' },
    { key: 'build', status: 'running' },
    { key: 'harden', status: 'pending' },
    { key: 'ship', status: 'pending' },
  ],
  pending_gate: 'gate3_build_review',
  gates: {
    gate1_brd: { approved: true, summary: 'Requirements agreed', ts: Date.now() / 1000 - 2400 },
    gate2_architecture: { approved: true, summary: 'ADRs accepted', ts: Date.now() / 1000 - 1500 },
  },
}, null, 2));

// Rebase the session stream so it ends a moment ago. Without this the demo is
// always an hour stale and every agent reads as idle, which hides the one state
// the map exists to show.
rebaseToNow(path.join(root, '.dai-ade', 'events'), 30_000);

function rebaseToNow(dir, endOffsetMs) {
  let names = [];
  try { names = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')); } catch { return; }
  const files = names.map((name) => {
    const file = path.join(dir, name);
    const events = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    return { file, events };
  });
  const newest = Math.max(...files.flatMap((f) => f.events.map((e) => Date.parse(e.ts))));
  if (!Number.isFinite(newest)) return;
  const shift = Date.now() - endOffsetMs - newest;
  for (const { file, events } of files) {
    for (const event of events) event.ts = new Date(Date.parse(event.ts) + shift).toISOString();
    fs.writeFileSync(file, events.map((e) => JSON.stringify(e)).join('\n') + '\n');
  }
}

const bridged = bridge.sync(root);

/* ---------------------------------------------------------------- done --- */

const { loadAll } = require('../packages/shell/src/cli.js');
const index = loadAll(root);
const runs = index.list();
const totals = runs.reduce((acc, r) => ({
  events: acc.events + r.events, spans: acc.spans + r.spans,
  tools: acc.tools + r.tools, blocked: acc.blocked + r.blocked,
  failed: acc.failed + r.failed, workers: acc.workers + r.workers,
}), { events: 0, spans: 0, tools: 0, blocked: 0, failed: 0, workers: 0 });

console.log(`demo project: ${root}`);
console.log(`  ${FEATURES.length} feature worktrees`);
console.log(`  ${runs.length} runs, ${totals.events} events, ${totals.spans} spans`);
console.log(`  ${totals.tools} tool calls, ${totals.workers} sub-agents, ${totals.blocked} blocked, ${totals.failed} failed`);
console.log(`  bridged ${bridged.written} harness event(s); a gate is waiting`);
