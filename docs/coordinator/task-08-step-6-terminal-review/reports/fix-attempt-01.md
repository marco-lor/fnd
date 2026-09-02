# Task 08 Step 6 terminal fallback remediation — fix attempt 01

## Identity, lease, and outcome

- Status: `DONE`; both authenticated Important findings from review attempt 1 are repaired locally and are ready for the same independent reviewer.
- Control ID: `task08-step6-review-a38f4568`.
- Step / workstream / implementation attempt: `1` / `terminal-fallback-acceptance` / `1`.
- Dispatch token: `b64a010e-769d-4127-9227-60cba98b5a67`.
- Dispatch control revision: `5`; current `control.md` revision read: `6`. Revision 6 records this already-running dispatch and is expected coordinator bookkeeping inside the excluded directory.
- Requested / canonical task: `step6_fix_01_b64a010e` / `/root/step6_fix_01_b64a010e`.
- Effective pair: `gpt-5.6-sol` / `high`.
- Checkout / branch: `C:\Users\Marco\OneDrive\git_projects\fnd-devs` / `devs`.
- Baseline and current HEAD: `9c7fcc7c5799a458768512b7cbab49e4d9b301a9` / `9c7fcc7c5799a458768512b7cbab49e4d9b301a9`.
- Protected manifest: `docs/coordinator/task-08-step-6-terminal-review/protected-dirty-state.md`.
- No commit, push, merge, PR, deployment, remote Firebase read/write, live-data mutation, dependency change, reset, stash, clean, worktree change, product/resource edit, Browser action, staging-tab action, or Step 7 work occurred.

Before any edit, the exact PowerShell serialization used by review attempt 1 was rerun, excluding only `docs/coordinator/task-08-step-6-terminal-review/`. Every dispatch component matched:

| Component | Dispatch verification |
| --- | --- |
| Branch / HEAD | `devs` / `9c7fcc7c5799a458768512b7cbab49e4d9b301a9` |
| Porcelain-v2 status SHA-256 | `ed57ee27449fdf20e360cea59f22fc6c91d7e4f750835d951aee1ab0623760ed` |
| Staged diff SHA-256 | `01ba4719c80b6fe911b091a7c05124b64eeece964e09c058ef8f9805daca546b` |
| Unstaged binary diff SHA-256 | `e37fec10f6696eea6efcb1b58cd1d5af38bd94fefd809f8b83e53c55db2b959f` |
| Sorted 70-path untracked tree SHA-256 | `91996d06c5426293866b77628f49a411f4ed3041ea1a573d8d27e04ae14cad2a` |
| Composite code-workspace fingerprint | `9c556fa01c4db1de8c7f55adda9c73f8a48cbea59f1584f7bf8bd46307faa028` |

The same serialization after implementation retained the exact branch, HEAD, status, staged, and tracked-unstaged components. Only the contents of the three already-untracked leased files changed:

- current untracked tree SHA-256: `b9571ad655d905147b76c7aef95de390ab0c865b10ed44e476ab2dc0a1aaade2`;
- current composite code-workspace fingerprint: `00e0a97306b3a769fe7c4bb1b241f845016a050a005c31fca899a6ea4c59f44f`.

No unexplained writer or protected-state mismatch was observed.

## Production reproductions and RED-first evidence

Both findings were reproduced against untouched Attempt 16 production before test or production edits.

### Rejected connected handoff

The review reproduction issued a connected request whose Firebase SIGINT listener threw, recorded the negative acknowledgement, then disconnected IPC. It exited nonzero and printed:

```text
REJECT_THEN_DISCONNECT {"afterRejection":{"connected":true,"disconnectListeners":0,"messageListeners":1,"sigints":1,"fallbacks":[],"ack":{"type":"fnd-performance-emulator-shutdown-ack","requestId":"owned-request","accepted":false,"reason":"controlled handler failure"}},"afterParentLoss":{"disconnectListeners":0,"messageListeners":1,"sigints":1,"fallbacks":[],"exitCode":null}}
```

This proves the child removed its disconnect ownership before acceptance and did not recover it after rejection.

The first production-code regression command selected the connected rejection, asynchronous acknowledgement failure, and synchronous channel-close cases. It failed `0/3` for the intended missing-fallback assertions; TAP duration was `137.6175 ms`.

### Referenced helper surviving the deadline

A real detached Node helper had a `1,200 ms` natural lifetime and a `50 ms` production deadline. Attempt 16 transferred to the injected root-retention owner at `64 ms` but the caller did not exit until `1,298 ms`:

```text
RETENTION_TRANSFER {"elapsedMs":64,"helperPid":24776,"diagnostic":"taskkill did not terminate rootPid=12564 within 50 ms"}
TIMEOUT_CALLER_EXIT {"code":1,"elapsedMs":1298,"helperPid":24776}
```

The RED helper command selected the real deadline/error probes and exact settlement unit cases. It failed `0/4`; controlled helpers survived `1,314 ms` and `1,293 ms`, and unit assertions observed no owned-helper kill/unref. TAP duration was `2,955.1973 ms`.

## Root causes and changes

### Finding 1 — rejected connected shutdown ownership

Root cause: `requestFirebaseCliShutdown()` removed `handleParentDisconnect` before invoking the Firebase SIGINT listener. A thrown listener therefore returned a rejection after child ownership had already been discarded. Negative acknowledgement delivery errors were ignored, and a later disconnect could not run fallback. Re-entering the shutdown function after a rejection would also yield `duplicate-request`, losing the original diagnosis.

Repair in `frontend/scripts/performance/firebase-emulator-supervisor.js`:

- The disconnect listener is removed only after a Firebase SIGINT handoff is accepted.
- A throwing handler records its original rejection reason while leaving child disconnect ownership active.
- A later disconnect reuses that recorded reason and never emits SIGINT a second time.
- Negative acknowledgement delivery failure, whether synchronous channel closure or asynchronous send-callback error, transfers immediately to the one child fallback with the original rejection diagnosis.
- A late duplicate after an already accepted graceful handoff is explicitly not treated as a new child-owned failure. Existing accepted shutdown remains no-fallback and idempotent.
- Terminal fallback still removes both supervisor lifecycle listeners first; duplicates and late messages are harmless.

The real owned-process helper in `frontend/scripts/performance/firebase-emulator-supervisor.test.js` can now request connected shutdown, authenticate the negative acknowledgement, disconnect the parent, and prove the exact supervisor and descendant PIDs disappear and the exact owned port becomes stably free.

### Finding 2 — referenced helper surviving terminal settlement

Root cause: common settlement cleared the deadline and removed listeners but left the detached taskkill helper referenced. The deadline therefore did not bound the second owned process/handle, even after the sole diagnosed root retainer was installed.

Repair in `frontend/scripts/performance/firebase-emulator-supervisor.js`:

- Every settlement is guarded by the existing one-winner gate.
- Settlement clears the one referenced deadline, removes both helper listeners, and unrefs the exact already-owned helper once.
- Deadline and asynchronous-helper-error settlement additionally call `kill()` only on that exact helper object before or as authority transfers. No PID discovery or unrelated targeting is introduced.
- A false/throwing exact-helper kill is appended to the retained diagnostic; it does not launch a second helper, retry, or weaken the single exact-root retainer.
- Natural helper exit/code/signal settlement releases the helper reference without trying to kill an already-settled helper.
- Synchronous launch throw and no-observable-child paths retain the same fail-closed exact-root policy and clear their deadline.
- The pre-settlement helper and deadline references from Attempt 16 remain intact, preserving protection against natural code-0 exit.

`frontend/scripts/performance/firebase-emulator-supervisor-liveness-probe-fixture.js` now has controlled `helper-exit`, `deadline`, and `helper-error` modes. The two new modes use a real long-lived detached helper, record its exact PID, and do not exit until that exact PID is gone. They demonstrate that cleanup occurs far before natural lifetime.

## Changed files and hashes

Only the three leased lifecycle files plus this assigned report changed:

- `frontend/scripts/performance/firebase-emulator-supervisor.js` — production ownership/settlement repair; SHA-256 `63ee0c8998270134750bd2af8a3423980c22a24238ced740d5a89f13e0ff60ac`.
- `frontend/scripts/performance/firebase-emulator-supervisor.test.js` — RED-first unit and real owned-process regressions; SHA-256 `d530ae279fc0f1bc40949d8dde47792e2331bc54cda7535f4779303e71d1952b`.
- `frontend/scripts/performance/firebase-emulator-supervisor-liveness-probe-fixture.js` — real deadline and async-error helper-PID probes; SHA-256 `ad5565e3b480f8df6c798331b288cc212b70d1d2036344c4c98cc41d12d2a6ad`.
- `docs/coordinator/task-08-step-6-terminal-review/reports/fix-attempt-01.md` — this report; excluded coordinator bookkeeping.

No product, resource, StatsBars, callable, metric, emulator caller, dependency, fixture-data, or build artifact source changed.

## Fresh GREEN verification

All commands ran from `frontend` unless noted. Process-owning suites were run outside the restricted sandbox so their already-owned exact `taskkill.exe /PID <trusted supervisor PID> /T /F` integrations could complete.

- Focused rejected-handoff GREEN: `3/3` passed, `0` failed, `0` skipped; TAP `138.0119 ms`.
- Focused helper settlement GREEN: `5/5` passed, `0` failed, `0` skipped; TAP `478.2896 ms`. Real evidence was `deadline=70 ms`, helper PID `5576` gone; async error `57 ms`, helper PID `25224` gone.
- Final supervisor suite: `32/32` passed, `0` failed, `0` skipped; TAP `2,917.0962 ms`, command wall `3.279 s`.
  - Final no-other-ref evidence: helper settled at `847 ms`, caller at `961 ms`, diagnosed nonzero `23`.
  - Final deadline evidence: helper PID `14132` gone at `66 ms`, diagnosed nonzero `24`.
  - Final async-error evidence: helper PID `27604` gone at `46 ms`, diagnosed nonzero `25`.
  - Final connected rejection tree: supervisor PID `18704`, descendant PID `11584`, port `62177`; both PIDs gone and port stably free in `491 ms`.
- Syntax: `node --check` passed for the supervisor, the existing owned-tree probe fixture, and the liveness probe fixture (`3/3`, all exit `0`).
- Required six-file matrix:
  `node --test scripts/performance/emulators.test.js scripts/performance/firebase-emulator-supervisor.test.js scripts/performance/task07-harness.test.js scripts/performance/task08-contract.test.js scripts/performance/task08-runner.test.js scripts/performance/task08-preflight.test.js`
  — `112/112` passed, `0` failed, `0` skipped; TAP `2,893.6011 ms`, wall `3.2606 s`.
- `npm.cmd run perf:test`: `484/484` passed, `0` failed, `0` skipped; TAP `14,882.6504 ms`, wall `16.4025 s`. The pre-existing Node `punycode` deprecation warning appeared; no new test warning or failure occurred.
- Retained normal build: command-scoped `FND_GIT_BRANCH=devs`; `npm.cmd run verify:staging-build` and `npm.cmd run perf:verify-disabled` both exited `0`. The latter confirmed no performance bridge, profiler, benchmark, or persistence-experiment artifacts.
- `git diff --check`: exit `0`; only the existing LF-to-CRLF working-copy warnings were emitted.
- No Browser run was required because all edits are lifecycle-harness-only. The user's staging tab was not inspected or touched.

## Cleanup, fixture, and protected-state evidence

- Before process-owning integration, production preflight plus explicit binds proved ports `3000,3001,4000,4400,4500,5000,5001,5002,8080,9099,9150,9199` free; the generated Firebase config and Playwright active marker were absent.
- Final two-sample explicit bind verification proved all twelve ports free twice, `100 ms` apart.
- Final elevated read-only process inventory, excluding its own PowerShell command, found zero `firebase-emulator-supervisor`, probe-fixture, `scripts/performance/emulators.js`, or `taskkill.exe` matches.
- Final generated config `frontend/.firebase.performance.generated.json` and marker `frontend/.perf-emulator-data/playwright-webserver.active` are absent.
- Retained fixture report SHA-256 remains `48bfa23355699d5865c05779dc72dedfd753c05cf54865e5a1c187933639e600`, with unchanged `verifiedAt=2026-09-01T20:24:05.746Z`, project `demo-fnd-perf`, `9,139` documents, `136` Storage objects, and approved hash `fbabc02a3376d466cf717e3886e0d12a9e15568c17b654322cff4909dc6eaca8`.
- One intentionally restricted focused run demonstrated the known taskkill permission boundary and retained three exact task-owned trees. Only exact roots `10680`, `16584`, and `4684` were elevated-taskkilled; recorded descendants/helpers were then proven gone and ports `62009`, `62013`, and `62020` free. Their three exact temporary directories were removed.
- A later task-owned stale directory `fnd-supervisor-no-handler-WVyIMr` recorded already-gone PIDs `23236/9604` and free port `62126`; only that exact directory was removed.
- The two historical directories `fnd-supervisor-throwing-handler-tphG2C` and `fnd-supervisor-throwing-handler-NFbqEl` predate this lease and remain untouched as required.

## Lifecycle self-review and residual risk

- Connected accepted request: one SIGINT, accepted acknowledgement, disconnect ownership removed, no child fallback, late duplicates harmless.
- Connected rejected request: one SIGINT, exactly one negative acknowledgement attempt, zero fallback while healthy, original diagnosis retained; disconnect or failed acknowledgement delivery enters one fallback.
- Direct and initialization-time disconnect: existing retry-after-initialization and accepted/failed terminal behavior remain covered.
- Fallback launch throw: deadline cleared, diagnosis retained, one exact-root retainer.
- No observable helper: deadline cleared, any exact helper cleanup method is bounded, one retainer.
- Async helper error: exact helper listeners removed, exact helper killed/unrefed once, deadline cleared once, one retainer; late captured callbacks do nothing.
- Helper exit with code/signal: helper unrefed once, deadline cleared once, one retainer.
- Deadline: one pre-settlement helper ref, one exact-helper kill, one post-settlement unref, one deadline clear, zero residual helper listeners, one retainer; late timer/error/exit callbacks do nothing.
- Platform routing remains exact: Windows still uses only `taskkill.exe /PID <trusted supervisor PID> /T /F`; POSIX still signals only the trusted detached negative process-group PID.
- Direct caller behavior in `emulators.js` was not changed and remains covered in the passing 112-test matrix and 484-test performance suite.

Residual risk is the deliberate fail-closed policy already accepted in Attempt 16: if exact helper cleanup itself cannot be confirmed, the appended diagnostic and the one referenced exact-root retainer require external exact-root intervention. There is no second helper, retry loop, PID rediscovery, silent code-0 exit, or weaker cleanup claim. Evidence-only warnings are the known restricted taskkill denial, Node `punycode` deprecation, and existing LF-to-CRLF messages.

## Final Git status

- `git status --short --branch`: `devs...origin/devs [ahead 1]` with the protected accumulated Task 08 tracked/untracked state still present.
- Staged diff remains empty; tracked unstaged SHA-256 remains the dispatch value `e37fec10f6696eea6efcb1b58cd1d5af38bd94fefd809f8b83e53c55db2b959f`.
- The only non-coordinator content drift from the dispatch fingerprint is the three leased untracked files listed above. No protected file was reset, stashed, cleaned, overwritten, or discarded.

This implementation stops at local verification and requests independent re-review.
