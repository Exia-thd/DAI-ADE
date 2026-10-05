#!/usr/bin/env node
/**
 * `ade` — the command the installer puts on your path via a launcher.
 *
 * Thin by design: everything lives in packages/shell/src/cli.js so the same
 * code serves the CLI, the Electron main process and the tests.
 */
'use strict';
require('../packages/shell/src/cli.js');
