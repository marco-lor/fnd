# Task 08 Steps 7–8 — consumables and integrated closure

## Goal
Complete the final two approved macro steps of Task 08 in the existing `fnd-devs` checkout: first make the consumable/DiceRoller path lifecycle-safe and atomic, then independently close the integrated Login → Character Creation → Home journey with source-matched local evidence. Each step is serialized and separately reviewable.

## Source and accepted predecessors
- Authoritative task specification: `docs/performance-improvement-plan/tasks/08-login-character-creation-and-home.md`.
- Measurement contract and accumulated evidence: `docs/performance-improvement-plan/task-08/README.md` and `frontend/scripts/performance/task08-contract.js`.
- Accepted Step 5: `docs/coordinator/task-08-home-read-render-step-5/control.md`, attempt-2 report, and coordinator Browser evidence.
- Accepted Step 6 product behavior: `docs/coordinator/task-08-resource-gesture-step-6/control.md` and Attempt-12 Browser evidence.
- Accepted Step 6 terminal-fallback review: `docs/coordinator/task-08-step-6-terminal-review/control.md`, revision 11, with code fingerprint `00e0a97306b3a769fe7c4bb1b241f845016a050a005c31fca899a6ea4c59f44f` before this coordinator directory was created.
- Original approved macro decomposition: Step 7 is “Consumables and DiceRoller integration”; Step 8 is “Integrated Task 08 closure.”

## Development workspace
- Decision: the existing permanent checkout explicitly selected by the user for this Task 08 journey.
- Exact path: `C:\Users\Marco\OneDrive\git_projects\fnd-devs`.
- Branch/ref: `devs`, `devs...origin/devs [ahead 1]` at intake.
- Baseline SHA: `9c7fcc7c5799a458768512b7cbab49e4d9b301a9`.
- Protected starting code fingerprint: `eb5efd35f8ad58c51f8bb1f8b462ad67c9e9be8a053349b0e496fb3645b88784`, computed from HEAD, branch, porcelain-v2 state, staged/unstaged binary diffs, and content hashes of every untracked file while excluding only this new coordinator directory.
- The complete existing Task 08 dirty tree is user-owned and must be preserved. Step 7 and Step 8 changes are additive.

## Authorization envelope
- Allowed: local inspection, source/test/documentation edits required by the active step, deterministic `demo-fnd-perf` fixture work, local builds, loopback emulators, and task-owned localhost Browser preparation in the exact `fnd-devs` checkout.
- Process cleanup is allowed only for an exact process tree created and still owned by the active test/harness run. Do not adopt, signal, or terminate unrelated processes.
- Not authorized: commit, push, merge, pull request, deployment, remote Firebase reads/writes, staging/live data mutation, dependency upgrades, reset, stash, clean, discard, history rewrite, worktree/branch changes, or deletion of historical temp directories.
- Never inspect, navigate, refresh, or reuse the user's existing `https://fatin-test.web.app` Browser tab. Any coordinator manual gate must use a new agent-owned localhost tab.
- The original Step 8 macro includes a staging release, but this run stops at a locally verified deploy-ready candidate because no deployment authorization was given.

## Developer policy
- Execution: same-session developer subagents, one mutation-capable developer at a time.
- Locked model/reasoning for every developer attempt: `gpt-5.6-sol` / `high`, per the user's explicit override.
- No child agents. No silent model or reasoning substitution.
- Test first: reproduce a meaningful RED contract before implementation and record the exact command, count, and failure.
- Every attempt must read the current `control.md`, verify the dispatch token/revision/fingerprint, update its assigned report only, and return the exact `COORDINATOR_RESULT` block.
- A callback/result is intake, not acceptance. The coordinator independently audits source, Git state, fresh tests, artifacts, processes/ports, and any required Browser gate.
- Remediation stays at Sol High. After three consecutive non-progressing attempts for the same finding at the locked pair, stop and ask the user rather than substituting another model.

## Step 7 — Consumables and DiceRoller integration

### Outcome
Render consumable dice animation inside the existing Home React tree and preserve authoritative server-prepared rolls. After the animation, commit exactly one authoritative prepare/commit operation whose server transaction applies the prepared result against current server state and atomically decrements/removes the inventory item, updates history, and clears an equipped slot when required.

### Required behavior
1. Remove the imperative `createRoot(document.body)` consumable overlay path. Home/EquippedInventory owns declarative DiceRoller state in the existing provider/tree; no detached root or orphan host may remain.
2. Keep the current visual formula and final server-prepared rolls. The animation is presentational and must not decide the committed stat value.
3. Never use a stale pre-animation client read as the final resource base. `task05CommitConsumable` remains the authoritative current-state transaction and enforces caps, quantity/removal, inventory history, and equipped-slot cleanup atomically.
4. Define one action owner keyed by authenticated actor, stable inventory instance, resource mode, Home repository generation, and action/operation identity. Rapid confirm/double click starts no duplicate preparation or commit.
5. Define cancellation and unmount semantics explicitly. Closing before an allowed commit point, route unmount, actor loss/change, inventory identity replacement, or repository-generation change must fence all late UI work and must not commit accidentally. Once an authoritative commit has been dispatched, cancellation must not lie about outcome; reconcile through the shared read plane and expose deterministic retry/error state.
6. Reuse the same preparation/commit operation identities only for the same logical retry. Definitive failures clear ownership; ambiguous/retryable failures retain the exact pending preparation and do not reroll or consume twice.
7. Preserve HP and mana semantics, no-regeneration consumption, Bonus Creazione, anima dice selection, dice logging behavior, caps, inventory history, last-item removal, equipped-slot clearing, multi-client visibility, Task 05 callable authority, and all accepted Steps 2–6 behavior.
8. Do not perform the remaining integrated closure or deployment in this step.

### Automated acceptance
- Focused RED/GREEN tests cover declarative in-tree rendering; server-prepared rolls; delayed animation followed by current-state atomic commit; no partial stat/quantity outcome; last-item/equipped-slot cleanup; no-regeneration use; rapid confirm; retry with stable identities; definitive failure; close-before-commit; unmount/actor/generation replacement; and late completion fencing.
- Callable emulator tests prove concurrent second-client resource changes are incorporated from current state, prepare/commit replay is idempotent, and both clients converge with no partial outcome.
- Task 08 metrics distinguish prepare starts, commit starts, terminal/applied/replayed outcomes, cancellation, and atomic convergence without inventing physical writes.
- Run focused React/data/callable suites, the relevant Task 08 matrix, full React suite, Functions build, `perf:test`, the local Task 08 behavior gate, and the full local Task 08 Chromium journey.
- Run the normal `devs` staging build and verify it with performance disabled, then the opt-in local performance build/preflight as required by the harness.
- `git diff --check`; fixture restored to 9,139 documents with hash `fbabc02a3376d466cf717e3886e0d12a9e15568c17b654322cff4909dc6eaca8`; generated config/markers absent; all task ports free in two samples.
- Append a clearly labeled Step 7 section to the Task 08 README with source/build identity, RED/GREEN commands and exact counts, observed values versus targets, skips/warnings, cleanup, and explicit local-only/no-deploy boundaries.

### Manual acceptance
Coordinator-owned, after independent automated/source review, in a new localhost Browser tab. Exercise HP, mana, and no-regeneration consumables; close/cancel; delayed animation with a concurrent second-client update; retry; last-item removal; equipped-slot clearing; and rapid repeated confirmation. Verify one preparation/one commit per logical action, current-state convergence, no detached overlay/root, no console errors, fixture restoration, and free ports.

### State
In progress: developer attempt 1 is ready to dispatch after the coordinator manifest/control files are persisted.

## Step 8 — Integrated Task 08 closure

### Depends on
Step 7 accepted GREEN, including its coordinator-owned manual gate and clean process/fixture handoff.

### Outcome
Produce a source-matched, locally verified deploy-ready Task 08 candidate and closure record across Login, Character Creation, Home reads/rendering, resource gestures, consumables, and two-client convergence. Repair only genuine Task 08 regressions found by the final integrated gate; do not broaden scope.

### Required behavior
1. Audit the final integrated tree against every Task 08 implementation bullet, boundary, test requirement, and acceptance gate. Confirm the accepted Step 2–7 contracts remain present and compatible.
2. Close the remaining duplicate Home config-read edge: consumers, including the consumable confirmation preview, must reuse the Home-owned `utils/varie`/schema slice rather than issue their own `getVarie`/`getSchema` reads. Preserve deterministic loading/error/retry and actor/generation ownership.
3. Run and source-match the complete automated journey and before/after measurement contract. Do not relabel historical Step 1 values as freshly observed; record a distinct final integrated observation.
4. Verify the four task acceptance gates: no duplicate compact player-domain target; one server mutation per resource gesture; one authoritative race-confirm write after cached configuration; and zero unrelated Home-section rerenders for a resource update.
5. Verify all explicit regression boundaries: formulas/caps, race reset, negative-stat/point policy, inventory history, dice semantics, media durability, direct navigation, error/retry behavior, multi-client visibility, cancellation/unmount, and Task 05 command authority.
6. Append a final Step 8 closure section and machine-readable evidence with exact source/build fingerprints, measurements, warnings/skips, cleanup, and deployment boundary. Do not deploy, commit, or mutate staging/live state.

### Automated acceptance
- RED/GREEN focused coverage for removal of the last duplicate consumable config read and its loading/error/generation behavior.
- All Step 2–7 focused/relevant suites, full React suite, Functions build, all Task 08 Node/contract/callable behavior gates, `perf:test`, local `perf:task08`, staging-build verification, disabled-build verification, opt-in performance preflight, and report-integrity checks.
- Final report is complete and source/build matched. Values are labeled observed versus target; any official-baseline flag remains truthful.
- `git diff --check`; fixture exactly 9,139 documents/hash `fbabc02a3376d466cf717e3886e0d12a9e15568c17b654322cff4909dc6eaca8`; generated config/markers absent; no owned live processes/artifacts; all task ports free twice.

### Manual acceptance
Coordinator-owned in a new localhost Browser tab. Perform the complete Login → Character Creation → Home journey, exercise a resource gesture and consumable, verify the 500-item inventory/Task 07 media path, and confirm two-client resource/consumable convergence plus console/network health. Staging deployment, live asset identity, and live rollback readiness remain explicitly unverified until separately authorized.

### State
Pending; dispatch only after Step 7 is independently accepted.

