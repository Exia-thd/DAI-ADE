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
const worktrees = require('../packages/shell/src/git/worktrees.js');

const project = path.resolve(process.argv[2] || process.cwd());
const index = loadAll(project);
const runs = index.list();
if (!runs.length) {
  console.error(`no runs found under ${path.join(project, '.dai-ade', 'events')}`);
  process.exit(1);
}

const id = runs[0].id;
const run = index.runs.get(id);
// Worktrees are part of the snapshot the window renders, so the fixture has to
// carry them or the Workspaces pane cannot be reviewed without Electron.
let workspaces = [];
try {
  workspaces = worktrees.list(project).map((entry) => {
    if (!entry.managed) return entry;
    try { return { ...entry, status: worktrees.status(project, entry.taskId) }; }
    catch (err) { return { ...entry, statusError: err.message }; }
  });
} catch { /* not a git repository */ }

const snapshot = {
  project,
  workspaces,
  eventsDir: path.join(project, '.dai-ade', 'events'),
  runs,
  selected: id,
  tree: index.tree(id),
  summary: index.summary(id),
  events: run.events,
  truncated: 0,
  stats: { files: 1 },
};

// Capture a real diff per worktree too. Without it the preview's stub returned
// a snapshot object and the Diff pane rendered "[object Object]" -- the sort of
// thing that ships because nobody opened that tab.
async function captureDiffs() {
  const diffs = {};
  for (const w of workspaces.filter((x) => x.managed)) {
    try { diffs[w.taskId] = await worktrees.diff(project, w.taskId); }
    catch { diffs[w.taskId] = ''; }
  }
  return diffs;
}

const target = path.join(__dirname, '..', 'packages', 'app', 'renderer', 'preview-data.js');

captureDiffs().then((diffs) => {
  const body = JSON.stringify(snapshot, null, 2).split('\n').join('\n  ');
  const readOnly = (name) =>
    `  ${name}(){ return Promise.reject(new Error('the preview is read-only')); },\n`;

  fs.writeFileSync(target,
    `/** Renderer fixture: a real run captured from an event store, so the views can\n` +
    ` * be developed without launching Electron. Regenerate: npm run fixture\n */\n` +
    `window.ade = {\n  _snap: ${body},\n` +
    `  _diffs: ${JSON.stringify(diffs, null, 2).split('\n').join('\n  ')},\n` +
    `  getSnapshot(){ return Promise.resolve(this._snap); },\n` +
    `  selectRun(){ return Promise.resolve(this._snap); },\n` +
    `  openProject(){ return Promise.resolve(this._snap); },\n` +
    `  refreshWorkspaces(){ return Promise.resolve(this._snap); },\n` +
    `  worktreeDiff(taskId){ return Promise.resolve(this._diffs[taskId] || ''); },\n` +
    readOnly('worktreeCreate') + readOnly('worktreeRemove') +
    `  harnessState(){ return Promise.resolve({ ok:false, error:'the preview is read-only' }); },\n` +
    `  approveGate(){ return Promise.resolve({ ok:false, error:'the preview is read-only' }); },\n` +
    `  onSnapshot(){ return () => {}; },\n` +
    `  onInvalid(){ return () => {}; },\n};\n`);
  report();
});

// Regenerate the preview page from the real one every time. The first version
// was a one-off copy, and it silently drifted: index.html gained tabs and a
// gate bar, the preview did not, and the new code threw on null elements while
// the old panes still rendered -- which looks like the feature is broken
// rather than like the harness page is stale.
const rendererDir = path.join(__dirname, '..', 'packages', 'app', 'renderer');
const page = fs.readFileSync(path.join(rendererDir, 'index.html'), 'utf8')
  .replace('<title>DAI ADE</title>', '<title>DAI ADE - renderer preview</title>')
  .replace('<script src="renderer.js"></script>',
    "<script src=\"preview-data.js\"></script>" + String.fromCharCode(10) + "<script src=\"renderer.js\"></script>");
fs.writeFileSync(path.join(rendererDir, 'preview.html'), page);


function report() {
  console.log(`fixture written from ${id}: ${snapshot.events.length} events, ${snapshot.summary.spans} spans, ${workspaces.length} worktree(s)`);
  console.log('preview.html regenerated from index.html');
}