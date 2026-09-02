# Task 08 Step 6 — attempt 07 narrowed recovery

## Status and scope

**DONE_WITH_CONCERNS.** All work was local to
`C:\Users\Marco\OneDrive\git_projects\fnd-devs`. The existing dirty and
untracked tree was preserved. No commit, push, merge, PR, deployment, remote
Firebase access, baseline acceptance, dependency change, reset, stash, clean,
discard, worktree change, process termination, or staging-browser interaction
was performed.

- Branch / HEAD: `devs` / `9c7fcc7c5799a458768512b7cbab49e4d9b301a9`.
- Attempt start fingerprints: tracked
  `0a5aa2f95b9eed9fb96e58cf1d0334b87ce906d835a4ad7ed8296b620cbabd2e`; source
  `cd68942ad14f9dfa39a9a819d43f65d6c13f75fbce1ebd5e2fada6368f783bc8`.
- Verification fingerprints immediately before this report append: tracked
  `1e9fa2d0040016abb4e8bc9682ac98f58335ce572233378a8c4c4c668b1f1bf5`; source
  `f59a42cecd48be0db3a4e07b6c67b4a1f9e57913eea4fd7b04806c962313c821`.

## Narrowed changes

- Added `StatsBars` regression coverage for pointerup-plus-synthetic-click
  suppression, timer release on every pointer terminal/freshness/unmount,
  late successful/ambiguous/definitive results after actor or freshness loss,
  and in-flight manual Retry fencing after an actor-scope change. Existing
  lifecycle production fencing satisfied this coverage; no production edit was
  justified by these tests.
- Strengthened the callable concurrent-barrier assertion to require the
  order-independent exact result envelopes `{previousValue,newValue,
  appliedDelta,newRevision}` of `1→2` then `2→3`, and the final revision.
- Made the two-client browser assertion independently require zero resource-window
  renders for Navbar, Inventory, EquippedInventory, Extra, and ParamTables on
  each client. Its window now ends at resource convergence, before the separate
  consumable action legitimately renders inventory consumers.

## Verification and diagnosis

| Command / evidence | Result |
| --- | --- |
| Focused `StatsBars.test.js` | PASS — `31/31` |
| Full React suite | PASS — `156/156` suites, `1,471/1,471` tests |
| `perf:test` | PASS — `431/431` on approved local-config rerun; sandbox first hit only four Firebase config-store `EPERM` reads |
| Functions build | PASS — `105` output files, no retired Task 05 runtime |
| Performance build | PASS — fresh opt-in report before the final ordinary build |
| Full `perf:task08` with command-scoped JBR 25 (Java 21+ compatible) | First five stages passed: asset warmup, auth setup, Login, Character Creation, and Home. Two-client stage RED: client A reported `5` unrelated renders because the asserted resource window accidentally included the subsequent consumable action. |
| Corrected full/browser and behavior reruns | BLOCKED: the failed owned harness left Java PID `31296` listening on `127.0.0.1:8080` and `127.0.0.1:9150`; the no-takeover behavior gate refused to start. No process was terminated. |
| Fixture reached by full runner | PASS before Chromium — `9,139` documents, `fbabc02a3376d466cf717e3886e0d12a9e15568c17b654322cff4909dc6eaca8` |
| `build:staging`, `verify:staging-build`, `perf:verify-disabled` | PASS — final ordinary local staging-target build has no performance bridge, profiler, benchmark, or persistence-experiment artifacts |
| `git diff --check` | PASS with existing LF-to-CRLF warnings only |

The test-scope failure is useful RED evidence for the Browser acceptance source,
but not a product defect: the resource-only count was recorded after the
intentional consumable mutation. The corrected window preserves the requested
per-client resource isolation assertion. The newly added unit coverage was green
against the prior lifecycle implementation; an initial manual-retry assertion
was red only because it counted the two intentionally logged ambiguous failures,
and was corrected without changing production code.

## Remaining concerns

The exact concurrent callable envelopes and corrected two-client Chromium
assertion require one clean rerun after the owned PID releases or is stopped by
an authorized operator. The full runner's first attempt proves the previous
static-warmup failure did not recur, but its two-client source correction is not
yet re-executed. Port cleanup is therefore not clean, and the coordinator-owned
manual localhost Browser gate remains unverified. This report does not claim
official baseline acceptance.
