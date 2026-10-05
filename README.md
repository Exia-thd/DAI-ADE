# DAI ADE

An Agent Development Environment for the **DAI Harness** — a glass box around
agents whose internals you own.

Not a general agent supervisor. [Orca](https://www.onorca.dev/) already does
that well, and it drives agents as black boxes because that is all a third-party
CLI exposes. This one goes the other way: it goes deep on one harness and one
memory layer, where both ends are yours, and shows the thing a black-box
supervisor structurally cannot — **the decision trail, not just the output**.

Status: **M0 complete** — the ingestion path is built and proven. No window yet;
see [Milestones](#milestones).

---

## What works today

```bash
node packages/shell/src/cli.js doctor          # what is wired up
node packages/shell/src/cli.js install-hooks   # install the emitter in THIS project
node packages/shell/src/cli.js tail            # follow the live stream
node packages/shell/src/cli.js runs            # one line per run
node packages/shell/src/cli.js tree            # the spawn tree
```

`tree` on a two-turn session:

```
run_3D0P2N3D0G
  ○ root:s2 RUN_STARTED —
    ✔ root:s2 TURN_STARTED 453ms
      ✔ tool:Read TOOL_PROPOSED 158ms
    ✔ root:s2 TURN_STARTED 721ms
      ✔ worker:sub-9 WORKER_SPAWNED 440ms
      ✖ tool:Bash TOOL_PROPOSED 141ms
```

Session → turns → the tools and sub-agents each turn actually spawned, with
durations, and failures marked. That tree is the data the Flow view will draw.

---

## Why the events come from hooks

The first version of the plan assumed the harness already emitted a usable
stream and that a read-only observer could be built against it. **That was
wrong, and checking it was the first thing this repo did.**

What the harness actually writes in `dai-nexus`, measured:

| Surface | Reality |
|---|---|
| `.daiharness/events.log` | **237 bytes** — one `COST_UPDATE` from a test, last written seven weeks ago |
| `.daiharness/telemetry/events-*.jsonl` | **4 lines**, all from test runs, last written two months ago |
| `.daiharness/verify/*.json` | 31 records — the only live surface, but end-of-turn only, not a flow |

The `IEventPublisher` machinery — `FileLogEventPublisher`,
`HttpWebhookEventPublisher`, `CombinedEventPublisher`, `PipelineService` — is
real code, but it lives in the **TypeScript** MCP server. The project's
`.mcp.json` starts `py -3 mcp/server.py`, the **Python** one, which emits
nothing. The nice architecture is not on the live path.

**Claude Code hooks are.** They already fire on every session, every prompt,
every tool call and every sub-agent, in the process that actually runs. So the
emitter is a hook, and an observer built on it has something to observe on day
one.

### Hooks compose; they are not owned

On this machine `~/.claude/settings.json` points every hook at Orca
(`~/.orca/agent-hooks/claude-hook.cmd`). Claude Code merges user-level and
project-level hooks, so **`ade install-hooks` writes only to the project's
`.claude/settings.json`** and never touches the user file. Orca keeps its chain;
this adds a second listener beside it. Clobbering another tool's hooks to
install your own observability is how you break the editor you were trying to
watch.

---

## Architecture

```
hooks ──► ade-emit ──► .dai-ade/events/<run>.jsonl ──► tailer ──► RunIndex ──► views
                                                          ▲
                      harness / memory MCP ───────────────┘  (M3: control + query)
```

Three properties worth keeping:

- **Files are the record.** Live paths (webhook, MCP) are latency hints; the
  JSONL is the truth. Dedupe is on event `id`, so the same event arriving twice
  is free. A run that happened while the ADE was closed replays identically.
- **Replay and live share one code path.** The renderer is a pure function of
  `RunIndex`, so "scrub back through a finished run" is not a second
  implementation — it falls out.
- **The emitter cannot break the turn.** It reads stdin, appends one line,
  always exits 0, never writes to stdout. An observability tool that can break
  the thing it observes gets uninstalled in a day.

---

## Milestones

| | | |
|---|---|---|
| **M0** | Event schema, hook emitter, tailer, run index, CLI | **done** — 11 tests |
| **M1** | Electron window: Flow timeline, Roster, Inspector (read-only) | next |
| **M2** | Harness-side events: `TOOL_BLOCKED` from `policy_check.py`, `WORKER_*` from `worktree_manager.py`, `EVIDENCE_WRITTEN` from `run_check.py` | |
| **M3** | Control plane: gate approve/reject over MCP, webhook listener | |
| **M4** | Worktrees + diff review with batched line comments | |
| **M5** | Terminal (node-pty + xterm.js) | |
| **M6** | Memory lens (`dai_memory_why` on the open file) + replay scrubbing | |

M2 is where `TOOL_BLOCKED` becomes real. Hooks see a tool call proposed and
executed; only the harness's own guardrail knows a call was *refused* and which
deny pattern matched. That event is the one no black-box supervisor can show,
so it is worth the harness-side work.

---

## Testing

```bash
npm test
```

Every test pins a failure that would otherwise look like "the timeline is
sometimes missing things" — the worst bug class for an observability tool,
because it is indistinguishable from the system under observation being quiet.

Covered: torn lines across a poll boundary, 500 interleaved appends arriving
once and in order, truncation, malformed lines reported rather than skipped,
cross-path dedupe, span pairing and durations, hook→taxonomy mapping,
Pre/Post pairing into one span, hostile input, oversized arguments, id
ordering, and turn nesting.

---

## Licence

MIT. Copyright (c) 2026 Dat Tran Huu.
