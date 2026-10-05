#!/usr/bin/env node
/**
 * Bridge whatever the harness has already recorded into the ADE event store.
 *
 *   node scripts/bridge-sync.js [projectDir]
 *
 * Lives as a file rather than an inline `node -e` so the installer does not
 * have to nest three levels of quoting through PowerShell, cmd and JavaScript —
 * which is exactly the kind of thing that works until a path contains a space.
 */
'use strict';

const path = require('path');
const bridge = require('../packages/shell/src/ingest/harnessBridge.js');

const project = path.resolve(process.argv[2] || process.cwd());
const result = bridge.sync(project);

if (result.written > 0) {
  console.log(`bridged ${result.written} harness event(s) into ${result.runId}`);
} else if (result.reason) {
  console.log(`nothing bridged: ${result.reason}`);
} else {
  console.log(`already up to date (${result.total} event(s) in ${result.runId})`);
}
