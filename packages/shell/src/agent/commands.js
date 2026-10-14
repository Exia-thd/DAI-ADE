/**
 * The slash commands available where the agent will run.
 *
 * Measured rather than guessed: a file in `.claude/commands/` shows up in the
 * `slash_commands` list of the session's first stream record and runs when it
 * is sent as the prompt. So the composer can offer them, and the project's own
 * commands — the ones a team actually standardised on — are one keystroke away
 * instead of something you have to remember.
 *
 * Read from disk rather than waiting for a session to report them, because the
 * menu has to exist before the first message. What a run reports is merged in
 * on top, so a command this cannot see is still offered once it has been seen.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

/** Project commands first: a project's own wording beats a personal one. */
function roots(cwd) {
  const out = [];
  if (cwd) out.push({ dir: path.join(cwd, '.claude', 'commands'), scope: 'project' });
  out.push({ dir: path.join(os.homedir(), '.claude', 'commands'), scope: 'user' });
  return out;
}

function list(cwd, seen = []) {
  const byName = new Map();

  for (const { dir, scope } of roots(cwd)) {
    for (const file of walk(dir)) {
      // Nested directories namespace a command, the way Claude Code reads them:
      // commands/review/api.md is `/review:api`.
      const rel = path.relative(dir, file).replace(/\.md$/i, '');
      const name = rel.split(/[\\/]/).join(':');
      if (byName.has(name)) continue;
      byName.set(name, { name, description: describe(file), scope, file });
    }
  }

  // Whatever a run reported but this could not find — a built-in, or something
  // supplied by a plugin. Listed without a description rather than omitted.
  for (const name of seen) {
    if (!byName.has(String(name))) byName.set(String(name), { name: String(name), description: null, scope: 'session' });
  }

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function* walk(dir, depth = 0) {
  if (depth > 3) return;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full, depth + 1);
    else if (entry.isFile() && /\.md$/i.test(entry.name)) yield full;
  }
}

/** The `description:` from the frontmatter, or the first line of real text. */
function describe(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return null; }

  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (frontmatter) {
    const line = /^description:\s*(.+)$/m.exec(frontmatter[1]);
    if (line) return line[1].trim().replace(/^["']|["']$/g, '');
    text = text.slice(frontmatter[0].length);
  }
  const first = text.split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('#'));
  return first ? first.slice(0, 120) : null;
}

module.exports = { list, describe };
