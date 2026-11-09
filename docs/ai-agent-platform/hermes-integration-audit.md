# Hermes Agent integration audit

Reviewed 2026-11-08 (Asia/Bangkok). **PARTIAL: configuration-driven integration code is implemented; database integration and live Hermes E2E remain unverified in this environment.**

The earlier connectivity-only assessment is superseded by the user's explicit instruction to support manually configured identities and Agent/run associations. Automatic provider discovery is not required. Configured identities are labeled operator declarations, never presented as discovered Hermes IDs.

## 1. Repository audit

The initial task began with a clean working tree and no applicable AGENTS.md. The continuation preserved the existing connectivity adapter, tests and documentation changes. Reviewed WORKSPACE.md, platform architecture, Phase 5 external integration/reference/ingestion/collaboration contracts, Phase 6 roadmap and operational status, registry, lifecycle, city binding, projection and frontend synchronization implementations.

Reused components:

| Component | Reused implementation and boundary |
| --- | --- |
| Agent Registry | `agents.service.ts` and existing orchestrators/agents tables, ownership, lifecycle and audit. New configuration application methods are internal, with no new HTTP endpoint |
| Connection | Existing Connection, AdapterRegistry, ExternalAdapterService, validated endpoint and isolated credential reference |
| Identity | Existing external_sources and external_agent_mappings, connection/namespace/generation scoping, approved internal EXTERNAL Agent reference, tombstones and historical references |
| Execution/activity ingestion | Existing external_execution_mappings, trusted source grants, durable inbox, dedupe, ordering, terminal preservation and bounded replay. No native Task/Execution allocation |
| Native runtime | Existing Runtime Coordinator remains sole authority for native work; no external dispatch or native completion from Hermes observations |
| Collaboration | Existing explicit membership/delegation and authority contracts. No Hermes relationship is fabricated |
| NPC mapping | Existing AgentNpcBindingService, conflict checks and 20 stable resident slots. No NPC spawn/rendering architecture was introduced |
| Frontend | Existing activity endpoint, shared REST sweeps, store, version checks, binding facade, status indicators, inspector and Icy White theme |
| Reference/testing | Existing LangGraph adapter and database harness patterns; source-derived Hermes fixtures remain clearly distinguished from live evidence |

The production roadmap remains deferred. The trusted source approval boundary still requires development/test loopback mode without account/OIDC authentication. This change does not authorize production ingestion or public tenancy.

## 2. Hermes identification

Selected project: **Nous Research Hermes Agent** ([official repository](https://github.com/NousResearch/hermes-agent)). Selected source review: commit [`fa425c942ead972b7dd192fba82c9ef93d45e688`](https://github.com/NousResearch/hermes-agent/commit/fa425c942ead972b7dd192fba82c9ef93d45e688), whose [version declaration](https://github.com/NousResearch/hermes-agent/blob/fa425c942ead972b7dd192fba82c9ef93d45e688/hermes_cli/__init__.py) is **0.21.2**, release date 2026-09-11. This is a reviewed baseline, not a claim about the latest release or an installed instance.

Authoritative evidence:

- **H1:** pinned [API server implementation](https://github.com/NousResearch/hermes-agent/blob/fa425c942ead972b7dd192fba82c9ef93d45e688/gateway/platforms/api_server.py): health/version, authenticated capabilities, bearer validation, model aliases, routes and key startup guard.
- **H2:** pinned [run implementation](https://github.com/NousResearch/hermes-agent/blob/fa425c942ead972b7dd192fba82c9ef93d45e688/gateway/platforms/api_server_runs.py): exact run read route, ownership scope, source status and modification timestamps, approval state, SSE queue and subagent callbacks.
- **H3:** pinned [run idempotency store](https://github.com/NousResearch/hermes-agent/blob/fa425c942ead972b7dd192fba82c9ef93d45e688/gateway/platforms/api_server_run_idempotency.py): terminal categories and retention.
- **H4:** rolling [API documentation](https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server), which may describe behavior newer than this pin.
- **H5:** official [ACP integration](https://hermes-agent.nousresearch.com/docs/user-guide/features/acp), documenting CLI/stdio host integration.
- **H6:** official [MCP documentation](https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp), describing Hermes consuming external tool servers.

Hermes owns server-side agent execution. Run access is profile/credential-scoped; a rotated key may not inspect older runs. A model listing is not a persistent individual Agent registry. Those gaps are handled by explicit operator configuration, not invented discovery responses.

## 3. API compatibility matrix

Verified means documented/source-exposed, not live E2E verified. DIRECT means existing Elyqreth machinery can be reused.

| Capability | Hermes support | Evidence | Elyqreth contract | Compatibility / implementation |
| --- | --- | --- | --- | --- |
| HTTP/REST | Verified | H1/H2 | Existing JSON transport | ADAPTER_REQUIRED; implemented read-only |
| Health/capabilities | Verified | H1 | health/describe | ADAPTER_REQUIRED; implemented |
| Bearer authentication | Verified | H1 | Isolated secret and bearer transport | DIRECT reuse |
| Automatic Agent discovery | Stable identity unknown | H1 models include aliases | ExternalAgentDescriptor | UNKNOWN; not claimed |
| Configured Agent registration | Operator declaration, not a Hermes response | User-authorized configuration | Existing Registry, external mapping and binding | ADAPTER_REQUIRED; implemented |
| Agent availability | No verified per-Agent liveness contract | H1 server health | Availability separate from observed execution | UNKNOWN; no online-to-working inference |
| Known run inspection | Verified | H2 GET /v1/runs/{run_id} | status/events.poll and durable inbox | ADAPTER_REQUIRED; implemented for explicitly configured runs |
| Task submission/control | Verified provider routes | H1/H2 | Optional controlled dispatch | ADAPTER_REQUIRED; deliberately not enabled |
| SSE execution events | Verified, queue-based | H2 | Optional subscription | ADAPTER_REQUIRED; not selected |
| Durable SSE replay | No replay cursor in reviewed handler | H2 q.get consumer | Ordered durable ingestion | UNSUPPORTED by reviewed handler; polling does not depend on it |
| Collaboration/delegation hints | Verified callbacks | H2 | Explicit external correlation | ADAPTER_REQUIRED; not implemented; recoverable relationship semantics unverified |
| Agent-monitoring WebSocket | Not verified | H1 browser-control WS is unrelated | No generic WS consumer | UNKNOWN for required monitoring |
| Signed activity webhook | Not verified | No reviewed outbound signature/delivery contract | No public ingress | UNKNOWN |
| External message queue | Not verified | Internal queues are not a broker API | No broker consumer | UNKNOWN |
| MCP | Verified tool-client support | H6 | No monitoring MCP adapter | UNKNOWN for inbound Agent monitoring |
| CLI/ACP | Verified host integration | H5 | HTTP adapter selected | ADAPTER_REQUIRED; subprocess bridge not selected |
| Monitoring SDK | Not verified | No reviewed monitoring SDK | OrchestratorAdapter | UNKNOWN |

## 4. Integration architecture

Configured Hermes connection -> existing capability-gated adapter -> explicit operator Agent/run declarations -> existing Registry and external mappings -> trusted durable inbox -> existing activity projection -> existing resident binding/status/inspection.

`registeredAgents` is a bounded configuration plan, not another registry. It supplies stable external IDs, display names, Registry UUIDs, resident slots and a list of existing Hermes run IDs. The operator explicitly asserts the association; Hermes supplies the run's actual status. Configuration changes are included in connection fingerprints and revoke existing grants. No arbitrary URL, script, endpoint template, status mapping, prompt or credential is accepted in registrations.

`apply` validates the plan, verifies listed run reads, registers the same-owner Hermes connection and missing EXTERNAL Agents through existing tables/services, then creates mappings and bindings. New EXTERNAL registrations are ACTIVE for display only. Existing disabled/archived/native/foreign registrations are not activated or taken over. Declared UUIDs and mapping uniqueness preserve identity after partial application/restart; repeated application converges or reports a conflict. Separate existing transactions may leave approved partial registrations on failure, never a claim of atomic whole-plan application.

`sync` reads one bounded page per configured run. `watch` performs a finite number of sweeps with bounded transient retry/backoff. No automatic startup worker, new scheduler service, native runtime strategy, remote task submission or cancellation is added.

## 5. Implementation summary

- Connection/context contracts add optional validated `registeredAgents`, restricted to hermes.v1; maximum 20 Agents and 20 total distinct runs. Duplicate external IDs, Registry IDs, resident slots and cross-Agent run assignments fail closed.
- HermesAdapter negotiates health/agents/status/events.poll only where configured and remote run-status support is declared. Without registrations, it remains connectivity-only. It verifies source version 0.21.2, platform, auth declarations and exact run identity.
- HermesObservationService and CLI apply/sync/watch reuse the registry, ingestion and binding services. Registry/binding writes revalidate source authorization before transaction commit.
- Existing activity projection gains an optional safe externalObservation extension. Native Task/Execution references remain separate. Current source/incarnation/configuration checks prevent stale identity takeover.
- Existing frontend validator/store/binding/status/inspector consume that optional extension. Native status rendering and Icy White art are preserved.
- Contract, security, frontend and an isolated database integration test are added. The database test is registered in the existing harness; execution status is reported separately.

## 6. Security and connection configuration

See the runnable [configuration guide](../../tools/hermes-reference/README.md) and [connection example](../../tools/hermes-reference/connection.example.json). Existing registry owner/database setup is required. Apply creates application registrations, not infrastructure. No real secrets or live endpoints were configured during this task.

The backend resolves EXTERNAL_SECRET_* references; Hermes keys never enter frontend responses or CLI arguments. The reviewed provider startup requires a strong non-placeholder key of at least 16 characters. Public destinations require HTTPS. Reused transport verifies exact origin, approved IPs/all DNS answers, actual peer, TLS certificate/hostname, no redirects/proxy bypass, 8 KiB headers, 64 KiB response, one-second connect/five-second operation budget, four global/two per-connection concurrent slots and no hidden transport retries. Those are admission/budget controls, not a newly implemented requests-per-second limiter.

Health remains independent of execution status. Endpoint/profile authorization is checked by Hermes; local owner/connection/source authorization is checked by Elyqreth. Native IDs, cross-owner resources and conflicting bindings cannot be substituted. Source credential/config rotation revokes grants. Unknown provider schema/version fails closed. Raw run prompts, outputs, approval contents and error summaries are discarded.

No webhook signatures are invented. Local/OIDC account mode and production source ingestion remain closed under the existing policy. No public multi-tenant isolation claim is made.

## 7. Status, freshness and NPC visualization

| Observed evidence | Existing NPC presentation |
| --- | --- |
| Configured identity without a run/observation | UNKNOWN |
| queued | Waiting |
| running | Working, explicitly recorded external state |
| waiting_for_approval | Waiting; execution remains in progress |
| completed / failed / cancelled | Recorded outcome; no native completion |
| stopping | UNKNOWN physical activity |
| interrupted / unknown / unrecognized state | UNKNOWN; never fabricated completion |
| No recent confirmation for 30 seconds | STALE |
| Disabled/retired configuration | UNKNOWN source activity; connection disabled |

The inspector shows Hermes source, connection name, configured Agent ID, exact external run ID, raw observed status, source observation time, last synchronization, freshness and connection health. Configured names are escaped. Provider payloads are not displayed.

The snapshot ordering policy uses lifecycle phase (unknown, queued, in-progress, terminal) followed by provider `updated_at` milliseconds within a phase. H2 explicitly updates that field when setting run status. This is a conservative partial order, not a claim of a monotonic provider event revision: backwards clocks/snapshots become stale; equal incompatible states or conflicting terminal outcomes remain deferred. Missing/invalid source modification time is rejected. Receipt time never orders executions.

Unchanged snapshots retain the same effective event ID and execution version. After successful/duplicate accepted snapshot application, a separate trusted Agent observation receipt reconfirms freshness without changing execution status. Stale/conflicting/deferred snapshots do not refresh the accepted projection. Terminal guards remain intact. Long-running unchanged work can stay recently observed without fabricated source updates.

Missing observations do not imply IDLE, OFFLINE or completion. Connection health remains UNKNOWN in the persisted activity view; no liveness claim is synthesized from an enabled configuration. Hermes collaboration is not inferred from simultaneous activity or callback names alone.

## 8. Recovery and verification

Mappings, source incarnation, accepted inbox evidence and bindings survive backend restart. Replay/deduplication and source ordering remain durable. Run another bounded sync/watch after restart. Watch retries only transient connection/server/rate/timeout errors, stops after three consecutive failures, and caps at 100 sweeps. Authorization/schema/configuration failures stop immediately. There is no infinite reconnect loop.

[Verification evidence](hermes-verification.json) records exact executed commands, exit codes, initial failures and final outcomes. Source-derived fixture passes are not live Hermes evidence. Docker's daemon is unavailable; isolated PostgreSQL integration cannot run in this environment. No compatible approved live Hermes instance was contacted. Database and live E2E must not be claimed as passed.

## 9. Files changed

Backend: existing Agent Registry/module, city binding/activity contracts/repository/service, external connection/context/service/module, and database integration harness; new registration validator, Hermes adapter/health and sync CLIs/observation module/service, external presentation mapper, focused tests and source-derived fixture.

Frontend: existing runtime contracts/validation/store/status/inspector and new Hermes NPC test. Documentation: README, user guide, this audit/evidence and tools/hermes-reference guide/example. Root/API package scripts expose health and observe commands. No new dependency, lockfile, schema migration, sprite/map or native execution strategy.

## 10. Known limitations

Automatic Hermes discovery, arbitrary runtime version support, unlisted run scanning, task dispatch/cancellation, raw result disclosure, signed webhooks, SSE replay and Hermes collaboration visualization are not implemented. Operator configuration establishes identity/association; it does not prove Hermes has a registry. The reported version is checked, not cryptographic build provenance. Source clocks and provider retention can cause stale/deferred observations. Configuration removal preserves historical registrations/bindings until explicit retirement through existing tools. Applying a new incarnation requires explicit retirement of an older active internal Agent mapping.

Database-backed integration and live E2E remain unexecuted here. Current implementation is limited to the existing trusted loopback development/test source authorization. Production/account-mode source policy is a separate concern.

## 11. Completion status

**PARTIAL** overall: the requested configuration-driven code path, safe run polling, registry/identity/NPC mapping and frontend observation rendering are implemented. Local contracts/regressions are verified as recorded in the evidence file. Database integration and live Hermes E2E remain environment-limited; no COMPLETE claim is made for live interoperability.

## 12. Recommended next action

Run the existing isolated database integration harness with Docker available, then use the supplied configuration against one explicitly authorized isolated Hermes 0.21.2 instance. Verify apply, a real run update, outage/recovery and stable NPC identity. No deployment or production access is authorized by this recommendation.
