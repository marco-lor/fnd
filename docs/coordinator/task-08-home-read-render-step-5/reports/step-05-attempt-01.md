# Task 08 Step 5 developer report — attempt 1

status: DONE_WITH_CONCERNS

## Objective and boundaries

Implemented the Step 5 Home shared read/render plane in the existing
`fnd-devs` checkout. Home now has one actor/generation-fenced owner for its six
compact user domains, one catalog path, shared config, stable selector slices,
and one structurally shared inventory/equipment/catalog projection. Inventory
search normalization is input-scoped, the query is deferred, and a named
60-row window with accessible expansion bounds the mounted DOM.

No Step 6 resource-gesture coalescing or Step 7 consumable/DiceRoller refactor
was started. No remote Firebase state was read or mutated. No commit, push,
merge, pull request, deployment, accepted-baseline mutation, dependency
upgrade, reset, stash, discard, cleanup of user-owned files, or worktree change
was performed. The coordinator-owned manual localhost Browser gate remains
outstanding and is the reason for `DONE_WITH_CONCERNS`.

## Control and workspace identity

- Control ID: `task08-home-step5-c07137fad080`
- Callback token: `f56f376c-df10-4a87-99d5-b60b6e0316fc`
- Step / attempt: `5 / 1`
- Developer task ID: `01a05428-79f1-7fa3-bd3e-2d8a2c59045f`
- Exact checkout: `C:\Users\Marco\OneDrive\git_projects\fnd-devs`
- Canonical `fnd` checkout: not edited
- Branch/upstream: `devs` / `origin/devs`; final divergence `0` behind / `1` ahead
- Baseline and current SHA: `9c7fcc7c5799a458768512b7cbab49e4d9b301a9`
- Accepted pre-Step-5 tracked fingerprint:
  `2ac90fa777a5a5b0db7d2f8578ffd79f2c7f757569d3c29ab2d545c09b1bd932`
- Accepted pre-Step-5 source fingerprint:
  `e9d7a650c770dbc1ce11f737d46d1657916e7a6be08b0347d2e373687449ed66`
- Final tracked fingerprint:
  `58f951f992b356ca8556873c79ee552b1448f68df54f3966be8feeebb6d586fc`
- Final source fingerprint:
  `365bbf928249717a902d290e40cd77d421654c034c65321c574e6135482b60c3`
- Final opt-in performance build identity:
  `59030b9adbb79a03f0b26f24a7f38f981bd1886568adb656d0d8366d2d9e8220`
- Final performance main asset: `static/js/main.3a1d9eed.js`, SHA-256
  `fcc0bb6605ecd3b41865c0ab07b6b7d5c3896d1b141721c09ef5c53b94e629e4`

The worktree remains intentionally dirty. The accepted Step 2–4 tracked and
untracked state, coordinator artifacts, and source files were preserved; the
Step 5 implementation, tests, README entry, and this report are additive.

## Implementation delta

- `frontend/src/components/home/HomeReadPlane.js`
  - Owns progression, resources, settings, equipment, profile content, and
    inventory subscriptions once at the Home route boundary.
  - Owns one catalog hook and the shared config/schema load.
  - Publishes through an actor/repository-generation scope key and ignores late
    publications from a stale scope.
- `frontend/src/components/home/homeReadStore.js` and test
  - Provide the selector-aware external store, explicit equality, stable
    selected identities, and stale-scope publication rejection.
- `frontend/src/components/home/homeInventoryProjection.js` and test
  - Build the inventory/equipment/catalog join once, preserve structural
    sharing, precompute normalized search fields, expose deferred filtering,
    and implement the named 60-row window/expansion contract.
- `frontend/src/data/userData/userDataHooks.js` and
  `frontend/src/data/useCatalogItemsById.js`
  - Retain standalone behavior outside Home while consuming shared Home slices
    and suppressing duplicate physical effects beneath the Home owner.
- `frontend/src/components/home/Home.js`, `Inventory.js`,
  `EquippedInventory.js`, `StatsBars.js`, `Extra.js`, and `paramTables.js`
  - Consume narrow shared slices/projections. Inventory keeps Task 07
    thumbnail/lazy `MediaImage` semantics and exposes the accessible expansion
    control. Resource changes update StatsBars without rerendering unrelated
    measured Home sections.
- `frontend/src/performance/PerformanceProfiler.js` and test plus the six
  measured consumers (including `frontend/src/components/common/navbar.js`)
  - Add in-component committed-render probes that remain truthful in the
    production performance build, where React Profiler callbacks are absent.
- `frontend/scripts/performance/task08-contract.js`, its test, and
  `frontend/performance/tests/browser/task08-baseline.performance.js`
  - Record and assert compact targets, resource-window component isolation,
    the 500-item/deep-filter/60-to-120 inventory sequence, and honest `null`
    media attribution.
- `docs/performance-improvement-plan/task-08/README.md`
  - Appends Step 5 RED/green, source/build identities, metrics, warnings,
    cleanup, and local-only/manual-gate boundaries.

## TDD RED evidence

The initial focused command was:

`npm.cmd --prefix frontend test -- --watch=false --watchman=false --runInBand src/components/home/homeReadStore.test.js src/components/home/homeInventoryProjection.test.js`

It exited `1`: `2/2` suites failed because the two Step 5 modules did not yet
exist. After implementation, the focused store/projection/Inventory/
EquippedInventory/StatsBars run passed `5/5` suites and `17/17` tests. The
combined relevant hook/catalog/projection/media/Task 08 run passed `10/10`
suites and `62/62` tests.

The first browser run produced a second RED result. Its trace showed each
authoritative resource delivery and the visible HP value update, but
`StatsBars` remained `0` because the production React Profiler callback emitted
no `react/commit` events and the stable wrapper did not rerender for a
selector-local child update. Before the fix, the new focused committed-render
probe test failed `1/2` with `usePerformanceRenderProbe is not a function`.
After the smallest fix it passed `2/2`; the affected profiler/component run
passed `4/4` suites and `14/14` tests. The corrected production browser run
then passed the resource-isolation assertion.

## Verification and exact results

| Command/result | Evidence |
| --- | --- |
| `node frontend/scripts/performance/task08-contract.test.js` | PASS — `10/10` Node contract tests. |
| `$env:CI='true'; npm.cmd --prefix frontend test -- --watch=false --watchman=false --runInBand` | PASS with exit `0` — `156/156` suites, `1,436/1,436` tests, `0` skipped/cancelled, `118.53s`. A preceding non-CI run printed the same totals but retained an idle handle and was stopped after completion; it is not used as the command-exit claim. |
| `npm.cmd --prefix frontend/functions run build` | PASS — `105` Functions output files and no retired Task 05 runtime. |
| `npm.cmd --prefix frontend run perf:test` | PASS on the host-permission rerun — `422/422`, `0` failures/skips/cancellations. The initial sandbox run failed only four Firebase Storage config-store permission cases. |
| `npm.cmd --prefix frontend run perf:task08:behavior -- --skip-browser` with the command-scoped JetBrains JDK | PASS — `4/4` React suites (`65/65` tests), `4/4` Node checks, `16/16` serialized callable-emulator checks, fixture verified. |
| `$env:FND_GIT_BRANCH='devs'; npm.cmd --prefix frontend run build:staging` | PASS — explicit local `devs`/`fatin-test` staging-target build; no deploy. |
| `$env:FND_GIT_BRANCH='devs'; npm.cmd --prefix frontend run verify:staging-build` | PASS — local hardened staging-build verification. |
| `npm.cmd --prefix frontend run perf:verify-disabled` | PASS with the normal staging build present — no performance bridge, profiler, benchmark, or persistence-experiment artifacts. |
| `npm.cmd --prefix frontend run perf:build` then `npm.cmd --prefix frontend run perf:preflight` | PASS after the README append — final source-matched opt-in build; Node `22.22.2`, command-scoped Java 21+. |
| `npm.cmd --prefix frontend run perf:task08` | PASS — `6/6` local Chromium Playwright stages in `4.4m`; report complete and owned-emulator cleanup passed. |
| `npm.cmd --prefix frontend run perf:fixture-determinism` | PASS — `9,139` documents, hash `fbabc02a3376d466cf717e3886e0d12a9e15568c17b654322cff4909dc6eaca8`. |
| `git diff --check` | PASS — only existing LF-to-CRLF conversion warnings. |

The required build order was preserved: normal `build:staging`,
`verify:staging-build`, and `perf:verify-disabled` ran first. The opt-in
performance build/preflight was then refreshed after the additive README state.

## Source-matched browser evidence

The completed report is `frontend/performance-results/task08-baseline.json`,
run `4813e02c-b1b5-40d3-9f8b-5b46e0d2872d`, with Chromium
`149.0.7827.55` and Playwright `1.61.1`. It is complete and
`officialBaseline=false`; it is local evidence, not accepted-baseline state.

Immediately before the additive README entry, the browser report matched
source fingerprint
`b6b7f4c4b1d1440d5076b3b10d56105fe00215b6ae3161e366bd3367fa8d8c97`,
tracked fingerprint
`3d32ffde7cd1c9e3284940f6fd97c426da6c794f95102c167b73f1d08f5e55fb`,
and performance build identity
`6e93e8c9114a513d789ec04312ea7abc06f69066b4b8da02b83ca71610eb9cb5`.

| Home metric | Observed |
| --- | ---: |
| Compact user-data subscription targets | `6` |
| Compact listener opens during route setup | `7` |
| Resource mutations / applied updates | `11 / 11` |
| Resource-window committed renders — StatsBars | `11` |
| Resource-window committed renders — Navbar / Inventory / EquippedInventory / Extra / ParamTables | `0 / 0 / 0 / 0 / 0` |
| Inventory items / initial mounted rows | `500 / 60` |
| Deep query `Fixture item 315` | `1` result |
| Mounted rows after accessible expansion | `120` |
| Inventory-owned media requests | `N/O` (`null`) |
| Consumable prepare / commit / atomic outcome | `1 / 1 / committed` |

The measured hold intentionally remains at `11` starts and `11` applied
updates because gesture coalescing belongs to Step 6. Consumable behavior
remains the existing atomic prepare/commit flow because its refactor belongs to
Step 7.

## Cleanup, warnings, and concerns

- All emulator/browser work used only loopback `demo-fnd-perf` and the
  deterministic fixture. No staging or production observation occurred.
- `frontend/.firebase.performance.generated.json` and
  `frontend/.perf-emulator-data/playwright-webserver.active` are absent.
- Ports `3000`, `3001`, `4000`, `4400`, `4500`, `5000`, `5001`, `5002`,
  `8080`, `9099`, `9150`, and `9199` are free.
- The first sandboxed browser attempt could not terminate its owned emulator
  and also exposed the render-counter RED assertion. PID `27624` was verified
  as the orphaned Java Firestore emulator from this checkout using project
  `demo-fnd-perf`, this checkout's rules path, and ports `8080/9150`; only that
  PID was terminated. The corrected host-permission run passed all six stages
  and clean teardown.
- Expected warnings remain Browserslist/caniuse-lite age, Node `punycode`,
  Playwright `NO_COLOR`/`FORCE_COLOR`, Firebase/Java emulator diagnostics,
  negative-path Firestore rules output, and existing line-ending warnings.
- Manual localhost Browser acceptance remains coordinator-owned and was not
  performed or claimed. `perf:baseline -- --accept` was not run.

## Requested coordinator action

Authenticate this report against the control ID/token, independently inspect
the additive Step 5 diff and fresh local evidence, then perform the
coordinator-owned localhost manual Browser gate. Requested action: `review`.
Do not start Step 6 from this developer task.
