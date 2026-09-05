# Task 08 Step 6 — Home resource gesture batching

## Goal
Replace the Home resource controls' repeated 200 ms network writes with pointer-owned optimistic accumulation and exactly one authoritative delta command per completed gesture, while preserving resource behavior, concurrent-client correctness, the accepted Step 5 read/render plane, and all earlier Task 08 contracts.

## Source
- Authoritative Task 08 specification: `docs/performance-improvement-plan/tasks/08-login-character-creation-and-home.md`.
- Measurement contract and local journey: `docs/performance-improvement-plan/task-08/README.md`, `frontend/scripts/performance/task08-contract.js`, and `frontend/performance/tests/browser/task08-baseline.performance.js`.
- Accepted predecessor: `docs/coordinator/task-08-home-read-render-step-5/control.md`, `reports/step-05-attempt-02.md`, and `evidence/step-05-browser-review-attempt-02.md`.

## Starting observation
- The accepted Step 5 local report records a two-second HP hold as `11` command starts, `11` applied mutations, and requested/applied delta `-11/-11`.
- `StatsBars.js` currently starts one network mutation immediately and another every 200 ms for HP, mana, essenza, and barriera through separate mouse/touch handlers.
- The Task 05 `task05UpdateResource` callable already applies `mode: "delta"` inside a Firestore transaction. Step 6 must use that authority rather than committing a client-computed final value.
- Step 5 established one selector-aware Home resource slice and proved that a resource update rerenders StatsBars but not Navbar, Inventory, EquippedInventory, Extra, or ParamTables. Step 6 must retain that isolation.

## Required behavior
1. Use a single Pointer Events lifecycle for the four resource controls. Capture the initiating pointer, reject duplicate or secondary pointers, and finalize an active gesture exactly once on pointer-up, pointer-cancel, or lost capture. A pointer-generated click must not create a second mutation; keyboard activation must remain operable and produce one logical one-step gesture.
2. Preserve the immediate first `+1`/`-1` response and the existing 200 ms repeat cadence as local optimistic accumulation only. No timer callback may call Firebase or `updateResource`. The displayed resource value must reflect the latest accepted Home resource slice plus the active pending delta without causing unrelated Home consumers to rerender.
3. On a normal terminal pointer event, send exactly one `updateResource({ resource, mode: "delta", value: accumulatedDelta, ... })` command for the gesture. The delta must equal the optimistic ticks actually shown. Use one stable logical operation/retry identity for that gesture and never reuse it for a later gesture or actor scope.
4. Fence every gesture, timer, terminal event, and async completion by pointer identity plus the accepted auth UID/repository-generation scope. Actor/generation change or route unmount must clear timers, pointer ownership, and optimistic state without dispatching a stale new command; late success/failure from an earlier scope must not alter the current UI or close current overlays. Duplicate terminal events must be harmless.
5. Reconcile optimistic state without a stale snap or lost concurrent update. A concurrent authoritative resource change must remain visible and the final server mutation must apply the accumulated delta to current server state, not overwrite it with a stale client total. On a definitive command failure, roll back only that gesture's optimistic overlay and preserve the current authoritative snapshot.
6. Preserve resource-specific rules and controls. HP, mana, and essenza keep their existing set/delta behavior. Barriera must remain bounded by the authoritative current/total state under concurrent changes; if this requires a callable guard, add only the smallest transaction-local server validation using stored state. Reset, custom-value, barrier activation/termination, turn metadata, disabled states, titles, formulas, and visual layout remain discrete one-command actions and are not batched.
7. Preserve the accepted Step 5 Home subscription/projection/render contracts and all Login, Character Creation, inventory/equipment, media, consumable, DiceRoller, Task 05, multi-client, and accessibility behavior. Extend Task 08 measurement so the two-second measured hold proves one start, one applied mutation, no pending/failure/duplicate terminal, and requested delta equals applied/authoritative delta.

## Non-goals
- Do not implement Step 7's DiceRoller/consumable refactor or change consumable prepare/commit behavior.
- Do not refactor the accepted Home read plane, inventory window/search/media flow, Login, or Character Creation except for narrowly necessary compatibility tests.
- Do not change Firebase rules, schemas, indexes, regions, deployment configuration, or remote data.
- Do not add dependencies, introduce background network batching beyond one active resource gesture, or accept a client-computed final value as authority.
- Do not rewrite Steps 1–5 evidence as if it were rerun; append a clearly labeled Step 6 section.

## Development workspace
- Decision: existing checkout.
- Exact path: `C:\Users\Marco\OneDrive\git_projects\fnd-devs`.
- Branch/ref: `devs` (`devs...origin/devs [ahead 1]`).
- Baseline SHA: `9c7fcc7c5799a458768512b7cbab49e4d9b301a9`.
- Accepted pre-Step-6 tracked-diff fingerprint: `336ce85a851c3599f81693b39b891a08a5522391b239aaaa025041830cd5358d`.
- Accepted pre-Step-6 source-tree fingerprint: `6e0b768fdb868721ebba8ee6c264d1d8398981ca4a2f48787d722dd690fb0d86`.
- User-owned dirty state: the complete accepted, uncommitted Steps 2–5 implementation, tests, Task 08 README, and coordinator artifacts. Preserve every tracked and untracked file; Step 6 work and its report must be additive.

## Authorization envelope
- Local Step 6 edits, tests, builds, deterministic fixtures, and loopback emulator/browser harnesses are allowed only in the exact `fnd-devs` checkout.
- Local Firebase work must use project `demo-fnd-perf`; fixture mutation is allowed only through the deterministic harness and must be restored and verified before completion.
- The user's existing `https://fatin-test.web.app` Browser tab is out of scope and must not be navigated, inspected, or reused.
- Commit, push, merge, pull request, deployment, remote Firebase reads/writes, accepted-baseline mutation, dependency upgrades, and worktree-topology changes are not authorized.
- Do not reset, stash, clean, discard, delete user-owned files, rewrite history, or run raw `firebase deploy`.

## Test-first development and automated acceptance
1. Read the source and predecessor artifacts listed above, repository instructions if present, `StatsBars.js` and its tests, the Home resource selector/store, the Task 05 command client/callable and tests, Task 08 instrumentation/contracts, and both Home/two-client browser scenarios before editing.
2. Add focused RED tests first and record the exact failing commands, test names/counts, and failure reasons. At minimum prove:
   - a short pointer activation shows one optimistic tick, makes no command before termination, and commits one delta command on release;
   - a two-second fake-timer hold shows every local tick but commits one command with their exact accumulated delta;
   - pointer-cancel, touch/pen pointer input, lost capture, and duplicate terminal events finalize at most once;
   - pointer capture, secondary pointers, actor/generation change, and unmount cannot leak timers or dispatch stale work;
   - keyboard activation remains accessible and cannot double-fire with pointer click synthesis;
   - authoritative updates during an active/in-flight gesture are combined with the pending delta rather than overwritten, and a rejected command rolls back cleanly;
   - barrier floor/ceiling and concurrent server-state behavior remain authoritative, while discrete reset/custom/activation actions retain their payloads;
   - a resource publication still rerenders only StatsBars among the six measured Home consumers.
3. Implement the smallest cohesive gesture controller/hook/helper plus StatsBars integration. Keep timer ownership centralized and terminal finalization idempotent. Do not solve correctness with arbitrary post-command sleeps.
4. Extend the Task 08 contract/browser evidence so the Home hold asserts `commandCount === 1`, `appliedCount === 1`, zero failures/pending/duplicate terminals, and exact requested/applied/authoritative delta agreement. Make the two-client resource scenario overlap a gesture with a concurrent client delta, then prove both clients converge without lost updates.
5. Run focused StatsBars/gesture/command/callable/contract tests, a combined relevant Home run, and the full React suite. If Functions change, compile them and run the focused callable emulator coverage. Report exact suites/tests, skips, warnings, and environment-only reruns separately.
6. Run the deterministic Task 08 Node contracts, `npm.cmd --prefix frontend run perf:test`, the local Task 08 behavior gate with Browser skipped, and the full `npm.cmd --prefix frontend run perf:task08` Chromium journey. The final report must remain `officialBaseline=false`.
7. Build the normal staging target locally without deploying: set `FND_GIT_BRANCH=devs`, run `build:staging`, `verify:staging-build`, and `perf:verify-disabled` while that normal build remains present. Only then run the opt-in performance build/preflight needed by the local Task 08 harness.
8. Run `git diff --check`. Restore and independently verify the deterministic fixture at `9,139` documents with hash `fbabc02a3376d466cf717e3886e0d12a9e15568c17b654322cff4909dc6eaca8`; remove only task-owned generated config/markers; leave ports `3000,3001,4000,4400,4500,5000,5001,5002,8080,9099,9150,9199` and any harness ports free.
9. Append a Step 6 section to `docs/performance-improvement-plan/task-08/README.md` with RED/green evidence, source/build identities, one-gesture mutation metrics, optimistic/pointer/concurrency results, warnings, cleanup, and explicit local-only/no-deploy/manual-gate boundaries.

## Manual acceptance
- Owner: coordinator after independent source and automated review.
- Surface: a new agent-controlled localhost Browser tab only; never the user's existing staging tab.
- Gate: verify mouse and touch-equivalent short activation, a two-second hold with responsive optimistic ticks and one server mutation, cancellation/lost-capture cleanup, barrier bounds, an overlapping second-client update with convergence, unchanged Home render isolation, error-free cleanup, fixture restoration, and free ports.

## Developer defaults
- Model: `gpt-5.6-terra`.
- Reasoning: `high`.
- Execution speed: standard/default.
- User override: explicit Terra High with standard speed.

## Step state
- Step 5 is accepted GREEN in `Task 08 Step 5 Home Read and Render` (`01a05428-79f1-7fa3-bd3e-2d8a2c59045f`).
- Step 6 is active in `Task 08 Step 6 Resource Gesture Batching` (`01a05751-fb94-7060-8946-a0c092ca0261`) with Terra High at standard/default speed and must stop after its implementation report/callback. Step 7 must not begin.
