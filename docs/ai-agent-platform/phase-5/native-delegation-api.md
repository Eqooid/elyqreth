# T03 - Native delegation contracts and authorization

**Final Phase 5 status (2026-10-29): ACCEPTED for the approved local scope; T01-T12 complete.** See [canonical acceptance, current contracts and limitations](acceptance.md). Task-date proposals, checkpoints, counts and future-task statements below are historical, not additional implemented capabilities or current roadmap status.

**T05 checkpoint (2026-10-27):** [Lifecycle and recovery](lifecycle-recovery.md) adds bounded operator reconciliation, durable cancellation intents, conservative aggregate state and explicit recovery of never-admitted children. Native uncertain outcomes remain quarantined; no worker, scheduler, terminal reset or external integration is introduced. Earlier task checkpoints below are historical.


**T04 checkpoint (2026-10-27):** [Native coordination](native-coordination.md) implements explicit operator activation, one correlated child through the existing Runtime Coordinator, canonical result-reference return and conservative interruption safety. No parent continuation, scheduler, external integration or collaboration UI is added. Earlier task-scoped planning statements below are historical.


Reviewed 2026-10-27, Asia/Bangkok. **Creating a delegation request does not automatically execute the delegated Task in T03.** No child Task, acceptance, runtime call, scheduling, result propagation, external integration or frontend is introduced. The existing [T02 repository](persistence.md) is reused without a migration.

## Scope and actual capability matrix

All paths below start with `/api/v1/collaborations`. They are implemented for the existing **trusted local-development operator** only. Authentication uses `AGENT_REGISTRY_TOKEN` through the existing loopback/Host/Origin/development-or-test boundary. City-read and limited city-interaction credentials are not broadened; the global exact-route interaction guard rejects their access. This is not human account/session or production tenant authentication.

| Method / suffix | Request DTO / input | Safe response / behavior |
| --- | --- | --- |
| POST root | `CreateCollaborationDto` | Collaboration detail; new 201, same authorized creation replay 200 |
| GET `/lookup` | `CollaborationLookupDto` query | `{collaboration: detail|null}` for exact owner/operator creation key |
| GET `/:sessionId` | UUID route parameter | Owned NATIVE collaboration detail; missing/inaccessible/external 404 |
| GET `/:sessionId/participants` | `CollaborationPageDto` query | Bounded participant page, including retained membership history |
| POST `/:sessionId/delegations` | `RequestDelegationDto` | Delegation detail in REQUESTED; new 201, compatible replay 200 |
| GET `/:sessionId/delegations/lookup` | `CollaborationLookupDto` query | `{delegation: detail|null}`; exact key, filtered to the authorized route session |
| GET `/:sessionId/delegations/:delegationId` | UUID route parameters | Exact owned delegation attached to that session; otherwise 404 |
| GET `/:sessionId/delegations` | `CollaborationPageDto` query | Bounded deterministic delegation records; no per-row result queries |

There is no collection-wide collaboration search, arbitrary PATCH/status route, decision/reject/withdraw/accept/execute/cancel/return/event endpoint or external registration/ingestion route. Methods not implemented remain 404; rejection is not a successful no-op. Eligibility uses these existing owned detail/participant/Agent contracts plus mutation-time checks; a separate discovery/eligibility endpoint is not needed for this request-only slice.

## Wire contracts

```typescript
// Actual request fields; additional fields are rejected.
type CreateCollaboration = {
  rootTaskId: string;                // existing owned Task UUID
  participantAgentIds: [string, string]; // two distinct existing Agent UUIDs
  idempotencyKey: string;            // [A-Za-z0-9._:-], 1..128 chars
};
type RequestDelegation = {
  sourceAgentId: string;
  targetAgentId: string;
  parentTaskId: string;
  sourceExecutionId: string;         // exact latest successful native attempt
  idempotencyKey: string;
};
type PageQuery = { limit?: number; after?: string }; // URL limit integer text, default10/max20
type LookupQuery = { idempotencyKey: string };
```

IDs normalize to lowercase before validation/hash comparison. Mutations require JSON. Raw keys are checked before class-transformer can discard constructor/prototype fields, then the existing strict ValidationPipe validates decorated DTOs. Arrays, malformed IDs/keys, unsupported query parameters/filters, oversized page limits and body fields such as ownerId, tenantId, authority, status, childTaskId, instructions, results, provider credentials or arbitrary metadata are rejected. Existing 64KiB body limits remain in force. Creation is not a resource-state PATCH: no `If-Match`, client command UUID or client authoritative correlation/status is accepted here.

No instruction text is duplicated in Delegation storage. The approved reference is the existing parent Task plus exact source Execution. T04 must explicitly authorize and persist any future child input through existing Task persistence; T03 neither copies a transcript nor interprets results as commands.

Response types in `collaboration.contract.ts` reuse safe T02 views:

- Collaboration: `id, authority, rootTaskId, status, version, createdAt, updatedAt, finishedAt`.
- Participant item: `id, agentId, role, joinedAt, leftAt`.
- Delegation: `id, sessionId, sourceAgentId, targetAgentId, parentTaskId, childTaskId, continuationTaskId, sourceExecutionId, childExecutionId, continuationExecutionId, status, version, createdAt, updatedAt, finishedAt`.
- Lists: `{items,nextCursor}`; optional references/terminal timestamps are null, timestamps are ISO strings.

No ORM row, owner identity, private Task input, result content, provider configuration, command key/hash or raw error is exposed. Details may show an already persisted non-REQUESTED state from future/internal work; this API cannot set it.

## Authorization and eligibility

`CollaborationHttpGuard` authenticates the operator directly with `assertLocalRequest`; it does not inherit the limited interaction-principal shortcut. `CollaborationApiService` derives the fixed owner and stable actor label server-side. Each Task, Agent, membership, session, route and lookup is independently owner-scoped. Agent ownership alone is not treated as authorization to a supplied parent Task; the Task is fetched independently and checked against both session context and source Agent. Existing operator privileges apply to owned Tasks; ordinary user/tenant delegation is not implemented.

New collaboration creation requires exactly two accessible ACTIVE native-type RULE_BASED/LLM Agents, ENABLED same-owner orchestrator routes, and an existing root Task whose Agent is a participant with matching current route. CREATED/QUEUED/RUNNING/COMPLETED roots are permitted so a session can precede the first execution; FAILED/CANCELLED roots cannot initiate a new native recipe. Authority is fixed NATIVE by the service.

New delegation requests require all of:

1. Owned NATIVE session in CREATED/ACTIVE/WAITING.
2. Accessible, distinct ACTIVE RULE_BASED/LLM source and target with ENABLED current routes.
3. Both are active persisted participants; no automatic enrollment. Initial DELEGATE and COORDINATOR roles are recognized membership metadata, not independent grants. This first recipe permits two active participants.
4. Parent Task independently belongs to the owner and expected source Agent/current route.
5. Parent is COMPLETED, and supplied sourceExecutionId is the exact latest SUCCEEDED NATIVE attempt for that Task/Agent. Running, pending, failed, cancelled, missing/stale or externally owned source attempts are not valid native handoff evidence.
6. Parent is the session root or a genuinely related child/continuation, with no existing outgoing delegation in that session. No arbitrary same-owner Task or another session's descendant is admitted.
7. Fixed first-recipe bounds: no fanout, depth at most two and three total work Tasks, counting pending child reservations; at most two delegation records. Existing deeper/oversized internal histories remain readable but cannot bypass admission bounds.

These are request eligibility rules, not a guarantee that a provider/profile is currently runnable or that a target Agent has spare execution capacity. Registry capabilities are descriptive; no new delegation capability tag or tool privilege is invented. T04 must revalidate actual Runtime Coordinator admission/provider policy before child work. Historical COMPLETED state does not imply currently active Agent work.

## Idempotency and recovery

T02 creation identity remains `(owner, actorReference, operation, key)`; operation is separated by the two tables. The stable API actor is `local-collaboration-operator`. Session ID and all semantic source/target/Task/Execution references are part of the delegation request hash. A same-owner/operator key reused with a different session or payload conflicts, rather than returning the other session's record. Different owners have independent identities even when using identical keys. The API cannot recover records created under an unrelated internal actor label.

Compatible mutation replay is an authorized read of existing intent, not a new admission. It rechecks operator authentication, owned session/root/Agent visibility and immutable payload hash, but does not require currently ACTIVE/open admission conditions after disable/withdrawal/terminalization. The owned historical detail/recovery contract remains available; no new Task, Execution, delegation, membership, accepted audit or event is written by replay. Changed payload replay is 409; a guessed key never grants object access.

On a lost response, GET the exact lookup with the same key and authorized session. Null means no matching committed record at that observation, not permission to blindly invent a new key. A caller may explicitly retry the identical authorized idempotent request to reconcile a race. Keys persist with their retained records; no expiry, automatic mutation retry or idempotency simulation in memory is added.

## Transactions and races

All policy/admission and persistence use `CollaborationRepository.run`, the same Drizzle transaction and owner-scoped collaboration advisory lock as T02. Session/membership writers share that lock. Parent Task locks precede attempt and sorted Agent/route share locks, preserving existing native lock conventions. A concurrent disable/status/withdrawal is serialized with the admission decision; invalid new intent rolls back. Terminal native parent/Execution history remains immutable.

The repository rechecks uniqueness/hash, correlation FKs and cycle/write-once constraints. Concurrent identical POSTs yield one 201 and compatible 200 responses; distinct requests cannot fan out one parent. Native execution state is neither written nor inferred from a request acknowledgement. No network/provider/runtime side effect occurs inside a transaction.

## Safe errors and audit

Route-local filter preserves the standard `{statusCode,message,requestId}` envelope and adds a stable `code`. Validation is 400/INVALID_INPUT; missing credentials 401/UNAUTHORIZED; denied operation or inactive membership 403; inaccessible/missing/mismatched nested IDs 404/NOT_FOUND; eligibility/relation/bounds/version/idempotency conflicts 409 with safe codes; persistence unavailable 503. Unsupported media/body-size handling follows existing 415/413 behavior; parser failures before controller routing retain the global safe envelope. No driver diagnostics, instructions, provider text or stack trace is returned.

Accepted requests reuse T02 atomic `delegation.recorded` facts, command_audit and trigger-created outbox rows. Safe metadata includes actor, session/delegation IDs, source/target Agents, parent Task/exact source attempt, version, outcome, timestamp and correlation. A valid UUID X-Request-Id is reused as correlation; other valid request IDs remain HTTP context while a server UUID is generated and linked in safe structured logs. No credential or private payload should be sent as a request ID.

Authenticated policy denials log safe operation/code/correlation and attempt a separate minimal REJECTED command audit after rollback; inaccessible guessed IDs and inputs are not copied into it. Guard/DTO denials use existing HTTP diagnostics without domain writes. Rejected-audit failure never changes denial into success. Database-unavailable failures do not attempt another audit write. Compatible replays produce no duplicate accepted facts/audit. No outbox publisher or runtime execution command is added.

## T01 refinement and T04 prerequisites

The broader T01 proposal included decision/acceptance and child creation during T03. This request-only task deliberately defers those to explicit T04 work, consistent with the current exclusions. No decision endpoint is falsely documented as delivered. Generic command lookup, richer mutation envelopes, chronological timeline APIs and external roles remain proposals; actual T03 uses narrow exact-key lookups and T02 ascending UUID pagination.

T04 must implement explicit acceptance/rejection authorization, final input/disclosure consent, and atomic child Task creation + relation + facts using existing Task persistence on the same transaction. The existing TasksService.create owns its transaction; do not call it as an independent nested commit and assume atomicity. Resolve that compatibility boundary in T04, retain idempotency, revalidate membership/session/Agent/runtime readiness and preserve terminal source semantics. Execute only through the existing coordinator after approval; do not recursively occupy a parent coordinator or assume detached crash resumption.

## Verification and limitations

| Actual command | Result |
| --- | --- |
| `npm.cmd run build` | Exit 0, final backend build |
| `npm.cmd run lint` | Exit 0, maintained JS syntax plus backend/frontend typechecks |
| `npm.cmd run test:api` | Exit 0, 210 passed |
| `node --test --test-name-pattern='P5 T03\|T11 HTTP execute uses real LLM' apps/api/test/database.integration.cjs` | Exit 0, 13 passed: 12 T03 cases and the affected existing LLM audit case |
| `npm.cmd run test:db` | Initial run 144/145 passed; final run exit 0, 145 passed, zero skipped |
| `npm.cmd test` | Exit 0, 209 frontend regression units passed |

The initial full run exposed an added duplicate ApiLogger provider changing the logger instance captured by existing runtime instrumentation. Collaboration now reuses the database module's already-provided logger through an export; runtime logger code/assertions were not changed. Both the targeted audit check and complete suite passed after correction. No migration or schema change was needed.

Actual commands/results are recorded in [T03 verification evidence](verification-evidence/t03-verification.json). Unit policy/DTO/error tests complement real NestJS HTTP/guard/service/PG tests for object isolation, poisoned DTOs, idempotency/restart, same keys across owners, nested enumeration, membership/status/Agent races, bounds and injected persistence failure. Request tests assert unchanged Task/Execution counts. History fixtures explicitly use T02 persistence to test bounded existing records; they are not evidence of executed delegated work.

No production user/tenant authentication, dedicated runtime E2E, paid provider, remote CI, UI or external integration is claimed by this task. Current tenancy is NOT APPLICABLE, not a fabricated passing tenant test. The accepted boundary remains trusted loopback development/test, with existing rate-limit/operational risks retained.
