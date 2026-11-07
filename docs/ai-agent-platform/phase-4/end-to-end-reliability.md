# T09 - End-to-End Workflow and Reliability Tests

Date: 2026-10-26, Asia/Bangkok. **T09: COMPLETE for the approved local scope.** Scope: the existing local-development interaction capability, real browser/Nest/PostgreSQL workflows and conservative runtime recovery. This task does not accept Phase 4 for release or implement T10.

## Repository audit and supported environment

Reviewed actual [architecture](architecture.md), [ADRs](decisions.md), [T02 backend contracts](interaction-api.md), [T03 client](frontend-interaction-client.md), [Task UI](task-submission-ui.md), [lifecycle controls](execution-lifecycle-controls.md), [results/history](execution-results-history.md), [T07 synchronization](interaction-state-synchronization.md), [T08 hardening/risk register](interaction-hardening.md), source, test harnesses, Compose and CI. T02-T08 have implemented local behavior and evidence; this inventory does not infer completion from prompts.

No applicable AGENTS.md was found in the workspace or accessible ancestors. There is no Git metadata, so status/diff/untracked inventory cannot be obtained from Git. A maintained-file hash inventory captured existing work before edits; `vite.config.js` was added to that inventory before its confirmed path fix. No unrelated work was discarded.

The test environment uses Node 24, the existing Vite-served maintained `dist/` frontend, installed headless Chrome, actual Nest application/coordinator/services and the repository's digest-pinned PostgreSQL 17 Docker image. No production URL or credential is consumed by the database harness. It creates random credentials, database/container/volume identities and loopback ports, checks health, applies real migrations, and verifies exact labels before teardown. Child processes and browser profiles belong to the test and have bounded shutdown.

There is no separate worker, message broker, Redis or reverse proxy in the current runtime. Those restart scenarios are **NOT APPLICABLE**, not passing tests. Compose intentionally disables runtime/read/interaction capabilities by default and binds the container API to a configuration incompatible with the loopback runtime guard. This E2E path uses the supported local test harness; it does not weaken Compose/production authorization to activate runtime inside a container.

## Deterministic fixtures

Existing fixtures create an owner, enabled native orchestrator, active Agents, stable resident slots and persisted bindings. A separate configured owner supports actual HTTP object-isolation tests; there is no invented human/tenant login. The fourth resident is explicitly unbound for decorative/unbound regression checks. IDs remain stable within each fixture, while owners, keys, tokens and resources are unique between tests.

T09 adds an opt-in rule-based-only fixture. It removes unused LLM configuration and uses the existing `text.stats.v1` strategy. A test-only process hosts the real Nest/coordinator runtime with an internal strategy barrier: success delegates to the genuine text-statistics implementation, failure throws a controlled RuntimeError, and timeout waits for the actual configured coordinator deadline. No controller, response DTO, lifecycle transition, result, audit row or public test endpoint is fabricated. Barrier/configuration commands travel through private IPC. The browser receives only city-read and limited interaction credentials; the operator credential stays out of it.

The existing T07 two-instance test remains the concurrency proof: independent genuine coordinators observe the same authorized PostgreSQL authority. It respects one active execution per coordinator and native per-Agent quarantine; it does not retrofit orchestration or assume one globally active execution.

## E2E matrix

PASS entries require executed evidence in the verification record. Different levels are explicit; a unit test is not labelled browser E2E.

| Scenario | Level / dependencies / fixture | Expected outcome | Coverage and result |
| --- | --- | --- | --- |
| NPC binding/Agent identity | Native Chrome + Nest + PG; actual persisted slots | Exact registered Agent/Task identity, no name/position inference | Existing T04/T07 plus T09 native path; PASS |
| Unbound/decorative selection | Native city and removed fourth binding | No submission section or duplicate NPC | Existing native workflows and T09 final resident-count assertion; PASS |
| Authorized Save/double submission | Native form -> real transaction | One saved Task, no automatic execution | Existing T04 and initial T09 double-submit; database counts and browser POST counts; PASS |
| Empty/invalid input, unavailable Agent | Component/typed client and real HTTP/PG | Validation/eligibility errors, no unauthorized mutation | Existing T02/T03/T04 tests and T08 browser validation; PASS at stated layers |
| Explicit Start, PENDING/QUEUED, RUNNING | Real coordinator/API/PG, native inspector | Backend versions and identities, projection drives NPC state | Native T05/T07/T09; queued read path in separate Phase 3 E2E; PASS |
| Success/result | Genuine rule-based runtime + persisted result | SUCCEEDED, correct four-word statistics, one terminal event/result | T09 native result/history and SQL checks; PASS |
| Runtime failure | Controlled strategy fault inside actual runtime | FAILED/Task FAILED, no result, safe UI summary and exactly one terminal event | T09 native; PASS |
| Native timeout | Actual 600ms configured runtime deadline, cooperative barrier | TIMED_OUT/Task FAILED, no fabricated result | T09 native plus existing lifecycle tests; PASS |
| Cancel/duplicate/terminal race | Native T05/T07 and real HTTP lifecycle tests | Exact execution target, persisted race winner, no duplicate effect | Existing native and SQL/API tests; PASS |
| Lost cancellation acknowledgement | Real HTTP with client response loss; native outage/cancel separately | GET reconciliation, no repeated Cancel | Existing T05 owner/API case and T07 native outage recovery; PASS; not mislabelled CDP Cancel interception |
| Result disclosure, malicious text, empty/unavailable output | Native T06 + real safe DTOs | Text escaped, no external fetch/script, absent result distinct from failure | Native T06 and T09 failed output; typed/unit availability tests; PASS |
| History/pagination/historical selection | Native T06 with genuine seeded executions | 10-row first page, stable cursor, correct result, live status unchanged | Existing native T06; T09 one-page/new-terminal invalidation; PASS |
| Multi-Agent isolation | Native T07, two authorized coordinator instances | A remains active while B completes; no crossed identities/results | Existing independent coordinator scenario; PASS under actual capacity policy |
| API outage/browser offline | Real hard process loss and Chrome network emulation | Stale observation, stable references, authoritative re-fetch | T09 native plus T07 URL-blocking test; PASS |
| Lost Create response and reload | Chrome CDP response-stage failure after real 201 commit | Original key survives identifiers-only journal; reauthorization restores one exact Task by GET | New T09 native; PASS |
| Lost Start success response | CDP drops real 200 response after execution/result commit | Canonical SUCCEEDED discovered by reads; one execution, no repeated POST | New T09 native; PASS |
| Active backend hard crash | Owned runtime child killed after real RUNNING admission; same-port restart | Persisted identity, stale then fresh UNKNOWN after real lease expiry, no success/redispatch | New T09 native/SQL proof; PASS for conservative semantics |
| Database restart | Actual owned PostgreSQL container restart in full regression suite | Committed identities/migration journal survive and reconnect queries succeed | Existing foundation integration case; PASS; not a claim of in-flight execution resumption |
| Worker/broker/Redis restart | No such deployed components | No invented guarantees | NOT APPLICABLE |
| Browser refresh while active | Native T07 | Exact execution restored after reauthorization; display actual persisted outcome | Existing native active reload; PASS; navigation can request cancellation |
| Authentication/revocation/ownership | Actual HTTP with two configured owners; native credential rotation | 401 cleanup, foreign resources 404, no leaked cache/results, explicit reauthorization | T08 security matrix and T09 native rotation; PASS |
| Production user/tenant login | Not implemented by approved architecture | No unsupported claim | NOT APPLICABLE to local acceptance; production release remains BLOCKED |
| Binding revocation/reassignment | Native T09 and existing transaction/unit checks | Action UI removed; backend execution identity independent of NPC | PASS |
| Keyboard/semantics/focus/motion/mobile | Actual Chrome keys/AX tree; existing T08 component checks, native T05/T06 | Named controls, focus destinations, bounded output/reflow, motion preference | Existing hardening harness enabled in CI and rerun; PASS; manual screen-reader operation NOT VERIFIED |
| Network/resource bounds/city regression | Browser request counts, deterministic ownership tests, retained T08 profiles, city smoke | No automatic POST replay or per-NPC poller, no NPC reconstruction; rendering/camera/environment continue | PASS for bounded observations; no long-soak or capacity guarantee |

## New native reliability sequence

The browser starts with the existing inspector and submits an initial Task through native fetch. It then saves another Task while CDP pauses the POST at the **response stage**. The parent verifies the committed Task using its exact original idempotency key, and CDP fails the acknowledgement before the frontend can consume it. The UI remains unresolved. Reload clears credentials/private drafts; explicit reauthorization restores the exact Task by GET. SQL proves two Tasks total at this point and no execution yet.

The user then starts the recovered Task. Actual RUNNING details/projection are observed while the strategy barrier holds. Interception is armed before dispatch; after releasing the genuine strategy, CDP drops the completed 200 acknowledgement. The frontend reconciles SUCCEEDED through existing reads. SQL checks one execution, one result and one terminal event; UI statistics and history match that exact execution.

Chrome offline/online emulation verifies stale presentation and reference retention. The dedicated dev server disables HMR so reconnecting the test transport cannot add an unrelated development-only page reload. Separate Tasks exercise a real controlled failure and the native runtime deadline through the same UI. No fixed sleep is used as proof of lifecycle state; test barriers, bounded predicates and authoritative queries establish transitions.

Finally another Agent's RUNNING runtime process is forcibly terminated. The API actually disappears; the frontend marks synchronization stale without changing the execution into FAILED. A new authorized Nest process listens on the same port. The existing shared poller re-fetches snapshots; after the real 20-second lease expires, Agent activity becomes UNKNOWN/LEASE_UNVERIFIED. The persisted Task/Execution remain RUNNING with no result or terminal event. An explicitly tested repeat Start is rejected with 409 and the new process dispatch count remains zero. This is observation recovery, **not automatic task repair or resumption**.

The fixture rotates the real interaction capability through a backend restart. The old credential receives 401, the UI clears protected Task/result/recovery state, and explicit new authorization is required. Removing the selected binding hides interaction controls without deleting or cancelling its persisted execution. The city retains its four residents.

## Defects, diagnosis and narrow fixes

| Classification | Finding | Correction and regression evidence |
| --- | --- | --- |
| CI/test serving defect | `vite.config.js` used a cwd-relative `dist` root. Root-level focused tests passed, but `npm run test:db` runs under `apps/api`, serving compiled API output instead of the city. Initial full run: 118/122, all four browser cases failed to initialize. | Resolve `dist/` from the configuration file URL. No city design change. Full PostgreSQL suite rerun: 122/122. |
| Interaction reliability defect | A transient eligibility-read failure unconditionally erased a confirmed saved Task reference, contrary to offline recovery semantics. | Preserve confirmed references on transient read failure while invalidating eligibility. Mutations and 403/404 still clear references; 401 clears the connection. Added failing-then-passing regression plus denial tests, and reran affected suites. |
| Environment | Docker Desktop Linux engine initially unavailable; sandboxed migration check failed Windows user-profile lookup with ENOMEM. | Started installed Docker engine in background and reran isolated tests; migration check passed outside that sandbox restriction. |
| New test-fixture defects and controls | Inherited unused LLM startup settings; attempted New Task before eligibility settled; armed response interception after Start dispatch. CDP preflights need continuation; development HMR is disabled to avoid unrelated reloads during offline testing. | Rule-based-only configuration, actual eligibility waits, response interception before dispatch, preflight continuation and HMR-free dedicated fixture. Assertions on backend state, IDs, event counts and mutation counts retained. |

No backend lifecycle, provider, tool, database schema, NPC movement or rendering implementation is replaced. No new recovery worker, state machine or realtime transport is introduced.

## CI and reproducible commands

Use the existing Node 24/npm installation and Docker Desktop/Engine with an installed Chrome/Chromium executable (`BROWSER_PATH` when autodetection is unavailable). No paid provider or production secret is required.

```powershell
npm.cmd run lint
npm.cmd run test:all
npm.cmd run db:check
npm.cmd run test:db
npm.cmd run build:web
npm.cmd run test:interaction:e2e
$env:BROWSER_HARDENING_PHASE4='true'
npm.cmd run test:browser
npm.cmd run test:city:e2e
```

`test:interaction:e2e` builds the backend and uses a separate existing-project-compatible opt-in tier (`ELYQRETH_INTERACTION_E2E=true`, Node test-name pattern `P4 T09`). It owns its database/processes; it does not require a previous test or mutate production state. Standard `test:db` retains all earlier backend/Phase 4 cases. The existing CI workflow enables the T08 native hardening checks, adds the new tier and retains the separate Phase 3 E2E step. Node/build/database/browser bounds stay explicit; no messaging service or deployment workflow is added.

The new test writes a sanitized success report or failure diagnostic and screenshot to `INTERACTION_E2E_ARTIFACT_DIR` (default OS temp). CI stores only that prefixed test evidence, excludes hidden files and retains it for seven days using the official [upload-artifact action](https://github.com/actions/upload-artifact); its [v7 manifest](https://github.com/actions/upload-artifact/blob/v7/action.yml) uses Node 24. Credentials travel only in private IPC or native request headers and are redacted from failure diagnostics. GitHub-hosted execution/artifact upload is configured but **not executed by this local task**.

## Actual verification results

| Command | Actual result |
| --- | --- |
| `npm.cmd run lint` | PASS: maintained JS syntax, strict runtime-web TypeScript and backend no-emit check |
| `npm.cmd run test:all` | PASS: 207 frontend and 198 backend unit tests before the two new reference regressions |
| `npm.cmd test` after the reference fix | PASS: 209 frontend tests |
| `node --test tests/task-submission.test.js tests/interaction-session.test.js` | PASS: 30 focused owner/session regressions |
| `npm.cmd run db:check` | PASS after Windows sandbox user-profile restriction was resolved |
| `npm.cmd run test:db` after the Vite root fix | PASS: 122 PostgreSQL/API cases, including real database restart and four earlier native browser workflows |
| `node --test --test-name-pattern='P4 T0[2345678]' apps/api/test/database.integration.cjs` after the reference fix | PASS: all 18 affected Phase 4 compatibility/security cases |
| `npm.cmd run build:web` | PASS after final source fixes; disposable production bundle, maintained source preserved |
| `npm.cmd run test:interaction:e2e` | PASS: one comprehensive new native workflow, zero browser exceptions, all four actual execution admissions verified |
| `BROWSER_HARDENING_PHASE4=true npm.cmd run test:browser` | PASS: native keyboard, AX, focus, motion/reflow and existing city regression; exact PowerShell setup in evidence |
| `npm.cmd run test:city:e2e` | PASS: existing real Phase 3 queued/concurrent/cancel/failure/timeout/restart/reload workflow; five persisted executions |
| `node --expose-gc scripts/phase4-interaction-profile.mjs --out <report>` | PASS: synthetic 1/5/20 scope observations and 100 cleanup cycles with zero outstanding timers |

The full 122-case suite passed after the serving-root fix; after the subsequent one-line owner change, its 18 affected Phase 4 cases and the full frontend suite were rerun. Unrelated persistence/Phase 1-2 cases were not repeated without cause. Real Chrome is version 155.0.8059.85 on Windows x64 with Node v24.9.0. The same CI commands are wired for Ubuntu 24.04/Node 24; the remote GitHub run itself is not executed here.

The new native scenario recorded exactly five Task POSTs and four execution POSTs and verified five persisted Tasks/four executions/four strategy dispatches. GETs and CORS preflights are counted separately in the report; the crash lease wait uses the existing shared poller, not a test-induced API polling storm. The native hardening regression measured zero text-node mutations and zero additional requests for 100 unchanged selected-state updates. Load timings/heap checkpoints are descriptive local evidence, not a production benchmark or leak-freedom proof.

## Evidence and remaining limitations

Exact command outcomes, counts, environment, failure diagnoses and preservation checks are in [T09 verification](verification-evidence/t09-verification.json). See [native reliability report](verification-evidence/t09-live-browser.json) and [accessibility regression report](verification-evidence/t09-accessibility.json). Existing Phase 1-3 acceptance records and T08 measurements remain historical evidence; this task does not rewrite them or claim a new throughput benchmark.

Public production identity, per-caller quotas and general DLP remain existing release constraints. Hard-crashed native executions are not autonomously resumed or reclassified; expired leases remain conservative UNKNOWN observations. Navigation may cancel synchronous HTTP execution; provider termination/billing is not guaranteed. No worker/broker/Redis guarantees, paid live-provider tests, manual screen-reader certification, long-duration leak proof or production capacity promise is made. CI configuration is locally reviewed, not a claim of a completed remote run.

T10 remains planned and must make the final Phase 4 acceptance/release-readiness decision separately.
