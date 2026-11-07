# Frontend access and session integration

Current follow-up: [T06 edge/network verification](edge-network.md) now covers actual pinned nginx HTTPS routing, CSP, session expiry/reauthentication and polling/reconnect. This T04 guide retains its original application/session scope.

**T04 COMPLETE for the supported private-operator browser contract**, 2026-10-30, Asia/Bangkok. T04 integrates the [T03 backend contracts](authentication-modes.md) into the existing static JavaScript/Canvas application. This is private installation-owner access with `viewer` and `operator` accounts, not public enrollment, a new tenancy model or a production deployment. Verification results are recorded in [T04 evidence](verification-evidence/frontend-access-verification.json).

T05 update: [container hardening](container-hardening.md) now supplies backend file/CA injection, readiness and a validated public mode snapshot. Earlier T04 infrastructure deferrals below describe its original task boundary; actual edge routing remains T06.

## Public configuration and deployment contract

The application reads `/access-config.json` once, with a five-second deadline, a 1 KiB JSON limit, no cookies, no redirects and no cache. The complete allowed shape is one field:

```json
{"mode":"local"}
```

Allowed modes are `disabled` (the shipped default), `local` or `oidc`. Unknown fields/modes, missing responses and malformed responses fail closed. This is non-secret presentation configuration; it never chooses an owner, role, issuer, credential or backend authorization mode. The backend must separately select the corresponding `AUTH_MODE`. A mismatch cannot create a session because `/api/v1/auth/me` must confirm the expected principal kind.

Account access uses the page's **same-origin HTTPS** API under `/api/v1/`. There is no user-selectable production API destination or localhost fallback. Explicit HTTP loopback origins remain available for development. Remote HTTP, cross-origin API destinations, URL credentials, query configuration and fragments are rejected. The existing limited development clients remain loopback-only unless explicitly composed in account mode.

The frontend remains static; no SSR/Node frontend server, environment namespace or backend config import was added. Vite `envPrefix: []` remains intact. Configure the reviewed non-secret JSON file at the static hosting boundary alongside the unchanged artifact; changing mode does not require compiling credentials into a bundle. Serve this file with `Cache-Control: no-store`, retain the existing static no-cache policy, and route `/api/v1/` through the later protected same-origin edge. **No reverse proxy, production Docker/Compose, certificate or firewall configuration is implemented here.** A production hostname/TLS/private ingress and secret injection remain T05/T06 acceptance gates. Do not expose Vite or the existing development Compose services publicly.

## Architecture and contract

`AccessSession` is the single page-owned authentication authority. Its snapshot contains phase, a narrowed backend principal and a safe message; it never includes a bearer or password. The access panel composes the existing runtime poller, Task interaction session and collaboration owner after successful authentication. Their original stores, source DTO validation, cursor handling, polling, bounded pagination and lifecycle rules are reused.

| Operation | Actual contract and UI behavior |
| --- | --- |
| Cold startup | Resolve public config; no stored credential or cookie exists, so show UNAUTHENTICATED without a speculative protected request |
| Local sign-in | POST `/api/v1/auth/login` with JSON username/password; then GET `/api/v1/auth/me` with the returned bearer; only then connect protected clients |
| OIDC access | Accept an already-issued API access JWT in a password-style field; verify it through GET `/api/v1/auth/me`; no username/password fallback, provider key or token-derived issuer |
| Principal | Backend-confirmed `kind`, `role`, `ownerId`, `actorReference`; client input never chooses owner or privilege |
| Protected requests | Existing clients use an account-scoped fetch gate; overwrite caller Authorization with the active in-memory bearer; omit cookies; no redirects; bounded existing transport |
| Recheck | Online and foreground events revalidate `/me`; explicit Recheck access clears feature scopes and revalidates before restoring fresh clients; existing authorized polling also detects 401; no second poller or per-NPC connection |
| Local sign-out | Clear local state immediately, then POST `/api/v1/auth/logout` with the captured old bearer and `{}`; report whether revocation was acknowledged |
| OIDC sign-out | Clear local state; explicitly state that the issuer token remains valid according to issuer/expiry policy; there is no backend/provider logout contract |

OIDC supports the backend's existing explicit RS256 access-token profiles and reviewed issuer/audience/JWKS/subject grants. This task does **not** introduce authorization-code/PKCE endpoints, redirect callbacks, refresh tokens, issuer discovery or a second identity provider. Token entry is a private-operator entry point, not a claim of a complete consumer SSO redirect flow. Password grants remain confined to the old disposable Keycloak test fixture; the frontend never calls a provider token endpoint. An issuer-driven redirect/BFF flow requires a separately reviewed compatible backend contract rather than guessed endpoints or browser client secrets.

Both modes are bearer-based. There is no ambient cookie authentication and therefore no added cookie CSRF token mechanism. Exact backend Origin checks remain in force, credentialed wildcard CORS remains disallowed and the frontend only selects same-origin account access. Browser localStorage/sessionStorage, URL parameters, cross-tab messages and public JSON never contain credentials. Account-mode Task recovery uses a memory-only journal, so drafts, results and even recovery locators are not persisted across account reloads. Default-disabled development behavior retains its existing identifier-only journal and limited credentials.

## State transitions and cleanup

Phases are INITIALIZING, UNAUTHENTICATED, AUTHENTICATED, EXPIRED and ERROR. Generation checks and AbortControllers fence obsolete login, principal, resource and polling responses. A cached principal alone cannot bootstrap a session after reload. There is no silent renewal or invalid-token retry loop.

- A confirmed protected 401 transitions the whole page to EXPIRED, removes credentials, aborts/invalidate requests, disconnects the shared runtime poller and clears Task/Execution drafts, results/history, collaboration snapshots/timelines, external observations, native detail selections and protected NPC activity.
- A resource 403 or concealed 404 clears the affected existing owner/panel scope without declaring the entire session expired. Backend role/object checks remain authoritative. A network/5xx error is never labelled credential expiry; an explicit `/me` recheck failure clears protected access with ERROR and requires fresh sign-in.
- Logout clears protected data before awaiting server revocation. Failure displays **unconfirmed server revocation**, without restoring the bearer. Late responses cannot reconnect a logged-out page or repopulate old data.
- Reauthentication rechecks `/me` and constructs fresh client/owner scopes. Viewer reads remain allowed; backend-projected mutation eligibility is false for viewers. There is no public cross-user owner switch: all authorized accounts in the supported private installation share its explicitly configured owner. Reauthentication is not an invented tenancy boundary.
- A single origin-scoped BroadcastChannel sends only `{type: "logout"}`. Other tabs erase their own local protected state; this does not claim server-side revocation of every separately issued session. Browsers without BroadcastChannel retain per-request backend invalidation and per-tab logout.
- Page hide drops local credentials and protected data; returning from browser history requires fresh sign-in. Online/visibility listeners and channels are removed on disposal. Losing a page/HTTP request does not claim to cancel or revoke already admitted native work.

## UI, authorization and city behavior

The existing header gains Sign in / Access / Sign in again, and a small native dialog with labelled inputs, status announcements, pending-state submission control, keyboard dismissal and focus restoration. Password/access-token fields clear after submission and on close. No sensitive response or provider payload is inserted into HTML. The existing dark/Icy White panel styles and reduced-motion behavior are retained; no animation was added.

Anonymous users can continue the decorative Canvas simulation, camera/zoom, NPC movement/selection and local demo mission. These are not backend Agent identities or protected Tasks. Real Agent inspection and status bindings load only after verified access. Account mode connects the existing Task and collaboration panels automatically and hides their independent development-token entry points. NPC selection, delegation navigation, native/external provenance, external freshness and the existing results/history views are reused. Logout removes backend names/status/results while preserving the public decorative city.

A narrow backend compatibility correction adds existing `actionEligibility` DTO fields to account-authenticated Agent/Task/Execution reads and Task creation. It calls the existing owner-scoped eligibility service and forces all three mutation booleans false for viewers. It does not establish the restricted development interaction identity, alter result authority, expand native admission or change Execution/collaboration transitions. Mutation guards still independently enforce role, owner, version and lifecycle.

## Verification scope

Unit tests cover mode/origin validation, memory-only bootstrap, backend principal resolution, account transports, 401/403/network separation, stale authentication, logout failure and OIDC token-only behavior. Existing frontend tests cover the original lifecycle/collaboration owners and city modules. Browser DOM scenarios cover session controls, revocation feedback, late responses, reauthentication, cross-tab logout and keyboard dismissal; existing smoke scenarios still cover Canvas/NPC/Task/collaboration regression.

Database integration exercises the real Nest guards/PostgreSQL sessions through the actual frontend API clients, including Task execution/results, viewer eligibility and revocation. A separate real-browser scenario uses an ephemeral same-origin **HTTPS** fixture and disposable pinned test certificate, a test-only API proxy, real PostgreSQL/Nest and actual local accounts. It verifies public city, login, mapped NPC Agent inspection, native Task success, collaboration snapshot, logout, viewer reauthentication and revoked-account cleanup. No production TLS/proxy configuration or authentication-bypass route is shipped: the test-only revocation control exists only in its temporary test server. Test certificates/keys/accounts/databases are disposed. The fixture requires installed OpenSSL (Git's bundled OpenSSL on Windows) and Chromium, alongside existing Docker prerequisites.

Hosted production TLS, deployment, issuer redirect SSO, a public tenant audience, manual screen-reader review and long-duration/load acceptance remain outside this task. Real Keycloak backend evidence remains T03's dated evidence; T04 does not relabel that earlier run as newly executed. See the machine evidence for exact current commands, failures and final status.

## Local setup and troubleshooting

1. Provision a local account using the [existing stdin-only CLI guide](authentication-modes.md#local-accounts-and-sessions); no default account/password is added.
2. Select matching backend `AUTH_MODE`, existing owner and database; enable `CITY_READ_ENABLED` and `COLLABORATION_READ_ENABLED` for the corresponding existing views, plus reviewed runtime bindings for native execution. Maintain real Agent-to-NPC bindings; names do not create mappings.
3. Set the frontend JSON mode to match. Provide same-origin `/api/v1/` routing in an authorized local/test setup, or later the approved production edge. Cross-origin port substitution is deliberately unsupported for account mode; this task does not change Vite/Compose routing for you.
4. Open Sign in, authenticate, select a mapped resident and use the existing Agent Task and Collaborations sections. A viewer can inspect authorized data but cannot submit/start/cancel.
5. If mode/config is invalid or unavailable, access stays closed; correct the non-secret file and reload. If 401, sign in again. If a feature is disabled/403/404, check backend flags, grants and mappings rather than retrying credentials indefinitely. Unconfirmed logout means local cleanup succeeded but server revocation must be checked separately.

Subsequent T05 [container hardening](container-hardening.md) supplies the validated public enum snapshot, file/CA inputs and readiness. T06 Edge & Private Network Configuration is next; actual ingress/deployment remains unimplemented. The verification below remains the original T04 record.


## Executed verification

| Command (repository root) | Exit | Outcome |
| --- | --- | --- |
| `npm.cmd run lint` | 0 | Frontend syntax, strict runtime/session types and backend typecheck |
| `npm.cmd run check:runtime:web` | 0 | Explicit frontend typecheck |
| `npm.cmd test` | 0 | 238/238 frontend unit/regression tests |
| `npm.cmd run test:api` | 0 | 295/295 backend unit/security tests |
| `npm.cmd run test:db` | 0 | 220/220 PostgreSQL/Nest/browser tests, including account clients and real HTTPS session workflow |
| `node --test --test-name-pattern='frontend account\|authentication frontend' apps/api/test/database.integration.cjs` | 0 | 2/2 targeted client/HTTPS browser integration cases |
| `node --test --test-name-pattern='authentication frontend' apps/api/test/database.integration.cjs` | 0 | 1/1 targeted real HTTPS browser case including mobile/desktop widths |
| `npm.cmd run test:browser` | 0 | Existing city/interaction/collaboration smoke plus local/OIDC session DOM scenarios, zero browser exceptions |
| `npm.cmd run build` | 0 | Backend production TypeScript build |
| `npm.cmd run build:web` | 0 | Final production bundle verified in disposable output; maintained source preserved |
| `python docs/ai-agent-platform/phase-6/verification-evidence/check_configuration.py` | 0 | 10 linked documents, inventory and changed-file whitespace checks |
| `git diff --check` | 129 | BLOCKED: supplied workspace has no Git metadata; changed-file whitespace/hash checks used |
| `git status --short` | 128 | BLOCKED: supplied workspace has no Git metadata; no staged/untracked claim made |

Earlier failures are retained in the machine evidence: the first database run could not access the stopped/sandboxed Docker engine; the first standalone browser test exposed a duplicate disabled-access button in the fixture; a subsequent full DB run passed 214/219 and exposed four access-dialog Escape test timing failures plus one resident-roster reload readiness race. The disabled-mode button lifecycle and explicit test readiness/key-up waits were corrected, with no assertions removed or security weakened. The final full database run passed 220/220, and final standalone smoke passed. No failures are relabelled as successful runs.

Private command logs are named `elyqreth-t04-*` under the OS temporary directory; exact names and commands are in the machine evidence. No live hosted IdP test, production rollout, public tenancy, sustained load or manual assistive-technology acceptance is claimed. All database mutations were confined to owned disposable test databases; no production account/default password was created.
