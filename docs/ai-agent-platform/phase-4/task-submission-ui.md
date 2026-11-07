# Phase 4 T04 - NPC interaction and Task submission

Current follow-on: [T05 now adds explicit Start and confirmed cancellation](execution-lifecycle-controls.md). This T04 checkpoint describes Task creation only; its execution-control exclusions below remain historical scope boundaries.

Date: 2026-10-26, Asia/Bangkok. **T04 COMPLETE for approved local interaction scope.** T05-T10 remain planned. This feature saves an authorized Task; it does not start an Execution, cancel work, or add result/history controls.

## Repository and integration

The existing native JavaScript/Canvas application uses `app.js` selection, a persistent inspector, the Phase 3 binding view and one shared activity poller. The new `agent-task-panel.js` mounts one persistent Agent Task section inside that inspector, outside the frequently replaced simulation/Agent Details content. No parallel inspector, framework, NPC entity or renderer is introduced. Decorative/unbound, ambiguous, unavailable and missing NPC bindings have no Task section. Existing simulated City Hall mission controls remain separate.

`runtime/interaction/submission-owner.js` owns per-binding drafts and submission references, reuses the T03 client and validation, and exposes snapshots/subscriptions. Selection/binding notifications drive presentation; the animation loop does not own form rendering or HTTP. Initial eligibility checks are deferred out of the selection callback and repeated only on explicit actions or binding selection changes. There is no new timer/polling loop. Existing binding and runtime health are consumed rather than copied into another Agent store.

```mermaid
sequenceDiagram
 participant User
 participant Inspector
 participant Owner as Submission owner
 participant Client as T03 client
 participant API as Authorized NestJS API
 participant Sync as Existing Phase 3 synchronization
 User->>Inspector: Select a persistently linked NPC
 Inspector->>Owner: Trusted Agent/NPC/binding identity
 User->>Inspector: Connect limited local interaction access
 Owner->>Client: getAgent(agentId)
 Client->>API: GET /api/v1/agents/:id
 API-->>Owner: Identity and actionEligibility
 User->>Inspector: Enter instructions and Save Task
 Owner->>Owner: Validate and freeze original payload/key
 Owner->>Client: Recheck Agent, then createTask(intent)
 Client->>API: POST /api/v1/tasks
 API-->>Owner: Persisted Task reference
 Owner-->>Inspector: Saved Task; no Execution started
 Owner->>Sync: One bounded shared refresh
```

## Local setup and use

Follow [T02 configuration and authorization](interaction-api.md#authorization-and-configuration) and the existing [Phase 3 runtime synchronization setup](../phase-3/frontend-runtime-integration.md). The backend must be loopback-bound, have the exact frontend CORS Origin configured, and have a current persisted supported binding for an allowed Agent. The existing Phase 3 city-read connection must already be established by its trusted local application setup; T04 does not add another city-read connection mechanism or grant write permissions to the city-read credential.

1. Select an Agent-linked resident through the canvas or existing Residents list.
2. In the existing inspector, open **Connect interaction access**. Enter the configured loopback backend origin and **limited interaction credential**. The default origin is the current page origin; change it when the API runs on a separate port. No backend address or credential is bundled.
3. After backend eligibility is checked, enter instructions and choose **Save Task**. Confirmation displays the real Task ID, Agent ID and backend status. This form does not create an Execution reference because this backend operation only creates a Task.
4. Close/reopen or select another NPC safely. Each binding retains its own draft/confirmed reference in this page session. **New Task** deliberately begins a separate logical submission only after a confirmed outcome.
5. **Disconnect interaction access** clears credentials, drafts and references. Reload also clears this volatile interaction journal. Never use an operator credential or provider key in this interface. Production user/tenant login is not implemented by this phase.

## Validation, eligibility and presentation

Instructions are required plain text, up to 16,000 JavaScript characters and 32,768 UTF-8 bytes for serialized input. T03's exact backend-aligned validator rejects unsupported control characters and recognized credential patterns. Original text is preserved; it is not injected as HTML. There is no arbitrary metadata, tool, provider/model, owner or runtime configuration input.

Only backend `actionEligibility.canCreateTask` enables creation. The panel also requires a fresh resolved binding and does not enable submission for a currently disabled/archived projection. It independently re-reads the Agent before Create. An active Execution does not automatically prohibit saving another Task: actual backend creation and start permissions differ. There are no invented Agent states, optimistic execution transitions or inferred liveness claims. Existing Agent Details above remains the activity/inspection entry point.

The owner separates IDLE, VALIDATING, SUBMITTING, SUBMITTED, ERROR and RECOVERY_REQUIRED presentation from backend Task/Execution state. Loading disables conflicting actions and announces progress. Optional missing activity remains UNKNOWN. A stale projection disables mutation/recovery until the existing shared synchronization restores freshness; **Recheck access** permits a manual eligibility read without creating a new poller.

## Duplicate prevention and ambiguous outcomes

The busy guard is set synchronously before asynchronous admission and the submit button is disabled. These are UX safeguards; PostgreSQL's existing owner/key/hash semantics remain the duplicate protection authority. A logical submission freezes its original Agent, exact input and CSPRNG key. Closing selection, changing NPCs or a lost HTTP response never silently generates a replacement key.

If Create may have been dispatched, no automatic retry runs. **Check submission** calls the existing exact authorized key lookup. A found Task becomes a confirmed reference; a null response remains unresolved rather than proving failure. **Retry same submission** is an explicit user action, revalidates eligibility and sends the original immutable payload/key. Editing and New Task stay unavailable while the original intent is unresolved. Conflicts, denials, validation failures, rate limits and network errors use fixed safe feedback from normalized error categories, without rendering backend diagnostics.

Selection changes during an eligibility read prevent a not-yet-dispatched Create. Selection changes after dispatch preserve the original operation's association in its binding journal; no backend cancellation occurs. A newly selected Agent never receives the previous Agent's draft or result. Confirmed unbinding hides the Task section while temporary stale transport preserves pending intent. Removed/reassigned binding identities do not inherit an old binding's journal.

## Contracts used

| T03 operation | Existing API | Purpose |
| --- | --- | --- |
| `getAgent` | GET `/api/v1/agents/:id` | Authorized identity and advisory Task creation eligibility |
| `createTask` | POST `/api/v1/tasks` | `{agentId,input:{instruction},idempotencyKey}`; 201 new/200 replay |
| `findTaskByIntent` | GET `/api/v1/tasks/lookup?agentId=...&idempotencyKey=...` | Exact nullable recovery; no history scanning |
| Existing `runtimeIntegration.refresh` | Existing shared activity API/scheduler | Bounded refresh after confirmed save/recovery |

No new backend endpoint, migration or production backend source change is required. No execute/cancel/result/history client operation is invoked by the form.

## Authorization, cleanup and bounds

The T03 client keeps only a private in-memory limited credential and validates the configured loopback origin. Connecting/replacing credentials clears previous drafts and fences pending responses. A 401 invalidates the scope; city-read authorization loss/disconnect also clears the interaction journal. A per-operation 403 clears that binding's protected Agent/detail references and presents a denial, without misclassifying connectivity as failed execution. All actual mutations remain independently authorized by the backend against current binding/Agent ownership and policy.

The journal is bounded to 20 binding entries (matching the current configured interaction Agent scope maximum). It never evicts an unresolved submission to admit another; when full, further bindings are non-actionable until explicit disconnect. Drafts and retained intents exist only in memory. Close selection preserves a pending operation; explicit disconnect/pagehide/HMR disposes or fences it. Credentials are cleared from dialog fields on connect, error, cancel and disposal. T03 handles request deadlines, cancellation listeners and late response fencing. Subscriptions are removed on hot disposal. No API request occurs per NPC/frame and no new periodic resource exists.

## Accessibility and design

The existing inspector remains scrollable, with a persistent, labelled multiline input and restrained Icy White styling. Required/invalid state, described-by help/feedback, polite status announcements, form busy state, native disabled buttons and visible focus outlines are provided. The access dialog uses native modal semantics and labels; Escape closes it and clears its credential field. Escape in the Task section closes existing selection. A separate close action is available during submission. User text uses DOM values/textContent; static markup contains no backend interpolation. No animation or reduced-motion-sensitive effect is added.

## Verification and limits

Tests use existing Node tests, controlled fetch fixtures, installed Chrome, NestJS and owned disposable PostgreSQL. No paid/provider calls or production data are used.

| Command | Actual outcome |
| --- | --- |
| `npm.cmd run lint` | PASS: game module syntax, frontend strict runtime TypeScript and backend no-emit compatibility |
| `npm.cmd run check:runtime:web` | PASS after final owner changes |
| `node --test tests/task-submission.test.js` | PASS: 13 focused cases for validation, scoped identity, duplicates, lost response/recovery/retry, selection, availability, auth, cleanup, safe backend failures and journal bounds |
| `npm.cmd test` | PASS: 155 tests, including all 142 previous frontend cases and 13 new Task submission owner cases |
| `npm.cmd run build:web` | PASS: 54-module disposable production bundle; maintained `dist/` source preserved |
| `npm.cmd run test:browser` | PASS: real Chrome155, zero exceptions; form interaction/recovery, keyboard Escape, labels, mobile overflow, existing NPC/movement/river/train/camera/inspector/status/reconnection/simulated mission smoke |
| `node --test --test-name-pattern='P4 T04' apps/api/test/database.integration.cjs` | PASS: two real PostgreSQL/Nest tests, one of which launches real Chrome/native CORS requests. Double submit persists exactly one CREATED Task and zero Executions; committed lost-response recovery performs only one POST |

The initial sandboxed browser attempt could not read ancestor directories for Vite; the authorized run passed. The initial database attempt found Docker Desktop stopped; starting the installed local engine resolved it and isolated tests passed. An early browser fixture omitted its JSON content type; it was corrected to match the backend, without weakening client validation. The initial focused test reused a consumed Response; its fixture was corrected. No known application defect remains from these failures.

Limitations: local delegated capabilities, not production human/tenant authentication; no draft/recovery persistence after reload or credential replacement (later T07 owns durable recovery design); no execution start/cancel/results/history controls (T05/T06); no live provider, long-duration memory/FPS or visual-diff acceptance run. The complete backend regression suite was not repeated because backend production source is unchanged; focused actual persistence/API and real browser compatibility were executed. Phase 4 final release acceptance remains T10.

Files and sanitized verification evidence: [commands and preservation](verification-evidence/t04-verification.json) and [live browser report](verification-evidence/t04-live-browser.json). Git metadata is absent; file preservation is compared against a 455-file pre-task hash inventory. No commit, push, tag, release or deployment is performed. Next task: **Phase 4 T05 - Execution Lifecycle Controls**, not begun here.
