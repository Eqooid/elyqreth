# T12 Immutable artifacts and controlled promotion

2026-11-06, Asia/Bangkok. **PARTIAL:** local artifact contracts, fail-closed candidate preparation, workflow validation, fixture promotion/rollback plans and regressions are implemented. The user explicitly chose **undecided; keep publication and deployment closed**. No canonical Git checkout, approved registry/tool images, reviewer roster or target infrastructure was supplied. No image was pushed, GitHub workflow dispatched, release published or environment deployed. T13 now adds an [isolated local rehearsal](staging-uat.md); this does not satisfy the missing release deployment/provenance gates. [Executed evidence](verification-evidence/immutable-promotion-verification.json).

## Repository audit and requirement status

Git metadata is absent from this supplied workspace. Git status/diff cannot identify staged/untracked changes; a 5310-file pre-change SHA256 snapshot protects existing work instead. No applicable AGENTS.md exists. Existing GitHub Actions verified Phase1-5 on hosted Ubuntu with read-only permissions, but used moving action tags and lacked Phase6 role/restore/container gates. Existing pinned multi-stage Docker targets, lockfile installation, T02-T11 access/secrets/private probes/migration/recovery contracts are preserved. There is no worker image, broker, cache, registry configuration, release manifest or deployment transport. `dist/` is maintained Canvas city source, not replaceable build output. The frontend is static JavaScript/Vite verification, **not Next.js**; runtime public configuration already supports environment promotion.

COMPLETE below describes local supported contracts, not hosted execution or production approval.

| Requirement | Recovered state | T12 result |
| --- | --- | --- |
| Existing CI/platform and artifact inventory | PARTIAL | COMPLETE: extend existing GitHub Actions, three images and one migration identity |
| Reproducible build inputs | PARTIAL | COMPLETE locally: pinned bases/Node/lockfile; canonical committed Git archive for candidate context, no ignored/untracked host inputs |
| Actual canonical revision | BLOCKED | BLOCKED: no .git; candidate preflight refuses fabricated provenance |
| Digest-based release manifest | MISSING | COMPLETE: strict canonical JSON, immutable bundle and expected SHA verification |
| OCI content/provenance/SBOM inspection | MISSING | COMPLETE fixture contract: streamed graph hashes, bound SPDX/SLSA presence, runtime user/ports/source labels; no signature verification claimed |
| Candidate build workflow | MISSING | PARTIAL: manual/default-branch gated implementation; real GitHub/OCI generator/scanner run not executed |
| Registry publication | MISSING | BLOCKED by user decision: no login/push command, write token, mutable tag promotion or registry provisioning |
| Quality/security gates | PARTIAL | COMPLETE local commands; hosted combined workflow NOT RUN; scanner/SBOM images require approved digest configuration |
| CI permissions, triggers and concurrency | PARTIAL | COMPLETE source/grammar contract; actual repository protection/reviewer/queue behavior NOT VERIFIED |
| Frontend promotion | COMPLETE | PRESERVED: same web image exercised with disabled/local runtime configuration; static assets/session/city unchanged |
| Staging/production approval and plan | MISSING | COMPLETE fixture plan validation; BLOCKED for real deployment: no target/execution adapter/verified approvers |
| Migration/backup/drain/smoke safety | PARTIAL | COMPLETE plan/failure contracts and existing local runtime/role/recovery fixtures; real target evidence unavailable |
| Rollback | MISSING | COMPLETE conservative exact-migration-inventory fixture contract; actual rollback NOT RUN |
| Release audit/runbooks | MISSING | COMPLETE local records/runbooks; hosted provenance, registry retention and deployment receipts remain gates |

## Release unit and immutable identity

| Artifact | Identity / ownership |
| --- | --- |
| API | `api` Docker target; native Runtime Coordinator, collaboration, authentication and external observation remain inside the existing application |
| Migration | Exactly the same API digest with the existing `node docker/api-start.cjs migrate` command, separate T07 credentials; no duplicate image |
| Web | `web` target: complete maintained dist tree, static nginx, strict mounted public mode; no Node SSR or embedded environment API endpoint |
| Edge | `edge` target: nginx routing/TLS policy. Certificates remain runtime secret references |
| Host maintenance/release tools | Hash-listed scripts and non-secret Compose files in the bundle; host tools still require their documented matching Node/dependency context and operator authority |
| PostgreSQL / secrets / external runtimes | Independent environment dependencies; never copied into the release bundle or managed by promotion plans |

API, web and edge belong to one manifest and must be promoted together. The manifest stores source repository/40-hex commit/ref, stable `rc-commit-run-attempt` identity, build workflow/run/attempt/time, all three **registry-qualified digest references**, archive checksums, exact migration-image identity, source/configuration file hashes and quality-run reference. The registry prefix must be explicitly approved; example.invalid appears only in fixture/example policy. There is no latest-tag deployment identity.

`release.json` is canonical sorted JSON and written once with exclusive creation. `release.sha256` helps transfer checking; it is **not authenticity evidence** when copied beside the file. Supply the expected SHA from the trusted candidate run, then verify all content. Promotion consumes that unchanged manifest; it never rebuilds or resolves mutable tags. Candidate attempts have distinct IDs/artifact names, overwrite is disabled, and existing bundle directories are rejected. Real registry immutability/retention is still unconfigured; no claim is made that an unselected registry prevents tag races or garbage collection.

The OCI reader streams at most2GiB/archive,4096 files,256 layers/manifest, and captures JSON blobs at most2MiB. It validates USTAR checksums, referenced SHA256 content/size, index/root identity, Linux amd64 runtime config, expected non-root user/ports, source/revision labels and bound SPDX/SLSA statement subjects. Web/edge metadata includes inherited nginx EXPOSE80; the existing T06 listener/Compose checks remain authoritative for actual exposure. Unknown extra ports are rejected. It never extracts paths; links, traversal, duplicate/unreferenced blobs, missing content, truncated data and unsupported TAR extensions fail closed. Other architectures, oversized archives and PAX/GNU variants need explicit compatibility verification. Native OCI export with the selected BuildKit/SBOM tool has **not** run here; fixtures exercise this narrow contract. A Docker image-config ID is not a registry manifest/index digest and cannot substitute for it.

Attestations are content-bound **metadata**, not signed provenance verification. Source labels and manifests are not cryptographic proof of authorship. Producer checks use GitHub's authenticated read API for the exact successful manual workflow run/attempt, repository, default branch and commit. Required source/reviewer protections and trusted artifact retrieval remain essential. No signing key, Cosign, federation or verified GitHub attestation deployment is claimed. See [Docker attestation guidance](https://docs.docker.com/build/ci/github-actions/attestations/) and [OCI export semantics](https://docs.docker.com/build/exporters/oci-docker/).

## CI and candidate preparation

The existing `verify.yml` remains push/PR/manual verification and is now reusable. It retains prior regressions, adds production npm audit, actual restricted-role and backup tests, YAML/policy checking and hardened API/web/edge container verification. Production high/critical npm findings block. Candidate image scanning requires an explicitly pinned administrator-approved Trivy-compatible image; high/critical vulnerability or secret findings block, including unfixed findings. No ignore list or suppression is introduced. Lower findings are report-only. Repository source secret scanning, signed artifact policy, Dockerfile lint tooling and size baselines are not claimed as implemented. Container non-root/port/filesystem/image-history checks remain the existing local harness.

Actions are pinned to full commit SHAs resolved from their official repositories on 2026-11-06: checkout v4, setup-node v4, upload-artifact v7, download-artifact v8 and setup-buildx v3. This is a pinning decision, not a claim of perpetual security. Review/update those commits and scanner/DB/tool images through normal source review. YAML grammar validation uses PyYAML6.0.2 in an isolated temporary verification environment; no application dependency changed. Static/grammar tests are not a hosted GitHub execution or an actionlint result.

Candidate workflow is **workflow_dispatch only**, default branch only, requires successful reusable verification and `ELYQRETH_CANDIDATE_ENABLED=true`. Default/unset is closed. It gets contents:read only, no deployment/registry/provider credentials, no PR secret inheritance and no pull_request_target. Hosted Ubuntu is used, not an untrusted persistent deployment runner. Required repository variables, all currently unconfigured:

| Variable | Required contract |
| --- | --- |
| ELYQRETH_CANDIDATE_ENABLED | Explicit approved activation of candidate preparation only |
| ELYQRETH_IMAGE_PREFIX | Approved registry/repository prefix, no credentials; creation reserves references but does not publish |
| ELYQRETH_SBOM_GENERATOR | Approved BuildKit-compatible generator image@sha256:digest |
| ELYQRETH_SCANNER_IMAGE | Approved Trivy-compatible scanner image@sha256:digest |
| ELYQRETH_BUILDKIT_IMAGE | Approved BuildKit image@sha256:digest |
| ELYQRETH_BUILDX_VERSION | Approved exact vX.Y.Z version |
| ELYQRETH_DOCKERFILE_FRONTEND_IMAGE | Approved Dockerfile syntax frontend image@sha256:digest, overriding the development syntax tag for release builds |
| ELYQRETH_PLAN_ENABLED | Explicit approval to run artifact review only; never deployment activation |

Preflight requires an actual clean canonical checkout, exact GITHUB_SHA, expected HTTPS GitHub remote, manual default-branch event and validated tool references. It creates no bundle if those fail. Git archive supplies only committed context to all three OCI builds, so ignored local files cannot affect candidates. The approved pinned Dockerfile frontend is passed through [BUILDKIT_SYNTAX](https://docs.docker.com/build/buildkit/frontend/); this preserves the existing development Dockerfile directive without using its moving tag for releases. Manifest build inputs record every tool pin. Each release target is built **once** with min provenance and a pinned SBOM generator; scans inspect those same archives. Earlier disposable quality-test images are not release artifacts. No bit-for-bit reproducibility claim is made: base/lock/tool inputs are controlled, but build timestamps, external package/scanner databases and hosted infrastructure still matter.

Successful bundles upload under a unique run/attempt artifact name, with required hidden non-secret files such as .dockerignore included. The source-context tar is removed before upload. Seven-day CI retention matches existing temporary verification artifacts; it is **not** an approved production rollback/retention policy. Failed candidate bundles are not published as successful artifacts. No registry login/push/release step exists. Future publication requires selecting the registry, credentials/federation, immutable naming/retention, provenance verification and a separately reviewed protected publisher; it must copy these exact OCI digests without rebuilding. No publication operation is authorized by this task.

## Promotion, evidence and safe ordering

The manual `promotion-plan.yml` is also default-branch gated and disabled unless explicitly enabled. It uses contents/actions read only, serialized environment review (`cancel-in-progress:false`), structured artifact inputs and safe environment variables rather than interpolating user input into shell source. It downloads the selected candidate, verifies integrity and producer metadata, and reports that deployment is closed. It does **not** deploy or claim to generate a complete target-specific operational plan without the private evidence inputs.

Before enabling any review workflow, administrators must configure actual staging/production environments, required reviewers, prevent self-review, default-branch restrictions, protected workflow/release code, allowed actions, artifact retention and environment access. Merely naming a GitHub environment in YAML does not create a protected approval policy. Check repository plan support for these controls; no settings were changed here. See [GitHub environment protection](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments) and [least-privilege workflow guidance](https://docs.github.com/en/actions/reference/security/secure-use).

The local `plan` command validates policy, exact target and manifest approval record, approved registry prefix, recovery receipts, migration inventory and staged identities. Policy must explicitly keep publication/deployment false. Operator JSON is **evidence input, not authentication**. The tool has no apply, publish, SSH, restore or database execution command. Its test-only simulator never claims an actual deployment. Real production planning also checks the candidate producer via GitHub; a fixture cannot masquerade as a live candidate. Actual platform approvals and receipt provenance/freshness must be verified by the operator; a hand-written APPROVED string is not production authority.

The plan orders: verify release/approval/target; verify recovery; pull/check exact digests; migration preflight; pause local observation commands; native-only drain; inspect zero active work/uncertainty; stop API with45s grace; locked migration using the same API digest and separate migration role; replace API without build; private readiness; paired web/edge replacement; read-only authorized/TLS/city smoke; record outcome. Native admission/leases remain T09-owned. External orchestrators keep running under their own authority; no external cancel/dispatch is invented. Single-writer maintenance replacement can have downtime; no blue/green, automatic resume or zero-downtime claim.

`schema.migrationInventorySha256` hashes release SQL/meta file names and bytes. It is **not** a database-query digest or proof of applied schema. The request must bind the expected target inventory; actual T07 preflight still checks applied hashes, identity/role and pending migrations before any SQL. The test simulator stops on failed recovery, missing digest, migration or readiness. Real execution must repeat those gates against the actual environment and preserve failed outcomes; no execution adapter exists yet.

T08 backup creation alone cannot satisfy the gate: require ARTIFACT_VALIDATED and RESTORED_VERIFIED_QUARANTINED evidence for the explicit backup identity/target, approved freshness/key/off-host policy and no uncertain effects. No credentials/key files/raw backup records go into manifests. T11 real email/inbox delivery, responders, independent failure monitoring and operational policy remain unverified. `operationsReady=false` blocks production planning. No true flag or fixture result is presented as proof those operational requirements are met.

### Rollback limitation

The **selected bundle is the known-good rollback target**; --current supplies the currently deployed manifest being replaced. Approval and expected SHA bind the selected target, not the current/new release. Current and target must have exactly matching migration inventories. This is conservative: the existing API readiness requires exact Drizzle history, so SQL-compatible expand-only DDL alone does not establish older-image readiness. A changed inventory requires a reviewed compatible forward fix or separately demonstrated compatibility policy; no override/down migration exists. Application artifact rollback, configuration rollback and database recovery are different procedures. Never restore a DB or replay uncertain effects to make an image rollback appear successful.

## Commands and operational runbooks

Paths below are placeholders for reviewed non-secret candidate/policy/evidence files. Use the same Node commands in PowerShell with Windows absolute paths. Do not put credentials in argv. All shown release commands are read/build/plan-only, never deployment.

```sh
# Real canonical CI context only; missing .git/source/tool decisions fails closed here.
node scripts/release.mjs preflight
node scripts/release.mjs build --bundle /new-private-candidate-directory
# Expected SHA comes from the trusted candidate run, not an arbitrary replacement sidecar.
node scripts/release.mjs verify --bundle /approved/candidate --expected-sha <trusted-64-hex>
node scripts/release.mjs producer --bundle /approved/candidate --expected-sha <trusted-64-hex>
node scripts/release.mjs plan --bundle /approved/candidate --expected-sha <trusted-64-hex> --policy /private/policy.json --request /private/review.json
# Rollback selects the old known-good bundle and binds the current manifest separately.
node scripts/release.mjs plan --bundle /approved/known-good --expected-sha <known-good-64-hex> --policy /private/policy.json --request /private/rollback-review.json --current /private/current-release.json
node --test apps/api/test/release-pipeline.test.cjs
```

Policy shape is in [the closed example](../../../docker/release-policy.example.json). Request fields are strict: simulation boolean (true only for fixture manifests); staging/production environment; promote/rollback action; approved targetId; exact manifestSha256; approval {status:APPROVED, reviewer, manifestSha256, environment, targetId, approvedAt}; backup {id, artifactStatus, restoreStatus, verifiedAt, targetId}; migrationInventorySha256; staging:null for staging or an exact successful staged receipt for production; currentManifestSha256:null for promotion or the current manifest hash for rollback. Production also requires operationsReady and a matching target-specific staged image tuple. Unknown/extra fields fail. A simulated receipt is accepted only in explicit fixture simulation, never as DEPLOYED evidence.

| Runbook | Preconditions / exact supported action | Expected result, failure and escalation |
| --- | --- | --- |
| 1 Candidate creation | Approved canonical CI/default branch/tool pins; manual candidate workflow or preflight/build above | BUILT_NOT_PUBLISHED only after quality and scans; stop on missing provenance/dirty input, review immutable source |
| 2 Publication | Registry/identity/retention undecided; no publisher exists | Keep closed; do not improvise docker push or rebuild; require separate approved publisher implementation |
| 3 Digest verification | Trusted manifest SHA and existing bundle; verify above | Full graph/archive/config hashes and runtime/source checks; reject missing/substituted content |
| 4 Manifest inspection | Read canonical release.json and producer-check above | Compare source/run/attempt, API/web/edge and migration identity; no sidecar-only authentication |
| 5 Staging preparation | Explicit isolated target/approval/recovery inputs; plan above with environment staging | Plan only, not deployed; no staging resource provision without authorization |
| 6 Staging smoke | Real deployment transport/target absent | NOT RUN; require private readiness, authenticated me/Agent reads, TLS/static assets/session cleanup; mutations only under synthetic-owner approval |
| 7 Production approval | Named protected-environment reviewers and exact staged manifest | Block if T11/operations or staged/backup/schema gates incomplete; reviewer JSON alone is insufficient authority |
| 8 Production deployment | No production transport/credentials, explicit prohibition | NOT RUN; do not infer approval from a passing plan or deploy from every push |
| 9 Migration failure | Dedicated role and known target; existing T07 preflight command below | Stop progression, inspect journal safely, no metadata edits/unsafe automatic retry or down migration |
| 10 Backup gate failure | Existing T08 protected request/key and isolated restore receipts | Stop; preserve last verified point and use [backup runbooks](backup-recovery.md); never bypass or restore automatically |
| 11 Drain timeout | Existing native private snapshot and maintenance authority | Stop for durable uncertainty review per [T09](runtime-drain.md), no lease reset, fabricated success or duplicate work |
| 12 Failed plan/promotion | Preserve source/manifest/target/run and failed step | No partial release success; simulator outcome is explicitly SIMULATION. Actual deployment failure requires target-specific reconciliation |
| 13 Application rollback | Known-good exact bundle, current manifest, schema/approval match | Rollback plan above; no rebuild, automatic DDL rollback or DB restore |
| 14 Configuration rollback | Reviewed prior private config references, compatible same image tuple | Operator-only change after approval; validate T02/T05 input and readiness; never include secrets in release records |
| 15 Audit investigation | Private read access to workflow logs/bundle/approvals | Preserve manifest SHA, source/run/attempt, selected/current digests, target, approver/time, migration/readiness/smoke outcomes. No invented audit database |

Existing migration preflight remains:

```sh
docker compose -f docker-compose.production.yml --profile maintenance run --rm migrate node docker/api-start.cjs preflight
```

This requires the existing operator-reviewed environment, exact API_IMAGE digest and separate migration secret. It is **not executed on a production database here**. Actual apply/drain/smoke/backup commands remain in [T07](database-migrations.md), [T08](backup-recovery.md), [T09](runtime-drain.md), [T06](edge-network.md) and [T11](observability.md). No deployment command is invented for an unspecified host.

## Acceptance and next task

Local tests validate digest/manifest/OCI parsing, tampering and source labels, default-branch/PR/approval/target isolation, staged identity consistency, backup/migration failure stops, conservative rollback, missing provenance and safe CLI rejection. Workflow syntax/policy and existing application/image regressions are recorded in the evidence file. Fixtures are synthetic and never pushed. The whole hosted CI run, native BuildKit SBOM/scanner export, signed provenance, registry availability/immutability, protected-environment enforcement, real staging/promotion/rollback and production smoke remain NOT RUN or BLOCKED. T12 is therefore PARTIAL, not a released/deployed pipeline.

T13 now adds the user-authorized [isolated local UAT rehearsal](staging-uat.md). It does not open registry publication/deployment or satisfy the missing real release/rollback evidence. The next roadmap task is T14; outstanding T11/T12/T13 release gates remain explicit.
