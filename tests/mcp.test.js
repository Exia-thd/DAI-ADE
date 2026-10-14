/**
 * MCP: what is declared, what actually answers, and what an agent may reach.
 *
 * The third one is the reason this exists. A panel that lists servers is a
 * nicety; deciding what a launched agent can touch — without editing anyone's
 * configuration to do it — is the thing a person running several agents at once
 * actually needs.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const registry = require('../packages/shell/src/mcp/registry.js');
const runners = require('../packages/shell/src/agent/runners.js');

const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `ade-${name}-`));

/** A real MCP server, small enough to read, honest enough to answer. */
function stubServer(dir) {
  const file = path.join(dir, 'server.js');
  const lines = [
    "const readline = require('readline');",
    'const rl = readline.createInterface({ input: process.stdin });',
    "const send = (m) => process.stdout.write(JSON.stringify(m) + '\\n');",
    "rl.on('line', (line) => {",
    '  let req; try { req = JSON.parse(line); } catch { return; }',
    "  if (req.method === 'initialize') {",
    "    send({ jsonrpc: '2.0', id: req.id, result: { protocolVersion: '2024-11-05',",
    "      capabilities: { tools: {} }, serverInfo: { name: 'stub', version: '1' } } });",
    '  }',
    "  if (req.method === 'tools/list') {",
    "    send({ jsonrpc: '2.0', id: req.id, result: { tools: [",
    "      { name: 'ping', description: 'Replies with pong' },",
    "      { name: 'echo', description: 'Echoes a string' }] } });",
    '  }',
    '});',
  ];
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
  return file;
}

test('servers are found in the project, the person, and this project only', () => {
  const project = tmp('mcp-scope');
  fs.writeFileSync(path.join(project, '.mcp.json'), JSON.stringify({
    mcpServers: { harness: { command: 'node', args: ['harness.js'] } },
  }));

  const found = registry.discover(project);
  const harness = found.find((s) => s.name === 'harness');
  assert.equal(harness.scope, 'project');
  assert.equal(harness.transport, 'stdio', 'a command means stdio');
  assert.ok(harness.source.endsWith('.mcp.json'), 'where it came from is part of the answer');
});

test('a URL is an http server even when nothing says so', () => {
  const project = tmp('mcp-http');
  fs.writeFileSync(path.join(project, '.mcp.json'), JSON.stringify({
    mcpServers: {
      typed: { type: 'sse', url: 'https://example.invalid/sse' },
      untyped: { url: 'https://example.invalid/mcp' },
    },
  }));
  const byName = Object.fromEntries(registry.discover(project).map((s) => [s.name, s]));
  assert.equal(byName.typed.transport, 'sse');
  assert.equal(byName.untyped.transport, 'http');
});

test('a BOM does not hide a project\'s servers', () => {
  // Written by another tool often enough to be worth tolerating rather than
  // failing on, which is what a strict parser would do.
  const project = tmp('mcp-bom');
  fs.writeFileSync(path.join(project, '.mcp.json'),
    `\uFEFF${JSON.stringify({ mcpServers: { a: { command: 'node' } } })}`);
  assert.equal(registry.discover(project).length, 1);
});

test('checking a server means connecting to it, not reading the config', async () => {
  const dir = tmp('mcp-probe');
  const server = stubServer(dir);

  const result = await registry.probe({
    name: 'stub', transport: 'stdio', command: process.execPath, args: [server], env: {},
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.tools.map((t) => t.name), ['ping', 'echo']);
  assert.equal(result.tools[0].description, 'Replies with pong');
});

test('a server that cannot start says why, in one readable line', async () => {
  const result = await registry.probe({
    name: 'broken', transport: 'stdio', command: process.execPath,
    args: [path.join(os.tmpdir(), 'ade-no-such-server.js')], env: {},
  });
  assert.equal(result.ok, false);
  // The tail of the output was the end of a stack trace - "at
  // node:internal/modules/run_main:33:47" - which tells a reader nothing.
  assert.match(result.reason, /Cannot find module/);
  assert.ok(!/^\s*at /.test(result.reason), result.reason);
});

test('a server that never answers is reported, not waited on forever', async () => {
  const dir = tmp('mcp-silent');
  const file = path.join(dir, 'silent.js');
  fs.writeFileSync(file, 'setTimeout(() => {}, 60000);\n');
  const result = await registry.probe(
    { name: 'silent', transport: 'stdio', command: process.execPath, args: [file], env: {} },
    { timeoutMs: 700 },
  );
  assert.equal(result.ok, false);
  assert.match(result.reason, /no response/);
});

test('an http server is reported as unchecked, never as working', async () => {
  const result = await registry.probe({ name: 'remote', transport: 'http', url: 'https://example.invalid/mcp' });
  // null, not false: this has not asked it. Claiming either way would be
  // invention, and the panel colours unchecked differently from broken.
  assert.equal(result.ok, null);
  assert.match(result.reason, /not checked/);
  assert.equal(result.tools, null);
});

test('a selection is enforced with our own file, never by editing theirs', () => {
  const project = tmp('mcp-select');
  const original = JSON.stringify({
    mcpServers: { keep: { command: 'node', args: ['a.js'] }, drop: { command: 'node', args: ['b.js'] } },
  }, null, 2);
  fs.writeFileSync(path.join(project, '.mcp.json'), original);

  const servers = registry.discover(project);
  const out = tmp('mcp-out');
  const file = registry.writeSelection(servers.filter((s) => s.name === 'keep'), out);

  const written = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(Object.keys(written.mcpServers), ['keep']);
  assert.deepEqual(written.mcpServers.keep, { command: 'node', args: ['a.js'] },
    'handed over unchanged');
  assert.equal(fs.readFileSync(path.join(project, '.mcp.json'), 'utf8'), original,
    "the project's own file is not touched by a selection");
});

test('the selection reaches the agent as flags, and only when there is one', () => {
  // Measured before any of this was written: --mcp-config with
  // --strict-mcp-config gave a session exactly the servers in that file, and
  // the session's first record reported each one's connection status.
  const claude = runners.get(null, 'claude-code');

  const without = runners.buildArgs(claude, { model: 'default', session: 'S', permissionMode: 'acceptEdits' });
  assert.ok(!without.includes('--mcp-config'), 'no selection means no flags, so nothing is overridden');

  const with_ = runners.buildArgs(claude, {
    model: 'default', session: 'S', permissionMode: 'acceptEdits', mcpConfig: 'C:/sel.json',
  });
  assert.ok(with_.includes('--mcp-config') && with_.includes('C:/sel.json'));
  assert.ok(with_.includes('--strict-mcp-config'),
    'without strict, the selection would be added to their servers rather than replacing them');
});

test('a runner that cannot take an MCP config is not given one', () => {
  const codex = runners.get(null, 'codex');
  assert.deepEqual(codex.mcpArgs, [], 'nothing is invented for a runner this project has not run');
  const args = runners.buildArgs(codex, { model: 'default', mcpConfig: 'C:/sel.json' });
  assert.ok(!args.includes('C:/sel.json'));
});

test('a server is added to and removed from the project, and only the project', () => {
  const project = tmp('mcp-write');
  registry.addToProject(project, 'harness', { command: 'py', args: ['-3', 'mcp.py'] });
  let parsed = JSON.parse(fs.readFileSync(path.join(project, '.mcp.json'), 'utf8'));
  assert.deepEqual(parsed.mcpServers.harness.args, ['-3', 'mcp.py']);

  const missing = registry.removeFromProject(project, 'not-there');
  assert.equal(missing.ok, false);
  assert.match(missing.error, /not declared/);

  assert.equal(registry.removeFromProject(project, 'harness').ok, true);
  parsed = JSON.parse(fs.readFileSync(path.join(project, '.mcp.json'), 'utf8'));
  assert.deepEqual(parsed.mcpServers, {});
});
