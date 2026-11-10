# Phase 6 handover evidence and acceptance matrices

2026-11-07, Asia/Bangkok. Handover preparation **COMPLETE**, production acceptance **NOT STARTED**, promotion **CLOSED — DEFERRED BY PROJECT OWNER**. See the [handover](operations-handover.md), [local startup](local-operations.md), and [exact machine-readable report](verification-evidence/handover-verification.json). T16 does not upgrade incomplete earlier tasks or satisfy its original deployed-acceptance gate.

## Task status matrix

The current column preserves T01-T15 authoritative scope/status. T16 COMPLETE refers only to the owner-authorized independent preparation; actual production acceptance remains NOT STARTED.

| Task | Previous | Current | Evidence | Outstanding requirements |
| --- | --- | --- | --- | --- |
| T01 | COMPLETE | COMPLETE | E01 | Actual production gates remain separate |
| T02 | PARTIAL | PARTIAL | E02 | Audience/hosting/operational objectives unresolved |
| T03 | COMPLETE | COMPLETE | E03 | Actual installation grants; public tenancy unsupported |
| T04 | COMPLETE | COMPLETE | E04 | Actual production authentication/TLS deployment; no PKCE/refresh |
| T05 | COMPLETE | COMPLETE | E05 | Actual host/secrets/permissions/registry |
| T06 | COMPLETE | COMPLETE | E06 | Actual DNS/TLS/firewall/private DB |
| T07 | COMPLETE | COMPLETE | E07 | Hosted DB access and migration approval |
| T08 | COMPLETE | COMPLETE | E08 | Off-host storage/independent key custody/schedule/objectives |
| T09 | COMPLETE | COMPLETE | E09 | Actual deployment coordination and uncertain-effect policy |
| T10 | COMPLETE | COMPLETE | E10 | Production LangGraph target/source-access policy; intentionally closed |
| T11 | PARTIAL | PARTIAL | E11 | Named operators, independent monitoring and external delivery/ack |
| T12 | PARTIAL | PARTIAL | E12 | Canonical commit/registry/artifacts/publisher/transport/approval |
| T13 | PARTIAL | PARTIAL | E13 | Exact registry release deployment and genuine previous-release rollback |
| T14 | PARTIAL | PARTIAL | E14 | Approved capacity/RPO/RTO, hosting-loss and external operational evidence |
| T15 | PARTIAL | PARTIAL | E15-CLOSURE | B01-B11 and explicit authorized promotion; owner defers configuration |
| T16 | PLANNED | COMPLETE (preparation only) | E16-FRESH | Production acceptance NOT STARTED; all deferred prerequisites remain |

## Evidence inventory

Historical reports were read and hashed, not regenerated. The checker preserves the recorded SHA256 values and accepts LF or CRLF line endings because Git converts the original Windows reports on Linux checkout; all other bytes remain checked. PARTIALLY VERIFIED here describes T16 review depth, not a downgrade of the original scoped task result: report integrity/content is checked, but historical heavy execution is not independently repeated. Source commit is unknown for all supplied-source evidence. Dates are copied only when recorded; null/unknown is not invented. See JSON for full SHA256, result fields, environment, revision and raw-log availability. E03-OLD is explicitly superseded by E03; older no-auth/development-only statements must be read in their phase/date context.

| ID / task | Evidence file | Recorded date | Classification | Scope and limitations |
| --- | --- | --- | --- | --- |
| E01 / T01 | [t01-verification.json](verification-evidence/t01-verification.json) | 2026-10-29 | DOCUMENTED_ONLY | Architecture/ADRs/roadmap only |
| E02 / T02 | [t02-verification.json](verification-evidence/t02-verification.json) | 2026-10-29 | PARTIALLY VERIFIED | Fail-closed configuration; audience/hosting/objectives unresolved |
| E03-OLD / T03 | [t03-verification.json](verification-evidence/t03-verification.json) | 2026-10-29 | SUPERSEDED | Initial issuer-only PARTIAL checkpoint; superseded by explicit local/OIDC scope |
| E03 / T03 | [dual-auth-verification.json](verification-evidence/dual-auth-verification.json) | 2026-10-30 | PARTIALLY VERIFIED | Private single-owner local/OIDC backend; not public signup or deployed identity |
| E04 / T04 | [frontend-access-verification.json](verification-evidence/frontend-access-verification.json) | 2026-10-30 | PARTIALLY VERIFIED | Memory-only bearer login/expiry/logout/polling, not cookie/PKCE/refresh |
| E05 / T05 | [container-hardening-verification.json](verification-evidence/container-hardening-verification.json) | 2026-11-05 | PARTIALLY VERIFIED | Non-root packaging/secret files/readiness; not hosting acceptance |
| E06 / T06 | [edge-network-verification.json](verification-evidence/edge-network-verification.json) | 2026-11-05 | PARTIALLY VERIFIED | Local TLS/private links/auth/polling/city, not actual DNS/firewall/cert operations |
| E07 / T07 | [database-role-verification.json](verification-evidence/database-role-verification.json) | 2026-11-05 | PARTIALLY VERIFIED | Restricted roles, explicit locked migrations/journal/grants; no live DB |
| E08 / T08 | [backup-recovery-verification.json](verification-evidence/backup-recovery-verification.json) | 2026-11-05 | PARTIALLY VERIFIED | Encrypted backup/isolated restore/corruption/retention; not independent escrow/offhost |
| E09 / T09 | [runtime-drain-verification.json](verification-evidence/runtime-drain-verification.json) | 2026-11-05 | PARTIALLY VERIFIED | Single-writer bounded admission/drain/fencing/recovery; not a fleet coordinator |
| E10 / T10 | [external-connectivity-verification.json](verification-evidence/external-connectivity-verification.json) | 2026-11-06 | PARTIALLY VERIFIED | Pinned TLS/destinations/credential/source/idempotency; production activation closed |
| E11 / T11 | [observability-verification.json](verification-evidence/observability-verification.json) | 2026-11-06 | PARTIALLY VERIFIED | Safe telemetry/internal diagnostics/runbooks; actual receiver/operators absent |
| E11-MAIL / T11 | [email-monitoring-verification.json](verification-evidence/email-monitoring-verification.json) | 2026-11-06 | PARTIALLY VERIFIED | Optional private SMTPS monitor; fixture delivery not real inbox acknowledgement |
| E12 / T12 | [immutable-promotion-verification.json](verification-evidence/immutable-promotion-verification.json) | 2026-11-06 | PARTIALLY VERIFIED | OCI/digest/source/producer/plan contracts; no published candidate/transport |
| E13 / T13 | [staging-uat-verification.json](verification-evidence/staging-uat-verification.json) | 2026-11-06 | PARTIALLY VERIFIED | Local UAT/content IDs only; not exact approved registry release/staging rollback |
| E14 / T14 | [security-capacity-recovery-verification.json](verification-evidence/security-capacity-recovery-verification.json) | 2026-11-06 | PARTIALLY VERIFIED | Finite capacity/source-database-loss read recovery; not approved SLA or whole-host DR |
| E15 / T15 | [production-readiness-verification.json](verification-evidence/production-readiness-verification.json) | 2026-11-07 | PARTIALLY VERIFIED | Offline blocking readiness/first-promotion preparation; production not started |
| E15-CLOSURE / T15 | [t15-blocker-closure-verification.json](verification-evidence/t15-blocker-closure-verification.json) | 2026-11-07 | PARTIALLY VERIFIED | Exact local scanner/A-B-A metadata replacement and configuration review; real candidate/people/target/objectives open |

E16-FRESH is the current local command record in the T16 JSON, including actual 390 backend and 238 frontend passes, syntax/typechecks, both builds and offline Compose/workflow checks. Those are fresh tests of the unchanged application source, not a fresh database/edge/provider/scan/rollback/load/DR deployment. The T15 scan records Trivy 0.76.2, frozen DB metadata and actual local config IDs; A/B/A records actual replacement/drain/TLS/schema/durable Execution checks. Neither proves a published candidate or previous-version rollback. The final hardened rollback has a retained PASS report but no retained numeric shell exit; the earlier run records exit 0. Availability/hash of old raw logs is recorded separately; it is not a new execution result.

## Deferred production prerequisites

These P rows present the canonical [T15 B01-B11 register](verification-evidence/t15-blocker-closure-verification.json). DEFERRED is an owner scheduling decision, not RESOLVED and not a replacement for the underlying blocking status. JSON retains required authority, dependency, existing evidence, future procedure and release-blocking impact.

| ID | Prerequisite | Canonical blocker / status | Missing decision/evidence | Status |
| --- | --- | --- | --- | --- |
| P01 | Canonical repository | B01 / BLOCKED_EXTERNAL | Configure approved owner/repository URL, branch and actual committed SHA; provide clean checkout and protection evidence | DEFERRED |
| P02 | Container registry | B02 / BLOCKED_EXTERNAL | Configure approved HTTPS registry origin/image prefix, retention and scoped publisher/pull references | DEFERRED |
| P03 | Immutable release candidate | B03 / BLOCKED_EXTERNAL | Supply actual T12 candidate manifest and source/digest/provenance/staging evidence; no fabricated candidate | DEFERRED |
| P04 | Production target | B04 / BLOCKED_EXTERNAL | Configure approved target/runtime/private topology/storage/DNS/TLS/database/secrets and evidence | DEFERRED |
| P05 | Deployment approver | B05 / BLOCKED_EXTERNAL | Configure actual accepted approver and protected mechanism evidence; self-filled record is not authentication | DEFERRED |
| P06 | Deployment transport | B06 / BLOCKED_TECHNICAL | Select reviewed transport and registry/target identities; only then implement audited protected execution separately | DEFERRED |
| P07 | Named operators | B07 / BLOCKED_EXTERNAL | Configure accepted principal/team, private contact and assignment/backup/escalation references for eight roles | DEFERRED |
| P08 | External email alerts | B08 / BLOCKED_EXTERNAL | Configure approved sender/channel and separately authorize isolated acceptance/delivery/acknowledgement verification | DEFERRED |
| P09 | Off-host backup | B09 / PARTIALLY RESOLVED | Configure independent storage/key custody; separately authorize host-loss/restore/session/effect verification | DEFERRED |
| P10 | Independent key recovery | B09 / PARTIALLY RESOLVED | Configure independent storage/key custody; separately authorize host-loss/restore/session/effect verification | DEFERRED |
| P11 | Capacity expectations | B10 / BLOCKED_EXTERNAL | Configure approved workload/latency/error/headroom/growth and compare with measured representative workloads | DEFERRED |
| P12 | RPO/RTO expectations | B11 / BLOCKED_EXTERNAL | Configure approved maximum loss/duration, schedule/retention/cadence and custody; compare measured hosting-loss recovery | DEFERRED |
| P13 | Production promotion | B05 / BLOCKED_EXTERNAL | Configure actual accepted approver and protected mechanism evidence; self-filled record is not authentication | DEFERRED |

## Acceptance coverage

These result labels describe requirement coverage, not global acceptance. ACCEPTED_LOCAL uses the historical scoped acceptance plus current unchanged-source regressions; it does not assert deployment. No requirement is labelled ACCEPTED_STAGING for an actual approved registry candidate, because T13 is a local simulation. DOCUMENTED_ONLY is never proof of production operation. Initial failures and missing coverage remain visible.

| ID / tasks | Criterion | Evidence | Result | Limitation / future gate |
| --- | --- | --- | --- | --- |
| A01 / T01 | Architecture and current topology documented | E01 | DOCUMENTED_ONLY | No actual infrastructure asserted; P04 |
| A02 / T02 | Fail-closed config with real deployment settings | E02 | DEFERRED_PRODUCTION | Local config tests; owner decisions absent; P04 |
| A03 / T03, T04 | Private principal/object/session transport/cleanup | E03, E04 | ACCEPTED_LOCAL | Historical private-owner/HTTPS local acceptance, no public tenant claim; P04 |
| A04 / T05, T06 | Non-root packaging, TLS, private networking/diagnostics | E05, E06 | ACCEPTED_LOCAL | Historical local container boundary only; P04 |
| A05 / T07 | Least-privilege runtime and serialized migration/journal safety | E07 | ACCEPTED_LOCAL | Disposable PostgreSQL only; P04 |
| A06 / T08 | Encrypted integrity-checked isolated restore | E08 | ACCEPTED_LOCAL | Local restoration is not host/offhost/key DR; P09 |
| A07 / T09 | Bounded drain/admission/fenced recovery | E09 | ACCEPTED_LOCAL | One writer, uncertainty quarantined, not arbitrary exactly-once effects; P04 |
| A08 / T10 | Existing external observation/ingestion boundary | E10 | ACCEPTED_LOCAL | No external dispatch/webhook; production activation deliberately closed; P04 |
| A09 / T11 | Safe logs/private diagnostics and local SMTP behavior | E11, E11-MAIL | ACCEPTED_LOCAL | No real backend/channel/recipient signoff; P08 |
| A10 / T12 | Release contracts and immutable artifact/source verification | E12 | ACCEPTED_LOCAL | Synthetic fixtures; actual committed published candidate missing; P03 |
| A11 / T13 | Exact candidate staging UAT and genuine rollback | E13, E15-CLOSURE | DEFERRED_PRODUCTION | Local on-demand simulation/metadata variants do not meet full staging release criterion; P03 |
| A12 / T14 | Capacity and operational recovery objectives met | E14 | DEFERRED_PRODUCTION | Finite observed bursts/source DB loss; no approved targets/hosting-loss evidence; P11 |
| A13 / T15 | Authorized first promotion, smoke and stabilization | E15, E15-CLOSURE | DEFERRED_PRODUCTION | No candidate/auth/target or executed production operation; P13 |
| A14 / T16 | Consolidated independently verified handover preparation | E16-FRESH | DOCUMENTED_ONLY | Docs/preparation complete; not production acceptance |
| A15 / T13, T14 | Previous initial transient failures and full-release coverage | E15-CLOSURE | NOT VERIFIED | T15 recorded initial city simulation/backup setup failures then passing retries; city cause unknown. Retained, not deleted or rerun to claim closure; P03 |

## Measurements and unresolved risk

Historical T14 finite staging measurements include 541.70 Agent reads/s (concurrency 8; p95 19.09 ms), 117.43 Task submissions/s, 7.73 native successes/s at concurrency 1, peak Node RSS 223.04 MiB, PG 1 CPU/512 MiB and pool 3. Headless city observations were approximately 34-38 FPS with four visible bound NPCs/up to 20 projections. Source-DB-loss isolated read recovery was 1935 ms; snapshot age 5750 ms with one known later marker absent. The same PostgreSQL server survived. These are neither a hosting-loss recovery result nor approved capacity/RPO/RTO. No new performance/recovery measurements were taken in T16.

Six original HIGH T14 release findings and B01-B11 remain unresolved in production scope: source/artifact/scan provenance, actual candidate/rollback/target, approved sustained capacity, offhost/key/hosting recovery, named real alerts, and restored-session/uncertain-effect cutover. No exception or business objective is invented. The historical initial city retry-handoff failure and backup TCP setup failure remain in T15 alongside passing retries; current 390/238 passes do not establish those original causes.

## Verification and maintenance

Exact current commands, return codes, working directory, raw-log references and hashes are in the JSON. Git commands return128/129 because .git is absent; the SHA256 preservation baseline is limited evidence, not a Git-clean claim. Documentation/static checks validate references/statuses/script names, not external approvals or operational settings. Keep generated API output separate from maintained city dist. Update these matrices when canonical evidence changes; preserve earlier scopes and dates. Production acceptance must remain NOT STARTED until independently authorized and actually evidenced.
