# Start Elyqreth and connect Agents locally

T16 handover preparation, 2026-11-07 (Asia/Bangkok). This is the consolidated entry point for local development. It requires **no private production configuration**. Commands below are instructions for your deliberately selected development workspace, not a claim that this session started your database, accounts, providers or application. Package scripts and implementation were inspected; fresh tests/builds and historical integration evidence are distinguished in the [handover report](operations-handover.md).

## Tools and workspace

Use the Elyqreth repository root with Node 24 (see `.node-version` and package engines), the existing npm lockfile, and Docker Desktop/Linux containers for PostgreSQL-backed development or isolated integration tests. Native backup operations need PostgreSQL 17 client tools; optional LangGraph reference tooling needs the Python environment in its own guide. Browser acceptance requires the installed supported browser. Neither Ollama, paid OpenAI access, LangGraph nor production secrets are required for the decorative city or ordinary unit tests.

`dist/` is maintained city source, not disposable build output. Never clean or overwrite it with a generic build script. `apps/api/dist/` is generated backend output. Never run volume deletion, broad Docker prune or reset commands to solve local setup problems. Existing local databases and configuration belong to their operator.

On a fresh approved checkout, install the locked workspace dependencies:

```powershell
npm.cmd ci
```

PowerShell examples use npm.cmd to avoid npm.ps1 execution-policy issues. Other shells can use npm. This installation command was not rerun for documentation-only work; existing lockfile dependencies were used for verification. The supplied export has no .git: do not invent history, a source SHA or a canonical remote.

## Start the city without backend data

```powershell
npm.cmd run dev:web -- --host 127.0.0.1 --port 5173 --strictPort
```

Open `http://127.0.0.1:5173`. The explicit loopback override matters because the existing Vite configuration otherwise permits a broad development bind. This is a development server, never a public production endpoint. The decorative Icy White city, camera, NPC movement and animation can run without authenticating to a backend. Backend-enabled panels require their separate configured session/access profile; a rendered city is not proof that an Agent is connected.

Stop only the server started in that terminal with Ctrl+C. Do not terminate unrelated Node processes.

## Start a local backend

Preserve existing root `.env` and `apps/api/.env`. If absent, manually copy the respective [.env.example](../../../.env.example) and [API example](../../../apps/api/.env.example), then replace development placeholders privately. Do not overwrite an existing file or copy production values into development. Root `.env` is for development Compose substitution; API settings belong in `apps/api/.env` or backend process injection. Process environment takes precedence. The browser never receives these files or VITE_* secrets.

With optional features disabled, the API can start for liveness without a database. In another root terminal:

```powershell
npm.cmd run dev:api
```

The default API endpoint is `http://127.0.0.1:3001/health`. A 200 proves process liveness only, not database/runtime/business readiness. Existing configured feature flags may require a database or other prerequisites and fail safely if incomplete. For a compiled local API, use `npm.cmd run build`, then `npm.cmd run start:api`; do not run watch and compiled servers on the same port simultaneously. Do not change NODE_ENV or disable authentication to bypass a production failure.

There is **no separate worker start command**. The native coordinator runs in the API process or a deliberately invoked trusted local command. There is no broker/Redis/cache service to start.

## Add PostgreSQL and migrations for actual Agent work

Before any mutating command, confirm the selected Compose project, endpoint, database and credentials are your intended local development resources. Root `.env` must contain your local POSTGRES_PASSWORD; the example placeholder is not a usable or production credential. Do not change passwords on an existing initialized volume by assumption: environment changes do not re-provision existing database roles.

```powershell
docker compose up -d postgres
docker compose ps postgres
```

This starts only the existing PG17 service with loopback publication and a persistent named volume. It is a selected persistent development environment, not one of the disposable test databases. Do not run this command blindly if a different service already owns the configured port. The full development Compose stack disables Agent/runtime APIs and is not a ready-made authenticated Agent installation.

Configure DATABASE_URL and DATABASE_SSL_MODE in the API-only environment for that exact local target. Application requests should use a restricted runtime role. Use a separate maintenance process/identity for migrations; never give bootstrap credentials to a business API. See the [current role provisioning and target checks](database-migrations.md); older Phase 1 setup descriptions are historical and do not replace T07.

After deliberately selecting your migration configuration:

```powershell
npm.cmd run build
node apps/api/dist/database/migrate.js --preflight
npm.cmd run db:migrate
```

Preflight is read-only with respect to schema, but connects to the configured DB and takes the existing maintenance lock. It is not permission to migrate an unknown target. Apply only to your approved development database. On lock, permission, connection or journal mismatch, stop and follow the T07 failure runbook; never edit migration metadata, run automatic schema synchronization, retry forever or drop existing state. API startup never applies migrations.

## Select access and provision actual identities

Choose one supported local access profile, without mixing credentials:

| Profile | When to use | Exact instructions |
| --- | --- | --- |
| Named local accounts | Existing private-operator browser/API workflow | [Local accounts and session setup](authentication-modes.md#local-accounts-and-sessions), including secure stdin account provisioning |
| OIDC | You have an explicitly reviewed issuer/public keys/audience/subject grants | [OIDC API-token verification](authentication-modes.md#oidc-api-token-verification); current UI takes an API token, not an issuer redirect/PKCE flow |
| Legacy trusted loopback development tokens | Reproduce the earlier isolated native/external development examples | [Rule-based local workflow](../phase-2/rule-based-runtime.md#local-workflow-powershell) and [reference integration](../phase-5/reference-integration.md); never expose or use as a production fallback |

For account mode, set AUTH_MODE=local or oidc and remove legacy audience tokens and delegated city-interaction token mode. Do not combine account-mode instructions with token-mode snippets from older guides. Current T03/T04 instructions supersede the historical statement that authentication is unimplemented. No default account, public registration or implicit owner is created.

An administrator must first provision the real local owner and intended orchestrator route in the selected DB, using the existing schema/administrative procedure linked from the [Agent Registry guide](../agent-registry.md). Keep returned UUIDs; do not invent references or treat a logical route as proof of connectivity. `auth:account` provisions an account into an existing owner, not a new tenant. The guide's secure stdin procedure avoids passwords in argv/logs; do not save its request in a tracked file.

The frontend uses only validated public mode JSON and memory-only credentials; see [frontend configuration and session lifecycle](frontend-access.md). Local mode signs in with the provisioned username/password; OIDC takes a suitable API access token. `/api/v1/auth/me` confirms the principal. Refreshing loses browser credentials by design. Logout/401 clears protected panels, requests and polling; 403/404 object denial does not fabricate logout. Cookie/CSRF/refresh configuration is not required by this bearer contract.

## Register, activate and run a native Agent

1. Follow the protected [Agent Registry API](../agent-registry.md) to register an Agent with the real same-owner orchestrator UUID. New Agents start DISABLED. Registry metadata and category/color JSON do not grant runtime/tool/provider authority.
2. Activate using the observed revision/If-Match contract; do not change lifecycle records through SQL. The [rule-based workflow](../phase-2/rule-based-runtime.md#local-workflow-powershell) contains an exact register/activate/Task example for the explicitly selected legacy development profile. In account mode use the corresponding authenticated account session, not a second development credential.
3. Configure reviewed RUNTIME_BINDINGS on the backend with actual Agent/orchestrator IDs and the compiled `text.stats.v1` definition. Enable RUNTIME_ENABLED only after prerequisites are valid. Environment changes affect the next process start, not an already running API.
4. Submit through the existing Task UI/API and dispatch through the native Execution controls. Persistence of a Task is not proof of successful Execution. Follow canonical state/results/history and inspect errors/attempts before any retry.
5. The existing trusted local CLI supports the following for a deliberately configured development target. The first command starts work; the second inspects. A second command process must not race another native writer for the same work:

```powershell
npm.cmd run runtime:execute -- --task-id ACTUAL_TASK_UUID --task-version OBSERVED_POSITIVE_INTEGER
npm.cmd run runtime:execute -- --inspect --task-id ACTUAL_TASK_UUID
```

Placeholders above are intentionally invalid until replaced. Respect admission, observed versions, lease/fencing and cancellation/timeout state; do not retry uncertain effects blindly. Production CLI use is not authorized. See [runtime operations and bounded drain](runtime-drain.md).

For city representation, a real Agent needs an explicit eligible binding, not just a matching name. Use [binding contracts](../phase-3/npc-runtime-binding.md) and `npm.cmd run city:bindings -- list` in the configured trusted local environment. This read command still opens the selected DB and requires its configured scope. Creating/reassigning/removing a binding is a separate explicit mutation using the documented commands, real IDs and observed revision. [Agent inspection and synchronization](../phase-3/agent-inspection.md) explain the projection; no new NPC behavior is introduced.

## Add an LLM provider deliberately

Plain rule-based work needs no model. For LLM Agents use the existing [LLM Agent strategy](../phase-2/llm-agent.md), [provider profile/digest contract](../phase-2/provider-foundation.md), and adapter-specific [Ollama](../phase-2/ollama-adapter.md) or [OpenAI](../phase-2/openai-adapter.md) guides. Select the actual reviewed provider/model/profile version/capabilities/digest and compile-time tool grants; no model or endpoint is inferred from Agent names, prompts or registry JSON.

Ollama needs an explicitly chosen installed local model and approved loopback endpoint. OpenAI requires backend-only credentials and explicit paid opt-in. Keep keys out of bindings/JSON/browser/argv. Tool-call support in an adapter does not prove a particular model returns valid tool inputs. Historical live Ollama and unrun live OpenAI evidence are distinct; no live provider was contacted for T16.

`npm.cmd run test:ollama:live` and `npm.cmd run test:openai:live` are opt-in diagnostics described by those guides. They are **not** ordinary offline verification commands; do not run them without an approved target/paid consent where applicable.

## Connect the external LangGraph reference

The only compiled external adapter is observation-only `langgraph.v1`. Elyqreth does not dispatch/cancel external work, create external Agents automatically or poll a provider on a scheduler. The provider remains authoritative for its Executions. There is no generic public webhook setup or signed-webhook secret to invent.

For an optional local reference, follow [pinned Python setup and loopback server startup](../../../tools/langgraph-reference/README.md). It runs the separate LangGraph dev server on 127.0.0.1:20240. It is not needed for native Agents. The explicit live acceptance command creates its own provider-side synthetic work; it is not an Elyqreth dispatch capability and was not run in T16.

For manual observation, follow the [reference registration/profile setup](../phase-5/reference-integration.md#configuration-authentication-and-transport) and [current endpoint/credential/source policy](external-connectivity.md). It needs a real same-owner ENABLED connection, source incarnation/namespace, reviewed destination pins and the supported trusted development operator/source grants. Account-mode installations cannot mint those legacy source grants. Keep this optional development reference separate; do not disable production/account authorization to make it work. Production external activation is intentionally closed.

With that explicitly selected development environment and actual IDs:

```powershell
npm.cmd run langgraph:observe -- health ACTUAL_CONNECTION_UUID
npm.cmd run langgraph:observe -- discover ACTUAL_CONNECTION_UUID
npm.cmd run langgraph:observe -- approve ACTUAL_CONNECTION_UUID ACTUAL_THREAD_UUID:ACTUAL_RUN_UUID
npm.cmd run langgraph:observe -- observe ACTUAL_CONNECTION_UUID ACTUAL_THREAD_UUID:ACTUAL_RUN_UUID
npm.cmd run langgraph:observe -- result ACTUAL_CONNECTION_UUID ACTUAL_THREAD_UUID:ACTUAL_RUN_UUID
npm.cmd run langgraph:observe -- replay ACTUAL_CONNECTION_UUID
```

`approve`, `observe` and `replay` can write local mapping/receipt/projection state; they do not start provider work. Each observation exits; no automatic external synchronization is implied. Replays preserve durable deduplication/order/owner/connection boundaries. Missing history or a deferred receipt is not success. Do not delete inbox rows, relabel foreign IDs or invent external completion to recover.

## Verify and troubleshoot safely

Ordinary local checks, independent of private production configuration:

```powershell
npm.cmd run lint
npm.cmd run test:api
npm.cmd test
npm.cmd run build
npm.cmd run build:web
python docs/ai-agent-platform/phase-6/verification-evidence/check_configuration.py
```

`lint` is the existing syntax/typecheck rollup, not an installed ESLint/Markdown lint tool. `build:web` verifies a disposable bundle and preserves maintained city source. Backend tests build first. Existing Docker/database/browser/provider test commands require their documented tools and can create owned disposable fixtures; do not substitute your database URL. T16 reuses historical heavy integration evidence rather than rerunning those exercises for documentation.

| Symptom | Investigation and safe action |
| --- | --- |
| City works but no Agent data | Expected with API/features/session/bindings absent; check configured mode, verified principal and real binding, not renderer code |
| API startup fails | Review safe invalid-field names, port ownership, role/schema/DB configuration; do not print URLs/passwords or weaken auth/TLS |
| 401 / 403 / concealed 404 | Verify current session/role and owner/operation scope; do not substitute IDs or client owner headers |
| Runtime not ready/draining | Inspect private DB/runtime state; liveness alone is insufficient; follow [runtime runbook](runtime-drain.md) |
| Migration lock/journal mismatch | Stop; inspect the selected migration target and approved history; never delete journal rows or run down migrations blindly |
| Provider observation unavailable | Check exact connection/source/profile/credential/destination and provider evidence; no automatic retry or fabricated result |
| Stuck Task/collaboration | Follow [lifecycle recovery](../phase-5/lifecycle-recovery.md) and [incident runbooks](observability.md); preserve terminal states and uncertain side effects |

Ctrl+C stops only servers you started. If deliberately pausing the chosen local PostgreSQL service, `docker compose stop postgres` retains its volume; do not use `down -v`, prune, or remove an unknown volume. Stop optional LangGraph only in its own terminal. Keep private configuration and recovery artifacts outside source/web roots. For production-only procedures and escalation roles, use the [handover/runbook index](operations-handover.md); those actions remain deferred.
