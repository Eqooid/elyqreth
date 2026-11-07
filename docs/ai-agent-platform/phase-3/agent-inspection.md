# T07 — Agent Inspection & Execution Details

**COMPLETE within available city-read contracts — verified 2026-10-25.** The latest T07 instructions explicitly prefer available safe fields rather than broadening history access. This supersedes the original T01 proposal to add a city detail facade during T07. T08–T10 remain planned.

## Repository findings and access boundary

The frontend is vanilla JavaScript/Canvas with one existing DOM NPC inspector in `app.js`. T02 immutable resident slots, T03 city projections, T04 synchronization, T05 object-identity bindings and T06 markers are reused without changing their contracts. No applicable AGENTS.md was found. The supplied workspace has no Git metadata, so git status/diff cannot establish provenance; a pre-change SHA-256 inventory is used to check preservation.

The city credential can read only:

- `GET /api/v1/cities/elyqreth/agents`
- `GET /api/v1/cities/elyqreth/agents/:agentId/activity`

`CityReadGuard` and projection service enforce enabled bindings, fixed owner/city, local development/test scope and safe response fields. Existing task execution/result, execution history and audit APIs use **operator** guards/credentials, not the city credential. This feature neither calls them nor asks the browser to acquire an operator token. It does not change backend authorization, persistence, schema or endpoints.

## Data available in the inspector

The existing NPC information and local simulation actions remain. Agent-bound residents gain an **Agent Details** section containing registered name/ID/type, immutable NPC identity, availability, current activity, Task/Execution references, recent outcome, backend observation/activity timestamps, frontend last-successful-sync timestamp and freshness/connection explanation. These are recorded facts; freshness does not guarantee an executing process.

Execution details contain ID, Task ID, separately labeled Execution status and Task status where disclosed, current attempt number, and a completion timestamp only when that exact execution matches the recent outcome. Missing fields are shown as unavailable.

The projection does **not** disclose descriptions, Task titles/input, strategy/provider, created/started timestamps, result bodies, diagnostic messages or full history. Consequently no elapsed time, completed duration or billing information is computed. No client clock is substituted for missing backend timestamps. Failure, timeout, cancellation and success summaries are fixed safe status descriptions, not interpretations of provider errors or result bodies. Canonical ISO UTC timestamps are validated before presentation; invalid/missing values are omitted or marked unavailable.

## Recent references, not full history

At most three distinct execution references can be derived from one existing activity projection:

1. Current Execution, when paired with current Task.
2. Latest Execution (`lastExecution`).
3. Execution identified by `recentOutcome`, if different.

Duplicate IDs merge into one entry, preferring current data then the richer outcome reference. UI order is current first, then latest, then remaining outcome. The API does not provide creation timestamps for all three, so this is **not timestamp-sorted history**. The expandable section is explicitly named **Recent execution references**, and the partial-record limit is visible. There is no pagination because no city history endpoint exists. No client-side history accumulates across polls.

Selecting a reference changes the read-only Execution details panel. Current versus historical/latest selection is explicit. The selection is scoped to entity ID, stable NPC slot, Agent ID and binding ID. A reference remains selected while still authorized in later snapshots, is refreshed only from authoritative data, and falls back to the current/first available reference if it disappears. Switching NPC/binding clears selection. Unknown IDs supplied through DOM attributes are rejected unless present in the current authorized projection.

## Outcome timeline

**Latest recorded outcome** displays zero or one timestamped item from `recentOutcome`: Task completed, failed, cancelled or unknown, with separate Task/Execution IDs. This is a lifecycle outcome, **not a fetched audit event**. There is no invented Task-assigned, execution-started, tool-called or waiting event. A stable outcome key is derived from the existing IDs/status/timestamp; replacement rather than accumulation prevents duplicates. Unknown outcomes receive a neutral label; invalid timestamps produce an empty timeline.

Full durable audit history remains available only through its existing operator APIs. The inspector states that full audit/tool events are unavailable to its credential.

## Selection and synchronization

```mermaid
sequenceDiagram
 participant User
 participant Inspector as Existing NPC inspector
 participant Binding as T05 binding view
 participant Runtime as T04 synchronized state
 User->>Inspector: Select existing NPC
 Inspector->>Binding: getForEntity(actual NPC object)
 Binding-->>Inspector: Authorized association and projection
 Inspector->>Inspector: Derive bounded references and selected details
 Runtime->>Binding: Authoritative snapshot/freshness update
 Inspector->>Binding: Read during existing UI refresh
 Inspector->>Inspector: Reconcile selection, safely replace content
 User->>Inspector: Select historical reference
 Inspector->>Inspector: Validate current membership; update details
```

`inspection-model.js` owns pure bounded read models and a tiny `NpcInspectionSelection` object containing scope/selected IDs and a boolean indicating that this selected NPC previously had an association. It has no credential, transport, data cache, timer or subscription. Revocation clears all backend IDs; only the boolean permits a generic authorization/unavailable notice. Changing selection clears that boolean too. The existing UI refresh (approximately 200 ms) reads T05/T04. No inspector requests, per-frame network calls, extra polling or state-management library are added. Clearing selection erases hidden DOM content and its cached HTML; changing to an ordinary/decorative NPC preserves its existing inspector without empty Agent sections.

`replaceInspectorContent` avoids identical DOM replacement, preserves expanded details, focused reference/summary and inspector scroll within the same authorized scope, and detects external content replacement. Native details/summary and buttons support keyboard interaction. IDs wrap inside the existing dark, Icy White panel, including narrow layouts. Selection changes reset retained scope; pagehide clears runtime data and rerenders using the existing disconnect path. No special subscription requires teardown on deselection.

## Loading, failure, stale and authorization behavior

| Condition | Behavior |
| --- | --- |
| No authorized binding | Original NPC inspector, no empty Agent section |
| Resolved Agent, no Execution | Explicit no-reference/empty outcome text |
| Loading/refreshing | Existing synchronization state, no invented progress |
| Temporary network/server failure | Retained authorized data labeled stale/unavailable, never an Agent failure |
| Paused/unknown freshness | Recorded-data explanation; no confirmed live-state claim |
| Reconnection | Next T04 authoritative projection replaces data and reconciles selection |
| First missing sweep | T05 unavailable association; no old Agent payload is displayed |
| Confirmed removal or identity change | References/timeline/details cleared |
| Auth denied/disconnect | Existing T04 clears protected data; inspector also rejects rendering old supplied bindings. A previously selected association shows only a generic notice, with no backend IDs/name/status retained |

No infinite spinner or independent retry is introduced. Existing bounded T04 recovery applies. While no binding identity is known, the inspector cannot infer that an arbitrary NPC should have a pending Agent; it retains its normal appearance instead of fabricating a loading association.

## Security and performance

Every backend value rendered as HTML is escaped. Output is constructed from an explicit display-field allowlist; raw results, credentials, tool payloads, prompts, exceptions and arbitrary diagnostic fields are ignored. There are no execution/Agent editing controls or new endpoints. The existing local simulation controls are not backend Agent controls.

Selection stores only IDs, with bounded reference/timeline derivation from one selected projection. No whole-population scans or canvas rerenders are caused by history selection. NPC movement, sprites, animations, renderer, camera and simulation algorithms are unchanged. No FPS or latency benchmark is claimed.

## Tests and verification

Run:

```powershell
node --test tests/agent-inspection.test.js
npm run lint
npm test
npm run build:web
npm run build
npm run test:api
npm run test:db
npm run test:browser
```

The focused tests cover authorized identity, current/recent references, deduplication/order/bounds, history selection and refresh, selection scope clearing, invalid timestamps, explicit missing duration disclosure, unknown states, safe fixed failure summaries, no-execution states, outcome deduplication, connection errors/recovery, forbidden-state redaction, escaping and sensitive-field exclusion.

Browser smoke uses a test-only mocked transport through real T04/T05 integration, without production fake records. It verifies active/historical details, native section expansion, selected-button focus after updates, single outcome timeline, unbound NPC switching, closing/reopening without hidden Agent data, responsive identifier wrapping, authorization cleanup, and T06 transitions/stale recovery. Existing camera, environment, movement, mission controls and mobile reload are also exercised. No live provider call or full backend-to-browser result/history workflow is claimed.

### Actual command results

| Command | Result |
| --- | --- |
| `node --test tests/agent-inspection.test.js` | PASS, 10 focused tests |
| `node --test tests/npc-status.test.js` | PASS, 8 T06 regression tests |
| `npm run lint` | PASS, recursive syntax, strict frontend runtime typing and backend typecheck |
| `npm test` | PASS, final 114 frontend tests, zero skips/failures |
| `npm run build:web` | PASS, final disposable frontend production build, 47 modules |
| `npm run build` | PASS, backend build |
| `npm run test:api` | PASS, 190 backend tests, zero skips/failures |
| `npm run test:db` | PASS, 103 isolated real PostgreSQL tests, zero skips/failures |
| `npm run test:browser` | PASS, final Chrome 155.0.8059.85 run, 79 resource requests, zero exceptions |

The existing SQL suite also exercises protected city HTTP routes, ownership isolation, read-only projection behavior, lifecycle concurrency and actual frontend-client/T03 compatibility. It does not substitute for a live-provider browser workflow. Logs in the OS temporary directory: `elyqreth-p3-t07-lint-final.log`, `elyqreth-p3-t07-web-final.log`, `elyqreth-p3-t07-build-final.log`, `elyqreth-p3-t07-api.log`, `elyqreth-p3-t07-db.log`, and `elyqreth-p3-t07-browser-final.log`. Duration formatting is not implemented or claimed tested because no start/created timestamps are authorized by the current city projection; tests verify that missing durations are disclosed instead of fabricated.

### Files and preservation

Created:

- `dist/js/runtime/inspection-model.js`
- `tests/agent-inspection.test.js`
- `docs/ai-agent-platform/phase-3/agent-inspection.md`

Modified:

- `dist/js/runtime/npc-runtime-inspector.js`
- `dist/js/app.js`, `dist/style.css`
- `scripts/browser-smoke.mjs`
- Root `README.md`, `docs/ai-agent-platform/README.md`
- Phase 3 `README.md`, `architecture.md`, `decisions.md`, `implementation-plan.md`, `visualization-inspector.md`

The pre-change inventory confirms 281 existing files are unchanged, including backend sources/tests/migrations, existing T02–T06 identity/synchronization/status modules, renderer, movement, simulation and assets. No inventoried files were removed. No schema, dependencies, providers, controls, endpoints or city assets were added or changed. No commit, push, tag, release or deployment was performed.

## Known limitations and next task

This completes inspection **within the existing safe city projection**. Full paginated execution history, durable audit timelines, result text and precise durations require a separately authorized safe display API and disclosure review; this feature does not broaden access. Production tenant identity/remote city exposure remains outside the established local-only boundary. Polling can miss transient states. No visual-diff/FPS/accessibility certification is claimed.

Next: **Phase 3 T08 — Multi-Agent Synchronization & Reconnection**. It remains unimplemented by T07.
