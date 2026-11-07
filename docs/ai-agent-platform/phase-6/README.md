# Phase 6 - Production Hardening & Deployment

Review date: 2026-11-07, Asia/Bangkok. **T01 COMPLETE (planning); T02 PARTIAL (common configuration validation implemented); T03 COMPLETE for private-operator backend authentication: exclusive local accounts or OIDC for explicitly configured private operator access; final evidence is linked below. T04 COMPLETE for the supported private-operator frontend bearer/session integration, including real HTTPS browser verification; production edge and public tenancy remain separate. T05 COMPLETE for locally verified container/secret/readiness packaging. T06 COMPLETE for locally verified TLS edge/private-network configuration. T07 COMPLETE for restricted database roles/migration safety. T08 COMPLETE for locally restore-tested encrypted backup tooling; T09 COMPLETE for locally verified native admission, bounded drain and restart contracts; see the runtime guide below. T10 COMPLETE for verified local security hardening with production activation explicitly closed; T11 is PARTIAL: local observability and runbooks are verified, but incident ownership and off-host alert delivery remain deployment gates. T12 candidate/manifest/dry-run contracts are locally verified and PARTIAL; publication/deployment remain closed. T13 is PARTIAL: isolated local simulation with fixed image IDs; approved release deployment, previous-release rollback and human acceptance remain gates. T14 adds local security/capacity and source-loss recovery verification; it is PARTIAL and release readiness is NOT READY pending the documented gates. T15 is PARTIAL for preparation: the offline readiness decision is BLOCKED, production authorization is absent and promotion is NOT STARTED. T16 independent handover preparation is COMPLETE; original deployed production acceptance is NOT STARTED. Phase 6 is HANDOVER PREPARED — PRODUCTION DEFERRED; promotion CLOSED — DEFERRED BY PROJECT OWNER. No production deployment or operator acceptance is claimed. Off-host hosting, scheduling and approved recovery objectives remain operational gates. No provisioning, deployment or production secret creation occurred.** [Phase 5 acceptance](../phase-5/acceptance.md) remains limited to trusted fixed-owner loopback development/test.

User-configurable T15 decisions are in the [version-2 prerequisites template](../../../docker/production-prerequisites.example.json), with [private-copy setup and offline validation instructions](t15-blocker-closure.md#configure-decisions-yourself-current-continuation). Filling the worksheet does not authorize promotion; all publication/deployment gates remain closed.

## Plan and status

- [T16 operations handover and runbook index](operations-handover.md)
- [Consolidated local startup, native/LLM Agents and LangGraph connection](local-operations.md)
- [T01-T16 task/evidence/acceptance and deferred-prerequisite matrices](handover-evidence.md)

- [T06 HTTPS edge, routing, private networks, bearer/polling compatibility and evidence](edge-network.md)

- [T05 container topology, secret-file/CA inputs, readiness, shutdown and production packaging](container-hardening.md)


- [T04 frontend access/session architecture, setup and limitations](frontend-access.md)


- [Production architecture, audited boundaries, hosting comparison and network/runtime diagrams](production-architecture.md)
- [Environment, artifact promotion, deployment/migration and rollback strategy](deployment-strategy.md)
- [Observability, backup/restore, runbook inventory and risk register](operations-recovery.md)
- [Ordered T02-T16 implementation roadmap and production acceptance gates](implementation-plan.md)
- [P6-ADR-001 through 012](decisions.md)
- [T01 verification and preservation evidence](verification.md)
- [T02 configuration/access contracts and unresolved gates](configuration-contracts.md)
- [Consumed environment inventory](configuration-inventory.md)
- [T02 verification evidence](t02-verification.md)
- [T03 principal model, authorization matrix, fixes and OIDC gate](principal-authorization.md)
- [T03 earlier verification record](t03-verification.md)
- [Current local/OIDC configuration, account CLI and test guide](authentication-modes.md)
- [Current dual-mode verification evidence](verification-evidence/dual-auth-verification.json)

**Recommended planning baseline:** one always-on application VPS running a planned HTTPS edge, existing static web and one NestJS API with its existing in-process Runtime Coordinator, backed by privately reachable managed PostgreSQL. No separate native worker, broker, Redis, Kubernetes or external execution engine is proposed for the first release. Managed database procurement remains conditional on total operating cost, private connectivity, restore evidence and operator approval. A self-hosted database is a documented alternative, not an automatic fallback.

## Requirements, assumptions and open decisions

| Class | Statement / evidence |
| --- | --- |
| Confirmed | Plain ES-module/Canvas frontend; static nginx image; NestJS/Node 24 API; PostgreSQL/Drizzle; synchronous native execution; one process-local admission slot; source-scoped external inbox; one observation-only LangGraph adapter |
| Confirmed | Default privileged APIs/configuration and browser transport reject non-loopback/production interaction; the explicit T03 account mode now provides a verified backend private-operator extension. Current Compose is local/development, not a production template with features enabled |
| Confirmed | No Elyqreth worker service, broker, Redis, automatic queue consumer or public tenant/enrollment system exists. T04 supplies private-operator browser session integration; T05 supplies namespace-local readiness |
| User decision | Initial audience remains **undecided: document both private-operator and public-account gates** |
| User decision | Database operating model remains **undecided: compare total operating cost**; no budget or procurement approval supplied |
| Planning assumption A1 | Start with one API/runtime process and one app host; accept a maintenance cutover only if the service owner approves downtime. This is not an availability SLA |
| Planning assumption A2 | Avoid GPU/model hosting on the app host; approved model/orchestrator endpoints are independent external services. Local provider development tooling is not deployed |
| Planning assumption A3 | Managed PostgreSQL is the preferred risk/operations baseline if affordable; no managed service/HA/PITR feature is assumed purchased or available |
| Planning proposal A4 | Initial private pilot backup design target: RPO at most 24 hours and RTO at most 4 hours, subject to owner approval and measured restore. Stricter loss limits require tested PITR/continuous protection. These are proposals, not confirmed requirements or promises |
| Unknown | Domain/region/data residency, canonical source repository/registry, IdP and audience, ownership/tenant model, VM/database provider, budget ceiling, traffic/users, execution rates/durations, provider quotas, retained data sizes and support/on-call ownership |
| Unknown | Availability objectives, maintenance window, confirmed RPO/RTO, audit/data retention policy, recovery approver and production release authorization |

No user count, traffic forecast, benchmark, monthly price or SLA is invented. Resource candidates and rate limits must be chosen using T14 measurements. For any audience, exposing current local tokens or setting NODE_ENV=development behind a public proxy is forbidden.

## Two audience gates

**Private operators/invited team:** authenticated HTTPS entry, named verified principals, least-privilege viewer/operator/admin mappings into the existing authorized owner scope, API validation of identity/audience, per-actor audit, secure browser session integration, rate limits, private service networking and revocation tests are mandatory. VPN/IP restriction is defense in depth, not a substitute for backend authorization. The current owner/capability policy stays intact; the production principal adapter is a planned extension, not a replacement of native lifecycle or authorization rules.

**Public accounts:** all private-operator controls plus an explicit account/owner or workspace membership model, per-request server-derived owner scope, cross-account isolation tests, lifecycle/session abuse protection, enrollment/recovery and data retention/privacy decisions are mandatory. Existing globally configured registry owner IDs are not public tenant isolation. Public exposure stays blocked until these decisions and tests pass. If the chosen scope needs a larger identity migration, T02 must split the subsequent work before implementation; it must not silently enable public access.

T02 must select the audience and configuration/security contract before production access code is implemented. An undecided audience or database supplier does not block this planning deliverable, but blocks the dependent procurement/exposure steps. Later tasks and every actual staging/production provision or promotion require their own authorized scope. T02 common validation is implemented; decision gates remain unresolved. The earlier T03 issuer-only prerequisite was subsequently refined by the user-authorized alternative local mode. The user subsequently authorized exclusive local username/password or OIDC modes and a disposable Keycloak test. T03 now implements that backend contract for explicitly approved private owner/operator scope. A real OIDC installation supplies its issuer/audience/public keys/subject grants; local mode does not require an IdP. T04 frontend integration and T05 container packaging are complete for their documented private-operator/local-verification scope. T06 edge/network packaging is locally verified; T07 database roles/migration safety is locally verified; see [role and migration guide](database-migrations.md). T08 backup/isolated recovery tooling is locally verified; see [backup/recovery guide](backup-recovery.md). T09 implementation and local verification: [native runtime drain/restart guide](runtime-drain.md). T10 local security hardening is verified with the user-selected production gate closed; see [external connectivity](external-connectivity.md). T11 observability is locally implemented and verified, but remains PARTIAL pending named responders and approved off-host alert delivery; see [observability and runbooks](observability.md). T12 is PARTIAL for locally prepared immutable artifacts and review plans; registry/deployment are closed. See [T12 guide](immutable-promotion.md). Production deployment/public-audience/hosting gates remain open.

T07 implementation: [database role architecture, provisioning, preflight and recovery](database-migrations.md), with [local verification evidence](verification-evidence/database-role-verification.json). Actual hosted database permissions, backups and deployment approval remain separate gates.

T08: [durable inventory, backup security, isolated restore and runbooks](backup-recovery.md), with [executed local recovery evidence](verification-evidence/backup-recovery-verification.json). Production cutover, remote storage and recovery SLA acceptance remain separate.

T09: [native admission, lifecycle, drain/restart runbooks and private diagnostics](runtime-drain.md), with [executed verification](verification-evidence/runtime-drain-verification.json).

T10: [external connectivity, credential binding, SSRF, ingestion and rotation runbooks](external-connectivity.md). Production activation remains closed by the user decision dated 2026-11-06; no approved target/source policy is fabricated.

Optional T11 follow-up: [separate email monitor, disabled configuration, SMTP security and activation procedure](email-monitoring.md). Local fixtures are verified; actual inbox delivery and named incident ownership remain gates.

T12: [immutable candidate bundles, CI controls, promotion/rollback plans and runbooks](immutable-promotion.md). No canonical Git/registry/approvers are configured; no publication, staging deployment or production promotion occurred.

T13: [isolated local staging/UAT runner, scope and acceptance limits](staging-uat.md), with [current evidence](verification-evidence/staging-uat-verification.json). This is not hosted staging or production acceptance.

T14: [security matrix, bounded capacity methodology, source-loss recovery and risk assessment](security-capacity-recovery.md), with [actual measurements and evidence](verification-evidence/security-capacity-recovery-verification.json).

T15: [production readiness matrix, authorization boundary, unbound change plan, preflight, smoke/rollback and prepared handoff](production-readiness.md), with [assessment and safe verification evidence](verification-evidence/production-readiness-verification.json).

T15 continuation: [blocker-closure register, local scanning/rollback, key/monitoring runbooks and private approval checklist](t15-blocker-closure.md), with [actual continuation evidence](verification-evidence/t15-blocker-closure-verification.json). Local verification is not full published-release or external prerequisite closure.
