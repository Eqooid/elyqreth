# Phase 3 - Agent-to-NPC integration

**Phase 3 T10 COMPLETE - ACCEPTED WITH LIMITATIONS for local development (2026-10-25).** The [final acceptance report](acceptance.md) verifies T01-T10 with 125 frontend, 192 backend and 104 real PostgreSQL tests, plus an additional real Chrome/API/PostgreSQL acceptance workflow covering five executions. Existing city source/assets are unchanged. Public production release remains blocked by the documented identity/access and deployment limits.

Run `npm run test:city:e2e` with Docker and installed Chrome for the isolated combined workflow. Runtime observation uses a distinct, volatile city-read token and explicit trusted local connection; it is disabled by default. See the report for setup, exact commands, evidence and limitations.

## Historical implementation checkpoints

The checkpoints below describe the repository at their task dates. Their "planned" statements are historical; the final T10 inventory above is authoritative.

**Phase 3 T09 COMPLETE — PASS WITH LIMITATIONS (2026-10-25):** [Security, performance and regression evidence](security-performance-verification.md) records the approved local trust boundary, patched HTTP parser advisories, measured synchronization/browser resources and reproducible regression checks. T10 final acceptance remains planned.

**Phase 3 T08 COMPLETE (2026-10-25):** [Multi-Agent synchronization and reconnection](multi-agent-synchronization.md) hardens existing shared REST polling, same-identity version checks, reentrant refresh coalescing and completion suppression. No new transport/backend state machine. T09/T10 remain planned.

**Phase 3 T07 COMPLETE within city-read contracts (2026-10-25):** [Agent inspection implementation](agent-inspection.md) extends the existing inspector using authorized city projection references and its latest recorded outcome. Full operator history/results/audit access is not broadened. T08–T10 remain planned.

**Phase 3 T06 COMPLETE (2026-10-25):** [NPC status visualization](npc-status-visualization.md) adds read-only Canvas markers and a compact runtime section in the existing NPC inspector. T07 detailed history/results and T08–T10 remain planned. See the implementation guide for verification and limitations.

Date: 2026-10-24 (Asia/Bangkok). **T02–T05 COMPLETE for local identity/projection/synchronization and nonvisual NPC association; T06–T10 PLANNED.** Earlier checkpoints below are historical. No runtime status rendering or inspector extension is implemented.

**T05 implemented and verified (2026-10-24):** [NPC Runtime Binding](npc-runtime-binding.md) derives indexed read-only associations from T04 and existing immutable NPC slots. Missing NPCs remain unresolved; no spawning, rendering or inspector change is added. Verification passed 96 frontend tests (19 new), 190 backend tests, 103 PostgreSQL tests, builds/static checks and browser smoke, plus final focused/type/build reruns. T06–T10 remain PLANNED.

**T04 implemented and verified (2026-10-24):** [Frontend runtime integration](frontend-runtime-integration.md) adds a typed city-read client, frozen store/read facade and bounded synchronization. Final checks passed 77 frontend tests (23 new runtime tests), 190 backend tests, 103 PostgreSQL tests, builds/static checks and browser smoke, with final focused compatibility/build reruns. T05–T10 remain PLANNED; no NPC binding/rendering or backend production source changed.

**T03 implemented and verified (2026-10-24):** [Backend Agent Activity Projection](agent-activity-projection.md) adds one-snapshot batched/single read models, separate city-read access, operator reads and explicit current-versus-recent outcome semantics. Full verification passed 190 backend, 102 PostgreSQL and 54 city tests, builds/static checks and browser smoke. T04–T10 remain PLANNED; no frontend code or database migration changed.

**T02 implemented and verified (2026-10-24):** [Agent/NPC binding implementation](agent-npc-bindings.md) provides trusted local create/read/remove/reassign operations over existing PostgreSQL storage, safe revisions and stable NPC slots. Final checks: 181 backend, 96 PostgreSQL and 54 city tests, builds/static checks and browser smoke passed through individually executed commands. No mapping REST mutation API, hydration or status synchronization was added; T03–T10 remain PLANNED.

## Scope and prerequisite decision

Phase 3 adds read-only visualization of registered Agents and their committed activity to the existing city. It does not execute work through NPC interactions. Simulation, execution and presentation are separate systems: walking/working animations and the existing four-stage mission are simulated; a runtime indicator represents a sampled backend fact. A moving NPC is not evidence of execution, and an LLM answer does not move a resident.

The [Phase 2 acceptance report](../phase-2/acceptance.md) records **ACCEPTED WITH LIMITATIONS for local development only**: 173 backend, 89 PostgreSQL and 51 city tests, builds/browser smoke, live installed Ollama text and calculator probes. Live OpenAI was NOT RUN. Current source confirms the reported coordinator, strategies, providers, tools, guarded APIs and transactional result/audit boundary. Those counts are T12 evidence, not tests rerun in this planning task.

Production identity/authorization and durable crash recovery remain absent. External deployment is BLOCKED. Local Phase 3 implementation can proceed with the same fail-closed loopback deployment and the additional read-only browser boundary specified in [security](security.md). T02 identity work can be tested internally; authenticated synchronization must wait for T03's narrow credential and safe projection APIs. Do not weaken existing runtime-control guards to enable visualization.

## Repository audit

| Area | Actual implementation and implication |
| --- | --- |
| Workspace | Root npm workspaces/Node 24; no Git metadata, so `git status --short` cannot establish a clean tree. No applicable AGENTS.md found in repository/ancestors. Use a before/after file-hash inventory to preserve existing work. |
| Frontend | Hand-maintained `dist/index.html`, `dist/style.css`, vanilla ES modules in `dist/js/`; Vite development/build tooling, Canvas 2D. Root dist is source, not disposable build output. No React/store framework or runtime API client. `assets.js` fetches local assets; this is not backend integration. |
| Functional residents | `simulation.js`: mutable `Simulation.agents`, four initial residents, `addAgent`/`removeAgent`, numeric `nextId` resets each page load. Names/roles are presentation. Local mission progress/status and reset/fail/retry are simulation only. |
| Decorative residents | `citizens.js`: separate `people`/staff, `decorative:true`, numeric IDs from 10001 and staff 9999, spawn/despawn/transit/service schedules. Do not bind these temporary visitors in Phase 3. |
| Movement/activities | `movement.js`, `activities.js`, `agent-state.js`, pathfinding, reservations, needs and animator own simulation behavior. `agent.state/status/workStatus/progress` are not backend Task states. |
| Rendering | `renderer.js` TownRenderer/TownScene, depth sorting, one `drawAgent`, hit-test selects `agent`/`citizen`/building; `theme.js` explicitly owns Icy White render-only colors. `game-loop.js` uses requestAnimationFrame with bounded simulation substeps. No network belongs here. |
| UI/state | `app.js` owns Simulation, selection, GameLoop, agent list and single `renderInspector`; DOM refresh approximately every 200 ms. Existing inspector has local remove/simulate-error controls. No durable resident identity or saved runtime binding. |
| Backend | Sole `apps/api` NestJS app; Drizzle/pg PostgreSQL, existing lifecycle services and atomic RuntimePersistenceService. One RuntimeCoordinator, `text.stats.v1` and `llm.text.v1`, one provider registry and one ToolRegistry. No city module/API. |
| Existing binding storage | `database/schema.ts` cityAgentBindings / `city_agent_bindings`, present since migration 0000; owner-scoped Agent FK and partial unique enabled Agent/NPC per city. Storage exists; no binding application service or synchronization implementation. |
| Runtime data | Agents ACTIVE/DISABLED/ARCHIVED; Tasks CREATED/QUEUED/RUNNING/COMPLETED/FAILED/CANCELLED; Executions PENDING/RUNNING/SUCCEEDED/FAILED/CANCELLED/TIMED_OUT. History/result/audit are durable; no percentage progress or guaranteed live progress stream. |
| APIs | `agents`, `tasks`, nested `executions`, `events` controllers and `runtime/http`. Synchronous execute has 30-second abort/disconnect behavior. Existing task status includes Task serialization: not a safe minimal city projection to copy blindly. |
| Access/observability | LocalAccessGuard requires configured bearer, fixed owner, loopback bind/socket/Host and allowed Origin; production/default closed. Runtime writes also require trusted bindings. ApiLogger/request-context provide safe observations and request IDs; audit is committed history, not a push transport. No production tenant identity or city-specific read credential. |
| Tests/deployment | Node test runner, owned Docker PostgreSQL harness, browser smoke and existing GitHub verification workflow; Compose has PostgreSQL only. Current Vite dev host is 0.0.0.0: do not type a local bearer into a remotely served city. Phase 3 integration must use an explicit loopback Vite override and exact CORS origin. |

## Documentation index

- [T05 NPC runtime binding and verification](npc-runtime-binding.md)

- [T04 frontend integration and actual verification](frontend-runtime-integration.md)

- [T03 implemented activity APIs and verification](agent-activity-projection.md)

- [T02 implemented bindings and verification](agent-npc-bindings.md)

- [Architecture and frontend ownership](architecture.md)
- [Stable Agent/NPC identity](identity-mapping.md)
- [Backend activity projection and read APIs](activity-api.md)
- [Polling, stale data and reconnection](synchronization.md)
- [Visual indicators and existing inspector](visualization-inspector.md)
- [Security and release boundaries](security.md)
- [Testing and performance targets](testing-performance.md)
- [T02–T10 implementation roadmap](implementation-plan.md)
- [Architecture decisions and alternatives](decisions.md)

## T01 verification and limits

This task inspected frontend/source/API/schema/migration/access/CI artifacts and the actual T12 report. It does not claim to rerun runtime, browser, database or live provider acceptance; those belong to T10 after implementation. Documentation links/fences and source preservation are checked at the end of T01. No code, dependencies, migration, sprites or city assets may change during T01.

T01 final checks: 12 documentation files checked for local link targets and balanced fenced blocks, zero issues. Before/after SHA-256 inventory of 340 existing maintained files found only the two documentation indexes modified, zero removed; 10 Phase 3 planning documents were created. All existing frontend/backend/test/migration/configuration files and Phase 1/2 documents remained unchanged. No application tests/builds or provider calls were run in this documentation-only task; the prior T12 counts above are explicitly historical evidence.

## Open risks and decision gates

- Browser connection cannot ship using the broad operator bearer: T03's separate read audience and ownership/result-disclosure tests are prerequisites, not optional polish.
- Existing numeric NPC IDs are not durable. The new manifest must agree across the explicit four-resident initialization and backend catalog; unknown keys fail unresolved instead of creating a misleading association.
- Polling can miss short RUNNING intervals. Accept sampled status/latest history for this phase; require a separate transport decision if every transition must be observed.
- Twenty linked slots, two-second polling and render/detail targets are selected initial design budgets, not measured capacity. T09 must measure them on recorded hardware.
- Exact future result text disclosure and retention policy needs operational review; default remains off. Full production identity/tenant/session controls and durable crash recovery are outside local Phase 3 acceptance.
- No external orchestrator is required. Future external records may permit multiple active attempts and unknown statuses; projection must remain explicit and conservative rather than relying on native-only runtime constraints.

Future Hermes/LangGraph/CrewAI/custom/external agents must enter through a separately authorized backend adapter and the same normalized projection contract. Phase 3 does not implement those adapters, multi-agent collaboration, scheduling, messaging, WebSockets/SSE, memory/RAG or new providers.
