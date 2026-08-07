# Task 07 operations runbook

Date: 2026-07-31

Current status: compatibility-preserving inactive deployment candidate;
non-legacy production activation remains a separate gated operation.

Use `deployment-readiness.md` for the release boundary and
`activation-runbook.md` for a later controlled rollout. A green deployment does
not authorize editing `utils/task07_media`, applying bucket CORS, or running a
production backfill.

## Non-negotiable safety rules

1. Use exact project `demo-fnd-perf` and loopback emulators for browser, rules,
   callable, and backfill validation.
2. Use read-only `/home` for ordinary browser evidence. Use an isolated demo
   board only for board-specific tests; do not manipulate an unrelated board.
3. Run one heavyweight workload at a time, one browser worker, serial Node
   tests, and Jest `--runInBand`.
4. Every long command must have a hard deadline and own its children. After it
   exits, verify that its Node, Java, browser, and emulator processes and ports
   are gone.
5. Never stop an unknown process or reuse an occupied validation port.
6. Never use bare `firebase deploy`. Review and verify one deployment plane at
   a time.
7. Do not accept or rewrite a performance baseline from a partial run.
8. Do not delete legacy originals, canonical objects, or lifecycle ledgers as
   a rollback shortcut.

`npm run perf:media` is bounded by
`FND_TASK07_MEDIA_RUN_TIMEOUT_MS` (15 minutes by default, 30 minutes maximum).
Its fixture, callable, rules, and directory-query setup stages have shorter
internal deadlines. Timeout cleanup targets only the spawned process tree and
then verifies release of the checked-in emulator ports.

## Before local validation

Record the candidate and toolchain:

```powershell
git status --short --branch
node --version
npm.cmd --version
firebase.cmd --version
Get-NetTCPConnection -State Listen | Where-Object {
  $_.LocalPort -in 3000,3001,4000,4400,4500,5000,5001,5002,8080,9099,9150,9199
}
```

Confirm that no stale Task 07 Node, Java, browser, or emulator process is
running. If a previous run ended abnormally, inspect its last report/log tail
and the owning PIDs before running the smallest focused gate again.

## Resource-bounded gate sequence

Run each group separately and stop on a correctness, authorization, cleanup,
or resource-ownership failure.

### 1. Static boundaries

From `frontend`:

```powershell
npm.cmd run perf:check-firestore-imports
npm.cmd run perf:check-callable-registry
npm.cmd run perf:check-query-contracts
npm.cmd run perf:check-shared-config-boundaries
npm.cmd run perf:check-user-data-boundaries
npm.cmd run perf:check-media-boundaries
```

### 2. Functions

From `frontend/functions`:

```powershell
npm.cmd run lint
npm.cmd test
```

### 3. Frontend and tooling

From `frontend`, with `CI=true`, run serially:

```powershell
npm.cmd test -- --watch=false --runInBand --watchman=false
npm.cmd run perf:test
npm.cmd run build:production
npm.cmd run verify:start
```

`verify:start` must bind only its owned port 3001, receive HTTP 200 from
`/home`, stop its process tree, and prove port release.

### 4. Rules and callables

Run the focused Firestore/Storage rules suite under an exact
`demo-fnd-perf` `emulators:exec` owner with Java 21. Then run the Task 07 Node
and Jest suites serially:

```powershell
npm.cmd run test:task07
npm.cmd run perf:rules
```

### 5. Bounded media integration

Only after the smaller gates are green:

```powershell
npm.cmd run perf:media
```

This owns its Playwright worker, static server, Firebase emulator tree, marker,
generated config, and fixed ports. It must produce a final report and release
all of them. If it fails because of host/emulator infrastructure, preserve the
report and logs, verify cleanup, and do not silently rerun it.

Performance threshold misses are evidence to review. They block the inactive
deployment only when they expose a functional regression, trigger storm,
resource leak, crash, or user-visible breakage.

## Media lifecycle diagnostics

For an emulator canary, record operation ID and asset ID and verify:

```text
prepared -> finalizing -> ready/fallback -> entity commit -> referenced
```

For replacement:

```text
new referenced -> previous superseded -> cleanup pending -> cleaned/retained
```

`retained` is a safe terminal outcome for a legacy object whose cross-record
ownership cannot be proven atomically. Prefer a bounded orphan over deleting a
possibly shared live object.

Before retrying, verify actor, owner, kind, entity, reference scope, revision,
manifest plan, object generation, exact entity reference, cleanup attempts,
lease timestamps, and reason. Never manually delete bucket objects to resolve
an ambiguous commit.

## Demo-only backfill

The checked-in planner accepts only `demo-fnd-perf` and loopback emulators:

```powershell
npm.cmd run task07:media-backfill:plan -- --project demo-fnd-perf --json
```

It is not authorization or tooling for production writes. Production migration
requires a separate reviewed implementation with backup/restore, resumable
receipts, rate limits, dry-run approval, reconciliation, and rollback.

## Host or emulator failure response

1. Do not automatically rerun the last heavyweight command.
2. Capture the exact command, start/end time, last output, report, and whether
   the deadline fired.
3. Verify owned process trees and ports are gone; do not terminate unrelated
   processes.
4. Inspect memory, page file, disk space, and relevant Windows events if the
   host became unresponsive.
5. Reduce the next diagnostic to one serial focused gate.
6. Stop and investigate the host if the same bounded failure repeats.

## Production operations

For an inactive release, follow the explicit Functions, indexes/rules, and
Hosting order in `deployment-readiness.md`. Leave CORS and the Task 07 control
unchanged. For later activation, use explicit canary allowlists and the staged
mode sequence in `activation-runbook.md`.
