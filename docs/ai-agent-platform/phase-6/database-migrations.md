# Production database roles and migration safety

Phase 6 T07, reviewed 2026-11-05 (Asia/Bangkok). This guide describes implemented local PostgreSQL 17 contracts, not a deployed database. See [verification evidence](verification-evidence/database-role-verification.json). T08 backup/restore implementation is separate.

## Recovery audit and access inventory

The interrupted session left an audit/design and a 720-file SHA-256 baseline, but no T07 implementation. No applicable AGENTS.md or Git metadata was present. Existing T02–T06 source and evidence were preserved. The original migrator already ran separately, verified release journal hashes and used Drizzle transactions; its session advisory lock waited indefinitely. Container fixtures used a superuser migrator and broad runtime DML grants. No dedicated worker, message broker, cache, automatic schema synchronization or production database provisioning existed.

| Client | Connection / operations | DDL / migrations |
| --- | --- | --- |
| API, in-process Runtime Coordinator, collaboration, authentication, external ingestion and projections | Existing validated DATABASE_URL or DATABASE_URL_FILE; shared pool; scoped DML, transactions, row locks and trigger writes | Runtime login only; startup/readiness inspect access and release compatibility, never migrate |
| Local runtime/Agent-binding/account management commands | Same private runtime configuration and application authorization; account creation is a trusted operator command | No DDL or migrations |
| Dedicated migration/preflight command | Separate migration URL file and explicit DATABASE_MIGRATION_TARGET | Owning migration login; same pinned API image; maintenance invocation only |
| Bootstrap/provision command | Explicit administrator URL via existing secret-file contract; stdin-only role request | Initial role/schema/grant creation or explicitly approved ownership adoption; never ordinary startup |
| Database integration/role/container tests | Random synthetic credentials and owned labelled PostgreSQL containers; no developer DATABASE_URL | Fixture bootstrap may perform DDL/fault injection; actual APIs and restricted suites use runtime credentials |
| Backup/maintenance (T08 update) | Separate restricted export login, injected only into operator backup tooling | See [backup provisioning/recovery](backup-recovery.md); never mounted into API/migrate services |

## Recovered checklist

| Area | Recovered state | Continuation result / evidence |
| --- | --- | --- |
| Access inventory / role architecture | PARTIAL: design only | COMPLETE: inventory and bound runtime/migration/bootstrap roles |
| Grants / role provisioning / future privileges | MISSING | COMPLETE: explicit manifest, SCRAM bootstrap, defaults and populated adoption tests |
| Credential configuration / separation | PARTIAL: two mounted URLs but permissive fixtures | COMPLETE: production role checks and three isolated fixture secret volumes |
| Migration runner isolation / auto-sync protection | COMPLETE: API never migrated; no auto-sync | PRESERVED: runtime cannot DDL or substitute for migrator |
| Migration concurrency | PARTIAL: unbounded session wait | COMPLETE: same advisory key, fail-fast contention and connection-death release |
| Transaction safety | COMPLETE: Drizzle SQL/journal transaction | PRESERVED and tested with real failed pending SQL; post-SQL ACL failure/forward fix verified |
| Schema ownership / defaults | MISSING | COMPLETE: correct creator, explicit ownership transfer and deny-by-default future objects |
| Compatibility / failure recovery / sequence | PARTIAL: history hash checks | COMPLETE: documented maintenance/expand-contract, explicit preflight/target and safe recovery |
| Runtime / negative / migration tests | MISSING for production roles | COMPLETE: 35 real PostgreSQL tests, including existing native/mixed scenarios under runtime credentials |
| Container/network integration | PARTIAL: T05/T06 existed | COMPLETE: real restricted roles, TLS, browser login/native workflow, readiness and restart |
| Documentation | MISSING | COMPLETE: this guide, inventory/contracts, ADR, roadmap and evidence |

## Role architecture and grants

Use two dedicated LOGIN roles in a dedicated application database. Names are operator-selected lower-case PostgreSQL identifiers (1–63 characters). Neither is a superuser, database owner, CREATEDB, CREATEROLE, replication or BYPASSRLS role; neither may inherit memberships. Bootstrap owns the database and `elyqreth_ops.access_contract`. This single-row operational policy records the reviewed database name, runtime/migration role bindings and policy version. Both application logins can read it but cannot modify it. It is not a business lifecycle or migration journal.

The migration login owns `public`, `drizzle`, their application objects and the Drizzle journal. **It requires database CREATE**: real PostgreSQL testing showed that Drizzle's `CREATE SCHEMA IF NOT EXISTS drizzle` checks this privilege even when the schema exists. It can therefore create schemas in this dedicated database. Runtime cannot. Bootstrap remains outside both services and is the only provisioning authority. A provider offering restricted administration must demonstrate the required role creation, ownership transfer and default-privilege powers before adoption; this is not assumed for every managed tier.

PUBLIC has no application-database CONNECT/CREATE/TEMP or access to application/control schemas. Runtime and migration get explicit CONNECT; neither gets TEMP. Runtime receives public/drizzle schema USAGE. Runtime pool maximum remains 20, default 5; role connection limit is 20. The migration role limit is 2 so a second attempt can connect and report a busy lock. Operator sessions/pools count against these limits. API and in-process runtime share credentials because they have the same operations; no fictitious worker service is introduced.

Runtime permissions are an explicit reviewed manifest in [access-policy.ts](../../../apps/api/src/database/access-policy.ts):

- SELECT only on owners, provisioned by trusted administration.
- SELECT/INSERT on append-only execution_results, agent_events, command_audit and trigger-written event_outbox.
- SELECT/INSERT/UPDATE on remaining mutable application tables, including collaboration_participants: the existing service records departures and locks memberships with FOR SHARE, which also requires UPDATE permission.
- DELETE additionally on auth_sessions only: existing login performs bounded expired/revoked-session cleanup. No other runtime DELETE permission is granted.
- SELECT only on drizzle.__drizzle_migrations. No journal writes or sequence privileges.
- EXECUTE only on the nine existing invoker trigger functions. No SECURITY DEFINER application functions are approved.
- No other DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN, schema CREATE, database CREATE/TEMP, ownership, grant option or cluster administration.

There are no public application sequences: UUID defaults use built-in gen_random_uuid. The migration journal's SERIAL sequence is migration-only. Future sequences require an explicit reviewed grant and verifier change if runtime usage is needed. Existing immutable/history/owner constraints and application object authorization remain authoritative for business access. This is service-level privilege isolation, not per-user PostgreSQL tenancy or protection after bootstrap/migration credential compromise.

Default privileges apply to the **actual migration object creator**, not bootstrap. Global PUBLIC function EXECUTE and type USAGE defaults are revoked. Future tables, sequences and functions are denied to runtime until an approved migration and manifest update explicitly grant required access. No broad future-table ALL/DML grant is used. After each successful migration batch, the same migration session applies the explicit grant policy transactionally. Runtime startup/readiness checks role flags, membership, schema ownership, contract integrity, exact table operations, journal read-only access, unrelated schemas, sequence denial and unsafe callable functions. A missing production contract fails before serving traffic; a present contract is enforced even in test/development. Unmanaged development/test databases retain their historical workflow.

## Provisioning and credential isolation

Provisioning is explicit privileged maintenance. It is never called by API startup, workers or normal migrations. Approval of a real target, maintenance window and recoverable backup is an operator prerequisite, not something this command claims to prove. It changes only the explicitly named database and dedicated roles. It does not provision a database, rewrite migration history, reset data, drop schemas or silently rotate passwords.

Use the existing Node 24 build (`npm run build`) or immutable API image. Supply bootstrap configuration through the existing backend environment and secret-file reader. Production requires NODE_ENV=production, explicit API_HOST/API_PORT/CORS_ORIGINS, DATABASE_URL or a protected DATABASE_URL_FILE (under /run/secrets in production containers), verify-full TLS and the reviewed CA. AUTH_MODE=disabled with all optional feature blocks absent is sufficient for this maintenance process; it does not serve HTTP. Do not reuse the API's feature configuration or mount bootstrap secrets into API/migrate services.

The request is bounded to 8 KiB JSON on standard input. Example **shape only**; replace passwords in an operator-protected input file or pipe from an approved secret store, not shell history/argv:

```json
{
  "expectedDatabase": "elyqreth",
  "runtimeRole": "elyqreth_runtime",
  "migrationRole": "elyqreth_migration",
  "runtimePassword": "<32-128 random base64url characters>",
  "migrationPassword": "<different 32-128 random base64url characters>"
}
```

```powershell
# Set private bootstrap configuration in this operator process only.
# Do not target production while executing repository verification.
Get-Content -Raw -LiteralPath 'C:\protected\role-request.json' | node apps/api/dist/database/provision.js
```

New passwords must be 32–128 ASCII base64url characters. The client derives PostgreSQL SCRAM-SHA-256 verifiers before SQL is sent; plaintext passwords never appear in CREATE ROLE SQL. Verifiers remain sensitive credentials: protect server statement logs/catalog backups. CLI errors do not serialize driver errors or SQL. Runtime URLs remain private secret files; environment-based development compatibility remains. Environment injection can expose secrets to privileged process inspection; file injection and host access control are still required. No credentials are put in images/frontend bundles.

Initial provisioning is one transaction under the same migration advisory lock. It validates existing roles before any changes. Re-execution uses the same three identity fields with password keys **omitted**; supplied passwords for existing roles are rejected, not overwritten. Unsafe existing role attributes or memberships are rejected. Password rotation is a separate administrator-controlled ALTER ROLE/secret-file replacement procedure: drain API, change the intended role password using approved non-logging tooling, replace its mounted URL, recreate the affected process, verify readiness/login, revoke the old secret. Do not use provisioning as a password reset service.

Populated databases are refused by default. After backup and a reviewed object/ownership/journal inventory, `"adoptExistingSchema": true` permits transactional transfer of only known application tables, journal table/sequence and nine invoker trigger functions. Existing objects must belong to the invoking administrator, and journal hashes must be a prefix of this release. Unknown objects, custom ownership or functions stop provisioning; provider-specific ownership needs an explicitly reviewed manual plan, not blanket REASSIGN OWNED. Data/history are preserved, and subsequent migration/grant verification is still required. Shared application schemas/databases are unsupported.

## Preflight, execution and deployment sequence

The actual migration framework remains Drizzle. API/worker replicas never call it. Existing Docker packaging has a one-shot `migrate` maintenance service with **only** migration credentials; API has only runtime credentials. Bootstrap is not a Compose service and its secret is never mounted into either. PostgreSQL remains an external private dependency under T06; no new host ports/network exposure are added.

Set DATABASE_MIGRATION_TARGET to the explicitly approved database name. It must match the URL path and actual current_database(). Production migrations fail before connecting if it is missing; ordinary API serve does not require this key. Configurations with this key but a mismatched URL fail validation. Contract-managed migration/preflight requires PostgreSQL major 17 and the exact bound migration role, never runtime or admin credentials.

```powershell
# Review the rendered configuration first, without printing secret contents.
docker compose -f docker-compose.production.yml -f docker-compose.edge.yml config --quiet
# Existing reviewed environment supplies immutable images, file paths, origin and target.
docker compose -f docker-compose.production.yml --profile maintenance run --rm migrate node docker/api-start.cjs preflight
docker compose -f docker-compose.production.yml --profile maintenance run --rm migrate
# Host tooling equivalent, with migration-only private environment:
node apps/api/dist/database/migrate.js --preflight
node apps/api/dist/database/migrate.js
```

Preflight is read-only apart from acquiring/releasing the session advisory lock. It validates connection/target/role/version, release journal hash ordering and pending count without creating metadata or applying SQL. It returns `{applied,pending}` counts only. It does **not** prove a backup, arbitrary schema drift absence, migration row-content correctness or hosting suitability. Readiness separately verifies release hash equality and expected table existence; no auto-sync or repair occurs.

Deployment progression:

1. Review target/release/configuration, backward compatibility and verified backup/restore prerequisites.
2. Stop new admission and drain/maintain the single native API writer according to T05; do not overlap native writers. Full operational drain automation is later roadmap work.
3. Run migration-role preflight. A nonzero exit stops progression.
4. Apply pending migrations with the same immutable image/reviewed target; only one migration invocation owns the lock.
5. Require exit 0, rerun preflight (pending 0), then start the compatible API and web release.
6. Verify private readiness, authentication, a synthetic critical workflow and state continuity before allowing traffic. Runtime grants and journal must match this release.

The existing lock key `(195023,3)` now uses a single pg_try_advisory_lock: busy means prompt nonzero failure, not an indefinite wait or automatic retry. Provisioning/preflight/migrate use that one lock; no additional queue/coordination system. It stays on the same connection through journal checks, SQL and grants; finally or PostgreSQL connection death releases it.

## Transactions, failure handling and compatibility

All eleven current migrations use supported transactional PostgreSQL DDL. Drizzle creates its metadata schema/table before its transaction, then applies **all pending SQL plus journal inserts in one transaction**. A failed batch leaves no partial batch objects or successful journal entry. Empty metadata can remain after first-run failure. Do not wrap another BEGIN around Drizzle's nested implementation, manually edit journal entries, modify applied SQL/hash history or retry destructive work indefinitely.

The explicit grant policy follows the SQL batch in a separate transaction under the same lock. **SQL and grants are not one atomic transaction.** If grants fail, exit is nonzero, truthful SQL journal entries remain, runtime startup/readiness fails, and deployment stops. Resolve ownership/permissions, then rerun the reviewed same release under the lock to repair grants without replaying applied SQL. No automated irreversible down migration exists.

| Failure | Safe response |
| --- | --- |
| Connection/TLS loss or interrupted process | Stop progression, reconnect with approved credentials, inspect journal via preflight, establish whether batch committed; never assume success from client disconnect |
| Lock busy | Identify active maintenance owner, wait operationally; never steal live locks or run parallel jobs |
| Permission/role/target failure | Correct the specific private credential/ownership/contract; never elevate API or switch to admin migrations |
| SQL batch failure | Transaction rollback verified; review SQL and logs with redaction, use a reviewed forward release; no journal editing |
| Post-batch ACL failure | Keep API down; repair privileges, rerun migrator to apply reviewed grant policy, verify runtime readiness |
| Hash drift/newer database | Refuse; restore matching immutable release or prepare an approved forward compatibility fix |
| Nontransactional future operation | Unsupported by current automatic runner; requires a separately reviewed operator procedure and recovery evidence, not silently disabling transactions |

Future schema changes must use expand/contract: additive compatible change, compatible code, bounded backfill, verification, later separately approved removal. Current exact-release readiness means this system uses a maintenance cutover; it does not claim arbitrary rolling old/new release compatibility. Tested adoption preserves populated data and current readiness rejects mismatched releases. This is not a full schema-diff or workload benchmark tool.

## Verification and limitations

Run `npm run test:database-roles` for owned disposable PostgreSQL tests: positive/negative grants, SCRAM/re-execution, role spoofing/elevation, real native/mixed workflows, populated adoption, migration failure rollback, hash drift, future defaults and lock release/concurrency. `npm run test:db` retains existing persistence/security/runtime regressions; `npm run test:edge` uses separate bootstrap/migration/runtime secrets in hardened containers, verified TLS, private networks and the actual browser workflow. No production/user database URL is consumed by these harnesses; cleanup checks owned labels and exact targets.

Remaining deployment gates: actual managed-provider permissions/TLS/private endpoint, operator approval, restore-tested backup (T08), operational drain/release procedures and real capacity are not verified by local role tests. Built-in PostgreSQL catalogs remain normally readable; isolation from unrelated databases requires provider/pg_hba policies beyond target-database grants. Migration/admin compromise can alter application data/schema; protect and audit these credentials separately. No new worker, auth authority, external execution engine or city change was introduced.

Primary references: [PostgreSQL default privileges](https://www.postgresql.org/docs/17/sql-alterdefaultprivileges.html), [grants](https://www.postgresql.org/docs/17/sql-grant.html), and [session advisory locks](https://www.postgresql.org/docs/17/explicit-locking.html#ADVISORY-LOCKS).
