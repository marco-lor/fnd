# Task 08 Step 8 — integrated closure, attempt 1

Date: 2026-09-02  
Status: DONE; coordinator review required  
Control ID: `task08-steps7-8-3095fd2c`  
Dispatch token: `5df4145f-461d-406e-ad11-8b9bbf4fdf52`  
Control revision read: `8`  
Task: `task08_step8_01_5df4145f` / `/root/task08_step8_01_5df4145f`  
Workspace: `C:\Users\Marco\OneDrive\git_projects\fnd-devs`  
Branch / HEAD: `devs` / `9c7fcc7c5799a458768512b7cbab49e4d9b301a9`

## Dispatch authentication

Before any source edit I read the complete control, plan, protected-dirty-state,
Step 7 Browser evidence and report, Task 08 specification, and Task 08 README.
HEAD, branch, control identity/revision, token, task identity, and lease matched.
The protected-manifest fingerprint, excluding only
`docs/coordinator/task-08-steps-7-8/`, recomputed exactly as
`ebb785f40b29161b0867a683bdfb99ac8171c2a1f2d03ab1308dd8c28d8f5f90`,
and the index had zero staged changes. The pre-existing tracked and untracked
dirty state was preserved.

After the authorized Step 8 edits and README closure append, the same algorithm
recomputed final fingerprint
`53ff26ec1ed6bdce73877d7be5981866a354dad9cc02ba45e76faadb48c1553f`
(`STATUS=6ab7995ee2f4d0c9a8353b2f8f8f48988a34555799aebf493b0f1034ebb27e1a`,
`STAGED=01ba4719c80b6fe911b091a7c05124b64eeece964e09c058ef8f9805daca546b`,
`UNSTAGED=1da618826c9f49116c52c5d8fcee81a580e117b5c868d3ed7bfcebc4d42b116f`,
`UNTRACKED=26010611ec26f35c08e4de853ad0ab5864c51ac8b8de1ea5251413f8118b1f80`;
53 tracked modified, 80 untracked, zero staged). HEAD remained exact.

## Implemented closure

- `frontend/src/components/home/HomeReadPlane.js` and
  `frontend/src/components/home/homeReadStore.js` now expose one Home-owned,
  parallel config attempt for `getVarie` and all four
  `SPECIAL_PARAM_SCHEMA_IDS`. Loading, error, fresh state, and retry are
  explicit. Retry invalidates the same five repository documents and remains
  in the same owner.
- The config attempt is deduplicated and fenced by UID,
  repository-access generation, store scope, and exact attempt. A late success
  or failure from an old actor/generation/attempt cannot publish over a newer
  scope or retry. React 18 Strict Mode reuses the in-flight owner rather than
  starting a duplicate attempt. The Home readiness owner remains active until
  the entire config attempt settles.
- `frontend/src/components/home/elements/ConfirmUseConsumableModal.js` no
  longer imports or calls `getVarie` and no longer silently fabricates `d10`.
  It consumes the narrow shared config selector, resolves the exact player
  level with the existing last-entry fallback only when that entry is itself a
  valid `dN`, and blocks regeneration confirmation/formula display until the
  config is fresh and valid. Loading/error/invalid-die UI is deterministic and
  error recovery calls the owner's retry. No-regeneration consumption still
  needs neither config nor DiceRoller.
- `frontend/src/components/home/Home.js` moves the Anima config consumer into
  an isolated section. Config-only state changes do not rerender the unrelated
  Home sections.
- Focused contracts cover single-owner reads across modal reopen, loading,
  failed config and retry, retry deduplication, actor/repository-generation
  replacement with late completion, valid exact/fallback dice, absence of a
  silent fallback, no-regeneration, Strict Mode, readiness ownership, and
  selector/render isolation.
- The local Chromium harness waits for finite image/asset settlement after both
  inventory-window expansions. Source contracts pin both waits. This is a
  deterministic harness lifecycle repair; route-active failures remain fatal.

No formula, cap, mode-selection, Bonus Creazione, prepared-result, callable
authority, race-reset, negative-stat/point, inventory-history, media lifecycle,
or ambiguous operation-identity semantics were changed.

## RED evidence

Commands ran from `frontend` before their corresponding implementation edits.

1. `$env:CI='true'; npm.cmd test -- --watch=false --watchman=false --runInBand src/components/home/HomeReadPlane.test.js src/components/home/elements/ConfirmUseConsumableModal.test.js src/components/home/homeReadStore.test.js`
   - Exit `1`; `2/3` suites failed, `9/14` tests failed. The modal open/reopen
     contract expected one owner `getVarie` read and observed six; loading,
     failure/retry, dice-validation, and no-fallback behavior were absent.
2. The focused `Home.test.js` config-isolation contract failed `1/1`: an
   unrelated Home child rerendered during a config-only transition.
3. The focused Home-readiness owner contract failed `1/3`: expected one
   `beginAsyncResourceOwner` registration and observed zero.
4. The Task 08 browser source contract failed `1/3` before the first
   inventory-expansion settlement was present, then failed `1/3` for the
   independently required restored-window settlement.

## GREEN verification

- Focused Home/config/consumable matrix: `14/14` suites, `130/130` tests.
- Accepted Steps 2–7 React matrix: `32/32` suites, `287/287` tests.
- Full React after the final product/harness source: `159/159` suites,
  `1,496/1,496` tests in `136.475s`.
- Final performance unit/contracts gate: escalated local
  `npm.cmd run perf:test` — `486/486`, zero fail/skip/cancel in `17.706s`.
- Task 08 behavior without Browser: React `4/4` suites / `77/77`, Node `4/4`,
  callable emulator `18/18`; fixture `9,139` documents with hash
  `fbabc02a3376d466cf717e3886e0d12a9e15568c17b654322cff4909dc6eaca8`.
- Source-matched performance build and command-scoped Java 21+ preflight:
  PASS on Node `22.22.2`, Chromium `149.0.7827.55`, Playwright `1.61.1`.
- Final `npm.cmd run perf:task08`: fixture verification PASS; Firestore rules
  `15/15`; repository rules `3/3`; Playwright `6/6` in `6.3m` for asset
  warmup, auth setup, Login, Character Creation, Home, and two-client
  convergence.
- Final ordinary local staging artifact: with `FND_GIT_BRANCH=devs`,
  `npm.cmd run build:staging`, `npm.cmd run verify:staging-build`, and
  `npm.cmd run perf:verify-disabled` all PASS. Main is
  `static/js/main.a34fe146.js`; route-home is
  `static/js/route-home.2d7753d2.chunk.js`; no performance bridge, profiler,
  benchmark, or persistence experiment is active in that normal artifact.

The first non-Java-overridden preflight invocation correctly failed closed on
the workstation Java `1.8.0_411`; the required command-scoped portable Java 21+
rerun passed. An earlier sandboxed `perf:test` could not reliably clean its
Windows descendant fixture; the authorized host rerun above is the final
evidence and passed all `486` tests.

## Final local machine report

`frontend/performance-results/task08-baseline.json` records:

- Run ID `bcee9a13-76ed-4f51-bf29-cc8f4f20bca2`; status `complete`;
  `complete=true`; `officialBaseline=false`.
- Source fingerprint
  `c7c35a9e8476413edad3351da53c2bbd839d770b48f20a42aebc3d7284b5b790`;
  performance-build identity
  `b4e0fbc3f6066140b5c1d8aabef38ddf2f65efe6b816cc7d4023352fa95f1425`.
- Main asset `static/js/main.1b614fab.js`, `205,598` gzip bytes; route-home
  `static/js/route-home.fd802c4a.chunk.js`, `31,674` gzip bytes.
- All four required scenarios completed in this one run. This is a distinct
  Step 8 observation and does not relabel historical Step 1 measurements.

Four required closure gates were freshly observed:

1. Home registered `6` unique compact subscription targets, with no duplicate
   player-domain target.
2. One Home resource gesture emitted one authoritative mutation, one applied
   result, and exact requested/observed delta `-11`; no interval writes.
3. The cached-config consumable path emitted one prepare and one commit with
   `atomicOutcome=committed` and no replay, failure, ambiguity, or cancellation.
4. The resource-update render window recorded `0` Navbar, Inventory,
   EquippedInventory, Extra, and ParamTables renders. StatsBars alone rendered
   the resource transition (`15`).

The two-client scenario emitted two resource commands and converged final value
`28` visibly on both clients. Its consumable path emitted one prepare and one
commit and converged the exact item absent on both clients. The fixture remained
`9,139` documents with the expected hash.

## Boundaries and handoff

This attempt did not deploy, access remote/staging/live Firebase, accept a
baseline, open or inspect the user's staging Browser tab, perform manual Browser
acceptance, commit, push, merge, create a PR, change dependencies, or alter Git
topology. `officialBaseline=false` is intentional. The README append and this
assigned report occur after the recorded source-matched run; they do not alter
compiled product source, and the report retains its pre-append identity.

Coordinator review remains required. Manual Browser acceptance, deployment,
and release/commit decisions remain coordinator-owned and unverified here.

Final hygiene: `git diff --check` passed with only the existing Windows
LF-to-CRLF notices; the conflict-marker scan found no matches; HEAD and branch
remained exact; the index remained empty. Both generated marker checks were
absent. Harness ports `4000`, `4400`, `4500`, `5000`, `5001`, `5002`, `8080`,
`9099`, `9150`, and `9199` were free in two samples two seconds apart. No owned
process or port cleanup remains pending.
