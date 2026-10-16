/**
 * What a session is carrying.
 *
 * The panel these back is the one most likely to be believed without checking,
 * because a number next to a label looks like a fact. So each test pins the
 * thing that keeps it a fact: the measurement is of something real, the source
 * is carried with the number, and the one figure this tool cannot know is
 * never invented.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const inventory = require('../packages/shell/src/session/inventory.js');
const { makeEvent } = require('../packages/shared/src/events.js');

function project(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ade-${name}-`));
  const write = (relative, text) => {
    const full = path.join(dir, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text);
  };
  return { dir, write };
}

test('it measures what is on disk, and says what it read', () => {
  const { dir, write } = project('inv');
  write('.claude/skills/review/SKILL.md', 'x'.repeat(400));
  write('.claude/skills/ship.md', 'y'.repeat(400));
  write('.claude/commands/verify.md', 'z'.repeat(200));
  write('CLAUDE.md', 'w'.repeat(800));

  const byId = Object.fromEntries(inventory.measure(dir).map((p) => [p.id, p]));

  assert.equal(byId.skills.files, 2, 'nested skill files are found');
  assert.equal(byId.skills.bytes, 800);
  assert.equal(byId.skills.tokens, 200, 'bytes divided by the stated divisor');
  assert.match(byId.skills.source, /\.claude\/skills/);

  assert.equal(byId.commands.files, 1);
  assert.equal(byId['claude-md'].bytes, 800);
  // Every part has to carry where it came from: a number whose origin is not
  // stated cannot be checked by the person reading it.
  for (const part of Object.values(byId)) assert.ok(part.source, part.id);
});

test('a part with nothing in it is left out rather than shown as zero', () => {
  const { dir } = project('empty');
  assert.deepEqual(inventory.measure(dir), []);
});

test('node_modules is not part of what a session carries', () => {
  const { dir, write } = project('nm');
  write('.claude/skills/real.md', 'a'.repeat(100));
  write('.claude/skills/node_modules/pkg/readme.md', 'b'.repeat(100000));
  const skills = inventory.measure(dir).find((p) => p.id === 'skills');
  assert.equal(skills.files, 1);
  assert.equal(skills.bytes, 100);
});

test('MCP tool definitions are measured from what a server answered', () => {
  const { dir } = project('mcp');
  const parts = inventory.measure(dir, {
    mcpServers: [
      { name: 'notes', check: { ok: true, tools: [{ name: 'a', description: 'x' }, { name: 'b' }] } },
      { name: 'broken', check: { ok: false, tools: null } },
      { name: 'remote', check: { ok: null, tools: null } },
    ],
  });
  const tools = parts.find((p) => p.id === 'mcp-tools');
  assert.equal(tools.files, 2, 'only the server that answered is counted');
  assert.match(tools.source, /1 server/);
  assert.ok(tools.bytes > 0);
});

test('the reported context comes from the session, and is absent when it did not report', () => {
  const none = inventory.reported([{ kind: 'root', id: 's', contextTokens: null, tokens: null }]);
  assert.equal(none, null, 'nothing is invented when nothing was reported');

  const some = inventory.reported([
    { kind: 'root', id: 'small', contextTokens: 9_000, tokens: 100, model: 'm' },
    { kind: 'root', id: 'big', contextTokens: 42_000, tokens: 700, model: 'm' },
    { kind: 'root', id: 'silent', contextTokens: null, tokens: null },
    { kind: 'worker', id: 'w', contextTokens: 99_000, tokens: 10 },
  ]);
  assert.equal(some.largest.id, 'big');
  assert.equal(some.largest.contextTokens, 42_000, 'a worker is not a session');
  assert.equal(some.sessions, 3);
  assert.equal(some.measured, 2, 'the silent one is counted but not measured');
  assert.equal(some.totalOutput, 800);
});

test('outputs are the files the tools actually wrote, newest first', () => {
  const at = (s) => `2026-10-16T09:0${s}:00.000Z`;
  const events = [
    { type: 'TOOL_EXECUTED', ts: at(1), payload: { tool: 'Read', input: { file_path: 'a.ts' } } },
    { type: 'TOOL_EXECUTED', ts: at(2), payload: { tool: 'Write', input: { file_path: 'src/new.ts' } } },
    { type: 'TOOL_EXECUTED', ts: at(3), payload: { tool: 'Edit', input: { file_path: 'src/old.ts' } } },
    { type: 'TOOL_EXECUTED', ts: at(4), payload: { tool: 'Edit', input: { file_path: 'src/old.ts' } } },
    { type: 'TOOL_FAILED', ts: at(5), payload: { tool: 'Edit', input: { file_path: 'src/bad.ts' } } },
  ].map((e) => makeEvent({ run_id: 'r', span_id: 's', parent_span_id: null,
    actor: { kind: 'tool', id: e.payload.tool }, ...e }));

  const out = inventory.outputs(events);
  assert.deepEqual(out.map((o) => o.file), ['src/bad.ts', 'src/old.ts', 'src/new.ts']);
  assert.ok(!out.some((o) => o.file === 'a.ts'), 'reading a file is not writing it');

  const old = out.find((o) => o.file === 'src/old.ts');
  assert.equal(old.writes, 2, 'two edits to one file is one entry, counted twice');
  assert.equal(old.at, at(4), 'the entry carries the most recent touch');

  const bad = out.find((o) => o.file === 'src/bad.ts');
  assert.equal(bad.failed, 1, 'a failed write is still recorded, and marked');
});

test('a tool call with no file is not an output', () => {
  const events = [makeEvent({
    type: 'TOOL_EXECUTED', run_id: 'r', span_id: 's', parent_span_id: null,
    actor: { kind: 'tool', id: 'Write' }, payload: { tool: 'Write', input: { content: 'x' } },
  })];
  assert.deepEqual(inventory.outputs(events), []);
});
