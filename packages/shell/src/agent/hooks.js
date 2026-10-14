/**
 * Install the emitter's hooks into a project, without printing anything.
 *
 * Pulled out of the CLI command because the window needs it too: a session the
 * ADE starts in a worktree is invisible unless that checkout has the hooks, and
 * a worktree does not inherit them — `.claude/settings.json` lives in the
 * working tree, so a fresh checkout simply does not have one. Measured, not
 * assumed: the first session this tool launched produced a correct answer and
 * not one event, which is exactly the silent failure the project keeps finding.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// Exactly the events Claude Code defines, and nothing else. An event name it
// does not know makes it drop the whole hooks block in silence: no warning, no
// error, no events — the failure that made this tool's first launched session
// answer correctly and produce nothing to look at. `SubagentStart` was such a
// name. A sub-agent is observed through the `Task` tool instead.
const HOOK_EVENTS = [
  'SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'SessionEnd',
];

/**
 * Add the emitter to the PROJECT settings of `root`.
 *
 * Never `~/.claude/settings.json`: those hooks commonly belong to another tool,
 * one the user may not control. Claude Code merges user and project hooks, so
 * writing ours alongside is enough and taking over theirs would be a theft.
 *
 * Idempotent, and refuses rather than damages: settings that are not valid JSON
 * are left exactly as they are.
 */
function installHooks(root) {
  const target = path.join(root, '.claude', 'settings.json');
  const emitPath = path.resolve(__dirname, '..', '..', '..', 'emitter', 'src', 'emit.js').replace(/\\/g, '/');
  const command = `node "${emitPath}"`;

  let settings = {};
  if (fs.existsSync(target)) {
    try {
      settings = JSON.parse(fs.readFileSync(target, 'utf8'));
    } catch {
      return { target, added: 0, error: `${target} is not valid JSON — refusing to touch it` };
    }
  }
  settings.hooks = settings.hooks || {};

  let added = 0;
  for (const event of HOOK_EVENTS) {
    const matchers = (settings.hooks[event] = settings.hooks[event] || []);
    const already = matchers.some((m) => (m.hooks || []).some((h) => String(h.command || '').includes('emit.js')));
    if (already) continue;
    matchers.push({ matcher: '*', hooks: [{ type: 'command', command }] });
    added++;
  }

  if (!added) return { target, added: 0, settings };
  return { target, added, settings };
}

/** Install and write. Returns the same record, plus whether it touched disk. */
function ensureHooks(root) {
  const result = installHooks(root);
  if (result.error || !result.added) return { ...result, written: false };
  fs.mkdirSync(path.dirname(result.target), { recursive: true });
  fs.writeFileSync(result.target, JSON.stringify(result.settings, null, 2) + '\n');
  return { ...result, written: true };
}

module.exports = { installHooks, ensureHooks, HOOK_EVENTS };
