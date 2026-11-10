# Phase 1 CI failure forensics

Audit date: 2026-11-10 (Asia/Bangkok). Starting branch: `main`; commit: `41d2288efaf4862d1f53e1af96c4292ff4d6678d`. The starting working tree and index were clean. No applicable AGENTS.md was found. No commit, push, workflow trigger, deployment, production database access, or migration modification is part of this repair.

## A. GitHub Actions evidence

- Workflow: **Elyqreth quality verification**, `.github/workflows/verify.yml`.
- Run: [42718457229](https://github.com/Eqooid/elyqreth/actions/runs/42718457229).
- Job: [129505961484](https://github.com/Eqooid/elyqreth/actions/runs/42718457229/job/129505961484).
- Commit: `41d2288efaf4862d1f53e1af96c4292ff4d6678d`, push to `main`.
- Runner: Ubuntu 24.04.5; Node v24.22.2; npm 11.19.1; Docker server 28.0.4.
- The complete job log was retrieved through the GitHub integration. No `gh` executable was available locally.
- Explicit verification environment names: `BROWSER_PATH`, `BROWSER_HARDENING_PHASE4`, `TMPDIR`. The database harness supplies its own generated test credentials; no production URL is consumed.
- Container environment names: `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`. API test configuration names include `NODE_ENV`, `DATABASE_URL`, `DATABASE_SSL_MODE`; the migration CLI also supplies the existing pool/connection/idle/statement timeout settings. No credential values are reproduced here.

The execution chain is:

```text
verify:phase1
  lint (JavaScript syntax, browser runtime types, API types)
  build (API)
  build:web (disposable Vite output)
  db:check (offline migration journal check)
  test:all (frontend tests, then API unit tests)
  test:db -> API workspace test:db
    npm run build -> tsc -p tsconfig.json
    node --test test/database.integration.cjs
  test:browser (only if preceding stages succeed)
```

Installation, compilation, all 245 frontend tests, and all 411 API unit tests passed remotely. Fresh database migration/reapplication and the actual PostgreSQL restart test also passed. The integration suite finished with **214 passed, 19 failed, 233 total**.

The first failed test was **T09 external observations retain provenance unknown states and native/external identity separation**, registered at `apps/api/test/collaboration-activity.integration.cjs:25`. Its first exception was:

```text
2026-11-09T23:15:59.2406008Z TypeError [Error]: Cannot read properties of undefined (reading 'agentId')
at TestContext.<anonymous> (.../apps/api/test/collaboration-activity.integration.cjs:27:119)
```

The preceding request at `23:13:07.385Z` logged a collaboration Agent projection failure and HTTP 503. The test then accessed `response.data.baseActivity.agentId`, although the error response had no `baseActivity`. Later native projection tests threw `ServiceUnavailableException`; browser tests timed out waiting for authorized bindings/eligibility. The npm lifecycle error at `23:15:59.2518510Z` was the final wrapper error, not the initiating failure.

## B. Root cause and previous repair limitations

**CONFIRMED:** the raw activity projection SQL introduced in commit `41d2288` referenced `i.received_at` three times. Migration `0007_volatile_bloodstorm.sql` creates `external_event_inbox.created_at`, with no `received_at` column. The ORM's logical `receivedAt` property uses the shared `created()` helper, which maps to physical `created_at`. There is no later column rename.

The optional Hermes subquery is part of every activity SELECT. PostgreSQL resolves its columns even when no Hermes configuration or matching data exists. The invalid column therefore breaks native activity reads as well as Hermes reads. Service error normalization deliberately replaces the driver exception with a safe HTTP 503.

TypeScript compilation cannot validate column names embedded in raw SQL. `db:check` validates migration metadata offline; it does not execute this application SELECT. Their successful exits therefore do not establish query/schema compatibility.

Before modifying source, an owned temporary PostgreSQL **17.3** cluster was initialized with random credentials, a fresh database, loopback access, bounded connections, and all **11** repository migrations. Executing the unmodified `activitySql` directly reproduced:

```text
SQLSTATE 42703: column i.received_at does not exist
```

After the correction, the identical query passed against another fresh cluster. Both clusters were stopped and their exact owned temporary directories removed. This proves the SQL defect and correction on real PostgreSQL; PostgreSQL 17.3/Windows is explicitly different from the hosted PostgreSQL 17.11/Linux environment.

The actual collaboration, Hermes and activity integration modules were also run against fresh native PostgreSQL databases. Loading the original repository module from HEAD in memory (without reverting files) reproduced the hosted `agentId` exception: **8 passed / 13 failed / 21 total**. With only the physical-column correction, that first error disappeared and **19 passed / 2 failed**. Both clusters shut down and cleaned up.

Two further defects were **CONFIRMED** by those previously obscured assertions:

1. An EXTERNAL Agent without a configured Hermes registration had its existing `DEADLINE_EXPIRED` reason overwritten with `EXTERNAL_LIVENESS_UNVERIFIED`. The optional Hermes mapper must leave its base projection untouched when it has no matching registration.
2. A newer Hermes `interrupted` snapshot still projected `RUNNING`, although the existing integration test requires `UNKNOWN`. The adapter assigns unknown states phase zero; the existing ingestion ordering therefore classifies even a newer source timestamp as `STALE`. The presentation query searched only `DEFERRED_ORDERING`. It now also considers stale unknown receipts whose source timestamp is at least the currently applied timestamp. Older unknown evidence is explicitly tested and must not hide a newer known state. This changes the uncertainty hint only; ingestion ordering and stored execution status remain unchanged.

**CONFIRMED locally:** after only the physical-column correction, the complete PostgreSQL 17.11 Docker harness passed **232 / 234** tests. All six browser scenarios that failed remotely passed, including the previous reload scenario. The only remaining failures were the same two semantic assertions above. This isolates the browser timeouts in the latest hosted run from the older reload race.

The previous attempt pinned Node 24.22.2, raised engine requirements, added safe runtime diagnostics, and added a load-event/DOM readiness helper for a browser reload race observed in the older run `42392417446` at commit `3d526e4`. Those changes address runtime selection and a different browser failure. The next commit also included the Hermes SQL extension that introduced the missing-column reference. Unit tests mocked repository results and did not execute that SQL; local Docker-backed verification had been unavailable. The repeated final npm message concealed a different first failure in the newer run. No previous repair is reverted here.

## C. Minimal correction

- `apps/api/src/city/activity.repository.ts`: use the existing physical `created_at` column in the unknown-observation ordering and last-confirmation aggregate. No schema migration is required.
- `apps/api/src/city/external-activity.mapper.ts`: preserve base projection semantics outside configured Hermes registrations.
- `apps/api/test/activity.integration.cjs`: execute the full activity SQL directly against the migrated test database for an empty owner scope. This retains PostgreSQL SQLSTATE diagnostics if any optional subquery references a nonexistent column, and verifies the empty-result contract.
- `apps/api/test/hermes.integration.cjs`: verify an older unknown source snapshot cannot replace the presentation of newer known evidence. Existing newer-unknown and deadline assertions are retained.
- This document records the evidence and verification boundaries.

No assertions are removed. Real database integration, workspace scripts, ordering, strict exit propagation, and the existing CI workflow remain enabled and unchanged.

## D. Environment comparison and verification

| Area | GitHub Actions | Local reproduction | Difference / evidence |
| --- | --- | --- | --- |
| OS | Ubuntu 24.04.5 | Windows | Job log / workspace shell; missing physical column is reproducible on Windows PostgreSQL |
| Node.js | 24.22.2 | 24.22.2 for checks | Temporary official binary; default system Node 24.9.0 was not changed |
| npm | 11.19.1 | 11.19.1 | Matching version installed only into a temporary directory |
| PostgreSQL | Harness pins 17.11-bookworm plus digest | Initial isolated reproduction: native 17.3; subsequent original Docker harness: 17.11 | Test-container `SHOW server_version` returned `17.11 (Debian 17.11-1.pgdg12+2)` |
| Docker | 28.0.4 | 27.4.0 | Initially stopped; installed Docker Desktop was started before harness verification |
| Environment | Explicit browser/temp variables; harness-generated database configuration | Explicit test configuration and generated credentials | No existing developer database or production configuration consumed |
| Migrations | Fresh database; 11 journal entries | Fresh database; 11 journal entries | Same versioned migrations; no local schema reuse |
| Working directory | Repository root, delegated API workspace | Repository root, delegated API workspace | Absolute platform paths differ; module and script resolution verified by successful builds |
| Execution | 245 frontend and 411 API unit tests pass; 19 integration failures | Final full Phase 1: 245 frontend, 411 API unit, 234 integration tests and browser hardening pass | One added direct SQL regression; original ordering and assertions retained |

The original harness creates a random, labeled container and volume, random credentials, a loopback ephemeral port, and a new `elyqreth_test_*` database. It polls the container's `pg_isready` health result, uses bounded connection/statement timeouts, creates the database, and applies migrations before assertions. It never consumes a developer `DATABASE_URL` or `TEST_DATABASE_URL`. Tests exercise real transactions, migration drift, startup without schema creation, and container restart persistence. Teardown closes pools, validates exact resource identities/labels, and removes only those resources. No additional workflow PostgreSQL service, migration change, authentication change, or shared database is necessary.

Executed before repair: separate API build passed; separate `node --test apps/api/test/database.integration.cjs` failed at setup because the Docker Linux pipe was unavailable. The native fresh-schema query then reproduced the SQLSTATE above before source edits.

Initial verification after repair: matching-version `npm ci` passed, the API rebuilt successfully, the isolated query passed, all three workflows passed `scripts/check-release-workflows.py`, and `git diff --check` passed. The first full Phase 1 attempt passed lint/builds, migration metadata, 245 frontend tests and 411 API unit tests, then reached the unavailable Docker engine. Successful final verification after Docker startup is recorded below.

Intermediate verification with only the SQL column-name correction: native selected integration modules **19 passed / 2 failed / 21 total**; complete pinned Docker suite **232 passed / 2 failed / 234 total**, including successful migrations, restart, browser scenarios and resource teardown. These are intermediate failing results, not claims that the final repair passed.

Continuation recovery: the retained final-source `npm run test:db --workspace=@elyqreth/api` log completed with **234 passed / 0 failed / 0 skipped**, including both previously hidden assertions and the new SQL regression. Its elapsed test-runner duration was 293185.7058 ms. The interrupted command session's wrapper exit code was no longer retrievable, so this result is supported by the complete Node test-runner summary. Recovery also confirmed no labeled test containers or volumes remained. The four recovered code/test changes were reviewed and preserved without further edits.

The remaining full `npm run verify:phase1` run then completed with **exit code 0**, using Node 24.22.2, npm 11.19.1, PostgreSQL 17.11, explicit `BROWSER_PATH`, `BROWSER_HARDENING_PHASE4=true`, and `TMPDIR`. It passed lint, API/frontend builds, migration metadata, **245 frontend/contract tests**, **411 API unit tests**, and **234 database integration tests**, with zero failed or skipped tests. The final real Chrome 156.0.8078.80 smoke check passed with zero exceptions, including Phase 4 keyboard/AX and repeated-selection hardening. The command output explicitly recorded `PHASE1_EXIT_CODE=0`.

The standalone passing database run used container identity suffix `f36fe7e3c97de86ea3c987a1`; the passing repeat inside Phase 1 used `a3be10953bec807760655a15`. Each owned a fresh database and volume, applied migrations, tested restart persistence, and completed teardown. No previous database state was reused.

| Investigation step | Recovered/final status | Evidence | Remaining work |
| --- | --- | --- | --- |
| Repository audit | COMPLETE | Branch/commit, clean starting index/tree, reviewed diff and instructions | None |
| GitHub Actions log retrieval | COMPLETE | Actual run/job linked above; complete failure log retrieved | None for root-cause evidence |
| Failure chain analysis | COMPLETE | Build succeeds; activity SELECT fails during integration assertions | None |
| CI environment reproduction | PARTIAL | Node/npm/PostgreSQL match; local Node/browser OS is Windows | Confirm on hosted Ubuntu |
| Root cause identification | CONFIRMED | SQLSTATE 42703, baseline assertion reproduction, two secondary assertion failures | None |
| Repair implementation | COMPLETE | Two source files and two integration test files; prior repair preserved | None |
| Local verification | PASS | Full Phase 1 exit 0; two fresh database runs each pass 234 tests | None |
| GitHub-hosted verification | PENDING | Latest existing run predates these uncommitted changes | Authorized post-repair run |

| Verification | Outcome | Evidence |
| --- | --- | --- |
| API build | PASS | Separate workspace build succeeded; final Phase 1 API builds also succeeded |
| Exact API `test:db` | PASS | Recovered complete runner summary: 234 pass, 0 fail, 0 skip; interrupted wrapper exit unavailable |
| Repeated integration | PASS | Fresh Phase 1 database: 234 pass, 0 fail, 0 skip; complete parent command exit 0 |
| Full Phase 1 | PASS | `npm run verify:phase1`, exit 0; browser hardening included |
| Workflow validation | PASS | All three workflows parsed and passed existing policy validator |
| GitHub Actions after repair | PENDING | No push or remote trigger performed |

## E. Status

**LOCALLY VERIFIED — GITHUB PENDING.** The original failure was reproduced; the final repair passes the original Docker-backed integration suite and full Phase 1 pipeline locally.

**GITHUB-HOSTED VERIFICATION: PENDING.** No remote workflow was triggered and no result for these uncommitted changes is claimed.

## F. Next action and reproduction commands

The remaining action is to inspect an authorized GitHub-hosted run of the repaired source before claiming hosted success. No remote run is started by this task.

The completed local checks can be reproduced with Docker Desktop's Linux engine ready, Node 24.22.2 and npm 11.19.1:

```sh
npm run test:db --workspace=@elyqreth/api
npm run verify:phase1
```

Each invocation owns a separate disposable PostgreSQL database/container/volume, so running both also checks independence from earlier test data.
