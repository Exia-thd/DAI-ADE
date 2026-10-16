/**
 * What a session is carrying, measured rather than asked for.
 *
 * The agent's own context accounting is not visible from outside it: hooks
 * carry no breakdown, and a transcript records usage totals, not what the
 * tokens were spent on. So this does not try to reproduce that breakdown.
 * It measures the things that are on disk and can be counted — the skills a
 * project declares, the memory files, the MCP tool definitions a server
 * actually returns — and says, for every number, where it came from.
 *
 * The distinction matters more than it sounds. A panel that shows a tidy
 * hundred-percent bar implies it accounts for everything, and the moment one
 * slice is a guess the whole bar is a lie. This one reports a handful of
 * measured parts and the measured total, and never pretends they add up.
 */

'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Bytes to tokens.
 *
 * Four bytes per token is the usual rule of thumb for English prose and it is
 * near enough for sizing a panel — but it is an estimate, and every value
 * derived from it is labelled as one. The bytes are the measurement; the token
 * figure is a convenience.
 */
const BYTES_PER_TOKEN = 4;
const estimateTokens = (bytes) => Math.round(bytes / BYTES_PER_TOKEN);

/** Total bytes of the files under `dir` matching `test`, and how many there were. */
function measureTree(dir, test, depth = 4) {
  let bytes = 0;
  let files = 0;
  const walk = (current, level) => {
    if (level > depth) return;
    let entries = [];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.git')) continue;
        walk(full, level + 1);
      } else if (entry.isFile() && test(entry.name)) {
        try { bytes += fs.statSync(full).size; files += 1; } catch { /* vanished */ }
      }
    }
  };
  walk(dir, 0);
  return { bytes, files };
}

const isMarkdown = (name) => /\.(md|markdown)$/i.test(name);

/**
 * The parts of a session's material this tool can actually count.
 *
 * Each entry carries `source` — the thing that was read — because a number
 * whose origin is not stated cannot be checked, and an unverifiable number in
 * a dashboard is worse than no number.
 */
function measure(project, { mcpServers = [] } = {}) {
  const parts = [];

  const skills = measureTree(path.join(project, '.claude', 'skills'), isMarkdown);
  if (skills.files) {
    parts.push({
      id: 'skills',
      label: 'Skills',
      files: skills.files,
      bytes: skills.bytes,
      tokens: estimateTokens(skills.bytes),
      source: '.claude/skills/**/*.md',
    });
  }

  const commands = measureTree(path.join(project, '.claude', 'commands'), isMarkdown);
  if (commands.files) {
    parts.push({
      id: 'commands',
      label: 'Slash commands',
      files: commands.files,
      bytes: commands.bytes,
      tokens: estimateTokens(commands.bytes),
      source: '.claude/commands/**/*.md',
    });
  }

  // Two conventions, both common enough to be worth looking for.
  for (const [id, relative] of [['memory', 'memory'], ['claude-md', '.']]) {
    const dir = path.join(project, relative);
    const test = id === 'claude-md'
      ? (name) => /^(CLAUDE|AGENTS)\.md$/i.test(name)
      : isMarkdown;
    const found = measureTree(dir, test, id === 'claude-md' ? 0 : 3);
    if (found.files) {
      parts.push({
        id,
        label: id === 'memory' ? 'Memory files' : 'Project instructions',
        files: found.files,
        bytes: found.bytes,
        tokens: estimateTokens(found.bytes),
        source: id === 'memory' ? 'memory/**/*.md' : 'CLAUDE.md, AGENTS.md',
      });
    }
  }

  // MCP tool definitions are the one part measured from a live answer rather
  // than a file: the server was asked what it offers, and this is the size of
  // what it said. Only servers that actually answered are counted.
  const answered = mcpServers.filter((s) => s.check && s.check.ok === true && s.check.tools);
  if (answered.length) {
    const bytes = answered.reduce(
      (total, server) => total + Buffer.byteLength(JSON.stringify(server.check.tools), 'utf8'),
      0,
    );
    parts.push({
      id: 'mcp-tools',
      label: 'MCP tool definitions',
      files: answered.reduce((n, s) => n + s.check.tools.length, 0),
      bytes,
      tokens: estimateTokens(bytes),
      source: `tools/list from ${answered.length} server(s) that answered`,
      unit: 'tool',
    });
  }

  return parts;
}

/**
 * What the agent itself reported, which is the only authoritative figure here.
 *
 * `contextTokens` is the size of the context on the most recent request and
 * `tokens` is what the agent generated; both come from the transcript, and
 * both are absent when nothing reported them.
 */
function reported(agents) {
  const roots = agents.filter((agent) => agent.kind === 'root');
  const withContext = roots.filter((agent) => Number.isFinite(agent.contextTokens));
  if (!withContext.length) return null;
  const largest = withContext.reduce((a, b) => (b.contextTokens > a.contextTokens ? b : a));
  return {
    sessions: roots.length,
    measured: withContext.length,
    largest: {
      id: largest.id,
      model: largest.model,
      contextTokens: largest.contextTokens,
      outputTokens: largest.tokens,
    },
    totalOutput: roots.reduce((n, agent) => n + (agent.tokens || 0), 0) || null,
    source: "each session's own transcript",
  };
}

/**
 * Files the agents actually changed, newest first.
 *
 * Taken from the tool calls themselves rather than from the filesystem, so it
 * says what this run did rather than what happens to be on disk.
 */
const WRITERS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

function outputs(events, limit = 40) {
  const seen = new Map();
  for (const event of events) {
    if (event.type !== 'TOOL_EXECUTED' && event.type !== 'TOOL_FAILED') continue;
    const payload = event.payload || {};
    if (!WRITERS.has(payload.tool)) continue;
    const input = payload.input || {};
    const file = input.file_path || input.path || input.notebook_path;
    if (typeof file !== 'string' || !file) continue;
    const entry = seen.get(file) || { file, tool: payload.tool, writes: 0, failed: 0, at: event.ts };
    entry.writes += 1;
    if (event.type === 'TOOL_FAILED') entry.failed += 1;
    if (event.ts > entry.at) entry.at = event.ts;
    entry.tool = payload.tool;
    seen.set(file, entry);
  }
  return [...seen.values()].sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

module.exports = { measure, reported, outputs, estimateTokens, BYTES_PER_TOKEN, measureTree };
