# Task 08 Step 6 — Attempt 15 fail-closed parent-loss shutdown

Status: `DONE_WITH_CONCERNS`  
Date: 2026-09-01  
Checkout: `C:\Users\Marco\OneDrive\git_projects\fnd-devs`  
Branch / baseline HEAD: `devs` / `9c7fcc7c5799a458768512b7cbab49e4d9b301a9`  
Dispatch tracked/source fingerprints: `e37fec10f6696eea6efcb1b58cd1d5af38bd94fefd809f8b83e53c55db2b959f` / `e02a2684845ba36fbd3ddff9db6193f51ffb12cce14a631e3b9758c43e6b31a4`.

## Root cause and RED evidence

Attempt 14 made normal parent IPC disconnect graceful, but after the parent had gone it still returned to the event loop when the Firebase CLI finished initialization without a SIGINT handler or when that handler threw. The parent could no longer run its exact-tree fallback, so the detached supervisor and emulator descendants had no terminal owner.

The first production-unchanged focused RED command was:

```text
node --test --test-name-pattern="makes parent loss terminal" scripts/performance/firebase-emulator-supervisor.test.js
0 passed, 2 failed
```

Both failures were the required missing terminal transition: the injected exact-tree fallback had zero calls instead of the expected one. The expanded production-unchanged supervisor run then reported `10/16` passed and `6/16` failed: the two parent-gone terminal cases, the prior throwing-handler characterization upgraded to require fallback, and three not-yet-implemented exact command/launch-failure/timeout helper contracts.

## Windows semantics and minimal repair

- Node documents that `detached: true` on Windows allows a child to continue after its parent exits, so `process.exit()`, `exitCode`, or supervisor-only termination cannot prove descendant cleanup: <https://nodejs.org/api/child_process.html#optionsdetached>.
- Microsoft documents that `taskkill /PID <pid> /T /F` ends the exact specified process and child processes it started: <https://learn.microsoft.com/sk-sk/windows-server/administration/windows-commands/taskkill>.
- Added a child-side fallback rooted only at the supervisor's trusted `process.pid`. It launches exactly `taskkill.exe /PID <supervisorPid> /T /F`; it performs no port lookup, process-name lookup, arbitrary PID scan, or sibling/ancestor targeting.
- The helper has a 10-second bound, writes the exact root/reason diagnostic before launch, exits terminally if launch throws, the helper errors or returns while the supervisor survives, or the deadline expires, and cleans helper listeners/timers exactly once. Process, spawn, timeout, clear-timeout, diagnostics, and terminal exit operations are injected for unit tests.
- Parent loss defers fallback until synchronous Firebase CLI initialization completes. A final missing handler or throwing handler removes the supervisor-owned message/disconnect listeners and requests the fallback once. Duplicate/late disconnects and messages cannot request it again.
- Normal registered-handler disconnect still emits one Firebase CLI SIGINT and never launches fallback. Connected explicit requests retain accepted/rejected acknowledgements, including a throwing handler returning its reason so the still-connected parent retains its existing exact-tree fallback ownership.
- Attempt 13's detached console isolation and parent-owned bounded taskkill path were not changed. No product, StatsBars, resource, Task 08 metric, or unrelated source was changed.

## Focused unit and owned failure-path integration evidence

Final supervisor coverage is `19/19`. It includes the two exact parent-gone terminal outcomes, exact `taskkill.exe` command/arguments/options/root ownership, synchronous launch failure, bounded timeout, exactly-once late-event behavior, listener cleanup, connected rejection, and no fallback on the normal graceful path.

The Windows-only test fixture allocates one loopback port, starts one detached supervisor and one descendant, records those exact owned PIDs, disconnects only that supervisor's IPC, and polls only those recorded identities and owned port. Its cleanup fallback, if ever required, can target only the recorded supervisor root. Final focused-run evidence was:

```text
OWNED_PARENT_LOSS_PROBE {"case":"no-handler","supervisorPid":26248,"descendantPid":27064,"port":50438,"boundedMs":479,"supervisorGone":true,"descendantGone":true,"portStablyFree":true}
OWNED_PARENT_LOSS_PROBE {"case":"throwing-handler","supervisorPid":7940,"descendantPid":24748,"port":50439,"boundedMs":485,"supervisorGone":true,"descendantGone":true,"portStablyFree":true}
```

No pre-existing PID or port owner was targeted.

## Real normal parent-disconnect recheck

Used command-scoped JetBrains OpenJDK `25.0.2` and started one owned `npm.cmd run perf:emulators` tree after a fail-closed free-port check. After all emulators were ready, the exact rooted tree was captured:

- PTY PowerShell root `25820`
- npm/cmd chain `8536 -> 8112 -> 12028`
- exact `node scripts/performance/emulators.js` wrapper `3756`
- detached Firebase supervisor `25956`
- Firestore Java `15996`
- Storage Java `25552` and conhost `10612`

While this tree was live, deterministic seed plus independent verification passed at `9,139` documents and the approved hash. Immediately before termination, PID `3756` was revalidated as `node.exe`, parent `12028`, exact command line `node  scripts/performance/emulators.js`. Only PID `3756` was force-terminated at `2026-09-01T21:03:26.6943974+02:00`.

Parent IPC loss invoked the normal Firebase CLI SIGINT path. Every captured PID was gone and all harness ports were stably free by `2026-09-01T21:03:55.2088374+02:00`, a conservative `28.515s` termination-to-proof bound including tool handoffs. No descendant, port owner, or unrelated process was signalled. The intentional wrapper kill left the exact task-owned `.firebase.performance.generated.json`; its expected loopback Hosting/Firestore identity was checked, then only that file was removed with the existing owned cleanup helper.

## Fresh automated verification

- Syntax: `node --check` passed for the supervisor and owned probe fixture.
- Required focused matrix:
  `node --test scripts/performance/emulators.test.js scripts/performance/firebase-emulator-supervisor.test.js scripts/performance/task07-harness.test.js scripts/performance/task08-contract.test.js scripts/performance/task08-runner.test.js scripts/performance/task08-preflight.test.js`
  — final `99/99` passed, `0` failed, `0` skipped.
- Restricted `npm.cmd run perf:test` before the final connected-parent characterization assertion: `466/470` passed. The only four failures were identical sandbox `EPERM` reads of `C:\Users\Marco\.config\configstore\firebase-tools.json` in `firebase-storage-runtime-patch.test.js`; the isolated file reproduced `2/6` passed and the same four exact failures.
- Final unrestricted identical `npm.cmd run perf:test`: `471/471` passed, `0` failed, `0` skipped. The pre-existing Node `punycode` deprecation warning was emitted.
- `git diff --check` passed with no whitespace errors and only the existing LF-to-CRLF working-copy warnings.

## Fixture, staging, cleanup, and boundaries

- Final retained fixture report: project `demo-fnd-perf`, `9,139` documents, `136` Storage objects, approved hash `fbabc02a3376d466cf717e3886e0d12a9e15568c17b654322cff4909dc6eaca8`, verified at `2026-09-01T19:03:11.787Z`.
- Restored the normal local staging build with command-scoped `FND_GIT_BRANCH=devs`. `build:staging` compiled successfully; main asset is `static/js/main.252018f4.js`. The only build warning was the pre-existing stale Browserslist database notice; no dependency update was performed.
- `verify:staging-build` passed for `devs` / `fatin-test`, and `perf:verify-disabled` confirmed no performance bridge, profiler, benchmark, or persistence-experiment artifacts.
- A later standalone sanity invocation intentionally failed closed with `Explicit Git branch is required` because it omitted the command-scoped branch; the corrected fresh invocation set `FND_GIT_BRANCH=devs`, after which both staging identity and disabled-performance verification passed again.
- Final generated performance config is absent and all Task 08 harness ports are stably free.
- The user's staging Browser tab was not inspected or touched. No Browser run, deployment, remote Firebase access, commit, push, merge, PR, reset, stash, clean, dependency change, arbitrary process targeting, or Step 7 work occurred.

## Final identity and concerns

- Final HEAD: `9c7fcc7c5799a458768512b7cbab49e4d9b301a9`.
- Final tracked-diff fingerprint: `e37fec10f6696eea6efcb1b58cd1d5af38bd94fefd809f8b83e53c55db2b959f`.
- Final source-tree fingerprint: `e783a42ab23735f081dc3389c672888c6dc4a62a7c65c0749d9399fd1e924cb4`.
- Concerns are evidence-only: the restricted sandbox cannot read the user's Firebase Tools config, and the build/test stack emits the existing `punycode`, stale Browserslist, and LF-to-CRLF warnings. The unrestricted suite is green, and no owned process, port, generated config, or fixture drift remains.

This attempt stops after its report/callback and does not claim coordinator acceptance.
