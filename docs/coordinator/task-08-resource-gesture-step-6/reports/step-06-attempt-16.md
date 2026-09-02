# Task 08 Step 6 — Attempt 16 terminal-fallback liveness authority

Status: `DONE_WITH_CONCERNS`  
Date: 2026-09-01  
Checkout: `C:\Users\Marco\OneDrive\git_projects\fnd-devs`  
Branch / baseline HEAD: `devs` / `9c7fcc7c5799a458768512b7cbab49e4d9b301a9`  
Dispatch tracked/source fingerprints: `e37fec10f6696eea6efcb1b58cd1d5af38bd94fefd809f8b83e53c55db2b959f` / `e783a42ab23735f081dc3389c672888c6dc4a62a7c65c0749d9399fd1e924cb4`.

## Root cause and required real-event-loop RED

Attempt 15 called both `timer.unref()` and `helper.unref()` after removing parent IPC and supervisor lifecycle listeners. A detached supervisor with no other referenced handle could therefore exit naturally before the exact-tree helper or its deadline settled.

Before changing production, Attempt 16 added a real child-process fixture that invokes the production helper with an injected detached helper delayed for 750 ms, a 5-second deadline, and no other referenced application handle. The focused RED command was:

```text
node --test --test-name-pattern="keeps a no-other-ref caller alive" scripts/performance/firebase-emulator-supervisor.test.js
0 passed, 1 failed
```

The child exited naturally with code `0` after about `153 ms`, not the expected injected settlement code `23`, and emitted no settlement evidence. This reproduced the coordinator's reported code-0 liveness race with actual Node event-loop behavior rather than fake listener counts.

## Minimal repair and ownership semantics

- The Windows exact-tree fallback still launches only `taskkill.exe /PID <supervisorPid> /T /F`, rooted at the trusted supervisor PID. It performs no port, process-name, sibling, ancestor, or arbitrary-PID discovery.
- The helper and bounded deadline now each receive an explicit `ref()` and are never unrefed while they are the active termination authorities.
- Real taskkill success remains self-proving: the exact supervisor tree disappears before the helper can report an exit to the surviving caller.
- If launch throws, returns no observable child, emits async `error`, exits early with any code/signal, or reaches the deadline while the supervisor survives, settlement is exactly once: the deadline is cleared, helper listeners are removed, a diagnostic is written, and `processImpl.exitCode` becomes `1`.
- Those failure paths no longer call `process.exit(1)`, because supervisor-only exit cannot prove descendant cleanup. Instead they create one referenced exact-root ownership retainer. There is no retry, recursive self-kill, PID rediscovery, or silent code-0 exit. The supervisor deliberately remains the exact root until an external owner can diagnose and terminate that exact tree.
- The generic fallback now routes `win32` only to taskkill. Other supported Node platforms signal only the already-detached supervisor process group with `process.kill(-supervisorPid, 'SIGKILL')`. A process-group signalling failure uses the same diagnosed exact-root retention policy.
- A defensive exception from the selected terminal implementation also retains the exact supervisor root rather than erasing it.
- Normal registered-handler parent disconnect, accepted explicit IPC shutdown, connected rejection, Attempt 13 console isolation, Attempt 14 disconnect behavior, and Attempt 15 no-handler/throwing-handler fallback entry were preserved. No product, StatsBars, resource, Task 08 metric, fixture, or unrelated source was changed.

Changed files are limited to:

- `frontend/scripts/performance/firebase-emulator-supervisor.js`
- `frontend/scripts/performance/firebase-emulator-supervisor.test.js`
- `frontend/scripts/performance/firebase-emulator-supervisor-liveness-probe-fixture.js` (new real-event-loop fixture)

## Focused liveness, failure, routing, and owned-tree evidence

The final supervisor suite passed `27/27`. It covers:

- referenced helper and deadline ownership with zero launch-time unrefs;
- the real no-other-ref child remaining alive through delayed helper settlement;
- exact Windows command, arguments, options, and root PID;
- synchronous launch failure and null/unobservable launch;
- async helper error;
- early helper exit with code `0` and nonzero exit;
- bounded deadline timeout;
- duplicate/late events, listener removal, timer clearing, and one retention transfer;
- referenced exact-root retention with failure exit code;
- Windows/POSIX selection and exact negative-PID POSIX process-group signalling;
- POSIX signalling failure retention;
- normal graceful disconnect never entering fallback;
- connected throwing-handler rejection never entering child fallback;
- real Windows no-handler and throwing-handler exact-tree integrations.

The controlled no-other-ref GREEN evidence from the final focused matrix was:

```text
CONTROLLED_FALLBACK_LIVENESS {"settlement":"helper-exit","diagnostic":"taskkill exited with code 0 while the supervisor remained alive","elapsedMs":848,"callerElapsedMs":982,"exitCode":23}
```

The injected settlement occurs only after the intentionally delayed helper, proving the caller cannot naturally exit code 0 first.

Final owned Windows integration evidence from the required matrix was:

```text
OWNED_PARENT_LOSS_PROBE {"case":"no-handler","supervisorPid":13596,"descendantPid":6832,"port":51335,"boundedMs":473,"supervisorGone":true,"descendantGone":true,"portStablyFree":true}
OWNED_PARENT_LOSS_PROBE {"case":"throwing-handler","supervisorPid":22768,"descendantPid":1888,"port":51336,"boundedMs":423,"supervisorGone":true,"descendantGone":true,"portStablyFree":true}
```

No pre-existing PID or port owner was targeted.

## Real demo-fnd-perf unexpected-wrapper-exit integration

Used command-scoped JetBrains OpenJDK `25.0.2` and started one owned `npm.cmd run perf:emulators` tree after proving every harness port free and the generated config absent. Deterministic seeding completed, then independent fixture verification passed at `9,139` documents and the approved hash.

The complete captured tree immediately before wrapper loss was:

- exact `node scripts/performance/emulators.js` wrapper `25204` (parent `26920`);
- detached Firebase supervisor `9188`;
- Firestore Java `25292`;
- Storage Java `25788` and conhost `8096`.

PID `25204` was immediately revalidated as `node.exe`, parent `26920`, with exact command line `node  scripts/performance/emulators.js`, then only that wrapper PID was force-terminated at `2026-09-01T22:24:30.6158638+02:00`. Parent IPC loss entered the normal registered Firebase CLI SIGINT path. All five captured PIDs disappeared and all twelve harness ports were stably free within `1,913 ms`:

```text
REAL_WRAPPER_LOSS_CLEAN elapsedMs=1913 ownedPids=25204,9188,25292,25788,8096 portsStablyFree=true
```

The intentional wrapper kill left the exact task-owned generated config; it was removed only through the existing exact-artifact cleanup helper.

## Fresh automated verification

- Syntax: `node --check` passed for the supervisor and liveness fixture.
- Supervisor-focused final run: `27/27` passed, `0` failed, `0` skipped.
- Required matrix:
  `node --test scripts/performance/emulators.test.js scripts/performance/firebase-emulator-supervisor.test.js scripts/performance/task07-harness.test.js scripts/performance/task08-contract.test.js scripts/performance/task08-runner.test.js scripts/performance/task08-preflight.test.js`
  — `107/107` passed, `0` failed, `0` skipped.
- Restricted `npm.cmd run perf:test` could not complete the real Windows fixture because sandboxed `taskkill` was denied. The new fail-closed behavior correctly retained the exact fixture roots rather than orphaning descendants or exiting code 0. Every retained root was identified from its exact Attempt-16 state/command line and cleaned only by unrestricted taskkill against that exact supervisor PID. This was a permission boundary, not a product assertion.
- Unrestricted identical `npm.cmd run perf:test`: `479/479` passed, `0` failed, `0` skipped. The pre-existing Node `punycode` deprecation warning was emitted.
- `git diff --check` passed with no whitespace errors and only the existing LF-to-CRLF working-copy warnings.

## Fixture, staging, cleanup, and boundaries

- Final retained fixture report: project `demo-fnd-perf`, `9,139` documents, `136` Storage objects, approved hash `fbabc02a3376d466cf717e3886e0d12a9e15568c17b654322cff4909dc6eaca8`, verified at `2026-09-01T20:24:05.746Z`.
- Restored the normal local staging build with command-scoped `FND_GIT_BRANCH=devs`. `build:staging` compiled successfully; main asset is `static/js/main.252018f4.js`. The only build warning was the pre-existing stale Browserslist database notice; no dependency update was performed.
- `verify:staging-build` passed for `devs` / `fatin-test`, and `perf:verify-disabled` confirmed no performance bridge, profiler, benchmark, or persistence-experiment artifacts.
- Final generated performance config is absent, all Task 08 harness ports are stably free, and no Attempt-16 supervisor/probe/seed/emulator process remains.
- The user's staging Browser tab was not inspected or touched. No Browser run, deployment, remote Firebase access, commit, push, merge, PR, reset, stash, clean, dependency change, arbitrary process targeting, or Step 7 work occurred.

## Final identity and concerns

- Final HEAD: `9c7fcc7c5799a458768512b7cbab49e4d9b301a9`.
- Final tracked-diff fingerprint: `e37fec10f6696eea6efcb1b58cd1d5af38bd94fefd809f8b83e53c55db2b959f` (unchanged).
- Final source-tree fingerprint: `1f75cddc5929bf32beae170e4cd7b6d936451062b5245bc4f43db46c639b05a3`.
- The deliberate failure policy is fail-closed: if exact-tree enforcement itself cannot complete, the supervisor remains alive and diagnosed under one referenced retainer until an external exact-root cleanup occurs. It does not retry indefinitely or claim descendant cleanup. This may require operator intervention by design.
- Evidence-only warnings remain the sandbox taskkill denial, existing `punycode` deprecation, stale Browserslist notice, and LF-to-CRLF warnings. Unrestricted local verification is green, and no owned process, port, generated config, build-target, or fixture-report drift remains.

This attempt stops after its report/callback and does not claim coordinator acceptance.
