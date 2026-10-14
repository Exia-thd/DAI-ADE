/**
 * Which agent to run, and on what model.
 *
 * This tool is provider-neutral on purpose: the window watches a stream of
 * events, and nothing about that stream is specific to one vendor. So the agent
 * that produces the work is configuration, not code. Claude Code is the
 * built-in runner because it is the one whose behaviour is verified here; any
 * other command-line agent is added as data, in `.dai-ade/runners.json`.
 *
 * What a runner declares is deliberately small — an executable, how to hand it
 * a prompt, and how to read what comes back. What it must not do is pretend:
 * a runner that does not emit this tool's hooks says so (`observable: false`),
 * and the window reports that its work will not appear on the map rather than
 * leaving someone to wonder why the timeline stayed empty.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * The one runner this project tests against.
 *
 * `--output-format stream-json` is what makes the reply arrive as it happens
 * instead of in one lump at the end, and the hooks are what put the same work
 * on the map. Both were measured, not assumed.
 */
const CLAUDE_CODE = {
  id: 'claude-code',
  label: 'Claude Code',
  command: 'claude',
  args: ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', '{permissionMode}'],
  promptVia: 'stdin',
  format: 'claude-stream-json',
  sessions: true,
  newSessionArgs: ['--session-id', '{session}'],
  resumeArgs: ['--resume', '{session}'],
  modelArgs: ['--model', '{model}'],
  observable: true,
  verified: true,
  // Aliases rather than dated ids: an alias keeps pointing at the current
  // model, and a pinned id goes stale silently. `default` passes no flag at
  // all, so whatever the CLI is configured with stays in charge.
  models: [
    { id: 'default', label: 'Default (as configured)' },
    { id: 'opus', label: 'Opus' },
    { id: 'sonnet', label: 'Sonnet' },
    { id: 'haiku', label: 'Haiku' },
  ],
};

/**
 * Codex CLI and Gemini CLI, shipped as definitions rather than integrations.
 *
 * Both executable names were confirmed against the npm registry
 * (`@openai/codex` -> `codex`, `@google/gemini-cli` -> `gemini`). The flags
 * were not: neither CLI is installed here, so nothing about them has been
 * observed running. They are marked `verified: false`, the window shows the
 * exact command before it runs one, and every field can be corrected in
 * `.dai-ade/runners.json` without touching this file. That is the honest shape
 * for a runner this project cannot test: visible, and editable.
 *
 * `format: 'text'` because neither emits this tool's stream format, and
 * `observable: false` because neither emits its hooks — so the window says
 * their work will not appear on the map instead of leaving an empty timeline
 * to explain itself.
 */
const CODEX = {
  id: 'codex',
  label: 'Codex CLI',
  command: 'codex',
  // `exec` is the non-interactive subcommand; `-` makes it read the prompt from
  // stdin, which is where this tool puts every prompt.
  args: ['exec', '--full-auto', '-'],
  promptVia: 'stdin',
  format: 'text',
  sessions: false,
  modelArgs: ['-m', '{model}'],
  observable: false,
  verified: false,
  models: [{ id: 'default', label: 'Default (as configured)' }],
};

const GEMINI = {
  id: 'gemini',
  label: 'Gemini CLI',
  command: 'gemini',
  args: ['--yolo'],
  promptVia: 'stdin',
  format: 'text',
  sessions: false,
  modelArgs: ['-m', '{model}'],
  observable: false,
  verified: false,
  models: [{ id: 'default', label: 'Default (as configured)' }],
};

const BUILT_IN = [CLAUDE_CODE, CODEX, GEMINI];

/** Where a project and a person keep their own runners. */
function configPaths(project) {
  const out = [];
  if (project) out.push(path.join(project, '.dai-ade', 'runners.json'));
  out.push(path.join(os.homedir(), '.dai-ade', 'runners.json'));
  return out;
}

/**
 * Every runner available for this project: the built-in one, plus whatever has
 * been declared. A declared runner with the built-in's id replaces it, so the
 * defaults can be adjusted without forking the code.
 */
function list(project) {
  const byId = new Map(BUILT_IN.map((r) => [r.id, normalise(r, 'built-in')]));
  for (const file of configPaths(project)) {
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { continue; }
    for (const entry of parsed.runners || []) {
      const runner = normalise(entry, file);
      if (runner) byId.set(runner.id, runner);
    }
  }
  return [...byId.values()];
}

function get(project, id) {
  const all = list(project);
  return all.find((r) => r.id === id) || all[0];
}

/** A declared runner, with the fields this tool relies on filled in. */
function normalise(entry, source) {
  if (!entry || !entry.id || !entry.command) return null;
  return {
    id: String(entry.id),
    label: String(entry.label || entry.id),
    command: String(entry.command),
    args: toArray(entry.args),
    promptVia: ['stdin', 'arg', 'file'].includes(entry.promptVia) ? entry.promptVia : 'stdin',
    promptArgs: toArray(entry.promptArgs),
    format: entry.format === 'claude-stream-json' ? 'claude-stream-json' : 'text',
    sessions: Boolean(entry.sessions),
    newSessionArgs: toArray(entry.newSessionArgs),
    resumeArgs: toArray(entry.resumeArgs),
    modelArgs: toArray(entry.modelArgs),
    env: entry.env && typeof entry.env === 'object' ? { ...entry.env } : {},
    // Default false: a runner has to claim it emits this tool's events, rather
    // than being assumed to and leaving an empty map to explain.
    observable: entry.observable === true,
    // False means: this project has not run it. Shown in the window, because
    // "we ship it" and "we tested it" are different claims.
    verified: entry.verified !== false,
    models: Array.isArray(entry.models)
      ? entry.models.map((m) => (typeof m === 'string' ? { id: m, label: m } : { id: String(m.id), label: String(m.label || m.id) }))
      : [{ id: 'default', label: 'Default' }],
    source,
  };
}

const toArray = (value) => (Array.isArray(value) ? value.map(String) : []);

/**
 * Fill in the placeholders. Substitution is per whole argument, never a string
 * concatenation of the command line, so a value cannot grow into a second
 * argument.
 */
function fill(args, values) {
  return args.map((arg) => arg.replace(/\{(\w+)\}/g, (whole, key) => (
    values[key] === undefined || values[key] === null ? whole : String(values[key])
  )));
}

/** The exact argv for one launch. */
function buildArgs(runner, { model, session, resume, permissionMode, promptFile }) {
  const values = { model, session, permissionMode, promptFile };
  const args = [...fill(runner.args, values)];

  if (model && model !== 'default' && runner.modelArgs.length) {
    args.push(...fill(runner.modelArgs, values));
  }
  if (runner.sessions && session) {
    args.push(...fill(resume ? runner.resumeArgs : runner.newSessionArgs, values));
  }
  if (runner.promptVia === 'file' && runner.promptArgs.length) {
    args.push(...fill(runner.promptArgs, values));
  }
  return args;
}

/**
 * The runners, each with whether its executable is actually on this machine.
 *
 * Asked before anything is launched, so a runner that is not installed is a
 * greyed-out option with a reason rather than a failure after you hit send.
 */
function available(project, resolve) {
  return list(project).map((runner) => {
    const found = resolve ? resolve(runner.command) : null;
    return { ...runner, installed: Boolean(found), executable: found || null };
  });
}

module.exports = { CLAUDE_CODE, CODEX, GEMINI, BUILT_IN, list, get, available, normalise, buildArgs, fill, configPaths };
