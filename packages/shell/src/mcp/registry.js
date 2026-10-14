/**
 * The MCP servers in play, and which ones an agent is allowed to see.
 *
 * Two jobs, and they are different. The first is honest enumeration: a server
 * can be declared in the project, by the person, or for one project only, and
 * until now the window showed none of them even though this tool has been
 * speaking MCP to the harness all along.
 *
 * The second is control, and it is the reason this is worth building. Measured
 * here before it was written: `--mcp-config <file> --strict-mcp-config` gives a
 * launched agent exactly the servers in that file and nothing else — the
 * session's own first record came back `mcp_servers: [{name, status}]` with the
 * tools exposed as `mcp__<server>__<tool>`. So the window can decide what an
 * agent may reach by writing a file of its own, and never by editing the
 * person's configuration. A tool that quietly rewrote your MCP config to
 * control a run would be the opposite of the point.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const PROBE_TIMEOUT_MS = 8_000;

/**
 * Every server this project could be using, with where it was declared.
 *
 * Project scope first: a project's own `.mcp.json` is the file the agent obeys
 * and the one a team shares, so a name declared there wins.
 */
function discover(project) {
  const byName = new Map();

  for (const [name, server] of Object.entries(readProjectFile(project))) {
    byName.set(name, shape(name, server, 'project', path.join(project, '.mcp.json')));
  }

  const home = path.join(os.homedir(), '.claude.json');
  const claudeJson = readJson(home);

  // Declared for one project only. Claude Code keys these by the project path,
  // so a different checkout of the same repository has its own set.
  if (project && claudeJson.projects) {
    const entry = claudeJson.projects[project] || claudeJson.projects[path.resolve(project)];
    for (const [name, server] of Object.entries((entry && entry.mcpServers) || {})) {
      if (!byName.has(name)) byName.set(name, shape(name, server, 'local', home));
    }
  }

  for (const [name, server] of Object.entries(claudeJson.mcpServers || {})) {
    if (!byName.has(name)) byName.set(name, shape(name, server, 'user', home));
  }

  return [...byName.values()];
}

function readProjectFile(project) {
  if (!project) return {};
  const parsed = readJson(path.join(project, '.mcp.json'));
  return parsed.mcpServers || {};
}

function readJson(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return {}; }
  // A BOM makes this invalid JSON for a strict parser; tolerate one rather than
  // refuse to work with a file some other tool wrote.
  try { return JSON.parse(text.replace(/^﻿/, '')); } catch { return {}; }
}

/** One server definition, normalised, with its transport named. */
function shape(name, server, scope, source) {
  const declared = String(server.type || '').toLowerCase();
  const transport = declared === 'http' || declared === 'sse'
    ? declared
    : (server.url ? 'http' : 'stdio');
  return {
    name,
    scope,
    source,
    transport,
    command: server.command || null,
    args: Array.isArray(server.args) ? server.args : [],
    env: server.env && typeof server.env === 'object' ? server.env : {},
    url: server.url || null,
    // What the agent would be handed, unchanged.
    definition: server,
  };
}

/**
 * Connect to a stdio server and ask what it can do.
 *
 * A real handshake, not a guess from the config: the point of a panel like this
 * is to answer "is this thing actually working", and a green dot derived from
 * the presence of a line in a JSON file answers nothing.
 */
function probe(server, { timeoutMs = PROBE_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    if (server.transport !== 'stdio' || !server.command) {
      // Said rather than faked. An HTTP server may well be fine; this just has
      // not asked it, and claiming otherwise either way would be invention.
      resolve({ ok: null, reason: `${server.transport} servers are not checked from here`, tools: null });
      return;
    }

    let proc;
    try {
      const viaShell = /\.(cmd|bat)$/i.test(server.command);
      proc = spawn(viaShell ? `"${server.command}"` : server.command, server.args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: viaShell,
        windowsHide: true,
        env: { ...process.env, ...server.env },
      });
    } catch (err) {
      resolve({ ok: false, reason: err.message, tools: null });
      return;
    }

    let out = '';
    let err = '';
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { proc.kill(); } catch { /* already gone */ }
      resolve(result);
    };

    const timer = setTimeout(() => finish({
      ok: false, reason: `no response within ${Math.round(timeoutMs / 1000)}s`, tools: null,
    }), timeoutMs);

    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk) => {
      out += chunk;
      for (const line of out.split('\n')) {
        if (!line.trim()) continue;
        let message;
        try { message = JSON.parse(line); } catch { continue; }   // a torn line
        if (message.id !== 2) continue;
        if (message.error) return finish({ ok: false, reason: message.error.message, tools: null });
        const tools = (message.result && message.result.tools) || [];
        finish({
          ok: true,
          reason: null,
          tools: tools.map((t) => ({ name: t.name, description: t.description || null })),
        });
      }
    });

    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', (chunk) => { err += chunk; });
    proc.on('error', (e) => finish({ ok: false, reason: e.message, tools: null }));
    proc.on('close', () => finish({
      ok: false, reason: firstUsefulLine(err) || 'the server exited without answering', tools: null,
    }));

    // The whole exchange up front: a server reading stdio waits forever for a
    // request that never arrives, and this must not hang the window.
    proc.stdin.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'dai-ade', version: '0.1.0' },
      },
    })}\n`);
    proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })}\n`);
  });
}

/**
 * The line of stderr worth showing.
 *
 * Taking the tail gave "at node:internal/modules/run_main:33:47" - the end of a
 * stack trace, which says nothing about what went wrong. The line naming the
 * error is the one a person needs.
 */
function firstUsefulLine(text) {
  const lines = String(text).split('\n').map((l) => l.trim()).filter(Boolean);
  const named = lines.find((l) => /^[A-Za-z]*Error\b/.test(l));
  return (named || lines[0] || '').slice(0, 200);
}

/**
 * Write the config that decides what a launched agent may reach.
 *
 * Its own file, in its own directory — never the project's `.mcp.json` and
 * never the person's. Selection is this window's business; their configuration
 * is theirs.
 */
function writeSelection(servers, dir) {
  const mcpServers = {};
  for (const server of servers) mcpServers[server.name] = server.definition;
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'mcp-selection.json');
  fs.writeFileSync(file, JSON.stringify({ mcpServers }, null, 2));
  return file;
}

/** Add or replace a server in the project's own file. */
function addToProject(project, name, definition) {
  const file = path.join(project, '.mcp.json');
  const parsed = readJson(file);
  parsed.mcpServers = parsed.mcpServers || {};
  parsed.mcpServers[name] = definition;
  fs.writeFileSync(file, `${JSON.stringify(parsed, null, 2)}\n`);
  return file;
}

/** Remove one, and only from the project's own file. */
function removeFromProject(project, name) {
  const file = path.join(project, '.mcp.json');
  const parsed = readJson(file);
  if (!parsed.mcpServers || !(name in parsed.mcpServers)) {
    return { ok: false, error: `"${name}" is not declared in this project's .mcp.json` };
  }
  delete parsed.mcpServers[name];
  fs.writeFileSync(file, `${JSON.stringify(parsed, null, 2)}\n`);
  return { ok: true, file };
}

module.exports = { discover, probe, writeSelection, addToProject, removeFromProject, shape };
