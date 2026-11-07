# Security and reliability requirements

Status: **T01 historical threat model**, supplemented by the implemented T04–T07 controls below. The [T08 acceptance report](phase-1-acceptance.md) records executed security/transaction tests and deployment limitations. Phase 1 access is an opt-in local operator boundary; production authentication/authorization, least-privilege roles, backup/restore and operational hardening remain prerequisites, not completed controls. Real execution remains disabled until its applicable gates pass. No tools or external transport are enabled.

## Gates before the first rule-based agent

| Boundary | Minimum required safeguard and verification |
| --- | --- |
| API authentication | Require an authenticated principal for all registry/task/history/result/event endpoints. Initial single-owner mode may use a server-validated local credential; no production bypass. Only non-sensitive liveness may be anonymous. Test missing/invalid credentials |
| Ownership/authorization | Server supplies ownerId, checks reads/writes/result/event subscriptions and same-owner relationships. Deny mass-assigned owner/status fields. Agent registration/update permissions are separate from execution permission. Test cross-owner IDs even if UI is initially single-owner |
| Orchestrator registration | Admin-only configuration/enablement; Phase 1 seeds a native descriptor. No arbitrary plugin upload, endpoint URL or adapter code through public API |
| Inputs | Runtime DTO/schema validation, reject unknown privileged fields, bounded strings/JSON depth/body size, pagination limits, safe enums, parameterized DB access; status changes only through transition service |
| Secrets | Environment/secret-store references on backend; ignored local env files and redacted logs. No credentials in Agent.configuration, DB events, OpenAPI examples, browser bundles or debug city-state. Validate missing secrets fail closed |
| Initial runtime | Allowlist bounded pure rule handlers. No user JavaScript, shell, filesystem, network, model or tool execution. Execution-wide deadline/concurrency/payload/result limits and bounded retries required |
| Network | Bind local API/DB to loopback by default; restrict Compose ports; explicit CORS origins and WebSocket origin checks. Public deployment requires TLS and authenticated transport. Existing Vite's 0.0.0.0 is not a security pattern for API |
| Task control | Idempotent submissions, owner quotas/rate limits, agent/global concurrency, deadlines/attempt caps; deterministic cancellation outcome and stale-write guards |
| Audit | Persist actor/command/resource/correlation/outcome for registration, configuration, submit, retry, cancel, access denial and admin changes; safe errors visible without stack/secrets |
| Durability | PostgreSQL transactions, migrations, restart recovery, lease/fencing and outbox; reject acceptance if durable commit fails |
| Realtime | Authenticate subscription/replay, filter server-side by owner/resource, frame/buffer limits, heartbeat and replay/snapshot recovery |

A local bearer credential must never be checked into source or saved in browser localStorage as a default. A future same-origin session may use HttpOnly/Secure cookies with CSRF protection; credentialed cross-origin access requires explicit origin policy. Choose the actual auth mechanism in T02 and test it before non-health endpoints. Production identity/membership UX can follow later, but authorization cannot.

The existing app escapes user task/resident names before innerHTML and uses textContent in several places. This is a useful current control, not an excuse to trust backend strings. Future external names/errors/results/tool output are untrusted; use text rendering or a reviewed sanitizer. Do not add raw Markdown/HTML result rendering without separate review.

## Additional gates before LLMs, tools or external runtimes

- Treat prompts, model responses, retrieved documents, tool/MCP output and external events as untrusted data. Prompt text cannot grant permissions, disable audit, reveal credentials or approve destructive operations.
- Enforce tool permissions using server-side grants tied to owner, agent, execution and tool version. Validate arguments against schema and budgets. No general shell or unrestricted network/filesystem tool by default.
- Run side-effecting tools in an isolated worker/process/container with constrained identity, CPU/memory/wall time, filesystem allowlists, canonical-path/symlink checks and denied access to server secrets. Apply network egress allowlists and SSRF checks for redirects, private/link-local/metadata addresses and DNS changes.
- Destructive operations need explicit authenticated approval of a concrete action/resource/arguments hash. Approval expires, is single-use and is revalidated at execution; approval for one call never grants future calls. Phase 1 excludes destructive tools entirely.
- Credentials are resolved just in time, least privilege, tenant-scoped and rotatable. External endpoint registration/discovery cannot read arbitrary local files or inject commands. Audit adapter version and capability changes.
- Use redacted output DTOs and secret scanning/tests; prevent cross-agent/owner context mixing. Sensitive prompts/results have retention policy, size limits, restricted storage/access and transport encryption. Public events carry references, not raw data.
- Cancellation of a model request does not prove its remote tools stopped. Track unconfirmed external operations and avoid retrying side effects until reconciled. Usage/cost budgets include retries and pending external work.

No generic sandbox guarantees safety by name; test the actual tool runner's permissions/termination behavior. External runtimes that manage tools must document their own authorization boundary before being enabled. Framework integration is not equivalent to trust.

## Reliability and operations

| Failure | Required response / acceptance evidence |
| --- | --- |
| API crashes after commit | Task survives; client repeats same idempotency key and gets original task |
| Crash during execution | Lease expiry detected; old attempt fenced; safe native handler retry bounded and recorded; no unknown external duplicate |
| Worker or external callback repeats | Same execution/event key deduplicated; uniqueness/transition guards tested concurrently |
| DB outage | Readiness false, no claims, 503 on durable commands; no silent in-memory acceptance |
| Orchestrator outage | Queued reason/freshness and bounded reconciliation; deadline governs waiting |
| Retry storm | Backoff/jitter, max attempts, owner/global quotas, no unbounded timers or promises |
| Event delivery fails | Outbox retained/retried; history/snapshot recover truth; slow WebSocket consumer disconnected safely |
| Oversize result/log | Reject/truncate safe summaries with explicit limits; store bounded authorized result separately |
| Unhandled error | Safe code/correlation to client, restricted diagnostic detail, visible task/attempt outcome |
| Cancellation/timeout race | Conditional terminal commit, one winning outcome; no success after confirmed cancellation accepted as fresh truth |

Before Phase 1 acceptance, verify migration rollback/recovery on disposable data, DB volume survival, backup/restore procedure and shutdown/drain behavior. Do not assume Docker volume durability is a backup. Backend readiness depends on DB and schema compatibility; liveness must not leak credentials. Record structured correlation logs, task queue age, active attempts, expired leases, retries, outbox lag, errors and event connection count. Alerts and SLO targets can scale later, but failures must already be visible.

Exactly-once side effects are not promised. DB atomicity prevents conflicting state, while handler/tool idempotency and external reconciliation address real duplicate work. A broker later provides durable delivery, not automatic execution uniqueness.

## Risks and unresolved decisions

| Risk | Mitigation / decision gate |
| --- | --- |
| Source export has no Git history | T02 establish actual working repository/revision and hash-preserved frontend baseline before scaffolding |
| dist directory overwritten | API output stays under apps/api; preserve static host and asset paths; file checks in CI |
| Agent/NPC IDs mixed | UUID platform identity and FUTURE explicit durable binding key |
| Frontend demo mistaken for execution | Explicit mode/status labels, separate commands/projection, no demo-to-backend completion callbacks |
| Shared movement/activity ownership | Narrow future facade with cancellation/lease cleanup and existing regressions |
| External semantics differ | Capability conformance tests, authoritative remote status, ambiguity quarantine |
| Host limitations unknown | Confirm persistent process, TLS/WebSocket and DB connectivity before deploying API |
| Auth/retention/ORM unselected | T02/T03 record choices and tests; no public exposure until controls pass |
| Fresh visual/FPS baseline unavailable | Capture browser baseline and representative frame timings before future frontend changes; historical captures are reference only |

Phase 1 security is deliberately smaller than arbitrary autonomous execution: authenticated durable rule-based work can be enabled only after the first gate table passes. LLM/tool/external execution remains disabled until its additional gates are met.

## T04 local-development exception and production gate

The [implemented registry boundary](agent-registry.md) follows the explicit T04 instruction allowing a restricted development API while full authentication is absent. Registry is off by default; enabling requires non-production mode, literal loopback bind, database, existing configured owner scope, and a random bearer credential. Per-request socket/Host/Origin/token checks and owner-scoped SQL prevent anonymous/cross-owner use within that boundary. No authenticated person is fabricated; accepted command audit uses the explicit local-development-operator label. Never tunnel/proxy this mode publicly. Real identity/membership authorization, TLS and per-user accountability remain required before production registry exposure. Safe metadata schemas, raw unsupported-field rejection, bounded input/query sizes, version checks and atomic audit/history are implemented. No real agent execution or tools are enabled; the original execution/tool security gates remain mandatory.

## T05 task/execution access and data boundaries

[Task & Execution Persistence](task-execution-persistence.md) reuses the exact T04 local-development gate for all new routes, including parent/attempt ownership checks and owner-scoped idempotency. The AGENT_REGISTRY_* settings now gate the protected task/history APIs as well. Task input is allowlisted, byte-bounded, checked for common credential material, never executed and omitted from HTTP/event/audit/log output; universal secret detection is not claimed. Stored error strings/result references, lease/configuration data and idempotency hashes are omitted from execution/task DTOs. Internal allocation rejects legacy arbitrary agent configuration rather than copying secrets. Every created record and its accepted audit/history/outbox commit atomically. Production authentication, quotas, retention and operational security remain required before broader exposure; no actual execution or tools are enabled.

## T06 internal lifecycle boundary

[Task Lifecycle Service](lifecycle-service.md) has no public mutation endpoints, controller or automatic startup work. It requires configured development/test owner scope, verifies scoped Task/attempt/route relationships and expected versions, rejects older attempts, and atomically writes safe history and accepted audit records. Input/results/raw errors are not exposed in its returned T05 DTOs or event payloads. Production invocation fails closed while real authentication is absent. Running cancellation and timeout do not terminate external processes; real runtime integration requires claims/fencing, process control, external reconciliation and identity authorization before enablement. No actual execution is added, and all original tool/LLM security gates remain in force.

## T07 event privacy and audit boundary

[Versioned events and history](event-audit-foundation.md) reuse the same opt-in loopback development gate, bearer credential and configured owner for all read routes. Writer descriptors are internal; no event write API or external callback ingestion exists. Payloads are derived allowlisted state/version/attempt primitives, checked before insertion and on reads. Legacy unknown/invalid payloads are returned empty with an explicit status, preserving DB evidence without exposing secrets. Raw source fields, input/results, environment, arbitrary errors and headers are omitted from events/logs. Original append-only triggers and RESTRICT references remain active; privileged administrators can bypass SQL controls, so no cryptographic tamper resistance is claimed. Production authentication and future transport/adapters retain their original security gates.

## Phase 6 T03 current boundary

See the [principal/owner/service model and authorization matrix](phase-6/principal-authorization.md) for current local credential resolution, request-bound interaction grants, object isolation, trusted external-source authority and polling authorization. [Verification](phase-6/t03-verification.md) records executed tests. Existing OIDC/JWT was selected for production, but its issuer/audience/key and owner/permission policy are not supplied; production access remains closed. This supplements the preceding task-date local security record and does not claim production sessions or public tenancy.

## Named local/OIDC backend authentication - 2026-10-30

The user subsequently authorized local username/password or OIDC, one mode per installation, and a real disposable Keycloak test. [Current mode contracts and account provisioning](phase-6/authentication-modes.md) supersede the issuer-only blocker above. [Current verification](phase-6/verification-evidence/dual-auth-verification.json) records signature/purpose/owner/permission checks, revocable sessions, no fallback, and regression outcomes. This remains explicit private owner/operator scope; frontend login, public tenancy and production deployment are not claimed.
