/** Renderer fixture: a real run captured from an event store, so the views can
 * be developed without launching Electron. Regenerate: npm run fixture
 */
window.ade = {
  _snap: {
    "project": "C:\\Users\\thdat\\AppData\\Local\\Temp\\ade-e2e2",
    "eventsDir": "C:\\Users\\thdat\\AppData\\Local\\Temp\\ade-e2e2\\.dai-ade\\events",
    "runs": [
      {
        "id": "run_3D0P2N3D0G",
        "startedAt": "2026-10-05T07:57:01.527Z",
        "endedAt": "2026-10-05T07:57:03.002Z",
        "durationMs": 1475,
        "events": 11,
        "spans": 6,
        "openSpans": 1,
        "tools": 2,
        "blocked": 0,
        "failed": 1,
        "workers": 1,
        "evidence": 0,
        "cost": 0
      }
    ],
    "selected": "run_3D0P2N3D0G",
    "tree": [
      {
        "id": "sp_root",
        "actor": {
          "kind": "root",
          "id": "s2"
        },
        "type": "RUN_STARTED",
        "status": "open",
        "openedAt": "2026-10-05T07:57:01.527Z",
        "closedAt": null,
        "durationMs": null,
        "eventCount": 1,
        "children": [
          {
            "id": "sp_turn_WCS6SGKZHF",
            "actor": {
              "kind": "root",
              "id": "s2"
            },
            "type": "TURN_STARTED",
            "status": "closed",
            "openedAt": "2026-10-05T07:57:01.673Z",
            "closedAt": "2026-10-05T07:57:02.126Z",
            "durationMs": 453,
            "eventCount": 2,
            "children": [
              {
                "id": "sp_t_R20G24R20G22",
                "actor": {
                  "kind": "tool",
                  "id": "Read"
                },
                "type": "TOOL_PROPOSED",
                "status": "closed",
                "openedAt": "2026-10-05T07:57:01.820Z",
                "closedAt": "2026-10-05T07:57:01.978Z",
                "durationMs": 158,
                "eventCount": 2,
                "children": []
              }
            ]
          },
          {
            "id": "sp_turn_7JRYPA2MQ3",
            "actor": {
              "kind": "root",
              "id": "s2"
            },
            "type": "TURN_STARTED",
            "status": "closed",
            "openedAt": "2026-10-05T07:57:02.281Z",
            "closedAt": "2026-10-05T07:57:03.002Z",
            "durationMs": 721,
            "eventCount": 2,
            "children": [
              {
                "id": "sp_w_undefined37W",
                "actor": {
                  "kind": "worker",
                  "id": "sub-9",
                  "tier": "Explore"
                },
                "type": "WORKER_SPAWNED",
                "status": "closed",
                "openedAt": "2026-10-05T07:57:02.419Z",
                "closedAt": "2026-10-05T07:57:02.859Z",
                "durationMs": 440,
                "eventCount": 2,
                "children": []
              },
              {
                "id": "sp_t_undefined35X",
                "actor": {
                  "kind": "tool",
                  "id": "Bash"
                },
                "type": "TOOL_PROPOSED",
                "status": "failed",
                "openedAt": "2026-10-05T07:57:02.562Z",
                "closedAt": "2026-10-05T07:57:02.703Z",
                "durationMs": 141,
                "eventCount": 2,
                "children": []
              }
            ]
          }
        ]
      }
    ],
    "summary": {
      "id": "run_3D0P2N3D0G",
      "startedAt": "2026-10-05T07:57:01.527Z",
      "endedAt": "2026-10-05T07:57:03.002Z",
      "durationMs": 1475,
      "events": 11,
      "spans": 6,
      "openSpans": 1,
      "tools": 2,
      "blocked": 0,
      "failed": 1,
      "workers": 1,
      "evidence": 0,
      "cost": 0
    },
    "events": [
      {
        "v": 1,
        "id": "01M45H1VPQEWMQTN1T8J2YGEZE",
        "ts": "2026-10-05T07:57:01.527Z",
        "run_id": "run_3D0P2N3D0G",
        "span_id": "sp_root",
        "parent_span_id": null,
        "actor": {
          "kind": "root",
          "id": "s2"
        },
        "type": "RUN_STARTED",
        "payload": {
          "hook": "SessionStart",
          "cwd": "C:/Users/thdat/AppData/Local/Temp/ade-e2e2"
        }
      },
      {
        "v": 1,
        "id": "01M45H1VV97ZHV7YR67SV2QA25",
        "ts": "2026-10-05T07:57:01.673Z",
        "run_id": "run_3D0P2N3D0G",
        "span_id": "sp_turn_WCS6SGKZHF",
        "parent_span_id": "sp_root",
        "actor": {
          "kind": "root",
          "id": "s2"
        },
        "type": "TURN_STARTED",
        "payload": {
          "hook": "UserPromptSubmit",
          "cwd": "C:/Users/thdat/AppData/Local/Temp/ade-e2e2",
          "prompt": "turn one"
        }
      },
      {
        "v": 1,
        "id": "01M45H1VZWM151H41EYBBPY4RS",
        "ts": "2026-10-05T07:57:01.820Z",
        "run_id": "run_3D0P2N3D0G",
        "span_id": "sp_t_R20G24R20G22",
        "parent_span_id": "sp_turn_WCS6SGKZHF",
        "actor": {
          "kind": "tool",
          "id": "Read"
        },
        "type": "TOOL_PROPOSED",
        "payload": {
          "hook": "PreToolUse",
          "tool": "Read",
          "input": {
            "f": "a.ts"
          },
          "cwd": "C:/Users/thdat/AppData/Local/Temp/ade-e2e2"
        }
      },
      {
        "v": 1,
        "id": "01M45H1W4T77NJQN1X5KD4JF90",
        "ts": "2026-10-05T07:57:01.978Z",
        "run_id": "run_3D0P2N3D0G",
        "span_id": "sp_t_R20G24R20G22",
        "parent_span_id": "sp_turn_WCS6SGKZHF",
        "actor": {
          "kind": "tool",
          "id": "Read"
        },
        "type": "TOOL_EXECUTED",
        "payload": {
          "hook": "PostToolUse",
          "tool": "Read",
          "input": {
            "f": "a.ts"
          },
          "response": {
            "ok": 1
          },
          "cwd": "C:/Users/thdat/AppData/Local/Temp/ade-e2e2"
        }
      },
      {
        "v": 1,
        "id": "01M45H1W9E33115J5BQH3JK6G2",
        "ts": "2026-10-05T07:57:02.126Z",
        "run_id": "run_3D0P2N3D0G",
        "span_id": "sp_turn_WCS6SGKZHF",
        "parent_span_id": "sp_root",
        "actor": {
          "kind": "root",
          "id": "s2"
        },
        "type": "TURN_ENDED",
        "payload": {
          "hook": "Stop",
          "cwd": "C:/Users/thdat/AppData/Local/Temp/ade-e2e2"
        }
      },
      {
        "v": 1,
        "id": "01M45H1WE9151F63JXXBGWW0YB",
        "ts": "2026-10-05T07:57:02.281Z",
        "run_id": "run_3D0P2N3D0G",
        "span_id": "sp_turn_7JRYPA2MQ3",
        "parent_span_id": "sp_root",
        "actor": {
          "kind": "root",
          "id": "s2"
        },
        "type": "TURN_STARTED",
        "payload": {
          "hook": "UserPromptSubmit",
          "cwd": "C:/Users/thdat/AppData/Local/Temp/ade-e2e2",
          "prompt": "turn two"
        }
      },
      {
        "v": 1,
        "id": "01M45H1WJK8RK7K7V72TVCA7Z6",
        "ts": "2026-10-05T07:57:02.419Z",
        "run_id": "run_3D0P2N3D0G",
        "span_id": "sp_w_undefined37W",
        "parent_span_id": "sp_turn_7JRYPA2MQ3",
        "actor": {
          "kind": "worker",
          "id": "sub-9",
          "tier": "Explore"
        },
        "type": "WORKER_SPAWNED",
        "payload": {
          "hook": "SubagentStart",
          "cwd": "C:/Users/thdat/AppData/Local/Temp/ade-e2e2"
        }
      },
      {
        "v": 1,
        "id": "01M45H1WQ2HVBJ0C821W78PFVD",
        "ts": "2026-10-05T07:57:02.562Z",
        "run_id": "run_3D0P2N3D0G",
        "span_id": "sp_t_undefined35X",
        "parent_span_id": "sp_turn_7JRYPA2MQ3",
        "actor": {
          "kind": "tool",
          "id": "Bash"
        },
        "type": "TOOL_PROPOSED",
        "payload": {
          "hook": "PreToolUse",
          "tool": "Bash",
          "input": {
            "command": "bad"
          },
          "cwd": "C:/Users/thdat/AppData/Local/Temp/ade-e2e2"
        }
      },
      {
        "v": 1,
        "id": "01M45H1WVFQXQPBMTD3RG06N6A",
        "ts": "2026-10-05T07:57:02.703Z",
        "run_id": "run_3D0P2N3D0G",
        "span_id": "sp_t_undefined35X",
        "parent_span_id": "sp_turn_7JRYPA2MQ3",
        "actor": {
          "kind": "tool",
          "id": "Bash"
        },
        "type": "TOOL_FAILED",
        "payload": {
          "hook": "PostToolUse",
          "tool": "Bash",
          "input": {
            "command": "bad"
          },
          "response": {
            "is_error": true
          },
          "cwd": "C:/Users/thdat/AppData/Local/Temp/ade-e2e2"
        }
      },
      {
        "v": 1,
        "id": "01M45H1X0BHCQXVAXPFC6VSVQ5",
        "ts": "2026-10-05T07:57:02.859Z",
        "run_id": "run_3D0P2N3D0G",
        "span_id": "sp_w_undefined37W",
        "parent_span_id": "sp_turn_7JRYPA2MQ3",
        "actor": {
          "kind": "worker",
          "id": "sub-9"
        },
        "type": "WORKER_DELIVERED",
        "payload": {
          "hook": "SubagentStop",
          "cwd": "C:/Users/thdat/AppData/Local/Temp/ade-e2e2"
        }
      },
      {
        "v": 1,
        "id": "01M45H1X4THY0RT2PZ46FF0RTJ",
        "ts": "2026-10-05T07:57:03.002Z",
        "run_id": "run_3D0P2N3D0G",
        "span_id": "sp_turn_7JRYPA2MQ3",
        "parent_span_id": "sp_root",
        "actor": {
          "kind": "root",
          "id": "s2"
        },
        "type": "TURN_ENDED",
        "payload": {
          "hook": "Stop",
          "cwd": "C:/Users/thdat/AppData/Local/Temp/ade-e2e2"
        }
      }
    ],
    "truncated": 0,
    "stats": {
      "files": 1
    }
  },
  getSnapshot(){ return Promise.resolve(this._snap); },
  selectRun(){ return Promise.resolve(this._snap); },
  openProject(){ return Promise.resolve(this._snap); },
  onSnapshot(){ return () => {}; },
  onInvalid(){ return () => {}; },
};
