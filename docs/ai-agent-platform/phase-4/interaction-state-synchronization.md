# T07 - Interaction State and Runtime Synchronization

Date: 2026-10-26, Asia/Bangkok. **T07: COMPLETE for the approved local scope.** Continuation of the interrupted implementation. Scope: the existing local-development interaction audience and inspector. Production person/tenant authentication, detached execution and T08-T10 are outside this task. See [architecture](architecture.md), [ADRs](decisions.md), [API contracts](interaction-api.md), [T03 client](frontend-interaction-client.md), [T04](task-submission-ui.md), [T05](execution-lifecycle-controls.md) and [T06](execution-results-history.md).

## Recovered implementation and state ownership

The interrupted session saved the page-owned `InteractionSession`, identifier-only recovery journal, owner integration, selection/read fencing, targeted history invalidation and focused tests. It did not finish this documentation or the final build. The continuation preserves those implementations and their test evidence, completes verification and adds an active-execution browser reload check. No backend production contract, migration, dependency, NPC entity, movement, rendering or animation system changes are required.

| State | Authority and lifetime |
| --- | --- |
| Agent/NPC binding, Agent activity | Authorized backend projection through the existing Phase 3 runtime singleton; sampled observations, never execution permission |
| Eligibility, Task, Execution and versions | Existing authorized T03 reads and mutation responses; resource versions fence delayed responses |
| Results and bounded history | Existing authorized result/history endpoints; T06 read owner retains one result and one history page |
| Selection, draft, confirmation, pending UI action | Existing inspector and T04/T05 owners, scoped by stable Agent/binding/NPC/Task/Execution IDs; private drafts stay in memory |
| Historical selection and pagination | T06 interaction state; independent of current execution and live NPC activity |
| Reload recovery | Expiring per-tab identifiers only; untrusted hints requiring backend authorization and fresh lookup |
| Labels, loading, stale and action availability | Derived presentation, never a competing backend lifecycle |

`InteractionSession` composes existing submission, lifecycle and result owners with one client and one view subscription. It has no execution engine, authoritative activity cache, interval or network connection. Existing binding notifications deliver Phase 3 sweep changes. The city update/animation loop does not perform interaction requests.

## Selection, panel and binding lifecycle

Every owner scopes data by stable identity; no display name, coordinate or array index establishes backend identity. Switching selection aborts obsolete reads and restore work, fences delayed callbacks and resets historical context. Pending mutation responses remain attached to their captured Agent/Task, including when another Agent is selected. Closing the inspector clears unnecessary selected reads without cancelling backend work. Reopening rechecks authoritative details; unresolved references remain associated with their original scope.

A fresh authorized projection that explicitly reports a missing Agent or changed/removed binding removes that scope's interaction cache and locators. Partial/transient absence is insufficient to erase valid state. Reassignment cannot turn an old Task into a new Agent's Task. Backend binding and ownership validation still runs on every mutation. Decorative NPCs use their existing inspector; no NPCs are spawned or reconstructed.

## Submission and lifecycle reconciliation

Task creation records the original idempotency key before dispatch, and adds the confirmed Task ID after acknowledgement. Save still creates intent only; explicit Start uses the existing synchronous coordinator route. Pending UI action and backend status remain separate. Start and Cancel record their exact scope before dispatch. Unknown mutation outcomes are resolved with existing authorized reads, never automatic POST replay.

T05 Task/Execution version checks are retained. Mutation responses supersede obsolete reads. Cancellation conflicts re-read the persisted race winner; neither an HTTP acknowledgement nor a network error invents CANCELLED/FAILED. An uncertain Start with a Task still CREATED (or QUEUED/PENDING) remains guarded: the absence of RUNNING is not proof that the request was rejected. A known active or terminal state reconciles the reference without replaying work.

## Minimal browser-refresh recovery

The journal key is `elyqreth.interaction.locators.v1`. Its schema is `{schemaVersion:1, origin, rows}`. Each row contains reviewed `agentId`, `bindingId`, stable `npcId`, optional `taskId`, `executionId`, original `idempotencyKey`, frontend pending `action` (CREATE/START/CANCEL/null), `savedAt` and `expiresAt`.

Limits: 20 locators, 16,384 raw JSON characters on load, 30-minute expiry, strict field whitelist, canonical UUIDs, known NPC manifest identities, bounded key syntax and exact approved loopback origin. Unsupported fields, malformed timestamps, future timestamps beyond five seconds, wrong origins and tampering purge this key. Expired loaded rows are removed. Pending references are not evicted to make room; capacity/storage failure is disclosed and falls back to volatile memory. Unchanged polling observations do not rewrite storage. Settling an older action does not steal a later saved Task's recovery target.

No credential, credential hash, instruction, Agent name, status snapshot, result, provider configuration or tool payload is stored. `savedAt` is only UI-intent priority/expiry metadata, not backend execution order. No broad localStorage persistence is introduced.

Page suspension/disposal preserves these identifiers and clears credentials/private owner data. After reload the user must reconnect the city-read capability and explicitly authorize the limited interaction capability. Restore revalidates Agent access and binding scope, then uses exact Task/key lookups and lifecycle GETs. Locators are never proof of permission. Lost Create response recovery can discover the committed Task; if no Task is found and the original private payload is gone, the UI allows lookup, not a replay with invented input. Explicit Disconnect/session invalidation purges locators and protected state and fences late responses. A subsequent Phase 3 disconnect notification cannot turn page suspension into a locator-purging logout.

The existing synchronous HTTP execution may receive cancellation when browser navigation closes its response. Reload recovery promises authoritative observation, not detached execution or provider termination. The native reload test compares the recovered exact Execution ID and outcome with PostgreSQL, without assuming that work survived or stopped.

## Freshness, reconnect and bounded invalidation

Phase 3 retains its shared after-completion polling, timeout, backoff and reconciliation policy. Stale activity disables unsafe controls and is distinct from runtime failure. When a fresh sweep follows stale state, eligibility and lifecycle details recheck. Automatic journal restore uses at most three attempts per scope on existing completed sweep notifications; explicit Restore context permits another bounded check. Concurrent restores share a promise. No per-NPC timer, extra transport or mutation retry is installed.

Task/Execution versions are compared only within the same resource identity. The completed-sweep timestamp is an equality notification token, not a total ordering across Agents. Historical detail/result high-water marks reject older versions, including attempts to regress a known terminal result to RUNNING. Local history revision counters schedule UI invalidation; they are not fabricated backend revisions.

Confirmed lifecycle version changes invalidate only the affected Agent history. Open first pages refresh with coalescing and at most one follow-up per invalidation revision. Later pages retain their snapshot cursor and historical selection and show a refresh notice. Closed sections remain lazy. Repeated identical versions do not trigger repeated history fetches. Historical selection never writes to Phase 3 activity or NPC indicators.

## Security, accessibility and performance boundaries

Existing local capabilities remain default-deny, audience-separated and owner/binding checked. There is no production user/tenant login in this repository; no cross-tenant implementation is claimed. Credentials remain memory-only, authorization loss clears protected state and old generations cannot populate a new connection. Recovery does not weaken backend access checks. Results retain the T06 allow-listed text/statistics rendering and safe DOM text insertion.

Recovery/loading/stale messages reuse the inspector's live regions and buttons. Stable message text is not repeatedly replaced on each refresh. Existing keyboard focus, confirmation, responsive layout and reduced-motion behavior are preserved. This is not a full accessibility audit; that remains T08.

Bounds remain explicit: 20 submission/recovery scopes, 40 lifecycle entries and result-version observations, 80 session execution/version invalidation keys, one retained result/history page, existing bounded history cursor traversal and client response limits. Obsolete reads are aborted, mutations retain captured scope, subscriptions are released, and disconnect drops runtime references and maps. No full-city rerender, sprite reconstruction or new animation resource is introduced. Deterministic tests verify request coalescing/cleanup; no FPS, heap endurance or production capacity claim is made.

The native concurrent-Agent fixture respects the coordinator's existing single-flight capacity: it first verifies the primary instance rejects competing work, then uses a second existing authorized application instance against the isolated PostgreSQL database to observe independent Agents. This is test infrastructure, not a new orchestrator. RabbitMQ/Redis/worker restart scenarios do not apply to this repository's current runtime.

## Requirement recovery checklist

| Requirement group | Recovered status | Continuation evidence |
| --- | --- | --- |
| State ownership/stable identities | PARTIAL: implementation and tests saved, documentation absent | This document; session identity/race tests |
| Selection and panel lifecycle | COMPLETE: focused and native tests saved | Preserved coverage; final native rerun |
| Submission/start/cancellation reconciliation | COMPLETE: owner tests and PostgreSQL evidence saved | Exact-key lost-response and race/guard tests retained |
| Results/history synchronization | COMPLETE: version/invalidation tests saved | Retained T06 compatibility and native history invalidation |
| Phase 3 integration/freshness/reconnect | COMPLETE: shared-sweep integration and native outage passed | Final native outage/recovery check |
| Browser refresh | PARTIAL: unstarted and terminal reload passed; active reload not tested | Added active RUNNING reload with canonical database comparison |
| Session/binding/multi-Agent isolation | COMPLETE in approved local scope | Journal authorization, late-response, rebind and native Agent switching tests |
| Deduplication/cleanup/performance guards | COMPLETE for deterministic bounded behavior | Session/result tests; no performance benchmark inferred |
| Accessibility/UX | PARTIAL: implementation saved; final checks pending | Native mobile/confirmation and regression smoke; full audit reserved for T08 |
| Automated/integration/browser checks | PARTIAL: successful prior logs retained; final build interrupted | Command outcomes in verification evidence |
| Documentation/roadmap | MISSING | This reference, indexes, roadmap and evidence |

## Verification and limitations

See [machine-readable command evidence](verification-evidence/t07-verification.json) and [sanitized native-browser report](verification-evidence/t07-live-browser.json). Prior successful checks are retained only where the continuation did not invalidate them. The final focused tests cover the final source and added reload scenario. No production records or paid LLM APIs are used.

| Command | Actual outcome |
| --- | --- |
| `npm.cmd run lint` | PASS in continuation: syntax, strict runtime-web TypeScript and backend no-emit check |
| `npm.cmd test` | PASS in continuation: 207 tests, including 15 session/journal and 20 result/history tests plus Phase 3/city regressions |
| `npm.cmd run build:web` | PASS in continuation: 60 modules, disposable production bundle; maintained `dist/` preserved |
| `node --test --test-name-pattern='P4 T07' apps/api/test/database.integration.cjs` | PASS in continuation: two real PostgreSQL/HTTP tests, including native Chrome 155; zero browser exceptions |
| `node --test --test-name-pattern='P4 T0[34567]' apps/api/test/database.integration.cjs` | Retained pre-interruption PASS: nine T03-T07 compatibility cases; final T07 scenario rerun after extension |
| `npm.cmd run test:browser` | Retained pre-interruption PASS: real Chrome city/Task/Phase 3/camera/mobile smoke; final T07 native test also executes the common city smoke |

The new active-reload test initially tried to start another Task on cancelled Agent A and correctly encountered existing native cancellation quarantine. The fixture was corrected to use independently eligible Agent B; runtime protection was preserved. The final reload recovered the exact execution and PostgreSQL's CANCELLED status. Failed exploratory runs are recorded in the evidence; they are not reported as passes.

No full backend suite, live paid provider run, real backend/worker restart, pixel-diff, exhaustive accessibility audit or sustained heap/FPS profiling is claimed by T07. Existing Phase 3 restart/retry behavior is reused; a fresh end-to-end backend restart is not verified here. Public production release remains blocked by the established identity/deployment limits. Git metadata is absent, so no clean-tree/diff claim is possible; maintained-file hash comparisons protect unrelated source instead. T08-T10 remain planned.
