/** Renderer fixture: a real run captured from an event store, so the views can
 * be developed without launching Electron. Regenerate: npm run fixture
 */
window.ade = {
  _snap: {
    "project": "C:\\Users\\thdat\\AppData\\Local\\Temp\\ade-ui",
    "workspaces": [
      {
        "path": "C:\\Users\\thdat\\AppData\\Local\\Temp\\ade-ui",
        "branch": "main",
        "head": "be8589313efeffe815af8637bb658edcf16b13e0",
        "bare": false,
        "detached": false,
        "locked": false,
        "isMain": true,
        "managed": false,
        "taskId": null,
        "contract": null
      },
      {
        "path": "C:\\Users\\thdat\\AppData\\Local\\Temp\\ade-ui\\.worktrees\\idempotency",
        "branch": "parallel/idempotency",
        "head": "be8589313efeffe815af8637bb658edcf16b13e0",
        "bare": false,
        "detached": false,
        "locked": false,
        "isMain": false,
        "managed": true,
        "taskId": "idempotency",
        "contract": {
          "task_id": "idempotency",
          "objective": "make charge idempotent",
          "outputs": [],
          "forbidden": [],
          "base_commit": "be8589313efeffe815af8637bb658edcf16b13e0",
          "created_at": "2026-10-05T10:02:48Z"
        },
        "status": {
          "taskId": "idempotency",
          "path": "C:\\Users\\thdat\\AppData\\Local\\Temp\\ade-ui\\.worktrees\\idempotency",
          "branch": "parallel/idempotency",
          "base": "be8589313efeffe815af8637bb658edcf16b13e0",
          "contract": {
            "task_id": "idempotency",
            "objective": "make charge idempotent",
            "outputs": [],
            "forbidden": [],
            "base_commit": "be8589313efeffe815af8637bb658edcf16b13e0",
            "created_at": "2026-10-05T10:02:48Z"
          },
          "uncommitted": [
            {
              "state": "??",
              "file": "CONTRACT.json"
            }
          ],
          "committed": [],
          "ahead": 0
        }
      },
      {
        "path": "C:\\Users\\thdat\\AppData\\Local\\Temp\\ade-ui\\.worktrees\\retry-budget",
        "branch": "parallel/retry-budget",
        "head": "be8589313efeffe815af8637bb658edcf16b13e0",
        "bare": false,
        "detached": false,
        "locked": false,
        "isMain": false,
        "managed": true,
        "taskId": "retry-budget",
        "contract": {
          "task_id": "retry-budget",
          "objective": "cap declined-card retries at two",
          "outputs": [],
          "forbidden": [],
          "base_commit": "be8589313efeffe815af8637bb658edcf16b13e0",
          "created_at": "2026-10-05T10:02:47Z"
        },
        "status": {
          "taskId": "retry-budget",
          "path": "C:\\Users\\thdat\\AppData\\Local\\Temp\\ade-ui\\.worktrees\\retry-budget",
          "branch": "parallel/retry-budget",
          "base": "be8589313efeffe815af8637bb658edcf16b13e0",
          "contract": {
            "task_id": "retry-budget",
            "objective": "cap declined-card retries at two",
            "outputs": [],
            "forbidden": [],
            "base_commit": "be8589313efeffe815af8637bb658edcf16b13e0",
            "created_at": "2026-10-05T10:02:47Z"
          },
          "uncommitted": [
            {
              "state": "M",
              "file": "billing.js"
            },
            {
              "state": "??",
              "file": "CONTRACT.json"
            }
          ],
          "committed": [],
          "ahead": 0
        }
      }
    ],
    "eventsDir": "C:\\Users\\thdat\\AppData\\Local\\Temp\\ade-ui\\.dai-ade\\events",
    "runs": [
      {
        "id": "run_harness_B2KDRK8E",
        "startedAt": "2026-10-05T09:52:49.083Z",
        "endedAt": "2026-10-05T12:00:09Z",
        "durationMs": 7639917,
        "events": 7,
        "spans": 7,
        "openSpans": 2,
        "tools": 0,
        "blocked": 2,
        "failed": 0,
        "workers": 0,
        "evidence": 0,
        "cost": 0
      }
    ],
    "selected": "run_harness_B2KDRK8E",
    "tree": [
      {
        "id": "sp_gate_VJS0G9WZ36",
        "actor": {
          "kind": "root",
          "id": "gate:gate1_brd"
        },
        "type": "GATE_REQUESTED",
        "status": "closed",
        "openedAt": "2026-10-05T09:52:49.083Z",
        "closedAt": "2026-10-05T09:52:49.083Z",
        "durationMs": 0,
        "instantaneous": true,
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
        "status": "closed",
        "openedAt": "2026-10-05T10:02:49.083Z",
        "closedAt": "2026-10-05T10:02:49.083Z",
        "durationMs": 0,
        "instantaneous": true,
        "eventCount": 1,
        "children": []
      },
      {
        "id": "sp_ph_S6F1N9Z1AJ",
        "actor": {
          "kind": "root",
          "id": "phase:define"
        },
        "type": "PHASE_ENTERED",
        "status": "closed",
        "openedAt": "2026-10-05T10:02:49.083Z",
        "closedAt": "2026-10-05T10:02:49.083Z",
        "durationMs": 0,
        "instantaneous": true,
        "eventCount": 1,
        "children": []
      },
      {
        "id": "sp_ph_Y1C31SQWN3",
        "actor": {
          "kind": "root",
          "id": "phase:build"
        },
        "type": "PHASE_ENTERED",
        "status": "open",
        "openedAt": "2026-10-05T10:02:49.083Z",
        "closedAt": null,
        "durationMs": null,
        "instantaneous": false,
        "eventCount": 1,
        "children": []
      },
      {
        "id": "sp_gate_6T92PR5T9M",
        "actor": {
          "kind": "root",
          "id": "gate:gate3_build"
        },
        "type": "GATE_REQUESTED",
        "status": "open",
        "openedAt": "2026-10-05T10:02:49.083Z",
        "closedAt": null,
        "durationMs": null,
        "instantaneous": false,
        "eventCount": 1,
        "children": []
      },
      {
        "id": "sp_blk_Z0J12M6SQ1",
        "actor": {
          "kind": "tool",
          "id": "Bash"
        },
        "type": "TOOL_PROPOSED",
        "status": "failed",
        "openedAt": "2026-10-05T12:00:03Z",
        "closedAt": "2026-10-05T12:00:03Z",
        "durationMs": 0,
        "instantaneous": true,
        "eventCount": 1,
        "children": []
      },
      {
        "id": "sp_blk_3ZX1146RH8",
        "actor": {
          "kind": "tool",
          "id": "Bash"
        },
        "type": "TOOL_PROPOSED",
        "status": "failed",
        "openedAt": "2026-10-05T12:00:09Z",
        "closedAt": "2026-10-05T12:00:09Z",
        "durationMs": 0,
        "instantaneous": true,
        "eventCount": 1,
        "children": []
      }
    ],
    "summary": {
      "id": "run_harness_B2KDRK8E",
      "startedAt": "2026-10-05T09:52:49.083Z",
      "endedAt": "2026-10-05T12:00:09Z",
      "durationMs": 7639917,
      "events": 7,
      "spans": 7,
      "openSpans": 2,
      "tools": 0,
      "blocked": 2,
      "failed": 0,
      "workers": 0,
      "evidence": 0,
      "cost": 0
    },
    "events": [
      {
        "v": 1,
        "id": "H7K04J3TAZ83JP6RV8B1P51WDE",
        "ts": "2026-10-05T12:00:03Z",
        "run_id": "run_harness_B2KDRK8E",
        "span_id": "sp_blk_Z0J12M6SQ1",
        "parent_span_id": null,
        "actor": {
          "kind": "tool",
          "id": "Bash"
        },
        "type": "TOOL_BLOCKED",
        "payload": {
          "source": "harness.telemetry",
          "tool": "Bash",
          "pattern": "rm[[:space:]]+-rf",
          "mode": "strict",
          "severity": "deny"
        }
      },
      {
        "v": 1,
        "id": "H5Y984WCJDBK7D85X2G13EYB3Q",
        "ts": "2026-10-05T12:00:09Z",
        "run_id": "run_harness_B2KDRK8E",
        "span_id": "sp_blk_3ZX1146RH8",
        "parent_span_id": null,
        "actor": {
          "kind": "tool",
          "id": "Bash"
        },
        "type": "TOOL_BLOCKED",
        "payload": {
          "source": "harness.telemetry",
          "tool": "Bash",
          "pattern": "git[[:space:]]+push[[:space:]]+--force",
          "mode": "strict",
          "severity": "deny"
        }
      },
      {
        "v": 1,
        "id": "HWMD1E3TN3KYE25M72DQ8FSZEB",
        "ts": "2026-10-05T10:02:49.083Z",
        "run_id": "run_harness_B2KDRK8E",
        "span_id": "sp_ph_XRHMFSHHBT",
        "parent_span_id": null,
        "actor": {
          "kind": "root",
          "id": "phase:interpret"
        },
        "type": "PHASE_EXITED",
        "payload": {
          "source": "harness.pipeline",
          "phase": "interpret",
          "status": "passed",
          "mode": "FULL_BUILD",
          "goal": "cap declined-card retries"
        }
      },
      {
        "v": 1,
        "id": "HCEJHDC2E8XQSQK4ZGJ1V7ZRAX",
        "ts": "2026-10-05T10:02:49.083Z",
        "run_id": "run_harness_B2KDRK8E",
        "span_id": "sp_ph_S6F1N9Z1AJ",
        "parent_span_id": null,
        "actor": {
          "kind": "root",
          "id": "phase:define"
        },
        "type": "PHASE_EXITED",
        "payload": {
          "source": "harness.pipeline",
          "phase": "define",
          "status": "passed",
          "mode": "FULL_BUILD",
          "goal": "cap declined-card retries"
        }
      },
      {
        "v": 1,
        "id": "HME9MT202THSA2RYJFK3R1Y4FQ",
        "ts": "2026-10-05T10:02:49.083Z",
        "run_id": "run_harness_B2KDRK8E",
        "span_id": "sp_ph_Y1C31SQWN3",
        "parent_span_id": null,
        "actor": {
          "kind": "root",
          "id": "phase:build"
        },
        "type": "PHASE_ENTERED",
        "payload": {
          "source": "harness.pipeline",
          "phase": "build",
          "status": "running",
          "mode": "FULL_BUILD",
          "goal": "cap declined-card retries"
        }
      },
      {
        "v": 1,
        "id": "H2N7PGRBTSZ41AKCXR23ZCX5HH",
        "ts": "2026-10-05T09:52:49.083Z",
        "run_id": "run_harness_B2KDRK8E",
        "span_id": "sp_gate_VJS0G9WZ36",
        "parent_span_id": null,
        "actor": {
          "kind": "root",
          "id": "gate:gate1_brd"
        },
        "type": "GATE_APPROVED",
        "payload": {
          "source": "harness.pipeline",
          "gate": "gate1_brd",
          "approved": true,
          "summary": "BRD ready"
        }
      },
      {
        "v": 1,
        "id": "H4K3J1E6N48K2CT5RMF3SZ2A4J",
        "ts": "2026-10-05T10:02:49.083Z",
        "run_id": "run_harness_B2KDRK8E",
        "span_id": "sp_gate_6T92PR5T9M",
        "parent_span_id": null,
        "actor": {
          "kind": "root",
          "id": "gate:gate3_build"
        },
        "type": "GATE_REQUESTED",
        "payload": {
          "source": "harness.pipeline",
          "gate": "gate3_build",
          "approved": false,
          "pending": true
        }
      }
    ],
    "truncated": 0,
    "stats": {
      "files": 1
    }
  },
  _diffs: {
    "idempotency": "",
    "retry-budget": "diff --git a/billing.js b/billing.js\nindex 15026c2..bef178b 100644\n--- a/billing.js\n+++ b/billing.js\n@@ -1 +1,2 @@\n-export function charge(){}\n+const MAX_RETRIES = 2;\n+export function charge(){ /* retry */ }\n"
  },
  getSnapshot(){ return Promise.resolve(this._snap); },
  selectRun(){ return Promise.resolve(this._snap); },
  openProject(){ return Promise.resolve(this._snap); },
  refreshWorkspaces(){ return Promise.resolve(this._snap); },
  worktreeDiff(taskId){ return Promise.resolve(this._diffs[taskId] || ''); },
  worktreeCreate(){ return Promise.reject(new Error('the preview is read-only')); },
  worktreeRemove(){ return Promise.reject(new Error('the preview is read-only')); },
  harnessState(){ return Promise.resolve({ ok:false, error:'the preview is read-only' }); },
  approveGate(){ return Promise.resolve({ ok:false, error:'the preview is read-only' }); },
  onSnapshot(){ return () => {}; },
  onInvalid(){ return () => {}; },
};
