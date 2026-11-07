# T15 Production readiness and authorized first promotion

Assessment: **2026-11-07, Asia/Bangkok**. **T15 PARTIAL (safe preparation); Go/No-Go BLOCKED; AWAITING PRODUCTION AUTHORIZATION; promotion NOT STARTED; Phase6 BLOCKED.** No production access, preflight, mutation, publication, migration, smoke test or stabilization took place. This prompt explicitly does not authorize deployment. [Assessment and verification evidence](verification-evidence/production-readiness-verification.json) records exact outcomes and the20-row readiness matrix.

## Audit and evidence disposition

No applicable AGENTS.md or Git metadata exists in the supplied workspace. Git status, staged/untracked classification and diff checks are unavailable. A pre-edit SHA256 inventory of5333 existing files preserves prior work. No canonical source commit is inferred from a workspace hash, fixture commit or local Docker image ID.

T01's baseline remains one application host, static web, HTTPS edge, API with the in-process native Runtime Coordinator, and privately reachable PostgreSQL. T02 common configuration and T03/T04 exclusive local/OIDC private-operator access are implemented; public multitenant enrollment is not accepted. T05-T10 local container/TLS/roles/migration/restore/drain/external-security contracts are preserved. No dedicated worker, broker, Redis, public signed webhook or external dispatch capability exists. No new service or deployment architecture is introduced.

T13/T14 files are **historical local evidence**, assessed today without changing their dates. T14 recorded374 backend,238 frontend,232 PostgreSQL,45 role/migration and16 backup checks, separate source-loss restore,23 bounded load stages/408 timed operations, and browser observations. Its output-guard refinement was tested separately after measurement; the recorded snapshots retain that distinction. Source database loss recovered read access in1935ms; the server survived,21 runtime tables matched the snapshot, and one post-snapshot marker was absent. Approved RPO/RTO/workload targets remain absent. These results are not production signoff.

The T15 assessor checks fixed evidence files for the expected reviewed partial profile: successful commands/counts, finite completed capacity stages, a successful isolated source-loss exercise, null unapproved recovery targets, and the six explicitly unresolved HIGH findings. Missing/contradictory evidence fails with exit1. A valid **blocking** assessment returns exit2 and records an integrity hash of each local input. Hashes/JSON are not authentication or proof that a reviewer approved a release. This scoped assessor does not automatically accept newly edited COMPLETE/READY reports; changed evidence requires review/revalidation.

All T14 HIGH findings retain disposition **OPEN—BLOCKS PROMOTION**; there is no approved exception policy or accepted exception:

| Finding | Current disposition / required closure |
| --- | --- |
| H-01 scanner/provenance | Container OS/build-tool CVE scan, approved scanner/database and signed/trusted candidate provenance remain unverified. npm production audit reported zero advisories for its recorded scope |
| H-02 release/rollback | No canonical candidate, registry, target, verified protection settings or deployed previous compatible release/rollback evidence |
| H-03 capacity | Finite local bursts are measured; approved workload, latency/storage/resource/cost targets and sustained acceptance are missing |
| H-04 recovery | Off-host backup/key/hosting-failure drill and approved recovery objectives remain missing |
| H-05 operations | No named responder/escalation and no approved recipient delivery evidence |
| H-06 restore cutover | Session-revocation rollback and uncertain native/external effects need an approved, exercised reconciliation procedure before access/admission reopens |

No CRITICAL application defect was confirmed by the executed tests; that does not certify unscanned artifacts or unexecuted production controls. M-01 human UAT/accessibility/tabletop remains unverified. The T14 verification-tool path defect was corrected and tested; it is not an unresolved application vulnerability.

## Production readiness matrix

Detailed evidence, severity-if-failed, responsible component, required action and blocking status are in the JSON assessment. These are **production readiness** classifications; PARTIALLY VERIFIED retains positive local evidence without claiming actual target acceptance.

| IDs | Requirement | Status |
| --- | --- | --- |
| APP-01 | Application correctness / approved-candidate regression and smoke | PARTIALLY VERIFIED |
| AUTH-01, AUTHZ-01 | Authentication/session and object ownership | PARTIALLY VERIFIED |
| CTR-01, NET-01 | Container restrictions and edge/private network | PARTIALLY VERIFIED |
| DB-01 | Runtime/migration identities, schema/journal/locking | PARTIALLY VERIFIED |
| RT-01, COL-01 | Native reliability and bounded collaboration | PARTIALLY VERIFIED |
| EXT-01 | External security; production activation remains disabled | PARTIALLY VERIFIED |
| BAK-01 | Backup tooling and local restorability | PARTIALLY VERIFIED |
| DR-01, CAP-01 | Operational recovery and capacity acceptance | BLOCKED |
| OBS-01 | Live monitoring/on-call/delivery | BLOCKED |
| RUN-01 | Runbooks and human handoff | PARTIALLY VERIFIED |
| ART-01, PIPE-01, ROLL-01 | Immutable release, deployment mechanism and actual rollback | BLOCKED |
| CFG-01, TGT-01 | Production inputs and authorized target preflight | BLOCKED |
| APPR-01 | Authenticated deployment approval | BLOCKED |

## Exact candidate and change plan

This is a reviewable **unbound change plan**, not a release candidate or scheduled deployment. All missing values remain null rather than invented names, commits, infrastructure or approvals:

```json
{
  "planStatus": "BLOCKED",
  "releaseId": null,
  "sourceCommit": null,
  "releaseManifest": null,
  "expectedManifestSha256": null,
  "apiDigest": null,
  "webDigest": null,
  "edgeDigest": null,
  "migrationImage": "must equal the approved API digest",
  "targetEnvironmentId": null,
  "deploymentWindow": null,
  "operator": null,
  "approvalAuthority": null,
  "protectedWorkflowRun": null,
  "backupAndRestoreReceipt": null,
  "previousCompatibleRelease": null,
  "monitoringWindowAndThresholds": null,
  "escalationContact": null
}
```

Local verification Docker config IDs remain in the historical reports only; they are not registry-manifest digests or source provenance and are not promoted. No approved `release.json`/bundle/expected SHA exists. Do not build a new artifact as part of promotion, use mutable tags, manufacture a Git commit, substitute a fixture bundle, or treat a checksum copied beside a manifest as its own trusted source.

Once a canonical candidate is supplied through the reviewed T12 path, existing **local read-only** primitives are:

```sh
node scripts/release.mjs verify --bundle <approved-local-bundle> --expected-sha <trusted-64hex-sha>
```

`verify` checks content/OCI graph/source labels; it does not authenticate authorship. `producer` uses authenticated GitHub access and may only be used in the approved repository workflow context; no such request was made here. Signed provenance/scanning and actual environment protection remain separate gates. T12 `plan` is PLAN_ONLY_NO_DEPLOYMENT; synthetic approval/backup receipts are test inputs, not live authority. The registry publisher and deployment executor **do not exist**. A future approved mechanism must be reviewed before any first-promotion execution; do not improvise SSH, ad-hoc `compose up`, a new secret token or an apply command to bypass that gap.

## Authorization and Go/No-Go contract

Approval must authenticate the exact manifest hash/release, exact environment, operation, authorized approver/protected mechanism and approved window. Repository access, this prompt, CI success, a credential, staging success, a local JSON `APPROVED` field, or an environment name in YAML is insufficient. No self-approval is supported. Existing `ELYQRETH_CANDIDATE_ENABLED` prepares a candidate only; `ELYQRETH_PLAN_ENABLED` enables review only. Neither grants production access or mutation.

The offline assessor reads no approval/credential input and exposes no fetch, SSH, Docker, migration, notification or deployment executor. Its current profile always keeps production closed; even internally consistent local evidence cannot yield GO/AUTHORIZED/DEPLOYED. Unsupported flags are rejected. Exit2 means **a successfully computed blocking decision**, not an authorization request being submitted. Existing output directories and checkout paths are refused.

```powershell
node scripts/production-readiness.mjs --output "$env:TEMP\elyqreth-t15-new-review"
```

Reassessment is required after any source, candidate, configuration, target or evidence change. Immediately before any future authorized mutation, the protected mechanism must recheck critical/high dispositions, immutable identity, target binding, staging/security/capacity evidence, fresh approved backup/restore/key availability, migration compatibility/lock, monitoring/responders, previous release compatibility and approval validity/window. GO is a safety decision, not a substitute for explicit authorization. Here identity, mechanism, target, operational gates and authorization are missing: **BLOCKED**.

## Read-only production preflight procedure — NOT EXECUTED

Preconditions: a designated target, separately approved read-only access, named operator and protected context. Do not connect now. Read-only preflight must not create a Compose stack, run migrations, send SMTP/provider requests, start work or acquire secrets by printing them. Capture only safe classifications/counts/approved certificate metadata, not full environments, URLs containing credentials, headers, tokens, keys or payloads.

| Check | Authorized future procedure / expected evidence | Current result |
| --- | --- | --- |
| Identity/access | Bind provider/host/database/environment identifiers to approved target and least-privilege operator session | BLOCKED: not designated |
| Runtime/topology | Read-only service status and approved image references; no direct API/DB/admin public mappings; verify one native writer | BLOCKED |
| Registry/candidate | Read approved manifests/attestations/digests under reviewed registry access; verify same staging tuple, no tag resolution | BLOCKED |
| DNS/TLS/proxy | Read approved DNS/cert chain/expiry/host and forwarding trust; verify renewal owner | BLOCKED |
| Application readiness | Within authorized existing API namespace: `node docker/api-health.cjs`; liveness separate from readiness/drain | BLOCKED |
| Configuration | Review explicit production origin/auth mode/owner/key references, HTTPS, CORS, proxy and private role/CA references; no dev/staging fallback | BLOCKED |
| Database | Existing approved host tool context: `node apps/api/dist/database/migrate.js --preflight` with migration-role secret injection | BLOCKED |
| Recovery | Read target-bound fresh backup metadata and independent restore/key/off-host evidence; approve recency/objectives | BLOCKED |
| Monitoring/operators | Approved read-only log/diagnostic access, verified delivery receipt, named responder/escalation | BLOCKED |
| External integration | Confirm disabled production gate; enabling requires separate approved target/version/destinations/credential/source principal and compatibility evidence | BLOCKED for enabled integration |
| Broker/cache/separate worker | No such component exists; do not invent a probe or service | Not applicable |

Migration preflight takes/releases the existing advisory lock and performs database reads; it does not apply DDL, but still requires explicit database access authorization. Do not use `compose run` as a supposedly infrastructure-read-only preflight: it can create containers/networks. Full `compose config` output can contain environment values; use `--quiet` with reviewed inputs on the authorized target, or safe field-filtering. The local checker below is explicitly an **inert fixture**, not target configuration, credentials or TLS validation:

```sh
node scripts/check-production-compose.mjs
```

It runs only `docker compose config` against fixed repository definitions with empty interpolation environment/inert secret placeholders, verifies service/port/network/restricted-filesystem and runtime/migration-secret separation, and never pulls, starts or connects to an application/DB. The example owner/certificate contents are deliberately not valid production startup inputs. Actual credential/configuration validation is BLOCKED until approved target values/access exist. Cookie/refresh/CSRF machinery is not invented: the current browser uses memory-only bearer authentication; OIDC accepts reviewed API tokens, not an implemented login redirect flow.

## Conditional promotion sequence — execution transport unavailable

The approved T12 plan sequence and T07/T08/T09 primitives are retained. Every step below is PLANNED/NOT STARTED; this is not a runnable production deployment script:

1. Bind the exact approved release/target/window/approver, review evidence and exceptions, acquire approved deployment ownership and obtain fresh target-bound recovery evidence. Missing/failed gates stop before mutation.
2. Pull and verify the same approved API/web/edge digest tuple without rebuilding. Migration image is the API digest; only the migration workflow receives migration credentials. Bootstrap credentials never enter API/web.
3. Run authorized migration-role preflight; review actual journal/pending migrations and exact image compatibility. Source migration-file fingerprints are not live journal checks. Use expand/contract and no destructive auto-sync.
4. Pause only approved local observation commands, enter native-only SIGUSR2 drain on the single writer, and verify readiness false while liveness/read APIs remain available. No generic worker/queue command exists. Do not cancel external-owned work.
5. Wait within approved runtime grace and reconcile remaining uncertain work. A timed-out/unknown effect must stop unsafe progression, not be called successful. Stop API using the existing45-second container grace before incompatible work/migration. No blind claim reset or replay.
6. Invoke the existing locked migration command through the approved mechanism using the separate migration role. Failure/connection ambiguity stops progression; inspect journal/schema with approved preflight. Never mark metadata manually or automatically reverse SQL.
7. Replace API by exact digest without build, verify private readiness/journal/auth mode, then replace the paired static web and edge. Preserve runtime secret mounts/strict public config; keep external activation closed.
8. Execute approved smoke checks and monitoring. On failure, preserve identities/logs/durable execution state and follow approved incident/rollback decisions. Never assume stop/restart means a successful deployment.

Current actor, deployment ownership/mutex, live target, window and executor are unset. T12 review-workflow concurrency is not evidence that a deployment mutex exists. Do not enable automatic production promotion as part of this preparation.

## Smoke, stabilization, rollback and handoff

| Stage | Prepared checks | Current execution |
| --- | --- | --- |
| Post-deployment smoke | Liveness/private readiness; trusted principal bootstrap; authorized Agent/Task/Execution reads; collaboration snapshot/provenance; frontend assets/city/NPC polling/session cleanup; negative unauthorized/forbidden checks | NOT STARTED |
| Optional mutation smoke | Only separately approved synthetic owner/task/idempotency key, deterministic rule-based native work and audit verification; no paid LLM or external dispatch | NOT AUTHORIZED |
| External checks | Disabled mode remains disabled; enabled provider health/reconciliation needs explicit provider-test authorization | NOT STARTED |
| Stabilization | Actual errors/latency/admission/recovery, DB/pool/storage/resource health, ingestion failures and frontend availability; approved observation interval and trigger thresholds required | NOT STARTED; no monitoring period invented |
| Rollback | Critical auth/security/data integrity, failed mandatory smoke, persistent unavailability or approved error/latency threshold triggers stop/escalation | Prepared only; previous release absent |

Rollback requires exact prior API/web/edge digest tuple, schema/journal compatibility, approved authority/operation/window, drain/reconciliation and readiness/smoke verification. T12 currently requires matching migration inventories; expand-only compatibility alone does not prove older-image readiness. Do not run down migrations or automatically restore a database. A restore is separate destructive DR with explicit approval and possible loss/replay of post-backup effects. Without a verified prior artifact, stop/escalate; do not fabricate a rollback result.

Prepared operational handoff (all people/access/window entries **UNASSIGNED**):

- Application/edge operator: approved target, TLS renewal, mode/origin/secret references, private health probes and one native writer. [Containers](container-hardening.md), [network](edge-network.md), [access](frontend-access.md).
- Database/migration operator: role separation, actual preflight/journal and failure inspection. [Database runbook](database-migrations.md).
- Recovery/key custodian: off-host freshness/retention/key availability, isolated restore, session invalidation and native/external effect reconciliation. [Recovery](backup-recovery.md), [T14 boundaries](security-capacity-recovery.md).
- Runtime/integration operator: drain, quarantine, exact native ownership and connection-scoped observation; no external engine takeover. [Runtime](runtime-drain.md), [external](external-connectivity.md).
- Incident/release authority: private diagnostic access, delivered alerts, on-call/escalation, immutable candidate/approved mechanism and known-compatible rollback. [Observability](observability.md), [email](email-monitoring.md), [release](immutable-promotion.md).

There is no deployed release identity, target endpoint, production approval/workflow run, migration/backup/drain/smoke outcome, monitoring observation or rollback outcome to hand over. Their audit fields remain null/NOT STARTED in the evidence. T16 Final Acceptance & Operations Handover is not implemented or marked complete; actual handoff requires the named operators and executed authorized evidence.

## T15 continuation supplement

The [blocker-closure continuation](t15-blocker-closure.md) supplements this dated assessment with actual local scan and metadata-variant rollback results, backup/monitoring checks and private decision records. Historical T13/T14 evidence and unresolved HIGH findings remain intact; published-candidate, approved target/transport/people/objective gates are not waived. Production remains NOT READY, authorization awaiting and promotion NOT STARTED. See [continuation evidence](verification-evidence/t15-blocker-closure-verification.json).
