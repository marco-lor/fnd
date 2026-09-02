# Task 08 Step 3 developer report

status: DONE

## Objective and actual scope

Objective: implement and locally verify Task 08 Step 3 for Character Creation in the
existing fnd-devs worktree. The implementation covers route-owned read-only
loading, authoritative profile consumption, serialized navigation, and avatar/media
cleanup. Later Task 08 steps were not implemented.

Actual scope:

- Added a Character-Creation-owned loader that starts the required Codex and Varie
  reads in parallel, exposes one shared snapshot/status, supports explicit retry,
  and fences stale completions by route/account/repository generation and attempt.
- Injected Codex, Anima/Varie, and combat-cost data into the four Character Creation
  steps. Children no longer launch their own Codex/config reads.
- Preserved the AuthProvider profile subscription as the only profile source and
  switched Character Creation to the split session/profile contexts.
- Added synchronous navigation locking for Next, Back, non-final progression, and
  final submission. Failure paths release the lock while keeping the user on the
  current step.
- Preserved existing Task 05 command payloads, retry keys, callable authority,
  durable-operation handling, revisit metrics, point policy, Task 07 media receipts
  and revision checks, and the accepted Task 08 instrumentation.
- Hardened partial/legacy Anima/profile/media data handling and verified object URL
  replacement, clear, invalid-file, cancel, route-unmount, and owner cleanup paths.

## Workspace and Git identity

- Workspace: C:\Users\Marco\OneDrive\git_projects\fnd-devs
- Canonical workspace was not edited: C:\Users\Marco\OneDrive\git_projects\fnd
- Branch: devs
- Baseline SHA: 9c7fcc7c5799a458768512b7cbab49e4d9b301a9
- Current SHA: 9c7fcc7c5799a458768512b7cbab49e4d9b301a9
- Upstream divergence at final review: devs...origin/devs = 1 0
- Accepted pre-Step-3 tracked-diff fingerprint:
  c867b6f4a56549c9df3f016124ff169c82b9ec341e7048e142e47cc52d5c33eb
- Final tracked-diff fingerprint:
  c3b5917bc77ed065cd1060d1ef3f24734207e4ab2976ba2b943fe1390fb70762
- Final source-tree fingerprint used by the local performance run:
  5f1d168d96e8fe57e2edc82902dc1be8cf570f5ab195d51be8ea5ed8a920ccb9

No commit, amend, push, merge, rebase, deployment, remote environment
inspection/mutation, or destructive Git/filesystem action was performed.

## Files changed

### Accepted pre-existing Step 2 files retained

The following accepted dirty files were present before Step 3 and were preserved:

- docs/performance-improvement-plan/task-08/README.md
- frontend/performance/tests/browser/task08-baseline.performance.js
- frontend/scripts/performance/task08-contract.js
- frontend/scripts/performance/task08-contract.test.js
- frontend/src/AuthContext.js
- frontend/src/AuthContext.test.js
- frontend/src/components/Login.js
- frontend/src/components/Login.test.js
- frontend/src/components/LoginCreateButton.js
- frontend/src/components/characterCreation/CharacterCreation.js
- frontend/src/components/LoginCharacterCreation.integration.test.js
- frontend/src/components/LoginCreateButton.test.js
- frontend/src/components/LoginSubmitButton.js
- frontend/src/components/LoginSubmitButton.test.js
- frontend/src/components/LoginVisuals.js
- frontend/src/components/characterCreation/CharacterCreation.test.js

CharacterCreation.js and the two integration/Character Creation test files overlap
this list because they were accepted Step 2 files that required the Step 3
route-loader/navigation implementation or split-context/repository mocks. The
Step 2 login routing, account-created route-state banner consumption, auth/profile
gates, and Task 08 measurement meanings were preserved.

### Step 3 implementation and focused tests

- frontend/src/components/characterCreation/characterCreationData.js — route,
  account, and generation-scoped parallel loader, snapshot statuses, retry, and
  stale-attempt fencing.
- frontend/src/components/characterCreation/characterCreationData.test.js —
  concurrent start, one-call-per-read, rejection propagation, and data
  classification tests.
- frontend/src/components/characterCreation/CharacterCreation.js — injected route
  data, split auth contexts, synchronous navigation guard, stale scope cleanup,
  retry/loading UI, and media/navigation composition.
- frontend/src/components/characterCreation/CharacterCreation.step3.test.js —
  route load/revisit/retry, profile-source, rapid navigation, failure unlock,
  partial-profile, and stale-completion coverage.
- frontend/src/components/characterCreation/CharacterCreation.media.step3.test.js —
  object URL and route/media-owner lifecycle coverage.
- frontend/src/components/characterCreation/elements/RaceSelection.js — injected
  Codex consumption and legacy placeholder behavior without a child read.
- frontend/src/components/characterCreation/elements/RaceSelection.step3.test.js —
  injected ready/missing data behavior.
- frontend/src/components/characterCreation/elements/AnimaShardSelection.js —
  injected Varie consumption plus explicit loading/error/missing/malformed handling.
- frontend/src/components/characterCreation/elements/AnimaShardSelection.step3.test.js —
  injected ready and missing-data behavior.
- frontend/src/components/characterCreation/elements/PointsDistribution.js —
  injected combat-cost configuration while retaining the distinct progression
  domain subscription.
- frontend/src/components/characterCreation/elements/PointsDistribution.step3.test.js —
  injected-cost and malformed-cost safety.
- frontend/src/components/characterCreation/elements/CharacterDetails.js — safe
  partial legacy Anima handling.
- frontend/src/components/characterCreation/elements/CharacterDetails.step3.test.js —
  partial legacy payload safety.
- frontend/src/components/common/useObjectUrl.js — replacement/clear handoff
  prevents an old preview from being rendered while its lease is being revoked.
- frontend/src/data/codexRepository.js — narrow Codex cache invalidation used by
  explicit loader retry.
- frontend/src/data/media/mediaOperationOwner.step3.test.js — replacement,
  cancel, dispose, abort, and release ownership coverage.

Coordinator files under docs/coordinator/task-08-character-creation-step-3/ were
pre-existing coordinator additions; this report is the required new uncommitted
report.

## TDD RED evidence and diagnosed root cause

Before the production implementation, the focused Character Creation RED command
was run in the exact frontend working directory:

    $env:CI='true'; npm.cmd test -- --watch=false --watchman=false --runInBand src/components/characterCreation/CharacterCreation.step3.test.js src/components/characterCreation/elements/RaceSelection.step3.test.js src/components/characterCreation/elements/AnimaShardSelection.step3.test.js

The first sandbox invocation was blocked by the local Watchman permission; the
same command was rerun through the normal approved host mechanism and exited 1.
Three suites and 12 tests were exercised. The meaningful failures were:

- the route had made zero Codex/config calls because the data was still owned by
  child effects;
- no explicit Retry control existed;
- revisit did not reuse a route snapshot;
- Character Creation consumed the broad useAuth source twice instead of the split
  authoritative profile path;
- rapid Next produced two updateCharacterCreation calls;
- Next and Back were not synchronously disabled during deferred transitions;
- the stale-account case did not start the expected new scoped read;
- Race and Anima children did not render injected data because they still fetched
  independently.

The root cause was fragmented ownership: each step could mount its own repository
read and the navigation handlers had no synchronous lock before React could
rerender. A later focused RED regression also reproduced a stale final completion
leaving the new actor's Create button stuck in Creating...; the fix fences the
completion and resets loading/error state when the authenticated scope changes.

## Implementation summary and preserved invariants

useCharacterCreationData starts getCodex and getVarie synchronously before awaiting
either promise, then publishes one snapshot for the route. It makes one attempt
per authenticated route/account/generation scope, reuses repository caches,
invalidates only the narrow Codex/Varie cache entries for explicit retry, and
ignores stale completion/rejection callbacks after unmount, scope change, or a new
attempt. Transport failures remain visible as retryable errors. Valid legacy
missing data retains the existing race placeholder behavior, while Anima and
malformed data expose explicit status.

Character Creation has one synchronous token guard for all conflicting navigation.
Only the token owner may release the lock or apply an async result. A transition
failure stays on the current step, shows an error, and unlocks for retry. Existing
authoritative commands and payloads remain in place, and the route revisit
window/metric is recorded once for a rapid double Back.

The profile path remains the AuthProvider's single authoritative
subscribeAuthProfile subscription. No Character Creation source file adds getDoc,
subscribeAuthProfile, useUserProfile, or a second profile listener. The
PointsDistribution progression subscription remains a separate domain. Scope
changes fence pending work and prevent one actor's profile/media state from being
reused by another.

Object URL ownership remains lease-based and idempotent. Replacement hides the old
URL during handoff; removal, invalid replacement, picker cancellation, route
navigation, route unmount, newer media attempts, and failed completion release or
cancel the correct owner. Task 07 durable receipts, revision checks,
retry-without-reupload behavior, legacy rollback cleanup, and feature flags were
not redesigned.

## Verification

All commands below were run from
C:\Users\Marco\OneDrive\git_projects\fnd-devs\frontend unless otherwise stated.
No remote Firebase target was contacted.

Focused Step 3 Jest suites:

    $env:CI='true'; npm.cmd test -- --watch=false --watchman=false --runInBand src/components/characterCreation/characterCreationData.test.js src/components/characterCreation/CharacterCreation.step3.test.js src/components/characterCreation/CharacterCreation.media.step3.test.js src/components/characterCreation/CharacterCreation.test.js src/components/LoginCharacterCreation.integration.test.js src/components/characterCreation/elements/RaceSelection.step3.test.js src/components/characterCreation/elements/AnimaShardSelection.step3.test.js src/components/characterCreation/elements/PointsDistribution.step3.test.js src/components/characterCreation/elements/CharacterDetails.step3.test.js src/data/media/mediaOperationOwner.step3.test.js

Exit 0 — 10 suites passed, 26 tests passed.

Relevant Auth/repository/Task 07/media regression suites:

    $env:CI='true'; npm.cmd test -- --watch=false --watchman=false --runInBand src/AuthContext.test.js src/data/codexRepository.test.js src/data/configRepository.test.js src/data/repositoryRuntime.test.js src/data/userData/userDataRepository.test.js src/data/userData/userDataHooks.test.js src/data/userData/userDataCommands.test.js src/components/Login.test.js src/components/LoginCreateButton.test.js src/components/LoginSubmitButton.test.js src/components/common/useObjectUrl.test.js src/data/media/useTask07MediaOperationOwner.test.js src/data/media/task07MediaControl.test.js src/components/characterCreation/characterCreationAvatarMedia.test.js src/data/media/mediaConsumerAdapter.test.js

Exit 0 — 15 suites passed, 137 tests passed.

Full React gate:

    $env:CI='true'; npm.cmd test -- --watch=false --watchman=false --runInBand

Exit 0 — 154 suites passed, 1,386 tests passed.

Performance and contract checks:

    npm.cmd run perf:test

Exit 0 — 422/422 tests passed, 0 failed, 0 cancelled, 0 skipped.

    node --test --test-concurrency=1 scripts/performance/task08-contract.test.js scripts/performance/task08-report.test.js scripts/performance/task08-preflight.test.js scripts/performance/task08-runner.test.js scripts/performance/task08-fixture.test.js scripts/performance/task08-regression-contracts.test.js

Exit 0 — 23/23 Node tests passed.

    $task08Jdk = 'C:\Program Files\JetBrains\PyCharm 2024.1.4\jbr'; $env:JAVA_HOME = $task08Jdk; $env:Path = "$task08Jdk\bin;$env:Path"; npm.cmd run perf:build

Exit 0 — opt-in performance build compiled. Build identity
293c2dad9e36e44c0fe37eedc3b2d16f1072175321f5cd4575dca97da262a049; main asset
static/js/main.56b92a70.js; raw/gzip/brotli sizes 678756/205498/173739 bytes.

    $task08Jdk = 'C:\Program Files\JetBrains\PyCharm 2024.1.4\jbr'; $env:JAVA_HOME = $task08Jdk; $env:Path = "$task08Jdk\bin;$env:Path"; npm.cmd run perf:preflight

Exit 0 — Performance preflight passed (Node 22.22.2).

    $env:FND_GIT_BRANCH='devs'; npm.cmd run build:staging

Exit 0 — local staging-target build compiled successfully; no deployment.

    npm.cmd run perf:verify-disabled

Exit 0 — normal build contained no performance bridge/profiler/benchmark/
persistence artifacts.

    $env:FND_GIT_BRANCH='devs'; npm.cmd run verify:staging-build

Exit 0 — local staging-build verification passed; no deployment.

Task 08 behavior with browser skipped:

    $task08Jdk='C:\Program Files\JetBrains\PyCharm 2024.1.4\jbr'; $env:JAVA_HOME=$task08Jdk; $env:Path="$task08Jdk\bin;$env:Path"; $env:CI='true'; npm.cmd run perf:task08:behavior -- --skip-browser

Exit 0 — 4 Jest suites/55 tests passed, deterministic Node checks passed, 14
local callable-emulator tests passed, and owned emulator teardown passed.

Full local Task 08 run:

    $task08Jdk='C:\Program Files\JetBrains\PyCharm 2024.1.4\jbr'; $env:JAVA_HOME=$task08Jdk; $env:Path="$task08Jdk\bin;$env:Path"; $env:CI='true'; npm.cmd run perf:task08

Exit 0 — fixture verified at 9,139 documents with hash
fbabc02a3376d466cf717e3886e0d12a9e15568c17b654322cff4909dc6eaca8;
preflight/rules 15/15; exact-query checks 3/3; local Playwright task08-chromium
6/6 passed in 5.2 minutes with one worker; browser was Chromium 149.0.7827.55
using Playwright 1.61.1; owned emulator teardown passed.

The final automated performance observation recorded:

- Codex reads: 1
- config schema reads: 0
- Varie reads: 1
- revisit count: 1
- revisit reads: 0
- profile subscriptions: 1
- authoritative actions: 3
- writes: 3
- duplicate transitions: 0
- object URL creates/revokes: 1/1
- cleanup count: 2

Port cleanup probe after the local behavior and browser runs:

    node -e "const net=require('node:net'); const ports=[3000,3001,5000,5001,5002,8080,9099,9150,9199]; const probe=p=>new Promise(resolve=>{const s=net.createServer(); s.once('error',()=>resolve(false)); s.listen({host:'127.0.0.1',port:p,exclusive:true},()=>s.close(()=>resolve(true)));}); Promise.all(ports.map(async p=>[p,await probe(p)])).then(rows=>{const busy=rows.filter(([,free])=>!free).map(([p])=>p); if(busy.length){console.error('BUSY '+busy.join(',')); process.exitCode=1;} else console.log('APP_AND_HARNESS_PORTS_FREE '+ports.join(','));})"

Exit 0 — APP_AND_HARNESS_PORTS_FREE
3000,3001,5000,5001,5002,8080,9099,9150,9199.

## Manual Browser preparation (no manual verdict)

This is a deterministic preparation path for the coordinator's separate manual
Browser gate. It is not a claim that the manual gate passed.

1. From C:\Users\Marco\OneDrive\git_projects\fnd-devs\frontend, start the
   local-only harness:

       $task08Jdk = 'C:\Program Files\JetBrains\PyCharm 2024.1.4\jbr'
       $env:JAVA_HOME = $task08Jdk
       $env:Path = "$task08Jdk\bin;$env:Path"
       $env:CI = 'true'
       npm.cmd run perf:preflight
       npm.cmd run perf:emulators

   Leave this foreground terminal running. In a second terminal at the same
   directory, seed and verify the deterministic fixture:

       npm.cmd run perf:seed
       npm.cmd run perf:verify-fixture

2. In the coordinator's local Browser, open
   http://127.0.0.1:5000/ and sign in with the deterministic incomplete account
   perf-new-player@example.test and fixture password PerfTest!123.

3. Exercise forward/back and repeated visits; slow/reload the route while
   observing the loading state; force a local Firestore read failure and restore
   it to check the explicit Retry path; reload through auth/profile readiness
   transitions; and verify partial legacy profile data without optional image,
   media, or revision fields does not crash or reuse another actor's state.

4. Rapidly double-click Next and Back. Expected preparation observations are one
   step movement, one transition/command, and disabled conflicting controls while
   busy. On a forced transition failure, the route should remain on the same step
   and controls should unlock for retry.

5. Exercise avatar first select, replacement, remove/clear, invalid replacement,
   picker cancel, and route Cancel/unmount. Expected preparation observation is
   that no stale preview reappears and every created URL is cleaned up exactly
   once.

6. Stop the emulator terminal with Ctrl+C after manual work, then rerun the port
   cleanup probe above. Do not leave a server or emulator running.

The automated local run already exercised the owned emulator and teardown. No
fatin-test, remote account/data, remote staging, or production target was used.

## Final self-review, residual risks, and decisions

Self-review completed:

- verified branch, baseline/current SHA, worktree topology, and final dirty scope;
- checked final diff for whitespace errors and inspected route ownership, async
  scope fences, transition-token release, profile-source count, and media cleanup;
- confirmed Character Creation production source has no duplicate profile read or
  profile listener;
- confirmed no speculative config schema read was added;
- confirmed normal build performance artifacts are disabled;
- confirmed all local app/emulator ports are free.

Residual risk: the coordinator still owns the separate manual Browser gate,
including any visual behavior that requires the in-app Browser and manual
throttling/failure controls. Automated local evidence is complete, but this report
does not mark that manual gate as observed or passed.

Decisions needed: coordinator review of the report and manual Browser preparation;
no deployment or later Task 08 step is requested.

## Authorized external actions

None. All edits, tests, builds, emulator activity, and browser automation were
local and loopback-only. No remote mutation or deployment was performed.

## Final git status

The worktree remains intentionally uncommitted. Exact
git status --short --untracked-files=all output after writing this report:

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
    ?? docs/coordinator/task-08-character-creation-step-3/plan.md
    ?? docs/coordinator/task-08-character-creation-step-3/reports/.gitkeep
    ?? docs/coordinator/task-08-character-creation-step-3/reports/step-03-attempt-01.md
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

All status entries are intentional: the M entries include accepted Step 2 changes
and Step 3 changes to overlapping Character Creation files; the ?? coordinator
files were supplied by the coordinator except for this report, and the ?? product
and test files are the accepted Step 2 files plus the Step 3 focused tests listed
above. The current branch and HEAD remain unchanged at devs /
9c7fcc7c5799a458768512b7cbab49e4d9b301a9.
