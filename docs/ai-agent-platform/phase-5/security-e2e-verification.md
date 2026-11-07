# T11 - Security, reliability and multi-Agent E2E verification

**Final Phase 5 status (2026-10-29): ACCEPTED for the approved local scope; T01-T12 complete.** See [canonical final acceptance and Phase 6 prerequisites](acceptance.md). The T11 task-date findings, counts and next-task statements below are preserved historical evidence.

**T11 COMPLETE for the approved fixed-owner loopback development/test scope (2026-10-29, Asia/Bangkok).** Final task status and exact commands are recorded in [structured evidence](verification-evidence/t11-verification.json). This is verification of the approved fixed-owner loopback development environment, not public deployment acceptance or Phase 5 closure. T12 remains planned.

## Repository and trust boundary audit

No .git directory or applicable AGENTS.md was supplied. Status, staged diff and untracked inspection were attempted; preservation uses a pre-edit SHA256 baseline of 533 files (532 maintained files and one ignored reference-runtime cache file). T01 ADRs and actual T02-T10 services, DTOs, repositories, tests and evidence were reviewed. T10 completion was verified against code rather than inferred from its prompt. Root dist/ is maintained frontend source, not a generated build destination.

Native work uses the existing synchronous Runtime Coordinator and durable Task/Execution leases. There is no Elyqreth worker, broker, Redis service, outbox publisher or automatic crash-repair scheduler. Native admission is bounded, source work must already be terminal, and the first collaboration recipe is two participants, no fanout, depth at most two/three work Tasks. Tests of hypothetical worker restart or arbitrary workflow DAGs are not applicable. The existing LangGraph Agent Server is the one observation-only reference; it owns its own runtime and workers. No new adapter or orchestration feature is introduced.

## Verification matrix

Statuses describe executed evidence in the linked final record. DEFECT entries retain their original classification and resolution rather than hiding failed tests.

| Requirement / implementation | Coverage and risks | Finding / corrective action |
| --- | --- | --- |
| T02 durable Session/Participant/Delegation, same-owner FKs, correlation and idempotency | collaboration.integration.cjs: duplicate creates, cycles, concurrent opposite edges, rollback, legacy upgrade and terminal versions | VERIFIED; no schema change |
| T03 authorized requests and bounded history | collaboration-api.integration.cjs: forged owners/status, wrong source/target/parent, disabled membership, concurrent request/fanout denial, restart lookup | VERIFIED; local operator only, not tenant identity |
| T04 native child admission | native-coordination.integration.cjs: genuine rule-based child, one Task/Execution, concurrent activation, capacity denial, transaction cuts | VERIFIED; existing coordinator and attempt semantics preserved |
| T05 lifecycle, failure and aggregate state | collaboration-recovery.integration.cjs: completion/failure, timeout uncertainty, cancellation races, unrelated work, duplicate observations and bounded batches | VERIFIED; root Task is not implicitly cancelled or resumed |
| T05 durable recovery | Existing never-admitted-child recovery across independent instances; three-attempt cap and durable cancellation intent | VERIFIED; admitted unknown work stays quarantined, not blindly retried |
| Actual backend process crash after delegation admission | New P5 T11 crash case uses existing child-process fixture, verifies committed correlation, kills only owned process, reopens backend and races three recovery calls | VERIFIED; one Execution and WAITING/OUTCOME_UNCERTAIN retained; persisted lease expiry is a controlled clock cut |
| T06 registry, capability/mode/owner checks and secrets | external-adapter/di/transport tests: unknown/duplicate registry, observation-only mutation denial, credential redaction and default-off configuration | VERIFIED; external dispatch/cancel remain disabled |
| T06 outbound transport | Real controlled HTTP/pinned DNS/TLS fixtures: private/metadata/loopback bypasses, DNS rebinding, peer mismatch, redirects, malformed/oversized responses, deadlines and capacity | VERIFIED; only trusted explicit local allowlists permit local reference endpoints |
| T07 source-scoped mapping/inbox | external-ingestion.integration.cjs: identical IDs across connections/generations, tombstones, ownership/FKs, concurrent duplicates, forged sessions, rollback and replay | VERIFIED; no public webhook or automatic internal Agent creation |
| T07 ordering and native authority separation | Ordered/unordered/unknown events, duplicate/equal/older versions, terminal conflicts and explicit external correlation | VERIFIED; unknown/conflicting evidence deferred, native rows unchanged |
| T08 LangGraph reliability | Captured 0.16.8 HTTP fixtures cover auth/rate/timeout/malformed/disconnection/result-provenance failures; live pinned local reference also executed | VERIFIED within pinned local scope; hosted auth is fixture-tested, not live accepted |
| T09 read projection and authorization | collaboration-activity.integration.cjs: v1 compatibility, owner isolation, SQL repeatable-read coherence, summary/count/null progress, stable cursor/history and indexes | VERIFIED; no provider call or lifecycle write from reads |
| T09 mixed authority E2E | New native real execution plus external mapping with an identical raw Execution ID; duplicate receipt, disabled source, pending receipt/replay, unified reads and timeline | VERIFIED; separate approved native/external sessions, no unsupported cross-orchestrator delegation |
| T10 membership pagination | Revisit Next after First/Refresh could be blocked by the old seen-cursor guard | DEFECT, fixed: successful first-page refresh clears membership/Agent-observation cursor trails; deterministic red/green regression |
| Existing Task submission/action interaction | Start could remain enabled for a previous projected Task while a new Task Create was pending | DEFECT, fixed: Start/Cancel wait for pending or unresolved submission; deterministic real DOM red/green test, existing actual runtime failure/crash regression rerun |
| T10 state/synchronization | collaboration.test.js: authority/schema narrowing, aborted late reads, binding/session switch, auth cleanup, invalid cursors, shared-sweep dedupe and external snapshot refresh | VERIFIED; no new timer, event bus or per-NPC connection |
| T10 browser/UI and city | Real Nest/PG/native/external browser case plus component/keyboard/AX/contrast/reduced-motion/mobile checks; Phase 3/4 city and Task acceptance | VERIFIED within smoke scope; manual AT, visual-diff and sustained FPS/capacity are not claimed |
| Resource/query bounds | Existing indexed query tests plus actual repeated mixed snapshots and forced-GC owner/client profile for 1/5/20 Agent selection sets | VERIFIED for representative bounded fixtures; measurements below are not production benchmarks |
| Dependencies/configuration | npm advisory audit and pinned Python dependency consistency check; default-off loopback guards, immutable reviewed endpoint configuration | VERIFIED as stated below; no unrelated upgrades |
| Public tenant/principal/remote ingress | Not implemented by the approved architecture; owner-isolation tests are real, tenant enforcement is not invented | BLOCKED for public deployment; outside local T11 acceptance, retain T12 deployment gate |

## Threat model and security review

The browser, provider payloads, external identifiers, cursors and instructions are untrusted inputs. Native persistence/runtime, server-provisioned external profiles and independently scoped source grants are separate trust boundaries. A valid Agent/NPC ID, participant record or supported capability grants no permission by itself.

- Local operator commands pass exact loopback/Host/Origin and bearer checks. Source/target Agent, Task, Execution, membership, parent ancestry and current lifecycle are revalidated under the existing owner transaction fence. Clients cannot assign owners, terminal status, child references or native result fields. Inaccessible nested resources return safe errors.
- City-read, interaction and collaboration-read credentials are distinct. Collaboration-read permits only T09 GET reads and cannot invoke mutations or native payload reads. Native metadata uses the independent interaction audience. Browser audience credentials are deliberately volatile authentication state; provider keys and operator credentials are not placed in frontend configuration, storage, logs or bundles.
- External source sessions are opaque, instance-approved, expiring grants bound to owner/connection/namespace/generation and operation kind. They are not bearer data accepted from arbitrary JSON. Internal authenticated ingestion is the implemented boundary; unauthenticated webhooks and provider signature protocols are not exposed.
- Mapping provenance uses connection/source incarnation, not provider display names or globally unique external IDs. Existing approved EXTERNAL registry references do not inherit native privileges. SQL constraints and application correlation prevent native identity takeover and cross-owner mappings.
- Inbox content identity and source-scoped unique event identity handle retries and concurrent duplicates. Provider sequence/domain, terminal guards and durable replay handle ordering. Receipt acknowledgement is distinct from projection application; older/unordered/conflicting evidence cannot invent success or overwrite native state.
- External transport validates scheme/origin/path, explicit resolved address allowlist, DNS answers and actual peer; verifies TLS, refuses redirects, bounds bytes/JSON/time and concurrency, and never automatically retries mutating operations. Provider failures use safe categories; connection failure is not Execution failure.
- Read APIs apply ownership before pagination and preserve native/external authority. Cursor validation, maximum page sizes, 64 KiB response bounds, stable ordering and indexed bounded reads limit enumeration and resource exhaustion. Provider payloads and large result bodies are excluded from summaries.
- Frontend dynamic provider/task text is rendered as text, with malicious HTML tested. Generation/abort fences, logout clearing, bounded pages/cursor trails and explicit stale labels prevent unauthorized old-context presentation. No history selection overwrites live NPC activity.

No confirmed critical or high-severity security defect remains in the tested local boundary. The two confirmed defects were frontend reliability/integrity defects, not cross-owner authorization bypasses. Production principal/tenant identity remains a high-impact deployment prerequisite; local acceptance must not be reinterpreted as permission to expose these APIs publicly.

## E2E and failure evidence

**Native:** actual parent Task for Agent A, terminal source Execution, collaboration/request/activation to Agent B, genuine native child result, exact persisted ancestry/attempt and audit, T09 snapshot/timeline and T10 browser metadata. Duplicate/concurrent activations preserve one effective child. Failure/cancellation/timeouts retain actual terminal winners and uncertainty rather than inventing parent completion.

**External:** deterministic documented provider fixtures exercise the real adapter, DI, HTTP boundary, PostgreSQL mappings/inbox and normalized observation. The separate real pinned LangGraph 0.16.8 / graph 1.2.18 server was started on loopback without paid model calls. Live discovery, QUEUED/RUNNING/COMPLETED, exact checkpoint/hash result provenance, backend restart/re-observation and unchanged native counts were verified. Fixture auth failures do not imply live hosted authentication acceptance.

**Mixed:** native and explicitly approved external collaborations coexist under one authorized owner. An external Execution raw ID deliberately equals the native Execution ID. Unified listing and browser labels remain unambiguous through explicit authority/source identity. External source retirement preserves RUNNING with UNKNOWN health; re-enabling, durable receipt replay and terminal observation preserve native counts/status. Native-session correlation from an external event is rejected. This is coexistence/inspection, not cross-orchestrator dispatch.

**Failure injection:** SQL transaction faults test rollback; API close/reopen tests committed intent/inbox recovery; the new real backend hard kill tests admitted child durability; existing Phase 4 browser reliability tests discard committed acknowledgements, cut network, force a native failure/timeout and kill/reopen the runtime process. Database restart durability is covered by the established isolated harness. No nonexistent Elyqreth worker, broker, message consumer or automatic replay engine was added.

A crash after native admission is not proof that execution stopped safely. Tests intentionally require WAITING/OUTCOME_UNCERTAIN and prohibit a second Execution. Never-admitted prepared work has separate bounded explicit recovery. A child result is not injected into a parent LLM, and the completed source parent is not reopened or cascade-cancelled. Nonterminal parent attempts cannot create the approved delegation in the first place.

## Performance and cleanup evidence

`node --expose-gc scripts/phase5-collaboration-profile.mjs` runs the actual frontend owner/client over deterministic HTTP with 20/100/400 selections across 1/5/20 Agent sets. Duplicate shared-sweep notifications coalesce. Assertions bound request counts, verify cleared credentials/data, zero post-disposal notifications and zero outstanding request timers. Measured duration/retained heap deltas are retained in [profile evidence](verification-evidence/t11-profile.json). Heap warmup/cache effects exist; these observations do not establish a memory capacity, absence of every leak or a browser FPS guarantee.

The mixed database E2E captures ten real snapshot reads through the actual projection service's logger, verifies response bytes remain below 65,536 and confirms reads add no lifecycle/audit writes. Actual durations and sizes are in [mixed evidence](verification-evidence/t11-mixed.json). Existing index/EXPLAIN and snapshot coherence regressions remain active. Query review found no relationship traversal or per-item provider invocation; bounded section SQL/aggregate queries reuse existing indexes. No new database index is justified by these fixtures.

Existing limits remain: native bounded recipe/admission, three explicit recovery dispatch attempts, inbox replay pages up to 20, API pages up to 20, adapter request timeout at most 5 seconds/connection 1 second/response 65,536 bytes/concurrency four, and UI pages of ten with bounded cursor history. There are no per-frame requests or independent per-NPC polling loops. Provider observation remains an explicit bounded command, not an uncontrolled polling scheduler.

npm audit reported zero advisories across all severities on this run; no dependency upgrade was needed. The pinned Python environment passed pip check (dependency consistency, not a Python vulnerability audit). Reviewed examples contain placeholders and test-only random/obvious fixture credentials. Provider secrets remain server references; configuration is default-off. Live test creates/deletes its disposable provider thread; test harness removes only labelled owned PostgreSQL resources.

## CI and reproduction

Existing verify:phase1 automatically discovers the added deterministic unit/database/browser cases. The existing workflow now also runs the bounded frontend resource profile and uploads only sanitized profile/mixed/crash/browser JSON artifacts from runner.temp. No live credentials, new deployment pipeline or provider requirement is added to ordinary CI. Remote CI was not inspected or claimed green.

Use Node 24, installed npm dependencies, Docker Desktop Linux containers and Chrome/Chromium. For live verification, use the existing [pinned reference setup](../../../tools/langgraph-reference/README.md); start no production source and supply no paid model credentials. Exact executed commands/counts/exits and initial failed tests are in [T11 verification](verification-evidence/t11-verification.json). Root dist/ must not be overwritten: build:web uses a verified disposable output directory.

## Remaining risks and T12 prerequisites

| Risk | Severity / impact | Mitigation and disposition |
| --- | --- | --- |
| Public principal/tenant identity and ingress are absent | High for public deployment | Exact fixed-owner loopback scope; blocks public deployment, not this approved local verification |
| Native crash uncertainty cannot be automatically resolved | Medium operational limit | Durable linked quarantine, attention diagnostics and no duplicate replay; operator review remains required |
| Hosted provider auth/API variants and Python advisories lack new live/security-scan evidence | Medium for hosted deployments | Pinned local provider verified; deterministic auth/shape tests and pip consistency are separate evidence; review before hosted use |
| Manual screen-reader review, full visual baseline and long-duration browser load are unexecuted | Low for this bounded local smoke tier | Automated keyboard/AX/contrast/motion/responsive tests and measured bounds; record scope in T12, do not claim WCAG certification or capacity |
| Remote CI is uninspected | Low for local verification | Current local CI-equivalent commands executed; run hosted workflow before relying on a remote green result |

T12 must independently reconcile all task evidence, remaining deployment limits and final acceptance documentation. T11 does not mark Phase 5 released, select another orchestrator, remove native quarantine or start T12.


## Final execution record

Final checks pass with zero skips: lint (including both typechecks), frontend units 226/226, backend units 271/271, full PostgreSQL/native/browser/security regressions 209/209, browser hardening/component checks, real Phase 4 failure/crash browser acceptance 1/1, real Phase 3 city acceptance 1/1, backend/frontend production builds, migration metadata check, npm audit (zero advisories) and pinned Python pip check. The separate full live reference tier passed 209/209 earlier in this task, including its real provider case; the subsequently added crash case also passed focused and in the final ordinary 209-case suite. These counts overlap and must not be summed as unique tests.

The final repeated snapshot fixture measured ten responses of 2,007 bytes, with 13/16/26 ms minimum/median/maximum service duration. Raw measured profile and read observations remain in the evidence artifacts, with platform and fixture limits. No new FPS or production load benchmark is claimed.

Failed attempts are retained in structured evidence. The pagination regression failed before its fix. An existing Phase 4 browser failure exposed the pending-Create/old-projected-Task action race; it passed in isolation, was reproduced deterministically in a controlled DOM test, then passed after the explicit action fence. A full database attempt passed 208 cases but its last browser was invalidated by Vite HMR during a source edit; the stable-source final rerun passed all 209. Test-only logger capture/response fixtures and initial profile assumptions were corrected to match actual module ownership, Task identity and every-fifth-sweep refresh behavior; no product assertion was weakened or skipped.

Only the two confirmed frontend defects were changed in product code. Native/runtime/provider implementations, database schema, historical migrations, city geometry/assets/NPC movement and visual tokens remain unchanged. Test-owned PostgreSQL resources and the live provider thread were cleaned up; the verified workspace-owned provider process was stopped. T12 remains the next separately authorized task, not a release/deployment action.
