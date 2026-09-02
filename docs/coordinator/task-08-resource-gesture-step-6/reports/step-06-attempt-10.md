# Task 08 Step 6 — Attempt 10 IPC backpressure repair

Date: 2026-09-01  
Checkout: `C:\Users\Marco\OneDrive\git_projects\fnd-devs`  
Branch / HEAD: `devs` / `9c7fcc7c5799a458768512b7cbab49e4d9b301a9`  
Status: `NEEDS_CONTEXT` — the source/test/build repair is green; protected occupied emulator ports block the only remaining integration gate.

## Dispatch preservation

- Dispatch tracked-diff fingerprint: `4e6a9d674294fe61c4d6b4e2f87945af6ad7d212f115b516182a78f20bbd0399`.
- Dispatch source-tree fingerprint: `a632186389547c794f91180c731c223a6984e9fce038639ea11f6dd47fe9cff1`.
- All pre-existing tracked and untracked changes were retained. No reset, stash, clean, discard, commit, push, merge, deployment, dependency change, remote Firebase access, baseline acceptance, worktree change, or staging Browser interaction occurred.

## Finding and fix

`child_process.send()` may return `false` when Node's IPC queue exceeds its backpressure threshold even though the message is queued and both its callback and the peer acknowledgement can still succeed. The former `requestOwnedWindowsGracefulShutdown` treated that return value as immediate delivery failure, so `shutdownOwnedWindowsEmulator` could start the exact captured-PID tree fallback while the already-queued graceful Firebase SIGINT request was being processed.

The helper now ignores the Boolean return value. It settles only from the send callback error, matching valid/rejected acknowledgement, child `error`, `disconnect`, `exit`, synchronous send throw, or the bounded timeout. All temporary message/exit/error/disconnect listeners and timer are removed by the one settlement gate. The existing parent-owned supervisor path, Firebase CLI SIGINT-handler check, request-ID matching, stable-port proof, and exact owned-tree fallback are unchanged.

## Test-first evidence

Before changing `emulators.js`, the new focused command was:

`node --test --test-name-pattern="Windows (IPC backpressure|graceful IPC)" scripts/performance/emulators.test.js`

It failed as expected:

- The backpressure regression failed with `Owned Firebase emulator shutdown failed.` because `send() === false` was treated as delivery failure, beginning the shutdown failure/fallback path despite a queued callback and matching ACK.
- The disconnect regression waited for the timeout and reported `acknowledgement did not arrive within 100 ms` instead of bounded disconnect diagnostics.

After the minimal protocol change:

- Focused emulator/supervisor/Task 08 Node command: `58/58` passed.
- `npm.cmd run perf:test`: `448/448` passed (exit 0).
- `CI=true npm.cmd test -- --watchAll=false --watchman=false --runInBand`: `156/156` suites and `1,471/1,471` tests passed (exit 0).
- `FND_GIT_BRANCH=devs npm.cmd run build:staging`, `npm.cmd run verify:staging-build`, and `npm.cmd run perf:verify-disabled`: all passed (exit 0); the ordinary local staging build is restored.
- `git diff --check`: passed; only existing LF-to-CRLF warnings were emitted.

The lifecycle matrix covers: queued-backpressure success without fallback; callback error; child error; disconnect; mismatched ACK followed by valid matching ACK; matching rejection; malformed ACK; missing ACK timeout; late callback/ACK; wrapper exit before ACK; listener cleanup; and the existing exact-tree fallback/stable-port failure paths. The expected non-failing warnings were stale Browserslist/caniuse-lite, Node `punycode`, and intentional negative-path test console output.

## Integration boundary

The read-only `assertEmulatorPortsFree()` check reported `Performance emulator harness ports are already occupied: 8080, 9150. Stop the owning processes before retrying; this command will not terminate them.` PID `18624` is explicitly not authorized for termination, signalling, takeover, or adoption. Accordingly, no emulator launch, performance build, fixture mutation, `perf:task08`, Chromium run, cleanup attempt, manual Browser check, or baseline action was performed.

The remaining source-matched full Chromium acceptance, fixture restoration/hash proof, and stable free-port verification are unverified. `officialBaseline=false` remains unchanged.

## Final identity and requested context

- Final tracked-diff fingerprint: `4ab192e4b0fc4fa23261b698b12091dc53eb6003dfbdb2c863f608e9ffe0796e`.
- Final source-tree fingerprint: `39d2a75fadcf228f11d7ec1d97b6f13cc64c5cf8228a459469c01be666548892`.
- Final HEAD: `9c7fcc7c5799a458768512b7cbab49e4d9b301a9`.

An explicit clean-port/ownership decision for PID `18624`, or externally freeing all harness ports without adopting that process, is required before the local emulator/Chromium gate may run.
