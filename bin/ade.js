#!/usr/bin/env node
/**
 * `ade` - the command the installer puts behind a launcher.
 *
 * Thin by design: everything lives in packages/shell/src/cli.js so the same
 * code serves the CLI, the Electron main process and the tests. It must call
 * main() explicitly - requiring the module is not enough, because the module
 * only self-starts when it is itself the entry point.
 */
'use strict';
require('../packages/shell/src/cli.js').main();
