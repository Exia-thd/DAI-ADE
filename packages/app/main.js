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
const { EventEmitter } = require('events');

const { RunDirectoryTailer } = require('../shell/src/ingest/tailer.js');
const { RunIndex } = require('../shell/src/store/runIndex.js');
const { eventsDir } = require('../emitter/src/emit.js');
const bridge = require('../shell/src/ingest/harnessBridge.js');
const worktrees = require('../shell/src/git/worktrees.js');
const mcp = require('../shell/src/mcp/client.js');
const { makeEvent } = require('../shared/src/events.js');

const PREFS = path.join(app.getPath('userData'), 'prefs.json');
const MAX_EVENTS_TO_RENDERER = 400;
const ALL_RUNS = '*';

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

  // The project itself, plus every worktree: an agent working on a feature runs
  // inside that feature's checkout and writes its events there, so watching
  // only the root made exactly the sessions this tool is for invisible.
  tailer = new MultiDirectoryTailer(watchedDirs(dir), { intervalMs: 150, scanIntervalMs: 800 });
  tailer.on('event', (event) => {
    if (!index.add(event)) return;         // dedupe across ingestion paths
    // Deliberately does not pick a run: snapshot() decides, and with more than
    // one it shows them all. Latching onto whichever run happened to emit first
    // hid the other three sessions behind a dropdown.
    dirty = true;
  });
  tailer.on('invalid', (d) => { send('ade:invalid', d); });
  syncHarness();
  dirty = true;
}

/**
 * Pull whatever the harness has recorded into the event store.
 *
 * Without this the window never showed a TOOL_BLOCKED at all: the bridge
 * existed and was tested, but only the CLI ever called it, so the one event no
 * black-box supervisor can produce was missing from the only place anyone
 * looks. Cheap to repeat - event ids are derived, so a re-read writes nothing.
 */
/** Every event directory worth watching for this project. */
function watchedDirs(dir) {
  const dirs = [eventsDir(dir)];
  try {
    for (const entry of worktrees.list(dir)) {
      if (entry.managed) dirs.push(eventsDir(entry.path));
    }
  } catch { /* not a git repository */ }
  return dirs;
}

/**
 * Several directories, one stream. New worktrees appear while the window is
 * open, so the set is re-checked rather than fixed at startup.
 */
class MultiDirectoryTailer extends EventEmitter {
  constructor(dirs, options) {
    super();
    this.options = options;
    this.tailers = new Map();
    this.adopt(dirs);
  }

  adopt(dirs) {
    for (const dir of dirs) {
      if (this.tailers.has(dir)) continue;
      const tailer = new RunDirectoryTailer(dir, this.options);
      tailer.on('event', (e) => this.emit('event', e));
      tailer.on('invalid', (d) => this.emit('invalid', d));
      this.tailers.set(dir, tailer.start());
    }
  }

  stop() {
    for (const tailer of this.tailers.values()) tailer.stop();
    this.tailers.clear();
  }

  get stats() {
    const total = { lines: 0, events: 0, invalid: 0, torn: 0, restarts: 0, files: 0 };
    for (const tailer of this.tailers.values()) {
      const s = tailer.stats;
      for (const key of Object.keys(total)) total[key] += s[key] || 0;
    }
    return total;
  }
}

function syncHarness() {
  if (!project) return;
  try {
    const result = bridge.sync(project);
    if (result.written > 0) dirty = true;
  } catch (err) {
    console.warn('harness bridge:', err.message);
  }
}
setInterval(syncHarness, 5000);

/* ---------------------------------------------------------- snapshot ----- */

const MAIN_FEATURE = '(main)';
let activeFeature = null;

/**
 * Which feature a run belongs to, from the working directory its events were
 * produced in. Correlating on the path is exact: the emitter records the cwd
 * the hook fired in, and a worktree is a directory.
 */
function featureOf(run) {
  for (const event of run.events) {
    const cwd = event.payload && event.payload.cwd;
    if (!cwd) continue;
    const resolved = path.resolve(cwd);
    for (const workspace of listWorkspaces()) {
      if (workspace.managed && resolved.startsWith(workspace.path)) return workspace.taskId;
    }
  }
  return null;
}

/** The features currently in flight, with how much is happening in each. */
function featureList() {
  const counts = new Map();
  for (const run of index.runs.values()) {
    const feature = featureOf(run);
    const key = feature ?? MAIN_FEATURE;
    counts.set(key, (counts.get(key) || 0) + run.events.length);
  }
  const out = [];
  for (const workspace of listWorkspaces()) {
    if (!workspace.managed) continue;
    out.push({
      id: workspace.taskId,
      objective: workspace.contract ? workspace.contract.objective : null,
      events: counts.get(workspace.taskId) || 0,
      uncommitted: workspace.status ? workspace.status.uncommitted.length : 0,
      ahead: workspace.status ? workspace.status.ahead : 0,
    });
  }
  // The main checkout is a feature tab like any other: work happens there too,
  // and without it switching to a feature would hide that work with no way back
  // to it other than 'everything at once'.
  if (counts.has(MAIN_FEATURE)) {
    out.unshift({ id: MAIN_FEATURE, objective: 'the main checkout', events: counts.get(MAIN_FEATURE) });
  }
  return out;
}

function snapshot() {
  const features = featureList();
  // Filtering happens on the run list, so every pane - timeline, agents,
  // counters, stream - narrows together. A feature tab that only filtered one
  // pane would be worse than none.
  const runIds = new Set();
  for (const [id, run] of index.runs) {
    if (activeFeature === null || (featureOf(run) ?? MAIN_FEATURE) === activeFeature) runIds.add(id);
  }
  const runs = index.list().filter((r) => runIds.has(r.id));
  // '*' is every run at once. It is the default with more than one, because
  // several features in flight is the normal case and the first question is
  // always "what is running", not "what happened in this one session".
  const combined = selected === ALL_RUNS || (selected === null && runs.length > 1);
  const runId = combined
    ? ALL_RUNS
    : (selected && runs.some((r) => r.id === selected) ? selected : runs[0]?.id ?? null);
  selected = runId;

  const run = combined ? null : (runId ? index.runs.get(runId) : null);
  // Only the tail of the stream crosses IPC. A long run holds thousands of
  // events and the renderer never draws more than a screenful; shipping all of
  // them would make the UI slower the longer you watched, which is backwards.
  const allEvents = combined
    ? [...index.runs.entries()].filter(([id]) => runIds.has(id))
        .flatMap(([, r]) => r.events).sort((a, b) => a.ts.localeCompare(b.ts))
    : (run ? run.events : []);
  const events = allEvents.slice(-MAX_EVENTS_TO_RENDERER);

  return {
    project,
    workspaces: listWorkspaces(),
    eventsDir: project ? eventsDir(project) : null,
    runs,
    selected: runId,
    agents: (combined ? index.agents('*') : index.agents(runId))
      .filter((a) => runIds.has(a.runId)),
    tree: combined
      ? index.treeAll().filter((n) => runIds.has(n.id))
      : (runId ? index.tree(runId) : []),
    features,
    activeFeature,
    summary: combined ? index.summaryAll() : (runId ? index.summary(runId) : null),
    events,
    truncated: Math.max(0, allEvents.length - events.length),
    stats: tailer ? tailer.stats : null,
  };
}

/**
 * Worktrees, with their status. Status shells out per worktree, so it is kept
 * out of the 250ms snapshot loop by caching: a parallel run with eight workers
 * would otherwise spawn sixteen git processes four times a second.
 */
let workspaceCache = { at: 0, value: [] };
function listWorkspaces(force = false) {
  if (!project) return [];
  const now = Date.now();
  if (!force && now - workspaceCache.at < 2000) return workspaceCache.value;
  let value = [];
  try {
    if (tailer) tailer.adopt(watchedDirs(project));
    value = worktrees.list(project).map((entry) => {
      if (!entry.managed) return entry;
      try { return { ...entry, status: worktrees.status(project, entry.taskId) }; }
      catch (err) { return { ...entry, statusError: err.message }; }
    });
  } catch { value = []; }
  workspaceCache = { at: now, value };
  return value;
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

/**
 * Screenshot mode: ADE_SHOT=<dir> renders at an exact size, captures each tab
 * and exits. The window is the real one with the real wiring, so the image
 * cannot drift from the product the way a mock-up silently does.
 */
const SHOT_DIR = process.env.ADE_SHOT || null;
const SHOT_OUT = (process.env.ADE_SHOT_SIZE || '1920x1080').split('x').map(Number);
// An on-screen window is clamped to the display work area: asking for
// 1920x1080 produced 1904x993, close enough to look right and wrong enough to
// be the wrong aspect ratio. Offscreen rendering is not bound by the display,
// so the frame really is the size asked for and nothing is upscaled.
const SHOT_RENDER = SHOT_OUT;

function createWindow() {
  win = new BrowserWindow({
    width: SHOT_DIR ? SHOT_RENDER[0] : 1340,
    height: SHOT_DIR ? SHOT_RENDER[1] : 860,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#eef5fd',
    title: 'DAI ADE',
    show: !SHOT_DIR,
    useContentSize: true,
    // The frame ate 48px of the requested height (1920x1032 instead of 1080).
    // Capturing frameless makes the content area exactly the size asked for.
    frame: !SHOT_DIR,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      offscreen: Boolean(SHOT_DIR),
    },
  });
  win.removeMenu();
  // In screenshot mode the renderer has no devtools and no one watching, so a
  // thrown error would just produce a blank image. Surface it.
  if (SHOT_DIR) {
    win.webContents.on('console-message', (_e, level, message, line, source) => {
      if (level >= 2) console.error(`renderer: ${message} (${source}:${line})`);
    });
  }
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.on('did-finish-load', () => {
    send('ade:snapshot', snapshot());
    if (SHOT_DIR) captureTabs().catch((err) => { console.error(err); app.exit(1); });
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function captureTabs() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  // The renderer coalesces snapshots every 250ms and the flow timeline animates
  // open spans once a second; give it long enough to settle or the capture
  // catches a half-drawn frame.
  // Offscreen rendering paints on demand; without a frame rate it can sit idle
  // and capture an empty surface.
  win.webContents.setFrameRate(30);
  // The initial size is clamped to the display work area even offscreen, so it
  // is re-applied here after the window exists; setContentSize is not subject
  // to that clamp.
  win.setContentSize(SHOT_RENDER[0], SHOT_RENDER[1]);
  await wait(600);
  const actual = win.getContentSize();
  console.log(`content size: ${actual[0]}x${actual[1]}`);
  await wait(2500);

  for (const tab of ['observe', 'agents', 'workspaces']) {
    await win.webContents.executeJavaScript(
      `document.querySelector('.tab[data-view="${tab}"]').click(); true;`,
    );
    if (tab === 'agents') {
      await win.webContents.executeJavaScript(
        "(() => { const c = document.querySelector('.gnode, .agent'); if (c) c.click(); return true; })();",
      );
    }
    if (tab === 'workspaces') {
      // Select the first worktree so the diff pane has something in it.
      await win.webContents.executeJavaScript(
        `(() => { const c = document.querySelector('.ws:not(.main)');
           if (c) c.click(); return true; })();`,
      );
    }
    await wait(1200);
    await shoot(tab);
  }

  // One feature, selected. The other three tabs show everything at once, which
  // is the wrong picture for "how do I follow one feature while three others
  // run": that question is answered by the strip narrowing every pane together,
  // and only a shot of it selected shows that.
  await win.webContents.executeJavaScript(`(() => {
    document.querySelector('.tab[data-view="observe"]').click();
    const tabs = [...document.querySelectorAll('.ftab')];
    const pick = tabs.find((t) => t.textContent.includes('retry-budget')) || tabs[1];
    if (pick) pick.click();
    return Boolean(pick);
  })();`);
  await wait(1400);
  await shoot('feature');

  app.exit(0);
}

async function shoot(name) {
  win.webContents.invalidate();
  await wait(400);
  const image = await win.webContents.capturePage();
  const file = path.join(SHOT_DIR, `dai-ade-${name}.png`);
  fs.writeFileSync(file, image.toPNG());
  const size = image.getSize();
  console.log(`${file}  ${size.width}x${size.height}`);
}

/* ----------------------------------------------------------------- ipc --- */

ipcMain.handle('ade:getSnapshot', () => snapshot());

ipcMain.handle('ade:selectFeature', (_e, feature) => {
  activeFeature = feature ?? null;
  selected = null;   // the run selection belongs to the feature that was open
  return snapshot();
});

ipcMain.handle('ade:selectRun', (_e, runId) => {
  selected = runId;
  return snapshot();
});

/* --- worktrees: the workflow half ---------------------------------------- */

ipcMain.handle('ade:worktreeCreate', (_e, { taskId, objective }) => {
  const made = worktrees.create(project, taskId, { objective: objective || undefined });
  listWorkspaces(true);
  dirty = true;
  return made;
});

ipcMain.handle('ade:worktreeRemove', (_e, { taskId, force, deleteBranch }) => {
  const out = worktrees.remove(project, taskId, { force, deleteBranch });
  listWorkspaces(true);
  dirty = true;
  return out;
});

ipcMain.handle('ade:worktreeDiff', (_e, { taskId, file }) => worktrees.diff(project, taskId, { file }));

ipcMain.handle('ade:refreshWorkspaces', () => { listWorkspaces(true); dirty = true; return snapshot(); });

/* --- control plane: the only place this tool writes ----------------------- */

ipcMain.handle('ade:harnessState', async () => {
  try { return { ok: true, state: await mcp.harness.state(project) }; }
  catch (err) { return { ok: false, error: err.message }; }
});

ipcMain.handle('ade:decideGate', async (_e, { gate, approved }) => {
  try {
    const result = await mcp.harness.decideGate(project, gate, approved);
    recordDecision(gate, approved);
    // The harness writes its state file synchronously, so the bridge can pick
    // the decision up immediately and the banner clears without a round trip.
    syncHarness();
    return { ok: true, result };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

/**
 * Write the decision this tool just made into the run's own stream.
 *
 * Measured, not assumed: the harness records a rejected gate identically to one
 * nobody has answered - approved:false, still pending - so the bridge cannot
 * distinguish them and does not try. This is the ADE recording an action it
 * performed itself, on the span the bridge gave the request, so the timeline
 * shows the request closing rather than a decision about nothing.
 */
function recordDecision(gate, approved) {
  try {
    const ctx = bridge.correlate(project);
    const event = makeEvent({
      type: approved ? 'GATE_APPROVED' : 'GATE_REJECTED',
      run_id: ctx.runId,
      span_id: bridge.gateSpanId(gate),
      parent_span_id: ctx.parent,
      actor: { kind: 'root', id: 'ade' },
      payload: { source: 'ade.decision', gate, approved: Boolean(approved) },
    });
    if (bridge.appendEvents(project, ctx.runId, [event]) > 0) dirty = true;
  } catch (err) {
    // A decision that reached the harness but not the log is still a decision;
    // never fail the action over its own audit trail.
    console.warn('could not record the gate decision:', err.message);
  }
}

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
  // ADE_PROJECT exists for the screenshot pass and for a second window on a
  // different repository; otherwise the last project is the one you meant.
  const last = process.env.ADE_PROJECT || loadPrefs().lastProject;
  if (last && fs.existsSync(last)) watchProject(last);
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  if (tailer) tailer.stop();
  if (process.platform !== 'darwin') app.quit();
});
