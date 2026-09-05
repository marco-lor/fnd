# Task 08 Step 4 — Character Creation authoritative mutations

## Goal
Ensure every logical Character Creation mutation has one current owner, one intentional callable invocation, and one accurately measured applied result: unchanged step revisits must not rewrite race or Anima state; deliberate selection changes and point changes must remain distinct actions; uncertain retries must reuse only the exact logical action identity; and completion/media retries must not duplicate submission, upload, or finalization work.

## Source
The user-approved Task 08 macro sequence in the `Coordinator - Task 08` task, continued by the user's 2026-08-30 instruction. Measurement and regression authority remain `docs/performance-improvement-plan/task-08/README.md`, `frontend/scripts/performance/task08-contract.js`, the Task 05 architecture and mutation matrix, and the accepted Step 3 coordinator record.

## Starting observation and intended improvement
- The accepted Step 3 browser journey performs one race selection and one Anima selection, then intentionally revisits the Anima step without changing the selection.
- The current measured result is `3` authoritative `task05CharacterCreation` starts and `3` `command-applied` events because advancing after the unchanged revisit sends `selectAnima` again.
- The same journey after Step 4 must record exactly `2` starts and `2` applied results: one successful `selectRace` and one successful `selectAnima`. The intentional revisit remains measured separately, with zero duplicate transitions and zero revisit reads.
- A real changed race or Anima selection after revisiting is a new logical action and must invoke exactly once. It must not be collapsed with an earlier successful action or reuse an ambiguous operation identity belonging to different payload bytes.

## Required behavior
1. Track the last successfully applied race and Anima values per authenticated actor/repository generation. Skip an unchanged forward-step persistence call only when that exact value is known to have succeeded for the current owner. A pending, failed, stale, cancelled, different-actor, or different-generation attempt is not proof of persistence.
2. Preserve the Task 05 server authority and invariants: race selection still atomically resets Base/Combat parameters, available/spent point counters, negative-stat count, and Anima; Anima selection still writes the authoritative shard; completed characters reject further creation changes.
3. Preserve logical-action idempotency. Concurrent duplicate UI events for one action share one in-flight operation. An uncertain transport failure retains and reuses the exact operation ID on an explicit retry of the same immutable request. A definitive callable failure retires that identity. A changed request or a later intentional identical action after success gets a fresh identity.
4. Keep point allocation server-authoritative. Each deliberate plus/minus action applies once, the same-tick/busy guard remains synchronous, controls recover after failure, actor/generation changes fence late UI effects, and the negative-stat, combat-cost, resource-total, and point-cap policies remain unchanged. Durable point intents must classify definitive Task 05 errors so terminal failures do not leave unrecoverable/stale session receipts.
5. Keep completion single-owned. Double submit cannot start a second completion. Uncertain completion retries reuse only the same immutable completion intent; changing the character name/media payload creates a new logical intent without colliding with a retained old operation ID. Late results cannot navigate or mutate a different actor/generation.
6. Preserve Task 07 avatar semantics. An attached or result-unknown media operation must resume without uploading the selected file again; a completion-only retry must not repeat preparation/upload/attachment; legacy fallback cleanup must not delete an object that an ambiguously settled authoritative completion may reference. Keep all Step 3 lease, abort, ownership, replacement, and unmount fences.
7. Keep Task 08 telemetry truthful: one `command-start` per actual callable attempt, `command-applied` only for `replayed === false`, replay success distinct from physical application, and no `command-non-replayed-success` for idempotent Character Creation actions. Do not count a skipped unchanged revisit as a command.

## Non-goals
- Do not redesign Step 3 shared reads, incremental loading, profile authority, navigation serialization, success-banner handling, or object-URL ownership except where a narrow mutation ownership hook is required.
- Do not optimize Home, inventory filtering, resource holds, consumables, dice, or two-client behavior; those belong to later Task 08 work.
- Do not weaken Task 02 actor scoping, Task 04 repository/cache authority, Task 05 validation/transactions/receipts, or Task 07 media durability.
- Do not change Firebase rules, schemas, deployment configuration, regions, or production/staging data.
- Do not accept a new Task 01 performance baseline or rewrite historical Step 1/2/3 evidence. Add clearly labeled Step 4 evidence instead.
- Do not commit, push, merge, create a PR, deploy, inspect/mutate remote Firebase state, or discard existing changes.

## Development workspace
- Decision: existing-checkout
- Exact path: `C:\Users\Marco\OneDrive\git_projects\fnd-devs`
- Branch/ref: `devs` (`devs...origin/devs [ahead 1]` at dispatch)
- Baseline SHA: `9c7fcc7c5799a458768512b7cbab49e4d9b301a9`
- Accepted pre-Step-4 tracked-diff fingerprint: `92682b0ae777d5ebefeb1ec7956f2f6e543da633b111321b917211507ba60d95`
- Accepted pre-Step-4 source-tree fingerprint: `b817fee6a81ebcd40c03e1959ba6a75cf47dbaecc70e10b4e2ef040b231fb21c`
- User-owned dirty state: the complete accepted, uncommitted Step 2 plus Step 3 product/test/documentation state. Preserve every listed tracked and untracked file. Coordinator artifacts in `docs/coordinator/` are additive and must also be preserved.

## Authorization envelope
- Local edits/tests/builds: allowed only in the existing `fnd-devs` checkout and only for Step 4 plus its report/evidence.
- Localhost/emulators: allowed only on loopback with project `demo-fnd-perf` and deterministic fixtures. Disposable local fixture mutations, including local completion paths, are allowed only when the harness restores and verifies the fixture afterward.
- Existing development environment inspection: read-only source/build/fixture inspection is allowed. Do not navigate or inspect the user's open `https://fatin-test.web.app` tab.
- Commit: not authorized.
- Push/merge/PR: not authorized.
- Deploy targets and procedure: no deployment is authorized, including `fatin-test`; never run raw `firebase deploy`.
- Live data: forbidden, including production and staging Firestore/Auth/Storage/Auth mutations or reads for verification.
- Destructive operations and recovery: forbidden; do not reset, stash, clean, discard, rewrite history, delete user-owned files, or alter another worktree.

## Test-first development and automated acceptance
1. Read the accepted Step 3 plan/control/final report, Task 08 README/contract/browser journey, Task 05 architecture/mutation matrix, current Character Creation components, command wrapper, durable intent store, Task 07 avatar orchestration, and callable handlers before editing.
2. Add focused RED tests first and record the exact failing command/test names and failure reason in the report. At minimum prove:
   - unchanged Anima revisit currently issues the third command and becomes exactly two total journey actions after the fix;
   - changing a selection after revisit issues exactly one new command, while stale/pending/different-owner success never marks it applied;
   - rapid duplicate Next/point/submit events invoke once and controls recover after failure;
   - ambiguous versus definitive retry identity, changed-payload separation, and later identical post-success actions;
   - point policy and derived totals are unchanged;
   - completion retry does not duplicate finalization or Task 07 upload, and ambiguous legacy completion cannot create a dangling media reference;
   - actor/repository-generation changes fence every late success/failure/navigation continuation.
3. Implement the smallest cohesive change that makes those contracts green. Prefer existing Task 05/06 durable operation primitives and Task 07 receipts; do not add timers as correctness mechanisms or create a second client-side source of truth.
4. Run focused Character Creation, child control, command-wrapper, durable-intent, Task 07 media, and callable tests; then the relevant combined React/Node/Functions gates and full React suite. Report exact suite/test counts, skips, warnings, and any environment-only rerun separately.
5. Run `npm.cmd --prefix frontend run perf:test`. With the command-scoped JetBrains JDK, run `npm.cmd --prefix frontend run perf:task08:behavior -- --skip-browser` and the local `npm.cmd --prefix frontend run perf:task08` Chromium journey. The Character Creation after observation must be source-matched and show `2/2` authoritative actions/applied writes, `0` non-replayed success, `1` intentional revisit, `0` revisit reads, `0` duplicate transitions, and balanced object URLs.
6. Run the normal staging-target build locally, never deploy: set `FND_GIT_BRANCH=devs`, run `build:staging`, then `verify:staging-build`, then `perf:verify-disabled` while that normal build is still present. Only afterward run `perf:build` and `perf:preflight` for the opt-in local performance build.
7. Run `git diff --check`. Verify the deterministic fixture settles at `9139` documents with hash `fbabc02a3376d466cf717e3886e0d12a9e15568c17b654322cff4909dc6eaca8`, no generated Firebase config remains, and task ports `3000,3001,5000,5001,5002,8080,9099,9150,9199` are free.
8. Append a Step 4 section to the Task 08 README with RED/green evidence, final identities, observed metrics, warnings, and explicit local-only/no-deploy boundaries. Do not alter historical measurements as though they were rerun.

## Manual acceptance
- Owner: coordinator, after independent source/automated review.
- Surface: a new agent-controlled localhost Browser tab only, never the user's existing staging tab.
- Gate: normal and changed-selection revisits, point action/busy recovery, duplicate submit fencing, completion retry/media behavior where a safe deterministic local control exists, visible errors, navigation, cleanup, fixture restoration, and free ports.

## Developer defaults
- Model: `gpt-5.6-luna`
- Reasoning: `max`
- User override: none

## Step state
- Step 4: accepted after developer attempt 2 and independent coordinator source, automated, and localhost Browser review. No remediation, commit, deployment, or next-step dispatch is pending.
