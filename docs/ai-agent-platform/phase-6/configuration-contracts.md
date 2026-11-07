# T02 - Production access and configuration contracts

Review: 2026-10-29, Asia/Bangkok. **PARTIAL: common configuration hardening is implemented; production access decisions remain blocked.** This does not authorize deployment. [T01 decisions](decisions.md), [roadmap](implementation-plan.md), [inventory](configuration-inventory.md) and [verification](t02-verification.md) are complementary records.

## Current T05 file/CA extension

The [T05 guide](container-hardening.md) adds bounded backend file inputs, DATABASE_SSL_CA_FILE, readiness and a separate production packaging profile. It reuses this validator and preserves the unresolved hosting/public-audience gates. Production rollout remains unimplemented; [T06](edge-network.md) now supplies locally verified edge/network packaging without changing these backend/private configuration boundaries.

## Current T03 authentication extension

The user subsequently authorized two exclusive installation modes: local username/password or OIDC. [The implemented guide](authentication-modes.md) supersedes this T02 task-date document's statements that production principal configuration is absent. Default AUTH_MODE=disabled still preserves all original fail-closed behavior. Explicit validated modes use named viewer/operator grants within an existing owner, enable supported backend native/read features through current guards, and prohibit legacy-token fallback. T04 now supplies [frontend account/session integration](frontend-access.md); production infrastructure remains later work. Hosting/DB/public-audience decisions remain open; no deployment was performed.

## Enforced environment profiles

`loadConfiguration` reads the optional ignored `apps/api/.env`, then overlays defined process values without mutating `process.env`. Empty values do not inherit defaults. Validate before constructing Nest; database connectivity and adapter configuration are checked during initialization before listening. Environment errors contain field names only. Unknown unrelated environment names are not treated as supported application settings.

| Profile | Actual behavior |
| --- | --- |
| Development | NODE_ENV omitted or `development`; loopback host 127.0.0.1, port 3001, exact localhost/127.0.0.1:5173 origins, optional database; all privileged features disabled unless explicitly configured |
| Test | `NODE_ENV=test`; same defaults, deterministic fixtures and isolated database harness; no real credentials required |
| Staging/UAT | Deployment environment, **not** a fourth NODE_ENV value. Must use `NODE_ENV=production` and the same validation, separately isolated DB/secrets/domains. Provisioning/access is deferred |
| Production | Explicit API_HOST, API_PORT, CORS_ORIGINS and DATABASE_URL required; verified DB TLS; privileged local features remain prohibited. A valid contract currently permits only liveness, not production Agent access |

NODE_ENV=staging, malformed integers, invalid host binding or empty/malformed origins fail. Production origins must be exact canonical HTTPS origins without credentials, path, query, fragment, wildcard, localhost/subdomains, loopback or unspecified IPs (including mapped IPv4). Multiple origins are deduplicated. Private HTTPS origins are not categorically prohibited because a private-operator audience remains possible. CORS is not authentication or a network firewall.

Production requires a PostgreSQL URL with user, password and valid database name; no query-string TLS override. Built-in `postgres` superuser, recognizable test database names (`test`/`testing` underscore-separated) and known default/placeholder passwords are rejected. This detects common mistakes, not actual database grants, password entropy or every test database. Operators must verify distinct staging/production identity and least privilege in T07. Explicit private/loopback DB endpoints remain possible for the self-hosted option; there is no implicit localhost fallback. TLS defaults to verify-full in production and cannot be disabled; hostname/CA validation uses the existing pg pool, without an insecure bypass. Custom CA/file injection belongs to T05. Pool/time budgets are bounded as inventoried.

## Access contracts and unresolved gates

| Boundary | Enforced now | Deferred requirement |
| --- | --- | --- |
| Static frontend | No public environment-variable prefix (`envPrefix: []`); no application process.env/import.meta.env reads; validated local browser origin/token entry remains unchanged | T04 same-origin production session/runtime configuration after identity decision |
| API | Exact noncredentialed CORS, 64 KiB body cap, sanitized errors, bounded request timeouts, no implicit proxy trust; privileged dev feature flags rejected in production | T03 principals/object grants; T04 cookie/session/CSRF; T05 readiness; T06 protected edge |
| Native runtime | Existing in-process coordinator, one active slot, DB fencing; cannot enable via production dev flags | T09 admission/drain/restart. No separate worker endpoint/process exists |
| PostgreSQL | Required production credentials, verified TLS, bounded pool/connect/query/idle limits; startup connectivity check | Private routing, firewall, app/migrator/backup roles and restore validation T06-T08 |
| External providers | Disabled by default; dev/test registry ownership; compiled registry rejects unknown adapters at initialization; LangGraph configuration rejects unsupported capabilities/modes/missing public credentials | T10 authorized production connectivity/rotation; no new adapter or mutation enabled |
| Trusted event ingestion | Internal source grant from authorized connection/generation/namespace, 5-minute grant, validated durable inbox, bounded payload/recovery; no public webhook | Future production principal/source policy; no generic webhook secret/signature switch exists |
| Health/admin | `/health` exposes constant liveness only, no configuration/DB status; no public recovery/worker/admin controls | Protected readiness and operational access later |
| Broker/cache | None required or configured | Do not add Redis/RabbitMQ variables or public ports |

Existing Compose is **development only** with loopback host-published ports. Its internal 0.0.0.0 bind does not enable Agent APIs; setting NODE_ENV=development behind a public proxy is forbidden. T02 does not implement reverse proxy/firewall/TLS infrastructure. Production validation cannot prove network privacy.

There is no session signing/encryption secret, cookie, CSRF, issuer/audience, trusted-proxy or worker-concurrency environment contract yet. Setting invented SESSION_SECRET, TRUST_PROXY or WORKER_CONCURRENCY variables does not implement those controls. No secrets are generated automatically. Production authentication is **not ready**; missing production identity policy cannot be worked around with registry tokens.

Both T01 audience gates remain mandatory alternatives: private operators need named verified principals, least-privilege owner grants, API identity validation, revocation/audit and secure browser sessions. Public accounts additionally require actual account/workspace membership, server-derived scope and cross-account enrollment/recovery/isolation tests. The user's audience and database answers remain **undecided**. D01-D05 (audience, DB TCO/region/private connectivity, identity and session policy) are unresolved; D06/D09/D10 recovery/retention/availability/capacity objectives are also not approved. No arbitrary session lifetime, provider, budget or tenant model is selected here. Record decisions before dependent access implementation; T03/T04 may not bypass them.

## Secrets and diagnostics

Only backend environment injection or the ignored API-local env file supplies DB credentials, operator tokens and provider secret references. Public frontend configuration currently has **zero environment keys**; API URL is validated local UI input. Environment changes require rebuilding the static artifact only if build configuration/code changes; there is no production runtime-config injector. Vite's empty env prefix prevents automatic VITE_* exposure; browser tests preserve local origin validation. Never add `define: process.env` or copy backend env to static hosting. Empty prefix does not sanitize source code, explicit substitutions or checked-in secrets; review remains required.

Root configuration and nested DB JSON/standard Node inspection now produce safe diagnostics: environment/bind/origin, enabled booleans and DB limits, excluding passwords, tokens, owner IDs, connection identities and provider payloads. Existing private provider credential stores remain redacted. Actual fields remain accessible to backend services; redaction is not encryption and spreading/deep-inspecting private objects bypasses it. Never log raw environment, spread configuration, or serialize individual token-bearing subobjects. Health and API DTOs do not expose configuration. Startup errors omit values/URLs; request logs omit credentials/query/body. No new diagnostics endpoint exists.

Inject process secrets from the later approved launcher/secret store; do not commit real values, put them in command arguments/URLs returned to browsers, or persist them in frontend storage/bundles. `_FILE` loading and external secret platforms are not implemented. Rotate via reviewed replacement and controlled restart, then verify old credential revocation and no log leak; rotating a connection secret is distinct from changing connection namespace/generation. Database password rotation needs provider/DB role coordination. Preserve current uncertain native-work handling during restart; never retry side effects blindly. Session rotation/revocation design remains T03/T04.

## Existing local predicates and trusted callers

Do not remove one guard and assume production is enabled. Configuration predicates live in `agents/registry-configuration.ts`, `city/{city-read,collaboration-read}.configuration.ts`, `interaction/interaction.configuration.ts`, `runtime/runtime-configuration.ts`, `external-orchestrators/external-configuration.ts` and provider validation. Runtime checks remain in `common/local-access.guard.ts`, `events/events.service.ts`, `city/{binding,activity,collaboration-activity}.service.ts`, `lifecycle/task-lifecycle.service.ts`, `collaboration/collaboration-api.service.ts`, `runtime/{runtime-persistence.service,http/runtime-api.service,tools/tool-execution.service}.ts` and `external-orchestrators/ingestion-authority.ts`. Browser checks live in `dist/js/runtime/http-transport.js` and existing runtime/interaction/collaboration clients; recovery-journal persistence also uses approved local boundaries.

Trusted commands `runtime/local-command.ts`, `city/local-command.ts`, and `external-orchestrators/langgraph-command.ts` load validated server configuration and retain internal authorization, not client-selected owner/Agent claims. They are local operator commands, not public worker interfaces. Test-only source grants/adapters/DB initialization stubs never enter src/build output. T03 must extend these existing principal boundaries deliberately; T04 owns browser production behavior.

## Troubleshooting and acceptance limits

- `Invalid API configuration: <fields>`: inspect only named keys in your private environment. Do not paste values into logs/issues. A production DB/origin/bind must be explicit; do not change NODE_ENV to evade checks.
- `Database unavailable`: verify private connectivity, URL/role, verified certificate chain/hostname and pool budget. Do not disable TLS. `/health` is liveness, not readiness.
- External `INVALID_CONFIGURATION`: check compiled adapter, capability subset, mode, endpoint allowlist and referenced secret; production enabling remains rejected even with correct dev credentials.
- Local 404: check explicit local feature flags and distinct limited tokens; this is intentional default-deny. Production business routes staying closed is expected until T03/T04.
- Origin/browser rejection: use exact allowed local UI/API origins for existing local mode; HTTPS CORS configuration does not make browser production access available.

T02 is PARTIAL because access/identity/session and infrastructure choices are not approved, despite implemented common validation and executed local regression evidence. Next approved roadmap item is **T03 Production Principal & Object Authorization**, after its T02 decision prerequisites are resolved. No T03+ feature or infrastructure is implemented by this change.

## T07 role and migration enforcement

Production API startup/readiness now requires the bootstrap-owned database role contract; runtime/admin credentials cannot substitute for the bound migration role or vice versa. Production migration/preflight also requires DATABASE_MIGRATION_TARGET to match the validated URL and actual database name. Development/test databases without an access contract preserve their existing workflow; a present contract is enforced in every environment. See [database roles and migration safety](database-migrations.md) for provisioning, required grants, preflight, credential isolation and failure recovery. No API-startup schema synchronization is enabled.

## T08 backup and isolated restore

The operator-only recovery CLI reuses T02/T05 private database and file validation. Production backup uses the separately bound read-only export login; no backup secret enters runtime application services. Artifact verification/copy/retention need only a protected key file and explicit private directory. The generic restore command rejects production, remote hosts, occupied schemas and unconfirmed targets; production cutover remains a separate approved procedure. See [backup and recovery contracts](backup-recovery.md).

## T10 external hardening update (2026-11-06)

The current [external security guide](external-connectivity.md) supersedes external rotation/isolation planning notes above. Production external activation remains rejected by explicit user choice; no approved hosted target or production source-principal contract exists. Existing private key-file inputs are reused, each connection requires a distinct referenced credential, and operation/source grants bind complete policy and key identity across asynchronous boundaries. Known cloud platform/IPv6 metadata addresses and port zero are excluded by the shared endpoint policy. Existing named-account browser access does not grant legacy source ingestion. No new environment switches, public webhook or provider mutation capability are introduced.
