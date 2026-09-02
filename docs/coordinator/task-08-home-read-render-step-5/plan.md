# Task 08 Step 5 — Home shared read and render plane

## Goal
Introduce one Home-owned data and selector boundary so Home domains are subscribed to once, consumers receive narrow stable slices, inventory/equipment/catalog data is normalized once, search work is precomputed and deferred, Task 07 thumbnail semantics are retained, and a 500-item inventory is rendered through a bounded, deterministic window without changing user-visible behavior.

## Source
This step implements the fifth macro step approved in the `Coordinator - Task 08` task: “Home shared read and render plane.” Its authoritative behavioral context is `docs/performance-improvement-plan/tasks/08-login-character-creation-and-home.md`, its measurement contract is `docs/performance-improvement-plan/task-08/README.md` plus `frontend/scripts/performance/task08-contract.js`, and its accepted predecessor is `docs/coordinator/task-08-character-creation-step-4/control.md` with the attempt-2 report and Browser evidence.

## Starting observation
- The accepted local Task 08 Home observation reports six compact subscription targets and seven physical listener opens.
- Baseline render observations are Navbar `2`, StatsBars `3`, Inventory `3`, EquippedInventory `3`, Extra `3`, and ParamTables `3`.
- `Home`, `Inventory`, `EquippedInventory`, `StatsBars`, and `paramTables` currently acquire overlapping user/config data through separate hooks or repository reads.
- Inventory and equipment/catalog projections are rebuilt in more than one component, while inventory filtering scans and maps the full result set during render.
- The deterministic fixture contains 500 inventory items; filtering for `Fixture item 315` must continue to return exactly one accessible result.
- Resource holds currently produce 11 starts and 11 applied updates for the measured hold. That gesture mutation behavior belongs to Step 6 and must not be changed here.
- Consumable prepare/commit and DiceRoller behavior belong to Step 7 and must not be changed here.

## Required behavior
1. Establish one Home-level owner for the compact player-domain reads and shared Home config/catalog inputs needed by the rendered sections. Preserve authentication, actor, profile-ownership, repository-generation, loading, error, and teardown semantics. A late event from an old actor/generation must never repopulate the current Home plane.
2. Expose narrow selector subscriptions with stable identity. A resource-only update may update the StatsBars/resource slice but must not rerender Navbar, Inventory, EquippedInventory, Extra, ParamTables, or unrelated Home sections. Selector equality must be explicit and testable rather than relying on a broadly rerendering provider value.
3. Normalize inventory, equipment, and catalog relationships once in the shared plane. Reuse structurally shared projections across Inventory and EquippedInventory; do not open a second catalog subscription or rebuild equivalent lookup maps independently in each consumer.
4. Precompute normalized search fields when inventory/catalog inputs change. Defer the user's query before applying the filter, preserve current case/field matching semantics, and ensure the 500-item fixture query `Fixture item 315` yields exactly one result.
5. Bound the number of inventory rows mounted at one time with a named, deterministic window/page size and an accessible expansion mechanism such as `Load more`. Every matching item must remain reachable, query changes must reset/clamp the window correctly, and equipment/mutation flows must remain stable as the window changes. Add no dependency for this.
6. Preserve Task 07 media authority. Inventory and equipment list images must continue through the canonical media adapter/image component using thumbnail variants and lazy loading. Measure inventory-owned media requests honestly; if attribution cannot be made authoritative, retain `N/O` and explain why rather than substituting the route-wide image diagnostic.
7. Preserve every existing mutation and gameplay contract: resource values/formulas/caps and current hold cadence, equipment and inventory mutations/history, gold/personal-item behavior, consumable atomicity, DiceRoller semantics, multi-client visibility, Task 05 command authority, Task 07 media durability, and all accepted Login/Character Creation behavior.

## Non-goals
- Do not implement the 200 ms resource-gesture coalescing or mutation reduction planned for Step 6.
- Do not refactor consumable preparation/commit or DiceRoller reads/rendering planned for Step 7.
- Do not change Login or Character Creation except for narrowly necessary compatibility tests.
- Do not change callable handlers, Firebase rules, schemas, indexes, regions, deployment configuration, or remote data.
- Do not rewrite historical Step 1–4 measurements as if they were rerun. Add clearly labeled Step 5 evidence.
- Do not add a virtualization dependency, upgrade dependencies, or introduce timers as correctness mechanisms.

## Development workspace
- Decision: existing checkout.
- Exact path: `C:\Users\Marco\OneDrive\git_projects\fnd-devs`.
- Branch/ref: `devs` (`devs...origin/devs [ahead 1]` at dispatch).
- Baseline SHA: `9c7fcc7c5799a458768512b7cbab49e4d9b301a9`.
- Accepted pre-Step-5 tracked-diff fingerprint: `2ac90fa777a5a5b0db7d2f8578ffd79f2c7f757569d3c29ab2d545c09b1bd932`.
- Accepted Step-4 source-tree fingerprint: `e9d7a650c770dbc1ce11f737d46d1657916e7a6be08b0347d2e373687449ed66`.
- User-owned dirty state: the complete accepted, uncommitted Step 2–4 implementation, tests, documentation, and coordinator artifacts. Preserve all tracked and untracked files; Step 5 work and its coordinator report/evidence must be additive.

## Authorization envelope
- Local edits, tests, builds, deterministic fixtures, and localhost emulator/browser harnesses are allowed only in the exact `fnd-devs` checkout and only for Step 5.
- Use only loopback emulators with project `demo-fnd-perf`. Local fixture mutation is allowed only through the deterministic harness, which must restore and verify the fixture before completion.
- The user's existing `https://fatin-test.web.app` Browser tab is out of scope and must not be navigated, inspected, or reused.
- Commit, push, merge, pull request, deployment, remote Firebase reads/writes, baseline acceptance, dependency upgrades, and worktree-topology changes are not authorized.
- Do not reset, stash, clean, discard, delete user-owned files, rewrite history, or run raw `firebase deploy`.

## Test-first development and automated acceptance
1. Read the Step 4 accepted plan/control/report/evidence, Task 08 specification/README/contracts/browser scenario, Home and all six measured consumers, user-data hooks/repository, inventory/equipment/catalog projections, Task 07 media adapter/image component, and relevant focused tests before editing.
2. Add focused RED tests first and record exact failing commands, test names, counts, and failure reasons in the attempt report. At minimum prove:
   - one Home plane owns each required compact domain and does not duplicate physical repository/catalog subscriptions;
   - selector results retain identity when their selected domain is unchanged and actor/generation transitions cannot leak stale data;
   - a resource-domain update yields zero render increments for Navbar, Inventory, EquippedInventory, Extra, ParamTables, and unrelated Home sections while the related resource consumer updates correctly;
   - Inventory and EquippedInventory consume one normalized, structurally shared inventory/equipment/catalog projection;
   - normalized search fields are not recomputed for unrelated updates, query filtering uses a deferred value, and `Fixture item 315` returns exactly one result from 500 items;
   - the mounted inventory row count never exceeds the named initial window, all matches remain reachable through the accessible expansion control, and query/data shrink/growth resets or clamps the window safely;
   - Task 07 thumbnail/lazy-media behavior and all equipment/inventory mutation flows remain intact.
3. Implement the smallest cohesive design that makes the contracts green. Prefer a selector-aware external store or equivalent stable selector mechanism; a broad Context value that rerenders the entire Home subtree on every domain change does not satisfy the requirement.
4. Run focused component/store/projection/media tests, then a combined relevant React run and the full React suite. Report exact suites/tests, skips, warnings, and any environment-only reruns separately.
5. Run the Task 08 deterministic contract/unit gates, `npm.cmd --prefix frontend run perf:test`, the local Task 08 behavior gate with Browser skipped, and the local `npm.cmd --prefix frontend run perf:task08` Chromium journey. Extend the Task 08 evidence so subscription ownership, the resource-update render window, 500-item filter result, bounded row count/expansion, and media attribution are source-matched and machine-checkable.
6. Build the normal staging target locally without deploying: set `FND_GIT_BRANCH=devs`, run `build:staging`, then `verify:staging-build`, then `perf:verify-disabled` while that normal build remains present. Only afterward run the opt-in performance build/preflight required by the local Task 08 harness.
7. Run `git diff --check`. Verify the deterministic fixture settles at 9,139 documents with hash `fbabc02a3376d466cf717e3886e0d12a9e15568c17b654322cff4909dc6eaca8`, generated Firebase config/active markers are absent, and ports `3000,3001,5000,5001,5002,8080,9099,9150,9199` plus harness ports are free.
8. Append a Step 5 section to the Task 08 README containing RED/green evidence, source/build identities, observed subscription/render/filter/window/media metrics, warnings, cleanup, and explicit local-only/no-deploy/manual-gate boundaries.

## Manual acceptance
- Owner: coordinator after independent source and automated review.
- Surface: a new agent-controlled localhost Browser tab only; never the user's existing staging tab.
- Gate: load the deterministic 500-item inventory; filter for an exact deep item; clear/search/scroll and expand the bounded list; exercise equipment flows; verify thumbnail/lazy image loading; observe listener counts; issue a deterministic resource update and confirm Navbar, Inventory, EquippedInventory, Extra, ParamTables, and unrelated sections do not rerender; verify cleanup, fixture restoration, and free ports.
- No deployment or staging observation is part of this developer attempt.

## Developer defaults
- Model: `gpt-5.6-sol`.
- Reasoning: `high`.
- User override: explicit Sol High.

## Step state
- Step 5: accepted after remediation attempt 2 in `Task 08 Step 5 Home Read and Render` (`01a05428-79f1-7fa3-bd3e-2d8a2c59045f`) with model `gpt-5.6-sol` and reasoning `high`.
- Accepted report: `docs/coordinator/task-08-home-read-render-step-5/reports/step-05-attempt-02.md`.
- Coordinator Browser evidence: `docs/coordinator/task-08-home-read-render-step-5/evidence/step-05-browser-review-attempt-02.md`.
- Verdict: GREEN. All three Attempt-1 Important findings are closed; no Step 5 finding remains. Step 6 requires a separate explicit user instruction and a new developer task.
