# Configure Hermes Agents in Elyqreth

This integration supports **operator-configured Agent registration and existing Hermes API run observation**. Automatic Hermes Agent discovery is unnecessary. It does not submit work to Hermes.

Supported source baseline: Nous Research Hermes Agent 0.21.2, reviewed commit `fa425c942ead972b7dd192fba82c9ef93d45e688`. [Compatibility and security audit](../../docs/ai-agent-platform/hermes-integration-audit.md).

## Configure

1. Set up Elyqreth's existing development/test database, migrations, registry owner and local operator token using the [local operations guide](../../docs/ai-agent-platform/phase-6/local-operations.md). The trusted source boundary currently requires loopback development/test mode without `AUTH_MODE=local` or OIDC; this change does not expand production ingestion.
2. Copy [connection.example.json](connection.example.json) to your own backend configuration. Replace `ownerId` with that existing owner. Choose a connection UUID and an `internalAgentId` UUID once and retain them. Choose an unused existing resident slot (`resident-slot-001` through `resident-slot-020`).
3. `externalId` is your stable operator-assigned Hermes identity. It is explicitly configured, not a claimed Hermes discovery result. A model alias is not an identity. Keep the ID across renames; change `name` to change the display name.
4. Set `EXTERNAL_ORCHESTRATORS_ENABLED=true` and supply the JSON array as `EXTERNAL_ORCHESTRATORS`. Preserve any other existing connections in this array. Inject the matching Hermes `API_SERVER_KEY` into backend-only `EXTERNAL_SECRET_HERMES` using existing secret procedures. Never put the value in JSON, browser settings or CLI arguments.
5. Set the actual authorized origin and IP pins. The example is a local loopback instance. Public endpoints require HTTPS and approved public IP pins; TLS verification remains enabled. Do not point this at production without separate authorization.

## Apply and synchronize

```powershell
npm.cmd run hermes:observe -- apply CONNECTION_UUID
npm.cmd run hermes:health -- CONNECTION_UUID
npm.cmd run hermes:observe -- sync CONNECTION_UUID
npm.cmd run hermes:observe -- watch CONNECTION_UUID 20
```

`apply` creates the configured connection and missing EXTERNAL Agents through the existing registry, then creates external identity/run mappings and existing resident bindings. Newly registered EXTERNAL Agents are ACTIVE; this only enables their association, never native execution. Existing disabled Agents remain disabled. Native, archived, foreign-owner or conflicting bindings are rejected. Repeating `apply` preserves the same identities; it does not generate new UUIDs. Apply uses separate existing transactions; an interrupted application can leave approved partial registration, and reapplying the same configuration converges. It does not silently repair conflicting ownership or identity.

With `executionIds: []`, the NPC is registered with **UNKNOWN** external activity. You can configure the identity before work exists. To observe work that Hermes already owns, add its actual `run_<32 lowercase hex characters>` ID to that Agent's `executionIds`, reload the backend configuration, then run `apply` and `sync`. Assign each run to exactly one configured Agent. This association is an explicit operator assertion. Get IDs from the system that submitted the Hermes work; Elyqreth does not create work to obtain them. The API key/profile must have read access to those runs.

`apply` verifies listed run access before creating registrations. The run status response is source-derived; raw prompts, outputs, approvals and error messages are discarded. Unknown versions, malformed run IDs and unlisted run reads fail closed.

`sync` performs one bounded sweep of at most 20 configured runs. `watch` performs a finite number of sweeps (default 20, maximum 100), normally five seconds apart. Transient failures back off to ten/twenty seconds and stop after three consecutive failures. Authentication, authorization, configuration and schema errors stop immediately. Ctrl+C stops the process; there is no installed service or automatic startup poller. Run another finite watch deliberately when needed.

## View in the city

Use existing city-read access and NPC bindings. The selected resident's existing indicator and Agent Details panel show Hermes provenance, connection name, configured Agent ID, external execution ID, recorded status, source observation and last synchronization times. The city shares its existing REST synchronization and does not contact Hermes.

Observed `running` shows working; `queued` and `waiting_for_approval` show waiting. Completed/failed/cancelled are labeled recorded outcomes. `stopping`, `interrupted`, unknown states, missing runs and missing observations do not imply successful completion or IDLE. No collaboration relationships are inferred. External results and native Task/Execution controls are not added.

An unchanged accepted run snapshot may be reconfirmed without modifying its execution status/version. A separate trusted observation receipt records that freshness. After 30 seconds without reconfirmation, the source data becomes STALE even if browser-to-Elyqreth synchronization remains fresh. Connection health remains UNKNOWN unless explicitly checked; an API health check never makes an NPC work.

## Recovery and changes

- After backend restart, reapply the same config if needed and run another sync/watch. Durable mappings and inbox dedupe prevent duplicate Agents, executions or NPC bindings.
- Renaming a display name preserves all IDs. Configuration changes revoke grants tied to the old configuration.
- Removing a configured run prevents new polling; retained historical mappings are not deleted. Removing an Agent declaration does not authorize deleting its Agent/binding/history. Retire it through existing operator lifecycle and binding tools. Unconfigured EXTERNAL activity remains unknown.
- A new source incarnation requires a new namespace/generation and reviewed identity retirement. Do not reuse an active internal Agent mapping across source incarnations without retiring its old mapping.
- An outage or 404 does not finalize work. A rotated Hermes API key may lose access to earlier runs because the reviewed provider scopes run ownership to profile/credential.
- The snapshot policy orders lifecycle phase first and provider modification time within a phase. Source clock regressions, equal conflicting snapshots and terminal conflicts remain stale/deferred; they are not resolved by receipt time. Review them explicitly.

Local contract tests use labeled source-derived fixtures, not a live Hermes installation. Database integration and live Hermes E2E require their documented isolated environments. Do not interpret fixture passes as live interoperability evidence.
