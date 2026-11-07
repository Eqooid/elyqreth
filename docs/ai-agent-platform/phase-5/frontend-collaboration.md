# T10 frontend collaboration architecture and implementation

**Final Phase 5 status (2026-10-29): ACCEPTED for the approved local scope; T01-T12 complete.** See [canonical acceptance, current contracts and limitations](acceptance.md). Task-date proposals, checkpoints, counts and future-task statements below are historical, not additional implemented capabilities or current roadmap status.

**T10 COMPLETE for the approved local fixed-owner development/test scope (2026-10-29, Asia/Bangkok).** Architecture was recorded before implementation. The interrupted implementation was recovered without rebuilding completed components. Final verification is recorded below and in the evidence file.

The frontend is hand-maintained ES modules and DOM panels around the existing canvas simulator, not React. T10 extends the selected NPC inspector with a persistent collaboration section. Confirmed directed delegations use a compact relationship list and detail view; no canvas overlay or graph/layout dependency is needed. Existing geometry, camera, NPC sprites/movement and status mapping remain unchanged.

T09 version-2 GET contracts are consumed by a separate typed collaboration client using the existing requestJson/local-origin/abort/error infrastructure. A new optional collaboration-read credential audience is necessary: T09 operator access remains supported for backend tools, but privileged operator credentials must never be entered in the browser. This narrow local read credential can access only the existing T09 controller; it grants no Task mutation, delegation activation, registry administration or provider access. Existing city and interaction credentials remain distinct.

One panel-scoped owner keeps the selected stable Agent/binding/NPC identity, membership page, selected collaboration, snapshot section pages and bounded timeline. Requests are aborted/fenced on selection, panel closure, credential changes and disposal. Credentials and protected collaboration data stay in memory; no localStorage cache or provider key is added. The current backend remains authoritative.

Selection notifications from the existing Phase 3 binding owner provide completed shared sweeps. The collaboration owner consumes those notifications instead of adding a timer/transport/per-NPC poller. Native owner-stream events are invalidation hints; unchanged native snapshots need not be refetched. External observations and reconnect require snapshot refresh as explicitly stated by T09. Reads are coalesced, scoped, bounded and back off after errors. Timeline history remains separate from current snapshots and NPC live activity.

The view uses native textContent, semantic buttons/details, existing panel classes, Icy White tokens, accessible status feedback, explicit back/close navigation and bounded page sizes. External ownership, raw provider status, observation freshness and UNKNOWN health remain distinct. It offers no external control actions. Related native Task/Execution reads use the separately authorized existing interaction client and reuse execution metadata presentation; they do not retarget Task submission or lifecycle controls.

T11-T12 and frontend city rendering changes remain excluded.


## Implemented components and workflow

`dist/js/collaboration-panel.js` mounts alongside the existing Task panel in the NPC inspector. `runtime/collaboration/{contracts.d.ts,validation.js,api-client.js,owner.js}` contains typed read contracts, response narrowing, the HTTP client and one presentation owner. No framework, event bus, database, provider or rendering dependency was added.

1. Start the existing backend and city with approved loopback configuration. Connect the existing city-read session so the NPC has a resolved, fresh Agent binding.
2. Select that NPC, expand **Collaborations**, and connect the distinct collaboration-read credential. Memberships show actual collaboration authority, status and participant role; no membership is inferred from names or location.
3. Open a membership to inspect lifecycle/counts, root Task, participants and directed source-to-target delegations. Relationships are keyed by delegation ID, so multiple relationships between the same Agents remain distinct. Missing NPCs are represented by Agent identity without spawning residents.
4. Open a delegation for parent/child Task and native Execution correlation. **Inspect parent Task** and **Inspect child Task / Execution** use separately connected Phase 4 interaction access, reuse existing metadata formatting, and never retarget Task submission or lifecycle actions. Inaccessible or missing references return safe feedback.
5. Inspect external observations and persisted activity history. External authority, connection-scoped identity, namespace/generation, raw provider status, observation time and backend freshness remain explicit. No external controls or raw result/provider payloads are rendered.
6. Back buttons and Escape restore the previous inspection context. Closing the panel aborts reads; reopening or Refresh retrieves authoritative state. Disconnect, runtime authentication loss, binding replacement, pagehide and disposal clear credentials/protected data or cancel obsolete work as appropriate. Reload requires reconnecting the in-memory credentials.

## Read contracts and authorization

The client consumes only existing schemaVersion 2 routes under `/api/v1/collaboration-activity`: list, `agents/:agentId`, `:sessionId/snapshot`, `:sessionId/timeline` and `:sessionId/events`. Snapshot sections provide summaries, participants and delegations; no duplicate summary/delegation endpoint is invented. The NPC view uses Agent-scoped membership discovery rather than a global feed. `contracts.d.ts` and response validators preserve explicit NATIVE/EXTERNAL authority; unknown source status remains text and progress remains null. Unexpected provider metadata is discarded.

Backend configuration in `apps/api/.env.example` adds `COLLABORATION_READ_ENABLED=false` and an empty `COLLABORATION_READ_TOKEN` example. To enable local inspection, set enabled to true and provide a separate random 32-128 character URL-safe token. The existing registry/owner, city-read and interaction setup is still required. The read credential must differ from registry, city, interaction and external-store credentials. Configuration rejects production/non-loopback use. Existing exact-origin and loopback request guards still apply; all reads remain fixed-owner scoped. No new public connection or collaboration mutation API is introduced.

The narrow audience is accepted only by the T09 GET controller. It cannot read registry/native Task payload routes, activate/cancel collaboration work or invoke providers. Existing operator access remains available to backend tools. Never enter an operator or provider credential into the browser. The collaboration credential is volatile, unlogged and omitted from URLs/storage; existing transport omits cookies, rejects redirects, limits bytes/time and supports AbortSignal. Native metadata additionally requires the existing independently limited interaction credential and Agent allowlist. This does not establish public user login or tenant identity.

## Synchronization, recovery and bounds

The owner responds to existing Phase 3 completed shared REST sweeps; it creates no scheduler, network connection per NPC or animation-frame request. Requests coalesce to one in-flight operation. Native event positions are invalidation hints, not a second lifecycle authority. Unchanged native hints avoid a full snapshot. Memberships refresh every fifth eligible sweep. Selected external observations require snapshot refresh because T09 explicitly cannot promise incremental external commit-order continuity. History cursors browse facts and are not synchronization checkpoints.

Selection/binding/credential generations fence late responses; closing cancels outstanding work. Native cursor, collaboration version and per-item versions cannot regress accepted state. Invalid/expired cursors reset the ambiguous view and recover through a fresh snapshot. Transport errors retain last-known data marked stale and use bounded backoff (maximum 60 seconds, driven by shared sweeps); manual Refresh can retry sooner. A read completing after its binding becomes stale must preserve the stale indicator; the continuation adds a regression test for that race. Authentication rejection clears protected state rather than retaining prior credentials.

Sections use page size 10 (client validation maximum 20), stable backend ordering, bounded cursor trails of 20 pages and replacement rather than unbounded append. Timeline event IDs are deduplicated/validated, ordering comes from the backend, and results are never loaded for summary rendering. Native metadata is an explicit separate read. External IDs cannot be treated as native Execution IDs. No frontend freshness threshold is invented: RECENT/STALE/UNKNOWN/RETIRED are backend observation labels. UNKNOWN connection health and NOT_PROJECTED result availability remain distinct from RUNNING/terminal status; unavailable sources do not fabricate failures.

## Accessibility, design and performance

The existing dark surfaces and Icy White `#F2F9FF` tokens remain dominant. Panels use semantic headings/details/buttons, labelled credential inputs and native modal dialog semantics, status announcements, visible focus, back/Escape navigation and bounded scrolling. Credential fields are cleared on close; focus stays within the dialog and returns to the trigger. Mobile checks cover 390-pixel layout. Reduced-motion CSS suppresses panel transitions/animations. Browser checks inspect the accessibility tree and actual action-text contrast. These are automated keyboard/DOM checks, not formal WCAG certification or a manual screen-reader review.

The relationship list deliberately replaces the optional canvas overlay: confirmed directions and multiple relationships remain readable without invasive renderer/camera changes, per-frame graph layout or city clutter. Protected text uses textContent. Rendering skips unchanged list/field signatures, preserves keyed button focus, and bounds the visible collections. Owner disposal removes listeners and aborts requests; import/disconnected state makes no requests. No new FPS, memory-capacity or long-duration benchmark is claimed; T11 remains responsible for expanded load and assistive-technology review.

## Test layers and evidence

- `tests/collaboration.test.js`: 16 deterministic cases for exact DTO/authority narrowing, unsafe inputs, separate authorization, lazy binding reads, late A/B selection, close/reopen, sweep coalescing, invalidation/history, network/backoff, logout, binding changes, external refresh, cursor recovery and freshness races.
- `scripts/collaboration-browser.mjs` in ordinary browser smoke: real DOM with deterministic HTTP-boundary fixtures, multiple directed relationships, separate native authorization feedback, malicious text escaping, history, outage/reconnect, Agent/auth cleanup, responsive navigation, modal keyboard/AX/contrast/reduced-motion checks. These fixtures are not live provider evidence.
- `apps/api/test/collaboration-read.test.cjs` and `collaboration-activity.integration.cjs`: configuration and genuine scoped HTTP authorization/denial tests. The read token cannot mutate or access native payloads and cross-owner resources remain unavailable.
- `apps/api/test/collaboration-browser.integration.cjs`: Chromium against actual NestJS/PostgreSQL, existing native Runtime Coordinator and genuine rule-based parent/child execution. It verifies persisted child metadata, offline backend state change/reconnect convergence, external mapped/inbox observations, explicit external ownership, safe source retirement and logout. Native Execution remains SUCCEEDED after inspection. The multiple-relationship view uses a separate T02 persistence fixture, never dispatched; this does not add public fanout or reopen a terminal collaboration. External observations use the trusted deterministic ingestion path, not a live LangGraph service in this T10 run.

Reproduce from the repository root with Node 24, installed npm dependencies, local Chromium/Chrome and Docker Desktop running Linux containers:

```powershell
npm.cmd run lint
npm.cmd run check:runtime:web
npm.cmd test
npm.cmd run test:api
npm.cmd run test:db
npm.cmd run test:browser
$env:BROWSER_HARDENING_PHASE4='true'
npm.cmd run test:browser
Remove-Item Env:BROWSER_HARDENING_PHASE4
npm.cmd run build:web
npm.cmd run build
npm.cmd run db:check
```

`test:db` builds the backend and creates/removes labelled disposable PostgreSQL resources; do not point it at or reset a development database. The real collaboration browser case runs inside that suite. `build:web` bundles into a verified temporary directory: root `dist/` is maintained source and must never become a build output directory. Existing CI commands discover these added tests without a new deployment workflow. Local verification does not imply remote CI is green.

See [structured verification and preservation evidence](verification-evidence/t10-verification.json) for exact commands/counts, recovered results, final outcomes and environment failures. The initial continuation database attempts failed because Docker Desktop was stopped; the initial sandbox web build could not resolve Vite's configuration. These are recorded separately from executed passing reruns. No assertion was weakened or test skipped to hide those failures.

## Known limits and T11 prerequisites

Public deployment, tenancy and principal-based multi-user sessions remain outside the approved fixed-owner loopback environment. No live external provider was required/reverified in T10; retained T08 evidence remains historical. External health/results/control support is exactly what T09 projects, not invented in the UI. Browser credential reload is deliberate and protected state is not persisted. No overlay, autonomous coordination, external dispatch/cancel or backend lifecycle behavior is added. T11 should broaden concurrent multi-Agent/security/reliability E2E, manual assistive technology checks, long-duration resource observations and production prerequisite tracking. T11/T12 remain planned.


## Continuation recovery inventory (2026-10-29)

The supplied tree has no Git metadata; `git status`, `git diff` and staged-change inspection cannot establish a branch or untracked state. No applicable AGENTS.md was found. A preserved 504-file pre-T10 SHA256 baseline and a separate continuation baseline identify actual changes without discarding existing work. Prior task documents, actual T09 code and saved execution logs were reviewed instead of treating prompts as completion evidence.

| Area | Recovered state | Continuation work |
| --- | --- | --- |
| ES-module/DOM architecture, client and typed response validation | COMPLETE | Preserved |
| NPC entry, memberships, summaries and participants | COMPLETE | Preserved |
| Delegation list, parent/child native metadata navigation | COMPLETE | Preserved; corrected visibly corrupted text separators |
| Native/external identity, freshness and read-only external presentation | COMPLETE | Preserved |
| Bounded snapshot/history/native invalidation and selection cancellation | COMPLETE | Fixed confirmed stale-binding/read-completion race with red/green unit regression |
| Optional city overlay | Intentionally omitted | Existing panel relationship view satisfies the approved alternative; no renderer edit |
| Read-audience security and real backend browser fixture | COMPLETE in recovered focused logs | Re-ran full backend/database regressions |
| Component/browser tests and city regression | Implemented; most earlier checks passed | Added focused dialog AX/keyboard/contrast/motion assertions and re-ran |
| Final verification, roadmap and architecture documentation | PARTIAL | Finalized against actual outcomes in linked evidence |

The recovered focused real-browser log already passed before continuation. Earlier failed attempts had exposed fixture defects (a second delegation requested after genuine collaboration closure, and a missing test Agent binding); those fixtures were corrected before continuation without loosening product invariants. The continuation did not recreate completed components or change backend lifecycle code.


## Final verification and remaining risks

Final local commands all exit 0: `npm.cmd run lint`, `npm.cmd run check:runtime:web`, `npm.cmd test` (225/225), `npm.cmd run test:api` (271/271), `npm.cmd run test:db` (207/207), `npm.cmd run test:browser` (component/city smoke), its `BROWSER_HARDENING_PHASE4=true` rerun, `npm.cmd run build:web`, `npm.cmd run build`, and `npm.cmd run db:check`. No final tests failed or were skipped. Browser smoke reports zero uncaught exceptions. PostgreSQL tests include prior phases and the actual T10 browser workflow. Remote CI and a live external provider were not rerun or claimed green.

| Risk | Impact / mitigation | T10 classification / follow-up |
| --- | --- | --- |
| Local fixed-owner credentials are not production user/tenant identity | Exact loopback/origin guards, distinct read audience and server ownership filters constrain the approved scope | Non-blocking for local T10; blocks public deployment, retain identity/security prerequisites |
| Last-known external observations may be old or source-retired | Backend freshness, source identity and UNKNOWN health remain visible; no invented failure or controls | Non-blocking documented behavior; T11 should broaden disconnected-source scenarios |
| Automated accessibility/performance evidence is limited | Keyboard/AX/contrast/reduced-motion/mobile and bounded requests are checked; no certification/capacity claim | Non-blocking T10 limit; T11 manual AT and extended resource/load review |
| Remote CI and live provider were not rerun in T10 | Existing CI automatically discovers deterministic tests; retained T08 provider evidence is separately scoped | Non-blocking for frontend slice; verify broader end-to-end acceptance in T11/T12 |

T10 does not close Phase 5. The next task is **Phase 5 T11 - Security, Reliability & Multi-Agent E2E**; it has not begun.
