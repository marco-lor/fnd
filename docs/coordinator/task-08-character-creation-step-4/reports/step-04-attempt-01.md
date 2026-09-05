# Task 08 Step 4 developer report — attempt 1

status: DONE_WITH_CONCERNS

## Objective and boundaries

Implemented the Character Creation authoritative-mutation contract in the
existing `fnd-devs` checkout. The change covers race/Anima revisit ownership,
keyed callable idempotency, server-authoritative point changes, completion
and avatar retry ownership, truthful Task 08 telemetry, and the associated
regressions.

No later Task 08 step was started. No production or staging Firebase state was
read or mutated. No commit, push, merge, pull request, deployment, baseline
acceptance, reset, stash, discard, or worktree-topology change was performed.
The coordinator-owned remote/manual Browser acceptance remains outstanding.

## Workspace and source identity

- Exact checkout: `C:\Users\Marco\OneDrive\git_projects\fnd-devs`
- Canonical `fnd` checkout: not edited
- Branch: `devs` (`devs` remains one accepted commit ahead of `origin/devs`)
- Baseline SHA: `9c7fcc7c5799a458768512b7cbab49e4d9b301a9`
- Current SHA: `9c7fcc7c5799a458768512b7cbab49e4d9b301a9`
- Accepted pre-Step-4 tracked-diff fingerprint:
  `92682b0ae777d5ebefeb1ec7956f2f6e543da633b111321b917211507ba60d95`
- Accepted pre-Step-4 source-tree fingerprint:
  `b817fee6a81ebcd40c03e1959ba6a75cf47dbaecc70e10b4e2ef040b231fb21c`
- Final tracked-diff fingerprint:
  `9857d0eb4536f9faf686932c7a200c7aec7ee126e16fa30d172db3699128fb5c`
- Final source-tree fingerprint:
  `6ed4c1d22da543d21967770e3d9603aaf87b97b10a6c80af30149490d1e8355d`
- Final opt-in performance build identity:
  `6bec3b2fcb6e7b3beba09dd476bc851817ca27ad1d2b7674fbb1f098d7afe279`
- Final performance main asset: `static/js/main.d74e638d.js`, SHA-256
  `db9384a7cbc681995e1027926ee8d0f9dc7d5a11b5804daf3cf2942c95af4651`

The worktree remains intentionally dirty. All accepted Step 2/3 tracked and
untracked state was preserved; this report and the Step 4 README section are
additive.

## Step 4 implementation delta

- `CharacterCreation.js` records successful race and Anima values only for the
  current authenticated actor/repository generation. Unchanged forward-step
  revisits skip the callable; changed-then-changed-back values remain new
  logical actions. Completion and legacy avatar fallback now retain ownership
  across ambiguous outcomes and never delete an object that may have been
  referenced by an uncertain completion.
- `userDataCommands.js` now deduplicates concurrent immutable keyed requests,
  separates changed request bytes, retries only the exact ambiguous operation,
  retires definitive failures, and requires the replay envelope for Character
  Creation telemetry. Task 05 initialize now uses the existing durable
  server-side idempotency wrapper without changing its authority or schema.
- `PointsDistribution.js` passes the definitive-error classifier into durable
  intents, keeps the synchronous busy guard, releases it immediately after
  failure, and fences late UI effects by actor/repository generation.
- `mediaOperationReceiptStore.js`, `mediaPipeline.js`, and
  `characterCreationAvatarMedia.js` propagate a retained-receipt resume only
  for the still-attached attempt, avoiding repeated preparation/upload while
  retaining Step 3 abort, lease, cleanup, and replacement fences.
- Added focused regressions for concurrent callable reuse, changed-payload
  identity, revisit ownership, point failure recovery, retained media resume,
  preparation bypass, ambiguous legacy completion, and Task 05 initialize
  replay. Tightened the existing local browser selector to target the unique
  Points Distribution heading.

## TDD RED evidence

The intentional focused RED run used the six Step 4 suites with Watchman
disabled. It produced `7` failing tests and `95` passing tests. The failures
were the expected missing behaviors: keyed in-flight deduplication, changed
payload separation after an unavailable operation, unchanged revisit skipping,
definitive point-error handling/immediate recovery, retained-receipt resume
propagation, preparation bypass, and ambiguous legacy-completion cleanup.

The final focused command passed `6/6` suites and `104/104` tests. The full
React command passed `154/154` suites and `1,422/1,422` tests.

## Verification and exact results

All commands were run from the exact checkout unless noted otherwise.

| Command/result | Evidence |
| --- | --- |
| `npm.cmd --prefix frontend/functions run build` | PASS — 105 Functions output files; retired Task 05 runtime verification passed. |
| `npm.cmd --prefix frontend run perf:test` | PASS on the final elevated rerun — 422/422 Node tests, 0 failures/cancellations/skips. The initial sandbox attempt failed only four Firebase Storage runtime tests with configstore `EPERM`; no product assertion failed. |
| `npm.cmd --prefix frontend run perf:task08:behavior -- --skip-browser` with `C:\Program Files\JetBrains\PyCharm 2024.1.4\jbr` | PASS — 15/15 local callable/emulator behavior tests; managed emulator shutdown completed. |
| `npm.cmd --prefix frontend run perf:task08` with the same JDK | PASS — 6/6 local Chromium Playwright tests in 4.4 minutes; Character Creation, Login, Home, and two-client scenarios completed and emulator cleanup passed. |
| `$env:FND_GIT_BRANCH='devs'; npm.cmd --prefix frontend run build:staging` | PASS — local `devs`/`fatin-test` staging-target build; no deploy. |
| `$env:FND_GIT_BRANCH='devs'; npm.cmd --prefix frontend run verify:staging-build` | PASS — local hardened staging-build verification. |
| `npm.cmd --prefix frontend run perf:verify-disabled` while the normal build was present | PASS — no active performance bridge, profiler, benchmark, or persistence-experiment artifacts. |
| `npm.cmd --prefix frontend run perf:build` followed by `npm.cmd --prefix frontend run perf:preflight` | PASS — final opt-in `demo-fnd-perf` build and preflight with Node 22.22.2 and portable Java 21+. |
| `npm.cmd --prefix frontend run perf:fixture-determinism` | PASS — 9,139 documents and canonical hash `fbabc02a3376d466cf717e3886e0d12a9e15568c17b654322cff4909dc6eaca8`. |
| `git diff --check` | PASS — only the existing LF-to-CRLF conversion warnings were reported. |

The final local browser report is
`frontend/performance-results/task08-baseline.json`, run
`a962a0c1-2d8f-4ac4-a0ac-98ff394b556d`, with Chromium `149.0.7827.55` and
Playwright `1.61.1`. The Character Creation scenario is source-matched to the
tree immediately before the documentation append and recorded:

| Character Creation metric | Observed |
| --- | ---: |
| Codex reads | `1` |
| Intentional step revisit | `1` |
| Revisit reads | `0` |
| Authoritative action count | `2` |
| Callable writes | `2` |
| Non-replayed-success fallback count | `0` |
| Duplicate transition count | `0` |
| Object URL create/revoke | `1 / 1` |
| Cleanup events | `2` |

That browser report used source fingerprint
`9835b6f9cf8bf11eea5cbeb636b5c1afacb06dd96da18dc2fb0c106c4c7b4f0d`, tracked
diff fingerprint
`402360316589c42e70484c360c44faaa11ddbcf21721eefaaebdfaead04190df`, and
build identity
`b57e46421c46fd65e9c9aa61d5efeff980f0b2f8d26c6af472c468d1d832bd36` before
the README append. The final documentation-state opt-in build was rebuilt and
preflighted against the final fingerprints above.

## Fixture, cleanup, warnings, and concerns

- The local browser harness seeded and exercised only the disposable
  `demo-fnd-perf` loopback fixture; its report retains the 9,139-document
  canonical identity above. A separate post-cleanup `perf:verify-fixture`
  attempt correctly failed closed with `ECONNREFUSED 127.0.0.1:8080` because
  the emulator had already been shut down. The deterministic generator check
  passed independently.
- `.firebase.performance.generated.json` and the Playwright marker are absent.
  Required task ports `3000,3001,5000,5001,5002,8080,9099,9150,9199` and the
  harness ports `4000,4400,4500` were free after cleanup. The first
  sandboxed browser run left its exact owned Firestore emulator PID `25476`
  because cleanup lacked permission; that one process was terminated with
  elevated cleanup before the corrected rerun. No unrelated user process was
  terminated.
- Expected local-only warnings remain: Browserslist/caniuse-lite age, Node
  `punycode` deprecation, Firebase CLI MOTD/remote-config and outdated
  `firebase-functions` notices, Java rules-runtime `Unsafe` deprecation,
  Playwright `NO_COLOR`/`FORCE_COLOR`, and negative-path Firestore rule
  diagnostics.
- Manual staging/remote Browser acceptance is coordinator-owned and was not
  performed in this developer task. `perf:baseline -- --accept` was not run.

## Requested coordinator action

Review the implementation and the source-matched local evidence. The local
implementation and automated gates are complete; retain the concern that
manual Browser acceptance and any live/staging observation remain outside this
developer authorization envelope.
