# Target architecture and decisions

Status: **T01 historical target design**. The implemented T02–T07 development foundation and T08 verification are described in the [Phase 1 acceptance report](phase-1-acceptance.md). Workers, runtime handlers, retries/recovery, authenticated realtime delivery, providers and NPC integration below remain **FUTURE**. Explicit subsequent task scopes deferred these parts of the original proposal. The city remains static Canvas source in root `dist/`; the modular NestJS backend remains in `apps/api`, with one PostgreSQL/Drizzle persistence boundary. No city relocation or new rendering framework was required.

## Additive architecture

Use one modular NestJS backend deployment and PostgreSQL. A bounded in-process worker polls durable pending executions; it is independent of requests and browsers. Keep the city as its existing static Canvas application. No microservices, Redis or RabbitMQ are necessary for Phase 1.

```mermaid
flowchart TD
  City[Existing Canvas city and decorative simulation]
  Projection[Future execution projection and visual bridge]
  API[NestJS HTTP API and authenticated realtime gateway]
  Control[Agent and Task control plane]
  DB[(PostgreSQL: state, attempts, events, outbox)]
  Adapter[Capability-based orchestrator port]
  Native[Native orchestrator]
  External[Future external adapters]
  Runtime[Bounded execution runtime]
  Rule[Rule-based handlers]
  Model[Future optional LLM providers]
  Tools[Future permissioned tools and MCP]
  City --- Projection
  Projection <-->|HTTP and WebSocket| API
  API --> Control
  Control <--> DB
  Control --> Adapter
  Adapter --> Native
  Adapter --> External
  Native --> Runtime
  Runtime --> Rule
  Runtime --> Model
  Runtime --> Tools
```

The frontend displays read models and sends authenticated commands; backend task state is authoritative. Network loss cannot stop execution. Decorative simulation must remain alive without any API. External runs have external execution authority; Elyqreth records normalized observations, policy and identity without executing a second copy.

| Boundary / expected API module | Responsibility | Excluded responsibilities |
| --- | --- | --- |
| City, existing dist modules | Rendering, NPC movement/activity, camera, demo mission | Task execution truth, provider credentials |
| Identity/agents | Owner-scoped logical configuration/lifecycle and permissions | Coordinates, visual animation state |
| Tasks/executions | Durable commands, attempts, validation, retry and recovery | Provider SDK types, decorative schedules |
| Orchestration | Capability negotiation, adapter routing, external reconciliation | Framework dependency in core domain |
| Runtime | Claims/leases, bounded handler invocation, deadlines, cancellation | Request lifetime or animation timing |
| Providers (FUTURE) | Model requests, usage and provider error normalization | Agent identity or task routing policy |
| Tools (FUTURE) | Authorized isolated side effects and approvals | Unrestricted execution of model output |
| Events/realtime | Transactional lifecycle journal, filtered replay and delivery | Uncommitted success broadcasts |
| Infrastructure | DB access, secrets, auth, health, configuration, telemetry | Business transitions hidden in controllers |

Use dependency injection at external boundaries, not a generic abstraction for every class. Keep controllers thin, transition logic in services, transactions in explicit application operations, and vendor SDKs within adapters. Nest modules encapsulate related providers and exported interfaces; this supports the proposed modular deployment. [Nest module documentation](https://docs.nestjs.com/modules).

## Repository strategy

Choose the **existing repository with additive packages**. It becomes a lightweight monorepo without moving the frontend. Phase 1 candidate layout:

```text
dist/                         # unchanged existing frontend source/static root
tests/                        # unchanged city regressions
scripts/check.mjs             # unchanged city syntax check
apps/api/                     # future NestJS package; build to apps/api/dist
  src/{auth,agents,tasks,executions,orchestration,runtime,events,realtime,infra}/
  test/
packages/contracts/           # future TS types + versioned schemas/OpenAPI
docs/ai-agent-platform/       # transfer this documentation when using real repo
compose.yaml                  # future local API + PostgreSQL, never public by default
```

T02 may add npm workspaces `apps/*` and `packages/*` after preserving root scripts, checking ESM/CommonJS boundaries, recording a real Git baseline and confirming package resolution. Keep city `dev`, `check`, `test` behavior; add explicit backend scripts instead of replacing them. Shared contracts can publish ESM JS, JSON Schema and declarations: the vanilla browser must not load raw TypeScript or require a frontend rewrite. T02 selects transport/runtime schema tooling and supported backend Node/Nest versions then pins them; T01 does not install or prescribe unverified package versions.

Preserve `.openai/hosting.json`, asset-relative URLs and Vite root. Static hosting alone does not run a persistent Nest process: future backend hosting must support long-running processes, DB networking, TLS and WebSocket upgrades. Determine that host before any deployment change. Local Compose is a new development path, not replacement hosting.

| Alternative | Decision and consequence |
| --- | --- |
| Move frontend immediately to apps/web | Reject for Phase 1: breaks root/path/hosting assumptions for no execution benefit; optional later with dedicated parity review |
| Separate API repository | Defer: independent release isolation is useful later, but contracts/version coordination and local setup become harder now |
| NestJS modular monolith | Recommend: explicit modules/guards/DI with one operational unit; avoid introducing unnecessary distributed services |
| PostgreSQL | Recommend for transactional task/attempt/event state, uniqueness and durable worker claims |
| Redis | Defer until measured need for shared cache/rate limits/fanout; not task truth |
| RabbitMQ | Defer until worker scale/routing requires broker delivery; retained outbox provides migration seam |
| WebSocket | Plan authenticated native-WebSocket-compatible transport, with HTTP snapshot/poll fallback; do not assume Socket.IO wire compatibility |
| Workflow framework as mandatory engine | Reject: domain and adapter port must work without any one framework |

Nest gateways support transport adapters, so T02 must deliberately choose native WebSocket versus Socket.IO and document client compatibility; the existing browser has neither. [Nest gateway documentation](https://docs.nestjs.com/websockets/gateways).

## API-first surface

Candidate `/api/v1` endpoints: list/create/get/patch/deactivate agents; list orchestrators/capabilities; create/get/list/cancel tasks; list attempts/get execution/result; authorized event history and state snapshot. Use pagination, resource versions/If-Match for edits, Idempotency-Key for task creation and retry commands, structured errors and schema-validated bodies. Persist accepted work before returning 202. Never expose ORM entities directly.

Task creation chooses one agent and its registered orchestrator, snapshots execution-relevant configuration and validates capabilities. A later explicit retry creates an attempt, not a new logical task. Return 409 for conflicting versions/state, 422 for invalid or unsupported requests, 401/403 for access failures, 429 for quotas, 503 for unavailable dependencies. Errors carry code, safe message, retryability and correlation ID. Exact endpoint schemas and HTTP codes become tested contracts in T04–T07.

## Optional LLM and tool boundaries

**FUTURE; not Phase 1 integrations.** Agent has an optional execution-profile reference, never a mandatory provider/model field. Rule handlers need no profile; externally managed runtimes own their own models. Profile versions snapshot provider/model/options/credential reference per execution, so later agent edits do not change a running attempt.

Provider port: `describeCapabilities`, `invoke` and optional `stream`/`cancel`; advertise text, vision, structured output, streaming, tool calling and usage reporting independently. Normalize request content, deadline, token/output limits, model identifier, correlation and optional tool schemas. Return output, finish reason, usage/cost metadata and safe normalized errors. Missing token/cost information is UNKNOWN, never zero. Estimate and actual usage have distinct provenance and pricing timestamp/currency. Enforce budgets before and during execution; collect actual usage when available.

| Integration | Boundary and handling |
| --- | --- |
| Local Ollama | Optional provider adapter, configured server URL, model capability verification, localhost/host-network ambiguity documented in deployment; no automatic downloads |
| OpenAI-compatible endpoints | Optional adapter; compatibility is negotiated/tested, not assumed for tool calling, streams or usage |
| Cloud LLMs | Provider-specific credentials and endpoint policies; deadlines, bounded retries and classified auth/rate-limit/model errors |
| Rule-based agents | Native deterministic real handler, no model dependency or mock LLM |
| External model-managed agents | External orchestrator boundary; do not wrap their hidden model lifecycle in native execution |
| Tool calls | Model proposes typed calls; permissioned tool executor validates arguments, scope, quotas and approval; output treated as untrusted |
| MCP | Future tool transport behind the same authorization/isolation layer; discovery is not permission |

Fail with `UNSUPPORTED_CAPABILITY` when tool calling/structured output is required but unavailable; never silently fall back to parsing arbitrary text into executable instructions. Allow only an explicitly configured safe non-tool fallback. Credentials remain server-side secret references. Enforce request/total deadlines, token/concurrency/cost limits, cancellation support reporting, output size limits and safe redaction. Tool side effects require independent idempotency and audit; retrying a model request is not permission to repeat a side effect.

## Decisions to close during implementation

ORM/migration tool, backend runtime version, auth mechanism/identity provider, event retention, result size limit, provider catalog and hosting remain unselected. T02/T03 must record choices and constraints. Phase 1 assumes one configured owner scope and authenticated local API; multiuser membership is FUTURE, but ownership columns/checks start now. City bindings and external runtime semantics require Phase 2/3 design validation against actual integrations.

## T02 scope resolution

The target above remains the T01 plan. [T02 implementation record](backend-foundation.md) describes the additive HTTP foundation now implemented. Following the explicit T02 requirements, the empty contracts package, Docker/Compose/database configuration, authentication and WebSocket dependency are deferred. Only public liveness is exposed; authentication/ownership remain required before protected APIs. NestJS 11/TypeScript with Express and Node 24 were selected, retaining root/browser ESM and an API-local CommonJS boundary. No frontend configuration/client or business execution was added.

## T03 persistence decision

[T03 database record](database-foundation.md) supersedes the previously unselected ORM/infrastructure decisions: Drizzle with pg, explicit SQL migrations, an injectable DatabaseModule and PostgreSQL-only Compose are now implemented. Database configuration remains optional for liveness-only startup and mandatory for persistence/migrations; configured connectivity failure stops API startup. No startup migration or schema synchronization occurs. Binding storage is included without NPC synchronization. There are no seeded owners/agents/orchestrators, runtime workers, protected APIs, event publishers or authentication implementation. Runtime role and owner-authorization requirements are documented for T04.

## T04 implemented checkpoint (2026-10-21)

The [Agent Registry](agent-registry.md) implements `/api/v1/agents` through the existing NestJS module/DatabaseService boundary. No frontend, package, schema or migration change is needed. Real authentication remains absent: the user-authorized T04 exception is an opt-in single-owner, bearer-credential, literal-loopback development mode, rejected in production. This narrows the original pre-auth proposal; it does not claim production authorization. Registration remains independent of runtime connectivity. Row-locked version checks, scoped lookups and atomic agent/event/audit/outbox writes preserve the planned control-plane boundary. No provider/framework dependency or execution path is added.

## T05 implemented checkpoint (2026-10-21)

[Task & Execution Persistence](task-execution-persistence.md) now implements CREATED tasks without attempts, owner/key canonical idempotency and scoped paginated reads. Internal attempt allocation uses a parent-row lock and existing uniqueness/active-attempt constraints; its transaction-aware variant lets T06 compose a later queue transition atomically. Task/attempt creation appends audit/events/outbox in the same transaction, with no publisher. The explicit T05 persistence-only requirement supersedes the earlier T01 immediate queue/attempt proposal; T06 owns scheduling/lifecycle. Existing T04 access checks are shared across all protected routes and fail closed in production. No city/provider/framework/runtime dependency is added. One additive task ordering index supports the actual list/date queries.

## T06 implemented checkpoint (2026-10-21)

[Task Lifecycle Service](lifecycle-service.md) implements internal Task/Execution state machines in a dedicated additive module. It reuses the T05 allocator and T03 schema/locks/constraints, requires expected versions, coordinates paired writes and history/audit/outbox atomically, and preserves terminal/older attempts. Repeated commands conflict rather than silently succeed. Cancellation and timeout are persisted decisions only; the T01 runtime/lease/recovery/retry and confirmed process-stop plan remains future work, following the explicit T06 exclusions. No new route, schema, dependency or frontend integration is introduced. Domain errors are transport-independent and code-only; future worker adapters must add real identity/claims and runtime fact validation before use.

## T07 implemented checkpoint (2026-10-21)

[Event Contracts & Audit History](event-audit-foundation.md) centralizes typed/runtime-validated event construction in EventsModule. Registry, Task/attempt creation and lifecycle coordinators call it within their existing transactions; no nested transaction or post-commit write is introduced. Correlation joins paired facts and new pending-allocation/queue facts. Existing event names and historical rows are preserved, with explicit invalid/unsupported read envelopes. Indexed owner-scoped history APIs are read-only. The owner-stream trigger retains scoped committed ordering; there is no global-order or transport-delivery claim. One additive migration introduces history indexes and duplicate protection limited to the new writer source. Earlier transport/gateway proposals remain future work under the explicit T07 exclusions.
