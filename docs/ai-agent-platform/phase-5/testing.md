# Planned testing and acceptance

**Final Phase 5 status (2026-10-29): ACCEPTED for the approved local scope; T01-T12 complete.** See [canonical acceptance, current contracts and limitations](acceptance.md). Task-date proposals, checkpoints, counts and future-task statements below are historical, not additional implemented capabilities or current roadmap status.

**T11 COMPLETE (2026-10-29), approved local scope:** See the [actual security/reliability matrix, threat model, fixes and E2E evidence](security-e2e-verification.md). The planning/task-date records below are historical. T12 and Phase 5 closure remain pending.

**Implemented T10 coverage (2026-10-29):** [Frontend collaboration inspection](frontend-collaboration.md) documents 16 focused unit cases, real Chromium DOM/keyboard/AX checks, separate read-audience security tests and a genuine NestJS/PostgreSQL/native-runtime browser workflow. The original T01 matrix below remains planning history. See [current evidence](verification-evidence/t10-verification.json); T11/T12 are not complete.

No Phase 5 runtime tests ran in T01 because no runtime feature is implemented. Retained [Phase 4 evidence](../phase-4/verification-evidence/t10-verification.json) is historical implementation evidence, not new Phase 5 results. Use existing Node tests, real isolated PostgreSQL/NestJS HTTP fixtures and native Chrome/CDP. Do not add a testing framework merely for this phase.

| Layer / scenario | Fixture and assertion | Gate |
| --- | --- | --- |
| Unit: contract/lifecycle/permission | Proposed typed envelopes, bounded recipes, denial matrix, terminal/cancel aggregation; test exact enums and unknown remote state without mutating native state | T03/T05/T06 |
| Real PG: persistence | Isolated owned Docker PG; same-owner composite FKs, unique child/key, parent ancestry/depth/count, concurrent accepts/cancels, immutable terminal facts, outbox atomicity and rollback | T02/T03/T05 |
| Real HTTP: object isolation | Distinct configured owner fixtures and exact scoped credentials; foreign session/parent/target/child/result/history, source credential misuse and recovery lookup denial | T03/T07/T11 |
| Native coordinator integration | Genuine deterministic text statistics A-to-B-to-A sequence, terminal source before child admission, one coordinator capacity preserved, no deadlock or phantom attempts | T04 |
| Failure/recovery | Crash between intent/admission and after admission; response loss, Task lookup, no redispatch; cancellation racing completion, failed/expired child, UNKNOWN native lease | T05/T11 |
| Adapter contracts with mocks | Deterministic paginated source, missing capabilities, permission changes, unknown statuses, optional-method rejection with zero side effects | T06; explicitly mock coverage |
| Inbox/mapping PG + HTTP | Same external IDs across providers/namespaces, reinstall generation, duplicate/conflicting payload, old versions, no-version refresh hints, cursor gaps, replay/checkpoint atomicity and signature/auth denial where supported | T07 |
| Real reference integration | Reviewed pinned endpoint with actual auth and source-owned deterministic work; observe real persisted IDs/status/results or explicit unsupported capabilities; disconnect/reconnect and namespace isolation | T08; mocks do not pass this gate |
| Projection/frontend integration | Strict v1 backwards compatibility and explicit v2 negotiation, external stale/disconnected UNKNOWN, session vs Agent status, owner/source switch, late reads and bounded invalidation | T09/T10 |
| Browser E2E | Select linked A, authorize handoff B, run child explicitly, inspect relationships/return, cancel eligible work, reload/offline restore; external observation-only controls stay read-only; decorative NPC and camera still work | T10/T11 |
| Accessibility/security | Malicious output/URLs, no privileged config in bundles/storage/logs, keyboard/focus/AX semantics, contrast samples, reduced motion/responsive checks; manual AT separate | T11 |
| Performance/resource | Existing 1/5/20 Agent fixtures, bounded relationship pages/results, repeated selection/open-close/session/source changes, reconnect backoff, request counts and timer/listener cleanup | T11; record actual measurements, no capacity claim |

Deterministic fixture IDs are stable within a case, randomized/isolated between cases; two same-owner participants plus foreign-owner/source fixtures. Initial recipe uses native rule-based work, not paid LLMs or real autonomous delegation. Fault injection affects transport or controlled fixtures, never replaces actual coordinator persistence in native E2E. Bounded polling observes state; no arbitrary fixed sleeps as proof. Teardown verifies test labels/absolute workspace paths before removing only owned resources. Tests must not depend on ordering or read production databases.

## Existing commands to reuse later

Inspect package scripts again when implementing. Currently `npm.cmd run lint` covers maintained JS syntax, strict frontend runtime types and backend no-emit. `npm.cmd run build`, `npm.cmd run build:web`, `npm.cmd run db:check`, `npm.cmd run test:all`, `npm.cmd run test:db`, `npm.cmd run test:browser`, `npm.cmd run test:interaction:e2e` and `npm.cmd run test:city:e2e` are established checks. Existing forced-GC profiling scripts can be extended only for demonstrated needs. `verify:phase1` is a historical script name for the current local rollup.

T11 extends existing CI with deterministic tests, bounded service readiness/timeouts and sanitized failure artifacts; no new deployment workflow or production secrets. Real reference checks may use an existing opt-in tier if credentials/services are unavailable to routine CI, but must execute with evidence before T12 external acceptance. Unsupported capabilities and unavailable dependencies must be reported, not skipped and counted passed.

## Final Phase 5 acceptance gates

T12 requires implemented and verified native bounded collaboration, authorized relationship integrity, idempotent handoffs, proven failure/cancel/unknown handling, external mapping/event safety, one real reference integration, compatible city projection/UI, multi-Agent isolation, security/accessibility/performance evidence, current documentation and regression checks. Controlled external dispatch is not mandatory if the selected reference is observation-only; do not claim it delivered. Public deployment remains blocked absent separate approved identity/deployment work. No READY based solely on compilation, mock adapters or diagram completeness.
