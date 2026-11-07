# T02 - Collaboration domain and persistence implementation

**Final Phase 5 status (2026-10-29): ACCEPTED for the approved local scope; T01-T12 complete.** See [canonical acceptance, current contracts and limitations](acceptance.md). Task-date proposals, checkpoints, counts and future-task statements below are historical, not additional implemented capabilities or current roadmap status.

**T05 checkpoint (2026-10-27):** [Lifecycle and recovery](lifecycle-recovery.md) adds bounded operator reconciliation, durable cancellation intents, conservative aggregate state and explicit recovery of never-admitted children. Native uncertain outcomes remain quarantined; no worker, scheduler, terminal reset or external integration is introduced. Earlier task checkpoints below are historical.


**T04 checkpoint (2026-10-27):** [Native coordination](native-coordination.md) implements explicit operator activation, one correlated child through the existing Runtime Coordinator, canonical result-reference return and conservative interruption safety. No parent continuation, scheduler, external integration or collaboration UI is added. Earlier task-scoped planning statements below are historical.


**T03 checkpoint (2026-10-27):** [Native delegation request/read APIs](native-delegation-api.md) are implemented for the existing local operator. Broader planning and T01/T02 records below are historical/task-scoped; acceptance, child execution, external integrations and collaboration UI remain deferred.

Reviewed 2026-10-27, Asia/Bangkok. This is an **internal backend persistence foundation**, not a public collaboration API, authorization service, runtime scheduler or external integration. T03-T12 remain PLANNED. T01 proposals remain design documents; this file describes the actual implementation.

## Repository audit and scope

No applicable AGENTS.md was found in accessible ancestors or maintained source. Git status/diff returned 128/129 because no Git metadata is supplied; branch/untracked classification is unavailable. A 425-file pre-edit maintained-source hash inventory preserves prior work. Phase 4's local READY acceptance is retained; public identity/tenancy, automatic crash recovery and orchestrator identity pinning remain outside that acceptance.

The implementation follows P5-ADR-002/003: three tables, delegation as the canonical Task relationship, existing Execution identity, existing owner/version/transaction infrastructure and transactional event/outbox/audit. No separate handoff table, collaboration event database, new ORM or Task/Execution status is introduced. The existing Runtime Coordinator and city source are unchanged.

## Implemented model

| Table | Durable fields / invariants |
| --- | --- |
| `collaboration_sessions` | UUID, valid owner FK, immutable NATIVE/EXTERNAL authority and optional root Task, status/version/timestamps, actor-scoped idempotency key/hash. Root Task FK includes owner. Terminal timestamp iff terminal status |
| `collaboration_participants` | UUID, session/Agent/owner composite FKs, COORDINATOR or DELEGATE role, joined/left timestamps. Unique session/Agent/owner across the entire history, not only active rows. Withdrawal is irreversible in this foundation; no silent rejoin or role mutation |
| `collaboration_delegations` | UUID, session, source/target members, parent/child/continuation Task IDs and optional exact source/child/continuation Execution IDs, status/version/timestamps and actor-scoped creation key/hash. Source and target differ; referenced Tasks/Executions must match owner and intended Agent |

Task/Execution input, status, results, provider metadata and configuration are not copied into these tables. Root Task is optional in persistence; future T03 will decide when a native request requires it and source terminality/eligibility. EXTERNAL is an authority discriminator only: it does not install a remote writer, map external IDs, grant dispatch permission or force unknown remote states into native lifecycle rows.

Same-owner FK references use existing `(id, owner_id)` keys. Delegation participant FKs use `(session_id, agent_id, owner_id)`. SQL guards additionally verify Task-to-Agent and Execution-to-Task/Agent correlation without adding redundant unique indexes to existing work tables. Child/continuation references are write-once; the same work Task cannot acquire two incoming relationships, including cross-role child/continuation reuse. Self-parenting and cycles across existing owner-scoped delegation/continuation edges are rejected, including concurrent SQL writes. No NPC row is created or changed.

Initial membership is bounded to 1-20 distinct Agent IDs for one atomic create; initial roles default to DELEGATE. `addParticipant` supports an explicit role for a new member. Roles are durable metadata, not permissions or runtime coordination privileges. T03 owns final business admission/depth/recipe limits and role semantics, not this storage layer. Pagination limits are not a promise that arbitrarily large collaborations are supported.

## Lifecycle persistence

Session transitions: CREATED -> ACTIVE/CANCELLED; ACTIVE -> WAITING/COMPLETED/FAILED/CANCELLED; WAITING -> ACTIVE/FAILED/CANCELLED. COMPLETED/FAILED/CANCELLED are terminal.

Delegation transitions: REQUESTED -> ACCEPTED/REJECTED/CANCELLED/EXPIRED; ACCEPTED -> EXECUTING/CANCELLED/FAILED; EXECUTING -> AWAITING_RETURN/FAILED/CANCELLED; AWAITING_RETURN -> COMPLETED/FAILED/CANCELLED. COMPLETED/FAILED/CANCELLED/REJECTED/EXPIRED are terminal. ACCEPTED/EXECUTING/AWAITING_RETURN/COMPLETED require a child Task reference.

The pure domain policy and database guards enforce legal transitions. Existing touch triggers advance version/update time; terminal rows and identity/creation fields are immutable, and historical deletes are rejected. These transitions represent storage decisions only. They do not start/cancel an Execution, prove a child succeeded or automatically aggregate a session. T05 must enforce the outcome-derived completion/cancel policy before exposing lifecycle actions. No native Task WAITING state is added.

## Internal repository and DI

`CollaborationModule` exports an injectable `CollaborationRepository`, registered in AppModule with **no controller, scheduler, consumer or runtime dependency**. `run(scope, callback)` opens the existing Drizzle transaction. The callback receives a typed collaboration facade and the same internal `PersistenceTransaction`, allowing future Task persistence composition without nested commits or remote side effects.

Scope is a trusted internal `{ownerId, actorReference, correlationId}` context, validated for shape/identifiers. It is **not authentication** and must never be constructed directly from untrusted HTTP fields. Every read filters owner; every cross-resource write is constrained by owner FKs/guards. A future API must independently resolve principals and authorize source, target, current membership/binding and every operation. There is no tenant model to pretend is implemented.

| Facade operation | Behavior |
| --- | --- |
| `createSession` | Atomically creates session + initial members + facts/audit/outbox, or returns original reference for compatible creation replay |
| `getSession`, `listSessions` | Safe internal DTOs; owned exact read and bounded UUID-keyset list |
| `addParticipant`, `leaveParticipant`, `listParticipants` | Active same-role add is idempotent; explicit withdrawal uses expected session version; no resurrection of historical membership |
| `createDelegation`, `getDelegation`, `findDelegationByKey` | Durable request identity/correlations; no child creation or execution; exact creation-key recovery is actor/owner scoped |
| `listDelegations` | Owned session-scoped DTOs include canonical parent/child/continuation/attempt references; no per-row result query |
| `updateSession`, `updateDelegation` | Expected version, legal transition and write-once reference attachment; updates/facts/audit commit or roll back together |

All lists default to 10, maximum 20, deterministic ascending UUID order and exclusive UUID cursor. They are **not chronological timeline endpoints**; future T09 can use committed event positions for a timeline. Cursors grant no permission and all queries reapply owner/session scope. DTOs omit owner identity, command keys/hashes/actor internals and all private work payloads; no ORM entities are returned publicly.

## Idempotency, concurrency and errors

Creation identity scope is `(owner, actorReference, operation, idempotencyKey)`; operation is separated by session/delegation tables. Keys follow the existing safe 1-128-character convention. SHA-256 hashes include normalized UUIDs and all semantic creation references; initial membership IDs are sorted so input ordering does not create a conflict. Compatible replay returns the durable current reference without more facts/membership writes; different payload reuse raises IDEMPOTENCY_CONFLICT. Keys live with retained records; no automatic expiry/cleanup or retry scheduling is implemented.

Transactions acquire the owner-scoped `:collaboration` PostgreSQL advisory lock before row work. Guards also lock relationship writes so concurrent direct SQL cannot commit a cycle. Session/delegation expected versions prevent silent lost updates; stale mutation retries return CONFLICT, not fabricated success. Database uniqueness remains authoritative. This deliberately serializes even internal read transactions per owner for the bounded local foundation; it is not a distributed scheduler or high-throughput capacity claim. Callers composing raw writes must use the repository transaction/lock order; deadlock/serialization errors translate safely, with no automatic replay.

Stable internal errors are INVALID_INPUT, NOT_FOUND, CONFLICT, IDEMPOTENCY_CONFLICT, INVALID_TRANSITION and PERSISTENCE_UNAVAILABLE. Database SQL/parameters/driver messages are not exposed. Raw SQL may be rejected by a more specific database invariant before an FK check; tests assert failure and atomicity without relying on private driver messages.

## Durable facts and audit

Added nullable `collaboration_id` and `delegation_id` to existing `agent_events`, same-owner relation FKs and collaboration/delegation aggregate identity checks. Native event fields/contract behavior remain unchanged. Collaboration facts use source `elyqreth.collaboration.v1`, immutable aggregate ID/version, source identity, correlation, timestamps and safe reference/status metadata. The existing trigger assigns the commit-safe owner stream position and inserts `event_outbox`; the same transaction records actor/resource/version in `command_audit`.

Facts cover collaboration creation/state/membership, delegation recording/state/correlation and child association. A single combined child/status update emits one fact containing both authoritative stored references and status, not duplicate runtime lifecycle events. No instructions/results/keys/secrets are in payloads. Replays produce no duplicate facts; failed transactions leave no facts/audit/outbox rows.

There is no publisher or consumer. Existing native event-history HTTP contracts are not broadened: collaboration facts have no native Agent/Task/Execution envelope references, and the legacy native serializer treats unfamiliar aggregate contracts as unsupported. T09 will define authorized typed collaboration history; this foundation does not claim the old public event schema already understands these new facts.

## Migration and rollback

`0005_collaboration_foundation.sql` and Drizzle snapshot/journal are additive. Generated SQL was reviewed and extended with the same hand-maintained PL/pgSQL guard/identity/timestamp/history pattern as `0001_persistence_guards.sql`. Older migrations are unchanged. Indexes cover owner/status/session lists, participant Agent lookup, delegation source/target, parent/child/continuation and Execution references, creation uniqueness and collaboration event order. Required composite FK uniqueness is intentional, not speculative denormalization.

Verification uses a fresh owned ephemeral PostgreSQL database and an additional isolated database migrated only through Phase 4, populated with real Agent/Task/Execution rows, then upgraded through the current migration. Native rows compare unchanged. Existing legacy event migration tests also require the two new fields to be null while preserving all previous values.

No automatic down-migration tooling exists. Disable collaboration callers first and retain history. Rolling application code back to Phase 4 is compatible with the additive native fields and existing schema. Do not drop tables/events or edit the migration journal to undo accepted work. Any physical removal requires a separately reviewed archival/forward migration that handles immutable facts/FKs; no destructive rollback command is provided. Generation encountered the known sandbox Windows profile lookup ENOMEM; the existing generator/check succeeded with approved execution outside that limitation.

## Deferred functionality

T03 owns public DTOs/principal authorization/current Agent eligibility, creation of child Tasks and final recipe/role policy. T04/T05 own execution, cancellation, aggregate outcomes and reconciliation. T06-T08 own adapter registration, external namespaced mapping/inbox and ingestion; existing EXTERNAL fields do not grant that capability. T09-T12 own projection/history APIs/UI/final acceptance. No automatic native crash repair, external dispatch, secret store, new tool/provider, rendering or city change is introduced here.

## Verification results

| Actual command | Exit / outcome |
| --- | --- |
| `npm.cmd run build` | 0; backend build, also repeated by test scripts |
| `npm.cmd run lint` | 0; syntax and frontend/backend typechecks |
| `npm.cmd run test:api` | 0; 203 backend units passed |
| `npm.cmd run db:check` | 0; migration metadata consistency |
| `node --test --test-name-pattern='P5 T02' apps/api/test/database.integration.cjs` | 0; expanded 11-case real PostgreSQL subset passed |
| `npm.cmd run test:db` | Initially 1 (130/132 passed, two old schema expectations); after strict expectation corrections 0, all 133 passed, zero skipped |
| `node --test --test-name-pattern='P5 T02 direct concurrent SQL' apps/api/test/database.integration.cjs` | 0; strengthened wrong-Execution fixture passed after full run; subset of 133 |
| `npm.cmd test` | 0; 209 unchanged frontend regression units passed |

Actual command results/log hashes and final preservation checks are recorded in [verification evidence](verification-evidence/t02-verification.json). Historical T01 and Phase 4 test evidence is preserved rather than relabelled as current results. The full database suite executes existing native Chrome Phase 4 workflows alongside registry, lifecycle, runtime, provider/tool, binding, projection and security regressions. Dedicated opt-in city/reliability E2E commands and paid live providers were not rerun for this backend-only foundation. Hosted CI was not executed; the new tests are registered in the existing database harness already invoked by CI.
