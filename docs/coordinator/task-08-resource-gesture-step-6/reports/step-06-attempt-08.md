# Task 08 Step 6 — Attempt 8 harness reliability round

Date: 2026-09-01  
Checkout: `C:\\Users\\Marco\\OneDrive\\git_projects\\fnd-devs`  
Branch / HEAD: `devs` / `9c7fcc7c5799a458768512b7cbab49e4d9b301a9`  
Scope: local-only harness reliability; no product gesture behavior changed.

## Change

- Browser asset validation keeps its 5,000 ms deadline and retries only once when the request's own `AbortController` fired and Chromium reported the exact transient `signal is aborted without reason` failure. The retry uses a fresh controller and preserves the full first/final attempt diagnostics. Persistent timeouts and every status, content-type, empty-body, or SHA-256 failure remain terminal.
- Windows emulator teardown now sends `SIGINT` only through the captured child process object first. It waits for that owned child to exit, uses `taskkill /PID <captured-pid> /T /F` only as a bounded fallback, and still requires two stable free-port samples. A denied fallback or unproven cleanup fails closed.

## Test-first evidence

The new tests were written before implementation and initially failed because there was no validation retry/attempt accounting and no Windows owned-shutdown helper. After the implementation:

- `node --test performance/tests/browser/helpers.test.js`: 50/50 passed.
- `node --test scripts/performance/emulators.test.js`: 20/20 passed.
- `npm.cmd run perf:test` (with the required local Firebase Tools configuration access): 436/436 passed.
- `CI=true npm.cmd test -- --watchAll=false --watchman=false --runInBand`: 156/156 suites and 1,471/1,471 tests passed.
- `npm.cmd run perf:preflight -- --skip-browser` passed with JBR OpenJDK 25.0.2.
- `git diff --check` passed.

## Build and Chromium boundary

A fresh local performance build compiled successfully for source fingerprint `aba11514d10d1f3e94298fae1a0e0b5991805b5967fb88d8271878f43880ed22` with the expected `demo-fnd-perf` fixture (`9,139` documents, `fbabc02a3376d466cf717e3886e0d12a9e15568c17b654322cff4909dc6eaca8`).

The full Task 08 Chromium runner was not started. Its required authoritative bind probe refused ports `8080` and `9150` as unavailable, while a separate Windows listener query returned no process owner. The harness therefore failed closed before the `npm run perf:task08` child could launch. No process was terminated or adopted; no browser scenario, fixture mutation, accepted baseline, deployment, remote Firebase access, commit, push, merge, or PR occurred. Thus no new 6/6 Chromium evidence is claimed and `officialBaseline=false` remains the boundary.

## Restoration

The ordinary local staging build was restored successfully, then `verify:staging-build` and `perf:verify-disabled` both passed.

## Current state

The checkout remains dirty by design. Current source fingerprint after this focused code change is `aba11514d10d1f3e94298fae1a0e0b5991805b5967fb88d8271878f43880ed22`; the Git HEAD remains the dispatched baseline. The unresolved exact port-unavailability condition requires coordinator direction before any further Chromium invocation.
