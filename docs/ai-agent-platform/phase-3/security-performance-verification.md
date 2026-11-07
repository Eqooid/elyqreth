# T09 — Security, Performance & Regression Verification

Review date: **2026-10-25**. This report covers Phase 3 T02–T08 under the approved **single-owner, loopback development/test** trust model. It is not Phase 3 final acceptance or production authorization approval. T10 remains planned.

**Overall: PASS WITH LIMITATIONS.** No unresolved Critical or High finding was identified in the reviewed local scope after remediation. Production exposure, long-duration leak freedom and larger linked populations are not approved by this result.

## Baseline and method

The supplied workspace has no Git metadata: `git status --short` fails, so neither a clean Git tree nor commit-history secret scanning can be claimed. No applicable AGENTS.md was found in the workspace/accessible ancestors. A pre-change SHA-256 inventory records existing application, test, documentation and Docker files, including the user's Docker work. Root package.json/package-lock.json were separately saved before dependency remediation.

The baseline ran before production changes:

| Check | Actual baseline result |
| --- | --- |
| Syntax, frontend/backend typecheck, backend/frontend build, migration check | PASS |
| Frontend suite | PASS, 125 tests |
| Backend suite | PASS, 190 tests |
| Initial aggregate SQL stage | BLOCKED by stopped Docker Desktop; aggregate exited 1, not claimed passing |
| Isolated PostgreSQL rerun after starting installed Docker Desktop | PASS, 104 tests |
| Real Chrome smoke and initial profiling | PASS, zero exceptions |
| Production dependency audit | FAIL, three HIGH entries representing two advisories and their adapter dependency chain |
| New focused parser checks before remediation | FAIL, affected versions and invalid compressed JSON incorrectly mapped to HTTP 500 |

Existing topology: vanilla JS/Canvas, one GameLoop; one T04 shared REST poller at a 2-second after-completion interval, 5-second sweep timeout, 6-second stale/30-second unknown policy; T05 stable-slot/object identity indexes; T06 shared shape/status presentation; T07 a selected read-only projection inspector. There is no React, streaming transport, event replay, full city execution-history/result API, or production tenant identity system.

## Security findings and remediation

| ID / severity | Evidence and impact | Resolution |
| --- | --- | --- |
| S01 HIGH — vulnerable body-parser | Installed 2.3.0 is affected by [GHSA-27r3-jxmh-p828](https://github.com/advisories/GHSA-27r3-jxmh-p828), a compressed-request process-termination advisory. Parsers run before route guards, including requests to unmatched routes. Dependency exposure is confirmed; a complete crash exploit reproduction is not claimed. | FIXED: reviewed 2.4.0 pin, actual dependency resolution checks, clean-install verification, isolated malformed/valid compressed-body regression and Docker image dependency checks. |
| S02 HIGH dependency finding — multer | Installed 2.4.0 is affected by [GHSA-q7qp-rjg7-q26m](https://github.com/advisories/GHSA-q7qp-rjg7-q26m). The triggering asynchronous fileFilter/upload path is **not exposed in this application**; source search found no upload interceptor/filter. Audit also flags the unchanged Nest adapter via this dependency. | FIXED defensively at 2.5.0; no upload feature introduced and no Nest major/minor upgrade. |
| S03 MEDIUM — parser error classification | Isolated real HTTP baseline: malformed gzip JSON returned 500 although body-parser identified a 400 `Z_DATA_ERROR`. A further 101-field form also reproduced 500 instead of the configured parameter-limit rejection. No raw diagnostics were returned. | FIXED: narrowly recognize observed zlib/Brotli client errors as 400, unsupported encoding/charset types as 415 and parameter-limit errors as 413. Static messages/correlation remain; other internal errors remain 500. Valid compressed bodies still parse. |
| S04 LOW — stale current security documentation | Active Docker documentation still described an unresolved audit. Earlier Phase 3 planning pages retained historical planned checkpoints. | Updated active indexes/current notes and Docker audit status; historical Phase 1/2 acceptance records preserved. |

Root overrides pin body-parser 2.4.0 and the existing Nest Express adapter's multer 2.5.0. npm did not apply the latter across the workspace link until the **already-used @nestjs/platform-express 11.2.7** was mirrored as a root resolution anchor. This behavior was observed with the installed npm and checked against the [npm workspace override issue](https://github.com/npm/cli/issues/9659). No new framework/library or adapter version was introduced. Both root/workspace references deduplicate to the same adapter. The security test resolves parsers through the adapter/Express dependency chain rather than trusting an unrelated hoisted package.

The reviewed lockfile changes only **body-parser 2.3.0 → 2.4.0** and **multer 2.4.0 → 2.5.0** versions. npm's dependency/peer classification metadata also reflects the root anchor. A clean `npm ci --ignore-scripts --no-audit` reproduced the patched tree. Production and complete audits subsequently reported **zero findings**. This is time-specific npm advisory evidence, not a guarantee that all possible vulnerabilities are absent.

The parser regression runs the API in an owned subprocess, sends small bounded valid and malformed gzip/deflate/Brotli JSON and form bodies to an unmatched route, checks safe response/error behavior and subsequent health, and closes the process. It also checks unsupported encoding. It does not attack a developer/production API or rely on a whole test-runner crash. The global body size limit remains 64 KiB.

## Authorization, identity and data exposure matrix

These controls are server-enforced. Frontend hiding is additional presentation behavior, not authorization.

| Area / scenario | Implementation and verification | Status |
| --- | --- | --- |
| Local authentication / distinct audiences | Shared local guard checks configured loopback bind, socket peer, Host, exact Origin, timing-safe bearer. City-read token differs from operator token; defaults/production fail closed. Existing real HTTP city/runtime tests. | PASS under approved local model |
| Agent, Task, Execution and audit ownership | Server-derived fixed owner, parent-chain predicates, missing/foreign uniform 404; city credential cannot call operator history/result/control endpoints. Phase 1/2 and activity HTTP/SQL suites. | PASS |
| City read-only boundary | Only existing city activity GET routes; no new mutation or provider endpoint. Docker bridged mode explicitly disables protected registry/runtime/city APIs. | PASS |
| IDs, queries and pagination | Strict UUIDs, supported slot catalog, query allowlist, bounded page/set sizes, strict response cursor/order/schema, 64 KiB response cap and safe errors. | PASS |
| Binding cardinality and concurrency | Existing FK/partial unique constraints, owner/city transaction locks, revision checks, atomic reassignment and audit rollback. SQL/CLI/concurrent tests. | PASS |
| Actual NPC identity | Immutable slot plus registered functional NPC object; no names/coordinates/sprites as authority, duplicate slots fail closed. T05 tests. | PASS |
| Missing/deleted/disabled/archived records | No fabricated NPC; unresolved/unknown/availability separate from lifecycle. Agent deletion/ownership changes cannot orphan FK bindings. Tests retain history and use documented lifecycle restrictions. | PASS |
| DTO and UI allowlists | Projection omits prompt/input/config/description/result/diagnostic/lease/tool fields; frontend validates/freeze-normalizes and escapes displayed text. Safe names max 160 characters; references/timestamps bounded by contracts. | PASS |
| Revocation and stale data | 401/403 clear token/protected store and listeners; old generations cannot reapply. Inspector selection/hidden DOM clear, generic revoked notice contains no backend IDs. Network error is stale, not failed execution. | PASS |
| Logging privacy | Existing safe event names, bounded request IDs and counts/durations; HTTP/SQL tests use excluded-field secret markers, and raw errors are normalized. | PASS for tested paths |
| Production/multi-tenant authentication | Not present, not approved by the architecture, and not added. External runtime exposure remains blocked. | BLOCKED for production, outside local acceptance |
| General secret detection in user-chosen display names | No DLP system is implemented or claimed. Explicitly safe fields may still contain operator-entered sensitive text. | NOT VERIFIED as general DLP |

The existing inspector deliberately exposes only current/latest/recent execution **references** (at most three) and one latest outcome, not full audit history, result text, provider payloads or precise duration. T09 does not broaden that access. An authenticated local operator's separate runtime APIs retain their existing scope. CORS is not treated as authentication.

## Synchronization and reliability

The existing T08 invariants were reviewed and exercised: in-flight lock before subscriber notification, generation checks before/after publish, same-ID version guards, all-or-nothing complete sweep commits, retryable cross-page conflicts, explicit unavailable first omission and removal only after a second complete omission. No timestamp/global sequence guarantee is invented across unrelated identities or separate SQL pages.

| Scenario | Evidence | Status |
| --- | --- | --- |
| Independent Agents, new executions and changed bindings | 20-Agent deterministic fixtures; current Task/Execution identity boundaries and selection tests | PASS |
| Delayed/duplicate/malformed updates | Abort/generation/same-ID version tests, response parsing limits, no duplicate binding/history/effect | PASS |
| Network failure, retries, visibility pause/resume and credential loss | Controlled clocks, bounded jitter/backoff, no hidden polling or repeated auth retry | PASS |
| Snapshot reconciliation after missed changes | Controlled transport and real protected HTTP/isolated PostgreSQL restart test | PASS |
| Exactly-once events or gap-free replay | Polling does not supply them; intermediate transitions can be missed | NOT VERIFIED / not promised |
| Replicas, version rollback or multi-region ordering | Not the approved single-primary architecture | NOT VERIFIED |

## Performance methodology and measurements

Hardware/environment is recorded in raw evidence: Node 24.9.0, Windows x64 build 10.0.26200, AMD Ryzen 5 5600H, 12 logical CPUs, approximately 15.4 GiB reported RAM. Chrome version and frame/DOM counters come from CDP. Docker Desktop supplies isolated PostgreSQL 17. Application/test-driver CPU measurements are not PostgreSQL server CPU measurements.

Reproducible commands:

```powershell
npm run profile:phase3 -- --out docs/ai-agent-platform/phase-3/verification-evidence/t09-node-final-running.json
$env:BROWSER_PROFILE_PHASE3='true'
npm run test:browser
Remove-Item Env:BROWSER_PROFILE_PHASE3
```

The Node harness uses 100 serialized complete refreshes per case, controlled response bodies/clocks, actual normalization/synchronization/T05/T06/selected-inspector work, then 300 complete integration lifecycles with forced-GC checkpoints. The final workload contains synthetic RUNNING Task/Execution references, not actual inference or execution dispatch. Cases 25/50/100 include unbound rows beyond the supported **20 linked slots**, not 100 visible NPCs. Query-count assertions verify one page per 20 rows, rather than a request per NPC.

The early Node baseline was an IDLE/no-execution fixture. It is preserved as such; it is **not** a like-for-like speed comparison to the final RUNNING fixture. There was no renderer/synchronization algorithm optimization justified by these measurements and no performance improvement percentage is claimed.

Browser profiling uses one headless city, fixed desktop viewport/camera for the final samples, 120 rAF intervals per case, CDP TaskDuration/ScriptDuration, the application's render-time EWMA, forced-GC heap samples and DOM/listener counters. Only four existing functional residents can be linked in that page; other bindings stay unresolved and offscreen/hidden residents may be culled. `boundExistingNpcs` counts eligible associations, not instrumented actual marker draws. This derived field was initially named `renderedLinkedNpcs`; its label was clarified in the script and saved JSON without changing measured values. The city continues animating; simulation time/decorative count/camera are recorded because live world load can vary. The initial browser baseline predates the fixed-camera refinement. Neither set is a controlled causal benchmark or production FPS guarantee. CDP task/script durations bracket commands/startup too, especially the initial case; they are not pure draw CPU or frame-time percentages.

Real SQL measurement covers 1/10/25/50/100 owned Agents with 2,000 historical Tasks. It asserts exactly ceil(N/20) SELECTs and records elapsed time, combined Node API/test-driver CPU, heap/RSS observations and query-plan estimates. These rows are persistence/read fixtures, not that many concurrently executing models.

Raw measurements and final observed values are listed after verification below. No latency thresholds were invented to make a timing test pass. Native/GPU memory, long-duration production soak, paid-provider load and multi-user workloads remain NOT VERIFIED.

## Memory/resource investigation

The initial Node forced-GC checkpoints after 0/100/200/300 lifecycles were approximately 8.89/9.09/9.03/9.07 MB. Initial Chrome heap was approximately 4.05/3.98/3.98/4.03 MB, with **57 event listeners** at each checkpoint; DOM nodes settled from 765 to 615 after revoked inspector content cleared. These short observations did not show sustained monotonic growth. They do not prove leak absence.

The harness explicitly asserts zero retained resident listeners/Agent rows after each lifecycle. Existing fake-clock tests assert timers/visibility/online listener cleanup across 100 connection cycles, authorization loss, disposal and interrupted requests. Browser tests additionally exercise reloads, NPC selection changes, mobile layout and disconnection/recovery. Integration lifecycle profiling is not 300 complete renderer/page mounts; full city teardown/long native-memory analysis remains a limitation.

## City and runtime regression scope

The standard suites retain NPC spawning/movement/daily routines/needs/social behavior, café/park seating and reservations, roads/bridges, train/station, water/environment animation, camera, pixel/theme invariants, selection and responsive panels. Runtime regressions cover registry, rule-based and mocked LLM execution, both provider transports, authorized calculator/date tools, budgets, cancellation/deadlines, SQL lifecycle races, results and durable audit.

No city sprites, movement, rendering, theme, lifecycle state or provider contract is redesigned. Docker smoke separately builds the patched dependency tree, verifies migrations/non-root application containers and runs the actual container-served city in Chrome. Live Ollama/OpenAI inference is NOT RUN; mocked provider checks are not labeled live verification.

## Evidence, final results and remaining gates

### Actual final measurements

Mocked RUNNING projection processing, 100 complete refreshes/case:

| Agent rows | Linked slots | Median ms | p95 ms | Mock transport calls |
| --- | --- | --- | --- | --- |
| 1 | 1 | 0.274 | 0.659 | 100 |
| 10 | 10 | 0.472 | 0.902 | 100 |
| 20 | 20 | 0.686 | 0.960 | 100 |
| 25 | 20 | 1.035 | 1.759 | 200 |
| 50 | 20 | 1.670 | 2.559 | 300 |
| 100 | 20 | 2.817 | 3.899 | 500 |

Actual SQL read cases for 1/10/25/50/100 Agents used 1/1/2/3/5 SELECTs and measured **24.393/20.227/45.312/84.655/119.976 ms** elapsed. The combined API/test-driver process observed approximately 225.4 MB RSS; heap changed from approximately 83.6 to 85.5 MB across these allocations without forced GC. `process.cpuUsage` returned 0 ms for these short per-case Windows samples: this is a sampling-resolution limitation, not evidence of zero CPU. PostgreSQL server CPU/memory was not separately profiled.

Actual headless browser samples:

| Projection rows | Bound existing NPCs (upper bound) | Mean frame ms | p95 frame ms | Sampled FPS | Scene draw EWMA ms |
| --- | --- | --- | --- | --- | --- |
| 0 | 0 | 19.37 | 25.10 | 51.6 | 2.13 |
| 1 | 1 | 17.99 | 25.00 | 55.6 | 2.52 |
| 10 | 4 | 21.32 | 33.20 | 46.9 | 2.29 |
| 20 | 4 | 19.93 | 25.10 | 50.2 | 2.20 |

The decorative population changed from six to seven during these live samples. No causal speedup/slowdown is inferred from those FPS differences, and no renderer rewrite or speculative optimization was justified. Seven mocked foreground snapshot calls occurred during the sampled runtime cases; these are not per-NPC backend connections. Asset/network requests are counted separately by browser smoke.

Final forced-GC Node heap checkpoints (0/100/200/300 integration cycles): **8.90/9.09/9.05/9.09 MB**. Chrome: **4.02/3.96/3.95/3.98 MB**, with **57 listeners** throughout and DOM nodes settling **765 → 615 → 615 → 615**. Explicit disposed-source listener and retained-row checks passed. These comparable short checkpoints show no sustained monotonic growth, but do not certify absence of slow/native/GPU leaks.

### Final command evidence

| Command | Actual result |
| --- | --- |
| `npm ci --ignore-scripts --no-audit` | PASS, clean patched dependency installation |
| `npm ls body-parser multer --all` | PASS, actual adapter tree uses patched 2.4.0 / 2.5.0 |
| `npm audit --omit=dev --json` | PASS after remediation, zero findings |
| `npm audit --json` | PASS after remediation, zero findings across complete tree |
| `npm run verify:phase1` with `BROWSER_PROFILE_PHASE3=true` | PASS, exit 0; lint/typecheck, both builds, migration check, 125 frontend tests, 192 backend tests, 104 isolated PostgreSQL tests and Chrome |
| `npm run test:api` after final parameter-limit refinement | PASS, 192 tests, zero skips/failures |
| `npm run lint` after final refinement | PASS; repository syntax/strict type checks. No separate ESLint/formatter configuration is present |
| `npm run test:docker` | PASS, isolated Compose/migrations/non-root/patched-dependency checks and real container-served Chrome city |
| `node --expose-gc scripts/phase3-profile.mjs --out ...` | PASS, six RUNNING cases, exact page-call assertions, 300 clean lifecycles |
| `node --check scripts/phase3-browser-profile.mjs` | PASS after derived-field label clarification |

The successful aggregate preceded the last one-line 413 parameter-limit mapping refinement. The full backend suite/type checks were rerun after that refinement; frontend/SQL algorithms were unchanged. Docker was rebuilt and checked again. No skipped tests are counted as passed.

Final aggregate Chrome: **155.0.8059.85**, **162 asset/resource requests**, **zero exceptions**, including the optional profiling/reload work. Docker's Chrome checks are separate and use no real provider. Standard city controls/movement/water/train/mobile regressions passed, but no golden-image diff, full manual zoom/accessibility audit or fixed FPS acceptance threshold is claimed.

Reproducible JSON evidence:

- [Initial Node IDLE baseline](verification-evidence/t09-node-baseline-idle.json)
- [Final Node RUNNING cases](verification-evidence/t09-node-final-running.json)
- [Initial Chrome observations](verification-evidence/t09-browser-baseline.json)
- [Final Chrome observations](verification-evidence/t09-browser-final.json)
- [Final PostgreSQL measurements](verification-evidence/t09-postgres-profile.json)

Detailed temporary logs use prefix `elyqreth-p3-t09-`: `baseline-tests.log`, `baseline-db.log`, `parser-before.log`, `parameter-before.log`, `final-tests.log`, `api-final.log`, `lint-final.log`, `docker-final.log`, `audit.json`, `audit-after.json`, `audit-full.json`, and `profile-final.log`. They distinguish expected pre-fix/infra failures from successful final runs. No Git status/diff or historical secret audit is fabricated.

### Remaining gates

Production identity/access architecture and externally exposed runtime operation remain blocked by the approved prior boundary. Full city history/results/audit disclosure, larger visible linked catalogs, gap-free event replay, real-provider throughput, native/GPU/long-soak memory and exhaustive visual/accessibility testing remain outside these verified claims. They are not new production guarantees. This local hardening result does not start T10 or declare final Phase 3 acceptance.

### Files changed and preservation

Created:

- `apps/api/test/parser-security.test.cjs`
- `apps/api/test/fixtures/http-parser-child.cjs`
- `scripts/phase3-profile.mjs`
- `scripts/phase3-browser-profile.mjs`
- This report and the five JSON evidence files linked above.

Modified:

- Root `package.json`, `package-lock.json` (reviewed parser pins/root adapter anchor and profiling command)
- `apps/api/src/common/http-foundation.ts` (safe parser error classification)
- `apps/api/test/activity.integration.cjs` (25-Agent measurement and CPU/memory observations)
- `scripts/browser-smoke.mjs` (optional CDP profiling)
- `scripts/docker-smoke.mjs` (verify actual image parser dependency chain)
- `README.md`, `docs/docker.md`, `docs/ai-agent-platform/README.md`
- Phase 3 `README.md`, `implementation-plan.md`, `security.md`, `testing-performance.md`

The pre-change inventory confirms **293 existing files unchanged**, including city assets, theme, renderer, simulation/movement, frontend runtime/identity/inspector logic, backend registry/lifecycle/providers/tools, schema and migrations. No inventoried file was removed. Root manifest/lock changes were separately reviewed: only the two parser package versions changed, alongside the documented root/peer metadata. The Docker work is preserved and verified; no Compose security boundary or service was weakened.

Links/fences were checked across 21 current documents with zero issues. Source review and hash comparisons substitute for the unavailable Git diff; they do not establish historical commit/secret provenance. No commit, push, tag, release or deployment was performed. The next task is **Phase 3 T10 — End-to-End Acceptance Review & Documentation**, not started here.
