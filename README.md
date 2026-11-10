# Elyqreth - A Living AI City

Elyqreth is an interactive cyberpunk city that represents backend AI Agents as NPCs. Its existing Canvas city, animated residents and environment use an Icy White (#F2F9FF) identity over dark architectural surfaces.

## For users

Start with the user guide. You do not need to read implementation phases or test reports to use the city.

| Read in this order | What it helps you do |
| --- | --- |
| **1. [User guide](docs/user-guide.md)** | Quick start, city controls, sign-in, real Agent inspection, Tasks, and integration limits |
| **2. [Set up your own installation and connect Agents](docs/ai-agent-platform/phase-6/local-operations.md)** | Configure the backend/database, native or LLM-backed Agents, and Agent-to-NPC mappings |
| **3. [Start the optional LangGraph reference](tools/langgraph-reference/README.md)** | Run the supported local external-orchestrator reference; not required for native Agents |

## For maintainers

Start with the architecture overview, then read only the guide for the subsystem you are changing or operating.

| Read in this order | What it explains |
| --- | --- |
| **1. [Architecture and operations overview](docs/ai-agent-platform/phase-6/operations-handover.md)** | System diagram, component responsibilities, authority boundaries, and operational runbook index |
| **2. [Authentication and access](docs/ai-agent-platform/phase-6/authentication-modes.md)** | Local accounts, OIDC, roles, sessions, provisioning, and revocation |
| **3. [External integration contracts](docs/ai-agent-platform/phase-5/external-integration.md)** | Adapter capabilities, integration requirements, and external execution authority |
| **4. [Database roles and migrations](docs/ai-agent-platform/phase-6/database-migrations.md)** | Privilege separation, migration preflight, locking, compatibility, and failure handling |
| **5. [Backup and recovery](docs/ai-agent-platform/phase-6/backup-recovery.md)** | Encrypted backups, verification, isolated restore, and recovery limitations |
| **6. [Current status and evidence](docs/ai-agent-platform/phase-6/handover-evidence.md)** | Implemented and tested scope, incomplete tasks, and deferred production prerequisites |

## Quick start

To open the local city preview, install Node 24.22.2 (see `.node-version`; older 24.x releases may be vulnerable to [CVE-2026-111497](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases)), open a terminal in this project folder, and run:

```powershell
npm.cmd ci
npm.cmd run dev:web -- --host 127.0.0.1 --port 5173 --strictPort
```

Open **http://127.0.0.1:5173**. This starts the built-in simulation; real Agent activity needs a configured backend and explicit mappings. **Residents → + Add agent** adds a simulated resident, not an installed AI Agent.

External observation adapters include **LangGraph Agent Server** and **Hermes Agent 0.21.2 with explicit configuration**. Hermes supports configured Agent/NPC registration and read-only polling of listed runs; see the [configuration guide](tools/hermes-reference/README.md) and [compatibility/testing limits](docs/ai-agent-platform/hermes-integration-audit.md). Automatic Hermes discovery is not required. CrewAI and AutoGen are not integrated.

## Current installation and production status

Use the [consolidated local startup, native/LLM Agent and LangGraph connection guide](docs/ai-agent-platform/phase-6/local-operations.md). The [T16 operations handover](docs/ai-agent-platform/phase-6/operations-handover.md) and [evidence/status matrices](docs/ai-agent-platform/phase-6/handover-evidence.md) complete independent handover preparation. Private production configuration and deployment are intentionally deferred: T02/T11-T15 remain PARTIAL, production acceptance NOT STARTED, promotion CLOSED — DEFERRED BY PROJECT OWNER. No production readiness or deployment acceptance is implied.

## Implemented capabilities

- Agent Registry, durable Tasks/Executions, native Runtime Coordinator, authorization and audit.
- Memory-only frontend account access, session expiry/logout cleanup and authorization-aware NPC/Task/collaboration inspection; see [frontend access](docs/ai-agent-platform/phase-6/frontend-access.md).
- Exclusive backend authentication modes: named local accounts with revocable sessions, or verified OIDC API tokens; viewer/operator grants and no fallback.
- Agent-to-NPC mapping, shared activity synchronization, Task submission, lifecycle controls and results/history.
- Explicit bounded Agent A-to-Agent B collaboration, delegation correlation, cancellation and safe operator recovery.
- Provider-neutral capability-gated external adapters, source-scoped identity mapping and trusted durable event ingestion.
- One observation-only LangGraph Agent Server reference: workflow discovery, selected run observation and restricted result provenance.
- Collaboration snapshots/history and NPC inspection with directed relationships, explicit native/external ownership and external freshness.

Native Executions remain owned by Elyqreth's Runtime Coordinator. External runtimes own their own Executions. Public user/tenant authentication, automatic uncertain-work repair, external dispatch/cancel and generic webhooks are not implemented.

## Local development and testing

Use Node 24 and npm from this repository root. Install dependencies with `npm ci`; run the standalone city with `npm run dev:web`. Real Agent interaction additionally requires migrated PostgreSQL and explicitly configured loopback API/runtime credentials; follow the [local operations guide](docs/ai-agent-platform/phase-4/operations.md) and [collaboration inspection/setup guide](docs/ai-agent-platform/phase-5/frontend-collaboration.md). Docker Compose keeps integrations disabled by default. There is no Elyqreth worker service to start.

Run `npm run dev:api` for the configured backend. External provider setup is optional: see the [pinned LangGraph local reference](tools/langgraph-reference/README.md). Operator/provider secrets remain backend-only; use the distinct limited browser audiences described in the guides.

Use `npm run verify:phase1` for the local verification rollup; it builds once, then runs the essential checks and tests. Docker and Chrome/Chromium are required for isolated database/browser E2E. See the [CI flow and additional manual checks](docs/ci.md). `npm run test:interaction:e2e` and `npm run test:city:e2e` cover specialized acceptance tiers; `npm run test:langgraph:live` requires the optional pinned reference server. Root `dist/` is maintained city source; build:web verifies a bundle in a disposable directory.

## History and evidence

These phase reports and implementation records are reference material. Start with the user or maintainer guides above; historical task names and acceptance statements retain their original scope.

- [Local/OIDC setup, local account creation, API contracts and real Keycloak test](docs/ai-agent-platform/phase-6/authentication-modes.md)

- [Phase 6 production architecture, configuration contracts, deployment/operations design and roadmap](docs/ai-agent-platform/phase-6/README.md)

- [Phase 5 acceptance, risks and Phase 6 prerequisites](docs/ai-agent-platform/phase-5/acceptance.md)
- [Phase 5 architecture, ADRs, implementation guides and roadmap](docs/ai-agent-platform/phase-5/README.md)
- [Platform documentation and prior phase acceptance](docs/ai-agent-platform/README.md)
- [T11 security, reliability and E2E evidence](docs/ai-agent-platform/phase-5/security-e2e-verification.md)
- [Preserved historical README checkpoints](docs/ai-agent-platform/history/pre-phase-5-final-readme.md)

Local acceptance does not imply production readiness, hosted-provider compatibility or a green remote CI run. Native crash uncertainty remains visible and fenced; manual assistive-technology review and sustained production load/capacity are not claimed by the local test evidence.

<details>
<summary>Historical implementation and production-hardening milestones</summary>

**Phase 5 COMPLETE - ACCEPTED for trusted fixed-owner loopback development/test (2026-10-29, Asia/Bangkok).** The [canonical acceptance report](docs/ai-agent-platform/phase-5/acceptance.md) records verified scope, task evidence, limitations and the final decision. Phase 6 T01 planning is complete; T02 configuration hardening and T03 backend authentication are implemented for explicit private-operator scope, with local username/password or OIDC selected per installation. Production hosting/access rollout decisions remain open. T05 adds verified non-root/read-only container packaging, backend secret-file/CA injection and private readiness; see the [container guide](docs/ai-agent-platform/phase-6/container-hardening.md). T06 adds the locally verified [HTTPS edge/private-network overlay](docs/ai-agent-platform/phase-6/edge-network.md), preserving bearer authentication and existing polling. T07 adds verified [restricted database roles and migration safety](docs/ai-agent-platform/phase-6/database-migrations.md). T08 adds [encrypted backup and isolated restore verification](docs/ai-agent-platform/phase-6/backup-recovery.md); off-host storage and production recovery approval remain operational gates. T09 adds [native admission, bounded drain and restart safeguards](docs/ai-agent-platform/phase-6/runtime-drain.md). T10 hardens [external connectivity and trusted ingestion](docs/ai-agent-platform/phase-6/external-connectivity.md); production external activation stays closed as requested. T11 adds [safe observability and incident runbooks](docs/ai-agent-platform/phase-6/observability.md); it remains PARTIAL until responder ownership and off-host alert delivery are established. T12 prepares [immutable candidates and controlled promotion plans](docs/ai-agent-platform/phase-6/immutable-promotion.md); publication and deployment remain closed. T13 adds an [isolated local staging/UAT rehearsal](docs/ai-agent-platform/phase-6/staging-uat.md), with actual tests distinguished from blocked release deployment and rollback. T14 adds [bounded capacity and disaster-recovery verification](docs/ai-agent-platform/phase-6/security-capacity-recovery.md); production readiness remains NOT READY pending explicit release and operational gates. T15 prepares an [offline production-readiness review and first-promotion plan](docs/ai-agent-platform/phase-6/production-readiness.md); the decision is BLOCKED, authorization is absent and promotion is NOT STARTED. The [T15 blocker-closure continuation](docs/ai-agent-platform/phase-6/t15-blocker-closure.md) adds actual local container scans and metadata-variant rollback verification; mandatory external approvals and published-release evidence remain open. No production infrastructure has been provisioned or deployed. See the [Phase 6 plan and decision gates](docs/ai-agent-platform/phase-6/README.md).

</details>
