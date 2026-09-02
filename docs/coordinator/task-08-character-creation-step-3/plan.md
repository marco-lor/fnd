# Task 08 Step 3 — Character Creation loading, navigation, and media

## Goal
Make Character Creation load its shared read-only data once, reuse it across step revisits, serialize step navigation, consume the authenticated profile through one authoritative shell subscription, and keep avatar preview/media ownership leak-free without changing mutation semantics.

## Source
The user-approved Task 08 macro sequence in the `Coordinator - Task 08` task, with the measurement and regression authority in `docs/performance-improvement-plan/task-08/README.md` and `frontend/scripts/performance/task08-contract.js`.

## Non-goals
- Do not redesign or optimize the authoritative race, Anima, point-allocation, or character-completion mutations; those belong to Step 4.
- Do not change Home, consumable, dice, inventory, or two-client behavior.
- Do not weaken Task 02 repository actor scoping, Task 04 shared repository/cache authority, Task 05 callable/durable-operation semantics, or Task 07 media ownership and receipts.
- Do not commit, push, merge, create a PR, deploy, access staging/live data, or discard existing changes.

## Development workspace
- Decision: existing-checkout
- Path: `C:\Users\Marco\OneDrive\git_projects\fnd-devs`
- Branch/ref: `devs`
- Baseline SHA: `9c7fcc7c5799a458768512b7cbab49e4d9b301a9`
- User-owned dirty state: accepted Step 2 changes are intentionally uncommitted. Their pre-coordination tracked-diff fingerprint is `c867b6f4a56549c9df3f016124ff169c82b9ec341e7048e142e47cc52d5c33eb`; preserve every listed tracked and untracked file. Coordinator artifacts under this directory are expected additions.

## Authorization envelope
- Local edits/tests/builds: allowed only in the existing `fnd-devs` checkout and only for Step 3 plus its coordinator report/evidence.
- Localhost/emulators: allowed only on loopback and only with the `demo-fnd-perf` performance project/fixtures; verify cleanup and free ports afterward.
- Existing development environment inspection: read-only inspection of local source, build output, and deterministic emulator fixtures is allowed; remote `fatin-test` inspection is not part of this step.
- Commit: not authorized.
- Push/merge/PR: not authorized.
- Deploy targets and procedure: no deployment is authorized, including `fatin-test`; never run raw `firebase deploy`.
- Live data: forbidden, including production and staging Firestore/Auth/Storage mutations.
- Destructive operations and recovery: forbidden; do not reset, stash, clean, discard, rewrite history, delete user-owned files, or alter another worktree.

## Developer defaults
- Model: gpt-5.6-luna
- Reasoning: max
- User override: none

## Steps
### Step 3 — Character Creation loading, navigation, and media
- Outcome: Character Creation begins one shared, parallel read-only load for Codex and required configuration, reuses fulfilled data on revisits, exposes deterministic loading/error/retry behavior, prevents duplicate forward/back transitions while work is pending, uses the existing authoritative profile shell without another profile subscription, and balances every avatar object URL and Task 07 operation lease across select/replace/remove/cancel/unmount paths.
- Depends on: accepted Task 08 Steps 1 and 2; Task 02 actor/session scoping; Task 04 repositories; Task 05 Character Creation commands; Task 07 media ownership; the current Step 1 regression and measurement contract.
- Automated acceptance: new RED-first focused tests cover parallel single-flight loading/cache/retry, revisit reuse, partial legacy profile handling, transition serialization, and media cleanup; existing Character Creation, repository, Auth, Task 07 media, Task 08 contract/behavior, broader React, and local staging-build gates remain green in proportion to scope; no Step 4 command behavior changes.
- Manual acceptance: Browser
- State: accepted on 2026-08-30 after independent source review, fresh focused/full/performance gates, and the localhost Browser gate
