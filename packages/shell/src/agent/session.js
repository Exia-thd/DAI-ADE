/**
 * Start an agent, and read what it says back.
 *
 * Until now this tool could only watch. Watching is most of the value, but a
 * window with no way to give work is a dashboard: you see a feature stall and
 * then alt-tab to a terminal to do anything about it. This module is the other
 * direction — a prompt goes in, a real Claude Code session comes out, in the
 * worktree the feature lives in.
 *
 * Two deliberate choices:
 *
 *  - The prompt is written to the process's stdin, never passed as an argument.
 *    Everything on the command line is a fixed flag or a UUID this module
 *    generated, so no text a person typed is ever parsed by a shell. That is
 *    not caution for its own sake: on Windows a `.cmd` shim has to be launched
 *    through the shell, and a prompt containing a quote would otherwise be a
 *    command.
 *
 *  - The session id is chosen here rather than read back afterwards. The run id
 *    the rest of this tool uses is derived from it, so the moment the process
 *    starts the window already knows which run on the map the reply belongs to.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const crypto = require('crypto');

const { shortHash } = require('../../../shared/src/events.js');
const runners = require('./runners.js');

/** The run id the emitter will derive from this session id. */
function runIdFor(sessionId) {
  return `run_${shortHash(String(sessionId), 10)}`;
}

/** Claude Code only resumes a session whose id it issued, and those are UUIDs. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isResumable = (sessionId) => UUID.test(String(sessionId || ''));

/**
 * Where a runner's executable is.
 *
 * `claude` is an npm shim, so on Windows the thing on PATH is `claude.cmd` and
 * on everything else it is a shell script. Resolved explicitly rather than left
 * to the shell so that a missing CLI is reported as a missing CLI, instead of
 * surfacing as an unreadable exit code much later.
 */
function resolveCli(command = 'claude', env = process.env) {
  if (command === 'claude' && env.ADE_CLAUDE_CLI) return env.ADE_CLAUDE_CLI;
  // An absolute path in the configuration is used as given.
  if (path.isAbsolute(command)) {
    try { return fs.statSync(command).isFile() ? command : null; } catch { return null; }
  }
  const names = process.platform === 'win32'
    ? [`${command}.cmd`, `${command}.exe`, `${command}.bat`, command]
    : [command];
  for (const dir of String(env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const name of names) {
      const candidate = path.join(dir, name);
      try { if (fs.statSync(candidate).isFile()) return candidate; } catch { /* next */ }
    }
  }
  return null;
}

class AgentSession extends EventEmitter {
  /**
   * @param {object} options
   * @param {string} options.cwd        the checkout to work in
   * @param {string} options.prompt     what to do
   * @param {string} [options.resume]   an existing session id to continue
   * @param {string} [options.permissionMode]
   */
  constructor({ cwd, prompt, resume = null, permissionMode = 'acceptEdits',
    runner = runners.CLAUDE_CODE, model = 'default' }) {
    super();
    this.cwd = cwd;
    this.prompt = prompt;
    this.runner = runner;
    this.model = model;
    // Resuming keeps the id, so the conversation stays one run on the map
    // instead of fragmenting into a new one per message.
    // A runner without sessions gets a fresh id anyway, because the run id on
    // the map is derived from it; it simply never asks to continue one.
    this.sessionId = isResumable(resume) ? resume : crypto.randomUUID();
    this.resumed = runner.sessions !== false && isResumable(resume);
    this.runId = runIdFor(this.sessionId);
    this.permissionMode = permissionMode;
    this.proc = null;
    this.status = 'idle';
    this.remainder = '';
  }

  get args() {
    return runners.buildArgs(this.runner, {
      model: this.model,
      session: this.sessionId,
      resume: this.resumed,
      permissionMode: this.permissionMode,
      promptFile: this.promptFile,
    });
  }

  /**
   * How the prompt reaches the process.
   *
   * stdin by default, so no text a person typed is ever parsed by a shell. A
   * runner that cannot read stdin gets a file instead. Passing it as an
   * argument is allowed only when the executable can be launched without a
   * shell — otherwise a quote in the prompt would become a command, and no
   * amount of escaping is worth that risk in a tool people will ship.
   */
  prepare(viaShell) {
    if (this.runner.promptVia === 'file') {
      this.promptFile = path.join(
        fs.mkdtempSync(path.join(require('os').tmpdir(), 'ade-prompt-')), 'prompt.txt',
      );
      fs.writeFileSync(this.promptFile, this.prompt);
      return { ok: true };
    }
    if (this.runner.promptVia === 'arg' && viaShell) {
      return { ok: false, error: `${this.runner.label} is configured to take the prompt as an argument, but its executable has to be launched through a shell. Use "promptVia": "stdin" or "file".` };
    }
    return { ok: true };
  }

  start() {
    const cli = resolveCli(this.runner.command);
    if (!cli) {
      this.status = 'failed';
      // Said plainly, because the alternative is a window that looks broken.
      this.emit('message', {
        kind: 'error',
        text: `${this.runner.label}: "${this.runner.command}" was not found on PATH.`
          + (this.runner.command === 'claude' ? ' Install Claude Code, or set ADE_CLAUDE_CLI to its path.' : ''),
      });
      this.emit('end', { ok: false, code: null });
      return this;
    }

    // A .cmd shim cannot be executed directly by Node, so it goes through the
    // shell; the path is quoted because Program Files exists. No part of the
    // prompt is on the command line — see prepare().
    const viaShell = /\.(cmd|bat)$/i.test(cli);
    const prepared = this.prepare(viaShell);
    if (!prepared.ok) {
      this.status = 'failed';
      this.emit('message', { kind: 'error', text: prepared.error });
      this.emit('end', { ok: false, code: null });
      return this;
    }

    const args = this.runner.promptVia === 'arg' ? [...this.args, this.prompt] : this.args;
    this.proc = spawn(viaShell ? `"${cli}"` : cli, args, {
      cwd: this.cwd,
      shell: viaShell,
      windowsHide: true,
      env: { ...process.env, FORCE_COLOR: '0', ...(this.runner.env || {}) },
    });

    this.status = 'running';
    if (this.runner.promptVia === 'stdin') this.proc.stdin.end(this.prompt);
    else this.proc.stdin.end();

    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (chunk) => this.consume(chunk));

    // stderr is diagnostics, not output. It is kept and only surfaced if the
    // process fails, so a warning never looks like the agent's answer.
    this.stderr = '';
    this.proc.stderr.setEncoding('utf8');
    this.proc.stderr.on('data', (chunk) => { this.stderr += chunk; });

    this.proc.on('error', (err) => {
      this.status = 'failed';
      this.emit('message', { kind: 'error', text: err.message });
      this.emit('end', { ok: false, code: null });
    });

    this.proc.on('close', (code) => {
      if (this.plain && this.plain.trim()) {
        this.emit('message', { kind: 'assistant', text: this.plain.trim() });
        this.plain = '';
      }
      if (this.status === 'cancelled') return this.emit('end', { ok: false, code });
      this.status = code === 0 ? 'done' : 'failed';
      if (code !== 0 && this.stderr.trim()) {
        this.emit('message', { kind: 'error', text: this.stderr.trim().slice(-2000) });
      }
      this.emit('end', { ok: code === 0, code });
    });

    return this;
  }

  /** NDJSON, with the same torn-line discipline the event tailer uses. */
  consume(chunk) {
    // A runner that just prints is read as plain text. Nothing is invented from
    // it - no tool calls, no cost - because it did not say any of that.
    if (this.runner.format !== 'claude-stream-json') {
      this.plain = (this.plain || '') + chunk;
      return;
    }
    this.remainder += chunk;
    const lines = this.remainder.split('\n');
    this.remainder = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      let record;
      try { record = JSON.parse(line); } catch { continue; }
      for (const message of normalise(record)) this.emit('message', message);
    }
  }

  cancel() {
    if (!this.proc || this.status !== 'running') return false;
    this.status = 'cancelled';
    // The CLI spawns its own children; on Windows only taskkill /T reaches
    // them, and a half-killed agent still holding a worktree is worse than one
    // that was never started.
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(this.proc.pid), '/t', '/f'], { windowsHide: true });
      } else {
        this.proc.kill('SIGTERM');
      }
    } catch { /* it is already gone */ }
    this.emit('message', { kind: 'note', text: 'stopped' });
    return true;
  }
}

/**
 * Turn one stream record into what the window shows.
 *
 * Only what the record actually carries. Nothing here invents a status, and a
 * record type this does not understand is dropped rather than guessed at.
 */
function normalise(record) {
  const out = [];
  if (record.type === 'system' && record.subtype === 'init') {
    out.push({
      kind: 'system',
      model: record.model ?? null,
      permissionMode: record.permissionMode ?? null,
      sessionId: record.session_id ?? null,
      // What this session will accept as a slash command. Kept so the composer
      // can offer the ones no file on disk explains - built-ins and plugins.
      slashCommands: Array.isArray(record.slash_commands) ? record.slash_commands : null,
    });
    return out;
  }

  if (record.type === 'assistant' && record.message) {
    for (const block of record.message.content || []) {
      if (block.type === 'text' && block.text.trim()) {
        out.push({ kind: 'assistant', text: block.text });
      } else if (block.type === 'tool_use') {
        out.push({ kind: 'tool', tool: block.name, input: summarise(block.input) });
      }
    }
    return out;
  }

  if (record.type === 'result') {
    out.push({
      kind: 'result',
      ok: record.is_error !== true,
      text: typeof record.result === 'string' ? record.result : null,
      costUsd: typeof record.total_cost_usd === 'number' ? record.total_cost_usd : null,
      durationMs: record.duration_ms ?? null,
      turns: record.num_turns ?? null,
    });
  }
  return out;
}

/** A tool's arguments can be a whole file; the chat line needs a glance. */
function summarise(input) {
  if (!input || typeof input !== 'object') return null;
  const first = input.command || input.file_path || input.pattern || input.path || input.prompt;
  if (typeof first === 'string') return first.length > 160 ? `${first.slice(0, 160)}…` : first;
  return null;
}

module.exports = { AgentSession, resolveCli, runIdFor, isResumable, normalise, runners };
