# Phase 4 notes - unreleased local-development checkpoint

Acceptance review date: 2026-10-27, Asia/Bangkok. These are implementation notes, not a release announcement. No version, tag, publication or deployment is created. See [acceptance](acceptance.md), [operation](operations.md) and the [final risks](risk-register.md).

## Delivered behavior

- Existing Agent-linked resident inspection supports validated instruction-only Task creation and a separate explicit Start action.
- Existing backend Agent Registry, Task/Execution persistence, Runtime Coordinator, provider/tool policy, cancellation and audit remain authoritative.
- Contextual lifecycle controls provide safe confirmation and version-fenced cancellation, pending-action feedback and authoritative race reconciliation.
- Safe text/numeric-statistics results and bounded Agent history are available inside the same inspector. Historical selection never changes live NPC status.
- Shared Phase 3 polling continues to drive status markers and activity inspection. Interaction details have scoped read lifetimes, stable identities and no second activity poller.
- Unknown mutations retain their original keys/references. A bounded identifiers-only per-tab journal supports lookup after reload and explicit reauthorization; private drafts/results/credentials are not persisted.
- Local capability, ownership, binding, validation, disclosure and session boundaries have actual HTTP/browser/SQL verification. Keyboard/AX/focus, responsive/motion and bounded resource checks are recorded.

## Stabilization included

T09 corrected Vite's frontend root when commands run from the API workspace and preserved confirmed Task references across transient eligibility-read failures. T10 adds an atomic enabled-control click in the reliability harness to avoid a readiness-to-click race; exact mutation counts remain asserted. T10 also corrects confirmed cancellation focus loss by returning to a stable Task heading while action controls are disabled, with a native regression assertion.

## Compatibility and limitations

Existing operator APIs, city-read audience, database/lifecycle records, NPC entities, movement, camera, sprites and Icy White (#F2F9FF) appearance are preserved. Phase 4's prior T02 history index remains the only Phase 4 migration; T10 adds no migration or runtime endpoint. No dependency, package identity or version is changed by T10.

The accepted target is trusted, loopback local development/test. The default Docker stack keeps protected runtime capabilities disabled; this does not provide a container/public runtime authorization mode. There is no production user/tenant login, autonomous crash repair, detached execution guarantee, orchestration, Agent delegation, memory or RAG. Synchronous request loss/cancellation and provider billing/termination retain existing semantics. Remote CI, manual screen-reader certification, long-duration leak/capacity claims and fresh live paid-provider behavior are not asserted.

Phase 5 remains **PLANNED**. Registry/runtime/contracts, mapping, observation and audit provide a basis for a separate architecture exercise, subject to the [identified prerequisites](acceptance.md#phase-5-readiness).
