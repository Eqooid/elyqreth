# Phase 4 Task and Execution API plan

**Current T10 reference:** [Final acceptance](acceptance.md), [current operation](operations.md) and [risks](risk-register.md) describe the completed Phase 4 local implementation. The original planning/task-date statements below remain historical scope/evidence and do not mark current UI/recovery work as missing.

Status: **T01 design record**, audited on 2026-10-25. T02 implements the backend gaps: see [actual API contracts and verification](interaction-api.md). The [T03 data client](frontend-interaction-client.md) is implemented; UI/owner proposals remain planned. Actual references clarify blank text and operation-specific 403 handling without backend changes. See [security](security-reliability.md) before making any route available to a browser.

## Existing routes to reuse

All paths start at the configured loopback API origin. UUID route identifiers and unknown-field rejection follow existing guards/DTOs; none is inferred from an NPC display name. No automatic background execution is implied.

| Operation | Actual method/path | Request | Existing response/behavior |
| --- | --- | --- | --- |
| Agent identity | GET `/api/v1/agents/:id` | None | Safe Agent DTO: id/name/description/type/orchestratorId/lifecycleStatus/capabilities/version/timestamps; no configuration secrets |
| Create intent | POST `/api/v1/tasks` | `{agentId,input:{instruction,context?},idempotencyKey?}` | 201 newly created or 200 matching replay; safe Task DTO, status normally CREATED |
| Task lookup | GET `/api/v1/tasks/:id` | None | Safe Task DTO with status/version; no input echo |
| Task list | GET `/api/v1/tasks` | `agentId`, limit/offset and supported filters | `{items,pagination:{limit,offset,hasMore}}`; createdAt/id ascending; limit 1-100, offset 0-10000 |
| Task status | GET `/api/v1/tasks/:taskId/status` | None | Safe Task DTO plus nullable latestExecutionId; requires runtime enabled |
| Start | POST `/api/v1/tasks/:taskId/execute` | JSON `{}`, `If-Match: "TASK_VERSION"` | Synchronous 200 `{kind:'finished',task,execution,correlationId,result}` on success; safe HTTP error on other outcomes |
| Execution list | GET `/api/v1/tasks/:taskId/executions` | limit/offset | Safe execution summaries, attemptNumber/id ascending; same pagination shape/limits |
| Execution detail | GET `/api/v1/tasks/:taskId/executions/:executionId` | None | Safe Execution DTO, including status/version, attempt, timestamps, durationMs, generic error and resultAvailability |
| Cancel native execution | POST `/api/v1/tasks/:taskId/executions/:executionId/cancel` | `{taskVersion}`, `If-Match: "EXECUTION_VERSION"` | 200 lifecycle pair if committed/idempotently observed according to lifecycle policy; conflicts otherwise |
| Result | GET `/api/v1/tasks/:taskId/executions/:executionId/result` | None | `{execution,availability:'PENDING'|'AVAILABLE'|'UNAVAILABLE',result:null|RuntimeExecutionResult}` |
| Operator audit | GET `/api/v1/agents/:id/events`, `/tasks/:id/events`, `/executions/:id/events` | Existing bounded event queries | Existing durable event envelopes; remain operator-only in Phase 4 MVP |
| NPC observation | GET `/api/v1/cities/elyqreth/agents`, `/api/v1/cities/elyqreth/agents/:agentId/activity` | Existing limit/after/ids | Separate city-read credential, validated minimal activity. Keep unchanged. |

Task DTO: `id,agentId,orchestratorId,status,version,createdAt,updatedAt,completedAt`. Execution DTO: `id,taskId,agentId,orchestratorId,attemptNumber,status,version,startedAt,finishedAt,createdAt,updatedAt,errorCode,errorMessage,resultAvailability,strategyId,correlationId,durationMs`. Do not invent Task title, provider duration, token streaming or hidden input fields. A locally entered summary can be labelled “your draft,” never a persisted backend title.

## Input, idempotency and submission

The instruction is nonempty after whitespace checking but its original text is analyzed unchanged. Each instruction/context is at most **16,000 JavaScript string units**, optional context is a string, and serialized input is at most **32,768 UTF-8 bytes**. Existing validation rejects disallowed control characters and common credential/private-key patterns; this is defense in depth, not general DLP. The HTTP parser also caps bodies at 64 KiB. Frontend duplicates user-facing limits but backend remains authoritative. Do not silently trim/change the payload after the idempotency key is assigned.

Create examples use placeholder UUIDs and an opaque random per-intent key, not a prompt hash:

```json
{
  "agentId": "11111111-1111-4111-8111-111111111111",
  "input": {"instruction": "Count the words in this sentence."},
  "idempotencyKey": "city.opaque-random-intent-id"
}
```

`idempotencyKey` is a **body field**, 1-128 characters matching `[A-Za-z0-9._:-]`. TasksService serializes equal owner/key requests, compares a canonical Agent/input request hash and enforces DB uniqueness. Same key and exact logical payload returns the existing Task, even if it is now terminal; different payload gives 409. Keys are owner-scoped, not Agent-scoped. The UI disables repeated Create while pending and keeps the same frozen intent on retry/reconciliation. An edited/new intent gets a new key only after the user resolves or explicitly abandons uncertainty; do not silently create a replacement Task.

Create and Start are separate requests/commits. Never report a created Task as already executing. Start uses the returned/fresh authoritative Task version, empty JSON object and quoted If-Match, not a body version or Agent version. There is no execution-creation HTTP endpoint and no public queue endpoint. The coordinator queues/claims internally. Start is not an idempotent replay operation; version/claim fences protect persistence but do not justify automatic POST retries.

## Synchronous execution and cancellation

Keep Start's request alive across inspector close and NPC selection changes. Give the **execute operation only** a bounded client deadline of 35 seconds, exceeding the existing 30-second HTTP execution budget plus response overhead. Never inherit the activity client's 5-second timeout. Server/platform/Task deadlines can end it earlier. A client timeout/abort may cause backend cancellation; it is not proof that work never began. No 202/fire-and-forget mechanism is planned.

Cancellation obtains Task and Execution versions from authorized current detail. Enable only for a trusted native PENDING/RUNNING attempt with eligible Task state; reject unsupported/external/unknown origin on the server. `cancellationPending` is request/UI state, not a backend enum. On 200 refresh pair/status/result/activity; on 409 refetch and show whichever terminal state committed. Duplicate cancellation must not emit duplicate events; do not assume every stale-version request returns 200. A completed execution remains completed. Running cancellation may remain quarantined as CANCELLATION_UNCONFIRMED and block new native work; the UI cannot clear quarantine.

The actual cancel path is RuntimeApiService -> TaskLifecycleService -> PostgreSQL, followed by coordinator heartbeat/finalization observation. Do not diagram a new direct cancellation engine or a coordinator method that does not exist.

## Results and safe failure display

Successful results have `schemaVersion:1`, executionId and either:

- `{output:{type:'text.statistics.v1',data:{codePointCount,wordCount,nonemptyLineCount}}}`; render a labelled numeric definition list.
- `{output:{type:'text',text:'...'}}`; render plain text using textContent/escaped nodes, never HTML/Markdown/link auto-execution.

Optional validated provider metadata, usage and tool invocation count are not required to render. The interaction DTO should omit internal provider profile ID/version and expose only reviewed provider/model display fields if explicitly enabled. Never forward provider SDK objects, prompts, tool arguments/results, stack traces or raw errors. A validated text result can still contain user/model-sensitive content: schema checking is not a secrecy guarantee. Require explicit server opt-in to reveal LLM text to the interaction audience; otherwise mark the **interaction display** unavailable without changing persisted resultAvailability. Rule-based structured results are the default MVP/E2E path.

PENDING means no final result yet. UNAVAILABLE with FAILED/CANCELLED/TIMED_OUT shows the actual terminal status and fixed safe summary. SUCCEEDED with empty text is still successful empty output if validated; a missing/corrupt expected persisted result yields safe uncertainty rather than fabricated success. Unknown result type shows unsupported format, no raw JSON fallback. Bound each response to 128 KiB at transport and the authorized result body to the existing at-most-64 KiB persistence limit; text preview 8,000 characters, explicit bounded expansion up to the authorized limit.

## Minimal T02 compatibility work - proposed, not implemented

1. **Narrow interaction access on selected existing routes.** Add a distinct optional local interaction credential and request-scoped audience/owner/Agent authorization; preserve operator behavior and city-read denial. Reuse `assertLocalRequest`, services, serializers and transactions. Exact route/method allowlist, active PASSIVE binding/manifest, server Agent allowlist and owned Task/Execution joins are checked before any read/replay/write. Registry mutations, arbitrary task enumeration, audit endpoints and bindings stay denied. Existing `GET /agents/:id` may use a smaller interaction DTO; add no Agent-management permission.
2. **Exact uncertain-create reconciliation.** Propose GET `/api/v1/tasks/lookup?agentId=UUID&idempotencyKey=KEY`, before dynamic `:id`, returning `{task:TaskView|null}` after full Agent/owner authorization. Reuse the existing owner/key indexed lookup, additionally bind Agent ID, return no prompt/hash/key in payload, apply no-store and sanitized query logging. This avoids resending private input after reload. No such endpoint exists today. A colliding inaccessible key must not disclose foreign resource existence. No new table is needed.
3. **Bounded Agent-wide history.** Propose GET `/api/v1/agents/:agentId/executions?limit=10&before=CURSOR`, returning `{items:ExecutionView[],pagination:{limit,nextCursor}}`. Default 10, max 20. Keyset order `(created_at DESC,id DESC)` uses an opaque versioned boundary retaining PostgreSQL timestamp precision, not JS-millisecond rounding. Validate cursor length/shape/scope; parameterize SQL and enforce owner/Agent access independently of cursor. One joined bounded query, no Task-by-Task HTTP fan-out. Existing per-Task ascending/offset routes remain compatible. Concurrent inserts may appear only after refreshing the newest page; this is not a whole-history snapshot. Add an index only if actual EXPLAIN/query evidence justifies it.
4. **Safe result disclosure and errors.** Audience-aware result/execute response projection must apply the same server disclosure policy to both synchronous execute and later result reads. Keep operator contract unchanged. Interaction failures use stable codes/fixed messages, with current generic 409 treated as “refresh required,” not guessed capacity/ownership details. CORS already admits Authorization/If-Match/X-Request-Id; no wildcard/cookie relaxation is required.
5. **Interaction-only action hints.** Existing Execution DTOs do not expose authority/trusted-snapshot eligibility, and IDLE is not a capacity grant. Add a minimal interaction-only `actionEligibility` view to authorized Task/Execution detail, with `canRequestStart`/`canRequestCancel` and a closed generic reason (`INVALID_STATE`, `NOT_SUPPORTED`, `UNAVAILABLE`, `REQUIRES_REFRESH`) where appropriate. Compute from actual owned records, allowed native snapshot/runtime binding and current versions; no external capability from frontend metadata. These hints are observations, not reservations or permission tokens. The mutation still reauthorizes/revalidates under existing transaction locks. Do not invent guaranteed slot availability or expose lease tokens, quarantine internals or arbitrary denial diagnostics.

These are compatibility/security changes assigned to T02, not an alternate engine or new data store. Resolve route precedence and operator/city regression tests before T03. An optional future production identity model is not implemented by static local delegation.

## Client and error plan

Extend the runtime integration module family with a separate typed **InteractionApiClient**; do not add POST or operator fallback to the fixed GET-only RuntimeApiClient. Extract/reuse only neutral origin validation, bounded JSON reading, abort/listener cleanup and fixed error normalization where tests preserve the city client's existing audience. Shared transport receives explicit method/route/deadline, never a caller-supplied arbitrary URL. Credentials stay private and separate.

Suggested operations: createTask, findTaskByIntent, getTask, executeTask, getExecution, cancelExecution, getResult, listAgentExecutions. Validate UUID relationships in responses (`agentId`, `taskId`, `executionId` must match the operation); unknown status is non-actionable, never RUNNING/success by default. Use current JS/JSDoc/`.d.ts` and strict runtime normalization, not a second DTO library.

401/403 clear interaction credentials, drafts/results/journal and suspend actions; distinguish generic authentication/permission UI without resource-existence leaks. 404 means inaccessible/removed/unavailable scope and requires reconciliation; 400 validation, 409 state/version conflict, 413 body limit, 415 unsupported media, 422 bounded runtime rejection, 429 rate limit, 500 generic runtime failure, 502 provider/response failure, 503 unavailable/uncertain, 504 deadline. Network errors are transport uncertainty, not execution failure. Never display arbitrary backend message/stack fields. X-Request-Id is safe support correlation; it is not an idempotency key or authorization claim.
