# Phase 5 implementation roadmap

**T01-T09 COMPLETE (native foundation, external reference and authorized collaboration projection), 2026-10-28. T10-T12 PLANNED.** Phase 5 product implementation is not complete. Dependencies below are gates, not evidence of implementation. T10 is recommended next; no future task is begun automatically.

The approved default is trusted local development. Public identity/tenant scope and inbound webhooks are BLOCKED pending separate security decisions; they do not prevent local persistence or outbound observation work. T08 verified a real local LangGraph Agent Server endpoint; no mock-only or hosted production acceptance is claimed.

## T02 - Collaboration Domain & Persistence

- **Objective/dependencies:** additive session/participant/delegation/correlation foundations; T01 and reviewed current schema. **Status: COMPLETE (2026-10-27).** See [implemented persistence, actual verification and limitations](persistence.md).
- **Scope/modules:** `apps/api/src/database/schema.ts`, migrations/meta, proposed collaboration domain module and existing event contracts/aggregate checks; no provider-specific tables. Reuse Task/Execution/owners/outbox. Explicit same-owner and ancestry/unique-child policy.
- **Acceptance/tests:** real PG migration/backward compatibility, same-owner FK/uniqueness/concurrent key/hash conflicts, event/audit atomicity and documented rollback; exact storage decisions match [domain model](domain-model.md).
- **Exclusions/risks:** no routes, coordinator behavior, external inbox or UI. Existing event checks need explicit additive evolution; no generic JSON relation escape hatch.

## T03 - Native Delegation Contracts & Authorization

- **Objective/dependencies:** typed request/read/recovery contracts and permission rules; T02. **Status: COMPLETE (2026-10-27).** See [actual operator-only API and evidence](native-delegation-api.md). Explicit decisions/child creation are deferred to T04 by the current request-only task scope.
- **Scope/modules:** collaboration DTO/controller/service, existing operator authentication and exact-route audience separation, T02 request transactions/audit and bounded recipe admission. No instruction duplication, child creation, automatic acceptance or execution.
- **Acceptance/tests:** actual HTTP owner/source/target/participant/Task/Execution denial, concurrent requests persist one intent, payload conflict/recovery, bounded history and safe errors. Generated suggestions cannot authorize commands.
- **Exclusions/risks:** no execution engine, autonomous Agent tool, new principal platform or provider. New request source must be the exact latest successful native attempt of a COMPLETED Task; no Task/Execution is created.

## T04 - Native Collaboration Coordination

- **Objective/dependencies:** explicit authorized activation of one persisted native delegation using the existing Runtime Coordinator; T03. **Status: COMPLETE (2026-10-27).** See [implemented coordination and evidence](native-coordination.md).
- **Scope/modules:** atomic existing Task creation plus ACCEPTED association, internal native admission hook that commits child Execution correlation before strategy entry, awaited existing runtime execution and exact-child read-through reconciliation. Explicit activation combines approval and one child step; no general decision/status API.
- **Acceptance/tests:** 14 real-PostgreSQL/native integration cases in the canonical 159-test passing suite, including genuine rule-based parent/child E2E, concurrent independent instances, capacity denial, cancellation races, rollback, lost acknowledgement and interrupted preparation. Backend units 214/214 and frontend regressions 209/209 passed; see [verification evidence](verification-evidence/t04-verification.json).
- **Scope refinement:** T01's broader staged A-to-B-to-A proposal is narrowed for this task to immutable completed source A, child B, and safe result-reference return. No continuation Task, parent resume, manual rejection endpoint or output merge is implemented. Result-reference availability satisfies T04 return; parent continuation is deferred.
- **Exclusions/risks:** no fanout, arbitrary graphs, scheduler/worker, autonomous resume or strategy expansion. A committed ACCEPTED/no-attempt record is inspectable and never automatically redispatched; T05 must define explicit recovery. Existing native leases/quarantine remain authoritative after crashes.

## T05 - Collaboration Lifecycle, Failure & Recovery

- **Objective/dependencies:** deterministic native aggregate lifecycle, durable cancellation and explicit recovery; T04. **Status: COMPLETE (2026-10-27).** See [implemented lifecycle/recovery and limits](lifecycle-recovery.md) and [verification evidence](verification-evidence/t05-verification.json).
- **Scope/modules:** existing immutable audit journal for cancellation/recovery control, two additive indexes, bounded session/cursor reconciliation, exact existing lifecycle cancellation, maximum three explicit dispatch attempts only for a never-admitted child. No automatic retries or terminal Task resets.
- **Acceptance/tests:** 217 unit tests and 174 isolated PostgreSQL/backend/browser regressions pass, including 15 new genuine-runtime/fault/race/authorization/migration scenarios. Independent recovery instances admit one Execution; cancellation intents survive interrupted propagation; unknown claims remain quarantined. Existing request-only reads are preserved.
- **Limits/refinements:** no worker/broker exists. Restart tests use controlled API close/reopen and durable cuts, not OS hard-kill recovery. Automatic crash repair and terminal-failure retry links remain unsupported; terminal native Tasks are non-retryable. There is no guarantee of eventual dispatch or exactly-once external effects. WAITING/attention preserves unsafe unknown outcomes rather than inventing success/failure.

## T06 - External Orchestrator Adapter Foundation

- **Objective/dependencies:** safe provider-neutral contracts/configuration and explicit capability intersection; T01/T02/T03 ownership foundations. **Status: COMPLETE (2026-10-28).** See [implemented adapter foundation](adapter-foundation.md) and [verification evidence](verification-evidence/t06-verification.json).
- **Scope/modules:** empty compiled-adapter registry, optional observation/mutation contracts, authorized read facade, fresh connection/namespace/generation capability snapshots, redacted server credential references, exact endpoint/DNS/IP/TLS and GET-only transport bounds. Existing native Runtime Coordinator, provider transports and collaboration code are unchanged.
- **Acceptance/tests:** 248 backend tests pass, including 31 new contract/security/transport/Nest DI cases. Existing 174 PostgreSQL/native/browser regressions pass. SSRF/rebinding/redirect/credential/owner/timeout/fanout tests exercise production boundaries with controlled HTTPS and real pinned local HTTP fixtures. No live external source compatibility is claimed.
- **Limits:** T06 contracts only; static trusted profiles, no connection/mapping migration or management API. No production adapter is registered. CONTROLLED_DISPATCH remains OPERATION_DISABLED even after capability/authorization checks; later durable intent/remote dedupe/recovery review is mandatory before enabling it. No consumer, monitoring loop or source ingestion is added.

## T07 - External Identity Mapping & Event Ingestion

- **Objective/dependencies:** durable source-scoped identities, inbox, external observations and bounded replay; T06/T02. **Status: COMPLETE (2026-10-28).** See [implemented ingestion and security boundaries](external-ingestion.md) and [verification evidence](verification-evidence/t07-verification.json).
- **Scope/modules:** four additive tables (source incarnation, Agent mapping, Execution observation/mapping, inbound receipt), same-owner/type/correlation guards, explicit operator mapping/tombstones, opaque expiring source sessions and canonical-source sequence reconciliation. Native Executions are never allocated or mutated.
- **Acceptance/tests:** 255 backend unit/contract tests and 189 real PostgreSQL/backend/browser regressions pass, including 15 T07 mapping/auth/dedupe/order/restart/rollback/correlation/upgrade cases. Populated pre-0007 schema upgrade preserves legacy identities; full fresh schema and prior native workflows pass.
- **Limits:** internal trusted-source invocation only; no public webhook, provider signature protocol, actual source polling, worker/broker or adapter registration is added. Unsequenced/unapproved ordering remains durably deferred. Provider status aliases remain UNKNOWN until a reviewed T08 protocol/snapshot contract supplies authority. No external aggregate activity, NPC binding or frontend changes.

## T08 - Reference External Orchestrator Integration

- **Objective/dependencies:** one actually supported verified external integration; T07 and accessible reviewed endpoint/version/permissions. **Status: COMPLETE (2026-10-28), approved pinned local LangGraph observation scope.** See [actual implementation](reference-integration.md) and [verification](verification-evidence/t08-verification.json).
- **Scope/modules:** one compiled langgraph.v1 adapter, safe X-Api-Key/read-only search transport seam, explicit approval/observation CLI, T07 phase-ranked external reconciliation and bounded result checkpoint/hash metadata. No native or city changes.
- **Acceptance/tests:** 266 backend tests, 11 focused adapter/security tests and 197 real PostgreSQL/native/browser/live tests pass without skips. Live pinned dev server proved discovery, queued/running/completed external work, result provenance, restart duplicates and no native rows created. Seven deterministic DB/CLI/upgrade cases run in normal CI; live tier is explicit. Hosted authentication is documented/wire-tested, not live verified.
- **Exclusions/risks:** no forced feature equivalence or paid LLM dependency for primary path. Controlled dispatch separately gated by idempotent submission/lookup and authorization; provider availability may block this task.

## T09 - Collaboration Activity Projection & APIs

- **Objective/dependencies:** safe native/external collaboration observation and bounded reads; T05 and T07, validated T08 source mapping for external acceptance. **Status: COMPLETE (2026-10-28), approved local operator scope.** See [actual projection/API contracts](collaboration-activity.md) and [verification evidence](verification-evidence/t09-verification.json).
- **Scope/modules:** new collaboration activity controller/service/contracts in CityModule compose the existing Phase 3 SQL/mapper. Operator-only schemaVersion 2 snapshots, Agent views, timelines and native event hints; v1 audiences/contracts unchanged. Two additive history indexes, no lifecycle writes or provider requests.
- **Acceptance/tests:** 269 backend tests and 205 PostgreSQL/native/browser tests pass; nine new real HTTP/PG cases cover child execution/correlation, external authority, cursor replay, timeline dedupe, ownership, page bounds, source retirement, MVCC coherence and index support. Final focused nine-case rerun passes after audit-name correction. No live-provider/hosted CI rerun is claimed.
- **Exclusions/risks:** no replacement projection or realtime platform; no status from unverified source or imported historical run drives live native state.

T09 continuation revalidated 2026-10-29 without implementation changes; see the [recovered checklist and fresh verification](t09-continuation.md).

## T10 - Frontend Collaboration Inspection & Visualization

- **Objective/dependencies:** bounded frontend read/inspection of T09 native/external activity. **Status: COMPLETE (2026-10-29), approved local fixed-owner scope.** See [implemented architecture and workflow](frontend-collaboration.md) and [verification evidence](verification-evidence/t10-verification.json).
- **Scope/modules:** typed v2 read client, strict safe response narrowing, panel-scoped CollaborationOwner driven by Phase 3 sweeps, existing NPC inspector extension, directed relationship list, bounded history and separately authorized native Task/Execution metadata. Distinct optional collaboration-read credential avoids putting operator credentials into the browser.
- **Acceptance/tests:** 225 frontend tests (16 focused collaboration cases), 271 backend tests and 207 isolated PostgreSQL/native/browser tests pass without skips; browser DOM/keyboard/AX/contrast/motion/responsive checks and actual native child execution/external ingestion/reconnect workflow pass. City camera/animation/Task regression checks, strict types, builds and migration consistency pass.
- **Recovery:** preserved interrupted implementation; fixed a late-read stale-binding race, added accessibility checks and completed documentation. Native/external lifecycle remains authoritative in existing backend/provider persistence.
- **Exclusions/risks:** no optional canvas overlay, renderer changes, new transport, per-NPC poller, provider controls or lifecycle redesign. Public identity/tenants, manual assistive-technology review, long-duration/load verification and final phase acceptance remain later gates. T11/T12 are planned.

## T11 - Security, Reliability & Multi-Agent E2E

- **Objective/dependencies:** evidence-based hardening and verification of T02-T10. **Status: COMPLETE (2026-10-29), approved fixed-owner loopback scope.** See [matrix, threats, outcomes and limitations](security-e2e-verification.md) and [verification evidence](verification-evidence/t11-verification.json).
- **Changes:** fix first-page membership cursor reuse and fence lifecycle controls during pending/unresolved Task Create; add deterministic DOM regression, actual admitted-child backend hard-kill test, mixed-authority/id-collision/replay E2E, bounded owner/client profiling and sanitized artifacts in existing CI. No runtime/schema/renderer/provider redesign.
- **Acceptance/tests:** final 226 frontend, 271 backend and 209 PostgreSQL/security/native/browser cases pass; actual runtime-crash and city acceptance each pass; separate real pinned LangGraph tier passes. SSRF/capability/identity/inbox/order/cancellation/recovery/index tests remain active. All final checks pass without skips; local snapshots measured at 2,007 bytes/16 ms median for the stated fixture.
- **Limits:** no production principal/tenant identity, hosted auth acceptance, automatic uncertain-work repair, formal WCAG certification or capacity claim. No worker/broker exists to restart. Remote CI remains uninspected. T12 is planned; Phase 5 is not released.

## T12 - Final Acceptance Review & Documentation

- **Objective/dependencies:** final actual-code/evidence reconciliation of T01-T11. **Status: COMPLETE (2026-10-29). Phase 5 ACCEPTED for trusted fixed-owner loopback development/test.** See [canonical acceptance matrix and operational limits](acceptance.md) and [fresh verification](verification-evidence/t12-verification.json).
- **Scope:** documentation/evidence only. Root README is concise with preserved historical notes; platform index and task-date documents point to current acceptance. No product source, historical migration, city asset, dependency, CI or runtime architecture changed.
- **Verification:** 226 frontend, 271 backend and 209 PostgreSQL/native/external/mixed/browser tests pass; separate live LangGraph, actual Task/crash and city acceptance cases each pass. Builds, strict types, migration check, browser hardening, bounded profile and zero-advisory npm audit pass. Remote CI/hosted provider/manual AT/production capacity are not claimed verified.
- **Disposition:** no unresolved critical local acceptance defect. Public deployment remains blocked pending Phase 6 identity/security/operations design. No release, version bump, commit or deployment.

## Next phase - production implementation planned

[Phase 6 T01 - Production Architecture & Deployment Plan](../phase-6/README.md) is COMPLETE as documentation/planning only. Its [ordered T02-T16 roadmap](../phase-6/implementation-plan.md) records undecided audience/database choices and all implementation/exposure gates. [T02 common configuration hardening](../phase-6/configuration-contracts.md) is PARTIAL; production access decisions remain unresolved. Next roadmap task is **T03 Production Principal & Object Authorization**, after its T02 prerequisites. No production service was enabled or infrastructure provisioned.

## Dependency summary

T01 -> T02 -> T03 -> T04 -> T05; T02/T03 -> T06 -> T07 -> T08; T05/T07/T08 -> T09 -> T10 -> T11 -> T12. T06 contracts may be designed while native coordination develops; completion gates remain explicit. T02 is not blocked by an unselected external provider. Public identity and remote-ingress work remain outside the approved local execution scope.
