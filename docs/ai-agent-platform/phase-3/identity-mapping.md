# Agent-to-NPC identity — planned

**T05 implemented and verified (2026-10-24):** [NPC Runtime Binding](npc-runtime-binding.md) derives indexed read-only associations from T04 and existing immutable NPC slots. Missing NPCs remain unresolved; no spawning, rendering or inspector change is added. Verification passed 96 frontend tests (19 new), 190 backend tests, 103 PostgreSQL tests, builds/static checks and browser smoke, plus final focused/type/build reruns. T06–T10 remain PLANNED.

Earlier checkpoints/plans below are historical. The latest T05 scope keeps absent NPCs unresolved and does not implement the original proposed extra-avatar provisioning.

**T02 implemented and verified (2026-10-24):** [Agent/NPC binding implementation](agent-npc-bindings.md) provides trusted local create/read/remove/reassign operations over existing PostgreSQL storage, safe revisions and stable NPC slots. Final checks: 181 backend, 96 PostgreSQL and 54 city tests, builds/static checks and browser smoke passed through individually executed commands. No mapping REST mutation API, hydration or status synchronization was added; T03–T10 remain PLANNED.

The original T01 design below remains historical; the implementation guide defines the verified T02 behavior.

## Selected model

One enabled Agent ↔ one stable NPC slot **per owner and city**. Existing partial unique indexes already enforce both sides in `city_agent_bindings`. An Agent may technically have a binding in another city; Phase 3 enables only configured `elyqreth`. One Agent/many avatars and many Agents/shared avatar are rejected: inspection/status ownership would become ambiguous.

These city visualization bindings are distinct from the existing runtime configuration's execution/strategy bindings. Creating a city association grants no right to execute an Agent, select a provider/model, authorize tools or extend a deadline. Never copy city mapping data into runtime permissions.

```mermaid
flowchart LR
  A[Registry Agent UUID + owner] --> B[Existing binding UUID]
  B --> K[cityId elyqreth + npcId resident-slot-001]
  K --> M[Versioned frontend slot manifest]
  M --> E[Current session resident numeric ID]
  E --> R[Existing movement and renderer]
```

`agentId` is a persisted UUID; `npcId` is an opaque external text key, **never** current `Simulation.nextId`, resident name, role, array search result or decorative ID. Proposed manifest keys `resident-slot-001` through `resident-slot-020` are new stable frontend identifiers, not existing source IDs. A small backend catalog validates the same versioned allowlist; contract fixtures ensure both agree. Manifest version 1 and city ID accompany projections. Changes must preserve keys; do not silently renumber after deleting a slot.

## Existing residents and extra slots

The initializer explicitly tags its four existing constructor entries with slots 001–004 regardless of name/role edits; this is a future narrow initialization change, not a runtime name/index match. Numeric IDs continue to serve movement, reservations, selection and hit-testing. Other locally added residents and all decorative/transit/staff NPCs remain unbound simulated residents. Slots 005–020 are integration-owned, provisioned on enabled mapping using existing `addAgent`/initialization and safe existing role/workplace defaults. No new movement class/sprite is introduced.

At most 20 linked residents are supported in this phase. No broad auto-spawn from every registered Agent and no binding to temporary visitors. Appearance/role is cosmetic and locally allowlisted; Agent.type/strategy/name does not grant a simulation profession or tool permission. No coordinates, path, needs or animation state are persisted in backend bindings.

## Binding lifecycle and persistence

| Operation | Planned behavior |
| --- | --- |
| Create | Explicit trusted development-only internal command, fixed configured owner/city, existing accessible Agent, allowlisted slot, PASSIVE mode; transaction and existing unique/FK checks. No public write route or fake Agent seeding. |
| Duplicate create | Same enabled association returns the existing binding; conflicting Agent/slot rejects without changing either mapping. Test concurrent creates against real PostgreSQL. |
| Disable/remove | Soft-disable existing row; do not delete Agent/Task/history. Stop overlay on next successful complete reconciliation; original resident stays simulated, extra integration-owned resident is cleaned up. |
| Reassign | Explicit command with expected binding updatedAt (no version column currently). Lock affected binding/Agent scopes in stable order, compare expected revision, disable old association and create new in one transaction. Reject competing unique claims; no browser reassignment. |
| Agent disabled | Binding may remain; availability DISABLED is visible separately from active/history facts. Do not cancel Tasks or hide running records as a side effect. |
| Agent archived | Preserve binding record/history; project ARCHIVED, remove live activity emphasis. Operator may disable binding explicitly. |
| Missing/unauthorized Agent | FK protects normal deletion; inaccessible/malformed/orphan rows yield no Agent data and a safe unresolved mapping outcome. Do not create an Agent, resurrect one or expose foreign IDs. |
| Missing NPC | Valid manifest slot recreates an integration-owned avatar once on reconnect. Removed original slot resident remains locally suppressed until explicit restore/reload, rather than respawning every poll. Unknown manifest keys are unresolved, not substituted by name. |
| Browser reload | Backend bindings reload; stable manifest reattaches to fresh numeric entities; local positions reset normally. No persisted numeric-ID cache. |
| Connection failure | Mapping retained in memory as stale; no disappearance inference from a failed/partial response. Auth failure purges protected identity data. |

No baseline migration is needed: existing owner/city/Agent/NPC/mode/enabled/timestamps are sufficient. Existing triggers preserve binding identity and touch updatedAt. T02 must verify timestamp comparison precision at the DB boundary and document conflict handling; do not assume JS millisecond serialization can exactly round-trip PostgreSQL microseconds. Return opaque encoded revision preserving full database precision. Add a forward version column only if implementation evidence shows it necessary, with populated-upgrade tests; never edit historical migrations.

Use existing command audit storage for explicit mapping changes where its contract supports them; otherwise record a safe operator observation and document lack of durable binding-change audit. Do not invent lifecycle events or claim append-only binding history (the table is mutable). Existing PASSIVE/WORK_ACTIVITY values are storage concepts; Phase 3 permits PASSIVE only. WORK_ACTIVITY is not permission to route NPC movement from tasks.
