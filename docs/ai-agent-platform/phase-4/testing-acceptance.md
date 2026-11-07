# Phase 4 testing strategy and T01 verification

**Current T10 reference:** [Final acceptance](acceptance.md), [current operation](operations.md) and [risks](risk-register.md) describe the completed Phase 4 local implementation. The original planning/task-date statements below remain historical scope/evidence and do not mark current UI/recovery work as missing.

This is a **test plan**, not a claim that Phase 4 tests already exist or pass. Existing evidence is catalogued in [Phase 3 acceptance](../phase-3/acceptance.md); implementation tasks must add focused tests to the existing infrastructure.

## Coverage plan

| Layer | Required cases | Existing tooling/location |
| --- | --- | --- |
| Frontend contracts/client | Exact method/path/body/quoted versions, separate audiences/deadlines, validation/size/UTF-8, safe HTTP errors, abort/timer cleanup, malformed or mismatched IDs, no POST retry | Node test runner under `tests/`, fake fetch/clocks, existing runtime-web `.d.ts` typecheck |
| Form/action/state | Instruction/context byte and unit limits, frozen intent/key, duplicate clicks, unavailable/disabled/external/unknown state, cancellation versions, current vs historical selection, drafts/operation retention across selection | Existing Node/DOM/browser conventions; no React/store adoption |
| Results/privacy | Structured stats, allowed text/empty/unknown/oversize, rejected metadata, actual XSS strings, LLM display denied on execute and GET, no secret/raw error/log output | Backend DTO/service tests, frontend normalizers/formatters, real DOM assertions |
| Backend HTTP | Operator compatibility, city-read denies every interaction write/read, anonymous denial, narrow grant limited to allowed bound Agent, foreign Task/Execution mismatch, invalid bodies/queries/UUIDs, scope changes and revoked capability | `apps/api/test/*.test.cjs` and existing integration extensions |
| Real PostgreSQL | Clean migrations, idempotency/key/hash conflict, exact Agent/key lookup, foreign-owner denial before replay, binding/reassign races, immutable terminal pair, result/audit atomicity, history keyset precision/order/query count | Existing `database.integration.cjs` owned container/volume harness |
| Synchronization/recovery | Lost Create after commit, lost Start/Cancel, no automatic replay, stale versions, missing execution, backend restart/unresolved quarantine, binding changes, token rotation, visibility, response-generation fencing | Deterministic barriers/fake clocks and real HTTP compatibility |
| Resource cleanup | Repeated inspector open/close/NPC switch, reconnect/disconnect, expired/tampered journal, storage denial, bounded caches, no duplicate poller/listener and no per-frame HTTP | Existing integration fixtures/profiling approaches |
| Browser workflow | Actual limited local connection, selected bound NPC form, Create/Start, live persisted observation, cancellation, results/history, reload recovery, output escaping, keyboard/scroll/mobile, decorative NPC and camera/river/train regression | Existing installed Chrome/CDP smoke and real-browser/PostgreSQL fixture |

T02 must establish authorization tests before T03/T04 expose controls. T09 must test actual UI requests over native fetch through the limited credential; operator-only fixture commands are permitted only for trusted setup/assertion, never a substitute for browser Create/Start/Cancel.

## Reproducible acceptance environment

Use Node 24/npm workspaces, existing PostgreSQL image/migrations, installed Chrome (optional `BROWSER_PATH`) and loopback ephemeral Vite/Nest servers. Owned random database/container/volume credentials, labels and identity-checked teardown must follow the current harness. Never read a production DATABASE_URL in a test fixture, reset a developer database, download a model automatically or incur paid OpenAI usage. Text statistics is the primary deterministic runtime; fake providers may cover LLM display contracts. Label all mocked/live results accurately.

Existing commands available for later implementation verification:

```sh
npm run lint
npm run build
npm run build:web
npm run db:check
npm run test:all
npm run test:db
npm run test:browser
npm run test:city:e2e
```

`lint` is the repository's syntax/typecheck aggregate, not configured ESLint or formatting. A future Phase 4 dedicated script may select its existing-harness extension; document it only after adding it in the appropriate implementation task. CI already runs `verify:phase1` and `test:city:e2e`; T09 should extend existing CI coverage after the actual fixture exists. T01 does not change CI or run these expensive acceptance suites.

## Measurable design budgets, not measurements

- Activity: keep existing 2-second foreground after-completion sweep, maximum five pages/100 projected records and 20 supported slot identities. No per-NPC requests; no new renderer work from interaction state. Test 1/5/20 linked fixtures; 100 projection rows are not 100 linked NPCs.
- Detail: at most one serialized/coalesced automatic detail read per successful shared sweep for the selected/unresolved operation; terminal result and history lazy, bounded/manual. No independent timer per operation/NPC. Measure request counts under refresh and reconnect.
- Requests: short read/control timeout 5 seconds unless a justified endpoint contract requires otherwise; **execute 35 seconds**, existing server HTTP budget 30 seconds and trusted execution budget still authoritative. No retries of mutations in a timer loop.
- Cache: 10 drafts with 15-minute idle expiry; 20 summary entries; at most 3 result bodies/192 KiB combined; 5-minute idle expiry. History page default 10/max20; one page in memory. Journal max5 locators/24 hours; no private text. Assert deterministic evictions and authorization purge.
- UI goals: local draft editing/action acknowledgement within 100 ms under recorded test hardware; no large parse/render in the Canvas frame callback. Output preview 8,000 characters and wrap identifiers. Measure frame/DOM/task duration against a same-environment decorative baseline in T08; do not fabricate an FPS guarantee.
- Cleanup: 100 controlled selection/connect/dispose cycles without accumulating timers/listeners, followed by a comparable-GC investigation when tooling supports it. Short tests are not a proof of long-term leak freedom.

## T01 documentation verification record

Audit performed 2026-10-25. `git status --short` and `git diff --stat` were attempted and failed because Git metadata is absent. No applicable AGENTS.md was found. Before writing, a SHA-256 inventory of 421 maintained existing files was saved outside the workspace. Application/runtime/API/client/rendering, result/idempotency/cancellation/access contracts, phase acceptance artifacts, tests/package scripts and CI were read; no application behavior was run or changed by this task.

T01 verification must check all new/changed Markdown local links and anchors, balanced fences, expected six workflow diagrams plus roadmap graph, unique contiguous P4-ADR-001..008 definitions, T02-T10 dependency order, and actual API-route parity. Use the pre-edit inventory to confirm only the root/platform documentation indexes change among existing files, with no removed files and zero application/migration/dependency/Phase 1-3 document changes. Record actual final results here after executing checks.

Executed source/documentation checks: **9 Markdown files**, **78 local links/anchors**, balanced fenced blocks, **7 Mermaid sources**, **8 unique sequential ADR definitions**, and all **9 T02-T10 predecessor dependencies** passed with zero reported issues. Controller/DTO/service reads confirmed the existing route methods, input/idempotency limits, versions, synchronous deadline/disconnect semantics, per-Task ordering, result shapes and actual cancellation path. Proposed routes/permissions are explicitly labelled as future T02 work. Across **421 pre-existing inventoried files**, only `README.md` and `docs/ai-agent-platform/README.md` changed; no files were removed. All application, migration, dependency/lockfile, asset, CI and Phase 1-3 documentation hashes in that inventory are unchanged. Seven Phase 4 Markdown documents are new. The full check output and baseline remain in the task's local temporary verification records; they contain no credentials or private task input.

A final source parity check additionally matched **13 existing controller method/prefix combinations** in Agent, Task, Execution, runtime and audit controllers; city activity contracts were reviewed directly. This is static contract verification, not an HTTP execution test. Final documentation-link/fence and preservation checks passed again after edits.

Mermaid tooling limitation: no Mermaid parser/CLI or documentation-validation script is installed. The planned diagrams use a small flowchart/sequence grammar and should receive structural source checks (balanced block nesting, declared participants/nodes and edge/message syntax). Full Mermaid renderer/browser validation is **NOT RUN** unless an existing parser is discovered. Do not install an application dependency solely for T01 or describe source checks as rendered diagrams.

No fresh backend/frontend/SQL/browser/provider/performance suite is required for this documentation-only change. Historical Phase 3 counts remain historical. Full interactive acceptance and any production readiness decision belong to T09/T10, not T01.
