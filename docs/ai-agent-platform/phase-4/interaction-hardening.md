# T08 - Security, Accessibility and Performance Hardening

**Follow-on T09:** the [E2E/reliability review](end-to-end-reliability.md) now verifies an actual active-runtime hard crash, committed-response loss and conservative restart observation. T08 results/limitations below remain its historical checkpoint; T09 does not add an autonomous recovery worker or accept production release.

Date: 2026-10-26, Asia/Bangkok. **COMPLETE for the approved local-development interaction scope.** T09/T10 and production release acceptance remain separate. This is a focused audit and remediation record, not a WCAG certification, penetration-test certification or production capacity guarantee.

## Audit boundary and baseline

Reviewed the [architecture](architecture.md), [ADRs](decisions.md), [backend interaction contracts](interaction-api.md), [client](frontend-interaction-client.md), [submission UI](task-submission-ui.md), [lifecycle controls](execution-lifecycle-controls.md), [results/history](execution-results-history.md), [T07 ownership/recovery](interaction-state-synchronization.md), actual source/tests and `.github/workflows/verify.yml`. T02-T07 have implemented local contracts and retained verification evidence; prompts alone were not used as implementation evidence.

The repository is vanilla JavaScript/Canvas with JSDoc/TypeScript checks, NestJS/Drizzle/PostgreSQL, explicit local credential audiences and one shared Phase 3 poller. There is no React, tenant login, worker queue, Redis or RabbitMQ integration. Root `dist/` is maintained source, not disposable build output. No applicable AGENTS.md was found in the workspace or accessible ancestors. Git metadata is absent; requested status/diff could not run. A new 370-file maintained-source hash inventory was captured before edits to preserve existing T07 and unrelated work.

Baseline evidence: the current T07 report records 207 frontend tests, nine T03-T07 integration cases and native Chrome checks. T08 independently reran affected checks. An initial real-browser component measurement observed 600 text-node mutations for 100 identical selected-state notifications, with zero extra HTTP requests. Baseline form label/validation and access Escape behavior already worked; they are retained, not claimed as new defects. Modal Tab boundary checks exposed loss of document focus at the native dialog boundary. History replacement discarded the focused row; closing/return actions needed explicit stable destinations. Existing narrow control borders measured 2.57:1 against the dark panel.

## Threat model and verification matrix

| Attack surface / threat | Existing mitigation and T08 verification | Result / limitation |
| --- | --- | --- |
| Unauthenticated Agent/Task/Execution requests | Explicit Bearer audience, timing-safe comparison, test/development and loopback bind/peer/Host restrictions; real HTTP absent/wrong/city token tests | PASS for approved local model |
| Foreign-owner Agent, Task or execution ID | Owner predicates, configured Agent allow-list, persisted enabled binding, execution-to-Task/Agent joins; two isolated configured owners exercised through actual HTTP | PASS; inaccessible resources return 404 |
| Guessed/mismatched execution IDs | Canonical UUID validation and compound resource membership; foreign Execution under an owned Task cannot be read/cancelled | PASS; no existence-bearing object IDs in denied bodies |
| Unauthorized Start/Cancel | Global exact-route interaction guard plus service/transaction revalidation, Task/Execution versions, native coordinator authority | PASS; no frontend permission bypass |
| History/result/recovery disclosure | Authorized Agent scope, exact-key lookup, bounded keyset history, safe DTOs; foreign-owner GETs/results/cancellation/recovery denied while legitimate owner still succeeds | PASS; production tenant identity absent, not simulated |
| Binding revoked during mutation | Existing transaction-level binding validation; persisted binding removal and authorization-to-commit revocation tests | PASS; no Task/Agent/NPC deletion introduced |
| Untrusted instructions / forged fields | Backend DTO whitelist, UUID/key checks, instruction/control-character/credential-pattern and size checks, 64 KiB HTTP body limit; client validation complements backend | PASS; no arbitrary provider/tool/owner field accepted |
| Duplicate Create / conflicting payload / lost response | Durable owner-scoped idempotency and payload conflict detection; concurrent HTTP tests and exact recovery | PASS; no automatic mutation retry |
| Duplicate Start / cancellation race | If-Match versions, single-flight coordinator and existing native reconciliation/quarantine; persisted terminal winner tested | PASS; quarantine is preserved, not bypassed |
| XSS / unsafe links / embedded resources | Results and names rendered as text; only text and typed numeric statistics allowed, no HTML/Markdown/URL execution; native malicious-text and large-output tests plus browser request-origin assertions | PASS; no rich renderer introduced |
| Credentials, internal errors and provider metadata | Existing allow-listed serializer/interceptor, text-result opt-in, safeText rejection patterns, closed error codes, provider fields removed from interaction results | PASS for tested contracts; not a general DLP guarantee |
| Session switch / revoked credential / stale response | Volatile credentials, generation fencing, 401 cleanup, scoped 403/404 data erasure, obsolete reads aborted, explicit disconnect clears owner caches/journal | PASS in local capability model; no production session platform |
| CSRF / cross-origin access | Explicit non-cookie Authorization, client `credentials:omit`, no-referrer/no-store/redirect:error, exact configured Origin checks, restricted CORS headers | PASS for inspected policy and existing HTTP Origin tests; no ambient cookie session to protect |
| Request abuse / uncontrolled recovery | Bounded pages/bodies/deadlines, no POST replay, single shared activity scheduler/backoff, bounded restore attempts and history invalidation; profiles and deterministic tests | PASS for bounded client behavior; no per-caller server quota/rate limiter |
| Sensitive logs / support metadata | HTTP logs use route templates, no body/query/credential logging; bounded request IDs and closed safe errors; native tests assert fixture secrets absent from output | PASS for reviewed paths; no external log-system audit |

The new T08 HTTP case creates a genuine completed execution for owner B, proves owner A cannot access its Agent, Task, status, history, execution, result, exact-key lookup, Start or Cancel, verifies mismatched execution membership under A's Task is rejected, and checks reverse owner isolation. It confirms B's result remains readable, the persisted result remains SUCCEEDED, and no duplicate execution was created. These are configured local owner identities in two authorized Nest applications, not invented human/tenant accounts.

## Focused fixes

1. Resident-list keyboard activation now focuses the existing inspector heading. Escape/Close returns focus to the selected resident, or the existing Residents toggle when the roster is hidden. Canvas rendering/selection identity is unchanged.
2. The existing access/cancellation dialogs wrap Tab and Shift-Tab within visible enabled controls. Escape remains available. Dialog close clears credential input and dismisses cancellation confirmation consistently. Cancel Back/Escape returns to the target action; a terminal outcome uses the lifecycle refresh control as fallback.
3. After connecting, focus goes to a stable Task heading while eligibility loads, rather than an input that may become disabled. Invalid input is associated with the existing help/error region and explicitly focused on validation failure.
4. History refresh preserves the focused execution row by stable ID; if it disappears, focus moves to the existing history summary. Returning from historical results focuses the current result heading instead of a button that becomes hidden.
5. Stable summary/reference/status/receipt text now uses conditional assignment, reusing the existing announcement helper. Identical selected-state updates no longer replace those text nodes.
6. Interaction-only focus rings, 24px minimum control targets, stronger control boundaries, scroll containment/margins and reduced-motion overrides were added. Legacy dialogs, sprites, navigation, movement and environmental animations are not restyled or redesigned.

No production backend code, endpoint, migration, execution semantics, tool/provider policy, dependency or global state framework changed.

## Accessibility review

Criteria references use the normative [WCAG 2.2 recommendation](https://www.w3.org/TR/WCAG22/). The scope is the Phase 4 interaction flow. Testing uses native Chrome keyboard events, accessibility-tree inspection, real component/API workflows and geometry checks, not a formal conformance audit or a claim that a screen reader was manually operated.

| Area / relevant criteria | Evidence and remediation | Status |
| --- | --- | --- |
| Equivalent NPC entry; keyboard/no trap (2.1.1, 2.1.2) | Existing Residents DOM buttons provide the canvas equivalent; Enter selects, heading receives focus, Escape returns; forward/backward modal traversal verified | PASS in tested Chrome flow |
| Focus order/visibility (2.4.3, 2.4.7) | Explicit inspector/dialog/history/result destinations, visible icy-white outlines, real Back/Escape and current-result focus assertions | PASS |
| Focus not obscured/reflow (2.4.11, 1.4.10) | Scrollable inspector/output, scroll margins, 320px component reflow and existing native 390px dialog/result tests | PASS for checked viewports; not exhaustive zoom/device coverage |
| Name/role/value and relationships (1.3.1, 4.1.2) | Native dialog with labelled heading; textbox label and Save Task/button names verified in Chrome AX tree; semantic history list/buttons and result metadata | PASS for inspected semantics |
| Error identification/instructions/status (3.3.1, 3.3.2, 4.1.3) | Required labelled multiline input, help/error association, aria-invalid, polite status/loading regions; stable live-region text is not rewritten on unchanged state | PASS for tested transitions |
| Contrast/non-text contrast (1.4.3, 1.4.11) | Existing text/muted/error tokens reviewed, narrow interaction borders strengthened | PASS for sampled tokens; gradients/compositing are not a whole-page certification |
| Color-independent status (1.4.1) | Existing textual lifecycle/action/availability labels and shape-based NPC status remain intact | PASS by code review and existing status tests |
| Target size (2.5.8) | Scoped minimum 24px dimensions; visible controls measured in real browser | PASS for measured controls |
| Motion | Reduced-motion emulation plus existing Phase 3 motion policy; interaction transitions/animations disabled under preference | PASS for interaction UI; world animation remains user-controlled by existing simulation controls |

Calculated relative-luminance contrast against opaque panel `#182534`: Icy White `#F2F9FF` 14.61:1, muted `#B5C3D0` 8.63:1, error `#FF809B` 6.51:1. Control border changed from `#526576` (2.57:1) to scoped `#7B91A6` (4.76:1). Disabled controls remain identifiable and explained; they are not counted as enabled text contrast failures. No formal WCAG AA certification or manual NVDA/JAWS/VoiceOver pass is claimed.

## Performance and resource investigation

Environment: Windows x64, Node v24.9.0, AMD Ryzen 5 5600H, 12 logical CPUs, approximately 16.5 GB total physical memory; installed Chrome 155. Detailed environment and samples are retained in the evidence below. Test timing reflects local load/JIT and is descriptive, not a production SLA.

**Measured optimization:** real Chrome MutationObserver over child/text changes for 100 identical panel selections: **600 before, 0 after**, with **zero additional HTTP requests** in both runs. The measured synchronous loop was 7.5ms before and 5.0ms in the final after sample. Timing is noisy and not an asserted threshold. Attribute writes, the whole city DOM and GPU work are not part of that mutation count.

**Interaction load:** the new `phase4-interaction-profile.mjs` uses actual Session/client/owner code with controlled RUNNING Task/Execution/result contracts. It validates the selected Agent, real normalized RUNNING detail and PENDING result on every iteration. It tests 200 selections each across 1, 5 and 20 Agent-linked scopes with result/history sections open. Total requests were 7, 1,010 and 1,040 respectively; repeated selection of the same scope coalesces, while switching scope intentionally authorizes/reads only that Agent's current details and bounded page. There is no per-row result fanout. Results/history retain only the selected result and one page. This is synthetic concurrent observation, not 20 real providers executing simultaneously.

**Shared synchronization:** existing profiling exercised 1/10/20/25/50/100 projected Agents for 100 sweeps each. Requests were 100/100/100/200/300/500, matching pages of 20, with no connection per NPC. Existing manifest capacity is 20 linked slots; rows beyond 20 are unbound projections. The observed p95 processing times were approximately 0.71/1.15/1.03/1.79/2.96/4.33ms. Native T07 tests separately exercise independent real Agent execution observation and network reconciliation with the existing two-instance fixture; the coordinator's single-flight policy is preserved.

**Rendering:** existing real-browser CDP/rAF profiling sampled 120 frames at 0/1/10/20 projections with four existing visible residents. Mean frame intervals were 19.72/20.00/18.47/14.93ms; p95 25.2/33.3/25.1/16.8ms. These runs are evolving-world samples, not comparable-world before/after speedup or 20 linked visible NPC capacity guarantees. City movement, environment, camera and mobile smoke remained functional with zero browser exceptions.

**Cleanup:** 100 interaction create/select/open-history/dispose cycles asserted zero remaining request deadline timers after each. Forced-GC heap checkpoints stayed roughly 8.1-8.6MB. Existing browser integration profiling ran 300 mount/dispose cycles: listener count remained 91; DOM nodes settled at 753 after the first checkpoint; JS heap settled around 4.75-4.76MB. Existing shared-runtime synthetic profiling also ran 300 cleanup cycles with zero remaining timers/listeners. These short, forced-GC investigations do not establish long-term leak freedom or native/GPU memory behavior.

No API request enters the animation loop; shared lookup/indexing, versions and invalidation rules are unchanged. No new cache, polling interval, framework or rendering resource is introduced.

## Verification evidence

See [command results and preservation inventory](verification-evidence/t08-verification.json), [browser before](verification-evidence/t08-browser-before.json), [browser final](verification-evidence/t08-browser-final.json), [interaction profile](verification-evidence/t08-interaction-profile.json), [shared synchronization profile](verification-evidence/t08-sync-profile.json) and [browser frame/heap profile](verification-evidence/t08-render-profile.json).

| Actual command | Outcome |
| --- | --- |
| `npm.cmd run build` | PASS, existing backend TypeScript build |
| `npm.cmd run lint` | PASS, syntax plus frontend strict TypeScript and backend no-emit check |
| `npm.cmd run test:api` | PASS, 198 backend unit tests |
| `npm.cmd test` | PASS, 207 frontend/security/synchronization/city tests |
| `node --test --test-name-pattern='P4 T0[28]' apps/api/test/database.integration.cjs` | PASS, nine real PostgreSQL/HTTP security, ownership, idempotency, race and history cases |
| `node --test --test-name-pattern='P4 T0[34567]' apps/api/test/database.integration.cjs` | PASS, nine client/owner/native-browser compatibility cases |
| `node --test --test-name-pattern='P4 T0[56] real browser' apps/api/test/database.integration.cjs` | PASS, two final native cancellation/result/history focus checks |
| `npm.cmd run build:web` | PASS, disposable production bundle, maintained source preserved |
| `BROWSER_HARDENING_PHASE4=true npm.cmd run test:browser` | PASS, native keyboard, AX, focus, malicious-name text, 320px reflow, motion preference and repeated-selection checks; see PowerShell environment setup in evidence |
| `BROWSER_HARDENING_PHASE4=true BROWSER_PROFILE_PHASE3=true npm.cmd run test:browser` | PASS, additional real browser frame/heap/DOM samples |
| `node --expose-gc scripts/phase3-profile.mjs --out <report>` | PASS, shared batching/cleanup and actual local timings |
| `node --expose-gc scripts/phase4-interaction-profile.mjs --out <report>` | PASS, interaction load/resource assertions and actual local timings |

The first exploratory browser helper runs exposed test-fixture issues (native Enter event needed text; a second component required a unique label ID) before baseline collection. The added modal Tab check then failed and prompted the scoped wrap fix. An initial profile fixture omitted required execution eligibility; it was corrected and assertions added to ensure RUNNING/result contracts actually load. Failed exploratory runs are not reported as passing checks. No production data, credentials or paid APIs were used.

## Risk register and remaining work

| Severity | Remaining limitation | Disposition |
| --- | --- | --- |
| High if publicly exposed | Fixed-owner local capabilities are not production person/tenant authentication or deployment protection | Public production release remains blocked by existing architecture; do not expose these APIs publicly |
| Medium | No server per-caller rate limiter/quota; a compromised authorized local capability can create excessive saved Tasks | Keep loopback/default-deny scope; define production identity/quota requirements separately rather than add unrelated infrastructure |
| Medium | Opted-in model text can contain private content not recognized by safeText patterns; prompt injection is not solved by output escaping | Keep explicit text opt-in and existing provider/tool allow-lists; no unrestricted tools, prompts or runtime payloads exposed |
| Medium | Synchronous execution can be interrupted by navigation; cancellation quarantine/provider termination semantics remain native | Preserve reconciliation, uncertainty and quarantine; no detached execution guarantee |
| Low | Manual assistive-technology reading order, exhaustive zoom/contrast/device and long-duration GPU/browser memory testing not performed | Documented follow-up for T09/T10 acceptance; no WCAG certification claim |
| Low | No fresh real backend restart, live paid-provider or production load test in this hardening pass | Reused existing recovery tests; report as unverified, not passed |
| Low | No Git metadata | Hash-based preservation inventory; no clean-tree or Git diff claim |

No unresolved Critical/High defect was found within the approved local interaction scope. T08 does not accept Phase 4 for release. Next: **T09 - End-to-End Workflow and Reliability Tests**, separately authorized. T09/T10 are not implemented here.
