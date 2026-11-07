# Elyqreth AI Agent Platform

T01: Existing Codebase Audit & Architecture Plan. Documentation date: **2026-10-20 (Asia/Bangkok)**. No platform features implemented.

## Scope and provenance

Audited source: `C:\Users\user\Desktop\Project\Elyqreth-source\elyqreth`, supplied after the initial working directory proved empty. It is a source export without Git metadata. Deliverables live separately in the writable workspace `C:\Users\user\Desktop\Project\Elyqreth\docs\ai-agent-platform`. They have not been copied into the source export or added to its README.

Future implementation paths below refer to the audited source root, not a new application in this documentation workspace. [Source README](../../../Elyqreth-source/elyqreth/README.md) and historical decisions are preserved. Source links depend on the sibling-folder arrangement and must be rebased if these documents are transferred. No commit baseline is available; preservation is checked using SHA-256 inventories of all 160 source files.

## Documentation index

| Document | Coverage |
| --- | --- |
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

[Database foundation](database-foundation.md) records the implemented PostgreSQL/Drizzle foundation in the actual source tree, with migrations, scoped constraints, local Compose setup and isolated real-database verification. T01/T02 sections above remain historical snapshots; the source tree documentation is the current implementation record. Binding storage is present without NPC synchronization. T04 is next and has not begun.
