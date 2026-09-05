# Task 08 Step 3 developer report — review-fix attempt 4

status: DONE

## Objective and actual scope

This attempt addressed the two Important regressions identified in the
attempt-3 rereview, and only those Step 3 concerns:

- prevent a browser-delivered physical double-click on Back from starting a
  second revisit after the first render/effect flush;
- preserve the deterministic actor-owned character-name default when exact
  profile ownership becomes ready after route initialization, while resetting
  it correctly for a real actor change and retaining a legitimate same-UID
  edit.

No later Task 08 step, mutation redesign, deployment, commit, or remote
environment action was performed.

## Workspace and Git identity

- Exact workspace: `C:\Users\Marco\OneDrive\git_projects\fnd-devs`
- Canonical `fnd` checkout: not edited
- Branch: `devs`
- Baseline SHA: `9c7fcc7c5799a458768512b7cbab49e4d9b301a9`
- Current SHA: `9c7fcc7c5799a458768512b7cbab49e4d9b301a9`
- `origin/devs...devs`: `0 1` (`devs` is ahead by one accepted commit)
- Accepted pre-Step-3 tracked-diff fingerprint:
  `c867b6f4a56549c9df3f016124ff169c82b9ec341e7048e142e47cc52d5c33eb`
- Attempt-4 local browser-run tracked-diff fingerprint:
  `92682b0ae777d5ebefeb1ec7956f2f6e543da633b111321b917211507ba60d95`
- Attempt-4 local browser-run source-tree fingerprint:
  `a64c55a158604efc27b3b9c09dc07e8033fe85229ed748b51563c69631e767c8`
- The worktree remains intentionally dirty and uncommitted.

The final `git status --short` was checked after this report was written. The
existing Step 2/attempt-3 entries and coordinator artifacts remain present;
the report is the only new coordinator artifact from this attempt. No reset,
stash, clean, checkout-discard, history rewrite, dependency change, push, or
deployment was performed.

## Files changed and preserved scope

### Accepted Step 2 state preserved

These accepted Login/Auth/performance files were not rewritten for this
attempt:

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

The direct login route, one-time account-created route-state consumption,
authoritative profile ownership, and Task 08 measurement contracts remain
intact.

### Earlier Step 3 state preserved

The prior Step 3 source, media, repository, child-control, and regression
files were preserved, including:

- `frontend/src/components/characterCreation/CharacterCreation.js`
- `frontend/src/components/characterCreation/CharacterCreation.test.js`
- `frontend/src/components/characterCreation/characterCreationData.js`
- `frontend/src/components/characterCreation/characterCreationData.test.js`
- `frontend/src/components/characterCreation/CharacterCreation.media.step3.test.js`
- `frontend/src/components/characterCreation/CharacterCreation.step3.test.js`
- `frontend/src/components/characterCreation/elements/AnimaShardSelection.js`
- `frontend/src/components/characterCreation/elements/AnimaShardSelection.step3.test.js`
- `frontend/src/components/characterCreation/elements/CharacterDetails.js`
- `frontend/src/components/characterCreation/elements/CharacterDetails.step3.test.js`
- `frontend/src/components/characterCreation/elements/PointsDistribution.js`
- `frontend/src/components/characterCreation/elements/PointsDistribution.step3.test.js`
- `frontend/src/components/characterCreation/elements/RaceSelection.js`
- `frontend/src/components/characterCreation/elements/RaceSelection.step3.test.js`
- `frontend/src/components/common/useObjectUrl.js`
- `frontend/src/data/codexRepository.js`
- `frontend/src/data/media/mediaOperationOwner.step3.test.js`

Attempt 3 already supplied resource lifetime fencing, actor reset and stale
async fencing, exact profile redirect gating, owned legacy rollback,
independent current-step loading, and Task 07 cleanup behavior. Those changes
were not redesigned here.

### Attempt-4 implementation delta

- `frontend/src/components/characterCreation/CharacterCreation.js`
  - `prevStep` now receives the click event and synchronously ignores
    follow-up click events with `detail > 1`, which are the second physical
    click in a browser double-click burst. Existing navigation ownership,
    disabled/busy controls while the transition is pending, instrumentation,
    failure release, and later single-click behavior remain unchanged.
  - Added actor-default name ownership. Before any exact actor is established,
    a route email is used only when it belongs to the current user (or no user
    email exists). Once an actor has been established, a real actor transition
    uses only the current authenticated user's email; loss of ownership clears
    the name. The initializer no longer overwrites an established actor's
    name, so same-UID refreshes and user edits are retained.
- `frontend/src/components/characterCreation/CharacterCreation.step3.test.js`
  - Added a browser-faithful Back regression that flushes the first render,
    delivers the second click with `detail: 2`, checks the final step and
    exact revisit/transition counts, then proves a later single Back still
    works.
  - Extended delayed exact-profile readiness through Character Details and
    asserted the route-derived default name.
  - Added actor-switch and same-UID refresh assertions for default derivation
    and edited-name retention.
- `docs/coordinator/task-08-character-creation-step-3/reports/step-03-attempt-04.md`
  - This uncommitted evidence report.

## TDD RED evidence and diagnosed root causes

The production fixes were not present when the focused RED command ran. The
tests used real deferred/settled React state transitions and did not weaken or
disable the reviewed behavior.

From `C:\Users\Marco\OneDrive\git_projects\fnd-devs\frontend`:

```powershell
$env:CI='true'; npm.cmd test -- --watch=false --watchman=false --runInBand src/components/characterCreation/CharacterCreation.step3.test.js --testNamePattern='browser-faithful|leaves initialization|preserves an edited'
```

Exit `1`: 1 suite, 3 selected tests; 2 failed, 1 passed, 22 skipped, 25
total. The failures were:

- after the first Back click had rendered Step 3, the `detail: 2` follow-up
  click moved the unfixed wizard to Step 2 and started a second revisit;
- after the exact profile became fresh, the delayed-readiness journey reached
  Character Details with an empty name instead of `created`.

The same-UID edit-preservation assertion passed as a control. The diagnosed
causes were the missing browser click-burst boundary around the Back handler,
and the actor-ownership reset's unconditional `setCharacterName('')` after
the initial route initializer had already run.

## Implementation summary and preserved invariants

The Back handler now uses the browser's stable click `detail` field to reject
the second physical click in the same burst after React has committed the
first step. This is synchronous, does not add an arbitrary timer or permanent
latch, preserves keyboard/default single-click events (`detail` 0/1), and
allows a later deliberate Back. The existing navigation ref lock still
serializes same-turn events and the existing transition effect still produces
one transition end for each owned transition.

Character-name initialization is now owned by the actor lifecycle. The first
exactly-owned actor receives the route/current-user default, actor loss clears
all actor-owned name state, a different exact actor receives that actor's
current-user default, and same-UID repository-generation changes do not rerun
the ownership transition or overwrite edits. Route success/banner handling,
profile readiness/ownership gates, selections, avatar cleanup, Task 05
payloads, Task 07 receipts, and Task 08 event meanings are unchanged.

## Verification commands and exact settled results

All commands below were run from the exact `fnd-devs` checkout unless the
command's working directory is explicitly shown.

### Focused and relevant React suites

```powershell
$env:CI='true'; npm.cmd test -- --watch=false --watchman=false --runInBand src/components/characterCreation/CharacterCreation.step3.test.js --testNamePattern='browser-faithful|leaves initialization|preserves an edited'
```

Exit `0`: 1 suite; 3 passed, 22 skipped, 25 total.

```powershell
$env:CI='true'; npm.cmd test -- --watch=false --watchman=false --runInBand src/components/characterCreation/CharacterCreation.media.step3.test.js src/components/characterCreation/CharacterCreation.step3.test.js src/components/characterCreation/CharacterCreation.test.js src/components/characterCreation/characterCreationData.test.js src/components/characterCreation/elements/AnimaShardSelection.step3.test.js src/components/characterCreation/elements/CharacterDetails.step3.test.js src/components/characterCreation/elements/PointsDistribution.step3.test.js src/components/characterCreation/elements/RaceSelection.step3.test.js src/data/media/mediaOperationOwner.step3.test.js src/components/LoginCharacterCreation.integration.test.js
```

The focused command exited `0`: 10 suites, 52 tests passed.

```powershell
$env:CI='true'; npm.cmd test -- --watch=false --watchman=false --runInBand src/components/characterCreation/CharacterCreation.media.step3.test.js src/components/characterCreation/CharacterCreation.step3.test.js src/components/characterCreation/CharacterCreation.test.js src/components/characterCreation/characterCreationData.test.js src/components/characterCreation/elements/AnimaShardSelection.step3.test.js src/components/characterCreation/elements/CharacterDetails.step3.test.js src/components/characterCreation/elements/PointsDistribution.step3.test.js src/components/characterCreation/elements/RaceSelection.step3.test.js src/data/media/mediaOperationOwner.step3.test.js src/components/LoginCharacterCreation.integration.test.js src/AuthContext.test.js src/components/Login.test.js src/data/codexRepository.test.js src/data/configRepository.test.js src/data/repositoryRuntime.test.js src/data/userData/userDataHooks.test.js src/data/userData/userDataRepository.test.js src/components/common/useObjectUrl.test.js src/components/characterCreation/characterCreationAvatarMedia.test.js
```

Exit `0`: 19 suites, 138 tests passed.

```powershell
$env:CI='true'; npm.cmd test -- --watch=false --watchman=false --runInBand
```

Exit `0`: 154 suites, 1,412 tests passed.

```powershell
& 'node_modules/.bin/eslint.cmd' src/components/characterCreation/CharacterCreation.js src/components/characterCreation/characterCreationData.js
```

Exit `0`. The repository emitted only its existing Browserslist staleness
notice. `git diff --check` also exited `0`; its only output was the expected
Windows LF/CRLF conversion warning for dirty tracked files.

### Task 08 contracts, performance, and builds

```powershell
node --test --test-concurrency=1 scripts/performance/task08-contract.test.js scripts/performance/task08-report.test.js scripts/performance/task08-preflight.test.js scripts/performance/task08-runner.test.js scripts/performance/task08-fixture.test.js scripts/performance/task08-regression-contracts.test.js
```

Exit `0`: 23/23 tests passed.

```powershell
$env:CI='true'; npm.cmd run perf:test
```

Exit `0`: 422/422 tests passed; no failures, cancellations, or skips.

```powershell
$task08Jdk = 'C:\Program Files\JetBrains\PyCharm 2024.1.4\jbr'; $env:JAVA_HOME = $task08Jdk; $env:Path = "$task08Jdk\bin;$env:Path"; $env:FND_GIT_BRANCH='devs'; $env:CI='true'; npm.cmd run build:staging
```

Exit `0`: local staging-target build compiled successfully; no deployment or
remote access occurred.

```powershell
$env:CI='true'; npm.cmd run perf:verify-disabled
```

Exit `0`: normal build contained no performance bridge, profiler,
benchmark, or persistence-experiment artifacts.

```powershell
$env:FND_GIT_BRANCH='devs'; npm.cmd run verify:staging-build
```

Exit `0`: local staging-build verification passed.

```powershell
$task08Jdk = 'C:\Program Files\JetBrains\PyCharm 2024.1.4\jbr'; $env:JAVA_HOME = $task08Jdk; $env:Path = "$task08Jdk\bin;$env:Path"; $env:CI='true'; npm.cmd run perf:build
```

Exit `0`: opt-in performance build completed. Build identity was
`e64f4d0431b616378dac6d16372aa9ff4bd4d17b6872bce90d3c2a93b06dc821`, with
main asset `static/js/main.058f8a3f.js` and SHA-256
`fd8b4b8c9a23536eb67a792d2fcecc192b733d49ec7109d44e7b9ca58edc1fab`.

### Local demo-fnd-perf behavior and Chromium

```powershell
$task08Jdk = 'C:\Program Files\JetBrains\PyCharm 2024.1.4\jbr'; $env:JAVA_HOME = $task08Jdk; $env:Path = "$task08Jdk\bin;$env:Path"; $env:CI='true'; npm.cmd run perf:preflight
```

Exit `0`: Node `22.22.2` preflight passed.

```powershell
$task08Jdk = 'C:\Program Files\JetBrains\PyCharm 2024.1.4\jbr'; $env:JAVA_HOME = $task08Jdk; $env:Path = "$task08Jdk\bin;$env:Path"; $env:CI='true'; npm.cmd run perf:task08:behavior -- --skip-browser
```

Exit `0`: 4 Jest behavior suites/55 tests passed, 4 deterministic Node
behavior tests passed, and 14 local callable-emulator tests passed. The
loopback rules/query checks settled at 15/15 and 3/3 in the harness.

```powershell
$task08Jdk = 'C:\Program Files\JetBrains\PyCharm 2024.1.4\jbr'; $env:JAVA_HOME = $task08Jdk; $env:Path = "$task08Jdk\bin;$env:Path"; $env:CI='true'; npm.cmd run perf:task08
```

Exit `0`: 6/6 local Playwright tests passed in 4.3 minutes with one worker;
Chromium `149.0.7827.55`, Playwright `1.61.1`. The settled report is
`performance-results/task08-baseline.json` with `officialBaseline=false`.
The `task08-character-creation` observation was:

- Codex reads: `1`
- Varie/config reads: `1`; config schema reads: `0`
- explicit revisit reads: `0`; revisit count: `1`
- profile subscriptions: `1`
- authoritative actions/writes: `3/3`
- duplicate transitions: `0`
- object URL create/revoke: `1/1`
- cleanup count: `2`

Run identity was `03b212ba-0998-467c-ba59-35649f6192b0`, and the run used the
dirty-worktree identity above. This is local automated evidence only and is
not the coordinator-owned manual Browser verdict.

### Fixture restoration and port cleanup

After the behavior and Chromium runs, the deterministic local fixture was
explicitly restored and verified:

```powershell
$task08Jdk = 'C:\Program Files\JetBrains\PyCharm 2024.1.4\jbr'; $env:JAVA_HOME = $task08Jdk; $env:Path = "$task08Jdk\bin;$env:Path"; $env:CI='true'; npm.cmd run perf:emulators
```

The foreground wrapper was intentionally stopped with `Ctrl+C`; its wrapper
exit was `1` because interruption is the requested cleanup action.

```powershell
$task08Jdk = 'C:\Program Files\JetBrains\PyCharm 2024.1.4\jbr'; $env:JAVA_HOME = $task08Jdk; $env:Path = "$task08Jdk\bin;$env:Path"; $env:CI='true'; npm.cmd run perf:seed
```

Exit `0`: fixture restored and verified at `9,139` documents with hash
`fbabc02a3376d466cf717e3886e0d12a9e15568c17b654322cff4909dc6eaca8`.

```powershell
$env:CI='true'; npm.cmd run perf:verify-fixture
```

Exit `0`: the same `9,139`-document/hash fixture was independently verified.

```powershell
node -e "require('./scripts/performance/emulators').assertEmulatorPortsFree().then(()=>console.log('HARNESS_PORTS_FREE')).catch(error=>{console.error(error.message);process.exit(1)})"
```

Exit `0`: `HARNESS_PORTS_FREE`.

```powershell
$ports = @(3000,3001,4000,4400,4500,5000,5001,5002,8080,9099,9150,9199); $listeners = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $ports -contains $_.LocalPort }; if ($listeners) { $listeners | Select-Object LocalAddress,LocalPort,OwningProcess | Format-Table -AutoSize; exit 1 } else { 'APP_AND_HARNESS_PORTS_FREE' }
```

Exit `0`: `APP_AND_HARNESS_PORTS_FREE`. No task-owned process or server was
left running.

## Manual Browser preparation only

The coordinator may use this deterministic local path for its separate manual
gate. This report does not claim that manual gate passed.

From `C:\Users\Marco\OneDrive\git_projects\fnd-devs\frontend`:

```powershell
$task08Jdk = 'C:\Program Files\JetBrains\PyCharm 2024.1.4\jbr'
$env:JAVA_HOME = $task08Jdk
$env:Path = "$task08Jdk\bin;$env:Path"
$env:CI = 'true'
npm.cmd run perf:preflight
npm.cmd run perf:emulators
```

In a second terminal at the same directory, while the foreground emulator
wrapper is running:

```powershell
npm.cmd run perf:seed
npm.cmd run perf:verify-fixture
```

Use only `http://127.0.0.1:5000/`, project `demo-fnd-perf`, and the
deterministic incomplete account `perf-new-player` /
`perf-new-player@example.test` with fixture password `PerfTest!123`.

Preparation expectations are: a physical Back double-click settles on only
the immediately previous step; a later single Back works; Step 4 displays the
current actor's default name; actor/profile readiness does not expose a prior
actor's name; repeated visits do not create new repository reads; and avatar
preview/reload/unmount remains leak-free. No final submission should be made.

After the disposable local run, restore and verify with `perf:seed` and
`perf:verify-fixture`, stop the foreground emulator terminal with `Ctrl+C`,
and rerun both port-free checks above. Do not use `fatin-test`, a remote
account, staging/production URLs, or raw Firebase deployment.

## Final self-review, residual risks, and decisions

- Verified branch, baseline/current SHA, permanent worktree, dirty scope, and
  untouched canonical checkout.
- The browser-faithful regression models the actual post-render click delivery
  (`detail: 1` then `detail: 2`) and confirms one Back transition/revisit,
  followed by a valid later single Back.
- Actor default derivation is exact-owner scoped; established same-UID edits
  are retained and actor changes/loss clear old name state.
- Attempt-3 resource fencing, independent Codex/Varie loading, profile
  subscription ownership, legacy media cleanup, Task 05 commands, Task 07
  receipts, and accepted Step 2 route/banner behavior remain covered by the
  green focused/relevant/full suites.
- Local performance identity is dirty and `officialBaseline=false`; it is not
  an official baseline or a coordinator manual Browser verdict.

Residual risk: the coordinator still owns the separate manual Browser visual
gate and any manual throttling/read-failure/actor-switch demonstration. The
reviewed browser double-Back path is covered by the new deterministic React
regression and the handler's browser click-detail boundary; the automated
four-scenario Task 08 journey itself does not replace that manual gate.

Decision needed: coordinator review and manual Browser execution only. No
deployment, commit, or later Task 08 step is requested.

## Authorized external action

None. All edits, tests, builds, emulator activity, fixture restoration, and
browser automation were local or loopback-only.

## Final `git status --short`

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
?? docs/coordinator/
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
