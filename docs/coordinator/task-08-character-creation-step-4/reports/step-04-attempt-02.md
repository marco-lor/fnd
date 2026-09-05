# Task 08 Step 4 developer report — attempt 2

status: DONE_WITH_CONCERNS

## Objective and boundaries

Remediated both Important findings from the independent attempt-1 review in
the existing `fnd-devs` checkout:

1. Character Creation retry identities now follow the current logical action
   scope. A stale ambiguous A identity is retired when the same scoped action
   advances to B, including while A is still in flight, so a later A is a new
   operation. An explicit retry of the same immutable ambiguous request still
   reuses its exact operation ID.
2. Character Creation replay telemetry no longer hides missing replay
   metadata. Only `replayed === false` records physical application;
   `replayed === true` is replay-only; an absent or invalid envelope records a
   diagnostic `command-non-replayed-success` event.

No later Task 08 step was started. No production or staging Firebase state was
read or mutated. No commit, push, merge, pull request, deployment, baseline
acceptance, reset, stash, discard, or worktree-topology change was performed.
The coordinator-owned staging/remote Browser acceptance remains outstanding.

## Workspace and source identity

- Exact checkout: `C:\Users\Marco\OneDrive\git_projects\fnd-devs`
- Canonical `fnd` checkout: not edited
- Branch: `devs`; upstream: `origin/devs`; divergence: `0` behind / `1` ahead
- Baseline SHA: `9c7fcc7c5799a458768512b7cbab49e4d9b301a9`
- Current SHA: `9c7fcc7c5799a458768512b7cbab49e4d9b301a9`
- Accepted pre-Step-4 tracked-diff fingerprint:
  `92682b0ae777d5ebefeb1ec7956f2f6e543da633b111321b917211507ba60d95`
- Accepted pre-Step-4 source-tree fingerprint:
  `b817fee6a81ebcd40c03e1959ba6a75cf47dbaecc70e10b4e2ef040b231fb21c`
- Attempt-2 starting tracked-diff fingerprint:
  `9857d0eb4536f9faf686932c7a200c7aec7ee126e16fa30d172db3699128fb5c`
- Attempt-2 starting source-tree fingerprint:
  `6ed4c1d22da543d21967770e3d9603aaf87b97b10a6c80af30149490d1e8355d`
- Final tracked-diff fingerprint:
  `2ac90fa777a5a5b0db7d2f8578ffd79f2c7f757569d3c29ab2d545c09b1bd932`
- Final source-tree fingerprint:
  `e9d7a650c770dbc1ce11f737d46d1657916e7a6be08b0347d2e373687449ed66`
- Final opt-in performance build identity:
  `a219482c5c69880cf649885d0de07850e10e9425c7b5164d09c177907501bac6`
- Final performance main asset: `static/js/main.bec507aa.js`, SHA-256
  `2248a56dc05842304c1940d2b305c623dc651ddaa52fed73bae010994e194a7a`

The worktree remains intentionally dirty. All accepted Step 2/3 state and the
attempt-1 Step 4 state were preserved; the attempt-2 code/tests, README entry,
and this report are additive.

## Attempt-2 implementation delta

- `frontend/src/data/userData/userDataCommands.js`
  - Added an internal `retryScope` channel to `updateCharacterCreation`; it is
    destructured before the callable payload is constructed and never sent to
    Firebase or Task 08 telemetry.
  - Keyed retained identities by the exact immutable request bytes and scope.
    Same-scope transitions retire older retained and in-flight entries, while
    the explicit same-request retry path retains its operation ID. Definitive
    callable failures still retire the identity, and late old completions are
    prevented from deleting a newer retained entry by an operation-ID check.
  - Removed the callable-name exception from replay telemetry. A response
    without `replayed === false` is never classified as a physical write.
- `frontend/src/components/characterCreation/CharacterCreation.js`
  - Passes actor/profile-ownership/repository-generation/navigation-fenced
    scopes for initialize, race, Anima, and completion actions. Scope state is
    internal only; late UI work remains fenced by the existing ownership
    tokens.
- `frontend/src/data/userData/userDataCommands.test.js` and
  `frontend/src/components/characterCreation/CharacterCreation.step3.test.js`
  - Added RED/green coverage for concurrent reuse, exact ambiguous retry,
    A-to-B-to-A identity retirement, pending stale invocation retirement,
    changed completion name/media, definitive failure retirement, actor and
    repository-generation boundaries, caller scopes, scope stripping, and
    truthful replay/fallback telemetry.
- `frontend/performance/tests/task05-callables.test.js`
  - Added an emulator check for truthful first/replay envelopes across
    initialize, selectRace, selectAnima, and complete. Existing Task 05
    server authority and receipt schema were not changed in this attempt.
- `docs/performance-improvement-plan/task-08/README.md`
  - Added an additive attempt-2 record with the RED evidence, implementation
    invariants, fresh automated counts, browser identity/metrics, warnings,
    cleanup, and local-only/manual-acceptance boundaries.

## Root cause and preserved invariants

Attempt 1 forwarded no `retryScope` from Character Creation to the wrapper.
The wrapper retained a retry identity too broadly, so after an ambiguous A and
a successful B, a later A could resurrect A's old operation receipt. The fix
keeps exact request bytes in the identity key and retires all older identities
for the same logical action scope, including metadata for still-running
invocations. A same-request explicit retry remains idempotent.

The second finding came from an explicit `name !== 'task05CharacterCreation'`
telemetry suppression. The fix removes that suppression and adds server-backed
coverage for every valid Character Creation action. Valid server responses
therefore produce the required truthful envelope; test-only unknown-envelope
responses remain visible as diagnostic fallback events.

The existing Task 05 callable authority, atomic race reset, Anima authority,
completion rejection, point policy, media lease/abort/cleanup fences,
actor/generation fences, and durable receipt behavior remain unchanged.

## TDD RED evidence

The first focused command-wrapper RED run was:

`npm.cmd --prefix frontend test -- --watch=false --watchman=false --runInBand src/data/userData/userDataCommands.test.js`

It exited `1`: `1` suite, `7` failed, `19` passed, `26` total. The failures
covered the missing unknown-envelope fallback event, leaked `retryScope`, stale
A-to-B-to-A race and completion identities, missing caller scopes, and the
definitive-retirement assertion.

The combined wrapper/caller RED run exited `1` with `10` failed and `44`
passed. It included the same seven wrapper failures plus three missing
Character Creation caller-scope assertions. Before adding in-flight metadata,
the targeted command-wrapper regression:

`npm.cmd --prefix frontend test -- --watch=false --watchman=false --runInBand src/data/userData/userDataCommands.test.js --testNamePattern="in-flight Character Creation"`

exited `1` with `expected 3 callable calls, received 2`.

After remediation, the combined wrapper/caller command passed `2/2` suites
and `55/55` tests. The broader relevant Character Creation, child-control,
media, points, and wrapper run passed `12/12` resolved suites and `127/127`
tests. The fresh full React suite passed `154/154` suites and `1,430/1,430`
tests.

## Verification and exact results

All commands were run from the exact checkout unless noted otherwise.

| Command/result | Evidence |
| --- | --- |
| `npm.cmd --prefix frontend/functions run build` | PASS — `105` Functions output files; no retired Task 05 runtime artifacts. |
| `npm.cmd --prefix frontend run perf:test` | PASS on the elevated rerun — `422/422` tests, `0` failures/cancellations/skips. The initial sandbox run failed only four Firebase Storage runtime cases with configstore `EPERM`; no product assertion failed. |
| `npm.cmd --prefix frontend run perf:task08:behavior -- --skip-browser` with `C:\Program Files\JetBrains\PyCharm 2024.1.4\jbr` | PASS — `16/16` local emulator behavior checks; managed emulator cleanup completed. |
| `$env:FND_GIT_BRANCH='devs'; npm.cmd --prefix frontend run build:staging` | PASS — local `devs`/`fatin-test` staging-target build; no deploy. |
| `$env:FND_GIT_BRANCH='devs'; npm.cmd --prefix frontend run verify:staging-build` | PASS — local hardened staging-build verification. |
| `npm.cmd --prefix frontend run perf:verify-disabled` while the normal build was present | PASS — no active performance bridge, profiler, benchmark, or persistence-experiment artifacts. |
| `npm.cmd --prefix frontend run perf:build` followed by `npm.cmd --prefix frontend run perf:preflight` | PASS — final opt-in build/preflight against the final documentation-state identity; Node `22.22.2`, portable Java 21+. |
| `npm.cmd --prefix frontend run perf:task08` with the same JDK | PASS — `6/6` local Chromium Playwright tests; complete report and emulator cleanup. |
| `npm.cmd --prefix frontend run perf:fixture-determinism` | PASS — `9,139` documents, canonical hash `fbabc02a3376d466cf717e3886e0d12a9e15568c17b654322cff4909dc6eaca8`. |
| Production ESLint for `userDataCommands.js` and `CharacterCreation.js` | PASS. |
| `$env:CI='true'; npm.cmd --prefix frontend test -- --watch=false --watchman=false --runInBand` | PASS — `154/154` suites, `1,430/1,430` tests, `0` skipped/cancelled. |
| `git diff --check` | PASS — only existing LF-to-CRLF conversion warnings were reported. |

The required staging build order was completed before the opt-in performance
build: `build:staging`, `verify:staging-build`, and `perf:verify-disabled` ran
while the normal staging-target build was present. The final opt-in build and
preflight were rerun after the additive attempt-2 documentation/report state.

## Source-matched local browser observation

The completed local report is
`frontend/performance-results/task08-baseline.json`, run
`2619a39e-8235-4233-a4fb-255a8a22f725`, with Chromium `149.0.7827.55` and
Playwright `1.61.1`. The browser scenarios were source-matched immediately
before the attempt-2 README append. At that point the identity was source
`44e7efcf1b7b3a54c8917e8ccf077717ec0c88309dab942fb41d101e7d774b03`, tracked
`d17e4fc516419c2de6cd00c48aeacae4ba012ab20bc3a44e4cfffe28c1b23662`, with
performance build identity
`475dfc063a98e08ef2415b331ba4432cb7b93c81641817672d258d48a2c1e8f2`.

The Character Creation scenario recorded:

| Metric | Observed |
| --- | ---: |
| Codex reads | `1` |
| Config-schema reads | `0` |
| Config-varie reads | `1` |
| Intentional step revisit | `1` |
| Revisit reads | `0` |
| Profile subscriptions | `1` |
| Authoritative action count | `2` |
| Callable writes | `2` |
| Non-replayed-success fallback events | `0` |
| Duplicate transitions | `0` |
| Object URL create/revoke | `1 / 1` |
| Character Creation cleanup events | `2` |

The report is complete but remains `officialBaseline=false`; it is local
reproducibility evidence, not an accepted baseline. No staging observation was
made.

## Fixture, cleanup, warnings, and concerns

- The behavior and browser runs used only the disposable loopback
  `demo-fnd-perf` emulators. The fixture identity was verified during the
  browser run and independently by deterministic generation: `9,139` documents
  and hash `fbabc02a3376d466cf717e3886e0d12a9e15568c17b654322cff4909dc6eaca8`.
- `frontend/.firebase.performance.generated.json` and
  `frontend/.perf-emulator-data/playwright-webserver.active` are absent. Task
  ports `3000,3001,5000,5001,5002,8080,9099,9150,9199` and harness ports
  `4000,4400,4500` were free after cleanup.
- The first sandboxed attempt-2 browser run completed all six scenarios but
  could not shut down its exact Firestore emulator PID `11544` because of
  Windows access denial. Its command line was confirmed as the
  `demo-fnd-perf` Firestore emulator using this checkout's rules and ports;
  elevated cleanup terminated only that process. The corrected rerun completed
  with clean emulator shutdown. No unrelated process was terminated.
- Expected local-only warnings remain: Browserslist/caniuse-lite age, Node
  `punycode` deprecation, Firebase CLI MOTD/remote-config, Java rules-runtime
  `Unsafe`, Playwright `NO_COLOR`/`FORCE_COLOR`, and negative-path Firestore
  rules diagnostics. Existing ignored emulator logs/configstore files remain
  outside the tracked diff.
- Manual staging/remote Browser acceptance is coordinator-owned and was not
  performed. `perf:baseline -- --accept` was not run. No live Firebase data,
  deployment, commit, push, merge, PR, reset, stash, discard, or worktree
  topology change occurred.

## Requested coordinator action

Review the attempt-2 implementation and source-matched local evidence. The
two Important findings are remediated and local automated gates are green;
retain the concern that manual staging/remote Browser acceptance remains
outside this developer authorization envelope. Do not begin Step 5 from this
developer task.
