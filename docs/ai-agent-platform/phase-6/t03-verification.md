# T03 authorization verification

Review: 2026-10-29, Asia/Bangkok. **PARTIAL**, production OIDC contract pending. [Principal model and complete authorization matrix](principal-authorization.md) distinguishes current verified local/service boundaries from production requirements. No new identity provider, account/tenant model, frontend session transport, runtime engine or deployment was introduced.

## Subsequent user-authorized authentication extension

This is the preserved earlier T03 verification snapshot. On 2026-10-30 the user authorized local username/password or OIDC, one mode per installation, and disposable real Keycloak testing. [Current contracts](authentication-modes.md) and [dual-mode verification](verification-evidence/dual-auth-verification.json) supersede the issuer-only blocker and lack-of-account statements below. No frontend session implementation or production deployment is implied.

## Recovery/audit and scope

The workspace retains all T02 implementation and prior Phase 1-5 changes. No applicable AGENTS.md was found in workspace or checked ancestors. There is no .git metadata: staged/untracked/diff state cannot be verified. Before edits, a SHA-256 snapshot of 671 files was stored outside the repository in `%TEMP%/elyqreth-p6-t03-baseline.json`. Final evidence lists exact T03 edits and preservation results. Existing configuration, owner-scoped repositories, DB migrations, Docker/CI and Canvas/frontend code remain in place. No production credentials or private key was added.

Audit reviewed T01 access/ownership decisions, T02 production closure/configuration contracts, current local credential guards, owner persistence, Task/Execution/native coordination/recovery/lease contracts, external adapter/source grants, activity APIs, browser polling/cleanup and actual test infrastructure. No production session/JWT/account verifier, separate runtime worker, public webhook or streaming transport exists. The user's T03 answer selects an existing OIDC/JWT issuer; issuer URL, API audience, allowed algorithms/key source and subject-to-owner/operation policy have been requested and remain missing. Existing account-free owner rows cannot be treated as OIDC users.

## Confirmed corrections

1. LocalAccessGuard previously accepted any interactionPrincipal present in the asynchronous context without binding it to the actual request or revalidating local credentials/configuration. It now requires the verified request object/method/path and current interaction token, configured owner and Agent grant. Unit tests cover copied/unbound contexts, rewritten routes, token rotation, owner/allowlist changes, production restriction and 25 concurrent request chains. This is hardening of an overly broad shortcut, not a claim that prior public HTTP cross-owner exploitation was demonstrated.
2. Shared local authentication now returns an immutable typed principal for one of the four actual configured credential audiences, with server-derived owner and safe local actor reference. Arbitrary caller-selected expected tokens do not create an authenticated audience. Identity/tenant/forwarded headers and cookies do not choose an owner. Typed metadata is not a new independently mintable authorization token or identity platform.

All existing exact-route authorization, transactional binding rechecks, per-owner queries, composite constraints, runtime claims, external source grants and safe response/error semantics are preserved. No production feature flag or local-only restriction was relaxed.

## Executed checks

Run from repository root using Windows npm.cmd. Commands redirected to private temporary logs and explicitly returned the underlying exit code. Expanded tool access was used only for the existing Docker/browser/esbuild harnesses; test database credentials and resources are random/disposable, never production. The database harness ignores developer DATABASE_URL and validates its owned resource labels before cleanup.

| Exact command | Exit | Evidence |
| --- | --- | --- |
| npm.cmd run build | 0 | Backend strict TypeScript production build; also repeated by test commands |
| npm.cmd run lint | 0 | Frontend JS syntax, strict frontend runtime types and backend typecheck |
| node --test apps/api/test/principal-authorization.test.cjs apps/api/test/interaction.test.cjs | 0 | 15 tests passed: 9 new principal/request-boundary tests plus 6 existing interaction tests |
| npm.cmd run test:api | 0 | 289 backend tests passed; existing Agent/Task/Execution/collaboration/auth/adapter/ingestion/tool/service authority tests included |
| npm.cmd run test:db | 0 | 210 real PostgreSQL/Nest/integration/browser tests passed; new forged-identity owner-isolation E2E plus existing cross-owner, external grants, recovery/rollback and browser authorization coverage |
| npm.cmd test | 0 | 228 frontend tests passed; authorization cleanup, late responses, reconnect/cursor/session isolation and city tests included |
| npm.cmd run build:web | 0 | Vite production bundle verified in a disposable directory; maintained city source untouched |
| npm.cmd run test:browser | 0 | Chrome156 browser/component/city smoke passed, zero exceptions |
| python docs/ai-agent-platform/phase-6/verification-evidence/check_configuration.py | 0 | Extended existing checker to 7 current contract/security documents, links, environment inventory and touched-file whitespace |
| git status --short | 128 | BLOCKED: supplied workspace has no Git metadata |
| git diff --check | 129 | BLOCKED: supplied workspace has no Git metadata; hash/whitespace fallback separately recorded |

See [machine-readable command and changed-file evidence](verification-evidence/t03-verification.json). Logs live at `%TEMP%/elyqreth-t03-{api,lint,db,web,browser,build-web}.log`. No npm script for separate streaming/worker security exists: those are existing polling, in-process runtime, tool/session and PostgreSQL authorization tests. No unexecuted production token/session test is counted as a pass.

## Security E2E disposition

| Scenario | Actual evidence / disposition |
| --- | --- |
| Agent isolation | PASS local scope: real owner A/B app fixtures reject foreign read/update/lifecycle; forged identity headers do not change authenticated owner |
| Task/Execution isolation | PASS local scope: nested reads/results/start/cancel reject foreign identifiers; own access remains available; foreign state/counts unchanged |
| Collaboration/delegation isolation | PASS local scope: foreign detail/list/activate and read snapshots/timelines/polls denied; persisted delegation stays REQUESTED; existing transactional correlation tests pass |
| External connection/mapping isolation | PASS existing local/internal scope: real PG/source grants reject forged/copied/cross-source/cross-owner references, overlapping IDs remain scoped, provider/native authority unchanged |
| Polling/reconnection | PASS existing local scope: every request reauthenticates, cursors cannot bypass owner scope, browser clears denied/stale data; there is no SSE/WebSocket subscription or production session |
| Runtime/service authority | PASS existing scope: factory-only context/tool grants, lease/claim/owner fencing, duplicate/cancel/recovery/rollback tests; no unauthenticated job/worker queue interface exists |
| Production OIDC user A/B, token expiry/revocation, issuer/audience/signature/rotation | BLOCKED / NOT RUN: existing issuer contract and owner/permission mapping missing; no production verifier introduced speculatively |
| Public tenancy | NOT SUPPORTED: no approved account/workspace model; no new multi-tenancy added merely for tests |

No critical newly demonstrated cross-owner HTTP bypass remains from the executed local suite. That does not establish production acceptance. Shared local credential audit is not per-person human attribution. Production access is deliberately unavailable until actual OIDC verification/authorization contracts and required tests can be implemented. T03 remains PARTIAL; T04 Frontend Production Access & Session Integration is the next planned roadmap task after T03 prerequisites, not started.
