# Task 08 Step 6 — Attempt 9 owned Windows shutdown fix

Date: 2026-09-01  
Checkout: `C:\Users\Marco\OneDrive\git_projects\fnd-devs`  
Branch / HEAD: `devs` / `9c7fcc7c5799a458768512b7cbab49e4d9b301a9`  
Status: `NEEDS_CONTEXT` — local source/test/build work is green; a new clean-port authorization boundary is required before emulator or Chromium integration can run.

## Preserved starting state

- Dispatch tracked-diff fingerprint: `b0d6bf458297fc6285353541fd5df2513e78d9e78b06828dcab17e56e669e0f6`.
- Dispatch source-tree fingerprint: `407df445824c79670416cfd319cdc3428bdc3d40a3f17f6becf1396ae8ffa9ec`.
- The existing dirty worktree was preserved. No reset, stash, clean, discard, commit, push, merge, PR, deployment, dependency change, remote Firebase access, accepted-baseline mutation, or user Browser interaction occurred.

## Change

The prior Windows path called `child.kill('SIGINT')` on the Node Firebase CLI wrapper. Windows terminated that wrapper without delivering an in-process signal event to Firebase Tools, so Firebase's registered `shutdownWhenKilled` handler did not run and its Firestore Java descendant could survive.

`frontend/scripts/performance/firebase-emulator-supervisor.js` is a local child-process supervisor. It loads the exact existing Firebase CLI entrypoint in the same Node process, receives a parent-owned IPC shutdown request, verifies that a Firebase `SIGINT` handler exists, emits `SIGINT` in that process, and returns a request-ID-specific acknowledgement. `emulators.js` now requires that acknowledgement before accepting graceful shutdown, then separately requires captured-child exit and two stable free-port samples. It retains exact captured-tree `taskkill` as a bounded fallback and attaches structured acknowledgement/exit/fallback/port diagnostics to any failure.

No product gesture, asset-validation, browser scenario, fixture, Firebase configuration, or dependency behavior changed.

## Test-first evidence

New lifecycle tests were first added against the signal-only implementation. The RED run had three failures: the old helper required an OS `kill` method rather than an IPC acknowledgement, it did not expose an acknowledgement result, and it accepted wrapper exit without exposing the descendant-port failure diagnostics. This directly captured the observed Attempt 8 failure mode.

After implementation:

- `node --test scripts/performance/emulators.test.js scripts/performance/firebase-emulator-supervisor.test.js scripts/performance/task08-runner.test.js scripts/performance/task08-report.test.js scripts/performance/task08-contract.test.js`: `49/49` passed.
- `npm.cmd run perf:test`: `439/439` passed.
- `CI=true npm.cmd test -- --watchAll=false --watchman=false --runInBand`: `156/156` suites and `1,471/1,471` tests passed.
- `FND_GIT_BRANCH=devs npm.cmd run build:staging`, followed by `npm.cmd run verify:staging-build` and `npm.cmd run perf:verify-disabled`: all passed; the ordinary local `devs` / `fatin-test` build remains present.
- `git diff --check`: passed; only pre-existing LF-to-CRLF warnings were emitted.

Expected non-failing warnings were the existing Node `punycode` deprecation, intentional negative-path test console output, and stale Browserslist/caniuse-lite notice.

## Integration boundary

The read-only command `assertEmulatorPortsFree()` reported: `Performance emulator harness ports are already occupied: 8080, 9150. Stop the owning processes before retrying; this command will not terminate them.` Coordinator evidence identifies the pre-existing owner as PID `18624`. Its termination or adoption is not authorized, so no emulator startup, fixture mutation, performance build, `perf:task08`, Chromium journey, cleanup attempt, manual Browser check, or baseline action was performed.

The required source-matched complete `6/6` Chromium rerun, fixture restoration/hash proof, and stable free-port cleanup therefore remain unverified. `officialBaseline=false` remains unchanged.

## Final identity and requested context

- Final tracked-diff fingerprint: `4e6a9d674294fe61c4d6b4e2f87945af6ad7d212f115b516182a78f20bbd0399`.
- Final source-tree fingerprint: `a632186389547c794f91180c731c223a6984e9fce038639ea11f6dd47fe9cff1`.
- Final HEAD: `9c7fcc7c5799a458768512b7cbab49e4d9b301a9`.

Please provide an explicit clean-port/ownership decision for PID `18624` (or make all harness ports free without adopting it). Only then may a fresh source-matched performance build and complete local Chromium acceptance be attempted.
