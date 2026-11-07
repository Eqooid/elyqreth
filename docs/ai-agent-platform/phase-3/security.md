# Phase 3 security and access boundary

**Phase 3 T09 COMPLETE — PASS WITH LIMITATIONS (2026-10-25):** [Security, performance and regression evidence](security-performance-verification.md) records the approved local trust boundary, patched HTTP parser advisories, measured synchronization/browser resources and reproducible regression checks. T10 final acceptance remains planned.

**T05 implemented and verified (2026-10-24):** [NPC Runtime Binding](npc-runtime-binding.md) derives indexed read-only associations from T04 and existing immutable NPC slots. Missing NPCs remain unresolved; no spawning, rendering or inspector change is added. Verification passed 96 frontend tests (19 new), 190 backend tests, 103 PostgreSQL tests, builds/static checks and browser smoke, plus final focused/type/build reruns. T06–T10 remain PLANNED.

Earlier checkpoints/plans below are historical. The latest T05 scope keeps absent NPCs unresolved and does not implement the original proposed extra-avatar provisioning.

**T04 implemented and verified (2026-10-24):** [Frontend runtime integration](frontend-runtime-integration.md) adds a typed city-read client, frozen store/read facade and bounded synchronization. Final checks passed 77 frontend tests (23 new runtime tests), 190 backend tests, 103 PostgreSQL tests, builds/static checks and browser smoke, with final focused compatibility/build reruns. T05–T10 remain PLANNED; no NPC binding/rendering or backend production source changed.

The original design/targets below remain historical. The implementation guide defines current T04 APIs/state and measured test evidence; no future NPC/inspector or performance target is claimed complete.

**T03 implemented and verified (2026-10-24):** [Backend Agent Activity Projection](agent-activity-projection.md) adds one-snapshot batched/single read models, separate city-read access, operator reads and explicit current-versus-recent outcome semantics. Full verification passed 190 backend, 102 PostgreSQL and 54 city tests, builds/static checks and browser smoke. T04–T10 remain PLANNED; no frontend code or database migration changed.

The T01 design below is historical. The implementation guide defines current routes/DTOs; history/result/audit inspector facade extensions remain deferred to T07 under the latest activity-only T03 scope.

## Supported deployment and required new safeguard

Phase 2's accepted scope is one explicitly configured local operator on loopback, not production user/tenant authentication. Keep that restriction for Phase 3; internet/LAN hosting, multiuser ownership and external reverse proxies remain BLOCKED. Current Vite binds 0.0.0.0 for standalone city development. Runtime-connected development must explicitly run `npm run dev:web -- --host 127.0.0.1` and use a pinned known loopback origin. Test the effective bind address, not just documentation. Do not change the standalone hosting model or assume CORS makes a LAN-served page trusted.

Do not send the existing broad registry/runtime operator bearer to browser code. Plan a **separate optional city-read bearer**, generated/provisioned by the operator, distinct from the operator token and bound by trusted server configuration to one owner/city. This is a narrow local audience credential, not a new account/JWT/identity platform. Reuse existing loopback socket/Host/Origin checks, timing-safe bearer validation, sanitized errors and owner predicates; factor the common policy rather than weaken or copy divergent guard logic. City token is accepted only by the new GET facade, never by Agent/Task/runtime-control endpoints; operator token is not an implicit city-token fallback. Defaults/production remain closed and no background integration starts automatically.

Proposed future configuration names, not implemented env variables: `CITY_READ_ENABLED`, `CITY_READ_TOKEN`, `CITY_READ_CITY_ID`, `CITY_READ_RESULT_TEXT_ENABLED` (false default). Owner comes from existing trusted registry owner. Validate distinct sufficiently random tokens and fixed city/manifest allowlists. Do not automatically expose these values in public config endpoints.

Browser explicit connect accepts the locally provisioned city token into volatile memory only. Never build it into VITE_ variables/JS, URL/query/hash, localStorage/sessionStorage/IndexedDB, service worker, debug DOM or logs. Clear on disconnect/401/403/page teardown. No password/API key collection. Provider credentials remain exclusively in backend adapters. A browser XSS/extension or trusted-page compromise can still steal an in-memory bearer; this local mechanism does not establish production security.

## Authorization and data minimization

Every City read derives owner from authenticated server scope, validates configured city and enabled binding, and checks all requested Agent/Task/Execution relationships. No client owner/capability/provider claim is trusted. Foreign/missing resource chains have consistent 404 behavior. Visibility of a binding does not grant result disclosure automatically. A malformed/unknown manifest or missing FK record does not trigger lookups by name or another owner's Agent.

Projection/history select explicit safe columns and validate output, not raw ORM entities. Existing Task/status serializations can include input: do not blindly forward them. No raw prompt/instruction/context, tool args, arbitrary Agent metadata, descriptions, provider endpoints/keys, lease tokens, raw errors or stacks. Result text may contain sensitive or malicious content; explicit server opt-in plus user reveal, strict size/plain-text rendering and no retention are required. Even these controls are not general secret detection/DLP.

No UI write or execution privilege is granted. Existing authorized execute/cancel still belong to separate operator tooling and the existing coordinator. Simulated buttons remain local and must be clearly labelled. Cross-agent navigation cannot bypass the facade chain checks; auth generation changes wipe caches and pending responses.

## Threats, tests and release gates

| Risk | Required control before data integration | Verification |
| --- | --- | --- |
| Broad control bearer exposed to browser | Distinct city-read credential; no fallback; cannot invoke POST/PATCH/control routes | Real HTTP test city token versus execute/cancel/create/update and operator token versus city reads |
| Cross-owner/city/parent IDOR | Server scope + enabled binding + full parent relationship filters | Two-owner/two-city fixtures; forged IDs and disabled mappings reveal no data |
| Provider/credential disclosure | Safe explicit DTOs; no prompts/config; separate text disclosure policy | Seed secret-looking markers in every excluded field and inspect JSON/DOM/logs |
| Model/name/result XSS | Plain text/escaping, never dynamic provider HTML, URLs or script | Malicious names/result payloads in browser tests; no network/script side effects |
| Polling abuse/resource growth | Server/page/byte bounds, local request budget and backoff; client cap is not security enforcement | Oversize/query/page tests, query count/EXPLAIN, repeated connect/dispose tests |
| Stale RUNNING misleading users | Independent freshness badge, expire pulse, authoritative recovery | Controlled time/disconnect/restart tests |
| LAN/public exposure | Existing production fail-closed + effective loopback dev server + exact Origin | Nonloopback/Host/Origin/default/production tests; no new wildcard CORS |

Do not log bearer, response payload, result, tool arguments or URLs with query. Reuse safe requestId/duration/route-template logs and existing audit history; no new metrics platform or new status event source. Read accesses need not create lifecycle events. Future production identity, scoped sessions/rotation, tenant membership, TLS/CSRF policy and rate limiting require a separate design/acceptance gate; no Phase 3 local acceptance authorizes production exposure.
