# Task 07 implementation evidence

Evidence date: 2026-07-26

Candidate branch: `codex/task-07-media-shell`

Base revision: `dfea5ec43675be2475810910dd34214d0b465bdf`

Verdict: the default-off local candidate is implemented and regression-tested.
The original Task 07 definition of done is not closed, and production
activation is blocked.

## Safety and scope

Implementation and validation were performed in the isolated worktree:

```text
C:\Users\Marco\OneDrive\git_projects\fnd\.codex-worktrees\task07-media-shell
```

The user's watched checkout, its existing port-3000 `npm start` process, and the
live `/grigliata` route were not used for Task 07 validation. Browser evidence
used read-only `/home` on project `demo-fnd-perf` with locally owned emulators
and ports. No Firebase deployment, online configuration/data/rule/index write,
CORS update, accepted baseline, production backfill, commit, or staging action
occurred.

The Task 07 client flag is absent in the final normal build. Only the exact
performance harness sets `REACT_APP_FND_PERF=1` for emulator evidence.

## Freeze investigation and execution controls

The user reported four whole-PC freezes while this task was in progress. Before
resuming, Windows event history, live processes, memory, disk space, and watched
ports were checked. The shutdown records were unexpected Kernel-Power events
with bugcheck code 0. No contemporaneous WHEA, disk, display-driver, or Windows
resource-exhaustion record tied a freeze to Task 07. This cannot prove the task
was unrelated, but there is no positive diagnostic evidence that the candidate
or a specific test caused the freezes.

The resumed work used these controls:

- one test/build/emulator workload at a time;
- no subagent or parallel test fan-out;
- Jest `--runInBand`, Playwright one worker, and rules test concurrency 1;
- below-normal process priority and affinity limited to two logical CPUs;
- bounded Node heaps and a portable Java 21 runtime;
- task-local caches and temporary files on `D:`;
- hard per-command timeouts between 5 and 15 minutes;
- waits no longer than 30 seconds, with process/resource checks after each
  heavyweight operation; and
- no globally inherited `JAVA_TOOL_OPTIONS`.

All resumed bounded runs completed without a freeze. At the documentation
checkpoint the machine had approximately 62.7 GiB free physical memory, no Java
or emulator process was running, and the only watched listener was the existing
port-3000 process (PID 26828). That process tree was left untouched.

## Implemented candidate surface

### Server and policy

- Versioned media contracts and canonical Storage layout for avatar, item, NPC,
  foe, map image, and map video.
- Authenticated callable prepare, finalize, confirm, abandon, retire, and cleanup
  retry operations registered through the callable registry.
- Idempotent operation identities, exact entity binding, replacement ordering,
  manifest state transitions, cleanup leases, trigger readiness accounting, and
  scheduled orphan sweeping.
- Server-side byte download and inspection of object generation, checksum-
  validated bytes, MIME type, image/video dimensions, orientation metadata,
  cache metadata, and exact custom identity metadata.
- Firestore entity-reference validation, private server-owned manifests/cleanup
  ledgers, create-only canonical Storage rules, and the required query index for
  the bounded music session query.

### Browser and consumers

- Default-off client pipeline with deterministic operation IDs and explicit
  prepare/generate/upload/finalize/commit/confirm ordering.
- Browser raster derivative generation from the server-returned contract,
  bounded upload concurrency, cancellation handling, legacy fallback, and
  ambiguous-commit reconciliation.
- Shared `MediaImage`/`MediaVideo` renderers, canonical descriptor validation,
  authenticated `getBlob` reads, bounded object-URL cache, offscreen lease
  release/reacquisition, and protected board/crossfade leases.
- Avatar, Bazaar/global item, private inventory item, NPC, foe, Grigliata map,
  map-video, token, gallery, and narration consumer integration.
- Repository-owned profile media update boundary; no new direct Task 05 user
  aggregate access.
- Low-node aurora with reduced-motion/hidden-document pause and bounded timers.
- Global music capped at four active sessions, one audio node, `preload="none"`,
  and source release while stopped, empty, or muted.

### Harness and operations

- Exact-demo fixture and browser setup hardening, deterministic static asset
  warmup, Task 07 `/home` media/shell browser assertions, and cleanup trigger
  readiness coverage.
- Read-only, emulator-only legacy media backfill planner that explicitly refuses
  write/live modes.
- Exact-origin CORS policy file and default-off activation/rollback runbooks;
  the policy was not applied.

## Final validation results

| Gate | Command or boundary | Result |
| --- | --- | --- |
| Functions lint/build/test | From `frontend/functions`: `npm.cmd run lint`; `npm.cmd test` | PASS; TypeScript build green; 110/110 Node tests |
| Task 07 rules | `firebase emulators:exec --project demo-fnd-perf --only firestore,storage` wrapping `node --test --test-concurrency=1 performance/tests/task07-media-rules.test.js` | PASS; 10/10 |
| Full seeded rules | Same exact demo emulators, deterministic seed, then `npm.cmd run perf:rules` | PASS; 30/30 |
| Frontend | `npm.cmd test -- --watch=false --runInBand --watchman=false --testMatch=**/*.test.js` with `CI=true` and task-local cache | PASS; 102/102 suites, 955/955 tests, 0 React act warnings; 110.36 s |
| Performance/tooling unit tests | `npm.cmd run perf:test` | PASS; 201/201 |
| Backend | `python -m unittest discover -s backend -p "test_*.py"` | PASS; 21/21 |
| Default-off production build | `npm.cmd run build` with Task 07 flags unset | PASS; compiled successfully; about 91.6 s |
| Normal startup contract | `npm.cmd run verify:start` | PASS; normal `npm start`, `/home` HTTP 200 on owned port 3001, own process stopped and port released; about 74.4 s |
| Exact browser case | `npx.cmd playwright test performance/tests/browser/task07-media-shell.performance.js --project=chromium` | PASS; asset warmup, auth setup, and read-only `/home`; 3/3 with one worker; 4.7 min |
| Firestore import boundary | `npm.cmd run perf:check-firestore-imports` | PASS; all application imports use the telemetry facade |
| Callable boundary | `npm.cmd run perf:check-callable-registry` | PASS; 36 callables across 3 regions |
| Query contracts | `npm.cmd run perf:check-query-contracts` | PASS; 57 listeners, 10 repository shapes, 7 activated index signatures |
| Shared config boundary | `npm.cmd run perf:check-shared-config-boundaries` | PASS |
| Task 05 user data boundary | `npm.cmd run perf:check-user-data-boundaries` | PASS; 42 tracked legacy files, 1 adapter, no new direct access |

The final Chromium `/home` case asserted all of the following:

- at least 400 inventory media elements;
- more than 300 elements far offscreen;
- zero far-offscreen network-bearing sources attached;
- fewer than 80 attached sources in total;
- intrinsic dimensions, `loading="lazy"`, and `decoding="async"` on every media
  element;
- fewer than 64 unique deterministic fixture image URLs;
- reduced-motion aurora paused, exactly two star fields, and zero shooting stars;
- at most one audio node, `preload="none"`, and no stopped/muted source; and
- zero media requests attributable to the offscreen fixture set and zero
  browser errors.

## Warning disclosure

- The full frontend run emitted only Node's known `punycode` deprecation; it had
  no React act warning or test failure.
- The production build emitted the existing stale `caniuse-lite`/Browserslist
  database notice; compilation itself was successful.
- Negative Firestore/Storage rule cases intentionally emitted
  `PERMISSION_DENIED` diagnostics. Some deliberately rejected complex writes
  fail closed at the emulator's rule-expression ceiling. Their denial
  assertions passed, but this is not counted as positive authorization evidence
  and should be reviewed again before any production rules rollout.
- No baseline or performance report was accepted or rewritten.

## Definition-of-done status

| Original Task 07 requirement | Status | Evidence or blocker |
| --- | --- | --- |
| Gate 0A: preceding Task 06 fully green | BLOCKED | Previous Task 06 `perf:ci` completed only 6/19 scenarios; cleanup accounting, comparison, repeatability, and baseline gates remain open |
| Isolate from active battle and port 3000 | PASS | Isolated worktree, exact demo emulators, read-only `/home`; live route/process untouched |
| Versioned private media contract and role matrix | CANDIDATE PASS | Unit/rules/full regression green; default off |
| Authoritative server generation with `sharp`/`ffmpeg` | BLOCKED | Candidate generates derivatives in the browser; server inspects and validates but does not regenerate or pixel-compare |
| Approved derivatives and legacy fallback | PARTIAL | Consumer and unit/browser coverage exists; full route matrix is not complete |
| Active board full-quality pin/crossfade safety | PARTIAL | Unit coverage and protected leases exist; 50-map live-cycle soak was not run |
| Blocking Task 01 media budgets | BLOCKED | Candidate has local caps and focused assertions; `performance/budgets.json` was not extended with all plan metrics |
| One compact authenticated-shell music listener | BLOCKED | Current implementation uses two shell listeners: playback document plus bounded active-session query |
| Replacement, cancellation, orphan, authorization, orientation, unsupported format | CANDIDATE PASS | Focused Functions/client/rules tests green |
| Resumable write backfill and rollback rehearsal | BLOCKED | Planner is deliberately read-only and emulator-only; production write path is not implemented or authorized |
| Chromium read-only `/home` media shell | PASS | 3/3 exact-demo browser cases |
| Chromium/Firefox/WebKit media matrix | BLOCKED | Only the focused Chromium case was run |
| 50-map/token and ten-minute lifecycle soak | BLOCKED | Required scripts/gates are not implemented or run |
| Full `perf:ci` and two-pass authoritative repeatability | BLOCKED | Not run; Gate 0A is already red and partial results cannot accept a baseline |
| `npm start` and `/home` | PASS | `verify:start` used normal start on port 3001 and returned HTTP 200 |
| Production activation | BLOCKED | No approval; active battle; preceding and Task 07 gates above remain open |

## Why the candidate is not declared complete

The original plan explicitly says to stop when Gate 0A is red. Continuing after
the user approved implementation produced useful default-off code and local
evidence, but it does not convert that hard prerequisite into a pass. It would
also be incorrect to equate the focused `/home` assertions with the missing
50-map/token soak, full route/cross-browser matrix, or authoritative two-pass
performance comparison.

Accordingly, this evidence supports only this statement:

> Task 07 has a default-off, locally verified implementation candidate whose
> normal build and `npm start` path pass. It must not be enabled or deployed
> until every BLOCKED item above is closed and reviewed after the active battle.

## External-state attestation

As of this evidence capture:

- no Firebase project was deployed;
- no online Firestore or Storage data was written;
- no online rules, indexes, Functions, Hosting, App Check, config, or CORS policy
  was changed;
- the Task 07 production feature flag remains unset;
- the live `/grigliata` page was not opened, refreshed, clicked, or mounted for
  validation; and
- the existing port-3000 server and the board's online presence/status were not
  changed.
