# Coordinator control — task08-home-step5-c07137fad080

- Coordinator task title: `Coordinator - Task 08`
- Coordinator thread ID: `01a047ff-5aee-7c22-8ec8-d74c7ade949d`
- Project ID/path: `local-3800f17496f5c93e49da280e2e23eb95` / `C:\Users\Marco\OneDrive\git_projects\fnd-devs`
- Current step: 5
- Phase: accepted
- Pause latch: clear
- Pending outbound action: none; Step 5 accepted, awaiting explicit user direction before any Step 6 dispatch
- Developer baseline: `gpt-5.6-sol` / `high`
- Current escalation tier: explicit user model override
- Non-progress counter: 0

## Workspace baseline
- Decision: existing checkout.
- Branch/ref: `devs` (`devs...origin/devs [ahead 1]`).
- Baseline SHA: `9c7fcc7c5799a458768512b7cbab49e4d9b301a9`.
- Accepted pre-Step-5 tracked-diff fingerprint: `2ac90fa777a5a5b0db7d2f8578ffd79f2c7f757569d3c29ab2d545c09b1bd932`.
- Accepted Step-4 source-tree fingerprint: `e9d7a650c770dbc1ce11f737d46d1657916e7a6be08b0347d2e373687449ed66`.
- Dirty-state policy: preserve the complete accepted, uncommitted Step 2–4 state and every coordinator artifact. Step 5 changes must be additive. No reset, stash, clean, discard, commit, push, deploy, dependency upgrade, or worktree-topology change is authorized.

## Task registry
### Step 5 / attempt 1
- Developer task ID and title: `01a05428-79f1-7fa3-bd3e-2d8a2c59045f` / `Task 08 Step 5 Home Read and Render`
- Host/client task ID when applicable: `local` / `01a05428-79f1-7fa3-bd3e-2d8a2c59045f`
- Callback token: `f56f376c-df10-4a87-99d5-b60b6e0316fc`
- Baseline SHA and dirty-state fingerprint: SHA `9c7fcc7c5799a458768512b7cbab49e4d9b301a9`; tracked `2ac90fa777a5a5b0db7d2f8578ffd79f2c7f757569d3c29ab2d545c09b1bd932`; accepted Step-4 source `e9d7a650c770dbc1ce11f737d46d1657916e7a6be08b0347d2e373687449ed66`.
- Report path: `docs/coordinator/task-08-home-read-render-step-5/reports/step-05-attempt-01.md`
- Status: callback payload authenticated from the user-referenced developer task after direct delivery was blocked by the app; independent review completed
- Review verdict: RED — three Important findings
- Automated evidence: current SHA and final fingerprints match the report. Fresh focused React verification passed `11/11` suites and `55/55` tests; the Task 08 Node contract passed `10/10`; `git diff --check` exited `0` with only existing line-ending warnings. These green tests do not cover the three source-level regressions below.
- Manual evidence: not reached because the source/spec gate is red. The user's existing `fatin-test.web.app` tab was not touched.
- Findings still open:
  1. Important — bounded inventory state is keyed only by the last expanded query. After expanding an unfiltered list to 120 or 500, entering a filter temporarily derives the initial 60-row limit, but clearing the filter makes `windowState.query === deferredQ` again and restores the old expanded count without a new user expansion. The same stale count can reappear after a data shrink/growth cycle. This violates the explicit query/data reset contract and can silently remount all 500 rows.
  2. Important — Home render telemetry has two owners for the same component ID. `PerformanceProfiler` now emits a committed probe for its wrapper while Navbar and every measured Home child emit another committed probe under the same ID; parent-driven commits are therefore counted twice (and a React Profiler event may add a third source). The focused test asserts only that an event exists and its “stable wrapper” rerender actually rerenders the wrapper. Task 08 `home.render.*` and resource-window evidence must consume exactly one authoritative committed event per component commit without breaking wrapper-only Login/route/grigliata metrics.
  3. Important — Inventory selects `resources.stats.gold` as a scalar, but the compatibility fallback still reads `resourcesGold?.stats?.gold`. A legacy numeric string such as `"100"`, which the previous code parsed correctly, now renders as `0`. Preserve numeric and numeric-string balances and add a component regression.

### Step 5 / attempt 2
- Developer task ID and title: `01a05428-79f1-7fa3-bd3e-2d8a2c59045f` / `Task 08 Step 5 Home Read and Render`
- Host/client task ID when applicable: `local` / `01a05428-79f1-7fa3-bd3e-2d8a2c59045f`
- Callback token: `4ce23a09-2a5f-4b13-b302-ebea4f7b7f4a`
- Baseline/current SHA before remediation: `9c7fcc7c5799a458768512b7cbab49e4d9b301a9`
- Starting tracked/source fingerprints: tracked `58f951f992b356ca8556873c79ee552b1448f68df54f3966be8feeebb6d586fc`; source `365bbf928249717a902d290e40cd77d421654c034c65321c574e6135482b60c3`.
- Report path: `docs/coordinator/task-08-home-read-render-step-5/reports/step-05-attempt-02.md`
- Status: matching Attempt-2 payload/report authenticated from the user-referenced developer task after direct callback delivery was blocked; independent review complete
- Review verdict: GREEN — all three Attempt-1 Important findings are closed and Step 5 is accepted
- Automated evidence: source inspection confirmed query/data-owned inventory windows, selector-shaped numeric-string gold handling, and single authoritative committed render ownership. Fresh focused React passed `4/4` suites and `21/21` tests; the Task 08 Node contract passed `11/11`; full React passed `156/156` suites and `1,442/1,442` tests. `perf:test` reproduced only four sandbox config-store `EPERM` failures (`419/423`) and the exact host-permission rerun passed `423/423`. The local Task 08 report was independently parsed as complete with run ID `8409d721-e7c6-41b6-a476-95ead66d4854`, compact targets/opens `6/7`, resource-window renders `0/11/0/0/0/0`, inventory `500/60/1/60/120`, and consumable `1/1/committed`.
- Manual evidence: PASS in a new agent-owned `http://127.0.0.1:5000/` tab. Inventory observed `60 -> 120 -> 1 -> 60 -> 120` with `380 remaining`; equipment item details and the main-hand chooser remained usable; all 120 mounted images were lazy (`9` loaded, `111` deferred); one local HP update reached `44/50` while the 120-row inventory and unrelated sections remained stable; Browser warnings/errors were `0`. The staging tab was not claimed or navigated. Full evidence: `docs/coordinator/task-08-home-read-render-step-5/evidence/step-05-browser-review-attempt-02.md`.
- Cleanup evidence: the deterministic fixture was cleanly reseeded and independently verified at `9,139` documents/hash `fbabc02a3376d466cf717e3886e0d12a9e15568c17b654322cff4909dc6eaca8`; all task ports were free in two consecutive checks; generated config/marker were absent; HEAD and final fingerprints remained `9c7fcc7c5799a458768512b7cbab49e4d9b301a9`, tracked `336ce85a851c3599f81693b39b891a08a5522391b239aaaa025041830cd5358d`, source `6e0b768fdb868721ebba8ee6c264d1d8398981ca4a2f48787d722dd690fb0d86`.
- Findings still open: none for Step 5

## Callback contract
Attempt 2 was authenticated from the user-referenced developer task using control ID `task08-home-step5-c07137fad080`, callback token `4ce23a09-2a5f-4b13-b302-ebea4f7b7f4a`, step `5`, attempt `2`, the matching developer task/report path, and unchanged baseline/current SHA. Callback receipt was intake only; the green verdict above comes from independent source, automated, Browser, and cleanup review.

## Authorization envelope
- Local Step 5 edits/tests/builds and deterministic loopback emulator/browser harnesses in `fnd-devs`: allowed.
- Commit/push/merge/PR/deploy/remote Firebase reads or writes/baseline acceptance/dependency upgrades: forbidden.
- Destructive Git/filesystem operations, user-change cleanup, and worktree changes: forbidden.
- The user's open `fatin-test.web.app` Browser tab: out of scope.

## Resume instruction
Step 5 is accepted. Do not continue this developer task or start Step 6 automatically. Await explicit user direction; if Step 6 is requested, create a new developer task only after recording its own callback token and authorization envelope.
