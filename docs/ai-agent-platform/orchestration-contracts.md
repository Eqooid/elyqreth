# Orchestrator-independent contracts

**T06 checkpoint (2026-10-28):** [Implemented external adapter contracts](phase-5/adapter-foundation.md) supersede the external foundation sketches below. Real provider integration and event ingestion remain planned; these older sketches are historical.


Status: **PLANNED** minimal native port; external adapters **FUTURE**. Existing City Hall methods remain simulated and are not this port. No framework integration is claimed for LangGraph, CrewAI, AutoGen, OpenAI Agents SDK, Hermes Agent or any other runtime.

## Capability negotiation

Register an orchestrator descriptor with stable id, adapter type/version, contract version, config reference, health/freshness and supported operations. Capabilities reflect both adapter implementation and configured remote endpoint/permissions. Recheck before accepting a task; snapshot negotiated descriptor/version into its attempt.

```typescript
// Design sketch only; DTO schemas and tests are required in implementation.
type CapabilitySet = {
  discovery: 'none' | 'read';
  registration: 'none' | 'write';
  submission: 'none' | 'direct' | 'delegate';
  status: boolean;
  results: 'none' | 'inline' | 'reference';
  cancellation: 'none' | 'best_effort' | 'confirmed';
  events: 'none' | 'poll' | 'push';
  multiAgent: boolean;
  idempotentSubmission: boolean;
  lookupBySubmissionKey: boolean;
  progress: boolean;
};
type AdapterReply<T> =
  | {ok: true; value: T}
  | {ok: false; error: {
      code: string; message: string; retryable: boolean;
      outcome: 'REJECTED' | 'UNKNOWN'; details?: Record<string, unknown>
    }};
```

Core interface operations receive owner context (not browser credentials), correlation ID, deadline and abort signal. Only `describe` and safe health reporting are universally required; optional operations are gated by capabilities and return explicit unsupported errors if called. Monitoring-only registration may have no submit/cancel/result capability.

| Operation | Input | Normalized output / requirement |
| --- | --- | --- |
| describe | configured adapter context | orchestrator identity, contract version, capabilities, constraints/input schemas |
| discoverAgents | paginated cursor/filter | external agent descriptors with namespaced IDs; read capability required |
| registerAgent | logical agent snapshot + registration key | external mapping; write capability required; many runtimes cannot register dynamically |
| submit | taskId, executionId, agent/config snapshot, immutable input, submissionKey, deadline | accepted external execution reference or bounded inline completion; exactly one authority chosen |
| getStatus | execution reference | normalized status, source version/sequence if any, observedAt, freshness and safe raw status label |
| cancel | execution reference + commandId/reason | `REQUESTED`, `CONFIRMED`, `ALREADY_TERMINAL` or explicit unsupported; request is not confirmation |
| readEvents / acceptPush | cursor or authenticated callback | normalized observations with sourceEventId/version; push signature/ownership validation required |
| getResult | execution reference | pending, authorized result/reference, or explicit unavailable/redacted error |
| health | deadline | connected/degraded/disconnected/unknown with observation time; not task failure |

Errors include `UNSUPPORTED_OPERATION`, `UNSUPPORTED_CAPABILITY`, `INVALID_INPUT`, `UNAVAILABLE`, `AUTH_FAILED`, `RATE_LIMITED`, `REMOTE_FAILED`, `DEADLINE_EXCEEDED`, `AMBIGUOUS_SUBMISSION`. Unsupported operations never succeed as no-ops and never return invented results. An incompatible task is rejected before durable dispatch, with an actionable safe error. Optional methods cannot be inferred from framework marketing names.

| Orchestrator class | Submission/authority | Observation and coordination |
| --- | --- | --- |
| Native Phase 1 | Direct allowlisted rule handler, Elyqreth controls claim/attempt | Local durable status, cooperative cancel and lifecycle events; no multi-agent engine needed |
| External direct executor | Remote owns run; Elyqreth records mapping | Push or polling; cancel/result availability independently advertised |
| External delegator | Remote submits to its own runtimes; same single external authority | Expose child observations as related metadata/steps later, not duplicate native attempts |
| Multi-agent coordinator | Remote owns graph/participant scheduling | Advertise coordination; preserve remote graph IDs without requiring graph schema in core |
| Monitoring-only | No submit; attach authorized existing external run through future import command | Read-only status/events; Elyqreth must not claim it created or can cancel work |
| Poll-only | No event stream | Bounded reconciliation polling produces normalized change events; no synthetic per-poll duplicates |

## Authority and duplicate prevention

Elyqreth owns agent registration, task request/owner/input, selected orchestrator, policy, command history and persisted normalized view. Native runtime owns execution facts under control-plane transitions. External runtime owns actual remote run status/result; Elyqreth's task status is a versioned projection of accepted external observations, not a second scheduler.

Persist attempt + immutable submission key before external I/O. Persist acceptance mapping when returned. If the request times out after remote acceptance, do not create another attempt or route to native automatically. Mark reconciliation pending; query by submission key or safely retry the same key only when advertised idempotent. If neither is possible, quarantine for operator reconciliation. Preserve remote correlation ID/error without secrets. No exactly-once guarantee is assumed.

Reject stale or contradictory observations after a committed terminal state; record diagnostic evidence and reconcile authoritative snapshot. For push, authenticate signature, replay window and source-event identity; for polling, use bounded exponential backoff/jitter and change detection. Disconnection means observation is stale, not FAILED or CANCELLED. Do not call remote execution while holding DB locks.

Normalize external queued/accepted work to a PENDING execution and QUEUED task; confirmed running to RUNNING; success to SUCCEEDED execution/COMPLETED task only once the success/result policy is met; terminal remote error to FAILED attempt followed by task retry/failure policy. A remote cancellation request is not CANCELLED. Unrecognized remote states retain the last confirmed status with stale/reconciliation metadata; they do not become fabricated failures. If a remote run succeeds but result retrieval is temporarily unavailable, retain the confirmed execution fact and mark result availability separately rather than retrying the work. Adapter tests must document each raw-to-normalized mapping.

Cancellation is pending until remote confirmation; unsupported cancellation remains explicit and does not stop monitoring. If completion wins before confirmation, task completes. Deadline expiry on a remote run is an unresolved termination request until termination/status is confirmed; avoid retry while an external side effect may continue. A forced operator resolution must be audited and must not silently authorize a second run.

Phase 1 implements only native descriptor/port routing and tests for unsupported operations. External registration/discovery UX, webhooks, SDKs, polling integrations, imports and coordination are FUTURE. Each future adapter needs capability matrix, conformance tests, credentials/permissions review and failure-injection tests before enabling submission.
