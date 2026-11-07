ï»¿# Containers, secret files and readiness

**T05 COMPLETE for locally verified production packaging**, 2026-11-04, Asia/Bangkok. This is the Phase 6 T05 packaging contract for the existing private-operator local/OIDC application. No cloud resource, production database, production credential, remote deployment or edge proxy is created. [T01 decisions](decisions.md), [configuration contracts](configuration-contracts.md), [authentication](authentication-modes.md) and [frontend access](frontend-access.md) remain authoritative. Exact verification and preservation evidence is recorded in [T05 evidence](verification-evidence/container-hardening-verification.json).

## Recovery audit and requirement matrix

No applicable AGENTS.md was found. The supplied workspace has no Git metadata, so status/staged/diff inspection cannot establish a Git-clean state. A SHA-256 baseline preserves pre-existing work, including ignored environment files without printing their contents. Root `dist/` is maintained city source, not a disposable build output.

| Area | Before T05 | Implemented contract |
| --- | --- | --- |
| Topology | COMPLETE: static web, one API/native runtime, PostgreSQL, explicit migrator | Reused; no worker, Redis, broker or new orchestrator |
| Dockerfiles | PARTIAL: multi-stage/npm lockfile/non-root already existed; floating bases and development-default API | Immutable version/digest bases, production default, production-only dependencies, no runtime package manager/build tools |
| Build context | PARTIAL: broad directory context could include local tools/venv/artifacts | Exact allowlist plus final private env/key/cache exclusions |
| Configuration | COMPLETE T02/T03 validator; file/CA inputs missing | Existing validator consumes bounded backend file inputs, verified DB CA and no ambiguous direct/file fallback |
| API health | PARTIAL: process-only liveness | Separate local-peer readiness, database/schema/migration compatibility, startup gate and drain rejection |
| Web readiness | PARTIAL: nginx process only | Required assets and exact bounded public JSON validated before nginx starts and on container probes |
| Worker readiness | NOT APPLICABLE | No dedicated worker process or consumer exists; native runtime initializes/drains inside the API |
| Shutdown | PARTIAL: existing Nest/runtime hooks and 5-second cooperative cancellation | Preserved hooks plus immediate readiness/admission drain, PID 1 signals and 30-second serve-process ceiling |
| Production profile | MISSING | Separate Compose packaging profile, private services, bounded restart/resource/log policies and external managed-DB connection |
| Verification/docs | PARTIAL: development Compose/browser tests existed | Production TLS/file/readiness/native/restart tests, schema-drift integration, updated guides/evidence |

Current follow-up: [T06](edge-network.md) adds the explicit edge overlay and TLS/network verification; T05 results below retain their task-date scope.

## Image and process boundaries

One Dockerfile retains `api-build`, `api` and `web` targets. Verified official references:

- Node **24.22.2-alpine**, index digest `sha256:8a32c8cf649a49915a66e81e7a609223c708d0adabf288ee3f4077d765542f85` for builder and API runtime.
- nginx **1.30.6-alpine-slim**, index digest `sha256:dede8895648b461178c3bc604f7eed4423efe5220b2c4d839f5eb3d34ac3f8f7` for static web.
- Development/test PostgreSQL remains its existing pinned 17.11 image; no migration SQL or existing database is reset.

Tags and digest/version metadata were resolved from the official registry, not guessed from a framework version. Updating pins requires a reviewed rebuild, vulnerability scan and this verification suite; this is not an automatic update policy. `npm ci` and the existing lockfile install the build graph; `npm prune --omit=dev` selects runtime packages. The installed runtime dependency graph was inspected and contains no external .node addons; Node crypto/scrypt and verified PostgreSQL TLS are exercised in the Alpine container workflow. Future native dependencies require a compatible musl build and a new compatibility review. No host node_modules, Git metadata, .env, tests, references or local Python environment enter the allowlisted context. There are no secret build arguments or build-time credential requirements. Network access to official base registries and the npm registry is an external build dependency; dependency and base integrity pins remain checked.

The API runtime contains compiled Nest code, production dependencies, migrations/journal and explicit Node startup/health commands. UID/GID **1000:1000** runs root-owned application files. npm/npx/corepack/yarn are removed from the final API image; use direct Node maintenance entrypoints. There is no separate Node frontend server/SSR. The reviewed minimal variants remove unused OS/module packages found by the initial scan; no CVE ignore list is introduced. The web image copies maintained `dist/` intact, including runtime-loaded sprite assets, and runs nginx as **101:101** with its existing Icy White source/theme unchanged. Web startup validates, runs `nginx -t`, then `exec`s nginx; no privileged runtime chown or environment substitution is performed.

The same API image runs explicit `serve`, `migrate`, account provisioning and other established maintenance commands. No migration runs on ordinary API startup. There is no worker image, broker consumer or second execution engine. PostgreSQL owns durable native work, identity mappings, inbox/projections, audit and opaque sessions. API/web layers hold no durable business data. Web startup writes only a validated enum JSON snapshot to its bounded `/tmp` mount; nginx serves that snapshot rather than the operator input mount. Private or invalid fields added to a live input therefore cannot become a public response.

Build locally, without publishing:

```powershell
docker build --target api -t elyqreth-api:review .
docker build --target web -t elyqreth-web:review .
```

`build:web` remains the disposable bundle verifier, not an instruction to overwrite maintained source or the image's complete static tree. Reproducibility here means pinned inputs/lockfile and a clean isolated build context, not an unmeasured claim of byte-identical timestamps or fleet portability. Container tests verify linux/amd64 on the available Docker engine; other architectures are not claimed tested.

## Secret and certificate inputs

All normal environment settings remain supported. `loadConfiguration` resolves backend file inputs into a private copy before invoking the same existing validation; it does not write plaintext secrets into process.env or expose a new configuration API.

Supported file inputs are:

- `DATABASE_URL_FILE`.
- Existing development audience counterparts: `AGENT_REGISTRY_TOKEN_FILE`, `CITY_READ_TOKEN_FILE`, `CITY_INTERACTION_TOKEN_FILE`, `COLLABORATION_READ_TOKEN_FILE`. Existing account modes still reject these legacy credentials; file injection does not introduce a fallback.
- Existing provider credential references: `<credentialEnv>_FILE`, where the existing LLM key name matches `[A-Z][A-Z0-9_]{0,47}_API_KEY`, and `EXTERNAL_SECRET_<NAME>_FILE` under the existing external reference grammar. These only supply credentials; they cannot enable a provider, change capabilities or bypass the current production external-integration gate.

A value and its `_FILE` form together are rejected. Missing, empty, relative, oversized, non-regular, invalid UTF-8 or NUL-containing file inputs fail safely. Linux no-follow opens reject symlinks; development on other platforms follows their filesystem guarantees. File reads allocate at most 64 KiB plus one detection byte, including protection against growth after stat. Exactly one trailing line ending is removed; leading/trailing spaces are not broadly normalized. Errors contain field names or safe categories, not file contents or secret URLs.

Production secret paths must be immediate files under `/run/secrets`. On Linux, files must be owned by root or the application UID, deny group/world writes, and deny world reads. A common mount contract is root:1000 with `0440`, or application-owned `0400`. The process must actually be able to read the file. No root bootstrap copies/chowns secrets on application startup. Windows host permission semantics are not used as proof of Linux permissions; positive/negative permissions are tested inside Linux containers.

`DATABASE_SSL_CA_FILE` is a public certificate input, not a secret. It must be an absolute readable regular file, at most 64 KiB, containing 1..16 parseable PEM certificates and no other material; writable-by-group/world files are rejected in production. It is legal only with `DATABASE_SSL_MODE=verify-full`. The existing node-postgres connection receives `{rejectUnauthorized:true, ca}` with hostname verification intact. No connection-string query parameter or CA file enables TLS bypass. Omit the file to retain Node's normal CA roots outside the example profile; the production Compose contract explicitly requires a selected database CA file.

The development-only launcher may still derive DATABASE_URL from the existing Compose POSTGRES settings. It **never** synthesizes a production URL or silently selects unverified TLS. The launcher passes resolved configuration directly to the existing API or migrator. It does not mutate process.env with a derived production secret.

Mounted files are read once during configuration load. Rotate with a reviewed secret replacement and single-instance drain/restart; do not assume live rotation. Existing local account password/role/disable/session revocation remains through T03. Opaque local sessions require no invented signing secret. OIDC JWKS/issuer/audience/subject grants remain their existing reviewed public verification configuration.

Environment injection is retained for compatibility but values may be visible in container metadata and process environments. File injection keeps values out of Config.Env; paths remain visible, and plaintext values necessarily exist in application memory. Host administrators/Docker daemon access can read mounts and memory. Compose file-backed secrets are bind mounts, not an encrypted vault; Compose does not reliably remap file ownership/mode. Set host ownership/ACLs before mounting, and verify inside the target Linux environment. See [official Compose secret behavior](https://docs.docker.com/compose/how-tos/use-secrets/) and [service secret permission limitations](https://docs.docker.com/reference/compose-file/services/). No secret-management platform is added.

## Liveness, readiness and startup

| Probe | Contract |
| --- | --- |
| API `GET /health` | Existing public process liveness, no database/provider readiness claim; no secrets or dependency details |
| API `GET /ready` | Only exact loopback socket peers; never Host/forwarded-header assertions, browser principals or external bridge peers. 200 ready or safe 503; other peers get 404/closed access |
| API Docker health | Node probes `/ready` inside the same network namespace with a 2-second deadline; image healthcheck timeout 3 seconds |
| Web Docker health | Validate required static files/public JSON and probe nginx's existing local `/health`; requires no authenticated browser session |
| Worker | Not applicable: no independent worker exists; adding one later requires its own verified readiness contract |

Readiness is false before application bootstrap and during drain. Config validation and normal module initialization complete before listening. Production bootstrap additionally requires database connectivity, the exact ordered migration hash/version journal and all mapped application tables. It fails startup against a missing/incompatible schema, without running a migration. Development/test retain their historical ability to start a liveness-only API; configured but unmigrated databases then report not ready.

A read-only probe uses bounded SQL checks, one shared flight, a one-second result cache and a 1.5-second HTTP/probe wait. Driver query timeouts are one second; the validated pool acquisition timeout still applies to a single underlying flight if the pool is saturated. Repeated HTTP timeouts cannot spawn a new flight until that one settles. No Task payload, result, row count or provider network call is needed. Required app-role permissions include SELECT on the Drizzle migration journal and catalog lookups; T07 owns complete production role provisioning/acceptance.

Database loss or journal drift removes readiness while process liveness remains up. Recovery can restore readiness from persisted compatible state. Optional LLM/external-provider outages never make the API fail liveness or become new mandatory readiness dependencies. Readiness is not a capacity/concurrency claim or an external Execution status. The future edge must exclude `/ready` from public routing, especially if it connects over same-host loopback; no proxy trust is enabled by this task. Image/container probes do not use a reusable privileged bearer.

Startup has no arbitrary sleep loop. A missing dependency fails within configured bounds. Development Compose preserves its existing healthy-PostgreSQL -> one migrator completion -> API ordering. The production profile runs migrations only through the maintenance profile and leaves ordinary API startup fail-closed. No migration is launched independently by each replica.

## Shutdown, persistence and logs

Node runs as PID 1 with explicit SIGTERM. T09 now gives actual HTTP bootstrap one signal owner and a shared [native admission/drain host](runtime-drain.md). Runtime readiness closes immediately, existing work receives validated grace (default 15 seconds, maximum 20), then cooperative cancellation/finalization gets five seconds. Application-wide middleware drain and HTTP/database closure follow. The serve-process watchdog exits nonzero after 30 seconds if shutdown cannot finish; Compose retains 45 seconds before forced termination. Linux SIGUSR2 requests native-only drain while authorized inspection and external observations remain available.

A deadline or lost acknowledgement is **not** a fabricated terminal state. Existing leases, cancellation quarantine and restart reconciliation remain authoritative. No automatic uncertain-work replay or lease reset is added. T05 tests quiescent SIGTERM, successful work persistence, API recreation and PostgreSQL restart. T09 adds real active-work clean/deadline PID1 signal verification via `node scripts/container-hardening.mjs --runtime-drain`; see its separate evidence. Production cutover remains an authorized operational task, not a claim that all active workloads naturally finish during stop.

nginx uses SIGQUIT for graceful worker termination, exec forwarding and a 15-second Compose grace. There is no public worker admin/health service. No uploads, persistent app cache or generated local business files exist; the public mode snapshot is disposable non-secret scratch data. API/web use read-only root filesystems with a bounded noexec/nosuid `/tmp` mount. Production services drop all capabilities, use no-new-privileges, have a 128 PID limit, finite memory/CPU limits and bounded json-file log rotation. API/web restart is limited to three failures; migration never restarts automatically. Invalid configuration must be corrected explicitly rather than hidden behind an application retry loop. Resource defaults are conservative packaging limits, not benchmark/capacity acceptance; T14 measures them.

Structured API logs remain on stdout/stderr with existing safe correlation. Shutdown emits `api_draining`; watchdog expiration emits a safe failure category. Readiness polls do not emit routine request/error floods. Successful liveness request logging is sampled at most once per minute; other existing request logs retain safe templates and omit query/body/credentials. nginx's health access logging remains disabled. No monitoring platform is introduced. Production requests must use uncompressed JSON/form bodies (identity or absent Content-Encoding); other encodings return 415 before body parsing/authentication. The supported frontend already sends plain JSON. This keeps optional compressed-body decoders out of the public production request path; development/test behavior remains compatible. OS package scanning alone does not prove every vendored Node library unaffected, so this boundary also avoids unnecessary decoder exposure.

## Separate production packaging profile

`docker-compose.production.yml` is a standalone packaging contract, not an overlay of development Compose and not a deployed environment. It follows T01's conditional **B baseline**: one app host, an external private managed PostgreSQL endpoint, and the same API image for separately invoked migration. It does not choose a vendor, buy a database or silently instantiate the alternative A self-hosted database. If A is later selected, volume/backup/role readiness requires its separately approved profile.

No service publishes ports in this profile. API has an application bridge for the approved private DB route; web has an internal presentation network. There is no new edge proxy, TLS terminator, firewall or unrestricted readiness publication. T06 supplies approved routing/ingress/private-network controls. There are no public API/database/worker ports, host network/privileged flags, source bind mounts or Docker socket mounts.

Required Compose inputs (operator-provided paths/references, not app secret values):

- `API_IMAGE`, `WEB_IMAGE`: reviewed immutable digest references for the paired build. Local verification uses private local tags; release promotion/provenance belongs to T12.
- `API_CONFIGURATION_FILE`: backend-only non-secret environment file based on `docker/production-api.env.example`; actual existing owner, mode, origins and feature/runtime bindings are explicit. Never put raw credentials here.
- `DATABASE_URL_SECRET_FILE`: app-role database URL file; only API mounts this secret.
- `MIGRATION_DATABASE_URL_SECRET_FILE`: separate migration-role URL file; only the maintenance service mounts it.
- `DATABASE_CA_FILE`: selected verified database CA PEM.
- `PUBLIC_ORIGIN`: canonical HTTPS origin for migration configuration validation.
- `PUBLIC_ACCESS_CONFIG_FILE`: non-secret exact T04 `{mode}` JSON, defaulting to the shipped disabled file and mounted outside the web root at `/run/config/access-config.json`. Select a mode matching backend AUTH_MODE; public JSON never supplies credentials or owner grants.

The profile forces production mode, the container bind/port, verified DB TLS and secret mount paths. Optional external/LLM services can remain off. It never enables production through legacy development tokens. Existing development `.env`/Compose workflow remains unchanged.

Validate with a private operator environment file (values must exist; do not paste secrets into shell history):

```powershell
docker compose --env-file PATH_TO_PRIVATE_COMPOSE_INPUTS -f docker-compose.production.yml config --quiet
```

Do not print an expanded configuration containing environment-injected secrets. The example file contains placeholders and is deliberately not sufficient to launch a real installation. For a separately approved local/staging target, run the one-shot maintenance service before starting API/web, then verify namespace-local readiness. This documentation is not permission to execute a production migration or deploy anything. The local test harness performs this ordering only against its owned disposable PostgreSQL.

Managed PostgreSQL storage/backup is external to this Compose profile. The unchanged development Compose uses its named postgres_data volume. Do not remove existing volumes. Volume persistence is not backup acceptance: T07/T08 cover app/migrator privileges, storage operations, off-host backup and measured restore. No destructive database initialization/reset or migration SQL change is introduced.

## Verification and troubleshooting

- `npm run test:api`: file-input/CA/configuration/guard/readiness tests plus existing backend regressions.
- `npm run test:db`: real schema-drift/readiness recovery and drain HTTP checks plus the existing complete persistence/authentication/native/external/browser suite.
- `npm run test:containers`: requires the reviewed locally built `elyqreth-t05-api:verification` and `elyqreth-t05-web:verification` images, Docker and installed OpenSSL (Git's bundled OpenSSL on Windows). It owns labelled containers/networks/volumes, random credentials and a one-day TLS fixture; checks labels before cleanup. It tests production-like TLS/permissions and distinct synthetic API/migration roles, not a hosted database or a T07 least-privilege certification.
- `npm run test:docker`: unchanged development Compose ordering, migrations, non-root API/web, safe static assets and real browser city regressions in a unique disposable project.
- Lint, frontend unit/typechecks, production build verifiers, dependency/image scans and exact final outcomes are in the evidence. No paid LLM/hosted IdP credentials are needed.

Troubleshooting: invalid production config/secret files stop startup; inspect only safe category/field-name diagnostics and correct the selected mounts/modes. A valid CA with a wrong database hostname must fail; never set rejectUnauthorized=false. Schema/journal readiness failure requires the reviewed migration/repair process, not deleting the journal or reset/replay. DB outage leaves liveness up; check private connectivity and the bounded pool, then observe readiness recovery. If the three-restart budget is exhausted, fix the dependency/configuration and restart explicitly. A missing/invalid public JSON or required asset stops nginx; changes to valid mode input require a reviewed restart to replace the served enum snapshot; correct the non-secret mount/artifact. A draining instance must stay out of admission; do not restart uncertain native work merely to restore a green health indicator.

Known limitations: no production provisioning or hosted database/IdP verification; no public edge/network policy yet; no fleet-wide native writer scaling; no full active-drain acceptance; no backup/restore certification, CI/CD promotion or observability platform. Image vulnerability evidence is time-specific and must be refreshed before release. Git provenance is unavailable in this supplied workspace and remains a release gate. No T06 or later implementation is started.


## Continuation review (2026-11-05, Asia/Bangkok)

The continuation recovered the passing logs below, verified scan IDs and the preserved-file baseline, completed the evidence manifest and corrected stale roadmap text. No application code was regenerated. A fresh read-only Docker resource listing could not connect to the Docker engine in the continuation sandbox; it does not replace or invalidate the recorded completed container runs. Container tests were not rerun. Git metadata remains absent. Temporary scanner data can remain in OS temp; no existing database or volume was removed during continuation.

## Executed results and residual gates

| Root command | Exit | Outcome |
| --- | --- | --- |
| `npm.cmd run lint` | 0 | Frontend syntax/strict types and backend types |
| `npm.cmd run test:api` | 0 | 303/303 backend unit/security/configuration tests |
| `npm.cmd test` | 0 | 238/238 frontend unit/regression tests |
| `npm.cmd run test:db` | 0 | 221/221 real persistence/auth/native/external/browser tests, including schema drift/readiness recovery and drain |
| `npm.cmd run build` | 0 | Backend build, also repeated by API/DB suites |
| `npm.cmd run build:web` | 0 | Disposable production bundle, unchanged city source |
| `docker build --target api -t elyqreth-t05-api:verification .` | 0 | Final pinned Alpine API build |
| `docker build --target web -t elyqreth-t05-web:verification .` | 0 | Final pinned slim nginx/static build |
| `npm.cmd run test:containers` | 0 | Production TLS/secrets/native/readiness/drain/recreation/web/public snapshot/Compose/image-content checks; actual web 128 MiB and migrator 512 MiB limits exercised |
| `npm.cmd run test:docker` | 0 | Existing development Compose and Chrome smoke passed, zero browser exceptions |
| `npm.cmd audit --omit=dev --json` | 0 | Zero production dependency vulnerabilities reported |
| Pinned Trivy 0.76.1 `image --input ... --scanners vuln --severity HIGH,CRITICAL --exit-code 1 --format json` on each final image | 0 each | Zero selected high/critical package findings; exact image IDs match final image inspect |
| `python docs/ai-agent-platform/phase-6/verification-evidence/check_configuration.py` | 0 | 11 documents, links, inventory and touched-file whitespace |
| `git status --short` | 128 | BLOCKED: no Git metadata in supplied workspace |
| `git diff --check` | 129 | BLOCKED: no Git metadata; independent hashes and whitespace checks used |

The final API image is 214,320,134 bytes and web image 41,675,767 bytes according to local `docker image inspect` (uncompressed image sizes, not download sizes or a performance benchmark). Tested on linux/amd64. Image IDs, scan metadata/commands and private OS-temp log names are in the evidence. Local verification tags/cache images may remain inspectable; owned test containers/networks/volumes were cleaned by the passing harness; disposable scanner cache/export archives may remain in OS temp. No production service was started.

Historical failures are retained rather than erased: new readiness checks required the existing route-only production unit mocks to simulate schema readiness; health log expectations were preserved through sampling. The first full database run passed 217/221 and identified HTTP drain logs contaminating initialization-only CLI JSON plus one asynchronous default-disabled frontend test bootstrap race. Drain logging is now tied to an actual listener, and the test fixture waits for initial access bootstrap disposal. Final reruns pass without removing authorization or lifecycle assertions.

Docker Scout was unavailable without a Docker login. A pinned disposable Trivy image scanned local exported archives with no Docker socket or credential requirement. Its first bounded tmpfs was too small for the advisory DB; disk-backed owned cache and serialized scans fixed the tool prerequisites (a missing tmp subdirectory and one concurrent cache-lock attempt are retained). The original Debian API/full nginx candidates had scanner findings; the verified pure-JavaScript/musl-compatible Alpine API and slim static nginx variants remove those unused OS packages. No CVE ignore/suppression list or unrelated npm upgrade was added. [Debian's zlib record](https://security-tracker.debian.org/tracker/CVE-2023-45853) also illustrates why package-level findings are not automatically proof that a particular binary/application exposes the affected code.

OS/package scans are time-specific and do not certify all vendored binary components or application logic; the production uncompressed-body boundary avoids unnecessary decoder exposure, and later security acceptance must refresh upstream advisories and scans. Production URL/CA/vendor readiness, host secret ACLs, public edge exclusions, database least privilege/backup, active-writer drain/cutover, hosted provider connectivity, sustained load and release provenance remain their ordered T06+ gates. T05 completion does not make the overall project production-ready or authorize deployment.

## T07 database access update

The former synthetic broad-grant fixture is superseded by [T07 database roles](database-migrations.md). Container verification now provisions bootstrap-owned access metadata and separate restricted runtime/migration logins using three independent secret volumes. Production migrate requires DATABASE_MIGRATION_TARGET and supports the preflight command; API remains runtime-only and cannot migrate. Bootstrap is an explicit one-shot operator process, not an application service. Earlier T05 evidence remains historical; current T07 evidence verifies the new role contract.
