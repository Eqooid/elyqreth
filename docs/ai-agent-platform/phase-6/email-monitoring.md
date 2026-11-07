# Optional T11 email monitor

On 2026-11-06 the user authorized preparing email monitoring while preserving existing features. This adds a **separate host-side tool**, not an API dependency or a deployed service. SMTP submission and alert-state behavior are locally tested. Real sender/recipient configuration, incident ownership, inbox delivery, host availability monitoring and operational approvals remain deployment gates. No real external email was sent. T11 remains PARTIAL; T12 now has separate [local immutable-artifact preparation](immutable-promotion.md), still PARTIAL with publication/deployment closed. [Follow-up evidence](verification-evidence/email-monitoring-verification.json) and [T11 runbooks](observability.md) distinguish those scopes.

## Isolation and behavior

`scripts/production-monitor.mjs` uses existing read-only Docker Compose log access and the namespace-only readiness probe. It cannot create Tasks, start Executions, change runtime admission, replay external events, write application tables, or stop/restart services. There are no API/frontend imports of the monitor. API, worker, authentication, collaboration, migration, edge and city source/configuration are unchanged. SMTP failure does not gate application readiness. No dependency was added.

Modes: `check` validates private configuration without networking; `once` performs one cycle; `watch` repeats cycles without overlap. Each cycle collects at most 1000 log lines from the configured window (2MiB command-output ceiling), calls one existing private readiness probe, then optionally submits one email. Docker commands have 10s limits; the private fetch has 2.5s and SMTP has one total 1..15s deadline. Polling defaults to 60s and cannot be shorter than 30s. A watch cycle sleeps after completion, so its actual cadence includes processing time. SIGINT/SIGTERM stops the monitor after bounded current work and releases its private lock; it sends no signal to the application.

The existing fixed-label detector supplies conditions. Failed log collection, unavailable readiness and truncated/malformed/unknown input have separate fixed conditions; incomplete input never silently proves health. Current READY overrides a historical database-failure log in the overlapping slice. No SQL/DB credentials, prompts, bodies, provider results, task IDs, user IDs or raw log lines enter email. Each notice contains a stable notice ID, fixed condition names, timestamp and runbook reference. Mail addresses and SMTP credentials are never printed by the tool.

The first observed condition generates an alert. Identical conditions are suppressed until the repeat interval (default one hour). A changed condition set produces an update. Two consecutive clear samples are required before a condition-cleared email; it states that disappearance does **not** prove Execution success. Overlapping windows mean a historic event can remain active until it ages out. These are proposed operational defaults, not approved SLAs. A flapping condition set can generate updates, at most one submission per cycle; approve cadence/rules against real workload before activation.

Definite SMTP failures retry at most three times per notice, after at least 60s then 300s. Exhaustion is visible and stops retries for that notice. Lost acknowledgement after DATA, or a saved inflight attempt after process interruption, is **uncertain** and requires operator review instead of automatic resend. Exactly-once mail/inbox delivery is not promised. SMTP acceptance is not proof of inbox delivery. State is private and bounded, with atomic replacement, file fsync and POSIX directory fsync. Disk/OS/filesystem failures and mailbox receipt still require deployment drills; Windows ACL/durability must be validated on the selected host.

## SMTP contract

Supported: **implicit TLS SMTP submission** (normally port 465) with verified certificate/hostname, minimum TLS1.2 and AUTH PLAIN inside TLS. SMTP password is supplied by a protected file. Optional `caFile` supports an explicitly approved private CA; there is no disable-verification option. This narrow contract follows [RFC8314](https://www.rfc-editor.org/rfc/rfc8314) and [SMTP reply/DATA rules](https://www.rfc-editor.org/rfc/rfc5321), using Node TLS verification. Plain SMTP, STARTTLS-only servers, OAuth-only SMTP, attachments, arbitrary templates, multiple transports and provider-specific SDKs are unsupported. Confirm the chosen provider supports this contract before configuring it; no provider or paid account is selected automatically.

## Configuration inventory

All fields belong to the host monitor, not backend environment variables or public frontend configuration. No configuration is installed automatically. Unknown fields fail closed. Use the [disabled example](../../../docker/monitor.example.json), copied outside the repository to a private operator directory; correct all absolute paths for the actual host (Windows paths in JSON require escaped backslashes).

| Field | Default / constraints | Classification |
| --- | --- | --- |
| enabled | Explicit boolean; example false. False performs no Docker/SMTP activity | Private operational flag |
| intervalSeconds | 60; integer30..3600 | Private operational tuning |
| windowSeconds | 300; integer60..3600, at least interval | Private operational tuning |
| repeatSeconds | 3600; integer300..86400, at least window | Private operational tuning |
| healthyChecks | 2; integer2..10 | Private operational tuning |
| stateDirectory | Required absolute non-root private directory; never shared with application data | Private operator path |
| composeFiles | 1..3 absolute reviewed Compose paths, in existing approved order | Private operator paths |
| composeEnvFile | Optional absolute reviewed non-secret Compose substitution file | Private operator path |
| email.enabled | Explicit boolean; example false. False previews without SMTP or delivery-state changes | Private operational flag |
| email.host / port | Approved SMTP DNS/IP and integer1..65535; port defaults465 | Private service configuration |
| email.username | Required ASCII login, max160 characters when email enabled | Private identity |
| email.passwordFile | Required absolute protected file, max4KiB; one optional trailing newline | **Secret reference**, contents secret |
| email.from / to | One sender and1..5 distinct simple ASCII recipient addresses; no header injection | Private personal/service metadata |
| email.caFile | Optional absolute regular CA certificate file, max64KiB | Private trust configuration; certificate public |
| email.timeoutMs | 10000; integer1000..15000 total SMTP deadline | Private operational tuning |

POSIX configuration/secret/state files must be owned by the running operator and mode0600 or stricter; state directory0700. A public CA certificate may be readable by others, but must be owned by root/the operator and not group/world writable. Symlinks, nonregular files, hard-linked inputs, oversized inputs and canonical-path aliases are rejected. Windows operators must explicitly restrict directory/file ACLs to the designated monitor account/administrators; POSIX permission emulation is not an ACL audit. Keep credentials/state outside source, web roots, backup export directories and application mounts. `.gitignore` additionally excludes `.monitor/`, `*.monitor.private.json` and `*.smtp-password`; that is defense in depth. Never paste SMTP passwords into chat, commands, build arguments or the JSON configuration itself.

## Prepare and preview

Prerequisites: approved release checkout/artifacts, Node24 and existing lockfile dependencies, compiled API policy (`npm run build`), Docker Compose access to the selected installation, reviewed private configuration and an authorized operator. Docker access is powerful host authority; do not casually grant membership or expose its socket remotely. The tool uses that existing authority only for fixed log/exec-read operations. It does not open a new metrics/admin port or relax networking.

Create the private configuration outside the checkout using the example. Set actual absolute Compose/state/env paths. Leave `email.enabled=false`; set `enabled=true` only to permit checks. The examples below use placeholder operator paths; no files or accounts are created by documentation.

```powershell
npm.cmd run build
node scripts/production-monitor.mjs check --config C:\protected\elyqreth.monitor.private.json
node scripts/production-monitor.mjs once --config C:\protected\elyqreth.monitor.private.json --dry-run
```

```sh
npm run build
node scripts/production-monitor.mjs check --config /protected/elyqreth.monitor.private.json
node scripts/production-monitor.mjs once --config /protected/elyqreth.monitor.private.json --dry-run
```

`check` does not connect to Docker or SMTP and prints only validity/enabled flags. Preview never sends, updates delivery history or consumes retry attempts. Exit0: disabled, quiet preview or successful/suppressed monitoring; exit2: preview found conditions; exit1: configuration/lock/check/state failure, pending failed submission, uncertain delivery or retry exhaustion. `retry_wait` reports its state without a new submission. Preserve stdout/stderr for a separate supervisor and alert on persistent errors or missing monitor runs; the monitor cannot email about its own total host loss or unavailable SMTP channel.

## Explicit activation and scheduling

Before activation, designate the incident owner, approve the actual sender/recipient/SMTP target, provision a dedicated minimum-permission SMTP credential privately, confirm provider compatibility, and approve cadence/repeats, log access, retention and escalation. Configure the credential file without displaying its contents. `check` verifies configured file access but does not prove SMTP connectivity. Set `email.enabled=true` only after notification authorization; a subsequent `once` or `watch` can then send real messages. There is no automatic test email or startup email.

```sh
node scripts/production-monitor.mjs watch --config /protected/elyqreth.monitor.private.json
```

The same command works in PowerShell with a Windows absolute config path. Run either one supervised `watch` process **or** an approved scheduler invoking `once` at the selected cadence, not both. A private exclusive lock prevents overlapping monitors. No scheduler/system service is installed here. Use existing approved host supervision, least-privilege execution, log rotation and restart policy; scope its stop command to the monitor process, never the API. Check missing-run/host-loss from an independent off-host mechanism before production acceptance. Single-host monitoring cannot detect a host that has lost power or connectivity.

For real acceptance, use an isolated authorized installation, induce a safe readiness failure, verify receipt by the designated inbox/owner, restore readiness, and verify a clear notice after the required checks. Then test SMTP rejection/outage, bounded retries, restart, uncertain outcome review, process/host loss and escalation. Local fixtures do not substitute for this inbox/delivery/ownership proof. No live production failure injection is authorized by this guide.

## Delivery incidents and rotation

Read only the tool's safe `monitor.*` JSON events and private state. SMTP_CONFIGURATION means check secret-file access/format; SMTP_TLS means verify hostname/trust/expiry; SMTP_AUTHENTICATION means review/revoke/rotate the dedicated credential; SMTP_REJECTED means review server/sender/recipient policy privately; SMTP_UNAVAILABLE means connectivity/deadline. Do not log raw server responses or weaken TLS. Fix configuration and restart **only the monitor**; configuration is loaded at startup, password/CA contents are re-read for each submission.

An `uncertain`, `exhausted` or leftover `monitor.lock` must not be cleared blindly. Stop/suspend scheduling, verify no live monitor owns the private directory, preserve private state, review the notice ID with provider/inbox records, and decide whether resend is safe. If a deliberate notification-history reset is approved, archive the state file privately and start with no state file; current active conditions may send again. Remove only the exact owned stale lock after ownership verification. No automatic deletion/reset command is provided. Do not remove the state directory or touch application Tasks/Executions, runtime leases or database rows.

## Verification and limitations

Run `node --test apps/api/test/email-monitor.test.cjs apps/api/test/operational-signals.test.cjs`. Tests use synthetic data and disposable loopback TLS SMTP fixtures: real encrypted authentication, accepted content, untrusted certificates, rejection, stalled/malformed responses, missing DATA acknowledgement, suppression/clear/retry/exhaustion, saved inflight recovery, state-write failure, private exclusive state and disabled CLI. Collector command behavior is fixture-tested; actual operator Compose settings are not supplied or activated. Existing frontend and backend regressions are recorded in the evidence file. No real emails, credentials, infrastructure, scheduler, production database or application deployment are created.

This monitor does not add backup scheduling/freshness probes, host disk/certificate monitoring, distributed tracing, a notification dashboard, a durable multi-host message broker or a guaranteed mail delivery service. Existing backup/runbook signals and independent host monitoring remain acceptance prerequisites. Existing application features continue independently when this tool is disabled, stopped or failing.
