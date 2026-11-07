# Local and OIDC authentication

T04 update: the [frontend access/session guide](frontend-access.md) describes the added local login and existing OIDC API-token entry UI. T03 evidence below remains its original backend run; browser redirect/PKCE and production deployment are not implied.

**Backend scope COMPLETE**, implemented and reviewed 2026-10-30, Asia/Bangkok. This is the user-authorized extension of T03: **choose one authentication mode per installation**. Local username/password accounts are separate from the earlier loopback development tokens. No production account, default password, production migration or deployment is created by this implementation. This document records T03 backend scope; the linked T04 guide records current frontend integration.

## Scope and selection

| AUTH_MODE | Behavior |
| --- | --- |
| disabled (default) | Existing restricted development/test bearer audiences continue unchanged. Production business APIs remain closed |
| local | Named, operator-provisioned username/password accounts and opaque PostgreSQL-backed bearer sessions |
| oidc | API access JWTs from one explicitly configured issuer, verified against reviewed public signing keys and an explicit subject/permission allowlist |

Only one mode is active. Local mode never accepts an OIDC JWT; OIDC mode has no password-login fallback and never accepts a local session or old development token. Account modes reject the legacy AGENT_REGISTRY_TOKEN, CITY_READ_TOKEN, CITY_INTERACTION_TOKEN and COLLABORATION_READ_TOKEN environment settings rather than silently retaining a fallback. Limited city-interaction token mode must be disabled. Neither mode is enabled merely by importing the module.

This backend scope is **private, single-owner operator access**, not public self-service accounts or a new tenancy/sharing model. Each local account is explicitly provisioned into the configured existing owner. Each OIDC subject is explicitly granted a role in that same installation owner. Arbitrary signed subjects, user/tenant/owner headers, provider roles and metadata cannot choose owner or permissions. Different installations/owners remain isolated. Public registration, account recovery/email, MFA and public tenant enrollment are not implemented.

`viewer` is an owner-wide private-team read grant, including permitted results/history/audit; it is not the earlier metadata-only city audience and must not be granted to public users. It permits authorized GET/HEAD reads; `operator` also permits supported mutation routes. Both remain constrained by existing ownership, parent-child correlation, lifecycle, version, native claim, capability and safe DTO checks. Viewer logout is allowed. There is no public account-management API or implicit administrative role. Internal runtime transitions retain service authority and fencing; logout does not cancel already admitted work. External providers remain authoritative for external Executions; production external connectivity is still gated T10 work.

## Shared configuration

Use the optional ignored `apps/api/.env` or backend-only process injection. Nonproduction account-mode APIs must bind an explicit loopback IP; production routing/TLS remains a later protected-edge requirement. Existing environment validation, production HTTPS CORS and verified database TLS rules still apply. Frontend public environment exposure remains disabled. Example placeholders below must be replaced; they are not credentials or automatically provisioned owner records.

```dotenv
AUTH_MODE=local
AGENT_REGISTRY_ENABLED=true
AGENT_REGISTRY_OWNER_ID=REPLACE_WITH_EXISTING_OWNER_UUID
# DATABASE_URL must be set privately; migrate with the approved separate role first.
# API_HOST/API_PORT/CORS_ORIGINS must be explicit in NODE_ENV=production.
RUNTIME_ENABLED=false
CITY_READ_ENABLED=false
COLLABORATION_READ_ENABLED=false
CITY_INTERACTION_ENABLED=false
```

Registry owner is an existing persisted scope, not a user ID. For a new approved development database, follow the [existing registry/owner bootstrap](../agent-registry.md); accounts never create an owner or tenant automatically. Do not configure a registry token in either account mode. Native runtime and read projection features remain explicit opt-ins; their existing flags/bindings/limits are preserved. The validated account mode extends their production server predicates; it does not bypass guards. Default-disabled installations and old local development configurations do not gain production access. External adapter enablement is rejected in account modes until the separate T10 service-grant integration. Existing source-grant issuance also rejects account mode or an empty legacy operator token; there is no empty-token fallback. Persisted authorized external observations remain readable. Trusted CLI restrictions have not been broadened into public interfaces.

## Local accounts and sessions

Set AUTH_MODE=local and optionally AUTH_SESSION_SECONDS (default 3600, range 300..86400). No session signing key is required: sessions are random 32-byte opaque bearer values, with only SHA-256 token hashes persisted. Passwords use asynchronous scrypt N=131072/r=8/p=1, independent random 16-byte salts and 64-byte derived keys. Passwords must be at least 16 characters, at most 256 UTF-8 bytes, with no control characters. Usernames are lowercase ASCII, 3..64 characters, starting with a letter/digit and containing letters/digits/dot/underscore/hyphen. Passwords are not trimmed or silently normalized.

The additive [0010 migration](../../../apps/api/migrations/0010_authentication_sessions.sql) creates:

- `local_accounts`: owner, unique owner/username, password hash, role, enabled state and credential version; no seed accounts.
- `auth_sessions`: owner/account correlation FK, unique token hash, credential version, expiration and revocation. Cross-owner sessions are rejected by the database.
- `auth_login_limits`: one durable admission bucket per owner, shared by API instances.

Apply migrations only through the existing reviewed process for your own approved development/staging target. This task applies them only to disposable test databases. Local mode checks its required tables during application initialization before accepting traffic. Migration is never automatic at API startup. Accounts/sessions are durable across API restarts; unknown usernames and invalid passwords receive the same safe 401 response.

Login has at most two active password derivations per API process, an installation-wide durable budget of 20 attempts per minute, and at most 20 active sessions per account. These are small private-installation limits, not internet-scale abuse protection. The durable budget includes unknown usernames without creating per-username rows. Edge/IP abuse controls remain later hardening work. Expired-session cleanup is bounded to 100 rows per successful login, indexed by owner/expiry. A failed audit write rolls back session issuance. HTTP/client errors never return password/hash/driver diagnostics.

Changing a password or role, or disabling an account, increments its credential version; old sessions fail on the next request. Logout revokes the presented session immediately for subsequent requests. Revocation does not retroactively undo an in-flight transaction or approved runtime claim. Runtime finalization remains authoritative. Expired sessions are rejected even if cleanup has not run.

### Provision an account

Build the backend, configure local mode and the existing owner/DB, and migrate the approved target before running the trusted CLI. It has **no HTTP equivalent**. It accepts bounded JSON on standard input, never a password in command arguments. From repository root, PowerShell:

```powershell
npm.cmd run build
$accountPassword = Read-Host 'New account password (at least 16 characters)' -AsSecureString
$accountCredential = [pscredential]::new('operator', $accountPassword)
$accountOutputEncoding = $OutputEncoding
try {
  $OutputEncoding = [System.Text.UTF8Encoding]::new($false)
  @{
    username = 'operator'
    password = $accountCredential.GetNetworkCredential().Password
    role = 'operator'
  } | ConvertTo-Json -Compress | node apps/api/dist/auth/local-account-command.js create
} finally {
  $OutputEncoding = $accountOutputEncoding
  Remove-Variable accountPassword, accountCredential, accountOutputEncoding
}
```

The command returns only an account UUID. Do not write the input JSON/password to a tracked file or paste it into logs. `create`, `disable`, `password` and `role` are the supported commands. `disable` accepts `{username}`; `password` accepts `{username,password}`; `role` accepts `{username,role}`. They scope to the configured installation owner and audit a trusted local-account command, not a fabricated human user. There is no default account/password, public registration or self-service reset. Disabled account re-enablement is not exposed by this CLI; a reviewed administrative database action is required and must increment credential_version so prior sessions cannot reactivate.

## OIDC API-token verification

Set AUTH_MODE=oidc. Local session settings/password login are rejected. Required backend configuration:

```dotenv
AUTH_OIDC_ISSUER=https://identity.example/realms/elyqreth
AUTH_OIDC_AUDIENCE=elyqreth-api
AUTH_OIDC_JWKS=REPLACE_WITH_REVIEWED_PUBLIC_JWKS_JSON
AUTH_OIDC_SUBJECTS=[{"subject":"REPLACE_WITH_APPROVED_SUBJECT","role":"operator"}]
```

Issuer must be HTTPS in production, with no credentials/query/fragment. Nonproduction permits HTTP only for an explicitly configured loopback issuer. Audience is an exact API identifier. Use an API audience distinct from the frontend login client. Approved subjects are exact issuer-scoped subject strings, not usernames/display names, email matching or client-supplied owner IDs. Up to 64 subjects map to viewer/operator. Removing a grant or changing keys takes effect after controlled configuration reload/restart; no token roles/groups automatically grant privileges.

JOSE validates RS256 signatures, exact issuer and audience, required iss/aud/sub/iat/exp, optional nbf, maximum token age one hour and 30-second clock tolerance. Access-token purpose must be explicit: protected typ `at+jwt`, or typ `JWT` with Keycloak's payload typ `Bearer` / an explicit token_use `access` claim. ID-token markers and unknown-purpose generic JWTs are rejected. Other algorithms, opaque provider tokens and unverified provider-specific token profiles are unsupported. Real Keycloak API access tokens are tested; this is not a blanket compatibility claim for every IdP configuration.

JWKS is a reviewed **public-key snapshot**, not an automatic remote fetcher. At most 16 published keys/32 KiB are accepted; at least one and at most eight compatible public RSA/RS256 signing keys enter the verifier. Encryption/other-algorithm keys may coexist but are excluded. Private/symmetric JWK parameters are rejected throughout the set; accepted signing keys require unique bounded kid and RSA modulus >=2048 bits. Untrusted token jku/x5u locations cannot select a network/key source. No outbound provider call occurs per API request and no issuer is guessed from a token.

For rotation, retrieve the issuer's keys through a trusted operator channel, review old/new public signing keys, update AUTH_OIDC_JWKS and restart in the approved drain order. Unknown/new kid fails closed until configured. Never disable signature/issuer/audience checks to recover. JWT acceptance is stateless and bounded by token expiry/one-hour maximum age; Elyqreth does not introspect provider revocation or implement provider logout. Remove the application subject grant and restart for immediate application-level removal. The [T04 guide](frontend-access.md) documents the current bearer session UX; authorization-code/PKCE, cookies and IdP logout are not supplied by this verifier or the token-entry UI.

## API contracts

| Endpoint | Contract |
| --- | --- |
| POST /api/v1/auth/login | Local mode only; application/json `{username,password}`; no query/extra fields; returns accessToken/tokenType/expiresAt with existing no-store headers |
| GET /api/v1/auth/me | Selected mode's valid bearer token; returns kind/role/ownerId/safe actorReference; never password, hash, session hash or raw provider claims |
| POST /api/v1/auth/logout | Local mode only, valid bearer, empty body; revokes that session; subsequent reuse returns 401 |

New authentication endpoints are unavailable when AUTH_MODE is disabled; existing constant `/health` remains public. Explicitly enabled legacy development APIs remain unchanged. Local-password login and local logout return 404 in OIDC mode. Invalid credentials return safe 401, unauthorized subject/operation/origin returns 403, foreign resources remain concealed 404, and login/session limits return 429. Auth routes reject query manipulation and unexpected nonempty bodies. The selected mode's global guard verifies every protected request; existing object-level guards then reuse the request-bound principal. Viewer mutation attempts fail before lifecycle side effects. Request/subject hashes and immutable private context preserve attribution without logging secrets or provider payloads. Native service audit actors remain distinct from initiating human actors.

Bearer values must travel only over HTTPS at the public boundary. T03 does not install TLS, trust arbitrary forwarded headers, provide a public proxy/firewall, create a browser login form or turn the local Compose file into a production deployment. The T03 frontend snapshot was unchanged; T04 now adds memory-only access without acquiring backend environment secrets. Do not expose a development server publicly.

## Verification and recovery

- `npm run test:api`: configuration, crypto, mode isolation, principal and existing backend tests; no live provider dependency.
- `npm run test:db`: isolated PostgreSQL account/session integrity, owner/role denial, restart/logout/password/disable/expiry behavior, audit rollback, native collaboration and existing regression/browser cases.
- `npm run test:keycloak:live`: owns disposable PostgreSQL and official Keycloak 26.8.1 pinned by digest, imports a random test realm/user, uses discovery/JWKS and real access/ID tokens, executes a native task, rejects ID/wrong-audience/local-mode token use, then verifies ownership labels before cleanup. No pre-existing IdP/account is needed.

### Final executed verification

| Exact root command | Exit | Final outcome |
| --- | --- | --- |
| npm.cmd run build | 0 | Backend production TypeScript build; also repeated by test commands |
| npm.cmd run lint | 0 | Frontend syntax/strict runtime types and backend typecheck |
| npm.cmd run test:api | 0 | 295/295 tests passed in the final serial run |
| npm.cmd run test:db | 0 | 218/218 real PostgreSQL/Nest/browser tests passed in the final serial run |
| npm.cmd run test:keycloak:live | 0 | 10 selected integration tests passed, including real Keycloak access/ID tokens and native execution |
| npm.cmd test | 0 | 228/228 frontend tests passed |
| npm.cmd run test:browser | 0 | Chrome browser/component/city smoke passed, zero exceptions |
| npm.cmd run build:web | 0 | Disposable Vite production bundle passed; maintained city source unchanged |
| npm.cmd run db:check | 0 | Offline migration metadata check passed |
| python docs/ai-agent-platform/phase-6/verification-evidence/check_configuration.py | 0 | Current docs, links, inventory and touched-file whitespace passed |
| git status --short | 128 | BLOCKED: no Git metadata in supplied workspace |
| git diff --check | 129 | BLOCKED: no Git metadata; hash/whitespace preservation fallback recorded |

Private logs are `%TEMP%/elyqreth-auth-api-verified.log`, `elyqreth-auth-db-serial.log`, `elyqreth-auth-keycloak-verified.log`, `elyqreth-auth-lint-verified.log`, `elyqreth-auth-web-final.log`, `elyqreth-auth-browser-verified.log`, `elyqreth-auth-web-build-final.log` and `elyqreth-auth-dbcheck.log`. Intermediate failed runs are separately retained in the evidence; none are relabelled as passes. A targeted isolated CLI case also passed before the full serial rerun. Docker label inspection confirmed no remaining owned test containers/volumes. Hosted IdP/TLS, public-account/tenant, browser OIDC/session UX, production rollout and sustained load acceptance were not run or claimed.

The Keycloak development image, HTTP loopback and password grant exist **only in the disposable fixture** to obtain test tokens. They are not the production deployment/login recommendation. Normal CI never starts Keycloak or requires provider credentials. Test passwords are random/synthetic, private fixture files are temporary, and raw tokens are never printed. A usage-limit interruption left one owned test container/volume; continuation verified labels before removing it and reran checks. The initial mixed-key rejection is preserved as failed evidence, then fixed with a regression test. Earlier complete regressions also recorded a Windows Chrome temp-profile cleanup lock and a child-process startup timeout under concurrent runs; final checks run serially and retain those failures rather than erasing them.

See [verification results and changed-file evidence](verification-evidence/dual-auth-verification.json). No migration was run against an existing database. The linked T04 guide records subsequent frontend work; all production infrastructure and final acceptance gates remain separate.

## Primary implementation references

- [Keycloak Docker development guide](https://www.keycloak.org/getting-started/getting-started-docker)
- [JOSE verification library](https://github.com/panva/jose)
- [JWT best current practices](https://www.rfc-editor.org/rfc/rfc8725)
- [OWASP password storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
