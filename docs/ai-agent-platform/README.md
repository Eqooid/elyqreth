# Elyqreth AI Agent Platform

**Current T16 checkpoint (2026-11-07, Asia/Bangkok):** [Local startup and Agent connections](phase-6/local-operations.md), [operations handover](phase-6/operations-handover.md), and [evidence/status matrices](phase-6/handover-evidence.md). Handover preparation COMPLETE; production acceptance NOT STARTED; production promotion CLOSED — DEFERRED BY PROJECT OWNER. Earlier phase snapshots below retain their historical scopes; current auth is exclusive local/OIDC private-operator access.

Current Phase 5 status is maintained in the [canonical final acceptance report](phase-5/acceptance.md) and [Phase 5 roadmap/index](phase-5/README.md). Native collaboration, external observations, collaboration read APIs and frontend NPC collaboration inspection are implemented and verified within the approved fixed-owner loopback scope. Phase 6 T01 architecture planning is complete; production implementation and deployment remain planned. See the [Phase 6 production plan](phase-6/README.md).

- [Current project README](../../README.md)
- [Phase 5 architecture, ADRs and implementation guides](phase-5/README.md)
- [Current local development and configuration runbook](phase-4/operations.md)
- [Frontend collaboration inspection and limited read credential](phase-5/frontend-collaboration.md)
- [LangGraph reference capabilities and local/hosted distinction](phase-5/reference-integration.md)
- [Security/reliability matrix and executed E2E](phase-5/security-e2e-verification.md)
- [Phase 4 acceptance](phase-4/acceptance.md), [Phase 3 acceptance](phase-3/acceptance.md), [Phase 2 acceptance](phase-2/acceptance.md), [Phase 1 acceptance](phase-1-acceptance.md)

The remaining sections preserve historical task-date records. Their planned/unsupported statements and counts are not current implementation claims; the Phase 5 acceptance report above is authoritative. No separate backend or frontend README is maintained.

## Prior phase acceptance and historical records

**Phase 3 T10 COMPLETE - ACCEPTED WITH LIMITATIONS for local development (2026-10-25).** The [final acceptance report](phase-3/acceptance.md) verifies T01-T10 with 125 frontend, 192 backend and 104 real PostgreSQL tests, plus an additional real Chrome/API/PostgreSQL acceptance workflow covering five executions. Existing city source/assets are unchanged. Public production release remains blocked by the documented identity/access and deployment limits.

Run `npm run test:city:e2e` with Docker and installed Chrome for the isolated combined workflow. Runtime observation uses a distinct, volatile city-read token and explicit trusted local connection; it is disabled by default. See the report for setup, exact commands, evidence and limitations.

## Historical implementation checkpoints

The checkpoints below describe the repository at their task dates. Their "planned" statements are historical; the final T10 inventory above is authoritative.

**Phase 3 T09 COMPLETE — PASS WITH LIMITATIONS (2026-10-25):** [Security, performance and regression evidence](phase-3/security-performance-verification.md) records the approved local trust boundary, patched HTTP parser advisories, measured synchronization/browser resources and reproducible regression checks. T10 final acceptance remains planned.

**Phase 3 T08 COMPLETE (2026-10-25):** [Multi-Agent synchronization and reconnection](phase-3/multi-agent-synchronization.md) hardens existing shared REST polling, same-identity version checks, reentrant refresh coalescing and completion suppression. No new transport/backend state machine. T09/T10 remain planned.

**Phase 3 T07 COMPLETE within city-read contracts (2026-10-25):** [Agent inspection implementation](phase-3/agent-inspection.md) extends the existing inspector using authorized city projection references and its latest recorded outcome. Full operator history/results/audit access is not broadened. T08–T10 remain planned.

**Phase 3 T06 COMPLETE (2026-10-25):** [NPC status visualization](phase-3/npc-status-visualization.md) adds read-only Canvas markers and a compact runtime section in the existing NPC inspector. T07 detailed history/results and T08–T10 remain planned. See the implementation guide for verification and limitations.

**Phase 3 T05 verified (2026-10-24):** [NPC Runtime Binding](phase-3/npc-runtime-binding.md) associates existing stable resident identities with authorized synchronized activity through indexed read-only views. Missing NPCs stay unresolved; no spawning, movement, rendering or inspector behavior changed. Checks passed 96 frontend, 190 backend and 103 PostgreSQL tests, builds/static checks and browser smoke. T06–T10 remain planned.

**T12 acceptance (2026-10-24): ACCEPTED WITH LIMITATIONS for local development only.** See [the acceptance report](phase-2/acceptance.md) for 173 backend, 89 isolated PostgreSQL and 51 city tests, both builds, browser smoke and live installed Ollama text/calculator evidence. Live OpenAI was NOT RUN. External production exposure remains BLOCKED without production identity/access controls. Earlier task checkpoints below are historical evidence.

**Phase 2 checkpoint:** T02-T11 are implemented and T12 reviewed. Current live Ollama text and calculator probes passed; historical string-operand failures remain documented model-reliability evidence. No worker, unrestricted public API or city synchronization exists. Phase 3 is planning only.

**Current project root:** `C:\Users\user\Desktop\Project\Elyqreth`. The full codebase was consolidated here on 2026-10-21; see [workspace instructions](../../WORKSPACE.md). Original source-location references below are historical provenance. Use this root for all future implementation work.

**Historical Phase 1 checkpoint:** T01–T08 local-development foundation accepted **READY WITH LIMITATIONS**; see the [Phase 1 acceptance report](phase-1-acceptance.md) for command evidence and production/hosted-CI limitations. Lifecycle operations remain internal-only. Actual AI execution, workers, retries, event delivery and NPC synchronization remain future work. The T01–T07 snapshots below retain their historical dates, paths and results.

T01 historical scope: Existing Codebase Audit & Architecture Plan. Documentation date: **2026-10-20 (Asia/Bangkok)**. No platform features were implemented by that documentation-only task.

## Scope and provenance

Audited source: `C:\Users\user\Desktop\Project\Elyqreth-source\elyqreth`, supplied after the initial working directory proved empty. It is a source export without Git metadata. Deliverables live separately in the writable workspace `C:\Users\user\Desktop\Project\Elyqreth\docs\ai-agent-platform`. They have not been copied into the source export or added to its README.

Future implementation paths below refer to the audited source root, not a new application in this documentation workspace. [Source README](../../README.md) and historical decisions are preserved. Source links depend on the sibling-folder arrangement and must be rebased if these documents are transferred. No commit baseline is available; preservation is checked using SHA-256 inventories of all 160 source files.

## Documentation index

| Document | Coverage |
| --- | --- |
| [Phase 2 runtime plan — T01](phase-2/README.md) | Repository audit, runtime/context, optional providers, lifecycle/result integration, tool security and dependency-aware T02–T12 roadmap |
| [Phase 1 acceptance review — T08](phase-1-acceptance.md) | Requirements traceability, executed verification, CI/local reproduction, preservation, limitations and readiness decision |
| [Event Contracts & Audit History — T07](event-audit-foundation.md) | Implemented versioned contracts, centralized atomic event writes, ordering, historical compatibility and read-only APIs |
| [Task Lifecycle Service — T06](lifecycle-service.md) | Implemented internal state machines, atomic paired transitions, version conflicts, cancellation/timeout and concurrency tests |
| [Task & Execution Persistence — T05](task-execution-persistence.md) | Implemented Task APIs, read-only attempt history, internal allocation, idempotency, security and migration |
| [Agent Registry API — T04](agent-registry.md) | Implemented routes, local-only access gate, validation, lifecycle, atomic history, testing and limitations |
| [Existing system audit](existing-system-audit.md) | Verified stack, subsystem locations, behavior, state ownership, limitations and checks |
| [Architecture](architecture.md) | Backend modules, repository strategy, decisions, optional LLM/tool boundaries |
| [Domain model](domain-model.md) | Logical identities, relationships, constraints and indexes |
| [Orchestration contracts](orchestration-contracts.md) | Capability-based adapters and execution authority |
| [Task lifecycle](task-lifecycle.md) | State transitions, retry, cancellation, interruption and recovery |
| [Event contracts](event-contracts.md) | Versions, history, delivery, deduplication and resynchronization |
| [City integration](city-integration.md) | Future execution projection and NPC bridge |
| [Security and reliability](security-and-reliability.md) | Gates before real execution and operational requirements |
| [Phase 1 implementation plan](phase-1-implementation-plan.md) | T02–T08 dependencies and Phase 2/3 overview |

## Labels and result

- **IMPLEMENTED**: inspected source; runtime verification stated separately.
- **SIMULATED**: functioning browser simulation without external execution.
- **PARTIAL**: verified precursor exists, but the platform requirement is incomplete.
- **PLANNED**: proposed Phase 1 work, not implemented.
- **FUTURE**: work beyond Phase 1.
- **UNKNOWN**: not established by evidence.

Target contracts and code-shaped examples are design only. Proposed module names are not existing files. T01 covers all requested audit/design/implementation-planning areas through the documents above. Syntax checks and **51 existing tests pass**. The complete source-file hash inventory is unchanged. Documentation checks are recorded in the audit. Fresh browser visuals and FPS were not checked; retained captures are historical evidence.

Recommendation: preserve `dist/` and its Canvas city; add a sibling NestJS API, shared contracts and PostgreSQL in the same repository. Defer frontend relocation, NPC synchronization, LLMs, external adapters and brokers. **T02 is the next implementation task and has not begun.**

## T02 implementation record

The preceding content is the preserved T01 snapshot. T02 implementation is now recorded in [Backend foundation and workspace integration](backend-foundation.md), including actual code, configuration, commands, scope adjustments and verification. Source and T01 documentation are now integrated under `Elyqreth-source/elyqreth`; this sibling documentation set remains available as provenance. No database, empty contract package, authentication placeholder or agent execution is included in T02. Next implementation slice after T02 acceptance is T03.

## T03 implementation record

[Database foundation](database-foundation.md) records the implemented PostgreSQL/Drizzle schema, migrations, scoped constraints, local Compose setup, configuration and real-database verification. T01/T02 sections above are preserved historical snapshots. Binding metadata storage is implemented in T03 as explicitly requested; NPC integration, agents/tasks APIs, execution and event publishing remain future work. Next: T04 — Agent Registry API, after the authentication/ownership prerequisite is addressed.


