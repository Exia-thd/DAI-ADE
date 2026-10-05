#!/usr/bin/env node
/**
 * Capture a real run from an event store into the renderer fixture, so the
 * views can be developed and reviewed in a browser without launching Electron
 * or driving an agent.
 *
 *   node scripts/make-fixture.js [projectDir]
 *
 * Then open packages/app/renderer/preview.html over http (file:// will not do:
 * the page's CSP and module loading both expect an origin).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { loadAll } = require('../packages/shell/src/cli.js');

const project = path.resolve(process.argv[2] || process.cwd());
const index = loadAll(project);
const runs = index.list();
if (!runs.length) {
  console.error(`no runs found under ${path.join(project, '.dai-ade', 'events')}`);
  process.exit(1);
}

const id = runs[0].id;
const run = index.runs.get(id);
const snapshot = {
  project,
  eventsDir: path.join(project, '.dai-ade', 'events'),
  runs,
  selected: id,
  tree: index.tree(id),
  summary: index.summary(id),
  events: run.events,
  truncated: 0,
  stats: { files: 1 },
};

const target = path.join(__dirname, '..', 'packages', 'app', 'renderer', 'preview-data.js');
const body = JSON.stringify(snapshot, null, 2).split('\n').join('\n  ');
fs.writeFileSync(target,
  `/** Renderer fixture: a real run captured from an event store, so the views can\n` +
  ` * be developed without launching Electron. Regenerate: npm run fixture\n */\n` +
  `window.ade = {\n  _snap: ${body},\n` +
  `  getSnapshot(){ return Promise.resolve(this._snap); },\n` +
  `  selectRun(){ return Promise.resolve(this._snap); },\n` +
  `  openProject(){ return Promise.resolve(this._snap); },\n` +
  `  onSnapshot(){ return () => {}; },\n` +
  `  onInvalid(){ return () => {}; },\n};\n`);

console.log(`fixture written from ${id}: ${snapshot.events.length} events, ${snapshot.summary.spans} spans`);
