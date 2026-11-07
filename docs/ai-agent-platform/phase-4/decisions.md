# Phase 4 architecture decision register

**T10 acceptance checkpoint (2026-10-27):** P4-ADR-001..008 remain the local design decisions; [final acceptance](acceptance.md) reconciles their actual implementation and the documented single-backend origin constraint. Phase 4 is READY for the approved local scope. Public identity, detached crash repair and Phase 5 integrations are not implemented. See [operations](operations.md) and [final risks](risk-register.md). Earlier checkpoints below are historical; no ADR is renumbered.

**Phase 4 T09 COMPLETE - local E2E/reliability verification (2026-10-26).** The [E2E matrix, native workflows and evidence](end-to-end-reliability.md) verifies real committed-response loss, execution failures/deadlines, browser offline recovery, hard backend crash/restart, identity persistence, authorization cleanup and existing interaction/city regressions. The dedicated test tier and CI evidence handling are available through `npm run test:interaction:e2e`. Production identity and final release acceptance remain outside this task; T10 is planned. Earlier checkpoints describe their task-date scope.

**Phase 4 T08 COMPLETE - local hardening (2026-10-26).** The [security, accessibility and performance audit](interaction-hardening.md) records real HTTP ownership checks, native Chrome keyboard/AX/focus verification, stronger interaction contrast and measured conditional DOM updates. Existing backend authority and Phase 3 transport remain intact. T09-T10 remain planned; production identity/release remain blocked. Earlier checkpoints describe their task-date scope.

**T07 implementation checkpoint (2026-10-26):** P4-ADR-006/008 are implemented by the page-owned composition boundary and expiring identifiers-only session journal. Existing Task/Execution reads authorize restoration; no mutation replay, private draft persistence, new poller or detached execution promise is added. Reconnection reuses Phase 3 sweeps. Explicit disconnect clears recovery state; page suspension retains only bounded references. See [state ownership, recovery and verification](interaction-state-synchronization.md). T08-T10 remain planned. Earlier checkpoints describe their task-date scope.

**T06 implementation checkpoint (2026-10-26):** P4-ADR-006/007 now include the implemented bounded, lazy read-only result/history owner and existing-inspector presentation. The view shares T03 authentication and transport, keeps historical selection independent of T05/Phase3 current activity, and renders only permitted plain text or typed numeric statistics. It retains one history page and one result; no new poller, generic renderer or output format is introduced. [Evidence and limits](execution-results-history.md). T07-T10 remain planned; no durable payload/selection storage is claimed.

**T05 implementation checkpoint (2026-10-26):** P4-ADR-002/004/005/006 now have local execution-control implementations, verified with native Chrome/API/PostgreSQL. T04 form and T05 lifecycle owners share one interaction client; selection close preserves the synchronous Start request, cancellation uses exact Execution-context eligibility and both versions, and no new poller/result/history UI is added. See [actual semantics and evidence](execution-lifecycle-controls.md). T06-T10 remain planned; T07 durable recovery and production identity are not claimed. Earlier notes below describe their task-date scope.

Date: 2026-10-25. **T02 backend portions of P4-ADR-003/004/005/007 are implemented and verified** in the [interaction API reference](interaction-api.md). T03's data-access status is recorded below; T04-T10 UI/owner/recovery work remains PLANNED. Follow the existing phase-local register convention: P4-ADR-001 through P4-ADR-008. Do not renumber/modify [Phase 3 ADRs](../phase-3/decisions.md).

**T03 data-access portions of P4-ADR-002/003/004/005/007 are now implemented:** see the [actual client contract and tests](frontend-interaction-client.md). T04-T10 UI/state/recovery work remains planned. Actual backend 403 can represent an individual runtime denial; it must not automatically cancel unrelated pending executions. Client 401/disconnect/credential change still clears or fences its whole connection scope. Full owner/cache handling from P4-ADR-006/008 is not implemented by this data-only task.

## P4-ADR-001 - Interactive presentation, exclusive backend execution authority

Context: Phase 3 observes backend activity through linked NPCs. Decision: extend the same inspector/selection with explicit user intent, never movement-driven execution. Reuse coordinator/services/lifecycle. This prospectively extends P3-ADR-002's read-only **product interaction scope**; its backend-authority invariant and Phase 3 read-only facade remain unchanged. Alternative: replace simulation controls or execute on building arrival; rejected for correctness and visual regression risk. Consequence: distinguish simulated mission from Agent Task throughout UI/tests. Implementation T04/T05, verified T09/T10.

## P4-ADR-002 - Reuse native synchronous HTTP, no background promise

Context: current execute waits for finalization, aborts on disconnected response and has a 30-second HTTP budget. Decision: retain it, with application-owned 35-second client wait, separate saved Task and explicit Start. Selection/panel close does not abort Start. Alternative: returning 202 from an in-memory promise or new worker; rejected as unsupported architecture/phase expansion. Consequence: browser navigation can cancel work; uncertain responses require reads. Implementation T03/T05/T07; changes to durable asynchronous semantics require a separate decision.

## P4-ADR-003 - Narrow local interaction audience before controls

Context: city-read cannot mutate and broad operator access includes registry administration. Decision: optional distinct delegated interaction capability, exact existing-route allowlist, current owner/Agent/binding checks and server-only runtime/tool policy. Reuse local transport guard; no production identity claim. Alternatives: expose operator token, accept body ownership, upgrade city-read to writes; rejected. Consequence: T02 is a mandatory security dependency; production user/tenant access and bridged Docker runtime remain blocked. Preserve P3-ADR-008's separate read audience.

## P4-ADR-004 - Frozen idempotent intent plus explicit Start

Context: Task creation already has owner/key/hash uniqueness, Start is synchronous and not an idempotent retry API. Decision: freeze exact input/key, Create once/reconcile, then explicit Start with current Task If-Match. Add minimal exact intent lookup for lost response/reload rather than searching unbounded Tasks. Alternatives: auto retry execute, regenerate keys on network error, combined create-and-run endpoint; rejected as duplicate/uncertain-work risks. Consequence: two commits are visible, saved Tasks may remain unstarted, no frontend status inventions. Implementation T02/T03/T04/T07.

## P4-ADR-005 - Cancellation observes the existing persisted race winner

Context: RuntimeApiService commits via TaskLifecycleService; coordinator later observes cancellation. Decision: reuse this exact route, both versions and native eligibility; UI pending is separate. Refresh on conflicts and preserve success/cancel race winner/quarantine. Alternatives: new cancellation service, direct provider abort from browser, optimistic local CANCELLED; rejected. Consequence: cancellation is cooperative, not necessarily immediate; no automatic quarantine reset or remote termination/billing guarantee. Implementation T05/T07.

## P4-ADR-006 - Separate interaction state from sampled activity

Context: Phase 3 store and one poller already own NPC observations. Decision: small vanilla application-owned interaction sidecar for drafts, immutable operation references and bounded lazy detail/history/result caches. Subscribe to existing completed sweeps and coalesce detail reads; no second NPC poller. Alternatives: mutate NPC state, clone activity store, adopt new framework/global state library; rejected. Consequence: per-selection generation fencing and preserving in-flight Start across UI navigation are required. Implementation primitives T03, composition T04, lifecycle/recovery T07.

## P4-ADR-007 - Authorized bounded disclosure and Agent history query

Context: current city inspection has limited references, operator APIs have per-Task ascending history and validated native results. Decision: minimal owner/Agent-scoped newest-first keyset history endpoint and audience-filtered results; render stats/plain text, LLM text opt-in. No full audit/prompt/tool access. Alternatives: per-Task query fan-out, client sorting one partial page, raw JSON/HTML output; rejected. Consequence: preserve old operator/per-Task contracts, validate cursor precision and disclosure on synchronous/GET paths. Implementation T02/T06.

## P4-ADR-008 - Minimal locator recovery without persisted private drafts

Context: reload clears credentials and a lost Create response may hide Task ID. Decision: bounded expiring per-tab locator journal only, authorize before exact lookup/display, no auto mutation replay. Drafts/results/tokens remain memory-only; scope change/revocation erases protected state. Alternative: store complete prompts/tokens or invent execution continuation after page close; rejected. Consequence: no cross-device/durable draft guarantee; storage-denied mode explicitly lacks reload locators; request abort/crash semantics remain authoritative. Implementation T07, adversarial tests T08/T09.

## Review gates and open decisions

T02 must settle exact optional configuration names and interaction DTO field subsets, implement the documented permission checks and prove no operator/city regression. T08 must review LLM display opt-in and real accessibility/performance evidence. If actual requirements demand production accounts, tenant-specific Tasks, detached durable execution or runtime container exposure, stop claiming this local plan satisfies them and open a separate scoped architecture decision. No such platform is silently added by T01.
