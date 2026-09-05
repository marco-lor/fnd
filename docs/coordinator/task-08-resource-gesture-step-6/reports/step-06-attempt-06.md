# Task 08 Step 6 — attempt 06 recovery

## Status and scope

**DONE_WITH_CONCERNS.** Local-only work in
`C:\Users\Marco\OneDrive\git_projects\fnd-devs`. No commit, push, merge, PR,
deployment, remote Firebase access, baseline acceptance, dependency change,
worktree change, reset/stash/clean, or manual Browser/staging-tab action was
performed. The existing dirty and untracked tree was retained.

- Branch / HEAD: `devs` / `9c7fcc7c5799a458768512b7cbab49e4d9b301a9`.
- Start fingerprints: tracked
  `ee9b005e28d6dcb4311030d6ecdb7d4a1e5ff0ba194689dbabe30c9006a3ea76`; source
  `6ba2230dd2f7e78dfbde78b251b00e4009a990a9f077458a4baffb8c47a9c07c`.
- Verification fingerprints immediately before this report append: tracked
  `0a5aa2f95b9eed9fb96e58cf1d0334b87ce906d835a4ad7ed8296b620cbabd2e`; source
  `cd68942ad14f9dfa39a9a819d43f65d6c13f75fbce1ebd5e2fada6368f783bc8`.

## Recovery changes

- Expanded `StatsBars` ownership/lifecycle tests: secondary and wrong pointer
  IDs across mouse/touch/pen; cancel/lost capture/release re-entrancy; capture
  failure; stale actor/freshness/unmount responses; timer cleanup; and unique
  retained-retry/new-gesture operation IDs. Pointer-event fixtures now model
  real native pointer fields rather than relying on JSDOM's incomplete helper.
- Expanded Task 08 settlement negatives: duplicate gesture terminals, terminal
  resource/effective-delta/local-sequence mismatch, zero or duplicate commands,
  missing or duplicate applications, and duplicate success/failure terminal
  records.
- Expanded callable emulator barrier evidence with a real `set` operation:
  exact total/current/turn-effect state, exact result envelope, and retained
  concurrent delta serialization checks.
- Tightened browser evidence source: the Home hold waits 2.05 seconds to cover
  the immediate tick plus ten 200ms intervals, then requires exact `-11` hold
  evidence and `[34, 34]` stable state samples. The two-client test derives
  resource/consumable commands and render observations from captured events.

## Verification

| Command | Result |
| --- | --- |
| Focused `StatsBars.test.js` | PASS — `22/22` |
| `node --test frontend/scripts/performance/task08-contract.test.js` | PASS — `19/19` |
| `CI=true npm.cmd --prefix frontend test -- --watch=false --watchman=false --runInBand` | PASS — `156/156`, `1,462/1,462` |
| `npm.cmd --prefix frontend run perf:test` | PASS — `431/431` on the approved local-config rerun; sandbox-only attempt had four configstore read (`EPERM`) failures |
| Java-21 `npm.cmd --prefix frontend run perf:build` | PASS — opt-in `demo-fnd-perf` build report refreshed |
| Java-21 `npm.cmd --prefix frontend run perf:preflight` | PASS — Node `22.22.2` |
| Java-21 `npm.cmd --prefix frontend run perf:task08:behavior -- --skip-browser` | PASS — React `4/4`, `65/65`; Node `4/4`; callable emulator `17/17` |
| Callable barrier matrix | PASS — legacy/overflow/underflow/set-total-turns/zero-total/concurrent checks within the `17/17` emulator suite |
| Fixture | PASS — `9,139`, `fbabc02a3376d466cf717e3886e0d12a9e15568c17b654322cff4909dc6eaca8` |
| Chromium `perf:task08:behavior` | BLOCKED — auth setup asset warmup aborted six static-chunk requests before Task 08 scenarios; `1` setup passed, `4` tests did not run |

The chromium runner subsequently reported emulator teardown unable to stop an
owned process and temporarily occupied harness ports. A fresh read-only
inspection immediately after returned no listeners on
`4000,4400,4500,5001,5002,8080,9099,9150,9199`; no process was terminated by
this attempt. Thus it is not evidence for the required exact two-second Home
or two-client Browser assertions.

Expected non-failing local diagnostics: Browserslist/caniuse-lite age, Node
`punycode`, Firebase MOTD/Java `Unsafe`, intentional negative-path console
output, and rules-test permission denials. `git diff --check` is re-run after
the final fingerprints are collected.

## Remaining concerns

The source and local tests are green, but the required full Chromium event
evidence (including the exact `-11` Home hold and derived two-client readings)
is unverified due to the asset-warmup/harness shutdown failure. The
coordinator-owned manual Browser acceptance is also unverified. This report
does not claim official baseline acceptance.
