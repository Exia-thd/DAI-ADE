/**
 * Minimal MCP stdio client — the control plane.
 *
 * Everything else in this tool reads. This is the one module that acts: it is
 * how the window approves a gate instead of only showing that one is waiting.
 *
 * It launches the server the *project* declares in its own `.mcp.json`, rather
 * than a path configured here. That matters: the project's config is what
 * Claude Code itself obeys, so the ADE drives exactly the server the agent is
 * talking to, and a project that moved its harness needs no change here.
 *
 * One call, one process. A long-lived server would be faster, but it would also
 * hold a writable handle on the harness state for the life of the window, and
 * the harness is built around every writer being short-lived. Correctness over
 * a few hundred milliseconds on an action a human triggers by hand.
 */

'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const DEFAULT_TIMEOUT_MS = 20_000;

/** Read the server definitions a project declares for its agents. */
function readServers(project) {
  const file = path.join(project, '.mcp.json');
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return {}; }
  try {
    // A BOM makes this invalid JSON for a strict parser; tolerate one rather
    // than refuse to work with a file some other tool wrote.
    return JSON.parse(text.replace(/^﻿/, '')).mcpServers || {};
  } catch {
    return {};
  }
}

function describe(project, name) {
  const server = readServers(project)[name];
  if (!server || !server.command) return null;
  return {
    name,
    command: server.command,
    args: Array.isArray(server.args) ? server.args : [],
    env: server.env && typeof server.env === 'object' ? server.env : {},
  };
}

/**
 * Call one tool and return its parsed payload.
 *
 * The whole exchange is written up front and the process is closed, because an
 * MCP server reading stdio will wait forever for a request that never arrives
 * and the window would hang on a button press.
 */
function callTool(project, serverName, toolName, args = {}, options = {}) {
  const server = describe(project, serverName);
  if (!server) {
    return Promise.reject(new Error(`no MCP server "${serverName}" in ${path.join(project, '.mcp.json')}`));
  }

  const requests = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: toolName, arguments: args } },
  ];

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(server.command, server.args, {
        cwd: project,
        env: { ...process.env, ...server.env },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (err) {
      reject(new Error(`could not start ${serverName}: ${err.message}`));
      return;
    }

    let out = '';
    let err = '';
    let settled = false;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.kill(); } catch { /* already gone */ }
      fn(value);
    };

    const timer = setTimeout(
      () => finish(reject, new Error(`${serverName}.${toolName} timed out after ${options.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms`)),
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );

    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { err += chunk; });
    child.on('error', (e) => finish(reject, new Error(`${serverName}: ${e.message}`)));

    child.on('close', () => {
      const replies = [];
      for (const line of out.split('\n')) {
        if (!line.trim()) continue;
        try { replies.push(JSON.parse(line)); } catch { /* a server may log to stdout */ }
      }
      const reply = replies.find((r) => r && r.id === 2);
      if (!reply) {
        finish(reject, new Error(`${serverName}.${toolName}: no reply${err ? ` (stderr: ${err.trim().slice(0, 200)})` : ''}`));
        return;
      }
      if (reply.error) {
        finish(reject, new Error(`${serverName}.${toolName}: ${reply.error.message || JSON.stringify(reply.error)}`));
        return;
      }
      finish(resolve, unwrap(reply.result));
    });

    child.stdin.write(requests.map((r) => JSON.stringify(r)).join('\n') + '\n');
    child.stdin.end();
  });
}

/** MCP wraps a result in content blocks; the useful part is the JSON inside. */
function unwrap(result) {
  if (!result || typeof result !== 'object') return result;
  const block = Array.isArray(result.content) ? result.content[0] : null;
  if (block && typeof block.text === 'string') {
    try { return JSON.parse(block.text); } catch { return { text: block.text }; }
  }
  return result;
}

/** List the tools a server offers — used by doctor to prove it is reachable. */
function listTools(project, serverName, options = {}) {
  const server = describe(project, serverName);
  if (!server) return Promise.reject(new Error(`no MCP server "${serverName}"`));
  return new Promise((resolve, reject) => {
    const child = spawn(server.command, server.args, {
      cwd: project, env: { ...process.env, ...server.env },
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    });
    let out = '';
    let settled = false;
    const done = (fn, v) => { if (!settled) { settled = true; clearTimeout(t); try { child.kill(); } catch {} fn(v); } };
    const t = setTimeout(() => done(reject, new Error('timed out')), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    child.stdout.on('data', (c) => { out += c; });
    child.on('error', (e) => done(reject, e));
    child.on('close', () => {
      for (const line of out.split('\n')) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id === 2) { done(resolve, msg.result?.tools ?? []); return; }
        } catch { /* ignore */ }
      }
      done(resolve, []);
    });
    child.stdin.write(
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) + '\n' +
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n');
    child.stdin.end();
  });
}

/* ------------------------------------------------------------- harness --- */

const HARNESS = 'dai-harness';

const harness = {
  state: (project) => callTool(project, HARNESS, 'dh_get_state', {}),
  approveGate: (project) => callTool(project, HARNESS, 'dh_approve_gate', {}),
  failPipeline: (project, reason) => callTool(project, HARNESS, 'dh_fail_pipeline', { reason }),
  advancePhase: (project) => callTool(project, HARNESS, 'dh_advance_phase', {}),
};

module.exports = { callTool, listTools, describe, readServers, harness, HARNESS };
