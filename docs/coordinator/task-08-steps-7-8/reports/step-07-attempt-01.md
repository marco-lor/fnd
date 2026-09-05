# Step 7 attempt 1 — declarative consumable dice integration

## Coordination and identity

- Control: `task08-steps7-8-3095fd2c`; workstream `consumable-dice-integration`; dispatch token `bb38703e-c160-45f4-8e90-6125b52a1780`.
- Control revision read: `3` (dispatch revision `1`).
- Checkout: `C:\Users\Marco\OneDrive\git_projects\fnd-devs`; branch `devs`.
- Baseline/current HEAD: `9c7fcc7c5799a458768512b7cbab49e4d9b301a9`.
- Intake reconciliation passed before edits: branch and HEAD exact; composite code fingerprint `eb5efd35f8ad58c51f8bb1f8b462ad67c9e9be8a053349b0e496fb3645b88784`; 47 tracked, 77 untracked, zero staged. All protected paths were preserved except files explicitly leased to Step 7.
- Final fingerprint (same manifest algorithm, excluding only `docs/coordinator/task-08-steps-7-8/`): `89fcbd1b38cde93f636547c590698233bf9021950212487e41d1604f6f811b74` (`STATUS=1447fb03d6813d80bdbc11302ea6d95622eeb910de321aa83b9364558c0a10fb`, `STAGED=01ba4719c80b6fe911b091a7c05124b64eeece964e09c058ef8f9805daca546b`, `UNSTAGED=8d74a647bd63d450e6ca78b4ce2a087e8094fd2955ebbaa8efae848a9e46897e`, `UNTRACKED=64cfec0c42ca891834f6da7f75936f15adee892811d4a971d726768d4ce587ee`).

## Files changed by this attempt

- Product/UI: `frontend/src/components/home/elements/useConsumable.js`, `frontend/src/components/home/elements/EquippedInventory.js`.
- Focused React tests: `frontend/src/components/home/elements/useConsumable.test.js`, `frontend/src/components/home/elements/EquippedInventory.test.js`.
- Task 08 telemetry/contracts: `frontend/src/performance/task08.js`, `frontend/src/performance/task08.test.js`, `frontend/scripts/performance/task08-contract.js`, `frontend/scripts/performance/task08-contract.test.js`.
- Integration evidence: `frontend/performance/tests/task05-callables.test.js`, `frontend/performance/tests/browser/task08-baseline.performance.js`.
- Narrow local harness prerequisite: `frontend/scripts/performance/emulators.js`, `frontend/scripts/performance/emulators.test.js`.
- Documentation: `docs/performance-improvement-plan/task-08/README.md` and this report.

The emulator source change is deliberately narrow. Windows supplied both `PATH` and `Path`; the later inherited casing overwrote the explicit portable-Java path and Firebase selected Java 8. Environment entries are now normalized case-insensitively in inherited-then-override order. No dependency, Firebase command, supervisor protocol, or Step 6 lifecycle contract was changed.

## Design and lifecycle proof

The detached `createRoot(document.body)` overlay and module-global action map were removed. `EquippedInventory` owns one `useConsumableAction` instance and renders `ConsumableActionLayer` declaratively in the mounted Home/Auth/provider tree. The logical owner binds authenticated UID, Home repository generation, inventory instance plus stable content/revision fingerprint, selected HP/mana mode, action ID, and distinct stable prepare/commit operation IDs.

`task05PrepareConsumable` supplies the immutable rolls, faces, modifier, gain, and preparation receipt. Those exact rolls drive `DiceRoller`; animation and dice logging are presentational. Only after animation closes does the owner dispatch `task05CommitConsumable`. The client never supplies or writes a final resource base. The existing server transaction reads current resources/inventory/equipment, applies the current-state cap, decrements or removes inventory, updates operation history, and clears/recomputes equipped state atomically.

Rapid/double confirmation is rejected while an owner exists. Ambiguous prepare or commit failure retains the same operation ID and retry key; commit retry remains valid after the shared inventory read observes depletion. Definitive errors clear ownership. Close/cancel before commit, route unmount, actor loss/change, repository generation change, inventory replacement, and late prepare/animation/log completion are fenced. Once commit is dispatched, the UI does not claim cancellation; it keeps deterministic pending/error/retry state and reconciles through shared reads.

Telemetry now records action start, animation completion, commit dispatch, terminal applied/replayed/definitive/ambiguous outcome, and pre-commit cancellation. The browser journey selects the exact fixture inventory instance, uses the real confirmation and DiceRoller UI, overlaps a second client's HP delta after preparation but before commit, then observes the server-computed capped value, last-item removal, equipped cleanup, one prepare, one commit, and convergence in both clients.

## RED evidence

All commands ran from `frontend` unless noted.

1. `$env:CI='true'; npm.cmd test -- --watch=false --watchman=false --runInBand src/components/home/elements/useConsumable.test.js` — failed 1 suite, `14/14` tests because the named declarative `useConsumableAction` export did not exist before product edits.
2. `$env:CI='true'; npm.cmd test -- --watch=false --watchman=false --runInBand src/components/home/elements/EquippedInventory.test.js --testNamePattern='owns consumable confirmation'` — failed the 1 selected test (2 skipped): no in-tree hook call was observed.
3. `$env:CI='true'; npm.cmd test -- --watch=false --watchman=false --runInBand src/components/home/elements/useConsumable.test.js --testNamePattern='ambiguous commit'` — failed the 1 selected test: expected two commit transports using one identity, received one after shared inventory removal.
4. `node --test --test-name-pattern='normalizes Windows PATH casing' scripts/performance/emulators.test.js` — failed the 1 selected test because inherited `Path` overwrote the portable-Java-first explicit `PATH`.
5. Initial Chromium `npm.cmd run perf:task08` — `4/6` passed; both new consumable scenarios failed before mutation because a title-only locator matched 125 fixture buttons. After exact-instance selection, the next run passed Home and reached the two-client convergence check; it exposed a hard-coded pre-equipment-transition `/50` total. The assertion was corrected to calculate the cap independently from the post-transaction authoritative total.

## GREEN verification

- Focused consumable/Equipped React: 2 suites, `17/17` tests.
- Focused consumable/Equipped/Task 08 React: 3 suites, `23/23` tests.
- Focused Home/store/command/performance matrix: exact 10-file command covering consumable, EquippedInventory, StatsBars, Inventory, equipment projection, Home stores/projection, command client/hooks, and Task 08 telemetry — 10 suites, `107/107` tests.
- Full React: `$env:CI='true'; npm.cmd test -- --watch=false --watchman=false --runInBand` — 156 suites, `1,483/1,483` tests.
- Functions: `npm.cmd run build` from `frontend/functions` — TypeScript build passed; clean output contained 105 files and no retired artifacts.
- Task 08 contract: `node --test scripts/performance/task08-contract.test.js` — `19/19`.
- Step 6 supervisor compatibility plus emulator helpers: `node --test --test-concurrency=1 scripts/performance/emulators.test.js scripts/performance/task07-harness.test.js` — `56/56`.
- Callable emulator: with `FND_PERF_JAVA_HOME=C:\Users\Marco\OneDrive\git_projects\fnd\frontend\.perf-tools\jdk-21.0.11+10`, `node scripts/performance/rules-emulators.js --task08-only` — `18/18`; observed concurrent client update followed by authoritative current-state cap, depletion/equipped cleanup, no-regeneration behavior, and stale-inventory atomic rejection. Fixture `9,139` documents, exact hash `fbabc02a3376d466cf717e3886e0d12a9e15568c17b654322cff4909dc6eaca8`.
- Local Task 08 behavior with Browser skipped: `npm.cmd run perf:task08:behavior -- --skip-browser` — React `76/76`, Node `4/4`, callable `18/18`, clean emulator shutdown.
- Full performance unit gate: sandbox run finished `477/484`; four failures were `EPERM` reading `C:\Users\Marco\.config\configstore\firebase-tools.json`, and three Step 6 parent-loss cases timed out while their exact synthetic listener trees remained. After proving and terminating only those six test-owned fixture PIDs, the exact escalated rerun `npm.cmd run perf:test` passed `484/484` in 14.7 seconds, including all three supervisor probes with stable-free ports.
- Normal staging artifact: `FND_GIT_BRANCH=devs npm.cmd run build:staging`; then `verify:staging-build` and `perf:verify-disabled` against that build — all passed, with performance bridge/profiler/benchmark/persistence artifacts absent.
- Opt-in local performance preflight/build passed with Node `22.22.2`, portable Java `21`, Chromium `149.0.7827.55`, Playwright `1.61.1`. Latest build identity before the final Chromium run was `e27b072b5433cbc6e4c82b4a6ffd2a82653150a7adbd549ee0f40b4eb9f74a55`.
- Chromium: the corrected final run proved Login, Character Creation, and the complete two-client concurrent consumable scenario, but finished `5/6`; Home alone failed at cleanup because four deterministic local Storage images returned `net::ERR_ABORTED`. The immediately preceding source iteration proved Home but failed the now-corrected two-client expectation. Latest report: `performance-results/task08-baseline.json`, run `36dd9417-209b-400d-bb73-f48bbcdda8b4`, partial/non-official, source fingerprint `c6af4615b64372a0acbf3005c51e621d206b4409d24ce008460e2a56330345fe`; completed scenarios are Login, Character Creation, and two-client. No baseline was accepted.
- `git diff --check` passed; output contained only existing LF-to-CRLF warnings.
- Generated markers `.firebase.performance.generated.json` and `.perf-emulator-data/playwright-webserver.active` were absent.
- Ports `4000, 4400, 4500, 5000, 5001, 5002, 8080, 9099, 9150, 9199` were bind-free in two samples one second apart.

## Warnings, cleanup, and boundaries

Expected warnings: stale Browserslist/caniuse-lite data, Node `punycode` deprecation, Playwright `NO_COLOR`/`FORCE_COLOR`, and intentional Firestore permission-denial negatives. The four local Storage aborts make the final Chromium report partial. This is the only remaining verification concern; the corrected two-client Step 7 journey itself passed.

The interrupted early Jest PIDs `9000`, `11836`, and `15496` were inspected and proved to be Codex/plugin MCP services, so they were not touched. The later 10:11–10:12 low-CPU cluster likewise was not targeted. Only the six exact synthetic supervisor/listener fixture processes created and leaked by this attempt's first `perf:test` were terminated after command-line and parent-tree proof. Final harness ports and markers are clean. No historical temp directory was deleted.

No deploy, remote Firebase read/write, staging/live data access, commit, push, merge, PR, dependency change, reset, stash, clean, discard, worktree/history change, or Step 8 work occurred.

## Result

`DONE_WITH_CONCERNS`: product, focused, full React, Functions, callable, behavior, staging, performance-unit, fixture, marker, and port gates pass. The final integrated Chromium artifact is partial only because of four transient local image aborts during Home cleanup, although Home passed once and the corrected concurrent two-client scenario passed once.
