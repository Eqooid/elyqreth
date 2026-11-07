# Phase 6 architecture decisions

2026-10-29, Asia/Bangkok. **ADRs 001-006 were accepted for planning; ADRs 007-010 record subsequent backend authentication, frontend session integration and container hardening. Purchase/deploy actions remain PLANNED.** User requested that audience and database operating model remain undecided with both gates and total operating cost compared. These decisions preserve [Phase 5 ownership ADRs](../phase-5/decisions.md). No existing runtime/authentication boundary is replaced by T01.

## P6-ADR-001 - Small app host with managed PG as conditional planning baseline

Choose option B for the architecture baseline: one app VPS/Compose topology and privately reachable managed PG, conditional on approved TCO, region/private route, supported TLS/version/roles and restore evidence. It separates app-host loss from database storage and avoids assuming an available DB on-call team. Alternative A is cheaper in service count but retains correlated failure and full backup/patch/restore labor; explicit operator/restore acceptance can select it. Managed containers (C) add IAM/runtime-contract/polling/instance-retirement coupling not currently justified. No Kubernetes requirement or provider/price commitment is made. D02/D03 are procurement gates, not assumed resolved.

## P6-ADR-002 - Preserve in-process native execution, one writer initially

No worker, queue, Redis or broker exists to deploy. Keep one API with its existing Runtime Coordinator and durable PG admission/result authority. Native concurrency one and per-Agent leases do not prove safe fleet-wide admission. Plan drain/maintenance replacement and conservative quarantine, not automatic redispatch. Worker extraction, multi-instance writes or a durable consumer require a separately justified dispatch/fencing ADR and fault tests; they are not prerequisites invented for T01. External runtimes keep their own queues/execution authority.

## P6-ADR-003 - Explicit production access extension, never loopback bypass

Production features currently fail closed in backend configuration/guards and frontend transport. A proxy/VPN is insufficient. Extend the existing principal/audience/owner policy path with verified production identities, keep local dev token mode restricted and reuse object authorization. Document both private named-operator and public-account gates; choose before implementation. Same-origin HTTPS and secure browser session/CSRF mode are proposed, subject to T02 identity/session contract. Trusting public headers, using dev mode publicly, embedding an operator token or globally assigning every user the configured owner are rejected.

## P6-ADR-004 - Promote immutable paired images, not temporary verifier output

Use existing static web and API container targets from one trusted commit, build once, publish digests and a schema/config/evidence manifest, then manually promote without environment rebuild. Root dist/ is maintained source; build:web deletes its temporary verification output. Retain current complete asset delivery/no-cache until a versioned caching scheme is tested. No SSR/frontend Node runtime, new renderer, auto-production deploy or CI/CD implementation in T01. Single-writer maintenance cutover is preferred to unsafe overlapping blue/green native admission.

## P6-ADR-005 - Recoverability is a measured gate, not a backup claim

PG remains the durable system for work, correlation, inbox/outbox and audit. Off-host encrypted protection plus independent recovery keys, isolated restore, schema/data validation and external-effect reconciliation are mandatory. Managed features/volume persistence alone are insufficient. RPO/RTO/retention proposals need owner approval and actual measurements; no destructive down migration or restore-triggered native replay. A stricter RPO requires a proven continuous protection design rather than mislabelling daily exports.

## P6-ADR-006 - Minimal operations and staged conditional promotion

Start with existing structured logs, bounded rotation, protected health/readiness and small off-host alerting/DB dashboards, adding only needed telemetry. No new observability cluster or permanent staging expense without justification. Use isolated on-demand staging/UAT and real fault/restore/load evidence before production approval. The absence of a supplied Git checkout/provenance and unresolved audience/budget/provider/operational targets are explicit downstream gates. These do not authorize paid resources or deployment. See [decision register and roadmap](implementation-plan.md).

## Reviewed primary references

Reviewed 2026-10-29; sources inform planning, not a hosted compatibility/price guarantee.

- [Docker single-server production Compose guidance](https://docs.docker.com/compose/how-tos/production/) supports using a separate reviewed production configuration rather than the development definition unchanged.
- [Docker Compose secrets](https://docs.docker.com/compose/how-tos/use-secrets/) describes per-service file mounts; this is not an encrypted secret-management service or automatic application _FILE support.
- [PostgreSQL 17 logical backup](https://www.postgresql.org/docs/17/app-pgdump.html) and [WAL/PITR](https://www.postgresql.org/docs/17/continuous-archiving.html) describe distinct recovery mechanisms; restore evidence is still required for the selected deployment.
- [PostgreSQL TLS modes](https://www.postgresql.org/docs/17/libpq-ssl.html) informs the trust requirement, while Elyqreth's actual Node pg client/CA/hostname behavior must be tested rather than assumed from libpq documentation.
- [Cloud Run container contract](https://docs.cloud.google.com/run/docs/container-contract) and [concurrency configuration](https://docs.cloud.google.com/run/docs/about-concurrency) demonstrate platform lifecycle/concurrency constraints to validate before considering model C; no Cloud Run deployment or price was tested.

## P6-ADR-007 - Exclusive local or OIDC backend authentication

2026-10-30: the user explicitly requested local username/password support alongside OIDC, selected **one mode per installation**, and authorized a disposable local Keycloak test without requiring an existing provider. This supersedes the earlier T03-only prohibition on introducing a local authentication mechanism; it does not authorize public signup, new tenancy/sharing or production deployment.

Implement AUTH_MODE=disabled/local/oidc. The default retains existing loopback-only development audiences. Local mode adds named operator-provisioned accounts, strong salted scrypt hashes and revocable PostgreSQL-backed opaque sessions. OIDC mode accepts explicitly configured RS256 API access JWTs with reviewed public keys and a nonempty approved-subject grant list. There is no simultaneous mode or automatic fallback. Each installation deliberately selects an existing owner and viewer/operator policy; this is explicit private operator access, not assignment of every signed/public user to a global owner.

All source owner predicates, composite constraints, lifecycle and runtime claim checks remain. User identity is separate from resource owner/Agent/service actor. Human initiating commands have local-user or issuer/subject-hash references; native and external service outcomes retain service attribution. Account management is trusted stdin-only CLI, not an HTTP administrative API. Local bootstrap creates no default account/password. Provider revocation/introspection and browser OIDC login/session/CSRF remain separate from the backend verifier.

Use pinned JWKS snapshots to avoid a new unrestricted outbound discovery/fetch boundary; key rotation is a reviewed configuration update/restart. Mixed encryption keys are excluded from the signing verifier and private material is rejected. The real Keycloak acceptance fixture is loopback-only, disposable and test-only; its start-dev/password grant is not a production recommendation. [Mode contracts and limits](authentication-modes.md) and [verification evidence](verification-evidence/dual-auth-verification.json) define scope. TLS/private networking, secret injection, deployment and public-account decisions remain later gates.


## P6-ADR-008 - Memory-only frontend bearer session for the existing account contract

2026-10-30. T04 reuses the explicit local/OIDC T03 bearer mechanism. Local sign-in and OIDC API-token entry must be confirmed by `/api/v1/auth/me` before connecting the existing clients. One page session owns invalidation; the existing polling and panel owners continue owning their read/request state. Tokens/passwords are never persisted in browser storage, public configuration or cross-tab messages. Cold reload requires sign-in.

Use public `{mode}` JSON and the same-origin HTTPS API, with explicit HTTP loopback development only. No arbitrary production API URL or implicit development token fallback is introduced. Cookies, refresh, issuer redirect/PKCE and provider logout are not invented where no approved backend contract exists. A 401 clears all protected data/requests/synchronization; resource 403/404 remains distinct from global logout. Unconfirmed logout reports unconfirmed server revocation. The decorative city remains public and unchanged.

This is the supported private operator browser profile, not public self-service SSO or production edge deployment. A disposable real PostgreSQL/Nest/HTTPS browser fixture tests the transport and lifecycle; its local certificate pin/proxy/revocation control are test-only. T05/T06 still own artifact/secret/readiness and actual trusted edge configuration. See [implementation, limitations and evidence](frontend-access.md).


## P6-ADR-009 - Production packaging with private file inputs and namespace-local readiness

2026-11-04. T05 retains the static nginx image, one API/native writer and separate maintenance command from the same API image. Pin official Node/nginx versions and image digests; install/prune with the existing lockfile and exclude host/private artifacts through an allowlist. Use non-root app users, read-only runtime filesystems, explicit temp mounts, bounded resources/logs/restarts, with no worker or broker extraction.

Reuse configuration validation after narrowly resolving backend secret files; do not mutate process.env with file values, put secrets in build arguments, invent session signing keys or bypass production database TLS. DATABASE_SSL_CA_FILE supplies reviewed CA PEM to rejectUnauthorized=true. Secrets are service-scoped mounts with real Linux permission checks; Compose bind-file permissions are an operator prerequisite, not automatic secret encryption.

Separate process liveness from read-only bounded/coalesced migration/schema/database readiness. Readiness accepts only real loopback peers, becomes false on drain and rejects fresh business admission; existing runtime shutdown/fencing remains authoritative. The production Compose contract follows the conditional managed-DB baseline, publishes no ports, includes no database/worker/edge service, and never auto-migrates each API. T06/T07/T09 retain network, role and full drain gates. See [contracts and evidence](container-hardening.md).

## P6-ADR-010 ? One TLS edge, separate internal links and untrusted forwarding at the API

2026-11-05. T06 uses the already pinned nginx family as one non-root edge target. An explicit overlay of production packaging publishes only 80/443; web/API stay private on separate internal links, while only API/migrator retain the private DB/provider application bridge. No worker, queue, webhook, new authentication mechanism or external runtime is created.

Terminate TLS directly, accept only the configured canonical authority, sanitize forwarding/request IDs and retain backend trust-proxy=false. Existing bearer authentication does not need trusted forwarded protocol/IP or cookie modifications. Reject blanket trust/hop guessing and incoming identity headers as authentication. Keep exact backend Origin/CORS and object ownership policy. Same-origin assets/API and bounded HTTP polling are the actual transports, not speculative SSE/WebSockets.

Protected key/chain mounts, runtime config validation, CSP/headers, request/login bounds, non-retried mutations, safe logs and namespace-only readiness are validated against local pinned containers and a disposable PostgreSQL/browser fixture. See [edge contracts/evidence](edge-network.md). Future artifact manifests must include the new edge image alongside the existing API/web pair; this does not implement promotion/CI. Host/provider firewall, actual domain/renewal owner/private DB selection remain real-environment promotion prerequisites; no host or remote infrastructure is changed.

## P6-ADR-011 - Explicit database ownership and maintenance authority

2026-11-05: use two non-superuser dedicated LOGIN roles, shared runtime DML and separately invoked migration ownership, plus external bootstrap administration. A bootstrap-owned read-only access contract binds role identities and the database. Production API startup fails without it. Drizzle demonstrably requires database CREATE for its journal-schema statement, so grant that only to the migration role; runtime has no DDL/TEMP or role memberships. Future objects default to denial, with explicit reviewed grant manifests. Reuse the existing session advisory key with fail-fast acquisition; preserve Drizzle batch SQL/journal transactions and apply grants in a separate transaction under the same lock. ACL failure means nonzero deployment failure, not falsified journal rollback. Populated adoption is explicit, scoped and transactional. Exact-release readiness retains maintenance cutover; no fleet-wide migration/bootstrap automation or production database is introduced. See [implementation and evidence](database-migrations.md).

## P6-ADR-012 - Encrypted logical export and isolated recovery before cutover

2026-11-05: use PostgreSQL 17 custom-format dumps from a dedicated read-only backup login, sharing the existing maintenance lock and an exported repeatable-read snapshot. Stream encryption binds ciphertext to the backup ID; authenticate metadata separately. Keep private files/key recovery outside application source and service credentials. Validate copied encrypted artifacts, retain a restore-tested point, and refuse pruning after failed attempts. Generic restore is limited to confirmed empty isolated targets with T07 migration authority and no ownership/ACL replay. Preserve native/external recorded authority and require effect/session reconciliation before any separately approved production cutover. No scheduler, off-host provider, PITR, worker, new runtime engine or production deployment is introduced. [Implementation/runbooks/evidence](backup-recovery.md) distinguish local proof from production recovery objectives.

## P6-ADR-013 - One native host admission gate and conservative bounded drain

2026-11-05: retain the single-writer Runtime Coordinator and existing PostgreSQL lease/token/uncertain-effect fencing. One application host closes native admission synchronously, tracks in-flight admission through finalization, permits bounded completion and then applies existing cancellation/quarantine semantics. Gate direct/CLI allocation and execution, legacy native lifecycle starts, child preparation and bounded recovery. A committed never-dispatched claim is interrupted conservatively; a never-admitted child remains recoverable rather than becoming a business failure. No uncertain side effect is automatically replayed.

Actual HTTP bootstrap owns SIGTERM/SIGINT once; Linux SIGUSR2 performs native-only drain without cancelling external work or removing authorized inspection. Readiness is false during drain while liveness remains available. Maximum 20s grace plus 5s finalization fits the 30s HTTP hard deadline and existing 45s container grace. Process-local diagnostics remain behind the existing namespace-only probe. No queue, fleet-wide barrier, worker extraction, new migration, public administrative route or execution authority is introduced. See [runtime contracts, runbooks and evidence](runtime-drain.md).

## P6-ADR-014 - Bound the existing observation tier and retain the production source gate

2026-11-06: the user has no approved production LangGraph target and explicitly requested that activation remain closed. Keep external profiles rejected in production and legacy source approval unavailable to named local/OIDC accounts. Do not invent a webhook, service token, signature scheme, provider, dispatch capability or source principal merely to remove that gate.

Harden the existing tier with a full connection/credential binding at asynchronous operation/commit boundaries, distinct per-connection credentials and two occupied slots per connection within the existing process-global four-slot budgets. Preserve zero automatic retries, pinned verified TLS, explicit private destinations and durable receipt/order/authority contracts. Exclude known cloud platform/IPv6 metadata services even under the private policy. Actual TLS fixtures and restricted PostgreSQL tests verify these local contracts; they are not hosted-provider evidence. A future activation requires the specific approved target/version/network/key and a separately reviewed T03-compatible source-access policy. [Inventory, runbooks, limits and evidence](external-connectivity.md) define the delivered scope.

## P6-ADR-015 - Closed telemetry and private host diagnostics before notification activation

2026-11-06: retain ApiLogger and the existing namespace-only readiness route. Use a closed field/event policy with request/config credential redaction, categorized dependency transitions, committed ingestion outcomes and a bounded owner-scoped read-only host report. Operational UUIDs remain logs/audit references, never metric labels. A local fixed-label JSONL detector supplies proposed alert conditions without a public exporter, monitoring platform or external delivery. Existing durable audit remains authoritative attribution; telemetry failures cannot change authorization or lifecycle outcomes. No separate worker/broker/tracing system is invented. The user has no incident owner or alert receiver and explicitly chose deployment gates: T11 remains PARTIAL until ownership, retention/access, off-host delivery and failure/incident rehearsals are approved and verified. [Contracts and runbooks](observability.md).


T11 follow-up, 2026-11-06: the user selected Email and authorized completing the missing monitoring support without disturbing existing features. Use an optional host-only read-only monitor and implicit verified TLS SMTP sender, disabled by default. It shares no lifecycle or database ownership with API/native runtime, introduces no dependency, persists bounded retry/deduplication state privately and quarantines uncertain SMTP acceptance. Real provider/recipient/owner inputs and activation remain separate gates. [Email configuration and local verification](email-monitoring.md).


## P6-ADR-016 - Immutable local candidates and review plans while publication remains closed

2026-11-06: the user left canonical repository, registry and approvers undecided and explicitly requested closed publication/deployment. Extend existing GitHub Actions with read-only manual/default-branch preparation, committed Git-archive contexts, pinned tools, three once-built OCI targets, streamed content/attestation/runtime checks and canonical digest manifests. Migrator identity equals API identity. Reuse the exact bundle in review plans; fixtures/operator JSON never constitute live authorization or signed provenance. Preserve private target configuration, existing T07/T08/T09 safety, single native writer and conservative same-migration-inventory rollback. No publisher, deployment adapter, SSH, registry write token or apply command is created. Actual hosted/toolchain/publication/environment evidence remains blocked and T12 is PARTIAL. [Contracts and runbooks](immutable-promotion.md).
