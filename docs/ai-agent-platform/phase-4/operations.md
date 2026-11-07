# Phase 4 local operation and troubleshooting

Reviewed 2026-10-27, Asia/Bangkok. This is the current local-development runbook. See [acceptance](acceptance.md), [wire contracts](interaction-api.md), [typed client](frontend-interaction-client.md) and [risks](risk-register.md). This is not a production deployment procedure.

## Choose the supported mode

The maintained city frontend is `dist/`, using vanilla JavaScript, Canvas and CSS. It runs without a backend for decorative residents and the existing City Hall simulation. Backend Agent work uses the **Agent Task** section of a linked resident's existing inspector. City Pause/Speed/Reset controls affect the simulation, not backend execution.

For the ordinary Docker city/database/backend stack, follow [Docker setup](../../docker.md). Protected Agent runtime/interaction APIs remain disabled in bridged containers. Do not change the loopback authorization guard or enable runtime on `0.0.0.0` to make that stack interactive. Phase 4 interaction uses the host-bound local API described below.

## Infrastructure and startup

Use Node 24 and npm from the repository root (`npm.cmd` in PowerShell), Docker for PostgreSQL, and an installed Chrome/Chromium only when running browser tests. Use existing ignored environment files; do not overwrite valid configuration or commit credentials.

1. Configure root `.env` from the root example with a real local `POSTGRES_PASSWORD`. Start only the required database with `docker compose up -d postgres`. Existing volumes retain their users/passwords; changing `.env` is not credential rotation. Do not delete valuable volumes as a setup shortcut.
2. Configure `apps/api/.env` following the [database guide](../database-foundation.md). Set the actual local `DATABASE_URL`, `DATABASE_SSL_MODE=disable` for this local setup, and loopback `API_HOST=127.0.0.1`. Apply migrations explicitly using a suitable migration-role URL. Restore the intended application-role configuration before API startup. `/health` is liveness, not proof of migrated/readable persistence.
3. Provision an actual owner and ENABLED native orchestrator through the existing [registry setup](../agent-registry.md). No normal startup seed creates them. Register and activate an Agent using the existing guarded registry APIs and returned versions; never invent a UUID as an existing database reference.
4. Configure a reviewed rule-based `RUNTIME_BINDINGS` definition for that exact Agent/orchestrator using the [existing runtime guide](../phase-2/rule-based-runtime.md). `text.stats.v1` is the deterministic primary path. Keep LLM/tool configuration disabled and optional profile fields absent unless deliberately enabling existing reviewed providers/tools.
5. Bind the Agent to an existing stable slot through the trusted administrative binding flow. The CLI accepts `npm.cmd run city:bindings -- create --agent-id ACTUAL_AGENT_UUID --npc-id resident-slot-001`; replace the identifier with the real registered Agent ID. The other supported actions/versions are documented in [identity mapping](../phase-3/identity-mapping.md). Binding does not spawn a resident or grant execution permission.
6. Start the API and frontend in separate terminals. Process environment overrides `apps/api/.env`, then defaults. The UI's actual Origin must match the API's exact `CORS_ORIGINS` configuration.

```powershell
npm.cmd ci
npm.cmd run db:migrate
npm.cmd run dev:api
# Separate terminal, same repository root:
npm.cmd run dev:web
```

Configure these existing settings with actual local values. Placeholder credentials/UUIDs are not runnable authorization:

| Setting | Purpose |
| --- | --- |
| `NODE_ENV=development`, `API_HOST=127.0.0.1`, `API_PORT=3001` | Existing development/test loopback boundary |
| `DATABASE_URL`, `DATABASE_SSL_MODE` | Actual migrated PostgreSQL connection; credentials stay server-side |
| `CORS_ORIGINS=http://127.0.0.1:5173` | Exact frontend Origin; adapt if Vite selects another port or localhost is used |
| `AGENT_REGISTRY_ENABLED=true`, `AGENT_REGISTRY_OWNER_ID`, `AGENT_REGISTRY_TOKEN` | Existing privileged local registry/admin scope; operator token stays out of the browser |
| `RUNTIME_ENABLED=true`, `RUNTIME_BINDINGS` | Trusted exact Agent/orchestrator/strategy definitions; not form-supplied runtime configuration |
| `CITY_READ_ENABLED=true`, `CITY_READ_TOKEN` | Separate observation-only credential |
| `CITY_INTERACTION_ENABLED=true`, `CITY_INTERACTION_TOKEN` | Third distinct credential for limited Agent actions and reads |
| `CITY_INTERACTION_AGENT_IDS` | Nonempty JSON allow-list of at most 20 real Agent UUIDs; valid enabled PASSIVE bindings are also required |
| `CITY_INTERACTION_TEXT_AGENT_IDS=[]` | Optional explicit subset for existing LLM text disclosure; default structured results only |
| `RUNTIME_LLM_ENABLED=false`, `RUNTIME_TOOLS_ENABLED=false` | Suitable primary rule-based setup; optional profiles/grants are configured by existing provider/tool guides, not the UI |

All three credential audiences are distinct. The enabled local interaction token must satisfy the configured 32-128 character syntax; provision strong random credentials. Never place operator/provider credentials in browser code, `VITE_*` variables, URLs, committed files or Task input.

## Connect and use the existing inspector

Phase 3 read synchronization is disabled by default and uses an explicit trusted local bootstrap. There is no production login/account UI. On the local city page, the following developer-console bootstrap obtains the read token without putting a literal credential in console command history. It returns no credential value:

```javascript
(async () => {
  const {runtimeIntegration} = await import('/js/runtime/index.js');
  const token = window.prompt('Local city-read credential');
  if (!token) return;
  runtimeIntegration.connect({
    baseUrl: 'http://127.0.0.1:3001', pageOrigin: location.origin, token
  });
  await runtimeIntegration.refresh();
})();
```

Use this only on the trusted local page. It is a developer bootstrap, not a password-manager or account/session system. Configure the **same approved API origin** in both read bootstrap and interaction dialog; the current UI validates loopback origins but does not negotiate a cross-server identity fingerprint. Reconnecting Phase 3 clears its previous scope and interaction access. Do not send a credential to an unreviewed local service.

1. Open Residents and select a linked resident using its DOM button or city selection. Keyboard activation focuses the inspector heading; decorative/unbound residents keep their normal inspection.
2. Choose **Connect interaction access**. Enter the same backend origin and the separate limited interaction credential in the existing password dialog. It stays in memory and is cleared on disconnect/reload. Backend eligibility is checked independently of NPC appearance.
3. Enter instructions and choose **Save Task**. The UI supports instruction text only. Required/length/byte/credential-pattern validation complements backend validation. Save confirms a stable Task ID; it does not start an execution.
4. Choose **Start Execution** when exact Task/backend eligibility allows it. The coordinator revalidates versions, ownership, native configuration and capacity. A saved Task or standing-still NPC is not an executing Agent. The synchronous request may remain pending while separately sampled persisted status is shown.
5. Monitor the current Execution, Agent activity and freshness independently. A current activity of IDLE can have a recent successful/failed outcome. A persisted RUNNING execution with UNKNOWN activity is not confirmed live work.
6. For eligible native work, choose **Cancel Execution**, then Confirm. Back/Escape restores focus; asynchronous confirmation has a stable heading fallback when both action controls are temporarily disabled. Cancellation is cooperative and completion can win. The displayed final status comes from backend reads, not the button click.
7. Expand **Execution result** for supported text or numeric statistics. Output is untrusted text, never executable HTML/Markdown. Failure/cancellation/timeout can have no result. There is no live stream or fabricated progress.
8. Expand **Execution history** for a bounded Agent-scoped cursor page (10 rows in the UI, backend maximum 20). Select a row for its exact authorized detail/result. Historical selection is read-only and never drives live NPC status; return to current Execution to use lifecycle controls. At most 20 navigation pages form one browsing window; refresh restarts it.

The coordinator permits one active execution per instance, and PostgreSQL separately protects native Agent attempts. The tested two-instance concurrency does not implement collaboration, task delegation or automatic routing.

## Failure and recovery

| Observation | Supported response |
| --- | --- |
| Validation/eligibility error | Read the safe message, correct input or recheck permission; the backend remains authoritative |
| Stale/disconnected observation | Preserve known references and wait for shared synchronization/read refresh; do not classify network failure as Agent failure |
| Lost Create response | Keep original key/input in memory; use Check submission/exact lookup. An explicit same-key retry is offered only with the original unchanged intent available |
| Lost Start/Cancel response | Read Task/Execution and reconcile the recorded outcome; no automatic POST replay |
| Close or switch inspector | Obsolete reads are aborted/ignored; captured mutations remain attached to their original Agent/Task, not the new selection |
| Reload/navigation | Credentials/private drafts/results are cleared. Expiring identifiers-only per-tab locators may restore after explicit reauthorization; a synchronous request can be interrupted and request cancellation |
| Expired/denied storage | Journal is limited to 20 locators and 30 minutes; unavailable storage falls back to volatile references. Retain known IDs for authorized inspection; no durable private draft or cross-device recovery is promised |
| Revoked capability/401 | Protected interaction state and locators clear; obtain the authorized current capability and reconnect explicitly |
| Scoped 403/404 | Affected protected details clear. Do not treat a denial as permission to cancel another pending execution |
| Backend hard crash | Restarted APIs retrieve persisted state. A dead native lease becomes UNKNOWN; no result/terminal event is invented, repeat Start stays fenced. No automatic repair/resumption worker is implemented |
| Binding removed/reassigned | Interaction scope is removed/reset according to fresh authoritative data; existing backend execution does not depend on NPC lifetime |

Do not reset native quarantine or force a successful lifecycle row to make a UI appear healthy. Provider termination/billing is not guaranteed by HTTP abort or cancellation. See the [risk register](risk-register.md) before planning broader access or asynchronous orchestration.

## Reproducible checks

From the repository root, with Docker running and an installed Chrome/Chromium (`BROWSER_PATH` when needed):

```powershell
$env:BROWSER_HARDENING_PHASE4='true'
npm.cmd run verify:phase1
npm.cmd run test:interaction:e2e
npm.cmd run test:city:e2e
```

The historical command name `verify:phase1` remains compatible; it runs current lint/type checks, both builds, migration consistency, frontend/backend units, owned PostgreSQL/API cases and browser smoke. The other tiers cover native interactive recovery and the separate Phase 3/city/runtime acceptance. These tests create isolated resources and do not consume a production/developer database URL. Check Docker readiness before starting; a failed setup is not a passed application test.

CI is configured in the [existing workflow](../../../.github/workflows/verify.yml), including scoped sanitized diagnostics/screenshots and seven-day artifact retention for the interaction tier. Local acceptance is distinct from a remote GitHub result; no remote CI run, release or deployment is performed by T10.
