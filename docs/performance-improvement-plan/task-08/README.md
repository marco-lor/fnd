# Task 08 Step 1 — Baseline and regression contracts

Status: complete as the Step 1 measurement foundation. The current product is not required to meet the later optimization targets, and this report is not an accepted Task 01 baseline. The reviewed changes remain uncommitted in the linked `fnd-devs` worktree.

## Reproducibility identity

The final local run is `runId=787b49ef-22be-4094-9008-8674d3183408`. Its report is the ignored artifact `frontend/performance-results/task08-baseline.json`; a new run replaces that file before any scenario starts and cannot reuse scenarios from an older run.

- Worktree: `C:\Users\Marco\OneDrive\git_projects\fnd-devs`
- Branch: `devs`
- HEAD: `397a308d511a59b7877f418aebc44a7b9c6e7ab0`
- Dirty source tree: `true`
- Tracked diff fingerprint: `35b7c6e21bbfab934209b367bdad2ce653cd2ceef0966bf6a2ccd778c81df2d0`
- Source-tree fingerprint: `9504d733493f72b83464c508eb490efb8473c9e3844cb33b7e3e73b12c53d090`
- The report stores the complete porcelain status and the sorted contents of all untracked source/test files; ignored build, emulator, and result artifacts are excluded.
- Linked worktree git-dir: `C:/Users/Marco/OneDrive/git_projects/fnd/.git/worktrees/fnd-devs`
- Common git-dir: `C:/Users/Marco/OneDrive/git_projects/fnd/.git`
- Fixture: local `demo-fnd-perf` emulators only; version `fnd-performance-v2-task05-runtime-retired-task07-media-codex-map`
- Fixture hash: `fbabc02a3376d466cf717e3886e0d12a9e15568c17b654322cff4909dc6eaca8`
- Fixture document count: `9,139` (including the deterministic `500`-item `perf-player` inventory)
- Performance build identity: `46abeaa9cf412f2884d11c6ee82008d3d277e730a099cdda496ce71bd75c115a`
- Measurement build: `static/js/main.5e162902.js`, raw `678,963`, gzip `205,550`, Brotli `173,489`, SHA-256 `fe2c4de68b28c9a6387ecce32dea360a6d1a4a30585181d6c1b7ea49031bfac7`
- Browser: Playwright project `task08-chromium`, Chromium `149.0.7827.55`, Playwright `1.61.1`
- Runtime: Node `v22.22.2`, npm `11.2.0`, command-scoped JDK `OpenJDK 25.0.2` from `C:\Program Files\JetBrains\PyCharm 2024.1.4\jbr`

The report is `status=complete`, `complete=true`, and `officialBaseline=false` only because the exact required set `task08-login`, `task08-character-creation`, `task08-home`, and `task08-two-client` completed with one run/source/fixture/build/browser identity. A dirty tree is deliberate and visible; HEAD alone is not a reproduction identity.

## Measurement contract and flow inventory

The version-1 contract is implemented by `frontend/src/performance/task08.js` and `frontend/scripts/performance/task08-contract.js`.

| Boundary | Stable evidence | Current flow covered |
| --- | --- | --- |
| Physical reads/subscriptions | Firestore facade `one-shot-documents-delivered`, `listener-open/close`, initial/changed delivery, and named target derivations | Login profile/config gate; Character Creation Codex/schema/`utils/varie` and profile shell; Home compact V2 user-data domains |
| Auth/mutations | `auth-request-*`, `command-start`, physical `command-applied` only when callable `replayed === false`, non-replayed-success, and failure | Login sign-in/create; Character Creation actions; Home resource and consumable commands |
| Renders | Committed Task 08 render events for Login, Navbar, StatsBars, Inventory, EquippedInventory, Extra, and ParamTables | React Profiler remains available in opt-in performance mode; the committed effect avoids render-time phantom observations |
| Navigation/transitions | Transition start/end and route `interactive` readiness | Login latency ends at destination interactivity; Character Creation transitions include explicit revisit windows and transition keys |
| Media/object URLs | Object URL create/revoke and cleanup events; route image responses retained only as a diagnostic | Character Creation avatar preview lifecycle; Home inventory media is `N/O` because ownership is not authoritative |
| Cleanup | Owned route cleanup plus recursive local account cleanup and post-delete verification | Account initialize writes are cleaned under `users/{uid}`, `user_directory/{uid}`, and actor-owned `user_operations` receipts before Auth deletion |

Login uses Auth sign-in or email preflight/account creation, then the profile gate routes to `/home` or `/character-creation`. Character Creation reads its configuration and profile domains, selects race/anima, revisits the anima step, invokes authoritative actions, and previews a deterministic PNG. Home retains the existing compact-domain subscriptions, direct resource hold behavior, inventory list/filter path, and prepare/commit consumable path. The two-client scenario uses two independent browser contexts for the same deterministic emulator session and checks resource and consumable convergence.

The opt-in browser bridge is `window.__FND_PERF_TASK08__`. It exposes only the three local test operations needed by the scenarios. `index.js` installs it synchronously with lazy command loading; the command module is not fetched or evaluated merely by opening Login. Normal builds return no active bridge, profiler, benchmark, or persistence-experiment behavior and pass `perf:verify-disabled`.

## Deterministic before snapshot

These are observed values from the final completed local run, not future gates. `N/O` means not observed. Counts aggregate the defined scenario journey unless noted.

### Login

| Metric | Current observed | Later acceptance target |
| --- | ---: | --- |
| Sign-in Auth requests | `1` | Preserve one logical request |
| Account-creation preflight requests | `1` | `0` duplicate/preflight requests |
| Account-creation Auth requests | `1` | Preserve one logical request |
| Profile reads | `2` | No duplicate profile read |
| Config reads | `6` | Preserve shared config authority without duplicate journey reads |
| Route-completion latency | `4,485.4 ms` | Set after the measured baseline; interval ends at destination `interactive` |
| Login committed renders | `17` | Route-local render isolation |

### Character Creation

| Metric | Current observed | Later acceptance target |
| --- | ---: | --- |
| Codex reads | `2` | Preserve required data; cache repeated reads |
| Schema reads | `0` | Preserve required data; avoid repeated step reads |
| `utils/varie` reads | `1` | Cache repeated step reads |
| Intentional step revisits | `1` | Measure separately from duplicate transitions |
| Config/Codex reads in the explicit revisit window | `0` | `0` cached-config revisit reads |
| Profile subscriptions | `1` | `1` authoritative subscription |
| Authoritative character-creation actions | `3` | One action per user selection |
| Physical applied character-creation writes | `3` | One applied write per authoritative action |
| Non-replayed-success responses without `replayed=false` | `0` | Keep physical and response semantics distinct |
| Duplicate transition starts | `0` | `0`, excluding intentional revisits |
| Avatar object URL create/revoke | `1 / 1` | Balanced lifecycle; zero leaks |
| Cleanup events | `2` | No leaked route/media resources |

### Home

| Metric | Current observed | Later acceptance target |
| --- | ---: | --- |
| Compact V2 subscription targets | `6` | Retain six named compact targets |
| Compact V2 physical listener opens | `7` | No duplicate opens beyond the measured route contract |
| Navbar / StatsBars renders | `2 / 3` | Unrelated section rerenders `0` |
| Inventory / EquippedInventory renders | `3 / 3` | Unrelated section rerenders `0` |
| Extra / ParamTables renders | `3 / 3` | Unrelated section rerenders `0` |
| Resource command starts in the closed two-second hold window | `11` | `1` mutation per hold |
| Applied resource mutations | `11` | No lost updates |
| Resource command failures in the closed hold window | `0` | `0` deterministic command failures |
| Non-replayed-success resource responses without `replayed=false` | `0` | Keep physical and response semantics distinct |
| Requested resource delta | `-11` | Preserve user-visible semantics |
| Resulting resource delta after command settlement | `-11` | Equal the sum of successfully applied requested deltas |
| Initial inventory items | `500` | Bounded/deferred list work |
| Filter result for `Fixture item 315` | `1` | Bounded/deferred filtering |
| Filtered item count | `1` | Preserve correct matching result |
| Inventory-owned media requests | `N/O` | Add authoritative ownership or retain `N/O` |
| Route-wide image responses (diagnostic only) | `14` | Not an inventory metric |
| Consumable prepare / commit | `1 / 1` | One prepare and one commit |
| Atomic consumable outcome | `committed` | Prepare/commit atomic outcome |

### Two clients

| Metric | Current observed | Later acceptance target |
| --- | ---: | --- |
| Concurrent resource command count | `2` | No lost updates |
| Final resource value | `43` | Both clients converge on the authoritative value |
| Resource visible on client A / B | `true / true` | `true / true` |
| Consumable prepare / commit | `1 / 1` | One prepare and one commit |
| Consumable visible on client A / B | `false / false` (item absent) | Both clients converge on the atomic outcome |
| Atomic outcome | `committed` | No partial outcome |

The Home resource result is read only after the closed hold window has stable command starts, exactly one terminal event per start, zero failures, and consecutive authoritative Firestore values matching the derived applied delta. This run observed `11` starts and `11` applied `-1` deltas, so the settled resource delta was `-11`; the tick count was derived from the window rather than hard-coded. Only that settled value is recorded as the Step 1 observation.

The future target object is exported as `TASK08_FUTURE_ACCEPTANCE_TARGETS`. It is documentation metadata only; Step 1 does not fail because the current product still has eleven hold mutations, duplicate Login config/profile work, or broad render behavior.

## Regression contracts

`TASK08_REGRESSION_CONTRACTS` retains source markers for routing, but marker existence is not treated as behavior proof. The exact behavior entry point is `npm.cmd run perf:task08:behavior`; the completed run used `npm.cmd run perf:task08:behavior -- --skip-browser` for the unit/Node/callable portions and `npm.cmd run perf:task08` for the actual four-scenario browser portion.

| Behavior | Executed authority |
| --- | --- |
| Formula composition and caps | Jest `src/performance/task08-regression.test.js` |
| Race reset rules | Local emulator `performance/tests/task05-callables.test.js` |
| Negative-stat and point policy | Local emulator `performance/tests/task05-callables.test.js` |
| Inventory acquisition/current history | Node `scripts/performance/task08-regression-contracts.test.js` |
| Dice and consumable semantics | Jest `src/components/home/elements/useConsumable.test.js` and callable prepare/commit tests |
| Multi-client visibility/correctness | Actual Playwright `task08-two-client` scenario with two contexts and local Admin readback |
| Direct navigation | Jest `src/components/Login.test.js` plus the browser Login route journey |
| Error/retry semantics | Jest `src/data/userData/userDataCommands.test.js`, consumable tests, and cleanup retry contract |

Created-account cleanup remembers the UID as soon as it is resolved, recursively deletes and verifies the owned Firestore tree/projection/receipts, and deletes/verifies Auth only afterward. The cleanup unit contract covers a Firestore partial failure followed by a retry; the completed browser Login scenario also cleaned the created account before and after its journey. No production or staging account was used.

## Validation evidence

Commands were run from `C:\Users\Marco\OneDrive\git_projects\fnd-devs\frontend` unless noted. JDK overrides were command-scoped. All emulator behavior used only `demo-fnd-perf` loopback services.

The exact PowerShell setup used for the final local runtime was:

```powershell
$task08Jdk = 'C:\Program Files\JetBrains\PyCharm 2024.1.4\jbr'
$env:JAVA_HOME = $task08Jdk
$env:Path = "$task08Jdk\bin;$env:Path"
$env:CI = 'true'
npm.cmd run perf:preflight
npm.cmd run perf:task08
```

Functions preparation was run from `C:\Users\Marco\OneDrive\git_projects\fnd-devs\frontend\functions` as:

```powershell
$env:NODE_OPTIONS = '--use-system-ca'
npm.cmd ci
npm.cmd run build
```

The focused Node command was:

```powershell
$files = @('scripts/performance/task08-contract.test.js','scripts/performance/task08-report.test.js','scripts/performance/task08-preflight.test.js','scripts/performance/task08-runner.test.js','scripts/performance/task08-fixture.test.js','scripts/performance/task08-regression-contracts.test.js','performance/global-setup.test.js','performance/tests/browser/task08-cleanup.test.js')
node --test --test-concurrency=1 $files
```

| Command/result | Evidence |
| --- | --- |
| `frontend\functions`: `NODE_OPTIONS=--use-system-ca npm.cmd ci` | PASS after the initial certificate-only retry; locked Functions dependencies installed. npm reported 120 audit findings; no audit fix was run. |
| `frontend\functions`: `npm.cmd run build` | PASS; clean compiled output, `105` files, no retired runtime artifacts. |
| `npm.cmd run perf:preflight` with the JetBrains JDK | PASS; Node `22.22.2`, required Functions dependencies/exports and matching performance build found. |
| `npm.cmd run perf:fixture-determinism` | PASS; `9,139` documents and fixture hash `fbabc02a3376d466cf717e3886e0d12a9e15568c17b654322cff4909dc6eaca8`. |
| Focused Task 08 Node command over contract/report/preflight/runner/fixture/regression/global-setup/cleanup tests | PASS — `41/41` tests. |
| `$env:CI='true'; npm.cmd test -- --watch=false --watchman=false --runInBand` with the ten focused Task 08/Login/Home/command/media suites | PASS — `10/10` suites, `50/50` tests. |
| `npm.cmd run perf:task08:behavior -- --skip-browser` | PASS — Jest `4/4` suites, `28/28` tests; deterministic Node `4/4` tests; local callable emulator `14/14` tests. |
| `npm.cmd run perf:task08` with the JetBrains JDK and `CI=true` | PASS — Playwright `6/6` tests in `4.2m`; all four required scenario IDs completed in one report; emulator teardown passed. |
| `node -e "require('./scripts/performance/emulators').assertEmulatorPortsFree()..."` plus app-port check | PASS — `HARNESS_PORTS_FREE` and `APP_AND_HARNESS_PORTS_FREE`. |

The staging-build, disabled-build, full `perf:test`, and bounded `verify:start` rows below are retained from the preceding Step 1 validation and were not repeated for this narrow temporal-evidence correction. The targeted contracts, fresh performance build, preflight, local callable behavior, full Task 08 browser run, report integrity, and port cleanup were rerun above.

| `$env:FND_GIT_BRANCH='devs'; npm.cmd run build:staging` | PASS — normal local staging-target build; no deploy or remote data access. |
| `npm.cmd run perf:verify-disabled` | PASS — normal build contains no active performance bridge/profiler/benchmark/persistence artifacts. |
| `$env:FND_GIT_BRANCH='devs'; npm.cmd run verify:staging-build` | PASS — local hardened staging-build verification. |
| `npm.cmd run perf:build` | PASS — restored the opt-in performance build after staging verification; its identity and source fingerprint match this report. |
| `npm.cmd run perf:test` in the default sandbox | `414/418` pass, `4` fail. All four failures were the existing Storage runtime patch tests blocked by `EPERM` reading `C:\Users\Marco\.config\configstore\firebase-tools.json`; they failed before assertions. |
| `npm.cmd run perf:test` with host permission for the local test process | PASS — `418/418` tests, `0` failures, `0` skipped/cancelled. |
| `npm.cmd run verify:start` with host permission for its captured local process tree | PASS — npm start compiled and `/home` returned HTTP `200` on port `3001`; cleanup released the port. The first sandbox attempt reached HTTP `200` but could not taskkill its owned wrapper and was stopped explicitly. |

The initial runtime reproduction failed before Playwright because the Functions dependency directory was absent and `functions/lib` had no usable callable export. The corrected runner now validates dependencies, compiled output, required exports, source/build identity, fixture identity, and browser identity before starting Playwright, so the failure is immediate rather than a four-minute readiness timeout.

## Manual observations and boundaries

- Manual staging browser observation: not run. No staging page was opened and no staging data was read or written.
- Production observation: not run.
- The six-test Chromium run is automated local browser evidence, not a manual staging observation.
- `home.inventory.mediaRequestCount` is intentionally `N/O`; the retained route-wide image count is diagnostic only and is not presented as inventory-owned media.
- No Firebase deployment, rules/index/config/Storage/Functions/Hosting change, live write, staging/production read, account creation, character creation, inventory mutation, or resource mutation occurred outside the owned local emulators.
- `perf:baseline -- --accept` was not run; no accepted Task 01 baseline was overwritten.
- The current report is complete for Step 1 but remains `officialBaseline=false` and must not be used as an accepted baseline.
- Commit, push, merge, and PR were not performed. The final source tree is intentionally dirty and uncommitted.

Step 1 stops here. Login optimization, Character Creation optimization, Home selector refactoring, resource gesture batching, and DiceRoller/consumable refactoring remain future work.
