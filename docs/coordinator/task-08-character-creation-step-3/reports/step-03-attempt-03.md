# Task 08 Step 3 developer report — review-fix attempt 3

status: DONE

## Objective and actual scope

Objective: complete the remaining Step 3 review fixes for Character Creation in
the existing permanent `fnd-devs` worktree and verify them locally. This
attempt stayed within Task 08 Step 3. No later Task 08 step was implemented.

The review-fix scope was completed as one ownership, cancellation, and loading
correction:

- Character Creation resource completions now have effect-lifetime ownership,
  so resolve/reject callbacks cannot publish after the resource hook unmounts.
- Wizard state and all pending work are actor-owned. An actual UID/profile
  ownership change resets the wizard before the next actor is usable; a
  same-UID repository generation change fences pending work without wiping
  legitimate progress.
- Profile completion redirects require an exact fresh profile owner. Delayed
  account-created route success remains pending until that same actor owns a
  fresh profile, and cannot cross an established actor change.
- Legacy avatar uploads are registered before upload, tagged with immutable
  scope/submission ownership, retained through the metadata command boundary,
  and rolled back only by their own owner. Download-URL failures, stale actor
  exits, cancellation, unmount, and supersession have exact cleanup coverage.
- Current-step loading is incremental: Step 1 gates on Codex only, while later
  steps use Varie independently and remain usable during an unrelated Codex
  refresh or failure.

## Workspace and Git identity

- Exact workspace: `C:\Users\Marco\OneDrive\git_projects\fnd-devs`
- Canonical `fnd` checkout: not edited
- Branch: `devs`
- Baseline SHA: `9c7fcc7c5799a458768512b7cbab49e4d9b301a9`
- Current SHA: `9c7fcc7c5799a458768512b7cbab49e4d9b301a9`
- `devs...origin/devs`: `1 0`
- Accepted pre-Step-3 tracked-diff fingerprint:
  `c867b6f4a56549c9df3f016124ff169c82b9ec341e7048e142e47cc52d5c33eb`
- Attempt-3 final tracked-diff fingerprint used by the local Task 08 run:
  `8f790bbf01c72cb01c4b6cefa7ee16d83ceb570fecb0248548377e2da42f8cbd`
- Attempt-3 final source-tree fingerprint used by the local Task 08 run:
  `d284b00d220c0b30c9cd80a13a552563bfa7a9555b4d1ebf39ea84c1df4b354e`
- Final local performance build identity:
  `8a796900e49cd621097f498e8460bf559ec835a0dbbd0f31fa6b7c34ae58d2ce`
- Final performance main asset: `static/js/main.f129d4d3.js`
- Final performance main asset SHA-256:
  `70728d82b88e677112a3b5c706d7b6469eea849de7c9669d505f73155a4d98d1`

The worktree remains intentionally uncommitted. No commit, amend, push, merge,
rebase, deployment, remote inspection/mutation, dependency upgrade, reset,
stash, clean, checkout-discard, or history rewrite was performed.

## Files changed

### Accepted Step 2 and prior Step 3 dirty state preserved

The complete accepted Step 2 and Step 3 attempt-2 state was inspected and
preserved. This includes the accepted Login/Auth changes and overlapping
Character Creation route work in:

- `docs/performance-improvement-plan/task-08/README.md`
- `frontend/performance/tests/browser/task08-baseline.performance.js`
- `frontend/scripts/performance/task08-contract.js`
- `frontend/scripts/performance/task08-contract.test.js`
- `frontend/src/AuthContext.js`
- `frontend/src/AuthContext.test.js`
- `frontend/src/components/Login.js`
- `frontend/src/components/Login.test.js`
- `frontend/src/components/LoginCreateButton.js`
- `frontend/src/components/LoginCharacterCreation.integration.test.js`
- `frontend/src/components/LoginCreateButton.test.js`
- `frontend/src/components/LoginSubmitButton.js`
- `frontend/src/components/LoginSubmitButton.test.js`
- `frontend/src/components/LoginVisuals.js`
- `frontend/src/components/characterCreation/CharacterCreation.js`
- `frontend/src/components/characterCreation/CharacterCreation.test.js`
- the previously accepted Step 3 child, repository, media, and focused test
  files already present at handoff.

`CharacterCreation.js` and the integration test overlap accepted Step 2
behavior. Direct login routing, one-time account-created route-state
consumption, authoritative AuthProvider profile ownership, auth/profile gates,
Task 08 instrumentation, and Task 05/Task 07 payload and receipt semantics
were retained.

### Attempt-3 implementation delta

- `frontend/src/components/characterCreation/characterCreationData.js` — added
  effect-lifetime mounted ownership to every Codex/Varie resolve, reject, and
  retry path while preserving independent settlement and generation fencing.
- `frontend/src/components/characterCreation/CharacterCreation.js` — reset
  actor-owned wizard state, exact profile redirect readiness, delayed banner
  consumption, current-step data gates, immutable legacy upload ownership,
  pre-upload registration, completion-boundary cleanup, and stale transition
  fencing.
- `frontend/src/components/characterCreation/characterCreationData.test.js` —
  deferred unmount regression proving no post-unmount state publication.
- `frontend/src/components/characterCreation/CharacterCreation.step3.test.js` —
  exact-owner redirect, same-UID current-step loading, actor-switch reset,
  stale resolve/reject, and generation fencing regressions.
- `frontend/src/components/characterCreation/CharacterCreation.media.step3.test.js` —
  overlapping actor upload ownership and post-upload URL-failure rollback
  regressions.
- `frontend/src/components/LoginCharacterCreation.integration.test.js` —
  delayed exact-profile account-created confirmation regression.

No Task 04/05/07 remote media architecture or Step 4 mutation redesign was
undertaken.

## TDD RED evidence and diagnosed root cause

The new assertions were run before their corresponding production fixes. The
RED runs used deferred promises and behaviorally accurate repository/media
mocks; no syntax error, disabled mock, or weakened expectation manufactured a
failure.

### Attempt-3 combined RED

From `C:\Users\Marco\OneDrive\git_projects\fnd-devs\frontend`:

```powershell
$env:CI='true'; npm.cmd test -- --watch=false --watchman=false --runInBand src/components/characterCreation/characterCreationData.test.js src/components/characterCreation/CharacterCreation.step3.test.js src/components/characterCreation/CharacterCreation.media.step3.test.js src/components/LoginCharacterCreation.integration.test.js
```

Exit `1`: 4 suites, 5 failed assertions, 35 passed assertions, 40 total;
3 suites failed and 1 passed. The failures were:

- stale completed actor data redirected the new user to `/home`;
- a same-UID Codex refresh blanked Step 2 while the unrelated Codex read was
  pending;
- stale actor cleanup deleted both the old and newer actor's legacy upload;
- a failed download-URL lookup left no owned rollback entry;
- route success was consumed before exact profile readiness, so the banner was
  lost.

The diagnosed causes were the missing profile owner predicate, a global Codex
route gate, global legacy-upload enumeration, registration after the upload
function returned, and immediate route-state consumption during profile
loading.

### Hook-unmount RED

The focused lifetime regression was then run independently:

```powershell
$env:CI='true'; npm.cmd test -- --watch=false --watchman=false --runInBand src/components/characterCreation/characterCreationData.test.js --testNamePattern="does not dispatch"
```

Exit `1`: the assertion expected setter-call counts `[1,0]` after unmount and
late Codex resolve/Varie reject, but the unfixed hook produced `[3,0]`.
The root cause was that cleanup only cleared in-flight bookkeeping; it did not
invalidate the effect lifetime, so a late callback could still dispatch state
to the unmounted consumer.

## Implementation summary and preserved invariants

`useCharacterCreationData` captures a lifetime token in each resource attempt.
Mounted ownership, lifetime, scope key, repository generation, and per-resource
attempt must all still match before a resolve/reject/final state path can
publish. Codex and Varie still begin concurrently, settle independently, retry
independently, preserve successful data, and use the existing repository
invalidation/single-flight/cache/rejection semantics.

Character Creation now requires `profileStatus === 'fresh'` and
`profileUid === user.uid` before using the profile or starting the route-owned
reads. A real actor change or loss resets step, selections, points child key,
name/default ownership, image/preview, errors, pending transition/media work,
revisit state, and banner state. Same-UID generation changes fence old work but
retain legitimate wizard state. The AuthProvider remains the sole profile
subscription; the PointsDistribution progression subscription remains its
separate domain.

Race/Anima commands and final submission use synchronous navigation/operation
tokens. Every owned transition finishes at most once, stale success and
failure continuations cannot change the current actor's step/error/navigation/
metrics, and conflicting navigation, race, Anima, point, name, and file input
is both synchronously guarded and visibly disabled/busy.

Legacy entries are immutable by actor scope and submission token. An entry is
registered before upload, and cleanup waits for upload and any already-started
metadata command before deleting. Successful metadata completion commits and
removes only that entry; stale/cancelled/unmounted/failed work rolls back only
its own path, treating `storage/object-not-found` as safe. Task 07 leases,
receipts, revision checks, retry-without-reupload behavior, feature flags, and
remote media semantics remain unchanged.

Codex loading/error UI is now applied only to visible Step 1. Step 2/3 use
Varie status/error/retry independently, and Step 4 is not blanked by an
unrelated Codex refresh.

## Verification

All commands below were run from
`C:\Users\Marco\OneDrive\git_projects\fnd-devs\frontend` unless noted. All
Firebase behavior used only the local `demo-fnd-perf` emulators.

### Focused and relevant React suites

```powershell
$env:CI='true'; npm.cmd test -- --watch=false --watchman=false --runInBand src/components/characterCreation/characterCreationData.test.js src/components/characterCreation/CharacterCreation.step3.test.js src/components/characterCreation/CharacterCreation.media.step3.test.js src/components/characterCreation/CharacterCreation.test.js src/components/LoginCharacterCreation.integration.test.js src/components/characterCreation/elements/RaceSelection.step3.test.js src/components/characterCreation/elements/AnimaShardSelection.step3.test.js src/components/characterCreation/elements/PointsDistribution.step3.test.js src/components/characterCreation/elements/CharacterDetails.step3.test.js src/data/media/mediaOperationOwner.step3.test.js
```

Exit `0` — 10 suites, 50 tests passed.

```powershell
$env:CI='true'; npm.cmd test -- --watch=false --watchman=false --runInBand src/components/characterCreation/CharacterCreation.media.step3.test.js src/components/characterCreation/CharacterCreation.step3.test.js src/components/characterCreation/CharacterCreation.test.js src/components/characterCreation/characterCreationData.test.js src/components/characterCreation/elements/AnimaShardSelection.step3.test.js src/components/characterCreation/elements/CharacterDetails.step3.test.js src/components/characterCreation/elements/PointsDistribution.step3.test.js src/components/characterCreation/elements/RaceSelection.step3.test.js src/data/media/mediaOperationOwner.step3.test.js src/components/LoginCharacterCreation.integration.test.js src/AuthContext.test.js src/components/Login.test.js src/data/codexRepository.test.js src/data/configRepository.test.js src/data/repositoryRuntime.test.js src/data/userData/userDataHooks.test.js src/data/userData/userDataRepository.test.js src/components/common/useObjectUrl.test.js src/components/characterCreation/characterCreationAvatarMedia.test.js
```

Exit `0` — 19 suites, 136 tests passed. This included the relevant
Auth/Login, Codex/config/repository runtime, user-data, object-URL, Task 07
avatar, media-owner, and all ten focused Step 3 suites.

```powershell
$env:CI='true'; npm.cmd test -- --watch=false --watchman=false --runInBand
```

Exit `0` — 154 suites, 1,410 tests passed.

```powershell
& 'node_modules/.bin/eslint.cmd' src/components/characterCreation/CharacterCreation.js src/components/characterCreation/characterCreationData.js
```

Exit `0` — production files passed focused ESLint. The repository's existing
Browserslist staleness notice was printed. A separate exploratory lint of the
large test set reported 22 existing Testing Library style findings; it was not
an acceptance gate and no unrelated test-style rewrite was made.

### Performance, contracts, and builds

```powershell
$env:CI='true'; npm.cmd run perf:test
```

Exit `0` — 422/422 Node tests passed; 0 failed, cancelled, or skipped. An
initial ambient-Java-8 preflight failure was recorded separately below; the
required command-scoped Java 21+ run passed.

```powershell
node --test --test-concurrency=1 scripts/performance/task08-contract.test.js scripts/performance/task08-report.test.js scripts/performance/task08-preflight.test.js scripts/performance/task08-runner.test.js scripts/performance/task08-fixture.test.js scripts/performance/task08-regression-contracts.test.js
```

Exit `0` — 23/23 focused Task 08 Node tests passed.

```powershell
$env:CI='true'; npm.cmd run perf:preflight
```

Exit `1` — expected environment-only failure under ambient Java
`1.8.0_411` (Firestore emulator requires Java 21+). No product code was
changed for this failure.

```powershell
$task08Jdk = 'C:\Program Files\JetBrains\PyCharm 2024.1.4\jbr'; $env:JAVA_HOME = $task08Jdk; $env:Path = "$task08Jdk\bin;$env:Path"; $env:CI='true'; npm.cmd run perf:preflight
```

Exit `0` — preflight passed on Node `22.22.2` with command-scoped Java 21+.

```powershell
$task08Jdk = 'C:\Program Files\JetBrains\PyCharm 2024.1.4\jbr'; $env:JAVA_HOME = $task08Jdk; $env:Path = "$task08Jdk\bin;$env:Path"; $env:FND_GIT_BRANCH='devs'; $env:CI='true'; npm.cmd run build:staging
```

Exit `0` — local staging-target build compiled successfully; no deployment.

```powershell
$env:CI='true'; npm.cmd run perf:verify-disabled
```

Exit `0` — normal build contained no performance bridge, profiler,
benchmark, or persistence-experiment artifacts.

```powershell
$env:FND_GIT_BRANCH='devs'; npm.cmd run verify:staging-build
```

Exit `0` — local staging-build verification passed; no deployment.

```powershell
$task08Jdk = 'C:\Program Files\JetBrains\PyCharm 2024.1.4\jbr'; $env:JAVA_HOME = $task08Jdk; $env:Path = "$task08Jdk\bin;$env:Path"; $env:CI='true'; npm.cmd run perf:build
```

Exit `0` — final opt-in performance build compiled and wrote the build report
identity recorded above.

### Local Task 08 behavior and Chromium

```powershell
$task08Jdk = 'C:\Program Files\JetBrains\PyCharm 2024.1.4\jbr'; $env:JAVA_HOME = $task08Jdk; $env:Path = "$task08Jdk\bin;$env:Path"; $env:CI='true'; npm.cmd run perf:task08:behavior -- --skip-browser
```

Exit `0` — 4 Jest suites/55 tests passed, 4 deterministic Node tests passed,
and 14 local callable-emulator tests passed. The same local behavior harness
settled its rules/query checks at 15/15 and 3/3. Fixture verification during
the run reported 9,139 documents and hash
`fbabc02a3376d466cf717e3886e0d12a9e15568c17b654322cff4909dc6eaca8`; owned
emulator teardown completed without a readiness-sentinel flake in this
attempt.

```powershell
$task08Jdk = 'C:\Program Files\JetBrains\PyCharm 2024.1.4\jbr'; $env:JAVA_HOME = $task08Jdk; $env:Path = "$task08Jdk\bin;$env:Path"; $env:CI='true'; npm.cmd run perf:preflight
```

Exit `0` — Chromium journey preflight passed.

```powershell
$task08Jdk = 'C:\Program Files\JetBrains\PyCharm 2024.1.4\jbr'; $env:JAVA_HOME = $task08Jdk; $env:Path = "$task08Jdk\bin;$env:Path"; $env:CI='true'; npm.cmd run perf:task08
```

Exit `0` — 6/6 local Playwright tests passed in 3.9 minutes with one worker,
Chromium `149.0.7827.55`, and Playwright `1.61.1`. The generated report is
complete, contains all four required scenarios, and intentionally has
`officialBaseline=false` because the worktree is dirty.

The Character Creation observation in that report was:

- Codex reads: `1`
- Varie/config reads: `1`; config schema reads: `0`
- explicit revisit reads: `0`; revisit count: `1`
- profile subscriptions: `1`
- authoritative actions/writes: `3/3`
- duplicate transitions: `0`
- object URL create/revoke: `1/1`
- cleanup count: `2`

### Fixture restoration and port cleanup

The post-browser verification used a newly owned local emulator process. Its
empty initial state was detected by `perf:verify-fixture`, then restored
explicitly:

```powershell
$task08Jdk = 'C:\Program Files\JetBrains\PyCharm 2024.1.4\jbr'; $env:JAVA_HOME = $task08Jdk; $env:Path = "$task08Jdk\bin;$env:Path"; $env:CI='true'; npm.cmd run perf:emulators
```

The foreground process was intentionally stopped with `Ctrl+C`; the npm shell
returned exit `1` for the interruption after its owned process-tree cleanup.

```powershell
$task08Jdk = 'C:\Program Files\JetBrains\PyCharm 2024.1.4\jbr'; $env:JAVA_HOME = $task08Jdk; $env:Path = "$task08Jdk\bin;$env:Path"; $env:CI='true'; npm.cmd run perf:seed
```

Exit `0` — deterministic fixture restored and verified at 9,139 documents with
the expected hash.

```powershell
$env:CI='true'; npm.cmd run perf:verify-fixture
```

Exit `0` — fixture verified at 9,139 documents with hash
`fbabc02a3376d466cf717e3886e0d12a9e15568c17b654322cff4909dc6eaca8`.

```powershell
node -e "require('./scripts/performance/emulators').assertEmulatorPortsFree().then(()=>console.log('HARNESS_PORTS_FREE')).catch(error=>{console.error(error.message);process.exit(1)})"
```

Exit `0` — `HARNESS_PORTS_FREE`.

```powershell
$ports = @(3000,3001,4000,4400,4500,5000,5001,5002,8080,9099,9150,9199); $listeners = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $ports -contains $_.LocalPort }; if ($listeners) { $listeners | Select-Object LocalAddress,LocalPort,OwningProcess | Format-Table -AutoSize; exit 1 } else { 'APP_AND_HARNESS_PORTS_FREE' }
```

Exit `0` — `APP_AND_HARNESS_PORTS_FREE`. No task-owned server or emulator was
left running.

## Manual Browser preparation (no manual verdict)

This is the coordinator's deterministic localhost preparation path. It is not
a claim that the coordinator-owned manual Browser gate passed.

From `C:\Users\Marco\OneDrive\git_projects\fnd-devs\frontend`:

```powershell
$task08Jdk = 'C:\Program Files\JetBrains\PyCharm 2024.1.4\jbr'
$env:JAVA_HOME = $task08Jdk
$env:Path = "$task08Jdk\bin;$env:Path"
$env:CI = 'true'
npm.cmd run perf:preflight
npm.cmd run perf:emulators
```

In a second terminal at the same directory, while the foreground emulators are
running:

```powershell
npm.cmd run perf:seed
npm.cmd run perf:verify-fixture
```

Use only `http://127.0.0.1:5000/`, project `demo-fnd-perf`, and the deterministic
incomplete account `perf-new-player` /
`perf-new-player@example.test` with fixture password `PerfTest!123`.

Expected visible preparation results:

- Step 1 becomes usable after Codex settles even when Varie is pending; Step 2
  and Step 3 expose Varie loading/error with explicit retry when needed.
- Repeated forward/back visits preserve only the current actor's selections and
  do not create another physical Codex/Varie read.
- Reload and profile-readiness transitions show a deterministic waiting/error
  state; partial legacy profile data does not crash or reuse another actor.
- Rapid double Next/Back moves once, records one intended revisit, and leaves
  all conflicting cards, inputs, and navigation controls visibly disabled while
  work is pending. A failed transition remains on the same step and unlocks
  retry.
- Avatar first select, replacement, remove/clear, invalid replacement, picker
  cancel, route Cancel, and route unmount leave only the current preview and no
  leaked object URL.
- Actor switching starts the next actor at Step 1 without old race, Anima,
  name, avatar, error, banner, or navigation effects.

After any disposable local mutations, restore and verify before stopping:

```powershell
npm.cmd run perf:seed
npm.cmd run perf:verify-fixture
```

Stop the foreground emulator terminal with `Ctrl+C`, then confirm:

```powershell
node -e "require('./scripts/performance/emulators').assertEmulatorPortsFree().then(()=>console.log('HARNESS_PORTS_FREE')).catch(error=>{console.error(error.message);process.exit(1)})"
$ports = @(3000,3001,4000,4400,4500,5000,5001,5002,8080,9099,9150,9199); $listeners = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $ports -contains $_.LocalPort }; if ($listeners) { $listeners | Select-Object LocalAddress,LocalPort,OwningProcess | Format-Table -AutoSize; exit 1 } else { 'APP_AND_HARNESS_PORTS_FREE' }
```

Do not use `fatin-test`, a remote account, a staging/production URL, or raw
Firebase deployment.

## Final self-review, residual risks, and decisions

- Branch, baseline/current SHA, worktree topology, dirty scope, and untouched
  canonical checkout were rechecked.
- `git diff --check` passed; only expected Windows LF/CRLF notices were
  emitted.
- Resource callbacks are lifetime-fenced after unmount and after actor/
  generation/retry changes.
- Exact fresh profile ownership gates reads and redirects; no broad or
  duplicate profile listener was added.
- Legacy cleanup is submission-owned, pre-upload registered, idempotent, and
  safe across overlapping actors and completion failures.
- Current-step loading no longer lets unrelated Codex refresh state blank later
  steps.
- Accepted Step 2 direct routing, route-state banner semantics, auth/profile
  ownership, Task 08 measurement meanings, Task 05 commands, and Task 07
  durable media semantics were preserved.
- Browser automation is local evidence only and has `officialBaseline=false`;
  it is not baseline acceptance or the coordinator's manual Browser verdict.

Residual risk: the coordinator still owns the separate manual Browser gate,
including visual review and manual throttling/read-failure/actor-switch
demonstration. The exploratory test-file lint findings are style-only and were
not part of the repository acceptance gate.

Decision needed: coordinator review and manual Browser execution. No deployment
or later Task 08 step is requested.

## Authorized external actions

None. All edits, tests, builds, emulator activity, fixture restoration, and
browser automation were local and loopback-only.

## Final git status

The final status was checked after this report was written. The existing dirty
Step 2/attempt-2 entries and coordinator artifacts remain untouched; the only
new coordinator artifact from this attempt is this report:

```text
 M docs/performance-improvement-plan/task-08/README.md
 M frontend/performance/tests/browser/task08-baseline.performance.js
 M frontend/scripts/performance/task08-contract.js
 M frontend/scripts/performance/task08-contract.test.js
 M frontend/src/AuthContext.js
 M frontend/src/AuthContext.test.js
 M frontend/src/components/Login.js
 M frontend/src/components/Login.test.js
 M frontend/src/components/LoginCreateButton.js
 M frontend/src/components/characterCreation/CharacterCreation.js
 M frontend/src/components/characterCreation/elements/AnimaShardSelection.js
 M frontend/src/components/characterCreation/elements/CharacterDetails.js
 M frontend/src/components/characterCreation/elements/PointsDistribution.js
 M frontend/src/components/characterCreation/elements/RaceSelection.js
 M frontend/src/components/common/useObjectUrl.js
 M frontend/src/data/codexRepository.js
?? docs/coordinator/task-08-character-creation-step-3/control.md
?? docs/coordinator/task-08-character-creation-step-3/evidence/.gitkeep
?? docs/coordinator/task-08-character-creation-step-3/evidence/step-03-browser-review-attempt-01.md
?? docs/coordinator/task-08-character-creation-step-3/evidence/step-03-browser-review-attempt-02.md
?? docs/coordinator/task-08-character-creation-step-3/plan.md
?? docs/coordinator/task-08-character-creation-step-3/reports/.gitkeep
?? docs/coordinator/task-08-character-creation-step-3/reports/step-03-attempt-01.md
?? docs/coordinator/task-08-character-creation-step-3/reports/step-03-attempt-02.md
?? docs/coordinator/task-08-character-creation-step-3/reports/step-03-attempt-03.md
?? frontend/src/components/LoginCharacterCreation.integration.test.js
?? frontend/src/components/LoginCreateButton.test.js
?? frontend/src/components/LoginSubmitButton.js
?? frontend/src/components/LoginSubmitButton.test.js
?? frontend/src/components/LoginVisuals.js
?? frontend/src/components/characterCreation/CharacterCreation.media.step3.test.js
?? frontend/src/components/characterCreation/CharacterCreation.step3.test.js
?? frontend/src/components/characterCreation/CharacterCreation.test.js
?? frontend/src/components/characterCreation/characterCreationData.js
?? frontend/src/components/characterCreation/characterCreationData.test.js
?? frontend/src/components/characterCreation/elements/AnimaShardSelection.step3.test.js
?? frontend/src/components/characterCreation/elements/CharacterDetails.step3.test.js
?? frontend/src/components/characterCreation/elements/PointsDistribution.step3.test.js
?? frontend/src/components/characterCreation/elements/RaceSelection.step3.test.js
?? frontend/src/data/media/mediaOperationOwner.step3.test.js
```

Branch and HEAD remain `devs` /
`9c7fcc7c5799a458768512b7cbab49e4d9b301a9`.
