# Phase 4 - Interactive AI City

Reviewed 2026-10-27, Asia/Bangkok. **T01-T10: COMPLETE. Phase 4: READY for the approved local-development/test scope.** Public production release is blocked by existing identity/deployment limits; Phase 5 is **PLANNED**. The [final acceptance report](acceptance.md), [current runbook](operations.md), [risk register](risk-register.md) and [unreleased notes](release-notes.md) supersede historical planning/checkpoint language for current behavior. Backend execution remains authoritative and the existing city presentation remains intact.

## Current documentation

- [Final T01-T10 inventory, acceptance matrix, actual checks and Phase 5 prerequisites](acceptance.md)
- [Local environment, credentials, Task/Execution workflow and troubleshooting](operations.md)
- [Final risks and deployment blockers](risk-register.md)
- [Unreleased implementation and compatibility notes](release-notes.md)

## Scope and prerequisite decision

Phase 4 makes the existing Agent-linked NPC inspector an authorized interface for creating text Tasks, explicitly starting eligible executions, requesting cancellation, reading results and navigating bounded execution history. The backend retains identity, ownership, configuration, execution, lifecycle, tool/provider policy, audit and result authority. The city renders and submits user intent; NPC movement never executes work.

[Phase 1](../phase-1-acceptance.md) is READY WITH LIMITATIONS; [Phase 2](../phase-2/acceptance.md) and the actual [Phase 3 T10 report](../phase-3/acceptance.md) are ACCEPTED WITH LIMITATIONS for **local development only**. T10's retained evidence records 125 frontend, 192 backend and 104 PostgreSQL tests plus one real Chrome/API/PostgreSQL workflow covering five executions. These are historical results inspected during T01, not fresh test runs. The source and acceptance artifacts agree on the implemented read-only integration.

Phase 3 does **not** grant browser execution permission. Its city-read credential cannot access operator writes/results. The broad operator token must not be placed in the browser. T02 now implements the separate default-deny local interaction audience, persisted binding/owner checks at transaction boundaries, safe display filtering and typed read/recovery contracts. Public production access remains blocked; production person/tenant identity is a separate release requirement, not silently invented here.

## Repository audit

| Area | Actual implementation and planning consequence |
| --- | --- |
| Workspace | No Git metadata: status/diff cannot establish a clean tree. No applicable AGENTS.md found in workspace or accessible ancestor locations. A pre-edit maintained-file SHA-256 inventory contains 421 files. |
| Frontend | Vanilla JavaScript ES modules, JSDoc/declaration-file typing and Canvas 2D. Root `dist/` is maintained source; Vite serves it and verifies production bundling into disposable output. No React, generic application HTTP layer or global state library exists. |
| Selection/inspector | `dist/js/app.js` owns selection, `renderInspector`, event delegation and roughly 200 ms UI refresh. `NpcInspectionSelection` and `replaceInspectorContent` preserve eligible focus/expansion. Existing simulated mission, remove-resident and simulate-error controls remain simulation actions. |
| NPC identity | `npc-registry.js`, `npc-runtime-binding.js` consume immutable slots and authorized activity. Four default residents, 20 supported slots; missing slots stay unresolved. Names, coordinates, numeric local IDs and DOM datasets are not backend identity authority. |
| Runtime observation | `runtime/index.js`, `api-client.js`, `runtime-store.js`, `sync-controller.js`; singleton disabled by default, volatile city-read credential, 2-second after-completion polling, 5-second sweep deadline, stale/unknown thresholds and bounded recovery. It is deliberately a fixed GET-only audience. |
| Backend | Sole NestJS app in `apps/api`, strict TypeScript, Drizzle/pg, existing PostgreSQL migrations. Agent Registry, TasksService, ExecutionsService, RuntimeApiService, RuntimeCoordinator and lifecycle/result/audit transactions already exist. No new engine is needed. |
| Actual lifecycle | Agents ACTIVE/DISABLED/ARCHIVED; Tasks CREATED/QUEUED/RUNNING/COMPLETED/FAILED/CANCELLED; Executions PENDING/RUNNING/SUCCEEDED/FAILED/CANCELLED/TIMED_OUT. Activity projection current states IDLE/QUEUED/RUNNING/UNKNOWN with separate recent outcome. |
| Task intent | `POST /api/v1/tasks` creates intent only. Body idempotencyKey is owner-scoped, request-hash checked, DB constrained; replay gives existing safe Task DTO, not a second Task. Input is not returned by the current serializer. |
| Execution | `POST /api/v1/tasks/:taskId/execute` is synchronous, version fenced and coordinator-owned. HTTP execution deadline is 30 seconds; request disconnect can request cancellation. One active execution per coordinator; per-Agent native quarantine remains authoritative. No detached durable background execution guarantee exists. |
| Cancellation | RuntimeApiService authorizes native trusted attempts and calls TaskLifecycleService to commit cancellation. A running coordinator observes it through heartbeat/fencing; cancellation API does not directly call or replace the coordinator. |
| Results/history | Native result endpoint returns validated `text` or `text.statistics.v1` output. Existing execution history is per Task, ascending attempt order, bounded offset pagination; no Agent-wide execution history or exact idempotency lookup route exists. |
| Access | `assertLocalRequest` checks token, configured development/test mode, loopback bind/peer/Host and exact Origin policy. Fixed configured owner, no frontend login or production user/tenant identity. City-read token is distinct and observation-only. |
| Audit/HTTP | Durable owner-scoped events and command audit; request context validates/generates X-Request-Id, runtime snapshot has correlationId. Safe closed errors, 64 KiB request body parser, no raw diagnostics. No Swagger/OpenAPI system is configured; Markdown is the established API documentation. |
| Tests/CI | Node test runner, fake clocks/providers, existing owned Docker/PostgreSQL harness and Chrome smoke/real-city acceptance. Workflow runs `verify:phase1` and `test:city:e2e`. No documentation/Mermaid validator or Mermaid package was found. |
| Deployment | Compose runs static city/health/database/migrations with protected runtime disabled. Browser interaction must use supported loopback host development; no guard bypass or Docker runtime enablement is planned here. |

## Mandatory MVP and optional work

Mandatory: authorized Agent selection, explicit interaction credential connection/disconnect, labelled instruction/context form, idempotent Create Task, separate Start execution action, authoritative status/details, eligible cancellation, safe results, bounded Agent history, loading/errors, in-page navigation retention, minimal reload reconciliation, accessibility, tests and city regression verification. Creation and start remain two explicit steps: a Task can exist without running.

Optional/deferred: one-click create-and-run, rich output/Markdown, search/export, notifications, automatic execution retries, durable drafts, advanced permission administration, production login/deployment, scheduling, asynchronous workers and streaming. If cancellation is ineligible or no native execution exists, explain it rather than invent an endpoint. A tool or provider change is never user input.

MVP authorization is explicitly a **local configured operator's delegated interaction capability**, not a multi-user account claim. It grants only reviewed bound Agents and exact route operations. T02 must fail closed without that capability. A deployment requiring actual independent users/tenants must resolve production identity before accepting that deployment scope.

## Documentation and decisions

- [T09 E2E matrix, real runtime crash/response loss, CI tier and verification](end-to-end-reliability.md)

- [T08 threat model, accessibility fixes, measured performance and risk register](interaction-hardening.md)

- [T07 state ownership, reload recovery, reconciliation, scoped invalidation and final verification](interaction-state-synchronization.md)

- [T06 safe results, cursor history, independent historical selection and native browser verification](execution-results-history.md)

- [T05 execution Start, confirmed cancellation, version-fenced reconciliation and real browser/API verification](execution-lifecycle-controls.md)

- [T04 inspector Task form, local access, idempotency recovery and real browser/API verification](task-submission-ui.md)

- [T03 frontend Task/execution client, transport reuse, error/auth semantics and verification](frontend-interaction-client.md)

- [T02 implemented interaction API, capability matrix, migration and verification](interaction-api.md)

- [Component architecture, workflows, UI/state and six sequence diagrams](architecture.md)
- [Actual API reuse, contracts and minimal T02 gaps](api-contracts.md)
- [Permissions, privacy, cancellation and network recovery](security-reliability.md)
- [P4-ADR-001 through P4-ADR-008](decisions.md)
- [Dependency-aware T02-T10 implementation roadmap](implementation-plan.md)
- [Testing strategy, budgets and T01 verification](testing-acceptance.md)

## Phase acceptance gates

Phase 4 may be accepted only after T02-T10 prove the following in the approved scope: distinct limited browser authorization; correct backend-selected identity and version fencing; no duplicate Task under response loss; no automatic replay of execute/cancel; live request navigation semantics disclosed; immutable terminal states; authorized result/history with safe rendering; no cross-Agent or credential-scope cache leakage; one shared activity poller; real browser plus owned PostgreSQL E2E; preserved decorative NPC/camera/environment behavior. Successful compilation alone is insufficient.

T01 made documentation-only changes. T02 added backend contracts and one history index. T03 added frontend data access/shared neutral transport. T04 added a persistent Task section within the existing inspector, local credential dialog and scoped submission journal. T05 added lifecycle controls and version-fenced reconciliation. T06 adds lazy read-only results/history sections with bounded state and safe rendering. T07 composes these owners with Phase 3 sweeps, expiring identifiers-only reload recovery and targeted history invalidation. T04-T07 introduce no backend production, renderer/sprite/animation, dependency or lifecycle-policy change. No commit/push/tag/release/deployment or subsequent implementation task is authorized by this plan.
