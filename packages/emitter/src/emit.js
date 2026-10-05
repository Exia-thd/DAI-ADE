#!/usr/bin/env node
/**
 * ade-emit — the live event source.
 *
 * Claude Code hooks are the only surface in this stack that already fires on
 * every turn and every tool call, in the process that actually runs. The
 * harness's own IEventPublisher machinery exists but is wired into a MCP server
 * that this project does not start, so its event log held one test event from
 * seven weeks ago. Hooks are therefore where a truthful stream comes from.
 *
 * Contract with the hook runner:
 *   - reads one JSON object on stdin (the hook payload)
 *   - appends one ade-event/v1 line to .dai-ade/events/<run_id>.jsonl
 *   - ALWAYS exits 0 and prints nothing on stdout
 *
 * That last point is not politeness. A hook that fails or chatters blocks or
 * corrupts the agent turn it is observing, and an observability tool that can
 * break the thing it observes will be uninstalled within a day.
 *
 * Usage (from .claude/settings.json):
 *   "command": "node /path/to/packages/emitter/src/emit.js"
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { makeEvent, shortHash, newId } = require('../../shared/src/events.js');

const ROOT_SPAN = 'sp_root';

/** Map a Claude Code hook name onto the event taxonomy. */
const HOOK_MAP = {
  SessionStart: 'RUN_STARTED',
  UserPromptSubmit: 'TURN_STARTED',
  Stop: 'TURN_ENDED',
  PreToolUse: 'TOOL_PROPOSED',
  PostToolUse: 'TOOL_EXECUTED',
  SubagentStart: 'WORKER_SPAWNED',
  SubagentStop: 'WORKER_DELIVERED',
};

function readStdin() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/**
 * Pair PreToolUse with PostToolUse without keeping state between processes.
 *
 * The two hooks run as separate invocations, so the span id has to be derivable
 * from the payload alone. Tool name plus a hash of the arguments is stable
 * across the pair and distinct between concurrent calls in the same turn, which
 * is the only case that matters — Claude Code issues parallel tool calls, but
 * never two identical ones.
 */
function toolSpanId(sessionId, toolName, toolInput) {
  const material = `${sessionId}:${toolName}:${stableStringify(toolInput)}`;
  return `sp_t_${shortHash(material, 12)}`;
}

/** JSON with sorted keys, so the same arguments always hash the same. */
function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

/** Arguments can be enormous (a whole file body); the view only needs a shape. */
function summarise(value, budget = 600) {
  if (value === undefined) return undefined;
  let text;
  try { text = JSON.stringify(value); } catch { return { unserialisable: true }; }
  if (text === undefined) return undefined;
  if (text.length <= budget) { try { return JSON.parse(text); } catch { return { raw: text }; } }
  return { truncated: true, bytes: text.length, preview: text.slice(0, budget) };
}

function classify(hook, payload) {
  const type = HOOK_MAP[hook];
  if (!type) return null;

  // A PostToolUse carrying an error is a failure, not an execution. The Flow
  // view colours these differently and the distinction is the whole reason to
  // look at the timeline, so it must not be flattened into one type.
  if (type === 'TOOL_EXECUTED') {
    const response = payload.tool_response ?? payload.tool_output ?? payload.response;
    const errored =
      (response && typeof response === 'object' && (response.is_error === true || response.error)) ||
      payload.is_error === true ||
      (typeof payload.exit_code === 'number' && payload.exit_code !== 0);
    if (errored) return 'TOOL_FAILED';
  }
  return type;
}

function build(payload) {
  const hook = payload.hook_event_name || payload.hookEventName || payload.event || '';
  const type = classify(hook, payload);
  if (!type) return null;

  const sessionId = String(payload.session_id || payload.sessionId || 'unknown-session');
  const runId = `run_${shortHash(sessionId, 10)}`;
  const toolName = payload.tool_name || payload.toolName;
  const toolInput = payload.tool_input ?? payload.toolInput;

  const isTool = type.startsWith('TOOL_');
  const isWorker = type.startsWith('WORKER_');

  let spanId;
  let parentSpanId;
  let actor;

  // A session and a turn are different lifetimes. Collapsing both onto one root
  // span made the tree say a session lasted as long as its last prompt, and
  // made "which turn did this tool call belong to" unanswerable — and several
  // turns per session is the normal case, not the edge one.
  if (type === 'RUN_STARTED') {
    spanId = ROOT_SPAN;
    parentSpanId = null;
    actor = { kind: 'root', id: sessionId };
  } else if (type === 'TURN_STARTED') {
    spanId = newTurnSpan(payload.cwd, runId);
    parentSpanId = ROOT_SPAN;
    actor = { kind: 'root', id: sessionId };
  } else if (type === 'TURN_ENDED') {
    spanId = takeTurnSpan(payload.cwd, runId) || ROOT_SPAN;
    parentSpanId = ROOT_SPAN;
    actor = { kind: 'root', id: sessionId };
  } else if (isTool) {
    spanId = toolSpanId(sessionId, toolName || 'unknown', toolInput);
    parentSpanId = currentTurnSpan(payload.cwd, runId) || ROOT_SPAN;
    actor = { kind: 'tool', id: toolName || 'unknown' };
  } else if (isWorker) {
    const workerId = String(payload.subagent_id || payload.agent_id || payload.agent_type || newId().slice(0, 8));
    spanId = `sp_w_${shortHash(`${sessionId}:${workerId}`, 12)}`;
    parentSpanId = currentTurnSpan(payload.cwd, runId) || ROOT_SPAN;
    actor = { kind: 'worker', id: workerId };
    if (payload.agent_type) actor.tier = String(payload.agent_type);
  } else {
    spanId = ROOT_SPAN;
    parentSpanId = null;
    actor = { kind: 'root', id: sessionId };
  }

  const payloadOut = { hook };
  if (toolName) payloadOut.tool = toolName;
  if (toolInput !== undefined) payloadOut.input = summarise(toolInput);
  const response = payload.tool_response ?? payload.tool_output ?? payload.response;
  if (response !== undefined) payloadOut.response = summarise(response, 400);
  if (payload.cwd) payloadOut.cwd = String(payload.cwd);
  if (payload.prompt) payloadOut.prompt = summarise(payload.prompt, 300);

  return makeEvent({ type, run_id: runId, span_id: spanId, parent_span_id: parentSpanId, actor, payload: payloadOut });
}

/** Where the stream lives. Per project, beside the code it describes. */
function eventsDir(cwd) {
  return path.join(cwd || process.cwd(), '.dai-ade', 'events');
}

/**
 * The open turn, held in a pointer file.
 *
 * Hooks are separate processes, so "which turn is this tool call part of" has
 * nowhere else to live. A tool span id can be derived from its own arguments;
 * a turn cannot, because nothing in a PreToolUse payload mentions the prompt
 * that started it. One small file read on the hot path buys the parent link
 * that makes the Flow view a tree instead of a flat list.
 */
function turnPointer(cwd, runId) {
  return path.join(eventsDir(cwd), `${runId}.turn`);
}

function newTurnSpan(cwd, runId) {
  const span = `sp_turn_${newId().slice(-10)}`;
  try {
    fs.mkdirSync(eventsDir(cwd), { recursive: true });
    fs.writeFileSync(turnPointer(cwd, runId), span);
  } catch { /* the event is still well-formed without the pointer */ }
  return span;
}

function currentTurnSpan(cwd, runId) {
  try {
    const span = fs.readFileSync(turnPointer(cwd, runId), 'utf8').trim();
    return span || null;
  } catch {
    return null;
  }
}

/** Read and clear: a turn ends once. */
function takeTurnSpan(cwd, runId) {
  const span = currentTurnSpan(cwd, runId);
  try { fs.unlinkSync(turnPointer(cwd, runId)); } catch { /* already gone */ }
  return span;
}

function append(event, cwd) {
  const dir = eventsDir(cwd);
  fs.mkdirSync(dir, { recursive: true });
  // One line, one syscall. Short appends in O_APPEND mode do not interleave in
  // practice, which is what keeps parallel tool-call hooks from corrupting each
  // other's lines. The tailer still handles a torn line defensively.
  fs.appendFileSync(path.join(dir, `${event.run_id}.jsonl`), JSON.stringify(event) + '\n');
}

function main() {
  const payload = readStdin();
  let event;
  try {
    event = build(payload);
  } catch {
    return; // a malformed payload must never break the turn
  }
  if (!event) return;
  try {
    append(event, payload.cwd);
  } catch {
    // Disk full, permissions, a race on mkdir — none of these are worth
    // failing an agent turn over.
  }
}

if (require.main === module) {
  main();
  process.exit(0);
}

module.exports = { build, classify, toolSpanId, stableStringify, summarise, eventsDir, turnPointer, HOOK_MAP };
