# T14 Security, capacity and disaster-recovery verification

Review: 2026-11-06, Asia/Bangkok. **PARTIAL; release NOT READY.** This is an isolated local verification exercise, not a production certification, capacity guarantee or authorization to deploy. [Current measurements, outcomes, commands and findings](verification-evidence/security-capacity-recovery-verification.json) are the evidence source; [T13 evidence](verification-evidence/staging-uat-verification.json) is retained as historical context.

## Repository and evidence audit

No applicable AGENTS.md or Git metadata exists in this supplied workspace. Status/staged/diff checks cannot establish tracked changes; a pre-change SHA256 inventory of 5325 existing files preserves prior work. T13 executed 371 backend, 238 frontend, 232 PostgreSQL, 45 role/migration and 16 backup checks, plus actual TLS/browser/drain probes. That is evidence for its recorded local scope, not proof of current code or production deployment. T14 reruns the supported suites rather than relabelling the old result.

The actual architecture remains one API/native Runtime Coordinator, static web, one HTTPS edge and private PostgreSQL. No separate worker, broker, Redis, public signed webhook, external dispatch capability or standing staging/production deployment exists. Authentication remains private, single-owner operator access, selected local or OIDC per installation; public multitenant enrollment is unsupported. Native collaborations permit exactly two participants and one child delegation under the current API policy. External observations remain connection-scoped and never acquire native execution ownership.

T01 D06/D09/D10 have no approved RPO/RTO, availability, latency, throughput or budget targets. T11 incident owners and actual email delivery, T12 canonical release/registry/protected promotion, and T13 actual release/rollback/manual UAT remain gates. T10 production external activation stays closed by the user's explicit decision.

## Safety envelope and repeatable verification

```powershell
node scripts/security-capacity.mjs --output "$env:TEMP\elyqreth-t14-new-run"
```

Use an existing Node24/npm installation, lockfile-installed dependencies, local Docker Desktop/Linux engine, Chromium, OpenSSL and the existing prebuilt API/web/edge verification images described in [T13](staging-uat.md). The output directory must be new and outside the checkout. No user-supplied application URL, database target, remote Docker context, deployment command or cleanup selector is accepted. Credentials/live-provider flags/preloads are stripped using T13's existing environment contract; the npm CLI is derived from the local Node installation. The standard local Docker socket is explicitly selected. Evidence and generated scratch data stay outside the checkout.

A zero runner exit means supported local test commands completed; the report still says PARTIAL/NOT READY and never authorizes promotion. A nonzero dependency audit remains a separately recorded finding or infrastructure failure. The fixed runner reuses T13 first. On failure it stops before load/destructive scenarios. It then invokes opt-in capacity and source-loss tests within the **existing disposable database harnesses**, frontend fixture profiling and a read-only production-dependency audit. The load test verifies its exact Docker run label/name before applying test-only PostgreSQL limits: 1 CPU, 512 MiB memory, 128 PIDs. Its API uses a separately provisioned runtime role, dedicated migration step, pool maximum three and loopback HTTP. Bootstrap/migration credentials are never used by the measured API.

Load increases from concurrency one to four/eight, with at most64 operations per stage, at most8 admitted generator operations, a20-second stage safety deadline and a768-MiB Node RSS stop threshold. Unexpected status, transport failure, RSS/deadline violation or incomplete workload fails the stage; already admitted operations settle before cleanup. HTTP calls have five-second abort deadlines. These are conservative **test safety limits**, not approved service objectives. Database saturation is a controlled200-ms hold of the three API pool connections, followed by read/recovery checks; it is not an uncontrolled memory/CPU exhaustion test.

Database tests create random database/container names and credentials. Cleanup verifies exact names and ownership labels before removing resources; no global prune, wildcard volume deletion or shared database reset is used. The source-loss test additionally checks its own labelled container and generated `elyqreth_test_<24hex>` name before dropping **only that synthetic source database**. Backups and a separately provisioned recovery target survive that drop. A failed DROP is not retried with FORCE. Existing user/production databases cannot be supplied as targets.

API capacity is measured on the host test process, not in the production API image. API and generator share that process, so CPU/heap figures include both. The security/container suite separately uses locked prebuilt Docker config IDs. Neither is registry provenance or source-to-image binding. No application image is rebuilt during rehearsal. Container vulnerability scanning and actual hosted supply-chain acceptance are separately classified; no unapproved scanner image or monitoring service is installed.

## Verification matrix

Common preconditions **P**: dependencies installed; local Docker verified; random, owned synthetic resources; no production credentials/target. Evidence **E**: exact command/exit code, source snapshot, artifact IDs, test counts and safe structured observations in the JSON report. Cleanup **C**: owning harness finally-blocks validate labels/names, close apps/pools and remove only owned resources; retain the new report directory. Manual/infrastructure rows never inherit PASS from automated fixtures.

| ID | Requirement / component | Method and procedure | Expected / evidence | Failure severity / cleanup |
| --- | --- | --- | --- | --- |
| SEC-01 | Authentication/session | P; actual Nest/PG/HTTPS browser login, expiry, revocation, logout/restart; signed OIDC fixtures | Unauthorized credentials rejected; no stale privileged state; E | HIGH / C |
| SEC-02 | Owner/object isolation | P; foreign IDs/headers, viewer mutation, Task/Execution/delegation/external mappings and diagnostics | Server-derived scope, no foreign mutation/disclosure; E | CRITICAL / C |
| SEC-03 | API input/error limits | P; bounded malformed/extra/oversized bodies, cursor/page and login budget probes | Safe4xx, bounded work, no secret output; E | HIGH / C |
| SEC-04 | Containers/network/edge | P; locked-ID production-profile containers, TLS/header/CORS/private-port/readiness probes | Non-root/restricted runtime; only approved edge ingress; E | CRITICAL / C |
| SEC-05 | Provider egress | P; existing DNS/peer/redirect/TLS/byte/timeout fixtures | SSRF and invalid peers denied, bounded calls; no unrelated target contacted; E | CRITICAL / C |
| SEC-06 | Trusted inbox | P; authority/rotation/disabled-source, duplicates/order/cross-owner/replay tests | Durable dedupe and external authority; E | CRITICAL / C |
| SEC-07 | Dependency/workflow supply chain | Lockfile audit; installed scanner discovery; existing YAML/action/promotion integrity checks | Actual findings/version/DB recorded; missing scanner/provenance remains BLOCKED | HIGH / no publication |
| CAP-01 | Agent reads | P;32 authenticated reads each at concurrency1/4/8 | Count/status/throughput/p50/p95/max, RSS/CPU/pool samples; E | HIGH / C |
| CAP-02 | Task writes | P;16 synthetic submissions each at concurrency1/4/8 | Durable201 responses and bounded pool behavior; E | HIGH / C |
| CAP-03 | Native dispatch/polling | P;8 distinct dispatches each at concurrency1/2/4, then32 polls | Success or explicit CAPACITY_EXCEEDED only; one execution/Task, no remaining RUNNING; E | CRITICAL / C |
| CAP-04 | Collaboration | P;4 parents,2 participants/session, fanout1;4 simultaneous duplicate activations, then read bursts | One effective child each; exact durable relationships; E | CRITICAL / C |
| CAP-05 | Ingestion | P;16 unique service-level events each at concurrency1/4/8,16 identical replays | Connection-scoped inbox/state, one effective duplicate receipt; E | CRITICAL / C |
| CAP-06 | Pool saturation/recovery | P; hold exactly3 owned pool connections200ms,24 reads at concurrency8, recovery sweep | Waiting observed, bounded connection count, successful reads and zero remaining waiters; E | HIGH / release held clients, C |
| CAP-07 | Frontend/city | Local Chromium frame/heap/DOM profile plus existing selected-NPC owner/client fixture profile | Actual observations, cleanup/timer invariants; no FPS/SLA assertion invented | MEDIUM / close browser/server/profile |
| RES-01 | Process loss/drain/races | P; existing hard child-process crash, clean/deadline PID1 signals, admission/claim/cancel/recovery races | No false success/duplicate work; quarantine preserved; E | CRITICAL / C |
| RES-02 | DB/network/provider failure | P; owned DB stop/start, edge restart and provider timeout/replay fixtures | Readiness loss/recovery, liveness remains, external isolation; E | HIGH / restore owned dependency, C |
| DR-01 | Artifact/retention/integrity | P; encrypted logical backup, copy/checksum, corrupt/failure/retention/target tests | Bad artifacts rejected; no last-good/arbitrary deletion; E | CRITICAL / C |
| DR-02 | Actual synthetic source DB loss | P; backup, exact source DROP, new DB/roles, decrypt/restore, full runtime-table equality and read API | Source absent, new read service works, states preserved; E and timing boundaries | CRITICAL / C |
| DR-03 | RPO/RTO assessment | DR-02; record snapshot, loss confirmation and read-ready wall-clock boundaries | Measured data-loss exposure, not invented objectives or approval | HIGH / C |
| OPS-01 | Telemetry/runbooks | P; real DB/drain readiness logs and existing redaction/correlation/rejection/monitor fixtures | Categorized safe signals and valid commands; no claimed external alert | HIGH / C |
| GATE-01 | Real release/rollback | Approved candidate/previous tuple, protected target and reviewers required | BLOCKED until actual deployment evidence; synthetic gate tests only | HIGH / no deploy |
| GATE-02 | Operational DR/alerts | Off-host backup/key custody, approved objectives, restore-session invalidation, named responders and delivered alert | BLOCKED until independently exercised/approved | HIGH / keep access closed |

Cookie CSRF/session-fixation through ambient cookies, public signed webhooks, brokers/caches and dedicated workers are not implemented components; they are not marked tested. Bearer-session lifecycle, exact origins, trusted source authority and current in-process native ownership are tested instead. Public multitenancy, a live hosted OIDC issuer and a production LangGraph deployment are not accepted by this local exercise.

## Capacity methodology and interpretation

The generator performs finite **closed-loop bursts**, not a steady arrival-rate benchmark, soak or maximum sustainable concurrency determination. Latency uses nearest-rank percentiles of observed completed operations. Successful2xx throughput is recorded separately from total request throughput; native capacity rejections are not counted as successful executions. Samples with only one successful execution do not establish a reliable tail-latency distribution. Each stage includes actual counts/statuses and start/end times; failed exploratory runs are retained separately and are not a completed baseline.

Node CPU is process user+system CPU time divided by wall time, expressed as percent of one core; it can exceed100% and is not host utilization. RSS includes the API, generator and loaded tests. Pool counts/waiters are sampled every10ms and can miss shorter peaks. PostgreSQL Docker statistics are two short observations, not sampled maxima. Database size is the synthetic database's physical footprint, not a per-user storage forecast. The measured API role is restricted, but transport/authentication is the existing test-profile loopback bearer contract; TLS/account/container costs are covered functionally, not included in these throughput figures.

The native runtime intentionally has one active execution slot per API coordinator. Raising request concurrency chiefly measures rejection behavior; it does not authorize horizontal writers or prove execution scaling. Collaboration load stays within the approved two-participant/one-child model. Ingestion numbers measure trusted service calls plus actual PostgreSQL transactions, not an absent HTTP webhook or provider network. There is no broker/cache queue depth to measure. Pool waiting is reported as pool waiting, never renamed message backlog.

Headless Chromium measurements use finite synthetic projection activity on the existing Canvas renderer. CDP/rAF FPS, heap and DOM counts depend on the host, headless browser and background test load; they are not production interaction latency or a visual-diff acceptance. Node forced-GC client profiles are separately labelled fixtures, not browser memory measurements. No renderer or NPC code is changed.

## Selected measured observations

From the consolidated run in the JSON evidence; rounded figures below are short closed-loop bursts, not a sustainable-capacity claim. Host: Windows x64, Ryzen5 5600H,12 logical CPUs, approximately15.4GiB RAM; Docker reported12 CPUs and approximately7.46GiB memory. Host Node24.9.0/npm11.6.2; PostgreSQL was capped at1 CPU/512MiB and API pool3.

| Workload | Concurrency / samples | Observed throughput | p95 response latency |
| --- | --- | --- | --- |
| Agent reads |8 /32 |541.70 requests/s |19.09ms |
| Task submission |8 /16 |117.43 successful submissions/s |78.77ms |
| Native dispatch |1 /8 |7.73 successful executions/s |151.10ms |
| Native dispatch |4 /8 |7.61 successful executions/s;7 of8 requests rejected with CAPACITY_EXCEEDED |131.30ms across all8 responses; only1 success |
| Execution polling |8 /32 |495.42 reads/s |17.54ms |
| Collaboration snapshot |8 /32 |172.94 reads/s |52.58ms |
| Trusted service ingestion |8 /16 |36.12 calls/s |227.31ms |
| Controlled pool saturation |8 /24 |104.23 reads/s |214.12ms |

All23 timed stages completed, with408 timed operations. Four parent collaborations each retained exactly one effective child under duplicate activation bursts. Pool waiting reached8 in the controlled hold and returned to0; maximum pool connections remained3. Sampled Node RSS peaked at223.04MiB. Short-stage process CPU observations include API and generator and reached above100% of one core; they are not whole-host CPU utilization. Two PostgreSQL samples were53.79/69.2MiB and3.37/3.83% CPU; these are not peak database measurements.

The finite browser profile sampled approximately34.3?38.4FPS over120-frame windows with0/1/10/20 projections and at most4 existing bound NPCs. It ran alongside other verification work; differences between samples cannot be attributed solely to projection count. No approved FPS target exists.

The source-loss recovery drill reached authenticated read access in1935ms, restoring21 runtime tables from a155025-byte encrypted artifact. Snapshot age at confirmed source loss was5750ms; one known post-snapshot marker was absent, as expected. These observations are not approved RPO/RTO compliance or full-host recovery evidence.

## Disaster-recovery boundaries and runbook validation

DR-02 reuses T08's synthetic native/child/pending/interrupted/external/audit dataset and encrypted custom-format archive. It closes source clients, confirms source deletion, provisions a new target and restricted roles, restores and compares every runtime table against the exported snapshot, then starts the existing read API with native work disabled. A known row committed **after** export is absent after restore; one known lost marker is evidence of snapshot rollback, not proof that only one row could ever be lost.

`applicationReadReadyMs` is a continuous **local drill** interval from source-pool closure through source DROP, target/role provisioning, restore, equality checks, application startup and successful authenticated API read. It excludes incident detection, operator approval, off-host transfer/key recovery, DNS/cutover, browser validation and safe native re-admission. The PostgreSQL server survives; this is source **database** loss, not server/volume/host/region loss. `snapshotAgeAtLossMs` and `snapshotAgeAtReadReadyMs` are observed ages using server snapshot and host clock timestamps; clock synchronization uncertainty applies. Approved RPO/RTO are null, so no objective can be declared met. No PITR/scheduled/off-host durability guarantee is inferred.

Preserve T08's quarantine rules: restored leases do not prove effects can be replayed; terminal states remain terminal; external providers remain authoritative. Before any real cutover, keep access/ingress/native admission closed, independently verify backups and key custody, reconcile uncertain effects and apply an approved session/account invalidation procedure. Restored auth data can roll back revocation. This drill does not authorize exposing restored credentials or automatically resuming every running execution.

Runbook procedures exercised by code are linked to their existing owners: [migration/roles](database-migrations.md), [backup/corruption/retention/restore](backup-recovery.md), [drain/restart/uncertain native work](runtime-drain.md), [external outage/replay](external-connectivity.md), [safe diagnostics/incident classification](observability.md), [email-monitor fixtures](email-monitoring.md), and [plan-only promotion/rollback](immutable-promotion.md). Actual operator tabletop, off-host email delivery, full-host disaster recovery, browser access after this particular source-loss restore and deployment rollback remain separate evidence gaps. Do not bypass guards, delete lifecycle/audit records, force leases, disable authentication or rewrite migration history to resolve a test failure.

## Findings and release decision

The machine-readable report contains actual measurements and the finding register, including failed exploratory probe commands and their corrections. After measurement collection, a runner-only output-path check was tightened: a checkout child whose name begins with two dots must not be confused with a parent-directory traversal. Targeted regression tests cover both rejection and fresh external output acceptance. Measurement-source and final-source snapshots are recorded separately; application/runtime/renderer source did not change, and the application measurements are not relabelled as a rerun of the post-measurement wrapper. Initial setup omissions (migration grants, unsupported third participant and nonconforming restore target name) were rejected by existing guards and fixed in tests; no production security rule was relaxed. No application vulnerability is claimed closed merely because a test fixture was corrected.

Release remains **NOT READY** while mandatory artifact/target/rollback, supply-chain scan/provenance, operational backup/key/alert/responders, approved capacity/recovery targets and human acceptance gates remain unresolved. Supported local assertions and measurements can be VERIFIED without treating the whole production posture as verified. T14 remains PARTIAL when required infrastructure/manual evidence is absent. No T15 operation is performed.

Next roadmap task: **T15 Production Readiness & Authorized First Promotion**. It requires T14 gates, a named release approver and separate deployment authorization; this task does not provide that authorization.
