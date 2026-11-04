# Task 15B Implementation Plan

> The controller assigns implementation and independent review separately. The developer does not spawn subagents. Steps use checkbox syntax for tracking.

**Goal:** Share one NPC source between Echi maps and sidebar without changing user workflows.

**Architecture:** A small NPC repository uses `subscribeShared`/`applyDocChanges` from the existing runtime. A route-owned hook binds the subscription to UID and repository access generation, and supplies raw ordered rows, ID lookup, loading and error state to both consumers.

**Tech Stack:** React 18, JavaScript, Firebase Firestore, existing Jest/Testing Library and performance instrumentation.

**Spec:** `docs/superpowers/specs/2026-11-02-task15b-npc-source-design.md` and `/workspace/task15b-verification.md` (Astra verification, must be read before implementation).

## Global Constraints

- Work first on `devs`; Sol 6.1 xhigh developer and reviewer. At most four attempts per review loop, then escalate unresolved material issues to the user.
- One full-collection NPC listener per mounted authenticated route; zero after cleanup. No truncating limit.
- Preserve raw editor fields, authoritative document IDs, all map lookup records, existing sidebar timestamp ordering and all current authorization/media/hover/drag/drop/delete behavior.
- Bind lifecycle to UID and `repositoryAccessGeneration`; do not show stale data on auth/access changes.
- Only worthwhile concrete fixes; no 15A/15C redesign or backend/rule/data changes.
- Latest user scope: code for `fatin-test`, local/emulator tests and guarded staging build only. No deployment, browser control or production work. Open/review the PR and wait for merging.

## Review Focus

- A legacy NPC without `createdAt` still resolves on a map without appearing in the timestamp-ordered sidebar.
- Pending/null timestamps and timestamp ties preserve sidebar ordering without altering raw editor text.
- Same UID with a new access generation releases the old subscription and resets both consumers.
- A late snapshot/error after unmount, logout or account change cannot repopulate state.
- A mounted real sidebar and page share updates and one listener, including StrictMode and route re-entry.

### Task 1: repository and shared route ownership

**Files:** Create `frontend/src/data/echiNpcsRepository.js`, `frontend/src/data/useEchiNpcs.js` and meaningful repository/hook/integration tests. Modify `frontend/src/components/echiDiViaggio/EchiDiViaggio.js`, `NpcSidebar.js`, their existing tests, `frontend/src/data/query-contracts.json`, and the task 15 document's 15B wording as needed. Add concise local evidence under `docs/coordinator/task-15b-npc-source/`.

**Interfaces:** `subscribeEchiNpcs(observer)` delivers a shared projection with raw records by ID and compatible sidebar items. `useEchiNpcs()` owns loading/error and scope reset using `useAuthSession`. The page passes `npcs`, `npcLoading`, `npcError` to `NpcSidebar`; the sidebar no longer subscribes. Refine exact projection naming in the implementation and keep callers consistent.

- [x] Write a real page/sidebar regression test first; capture the pre-change two-listener result and expected failure for the one-listener gate. Use the same 500-NPC/2,000-marker fixture for after measurement.
- [x] Add focused tests for the five Review Focus cases, incremental added/modified/removed snapshots and reference preservation. Avoid timing benchmarks and duplicate generic runtime tests.
- [x] Implement the repository, route hook and prop wiring. Keep mutation/media/hover implementation intact. Remove obsolete component listener imports/state/effects and update the source registry.
- [x] Run the focused Echi/repository/hook/integration suites and relevant import/query-contract/media checks. Run the full frontend suite once, a guarded staging build, and record exact commands/results and limitations.
- [x] Self-review and commit the complete implementation on `devs`. Write developer report outside tracked source and send it to the controller for independent task review.

### Task 2: PR review and monitoring

**Owner:** Controller after Task 1 and final whole-branch review pass.

- [ ] Push reviewed `devs` and open a `devs` to `main` PR with the actual local evidence and limitations.
- [ ] Complete independent review, fix worthwhile issues with at most four attempts per loop, then monitor PR checks/comments.
- [ ] Leave the PR unmerged and wait. No staging deployment, browser control/acceptance, production promotion or live edits are in the current user scope.
