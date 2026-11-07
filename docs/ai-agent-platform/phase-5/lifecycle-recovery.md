# T05 - Native collaboration lifecycle, failure and recovery

**Final Phase 5 status (2026-10-29): ACCEPTED for the approved local scope; T01-T12 complete.** See [canonical acceptance, current contracts and limitations](acceptance.md). Task-date proposals, checkpoints, counts and future-task statements below are historical, not additional implemented capabilities or current roadmap status.

Reviewed 2026-10-27 (Asia/Bangkok). **T05 COMPLETE for the bounded local-operator workflow.** This reference describes the implemented system. Final status and commands are recorded in [T05 evidence](verification-evidence/t05-verification.json). T06-T12 are not implemented.

## Audit and scope

T01 ADRs, T02 domain/transactions, T03 authorization and T04 coordination/evidence were reviewed against the actual code. T04 uses the existing synchronous Runtime Coordinator, not a worker service. There is no local RabbitMQ, Redis, durable scheduler, outbox publisher or inbox to extend. The existing event trigger/outbox stores facts only. This task adds explicit operator-driven recovery and bounded reconciliation rather than turning that outbox into an execution queue.

Git status, diff, staged/untracked inspection are unavailable because the supplied workspace has no Git metadata. A pre-edit SHA-256 baseline covers 447 maintained files. Applicable AGENTS.md searches found none. The local-only Phase 4 acceptance and fixed-owner authorization boundary remain prerequisites; this does not accept production accounts or multi-tenant deployment.

## State ownership

| State | Owner and invariant |
| --- | --- |
| Task / Execution | Existing lifecycle/runtime persistence; no new statuses, terminal resets, forced lease expiry or synthetic success |
| Delegation | Existing REQUESTED/ACCEPTED/EXECUTING/AWAITING_RETURN and terminal transitions; canonical child outcome is read through T04 observation |
| Collaboration | Existing CREATED/ACTIVE/WAITING/COMPLETED/FAILED/CANCELLED; owner-locked aggregation of persisted required work |
| Cancellation intent | Durable existing command_audit record scoped by owner, operation and exact session/delegation ID; separate from outcome |
| Recovery dispatch budget | At most three durable delegation.recovery.dispatch audit records per delegation; separate from native attempt count |
| Attention | Derived diagnostic, never an invented Execution state or authority to restart work |

No API accepts status, owner, child Task/Execution IDs, result content, provider configuration or arbitrary lifecycle signals. Reconciliation means reading canonical persistence, not trusting an event payload. T04's request-only GET behavior remains: inspecting an untouched REQUESTED intent does not itself activate a CREATED session. Explicit reconciliation may identify that decision as WAITING.

## Deterministic aggregate algorithm

The first native recipe remains two participants, at most two delegation edges/three work Tasks, depth two and no fanout. There is no optional-work flag: every persisted delegation is required. Reconciliation rejects an oversized session rather than silently ignoring additional work.

1. Terminal sessions are immutable. A valid confirmed result is never undone by late cancellation or a stale signal.
2. Zero delegations remain CREATED, or become CANCELLED after explicit cancellation. Absence of running work is not success. The root Task is not cancelled by collaboration cancellation.
3. Missing/mismatched child correlation, expired RUNNING leases/deadlines, CANCELLATION_UNCONFIRMED or NATIVE_OUTCOME_UNCERTAIN keep open sessions WAITING. Expiry is checked against PostgreSQL clock_timestamp; it is not used as proof that side effects stopped.
4. Incomplete required work is ACTIVE only when a child is EXECUTING and no cancellation/failure is present; otherwise WAITING. Failure/cancellation stops later admission, while already admitted unrelated work is preserved.
5. When all required work is terminal and no native uncertainty remains, any FAILED/REJECTED/EXPIRED delegation makes the session FAILED. All COMPLETED makes it COMPLETED, including when cancellation arrived too late. Otherwise cancelled work makes it CANCELLED.

Existing legal transition paths are preserved: CREATED enters ACTIVE before WAITING or a final outcome where necessary; WAITING returns through ACTIVE before COMPLETED. Versioned repository operations write timestamps, audit and existing transactional facts/outbox. No-op reconciliation writes no duplicate state events. New delegation requests remain allowed in an open eligible session but are denied after terminal closure, a recorded session cancellation or a required failure. All currently persisted required work defines the bounded recipe's completion boundary; future continuation is not implied.

## Child outcomes and failure propagation

T04 observation requires matching child Task, Execution, target Agent, owner, native authority and a validated existing result reference. COMPLETED Task + SUCCEEDED Execution + AVAILABLE result produces delegation completion. FAILED/TIMED_OUT with FAILED Task produces delegation failure. CANCELLED Task/Execution produces the corresponding persisted delegation outcome. Missing, inconsistent or unavailable evidence remains unresolved.

Delegation outcome and runtime certainty are distinct. A CANCELLED native row with CANCELLATION_UNCONFIRMED may already yield a CANCELLED delegation, but its collaboration remains WAITING/requiresAttention. Likewise a native timeout can be persisted while effects remain quarantined. T05 does not erase native uncertainty, invent a finished worker, or promise autonomous crash repair. Ordinary proven native failure closes mandatory work as FAILED. No unrelated Agent is cancelled, no successful result is overwritten and no parent is resumed or fed child output.

## Cancellation

The operator first commits one idempotent cancellation intent. Preparation, new requests and native admission all consult that intent under the existing owner fence. A request cannot slip in new child dispatch after cancellation commits.

Propagation then visits only the session's bounded exact delegations. REQUESTED work without a child is cancelled in the domain. A CREATED child without an attempt is cancelled through the existing Task lifecycle in the same transaction as its delegation update. An admitted eligible child uses the existing exact Task/Execution versions and cancellation lifecycle. Cancellation and completion serialize on existing Task/Execution locks; a terminal native winner is observed, not overwritten. Disabling an Agent does not prevent inspection or finalization of already admitted work.

The cancellation intent survives a failure between recording it and updating children. A later explicit reconciliation re-applies propagation safely after restart. Repeated cancellation neither appends another intent nor cancels unrelated Tasks/Agents. Existing native cancellation quarantine is respected: HTTP acknowledgement does not imply confirmed external effects have stopped. There is no new process termination mechanism or cascade outside these owned delegation references.

## Recovery and retry policy

Recovery is explicit, never a startup dispatch loop. It first reconciles durable cancellation/outcomes, then permits dispatch only for ACCEPTED with an owned CREATED child, no child Execution reference and no persisted attempt for that Task. It revalidates current source/target eligibility, participants, native routes, successful parent and ancestry. The same child identity and existing Task input are reused; the client supplies no replacement instructions or child IDs.

Before calling the Runtime Coordinator, a recovery attempt is durably journalled under the owner lock. At most three such attempts are allowed; interrupted/rejected reservations consume the budget. There is no automatic retry or backoff timer. Native admission independently rechecks cancellation/policy and atomically attaches the first Execution. Even independent API instances that reserve recovery concurrently converge on one native admission; no database transaction spans runtime execution.

| Condition | Policy |
| --- | --- |
| Prepared child, no admitted attempt | Explicit recovery may dispatch the same child, within its three-command budget |
| Capacity/configuration/temporary persistence rejection | Preserve exact identities and safe diagnostic; no fabricated failed Execution; later explicit recovery may be possible |
| Budget exhausted | RECOVERY_EXHAUSTED attention, no further dispatch; no counter reset API |
| An attempt exists, including stale RUNNING | Reconcile only; never replay unknown side effects |
| Terminal success/failure/cancellation | No restart, reset or new native attempt; return canonical references |
| Unauthorized, invalid relationship or cancelled intent | Deny admission; never retry automatically |

Terminal failed Tasks have no supported retry transition. This task deliberately treats terminal failure as non-retryable rather than introducing a new linked retry Task model or reopening terminal records. A separately approved new workflow can use a new identity; these endpoints do not manufacture it. Guaranteed eventual dispatch, arbitrary retry scheduling and automatic crash repair are not claimed.

## Operator API

All routes use existing operator Bearer, trusted loopback/Host/Origin and development/test guards. Limited city/read credentials are not broadened. UUIDs and ownership are independently checked; foreign resources are 404. Unknown body/query fields are rejected. Errors retain existing safe 400/401/403/404/409/503 semantics.

| Method and route under /api/v1/collaborations | Body | Response |
| --- | --- | --- |
| POST /:sessionId/cancel | {} | 200 terminal session, otherwise 202 pending/attention |
| POST /:sessionId/delegations/:delegationId/cancel | {} | Same receipt, scoped cancellation intent |
| POST /:sessionId/delegations/:delegationId/recover | {} | 200 terminal, otherwise 202; only never-admitted child may dispatch |
| POST /:sessionId/reconcile | {} | 200 canonical bounded session receipt, no dispatch |
| POST /reconcile | {limit?: number, after?: UUID} | 200 bounded incomplete-native-session page and nextCursor; default 10, maximum 20 |

Typed CollaborationReconciliation returns collaboration, delegation receipts and requiresAttention. Each delegation receipt reuses T04's safe Task/Execution/result references, plus recoveryAttempts and a safe attention category. Batch returns items and nextCursor ordered by stable session UUID. No result bodies, Task instructions, lease tokens or credentials are exposed. Existing detail/history/result APIs retain their contracts; exact delegation observation also updates applicable aggregate state.

## Restart, replay and concurrency

After restart the authorized operator can reconcile a session or cursor through incomplete sessions. This never dispatches. Only the explicit recover command can resume a provably never-admitted child. Cancellation intents are replayed from the same durable journal. Missing notifications, duplicate notifications and out-of-order progress require no new event consumer: repeat the same canonical read, preserve terminal facts and write a versioned transition only when state changes.

The existing PostgreSQL owner advisory fence serializes collaboration command acceptance, cancellation intent, recovery reservation and aggregate updates across instances. Native Task/Execution row locks, Task versions and write-once child references remain the final admission authority. No process-local map is the sole deduplication mechanism. Unknown native claims stay quarantined. Read-through reconciliation is bounded to one recipe; batch is at most twenty sessions with a stable cursor. There are no per-Agent timers, per-frame network calls, new transports or full-history result requests.

## Persistence, audit and operations

Migration 0006_wise_jigsaw adds only two indexes: command_audit_resource_command_idx for exact control journal lookup, and collaboration_sessions_incomplete_idx for owner/cursor scans of incomplete native sessions. Existing tables, Task/Execution data, lifecycle enums and foreign keys are preserved. Drizzle metadata is generated using existing tooling; historical migrations are unchanged. Rollback may drop those two indexes after separately stopping affected operations; it removes no business data or audit intents. Do not remove T04's delegated-child admission guard during downgrade.

The command audit journal is now part of native control state: cancellation and recovery records must not be purged while their workflows may be inspected or recovered. Existing append-only audit protections are retained. Journal records capture actor, correlation, session/delegation, child/parent and relevant Agent references without Task content. T02 state facts/outbox and native runtime events remain authoritative; they are not re-emitted as duplicate native lifecycle events. Recovery dispatch rejection adds a safe allow-listed error code; diagnosis persistence failure does not manufacture an execution outcome.

Diagnostics distinguish DISPATCH_NOT_ADMITTED, RECOVERY_EXHAUSTED, CORRELATION_MISMATCH, RESULT_UNAVAILABLE, OUTCOME_UNCERTAIN, CANCELLATION_UNCONFIRMED and NATIVE_OUTCOME_UNCERTAIN. WAITING with attention requires operator investigation; no ordinary-user recovery control or monitoring stack is introduced. Preserve journal/result/native lease evidence when investigating. Never clear a quarantine or redispatch solely because the browser disconnected or a deadline passed.

## Verification and limitations

Use existing root scripts: npm.cmd run lint, npm.cmd run build, npm.cmd run test:api, npm.cmd run db:check and npm.cmd run test:db. The database harness owns isolated PostgreSQL/random credentials, applies migrations, verifies populated-table index compatibility and runs genuine NestJS/native-runtime success, failure, timeout, cancellation, concurrent-instance recovery, stale-lease, rollback, authorization and browser regressions. No paid provider is needed. Test evidence records actual outcomes and intermediate corrections.

Worker/broker integration is not applicable: none exists in this architecture. Restart tests close/reopen API instances at controlled durable boundaries, and fault injection exercises lost finalization; these are not claimed as OS hard-kill or automatic worker recovery tests. Native uncertain effects may remain WAITING indefinitely until a separately authorized operator resolution is available. This conservative limitation follows T01 and prevents duplicate side effects. Production identity/tenancy, automatic parent continuation, external adapters and collaboration UI remain out of scope. T06 must preserve these ownership/control boundaries when defining external capability contracts; no external recovery or dispatch is enabled here.

## Compatibility corrections during verification

The first full integration pass exposed a passive-read regression: observing a request-only T03 intent advanced its session. That implicit update was removed, preserving the original T03 assertions. A fault-injection fixture was narrowed to terminal native writes so it tests lost finalization rather than rejecting admission. An existing Phase 4 browser reload wait dereferenced a DOM element before it existed; its readiness expression now tolerates the transient missing element without weakening the readiness condition. Finally, an activation rejection consults any earlier durable cancellation intent before recording failure, allowing cancellation propagation to win that race. The final evidence retains earlier failed runs and their diagnoses.

## Final verification checkpoint

Final backend lint/typecheck passed. Backend unit suite passed 217/217; canonical PostgreSQL/NestJS/native-runtime/browser suite passed 174/174, including all fifteen T05 cases, with no failures or skipped tests. Drizzle metadata check passed. Final application/test sources were frozen for these runs; only documentation/evidence changed afterward. Test-owned containers and volumes were absent after cleanup. The complete commands, intermediate failure diagnoses, hashes, preservation inventory and limitations are in the verification JSON. Hosted CI, worker integration and paid-provider execution are not claimed. T06-T12 remain planned.
