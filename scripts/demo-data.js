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

const featurePath = new Map();

for (const feature of FEATURES) {
  const made = worktrees.create(root, feature.id, { objective: feature.objective });
  featurePath.set(feature.id, made.path);
  const target = path.join(made.path, feature.file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, feature.body);
  if (feature.commit) {
    git(made.path, ['add', '-A']);
    git(made.path, ['commit', '-qm', feature.objective.toLowerCase()]);
    fs.appendFileSync(target, '\n// TODO: cover the boundary case\n');
  }
}

/* ------------------------------------------------- the project's commands -- */

// Commands a team standardised on. They live in the checkout, so every worktree
// has its own copy - which is why the composer reads them from the directory
// the agent will actually run in rather than from the repository root.
const COMMANDS = {
  'verify.md': '---\ndescription: Run the gate for this feature and report the evidence\n---\nRun the project gate and report what passed.\n',
  'review/api.md': '---\ndescription: Review the public surface for breaking changes\n---\nReview the public API surface for breaking changes.\n',
  'handoff.md': '---\ndescription: Summarise this worktree for whoever picks it up\n---\nSummarise the state of this worktree.\n',
};
for (const dir of [root, ...featurePath.values()]) {
  for (const [name, body] of Object.entries(COMMANDS)) {
    const file = path.join(dir, '.claude', 'commands', name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
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

let cwd = root;   // the directory the session being emitted is working in

function emit(payload, advanceSeconds = 2) {
  const when = at(advanceSeconds);
  // buildAll, not build: a closing hook also reports what the turn cost, and
  // that second event has to come out of the same code the installed hook runs.
  const events = emitter.buildAll({ cwd, ...payload });
  for (const event of events) {
    // The timestamp is rewritten rather than faked through Date.now: makeEvent
    // builds it with `new Date()`, so overriding Date.now left every span in
    // the same millisecond and a 23-minute session measured 38ms on the
    // timeline.
    event.ts = new Date(when).toISOString();
    const dir = path.join(cwd, '.dai-ade', 'events');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, `${event.run_id}.jsonl`), JSON.stringify(event) + '\n');
  }
}

function toolCall(session, tool, input, { seconds = 3, failed = false } = {}) {
  emit({ hook_event_name: 'PreToolUse', session_id: session, tool_name: tool, tool_input: input }, 1);
  emit({
    hook_event_name: 'PostToolUse', session_id: session, tool_name: tool, tool_input: input,
    tool_response: failed ? { is_error: true, error: 'exit status 1' } : { ok: true },
  }, seconds);
}

/**
 * Write a transcript in the shape the runner writes one.
 *
 * The demo does not hand the window token counts; it writes the file the
 * numbers really come from and lets the production reader parse it. If that
 * reader regresses, the demo screenshot loses its numbers too — which is the
 * point of generating demo data through the real code instead of beside it.
 */
function writeTranscript(dir, name, { model, turns, scale }) {
  const file = path.join(dir, '.dai-ade', 'transcripts', `${name}.jsonl`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lines = [];
  let context = Math.round(8_000 * scale);
  for (let turn = 0; turn < turns; turn++) {
    context += Math.round((3_200 + turn * 1_900) * scale);
    lines.push(JSON.stringify({
      type: 'assistant',
      message: {
        model,
        usage: {
          input_tokens: Math.round(700 * scale),
          cache_read_input_tokens: context - Math.round(700 * scale) - 1_400,
          cache_creation_input_tokens: 1_400,
          output_tokens: Math.round((420 + turn * 260) * scale),
        },
      },
    }));
  }
  fs.writeFileSync(file, lines.join('\n') + '\n');
  return file;
}

const SESSIONS = [
  {
    id: 'sess-retry-budget', feature: 'retry-budget', model: 'claude-opus-5',
    prompt: 'Cap declined-card retries at two and prove it',
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
    id: 'sess-idempotency', ended: true, feature: 'idempotent-charge', model: 'claude-opus-5',
    prompt: 'Make charge idempotent with a request key',
    turns: [
      { tools: [['Read', { file: 'src/billing/charge.ts' }]],
        agents: [{ id: 'plan-idempotency', type: 'Plan' }, { id: 'explore-gateway', type: 'Explore' }] },
      { tools: [['Edit', { file: 'src/billing/charge.ts' }], ['Bash', { command: 'npm test -- charge' }]],
        agents: [] },
    ],
  },
  {
    id: 'sess-session-rotation', feature: 'session-rotation', model: 'claude-sonnet-5-5',
    prompt: 'Rotate session tokens every 15 minutes',
    turns: [
      { tools: [['Read', { file: 'src/auth/session.ts' }], ['Edit', { file: 'src/auth/session.ts' }]],
        agents: [{ id: 'review-auth', type: 'code-review' }] },
    ],
  },
  {
    id: 'sess-search-ranking', feature: 'search-ranking', model: 'claude-opus-5',
    prompt: 'Fuse keyword and semantic ranking',
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
  {
    // Not every session is a feature branch. This one runs in the main
    // checkout, which is why the main checkout gets a tab of its own: without
    // it, selecting a feature would hide this work with nowhere to go back to.
    id: 'sess-release-notes', ended: true, feature: null, model: 'claude-sonnet-5-5',
    prompt: 'Write the release notes for the billing hardening set',
    turns: [
      { tools: [['Read', { file: 'docs/billing.md' }], ['Bash', { command: 'git log --oneline -20' }]],
        agents: [] },
    ],
  },
];

// Parallel work overlaps. Rewinding the clock a little before each session
// makes the runs interleave on the timeline the way four features in flight
// actually do, rather than forming one queue.
// A scout reads cheaply and a reviewer reasons expensively; the model and the
// size of the transcript follow the tier, which is what makes the map's numbers
// say something rather than just being present.
const TIER_MODEL = {
  Explore: ['claude-haiku-5-5', 0.45],
  Plan: ['claude-sonnet-5-5', 0.8],
  'code-review': ['claude-opus-5', 1.1],
  'general-purpose': ['claude-sonnet-5-5', 0.7],
};

SESSIONS.forEach((session, n) => {
  // Overlap, not a queue. The stagger used to be four minutes a session, which
  // put every session but the last one outside the idle threshold by the time
  // the stream was rebased - five features in flight, drawn as one live agent
  // and nine dead ones, which is the opposite of what parallel work looks like.
  clock -= (SESSIONS.length - n) * 70 * 1000;
  // The session works where its feature lives. This is the whole reason the
  // window tails every worktree: a session in a worktree writes its stream
  // there, so watching only the root showed none of this.
  cwd = session.feature ? featurePath.get(session.feature) : root;

  const transcript = writeTranscript(cwd, session.id,
    { model: session.model, turns: session.turns.length + 2, scale: 1 });

  emit({ hook_event_name: 'SessionStart', session_id: session.id }, 4);
  for (const turn of session.turns) {
    emit({ hook_event_name: 'UserPromptSubmit', session_id: session.id, prompt: session.prompt }, 2);
    for (const agent of turn.agents) {
      // A sub-agent is the `Task` tool being used - there is no hook that
      // announces one. This is the payload Claude Code actually sends.
      emit({
        hook_event_name: 'PreToolUse', session_id: session.id, tool_name: 'Task',
        tool_input: { description: agent.id, subagent_type: agent.type, prompt: agent.brief || session.prompt },
      }, 2);
    }
    for (const [tool, input, options] of turn.tools) {
      toolCall(session.id, tool, input, options || {});
    }
    for (const agent of turn.agents) {
      const [model, scale] = TIER_MODEL[agent.type] || ['claude-sonnet-5-5', 0.7];
      // A sub-agent has its own transcript, so its cost is its own and is not
      // double-counted into the session that spawned it.
      const workerTranscript = writeTranscript(cwd, `${session.id}-${agent.id}`,
        { model, turns: 3, scale });
      // The Task result is where a sub-agent's own figures come from.
      emit({
        hook_event_name: 'PostToolUse', session_id: session.id, tool_name: 'Task',
        tool_input: { description: agent.id, subagent_type: agent.type, prompt: agent.brief || session.prompt },
        tool_response: {
          totalTokens: Math.round(10_700 * scale),
          totalToolUseCount: agent.tools ?? 3,
          totalDurationMs: Math.round(14_000 * scale),
        },
        transcript_path: workerTranscript,
      }, 5);
    }
    if (!turn.leaveOpen) {
      emit({ hook_event_name: 'Stop', session_id: session.id, transcript_path: transcript }, 2);
    }
  }
  // Only the sessions that finished say so. A session between prompts has
  // closed its turn but not itself, which is most of them at any moment - that
  // distinction is the whole reason SessionEnd is worth having.
  if (session.ended) {
    emit({ hook_event_name: 'SessionEnd', session_id: session.id, reason: 'clear' }, 2);
  }
});
cwd = root;

/* ------------------------------------------------------ harness evidence -- */

const harnessDir = path.join(root, '.daiharness');
fs.mkdirSync(path.join(harnessDir, 'telemetry'), { recursive: true });
fs.mkdirSync(path.join(harnessDir, 'verify'), { recursive: true });

// Seconds, not minutes. The sessions are rebased into the last couple of
// minutes, so telemetry a quarter of an hour old stretched the timeline to
// cover it and squeezed every session bar into a sliver at the right-hand edge.
// A demo of parallel work has to put the guardrail refusals in the same window
// as the work they refused.
const stamp = (secondsAgo) => new Date(Date.now() - secondsAgo * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');

fs.writeFileSync(path.join(harnessDir, 'telemetry', 'events-202610.jsonl'),
  [
    { ts: stamp(190), event: 'policy.deny', data: { tool: 'Bash', pattern: 'rm[[:space:]]+-rf', mode: 'strict' } },
    { ts: stamp(150), event: 'policy.deny', data: { tool: 'Bash', pattern: 'git[[:space:]]+push[[:space:]]+--force', mode: 'strict' } },
    { ts: stamp(96),  event: 'policy.deny', data: { tool: 'Write', pattern: '\\.env$', mode: 'strict' } },
    { ts: stamp(52),  event: 'policy.warn', data: { tool: 'Bash', pattern: 'chmod[[:space:]]+777', mode: 'permissive' } },
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
    timestamp_utc: stamp(170 - i * 45), command: record.cmd,
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
    gate1_brd: { approved: true, summary: 'Requirements agreed', ts: Date.now() / 1000 - 240 },
    gate2_architecture: { approved: true, summary: 'ADRs accepted', ts: Date.now() / 1000 - 150 },
  },
}, null, 2));

// Rebase the session stream so it ends a moment ago. Without this the demo is
// always an hour stale and every agent reads as idle, which hides the one state
// the map exists to show.
const EVENT_DIRS = [root, ...featurePath.values()].map((d) => path.join(d, '.dai-ade', 'events'));
// One shift for every stream. Rebasing each directory to its own end would
// slide the features apart in time and destroy the overlap that makes parallel
// work legible.
rebaseToNow(EVENT_DIRS, 30_000);

function rebaseToNow(dirs, endOffsetMs) {
  const files = [];
  for (const dir of dirs) {
    let names = [];
    try { names = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')); } catch { continue; }
    for (const name of names) {
      const file = path.join(dir, name);
      const events = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
      files.push({ file, events });
    }
  }
  if (!files.length) return;

  // Each run is landed separately, a few seconds apart, rather than all of them
  // by one shift. A single shift preserves the order the sessions were written
  // in, and that order spans twenty minutes: rebasing it as a block leaves one
  // agent inside the idle threshold and the rest outside it, so five features
  // in flight draw as one live agent and ten dead ones. The point of the demo
  // is parallel work, and parallel work means several agents live at once.
  files.sort((a, b) => lastTs(a) - lastTs(b));
  files.forEach((entry, n) => {
    const shift = Date.now() - (endOffsetMs + n * 11_000) - lastTs(entry);
    for (const event of entry.events) event.ts = new Date(Date.parse(event.ts) + shift).toISOString();
    fs.writeFileSync(entry.file, entry.events.map((e) => JSON.stringify(e)).join('\n') + '\n');
  });
}

function lastTs(entry) {
  return Math.max(...entry.events.map((e) => Date.parse(e.ts)));
}

const bridged = bridge.sync(root);

/* ---------------------------------------------------------------- done --- */

const { loadAll } = require('../packages/shell/src/cli.js');
const runs = [root, ...featurePath.values()].flatMap((dir) => loadAll(dir).list());
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
