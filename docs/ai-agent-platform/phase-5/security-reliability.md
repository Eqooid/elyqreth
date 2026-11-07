# Proposed security, reliability and observability

**Final Phase 5 status (2026-10-29): ACCEPTED for the approved local scope; T01-T12 complete.** See [canonical acceptance, current contracts and limitations](acceptance.md). Task-date proposals, checkpoints, counts and future-task statements below are historical, not additional implemented capabilities or current roadmap status.

**T11 COMPLETE (2026-10-29), approved local scope:** See the [actual security/reliability matrix, threat model, fixes and E2E evidence](security-e2e-verification.md). The planning/task-date records below are historical. T12 and Phase 5 closure remain pending.

**T10 checkpoint (2026-10-29):** Frontend collaboration inspection and the distinct local collaboration-read audience are implemented; see [actual architecture, contracts, security and test evidence](frontend-collaboration.md). Historical proposed contracts below are task-date planning, not additional implemented endpoints. T11/T12 remain planned.

**T09 checkpoint (2026-10-28):** [Collaboration activity projection](collaboration-activity.md) provides operator-authorized version-2 snapshots, bounded relationships/history, explicit native/external provenance and native event cursor hints. It composes existing Phase 3 SQL/mapper and T07 observations without provider calls or lifecycle writes. V1 city routes remain unchanged; T10-T12 remain planned. Earlier snapshots below are historical.


**T08 checkpoint (2026-10-28):** [LangGraph reference integration](reference-integration.md) adds one observation-only compiled adapter, explicit discovery/approval/poll/result commands, real pinned-server verification and T07 inbox reconciliation. No external dispatch/cancel, public webhook, scheduler, activity API or city/UI change. Earlier task snapshots below are historical.


**T07 checkpoint (2026-10-28):** [External mappings and ingestion](external-ingestion.md) implement durable source incarnations, explicit identity approval, authenticated internal receipt, conservative ordered observation and bounded replay. External data never mutates native work. Real providers/public webhooks/polling and activity/UI integration remain deferred. Earlier task/planning snapshots below are historical.


**T06 checkpoint (2026-10-28):** [External adapter foundation](adapter-foundation.md) implements provider-neutral contracts, capability/ownership gates, trusted configuration and bounded transport with an empty production registry. No real provider, external persistence/ingestion or dispatch is implemented. Earlier planning/task snapshots below are historical.


**T05 checkpoint (2026-10-27):** [Lifecycle and recovery](lifecycle-recovery.md) adds bounded operator reconciliation, durable cancellation intents, conservative aggregate state and explicit recovery of never-admitted children. Native uncertain outcomes remain quarantined; no worker, scheduler, terminal reset or external integration is introduced. Earlier task checkpoints below are historical.


**PLANNED requirements**, not implemented controls. Preserve [Phase 4 risks](../phase-4/risk-register.md), default-deny startup and current loopback guards. Owner isolation is real; production human/tenant identity is not implemented.

## Permission and threat boundaries

| Principal / action | Proposed permission and server revalidation |
| --- | --- |
| Local collaboration operator | New explicit collaboration scope; same-owner session and source/target Agents, approved membership, current route eligibility, disclosure policy and expected versions for every mutation |
| Agent-originated suggestion | No execution privilege; accept only a schema-valid recommendation tied to its exact owned source attempt. A separate operator authorization approves target/input |
| City-read audience | Redacted membership/activity summaries only, existing bound-Agent scope; no delegation, provider registration, raw result or secret read |
| Interaction audience | Only newly explicit allowed collaboration routes/operations; existing capability does not automatically become an administrative integration credential |
| Integration administrator | Register/map/disable/rotate a reviewed source; references to server-side secrets only. Cannot use frontend-supplied ownership or import privileged remote roles |
| Adapter ingestion principal | Exactly one owner/provider/config generation; normalize external observations only, never native lifecycle commands |
| External dispatch principal | Additional local action permission and remote capability/credential scope; source authority immutable, no native fallback on error |

Cross-owner collaboration/mapping is denied; production cross-tenant delegation is BLOCKED until a genuine principal/tenant/delegation model is separately approved. Session membership is not a substitute for Agent or result authorization. Guessable IDs, external names, parent links and valid NPC bindings grant no access. Uniform inaccessible-object errors avoid unnecessary existence disclosure.

External config must prevent SSRF and credential forwarding: admin-provisioned exact endpoint allow-list, scheme/TLS policy, DNS/redirect checks, connection timeouts and response size limits. Local generic reference endpoints require explicit loopback allowance; do not turn that test exception into arbitrary remote URL access. No callback URL from a model/browser. File/shell/remote tool permissions are not imported.

Keep credential values server-side via the existing configuration-reference pattern; real secret resolution/rotation must be implemented and tested in T06, not falsely described as present. Environment-based local references may be sufficient for the first local fixture; do not add a vault platform merely for novelty. No key or sensitive remote payload in DTOs, logs, browser storage or event hashes returned publicly.

Push ingestion is BLOCKED until ingress fits the accepted deployment boundary: current loopback production-disabled routes cannot safely receive public callbacks. Prefer local outbound polling. If approved later, use source-specific signature/HMAC or equivalent verified auth, exact raw-body verification, bounded timestamp skew/nonce and replay receipt, key ID/rotation overlap, TLS and fail-closed source binding. Do not require signatures from a provider that does not support them; choose another authenticated transport instead.

Task/delegation input remains bounded typed data, not arbitrary tool/provider instructions. Safe output uses existing text/statistics disclosure policies; external URLs are not auto-fetched or rendered as HTML. Minimal result propagation is explicitly approved per handoff, not automatic full transcript sharing. Input/output redaction is not universal prompt-injection prevention or DLP.

## Recovery policy

| Failure | Required behavior / future evidence |
| --- | --- |
| Duplicate request / concurrent accept | Unique scoped command key/hash; transaction yields one child Task and one relation; conflicting payload rejected |
| Parent/child admission conflict | Lock/check same-owner ancestry and versions; no nested coordinator call; retain pending step for explicit later action |
| Native HTTP timeout / lost response | Preserve exact IDs/key; reconcile authoritative Task/Execution, never automatically repeat mutation |
| Native crash after admission | Existing lease/quarantine remains; session WAITING/attention with UNKNOWN child observation. No promised automatic resume or exactly-once effects |
| Cancel/completion race | Record intent; existing exact-target versioned cancellation; locked reconciliation preserves actual winner and no later child admission |
| Duplicate/reordered/missing external event | Inbox uniqueness/hash, source aggregate version where valid, gap-triggered snapshot; no client-time ordering |
| Adapter/backend restart | Restore mapping/config generation/checkpoint from PG; reconnect bounded, not redispatch work. Rotate/revalidate capabilities |
| Source/worker/broker/Redis restart | External adapter observes actual supported source behavior. Elyqreth currently has no worker/broker/Redis; do not invent local recovery tests or install them |
| Partial collaboration failure | Stop required downstream admission, preserve successes/results and safe reason; no implicit rollback of remote effects |
| Database outage | No acknowledgement before commit, no dispatch without durable authorized intent; safe unavailable response and bounded retry of reads only |
| Frontend reload/session/source switch | Existing generation/abort/journal rules; reauthorize reads, namespace caches by backend/owner/provider/session; no private payload persistence or mutation replay |

Existing event_outbox is useful for durable facts, but has no publisher. T02 may add typed collaboration facts through the existing trigger/outbox transaction. Native explicit step execution does not need a broker or background scheduler. T07 requires a durable inbox because at-least-once source delivery and snapshot replay cross a trust boundary. Optional external dispatch may require an outbox consumer, but that is a separate T06/T08 design gate with fenced claiming/backoff and remote idempotency tests. Do not turn the generic event outbox into a Task runner or claim exactly-once remote execution.

## Observability

Extend existing structured ApiLogger, request correlation, command_audit and durable event contracts. Proposed fields: owner/session/delegation IDs, parent/child/continuation Task IDs, exact source/child attempts, source/target Agent IDs, orchestrator/namespace/config generation, causation/command/submission IDs, aggregate version, safe decision/outcome/reason and observed/occurred timestamps. Preserve parent-before-attempt lock order and existing owner stream serialization.

Audit accepted/rejected delegation, admission, returned result reference, cancellation intent/outcome, mapping/config/credential lifecycle, quarantined conflicting source event and replay gap. Existing native execution facts are referenced, not emitted twice as a second lifecycle. Connection/retry telemetry can be sampled counters; never write heartbeat events per NPC/frame. No task prompts, provider credentials, raw tool args or unrestricted source error text. Proposed metrics: ingestion lag/gaps, dedupe/conflict counts, action denials, pending/unknown sessions and bounded retries; no new telemetry service required.

## Risk register and gates

| ID | Severity / impact | Mitigation / required gate |
| --- | --- | --- |
| P5-R01 | HIGH outside local scope: no production principals or delegated permissions | Retain loopback; block public/multi-tenant implementation until separately approved identity boundary |
| P5-R02 | HIGH correctness: recursive delegation exhausts coordinator capacity | T03/T04 explicit staged handoff and real coordinator tests; no active parent waiting on child |
| P5-R03 | HIGH: duplicate side effects after ambiguous dispatch | Native exact lookup/fences; external controlled dispatch BLOCKED without remote dedupe/lookup proof |
| P5-R04 | HIGH: forged events/SSRF/source confusion | T06/T07 authenticated scoped source, endpoint policy, namespace/config generation and inbox atomicity |
| P5-R05 | MEDIUM: crashed native work cannot resume | WAITING/UNKNOWN/quarantine, explicit reconciliation; durable scheduler is deferred, not a hidden dependency |
| P5-R06 | MEDIUM: no real reference target/version selected | T08 capability/security/live-fixture gate; T11/T12 cannot substitute mocks |
| P5-R07 | MEDIUM: existing event checks/native indexes insufficient for new domains | T02/T07 additive migrations, FK/namespace/backward-compatibility tests before feature writes |
| P5-R08 | MEDIUM: result disclosure, stale cross-provider/frontend state | Minimal approved propagation, safe rendering, strict cache namespace and generation tests |
| P5-R09 | MEDIUM: polling/graph/history growth | Proposed fixed recipe bounds, capped pagination/ingestion/retention, targeted projection and measured T11 load |
| P5-R10 | LOW: no supplied Git metadata/hosted CI/manual AT proof | Hash preservation for T01, owner Git/CI review and real T11 accessibility/E2E evidence later |

Open decisions: T03 final numeric bounds/disclosure consent and cancellation aggregation; T06 exact server credential/capability DTO; T07 schema names/retention and external-attempt vs observation representation; T08 real target/version/available credentials. These block affected implementation/acceptance, not documentation completion. No risk is marked fixed merely by documenting it.
