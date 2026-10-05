/**
 * The control plane: the only place this tool writes.
 *
 * Every test here pins a defect that was found by actually driving a harness
 * rather than by reading the code. The button in the window could not have
 * worked, and nothing would have said so until someone pressed it on a real
 * gate — which is the worst possible moment to discover it.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const mcp = require('../packages/shell/src/mcp/client.js');
const bridge = require('../packages/shell/src/ingest/harnessBridge.js');
const { validateEvent } = require('../packages/shared/src/events.js');

function project(servers) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dai-ade-ctl-'));
  if (servers !== undefined) {
    fs.writeFileSync(path.join(dir, '.mcp.json'), JSON.stringify({ mcpServers: servers }, null, 2));
  }
  return dir;
}

/** A stand-in MCP server: speaks the protocol, records what it was asked. */
function fakeServer(dir, behaviour = 'echo') {
  const file = path.join(dir, 'fake-server.js');
  fs.writeFileSync(file, `
    'use strict';
    let buf = '';
    process.stdin.on('data', (c) => { buf += c; });
    process.stdin.on('end', () => {
      for (const line of buf.split('\\n')) {
        if (!line.trim()) continue;
        const msg = JSON.parse(line);
        if (msg.method === 'initialize') {
          process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { ok: true } }) + '\\n');
        } else if (msg.method === 'tools/call') {
          const payload = ${behaviour === 'error'
            ? "{ error: 'refused' }"
            : "{ tool: msg.params.name, args: msg.params.arguments }"};
          process.stdout.write(JSON.stringify({
            jsonrpc: '2.0', id: msg.id,
            result: { content: [{ type: 'text', text: JSON.stringify(payload) }] },
          }) + '\\n');
        }
      }
      process.exit(0);
    });
  `);
  return file;
}

test('a gate decision sends the gate name and the verdict', async () => {
  const dir = project();
  const server = fakeServer(dir);
  fs.writeFileSync(path.join(dir, '.mcp.json'),
    JSON.stringify({ mcpServers: { 'dai-harness': { command: process.execPath, args: [server] } } }));

  // The real tool requires { gate, approved }. Sending neither returned
  // "gate '' was never requested", so the button could never have worked.
  const approved = await mcp.harness.decideGate(dir, 'gate1_brd', true);
  assert.equal(approved.tool, 'dh_approve_gate');
  assert.deepEqual(approved.args, { gate: 'gate1_brd', approved: true });

  const rejected = await mcp.harness.decideGate(dir, 'gate1_brd', false);
  assert.equal(rejected.args.approved, false, 'a gate you can only approve is not a gate');
});

test('deciding with no gate pending fails before spawning anything', async () => {
  const dir = project({ 'dai-harness': { command: 'definitely-not-a-real-binary' } });
  await assert.rejects(() => mcp.harness.decideGate(dir, '', true), /nothing is waiting/);
});

test('a missing server is reported, not hung on', async () => {
  const dir = project({});
  await assert.rejects(() => mcp.harness.state(dir), /no MCP server/);
});

test('the client reads the project’s own .mcp.json, BOM and all', () => {
  const dir = project();
  fs.writeFileSync(path.join(dir, '.mcp.json'),
    '﻿' + JSON.stringify({ mcpServers: { 'dai-harness': { command: 'py', args: ['-3', 'x.py'] } } }));
  // PowerShell writes a BOM by default and some other tool may have made this
  // file; refusing to parse it would be correct and useless.
  const server = mcp.describe(dir, 'dai-harness');
  assert.ok(server, 'a BOM must not make the config unreadable');
  assert.equal(server.command, 'py');
});

test('a server error surfaces as a rejection with its message', async () => {
  const dir = project();
  const server = fakeServer(dir, 'error');
  fs.writeFileSync(path.join(dir, '.mcp.json'),
    JSON.stringify({ mcpServers: { 'dai-harness': { command: process.execPath, args: [server] } } }));
  const out = await mcp.callTool(dir, 'dai-harness', 'dh_get_state', {});
  assert.equal(out.error, 'refused', 'a tool-level error is data, not a crash');
});

test('one waiting gate is one event, however often the bridge runs', () => {
  const dir = project();
  fs.mkdirSync(path.join(dir, '.daiharness'), { recursive: true });
  const state = {
    goal: 'g', mode: 'FULL_BUILD', status: 'blocked_on_gate', phase_index: 0,
    phases: [{ key: 'interpret', status: 'running' }],
    pending_gate: 'gate1_brd',
    // The harness records a requested gate in BOTH places at once. Emitting
    // from both reported one waiting gate as two, and the pending event's id
    // used to include the file mtime, minting a fresh duplicate per write.
    gates: { gate1_brd: { approved: false, summary: 'ready', ts: 1791216796.2 } },
  };
  fs.writeFileSync(path.join(dir, '.daiharness', 'pipeline-state.json'), JSON.stringify(state));

  const first = bridge.fromPipeline(dir, { runId: 'r', parent: null }).filter((e) => e.type.startsWith('GATE'));
  assert.equal(first.length, 1, 'one gate, one event');

  // Touch the file the way the harness would, then read again.
  fs.writeFileSync(path.join(dir, '.daiharness', 'pipeline-state.json'), JSON.stringify({ ...state }));
  const second = bridge.fromPipeline(dir, { runId: 'r', parent: null }).filter((e) => e.type.startsWith('GATE'));
  assert.equal(second.length, 1);
  assert.equal(first[0].id, second[0].id, 'the id must survive a rewrite of the state file');
});

test('a decision recorded by this tool lands on the gate’s own span', () => {
  const dir = project();
  const { makeEvent } = require('../packages/shared/src/events.js');
  fs.mkdirSync(path.join(dir, '.daiharness'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.daiharness', 'pipeline-state.json'), JSON.stringify({
    phases: [], pending_gate: 'gate2_arch', gates: {},
  }));

  const ctx = bridge.correlate(dir);
  const request = bridge.fromPipeline(dir, ctx).find((e) => e.type === 'GATE_REQUESTED');
  const decision = makeEvent({
    type: 'GATE_REJECTED', run_id: ctx.runId, span_id: bridge.gateSpanId('gate2_arch'),
    parent_span_id: ctx.parent, actor: { kind: 'root', id: 'ade' },
    payload: { source: 'ade.decision', gate: 'gate2_arch', approved: false },
  });

  assert.ok(validateEvent(decision).ok);
  assert.equal(decision.span_id, request.span_id,
    'a decision must close the request it answers, not open a span of its own');

  const written = bridge.appendEvents(dir, ctx.runId, [decision]);
  assert.equal(written, 1);
  assert.equal(bridge.appendEvents(dir, ctx.runId, [decision]), 0, 'and writing it twice is free');
});
