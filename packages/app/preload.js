/**
 * The only bridge between the renderer and anything privileged.
 *
 * Context isolation is on and nodeIntegration is off, so the renderer cannot
 * touch the filesystem even by accident. An ADE reads agent output — tool
 * arguments, file contents, error text — which is untrusted data from the
 * renderer's point of view, and the cheapest way to keep it from becoming
 * executable is to give that process no capability to execute anything.
 */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ade', {
  getSnapshot: () => ipcRenderer.invoke('ade:getSnapshot'),
  selectRun: (runId) => ipcRenderer.invoke('ade:selectRun', runId),
  openProject: () => ipcRenderer.invoke('ade:openProject'),

  // The workflow half.
  worktreeCreate: (taskId, objective) => ipcRenderer.invoke('ade:worktreeCreate', { taskId, objective }),
  worktreeRemove: (taskId, force, deleteBranch) =>
    ipcRenderer.invoke('ade:worktreeRemove', { taskId, force, deleteBranch }),
  worktreeDiff: (taskId, file) => ipcRenderer.invoke('ade:worktreeDiff', { taskId, file }),
  refreshWorkspaces: () => ipcRenderer.invoke('ade:refreshWorkspaces'),

  // The only write path in the tool. Everything else observes.
  harnessState: () => ipcRenderer.invoke('ade:harnessState'),
  decideGate: (gate, approved) => ipcRenderer.invoke('ade:decideGate', { gate, approved }),
  onSnapshot: (fn) => {
    const handler = (_e, snap) => fn(snap);
    ipcRenderer.on('ade:snapshot', handler);
    return () => ipcRenderer.off('ade:snapshot', handler);
  },
  onInvalid: (fn) => {
    const handler = (_e, d) => fn(d);
    ipcRenderer.on('ade:invalid', handler);
    return () => ipcRenderer.off('ade:invalid', handler);
  },
});
