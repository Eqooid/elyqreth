# Versioned agent activity events

Status: **T01 historical proposal**. [T07 Event Contracts & Audit History](event-audit-foundation.md) documents the implemented v1 contracts and read APIs. Transport, external observations, richer event vocabulary and NPC synchronization below remain **FUTURE**. City onChange callbacks, activity counters, text logs and visual packets remain local simulation mechanisms.

## Envelope and semantics

Example schema v1 (optional fields omitted when unrelated):

```json
{
  "eventId": "a2314c57-83fb-4b5c-aecd-7a8e620b8209",
  "eventType": "execution.started",
  "schemaVersion": 1,
  "occurredAt": "2026-10-20T13:00:00.000Z",
  "recordedAt": "2026-10-20T13:00:00.010Z",
  "ownerId": "owner-scope",
  "agentId": "agent-uuid",
  "taskId": "task-uuid",
  "executionId": "execution-uuid",
  "orchestratorId": "native-orchestrator-uuid",
  "correlationId": "request-or-workflow-uuid",
  "causationId": "command-or-event-uuid",
  "aggregateType": "execution",
  "aggregateId": "execution-uuid",
  "aggregateVersion": 2,
  "aggregateSequence": 2,
  "streamPosition": "1042",
  "source": "elyqreth.native",
  "payload": {"status": "RUNNING", "attempt": 1}
}
```

Examples use illustrative identity values except eventId. IDs are UUIDs in real contracts; streamPosition is a decimal string to avoid browser integer precision loss. Timestamps are UTC RFC3339; external occurredAt may differ from recordedAt and must not determine ordering. schemaVersion versions the specific event payload/envelope compatibility, not the API endpoint version. Keep event types stable, use additive optional fields for compatible change, introduce new schema versions for breaking meaning.

| Event / phase | Meaning and minimum payload |
| --- | --- |
| agent.registered / Phase 1 | Durable registry creation; name/type/lifecycle/version, safe capability summary |
| agent.updated / Phase 1 | Approved configuration/lifecycle changes; changed field names and version, no secret configuration values |
| agent.unregistered / Phase 1 | Logical archival/deactivation from registry, history retained; lifecycleStatus=ARCHIVED/reason. Ordinary disable uses updated |
| task.created / Phase 1 | Durable accepted request; task status and routing IDs, not full sensitive input |
| task.queued / Phase 1 | Eligible/retry-scheduled work; attempt ID, reason and nextEligibleAt |
| task.started / Phase 1 | Task transitions QUEUED → RUNNING for an attempt; may repeat across retries with increasing task version |
| task.completed / Phase 1 | Task terminal COMPLETED with successful execution/result reference |
| task.failed / Phase 1 | Terminal task failure only, after retries exhausted or prohibited; safe error |
| task.cancel_requested / Phase 1 | Durable command accepted, not confirmation of stop |
| task.cancelled / Phase 1 | Confirmed terminal cancellation with reason |
| execution.started / Phase 1 | Current attempt actually running; status/attempt |
| execution.completed / Phase 1 | Attempt SUCCEEDED; result reference and safe summary, not raw result stream |
| execution.failed / Phase 1 | Attempt FAILED; error code/retryability; may queue another attempt without task.failed |
| execution.cancelled / Phase 1 | Attempt cancellation confirmed, including cancellation before start |
| execution.timed_out / Phase 1 | Confirmed terminal timeout; error/deadline. Not emitted merely for stale heartbeat |
| execution.progress / FUTURE optional | Transient bounded progress/phase/usage hints, scoped to current execution; no terminal authority |
| agent.handoff / FUTURE | Actual accepted transfer between logical participants with from/to IDs and artifact references; not simulated walking/packets |
| orchestrator.connected/disconnected / FUTURE external observation | Connectivity changed with lastObservedAt/reason; not execution success/failure |

Do not emit all candidate events simply for coverage. Native bootstrap may record registry/health facts without pretending to open an external connection. `execution.completed` intentionally maps to SUCCEEDED; `task.completed` maps to COMPLETED. Result/error fields are referenced rather than copied to every event. Handoff is unnecessary for Phase 1's single-agent tasks.

## Persistence and ordering

State transition, lifecycle journal record and delivery outbox insertion commit in the same PostgreSQL transaction. T03 defines storage; T04–T06 append internal lifecycle records; T07 supplies versioned public mapping/replay without retroactively fabricating missing history. Failed transactions emit nothing. Append-only records have constrained privileged retention/redaction procedures; no general update/delete API.

Allocate monotonically increasing per-aggregate sequence under the same row lock as the state update. eventId deduplicates delivery; `(source,sourceEventId)` deduplicates external observations. Aggregate version guards stale writes/projections. There is no global causal order between independent tasks or agents, and occurredAt is never an ordering key.

For resumable owner streams, assign `streamPosition` while holding an owner-stream counter lock through transaction commit. This yields committed ordering for that scope at initial scale. A raw sequence/serial allocated before commit can skip over an uncommitted transaction and lose replay events; do not use it as a supposedly gap-free commit cursor. Scoped ordering may limit throughput; a committed-log dispatcher can replace it later. Cross-owner streams never share client cursors or records.

Outbox delivery is at least once. Publish after commit, retry with bounded delay, keep event ID, and mark published only after delivery handoff. A crash after send/before mark may duplicate; consumers must deduplicate. Acknowledging transport delivery is not evidence the user saw a message. In-process notification accelerates delivery, but a periodic outbox scan recovers missed wakeups.

Progress updates need not be persistent by default: coalesce/drop under pressure, carry execution identity and increasing per-execution progress sequence, and keep latest snapshot if useful. Lifecycle/approval/tool-side-effect audit cannot be silently dropped. Unknown schemas are skipped safely with resync/diagnostics, not applied to status.

## HTTP/WebSocket delivery and resynchronization

Use authenticated, owner-filtered channels, bounded frame/buffer sizes, origin validation, heartbeats and disconnect on sustained slow consumption. T07 may implement a backend gateway and replay endpoint; actual city wiring remains FUTURE. Native browser WebSocket transport compatibility must be tested; Socket.IO clients cannot be assumed.

On connection, request an authorized consistent snapshot plus its owner-stream high-water cursor in one DB snapshot transaction. Subscribe/replay all retained durable events after that cursor, then switch to live delivery with overlap deduplication so no event is lost between replay and subscription. Alternatively open/buffer first, fetch snapshot, then apply newer buffered records. Client keeps last applied cursor/version, deduplicates event IDs and resynchronizes on sequence gaps or unknown binding state.

After reconnect, resume from cursor with bounded pages; if retention expired, return `RESYNC_REQUIRED` and fetch a new snapshot. A gateway restart or broker outage does not discard DB truth. Use HTTP polling/snapshot fallback when WebSocket is unavailable; show freshness/connection status without freezing city simulation. Replay displays current state/history, not every old animation again.

Payload schemas allowlist safe fields, enforce size limits and omit prompts, credentials, sensitive tool arguments, stack traces and result bodies. Event authorization equals resource authorization, including replay. Persist normalized source facts separately from public redacted DTOs if operational diagnosis needs more restricted evidence.

## Broker migration

Keep the same committed journal/outbox and event IDs. A FUTURE relay publishes to RabbitMQ with confirmation, durable routing and retry/dead-letter policy. Worker/gateway consumers use inbox/event-ID deduplication. Broker envelopes carry contract version and correlation; database state remains authoritative, broker acknowledgements do not replace task transactions. Redis becomes optional for measured multi-instance transient fanout, never the sole lifecycle history.

## T07 implemented contract checkpoint

[Event Contracts & Audit History](event-audit-foundation.md) is the current v1 event/read contract. Existing names agent.active/agent.archived/execution.completed are retained; no unregistered/deactivated/progress/handoff/connectivity event is emitted without an actual implemented operation. Cancellation/timeout facts represent T06 persisted decisions, not confirmed process termination. New writes are schema-validated and atomic with state; unknown/invalid historical payloads are redacted without rewriting stored evidence. Read-only cursor/offset history exists; WebSocket/SSE, RabbitMQ relay, external ingestion, replay execution and NPC projection remain future work despite the earlier optional gateway proposal above.
