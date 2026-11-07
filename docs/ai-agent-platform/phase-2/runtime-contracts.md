# Phase 2 T02 — Runtime contracts and execution context

**T12 acceptance (2026-10-24): ACCEPTED WITH LIMITATIONS for local development only.** See [the acceptance report](acceptance.md) for 173 backend, 89 isolated PostgreSQL and 51 city tests, both builds, browser smoke and live installed Ollama text/calculator evidence. Live OpenAI was NOT RUN. External production exposure remains BLOCKED without production identity/access controls. Earlier task checkpoints below are historical evidence.

T09 update: [LLM Agent Strategy](llm-agent.md) adds optional trusted instructions, neutral structured calls/results and opaque continuation, optional providerId result metadata and known abort-reason preservation. Original T02/T08 records below remain historical.

T08 update: [safe tools](safe-tools.md) extends the existing tool contracts and registers AUTHORIZED_TOOL_INVOKER. Context factory provenance is now checked, but only a committed runtime claim can authorize an execution session; factory shape validation alone grants no permission. The T02 implementation/test record below is historical.

**T06 checkpoint:** [Ollama adapter](ollama-adapter.md) now supplies native nonstreaming text generation and a pinned/limited HTTP transport, with deterministic fixtures and an actual opt-in local model probe. Earlier empty-registry/no-adapter statements below are historical. No LLM Agent Strategy or Task execution integration is added; that remains T09.

**T05 checkpoint:** [Provider foundation](provider-foundation.md) implements validated contracts, exact profile selection, isolated configuration, empty provider registry and guarded timeout/output boundaries. Historical statements below about those foundations being unimplemented are preserved snapshots. Concrete adapters, LLM strategy and network inference remain planned.

**T04 checkpoint:** [Rule-based runtime](rule-based-runtime.md) adds the genuine text.stats.v1 DI registration and trusted local execute/inspect command. Execution is still opt-in, never automatic. Earlier no-strategy/CLI-deferred statements below are the preserved T01-T03 historical record. No provider, tool, worker or city integration is added.

**Current T03 implementation:** see the [coordinator guide](runtime-coordinator.md) for internal invocation, registered strategy resolution, database claims, result persistence, cancellation and verified boundaries. The earlier status/design below is retained as the T01/T02 historical snapshot; it does not override the current guide. No concrete strategy/provider/tool is enabled.

Status: **IMPLEMENTED, inert contracts/context only**, 2026-10-21. The existing `apps/api` NestJS/strict TypeScript backend is reused. There is no strategy implementation, coordinator, registry of executable tools/providers, runtime route, model call, worker, persistence change or city integration. T03–T12 remain planned.

## Repository findings and scope

The [Phase 1 acceptance report](../phase-1-acceptance.md) was reviewed with current Agent/Task/Execution/lifecycle/event/configuration/test/CI code. Phase 1's documented local-development acceptance remains the foundation; no production authentication is inferred. [T01 architecture](runtime-architecture.md) selected server-owned versioned definitions, existing lifecycle transactions, native authority and optional providers. Agent Registry configuration is still category/color only; no runtime settings are added to that DTO in T02. Task creation/reads and Execution history are unchanged.

No applicable AGENTS.md or Git metadata exists in this export. A pre-edit hash inventory protects unrelated files; no clean Git-tree claim is possible. Existing Node 24/npm scripts and dependency versions remain unchanged. No ORM/framework/dependency installation is needed.

## Implemented structure

Under `apps/api/src/runtime/`:

| File | Public responsibility |
| --- | --- |
| `runtime.module.ts` | Nest module providing/exporting ExecutionContextFactory and its symbol alias; no lifecycle/startup hook |
| `tokens/runtime.tokens.ts` | RUNTIME_CONTEXT_FACTORY (bound); RUNTIME_STRATEGIES, LLM_PROVIDERS and AUTHORIZED_TOOL_INVOKER (intentionally unbound future keys) |
| `context/execution-context.factory.ts` | Injectable factory, safe metadata normalization, deadline/signal/grant checks and scoped logger |
| `contracts/agent-strategy.contract.ts` | Provider/HTTP/DB-independent AgentStrategy interface; no implementation |
| `contracts/definition.contract.ts` | Validated, frozen RULE_BASED/LLM discriminated definitions, profile capabilities and budgets |
| `contracts/execution-request.contract.ts` | Reuses TaskInput/validation; builds immutable process-local validated requests with scoped UUIDs |
| `contracts/execution-context.contract.ts` | Read-only context/logger/metrics types and cooperative assertRuntimeActive helper |
| `contracts/execution-result.contract.ts` | Bounded versioned success candidate and validator; no status mutation/storage |
| `contracts/runtime-error.contract.ts` | Fixed runtime error catalog and safe JSON representation |
| `contracts/provider.contract.ts` | LlmProvider/request/context/result/capability/usage types, no adapter |
| `contracts/tool.contract.ts` | Explicit tool grant/proposal/schema-validation/invoker interfaces, no registry or handler |
| `contracts/validation.ts` | Shared closed-record, UUID, token, integer, grant and text guards |

The existing AppModule imports RuntimeModule. There is no extra application, global runtime module or cyclic dependency on database/lifecycle services. Ordinary Nest startup creates the factory only. The module can also be resolved alone with `NestFactory.createApplicationContext`; it does not require PostgreSQL, runtime environment variables or provider credentials.

## Strategy, definitions and requests

`AgentStrategy.execute(request, context): Promise<RuntimeExecutionResult>` is a plain TypeScript interface. Its `type` reuses the native subset of existing Agent types. RULE_BASED maps to `text.stats.v1` / `text.statistics.v1`; LLM maps to `llm.text.v1` / `text`. These are registered **contract identifiers**, not running handlers. EXTERNAL is deliberately excluded from native definitions, following T01 execution-authority boundaries.

`createRuntimeDefinition(unknown)` validates schemaVersion 1, definitionId/version, compatible agent/strategy/output discriminants, frozen budgets, bounded tool capabilities and (LLM only) a nonsecret provider profile. Profiles contain ID/version/model and capabilities only; unknown fields, credentials, arbitrary strategy IDs and incompatible capabilities are rejected. Runtime definitions remain separate from actual category/color registry metadata. T03 must resolve them from a trusted operator catalog and validate their binding to real DB records; T02 does not resolve or authorize one.

`createRuntimeExecutionRequest(unknown)` accepts exactly `{ids, input, definition}`. IDs include ownerId/taskId/executionId/agentId/orchestratorId/correlationId; required UUIDs normalize to lowercase. It reuses the existing TaskInput `{instruction, context?}` and its 16,000-character per-field/32 KiB aggregate validation and credential heuristics. Task input cannot add strategy/provider/tool/owner selection. The trusted definition chooses strategy type. IDs/input/definition/budgets/profiles/grants are copied and frozen.

Validated requests carry compile-time provenance and process-local WeakSet membership. JSON round-trips/plain objects cannot be passed directly to the context/result factories as validated requests. This is a construction guard, **not authentication, database existence verification or protection against privileged code calling the builder**. It retains no strong execution/session registry or current-task global state. A future process must re-read/revalidate its trusted persisted data and rebuild a request.

## Context factory and cancellation

Inject `ExecutionContextFactory` or the bound RUNTIME_CONTEXT_FACTORY token from RuntimeModule. `create` takes:

- A validated request from the internal builder.
- A future UTC deadline string (seconds or 1–3 fractional digits, `Z` required).
- The caller-owned native AbortSignal.
- Optional authorizedCapabilities (default empty) and safeAgentConfiguration (default empty).

Deadline must be valid, unexpired and no farther away than the definition's executionTimeoutMs. The output normalizes it to UTC milliseconds. Invalid dates/identifiers/unknown fields/prototypes/symbols/accessors are rejected without evaluating getters. Config permits existing category values and valid hex colors only; colors normalize to lowercase. Explicit null configuration/grant arrays are invalid, rather than aliases for defaults.

The resulting `RuntimeExecutionContext` exposes readonly IDs, Task input, definition/budget, safe metadata, authorized capability array, deadline, signal and scoped logger. Grants are trimmed/deduplicated/sorted, limited to 32 input entries and tool-prefixed tokens, then checked as a subset of definition grants and frozen. Default-deny remains even when the definition lists tools. Agent.capabilities is descriptive metadata and is not read for permission. Platform/operator policy intersection still belongs to T03/T08.

Factory attaches the exact signal and never owns/creates/aborts a controller, starts a timer, registers a worker, writes records or changes states. Already-aborted signals can be observed in a context; `assertRuntimeActive` throws CANCELLED without exposing signal.reason. The helper throws DEADLINE_EXCEEDED when current time reaches the deadline. It is a **cooperative check**, not a deadline enforcer; future coordinator/adapters must call it at safe boundaries and actively bound/abort I/O. T03 owns controllers, timer cleanup, claim fences, clock coordination and disposal. No AbortSignal in the API process can preempt arbitrary blocking JavaScript.

Conceptual use after future authorization/claim work, not a runnable T02 execution command:

```typescript
const request = createRuntimeExecutionRequest({
  ids: authorizedPersistedIdentifiers,
  input: validatedPersistedTaskInput,
  definition: resolvedApprovedDefinition,
});
const context = factory.create({
  request,
  deadlineAt: effectivePersistedDeadline,
  signal: coordinatorOwnedController.signal,
  authorizedCapabilities: policyApprovedToolCapabilities,
  safeAgentConfiguration: validatedAgentMetadata,
});
assertRuntimeActive(context);
// No strategy exists or runs in T02.
```

## Results and errors

`createRuntimeExecutionResult(value, request)` returns a deeply frozen `RuntimeExecutionResult`: schemaVersion 1, matching executionId, typed output, optional exact-profile metadata, nullable bounded token usage, and optional bounded tool count. Result output must match the validated definition:

- `text.statistics.v1`: finite nonnegative integer code-point/word/nonempty-line counts, each bounded by the existing instruction limit; words/lines cannot exceed code points. This validates candidate shape, not correctness of a counting algorithm, which belongs to T04.
- `text`: nonblank bounded text, control/known credential-pattern checks. This is a heuristic safety check, not proof prose is free of all sensitive data.

The **entire serialized UTF-8 result**, including metadata, must fit the definition maxResultBytes (hard ceiling 32 KiB). Provider metadata must match its approved profile ID/model/version; usage counts are integers/null with consistent totals when all known. Unknown properties such as status, arbitrary metadata, headers, keys or SDK objects reject. No successful result contains authoritative lifecycle status, timestamps, result UUID or a persistence operation. T03 must revalidate the candidate, insert into existing execution_results and finish Task/Execution/events/audit atomically; PostgreSQL's own 64 KiB check also remains in force.

Strategy failure uses RuntimeError (or future normalization of unexpected exceptions), not a result falsely reporting success. The stable catalog follows T01: INVALID_INPUT, DEFINITION_UNAVAILABLE, ACCESS_DENIED, UNSUPPORTED_CAPABILITY, CAPACITY_EXCEEDED, PROVIDER_UNAVAILABLE, PROVIDER_AUTH_FAILED, PROVIDER_RATE_LIMITED, MODEL_UNAVAILABLE, INVALID_PROVIDER_OUTPUT, OUTPUT_LIMIT_EXCEEDED, TOOL_DENIED, TOOL_FAILED, DEADLINE_EXCEEDED, CANCELLED, LEASE_LOST, OUTCOME_UNCERTAIN, PERSISTENCE_UNAVAILABLE. T02 additionally defines CONFIGURATION_ERROR, STRATEGY_NOT_FOUND and INTERNAL_RUNTIME_ERROR to distinguish configuration/dispatch/unexpected failures without complex inheritance.

Each code has a fixed safe message. Optional internal stage is a closed enum only; arbitrary diagnostics/cause/provider text is not accepted. Invalid code supplied by JavaScript normalizes to INTERNAL_RUNTIME_ERROR. Error JSON contains only `{code,message}`; stack and stage are excluded. These codes are not new database status values or additions to closed v1 audit payloads. Their eventual lifecycle/audit mapping remains T03 work.

## Provider and tool boundaries

LlmProvider defines id, capabilities(profile), and asynchronous generate(request, context). Types include closed message roles, output-token cap, text output request, optional authorized tool descriptions, a configured nonsecret model/profile, UTC deadline, AbortSignal, optional nullable usage and final-text versus tool-proposal results. Tool arguments are explicitly unknown until their schema parser validates them. No SDK types, endpoints/credentials, HTTP response objects or provider imports occur in these contracts.

Capabilities distinguish structured-output knowledge, tool proposals, transport abort and uncertain/best-effort remote cancellation. The first request contract is text-only; JSON/schema execution is intentionally unsupported for now. Capability declarations do not implement adapters or runtime validation of actual network messages. T05–T09 must enforce token/byte/round/transport/profile capability rules at dispatch and response boundaries. There is no generate implementation or provider registered today.

Tool contracts define identifiers/capabilities/immutable grants, proposal/result/context, closed-schema parser obligations with byte/time limits and an AuthorizedToolInvoker interface. No registry, calculator, handler, shell, file, SQL, HTTP tool or invoker is implemented/provided. The context **does not expose an executable tools object**: this deliberately defers T01's conceptual tools field to T08 instead of installing a misleading stub in T02. Future implementations must intersect operator/agent/model policy, validate every input/output and keep credentials/DB/context input out of tool contexts.

## Security review: enforced versus deferred

| Implemented now and tested | Still required before execution |
| --- | --- |
| Closed shape checks, UUID/deadline validity, native discriminants, copies/freezing, bounded definitions/grants/results and credential-field rejection | DB existence/ownership/ACTIVE Agent/ENABLED native route checks; trusted definition resolver/catalog/digest/snapshot at allocation |
| Signal propagation and cooperative cancellation/deadline check; no automatic timers/actions | Runtime opt-in authorization, effective deadline persistence, active I/O abort and cleanup, leases/fencing/heartbeats/recovery |
| Granted subset validation/default deny; no tool access implementation | Full platform/operator policy intersection, tool registry/schema/invocation controls |
| No credentials in serializable request/context; protected logger API | Provider credentials/endpoint/SSRF/proxy policy, actual model capabilities, token/cost/concurrency enforcement |
| Versioned bounded success candidates, safe error JSON, no status field | Atomic result/state/event persistence, unexpected exception normalization and domain error mapping |

Context/request input and infrastructure fields are non-enumerable and their JSON views expose only scoped IDs and definition reference (plus context deadline). Ordinary JSON serialization, spreading and default inspection omit input/configuration/abort reason; runtime code can still deliberately access those properties. This is accidental-disclosure protection, not an isolation boundary against trusted code or hostile Proxies. Never pass raw contexts/provider objects into arbitrary loggers/audit writers or inspect with hidden fields enabled.

The context logger supports only fixed diagnostic/budget events, bounded duration/provider-request/tool counters and known error codes, with IDs attached automatically. It rejects raw text, prompt, headers, unknown keys and arbitrary errors. Context construction itself logs nothing. Actual runtime metrics/events remain deferred; these logger events do not claim a lifecycle transition happened. Generic TypeScript interfaces are not security controls without the validators and later execution policy.

## Verification and changes

Executed on 2026-10-21:

| Command/check | Result |
| --- | --- |
| `npm.cmd run check:api` | PASS, strict TypeScript; an initial optional-property typing mismatch was corrected before acceptance |
| `npm.cmd run build` | PASS |
| `node --test apps/api/test/runtime-contracts.test.cjs` after build | 16/16 passed, no database/provider required |
| `npm.cmd run lint` | PASS: existing JS syntax checks + API strict typecheck; no separate ESLint configuration exists |
| `npm.cmd run test:all` | 51/51 city and 61/61 backend tests passed (45 existing + 16 new), zero skips/failures |
| `npm.cmd run test:db` | 49/49 real PostgreSQL integration tests passed, including registry/Task/Execution/audit/lifecycle/concurrency/migration/restart acceptance |
| `npm.cmd run build:web` | PASS, 35 modules into an owned temporary directory, removed without overwriting city source |
| `npm.cmd run db:check` | PASS, existing migration journal unchanged |

Runtime tests cover definition/request validation, every missing/malformed ID, immutable copies, correlation, null/unknown/prototype/accessor inputs, deadline and cancellation distinction (including prototype-spoofed signal rejection), grants, safe configuration/logging/serialization, matching results, exact UTF-8 result limit, usage/error safety and standalone DI. Startup test replaces fetch/socket/pg connection methods with failing sentinels: RuntimeModule resolves without touching them or binding a strategy/provider/tool. A separate factory test rejects timer creation. Existing CI discovers the new `*.test.cjs` automatically; its configuration is unchanged. Hosted CI was not submitted. Browser visuals were not rechecked in T02; city build/simulation tests and baseline hashes establish the stated preservation scope.

Created 12 runtime TypeScript files listed above, `apps/api/test/runtime-contracts.test.cjs`, and this document. Existing AppModule receives the inert module import; other existing backend services, DTOs, tests, schema, migration files, dependency/config/CI/deployment and city source remain unchanged. Documentation indexes and roadmap statuses are updated. No database records or real provider fixtures are created by the new unit tests.

Modified-file inventory: `apps/api/src/app.module.ts`, root `README.md`/`WORKSPACE.md`, platform `README.md`/`phase-1-implementation-plan.md`, and Phase 2 `README.md`/`implementation-plan.md`/`runtime-architecture.md`/`provider-abstraction.md`/`tool-security.md`. No files removed. Final SHA-256 comparison confirms all 51 city source/assets and nine migration SQL/metadata files unchanged; AppModule is the only changed preexisting non-Markdown file. Documentation checks passed for 49 local links, index links and balanced fences. The disposable test container/volume inspection found no remaining test-labeled resources. Final backend rerun after adding native AbortSignal brand validation passed 61/61; the guard's prototype-spoof regression is included in the existing cancellation test group.

Next: **Phase 2 T03 — Runtime Coordinator & Lifecycle Integration**. T03 must implement the audited authorization, snapshot and transaction/lease seams before any concrete strategy is enabled. T02 alone provides no real agent execution.
