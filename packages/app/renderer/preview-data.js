/** Renderer fixture: a real run captured from an event store, so the views can
 * be developed without launching Electron. Regenerate: npm run fixture
 */
window.ade = {
  _snap: {
    "project": "C:\\Users\\thdat\\AppData\\Local\\Temp\\ade-gate2",
    "workspaces": [
      {
        "path": "C:\\Users\\thdat\\AppData\\Local\\Temp\\ade-gate2",
        "branch": "main",
        "head": "d18ed3e9661032486f89681171bb7b1842bd4683",
        "bare": false,
        "detached": false,
        "locked": false,
        "isMain": true,
        "managed": false,
        "taskId": null,
        "contract": null
      }
    ],
    "eventsDir": "C:\\Users\\thdat\\AppData\\Local\\Temp\\ade-gate2\\.dai-ade\\events",
    "runs": [
      {
        "id": "run_harness_CFGCM8CK",
        "startedAt": "2026-10-05T16:13:15.915Z",
        "endedAt": "2026-10-05T16:13:15.916Z",
        "durationMs": 1,
        "events": 2,
        "spans": 2,
        "openSpans": 2,
        "tools": 0,
        "blocked": 0,
        "failed": 0,
        "workers": 0,
        "evidence": 0,
        "cost": 0
      }
    ],
    "selected": "run_harness_CFGCM8CK",
    "tree": [
      {
        "id": "sp_gate_VJS0G9WZ36",
        "actor": {
          "kind": "root",
          "id": "gate:gate1_brd"
        },
        "type": "GATE_REQUESTED",
        "status": "open",
        "openedAt": "2026-10-05T16:13:15.915Z",
        "closedAt": null,
        "durationMs": null,
        "instantaneous": false,
        "eventCount": 1,
        "children": []
      },
      {
        "id": "sp_ph_XRHMFSHHBT",
        "actor": {
          "kind": "root",
          "id": "phase:interpret"
        },
        "type": "PHASE_ENTERED",
        "status": "open",
        "openedAt": "2026-10-05T16:13:15.916Z",
        "closedAt": null,
        "durationMs": null,
        "instantaneous": false,
        "eventCount": 1,
        "children": []
      }
    ],
    "summary": {
      "id": "run_harness_CFGCM8CK",
      "startedAt": "2026-10-05T16:13:15.915Z",
      "endedAt": "2026-10-05T16:13:15.916Z",
      "durationMs": 1,
      "events": 2,
      "spans": 2,
      "openSpans": 2,
      "tools": 0,
      "blocked": 0,
      "failed": 0,
      "workers": 0,
      "evidence": 0,
      "cost": 0
    },
    "events": [
      {
        "v": 1,
        "id": "HZKZAJN3CSDDB41NWRW0Z98FM6",
        "ts": "2026-10-05T16:13:15.916Z",
        "run_id": "run_harness_CFGCM8CK",
        "span_id": "sp_ph_XRHMFSHHBT",
        "parent_span_id": null,
        "actor": {
          "kind": "root",
          "id": "phase:interpret"
        },
        "type": "PHASE_ENTERED",
        "payload": {
          "source": "harness.pipeline",
          "phase": "interpret",
          "status": "running",
          "mode": "FULL_BUILD",
          "goal": "g"
        }
      },
      {
        "v": 1,
        "id": "H56EH1Z170P3HP3NZWNYTNMW8C",
        "ts": "2026-10-05T16:13:15.915Z",
        "run_id": "run_harness_CFGCM8CK",
        "span_id": "sp_gate_VJS0G9WZ36",
        "parent_span_id": null,
        "actor": {
          "kind": "root",
          "id": "gate:gate1_brd"
        },
        "type": "GATE_REQUESTED",
        "payload": {
          "source": "harness.pipeline",
          "gate": "gate1_brd",
          "approved": false,
          "summary": "ready"
        }
      }
    ],
    "truncated": 0,
    "stats": {
      "files": 1
    }
  },
  _diffs: {},
  getSnapshot(){ return Promise.resolve(this._snap); },
  selectRun(){ return Promise.resolve(this._snap); },
  openProject(){ return Promise.resolve(this._snap); },
  refreshWorkspaces(){ return Promise.resolve(this._snap); },
  worktreeDiff(taskId){ return Promise.resolve(this._diffs[taskId] || ''); },
  worktreeCreate(){ return Promise.reject(new Error('the preview is read-only')); },
  worktreeRemove(){ return Promise.reject(new Error('the preview is read-only')); },
  harnessState(){ return Promise.resolve({ ok:false, error:'the preview is read-only' }); },
  decideGate(){ return Promise.resolve({ ok:false, error:'the preview is read-only' }); },
  onSnapshot(){ return () => {}; },
  onInvalid(){ return () => {}; },
};
