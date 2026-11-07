# Proposed API and frontend integration

**Final Phase 5 status (2026-10-29): ACCEPTED for the approved local scope; T01-T12 complete.** See [canonical acceptance, current contracts and limitations](acceptance.md). Task-date proposals, checkpoints, counts and future-task statements below are historical, not additional implemented capabilities or current roadmap status.

**T10 checkpoint (2026-10-29):** Frontend collaboration inspection and the distinct local collaboration-read audience are implemented; see [actual architecture, contracts, security and test evidence](frontend-collaboration.md). Historical proposed contracts below are task-date planning, not additional implemented endpoints. T11/T12 remain planned.

**T09 checkpoint (2026-10-28):** [Collaboration activity projection](collaboration-activity.md) provides operator-authorized version-2 snapshots, bounded relationships/history, explicit native/external provenance and native event cursor hints. It composes existing Phase 3 SQL/mapper and T07 observations without provider calls or lifecycle writes. V1 city routes remain unchanged; T10-T12 remain planned. Earlier snapshots below are historical.


**T07 checkpoint (2026-10-28):** [External mappings and ingestion](external-ingestion.md) implement durable source incarnations, explicit identity approval, authenticated internal receipt, conservative ordered observation and bounded replay. External data never mutates native work. Real providers/public webhooks/polling and activity/UI integration remain deferred. Earlier task/planning snapshots below are historical.


**T06 checkpoint (2026-10-28):** [External adapter foundation](adapter-foundation.md) implements provider-neutral contracts, capability/ownership gates, trusted configuration and bounded transport with an empty production registry. No real provider, external persistence/ingestion or dispatch is implemented. Earlier planning/task snapshots below are historical.


**T05 checkpoint (2026-10-27):** [Lifecycle and recovery](lifecycle-recovery.md) adds bounded operator reconciliation, durable cancellation intents, conservative aggregate state and explicit recovery of never-admitted children. Native uncertain outcomes remain quarantined; no worker, scheduler, terminal reset or external integration is introduced. Earlier task checkpoints below are historical.


**T04 checkpoint (2026-10-27):** [Native coordination](native-coordination.md) implements explicit operator activation, one correlated child through the existing Runtime Coordinator, canonical result-reference return and conservative interruption safety. No parent continuation, scheduler, external integration or collaboration UI is added. Earlier task-scoped planning statements below are historical.


**T03 checkpoint (2026-10-27):** [Native delegation request/read APIs](native-delegation-api.md) are implemented for the existing local operator. Broader planning and T01/T02 records below are historical/task-scoped; acceptance, child execution, external integrations and collaboration UI remain deferred.

**PROPOSED route concepts, not working endpoints.** Actual Phase 4 routes remain described in [interaction API](../phase-4/interaction-api.md). All proposed paths follow `/api/v1`; T03/T06/T09 must verify collisions and update exact-route guards/typed DTOs deliberately. No OpenAPI generator is currently established.

## Common wire rules

Server assigns owner, IDs and authoritative status. Strict validated DTOs reject unsupported fields. UUID internal IDs; opaque bounded source IDs; common safe metadata maximum 16KiB, instructions/results retain existing contract limits. New mutation envelope has commandId, idempotencyKey, correlationId and payload; expected resource version uses existing quoted `If-Match`. These are new collaboration contracts, not changes to existing Task requests. Dedupe is caller/owner + operation + key with payload conflict detection and durable original references.

Proposed error semantics: 400 validation, 401 invalid authentication, 403 denied operation, 404 inaccessible/missing object per existing disclosure conventions, 409 version/eligibility/idempotency conflict, 429 bounded admission/rate budget if implemented, 503 source/persistence unavailable; unsupported capability is a stable code with a documented rejection, not HTTP success. Safe codes/reasons only; no source stack/credential. Mutation acknowledgement distinguishes accepted intent, confirmed outcome and unresolved outcome.

All lists use stable opaque keyset cursor bound to owner/filter/source generation; deterministic `(createdAt,id)` order, default10/max20. No unlimited graph/event/result expansion. Safe detail responses contain explicit references and pagination links, not ORM entities or repeated prompts/results.

| Proposed method / route | Purpose, request -> response DTO concept | Authorization / idempotency / pagination |
| --- | --- | --- |
| POST `/collaborations` | `CreateCollaboration {participantAgentIds,rootTaskId,policy}` + envelope -> `CollaborationDetail` | Collaboration operator; same owner/current eligible participants and root; command-key replay |
| GET `/collaborations` | Query filter/cursor -> `CollaborationPage` | Authorized owned scope only; bounded keyset |
| GET `/collaborations/:sessionId` | Exact ID -> safe `CollaborationDetail` status/version/attention/refs | Session and related object access; no hidden result expansion |
| GET `/collaborations/:sessionId/participants` | Cursor -> `ParticipantPage` | Same-owner session; current disclosure; max20 |
| POST `/collaborations/:sessionId/delegations` | `RequestDelegation {sourceTaskId,sourceExecutionId,targetAgentId,instruction,deadlineAt}` -> `DelegationDetail` | Source and target permission, terminal source, bounded ancestry; key/version checked |
| POST `/collaborations/:sessionId/delegations/:id/decision` | `Decision {accept,reason?}` -> delegation and optional childTaskId | Explicit operator approval; transactionally unique child; key/version checked |
| POST `/collaborations/:sessionId/delegations/:id/execute` | Exact accepted relation/child version -> child Task/Execution refs or unresolved acknowledgement | Existing native admission, explicit step; no recursive execution; no blind retry |
| POST `/collaborations/:sessionId/delegations/:id/return` | Exact child result ref and approved continuation input -> safe return/continuation refs | Result authorization/disclosure; explicit command key, no automatic transcript sharing |
| GET `/collaborations/:sessionId/delegations` | Cursor -> `DelegationPage` including bounded parent/child refs | Same-owner membership/Agent disclosure; also provides handoff history without a duplicate route |
| GET `/collaborations/:sessionId/events` | Cursor -> safe `CollaborationEventPage` | Explicit audit-read subset; no raw prompts/provider events |
| POST `/collaborations/:sessionId/cancel` | Expected version + command -> intent/current aggregate with pending children | Authorized session cancel and each target permission, capability checks; no fabricated terminal acknowledgement |
| GET `/collaboration-commands/lookup` | Exact scoped operation/key -> `CommandRecovery {reference|null,outcome}` | Original caller/owner/operation access revalidated; no history scan; no raw key in telemetry |
| POST `/orchestrators` | Safe type/name/configurationReference -> safe registration | Integration administrator only; reuse existing registry/schema, no existing controller of this name assumed; never body credentials |
| GET `/orchestrators/:id/capabilities` | ID -> effective capability/config generation snapshot | Authorized source read, redacted constraints; stale disables commands |
| GET `/orchestrators/:id/health` | ID -> bounded last-observed connection health | Safe authorized cache; not live provider probe on every NPC request |
| POST `/orchestrators/:id/agent-mappings` | Namespace/sourceAgentId and explicit EXTERNAL Agent -> safe mapping | Administrator, same owner, one source namespace, key/version constraints |
| GET `/orchestrators/:id/agent-mappings` | Cursor -> safe mapping page | Source/Agent read permissions, bounded discovery candidates separate from approved mappings |
| POST `/orchestrators/:id/disconnect` | Version + command -> disabled/health acknowledgement | Administrator; revoke admission, generation fence, preserve history |

Progress/completion/failure are internal service/adapter inputs, not general browser status PATCH endpoints. External push route is intentionally **not** part of the MVP: T06 must justify authenticated ingress before proposing one. Optional external dispatch/cancel routes require separate capability/idempotency proof; native `/tasks/:id/execute` cannot dispatch EXTERNAL work as a fallback.

## Frontend composition

Extend existing vanilla inspector/Residents selection, `agent-task-panel.js`, shared `http-transport.js`, typed runtime/interaction clients and page-owned Session conventions. Proposed narrowly scoped CollaborationOwner manages selected session/delegation, bounded pages and pending commands; it does not own native lifecycle or another global cache library. Backend collaboration snapshots are authoritative; frontend-only open section/confirmation/draft/action state is separate.

Cache/request identity includes backend origin, authorized identity generation, Agent, session, source generation and exact execution authority/reference. Abort obsolete reads and generation-fence late callbacks. Changing Agent resets historical relationship selection; changing session/source or logout clears private views. Native pending actions remain tied to original IDs. Before new collaboration controls, require a single reviewed backend origin and test read/interaction origin consistency rather than extending the existing manual-configuration risk to external sources.

Reuse the Phase 3 shared scheduler and scoped notifications for status; T09/T10 versioned collaboration summaries trigger bounded selected-detail invalidation. No per-participant/per-row result requests, new browser SSE/WebSocket, per-NPC loop or frame-time network calls. Terminal details stop refreshing unless version invalidation or explicit user refresh requires it. History and result content stay lazily fetched and bounded; no whole graph reconstruction per animation frame.

UI shows ownership badge (native/external), observation-only restriction, connection/freshness, participant roles, safe handoff reason, parent/child/continuation links and aggregate status. Preserve existing Task form, cancellation confirmation/results/history and decorative NPC behavior. Keyboard entry through Residents, labels/status text beyond color, focus restoration, reduced motion, bounded long-text scrolling and responsive layout follow Phase 4 patterns. No graph canvas or new sprite effects required.
