# Verification strategy and performance targets — planned

**Phase 3 T09 COMPLETE — PASS WITH LIMITATIONS (2026-10-25):** [Security, performance and regression evidence](security-performance-verification.md) records the approved local trust boundary, patched HTTP parser advisories, measured synchronization/browser resources and reproducible regression checks. T10 final acceptance remains planned.

**Phase 3 T08 COMPLETE (2026-10-25):** [Multi-Agent synchronization and reconnection](multi-agent-synchronization.md) hardens existing shared REST polling, same-identity version checks, reentrant refresh coalescing and completion suppression. No new transport/backend state machine. T09/T10 remain planned.

**T05 implemented and verified (2026-10-24):** [NPC Runtime Binding](npc-runtime-binding.md) derives indexed read-only associations from T04 and existing immutable NPC slots. Missing NPCs remain unresolved; no spawning, rendering or inspector change is added. Verification passed 96 frontend tests (19 new), 190 backend tests, 103 PostgreSQL tests, builds/static checks and browser smoke, plus final focused/type/build reruns. T06–T10 remain PLANNED.

Earlier checkpoints/plans below are historical. The latest T05 scope keeps absent NPCs unresolved and does not implement the original proposed extra-avatar provisioning.

**T04 implemented and verified (2026-10-24):** [Frontend runtime integration](frontend-runtime-integration.md) adds a typed city-read client, frozen store/read facade and bounded synchronization. Final checks passed 77 frontend tests (23 new runtime tests), 190 backend tests, 103 PostgreSQL tests, builds/static checks and browser smoke, with final focused compatibility/build reruns. T05–T10 remain PLANNED; no NPC binding/rendering or backend production source changed.

The original design/targets below remain historical. The implementation guide defines current T04 APIs/state and measured test evidence; no future NPC/inspector or performance target is claimed complete.

No Phase 3 performance or integration claim is measured in T01. These are implementation acceptance targets and required test scenarios. Existing Phase 2 counts in [the prior acceptance](../phase-2/acceptance.md) are historical executed evidence.

## Backend tests

Use the existing Node test runner/Nest DI and owned Docker PostgreSQL harness. Unit tests cover projection mapping for every actual enum, orthogonal availability, no Task/CREATED/PENDING, native/external multiple activity representatives, stable ties, expired lease/unknown/inconsistent records, safe serialization and query validation. Source projection never mutates DB status or creates events.

Real SQL tests: binding FK/uniqueness and concurrent create/reassign, opaque revision conflicts, populated records unchanged, owner/city/enabled filters, all parent chains, bounded query count/pages, latest Task versus latest attempt, history caps and safe audit order. A read snapshot must never combine status/result from contradictory transaction instants. Seed old Tasks with active work so representative selection is not merely newest-created. Test migrations fresh/populated only if justified additions occur; default plan requires none.

HTTP tests: missing/wrong/rotated city credential; operator-token no fallback; city token cannot call existing writes; wrong socket/Host/Origin/production/disabled guard; arbitrary query/owner/provider/tool fields rejected; results undisclosed by default. Test city reads when runtime execution disabled but registry/database read access explicitly configured, if allowed by final config. Existing control APIs retain all tests.

## Frontend tests

Pure modules with fake fetch/time/visibility: stable slot ↔ new session IDs; no name matching; duplicate mapping prevention; explicit manifest mismatch; locally removed original resident suppression; dynamic avatar cleanup; reassignment purges old details; page/reload identity restoration; paused/speed/reset simulation has no effect on runtime polling; standalone remains unchanged.

Controlled clock tests for single-flight scheduling, timeout, jitter bounds/Retry-After, hidden-tab pause, stale RUNNING, auth wipe, old response/selection rejection, complete/partial page removals and repeated connect/disconnect disposal. Counters/listeners/store size return to baseline after at least 100 cycles. Validate invalid/oversized/unsupported server responses and text rendering. No credentials in browser persistence, build or debug DOM. DOM inspector keyboard/reduced-motion/status text tests supplement Canvas checks.

## End-to-end workflow

Use actual Nest HTTP, PostgreSQL and existing city browser smoke infrastructure. Provision a test-only native owner/orchestrator/Agent via existing trusted fixtures, activate and provision one binding with the trusted service; fake providers only in fixtures. Browser connects with read credential; separate trusted test client creates/executes Tasks. Use barriers to hold provider/tool activity through at least one poll, not arbitrary sleeps, to deterministically observe RUNNING. Complete -> verify COMPLETED badge, stored result reveal policy and durable audit. Repeat FAILED, CANCELLED and TIMED_OUT; late completion cannot replace terminal state.

Reload browser and restart API: same backend binding maps to new numeric resident ID without duplicate avatars, result/history stays durable, old terminal badges do not replay. Disconnect during execution, complete while absent, reconnect to current state/history without claiming missed intermediate animation. Repeat for 1, 5 and 20 linked Agents, with independent cancellation/contexts; simultaneous **visualization** is not a promise the single-process runtime can execute twenty Tasks at once. Multiple runtime instances for concurrency fixtures must retain existing PostgreSQL fencing.

Use fake server delay for network/auth/schema outages; test all read routes with foreign owner and parent IDs. Live Ollama is optional diagnostic and separately labelled; paid OpenAI is opt-in only and never CI requirement. No model download or benchmark provider loops.

## Measurable targets (not measurements)

| Concern | Initial target / validation method |
| --- | --- |
| Refresh | Foreground 2 seconds after response, no overlapping batch; healthy RUNNING observation within 2 poll cycles for work held by a barrier |
| Request concurrency | At most one batch plus one selected-detail GET per browser; zero per-frame/per-NPC requests |
| Payload/query bounds | 20 projection rows, ≤64 KiB encoded response; ≤4 SQL queries per page independent of 1/5/20 count. Profile EXPLAIN on representative populated history; a bounded query count alone does not prove efficiency |
| Detail | Task page 10/default, 20/max; three recent attempts/Task; event page 10/default, 50/max; optional text ≤16 KiB; fetch only explicit selected panel |
| Render overhead | On the same recorded browser/device/viewport, 20 linked indicators add ≤2 ms p95 frame CPU over the same 20-resident no-overlay baseline across 60 seconds; record raw distribution and distinguish browser throttling |
| Inspector | Cached selection visibly updates within 100 ms; loading placeholder immediate, remote detail target ≤500 ms p95 on local test DB excluding injected faults |
| Store/memory | ≤20 Agent views plus bounded selected history/outcome keys; after 100 reconnect cycles no growing listeners/timers/retained entities. Measure heap/RSS as observations, not assume a fixed-byte leak proof |
| Retry/freshness | Stale at 6 seconds, UNKNOWN at 30; backoff capped, no hidden-tab polling or burst on restore |

If hardware or measured workload cannot meet a target, record evidence and adjust scope deliberately before acceptance; do not silently drop assertions. No new load-testing infrastructure, paid stress tests or invented FPS measurements.

## Reproducible commands and acceptance evidence

Keep existing `npm run lint` (actual syntax/static + API noEmit, not ESLint), `npm run build`, `npm run build:web`, `npm run db:check`, `npm run test:all`, `npm run test:db`, `npm run test:browser` and aggregate `npm run verify:phase1`. Add focused Phase 3 suites to existing test discovery/CI rather than a second test system. No configured formatter is assumed. T10 must record actual command outcomes, hardware/browser/counts, optional live versus mocked providers, source preservation and NOT RUN infrastructure checks.

Regression baseline includes simulation missions, needs/activities/reservations, decorative population, camera/hit tests, river/railway/roads/bridges/theme/assets and mobile inspector; backend includes Agent/task/execution lifecycle, atomic results/events, providers/tools, runtime auth/cancellation/races. No Phase 3 acceptance based solely on documentation/source existence.
