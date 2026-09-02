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

# Task 08 Step 2 — Login request-path and render-isolation optimization

Status: complete for the Login scope, including the required destination feedback handoff. The changes remain uncommitted in the linked `fnd-devs` worktree. General Character Creation and Home optimization remain future work.

## Implementation decisions

- `AuthContext` remains the only profile listener and profile authority. It exposes the UID owning the current fresh snapshot as `profileUid`, plus an auth-observer revision. Login requires the authenticated UID, `profileUid`, `profileStatus=fresh`, and profile data to match before routing; it never routes from cached roles or another UID’s profile.
- Login and account creation use one synchronous in-flight guard shared by both actions. This closes same-tick double-click and Login/Create cross-action races before React state can update.
- Account creation calls `createUserWithEmailAndPassword` directly. The `fetchSignInMethodsForEmail` preflight was removed completely. `auth/email-already-in-use` retains the friendly “already registered; login instead” message, and all auth/profile failures release the guard and restore both controls.
- Missing-profile initialization is owned by the shared profile-missing effect and is attempted once per accepted UID. The submit handlers do not issue a competing initialization call or a post-login `getDoc`.
- The pending-profile gate treats an explicit observer error as terminal even when `user` is null, cancels an authenticated UID supersession, and cancels a session that becomes anonymous after the matching UID was observed. Initial pre-observer null/anonymous catch-up still waits. Every cancellation/failure clears the pending attempt, releases the synchronous guard, finishes the transition once, and fences stale navigation/state work.
- Matching authoritative fresh-profile state drives navigation with no timer. Sign-in routes completed characters to `/home` and incomplete profiles to `/character-creation`; successful account creation routes immediately to `/character-creation` with the existing success message in route state.
- Character Creation now displays that carried message in an accessible `role="status"`/`aria-live` banner and consumes only `successMessage` from route state while preserving the carried email. There is no navigation delay, wizard-order change, formula change, or duplicate initialization pass.
- Login’s Aurora background, decorative orbs, card border, header, and animated buttons are memoized component boundaries. Button hover state is local to each button, so controlled credential input changes do not rerender those subtrees. The production `LoginCreateButton` export is covered by a real stable-prop render-counter test; `PerformanceProfiler id="Login"`, the opt-in Task 08 bridge, normal-build instrumentation stripping, and Login module isolation remain intact.

## Source-matched Login evidence

The before and after reports use the same clean starting commit, deterministic local fixture, Chromium identity, and Task 08 contract. The final after report was captured immediately before this documentation append; the README change is documentation-only and does not alter the compiled Login artifact. Reports are retained as `frontend/performance-results/task08-step2-before-login.json` and `frontend/performance-results/task08-step2-after-login-review-final.json`.

| Identity | Clean Step 2 before | Step 2 after review fixes |
| --- | --- | --- |
| Run ID | `497f2a88-dda0-4657-8a2c-4946eb98ff22` | `edc627ce-5646-4458-9951-9031c69bf49b` |
| HEAD | `9c7fcc7c5799a458768512b7cbab49e4d9b301a9` | `9c7fcc7c5799a458768512b7cbab49e4d9b301a9` |
| Source tree fingerprint | `5603a74f3abea558fd69b7d909a89d178c6c2a2aac705340690a443f40d6f008` | `3523f3a238d18114a866006736dcd2f564a1c1071edcb308b431e215fa480675` |
| Tracked diff fingerprint | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | `8bb6d9760b1b06e0c3c6b65ae844eb0e92bf13b66d3846fa7fdbc6d38a16536a` |
| Source tree dirty | `false` | `true` (intended uncommitted Step 2 source/test changes) |
| Performance build identity | `4e25fe2e476774a3828d2aec578fa46643e1b7a9098a222003822c6ebb61a17f` | `33bf533fbf9814cc9153c083af0e71594bd20eaf441b2c6fcaee35a8be5acdce` |
| Main asset | `static/js/main.5e162902.js` | `static/js/main.058d194f.js` |
| Fixture | `fnd-performance-v2-task05-runtime-retired-task07-media-codex-map`, `9,139` documents, hash `fbabc02a3376d466cf717e3886e0d12a9e15568c17b654322cff4909dc6eaca8` | Same |
| Browser | Chromium `149.0.7827.55`, Playwright `1.61.1` | Same |

| Login metric | Clean Step 2 before | Step 2 after review fixes | Result |
| --- | ---: | ---: | --- |
| Sign-in Auth requests | `1` | `1` | One logical request preserved |
| Account-creation preflight requests | `1` | `0` | Preflight removed |
| Account-creation Auth requests | `1` | `1` | One logical request preserved |
| Shared profile reads | `2` | `2` | No duplicate profile authority added |
| Shared config reads | `6` | `6` | No duplicate config read added |
| Route-completion latency | `4,598.6 ms` | `4,979 ms` | Single local observations; not a statistical claim |
| Login committed renders | `17` | `15` | Lower aggregate route render count |

The after report’s render-isolation counters were decorative background `2`, decorative orbs `2`, card border `2`, header `2`, animated submit button `7`, and animated create button `7`. The static counters are two Login mounts in the browser journey; button counters include expected loading/hover/action-state transitions. The explicit unit render-counter test proves that typing email/password leaves each decorative and animated-button subtree at one render, while hover, loading, disabled, and password visibility behavior still updates. The browser Login scenario also asserted that the account-created confirmation was visible at the Character Creation destination, not merely present in route state.

## Red/green and validation evidence

The original Step 2 test-first cycle produced an intentional RED run with `9` failing and `8` passing Login tests. The review-fix cycle then added the observer-error, UID-supersession, pre-resolution ordering, observed-session cancellation, destination-banner, and production-button-counter regressions: the pre-fix RED run failed the four Login recovery tests because the old guard returned before handling the terminal state, and failed the destination assertion because the success state was not displayed/consumed. After the fixes, the following current gates are green:

| Command/result | Evidence |
| --- | --- |
| Focused Jest Login/module/AuthContext/App/Character Creation command | PASS — `8/8` suites, `53/53` tests |
| Focused Task 08 contract/report/preflight/runner/fixture/regression/cleanup Node command | PASS — `42/42` tests |
| `npm.cmd --prefix frontend run perf:task08:behavior -- --skip-browser` with the JetBrains JDK | PASS — `4/4` Jest suites, `46/46` Jest tests, `14/14` local callable behavior tests, and `4/4` deterministic Node checks |
| `$env:CI='true'; npm.cmd test -- --watch=false --watchman=false --runInBand` | PASS — `146/146` suites, `1,353/1,353` tests, `0` skipped/cancelled |
| `npm.cmd run perf:test` in the default local environment | PASS — `422/422` tests, `0` failures, `0` skipped/cancelled; no Firebase config-store `EPERM`, so no host-permission rerun was needed |
| `$env:FND_GIT_BRANCH='devs'; npm.cmd run build:staging` | PASS — explicit local `devs`/`fatin-test` staging-target build; no deploy |
| `npm.cmd --prefix frontend run verify:staging-build` | PASS — local hardened staging-build verification |
| `npm.cmd --prefix frontend run perf:verify-disabled` | PASS — normal build contains no active performance bridge, profiler, benchmark, or persistence artifacts |
| `npm.cmd --prefix frontend run perf:build` followed by `npm.cmd --prefix frontend run perf:preflight` | PASS — current opt-in `demo-fnd-perf` build and preflight; main asset `static/js/main.058d194f.js` |
| `npm.cmd --prefix frontend run perf:task08` final reproducibility run | PASS — `6/6` Playwright tests in `4.4m`; Login destination status, Character Creation, Home, and two-client scenarios completed; emulator cleanup passed |
| `npm.cmd --prefix frontend run verify:start` | PASS — app compiled, `/home` returned HTTP `200` on port `3001`, and the port was released |
| `perf:baseline -- --accept` | Not run, as required |

The four requested Login recovery paths are covered by focused tests: observer error after the Auth promise, authenticated UID A replaced by B, a matching Auth/profile callback before the create promise resolves, and a matching UID followed by anonymous/different session before freshness. The existing wrong-UID test now asserts terminal recovery and exactly-once transition completion. The destination integration test proves immediate navigation with a visible Character Creation confirmation, and the browser journey repeats that assertion.

## Known warnings and boundaries

- Local builds report the existing Browserslist/caniuse-lite age warning; Node reports the existing `punycode` deprecation; Firebase CLI reports unavailable MOTD/remote config and the existing outdated `firebase-functions` warning; Playwright reports the existing `NO_COLOR`/`FORCE_COLOR` warning; Java reports the existing rules-runtime `Unsafe` deprecation.
- Emulator rule-denial and Firestore expression-limit messages are expected negative-path evidence from local rules tests. No production or staging Firebase data was accessed or mutated.
- The six-test Chromium run is automated local browser evidence, not a manual staging observation. The fixture remained `demo-fnd-perf` with 9,139 documents and the recorded hash above.
- No raw `firebase deploy`, deployment, push, merge, PR, baseline acceptance, or live observation was performed. The final source tree is intentionally dirty and uncommitted.
- Later Task 08 work remains for general Character Creation and Home optimization; this Step 2 section claims only the required destination feedback handling in Character Creation.

## Second-review fix — active Login auth-attempt lifecycle (2026-08-29)

This additive entry records the correction for the second read-only review. It does not rewrite the Step 1 evidence or the preceding Step 2 run identity. The preceding Step 2 report remains historical; the source-matched browser report for this correction is `frontend/performance-results/task08-step2-after-login-review-fix-final-2.json`.

### Lifecycle correction

- `beginAttempt` now publishes the active attempt synchronously, before either Auth promise settles. The attempt captures the starting auth status, UID, and observer revision, and records the latest observer snapshot for the whole request lifetime.
- The profile effect reconciles an active attempt even when `pendingAuth` is absent. An explicit observer error finishes as `failure` immediately; a post-start authenticated UID change or anonymous revision change finishes as `cancelled`; only the isolated initial `checking`/revision-0 to anonymous/revision-1 readiness callback is allowed to keep waiting.
- Reconciliation uses the latest snapshot when the Auth promise returns. A matching authenticated callback may arrive before the promise and still proceed; a different current UID, observer error, or collapsed matching-then-anonymous revision cannot be rescued by a late promise settlement. `finishAttempt` is idempotent and every late Auth/profile continuation checks mount, ownership, and the finished token before logging, navigating, or mutating state.
- The shared `AuthContext` profile listener, UID/freshness checks, at-most-once profile initialization, destination selection, route-state success message, and no-timer navigation remain unchanged. The account-created callback-before-promise path is covered and still routes once the matching fresh profile is authoritative.
- No Character Creation banner/render-isolation implementation was changed by this review correction. The destination still renders and consumes the carried success message while preserving `email`; production Login visual/button boundaries and module isolation remain covered by the preceding Step 2 work.

### Red/green evidence for the review correction

The test-first RED run was:

```powershell
$env:CI = 'true'
npm.cmd --prefix frontend test -- --watch=false --watchman=false --runInBand src/components/Login.test.js
```

It failed `5` of `31` tests (`26` passed): the pending observer-error resolve/reject cases, the ready-anonymous revision cancellation cases, and the collapsed matching-to-anonymous case. After the active-attempt reconciliation was implemented, the same lifecycle suite passed. The current focused and full green counts are:

| Command/result | Evidence |
| --- | --- |
| Focused Login/module-isolation/LoginCreateButton/LoginSubmitButton/AuthContext/App/Character Creation integration command | PASS — `8/8` suites, `61/61` tests |
| Focused Task 08 contract/report/preflight/runner/fixture/regression/global-setup/cleanup Node command | PASS — `42/42` tests |
| `npm.cmd --prefix frontend run perf:task08:behavior -- --skip-browser` with the command-scoped JetBrains JDK | PASS — `4/4` Jest suites, `54/54` tests; `4/4` deterministic Node checks; `14/14` local callable-emulator checks |
| Full React suite: `$env:CI='true'; npm.cmd --prefix frontend test -- --watch=false --watchman=false --runInBand` | PASS — `146/146` suites, `1,361/1,361` tests, `0` skipped/cancelled |
| `npm.cmd --prefix frontend run perf:test` | PASS — `422/422` tests, `0` failures, `0` skipped/cancelled; no Firebase config-store `EPERM`, so no host-permission rerun was needed |

The focused regression set includes deferred observer-error resolution and rejection after terminal failure, ready-anonymous revision supersession before and after the Auth response UID, checking-0 initial readiness, collapsed matching/anonymous callbacks, same/different authenticated callback-before-promise outcomes, strengthened wrong-UID recovery, unmount fencing, and the existing create callback-before-promise route. Every terminal assertion checks both controls and exactly one transition finisher call.

### Source-matched Login evidence for this correction

The clean before report was captured from HEAD `9c7fcc7c5799a458768512b7cbab49e4d9b301a9` before Step 2 product edits. The after report was captured after this lifecycle fix and before this documentation append, against the same local `demo-fnd-perf` fixture and browser identity. The after report source/build identity is therefore valid for the product/test tree recorded inside that report; this README append changes only the working-tree documentation fingerprint afterward.

| Identity | Clean before | After second-review fix |
| --- | --- | --- |
| Report | `task08-step2-before-login.json` | `task08-step2-after-login-review-fix-final-2.json` |
| Run ID | `497f2a88-dda0-4657-8a2c-4946eb98ff22` | `661a12fa-ac3b-4079-9b97-977a91e12ad2` |
| HEAD | `9c7fcc7c5799a458768512b7cbab49e4d9b301a9` | `9c7fcc7c5799a458768512b7cbab49e4d9b301a9` |
| Source tree fingerprint | `5603a74f3abea558fd69b7d909a89d178c6c2a2aac705340690a443f40d6f008` | `2f826ce4eba7b6733ac29368fdccd20a5c4c1383911ed3fdaa3ab01f53e2f5c2` |
| Tracked diff fingerprint | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | `d1942a6517e26e4e0b7780aad47c9d1d864abba16a7b7574dbea52a5ea0e5ab4` |
| Performance build identity | `4e25fe2e476774a3828d2aec578fa46643e1b7a9098a222003822c6ebb61a17f` | `64500d07e6bdbb7a3d1ac508a84e82cb1543c269c4c85fc0d96d4078dc773840` |
| Main asset | `static/js/main.5e162902.js` | `static/js/main.c5554d99.js` |
| Fixture | `9,139` documents; hash `fbabc02a3376d466cf717e3886e0d12a9e15568c17b654322cff4909dc6eaca8` | Same |
| Browser | Chromium `149.0.7827.55`, Playwright `1.61.1` | Same |

| Login metric | Clean before | After second-review fix | Result |
| --- | ---: | ---: | --- |
| Sign-in Auth requests | `1` | `1` | One logical request |
| Account-creation preflight requests | `1` | `0` | Preflight removed |
| Account-creation Auth requests | `1` | `1` | One logical request |
| Shared profile reads | `2` | `2` | No duplicate profile authority |
| Shared config reads | `6` | `6` | No duplicate config read |
| Route-completion latency | `4,598.6 ms` | `4,230.6 ms` | Single local observations; not a statistical claim |
| Login committed renders | `17` | `15` | Lower aggregate route render count |
| Decorative background / orbs / card border / header isolation counters | Not recorded by the clean report | `2 / 2 / 2 / 2` | Stable decorative subtrees in the browser journey |
| Animated submit / create button isolation counters | Not recorded by the clean report | `7 / 7` | Expected action/hover/loading transitions; input typing is covered by the explicit unit counter |

The after Login browser scenario also asserted that the account-created confirmation was visible at Character Creation. The destination integration test proved immediate route completion with matching Auth/profile state already available as the create promise settled; no fake timers or navigation delay were used.

### Commands and boundaries

The source-valid local behavior and browser runs used only the loopback `demo-fnd-perf` emulators and the command-scoped JDK:

```powershell
$task08Jdk = 'C:\Program Files\JetBrains\PyCharm 2024.1.4\jbr'
$env:JAVA_HOME = $task08Jdk
$env:Path = "$task08Jdk\bin;$env:Path"
$env:CI = 'true'
npm.cmd --prefix frontend run perf:task08:behavior -- --skip-browser
npm.cmd --prefix frontend run perf:task08
```

Results were PASS — behavior: `4/4` Jest suites and `54/54` tests, `4/4` deterministic Node checks, `14/14` callable checks; browser: `6/6` Playwright tests in `3.9m`, with emulator cleanup verified. The preserved after report contains `login.auth.signInRequestCount=1`, `login.auth.accountCreationPreflightCount=0`, `login.auth.accountCreationRequestCount=1`, `login.firestore.profileReads=2`, `login.firestore.configReads=6`, and the render-isolation values above.

The remaining local gates were also rerun after the source fix: `$env:FND_GIT_BRANCH='devs'; npm.cmd --prefix frontend run build:staging` PASS; `$env:FND_GIT_BRANCH='devs'; npm.cmd --prefix frontend run verify:staging-build` PASS; `npm.cmd --prefix frontend run perf:verify-disabled` PASS for the normal build; `npm.cmd --prefix frontend run perf:build` and `npm.cmd --prefix frontend run perf:preflight` PASS for the opt-in build; and `git diff --check` PASS. The final opt-in build report was refreshed after this documentation-only append so the ignored build artifact reflects the final source fingerprint; the preserved browser report remains tied to its recorded pre-append source identity.

Known warnings are unchanged and local-only: Browserslist/caniuse-lite age, Node `punycode` deprecation, Firebase CLI MOTD/remote-config and outdated `firebase-functions` notices, Java rules-runtime `Unsafe` deprecation, expected local Firestore rules-denial/expression-limit diagnostics, and Playwright `NO_COLOR`/`FORCE_COLOR` output. No production or staging Firebase data was accessed or mutated. No raw deploy, deployment, push, merge, PR, baseline acceptance, or commit was performed. Later Task 08 work remains for general Character Creation and Home optimization; this correction is limited to the Login attempt lifecycle.

## Third-review correction — idempotent initial anonymous readiness (2026-08-29)

This additive entry records the third-review correction only. It preserves the Step 1 section and both preceding Step 2 review entries, including their historical report identities. The correction remains uncommitted in the linked `fnd-devs` worktree.

### Correction

- The initial-auth readiness exception is now identified by the attempt's starting snapshot (`checking`, UID `null`, observer revision `0`) and the exact benign anonymous snapshot (`anonymous`, UID `null`, observer revision `1`). That snapshot is stored as `benignInitialAnonymousRevision` and remains idempotently benign across repeated effect reconciliation, rerenders, and the Auth promise continuation.
- An anonymous revision `2` or later still represents a post-readiness session change and cancels the attempt. A ready anonymous revision `1` starting state retains the production cancellation rule. Explicit observer errors, authenticated UID supersession, matching-then-anonymous collapse, late promise settlement, synchronous duplicate protection, and exactly-once transition terminal semantics remain fenced by the same attempt ownership token.
- The new deferred ordering regression starts at checking/revision `0`, publishes anonymous/revision `1`, resolves the Auth promise while the same anonymous snapshot is still current, reconciles it again on a rerender, and then routes exactly once after matching authenticated revision `2` plus a fresh matching profile. The adjacent revision-`2` test cancels, recovers both controls, and ignores a late Auth settlement.
- Character Creation, the success banner, Login render isolation, production button memoization, and module isolation were not changed by this correction.

### Red/green evidence

The required test-first RED run was the focused Login suite:

```powershell
$env:CI = 'true'
npm.cmd --prefix frontend test -- --watch=false --watchman=false --runInBand src/components/Login.test.js
```

It failed `1` test and passed `31` (`32` total): the Auth promise continuation incorrectly treated the already-accepted anonymous/revision-`1` snapshot as a supersession. After storing that snapshot identity, the same suite passed `32/32`.

| Command/result | Evidence |
| --- | --- |
| Focused Login/module-isolation/LoginCreateButton/LoginSubmitButton/AuthContext/App/Character Creation integration command | PASS — `8/8` suites, `62/62` tests |
| Focused Task 08 contract/report/preflight/runner/fixture/regression/global-setup/cleanup Node command | PASS — `42/42` tests |
| `npm.cmd --prefix frontend run perf:task08:behavior -- --skip-browser` with the command-scoped JetBrains JDK | PASS — `4/4` Jest suites, `55/55` tests; `4/4` deterministic Node checks; `14/14` local callable-emulator checks |
| Full React suite: `$env:CI='true'; npm.cmd --prefix frontend test -- --watch=false --watchman=false --runInBand` | PASS — `146/146` suites, `1,362/1,362` tests, `0` skipped/cancelled |
| `npm.cmd --prefix frontend run perf:test` | PASS — `422/422` tests, `0` failures, `0` skipped/cancelled; no Firebase config-store `EPERM`, so no host-permission rerun was needed |
| `$env:FND_GIT_BRANCH='devs'; npm.cmd --prefix frontend run build:staging` | PASS — explicit local `devs`/`fatin-test` staging-target build; no deploy |
| `$env:FND_GIT_BRANCH='devs'; npm.cmd --prefix frontend run verify:staging-build` | PASS — local hardened staging-build verification |
| `npm.cmd --prefix frontend run perf:verify-disabled` | PASS — normal build contains no active performance bridge, profiler, benchmark, or persistence artifacts |
| `npm.cmd --prefix frontend run perf:build` followed by `npm.cmd --prefix frontend run perf:preflight` | PASS — opt-in `demo-fnd-perf` build and preflight; the final post-append build was refreshed after this documentation entry |
| `npm.cmd --prefix frontend run perf:task08` | PASS — `6/6` Playwright tests in `4.2m`; Login destination confirmation, Character Creation, Home, and two-client scenarios completed; emulator cleanup passed |
| `$env:FND_GIT_BRANCH='devs'; npm.cmd --prefix frontend run verify:start` | PASS — npm start compiled and `/home` returned HTTP `200` on port `3001`; cleanup released the port |
| `git diff --check` | PASS; Git reported only the existing LF-to-CRLF conversion warnings |
| `perf:baseline -- --accept` | Not run, as required |

All local behavior and browser evidence used only the loopback `demo-fnd-perf` emulators and the command-scoped JDK:

```powershell
$task08Jdk = 'C:\Program Files\JetBrains\PyCharm 2024.1.4\jbr'
$env:JAVA_HOME = $task08Jdk
$env:Path = "$task08Jdk\bin;$env:Path"
$env:CI = 'true'
npm.cmd --prefix frontend run perf:task08:behavior -- --skip-browser
npm.cmd --prefix frontend run perf:task08
```

### Source-matched Login evidence

The clean before report remains the source-matched clean-commit evidence. The new after report was captured immediately before this additive README entry; the entry is documentation-only and does not change the Login bundle. The preserved report is `frontend/performance-results/task08-step2-after-login-third-review-final.json`.

| Identity | Clean before | After third-review correction |
| --- | --- | --- |
| Report/run ID | `task08-step2-before-login.json` / `497f2a88-dda0-4657-8a2c-4946eb98ff22` | `task08-step2-after-login-third-review-final.json` / `f6b1ec66-182a-4b55-be61-b346eaeda568` |
| HEAD | `9c7fcc7c5799a458768512b7cbab49e4d9b301a9` | `9c7fcc7c5799a458768512b7cbab49e4d9b301a9` |
| Source tree fingerprint | `5603a74f3abea558fd69b7d909a89d178c6c2a2aac705340690a443f40d6f008` | `48255c8aec90db154f3cdb23dad47e80f5cd648f705ef70ca4b4e6ca673f0151` |
| Tracked diff fingerprint | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | `dac4647e050b86d780ab3299abe2d10834531e2b9ec6904b557fb0b9c994fd5e` |
| Source tree dirty | `false` | `true` (intended uncommitted Step 2 work) |
| Performance build identity / main asset | `4e25fe2e476774a3828d2aec578fa46643e1b7a9098a222003822c6ebb61a17f` / `static/js/main.5e162902.js` | `5fbcabb6f93b8983375ed983194b716373213edb047500eacb15c724215bbc7e` / `static/js/main.afd5430e.js` |
| Fixture | `9,139` documents; hash `fbabc02a3376d466cf717e3886e0d12a9e15568c17b654322cff4909dc6eaca8` | Same |
| Browser | Chromium `149.0.7827.55`, Playwright `1.61.1` | Same |

| Login metric | Clean before | After third-review correction | Result |
| --- | ---: | ---: | --- |
| Sign-in Auth requests | `1` | `1` | One logical request |
| Account-creation preflight requests | `1` | `0` | Preflight removed |
| Account-creation Auth requests | `1` | `1` | One logical request |
| Shared profile reads | `2` | `2` | No duplicate profile authority |
| Shared config reads | `6` | `6` | No duplicate config read |
| Route-completion latency | `4,598.6 ms` | `4,970.2 ms` | Single local observations; not a statistical claim |
| Login committed renders | `17` | `15` | Lower aggregate route render count |
| Decorative background / orbs / card border / header isolation counters | Not recorded by the clean report | `2 / 2 / 2 / 2` | Stable decorative subtrees in the browser journey |
| Animated submit / create button isolation counters | Not recorded by the clean report | `7 / 7` | Expected action/hover/loading transitions; typing isolation is also covered by the real production-component test |

The browser Login scenario asserted the account-created confirmation at the Character Creation destination, and the route/integration test covered immediate navigation when the matching fresh profile was already available as the create promise settled. No fake timers or navigation delay were introduced.

### Warnings, boundaries, and remaining work

- Warnings remain local and expected: Browserslist/caniuse-lite age, Node `punycode` deprecation, Firebase CLI MOTD/remote-config and outdated `firebase-functions` notices, Java rules-runtime `Unsafe` deprecation, Playwright `NO_COLOR`/`FORCE_COLOR` output, and negative-path Firestore rules-denial/expression-limit diagnostics.
- No production or staging Firebase data was accessed or mutated. No raw deploy, deployment, push, merge, PR, baseline acceptance, or commit was performed. The worktree remains intentionally dirty and uncommitted.
- The after browser report is source-matched to the product/test tree immediately before this documentation-only append; the opt-in build was rebuilt and preflighted again afterward so the ignored build artifact reflects the final working-tree fingerprint.
- Later Task 08 work remains for general Character Creation and Home optimization. This third-review correction is limited to Login attempt lifecycle reconciliation.

## Task 08 Step 4 — Character Creation authoritative mutations (2026-08-30)

This additive entry records the Character Creation mutation implementation in the existing `fnd-devs` checkout. It preserves the historical Step 1, Step 2, and Step 3 measurements and remains uncommitted.

### Implementation

- Character Creation now records successful race and Anima application per authenticated actor and repository-generation scope. An unchanged forward-step revisit skips the mutation only when that exact value is known to have succeeded; changed-then-changed-back selections remain fresh logical actions.
- The shared callable wrapper now deduplicates concurrent immutable keyed requests, separates changed payload bytes, retains only explicitly retryable ambiguous operation identities, retires definitive failures, and reports replay envelopes truthfully. Character Creation initialization uses the existing Task 05 durable receipt path.
- Point changes retain server-authoritative receipts and policies, classify definitive failures, synchronously guard duplicate events, recover controls immediately, and fence late results by actor/generation scope.
- Completion and avatar fallback retain single ownership across uncertain retries. Resumed Task 07 receipts skip preparation/upload only for the still-attached attempt; changed media/name payloads receive new intent identity, and ambiguous legacy completion never deletes a possibly referenced object.
- Task 08 telemetry counts physical `command-applied` events only for `replayed === false`; skipped revisits emit no command and Character Creation emits no `command-non-replayed-success` fallback event.

### Test-first and automated evidence

The intentional RED run used the focused Step 4 suites with Watchman disabled: `7` tests failed and `95` passed, covering keyed in-flight deduplication, changed-payload separation, revisit skipping, point failure recovery, resumed media receipts, preparation bypass, and ambiguous legacy completion safety. The final focused run passed `6/6` suites and `104/104` tests. The full React suite passed `154/154` suites and `1,422/1,422` tests.

| Command/result | Evidence |
| --- | --- |
| `npm.cmd --prefix frontend run perf:test` | PASS after the host-permission rerun — `422/422` Node tests, `0` failures; the initial sandbox attempt had only the four Firebase Storage runtime tests denied by the local configstore permission boundary. |
| `npm.cmd --prefix frontend/functions run build` | PASS — `105` Functions output files; no retired Task 05 runtime artifacts. |
| `npm.cmd --prefix frontend run perf:task08:behavior -- --skip-browser` with `C:\Program Files\JetBrains\PyCharm 2024.1.4\jbr` | PASS — `15/15` local callable/emulator behavior tests, including the initialize replay contract; managed emulator shutdown completed. |
| `npm.cmd --prefix frontend run perf:task08` with the same JDK | PASS — `6/6` local Chromium Playwright tests in `4.4m`; managed emulator cleanup and port release completed. |
| `$env:FND_GIT_BRANCH='devs'; npm.cmd --prefix frontend run build:staging` | PASS — local `devs`/`fatin-test` staging-target build; no deploy. |
| `$env:FND_GIT_BRANCH='devs'; npm.cmd --prefix frontend run verify:staging-build` | PASS — local hardened staging-build verification. |
| `npm.cmd --prefix frontend run perf:verify-disabled` | PASS — normal build contained no active performance bridge, profiler, benchmark, or persistence-experiment artifacts. |
| `npm.cmd --prefix frontend run perf:build` followed by `npm.cmd --prefix frontend run perf:preflight` | PASS — final opt-in `demo-fnd-perf` build and preflight with Node `22.22.2` and portable Java 21+. |
| `npm.cmd --prefix frontend run perf:fixture-determinism` | PASS — `9,139` documents, hash `fbabc02a3376d466cf717e3886e0d12a9e15568c17b654322cff4909dc6eaca8`. |
| `git diff --check` | PASS — only existing LF-to-CRLF conversion warnings were reported. |

### Source-matched local Character Creation observation

The completed local browser report is `frontend/performance-results/task08-baseline.json`, run `a962a0c1-2d8f-4ac4-a0ac-98ff394b556d`, against Chromium `149.0.7827.55` and Playwright `1.61.1`. Its Character Creation scenario recorded the required mutation and revisit behavior:

| Metric | Observed |
| --- | ---: |
| Codex reads | `1` |
| Intentional step revisit | `1` |
| Revisit reads | `0` |
| Authoritative action count | `2` |
| Callable writes | `2` |
| Non-replayed-success fallback events | `0` |
| Duplicate transitions | `0` |
| Object URL create/revoke | `1 / 1` |
| Character Creation cleanup events | `2` |

The browser report was source-matched immediately before this documentation append with source fingerprint `9835b6f9cf8bf11eea5cbeb636b5c1afacb06dd96da18dc2fb0c106c4c7b4f0d`, tracked-diff fingerprint `402360316589c42e70484c360c44faaa11ddbcf21721eefaaebdfaead04190df`, and performance build identity `b57e46421c46fd65e9c9aa61d5efeff980f0b2f8d26c6af472c468d1d832bd36`. The final documentation-state fingerprints are recorded in the Step 4 coordinator report; the opt-in build was refreshed afterward.

### Boundaries and concerns

- The local browser run used only the disposable `demo-fnd-perf` loopback emulators and deterministic fixture. The post-cleanup standalone `perf:verify-fixture` command was not a valid live check after cleanup (`ECONNREFUSED 127.0.0.1:8080`); the browser harness seeded and exercised the fixture, and deterministic generation independently passed with the canonical count/hash.
- The generated performance Firebase config `.firebase.performance.generated.json` and Playwright marker are absent after cleanup. Required task ports `3000,3001,4000,4400,4500,5000,5001,5002,8080,9099,9150,9199` are free. The first sandboxed run left its exact owned Firestore emulator PID `25476`; it was terminated with elevated cleanup before the corrected rerun. No unrelated user process was terminated. Existing ignored emulator logs/configstore files remain outside the tracked diff.
- Known local-only warnings remain: Browserslist/caniuse-lite age, Node `punycode` deprecation, Firebase CLI MOTD/remote-config and outdated `firebase-functions` notices, Java rules-runtime `Unsafe` deprecation, Playwright `NO_COLOR`/`FORCE_COLOR`, and expected negative-path Firestore rules diagnostics.
- Manual staging/remote Browser acceptance remains coordinator-owned and was not performed here. No live Firebase data was read or mutated. No commit, push, merge, PR, deployment, baseline acceptance, or worktree reset/stash/cleanup was performed.

The final implementation and verification report is `docs/coordinator/task-08-character-creation-step-4/reports/step-04-attempt-01.md`. Later Task 08 work remains for broader Character Creation and Home optimization.

### Attempt 2 remediation — retry identity and replay telemetry (2026-08-30)

This additive entry records the second Step 4 implementation attempt. It preserves the historical attempt-1 measurements above and remains uncommitted in the existing `fnd-devs` checkout.

#### Remediation

- `updateCharacterCreation` now accepts an internal `retryScope` that is removed before the callable payload is built. Character Creation supplies actor- and repository-generation-fenced scopes for `initialize`, `selectRace`, `selectAnima`, and `complete`; the scope is not sent to Firebase or included in Task 08 tags.
- Keyed retry identity now includes the immutable request bytes and the logical scope. Advancing a scope retires prior retained and in-flight identities, so A → B → A gets a new operation ID while an explicit retry of the same ambiguous request still reuses its exact ID. Definitive failures retire the identity; actor/generation changes cannot reuse it.
- The callable wrapper no longer suppresses `command-non-replayed-success` for Character Creation. `command-applied` requires `replayed === false`; `replayed === true` is replay-only; absent or invalid replay metadata is reported as a diagnostic non-replayed success rather than a physical application.
- Added real-wrapper regressions for A → B → A, pending stale invocations, changed completion name/media, definitive retirement, actor/generation fences, internal scope stripping, and replay telemetry. Added an emulator check proving initialize, race, Anima, and completion all return truthful first-application/replay envelopes.

#### Attempt-2 RED/green evidence

The first focused command-wrapper RED run failed `7` tests and passed `19` (`26` total): missing fallback telemetry, scope leakage, stale A → B → A identity reuse, stale completion identity reuse, and missing caller scopes. The combined command-wrapper/Character Creation caller RED run failed `10` tests and passed `44`, including the three missing caller-scope assertions. A targeted pending-invocation regression also failed before in-flight metadata invalidation (`expected 3 callable calls, received 2`).

After the fixes, the combined wrapper/caller run passed `2/2` suites and `55/55` tests. The broader relevant Character Creation, child-control, media, points, and wrapper run passed `12/12` suites and `127/127` tests. The fresh full React suite passed `154/154` suites and `1,430/1,430` tests.

#### Attempt-2 verification

| Command/result | Evidence |
| --- | --- |
| `npm.cmd --prefix frontend/functions run build` | PASS — `105` Functions output files; no retired Task 05 runtime artifacts. |
| `npm.cmd --prefix frontend run perf:test` | PASS on the elevated rerun — `422/422` tests, `0` failures/cancellations/skips. The initial sandbox run was blocked only by four Firebase Storage configstore `EPERM` cases. |
| `npm.cmd --prefix frontend run perf:task08:behavior -- --skip-browser` with `C:\Program Files\JetBrains\PyCharm 2024.1.4\jbr` | PASS — `16/16` local behavior checks, including the all-action Character Creation replay-envelope check; emulator cleanup completed. |
| `$env:FND_GIT_BRANCH='devs'; npm.cmd --prefix frontend run build:staging` | PASS — local `devs`/`fatin-test` staging-target build; no deploy. |
| `$env:FND_GIT_BRANCH='devs'; npm.cmd --prefix frontend run verify:staging-build` | PASS — local hardened staging-build verification. |
| `npm.cmd --prefix frontend run perf:verify-disabled` while the normal build was present | PASS — no active performance bridge, profiler, benchmark, or persistence-experiment artifacts. |
| `npm.cmd --prefix frontend run perf:build` followed by `npm.cmd --prefix frontend run perf:preflight` | PASS — opt-in `demo-fnd-perf` build/preflight with Node `22.22.2` and portable Java 21+. |
| `npm.cmd --prefix frontend run perf:task08` | PASS — `6/6` local Chromium Playwright tests in `4.2m`; the completed report is run `2619a39e-8235-4233-a4fb-255a8a22f725`. |
| `npm.cmd --prefix frontend run perf:fixture-determinism` | PASS — `9,139` documents, hash `fbabc02a3376d466cf717e3886e0d12a9e15568c17b654322cff4909dc6eaca8`. |
| Production ESLint for `userDataCommands.js` and `CharacterCreation.js` | PASS. |
| `git diff --check` | PASS — only existing LF-to-CRLF conversion warnings were reported. |

The source-matched browser report is `frontend/performance-results/task08-baseline.json`, with Chromium `149.0.7827.55` and Playwright `1.61.1`. Before this attempt-2 documentation append it recorded source fingerprint `44e7efcf1b7b3a54c8917e8ccf077717ec0c88309dab942fb41d101e7d774b03`, tracked-diff fingerprint `d17e4fc516419c2de6cd00c48aeacae4ba012ab20bc3a44e4cfffe28c1b23662`, and opt-in build identity `475dfc063a98e08ef2415b331ba4432cb7b93c81641817672d258d48a2c1e8f2`. The final documentation-state fingerprints and rebuilt opt-in build identity are recorded in the attempt-2 coordinator report. The Character Creation scenario recorded:

| Metric | Observed |
| --- | ---: |
| Codex reads | `1` |
| Intentional step revisit | `1` |
| Revisit reads | `0` |
| Authoritative action count | `2` |
| Callable writes | `2` |
| Non-replayed-success fallback events | `0` |
| Duplicate transitions | `0` |
| Object URL create/revoke | `1 / 1` |
| Character Creation cleanup events | `2` |

The browser run used only disposable loopback `demo-fnd-perf` emulators and the deterministic fixture; it was not a staging or production observation. The first sandboxed attempt-2 browser run completed all six scenarios but could not shut down its exact Firestore emulator PID `11544` because of Windows access denial; after confirming its command line belonged to this checkout/run, elevated cleanup terminated only that process, and the corrected rerun completed with clean shutdown. The generated performance Firebase config and Playwright marker are absent, and required task plus harness ports are free. Expected local-only warnings remain Browserslist/caniuse-lite age, Node `punycode`, Firebase CLI MOTD/remote-config, Java rules-runtime `Unsafe`, Playwright color handling, and negative-path Firestore diagnostics.

Manual staging/remote Browser acceptance remains coordinator-owned and was not performed here. No live Firebase data, deployment, commit, push, merge, PR, baseline acceptance, reset, stash, discard, or worktree-topology change was performed. The final attempt-2 report is `docs/coordinator/task-08-character-creation-step-4/reports/step-04-attempt-02.md`; later Task 08 work remains for broader Character Creation and Home optimization.

## Step 5 — Home shared read and render plane (2026-08-30)

This additive Step 5 entry records local implementation and source-matched
`demo-fnd-perf` evidence. It preserves the accepted uncommitted Step 2–4
state and does not rewrite any earlier observation.

### Implementation

- `HomeReadPlane` now owns the six compact Home user-domain subscriptions, the
  single catalog subscription path, shared config reads, and one normalized
  inventory/equipment/catalog projection. Publications are fenced by actor and
  repository-generation scope; stale publishers cannot update a new scope.
- Selector-aware external-store readers preserve selected identity when an
  unrelated domain changes. Home consumers retain their existing hooks, but
  those hooks read narrow shared slices and suppress duplicate physical
  subscriptions while under the Home plane.
- Inventory search names/types are normalized with the shared projection and
  queried through `useDeferredValue`. The list mounts an initial named window
  of `60` rows, resets on query changes, and exposes an accessible `Load more`
  control that expands by another `60` rows without making deeper matches
  unreachable.
- Inventory and equipment media remain on the canonical Task 07 `MediaImage`
  thumbnail/lazy path. Inventory-owned request attribution remains `N/O`
  (`null`) because the route-wide resource diagnostic cannot authoritatively
  assign an image request to Inventory.
- Production-safe committed-render probes now sit inside the six measured
  consumers. This was required because the production React Profiler callback
  is absent and a stable wrapper does not rerender for a selector-local child
  update; the browser trace proved authoritative resource delivery and visible
  HP updates while the old wrapper-only counter remained zero.

### RED/green and automated evidence

The initial focused RED command was:

```powershell
npm.cmd --prefix frontend test -- --watch=false --watchman=false --runInBand src/components/home/homeReadStore.test.js src/components/home/homeInventoryProjection.test.js
```

It failed both suites because the new store and projection modules did not yet
exist. After implementation, the focused Home store/projection/Inventory/
EquippedInventory/StatsBars run passed `5/5` suites and `17/17` tests. The
combined relevant hook/catalog/projection/media/Task 08 run passed `10/10`
suites and `62/62` tests.

The first full browser run exposed a second RED condition: the Home resource
window received and rendered authoritative HP changes, but the wrapper-only
`StatsBars` counter remained `0`. A focused regression test for an
in-component committed-render probe failed `1/2` before the export existed and
passed `2/2` after the fix; the affected component/profiler run passed `4/4`
suites and `14/14` tests.

| Command/result | Evidence |
| --- | --- |
| `node frontend/scripts/performance/task08-contract.test.js` | PASS — `10/10` Node contract tests. |
| `$env:CI='true'; npm.cmd --prefix frontend test -- --watch=false --watchman=false --runInBand` | PASS with clean exit — `156/156` suites, `1,436/1,436` tests, `0` skipped/cancelled. |
| `npm.cmd --prefix frontend/functions run build` | PASS — `105` Functions output files and no retired runtime. |
| `npm.cmd --prefix frontend run perf:test` | PASS on the host-permission rerun — `422/422` tests, `0` failures/skips; the sandbox-only run had four Firebase config-store permission failures. |
| `npm.cmd --prefix frontend run perf:task08:behavior -- --skip-browser` with the command-scoped JetBrains JDK | PASS — `4/4` React suites (`65/65` tests), `4/4` Node checks, and `16/16` serialized callable-emulator checks. |
| `$env:FND_GIT_BRANCH='devs'; npm.cmd --prefix frontend run build:staging` | PASS — local `devs`/`fatin-test` staging-target build; no deploy. |
| `$env:FND_GIT_BRANCH='devs'; npm.cmd --prefix frontend run verify:staging-build` | PASS — local hardened staging-build verification. |
| `npm.cmd --prefix frontend run perf:verify-disabled` | PASS while the normal staging build was present — no performance bridge, profiler, benchmark, or persistence-experiment artifacts. |
| `npm.cmd --prefix frontend run perf:build` and `npm.cmd --prefix frontend run perf:preflight` | PASS — opt-in `demo-fnd-perf` build/preflight with Node `22.22.2` and the command-scoped Java 21+ runtime. |
| `npm.cmd --prefix frontend run perf:task08` | PASS — `6/6` Chromium Playwright stages in `4.4m`; complete report and owned-emulator cleanup. |

### Source-matched Home observation

The completed local report is
`frontend/performance-results/task08-baseline.json`, run
`4813e02c-b1b5-40d3-9f8b-5b46e0d2872d`, with Chromium
`149.0.7827.55` and Playwright `1.61.1`. Immediately before this documentation
append it recorded source-tree fingerprint
`b6b7f4c4b1d1440d5076b3b10d56105fe00215b6ae3161e366bd3367fa8d8c97`,
tracked-diff fingerprint
`3d32ffde7cd1c9e3284940f6fd97c426da6c794f95102c167b73f1d08f5e55fb`,
performance build identity
`6e93e8c9114a513d789ec04312ea7abc06f69066b4b8da02b83ca71610eb9cb5`,
and main asset `static/js/main.3a1d9eed.js` with SHA-256
`fcc0bb6605ecd3b41865c0ab07b6b7d5c3896d1b141721c09ef5c53b94e629e4`.

| Home metric | Observed |
| --- | ---: |
| Compact user-data subscription targets | `6` |
| Compact listener opens during route setup | `7` |
| Resource mutations / applied updates | `11 / 11` |
| Resource-window committed renders — StatsBars | `11` |
| Resource-window committed renders — Navbar / Inventory / EquippedInventory / Extra / ParamTables | `0 / 0 / 0 / 0 / 0` |
| Fixture inventory items | `500` |
| Initial mounted rows / window limit | `60 / 60` |
| Deep filter `Fixture item 315` | `1` result |
| Mounted rows after accessible expansion | `120` |
| Inventory-owned media requests | `N/O` (`null`) |
| Consumable prepare / commit / atomic outcome | `1 / 1 / committed` |

The run remained `officialBaseline=false`; it is reproducibility evidence, not
baseline acceptance. The fixture settled at `9,139` documents with hash
`fbabc02a3376d466cf717e3886e0d12a9e15568c17b654322cff4909dc6eaca8`.
The first sandboxed browser attempt could not terminate its owned Firestore
emulator and also revealed the render-probe RED assertion. PID `27624` was
verified from its exact `demo-fnd-perf` command line and this checkout's rules
path before only that orphan was terminated. The corrected host-permission run
passed all stages and cleanup.

Expected local warnings remain Browserslist/caniuse-lite age, Node `punycode`,
Playwright color handling, Java/Firebase emulator diagnostics, and intentional
negative-path rules/test console output. Manual localhost Browser acceptance is
coordinator-owned and was not claimed here. No staging or production Firebase
data was read or mutated, and no commit, push, merge, PR, deployment, baseline
acceptance, dependency upgrade, reset, stash, discard, or worktree-topology
change was performed.

## Step 5 remediation attempt 2 (2026-08-31)

This follow-up closed the three review findings without changing the Task 08
deployment or baseline-acceptance boundary:

- Inventory window ownership now follows the active query and item-set identity.
  Filtering a deeply paged list, clearing the query, or shrinking and regrowing
  the same-query data resets the mounted window to `60`; ordinary accessible
  expansion still advances `60 -> 120`.
- Inventory gold now accepts the selector-shaped scalar returned by
  `useResources`, including a legacy numeric string, while malformed values
  remain safely normalized to zero. Consumable deltas continue through the
  command layer.
- Committed render counts now have one explicit authoritative owner. Child-owned
  probes suppress the wrapper probe, React Profiler samples remain auxiliary,
  and Task 08 contracts and browser aggregation count only committed,
  authoritative probe events.

The RED contract run produced the three intended failures: the missing reset
metric, the missing reset value, and a mixed profiler stream counted as `3`
instead of `1`. The first focused React run then exposed only a test-runtime
timeout from mounting all 500 rows; the distinct full-expansion regression was
right-sized to 120 rows while the required exact-500 deep-filter case remained
unchanged. Final focused verification passed `5/5` suites and `25/25` tests;
the Inventory suite independently passed `13/13`, and the Task 08 contract
suite passed `11/11`.

| Attempt-2 gate | Result |
| --- | --- |
| Full React suite | PASS — `156/156` suites, `1,442/1,442` tests, `0` snapshots. |
| Functions compile | PASS — `105` output files and no retired Task 05 artifacts. |
| `npm.cmd --prefix frontend run perf:test` | PASS — `423/423`; the sandboxed run reached `419/423` with only four Firebase CLI config-store permission failures before the host-permission rerun passed. |
| Staging build / verify / instrumentation-disabled | PASS — `devs` build `static/js/main.1c45d437.js`, staging verification, and no performance instrumentation. |
| Performance build / preflight | PASS — opt-in `demo-fnd-perf`, Node `22.22.2`, and command-scoped Java 21+. |
| Task 08 behavior (`--skip-browser`) | PASS — React `4/4` suites (`65/65`), Node `4/4`, callable emulator `16/16`, fixture `9,139` documents, and clean shutdown. |
| Full Task 08 browser | PASS — `6/6` Chromium Playwright stages in `4.4m`; complete report and managed cleanup. |
| Fixture determinism | PASS — `9,139` documents, hash `fbabc02a3376d466cf717e3886e0d12a9e15568c17b654322cff4909dc6eaca8`. |

### Attempt-2 source-matched Home observation

The completed local report is
`frontend/performance-results/task08-baseline.json`, run
`8409d721-e7c6-41b6-a476-95ead66d4854`, with Chromium `149.0.7827.55` and
Playwright `1.61.1`. Immediately before this documentation append it recorded
source-tree fingerprint
`d593623c55819be84eb8095c9f70ecb3e431d9d553312328962f7e46bb9c6abf`,
tracked-diff fingerprint
`284f697d072eafd2ce8ef7c1707fff0f72ba100eeb5af2406c92b74025f77c41`,
performance build identity
`0c057ae479727a0c7448438e3c4e21efc839b476411545804b8d7596fdcb3ec9`,
and main asset `static/js/main.47b05f2b.js` with SHA-256
`410ba8982fe309084f5e9a75606b65e8cbc6f7ae9026c74837d3e2e941c4acca`.

| Home metric | Observed |
| --- | ---: |
| Compact user-data subscription targets / listener opens | `6 / 7` |
| Total authoritative committed renders — Navbar / StatsBars / Inventory / EquippedInventory / Extra / ParamTables | `2 / 17 / 43 / 37 / 2 / 9` |
| Resource-window authoritative committed renders — Navbar / StatsBars / Inventory / EquippedInventory / Extra / ParamTables | `0 / 11 / 0 / 0 / 0 / 0` |
| Resource mutations / applied updates / non-replayed updates | `11 / 11 / 0` |
| Requested / applied resource delta | `-11 / -11` |
| Fixture inventory items / deep-filter result | `500 / 1` |
| Initial / reset / expanded mounted rows / window limit | `60 / 60 / 120 / 60` |
| Inventory-owned media requests | `N/O` (`null`) |
| Consumable prepare / commit / atomic outcome | `1 / 1 / committed` |

The report remains `officialBaseline=false`: it is local reproducibility
evidence, not baseline acceptance. A first post-build behavior invocation was
interrupted after inherited Windows `Path`/`PATH` casing caused the Functions
emulator to reject `node`; all required ports and ownership markers were then
verified clean, and the command-scoped normalized rerun passed. Watchman access
also required the focused React commands to use `--no-watchman`.

Expected local warnings remain Browserslist/caniuse-lite age, Node `punycode`,
Playwright color handling, Firebase/Java emulator diagnostics, and intentional
negative-path console output. Manual localhost Browser acceptance remains
coordinator-owned and is not claimed here. No staging or production Firebase
data was read or mutated, and no commit, push, merge, PR, deployment, baseline
acceptance, dependency upgrade, reset, stash, discard, cleanup of user-owned
files, or worktree-topology change was performed.

## Step 6 — resource gesture batching attempt 1 (2026-08-31)

This local-only attempt replaces the four repeated resource-write paths with a
single pointer-owned optimistic gesture path. Focused React tests cover a
short press, a two-second eleven-tick hold, duplicate terminals, and keyboard
activation (`6/6`); a combined focused Home/command run passed `37/37`, the
Functions build passed, and the Task 08 Node contract remained `11/11`.

This entry is deliberately **not accepted**: callable-emulator concurrency,
full React/performance suites, deterministic browser evidence, fixture/port
cleanup, and the required source-acknowledged optimistic reconciliation review
remain open. No deployment, staging observation, remote Firebase access, or
manual Browser verdict was performed. See
`docs/coordinator/task-08-resource-gesture-step-6/reports/step-06-attempt-01.md`.

## Step 6 — resource gesture batching attempt 2 (2026-08-31)

Attempt 2 replaces the first attempt's additive overlay with a source-acknowledged
gesture lifecycle. The callable returns the committed resource value and revision
and stamps the operation ID in the resource document, so listener-first delivery
does not double apply a local delta and callable-first delivery holds the committed
value until the matching resource revision arrives. Concurrent non-matching source
updates remain visible under an in-flight delta; later revisions win.

The local controller now rejects secondary/non-primary pointers, has only Pointer
Events terminals, clears capture safely, fences state by auth generation/unmount,
and retries one ambiguous response using the same idempotency operation ID.
Focused coverage passed `11/11` StatsBars tests and `42/42` StatsBars/Home-store/
command tests; Functions compilation and the `11/11` Task-08 Node contract were
green. The full suite did not return a completion result from the local runner and
is therefore not claimed. Emulator, browser, fixture, build, and manual acceptance
remain unrun; no deploy or remote state change occurred. See
`docs/coordinator/task-08-resource-gesture-step-6/reports/step-06-attempt-02.md`.

## Step 6 — resource gesture batching attempt 5 recovery (2026-08-31)

Local recovery freezes unresolved ambiguous holds rather than adding their delta
to a later source snapshot, blocks pointer and keyboard mutations while retry is
unresolved, and replays only the exact retained operation identity. Capture
ownership is invalidated before release; one hold ID is captured at gesture start
and correlated through terminal, command, and callable application evidence.
Settlement now gates exactly one terminal, physical command, and application and
uses callable `appliedDelta` rather than the requested value.

Focused React/command coverage passed `2/2` suites and `43/43` tests; Functions
build verified `105` outputs; Node contract passed `12/12`; and local behavior
with Browser skipped passed React `65/65`, Node `4/4`, callable emulator `17/17`.
The fixture verified `9,139` documents with hash
`fbabc02a3376d466cf717e3886e0d12a9e15568c17b654322cff4909dc6eaca8`; all
required harness ports were free after shutdown. Full React/perf and Chromium
remain unrun, as does the coordinator-owned manual Browser gate. Local-only,
`officialBaseline=false`; no deployment or remote Firebase access occurred.

## Step 6 — resource gesture batching attempt 6 recovery (2026-08-31)

Attempt 6 makes the pointer ownership matrix explicit for mouse, touch, and
pen: non-primary pointers, mismatched pointer IDs, capture failure, cancel,
lost capture, synchronous lost capture during release, actor/freshness/unmount
invalidation, timers, and retained-retry identity are covered. Test fixtures no
longer inject schema-shaped `lastResourceOperationId` values; operation IDs are
unique and a new gesture receives a new identity only after retained retry
reconciliation. Terminal contract negatives now reject duplicate/mismatched
terminals, zero/duplicate commands, missing/duplicate applications, and
duplicate success/failure events.

The Home Chromium scenario now specifies a 2.05-second pointer window for the
immediate-plus-ten-interval contract and asserts one terminal/command/apply,
exact `-11` requested/effective/applied delta, and stable authoritative samples
`[34, 34]`. The two-client scenario derives resource/consumable command and
render observations from captured events rather than literals, with client A as
the real UI-held pointer owner and client B as the overlapping mutation.

Verification passed: StatsBars `22/22`; Task 08 contract `19/19`; full React
`156/156` suites and `1,462/1,462` tests; full `perf:test` `431/431`; opt-in
performance build and preflight; and behavior-with-browser-skipped React
`65/65`, Node `4/4`, callable emulator `17/17`, fixture `9,139` documents,
hash `fbabc02a3376d466cf717e3886e0d12a9e15568c17b654322cff4909dc6eaca8`.

The full Chromium invocation did **not** produce scenario evidence: its auth
setup failed while warming six deterministic static chunks with `signal is
aborted without reason`, and managed emulator teardown then reported
temporarily occupied harness ports. A fresh local port inspection found those
ports free. This environmental/harness failure leaves the exact Chromium Home
and two-client acceptance unverified; the coordinator-owned manual Browser
gate is also still unverified. No staging/production Firebase data was read or
mutated, and no deploy, commit, push, merge, PR, baseline acceptance,
dependency change, reset, stash, discard, or worktree-topology change occurred.
See `docs/coordinator/task-08-resource-gesture-step-6/reports/step-06-attempt-06.md`.

## Step 6 — resource gesture batching attempt 7 narrowed recovery (2026-08-31)

Attempt 7 adds independent lifecycle/timer/synthetic-click and in-flight Retry
coverage to `StatsBars` (`31/31` focused tests), exact concurrent callable
envelope expectations, and per-client unrelated-render assertions. Full React
passed `156/156` suites / `1,471/1,471` tests, Functions build verified `105`
outputs, and `perf:test` passed `431/431` after the local-config permission
rerun. The ordinary local staging build, verification, and disabled-performance
check were restored successfully.

A full local Chromium run passed asset warmup, auth setup, Login, Character
Creation, and Home. Its two-client assertion initially counted renders after the
deliberately separate consumable action; the resource window was corrected to
end at resource convergence. The corrected rerun is blocked because the prior
owned harness left Java PID `31296` on loopback ports `8080` and `9150`; it was
not terminated. Thus neither the exact callable-envelope rerun nor corrected
two-client Chromium proof is claimed, and the coordinator-owned manual Browser
gate remains unverified. No deployment, remote Firebase access, baseline
acceptance, commit, push, merge, PR, dependency change, or destructive cleanup
occurred. See
`docs/coordinator/task-08-resource-gesture-step-6/reports/step-06-attempt-07.md`.

## Step 6 — resource gesture batching attempt 8 harness reliability (2026-09-01)

Attempt 8 is a narrow harness-only recovery: browser validation retains its 5-second deadline but retries exactly once only for an instrumented, self-triggered transient abort, recording both attempts; all delivery and integrity failures remain terminal. Windows teardown now signals the captured child with `SIGINT` first, permits exact-PID `taskkill` only as a bounded fallback, and requires stable free ports without adopting or terminating unrelated processes.

Focused browser/emulator tests passed `50/50` and `20/20`; `perf:test` passed `436/436`; and full React passed `156/156` suites / `1,471/1,471` tests. A fresh performance build and JBR preflight passed, then staging build/verification and the disabled-performance check were restored successfully. Chromium remains unverified: the authoritative bind guard refused ports `8080` and `9150` even while Windows reported no listener owner, so the harness did not start and no process was killed. No deployment, remote Firebase access, baseline acceptance, commit, push, merge, or PR occurred. See `docs/coordinator/task-08-resource-gesture-step-6/reports/step-06-attempt-08.md`.

## Step 6 — resource gesture batching attempt 9 owned Windows shutdown (2026-09-01)

Attempt 9 replaces Windows' OS-level signal delivery to the captured Firebase
wrapper with a parent-owned IPC request to a small local supervisor. The
supervisor loads the exact Firebase CLI entrypoint in-process, confirms that its
`SIGINT` handler is installed, emits that event in the Firebase process, and
acknowledges the specific request ID. Cleanup then still requires captured-child
exit and stable free harness ports; a rejected/missing acknowledgement or port
proof fails closed, with exact-tree `taskkill` retained only as the bounded
fallback.

The new RED lifecycle cases initially failed against the prior signal-only
helper: it could not obtain an owned acknowledgement, accepted an exited wrapper
without descendant port proof, and exposed no shutdown diagnostics. After the
implementation, focused lifecycle/Task 08 coverage passed `49/49`, full
`perf:test` passed `439/439`, and full React passed `156/156` suites /
`1,471/1,471` tests. The normal local `devs`/`fatin-test` staging build,
verification, and disabled-performance check also passed. Expected warnings were
the existing `punycode` deprecation, intentional negative-path test console
output, and stale Browserslist/caniuse-lite notice.

No new emulator or Chromium run was started: the read-only harness preflight
found ports `8080` and `9150` occupied by pre-existing PID `18624`, which was
not authorized for termination or adoption. Therefore fixture restoration,
free-port cleanup, and source-matched `6/6` Chromium rerun remain unverified;
`officialBaseline=false` remains unchanged. No deployment, remote Firebase
access, baseline acceptance, commit, push, merge, PR, dependency update, or
manual Browser acceptance occurred. See
`docs/coordinator/task-08-resource-gesture-step-6/reports/step-06-attempt-09.md`.

## Step 6 — resource gesture batching attempt 10 IPC backpressure (2026-09-01)

Attempt 10 narrows the owned Windows emulator shutdown protocol further. A
`child.send()` return value of `false` now records IPC backpressure only; it is
not treated as delivery failure. The parent instead settles on the send callback,
the request-ID-specific supervisor acknowledgement, child error/disconnect/exit,
or the bounded acknowledgement timeout. This prevents the exact captured-tree
fallback from racing a graceful request that Node has already queued.

New lifecycle coverage proves backpressure followed by callback and matching ACK
does not invoke fallback, while callback errors, child errors, disconnect,
wrapper exit, rejected/malformed/mismatched ACKs, timeout, and late events all
fail or settle safely with listeners removed. Focused Node coverage passed
`58/58`, `perf:test` passed `448/448`, and full React passed `156/156` suites /
`1,471/1,471` tests. The normal local `devs` / `fatin-test` staging build,
verification, and disabled-performance verification were restored successfully.

No emulator or Chromium integration was run: read-only preflight still found
ports `8080` and `9150` occupied by pre-existing, unauthorized PID `18624`.
No process was signalled, adopted, or terminated; fixture restoration,
free-port cleanup, and the source-matched full Chromium rerun remain unverified.
No deployment, remote Firebase access, baseline acceptance, commit, push,
merge, PR, dependency update, or manual Browser acceptance occurred. See
`docs/coordinator/task-08-resource-gesture-step-6/reports/step-06-attempt-10.md`.

## Step 7 — declarative consumable dice integration (2026-09-02)

Consumable use now belongs to the mounted Home/EquippedInventory React tree.
The former detached `createRoot(document.body)` overlay and module-global action
ownership are gone. A component-scoped owner fences each logical action by UID,
Home repository generation, inventory instance/version, resource mode, and
stable prepare/commit identities. Server-prepared rolls drive the existing
DiceRoller presentation; after animation, `task05CommitConsumable` remains the
sole authoritative transaction for current-state capping, inventory history,
depletion, and equipped-slot cleanup. Ambiguous retries reuse the exact
operation identities, while pre-commit close, actor/generation/inventory change,
and unmount paths are fenced without claiming cancellation of dispatched work.

Focused React coverage passed `10/10` suites / `107/107` tests, full React
passed `156/156` suites / `1,483/1,483` tests, Functions built successfully,
the callable emulator passed `18/18`, Task 08 behavior passed React `76/76`,
Node `4/4`, and callable `18/18`, and the escalated local `perf:test` rerun
passed `484/484`. The Chromium journey proved Home once and the corrected
two-client concurrent consumable scenario once, but no single final `6/6` run
completed: the last run was `5/6` because four deterministic local Storage
image requests were aborted during Home cleanup. Fixture integrity remained
`9,139` documents with hash
`fbabc02a3376d466cf717e3886e0d12a9e15568c17b654322cff4909dc6eaca8`;
all harness ports were free in two samples and generated markers were absent.
No deployment, remote Firebase access, baseline acceptance, commit, push,
merge, PR, dependency change, or Step 8 work occurred. See
`docs/coordinator/task-08-steps-7-8/reports/step-07-attempt-01.md`.

## Step 7 remediation — Strict Mode and cleanup diagnostics (2026-09-02)

The Step 7 hook now restores its mounted lifecycle flag in every effect setup,
so React 18 Strict Mode's development setup/cleanup/setup probe cannot leave a
real consumable action inert. A real-hook Strict Mode regression proves one
logical begin reaches exactly one prepare and one commit, clears its busy UI,
and emits no cancellation telemetry during the initial probe. Existing
pre-commit cancellation, ownership fencing, late-completion, and stable retry
contracts remain green.

The Task 08 browser harness also distinguishes one narrowly proven cleanup-only
diagnostic: a `GET` image request to the local `demo-fnd-perf` Storage emulator
may be explained after cleanup navigation only when that exact fixture object
already completed successfully in the same scenario. Route-active failures,
other methods or resource types, external/non-fixture URLs, non-abort failures,
and requests without a prior successful response remain fatal. Explained
events are retained in a named diagnostics bucket rather than silently dropped.

The remediation RED runs each failed one focused test before product changes.
After the fixes, the focused Step 7 React matrix passed `108/108`, the related
Node/browser contracts passed `74/74`, full React passed `1,484/1,484`, the
Functions build passed, `perf:test` passed `485/485`, and the local behavior
gate passed React `77/77`, Node `4/4`, and callable-emulator `18/18`. Normal
staging build verification and disabled-performance checks passed before the
opt-in performance build. The final source-matched `perf:task08` run
`c239d1f7-16d3-4304-b74e-0dfa66b32cb5` passed `6/6` Chromium tests in `5.8m`
with all four required scenarios complete; no cleanup image abort occurred in
that final run. Fixture integrity remained `9,139` documents with hash
`fbabc02a3376d466cf717e3886e0d12a9e15568c17b654322cff4909dc6eaca8`.
See `docs/coordinator/task-08-steps-7-8/reports/step-07-attempt-02.md`.

## Step 8 — integrated Task 08 closure (2026-09-02)

The last duplicate Home configuration read has been removed. `HomeReadPlane`
is now the sole owner of the parallel `getVarie` plus special-schema load and
publishes one scoped config slice with explicit loading, error, freshness, and
retry state. The owner deduplicates concurrent attempts and fences publication
by the exact UID, repository-access generation, store scope, and attempt, so
late old-actor results, rapid retries, and the React 18 Strict Mode probe cannot
replace current state. The consumable confirmation dialog reads only that
shared slice. Regeneration is blocked until a valid configured Anima die is
fresh, config failures expose the same owner's retry action, and no fabricated
`d10` fallback or independent consumer read remains. Consumables with no
regeneration continue directly without requiring config or mounting the dice
presentation.

The Home Anima config consumer is isolated from the remaining Home content so a
config-only transition does not rerender Navbar, Inventory, EquippedInventory,
Extra, StatsBars, or ParamTables. The browser harness also waits for finite
image/asset settlement after both inventory-window expansions; focused source
contracts prevent either wait from being removed. These waits repaired only the
measurement lifecycle that had allowed a settled fixture image to be aborted
when the modal changed the expanded inventory tree; product error
classification was not broadened.

The primary RED contract ran before product edits:
`$env:CI='true'; npm.cmd test -- --watch=false --watchman=false --runInBand src/components/home/HomeReadPlane.test.js src/components/home/elements/ConfirmUseConsumableModal.test.js src/components/home/homeReadStore.test.js`
failed `9/14` tests across two failing suites: modal open/reopen caused six
`getVarie` reads where one owner read was required and the loading, failure,
retry, and valid-die contracts did not exist. The config-isolation RED in
`Home.test.js` failed `1/1` because an unrelated child rerendered. A later owner
readiness RED failed `1/3` because the config attempt had not registered an
async Home owner. The two harness source contracts each failed `1/3` before the
first and restored inventory-window settlement points were added.

Final GREEN evidence is fresh against the completed Step 8 source: focused
Home/config/consumable coverage passed `14/14` suites / `130/130` tests; the
accepted Steps 2–7 React matrix passed `32/32` suites / `287/287`; the full
React suite passed `159/159` suites / `1,496/1,496`; the final escalated local
`perf:test` passed `486/486`; and the Task 08 behavior gate passed React
`77/77`, Node `4/4`, and callable-emulator `18/18`. Fixture integrity was
`9,139` documents with SHA-256
`fbabc02a3376d466cf717e3886e0d12a9e15568c17b654322cff4909dc6eaca8`.

The final source-matched `perf:task08` report is run
`bcee9a13-76ed-4f51-bf29-cc8f4f20bca2`: status `complete`, all four required
scenarios complete, `officialBaseline=false`, and Playwright `6/6` in `6.3m`
on Chromium `149.0.7827.55`. Its source fingerprint is
`c7c35a9e8476413edad3351da53c2bbd839d770b48f20a42aebc3d7284b5b790` and
its performance-build identity is
`b4e0fbc3f6066140b5c1d8aabef38ddf2f65efe6b816cc7d4023352fa95f1425`;
main is `static/js/main.1b614fab.js` (`205,598` gzip bytes) and route-home is
`static/js/route-home.fd802c4a.chunk.js` (`31,674` gzip bytes). The machine
report freshly observed all four requested acceptance gates: six unique compact
Home subscription targets; one Home gesture produced one authoritative
resource mutation with delta `-11`; consumable use produced one prepare and one
commit with atomic outcome `committed`; and the resource-update window produced
zero Navbar, Inventory, EquippedInventory, Extra, and ParamTables renders.
Two-client resource writes converged to `28` on both clients, and the consumed
item converged absent on both clients after one prepare and one commit.

After recording that opt-in report and appending the closure documentation, the
ordinary local `devs` / `fatin-test` staging build was restored and compiled
successfully (`static/js/main.a34fe146.js`, route-home
`static/js/route-home.2d7753d2.chunk.js`). `verify:staging-build` and
`perf:verify-disabled` both passed; the normal artifact contains no active
performance bridge, profiler, benchmark, or persistence experiment.

This is a new Step 8 observation, not a relabeling of the historical Step 1
baseline. The README entry was appended after the source-matched browser report,
so that report retains its recorded pre-append source identity. No deployment,
remote Firebase access, baseline acceptance, commit, push, merge, PR, dependency
change, manual Browser acceptance, or interaction with the open staging tab
occurred. See
`docs/coordinator/task-08-steps-7-8/reports/step-08-attempt-01.md`.
