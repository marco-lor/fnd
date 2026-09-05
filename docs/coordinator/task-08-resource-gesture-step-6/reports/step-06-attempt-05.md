# Task 08 Step 6 — attempt 05 recovery

## Status and boundaries

**DONE_WITH_CONCERNS.** This is local-only work in
`C:\Users\Marco\OneDrive\git_projects\fnd-devs`; no commit, push, merge, PR,
deployment, remote Firebase access, baseline acceptance, dependency change,
worktree change, reset/stash/clean, or manual Browser/staging-tab action occurred.

- Branch / HEAD: `devs` / `9c7fcc7c5799a458768512b7cbab49e4d9b301a9`.
- Start fingerprints: tracked
  `34f96ea65d75baac1a1d65e023c810cee4cc183b3eeee781ba32c8ef1f8530f6`;
  source `31a584006bf0a14eb644536c13cd351273ab90783bf5bdf0b737f318ce130084`.
- Final fingerprints: tracked
  `ee9b005e28d6dcb4311030d6ecdb7d4a1e5ff0ba194689dbabe30c9006a3ea76`;
  source `6ba2230dd2f7e78dfbde78b251b00e4009a990a9f077458a4baffb8c47a9c07c`.
- Worktree topology was verified as the existing `fnd` main checkout plus this
  `fnd-devs` checkout; all pre-existing dirty and untracked files were retained.

## Changes

- `StatsBars`: unresolved ambiguous holds retain frozen truth, block new pointer
  and keyboard mutations, and preserve the same retry operation ID; terminal
  handlers fence on scope/readiness/lifecycle generation. Cancellation clears
  ownership before releasing pointer capture. The gesture captures one hold ID
  at start, clamps barrier delta before terminal evidence, and forwards that
  hold/local sequence without putting test metadata in the callable payload.
- `userDataCommands`: task-only hold/local sequence metadata is correlated in
  telemetry and callable applications record actual `appliedDelta`, `newValue`,
  and `newRevision`.
- Task 08 contract: requires exactly one terminal, command, and application for
  a hold; terminal resource/delta/local sequence must match its command and
  authoritative settlement uses actual applied delta.
- Browser scenario: client A now starts a real UI hold while client B overlaps a
  delta mutation; it asserts correlated one-terminal/one-command/one-apply
  settlement and two-client convergence.
- Callable emulator: added legacy numeric barrier, overflow/underflow/zero
  total, concurrent serialization, result field, schema-free, and unaffected
  resource/turn-state coverage.

## Red-first evidence

1. `CI=true npm.cmd --prefix frontend test -- --watch=false --watchman=false --runInBand src/components/home/elements/StatsBars.test.js` was RED: after two ambiguous failures a source value `7/10` rendered `6/10`, proving the retained delta was double-applied. Green after frozen retry state plus keyboard blocking.
2. `node frontend/scripts/performance/task08-contract.test.js` was RED: settlement computed requested `-2` and rejected the authoritative `44` (`expected 43`), proving it ignored callable `appliedDelta` and did not gate terminal evidence. Green after terminal/command/application correlation.

## Verification

| Command | Result |
| --- | --- |
| Focused StatsBars + command suite | PASS — `2/2`, `43/43` |
| `npm.cmd --prefix frontend/functions run build` | PASS — `105` outputs; no retired artifacts |
| `node frontend/scripts/performance/task08-contract.test.js` | PASS — `12/12` |
| `node frontend/scripts/performance/task08-regression-contracts.test.js` | PASS — `2/2` |
| `FND_GIT_BRANCH=devs` staging build / verify / disabled check | PASS; normal build had no performance artifacts |
| `npm.cmd --prefix frontend run perf:build` | PASS — local opt-in build report refreshed |
| Java-21 command-scoped `perf:preflight` | PASS — Node `22.22.2` |
| Java-21 command-scoped `perf:task08:behavior -- --skip-browser` | PASS — React `4/4`, `65/65`; Node `4/4`; callable emulator `17/17`; Browser explicitly skipped |
| Fixture | PASS — `9,139`, `fbabc02a3376d466cf717e3886e0d12a9e15568c17b654322cff4909dc6eaca8` |
| Ports `3000,3001,4000,4400,4500,5000,5001,5002,8080,9099,9150,9199` | all free after managed shutdown |
| `git diff --check` | PASS; existing LF-to-CRLF warnings only |

Expected warnings: Browserslist/caniuse-lite age, Node `punycode`, Firebase
MOTD/remote-config diagnostics, Java `Unsafe`, and intentional negative-path
test console output. They were not treated as failures.

## Remaining concerns

The required full React suite, `perf:test`, Chromium `perf:task08` flow, and
manual coordinator-owned Browser gate were not run in this recovery. Thus no
claim is made for final browser event/hold/operation evidence, stable two-read
browser state, or official baseline acceptance. The local callable fixture and
managed behavior harness restored and shut down cleanly.
