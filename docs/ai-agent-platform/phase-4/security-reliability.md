# Phase 4 security, eligibility and recovery plan

**Current T10 reference:** [Final acceptance](acceptance.md), [current operation](operations.md) and [risks](risk-register.md) describe the completed Phase 4 local implementation. The original planning/task-date statements below remain historical scope/evidence and do not mark current UI/recovery work as missing.

**T08 checkpoint:** the [actual hardening audit, threat model, measurements and risks](interaction-hardening.md) verifies the approved local interaction boundary. This document retains T01 planning context; actual recovery limits and denial handling are corrected below.

Status: **T01 security/recovery design record**. T02 implements backend limited authorization and API contracts; [actual behavior and verification](interaction-api.md) are authoritative. Remaining browser UI/session-state recovery work is planned for later tasks. No production sessions are claimed. [Original API plan](api-contracts.md) and [ADRs](decisions.md) specify the decisions.

T03 now implements [data-access error/auth behavior](frontend-interaction-client.md): 401 invalidates the client scope; operation-level 403 is returned without automatically aborting another Agent's pending synchronous execution. This refines the original generic purge advice below using actual backend error semantics. T04-T07 must clear denied selected data and fence genuine identity changes; no UI cache or persistent journal exists in T03.

## Access boundary and permission matrix

Keep the accepted development/test loopback bind/peer/Host/exact-Origin boundary. Propose optional `CITY_INTERACTION_ENABLED` and a strong `CITY_INTERACTION_TOKEN`, distinct from operator and city-read tokens, plus a reviewed bounded Agent allowlist. Names are provisional configuration contracts for T02. Disabled is default; invalid/duplicate audience configuration fails startup. No production enablement, LAN proxy trust, wildcard CORS, cookie authentication, new identity provider or broad operator fallback is introduced.

Reuse `assertLocalRequest` and configured owner resolution, then derive an immutable **request-scoped** interaction principal. Body/query/DOM/NPC claims cannot set owner, tenant or permissions. No globally mutated “current user.” Every permitted operation additionally resolves owned Agent and current enabled PASSIVE binding/manifest and server grant; Task/Execution IDs require relational joins to that Agent/owner. Validate before idempotent replay/result retrieval too. Deny inaccessible resources uniformly. The delegation is Agent-level for this fixed local owner, including permitted history; it does not create personal Task ownership between humans sharing that owner.

| Operation | Existing operator | Existing city-read | Proposed interaction grant | Anonymous |
| --- | --- | --- | --- | --- |
| Safe bound activity | Existing own routes | Configured city/owner GET | Use separate city-read connection; no implicit audience mixing | Deny |
| Agent identity | Existing owned registry read | Activity fields only | Exact authorized bound/allowlisted Agent, safe DTO | Deny |
| Create Task | Existing owned active Agent | Deny | ACTIVE, allowed/bound Agent and valid text/key | Deny |
| Start execution | Existing trusted runtime binding | Deny | Owned eligible Task, allowed native runtime binding and fresh version | Deny |
| Cancel execution | Existing native snapshot policy | Deny | Owned eligible native attempt and both versions, server revalidation | Deny |
| Task/detail/result/intent lookup | Existing scoped reads | Deny | Exact allowed Agent relationship; result disclosure policy applies | Deny |
| Agent execution history | Proposed new bounded route under operator policy | Deny | Allowed bound Agent only, bounded cursor | Deny |
| Edit/register/archive Agent, binding writes | Existing registry/internal command policy | Deny | Deny | Deny |
| Raw prompts/configuration, provider secrets | No raw secrets in public DTOs | Deny | Deny | Deny |
| Audit history | Existing guarded read | Deny | Deny in MVP; latest safe lifecycle detail is sufficient | Deny |

Multi-user/tenant identity, roles and production sessions are **not implemented**. They remain release blockers for a product requiring independent users/tenants. Tests must prove existing fixed-owner foreign-resource denial, not pretend it is a production login/tenant suite.

The proposed static local capability has no automatic account-session expiry. Handle observed rejection/revocation, explicit disconnect and trusted rotation; do not claim a session renewal protocol exists. Revoking new request permission does not by itself terminate already admitted work. Transport closure may request cooperative cancellation, but no immediate stop/remote termination guarantee follows. Require authorized cancellation and persisted reconciliation where available.

## Eligibility and action presentation

| Authoritative facts | Create | Start | Cancel | Reads |
| --- | --- | --- | --- | --- |
| Valid grant, active binding, ACTIVE Agent, no known active conflict | Enabled after input validation | Only CREATED/QUEUED Task and reviewed native binding | Only actual PENDING/RUNNING native attempt with eligible Task | Authorized bounded reads |
| Known active execution or queued work | May save additional intent with warning; not a queue guarantee | Disable for known conflicting Agent execution; coordinator decides capacity | Current eligible attempt only | Continue fresh reads |
| Agent DISABLED/ARCHIVED | Disable | Disable | Backend cancellation policy remains final; do not block emergency cancel solely because Agent disabled | Authorized history can remain available while grant/binding valid |
| EXTERNAL Agent/attempt or unsupported runtime | May omit Create in MVP rather than save unusable intent | Disable; no external adapter | Disable | Only supported authorized safe references |
| Stale/UNKNOWN state or missing versions | Draft editable; confirm authorization before submitting | Disable until bounded detail/authorization refresh | Revalidate exact current detail before enabling | Label stale, provide bounded refresh |
| Missing/reassigned binding, revoked access, unresolved NPC | No NPC-triggered actions | Disable | No guessed old association; reconcile only through still-authorized operation reference | No protected data for new/unauthorized association |

These are conservative UI hints, not a second lifecycle state machine. Backend can reject any action as state changes. Current global one-active-execution coordinator capacity is not fully described by one Agent projection; never promise a Start slot from an IDLE marker. Existing running cancellation/timeout quarantine can reject new native attempts even after a terminal UI state. Do not clear reconciliation flags or expose unrestricted retry/recovery controls.

A CREATED Task with no pending/native execution has no public execution-cancellation route. “Discard draft” removes only local text, not the saved Task. No Task-delete/cancel-new-intent API is added merely for UI symmetry.

## Mutation safety and privacy

- Read current selection from T05 and compare binding/Agent identities before dispatch; server independently validates. Reassignment during a request cannot retarget its immutable operation IDs.
- Keep provider/model/profile, tool grants, deadlines and strategy in trusted runtime definitions. User instructions cannot select a provider, unlock a tool or change deadlines. Prompt injection remains untrusted text; there is no claim that prompt wording can secure tools.
- Do not log instructions/context, output, credentials, idempotency keys, query locators or hidden prompts. Render all text through textContent or existing escaping; no innerHTML for model/user content, Markdown, scriptable links or raw JSON fallback.
- Clear protected interaction data on authorization failure/connection scope change. Abort obsolete reads, fence all callbacks. Keep existing authorized city-read data only if its separate capability remains valid; never copy interaction permissions into that facade.
- Result disclosure must be enforced on the backend for synchronous execute **and** result GET. Default structured rule-based output; LLM text requires explicit trusted per-Agent display opt-in. This is deliberate disclosure to an authorized local user, not an arbitrary-content secrets filter.
- Tokens are memory-only, non-echoing fields; no URLs/storage/build-time env keys. An XSS/extension can still observe in-memory capabilities: static local delegation does not solve hostile-browser security.

## Failure recovery matrix

Use the existing read retry/backoff behavior for GETs only: bounded jittered recovery, no per-NPC timer, unauthorized responses suspend. Never automatically replay Start or Cancel. Same-key Create replay may be explicitly requested only with unchanged known payload after reconciliation.

| Failure | Required behavior |
| --- | --- |
| Create validation rejection | Keep editable local draft, fixed field error; no saved Task claim |
| Create response lost | Freeze same intent/key, query exact authorized lookup. Found Task -> show ID/state. Confirmed absence + retained unchanged payload -> explicit same-key retry. Unavailable lookup -> remain uncertain, no new key automatically |
| Start response lost/timeout | Task ID is already known. Read Task/status/latest execution and detail/result. Never infer no execution from transport failure; no automatic re-execute |
| Cancel response lost | Refresh exact pair. Terminal success wins if committed first; cancellation only displayed when persisted. If still eligible allow explicit fresh-version cancel, not a blind timed retry |
| HTTP execution timeout | Read persisted state; TIMED_OUT may map Task FAILED. Request-error status alone is not proof finalization committed |
| Full disconnect/reload/page close | Execute HTTP close can request cancellation. Warn while request pending; do not advertise “runs after browser closes.” Actual state after restart is read from persistence, with uncertainty/quarantine retained |
| Backend hard crash | State may remain RUNNING/unresolved. Display safe uncertainty; no fabricated completion, lease reset or recovery worker |
| Browser hidden/sleep | Pause observation reads per Phase 3; do not intentionally abort active Start just because visibility changes. On resume coalesce authoritative refresh |
| Binding removed while pending | Clear NPC association/actions. Do not delete Task/Agent/NPC. An operation remains accessible only if backend authorization still permits it; otherwise show unavailable without leaking old details |
| Capability rotation/401 | Clear/fence credentials and protected state, require explicit reauthorization; no perpetual reconnect |
| Operation-specific 403/404 | Clear affected protected details/history and disable that scope; do not abort an independently pending Execution merely because another operation was denied |
| Unsupported/malformed response | Mark detail unavailable/unknown, retain clearly stale safe snapshot only where authorized; disable commands, no fabricated success |

Implemented T07 recovery uses a per-tab `sessionStorage` journal of **at most 20 locators**, **30-minute expiry**, with strict origin/field/identifier validation and a 16,384-character load bound. This supersedes the original T01 proposal of five locators and 24 hours; see the [actual state model](interaction-state-synchronization.md). Store only API origin, Agent/Task/Execution UUIDs and opaque intent key; no text, results, credentials or claimed lifecycle. All locators are private operational references, validated as untrusted on read, hidden until explicit reauthorization and server lookup. They are not a permission capability. Logout/revocation/scope change clears them; reauthorization must never render a record merely because its UUID exists in storage. If browser storage is unavailable, fall back to in-memory references and explicitly report that reload recovery is unavailable. Do not persist unfinished private drafts to make recovery easier.

## Observability and audit

Reuse existing request IDs and safe runtime correlation IDs. Frontend generates or accepts only validated support identifiers; a request ID is not the durable execution correlation or an idempotency key. Durable `task.created`, queue/start, execution/task terminal events remain written by existing services/transactions exactly once per committed transition. UI receipt of a response/poll is not another lifecycle event.

Existing RuntimeApiService logs runtime.requested/conflict/cancellation.requested/recorded; coordinator logs started/completed/failed/cancelled/timeout; HTTP foundation records safe errors/context. Proposed audience/authorization diagnostics may include stable action and bounded reason category, never credentials or arbitrary request bodies/URLs. Do not add Agent/Task/Execution IDs as metric labels. A denied request or button click is an operational observation, not proof of a persisted lifecycle transition. T02/T08 must verify safe denial logging; there is no new audit store, human-action attribution or fake `task.assigned` event.
