# DAI ADE — build plan

An Agent Development Environment for the DAI Harness, as a Windows desktop app.

Status: plan only. Nothing here is built yet. Paths marked **(exists)** were read
out of `Downloads/forgewright/dai-nexus` at commit `f7f075f`; everything else is
work to do.

---

## 0. The reframe that makes this tractable

You are not building an ADE from scratch. You are building **the window onto a
harness that already emits**. Roughly 70% of the data plane exists:

| Capability | Where it already lives | State |
|---|---|---|
| Worktree per task | `scripts/lite/worktree_manager.py` — `create / contract / deliver / validate / merge` | **exists** |
| Parallel workers | `skills/parallel-dispatch/`, `DAIHARNESS_MAX_WORKERS` (default 4) | **exists** |
| Task contract | `CONTRACT.json` per worktree, merge arbiter rules | **exists** |
| Pipeline state | `mcp/src/core/models/PipelineState.ts` — `currentPhase`, `status: IDLE \| IN_PROGRESS \| WAITING_FOR_GATE \| COMPLETED \| FAILED`, `phases[]`, `activeAction`, `phaseProgress`, `selfHealing`, `qualityGate` | **exists** |
| Pipeline control | `PipelineService` — `startPipeline`, `advancePhase`, `requestGateApproval`, `approveGate`, `failPipeline`, `updateSubTask`, `updateSelfHealing` | **exists** |
| Event publishing | `IEventPublisher` → `FileLogEventPublisher`, `HttpWebhookEventPublisher`, `McpEventPublisher`, `CombinedEventPublisher` | **exists** |
| Event log | `.daiharness/events.log` | **exists** |
| Telemetry | `.daiharness/telemetry/events-YYYYMM.jsonl` via `scripts/lite/telemetry.sh emit <type> <json>` | **exists** |
| Evidence records | `.daiharness/verify/*.json`, schema v2 | **exists** |
| Guardrail | `scripts/lite/policy-check.sh` runs before tool execution | **exists** |
| MCP surfaces | harness `dh_*` tools; memory layer 35 tools + 3 prompts | **exists** |
| Memory + code graph | `vendor/dai-memory` submodule, `.memory/` | **exists** |

**And the console contract is already pre-wired.**
`HttpWebhookEventPublisher` looks for:

```
~/.daiharness-console/webhook-port.txt
~/.daiharness-console/webhook-token.txt
~/.daiharness-console/rpc-port.txt      (mcp/src/state/rpc-port.ts)
```

The harness already tries to POST events to a console. **Nothing listens.**
Your ADE is that listener. That is the single most important fact in this plan:
the integration seam was designed for, and is sitting unused.

### What is genuinely missing

1. A **stable event schema with span IDs**. Today the event names are ad-hoc
   (`PIPELINE_STATE_UPDATE`, `COST_UPDATE`) and carry no correlation IDs. Without
   `span_id` / `parent_span_id` you get a flat log and **cannot** draw a spawn
   tree or a flow timeline. This is the first thing to build, and it is a change
   to the *harness*, not the ADE.
2. The webhook listener, the index, and every view.
3. Python-side events do not reach the HTTP webhook (that publisher is
   TypeScript only). File tailing covers both runtimes — see §2.

---

## 1. What to copy from Orca, and what not to

Orca (MIT, open source) runs multiple coding agents in parallel, each in an
isolated git worktree with its own terminal and its own Chromium window.

**Worth stealing:**
- Worktree-per-task isolation — you already have it in `worktree_manager.py`.
- Batched diff-line comments sent back to the agent as feedback.
- A real browser per worktree for front-end work.

**Do not copy the shape of it.** Orca supervises *opaque* agents: it drives
Claude Code, Codex, Gemini and others as black boxes. It can show you a terminal,
a diff and a browser, because that is all those agents expose. It structurally
cannot tell you *why* an agent did something, which rule stopped it, or whether
"done" was ever verified.

Your harness emits phases, gate decisions, guardrail verdicts, evidence records,
a rule ledger and a memory graph. So your ADE can show the thing Orca cannot:

> **the decision trail, not just the output.**

That is the product. If you build an Orca-shaped terminal-first UI you will have
spent months to arrive at a worse Orca. Build the glass box.

---

## 2. Architecture

Three layers, three processes.

```
┌─────────────────────────────────────────────────────────────┐
│  RENDERER  (React + TS)                                      │
│  Views only. No filesystem, no child processes.              │
│  Flow · Roster · Inspector · Gates · Diff · Terminal · Memory│
└───────────────▲─────────────────────────────────────────────┘
                │ typed IPC (contextBridge, no nodeIntegration)
┌───────────────┴─────────────────────────────────────────────┐
│  SHELL  (Electron main / Node)                               │
│  • webhook listener on 127.0.0.1, writes ~/.daiharness-console│
│  • file tailers (events.log, telemetry/*.jsonl, verify/*)    │
│  • SQLite event index (better-sqlite3)                       │
│  • MCP stdio clients: harness dh_*, memory layer             │
│  • PTY supervisor (node-pty / ConPTY)                        │
│  • git + worktree_manager.py driver                          │
└───────────────▲─────────────────────────────────────────────┘
                │ spawn / MCP / file watch
┌───────────────┴─────────────────────────────────────────────┐
│  AGENTS + HARNESS  (unchanged)                               │
│  Claude Code / CLI agents · dai-harness · dai-memory         │
│  write .daiharness/** and .memory/**                         │
└──────────────────────────────────────────────────────────────┘
```

### Ingestion: three paths, deliberately redundant

| Path | Latency | Survives ADE restart | Use for |
|---|---|---|---|
| **File tail** — `.daiharness/events.log`, `telemetry/*.jsonl`, `verify/*.json`, `pipeline-state.json` | ~100ms (polling) | **yes** — full replay | the authoritative record |
| **HTTP webhook** — ADE writes `webhook-port.txt` + `webhook-token.txt`, harness POSTs | instant | no | live UI responsiveness |
| **MCP client** — `dh_get_state`, memory tools | on demand | n/a | queries and **control** |

Redundancy is the point. The webhook gives you latency; the files give you truth
and replay. If the ADE was closed while a run happened, tailing reconstructs the
whole thing — which is also how the replay/scrub view in M6 works for free.

**Conflict rule:** files win. A webhook event is a hint that a file changed; the
file is the record. Dedupe on `(run_id, seq)`.

---

## 3. Build this first: `ade-event/v1`

Everything else depends on it, and it is a harness change, not an ADE change.

```jsonc
{
  "v": 1,
  "ts": "2026-10-05T04:12:33.481Z",
  "run_id": "run_01JAB…",        // one user task, start to finish
  "seq": 1042,                     // monotonic per run; dedupe key
  "span_id": "sp_7f2a",            // this unit of work
  "parent_span_id": "sp_0001",     // null for the root — THIS draws the tree
  "actor": {
    "kind": "root | worker | expert | tool",
    "id": "worker-3",
    "tier": "scout | builder | expert",
    "model": "claude-opus-5-5",    // whatever actually answered
    "worktree": ".worktrees/task-3" // null for root
  },
  "type": "TOOL_BLOCKED",
  "payload": { }                   // per-type, below
}
```

`span_id` / `parent_span_id` is non-negotiable. Without it the Flow view and the
spawn tree are impossible and you will have built a log viewer.

### Event taxonomy to emit

| Group | Types |
|---|---|
| Run | `RUN_STARTED` `RUN_ENDED` |
| Phase | `PHASE_ENTERED` `PHASE_EXITED` |
| Gate | `GATE_REQUESTED` `GATE_APPROVED` `GATE_REJECTED` |
| Worker | `WORKER_SPAWNED` `WORKER_CONTRACT` `WORKER_DELIVERED` `WORKER_MERGED` `WORKER_FAILED` |
| Tool | `TOOL_PROPOSED` `TOOL_BLOCKED` `TOOL_EXECUTED` `TOOL_FAILED` |
| Escalation | `ESCALATION_REQUESTED` `ESCALATION_RESULT` |
| Evidence | `EVIDENCE_WRITTEN` `VERIFY_PASSED` `VERIFY_FAILED` |
| Memory | `MEMORY_WRITE` `MEMORY_SEARCH` |
| Cost | `COST_UPDATE` |
| Rules | `RULE_VIOLATION` |

`TOOL_BLOCKED` is the highest-value event in the list. It is the moment the
guardrail stopped something, and it is exactly what no other ADE can show you.
Its payload should carry the matched deny pattern and the policy mode.

### Harness-side work this implies

- `scripts/lite/telemetry.sh` gains the envelope (it already takes
  `emit <type> <json>` — wrap, do not replace).
- `policy_check.py` emits `TOOL_BLOCKED` / `TOOL_EXECUTED` (it already writes
  `policy.deny` / `policy.warn` telemetry — upgrade it to the envelope).
- `worktree_manager.py` emits the `WORKER_*` events at create/deliver/merge.
- `escalate.py` emits `ESCALATION_*`.
- `run_check.py` emits `EVIDENCE_WRITTEN` with the record path.
- A tiny shared helper so run_id/span_id propagate through env vars
  (`DAIHARNESS_RUN_ID`, `DAIHARNESS_SPAN_ID`) into child processes — that is how
  a worker inherits its parent span without any IPC.

Ship this **before** the UI. It is testable on its own: run a task, assert the
JSONL contains a well-formed tree.

---

## 4. The views

### a. Flow — "xem flow đang chạy"
Swimlane timeline. X axis = wall-clock. One lane per actor (root at top, workers
below, experts nested). Phase bands across the top; gates as vertical stop bars
that go amber when `status = WAITING_FOR_GATE`. Tool calls are ticks on a lane;
blocked ones are red. Click any span → Inspector.

Live mode follows the head; drag back to scrub history (same data path, so
replay is free).

### b. Roster / spawn tree — "spawn agent nào"
Table + tree, driven entirely by `parent_span_id`:

`task_id · contract objective · tier/model · worktree · branch · status · tools used · cost · elapsed`

Row actions: focus in Flow, open terminal, open diff, kill.

### c. Inspector
Context-sensitive on the selected span.
- Tool call → proposed args, **policy verdict and which pattern matched**, exit code, stdout/stderr, duration.
- Evidence record → acceptance IDs, the exact argv, `tree_sha`, PASS/FAIL per criterion, limitations.
- Worker → its CONTRACT.json, changed files, validation result.

### d. Gate console
The harness blocks on `WAITING_FOR_GATE`. Show what is being asked, the evidence
gathered so far, and Approve / Reject-with-reason — written back via MCP
`dh_approve_gate`. This is the first **write** path, so it needs a confirmation
step and an audit entry.

### e. Diff review
Monaco diff per worktree. Markdown comments on specific lines, batched, sent back
to the agent as one feedback message. (The one Orca idea worth copying wholesale.)

### f. Terminal
xterm.js attached to the worker PTY. Scrollback persisted per worktree.

### g. Memory lens — yours alone
For the file open in the diff, call `dai_memory_why` and show the decisions and
incidents attached to it, plus `dai_memory_impact` for the symbol under the
cursor. No other ADE can do this, because no other ADE has your memory layer.

---

## 5. Stack decision

**Recommendation: Electron + TypeScript + React + Vite.**

Reasons, in order of weight:
1. **Zero new languages.** Your stack is already TS (`mcp/`, `src/cli/`) and
   Python (`scripts/lite/`). A solo project with a 45-minute CI gate cannot also
   absorb Rust.
2. You can **reuse `src/cli` directly in the main process** — the docs gate, the
   MCP client code and the evidence parsing are already written in TS.
3. `node-pty` (ConPTY on Windows), `xterm.js`, `monaco-editor`,
   `better-sqlite3`, `chokidar` and the MCP TypeScript SDK are all first-class
   in Node and all are things you need.

**Cost, stated honestly:** ~150–250 MB resident for an app that runs all day next
to agents that are already heavy. That is the real price of this choice.

**Alternative: Tauri 2** — ~10 MB binary, far lower RAM, `portable-pty` is mature
(WezTerm uses it). Take it only if the footprint becomes a real problem. The
renderer ports almost unchanged; the shell is the rewrite. Decide once, early.

Supporting choices:
- `better-sqlite3` for the event index. Do **not** hold thousands of events in
  React state; query windows of them.
- `chokidar` with `usePolling: true` on Windows for JSONL tails, plus explicit
  partial-line buffering (a tailer that splits mid-line will corrupt an event).
- `zod` for event validation at the boundary — reject malformed events loudly
  rather than rendering half a span.

---

## 6. Milestones

Each one ships a usable app.

### M0 — Spike (1–2 days)
Electron window, tail `.daiharness/events.log` and `pipeline-state.json`, render
the raw stream in a list. No design. **Proves the ingestion path works on
Windows**, which is the only unknown that can sink the project.

### M1 — Observer, read-only ← *the real first release*
Flow + Roster + Inspector, fed by file tailing only. No webhook, no control, no
PTY. **This is already useful on day one**: you can watch a run and see what the
harness decided, which is something you cannot do today at all.

Stop here for a while and use it. Everything after this is easier to judge once
you have lived with M1.

### M2 — `ade-event/v1` in the harness
Span IDs, the event taxonomy, env-var propagation. Harness PRs, not ADE work.
Flow and Roster go from approximate to exact.

### M3 — Control plane
Webhook listener (live latency) + MCP client. Gate approve/reject, cancel a run.
First write path: needs the token file, 127.0.0.1 binding, and a confirmation UX.

### M4 — Worktrees + diff review
Drive `worktree_manager.py` from the UI. Monaco diff, batched line comments.

### M5 — Terminal
node-pty + xterm.js, persisted scrollback.

### M6 — Memory lens + replay
`dai_memory_why` / `impact` in the inspector. Scrub a finished run from the
JSONL — which already works if M1 was built on file tailing.

---

## 7. Risks, from your actual environment

These are not generic; each one has already bitten this machine.

| Risk | Why it will happen here | Mitigation |
|---|---|---|
| **LadybugDB single writable open** | On Windows a path opened for writing cannot be reopened for writing in the same process. An ADE that holds a writable memory handle will deadlock the agent's writes. | ADE opens the memory store **read-only, always**. All writes go through the CLI/MCP, which are short-lived processes. |
| **MSYS vs native paths** | `/c/Users/...` from Git Bash vs `C:/Users/...` for node. This already broke the session tracker and the installer. | Normalise once at the boundary with `cygpath -m`; store one spelling. |
| **Windows file tailing** | No inotify; a naive watcher misses appends. | `chokidar` with polling + partial-line buffer + `(run_id, seq)` dedupe. |
| **PTY on Windows** | ConPTY quirks with resize and exit codes. | `node-pty` ≥ 1.x, test resize early in M5. |
| **Event volume** | A busy parallel run writes thousands of events. | SQLite index; virtualised lists; never keep the full stream in React. |
| **Webhook auth** | A listener on localhost is reachable by anything on the machine. | Generate `webhook-token.txt` per session, bind 127.0.0.1 only, reject unauthenticated POSTs, delete the file on exit. |
| **The 45-minute gate** | Tempting to wire "run the gate" into the UI. | Never run the full gate on a UI action. Expose it as an explicit, clearly-labelled long job. |
| **Scope** | An ADE is a 6–12 month solo project. | M1 must be independently useful. If M1 is not useful, the plan is wrong. |

---

## 8. Repo skeleton

```
dai-ade/
├─ package.json                  # workspaces: shell, renderer, shared
├─ electron.vite.config.ts
├─ shared/
│  ├─ events.ts                  # ade-event/v1 types + zod schemas
│  └─ ipc.ts                     # typed IPC contract
├─ shell/                        # Electron main
│  ├─ main.ts
│  ├─ ingest/
│  │  ├─ fileTailer.ts           # events.log, telemetry/*.jsonl, verify/*
│  │  ├─ webhookServer.ts        # writes ~/.daiharness-console/*
│  │  └─ index.ts                # merge, dedupe, persist
│  ├─ store/
│  │  ├─ schema.sql
│  │  └─ eventStore.ts           # better-sqlite3
│  ├─ mcp/
│  │  ├─ harnessClient.ts        # dh_* tools
│  │  └─ memoryClient.ts         # read-only
│  ├─ pty/ptyManager.ts
│  └─ git/worktrees.ts           # drives worktree_manager.py
├─ renderer/
│  ├─ views/{Flow,Roster,Inspector,Gates,Diff,Terminal,Memory}/
│  ├─ components/
│  └─ state/                     # zustand or similar
└─ docs/
   ├─ PLAN.md                    # this file
   └─ EVENT-SCHEMA.md            # ade-event/v1, versioned
```

Licence note: Orca is MIT, so reading it is fine and reuse is permitted with
attribution. Given you dropped GitNexus over its licence, keep the provenance
clean here too — take interface ideas, write your own code, and if you ever do
vendor anything, record it the way the memory plugin records its grammars.

---

## 9. M0 definition of done

A single Electron window that, with the harness running a real task in
`dai-nexus`:

- [ ] tails `.daiharness/events.log` and `.daiharness/telemetry/events-*.jsonl`
      without dropping or splitting a line, for a run that produces ≥ 500 events;
- [ ] renders `pipeline-state.json` — current phase, status, and the amber state
      when `status = WAITING_FOR_GATE`;
- [ ] survives the ADE being closed mid-run and reconstructs the full run from
      files on restart;
- [ ] holds no writable handle on `.memory/` or `.daiharness/memory.db`
      (verify: run the memory CLI while the ADE is open — it must still write).

If all four hold, the hard part of the ingestion design is proven and the rest
is UI.

---

# Review corrections — 2026-10-05

The plan above was written before anything was measured. Building M0 tested its
assumptions, and three of them were wrong. Corrections, with the evidence.

## C1 — "70% of the data plane exists" was wrong

The *code* exists. It is not on the live path.

Measured in `dai-nexus` at `f7f075f`:

- `.daiharness/events.log` — 237 bytes, a single `COST_UPDATE` from a test,
  last written 17 Aug.
- `.daiharness/telemetry/events-202607.jsonl` — 4 lines, every one from a test
  run, last written 31 Jul.
- `.mcp.json` registers only `dai-harness → py -3 mcp/server.py`. A grep for
  `telemetry|events.log|publish` in that file returns **0**.

So `IEventPublisher`, `FileLogEventPublisher`, `HttpWebhookEventPublisher` and
`PipelineService` all live in the **TypeScript** MCP server, which this project
never starts. The console webhook contract (`~/.daiharness-console/*`) is real
but nothing has ever POSTed to it in anger.

**Correct statement:** the *shapes* exist and are worth reusing. The live data
plane is approximately empty.

## C2 — M1 before M2 was the wrong order

The plan had M1 as "Observer, read-only, useful on day one" fed by file
tailing, with harness event work deferred to M2. Given C1, that observer would
have tailed a dead file and displayed nothing. The milestone would have shipped
and taught nothing.

**Correction:** the event *source* comes first. M0 is now the schema plus a
hook-based emitter, because Claude Code hooks are the one surface that already
fires on every turn and every tool call. M1 (the window) now has a real stream
to render the moment it is built.

## C3 — the hook chain is not free to take

`~/.claude/settings.json` on this machine points all six hook events at Orca.
The user runs Orca but does not control it. Any plan that installs user-level
hooks would have fought another tool for ownership of the editor's hook chain.

**Correction:** install at project level only. Claude Code merges user and
project hooks, so the emitter composes beside Orca rather than replacing it.
`ade install-hooks` refuses to touch the user file, and `ade doctor` reports
Orca's ownership as information, not as a problem to fix.

## C4 — a schema detail, changed while implementing

The plan specified a monotonic `seq` per run as the dedupe key. Hooks are
separate processes with no shared memory, so maintaining that counter needs a
lock on the hot path of every tool call. Replaced with a time-ordered unique
`id` per event: dedupe on `id`, ordering assigned by the store. No lock, no
race, same guarantee.

## What survived review unchanged

- Span IDs as the thing everything depends on. Confirmed by building it: the
  first tree was wrong precisely because two different lifetimes shared one
  span id.
- Files as the record, live paths as hints, dedupe making redundancy free.
- Replay and live sharing one code path.
- The differentiator: `TOOL_BLOCKED` and the evidence contract are what a
  black-box supervisor cannot show. Still true, and now the reason M2 exists.
