# Task 08 Step 6 — terminal fallback acceptance

## Goal
Independently determine whether Step 6 Attempt 16 closes the Firebase emulator supervisor terminal-fallback liveness race without introducing a Critical or Important regression, and iterate through a separate implementation subagent only when review is red.

## Source
- Step contract: `docs/coordinator/task-08-resource-gesture-step-6/plan.md`.
- Prior coordinator state: `docs/coordinator/task-08-resource-gesture-step-6/control.md`.
- Attempt under review: `docs/coordinator/task-08-resource-gesture-step-6/reports/step-06-attempt-16.md`.
- Predecessor defect evidence: `docs/coordinator/task-08-resource-gesture-step-6/evidence/step-06-source-review-attempt-15.md` and `reports/step-06-attempt-15.md`.

## Non-goals
- No Step 7 work or unrelated Task 08 refactor.
- No deployment, remote Firebase access, live-data mutation, commit, push, merge, pull request, dependency change, or worktree-topology change.
- Do not touch or use the user's open `https://fatin-test.web.app` Browser tab.

## Development workspace
- Decision: existing checkout, explicitly selected by the user earlier in this Task 08 journey and reaffirmed by asking to continue the last `fnd-devs` attempt.
- Path: `C:\Users\Marco\OneDrive\git_projects\fnd-devs`.
- Branch/ref: `devs`, ahead of `origin/devs` by one commit and behind by zero.
- Baseline SHA: `9c7fcc7c5799a458768512b7cbab49e4d9b301a9`.
- Protected dirty state: all accumulated uncommitted Task 08 source, tests, coordinator artifacts, and reports recorded in `protected-dirty-state.md`.

## Authorization envelope
- Local inspection and read-only review — authorized actors: coordinator and Sol Max reviewer subagent.
- Local tests/builds and task-owned loopback fixtures — authorized actors: reviewer and, only after a red verdict, Sol High implementation subagent. Each may terminate only processes it created and still exactly owns.
- Local source/test edits — authorized actor: Sol High implementation subagent only after a red review. Reviewer may write only its assigned report.
- Commit, push, merge, PR, deployment, remote Firebase reads/writes, live data, dependency upgrades, resets, stashes, cleans, history rewrites, arbitrary process termination, and worktree changes — not authorized.

## Subagent policy
- Execution mode: same-session subagents, serialized against this checkout.
- Reviewer: `gpt-5.6-sol` / `max`, user-locked.
- Implementer when required: `gpt-5.6-sol` / `high`, user-locked.
- Loop: reviewer verdict; if red, implementer fixes consolidated blocking findings; the same reviewer re-reviews; repeat while material progress continues and until green.
- Neither subagent may spawn child agents.

## Steps
### Step 1 — Validate Attempt 16 and remediate only blocking findings
- Outcome: no Critical or Important defect or spec gap remains in the terminal-fallback lifecycle, and fresh focused evidence demonstrates the original no-other-reference race is closed.
- Depends on: Step 6 Attempt 16 report and preserved Attempt 12 product/manual evidence.
- Automated acceptance: source/caller audit; real event-loop liveness reproduction; exact-root Windows/POSIX routing and failure semantics; focused supervisor suite; relevant harness matrix; proportional broader Task 08 performance verification; diff and process/port cleanup checks.
- Manual acceptance: no new Browser gate is required for a harness-only change if review proves no product files changed after the already-recorded Attempt 12 Browser gate. The user's staging tab remains untouched.
- State: accepted GREEN.

## Completion evidence
- Sol Max independent re-review: GREEN with no Critical or Important findings; syntax `4/4`, adversarial assertions `6/6`, focused supervisor `32/32`, relevant matrix `112/112`, and `perf:test` `484/484`.
- Coordinator-owned fresh verification: syntax `4/4`, relevant matrix `112/112`, `perf:test` `484/484`, staging-build verification and performance-disabled verification passed, `git diff --check` passed, code fingerprint `00e0a97306b3a769fe7c4bb1b241f845016a050a005c31fca899a6ea4c59f44f`, no matching owned process/artifact, and all twelve Task 08 ports free in two samples.
- Attempt 12 Browser evidence remains applicable because the accepted remediation changed only three lifecycle-harness files under `frontend/scripts/performance`; the staging Browser tab was not touched.
