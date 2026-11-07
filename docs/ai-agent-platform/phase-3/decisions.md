# Phase 3 architecture decisions

**Phase 3 T08 COMPLETE (2026-10-25):** [Multi-Agent synchronization and reconnection](multi-agent-synchronization.md) hardens existing shared REST polling, same-identity version checks, reentrant refresh coalescing and completion suppression. No new transport/backend state machine. T09/T10 remain planned.

**Phase 3 T07 COMPLETE within city-read contracts (2026-10-25):** [Agent inspection implementation](agent-inspection.md) extends the existing inspector using authorized city projection references and its latest recorded outcome. Full operator history/results/audit access is not broadened. T08–T10 remain planned.

**Phase 3 T06 COMPLETE (2026-10-25):** [NPC status visualization](npc-status-visualization.md) adds read-only Canvas markers and a compact runtime section in the existing NPC inspector. T07 detailed history/results and T08–T10 remain planned. See the implementation guide for verification and limitations.

**T05 checkpoint:** [Verified runtime association](npc-runtime-binding.md) implements the frontend portion of P3-ADR-001/005 using existing slots and T04 views. The latest T05 scope retains missing NPCs as unresolved and never provisions extra avatars automatically. Rendering/inspection in P3-ADR-006 remains planned.

**T04 checkpoint:** [Verified frontend boundary](frontend-runtime-integration.md) implements the REST polling/store/freshness decisions (P3-ADR-004/005/007) and volatile credential/safe read-audience handling from P3-ADR-008. NPC rendering/inspection decisions remain planned; no production identity platform or credential-entry UI was added.

Date: 2026-10-24. **Status: P3-ADR-001 identity/storage is implemented by T02; P3-ADR-003 projection and the backend read-audience portion of P3-ADR-008 are implemented by T03. T04 now implements polling/frontend-state/freshness; NPC binding/visualization and later integration remain planned.** See [verified T02 boundaries](agent-npc-bindings.md) and [verified T03 activity/access contract](agent-activity-projection.md). Backend execution authority remains unchanged; no city control integration exists. Existing repository decisions are documented inline in architecture/planning pages rather than a dedicated ADR system; this phase-local numbered register follows that lightweight convention. Scope/dependencies are in the [implementation plan](implementation-plan.md). Revisit decisions with test/measurement evidence, not speculative frameworks.

## P3-ADR-001 — One enabled Agent per stable NPC slot per city

Context: numeric resident IDs reset on load and decorative IDs are transient; binding storage already exists. Decision: use existing owner/city-scoped enabled unique Agent/NPC rows with a versioned slot manifest, never display-name matching. Alternatives: Agent → many NPCs complicates indicators/inspection; many Agents → one NPC hides ownership; browser-only persistence cannot establish durable authority. Consequences: minimal storage reuse, explicit provisioning/removal, extra slot cap 20 and manifest compatibility tests. Binding mutation remains a trusted internal command, not a visual action.

## P3-ADR-002 — Backend retains exclusive execution authority

Context: simulation state/progress looks like work but is not runtime state. Decision: city is read-only; no execute/cancel/retry from rendering, simulation or NPC inspector. Existing runtime APIs/coordinator remain the sole control path. Alternative: drive runtime from simulation update or building arrival; rejected because frame rate, path failure and offline reload would affect execution semantics. Consequence: simulated controls must be labelled and cannot mutate persisted Tasks.

## P3-ADR-003 — Query committed activity, do not create a second state machine

Decision: on-demand batched read projection with availability, actual Task/Execution fields, counts, deterministic representative, latest outcome and uncertainty. No persisted derived status table/new enum/event sourcing. Alternatives: copy last audit event into status, or per-Agent HTTP joins; rejected because audit aggregates/order differ and N+1 cost grows. Consequences: bounded consistent SQL snapshots and explicit UNKNOWN mapping, no guarantee polling observes every transient state. Historical outcomes remain separate from current activity.

## P3-ADR-004 — REST polling first

Decision: existing authenticated HTTP, one batch per 2-second foreground interval after completion, 5-second request timeout, bounded backoff and visibility pause. SSE/WebSockets deferred: neither exists, native EventSource does not fit bearer headers without extra design, and bidirectional controls are outside scope. Consequence: sampled state rather than real-time delivery; no per-NPC requests. Revisit only with measured latency/load requirements and a scoped reconnect/auth protocol.

## P3-ADR-005 — Small vanilla frontend sidecar store

Decision: client/store/scheduler/reconciler modules composed by app.js; Map keyed by Agent UUID and stable NPC slot, independent from Simulation and GameLoop. No Redux/Zustand/new frontend framework. Alternative: mutate resident.state/status/progress or fetch in drawAgent; rejected because it conflates animation with execution and leaks requests into frame scheduling. Consequences: explicit dispose/change notifications, selection/request generation guards and bounded caches.

## P3-ADR-006 — Additive visualization and one inspector

Decision: existing Canvas renderer/hit-test/inspector, small Icy White shape/text markers, accessibility DOM/reduced motion; movement/needs/activity behavior remains local. Alternative: new NPC subclasses/renderer/second dashboard, task-driven teleport/workplaces; rejected as duplicative and misleading. Consequences: render-only overlay lookup and clearly separated simulation/runtime sections; no sprites or city lighting redesign.

## P3-ADR-007 — Staleness is an observation, not Agent availability

Decision: client freshness ages independently; stale after 6 seconds, unknown after 30, frozen working pulse and authoritative refresh on reconnect. No assumed offline runtime or automatic Task cancellation. Alternative: keep RUNNING forever or reset backend state on disconnect; rejected as false/mutating. Consequences: initial/reconnect terminal outcome is history, not replayed animation; auth failure purges protected identity/result data immediately.

## P3-ADR-008 — Read-only local browser credential and safe facade

Context: existing local bearer permits control routes and existing Task responses may contain input. Decision: distinct optional city-read credential bound to configured owner/city, GET-only facade, exact loopback origin, minimized DTOs and default-off LLM text disclosure. Reuse local guard policy rather than introduce an identity provider. Alternatives: embed operator key in build/storage, use unrestricted proxy, strip Authorization; rejected. Production user/tenant sessions are not implemented by this decision. Consequences: T03 is a prerequisite for browser reads; city token must fail on existing writes; public deployment remains blocked. Memory-only bearer still has XSS/extension risk.

## Revisit triggers

More than 20 mapped residents, multiuser hosting, requirement to observe every state transition, automated binding creation, external-agent ingestion or NPC-triggered execution require a separate scoped decision and acceptance tests. They are not silently enabled by a new frontend enum, existing database mode or future transport availability.
