/** Renderer fixture: a real run captured from an event store, so the views can
 * be developed without launching Electron. Regenerate: npm run fixture
 */
window.ade = {
  _snap: {
    "project": "C:\\Users\\thdat\\AppData\\Local\\Temp\\dai-ade-demo",
    "workspaces": [
      {
        "path": "C:\\Users\\thdat\\AppData\\Local\\Temp\\dai-ade-demo",
        "branch": "main",
        "head": "1049afac3050d24d16451d014b00cb047a0453ca",
        "bare": false,
        "detached": false,
        "locked": false,
        "isMain": true,
        "managed": false,
        "taskId": null,
        "contract": null
      },
      {
        "path": "C:\\Users\\thdat\\AppData\\Local\\Temp\\dai-ade-demo\\.worktrees\\idempotent-charge",
        "branch": "parallel/idempotent-charge",
        "head": "246f844ee2c3af7a0324d05f29b239c4daa1a613",
        "bare": false,
        "detached": false,
        "locked": false,
        "isMain": false,
        "managed": true,
        "taskId": "idempotent-charge",
        "contract": {
          "task_id": "idempotent-charge",
          "objective": "Make charge idempotent with a request key",
          "outputs": [],
          "forbidden": [],
          "base_commit": "1049afac3050d24d16451d014b00cb047a0453ca",
          "created_at": "2026-10-14T06:08:59Z"
        },
        "status": {
          "taskId": "idempotent-charge",
          "path": "C:\\Users\\thdat\\AppData\\Local\\Temp\\dai-ade-demo\\.worktrees\\idempotent-charge",
          "branch": "parallel/idempotent-charge",
          "base": "1049afac3050d24d16451d014b00cb047a0453ca",
          "contract": {
            "task_id": "idempotent-charge",
            "objective": "Make charge idempotent with a request key",
            "outputs": [],
            "forbidden": [],
            "base_commit": "1049afac3050d24d16451d014b00cb047a0453ca",
            "created_at": "2026-10-14T06:08:59Z"
          },
          "uncommitted": [
            {
              "state": "M",
              "file": "src/billing/charge.ts"
            }
          ],
          "committed": [
            {
              "state": "A",
              "file": "CONTRACT.json"
            },
            {
              "state": "M",
              "file": "src/billing/charge.ts"
            }
          ],
          "ahead": 1
        }
      },
      {
        "path": "C:\\Users\\thdat\\AppData\\Local\\Temp\\dai-ade-demo\\.worktrees\\retry-budget",
        "branch": "parallel/retry-budget",
        "head": "1dadbe44944bd4b8ac04b2ba390fc868b6ba7214",
        "bare": false,
        "detached": false,
        "locked": false,
        "isMain": false,
        "managed": true,
        "taskId": "retry-budget",
        "contract": {
          "task_id": "retry-budget",
          "objective": "Cap declined-card retries at two",
          "outputs": [],
          "forbidden": [],
          "base_commit": "1049afac3050d24d16451d014b00cb047a0453ca",
          "created_at": "2026-10-14T06:08:58Z"
        },
        "status": {
          "taskId": "retry-budget",
          "path": "C:\\Users\\thdat\\AppData\\Local\\Temp\\dai-ade-demo\\.worktrees\\retry-budget",
          "branch": "parallel/retry-budget",
          "base": "1049afac3050d24d16451d014b00cb047a0453ca",
          "contract": {
            "task_id": "retry-budget",
            "objective": "Cap declined-card retries at two",
            "outputs": [],
            "forbidden": [],
            "base_commit": "1049afac3050d24d16451d014b00cb047a0453ca",
            "created_at": "2026-10-14T06:08:58Z"
          },
          "uncommitted": [
            {
              "state": "M",
              "file": "src/billing/retry.ts"
            }
          ],
          "committed": [
            {
              "state": "A",
              "file": "CONTRACT.json"
            },
            {
              "state": "M",
              "file": "src/billing/retry.ts"
            }
          ],
          "ahead": 1
        }
      },
      {
        "path": "C:\\Users\\thdat\\AppData\\Local\\Temp\\dai-ade-demo\\.worktrees\\search-ranking",
        "branch": "parallel/search-ranking",
        "head": "1049afac3050d24d16451d014b00cb047a0453ca",
        "bare": false,
        "detached": false,
        "locked": false,
        "isMain": false,
        "managed": true,
        "taskId": "search-ranking",
        "contract": {
          "task_id": "search-ranking",
          "objective": "Fuse keyword and semantic ranking",
          "outputs": [],
          "forbidden": [],
          "base_commit": "1049afac3050d24d16451d014b00cb047a0453ca",
          "created_at": "2026-10-14T06:09:01Z"
        },
        "status": {
          "taskId": "search-ranking",
          "path": "C:\\Users\\thdat\\AppData\\Local\\Temp\\dai-ade-demo\\.worktrees\\search-ranking",
          "branch": "parallel/search-ranking",
          "base": "1049afac3050d24d16451d014b00cb047a0453ca",
          "contract": {
            "task_id": "search-ranking",
            "objective": "Fuse keyword and semantic ranking",
            "outputs": [],
            "forbidden": [],
            "base_commit": "1049afac3050d24d16451d014b00cb047a0453ca",
            "created_at": "2026-10-14T06:09:01Z"
          },
          "uncommitted": [
            {
              "state": "M",
              "file": "src/search/index.ts"
            },
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
        "path": "C:\\Users\\thdat\\AppData\\Local\\Temp\\dai-ade-demo\\.worktrees\\session-rotation",
        "branch": "parallel/session-rotation",
        "head": "1049afac3050d24d16451d014b00cb047a0453ca",
        "bare": false,
        "detached": false,
        "locked": false,
        "isMain": false,
        "managed": true,
        "taskId": "session-rotation",
        "contract": {
          "task_id": "session-rotation",
          "objective": "Rotate session tokens every 15 minutes",
          "outputs": [],
          "forbidden": [],
          "base_commit": "1049afac3050d24d16451d014b00cb047a0453ca",
          "created_at": "2026-10-14T06:09:00Z"
        },
        "status": {
          "taskId": "session-rotation",
          "path": "C:\\Users\\thdat\\AppData\\Local\\Temp\\dai-ade-demo\\.worktrees\\session-rotation",
          "branch": "parallel/session-rotation",
          "base": "1049afac3050d24d16451d014b00cb047a0453ca",
          "contract": {
            "task_id": "session-rotation",
            "objective": "Rotate session tokens every 15 minutes",
            "outputs": [],
            "forbidden": [],
            "base_commit": "1049afac3050d24d16451d014b00cb047a0453ca",
            "created_at": "2026-10-14T06:09:00Z"
          },
          "uncommitted": [
            {
              "state": "M",
              "file": "src/auth/session.ts"
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
    "eventsDir": "C:\\Users\\thdat\\AppData\\Local\\Temp\\dai-ade-demo\\.dai-ade\\events",
    "runs": [
      {
        "id": "run_88GC4QQKA2",
        "startedAt": "2026-10-14T05:30:05.396Z",
        "endedAt": "2026-10-14T05:30:48.396Z",
        "durationMs": 43000,
        "events": 21,
        "spans": 10,
        "openSpans": 1,
        "tools": 6,
        "blocked": 0,
        "failed": 1,
        "workers": 1,
        "evidence": 0,
        "cost": 0
      },
      {
        "id": "run_X5M1ZRBY7V",
        "startedAt": "2026-10-14T05:18:52.396Z",
        "endedAt": "2026-10-14T05:19:26.396Z",
        "durationMs": 34000,
        "events": 15,
        "spans": 8,
        "openSpans": 1,
        "tools": 3,
        "blocked": 0,
        "failed": 0,
        "workers": 2,
        "evidence": 0,
        "cost": 0
      },
      {
        "id": "run_8JM3W4A66V",
        "startedAt": "2026-10-14T05:11:30.396Z",
        "endedAt": "2026-10-14T05:11:49.396Z",
        "durationMs": 19000,
        "events": 9,
        "spans": 5,
        "openSpans": 1,
        "tools": 2,
        "blocked": 0,
        "failed": 0,
        "workers": 1,
        "evidence": 0,
        "cost": 0
      },
      {
        "id": "run_MYT20M6B7S",
        "startedAt": "2026-10-14T05:07:53.396Z",
        "endedAt": "2026-10-14T06:09:01.492Z",
        "durationMs": 3668096,
        "events": 32,
        "spans": 22,
        "openSpans": 4,
        "tools": 4,
        "blocked": 4,
        "failed": 0,
        "workers": 2,
        "evidence": 3,
        "cost": 0
      }
    ],
    "selected": "run_88GC4QQKA2",
    "tree": [
      {
        "id": "sp_root",
        "actor": {
          "kind": "root",
          "id": "sess-retry-budget"
        },
        "type": "RUN_STARTED",
        "status": "open",
        "openedAt": "2026-10-14T05:30:05.396Z",
        "closedAt": null,
        "durationMs": null,
        "lastEventAt": "2026-10-14T05:30:05.396Z",
        "instantaneous": false,
        "eventCount": 1,
        "children": [
          {
            "id": "sp_turn_X61T2WJ680",
            "actor": {
              "kind": "root",
              "id": "sess-retry-budget"
            },
            "type": "TURN_STARTED",
            "status": "closed",
            "openedAt": "2026-10-14T05:30:07.396Z",
            "closedAt": "2026-10-14T05:30:24.396Z",
            "durationMs": 17000,
            "lastEventAt": "2026-10-14T05:30:24.396Z",
            "instantaneous": false,
            "eventCount": 2,
            "children": [
              {
                "id": "sp_w_RN7FX572HQ71",
                "actor": {
                  "kind": "worker",
                  "id": "explore-billing",
                  "tier": "Explore"
                },
                "type": "WORKER_SPAWNED",
                "status": "closed",
                "openedAt": "2026-10-14T05:30:09.396Z",
                "closedAt": "2026-10-14T05:30:22.396Z",
                "durationMs": 13000,
                "lastEventAt": "2026-10-14T05:30:22.396Z",
                "instantaneous": false,
                "eventCount": 2,
                "children": []
              },
              {
                "id": "sp_t_9RF8H1R2TZAC",
                "actor": {
                  "kind": "tool",
                  "id": "Read"
                },
                "type": "TOOL_PROPOSED",
                "status": "closed",
                "openedAt": "2026-10-14T05:30:10.396Z",
                "closedAt": "2026-10-14T05:30:13.396Z",
                "durationMs": 3000,
                "lastEventAt": "2026-10-14T05:30:13.396Z",
                "instantaneous": false,
                "eventCount": 2,
                "children": []
              },
              {
                "id": "sp_t_1NP4C16HCK63",
                "actor": {
                  "kind": "tool",
                  "id": "Grep"
                },
                "type": "TOOL_PROPOSED",
                "status": "closed",
                "openedAt": "2026-10-14T05:30:14.396Z",
                "closedAt": "2026-10-14T05:30:17.396Z",
                "durationMs": 3000,
                "lastEventAt": "2026-10-14T05:30:17.396Z",
                "instantaneous": false,
                "eventCount": 2,
                "children": []
              }
            ]
          },
          {
            "id": "sp_turn_T4P0181ZEM",
            "actor": {
              "kind": "root",
              "id": "sess-retry-budget"
            },
            "type": "TURN_STARTED",
            "status": "closed",
            "openedAt": "2026-10-14T05:30:26.396Z",
            "closedAt": "2026-10-14T05:30:36.396Z",
            "durationMs": 10000,
            "lastEventAt": "2026-10-14T05:30:36.396Z",
            "instantaneous": false,
            "eventCount": 2,
            "children": [
              {
                "id": "sp_t_JJQE32PCF48P",
                "actor": {
                  "kind": "tool",
                  "id": "Edit"
                },
                "type": "TOOL_PROPOSED",
                "status": "closed",
                "openedAt": "2026-10-14T05:30:27.396Z",
                "closedAt": "2026-10-14T05:30:46.396Z",
                "durationMs": 19000,
                "lastEventAt": "2026-10-14T05:30:46.396Z",
                "instantaneous": false,
                "eventCount": 4,
                "children": []
              },
              {
                "id": "sp_t_Y053X1NMK6X8",
                "actor": {
                  "kind": "tool",
                  "id": "Bash"
                },
                "type": "TOOL_PROPOSED",
                "status": "closed",
                "openedAt": "2026-10-14T05:30:31.396Z",
                "closedAt": "2026-10-14T05:30:34.396Z",
                "durationMs": 3000,
                "lastEventAt": "2026-10-14T05:30:34.396Z",
                "instantaneous": false,
                "eventCount": 2,
                "children": []
              }
            ]
          },
          {
            "id": "sp_turn_PQKP4T5KT8",
            "actor": {
              "kind": "root",
              "id": "sess-retry-budget"
            },
            "type": "TURN_STARTED",
            "status": "closed",
            "openedAt": "2026-10-14T05:30:38.396Z",
            "closedAt": "2026-10-14T05:30:48.396Z",
            "durationMs": 10000,
            "lastEventAt": "2026-10-14T05:30:48.396Z",
            "instantaneous": false,
            "eventCount": 2,
            "children": [
              {
                "id": "sp_t_R9J753WMWXN0",
                "actor": {
                  "kind": "tool",
                  "id": "Bash"
                },
                "type": "TOOL_PROPOSED",
                "status": "failed",
                "openedAt": "2026-10-14T05:30:39.396Z",
                "closedAt": "2026-10-14T05:30:42.396Z",
                "durationMs": 3000,
                "lastEventAt": "2026-10-14T05:30:42.396Z",
                "instantaneous": false,
                "eventCount": 2,
                "children": []
              }
            ]
          }
        ]
      }
    ],
    "summary": {
      "id": "run_88GC4QQKA2",
      "startedAt": "2026-10-14T05:30:05.396Z",
      "endedAt": "2026-10-14T05:30:48.396Z",
      "durationMs": 43000,
      "events": 21,
      "spans": 10,
      "openSpans": 1,
      "tools": 6,
      "blocked": 0,
      "failed": 1,
      "workers": 1,
      "evidence": 0,
      "cost": 0
    },
    "events": [
      {
        "v": 1,
        "id": "01M4WGEJEN25D3TJR5BKNHXZMR",
        "ts": "2026-10-14T05:30:05.396Z",
        "run_id": "run_88GC4QQKA2",
        "span_id": "sp_root",
        "parent_span_id": null,
        "actor": {
          "kind": "root",
          "id": "sess-retry-budget"
        },
        "type": "RUN_STARTED",
        "payload": {
          "hook": "SessionStart",
          "cwd": "C:\\Users\\thdat\\AppData\\Local\\Temp\\dai-ade-demo"
        }
      },
      {
        "v": 1,
        "id": "01M4WGEJES3ZY74NS9SQ77R1X7",
        "ts": "2026-10-14T05:30:07.396Z",
        "run_id": "run_88GC4QQKA2",
        "span_id": "sp_turn_X61T2WJ680",
        "parent_span_id": "sp_root",
        "actor": {
          "kind": "root",
          "id": "sess-retry-budget"
        },
        "type": "TURN_STARTED",
        "payload": {
          "hook": "UserPromptSubmit",
          "cwd": "C:\\Users\\thdat\\AppData\\Local\\Temp\\dai-ade-demo",
          "prompt": "Cap declined-card retries at two and prove it"
        }
      },
      {
        "v": 1,
        "id": "01M4WGEJEVSJ587FZTK6Z5BV49",
        "ts": "2026-10-14T05:30:09.396Z",
        "run_id": "run_88GC4QQKA2",
        "span_id": "sp_w_RN7FX572HQ71",
        "parent_span_id": "sp_turn_X61T2WJ680",
        "actor": {
          "kind": "worker",
          "id": "explore-billing",
          "tier": "Explore"
        },
        "type": "WORKER_SPAWNED",
        "payload": {
          "hook": "SubagentStart",
          "cwd": "C:\\Users\\thdat\\AppData\\Local\\Temp\\dai-ade-demo"
        }
      },
      {
        "v": 1,
        "id": "01M4WGEJEX05WF866CA23BACEE",
        "ts": "2026-10-14T05:30:10.396Z",
        "run_id": "run_88GC4QQKA2",
        "span_id": "sp_t_9RF8H1R2TZAC",
        "parent_span_id": "sp_turn_X61T2WJ680",
        "actor": {
          "kind": "tool",
          "id": "Read"
        },
        "type": "TOOL_PROPOSED",
        "payload": {
          "hook": "PreToolUse",
          "tool": "Read",
          "input": {
            "file": "docs/billing.md"
          },
          "cwd": "C:\\Users\\thdat\\AppData\\Local\\Temp\\dai-ade-demo"
        }
      },
      {
        "v": 1,
        "id": "01M4WGEJEYG521RS6M346JEAJG",
        "ts": "2026-10-14T05:30:13.396Z",
        "run_id": "run_88GC4QQKA2",
        "span_id": "sp_t_9RF8H1R2TZAC",
        "parent_span_id": "sp_turn_X61T2WJ680",
        "actor": {
          "kind": "tool",
          "id": "Read"
        },
        "type": "TOOL_EXECUTED",
        "payload": {
          "hook": "PostToolUse",
          "tool": "Read",
          "input": {
            "file": "docs/billing.md"
          },
          "response": {
            "ok": true
          },
          "cwd": "C:\\Users\\thdat\\AppData\\Local\\Temp\\dai-ade-demo"
        }
      },
      {
        "v": 1,
        "id": "01M4WGEJEZTT8FNR79JW6TQQ4T",
        "ts": "2026-10-14T05:30:14.396Z",
        "run_id": "run_88GC4QQKA2",
        "span_id": "sp_t_1NP4C16HCK63",
        "parent_span_id": "sp_turn_X61T2WJ680",
        "actor": {
          "kind": "tool",
          "id": "Grep"
        },
        "type": "TOOL_PROPOSED",
        "payload": {
          "hook": "PreToolUse",
          "tool": "Grep",
          "input": {
            "pattern": "shouldRetry"
          },
          "cwd": "C:\\Users\\thdat\\AppData\\Local\\Temp\\dai-ade-demo"
        }
      },
      {
        "v": 1,
        "id": "01M4WGEJF1QEV7DBPQN1SNVCVT",
        "ts": "2026-10-14T05:30:17.396Z",
        "run_id": "run_88GC4QQKA2",
        "span_id": "sp_t_1NP4C16HCK63",
        "parent_span_id": "sp_turn_X61T2WJ680",
        "actor": {
          "kind": "tool",
          "id": "Grep"
        },
        "type": "TOOL_EXECUTED",
        "payload": {
          "hook": "PostToolUse",
          "tool": "Grep",
          "input": {
            "pattern": "shouldRetry"
          },
          "response": {
            "ok": true
          },
          "cwd": "C:\\Users\\thdat\\AppData\\Local\\Temp\\dai-ade-demo"
        }
      },
      {
        "v": 1,
        "id": "01M4WGEJF2YAEFE9ZFMP3EKX46",
        "ts": "2026-10-14T05:30:22.396Z",
        "run_id": "run_88GC4QQKA2",
        "span_id": "sp_w_RN7FX572HQ71",
        "parent_span_id": "sp_turn_X61T2WJ680",
        "actor": {
          "kind": "worker",
          "id": "explore-billing",
          "tier": "Explore"
        },
        "type": "WORKER_DELIVERED",
        "payload": {
          "hook": "SubagentStop",
          "cwd": "C:\\Users\\thdat\\AppData\\Local\\Temp\\dai-ade-demo"
        }
      },
      {
        "v": 1,
        "id": "01M4WGEJF332Q1Z5SVYWZ1HX26",
        "ts": "2026-10-14T05:30:24.396Z",
        "run_id": "run_88GC4QQKA2",
        "span_id": "sp_turn_X61T2WJ680",
        "parent_span_id": "sp_root",
        "actor": {
          "kind": "root",
          "id": "sess-retry-budget"
        },
        "type": "TURN_ENDED",
        "payload": {
          "hook": "Stop",
          "cwd": "C:\\Users\\thdat\\AppData\\Local\\Temp\\dai-ade-demo"
        }
      },
      {
        "v": 1,
        "id": "01M4WGEJF5H1SS5GA1K2N5A89G",
        "ts": "2026-10-14T05:30:26.396Z",
        "run_id": "run_88GC4QQKA2",
        "span_id": "sp_turn_T4P0181ZEM",
        "parent_span_id": "sp_root",
        "actor": {
          "kind": "root",
          "id": "sess-retry-budget"
        },
        "type": "TURN_STARTED",
        "payload": {
          "hook": "UserPromptSubmit",
          "cwd": "C:\\Users\\thdat\\AppData\\Local\\Temp\\dai-ade-demo",
          "prompt": "Cap declined-card retries at two and prove it"
        }
      },
      {
        "v": 1,
        "id": "01M4WGEJF7TXW2XQ32B6HF0MWB",
        "ts": "2026-10-14T05:30:27.396Z",
        "run_id": "run_88GC4QQKA2",
        "span_id": "sp_t_JJQE32PCF48P",
        "parent_span_id": "sp_turn_T4P0181ZEM",
        "actor": {
          "kind": "tool",
          "id": "Edit"
        },
        "type": "TOOL_PROPOSED",
        "payload": {
          "hook": "PreToolUse",
          "tool": "Edit",
          "input": {
            "file": "src/billing/retry.ts"
          },
          "cwd": "C:\\Users\\thdat\\AppData\\Local\\Temp\\dai-ade-demo"
        }
      },
      {
        "v": 1,
        "id": "01M4WGEJF89YCCH2K9B1MMVFM5",
        "ts": "2026-10-14T05:30:30.396Z",
        "run_id": "run_88GC4QQKA2",
        "span_id": "sp_t_JJQE32PCF48P",
        "parent_span_id": "sp_turn_T4P0181ZEM",
        "actor": {
          "kind": "tool",
          "id": "Edit"
        },
        "type": "TOOL_EXECUTED",
        "payload": {
          "hook": "PostToolUse",
          "tool": "Edit",
          "input": {
            "file": "src/billing/retry.ts"
          },
          "response": {
            "ok": true
          },
          "cwd": "C:\\Users\\thdat\\AppData\\Local\\Temp\\dai-ade-demo"
        }
      },
      {
        "v": 1,
        "id": "01M4WGEJF9M8YF2NX0TAFHG2Y6",
        "ts": "2026-10-14T05:30:31.396Z",
        "run_id": "run_88GC4QQKA2",
        "span_id": "sp_t_Y053X1NMK6X8",
        "parent_span_id": "sp_turn_T4P0181ZEM",
        "actor": {
          "kind": "tool",
          "id": "Bash"
        },
        "type": "TOOL_PROPOSED",
        "payload": {
          "hook": "PreToolUse",
          "tool": "Bash",
          "input": {
            "command": "npm test -- retry"
          },
          "cwd": "C:\\Users\\thdat\\AppData\\Local\\Temp\\dai-ade-demo"
        }
      },
      {
        "v": 1,
        "id": "01M4WGEJFBFSBK2NHTE6ZY9RPZ",
        "ts": "2026-10-14T05:30:34.396Z",
        "run_id": "run_88GC4QQKA2",
        "span_id": "sp_t_Y053X1NMK6X8",
        "parent_span_id": "sp_turn_T4P0181ZEM",
        "actor": {
          "kind": "tool",
          "id": "Bash"
        },
        "type": "TOOL_EXECUTED",
        "payload": {
          "hook": "PostToolUse",
          "tool": "Bash",
          "input": {
            "command": "npm test -- retry"
          },
          "response": {
            "ok": true
          },
          "cwd": "C:\\Users\\thdat\\AppData\\Local\\Temp\\dai-ade-demo"
        }
      },
      {
        "v": 1,
        "id": "01M4WGEJFCEZFNTYV7WVRJKJFA",
        "ts": "2026-10-14T05:30:36.396Z",
        "run_id": "run_88GC4QQKA2",
        "span_id": "sp_turn_T4P0181ZEM",
        "parent_span_id": "sp_root",
        "actor": {
          "kind": "root",
          "id": "sess-retry-budget"
        },
        "type": "TURN_ENDED",
        "payload": {
          "hook": "Stop",
          "cwd": "C:\\Users\\thdat\\AppData\\Local\\Temp\\dai-ade-demo"
        }
      },
      {
        "v": 1,
        "id": "01M4WGEJFEXT1KPVGA77SN76GG",
        "ts": "2026-10-14T05:30:38.396Z",
        "run_id": "run_88GC4QQKA2",
        "span_id": "sp_turn_PQKP4T5KT8",
        "parent_span_id": "sp_root",
        "actor": {
          "kind": "root",
          "id": "sess-retry-budget"
        },
        "type": "TURN_STARTED",
        "payload": {
          "hook": "UserPromptSubmit",
          "cwd": "C:\\Users\\thdat\\AppData\\Local\\Temp\\dai-ade-demo",
          "prompt": "Cap declined-card retries at two and prove it"
        }
      },
      {
        "v": 1,
        "id": "01M4WGEJFFFRVDHW1DG3GKHXQ9",
        "ts": "2026-10-14T05:30:39.396Z",
        "run_id": "run_88GC4QQKA2",
        "span_id": "sp_t_R9J753WMWXN0",
        "parent_span_id": "sp_turn_PQKP4T5KT8",
        "actor": {
          "kind": "tool",
          "id": "Bash"
        },
        "type": "TOOL_PROPOSED",
        "payload": {
          "hook": "PreToolUse",
          "tool": "Bash",
          "input": {
            "command": "npm run lint"
          },
          "cwd": "C:\\Users\\thdat\\AppData\\Local\\Temp\\dai-ade-demo"
        }
      },
      {
        "v": 1,
        "id": "01M4WGEJFHTXQVJ8WPCRCXZR7Q",
        "ts": "2026-10-14T05:30:42.396Z",
        "run_id": "run_88GC4QQKA2",
        "span_id": "sp_t_R9J753WMWXN0",
        "parent_span_id": "sp_turn_PQKP4T5KT8",
        "actor": {
          "kind": "tool",
          "id": "Bash"
        },
        "type": "TOOL_FAILED",
        "payload": {
          "hook": "PostToolUse",
          "tool": "Bash",
          "input": {
            "command": "npm run lint"
          },
          "response": {
            "is_error": true,
            "error": "exit status 1"
          },
          "cwd": "C:\\Users\\thdat\\AppData\\Local\\Temp\\dai-ade-demo"
        }
      },
      {
        "v": 1,
        "id": "01M4WGEJFJZ2S357E84S0VHMJ2",
        "ts": "2026-10-14T05:30:43.396Z",
        "run_id": "run_88GC4QQKA2",
        "span_id": "sp_t_JJQE32PCF48P",
        "parent_span_id": "sp_turn_PQKP4T5KT8",
        "actor": {
          "kind": "tool",
          "id": "Edit"
        },
        "type": "TOOL_PROPOSED",
        "payload": {
          "hook": "PreToolUse",
          "tool": "Edit",
          "input": {
            "file": "src/billing/retry.ts"
          },
          "cwd": "C:\\Users\\thdat\\AppData\\Local\\Temp\\dai-ade-demo"
        }
      },
      {
        "v": 1,
        "id": "01M4WGEJFKY3F1ZBNFA5N79S21",
        "ts": "2026-10-14T05:30:46.396Z",
        "run_id": "run_88GC4QQKA2",
        "span_id": "sp_t_JJQE32PCF48P",
        "parent_span_id": "sp_turn_PQKP4T5KT8",
        "actor": {
          "kind": "tool",
          "id": "Edit"
        },
        "type": "TOOL_EXECUTED",
        "payload": {
          "hook": "PostToolUse",
          "tool": "Edit",
          "input": {
            "file": "src/billing/retry.ts"
          },
          "response": {
            "ok": true
          },
          "cwd": "C:\\Users\\thdat\\AppData\\Local\\Temp\\dai-ade-demo"
        }
      },
      {
        "v": 1,
        "id": "01M4WGEJFM7Y7X6AJ7ES6SGDY7",
        "ts": "2026-10-14T05:30:48.396Z",
        "run_id": "run_88GC4QQKA2",
        "span_id": "sp_turn_PQKP4T5KT8",
        "parent_span_id": "sp_root",
        "actor": {
          "kind": "root",
          "id": "sess-retry-budget"
        },
        "type": "TURN_ENDED",
        "payload": {
          "hook": "Stop",
          "cwd": "C:\\Users\\thdat\\AppData\\Local\\Temp\\dai-ade-demo"
        }
      }
    ],
    "truncated": 0,
    "stats": {
      "files": 1
    }
  },
  _diffs: {
    "idempotent-charge": "diff --git a/CONTRACT.json b/CONTRACT.json\nnew file mode 100644\nindex 0000000..135bb91\n--- /dev/null\n+++ b/CONTRACT.json\n@@ -0,0 +1,8 @@\n+{\n+  \"task_id\": \"idempotent-charge\",\n+  \"objective\": \"Make charge idempotent with a request key\",\n+  \"outputs\": [],\n+  \"forbidden\": [],\n+  \"base_commit\": \"1049afac3050d24d16451d014b00cb047a0453ca\",\n+  \"created_at\": \"2026-10-14T06:08:59Z\"\n+}\ndiff --git a/src/billing/charge.ts b/src/billing/charge.ts\nindex 65e934a..2317953 100644\n--- a/src/billing/charge.ts\n+++ b/src/billing/charge.ts\n@@ -1,3 +1,6 @@\n-export async function charge(cardId: string, amount: number) {\n-  return gateway.submit(cardId, amount);\n+export async function charge(cardId: string, amount: number, key: string) {\n+  if (await seen(key)) return cached(key);\n+  return gateway.submit(cardId, amount, key);\n }\n+\n+// TODO: cover the boundary case\n",
    "retry-budget": "diff --git a/CONTRACT.json b/CONTRACT.json\nnew file mode 100644\nindex 0000000..e64c126\n--- /dev/null\n+++ b/CONTRACT.json\n@@ -0,0 +1,8 @@\n+{\n+  \"task_id\": \"retry-budget\",\n+  \"objective\": \"Cap declined-card retries at two\",\n+  \"outputs\": [],\n+  \"forbidden\": [],\n+  \"base_commit\": \"1049afac3050d24d16451d014b00cb047a0453ca\",\n+  \"created_at\": \"2026-10-14T06:08:58Z\"\n+}\ndiff --git a/src/billing/retry.ts b/src/billing/retry.ts\nindex 1a85902..e641a19 100644\n--- a/src/billing/retry.ts\n+++ b/src/billing/retry.ts\n@@ -1,3 +1,7 @@\n-export function shouldRetry(result: Result) {\n-  return result.declined;\n+const MAX_RETRIES = 2;\n+\n+export function shouldRetry(result: Result, attempt: number) {\n+  return result.declined && attempt < MAX_RETRIES;\n }\n+\n+// TODO: cover the boundary case\n",
    "search-ranking": "diff --git a/src/search/index.ts b/src/search/index.ts\nindex 371c4a4..984086e 100644\n--- a/src/search/index.ts\n+++ b/src/search/index.ts\n@@ -1,3 +1,3 @@\n export function search(q: string) {\n-  return store.query(q);\n+  return rrf(bm25(q), semantic(q));\n }\n",
    "session-rotation": "diff --git a/src/auth/session.ts b/src/auth/session.ts\nindex 8b499e2..d1af6b3 100644\n--- a/src/auth/session.ts\n+++ b/src/auth/session.ts\n@@ -1,3 +1,3 @@\n export function createSession(userId: string) {\n-  return { userId, issuedAt: Date.now() };\n+  return { userId, issuedAt: Date.now(), rotateAfter: 900_000 };\n }\n"
  },
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
