/**
 * ade-event/v1 — the wire format every DAI ADE surface speaks.
 *
 * Correlation is the whole point. `span_id` / `parent_span_id` is what turns a
 * flat log into a spawn tree and a flow timeline; without it there is no Flow
 * view and no Roster, only a log viewer. Everything else here is negotiable.
 *
 * Deliberate deviation from the first plan: the plan specified a monotonic
 * `seq` per run as the dedupe key. Hooks are separate process invocations with
 * no shared memory, so a cross-process counter would need a lock on the hot
 * path of every tool call. Instead each event carries a time-ordered unique
 * `id`, dedupe is on `id`, and ordering is assigned by the store on insert.
 * No lock, no race, same guarantees.
 *
 * Plain JS with hand-written validation rather than zod: the emitter runs
 * inside a Claude Code hook on every single tool call, so its startup cost is
 * paid constantly. Zero dependencies keeps that near node's own floor.
 */

'use strict';

const SCHEMA_VERSION = 1;

/** The actor a span belongs to. `root` is the main session. */
const ACTOR_KINDS = ['root', 'worker', 'expert', 'tool'];

/**
 * Event taxonomy. Grouped by what they let a view draw:
 *   run/turn  -> the timeline's spine
 *   phase/gate-> the bands and the stop bars
 *   worker    -> the spawn tree and the roster
 *   tool      -> the ticks on a lane; TOOL_BLOCKED is the one no other ADE has
 *   evidence  -> whether "done" was ever actually verified
 */
const EVENT_TYPES = [
  'RUN_STARTED', 'RUN_ENDED',
  'TURN_STARTED', 'TURN_ENDED',
  'PHASE_ENTERED', 'PHASE_EXITED',
  'GATE_REQUESTED', 'GATE_APPROVED', 'GATE_REJECTED',
  'WORKER_SPAWNED', 'WORKER_CONTRACT', 'WORKER_DELIVERED', 'WORKER_MERGED', 'WORKER_FAILED',
  'TOOL_PROPOSED', 'TOOL_BLOCKED', 'TOOL_EXECUTED', 'TOOL_FAILED',
  'ESCALATION_REQUESTED', 'ESCALATION_RESULT',
  'EVIDENCE_WRITTEN', 'VERIFY_PASSED', 'VERIFY_FAILED',
  'MEMORY_WRITE', 'MEMORY_SEARCH',
  'COST_UPDATE',
  'RULE_VIOLATION',
];

const EVENT_TYPE_SET = new Set(EVENT_TYPES);
const ACTOR_KIND_SET = new Set(ACTOR_KINDS);

/** Crockford base32, so an id is sortable as a plain string. */
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

let lastMs = 0;
let lastRand = null;

/**
 * A ULID-shaped identifier: 10 chars of timestamp, 16 of randomness.
 * Monotonic within a process; across processes the timestamp still orders
 * events to the millisecond, which is finer than anything a view renders.
 */
function newId(now = Date.now(), random = Math.random) {
  let ms = now;
  if (ms === lastMs && lastRand) {
    // Same millisecond: increment the random part so ids stay strictly
    // increasing rather than ties sorting arbitrarily.
    for (let i = lastRand.length - 1; i >= 0; i--) {
      if (lastRand[i] < 31) { lastRand[i]++; break; }
      lastRand[i] = 0;
    }
  } else {
    lastMs = ms;
    lastRand = new Array(16);
    for (let i = 0; i < 16; i++) lastRand[i] = Math.floor(random() * 32);
  }
  let time = '';
  let t = ms;
  for (let i = 9; i >= 0; i--) { time = B32[t % 32] + time; t = Math.floor(t / 32); }
  let rand = '';
  for (let i = 0; i < 16; i++) rand += B32[lastRand[i]];
  return time + rand;
}

/** A short stable id derived from a string — used to turn a session id into a run id. */
function shortHash(input, length = 10) {
  // FNV-1a, 32-bit. Not cryptographic; it only has to avoid collisions between
  // a handful of concurrent sessions on one machine.
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  let out = '';
  let v = h;
  while (out.length < length) { out = B32[v % 32] + out; v = Math.floor(v / 32) || (v = h ^ out.length); }
  return out.slice(0, length);
}

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Validate an event. Returns { ok: true, event } or { ok: false, errors }.
 *
 * Rejecting loudly at the boundary matters more here than it looks: a
 * half-valid event renders as half a span, and a timeline with a span that has
 * no end is indistinguishable from work that is still running.
 */
function validateEvent(raw) {
  const errors = [];
  if (!isPlainObject(raw)) return { ok: false, errors: ['event must be an object'] };

  if (raw.v !== SCHEMA_VERSION) errors.push(`v must be ${SCHEMA_VERSION}, got ${JSON.stringify(raw.v)}`);
  for (const key of ['id', 'ts', 'run_id', 'span_id', 'type']) {
    if (typeof raw[key] !== 'string' || !raw[key]) errors.push(`${key} must be a non-empty string`);
  }
  if (typeof raw.ts === 'string' && Number.isNaN(Date.parse(raw.ts))) {
    errors.push('ts must parse as a date');
  }
  if (raw.parent_span_id !== null && typeof raw.parent_span_id !== 'string') {
    errors.push('parent_span_id must be a string or null');
  }
  if (typeof raw.type === 'string' && !EVENT_TYPE_SET.has(raw.type)) {
    errors.push(`unknown event type ${JSON.stringify(raw.type)}`);
  }
  if (!isPlainObject(raw.actor)) {
    errors.push('actor must be an object');
  } else {
    if (!ACTOR_KIND_SET.has(raw.actor.kind)) errors.push(`actor.kind must be one of ${ACTOR_KINDS.join('|')}`);
    if (typeof raw.actor.id !== 'string' || !raw.actor.id) errors.push('actor.id must be a non-empty string');
  }
  if (raw.payload !== undefined && !isPlainObject(raw.payload)) {
    errors.push('payload must be an object when present');
  }
  return errors.length ? { ok: false, errors } : { ok: true, event: raw };
}

/** Build a well-formed event. Throws if the result would not validate. */
function makeEvent({ type, run_id, span_id, parent_span_id = null, actor, payload = {}, ts, id }) {
  const event = {
    v: SCHEMA_VERSION,
    id: id || newId(),
    ts: ts || new Date().toISOString(),
    run_id,
    span_id,
    parent_span_id,
    actor,
    type,
    payload,
  };
  const result = validateEvent(event);
  if (!result.ok) throw new Error(`invalid ade-event: ${result.errors.join('; ')}`);
  return event;
}

module.exports = {
  SCHEMA_VERSION,
  EVENT_TYPES,
  ACTOR_KINDS,
  newId,
  shortHash,
  validateEvent,
  makeEvent,
};
