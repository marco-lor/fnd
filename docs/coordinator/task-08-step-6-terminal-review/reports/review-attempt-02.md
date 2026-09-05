GREEN

# Task 08 Step 6 terminal-fallback independent re-review — attempt 02

## Review identity and lease verification

- Review time: `2026-09-01T22:16:26.0455947Z`.
- Control ID: `task08-step6-review-a38f4568`.
- Step / workstream / review attempt: `1` / `terminal-fallback-acceptance` / `2`.
- Dispatch token: `46f3bb80-c1c6-48bb-a8c1-e4145e2b4486`.
- Dispatch control revision: `8`; current `control.md` revision read: `9`. Revision 9 records this already-running dispatch and is expected coordinator bookkeeping inside the excluded directory.
- Requested / canonical task: `step6_review_01_a31b407a` / `/root/step6_review_01_a31b407a`.
- Effective pair: `gpt-5.6-sol` / `max`.
- Checkout / branch / HEAD: `C:\Users\Marco\OneDrive\git_projects\fnd-devs` / `devs` / `9c7fcc7c5799a458768512b7cbab49e4d9b301a9`.
- Runtime: Windows NT `10.0.19045.0`, Node `v22.22.2`, npm `11.2.0`.
- Protected manifest: `docs/coordinator/task-08-step-6-terminal-review/protected-dirty-state.md`.

Before substantive review, I reran the exact dispatch serialization while excluding only `docs/coordinator/task-08-step-6-terminal-review/`. Every component matched dispatch:

| Component | Current | Expected |
| --- | --- | --- |
| Branch | `devs` | `devs` |
| HEAD | `9c7fcc7c5799a458768512b7cbab49e4d9b301a9` | same |
| Porcelain-v2 status SHA-256 | `ed57ee27449fdf20e360cea59f22fc6c91d7e4f750835d951aee1ab0623760ed` | same |
| Staged diff SHA-256 | `01ba4719c80b6fe911b091a7c05124b64eeece964e09c058ef8f9805daca546b` | same, empty serialization |
| Unstaged binary diff SHA-256 | `e37fec10f6696eea6efcb1b58cd1d5af38bd94fefd809f8b83e53c55db2b959f` | same |
| Sorted untracked path/hash tree SHA-256 | `b9571ad655d905147b76c7aef95de390ab0c865b10ed44e476ab2dc0a1aaade2` | same |
| Composite code-workspace fingerprint | `00e0a97306b3a769fe7c4bb1b241f845016a050a005c31fca899a6ea4c59f44f` | same |

The three declared content hashes also matched exactly:

- `frontend/scripts/performance/firebase-emulator-supervisor.js`: `63ee0c8998270134750bd2af8a3423980c22a24238ced740d5a89f13e0ff60ac`.
- `frontend/scripts/performance/firebase-emulator-supervisor.test.js`: `d530ae279fc0f1bc40949d8dde47792e2331bc54cda7535f4779303e71d1952b`.
- `frontend/scripts/performance/firebase-emulator-supervisor-liveness-probe-fixture.js`: `ad5565e3b480f8df6c798331b288cc212b70d1d2036344c4c98cc41d12d2a6ad`.

A direct current-hash comparison against all 69 hash-bearing entries in the protected manifest found exactly these three differences and no missing path. No unexplained writer or protected-state drift was present.

## Outcome

Both Important findings from review attempt 1 are closed. The original no-other-reference event-loop race remains closed, rejected connected handoff ownership is now preserved until a safe transfer or one exact fallback, and every observable helper settlement releases its timer/listener/reference ownership. Windows targeting remains exactly `taskkill.exe /PID <trusted supervisor PID> /T /F`; POSIX targeting remains only `SIGKILL` to the trusted negative detached supervisor PID. No Critical or Important correctness, regression, ownership, security, data-loss, process-leak, or maintainability defect remains in scope.

## Findings

### Critical

None.

### Important

None.

### Minor — Two historical failed-probe directories still predate this lease

The final elevated inventory found only the two directories already recorded by review attempt 1:

- `C:\Users\Marco\AppData\Local\Temp\fnd-supervisor-throwing-handler-NFbqEl`, created `2026-09-01T20:19:13.2713719Z`.
- `C:\Users\Marco\AppData\Local\Temp\fnd-supervisor-throwing-handler-tphG2C`, created `2026-09-01T20:15:47.7308680Z`.

They predate this review and were not authorized targets, so I did not remove them. Their previously recorded processes are gone and ports remain free. No current gate created another matching directory. The fixture still throws on a surviving descendant before its `fs.rmSync()` (`frontend/scripts/performance/firebase-emulator-supervisor.test.js:191-196`), so making diagnostic-directory cleanup exception-safe remains a non-blocking test-maintenance improvement.

## Independent causal review

### Prior Important 1 — rejected connected handoff ownership

The repaired state machine now keeps the child-side disconnect listener until SIGINT emission has actually been accepted:

- `requestFirebaseCliShutdown()` sets `shutdownRequested`, invokes the registered Firebase handlers, and removes `handleParentDisconnect` only on accepted emission (`frontend/scripts/performance/firebase-emulator-supervisor.js:255-270`).
- A synchronous handler failure stores the original reason and returns a negative acknowledgement without releasing disconnect ownership (`:271-277`).
- A later disconnect reuses that stored reason rather than re-emitting SIGINT (`:312-319`).
- Failed negative-ack delivery, synchronously or through the send callback, enters `requestTerminalFallback()` with that original reason (`:10-21`, `:299-309`). The terminal guard removes both lifecycle listeners and permits one fallback only (`:225-253`).
- A healthy connected rejection sends one negative acknowledgement and does not invoke fallback. Accepted shutdown still removes disconnect ownership and remains no-fallback/idempotent under duplicate or late events.

Production-code regressions cover the full transition: healthy rejection then disconnect (`frontend/scripts/performance/firebase-emulator-supervisor.test.js:980-1029`), asynchronous acknowledgement failure (`:1031-1072`), synchronous channel closure (`:1074-1111`), and a real connected rejection followed by parent loss with exact supervisor/descendant PID and port cleanup (`:1127-1132`). The direct parent caller remains unchanged and its bounded acknowledgement/fallback behavior passes in the six-file matrix.

I also ran six inline adversarial assertions directly against the exported production functions. They covered a synchronous failing send callback followed by a send throw, IPC backpressure followed by disconnect, and an accepted-shutdown late callback error. Each rejection path retained the original diagnosis and invoked exactly one fallback; the accepted path invoked none.

The installed Firebase Tools compatibility check found its emulator SIGINT cleanup at `node_modules/firebase-tools/lib/emulator/commandUtils.js:164-219`: the handler begins asynchronous cleanup and returns control without synchronously disconnecting IPC. Its locator cleanup handler at `node_modules/firebase-tools/lib/emulator/hub.js:167-181` is also synchronous and non-disconnecting. Thus moving listener removal to post-acceptance does not introduce a real-handler reentrant disconnect regression.

### Prior Important 2 — helper/deadline ownership after settlement

The repaired Windows fallback preserves pre-settlement liveness while making settlement one-winner and bounded:

- The deadline is created and explicitly referenced before helper launch (`frontend/scripts/performance/firebase-emulator-supervisor.js:121-126`); an observable helper is then listener-owned and explicitly referenced (`:128-146`). The real no-other-reference probe stayed alive until its delayed helper exit.
- `retainRootAfterFailure()` is guarded by `settled`, clears the deadline once, releases the exact helper, emits a root-PID/reason diagnostic, and installs the one explicit root retainer (`:97-111`).
- `releaseOwnedHelper()` removes both helper listeners, kills only the already-owned helper when timeout/error requires it, appends false/throw cleanup diagnostics, and unrefs the helper (`:78-95`). Natural helper exit releases without trying to kill an already-settled process (`:116-119`).
- Timeout and async helper error both request exact-helper termination (`:112-125`). Launch throw and null/unobservable child clear the referenced deadline and retain the exact root (`:128-141`).
- The retained failure owner is the single referenced interval returned by `retainExactSupervisorRootOwnership()` (`:23-35`). It sets nonzero exit status and preserves exact root PID, reason, and diagnostic; it neither retries nor discovers another PID.

The inline adversarial production assertions separately exercised `helper.kill()` returning false, throwing, and synchronously emitting an `error` after listener removal. All three paths performed one kill attempt, one unref, one deadline clear, zero residual helper listeners, one root-retention transfer, and one diagnostic containing the cleanup failure. Captured late error/exit/deadline callbacks were harmless because the settlement guard had already won.

The focused suite is not fake-only. Its real long-lived detached helper probes prove exact helper PIDs gone after both deadline and async error, far before their 1,200 ms natural lifetime (`frontend/scripts/performance/firebase-emulator-supervisor.test.js:235-290`). Its real no-other-reference probe proves the caller cannot naturally exit code 0 before helper/deadline authority (`:200-233`). The unit cases additionally prove listener/reference/timer counts and late-callback idempotence (`:607-858`).

If exact helper cleanup itself returns false or throws, the implementation cannot truthfully claim that helper termination was confirmed; it instead appends that fact to the operator diagnostic, unrefs the helper, marks exit failure, and retains the exact supervisor root. The retained root remains the one referenced authority, and an operator can terminate that exact root tree—including its child helper ancestry—without any PID/port/name rediscovery. This is an acceptable fail-closed boundary, not a silent orphan or code-0 path.

### Platform and targeting boundary

- Windows validates a positive integer supervisor PID and positive finite timeout, then launches only `taskkill.exe` with `['/PID', String(rootPid), '/T', '/F']`, detached with ignored stdio and a hidden window (`frontend/scripts/performance/firebase-emulator-supervisor.js:37-64`). Helper cleanup calls only the returned exact helper object's `kill()`.
- POSIX validates the same trusted supervisor PID and signals only `-rootPid` with `SIGKILL` (`:149-192`).
- Routing selects Windows only for `win32` and the exact process-group implementation otherwise (`:195-204`). No PID, port, process-name, or unrelated-process discovery was introduced.

## Fresh verification

All test commands ran from `frontend`. Process-owning suites ran with the approved elevated boundary from the outset because restricted Windows `taskkill` denial is an intentional diagnosed-retainer path, not a useful safe test environment.

1. Pre-integration ownership gate:
   - Production `assertEmulatorPortsFree()` plus explicit exclusive loopback binds for `3000` and `3001`.
   - Exit `0`; ports `3000,3001,4000,4400,4500,5000,5001,5002,8080,9099,9150,9199` were all free.
   - `.firebase.performance.generated.json` and `.perf-emulator-data/playwright-webserver.active` were absent.
   - Elevated `taskkill.exe` inventory was empty. No pre-existing PID was terminated by this review.

2. Syntax:

```text
node --check scripts/performance/firebase-emulator-supervisor.js
node --check scripts/performance/firebase-emulator-supervisor-liveness-probe-fixture.js
node --check scripts/performance/firebase-emulator-supervisor-probe-fixture.js
node --check scripts/performance/emulators.js
```

Exit `0`; `4/4` files passed; aggregate command duration `327 ms` (wrapper wall `0.573 s`).

3. Additional adversarial production assertions:

```text
node -e "<six direct assertions against the exported production supervisor functions>"
```

Exit `0`; `6/6` passed; wall `0.458 s`. Cases: helper kill false, helper kill throw, synchronous helper kill-error event, synchronous send-callback/send-throw race, IPC backpressure then disconnect, and accepted shutdown with a late acknowledgement error.

4. Focused supervisor suite:

```text
node --test scripts/performance/firebase-emulator-supervisor.test.js
```

Exit `0`; `32/32` passed, `0` failed, `0` skipped; TAP duration `2,926.9778 ms`, wall `3.290 s`.

- No-other-ref liveness: helper settlement `837 ms`, caller `949 ms`, controlled exit `23`.
- Deadline cleanup: exact helper PID `10552` gone at `71 ms`, controlled exit `24`.
- Async-error cleanup: exact helper PID `20028` gone at `56 ms`, controlled exit `25`.
- Owned no-handler tree: supervisor/descendant `25128/12024`, port `62443`, gone/free in `489 ms`.
- Owned direct throwing-handler tree: supervisor/descendant `9148/26584`, port `62444`, gone/free in `484 ms`.
- Owned connected-rejection tree: supervisor/descendant `7952/2312`, port `62445`, gone/free in `486 ms`.

5. Required six-file relevant matrix:

```text
node --test scripts/performance/emulators.test.js scripts/performance/firebase-emulator-supervisor.test.js scripts/performance/task07-harness.test.js scripts/performance/task08-contract.test.js scripts/performance/task08-runner.test.js scripts/performance/task08-preflight.test.js
```

Exit `0`; `112/112` passed, `0` failed, `0` skipped; TAP duration `2,961.585 ms`, wall `3.334 s`.

- No-other-ref liveness: helper settlement `821 ms`, caller `963 ms`, controlled exit `23`.
- Deadline cleanup: exact helper PID `17804` gone at `78 ms`.
- Async-error cleanup: exact helper PID `22996` gone at `42 ms`.
- Three real owned trees were gone with their ports stably free: `10140/14844/62450`, `25332/16424/62451`, and connected rejection `22392/14212/62452`.

6. Broad performance suite:

```text
npm.cmd run perf:test
```

Exit `0`; `484/484` passed, `0` failed, `0` skipped; TAP duration `14,926.9495 ms`, wall `16.444 s`. The existing Node `punycode` deprecation warning appeared in two workers; no dependency change or new warning class was introduced.

7. Retained normal staging output:

```text
$env:FND_GIT_BRANCH='devs'; npm.cmd run verify:staging-build
npm.cmd run perf:verify-disabled
```

Both exited `0`; durations `1,361 ms` and `1,349 ms`. The retained main asset is still `static/js/main.252018f4.js`; disabled verification found no performance bridge, profiler, benchmark, or persistence-experiment artifact.

8. Whitespace:

```text
git -c safe.directory='C:/Users/Marco/OneDrive/git_projects/fnd-devs' diff --check
```

Exit `0`; duration `248 ms`; no whitespace error. Existing LF-to-CRLF working-copy warnings were emitted for the 47 protected tracked paths.

## Final ownership, artifact, and fixture audit

- Two consecutive exclusive-bind samples, `100 ms` apart, proved all twelve listed Task 08 ports free.
- Elevated read-only `Win32_Process` inventory, using corrected outer-process capture, found zero command lines matching the supervisor, either probe fixture, `scripts/performance/emulators.js`, or the controlled helper commands; zero live `taskkill.exe`; and zero live process among all 18 explicitly recorded focused/matrix PIDs.
- No review-created `fnd-supervisor-*` directory remains. Only the two historical pre-lease directories in the Minor finding remain.
- Final generated config and Playwright marker are absent.
- Retained fixture report SHA-256 is unchanged at `48bfa23355699d5865c05779dc72dedfd753c05cf54865e5a1c187933639e600`, with `verifiedAt=2026-09-01T20:24:05.746Z`, project `demo-fnd-perf`, `9,139` documents, `136` Storage objects, and approved fixture hash `fbabc02a3376d466cf717e3886e0d12a9e15568c17b654322cff4909dc6eaca8`.

## Product/manual evidence boundary

No Browser run was performed, and the user's staging Browser tab was not inspected or touched.

The Attempt 12 Browser evidence remains applicable. Its source identity was tracked diff `c6565b3b24ca56878a17e17a7ec6860d1faa6d33da5f94cde2e6b33bf60d4ce8` / source tree `6235c283cf134a4e2c3d6b9a015da4bf2e05a47a02b8300f4d0a0e2ecc9dc902`, and it recorded green physical resource behavior with cleanup as its only red boundary. Attempt 13 changed the tracked fingerprint to `e37fec10f6696eea6efcb1b58cd1d5af38bd94fefd809f8b83e53c55db2b959f` for emulator lifecycle harness work. That tracked fingerprint remains unchanged now. The protected-manifest comparison proves the only later non-coordinator content changes are the three declared files under `frontend/scripts/performance`; no product, resource, callable, metric, StatsBars, Task 08 scenario, or dependency file changed. Fresh staging identity and performance-disabled checks passed. A new Browser gate is therefore neither required nor safer than carrying the already-recorded product observation.

## Final status

- Verdict: GREEN; no Critical or Important finding.
- Required fresh automated gates: syntax `4/4`, adversarial production assertions `6/6`, focused supervisor `32/32`, relevant matrix `112/112`, and `perf:test` `484/484`; zero failures and zero skips.
- Cleanup: all review-created processes/PIDs/artifacts are gone, all listed ports are free in two samples, generated config/marker are absent, the fixture report is unchanged, and protected state is preserved.
- Current HEAD: `9c7fcc7c5799a458768512b7cbab49e4d9b301a9`.
- Current code fingerprint excluding this coordinator directory: `00e0a97306b3a769fe7c4bb1b241f845016a050a005c31fca899a6ea4c59f44f`.
- Requested action: accept the terminal-fallback workstream review result.
