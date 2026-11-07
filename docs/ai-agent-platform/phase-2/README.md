# Phase 2 — AI Agent Runtime plan

**T12 acceptance (2026-10-24): ACCEPTED WITH LIMITATIONS for local development only.** See [the acceptance report](acceptance.md) for 173 backend, 89 isolated PostgreSQL and 51 city tests, both builds, browser smoke and live installed Ollama text/calculator evidence. Live OpenAI was NOT RUN. External production exposure remains BLOCKED without production identity/access controls. Earlier task checkpoints below are historical evidence.

Status: **T02-T11 IMPLEMENTED; T12 REVIEW COMPLETE — ACCEPTED WITH LIMITATIONS (local development only).** The acceptance report is the current evidence; earlier per-task counts and live-model failures remain historical, not contradictory current status. T12 does not approve external production exposure or implement Phase 3.

The audit table and T01 verification below preserve the original planning snapshot. Current contract, coordinator, provider and safe-tool guides define implemented behavior. Distributed recovery and later hardening remain future work.
Start with [T02 implemented contracts](runtime-contracts.md), then the T01 design: [Runtime architecture](runtime-architecture.md), [Lifecycle integration](execution-lifecycle.md), [Provider abstraction](provider-abstraction.md), [Tool security](tool-security.md) and [implementation plan](implementation-plan.md). The repository audit and T01 verification paragraphs below preserve the original planning snapshot. T01 interface sketches remain design references; the T02 guide identifies the concrete contract names and deliberate deferred fields.

## Repository-grounded audit

The actual backend is `apps/api`, alongside the existing static city source in root `dist/`. npm workspaces, Node 24, strict TypeScript, NestJS 11.2.7, Drizzle 0.45.4/pg 8.23.1 and PostgreSQL 17.11 are retained. There is no `apps/web`, shared-contract package, second backend, ORM or required orchestration SDK. Vite is the frontend development/bundle tool; Canvas 2D and vanilla JS still own the city.

| Evidence inspected | Verified current implementation / boundary |
| --- | --- |
| [Phase 1 T08 acceptance](../phase-1-acceptance.md) | Recorded **READY WITH LIMITATIONS** for local development, 51 city + 45 backend + 49 PostgreSQL tests, browser smoke and builds. This T01 read the report and corresponding tests/code; those runtime checks were not rerun, and their counts are historical evidence, not new T01 results. |
| [Phase 1 architecture](../architecture.md), [orchestrator proposal](../orchestration-contracts.md) | Additive backend, explicit external execution authority and capability-based future adapters. Workers/native adapter implementations described in the original proposal are not implemented. |
| [Agent DTO](../../../apps/api/src/agents/dto/agent.dto.ts), [service](../../../apps/api/src/agents/agents.service.ts) | RULE_BASED/LLM/EXTERNAL; ACTIVE/DISABLED/ARCHIVED. Required same-owner orchestrator; create DISABLED, versioned activate/disable/archive. Configuration accepts **category/color only**; capabilities are descriptive strings, not tool permissions. No runtime/provider selector. |
| [Task DTO](../../../apps/api/src/tasks/dto/task.dto.ts), [Task service](../../../apps/api/src/tasks/tasks.service.ts) | Input is `{instruction, context?}`, not arbitrary operation/tool/provider JSON; bounded to 32 KiB, with per-field limits and credential heuristics. CREATED only, no automatic attempt or execution. Scoped idempotency and stable reads. |
| [Schema](../../../apps/api/src/database/schema.ts), [guard migration](../../../apps/api/migrations/0001_persistence_guards.sql) | 11 tables, four migrations. Task/attempt identity and route immutable, attempts unique, one active attempt/task and one native RUNNING attempt/agent. `execution_results` is append-only, one result/attempt, ≤64 KiB. Snapshot/adapter/configVersion immutable after allocation. |
| [Attempt service](../../../apps/api/src/executions/executions.service.ts) | Internal atomic `createPending`/caller-transaction variant; current snapshot validates category/color only. No public allocation route. No lease claim/heartbeat, strategy resolver or execution dispatch. |
| [Lifecycle service](../../../apps/api/src/lifecycle/task-lifecycle.service.ts), [policy](../../../apps/api/src/lifecycle/lifecycle-policy.ts) | Owns transactions, locks Task then Execution, checks versions, coordinates state/timestamps/events. Queue creates/adopts PENDING. Completion validates a **previously inserted** `result:<uuid>`. No caller-transaction completion, result writer, abort implementation or stale-worker token check. |
| [Events](../../../apps/api/src/events/events.service.ts), [contracts](../../../apps/api/src/events/contracts/event-contracts.ts) | 17 v1 lifecycle events; runtime-validated small closed payloads. Caller-transaction append, per-owner ordered stream and correlated paired facts, protected histories. Success event is `execution.completed`, status SUCCEEDED. Outbox rows exist but no relay. |
| [Configuration](../../../apps/api/src/config/configuration.ts), [local guard](../../../apps/api/src/common/local-access.guard.ts), [API example env](../../../apps/api/.env.example) | Process > API .env > defaults; scoped credentialed opt-in dev/test APIs, loopback/Host/Origin checks; production fails closed. No LLM/runtime settings or full person authentication. Task/Execution responses omit input/results/unsafe errors. |
| [Compose](../../../docker-compose.yml), [.openai hosting](../../../.openai/hosting.json) | PostgreSQL only, pinned image, named volume, loopback port. City static hosting remains `dist/`. No API/Ollama container, broker, Redis, worker, WebSocket or external runtime is configured. |
| [Tests](../../../apps/api/test/acceptance.integration.cjs), [DB harness](../../../apps/api/test/database.integration.cjs), [CI](../../../.github/workflows/verify.yml) | Real Nest HTTP + trusted service + owned disposable PostgreSQL, race/rollback/migration/restart tests. CI runs the same local verification command; remote workflow execution remains NOT VERIFIED. No live-provider suite exists. |

No applicable AGENTS.md was found in the project/ancestor instruction locations or source/documentation subtrees. `git status --short` again reports **not a Git repository**. No clean-tree/commit claim is made. A fresh SHA-256 baseline protects existing files during this documentation task. No `.env` secrets were inspected.

## Required integration remediation

These are Phase 2 implementation prerequisites, not invented Phase 1 completion claims:

| Gap / risk | Required action before enabling execution | Planned slice |
| --- | --- | --- |
| Metadata-only configuration and immutable incomplete snapshots | Server-owned, versioned definitions/bindings; snapshot validated strategy/profile/budgets/tools at allocation. Never infer strategy from category, role, name or prose; never retrofit existing attempts. | T02 contracts; T03 persistence/resolver seam |
| Lifecycle transaction ownership; result-before-completion gap | Extract transaction-aware lifecycle primitives while retaining public wrappers/rules. One transaction must insert result, finish both records and append events/audit/outbox, with failure rollback. | T03 |
| Lease fields without enforcement; heartbeat mutates resource version | Enforce native claims, deadline, token, DB-time lease and terminal guards in the shared lifecycle boundary. Read fresh versions under lock after heartbeats; fail closed on lost ownership. | T03 baseline; T10 expanded recovery tests |
| Existing cancellation is a terminal decision, not a process stop | Persist cancellation, abort locally, fence late completion, quarantine unresolved remote work; do not treat lease expiry as proof remote termination. | T03 minimum; T10 expanded policies |
| Local registry credential is not permission to spend money or run tools | Separate runtime enablement/owner-agent-route allowlist; explicit provider/paid consent, tight budgets, tools default-deny, keep production off. | T03; T05–T09 |
| No authoritative native/external dispatch | Match configured native route UUIDs AND NATIVE authority; refuse EXTERNAL agents/attempts. No automatic provider/framework fallback or ambiguous replay. | T03 |

**Planning can proceed. Enabling a runtime before these gates is blocked.** Production runtime remains blocked by absent identity/tenant authorization, hardened deployment/TLS, role separation, operational recovery and other T08 limitations. A local, explicitly authorized, no-tools deterministic first agent can be enabled after its narrower gates pass. Ollama installation, local models, GPU/RAM availability, cloud model access, actual production infrastructure and provider account policy are **UNKNOWN**; no probe/download/provider request was performed.

## T01 verification and handoff

T01 uses source/config/test/document inspection, official-provider documentation research, local-link/fence/coverage checks and before/after hash comparison. It does not rerun migrations, start Docker or exercise model execution, because it changes documentation only. Provider references are dated in the provider document; revalidate protocol details at adapter implementation.

Executed documentation checks passed: six planning documents, 40 local source/document links, balanced Markdown fences, six Mermaid source diagrams, and all 11 T02–T12 slices checked for objective/dependencies/scope/files/database/security/tests/acceptance/exclusions. The first link check found audit links with one excess parent-directory segment; those links were corrected and the complete check passed. Mermaid rendering was not executed; the diagrams were reviewed as source. SHA-256 comparison found **zero changed/missing files among 225 existing non-Markdown files**. Only four existing Markdown indexes/roadmaps were updated; six new Markdown documents were created. Application/frontend code, tests, dependency files, CI/deployment configuration and migrations remain unchanged. Phase 1's acceptance report and historical architecture content were preserved.

## Acceptance coverage

| T01 deliverable | Location / planning outcome |
| --- | --- |
| Phase 1 implementation and acceptance review | Repository audit and remediation tables above; code/test evidence inspected, historical test results labeled |
| Runtime components, strategies, context and results | runtime-architecture.md; rule-first native module, immutable definitions and versioned results |
| Provider interface, Ollama and optional OpenAI | provider-abstraction.md; official references, exact illustrative local tag, capability/configuration/credential boundaries |
| Triggering, lifecycle, cancellation and recovery | execution-lifecycle.md; explicit local command first, transaction-aware lifecycle/result seam, leases and no ambiguous replay |
| Tool security, threats and first-call gates | tool-security.md; default-deny pure tools, local authorization and LLM prerequisites |
| Observability and testing | runtime-architecture.md plus implementation-plan.md; durable state facts, safe audit metadata, optional usage, fixture/real-DB/live separation |
| T02–T12 roadmap | implementation-plan.md; all required fields for each slice, justified early safety/text-strategy dependencies |
| Preservation / no implementation | Baseline hash comparison and documentation-only changed-file inventory above |

## Open operational questions and risks

No answer to these is needed to implement inert T02 contracts. They must be resolved before their enablement gate:

- **Local hardware/model:** actual Ollama installation, server version, model digest, RAM/GPU and measured cold-start budget are UNKNOWN. Operator chooses/obtains the model explicitly for T06; insufficient hardware or absent live evidence blocks the LLM-enabled milestone.
- **Cloud policy:** approved OpenAI model/account/data policy/spending controls are UNKNOWN. Leave the profile disabled until reviewed; cloud access is never the fallback for local failure.
- **Definition operations:** startup-bound versioned catalog is selected for MVP. A later multi-user definition administration API needs real authorization/version retention; it is not part of T02.
- **Uncertain remote outcome:** the first provider adapters may lack trustworthy remote status/cancel confirmation. Preserve quarantine and require explicit disposition; local abort/lease expiry cannot justify automatic replay or exact billing claims.
- **Deployment:** production identity, least-privilege roles, TLS, backup restoration, signal/drain testing and hosted CI execution remain T08 limitations. Native production runtime is blocked until these are addressed. A dedicated worker/supervisor is a later deployment choice, not a service silently introduced by this plan.

Current next task: **Phase 2 T03 — Runtime Coordinator & Lifecycle Integration**. T02 contracts alone enable no execution. Phase 1 acceptance, historical documents and the existing city remain preserved. T03 has not begun.



