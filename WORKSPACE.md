# Current project workspace

**Current checkpoint — Phase 6 T16 (2026-11-07, Asia/Bangkok): HANDOVER PREPARED — PRODUCTION DEFERRED.** [Startup/Agent/provider guide](docs/ai-agent-platform/phase-6/local-operations.md), [operations handover](docs/ai-agent-platform/phase-6/operations-handover.md), [task/evidence/acceptance matrices](docs/ai-agent-platform/phase-6/handover-evidence.md). T16 preparation COMPLETE; original production acceptance NOT STARTED. T02 and T11-T15 remain PARTIAL. Private production configuration/provisioning/deployment are intentionally deferred; promotion CLOSED — DEFERRED BY PROJECT OWNER. No automatic next task. All earlier checkpoints below are historical.

**Phase 6 T06 (2026-11-05): COMPLETE for locally verified edge/private-network configuration.** See [TLS, routes, isolation, auth/polling, certificate tests and final evidence](docs/ai-agent-platform/phase-6/edge-network.md). T07 Production Database Roles & Migration Safety is next and not started. Only one API header-budget compatibility fix was needed; city source, lifecycle, migrations and development Compose are unchanged. Hosting/actual DNS/private DB/firewall/renewal ownership remain deployment gates. No remote deployment, production credentials, commit or release occurred. Earlier checkpoints below are historical.

**Phase 6 T05 (2026-11-04): COMPLETE for locally verified container packaging.** See [images, secret files, readiness, shutdown, evidence and remaining gates](docs/ai-agent-platform/phase-6/container-hardening.md). T06 is next and unstarted. T02 hosting/public-audience decisions remain open; no remote deployment or production credential was created. Existing environment files, migrations, native/external execution semantics and city source were preserved. Earlier checkpoints below retain their task-date context.

**Phase 6 T04 (2026-10-30): COMPLETE for the supported private-operator frontend access/session contract; final verification recorded in the [current guide](docs/ai-agent-platform/phase-6/frontend-access.md).** T03 supports exclusive local or OIDC private-operator backend access; T04 adds memory-only frontend login/token entry, principal verification, session cleanup and authorized existing UI. T02 remains PARTIAL for unresolved deployment/public-audience decisions. T05 and later remain planned. No production credentials, deployment or provisioning occurred. Older checkpoints below are historical, not current status.

**Historical checkpoint - Phase 6 T01 (2026-10-29): COMPLETE, architecture and planning only.** See [production architecture, audience/database decisions, operational risk register and implementation roadmap](docs/ai-agent-platform/phase-6/README.md). Both initial audience and database operating model remain undecided; private/public access gates and total operating cost are documented. T02-T16 remain PLANNED. No production code, infrastructure, secret, CI/CD or deployment change has been implemented. Next: Phase 6 T02 - Production Access & Configuration Contracts, separately authorized.

**Phase 4 checkpoint - T10 (2026-10-27): READY for the approved trusted, single-backend loopback development environment.** Phase 4 interaction, lifecycle, results/history and recovery have executed acceptance evidence. See the [current acceptance report](docs/ai-agent-platform/phase-4/acceptance.md), [operations guide](docs/ai-agent-platform/phase-4/operations.md) and [risk register](docs/ai-agent-platform/phase-4/risk-register.md). Public production exposure remains blocked by the identity/security deployment prerequisites. Phase 5 status is recorded in the checkpoint below. The Phase 1-2 checkpoints below are historical; their statements about future city integration do not describe the current implementation.

**Phase 5 checkpoint (2026-10-29): COMPLETE - ACCEPTED for approved fixed-owner loopback development/test. T01-T12 COMPLETE.** See the [canonical acceptance matrix, fresh evidence, limitations and Phase 6 prerequisites](docs/ai-agent-platform/phase-5/acceptance.md). Native collaboration, external observations and NPC collaboration inspection are verified; provider/native execution authority remains separate. Public production identity/tenancy, hosted deployment and automatic uncertain-work repair remain unsupported. **Phase 6 T01 planning is complete; implementation remains PLANNED.** No release or deployment was performed.

**T12 acceptance (2026-10-24): ACCEPTED WITH LIMITATIONS for local development only.** See [the acceptance report](docs/ai-agent-platform/phase-2/acceptance.md) for 173 backend, 89 isolated PostgreSQL and 51 city tests, both builds, browser smoke and live installed Ollama text/calculator evidence. Live OpenAI was NOT RUN. External production exposure remains BLOCKED without production identity/access controls. Earlier task checkpoints below are historical evidence.

**Phase 2 checkpoint:** T02-T11 are implemented and T12 reviewed. Current live Ollama text and calculator probes passed; historical string-operand failures remain documented model-reliability evidence. No worker, unrestricted public API or city synchronization exists. Phase 3 is planning only.

**Current acceptance checkpoint:** T08 verification/stabilization is recorded in the [Phase 1 acceptance report](docs/ai-agent-platform/phase-1-acceptance.md). Use its final decision and evidence rather than the historical task checkpoints below. `npm run verify:phase1` reproduces all development checks, including owned-container PostgreSQL and headless browser smoke. The city remains independent; no worker, broker or realtime city integration exists.

The complete Elyqreth project now lives in:

`C:\Users\user\Desktop\Project\Elyqreth`

Use this directory for all future implementation work. The former source export was consolidated here on 2026-10-21 (Asia/Bangkok); paths mentioned in T01–T03 historical audit records describe their original inspection location, not a required runtime dependency.

- City frontend: `dist/` (hand-maintained source; preserve it).
- NestJS backend: `apps/api/src/`.
- Database schema and migrations: `apps/api/src/database/` and `apps/api/migrations/`.
- PostgreSQL setup: `docker-compose.yml`.
- [Architecture and implementation documentation](docs/ai-agent-platform/README.md).
- [Database setup and verification](docs/ai-agent-platform/database-foundation.md).

Run commands from this root:

```sh
npm run dev:web
npm run dev:api
npm run build
npm run test:all
npm run test:db
```

Web and API development commands run independently in separate terminals. PowerShell users can use `npm.cmd` when npm.ps1 is blocked. Dependencies were reinstalled here to recreate the workspace link at its new location. Existing PostgreSQL data uses named Docker volumes, not the old project path.

Five differing documentation files that already existed in this destination were preserved verbatim under [the pre-move archive](docs/ai-agent-platform/history/before-workspace-move-2026-10-21/README.md). Current documents are in docs/ai-agent-platform. No application behavior was changed by the relocation.

**Phase 1 T01–T07 foundations are implemented.** See [registry setup](docs/ai-agent-platform/agent-registry.md), [task/execution API](docs/ai-agent-platform/task-execution-persistence.md), [internal lifecycle service](docs/ai-agent-platform/lifecycle-service.md), and [versioned events/audit history](docs/ai-agent-platform/event-audit-foundation.md). HTTP access remains opt-in loopback development; lifecycle/event mutations have no public routes. Production authentication remains deferred and access fails closed. Apply explicit migrations before local use, including 0003_event_history.sql. Next implementation task is **Phase 1 T08 — Integration Tests & Final Acceptance Review**; it has not begun.

Relocation verification: all 215 non-dependency files were hash-verified before removing the old source directory. Build/static checks passed, as did the final 51 city, 15 backend and 15 PostgreSQL integration tests. One unchanged simulation test failed on the first full run, then passed in isolation in both locations and on the full rerun; no simulation code was changed.

T04 verification: 51 city tests, 25 backend tests and 23 real PostgreSQL tests passed; build, static checks and migration-journal checks passed. All 148 protected frontend/test/hosting/reference files match the pre-T04 SHA-256 baseline. Details and limitations are in the registry guide.

T05 verification: 51 city, 34 backend and 33 real PostgreSQL tests passed, including concurrent idempotency/attempt allocation and a populated T03-to-T05 migration upgrade. Build, strict/static checks and migration checks passed. All 148 protected frontend/test/hosting/reference files and prior migration SQL/snapshots remain hash-identical. See the task/execution guide for details. T06 has not begun.

T06 verification: 51 city tests, 39 backend tests and 41 real PostgreSQL tests passed. Build/static/migration checks passed; all 155 protected city/reference/test/migration baseline files remain hash-identical. Details, concurrency policy and cancellation limitations are documented in the lifecycle guide. T07 has not begun.

T07 verification: 45 backend and 48 real PostgreSQL tests passed; build/static/migration checks passed. All 148 protected city/reference/test/hosting files and earlier migration SQL/snapshots remain hash-identical. Full city regression was 50/51 on two runs, with the same café-interruption assertion previously recorded during relocation; that test passed alone. No city/test change was made. This is an open T08 acceptance item, not an all-tests-green result. See the event/audit guide for details. T08 has not begun.



## Phase 6 T02 checkpoint

Common production configuration validation and redacted diagnostics are implemented; see [contracts/inventory and decision gates](docs/ai-agent-platform/phase-6/configuration-contracts.md) and [verification](docs/ai-agent-platform/phase-6/t02-verification.md). T02 is PARTIAL because audience, identity/session and database operating choices remain undecided. Local features remain dev/test only; no production access, deployment or infrastructure was added. T03 has not started.

## Phase 6 T03 checkpoint

T03 local authorization hardening and object-isolation verification are recorded in [principal model and authorization matrix](docs/ai-agent-platform/phase-6/principal-authorization.md) and [test evidence](docs/ai-agent-platform/phase-6/t03-verification.md). The user selected an existing OIDC/JWT issuer; exact issuer, audience, algorithm/key source, subject-to-owner/permissions and private/public audience are still required. Production remains closed; T03 is PARTIAL. No T04+, identity server, tenancy, deployment or city changes were introduced.

## Dual-auth continuation checkpoint - 2026-10-30

The user expanded T03 to support local username/password or OIDC, one mode per installation, and authorized real testing with disposable Keycloak. See [current authentication guide](docs/ai-agent-platform/phase-6/authentication-modes.md) and [current evidence](docs/ai-agent-platform/phase-6/verification-evidence/dual-auth-verification.json). Existing T03 issuer-only blockers above are task-date history. Backend modes now use explicit private owner/operator grants; frontend login is T04 and has not started. No permanent user/default password, production database migration or deployment was performed.

Final backend-auth acceptance: COMPLETE for the supported private single-owner modes. Final serial verification: 295 backend, 218 real DB/integration/browser, 10 selected live-Keycloak integration and 228 frontend tests passed; lint/typechecks, builds and migration metadata checks passed. Earlier Windows cleanup/startup failures remain recorded. T04 frontend login/session work has not started; production readiness/deployment is not claimed.
