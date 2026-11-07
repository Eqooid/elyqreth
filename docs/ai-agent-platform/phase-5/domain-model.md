# Proposed domain and persistence model

**Final Phase 5 status (2026-10-29): ACCEPTED for the approved local scope; T01-T12 complete.** See [canonical acceptance, current contracts and limitations](acceptance.md). Task-date proposals, checkpoints, counts and future-task statements below are historical, not additional implemented capabilities or current roadmap status.

**T07 checkpoint (2026-10-28):** [External mappings and ingestion](external-ingestion.md) implement durable source incarnations, explicit identity approval, authenticated internal receipt, conservative ordered observation and bounded replay. External data never mutates native work. Real providers/public webhooks/polling and activity/UI integration remain deferred. Earlier task/planning snapshots below are historical.


**T06 checkpoint (2026-10-28):** [External adapter foundation](adapter-foundation.md) implements provider-neutral contracts, capability/ownership gates, trusted configuration and bounded transport with an empty production registry. No real provider, external persistence/ingestion or dispatch is implemented. Earlier planning/task snapshots below are historical.


**T02 checkpoint (2026-10-27):** Internal collaboration domain/persistence is implemented and verified in [the persistence reference](persistence.md). The T01 design/audit below is retained as its planning-date record; APIs, runtime delegation and external integration remain unimplemented.

All additions are **PROPOSED** for T02/T07. No migrations are created by T01. Existing schema has neither parent/child Task links nor collaboration aggregates. Preserve existing Task/Execution statuses, owner composite FKs and native fences.

## Concepts and storage decisions

| Concept | Identity, ownership and relationships | Lifecycle / persistence / authorization / audit |
| --- | --- | --- |
| CollaborationSession | New UUID and ownerId; native or external ownership mode; rootTaskId optional for imported observations | CREATED/ACTIVE/WAITING/COMPLETED/FAILED/CANCELLED proposed aggregate, version and timestamps. Persist session policy and cancellation intent. Same-owner reads/commands; audit mutations |
| CollaborationParticipant | `(ownerId, sessionId, agentId)` unique; approved role/coordinator/delegate, explicit capability snapshot | Membership enable/withdraw state; withdraw blocks new work, never deletes history or cancels work implicitly. Persist membership; check both Agent route and session authority |
| Delegation | UUID; session, parentTaskId, sourceAgentId, targetAgentId, sourceExecutionId, childTaskId nullable until acceptance; all same owner | Persist decision, idempotency/hash, expected versions, deadline and final outcome. Authorization checks both source and target, not merely session membership; audit every accepted/rejected decision |
| Handoff | Event/fact on Delegation, not an additional mutable table in MVP | Requested/accepted/rejected/result-returned facts and sanitized references, emitted transactionally; no duplicate status owner |
| Task relationship | Delegation is the canonical parent/child Task link; unique child attachment, explicit continuation Task link | Do not add unrelated free-form parent IDs to Task input. Lock session then sorted Task IDs then attempts consistently. Enforce acyclic/depth/count rules transactionally |
| Execution correlation | Delegation source/child/continuation Execution IDs link real attempts; Task ID is not an Execution ID | Same-owner and matching Task/Agent checks. New attempt/new continuation identity on approved retry; never overwrite a terminal source Execution |
| CollaborationEvent | Extend existing durable event/audit mechanism, not a second event database | New aggregate/contract definitions and DB checks must be migrated explicitly. Existing source uniqueness/outbox reused; redact prompts/results. Version/order and correlation/causation retained |
| ExternalOrchestrator | Reuse existing `orchestrators` UUID/ownerId/type/registration/connectivity/config reference | New validated adapter descriptor/config generation. ENABLED is not CONNECTED. Administrative local provisioning; do not expose credentials to browsers |
| ExternalAgentMapping | New UUID; unique `(ownerId, orchestratorId, namespace, externalAgentId)` to exactly one existing EXTERNAL Agent | Active/tombstoned/versioned; no name/position inference. Admin approval for discovery activation, same-owner FKs, audit remaps |
| ExternalExecutionMapping / observation | Stable namespaced external run key, local UUID correlation, external Task reference if actually provided, source incarnation and status evidence | Reuse `executions.authority=EXTERNAL` only with a real authorized correlated Task and representable lifecycle. Otherwise store a bounded separate external observation/mapping with no invented native Task. Persist dedupe/version/expiry; external ingestion permission only |
| External inbox | New bounded accepted-event receipt keyed by provider generation and source identity | Atomically record validation/dedupe/application result. It is not the existing outbound event_outbox. Retention must preserve required dedupe/replay window; authorization ties to registered source |

Native Task/Execution/result services remain the canonical work stores. Session and Delegation describe relationships, not parallel copies of Task input/status/results. External observation rows are source evidence, not native dispatchable attempts. T07 must choose exact table names and whether representable external attempts are needed by the reference; do not force unknown remote states/timestamps into native enums.

## Integrity and namespaces

All new relationships include ownerId, same-owner composite FKs, unique idempotency constraints and safe immutable source references. UUIDs/cursors are stable server identifiers. A tenant abstraction does not currently exist: owner is the durable local scope, not a claim of production authentication. Cross-owner collaboration is rejected in the MVP.

External key = configured owner + orchestrator UUID + installation/workspace namespace + opaque external ID. Adapter/version/config generation identifies the source incarnation; a remote ID reused after reinstall must not inherit old permissions/history. Native `executions_external_identity_idx` currently omits namespace; T07 must encode a collision-safe canonical key or add a compatible scoped uniqueness migration before reusing that column. Never truncate/human-normalize opaque IDs into collisions.

Many external mappings cannot silently target one internal Agent. Require explicit unmap/remap with version checks; disconnection freezes admission/observations and marks freshness, preserving Agent/NPC/execution history. Re-registration does not reactivate tombstones or reassign NPCs automatically. Existing binding uniqueness remains authoritative, and imported Agent discovery never spawns residents.

## Persistence and rollback gates

T02 reviews additive migrations for sessions/members/delegations and typed event aggregate/check extensions. T07 owns external mapping/inbox/observation persistence; T06 owns contracts only. Index owner/session/version, parent/child Task, provider/source key and pending ingestion eligibility. No N+1 relation traversal or unbounded payload columns. Retain existing 64KiB work/result ceilings; proposed events maximum 16KiB safe metadata, history pages default 10/max20. Validate operational counts separately from display limits.

Every future migration needs isolated PostgreSQL FK/concurrency/backfill tests and rollback guidance. Additive schema must not reinterpret Phase 1-4 data; disabling Phase 5 leaves native rows readable. Rollback is disable writes and retain history first, not destructive dropping of accepted work. No unconditional cascade deletion of Agents/Tasks/NPCs.
