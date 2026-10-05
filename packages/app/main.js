/**
 * Electron main — owns every privileged thing, so the renderer can stay a pure
 * function of a snapshot.
 *
 * The window watches a *project*, not itself: a run belongs to the repository
 * the agent was working in. Opening a project reads whatever history is already
 * on disk and then follows it, which is the same code path for a finished run
 * and a live one — that equivalence is what makes replay fall out later instead
 * of being a second implementation.
 */

'use strict';

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { RunDirectoryTailer } = require('../shell/src/ingest/tailer.js');
const { RunIndex } = require('../shell/src/store/runIndex.js');
const { eventsDir } = require('../emitter/src/emit.js');

const PREFS = path.join(app.getPath('userData'), 'prefs.json');
const MAX_EVENTS_TO_RENDERER = 400;

let win = null;
let tailer = null;
let index = new RunIndex();
let project = null;
let selected = null;
let dirty = false;

/* ------------------------------------------------------------- prefs ----- */

function loadPrefs() {
  try { return JSON.parse(fs.readFileSync(PREFS, 'utf8')); } catch { return {}; }
}
function savePrefs(next) {
  try {
    fs.mkdirSync(path.dirname(PREFS), { recursive: true });
    fs.writeFileSync(PREFS, JSON.stringify({ ...loadPrefs(), ...next }, null, 2));
  } catch { /* a missing preference is not worth an error dialog */ }
}

/* ------------------------------------------------------------ project ---- */

function watchProject(dir) {
  if (tailer) tailer.stop();
  project = dir;
  index = new RunIndex();
  selected = null;
  savePrefs({ lastProject: dir });

  const dirPath = eventsDir(dir);
  tailer = new RunDirectoryTailer(dirPath, { intervalMs: 150, scanIntervalMs: 800 });
  tailer.on('event', (event) => {
    if (!index.add(event)) return;         // dedupe across ingestion paths
    if (!selected) selected = event.run_id; // first run seen becomes the view
    dirty = true;
  });
  tailer.on('invalid', (d) => { send('ade:invalid', d); });
  tailer.start();
  dirty = true;
}

/* ---------------------------------------------------------- snapshot ----- */

function snapshot() {
  const runs = index.list();
  const runId = selected && runs.some((r) => r.id === selected) ? selected : runs[0]?.id ?? null;
  selected = runId;

  const run = runId ? index.runs.get(runId) : null;
  // Only the tail of the stream crosses IPC. A long run holds thousands of
  // events and the renderer never draws more than a screenful; shipping all of
  // them would make the UI slower the longer you watched, which is backwards.
  const events = run ? run.events.slice(-MAX_EVENTS_TO_RENDERER) : [];

  return {
    project,
    eventsDir: project ? eventsDir(project) : null,
    runs,
    selected: runId,
    tree: runId ? index.tree(runId) : [],
    summary: runId ? index.summary(runId) : null,
    events,
    truncated: run ? Math.max(0, run.events.length - events.length) : 0,
    stats: tailer ? tailer.stats : null,
  };
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

// Coalesce pushes. A burst of hook events during a parallel turn can arrive as
// dozens of appends in one poll; repainting per event would spend the whole
// frame budget on work the next event invalidates.
setInterval(() => {
  if (!dirty) return;
  dirty = false;
  send('ade:snapshot', snapshot());
}, 250);

/* -------------------------------------------------------------- window --- */

function createWindow() {
  win = new BrowserWindow({
    width: 1340,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#eef5fd',
    title: 'DAI ADE',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.on('did-finish-load', () => send('ade:snapshot', snapshot()));
}

/* ----------------------------------------------------------------- ipc --- */

ipcMain.handle('ade:getSnapshot', () => snapshot());

ipcMain.handle('ade:selectRun', (_e, runId) => {
  selected = runId;
  return snapshot();
});

ipcMain.handle('ade:openProject', async () => {
  const result = await dialog.showOpenDialog(win, {
    title: 'Choose the project to watch',
    properties: ['openDirectory'],
    defaultPath: project || os.homedir(),
  });
  if (result.canceled || !result.filePaths[0]) return snapshot();
  watchProject(result.filePaths[0]);
  return snapshot();
});

app.whenReady().then(() => {
  const last = loadPrefs().lastProject;
  if (last && fs.existsSync(last)) watchProject(last);
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  if (tailer) tailer.stop();
  if (process.platform !== 'darwin') app.quit();
});
