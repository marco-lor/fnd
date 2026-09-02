# Task 08 Step 6 — Attempt 14 detached supervisor parent-disconnect recovery

Status: `DONE_WITH_CONCERNS`  
Date: 2026-09-01  
Checkout: `C:\Users\Marco\OneDrive\git_projects\fnd-devs`  
Branch / baseline HEAD: `devs` / `9c7fcc7c5799a458768512b7cbab49e4d9b301a9`  
Dispatch tracked/source fingerprints: `e37fec10f6696eea6efcb1b58cd1d5af38bd94fefd809f8b83e53c55db2b959f` / `7e87a20db716b9847af21181fcfaac9a199cd2b9660f73f97d7e5dc1f0736b1f`.

## Root cause and RED evidence

`firebase-emulator-supervisor.js` registered only an IPC `message` listener. Attempt 13 deliberately launches that supervisor detached on Windows, so an unexpected `emulators.js` wrapper exit closes the IPC channel without delivering console Ctrl+C to the Firebase CLI. There was consequently no child-side route from parent loss to the already-registered Firebase CLI SIGINT handler.

The first new regression test ran before production edits:

```text
node --test scripts/performance/firebase-emulator-supervisor.test.js
2 passed, 1 failed
supervisor relays parent IPC disconnect to Firebase CLI SIGINT in-process exactly once
Expected 1, actual 0
```

The expanded pre-implementation matrix then ran `8` tests with `4` expected failures: post-initialization disconnect, disconnect observed during synchronous initialization, missing-handler retry after initialization, and startup-failure listener cleanup. The accepted explicit-shutdown acknowledgement and no-handler rejection contracts stayed green.

## Minimal repair

- Added one supervisor-owned `disconnect` listener.
- Routed explicit IPC requests and parent disconnect through the same idempotent in-process Firebase CLI SIGINT transition.
- An accepted transition sets ownership before emitting, removes its disconnect listener, and can never emit SIGINT twice. A connected repeated explicit request retains the existing negative `duplicate-request` acknowledgement.
- A disconnect observed before the CLI has registered SIGINT is retained and retried once immediately after synchronous CLI initialization. A CLI startup exception removes only the supervisor's own `message` and `disconnect` listeners and rethrows the original error.
- Acknowledgements are attempted only while IPC is connected. Synchronous/closing-channel send errors are contained, and an async send callback is supplied so the channel race does not create an unhandled process error.
- No PID lookup, PID scan, port-derived termination, timer, wait, fallback process kill, or product/Task 08 measurement change was added.

Final supervisor coverage is `10/10`. It covers disconnect after handler registration, disconnect during initialization, disconnect after accepted explicit shutdown, repeated/late messages and disconnects, connected duplicate rejection, missing-handler behavior, startup failure cleanup, closing-channel send error, throwing SIGINT listener behavior, and the original accepted/rejected explicit request contract.

## Fresh automated verification

- Required focused matrix:
  `node --test scripts/performance/emulators.test.js scripts/performance/firebase-emulator-supervisor.test.js scripts/performance/task07-harness.test.js scripts/performance/task08-contract.test.js scripts/performance/task08-runner.test.js scripts/performance/task08-preflight.test.js`
  — `90/90` passed, `0` failed, `0` skipped.
- Initial sandboxed `npm.cmd run perf:test` — `458/462` passed; the only four failures were identical `EPERM` denials reading `C:\Users\Marco\.config\configstore\firebase-tools.json` in `firebase-storage-runtime-patch.test.js`.
- Identical unrestricted `npm.cmd run perf:test` — `462/462` passed, `0` failed, `0` skipped. The pre-existing Node `punycode` deprecation warning was emitted.
- `git diff --check` passed with no whitespace errors; it emitted only the pre-existing LF-to-CRLF working-copy warnings.

## Owned Windows lifecycle probe 1 — normal Ctrl+C

- Used command-scoped JetBrains OpenJDK `25.0.2`; system Java 8 was not used. Preflight reported all Task 08 harness ports free.
- Owned PTY root and exact captured tree before shutdown:
  - `pwsh` `22060`
  - `cmd/npm/node/cmd`: `25728` -> `12300` -> `8816`
  - `emulators.js` wrapper `27184`
  - detached Firebase supervisor `27188`
  - Firestore Java `26908`
  - Storage Java `16696` -> conhost `5208`
- The retained deterministic seed completed, then an independent verify reported `9,139` documents and hash `fbabc02a3376d466cf717e3886e0d12a9e15568c17b654322cff4909dc6eaca8`; the fixture report records `136` Storage objects.
- Sent exactly one Ctrl+C after the recorded pre-signal timestamp `2026-09-01T20:22:39.5277397+02:00`, followed only by the normal batch `Y` confirmation. The PTY exited with code `1`.
- Every captured PID was gone. Stable port polling reported `HARNESS_PORTS_STABLY_FREE` at `2026-09-01T20:23:02.1364653+02:00`, a conservative end-to-end bound of `22.609s` including tool handoffs and final PID/port verification. No external taskkill or other process termination was used.

## Owned Windows lifecycle probe 2 — unexpected exact-wrapper exit

- Started a new PTY with root PID `4500` and captured the exact owned tree:
  - `cmd/npm/cmd`: `16696` -> `7956` -> `26908`
  - uniquely matched `node scripts/performance/emulators.js` wrapper `5208`
  - detached Firebase supervisor `27184`
  - Firestore Java `5016`
  - Storage Java `2244` -> conhost `23532`
- Immediately before termination, PID `5208` was revalidated as `node.exe`, parent `26908`, with exact command line `node scripts/performance/emulators.js`. Only PID `5208` was force-terminated at `2026-09-01T20:24:21.2735612+02:00`. No descendant, supervisor, port owner, unrelated process, or merely discovered PID was targeted.
- The npm/PTTY chain exited with code `1`. Parent IPC disconnect caused the detached supervisor to invoke the Firebase CLI shutdown; the supervisor and both Java descendants exited without an external tree kill.
- Every captured PID was gone and stable port polling reported `HARNESS_PORTS_STABLY_FREE` at `2026-09-01T20:24:46.7729887+02:00`, a conservative termination-to-completed-proof bound of `25.499s`.
- Because the wrapper was intentionally killed before its `finally` cleanup, its exact task-owned `.firebase.performance.generated.json` remained. It was verified by creation time/content and removed explicitly; no other file or process was cleaned.

## Fixture, staging restoration, and final boundaries

- Final retained fixture report: `9,139` documents, `136` Storage objects, approved hash `fbabc02a3376d466cf717e3886e0d12a9e15568c17b654322cff4909dc6eaca8`, project `demo-fnd-perf`, verified at `2026-09-01T18:22:31.596Z`.
- Restored the normal local staging build with command-scoped `FND_GIT_BRANCH=devs`. `build:staging` compiled successfully; main asset is `static/js/main.252018f4.js`. The only build warning was stale Browserslist data; no dependency update was performed.
- `verify:staging-build` passed for staging / `fatin-test`, and `perf:verify-disabled` confirmed that the normal build contains no performance bridge, profiler, benchmark, or persistence-experiment artifacts.
- Final generated performance config is absent. All Task 08 harness ports are stably free.
- The user's open `fatin-test.web.app` Browser tab was not inspected or touched. No Browser run was performed because Attempt 14 changes only the process lifecycle gap; Attempt 12 remains the product-behavior evidence boundary.
- No deployment, remote Firebase access, commit, push, merge, PR, reset, stash, clean, discard, dependency change, arbitrary process targeting, or Step 7 work occurred.

## Final identity and concern

- Final HEAD: `9c7fcc7c5799a458768512b7cbab49e4d9b301a9`.
- Final tracked-diff fingerprint: `e37fec10f6696eea6efcb1b58cd1d5af38bd94fefd809f8b83e53c55db2b959f`.
- Final source-tree fingerprint: `e02a2684845ba36fbd3ddff9db6193f51ffb12cce14a631e3b9758c43e6b31a4`.
- Concern retained from Attempt 13: the outer Windows npm/PTTY reports exit code `1` after the single normal Ctrl+C/batch confirmation even though shutdown is clean. The intentionally killed-wrapper probe also exits `1` as expected. Neither probe left an owned process or occupied port.

This attempt stops after its report/callback and does not claim coordinator acceptance.
