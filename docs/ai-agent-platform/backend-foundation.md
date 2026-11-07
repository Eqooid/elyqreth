# T02 — Backend foundation and workspace integration

This is the historical T02 implementation record. Current repository location, additional modules, reproducible verification/CI commands and Phase 1 acceptance are recorded in the [T08 report](phase-1-acceptance.md). `apps/api` remains the sole backend; no separate backend README is needed. Root `build` builds the API; `build:web` now checks a disposable frontend bundle without changing static hosting.

Status: **IMPLEMENTED**, limited to HTTP/backend foundation. No agent, task, execution, orchestration, database, LLM, tool or realtime business functionality is implemented.

## Preflight and structure

Implementation root: `C:\Users\user\Desktop\Project\Elyqreth-source\elyqreth`. The complete city source was present, and T01 documents were available in the sibling Elyqreth documentation workspace. No applicable AGENTS.md or existing backend/Docker configuration was found. This export has no Git metadata; branch/revision/unrelated tracked-change status cannot be determined. A 160-file SHA-256 baseline was recorded before changes instead.

```text
dist/                         existing hand-maintained static city, unchanged
tests/                        existing 51 city tests, unchanged
scripts/check.mjs             existing city syntax check, unchanged
vite.config.js                existing frontend configuration, unchanged
.openai/hosting.json           existing static deployment configuration, unchanged
apps/api/
  src/main.ts                 process bootstrap and safe startup failure
  src/application.ts          reusable application factory and HTTP timeouts
  src/app.module.ts           module registration
  src/config/                 validated environment, injectable configuration
  src/health/                 GET /health
  src/common/                 safe errors, JSON logging, HTTP defaults
  test/foundation.test.cjs     real HTTP tests and test-only validation fixture
  .env.example
  package.json, tsconfig.json
  dist/                       generated API output, ignored
docs/ai-agent-platform/        T01 documents plus this T02 implementation record
package.json, package-lock.json
.node-version                 Node 24 release line
```

The root is an npm workspace containing `apps/*`. The frontend remains in dist; apps/web was not introduced. The API has its own CommonJS package boundary while the root/browser remain ESM. TypeScript strictness, decorator metadata, unchecked-index and exact-optional checks are enabled. Existing root dev/check/test commands retain their previous meanings.

T01's additive integration decision is retained. Deliberate scope adjustments following T02 requirements: no empty contracts package, no database/Compose, no placeholder authentication, and no WebSocket adapter dependency. Only public liveness exists; authentication/authorization are a mandatory gate before future protected business endpoints. The T01 architecture remains a target, not a description of completed platform features.

## Install and development

Use a maintained **Node 24.x** patch release and npm 11. The implementation was verified on the available Node 24.9.0/npm 11.6.2; that observation is not a recommendation to freeze an old patch. Runtime packages use NestJS 11; exact resolved package versions are recorded in apps/api/package.json and the root lockfile. No globally installed Nest CLI is needed.

From the source root:

```sh
npm ci
npm run dev:web
```

In a separate terminal, independently:

```sh
npm run dev:api
```

Vite normally serves the city at http://localhost:5173; if that port is occupied it may choose another port. Set the API origin allowlist explicitly if using that alternate port later. The API binds http://127.0.0.1:3001 by default. No backend is needed to open/use the city. On PowerShell hosts where npm.ps1 is blocked by execution policy, use `npm.cmd` instead of changing machine policy.

Compiled local launch (still development configuration unless NODE_ENV is explicitly set):

```sh
npm run build
npm run start:api
```

Build invokes the pinned TypeScript compiler and writes only apps/api/dist. The existing frontend is buildless; it has no historical build command and requires no compilation. Do not run a new Vite output build into the hand-maintained root dist. The static-server workflow in the original README continues to work independently. The API dev command uses tsc-watch to compile/restart on successful TypeScript changes; a type error prevents a new restart and must be fixed before the next successful reload.

| Command | Actual responsibility |
| --- | --- |
| npm run dev / dev:web | Existing city Vite server |
| npm run dev:api | TypeScript watch/compile and API restart |
| npm run build | API TypeScript compilation only |
| npm run start:api | Run previously compiled API |
| npm run check | Existing city JS syntax checks |
| npm run check:api | Strict API type check without emit |
| npm run lint | City syntax + API type checks; no ESLint/style checker is claimed |
| npm test | Existing city tests only, preserved |
| npm run test:api | Compile API then run Node backend tests |
| npm run test:all | Existing city suite followed by backend suite |

## Configuration

Current production requirements are tightened by [Phase 6 T02](phase-6/configuration-contracts.md): explicit bind/port/HTTPS origins and verified PostgreSQL configuration. Local privileges remain disabled in production; this historical foundation does not establish production access.

Optionally copy apps/api/.env.example to apps/api/.env. No .env file or secret is committed. API configuration resolves independently of the command's working directory: explicit process environment > apps/api/.env > documented development defaults. File loading does not mutate process.env. Only the named settings are read; inherited unrelated environment variables are not reported/logged.

| Variable | Default and validation |
| --- | --- |
| NODE_ENV | development; only development, test, production |
| API_HOST | 127.0.0.1; valid IPv4/IPv6 literal or localhost. Nonlocal binding is explicit |
| API_PORT | 3001; decimal integer 1–65535, no empty/partial/fractional values |
| CORS_ORIGINS | development/test: http://localhost:5173,http://127.0.0.1:5173; production: explicit HTTPS nondevelopment origins required |

Origins are exact canonical HTTP(S) origins separated by commas; no wildcard, credentials, paths, query, fragment, trailing slash or empty list items. Duplicates are removed. Invalid configuration stops startup with exit code 1 and offending field names only, without values or stack traces. The supported port can still be unavailable; listen failure exits safely instead of silently switching ports.

.gitignore excludes .env/.env.* (except .env.example), PEM/key files, node_modules and apps/api/dist. There are no database, model, broker or cloud credentials/configuration. Production deployment requires its own secret policy when real credentials are introduced.

## Health and HTTP behavior

```http
GET /health
```

Returns HTTP 200:

```json
{"status":"ok","service":"elyqreth-api"}
```

This proves only that the HTTP application responds, not platform readiness, persistence, external connectivity or agent health. No DB/LLM call or environment data is included. No /api prefix is introduced. Unknown routes and unsupported health methods return safe correlated 404 responses; no agent/task endpoints exist.

Global validation transforms explicit DTOs, rejects unknown fields/objects, disables implicit primitive coercion and omits validation target/value details. Health accepts no input DTO; a test-only controller verifies validation behavior without adding a fake production endpoint.

JSON and URL-encoded request bodies are limited to 64 KiB; form parameters to 100. HTTP request/header/keepalive timeouts are 30/10/5 seconds. The default Express powered-by header is disabled; responses set nosniff and no-store. Server-side exceptions produce generic status/message/requestId JSON without paths, stack traces or original exception messages. Oversized/invalid parsed bodies return 413/400 safely.

X-Request-Id is reused only when it matches 1–64 ASCII alphanumeric/dot/underscore/hyphen characters; otherwise a UUID is generated. It appears in response headers, errors and structured request logs. Do not put sensitive data in identifiers. Logs include timestamp, event, method, matched route template (or unmatched), status and duration. They omit URL/query, request/response bodies, headers, credentials and arbitrary exception text. Startup failures report safe field names or a generic message.

SIGINT/SIGTERM use Nest shutdown hooks; application/server close supports resource cleanup. There are no workers, database pools or background execution tasks. Process signal semantics depend on the host; Windows forced termination is not equivalent to a Unix graceful signal.

## Security assumptions and frontend boundary

This foundation intentionally has **no authentication implementation**. /health is public liveness. CORS controls browser response access, not access by scripts/curl and not authentication. Allowed origin requests receive exact Access-Control-Allow-Origin; disallowed origins receive no allow header. Credentials are disabled; Authorization/Content-Type/X-Request-Id headers are permitted for a future authenticated client. Future cookie auth requires a deliberate credentials/CSRF review.

Use loopback locally. Before public deployment or protected features, add real authentication/authorization, owner-scoped APIs, quotas/rate limits, TLS/reverse-proxy policy and audited secret handling. There is no auth bypass disguised as a development guard. Existing Vite binding to 0.0.0.0 is unchanged and is not the API binding policy. Proxy trust is not enabled implicitly.

The frontend entry remains dist/index.html → dist/js/app.js. app.js constructs Simulation/TownRenderer/GameLoop. No API client, frontend environment-variable convention, fetch/WebSocket calls or network-backed execution existed. No configuration helper was added because it would be unused. Existing decorative behavior remains backend-independent.

Future HTTP client configuration should be explicit runtime configuration (for static hosting) or a deliberately introduced Vite mechanism; never embed backend credentials in browser variables. Future realtime uses authenticated transport and a separate execution projection plus narrow NPC bridge as specified in T01, with replay/snapshot fallback. No socket callbacks or backend states are wired into movement/animation or the current City Hall UI.

## Infrastructure and limitations

Dockerfile/Compose are deferred: local Node/npm already run both sides, and there is no deployable persistence/service topology to containerize in T02. No image/port exposure or frontend hosting changes were made. Future Docker should use a supported pinned Node image, npm ci, nonroot runtime and explicit API host/ports, with secrets injected at runtime. Static Sites hosting still serves only dist and does not automatically run Nest or provide Git/source export.

No Git history was fabricated. T01 was copied as documentation with relative source links rebased; its historical findings/decisions remain intact. Its original provenance describes the earlier sibling documentation location. New implementation status is recorded here rather than relabeling planned agent functionality as implemented.

Verification evidence is recorded below after actual execution. No browser-rendering/FPS claim is implied by source preservation and model tests. Next: **Phase 1 T03 — Database Schema & Migrations**. Do not begin automatically; protected API work still requires the auth gate.

## Verification record

- `npm.cmd ci`: passed from the source root; 147 packages installed, 149 audited, zero reported vulnerabilities. The root lockfile reproduces both frontend and API dependencies.
- `npm.cmd run test:all`: passed **51 city tests + 12 API tests**, zero failures/skips. API tests exercise actual ephemeral-port HTTP servers, environment precedence/failure, CORS, request IDs, safe body/error handling, log redaction, unsupported routes, global DTO validation and application close. Test fixtures are not compiled into the production API.
- `npm.cmd run lint`: passed all city-module syntax checks and API strict no-emit TypeScript check. This command is static syntax/type verification, not an ESLint style analysis.
- `npm.cmd run build`: passed independently after restoring the reload-smoke file; emitted only API-local output.
- `npm.cmd run dev -- --host 127.0.0.1 --port 5173 --strictPort`: Vite 6.4.4 started; GET /, /js/app.js and /assets/characters.png returned 200. The city still returned 200 after stopping the API.
- `npm.cmd run dev:api`: watch compilation passed, health returned the exact expected 200 JSON, and a temporary whitespace-only change in the new health controller caused successful recompilation/restart. The exact source file was restored afterward.
- `npm.cmd run start:api`: compiled API started and served the exact expected 200 health JSON with the city server stopped. Test/development servers were stopped after verification.
- Preflight SHA-256 comparison: **156 of 160 original source files unchanged**. The only changed originals are package.json, package-lock.json, .gitignore and README.md. All original dist files (including rendering, NPCs, movement, camera, environmental systems, UI, styles and assets), tests, scripts, Vite config, hosting metadata, historical docs and reference artifacts are unchanged.
- Documentation local-link and fence checks passed. Source T01 links were rebased to the integrated tree; original historical documents were not removed. No source files were deleted.

Fresh browser visual/interaction/FPS checks were not performed; HTTP serving checks, all original simulation tests and byte-for-byte city preservation passed. No frontend build was run because this application is buildless and had no frontend build script. Windows Ctrl+C termination and application close were exercised; Unix graceful-signal behavior was not executed on this Windows host. There is no Git diff because this export has no .git directory.

### Changed files

Modified originals: package.json, package-lock.json, .gitignore, README.md. Added .node-version.

Added API files: apps/api/package.json, tsconfig.json, .env.example; src/main.ts, application.ts, app.module.ts; src/config/configuration.ts and config.module.ts; src/common/api-logger.ts and http-foundation.ts; src/health/health.controller.ts and health.module.ts; test/foundation.test.cjs. Generated apps/api/dist and installed node_modules are ignored build/install artifacts.

Added source documentation: docs/ai-agent-platform/README.md, existing-system-audit.md, architecture.md, domain-model.md, orchestration-contracts.md, task-lifecycle.md, event-contracts.md, city-integration.md, security-and-reliability.md and phase-1-implementation-plan.md (preserved T01 planning with rebased source links and appended T02 status where appropriate), plus backend-foundation.md. The sibling T01 index/architecture were appended with T02 links and the same backend record is available there. Removed files: none.

Official references used when selecting/configuring the foundation: [Nest first steps](https://docs.nestjs.com/first-steps), [Nest configuration](https://docs.nestjs.com/techniques/configuration), [Nest validation](https://docs.nestjs.com/techniques/validation), [Node release policy](https://nodejs.org/en/about/previous-releases). Package versions are exact in the manifest/lockfile; no latest-version claim is needed.
