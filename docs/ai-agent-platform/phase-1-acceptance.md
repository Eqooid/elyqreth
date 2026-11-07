# Phase 1 acceptance review — T08

Review date: 2026-10-21 UTC. Canonical workspace: `C:\Users\user\Desktop\Project\Elyqreth`.

**Decision: READY WITH LIMITATIONS.** All mandatory Phase 1 **local-development** acceptance checks pass. This does not authorize production exposure: person authentication/authorization and operational production controls remain absent or unverified. Hosted CI was defined but not executed remotely.

## Scope and repository findings

Phase 1 provides a local-development control-plane foundation, not a running AI platform. T01 is the preserved audit/design record. T02–T07 implement NestJS HTTP/configuration, PostgreSQL/Drizzle persistence, Agent Registry, Task creation/read APIs, internal Execution allocation/lifecycle coordination, versioned events and protected audit reads. No model, worker, external orchestrator, retry scheduler, transport publisher or NPC execution binding runs.

The existing city remains vanilla JavaScript ES modules, HTML/CSS and Canvas 2D in **root `dist/`, which is source**, with Vite 6.4.4. Backend is `apps/api`, NestJS 11.2.7 / strict TypeScript 5.9.3, Drizzle 0.45.4 and pg 8.23.1. npm workspaces retain the frontend location; Node 24 is required. PostgreSQL 17.11 is image-digest pinned in Compose. No additional ORM/backend/build-system framework was introduced.

No applicable AGENTS.md or existing CI workflow was found. This export has **no `.git` metadata**: `git status --short` fails, so no branch, clean-tree or historical-commit claim is possible. A pre-edit SHA-256 inventory was taken outside the workspace to preserve unrelated files. Existing historical documentation and migrations remain authoritative provenance, not descriptions of completed future execution.

## Reproduce verification

From the root, with Node 24/npm, Docker running and an installed Chromium browser:

```sh
npm ci
npm run verify:phase1
```

PowerShell may require `npm.cmd`. `BROWSER_PATH` can specify Chrome/Edge/Chromium. Discovery covers normal Windows Chrome/Edge paths and common Linux Chromium paths. Browser checks fail explicitly if no browser is installed; they do not silently skip. Optional `BROWSER_SCREENSHOT` writes a PNG to a chosen path for inspection.

`verify:phase1` runs lint/static checks, API build, isolated frontend bundle build, migration journal check, city/backend unit/API tests, disposable PostgreSQL integration tests and the browser smoke test in order. `lint` means the existing JavaScript syntax checks plus strict API TypeScript checks; **there is no ESLint rule set**. The frontend has no TypeScript. `build:web` verifies a Vite production bundle in an OS temporary directory and removes only that owned directory. It never writes over `dist/` or changes `.openai/hosting.json`.

The new `.github/workflows/verify.yml` runs `npm ci` and the same verification command on Ubuntu 24.04/Node 24. The hosted runner's Docker engine starts the test harness's isolated PostgreSQL service, rather than a shared database. No credentials, deployment or paid services are required. Remote workflow execution is **NOT VERIFIED**: this local export has not been committed/pushed and no GitHub run was triggered.

## Requirements traceability

Statuses apply to the stated Phase 1 development scope. PASS requires executed behavior or, for documentation/design requirements, source review corroborated by relevant checks. Future production/runtime capabilities are listed separately and do not receive a PASS merely because a document proposes them.

| Requirement | Source | Implementation | Verification / coverage | Status / issue |
| --- | --- | --- | --- | --- |
| Actual source audit and city ownership boundaries | T01 | existing-system-audit.md; `dist/js/{simulation,renderer,activities}.js` | Source/config inspection; city suite and browser smoke corroborate Canvas, NPC and decorative ownership | PASS |
| Modular, framework-independent control plane | T01 | architecture.md; `apps/api/src/{agents,tasks,executions,lifecycle,events}` | Module/DI review and real cross-module acceptance scenario; no provider/framework dependencies | PASS |
| Shared npm workspace without relocating city | T02 | root/package scripts; `apps/api/package.json` | Independent HTTP application and Vite startup; successful `npm ci --offline` from the unchanged lockfile | PASS |
| Strict compilation and DI startup | T02 | `src/application.ts`, `app.module.ts`, module providers | Backend typecheck/build; foundation HTTP tests; real Nest/PostgreSQL startup | PASS |
| Environment validation and precedence | T02 | `src/config/`, registry/database configuration | `foundation.test.cjs`, `database-config.test.cjs`, `agents.test.cjs`: invalid ports/origins/credentials, production and file/process precedence | PASS |
| Lightweight public health | T02 | `src/health/` | Real GET /health with/without DB, exact 200 response; cross-module scenario | PASS |
| HTTP validation, CORS, size limits, safe errors/logs, request IDs | T02 | `src/common/http-foundation.ts` | Foundation HTTP tests: malformed/oversize/unknown bodies, exact origins, unmatched routes, secret markers absent from logs | PASS |
| Shutdown and backend/browser independence | T02 | shutdown hooks; `DatabaseService.onApplicationShutdown` | Repeated app.close/new-instance tests close DB pools; browser runs without API | PASS — platform signal-delivery caveat below |
| PostgreSQL access and bounded configuration | T03 | `src/database/{database.module,pool,database-configuration}.ts` | Real SQL through DI, startup failure on unavailable DB, pool closure and configuration tests | PASS |
| Fresh migrations, repeat application and drift detection | T03 | four migrations; `database/migrate.ts` | Real disposable fresh DB; CLI migration, reapplication, hash-drift rejection | PASS |
| Owner scope, required/null fields, FK/unique/check constraints | T03 | schema.ts; migrations 0000/0001 | Real inserts/updates rejected by PostgreSQL; composite FKs, defaults, UUIDs, timestamps and deletion restrictions | PASS |
| Non-destructive populated upgrades | T03/T05/T07 | additive 0002/0003 indexes | Upgrade T03→current and populated T05→current, preserving rows including repeated legacy event versions | PASS |
| Registration, retrieval, metadata, listing/filtering | T04 | `src/agents/` | `agents.integration.cjs`: real HTTP + SQL + new application instance; bounded deterministic pagination | PASS |
| Agent lifecycle and optimistic versions | T04 | agents.service.ts | activate/disable/archive, repeated no-ops, terminal rejection, If-Match conflicts and rollback | PASS |
| Orchestrator association and safe metadata | T04 | Agent DTO/service, scoped FKs | Missing/cross-owner routes, credentials, unknown/internal fields and unsafe legacy configuration tested | PASS |
| Durable task creation/read without execution | T05 | `src/tasks/` | HTTP/SQL restart tests; CREATED task has zero attempts until internal allocation | PASS |
| Owner-scoped concurrent idempotency | T05 | task service; unique owner/key index | Concurrent equivalent requests yield one task; conflicting input/agent reuses return conflict; replay after completion | PASS |
| Task filters, date validation and stable bounded pagination | T05 | list DTO/service; 0002 index | Real filtered/ordered list queries, bad dates/bounds and owner scoping | PASS |
| Internal attempt allocation and history | T05 | `src/executions/` | Concurrent allocations, unique attempts, history preservation, cross-task reads, new instance and no public write routes | PASS |
| Central Task and Execution transition matrices | T06 | lifecycle-policy.ts; lifecycle services | Exhaustive matrix unit tests and real success/failure/timeout/cancellation paths | PASS |
| Paired states, timestamps and terminal immutability | T06 | TaskLifecycleService transactions | Persisted status/timestamp checks, stale/terminal/mismatched commands and real transaction rollback | PASS |
| Concurrent state transitions and capacity | T06 | parent row locks, versions and partial unique indexes | Concurrent queue/start, native agent capacity, completion/cancellation and success/failure races | PASS |
| Cancellation/timeout policy without process termination | T06 | internal lifecycle methods | CREATED/no attempt, CREATED/PENDING, QUEUED and RUNNING cancellation; pending/running timeout; no automatic retries | PASS |
| Versioned typed/runtime-validated event contracts | T07 | `events/contracts/event-contracts.ts` | All 17 types, schema/status/identity/version/timestamp/cursor validation; unsafe payload rejection | PASS |
| Atomic registry/task/execution lifecycle events | T07 | EventsService.appendState inside caller transactions | Injected event-insert failures roll back domain/audit/outbox; no-op and rejected transitions create no extra facts | PASS |
| Durable ordering, correlation and deduplication | T07 | owner stream trigger; 0003 index; EventsService | Owner commit-order locks/rollback, same-operation correlations, aggregate-version uniqueness and deterministic cursors | PASS — no global cross-owner order |
| Audit reads, filtering and pagination | T07 | EventsController/guard/service | Real Agent/Task/Execution history, cursor/offset/type/correlation filters, scoped existence and restart | PASS |
| Append-only behavior and safe historical reads | T07 | guards/routes and DB triggers; serializeEvent | SQL update/delete rejection, no write APIs; invalid/unknown contracts redacted rather than exposed | PASS — privileged DB admins can bypass |
| Full cross-module result/restart scenario | T08 | `test/acceptance.integration.cjs` | HTTP registry/task, trusted allocation/queue/start/complete, stored result reference, paired timestamps, events/outbox, new instance and idempotent replay | PASS |
| Local opt-in access and production fail-closed | T04–T07 | registry configuration; LocalAccessGuard | Production/default HTTP 404, invalid production enablement, socket/Host/Origin/token and cross-owner tests | PASS — not production authentication |
| Existing city preservation and regression | T01–T08 | unchanged `dist/`; four city test files | 51 city tests; production bundle; Chrome desktop/mobile smoke and screenshot review; baseline hashes | PASS — smoke scope, not exhaustive visual acceptance |
| Reproducible combined verification and CI definition | T08 | root scripts; `.github/workflows/verify.yml` | Complete local command passed after locked reinstall; hosted job not triggered | PASS locally; remote execution NOT VERIFIED |

## T08 stabilization and deviations

No production domain defect requiring a backend rewrite or migration was found. Changes are focused acceptance tests, reproducible verification tooling, a CI definition and documentation.

1. **Café test fixture defect:** seed 3 reproduced the previous intermittent assertion with a completed mission and a valid `encounter-2-approach` lease held by idle socializing agents. `chance:0` disables activity admissions, not independent street encounters. The café interruption fixture now uses seed 3 and sets its encounter timer to Infinity. The strict zero-reservation assertion and all four interruption states remain; the random function is restored in finally. Existing encounter/purposeful-city tests still exercise encounters. City source and actual behavior are unchanged.
2. **Unit runner contention:** a combined run with concurrent Nest test files hit the unchanged 10-second startup-child deadline (44/45 backend tests). The exact test passed alone in 871 ms. The backend unit runner now bounds test-file concurrency to one; deadlines and assertions are unchanged, and subprocess errors are explicitly asserted. Database concurrency tests retain real concurrent operations and are not serialized internally.
3. **Earlier scope proposals:** T01 mentioned in-process workers, runtime handlers, automatic recovery/retries and realtime delivery. Subsequent explicit T02–T07 scopes excluded them. They are FUTURE, not missing implemented workers. Schema leases/reconciliation/outbox fields do not mean a worker/relay exists.
4. Actual Agent states are ACTIVE/DISABLED/ARCHIVED, with required orchestrator association. There is no INACTIVE/deactivate operation. Native, LLM and external logical registrations do not instantiate providers. Task routing snapshots are immutable. Names are display labels and may repeat. These decisions predate T08 and are documented in the T03/T04 guides.
5. Task QUEUED→FAILED and pending Execution→FAILED/TIMED_OUT support pre-start failure/timeout. All repeated lifecycle commands conflict; Agent same-status operations are idempotent no-ops. T06 queue creates/adopts an attempt atomically; the acceptance scenario allocates through T05 first and then queues/adopts it. It does not bypass the state machine or allocate a second active attempt.
6. Execution success is the existing canonical event `execution.completed` with payload status SUCCEEDED, not a newly introduced alias. Old events are retained; unknown/invalid contracts expose redacted payloads.

## Database and transaction evidence

There are 11 public tables and four versioned migrations: `0000_initial_platform.sql`, `0001_persistence_guards.sql`, `0002_task_list_order.sql`, `0003_event_history.sql`. T08 changes no schema or historical migration. `npm run db:check` checks journal consistency; **it is not a real migration test**. `npm run test:db` applies the actual migrations and CLI against a fresh PostgreSQL database, checks schema/constraints, upgrades populated earlier schemas, and restarts the actual PostgreSQL container with its named volume.

The harness ignores developer DATABASE_URL/TEST_DATABASE_URL, creates randomly named database/container/volume resources with a unique label and random temporary credentials, binds a random loopback-only port, and checks identity/labels before deletion. No user database is reset. Production migrations remain an explicit `npm run db:migrate` operation after configuration/backup review, never an application-startup side effect. Forward fixes and backups are required; no down/reset promise is made.

Task idempotency combines an owner/key transaction advisory lock with a database unique constraint. Attempt creation locks the parent task and has a task/attempt unique index plus a partial one-active-attempt constraint. Lifecycle commands lock the task then selected attempt and recheck versions/ownership/latest-attempt invariants. Paired updates, events, command audit and outbox commit in the same transaction. Event insertion failure tests check persisted rows after rollback, not just returned exceptions.

Event stream positions are allocated through a locked owner counter, with aggregate sequences and aggregate-version deduplication for the new writer. This provides deterministic **per-owner** committed ordering; no cross-owner/global ordering or distributed delivery is claimed. UTC occurrence and persistence times are distinct and do not replace cursors.

## Cross-module acceptance scenario

Run with `npm run test:db`; the test named **Phase 1 acceptance: HTTP registry/task, trusted attempt/lifecycle, audit and new-instance persistence** is included automatically.

An isolated SQL fixture provisions only the test owner and enabled logical route. The test starts the real Nest application, verifies health, registers an Agent over HTTP, activates it, creates/retrieves a Task over HTTP and verifies zero automatic attempts. It uses the trusted allocation service, queues/adopts the attempt, starts both records atomically and completes them with an opaque reference to a test-only persisted result. No status fields are patched directly. It verifies COMPLETED/SUCCEEDED, aligned timestamps, bounded history, seven ordered task-related facts, correlations and nine owner outbox rows (including registration/activation). A new Nest instance/pool retrieves identical persisted representations, replays the idempotency key, rejects terminal mutation and exposes no public worker/event-write routes. Input markers, token and result reference are absent from responses/logs.

## API and security acceptance

Implemented routes use `/api/v1`: Agent create/list/detail/metadata/activate/disable/archive; Task create/list/detail; nested Task Execution list/detail; Agent/Task/top-level Execution event reads. `/health` is public liveness only. Lifecycle/event/Execution mutation has no public route. Request IDs and generic status/error messages are consistent. Names, IDs, queries, input sizes, metadata keys, capability arrays and dates are bounded. Task input is excluded from reads/events/logs. Configuration is closed metadata, not credential storage. Raw ORM errors and headers/bodies are not logged.

No person authentication/membership service exists. Access requires explicit dev/test enablement, literal loopback binding/socket, valid Host/Origin, configured owner and constant-time bearer credential comparison. Production enablement is rejected and disabled endpoints return 404. This is a **local operator boundary**, not production RBAC. Do not tunnel it, set NODE_ENV incorrectly on a public host, or interpret CORS as authentication. Full identity, tenant authorization, TLS, per-user audit, rate limits, credential lifecycle, hardened DB roles, backups/restores and operational monitoring are prerequisites to production exposure. No tool/process permissions or prompt-injection mitigation is claimed, because no execution is enabled. Input secret heuristics cannot guarantee arbitrary prose contains no sensitive data; use only approved nonsecret input.

Graceful application/pool closure is exercised repeatedly. SIGINT/SIGTERM hooks are configured, but operating-system signal-delivery/drain behavior under production load is NOT VERIFIED by Windows app.close tests. Docker test superuser privileges are confined to disposable resources; least-privilege production roles and backup restoration are NOT VERIFIED. Audit append-only controls are not tamper resistance against database administrators.

## Frontend regression and preservation

The 51 existing city tests cover pathfinding/collision, movement, schedules, lease cleanup, handoffs, train stops, rivers, road/bridge topology, traffic, independent decorative people and theme/material behavior. T08 changes one test fixture only. The browser smoke launches an owned headless Chromium profile and a loopback Vite server, with no API server dependency. Desktop 1440×1000 and mobile 390×844 are exercised. Checks cover a nonempty Canvas, four residents, decorative citizens, advancing environment/water/train/NPC positions, camera zoom/focus/recenter, help/debug panels, demo mission start/pause/resume/reset, mobile reload and no horizontal overflow. Requests must remain local/static, with no API/health requests or uncaught exceptions/resource failures.

A desktop screenshot was inspected: Icy White branding/lights, retained buildings/roads, park, river/bridge, railway/Central Station, NPCs and mission panel are present. This is a smoke/structural review, **not a pixel-diff baseline, full gesture/accessibility audit, FPS benchmark or long-duration browser soak**. Existing automated long-duration simulation tests supplement it. Static hosting, frontend source and assets remain unchanged; a bundle verification is not a deployment change.

## Executed command evidence

| Command / check | Result |
| --- | --- |
| `git status --short` | BLOCKED: export has no Git metadata; no commit comparison possible |
| Initial `npm.cmd run test:all` | 51 city + 45 backend passed before T08 stabilization |
| First `npm.cmd run test:db` | BLOCKED by stopped Docker Desktop engine, not a schema/application failure |
| Docker Desktop start, then `npm.cmd run test:db` | 49/49 passed, including new acceptance scenario; 0 skipped |
| First sandboxed `test:browser` / `db:check` | Sandbox blocked Vite parent-directory access / Drizzle user lookup; rerun with tool approval |
| `npm.cmd run test:browser` | PASS in Chrome 155.0.8059.85; 0 uncaught exceptions, no API requests; strengthened water/train/NPC checks also passed |
| `npm.cmd run build:web` | PASS: 35 modules, generated HTML/CSS/JS bundle in owned temporary directory |
| First combined `verify:phase1` | City 51/51, backend 44/45; startup child hit 10-second deadline under concurrent test-file load; isolated retest 3/3 passed |
| `npm.cmd ci --offline` | PASS: 175 packages installed from the local cache using the unchanged lockfile. Transitive esbuild-kit deprecation warnings remain; offline audit output is not a fresh vulnerability assessment. |
| Final `npm.cmd run verify:phase1` | PASS, exit 0: lint/static/typecheck, API build, frontend bundle, migration journal, **51/51 city + 45/45 backend + 49/49 PostgreSQL**; zero failures/skips. Chrome smoke passed with 62 local resource requests, zero exceptions and no API requests. |
| Documentation and preservation | PASS: 14 reviewed documents, 16 current acceptance/workflow links and balanced code fences; 197 protected baseline files checked, zero changed/missing. A first ad-hoc placeholder check incorrectly matched the legitimate PENDING lifecycle status; the corrected check passed. |
| Disposable Docker resource inspection | PASS: no containers or volumes with the test-run label remain after cleanup. |
| Hosted GitHub Actions | NOT VERIFIED; workflow created but not submitted remotely |

## Files changed and preservation evidence

Created:

- `.github/workflows/verify.yml`
- `apps/api/test/acceptance.integration.cjs`
- `scripts/browser-smoke.mjs`
- `scripts/build-web.mjs`
- `docs/ai-agent-platform/phase-1-acceptance.md`

Modified:

- Root `package.json`, `README.md`, `WORKSPACE.md`.
- `apps/api/package.json`; tests `database-config.test.cjs`, `foundation.test.cjs`, `database.integration.cjs`.
- `tests/simulation.test.js` (fixture only).
- Documentation in `docs/ai-agent-platform/`: `README.md`, `architecture.md`, `domain-model.md`, `backend-foundation.md`, `database-foundation.md`, `agent-registry.md`, `task-execution-persistence.md`, `lifecycle-service.md`, `event-audit-foundation.md`, `phase-1-implementation-plan.md`, `security-and-reliability.md`.

Removed: none. No dependencies or lockfile versions changed. Rebuilt `apps/api/dist` is ignored generated output. SHA-256 comparison with the pre-T08 inventory confirms all **51 city source/assets**, **41 backend application source files** and **nine migration SQL/metadata files** unchanged, together with reference material, static hosting and frontend configuration. There is no Git commit baseline; these checks establish preservation over this task only. The test-only café fixture change is explicit above. Test resources are removed through the existing identity/label-checked container cleanup.

## Release readiness and remaining limitations

**READY WITH LIMITATIONS** for Phase 1 local development. All combined mandatory checks executed successfully after stabilization and the locked reinstall. There are no unresolved confirmed Phase 1 application defects. No Phase 2 work has begun. Historical T01–T07 counts remain historical, not the final T08 evidence.

Nonblocking development limitations and follow-ups:

- Hosted GitHub Actions execution is NOT VERIFIED; commit/push only when separately authorized, then inspect that first run. The identical local verification command passed.
- Full identity/tenant authorization, TLS deployment, constrained production DB roles, backup/restore, rate limiting and monitoring must precede production exposure. Current APIs intentionally fail closed in production.
- Browser smoke and screenshot review do not establish pixel equality, complete touch/keyboard/accessibility coverage or a performance budget. Define reference captures/FPS thresholds before claiming those guarantees.
- OS signal-delivery/drain behavior under production load and production TLS/backup recovery were not exercised. Application/pool close and new-instance persistence were exercised.
- The export has no Git history, and transitive build-tool deprecation warnings remain. No dependency upgrade or Git initialization was performed under acceptance scope.
- Task input safety is bounded/heuristic, audit administrators retain privileged access, and persistence is not a processing runtime. Durable recovery, actual abort, retries, adapter authority and delivery remain future design work.

Once all mandatory development checks pass, the next recommendation is **Phase 2 T01 — AI Agent Runtime Architecture & Implementation Plan**, with a security/ownership review before any real runtime or external adapter is enabled. It must plan durable recovery and execution authority explicitly; registering an Agent, activating it or creating a Task currently starts no process.
