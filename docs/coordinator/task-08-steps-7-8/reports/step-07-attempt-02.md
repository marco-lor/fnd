# Task 08 Step 7 — remediation attempt 2

Status: **DONE**. The React 18 Strict Mode lifecycle regression is fixed and the
final source-matched Task 08 Chromium journey is complete at `6/6`. This report
covers only the authorized Step 7 remediation; Step 8 was not started.

## Dispatch and reconciliation

- Control: `task08-steps7-8-3095fd2c`; control revision read: `5`.
- Workstream: `consumable-dice-integration-remediation`; attempt: `2`.
- Dispatch token: `33a6300b-b20a-4e9c-8e37-1a11a06fae0d`.
- Requested/canonical task: `task08_step7_01_bb38703e` / `/root/task08_step7_01_bb38703e`.
- Exact checkout/branch: `C:\Users\Marco\OneDrive\git_projects\fnd-devs` / `devs`.
- Baseline and final HEAD: `9c7fcc7c5799a458768512b7cbab49e4d9b301a9` (unchanged).
- Protected manifest: `docs/coordinator/task-08-steps-7-8/protected-dirty-state.md`.
- Dispatch fingerprint: `89fcbd1b38cde93f636547c590698233bf9021950212487e41d1604f6f811b74`.
- Before edits I recomputed the manifest algorithm, excluding only
  `docs/coordinator/task-08-steps-7-8/`: HEAD, branch, status, staged,
  unstaged, untracked, and composite fingerprint all matched the dispatch.
  There were no staged changes. All protected tracked and untracked files were
  retained.

## Files changed in this remediation

- `frontend/src/components/home/elements/useConsumable.js`
- `frontend/src/components/home/elements/useConsumable.test.js`
- `frontend/performance/tests/browser/helpers.js`
- `frontend/performance/tests/browser/helpers.test.js`
- `frontend/performance/tests/browser/task08-baseline.performance.js`
- `docs/performance-improvement-plan/task-08/README.md` (additive Step 7 remediation section)
- this assigned report (excluded from the code fingerprint)

The cumulative Step 7 implementation from attempt 1 remains intact, including
the narrowly justified Windows `PATH` normalization in the existing emulator
harness. No additional emulator/source refactor was made in attempt 2.

## Lifecycle remediation and proof

`useConsumableAction` now makes its mount effect symmetric: each effect setup
sets `mountedRef.current = true`, while cleanup sets it to `false`. During the
React 18 development Strict Mode setup/cleanup/setup probe, the first cleanup
runs before any user action exists, so it emits no cancellation telemetry and
discards no valid logical owner; the second setup restores the mounted state
before the user can begin an action.

The rest of the ownership behavior remains intentionally asymmetric around the
authoritative boundary:

- Before commit dispatch, real close/unmount/scope/inventory replacement clears
  the exact component-scoped owner, records the applicable cancellation, and
  prevents late prepare/animation/log callbacks from advancing because both the
  mounted flag and `actionRef` identity are checked.
- After commit dispatch, cleanup does not claim that the server transaction was
  cancelled. It clears local ownership; late callbacks cannot mutate an
  unmounted or replacement tree, while shared Home reads reconcile the
  authoritative result.
- The same action object retains stable prepare and commit operation IDs across
  ambiguous transport retries. Definitive errors clear ownership. Rapid/double
  confirmation cannot create a second prepare or commit.
- Server-prepared rolls remain the DiceRoller input, animation remains
  presentational, and `task05CommitConsumable` remains the only resource,
  quantity, history, and equipped-slot transaction against current server
  state. No client final resource base was introduced.

The new regression mounts the real hook under `React.StrictMode`, begins one
logical action, and proves exactly one prepare, exactly one commit, no lingering
preparing/committing UI, and no `consumable-action-cancelled` event from the
initial probe. The existing suite continues to cover declarative in-tree dice,
prepared rolls, rapid confirm, ambiguous stable-identity retry, definitive
failure, close-before-commit, unmount, actor/generation/inventory replacement,
late completions, no-regeneration, depletion/equipped cleanup, current-state
concurrency, and atomic no-partial-outcome behavior.

## Cleanup-image diagnosis and narrow classification

Attempt 1's final Home failure contained four `net::ERR_ABORTED` image requests
only after the harness set its phase to `route-cleanup` and called
`navigateToCleanup`. The failed URLs were local deterministic Storage-emulator
fixture objects. The harness already recorded the same requests as successful
responses before cleanup; the aborts were therefore duplicate/cancellation
notifications caused by the harness-owned navigation, not route-active product
failures.

The new classifier accepts only all of the following together:

- project `demo-fnd-perf`;
- lifecycle phase exactly `route-cleanup`;
- resource type `image`, method `GET`, failure exactly `net::ERR_ABORTED`;
- origin exactly `http://127.0.0.1:9199` and the deterministic
  `/v0/b/demo-fnd-perf.appspot.com/o/performance%2Fimage-NNN.png` path contract;
- a prior same-path `GET` image network record with status `200` in the same
  scenario.

Route-active aborts, fetches, POSTs, `ERR_FAILED`, external origins,
non-fixture paths, another Firebase project, missing prior responses, and prior
404s remain rejected and therefore fatal. Accepted events are retained under
the named `explainedCleanupImageCancellations` diagnostics bucket and copied
into the captured scenario after cleanup. The final run did not reproduce an
abort, so its bucket is empty; the focused positive/negative contract is still
present to explain the proven intermittent cleanup-only case without broadly
suppressing failures.

## RED evidence

Both regressions were added before their corresponding product/harness edits.
Commands ran from `frontend`.

1. `$env:CI='true'; npm.cmd test -- --watch=false --watchman=false --runInBand src/components/home/elements/useConsumable.test.js --testNamePattern='Strict Mode mount probe'`
   - RED: 1 selected test failed (`14` skipped). Expected one commit, received
     zero; the preparing overlay remained wedged because the Strict Mode probe
     left `mountedRef.current` false.
2. `node --test --test-name-pattern='cleanup-navigation aborts' performance/tests/browser/helpers.test.js`
   - RED: 1 selected test failed. Expected the exact proven cleanup-only case to
     classify `true`; the classifier did not yet exist and returned
     `undefined`.

## GREEN verification

All commands used the final remediation source unless a stage is explicitly
described. No baseline was accepted.

- Strict Mode focused rerun: the exact RED Jest command passed `1/1` selected
  (`14` skipped).
- Cleanup classifier focused rerun: the exact RED Node command passed `1/1`.
- Focused Step 7 React/store/command/performance matrix:
  `$env:CI='true'; npm.cmd test -- --watch=false --watchman=false --runInBand src/components/home/elements/useConsumable.test.js src/components/home/elements/EquippedInventory.test.js src/components/home/elements/StatsBars.test.js src/components/home/elements/Inventory.test.js src/components/home/elements/equipmentInventoryProjection.test.js src/components/home/homeReadStore.test.js src/components/home/homeInventoryProjection.test.js src/data/userData/userDataCommands.test.js src/data/userData/userDataHooks.test.js src/performance/task08.test.js`
  — `10/10` suites, `108/108` tests.
- Browser/helper/Task 08 contract matrix:
  `node --test --test-concurrency=1 performance/tests/browser/helpers.test.js scripts/performance/task08-contract.test.js scripts/performance/task08-regression-contracts.test.js performance/tests/browser/task08-cleanup.test.js`
  — `74/74` tests.
- Functions: `npm.cmd run build` from `frontend/functions` — PASS; clean
  TypeScript output contained `105` files and no retired artifacts.
- Full React: `$env:CI='true'; npm.cmd test -- --watch=false --watchman=false --runInBand`
  — `156/156` suites, `1,484/1,484` tests.
- Full performance unit gate: escalated local `npm.cmd run perf:test` —
  `485/485`, zero fail/skip/cancel in `18.263s`; all three parent-loss
  supervisor probes reported parent gone, descendant gone, and port stably
  free. There were no failing test names.
- Normal local staging target: with `FND_GIT_BRANCH=devs`,
  `npm.cmd run build:staging`, then `npm.cmd run verify:staging-build`, then
  `npm.cmd run perf:verify-disabled` — all PASS; the normal build contained no
  active performance bridge, profiler, benchmark, or persistence artifacts.
  The build printed the existing stale Browserslist warning; route-home was
  `31.08 KB` gzip.
- Opt-in harness prerequisite: with command-scoped
  `FND_PERF_JAVA_HOME=C:\Users\Marco\OneDrive\git_projects\fnd\frontend\.perf-tools\jdk-21.0.11+10`,
  `npm.cmd run perf:preflight` and `npm.cmd run perf:build` — PASS with Node
  `22.22.2`, Java 21+, Chromium `149.0.7827.55`, Playwright `1.61.1`.
- Local Task 08 behavior with Browser skipped:
  `npm.cmd run perf:task08:behavior -- --skip-browser` under the same Java
  override — React `4/4` suites / `77/77` tests, Node `4/4`, callable emulator
  `18/18` in `248664.3958ms`, clean emulator shutdown. The callable coverage
  includes authoritative current-state consumable commit, depletion/equipped
  cleanup, no-regeneration, stale-inventory rejection, replay safety, and no
  partial stat/quantity outcome.
- Final integrated Chromium:
  `npm.cmd run perf:task08` under the same Java override — fixture verification
  PASS; Firestore rules `15/15`; repository rules `3/3`; Playwright `6/6` in
  `5.8m`, including asset warmup, auth setup, Login, Character Creation, Home,
  and two-client concurrent resource/consumable convergence.

## Final browser/report identity and observed contract

- Result: `frontend/performance-results/task08-baseline.json`.
- Run ID: `c239d1f7-16d3-4304-b74e-0dfa66b32cb5`.
- Status/complete/official: `complete` / `true` / `false` (local evidence, no
  baseline acceptance).
- Browser-run source fingerprint: `c55f0e5c2822d1aa048438894d3bb4b66d8b233ed2aebd2da36574e3032aa076`.
- Performance build identity: `fa62db05c91adb21a5e1a9b5496a4ec9b9679fe2e8f0ddad08f3a58779b0f007`.
- Main asset: `static/js/main.28a0c9f8.js`, `205,594` gzip bytes.
- Browser: Chromium `149.0.7827.55`; Playwright `1.61.1`.
- Required/completed scenarios: Login, Character Creation, Home, two-client —
  all four complete in one report. The additive README paragraph was appended
  after the run and does not alter compiled source or the verified build.
- Fixture observed/target: `9,139` / `9,139` documents; observed/target SHA-256
  `fbabc02a3376d466cf717e3886e0d12a9e15568c17b654322cff4909dc6eaca8`.
- The browser journey observed exact-instance selection, server-prepared dice,
  a concurrent second-client HP update during delayed presentation, server-side
  capped convergence, last-item removal, equipped-slot clearing, exactly one
  prepare and one commit, both-client visibility, and non-replayed physical
  write telemetry. Physical-write telemetry was used only as evidence where
  `replayed === false`.

## Hygiene, cleanup, warnings, and boundaries

- `git diff --check` passed. Its only output was the existing Windows
  LF-to-CRLF conversion warnings.
- Conflict-marker scan returned no matches (the scan command exits `1` when
  `rg` finds none).
- Generated markers `.firebase.performance.generated.json` and
  `.perf-emulator-data/playwright-webserver.active` were absent.
- Ports `4000, 4400, 4500, 5000, 5001, 5002, 8080, 9099, 9150, 9199` were
  bind-free in two samples one second apart.
- The final runner and its Chromium/emulator tree exited cleanly with code `0`.
  A read-only WMI command-line inventory was denied by the local environment;
  no process was terminated. Stable-free owned ports, absent active marker, and
  the runner's clean shutdown are the cleanup evidence.
- A redundant post-run standalone `perf:verify-fixture` probe was attempted
  after emulators had already shut down and correctly returned
  `ECONNREFUSED 127.0.0.1:8080`; it is not a product or fixture failure. The
  authoritative integrated gate had already verified the exact fixture before
  rules and Chromium and completed `6/6`.
- Expected warnings were stale Browserslist/caniuse-lite data, Node `punycode`
  deprecation, Playwright `NO_COLOR`/`FORCE_COLOR`, Java rules-runtime warnings,
  and intentional Firestore permission-denial negative-path messages.
- No deployment, raw Firebase deploy, remote Firebase read/write, staging/live
  data access, dependency change, commit, push, merge, PR, reset, stash, clean,
  discard, history/worktree change, baseline acceptance, arbitrary PID
  termination, historical temp-directory deletion, staging Browser interaction,
  or Step 8 work occurred.

## Final fingerprint

Fresh manifest-algorithm values after product/tests/README/report work, excluding
only `docs/coordinator/task-08-steps-7-8/`:

- status: `1447fb03d6813d80bdbc11302ea6d95622eeb910de321aa83b9364558c0a10fb`
- staged: `01ba4719c80b6fe911b091a7c05124b64eeece964e09c058ef8f9805daca546b`
- unstaged: `f0bdc59ab094d9190fb4aed22b2ccdd6686cad1110110f64a1af772847bad908`
- untracked: `64cfec0c42ca891834f6da7f75936f15adee892811d4a971d726768d4ce587ee`
- composite code fingerprint:
  `ebb785f40b29161b0867a683bdfb99ac8171c2a1f2d03ab1308dd8c28d8f5f90`

Final concern: none. The remediation's required Strict Mode test and one fresh,
source-matched Chromium `6/6` gate are green.
