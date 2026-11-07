# Consumed configuration inventory

T02 audit, 2026-10-29. This inventory describes actual consumed names, not future infrastructure variables. See [contracts, access and troubleshooting](configuration-contracts.md), [API example](../../../apps/api/.env.example) and [root Compose example](../../../.env.example). Example values are explanatory placeholders, never production credentials. API_PORT also configures the Compose host mapping; Compose container API_PORT remains fixed at 3001. Root .env is Compose interpolation; apps/api/.env is API loading. They are distinct files and scopes.

## Application and local infrastructure

All settings are optional unless the condition/production column requires them. Disabled local registry/city/interaction token fields are unused, not an alternative production identity policy. Runtime/LLM/external dependent settings generally reject presence while disabled. Exact behavior is implemented by the linked source groups below; ambient unrelated environment names are not globally rejected.

| Name | Consumer | Type | Default / condition | Production requirement | Classification | Validation / purpose | Placeholder |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `NODE_ENV` | API/commands | enum | development | required production | private | development/test/production only; staging uses production | production |
| `API_HOST` | API | IP/localhost | 127.0.0.1 | explicit | private | IP or localhost; privileged local features require exact loopback | 127.0.0.1 |
| `API_PORT` | API | integer | 3001 | explicit | private | 1..65535 digits | 3001 |
| `CORS_ORIGINS` | API | CSV origins | localhost:5173 + 127.0.0.1:5173 HTTP | explicit | non-secret server policy | canonical exact origins; production HTTPS without development addresses | https://city.example |
| `DATABASE_URL` | API/migrator/commands | PostgreSQL URL | absent: optional dev/test DB | required | secret | user/password/host/db; no query/hash; production default/test identity rejection | postgresql://app:REPLACE@db.example/elyqreth |
| `DATABASE_SSL_MODE` | API/migrator | enum | disable dev/test; verify-full production | verify-full only | private | disable or verify-full; verified TLS mandatory production | verify-full |
| `DATABASE_POOL_MAX` | API/migrator | integer | 5 | optional bounded | private | 1..20, requires DB | 5 |
| `DATABASE_CONNECTION_TIMEOUT_MS` | API/migrator | integer ms | 5000 | optional bounded | private | 100..30000, requires DB | 5000 |
| `DATABASE_IDLE_TIMEOUT_MS` | API/migrator | integer ms | 10000 | optional bounded | private | 1000..60000, requires DB | 10000 |
| `DATABASE_STATEMENT_TIMEOUT_MS` | API/migrator | integer ms | 30000 | optional bounded | private | 100..120000; query timeout +2000; idle transaction 15000 fixed | 30000 |
| `AGENT_REGISTRY_ENABLED` | API | boolean | false | must remain false/absent | private | exact true/false; true requires DB, dev/test, exact loopback | false |
| `AGENT_REGISTRY_OWNER_ID` | API/commands | UUID | absent | not a production principal | private identity | required when registry enabled; existing owner required by services | reviewed-existing-owner-uuid |
| `AGENT_REGISTRY_TOKEN` | API/commands | token | absent | dev token never production | secret | required when enabled; 32..128 ASCII alphanumeric/_/- | GENERATE_LOCAL_ONLY |
| `CITY_READ_ENABLED` | API | boolean | false | false/absent | private | true requires local registry | false |
| `CITY_READ_TOKEN` | API | token | absent | not a production session | secret; limited local browser audience | 32..128 safe chars; distinct operator token | GENERATE_DISTINCT_LOCAL_ONLY |
| `CITY_READ_CITY_ID` | API | literal | elyqreth | disabled feature | non-secret | when enabled only elyqreth accepted | elyqreth |
| `CITY_INTERACTION_ENABLED` | API | boolean | false | false/absent | private | true requires registry/dev-test/loopback | false |
| `CITY_INTERACTION_TOKEN` | API | token | absent | not a production session | secret; limited local browser audience | 32..128; distinct registry and city-read tokens | GENERATE_DISTINCT_LOCAL_ONLY |
| `CITY_INTERACTION_AGENT_IDS` | API | JSON UUID list | required when enabled | disabled feature | private allowlist | nonempty <=20 unique UUIDs, <=1600 bytes | [reviewed UUIDs] |
| `CITY_INTERACTION_TEXT_AGENT_IDS` | API | JSON UUID list | [] | disabled feature | private disclosure policy | <=20; subset of interaction IDs; <=1600 bytes | [] |
| `COLLABORATION_READ_ENABLED` | API | boolean | false | false/absent | private | true requires local registry/dev-test/loopback | false |
| `COLLABORATION_READ_TOKEN` | API | token | absent | not a production session | secret; limited local browser audience | 32..128; distinct operator/city/interaction/provider secrets | GENERATE_DISTINCT_LOCAL_ONLY |
| `RUNTIME_ENABLED` | API/commands | boolean | false | false/absent | private | true requires registry and dev/test | false |
| `RUNTIME_BINDINGS` | API/commands | JSON array | required when enabled | disabled feature | private policy; may contain instructions | <=32768 bytes, <=64 closed bindings, unique Agent UUID, compiled definition budgets | [] |
| `RUNTIME_DRAIN_TIMEOUT_MS` | API/native CLI | integer milliseconds | optional only when runtime enabled | 15000 | private operational policy | 100..20000; fixed additional 5000 finalization, HTTP hard stop 30000, container grace 45000 | 15000; [runtime guide](runtime-drain.md) |
| `RUNTIME_TOOLS_ENABLED` | API | boolean | false | false/absent | private | requires runtime; no implicit invocation | false |
| `RUNTIME_TOOL_ALLOWLIST` | API | JSON string list | absent | disabled feature | private grants | required if tools enabled; <=256 bytes, <=2 compiled capabilities, no duplicate | [tool.calculator.v1] |
| `RUNTIME_LLM_ENABLED` | API | boolean | false | false/absent | private | requires runtime/profile catalog | false |
| `LLM_ALLOW_PAID` | API | boolean | false | disabled feature | private consent | exact true for public provider credentials; rejected when LLM disabled | false |
| `LLM_PROFILES` | API | JSON profiles | required when enabled | disabled feature | private model/endpoint policy; no literal credentials | <=32768 bytes, 1..16 unique profiles; closed schema, compiled providers/SSRF allowlist | reviewed profile JSON |
| `LLM_REQUEST_TIMEOUT_MS` | API | integer ms | 60000 | disabled feature | private | 1..120000 when LLM enabled | 60000 |
| `LLM_MAX_OUTPUT_TOKENS` | API | integer | 512 | disabled feature | private | 1..4096 when LLM enabled | 512 |
| `*_API_KEY` | API | dynamic credential reference | absent | disabled feature | secret | profile credentialEnv name [A-Z][A-Z0-9_]{0,47}_API_KEY; printable ASCII 8..4096 bytes; e.g. OPENAI_API_KEY | INJECT_BACKEND_ONLY |
| `EXTERNAL_ORCHESTRATORS_ENABLED` | API/commands | boolean | false | false/absent | private | true requires registry/dev-test; no production connection bypass | false |
| `EXTERNAL_ORCHESTRATORS` | API/commands | JSON connection list | absent | disabled feature | private endpoint/owner/reference config | <=32768 bytes, <=16 unique connections; owner matches registry; closed schema; compiled adapter initialization | reviewed connection JSON |
| `EXTERNAL_SECRET_*` | API/commands | dynamic token reference | absent | external activation remains closed | secret | EXTERNAL_SECRET_[A-Z0-9_]{1,80}; 8..4096 printable ASCII; required when referenced; distinct reference and value per connection; existing _FILE injection | INJECT_BACKEND_ONLY |
| `POSTGRES_USER` | Compose/local launcher | string | elyqreth | local-only stack | private | official image init role; launcher URL-encodes; production role must be separately reviewed | elyqreth |
| `POSTGRES_PASSWORD` | Compose/local launcher | password | required Compose interpolation | local-only stack | secret | required root ignored env; never put real values in examples | replace_with_a_local_password |
| `POSTGRES_DB` | Compose/local launcher | DB name | elyqreth | local-only stack | private | official image initialization; backend DB parser validates generated URL | elyqreth |
| `POSTGRES_PORT` | Compose | host port | 5432 | not a production exposure contract | private | local host mapping 127.0.0.1; Docker validates published port | 5432 |
| `WEB_PORT` | Compose | host port | 8080 | local-only mapping | non-secret | 127.0.0.1 mapping; also used in exact local CORS | 8080 |

## Named-account authentication extension (2026-10-30)

The user authorized local username/password accounts as an alternative to OIDC, with **one mode per installation**. This supersedes earlier inventory statements that no user-account authentication exists. See [current guide](authentication-modes.md). Earlier rows describing local-only flags/tokens remain the default disabled-mode behavior; an explicitly validated account mode replaces tokens and allows supported native/read services under verified viewer/operator principals. External production connectivity and frontend session integration remain separate gates.

| Name | Consumer | Type/default | Production/security contract | Placeholder |
| --- | --- | --- | --- | --- |
| AUTH_MODE | API/account CLI | disabled, local or oidc; default disabled | Backend-only policy. Exclusive mode, DB and enabled existing registry owner required. Both/fallback modes and legacy bearer token settings rejected; external adapter enablement remains blocked in account modes pending T10 | local |
| AUTH_SESSION_SECONDS | Local API sessions | integer, default 3600 | Local only; 300..86400; rejected in disabled/OIDC mode. Opaque DB sessions, no signing-secret knob | 3600 |
| AUTH_OIDC_ISSUER | OIDC verifier | required URL | HTTPS in production; nonproduction loopback HTTP exception only; exact issuer, no credential/query/fragment | https://identity.example/realms/elyqreth |
| AUTH_OIDC_AUDIENCE | OIDC verifier | required exact API identifier <=200 chars | Not frontend client audience or wildcard; not taken from untrusted token | elyqreth-api |
| AUTH_OIDC_JWKS | OIDC verifier | required public JSON <=32768 bytes | Reviewed public keys only; <=16 published/<=8 accepted RS256 RSA signing keys; no automatic URL fetch; private material rejected | reviewed public JWKS JSON |
| AUTH_OIDC_SUBJECTS | OIDC authorization | required JSON <=32768 bytes, 1..64 unique subject/role entries | Private grant policy. Exact subject -> viewer/operator within existing installation owner; token roles/user headers ignored | [{"subject":"approved-subject","role":"operator"}] |
| ELYQRETH_KEYCLOAK_LIVE | Test harness only | true opt-in via test:keycloak:live | Disposable pinned Keycloak/PG fixtures only, not a production auth shortcut | true |

[auth-configuration.ts](../../../apps/api/src/auth/auth-configuration.ts) owns validation; [authentication-modes.md](authentication-modes.md) documents access tokens, local accounts, CLI, sessions, rotation and limits. No AUTH_* value is frontend public configuration. AGENT_REGISTRY_OWNER_ID remains the existing owner setting, not a second duplicated AUTH_OWNER_ID. Local sessions/accounts are persisted in PostgreSQL, not environment JSON. AUTH_SESSION_SECONDS is irrelevant to OIDC JWTs, which have a fixed maximum age of one hour and 30-second clock tolerance.

## Schema and source ownership

- Bootstrap/env merge, host/port/CORS: [configuration.ts](../../../apps/api/src/config/configuration.ts). Process-defined values override optional API env file, no environment mutation.
- Database URL/pool/TLS: [database-configuration.ts](../../../apps/api/src/database/database-configuration.ts), [pool.ts](../../../apps/api/src/database/pool.ts). URLs may not override TLS with a query parameter. A file/CA setting is not yet supported.
- Registry: [registry-configuration.ts](../../../apps/api/src/agents/registry-configuration.ts); browser audiences: [city-read](../../../apps/api/src/city/city-read.configuration.ts), [interaction](../../../apps/api/src/interaction/interaction.configuration.ts), [collaboration-read](../../../apps/api/src/city/collaboration-read.configuration.ts). Tokens are never baked into browser assets; limited local tokens are entered interactively, unlike backend-only operator/provider credentials.
- Runtime definitions/tools: [runtime-configuration.ts](../../../apps/api/src/runtime/runtime-configuration.ts). Per-definition execution/retry/output/tool budgets are validated JSON policy, not duplicate worker env settings. Existing one-slot concurrency, lease/heartbeat, recovery batch/backoff and shutdown limits remain code policy. This task does not alter execution semantics.
- Model profiles: [provider-configuration.ts](../../../apps/api/src/runtime/providers/provider-configuration.ts). Ollama accepts reviewed local endpoints only; OpenAI has fixed HTTPS origin and paid consent; credentials resolve privately by reference. Capability declarations are validated against compiled adapters.
- External profiles: [external-configuration.ts](../../../apps/api/src/external-orchestrators/external-configuration.ts), [adapter registry](../../../apps/api/src/external-orchestrators/adapter-registry.ts), [startup validation](../../../apps/api/src/external-orchestrators/external-adapter.service.ts), [LangGraph validation](../../../apps/api/src/external-orchestrators/langgraph.adapter.ts). Fields: id/ownerId/adapterType/name/namespace/generation/mode/enabled/endpoint/credentialRef/capabilities; no raw secrets. Endpoint public HTTPS or reviewed trusted local with exact addresses; transport revalidates DNS/peer, no redirects, bounded bytes/time. LangGraph is observation-only. Dispatch/cancel cannot be enabled through capability JSON.
- Ingestion has no public webhook env or arbitrary verification-secret switch: [ingestion-authority.ts](../../../apps/api/src/external-orchestrators/ingestion-authority.ts). Internal trusted source grants bind owner/connection/namespace/generation, expire after 5 minutes; normalized event <=12000 bytes, recovery batch <=20. External transport budget is request 5000 ms/connect 1000 ms/response 65536 bytes/concurrency 4; not new env knobs.
- Compose/launcher: [docker-compose.yml](../../../docker-compose.yml), [api-start.cjs](../../../docker/api-start.cjs). Local launcher creates DATABASE_URL from POSTGRES_* only when URL absent and password supplied; defaults generated SSL mode to disable, intentionally rejected in production. Do not use this dev convenience to select a production DB. Existing Compose remains unchanged.

No direct application frontend environment keys exist. Vite `envPrefix: []` disables automatic VITE_* exposure; built-in development/build metadata is not a credential channel. API origins are manually supplied local runtime client settings, validated in [http-transport.js](../../../dist/js/runtime/http-transport.js). No SSR/Node frontend, session signing secret, cookie domain, CSRF secret, proxy trust, event-retention knob, metrics exporter or worker/broker/cache env exists. Those cannot be configured by inventing names. Logging is current structured stdout; liveness returns constants.

## Rejected aliases and ambiguous settings

`LLM_PROVIDER`, `LLM_MODEL`, `LLM_DEFAULT_PROVIDER`, `LLM_ENABLED_PROFILES`, `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `OPENAI_MODEL`, `OPENAI_ENABLED` are rejected aliases (including when LLM is disabled). They do not select a model or grant consent. Use a validated exact profile instead. NODE_ENV=staging is rejected; staging is a separately isolated deployment using production settings. POSTGRES_* are local infrastructure inputs, not substitutes for explicit production DATABASE_URL. Existing DATABASE_* extras without a URL fail. No unused compatibility aliases were added.

## Tooling, CI and optional live diagnostics

These are command-scoped controls, not production configuration and never frontend public variables. Do not reuse developer/provider secrets in CI. Generic OS executable/temp lookup variables are inherited tooling context only; they do not select production identity or application privileges.

| Names | Consumer / type / default and requirement | Classification / validation / example |
| --- | --- | --- |
| BROWSER_PATH | browser-smoke / executable path; auto-detect installed browser if absent | Private local path; CI example /usr/bin/google-chrome; optional |
| BROWSER_BASE_URL | browser-smoke / optional URL; starts owned Vite if absent | Trusted test origin only; validates loopback, no arbitrary public target |
| BROWSER_SCREENSHOT, BROWSER_RUNTIME_SCREENSHOT, CITY_ACCEPTANCE_SCREENSHOT | browser-smoke / optional output paths | Private test artifact paths; no secrets; use disposable temp paths |
| BROWSER_HARDENING_PHASE4, BROWSER_PROFILE_PHASE3 | browser-smoke / explicit true opt-ins, otherwise off | Non-secret test flags; assertions/profiles only |
| BROWSER_HARDENING_REPORT | browser-smoke / optional output path | Private test JSON path, not a server setting |
| ELYQRETH_CITY_E2E, ELYQRETH_CITY_E2E_BROWSER, ELYQRETH_TASK_PANEL_E2E, ELYQRETH_INTERACTION_E2E, ELYQRETH_COLLABORATION_E2E | isolated integration/browser harness / true opt-ins, otherwise off | Test-only; owned isolated PG/children and deterministic fixtures, not production auth shortcuts |
| ELYQRETH_OLLAMA_RUNTIME_LIVE, ELYQRETH_OLLAMA_RUNTIME_MODEL | optional isolated runtime integration / true opt-in and reviewed model | Private local model selection; not ordinary CI or production configuration |
| TEST_ORIGIN | test-only HTTP subprocess fixture / trusted owned local URL | Synthetic test harness input, never an API server setting |
| INTERACTION_E2E_ARTIFACT_DIR | interaction integration harness / optional output directory | Private local artifact path; CI uses runner temp |
| ELYQRETH_LANGGRAPH_LIVE | explicit optional reference test / true opt-in | Requires separately running pinned disposable reference server; never ordinary CI dependency |
| ELYQRETH_OPENAI_LIVE, ELYQRETH_OPENAI_LIVE_PROFILE | paid diagnostic / true opt-in plus exact enabled OpenAI profile | Private reviewed profile; explicit paid consent/real key required, never executed by T02 |
| ELYQRETH_OLLAMA_LIVE, ELYQRETH_OLLAMA_LIVE_ORIGIN, ELYQRETH_OLLAMA_LIVE_MODEL, ELYQRETH_OLLAMA_LIVE_DIGEST | optional local diagnostic / off, origin default http://127.0.0.1:11434, selected model required, digest optional | Private reviewed local model identity; rejects production; no fallback provider |
| TMPDIR, TEMP, TMP, PATH, SystemRoot, PROGRAMFILES and browser executable discovery paths | Node/OS/test artifact/executable discovery; inherited platform defaults | Toolchain context, not app access policy; no credential contents in reports |
| LOG_JSON, LANGSMITH_TRACING, LANGCHAIN_TRACING_V2, PYTHONUTF8 | optional upstream LangGraph dev launcher only / documented true,false,false,1 | Outside Elyqreth config; no telemetry secrets; see pinned reference README |

See [CI](../../../.github/workflows/verify.yml), [browser harness](../../../scripts/browser-smoke.mjs), [database harness](../../../apps/api/test/database.integration.cjs), [live probes](../../../apps/api/test/ollama.live.cjs) and [reference setup](../../../tools/langgraph-reference/README.md). Test harnesses may construct synthetic process environments; no production endpoint consumes ELYQRETH_* flags. Dependency/framework-internal environment variables are not re-exported into an application contract. No deployment registry/CI secret or production secret has been created.


## T04 frontend access contract (2026-10-30)

`dist/access-config.json` consumes only `mode: disabled|local|oidc`; default disabled. It is public non-secret runtime configuration, bounded to 1 KiB and restricted to exact fields. Account APIs are same-origin HTTPS or HTTP loopback development; no API-origin, owner, bearer, password, provider key or secret is accepted in this file. Mode is a UI choice that must match backend AUTH_MODE, never an authorization grant. See [frontend access](frontend-access.md). No new application environment variable was introduced.

The disposable authentication browser fixture consumes `ACCESS_TEST_ORIGIN` (HTTPS loopback test URL), `ACCESS_TEST_PASSWORD` (synthetic account credential, private process environment only) and `ACCESS_TEST_SPKI` (public ephemeral test certificate pin). They are test-runner inputs, never frontend build variables or production application configuration. Installed OpenSSL/Chromium and Docker are test prerequisites; no production secret is generated.


## T05 file inputs and packaging (2026-11-04)

| Setting | Owner/type/default | Contract and classification |
| --- | --- | --- |
| DATABASE_URL_FILE | Backend and separate migrator; optional absolute file path; no default | Backend-only secret reference; mutually exclusive with DATABASE_URL; production immediate /run/secrets file; 64 KiB max, bounded UTF-8 read and permissions; same existing database validator |
| DATABASE_SSL_CA_FILE | Backend/migrator; optional absolute certificate path; no default | Public CA PEM material, backend TLS input; 1..16 certs/64 KiB max, verify-full only, no TLS bypass; required by the example production Compose profile |
| AGENT_REGISTRY_TOKEN_FILE, CITY_READ_TOKEN_FILE, CITY_INTERACTION_TOKEN_FILE, COLLABORATION_READ_TOKEN_FILE | Backend development audiences; optional paths; no defaults | Backend-only secret references; existing account modes still reject these audiences; file injection grants no new privilege |
| Existing credentialEnv *_API_KEY_FILE and EXTERNAL_SECRET_*_FILE | Backend provider/reference input; optional paths | Exact existing key/reference name grammars; value/file ambiguity denied; no new provider, capability or production enablement |
| API_IMAGE, WEB_IMAGE | Production Compose only; required reviewed image references | Non-secret immutable release references; no automatic publication/deployment |
| API_CONFIGURATION_FILE | Production Compose only; required backend non-secret env-file path | Existing mode/owner/origin/feature configuration; no credential values; example docker/production-api.env.example |
| DATABASE_URL_SECRET_FILE, MIGRATION_DATABASE_URL_SECRET_FILE | Production Compose only; required protected host file paths | Private references, separate service mounts; not DATABASE_URL strings or baked image values |
| DATABASE_CA_FILE | Production Compose only; required host CA PEM path | Public certificate input mapped to DATABASE_SSL_CA_FILE; no private key |
| PUBLIC_ORIGIN | Production Compose migration service; required canonical HTTPS origin | Non-secret; existing validator enforces HTTPS origin constraints |
| PUBLIC_ACCESS_CONFIG_FILE | Production Compose static web; defaults to dist/access-config.json | Public exact T04 mode JSON; no owner/token/provider data |

No new worker, queue, cache, session-signing secret or trusted-proxy configuration is introduced. Readiness cache (1 second), probe wait (1.5 seconds), driver probe query timeout (1 second), shutdown ceiling (30 seconds), Compose resource limits and restart budget are explicit packaging constants, not duplicate environment settings. See [container contracts](container-hardening.md) for file permission limits, CA rotation, readiness access and verification.

## T06 edge inputs (2026-11-05)

These belong to the edge image/Compose overlay, not backend or frontend bundles. See [edge/network contracts](edge-network.md).

| Setting | Owner/type/default | Contract and classification |
| --- | --- | --- |
| EDGE_IMAGE | Compose; required image reference | Non-secret reviewed immutable edge artifact; no build secret |
| EDGE_HOST | Edge/Compose; required DNS hostname | Public canonical lower-case bounded hostname; no URL, wildcard, directives or arbitrary template input |
| EDGE_HTTPS_PORT | Edge image; optional integer/default 443 | Public HTTPS authority port 1?65535; production overlay forces 443; random loopback port in disposable tests |
| EDGE_HSTS | Edge image; enum on/off/default on | Production overlay forces on; local test explicitly off, never frontend data |
| EDGE_TLS_CERTIFICATE_FILE | Compose; required protected host path | Public full-chain certificate reference mounted read-only; no certificate contents in environment/image |
| EDGE_TLS_PRIVATE_KEY_FILE | Compose; required protected host path | Backend-edge-only private key reference; readable by UID/GID 101 with strict Linux file modes; no key value in environment/image/browser |
| ELYQRETH_EDGE_BROWSER | Test runner only; optional/default enabled | Setting false skips the real Chromium test and is not full T06 acceptance; never a deployment/authentication setting |

The edge fixes resolver/upstreams/limits to reviewed packaging constants. Backend proxy trust remains disabled and no arbitrary proxy-CIDR or origin override is introduced. T05's existing API_IMAGE/WEB_IMAGE/PUBLIC_ORIGIN/config/secret references remain unchanged. The edge adds no public ingestion verification secret because there is no HTTP ingestion endpoint.

## T07 migration target and access policy

| Setting | Owner / type / default | Production validation and classification |
| --- | --- | --- |
| DATABASE_MIGRATION_TARGET | Dedicated migrator/preflight and production Compose; database identifier; no default | Required by production migration/preflight, exact URL and actual database match; private non-secret; never a browser setting. API serve does not require it. Existing DATABASE_URL/DATABASE_URL_FILE carry distinct runtime or migration credentials per service |

The bootstrap-owned role contract is database metadata, not another environment source. See [role provisioning and migration safety](database-migrations.md). Bootstrap uses the existing backend secret-file reader only in an explicit operator process; no bootstrap secret is added to application Compose.

## T08 operator recovery inputs

Recovery commands reuse existing backend DATABASE_URL/DATABASE_URL_FILE, NODE_ENV and DATABASE_SSL_MODE/CA validation. No backup credentials or key are added to API/web Compose or public configuration. The stdin-only contracts (directory, expectedDatabase/expectedHost, keyFile, explicit isolated target confirmation, retention anchor/keep/dryRun and role/password provisioning) are documented in [backup/recovery](backup-recovery.md). `RECOVERY_KEY_FILE` is a diagnostic file-field label, not a consumed environment variable.

The maintenance process generates transient backend-only libpq child settings PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD, PGSSLMODE, PGSSLROOTCERT, PGCONNECT_TIMEOUT, PGAPPNAME and PGOPTIONS from the validated database configuration. Inherited PG* and DATABASE_* settings are removed before database client invocation; these generated settings are not an alternate public connection source. Native clients receive no connection URL/password in argv. A private CA is written only to the private operation scratch directory and cleaned up normally. PostgreSQL clients must be major 17. See the guide for key storage, Windows ACL requirements, plaintext scratch and process-environment inspection limits.
