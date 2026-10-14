/**
 * Read token usage out of an agent transcript.
 *
 * No hook payload carries token counts, so for a long time the agent map had
 * nowhere to get them and showed none — correct, but it left the most asked
 * question ("what is this costing") unanswerable. The transcript is the one
 * place the numbers already exist: the runner writes a JSONL record per
 * message, and each assistant record carries its own `usage` block and the
 * model that produced it. Hook payloads hand us the path to it.
 *
 * Reading it is therefore reporting, not estimating. Nothing here infers,
 * averages, or prices anything: a field that is absent stays absent, and a
 * transcript that cannot be read yields null rather than a zero that would be
 * read as "this agent used nothing".
 */

'use strict';

const fs = require('fs');

/** Usage as the runner records it, summed where summing is meaningful. */
function readUsage(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return null; }

  let output = 0;
  let messages = 0;
  let model = null;
  let context = null;

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let record;
    try { record = JSON.parse(line); } catch { continue; }  // a torn tail line
    const message = record.message || record;
    const usage = message.usage || record.usage;
    if (!usage || typeof usage !== 'object') continue;

    // Generated tokens add up across a session: each one was produced once.
    output += num(usage.output_tokens);
    messages += 1;
    if (message.model) model = String(message.model);

    // Input tokens do NOT add up. Every request resends the conversation, so
    // summing them counts the same context once per turn and reports a number
    // several times larger than anything that happened. What the input side can
    // honestly report is the size of the context on the most recent request —
    // fresh tokens plus whatever was served from cache.
    const size = num(usage.input_tokens)
      + num(usage.cache_read_input_tokens)
      + num(usage.cache_creation_input_tokens);
    if (size > 0) context = size;
  }

  if (!messages) return null;
  return { model, outputTokens: output, contextTokens: context, messages };
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

module.exports = { readUsage };
