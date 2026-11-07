# T15 continuation: blocker closure and approval package

2026-11-07, Asia/Bangkok. **NOT READY; AWAITING PRODUCTION AUTHORIZATION; T15 PARTIAL.** This continuation preserves the [original T15 assessment](production-readiness.md), its six unresolved HIGH findings and the closed publication/deployment decision. [Closure evidence and register](verification-evidence/t15-blocker-closure-verification.json) distinguish implemented tooling, actual local execution and external prerequisites. No production preflight/mutation, publication, remote branch, real-channel notification or deployment is performed.

## Recovered work and closure matrix

The workspace still has no Git metadata or applicable AGENTS.md. Original T12/T13/T14 evidence and the original T15 assessment fields are preserved; T15 receives an explicitly dated supplement. A 5339-file SHA256 baseline protects existing work. Current deployment primitives are the fixed API/web/edge targets and a migration command sharing the API image. There is no separate worker, broker, cache, public signed webhook, external dispatch capability, approved publisher or production execution adapter. Those are not silently invented to remove blockers.

| Blocker | Existing evidence | Missing requirement | Owner / resolution action | Status |
| --- | --- | --- | --- | --- |
| Canonical Git/source revision | Repository docs and default-branch checks; no .git | Owner URL, default branch, exact commit and branch/workflow protection | Repository owner approves actual canonical identity and supplies clean checkout; do not init fabricated history or change remotes | BLOCKED_EXTERNAL |
| Registry/publication | T12 digest naming and disabled candidate/review workflows | Selected registry/project, visibility/retention, publisher and readonly pull identity; authorized publication | Release/security owner selects policy below; no images pushed | BLOCKED_EXTERNAL |
| Candidate identity | OCI/manifest/hash/producer fixture tests | Actual source-selected candidate, trusted expected SHA, digest tuple, scans/provenance/staging receipts | Release owner completes approved T12 preparation; no local config-ID substitution | BLOCKED_EXTERNAL |
| Target/approval/authorization | T01 topology, strict T02-T10 contracts, offline T15 gate | Real environment/access, protected mechanism/operator/approver/window | Infrastructure/release/security owners complete private checklist and separate authorization | BLOCKED_EXTERNAL |
| Local container scanning | New pinned Trivy archive runner; actual results in closure JSON | Published candidate scan/trust remains unavailable | Local tooling verified; security owner must approve tool policy and scan exact candidate | PARTIALLY RESOLVED |
| Local rollback execution | New owned A/B/A API/web/edge rehearsal | Previous approved release, actual software/schema downgrade and protected target evidence | Local tool execution verified where supported; actual release rollback still needs release/database approval | PARTIALLY RESOLVED |
| Production execution transport | T12 is PLAN_ONLY_NO_DEPLOYMENT | Reviewed publisher/target-specific controlled execution and protected access | Repository implementation depends on selected registry/target/approval policy; no improvised SSH/apply command | BLOCKED_TECHNICAL |
| Backup/key recovery | Existing encrypted dump, actual isolated restore/source-loss, wrong-key/corruption/role checks | Off-host/key escrow/provider recovery, named custody and approved cutover/session/effect policy | Recovery/security owner approves and exercises actual dependency chain | PARTIALLY RESOLVED |
| Monitoring/delivery | Existing actual local SMTPS fixture, redaction, retry/uncertainty and real readiness logs | Configured external test receiver, delivery receipt, acknowledgement and named responder | Monitoring/incident owner supplies private channel/contacts and authorizes delivery | BLOCKED_EXTERNAL |
| Capacity/RPO/RTO | Actual finite T14 bursts and1935ms source-loss read recovery | Approved expectations, sustained comparison, operational coverage and hosting-failure recovery | Product/operations/recovery owners approve records and commission measurements | BLOCKED_EXTERNAL |

Status meanings: RESOLVED applies only to the specifically evidenced repository capability; PARTIALLY RESOLVED retains mandatory external evidence; BLOCKED_EXTERNAL needs owner/infrastructure input; BLOCKED_TECHNICAL names an unimplemented/incomplete technical operation; NOT VERIFIED has no actual result. Documentation/templates alone never close a blocker. No unresolved T14 finding or exception is deleted or waived.

## Canonical repository, registry and candidate decisions

No canonical Git remote, default/current branch or source SHA can be established without .git. No conflicting approved repository was found in the current release settings; dependency/documentation links are not canonical ownership. The required decision is a repository-owner-approved URL and branch, then an actual clean checkout with reviewed source/workflow protection. Existing CI uses `github.repository`, the event default branch and exact HEAD/origin validation. Naming an environment in YAML does not prove protected settings or reviewer identity. Require authorized reviewers, self-review prevention, branch restrictions, protected workflow/release code and audited manual promotion ownership before enabling production paths.

Compatible registry choices (none selected):

| Option | Fit / required decision |
| --- | --- |
| GHCR | Fits current GitHub Actions. Owner must supply organization/project, visibility, scoped package publisher identity, readonly production pull, retention/access and protected publication policy. Existing build jobs are contents:read and do not publish; a future publisher needs explicitly approved package-write scope isolated from PR jobs |
| Existing private OCI registry | Fits provider-neutral digest references; owner must supply namespace, trusted CA/auth, retention/availability, least-privilege push/pull and audit policy |
| Docker Hub | Compatible OCI publication option; requires organization/repository visibility, scoped publishing/pull tokens, retention/pull-limit review and manual promotion policy |

All must support retained immutable **manifest digests** and demonstrate continued pull/retention. Digest addressing does not guarantee an operator cannot delete an artifact; do not infer immutable tag policy or indefinite retention. Naming remains `<approved-prefix>/{api,web,edge}@sha256:<verified digest>`. Migrator uses the API digest. There is no worker digest. Neither the Trivy tool registry nor local verification tags select Elyqreth's publication registry.

Candidate milestones remain separate: source selected **NO**; canonical committed build verified **NO**; existing local verification images built/tested **YES, original evidence scope**; registry artifact published **NO**; registry candidate digest verified **NO**; exact approved staging release tested **NO**; production eligible **NO**. No fake source SHA/release manifest/registry digest is generated.

## Container scanning: actual local execution

The repository already expected Trivy in T12. This continuation uses one scanner, official Trivy0.76.2 pinned to the resolved content digest recorded in code/evidence. Its [official release](https://github.com/aquasecurity/trivy/releases/tag/v0.76.2) and [installation/archive guidance](https://www.trivy.dev/docs/latest/getting-started/installation/) were checked. Avoid floating latest/compromised historical tags; Docker documented the [2026 Trivy image incident](https://www.docker.com/blog/trivy-supply-chain-compromise-what-docker-hub-users-should-know/). Release-page verification and content pinning are recorded, not claimed as independent cryptographic image-signature verification or production policy approval.

```powershell
docker pull docker.io/aquasec/trivy@sha256:8f6bb947dbc528902e11f2f5be52f7b519f6a39d5d148f41166f2040499768fb
node scripts/scan-local-images.mjs --output "$env:TEMP\elyqreth-local-image-scan-new"
```

The runner accepts no target registry, credential or production endpoint. It resolves the three fixed existing verification tags once, saves by exact local Docker config ID, hashes the archive and raw report, and validates Trivy's metadata ImageID against that identity. OS package coverage is required; API Node package coverage is required. Unsupported/EOL or incomplete/unknown reports cannot yield a clean gate. A nonempty scan with no vulnerabilities is distinguished from an empty/unscannable image.

Only public vulnerability-DB acquisition has network access. Actual archive scans use `--network none`, offline analysis and frozen DB content/metadata hashes. No Docker socket, home, host credentials, runtime environment or key files are mounted into the scanner. It runs non-root/read-only with resource limits and only isolated archive/cache/output mounts. HIGH/CRITICAL findings block even when no fix exists; no exception is implicitly accepted. Secret matches/snippets are omitted from safe summaries. Raw reports/archives remain in the new private local output directory and are not copied into this repository, frontend or edge. Windows ACLs require operator review; Unix file modes are not a Windows ACL guarantee.

Exit0 means the local scan completed with no HIGH/CRITICAL; exit2 means completed but security-gate failure; exit1 means incomplete/technical failure. A clean local scan does not authorize publication or prove source-to-image provenance, signed SBOM/provenance, published-artifact scanning or current scanner-policy approval. T12's existing pinned administrator-selected Trivy-compatible CI gate is preserved; no automatic GitHub variable/permission change occurs. Re-scan the exact approved candidate after source/dependency/tool/DB changes.


Actual results (2026-11-07):

| Local image | Docker config identity suffix | Verified coverage | Findings |
| --- | --- | --- | --- |
| API | `ed38ea35...afd900` | Alpine 3.24.3, 19 OS packages and 122 Node packages | 0, including 0 HIGH/CRITICAL |
| Web | `ee9782e2...033e` | Alpine 3.24.3, 21 OS packages | 0, including 0 HIGH/CRITICAL |
| Edge | `c61be9fd...99f2` | Alpine 3.24.3, 21 OS packages | 0, including 0 HIGH/CRITICAL |

The closure JSON retains exact full identities, scanner version, DB timestamp/content hash, artifact/report hashes, commands and scan timestamps. These are local Docker configuration IDs, not published OCI manifest digests. The actual scan used `aquasec/trivy@<digest>`; code now uses the fully qualified `docker.io/aquasec/trivy@<same digest>`. That namespace normalization passed contract validation; it is not described as another full scan.

## Rollback: real local fixture, not a released-version claim

```sh
node scripts/container-hardening.mjs --edge --runtime-drain --rollback
node --test --test-reporter=tap apps/api/test/local-rollback.test.cjs
```

This extends the existing random-labelled T05/T06 harness. Rollback mode strips inherited Docker contexts/remote hosts and explicitly selects the local Docker Desktop/Linux socket, matching the scan runner; custom/rootless/remote daemons are not inferred. It never accepts a database/host/release target. The fixture creates two **metadata-only variants of the same base application code**, each with real distinct Docker config IDs and explicit LOCAL_METADATA_VARIANTS selection records. A is started, authenticated/TLS/readiness-smoked, replaced by B and then restored to A. Every selected API/web/edge identity is inspected, the exact database journal hash remains stable, prior successful Execution state stays SUCCEEDED with exactly one effective Execution, and native-only drain precedes replacement. Frontend, protected account access and internal readiness isolation are checked. Production external activation is not enabled or cancelled.

The variants are not invented source revisions, release manifests, registry digests or a genuine earlier software version. This does not demonstrate compatibility after a real application/schema change, or validate the missing production execution adapter. The actual previous approved release/target rollback gate remains unresolved. Images, containers, networks and volumes created by this fixture are cleaned up only after exact run-label/image-label validation; the original fixture API is restored before remaining harness checks.

Failure handling:

| Failure | Evidence / safe disposition |
| --- | --- |
| Image unavailable | Local identity lookup rejects before replacing current service; no tag fallback or rebuild |
| Manifest/selection invalid | Contract tests reject mutable/registry substitutions into local config-ID schema; T12 candidate contract remains separate |
| Schema incompatible | Actual journal fingerprint and selection contract must match before replacement; no down migration |
| Invalid candidate startup/readiness | Missing secret fixture fails startup; current A remains healthy; preserve durable state |
| Drain timeout | Existing actual PID1 deadline test preserves/quarantines state; do not fabricate success, force claims or continue uncertain effects |
| Readiness/smoke/observation step fails | Test-only T12 failure oracle stops at each configured step. This is labelled simulation, not an actual failed deployed rollback |
| Separate worker readiness | Not applicable; runtime remains inside API |

Any real rollback failure must stop admission/cutover, retain exact current/previous identities and safe diagnostics, and escalate to the assigned release/database/incident authority. Never blindly delete Tasks/Executions/audit rows, reset leases, disable auth, reverse SQL or restore a production DB. If prior artifacts are missing, do not claim a rollback exists.

## Backup, secrets and key-recovery runbook

Existing T08/T14 evidence separately proves encrypted backup creation, authenticated metadata/checksums, copied-artifact validation, isolated restore and read service recovery. A checksum is not restoration; local mirror copying is not off-host durability. Current continuation verification commands and outcomes are in the closure JSON.

| Material / owner role | Recovery dependency and safe action | Key-loss consequence |
| --- | --- | --- |
| Backup AES-256-GCM/authentication key / key custodian | Escrow outside failed host under approved custody; verify using synthetic keys or an isolated approved restore, never print/hash secret material into public evidence | Archive/receipts cannot be authenticated/decrypted; no bypass or guessed replacement key |
| Runtime/migration/bootstrap/backup DB credentials / database operator | Separate secret references; T07 re-provision approved roles against fresh target. Bootstrap never enters API/web; SQL archive does not replace cluster-role/bootstrap recovery | DB/schema/recovery access unavailable until authorized re-provisioning |
| Local accounts/opaque sessions / security and recovery operator | Password/session hashes live in DB; there is no invented local session signing key. Keep access closed and apply approved account/session invalidation before reopening a restored checkpoint | Restoring old versions can undo revocation; do not accept replayed old sessions by assumption |
| OIDC / IdP/security operator | Issuer signing keys remain outside Elyqreth. Recover issuer/key custody per provider policy; public JWKS/issuer/audience and explicit subject grants must be restored/validated | Tokens cannot be verified or may remain compromised; no local password fallback |
| Provider/source secrets / integration operator | Restore or rotate backend-only references after approved provider/source identity review. Keep activation/dispatch closed; preserve source generations, mappings/inbox and external authority | Observation/authentication unavailable; metadata does not confer privileges or authorize duplicate work |
| Edge TLS private key and DNS issuance / TLS operator | Restore protected reference or reissue only with authorization; retain trusted public CA/cert chain and expiry/renewal owner | HTTPS availability/authenticity lost; no insecure TLS bypass |
| Managed DB encryption/PITR keys / provider recovery owner | Confirm actual provider operations and access; these are not Elyqreth-owned application master keys or included in logical backup | Provider recovery may fail even when logical archive survives |
| SMTP credential and monitor private state / monitoring owner | Restore/rotate credential separately; preserve bounded dedupe/inflight state and reconcile uncertain acceptance, not blind resend | Notifications fail or duplicate if uncertainty is ignored |
| Future CI/registry/signing credentials / release owner | None configured; use approved least-privilege provisioning/rotation and audit, never generate production keys here | Publication/pull/provenance unavailable |

Recovery procedure, not production authorization:

1. Name recovery/approval/operator/key/security roles, isolate writers/ingress/provider effects and confirm target ownership. Verify the independent backup and key custody references without logging values.
2. Select a retained archive and authenticated metadata from approved independent storage. Use existing `backup-command.js verify` stdin contract; nonzero/missing key/checksum failure stops. See [T08 exact contracts and placeholders](backup-recovery.md).
3. Rehearse on a separate fresh isolated loopback target using the existing role provisioning and restore confirmation. Missing/wrong keys must reject; do not infer recoverability from mere key-file presence or a checksum.
4. Restore schema/data, verify journal/constraints, every relevant runtime relationship, mappings/inbox/audit and least-privilege grants. Re-provision cluster roles/private CA and secret references separately.
5. Keep native admission and public access closed; review all interrupted/running/cancelled/terminal work and post-backup effects. Apply an approved local-session or issuer revocation procedure and connection credential/source reconciliation. Do not blindly restart work.
6. Start only approved read inspection in isolation, verify auth/owner boundaries and frontend/API availability, then obtain separate authorized cutover/re-admission approval. Record actual timing boundaries/data loss/limitations and escalation outcome.
7. If keys/storage/operator access are unavailable, stop and escalate to the assigned custodian/recovery authority. Do not substitute a freshly generated key, export production keys or bypass encryption/verification.

The restore fixture now waits for TCP readiness, matching its host TCP client; a socket-only init server must not satisfy that probe. This hardens test startup only, not production lifecycle or schema behavior. PostgreSQL documents the socket-only initialization server in its [official entrypoint](https://github.com/docker-library/postgres/blob/master/docker-entrypoint.sh). Synthetic wrong-key/corruption/redaction and real encrypted restore tests exercise repository mechanisms; actual escrow ACLs, custodian availability, off-host/key recovery and chosen local/OIDC cutover policy remain external/operator evidence. Generic role labels are not named assignments.

## Monitoring and ownership

T11 already has structured safe logs, request/execution/collaboration/connection correlation, private DB/runtime readiness, ingestion rejection/reconciliation diagnostics and a separate optional host monitor/verified SMTPS sender. Existing real local SMTPS fixtures verify authentication, fixed safe notification bodies, TLS rejection, retry exhaustion, persistence, duplicate suppression and uncertain-DATA quarantine. Actual container failures verify dependency/drain signals. No external receiver is contacted or test alert sent by this continuation.

Release-critical rule review: API/DB/readiness unavailable, native finalization/recovery/drain deadline, source/authentication/ingestion reconciliation, backup verification failure and future protected deployment failure. Broker/cache/dedicated-worker alerts are not invented. Backup/restore and deployment command exit outcomes must be monitored by the approved scheduler/pipeline; local fixtures do not establish that those operational jobs exist.

Instrumentation implemented, signals emitted, backend configured, rule configured, notification delivered and operator acknowledged are distinct milestones. The private record must include a test-channel authorization reference, actual delivery receipt, acknowledgement and assignment—not only a config file or a passing fake SMTP server. Required named roles: deployment approver/operator, primary/backup incident responders, database recovery, backup/key custody, security escalation and monitoring owner. Keep personal contacts and actual secret values outside the public repository.

## Private decision/approval record and gap analysis

[The unpopulated public template](../../../docker/production-prerequisites.example.json) is a copy-out checklist, **not an approval credential or deployment input**. Copy outside checkout into approved private configuration; do not fill real contacts/secrets/signatures in tracked files. All values remain null/unapproved here. Completion of a JSON template never authenticates authority or opens the T15 gate.

It requires canonical source/branch/commit, registry policy, candidate/digest/producer/staging receipt, target/network/DNS/TLS/DB/secret references, named roles/private contact refs, approved window/rollback authority and authenticated protected-mechanism approval. Capacity fields cover concurrent users/Agents/Executions, task/collaboration/ingestion workload, response/error requirements, headroom/growth. Recovery fields cover acceptable data loss/duration, backup frequency/retention, restore cadence, key custody, session/effect policy and disaster escalation.

| Comparison | Existing measurement | Approval / gap |
| --- | --- | --- |
| API/task/native/collaboration/ingestion | T14 finite bursts: Agent reads541.70/s at concurrency8; Task submissions117.43/s; native7.73 actual successes/s at concurrency1; single active slot rejects excess; exact workload/limits in T14 report | AWAITING APPROVAL for expected users/rates/p95/errors/headroom/growth; not PASS |
| DB/resource/frontend | Pool3 with bounded waiting/recovery, Node RSS223.04MiB peak; limited PG1CPU/512MiB; four visible bound NPCs, up to20 projections; finite headless34–38FPS | AWAITING APPROVAL / sustained production capacity NOT MEASURED |
| Recovery point | Snapshot5750ms old at synthetic source loss; one known later marker absent | AWAITING APPROVAL; not an approved maximum data-loss objective or zero-loss claim |
| Recovery duration |1935ms to isolated read API after deleting synthetic source DB; same PG server survives | AWAITING APPROVAL; actual hosting/key/off-host/browser/native cutover NOT MEASURED |
| Coverage/alerting | Local mechanisms and fixture delivery verified | AWAITING APPROVAL for named coverage, real test-channel delivery and acknowledgement |

No proposed daily schedule/retention or local measurement is silently promoted to an approved RPO/RTO/SLA. Unknown expectations stay unknown. A contradiction with a later approved value must be FAIL, a missing measurement NOT MEASURED, and an absent decision AWAITING APPROVAL—never PASS.


## Executed verification and retained limitations

The actual local A/B/A fixture passed twice. The final complete JSON confirms immutable base config IDs, exact selected container identities, private API/web/edge readiness, authenticated TLS smoke, unchanged schema and one durable successful Execution at each transition. Final independent read-only checks after restarting local Docker Desktop confirmed zero rehearsal-labelled containers and zero metadata-variant images; existing user resources were not removed. Its numeric process exit was lost across the usage-limit interruption; the earlier complete run returned exit 0. A PASS result in JSON is not substituted for an unrecorded shell exit code.

Backend checks passed with 383 tests; frontend repeat passed with 238; encrypted backup/restore tests passed with 16; monitor/observability tests passed with 21; final scanner/rollback/release/readiness contract tests passed with 19. Both backend and frontend production builds passed. Compose and three workflow grammar/policy checks passed with offline fixtures. The offline production-readiness CLI deliberately returned exit 2 and BLOCKED.

Two initial failures remain in the evidence: the city simulation handoff/error-retry test failed once (237/238), then the full repeat passed without city edits; its cause is unverified. Backup integration setup initially lost a TCP connection during CREATE DATABASE (11 unit tests passed, five integration setup failures), then passed unchanged on retry and passed again after the TCP readiness correction. No flaky observation is silently converted into a claim that all attempts passed.

Git status/remotes/branch/SHA returned 128 and diff-check returned 129 because .git is absent. The SHA256 baseline and touched-file whitespace/link checks provide limited preservation evidence; they do not prove Git cleanliness, staged state or committed source identity. See exact commands, return codes and local raw-log references in the closure JSON.

## Configure decisions yourself (current continuation)

The user elected to supply decisions through configuration rather than chat. Use the existing [production prerequisites example](../../../docker/production-prerequisites.example.json), now version 2. No real values or approvals were supplied during this continuation. This remains an administrative worksheet, separate from backend environment configuration, monitor SMTP configuration and T12 release policy. No application or workflow automatically loads it. Keep production promotion closed.

Copy it outside the checkout, edit the copy, and run the offline checker. These PowerShell commands are operator instructions; they have not been executed against your private configuration:

```powershell
$taskPrivateRoot = Join-Path $env:USERPROFILE '.elyqreth-operator'
$taskDecisionFile = Join-Path $taskPrivateRoot 'production-prerequisites.private.json'
New-Item -ItemType Directory -Path $taskPrivateRoot -Force | Out-Null
if (Test-Path -LiteralPath $taskDecisionFile) { throw 'Existing decision file preserved; edit it instead of copying again.' }
Copy-Item -LiteralPath docker/production-prerequisites.example.json -Destination $taskDecisionFile
notepad $taskDecisionFile
node scripts/production-decisions.mjs --config $taskDecisionFile --output (Join-Path $env:TEMP ('elyqreth-decisions-' + [guid]::NewGuid().ToString('N')))
```

Restrict private directory/file ACLs to the responsible operator and administrators before entering personal references. The checker uses no credentials, makes no network/Docker calls, starts no process other than Node itself, and never prints input values. It reads only the explicitly selected JSON files, never dereferences evidence references, and writes a fresh report outside the checkout. Reports contain fixed schema paths/error codes, not raw keys, values, contact details, URLs or credentials. Do not put passwords, tokens, private keys, actual contact addresses or secret contents in this worksheet. Use private reference identifiers instead. It is not a secret scanner, proof of Windows ACLs, or an approval system.

### What to fill in

| Section | Configuration contract / required owner decision |
| --- | --- |
| `source` | T12 currently supports GitHub Actions: `repository` is owner/repository, `repositoryUrl` the matching HTTPS GitHub URL, `defaultBranch` the reviewed branch, and `sourceCommit` an actual 40-character lowercase SHA. Supply branch-protection and owner-approval evidence references. Do not invent a commit for this export without .git |
| `registry` | Select an approved HTTPS origin with no trailing slash/path/credentials, and an imagePrefix of host/namespace (no scheme/tag/digest). Supply visibility (`private`, `internal`, `public`), retained-digest evidence, separate push/pull identity references and approval. No registry is selected by this template |
| `candidate` | Actual local manifest reference and its canonical SHA256, plus actual `sha256:` API/web/edge manifest digests, producer and staging references. Not Docker config IDs; migration uses API; there is no separate worker |
| `target` | Environment identity, hosting, runtime, topology/private database/network, DNS/TLS, storage, secret-injection, backup/monitoring and approved `local` or `oidc` authentication profile. No broker/cache/worker is required by the current topology; adding one needs separate architecture review |
| `transport` | Reviewed `ci-controlled`, `ssh`, `deployment-agent` or `other-reviewed` method; matching registry origin and target ID. Require digest pinning, host/agent identity verification, restricted short-lived credentials, audit/approval/concurrency/rollback policies. SSH, if selected later, must verify host keys; no transport is selected or implemented automatically |
| `roles` | Eight existing assignments, with principal/team reference, private contact reference, assignment evidence, backup principal and escalation procedure. `backupKeyCustodian` includes both backup custody and key-recovery responsibility; an approved team/procedure can name separate custodians privately. Role labels alone do not establish accepted assignments |
| `monitoring` | Sender/transport policy, authorized test channel, delivery authorization, provider/inbox receipt, recipient acknowledgement and alert-policy references. SMTP credentials belong only in the existing protected monitor configuration; never here |
| `capacity` | Approved numeric users/Agents/Executions/rates/error ratio (0..1), and reviewed collaboration/latency/headroom/growth references. Leave unknowns null. No target is inferred from T14 measurements |
| `recovery` | Approved loss/duration objectives, backup schedule/retention/restore cadence, off-host storage, independent key escrow, restored-session/effect reconciliation, escalation and actual restore evidence. Host-loss survival assertions must be true but still require independent evidence |
| `authorization` | Exact candidate manifest hash, target, operation `promote`, protected mechanism, window, rollback authority and authenticated approval reference. These remain claims until verified through the approved mechanism; populating them never authorizes this tool to act |

Numbers must be JSON numbers, booleans JSON true/false, and unknown decisions null. Rates/latencies are not silently converted between units. Version-1 private copies, if any, should be migrated by copying their reviewed non-secret values into the version-2 template; preserve the old copy. No automatic migration, production secret discovery or fallback is performed.

The checker rejects unknown fields/types, mutable or malformed digests, credentialed/non-HTTPS origins, repository/registry/target/manifest contradictions and false host-loss/digest-pinning assertions. All-null input returns exit 2 with INCOMPLETE; structurally complete input also returns exit 2 with COMPLETE_UNAUTHENTICATED_WORKSHEET. Invalid/conflicting input returns exit 1. **There is no exit-0 promotion approval.** A complete worksheet still reports NOT READY, AWAITING PRODUCTION AUTHORIZATION and CLOSED. Missing values are not approved by default.

Optionally check a real local candidate manifest against the worksheet without registry access:

```powershell
node scripts/production-decisions.mjs --config $taskDecisionFile --manifest C:\protected\candidate\release.json --output (Join-Path $env:TEMP ('elyqreth-manifest-review-' + [guid]::NewGuid().ToString('N')))
```

This reuses T12's manifest validator and compares canonical hash, source, component digests, image namespace and migration metadata. It does **not** read referenced archives, verify publisher identity/signatures, query a registry, validate staging receipts or prove approvals. When actual OCI archives exist, the separate existing offline `node scripts/release.mjs verify --bundle <local bundle> --expected-sha <trusted canonical hash>` checks their bytes; its tests use explicitly synthetic fixtures. Do not run `producer` or other remote operations under this continuation.

### Authorized external verification, after configuration

Email: the monitoring owner must approve sender, test recipient and isolated target, prepare the existing protected monitor config, run its offline `check`, then separately authorize a real isolated failure/clear notification. Record provider acceptance, inbox delivery, recipient acknowledgement, notice ID/time and any uncertainty. A local SMTPS test proves none of those external milestones. Exact supported commands and failure handling are in [email monitoring](email-monitoring.md); no real email was sent here.

Recovery: the recovery/key owners must approve an off-host destination and independent escrow, record host-loss independence and permissions, then authorize an isolated encrypted-copy verification/restore exercise with synthetic data. Record archive validation, actual restore, schema/relationship checks and read recovery separately. Same-host mirror files or key-file presence do not prove host-loss recovery. Use [T08 contracts](backup-recovery.md) and the key-recovery runbook above; do not select a provider, export keys, upload real data, or restore a shared target here.

The canonical blocker register remains the closure JSON, with a dated `decisionReview` supplement mapping B01-B11 to existing blockers. Previous scan/rollback reports and T13/T14 evidence are retained, not rerun or upgraded to candidate-specific verification. No contradictory approved infrastructure decisions can be established yet because no actual configured values/approval evidence were supplied.

## Approval package and stop condition

The closure JSON packages the original T15/T14 blockers, actual scan/rollback/test evidence, exact canonical release identity fields (still null), custody/monitoring gaps, capacity/recovery observations, external decision checklist and explicit dispositions. The existing readiness assessor remains closed and does not consume the private template as authorization. T14 historical findings remain intact; local new evidence supplements them without rewriting their dates or claiming full closure.

**NOT READY / AWAITING PRODUCTION AUTHORIZATION / PARTIAL.** Publication and production promotion remain NOT STARTED. Required next actions are owner-approved canonical source/registry/target/protected mechanism/people/policies, then exact candidate production-like staging/scanning/rollback/restore/alert evidence and separate authorization. No T16 acceptance or automatic production task begins here.
