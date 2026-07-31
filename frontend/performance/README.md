# FND performance harness

This harness measures the production frontend against deterministic Firebase emulator data. It does not use production credentials, data, or telemetry, and it refuses to reset or seed a project whose ID does not start with `demo-`.

## Prerequisites

- Node.js 22 or newer
- Java 21 or newer
- Playwright Chromium (`npx playwright install chromium`)
- Dependencies installed from `frontend/package-lock.json`

Run `npm run perf:preflight` for actionable prerequisite checks.

## Local workflow

From `frontend/`:

1. `npm run perf:build` builds the instrumented production bundle and asset report.
2. `npm run perf:run` starts the emulators, restores the canonical fixture, and runs the Chromium smoke scenarios serially.
3. `npm run perf:compare` evaluates blocking budgets and non-blocking remediation targets.
4. `npm run perf:ci` performs the complete local CI sequence.

The fixture command verifies the Functions runtime, temporarily disables and flushes
background triggers for the bulk demo seed, then re-enables and verifies triggers before
the rules matrix runs. The harness then disables background triggers for the measurement
window because fixture-derived totals are already seeded, re-enables them during global
teardown, and fails if any background invocation ran while measurement was active.
Emulator startup replaces only the current ignored debug logs, uses INFO verbosity, and
fails if `firebase-debug.log` exceeds 25 MiB.

Run `npm run verify:start` for the development-workflow smoke gate. It invokes the
unchanged `npm start` on port 3001 with `BROWSER=none`, requires a successful compile and
an HTTP 200 HTML response from `/home`, and stops only the process tree it created.

Use `npm run perf:authoritative` on the named reference machine to perform two compatible runs. Each run produces one discarded warmup and three retained measurements per single-context scenario. `npm run perf:repeatability` requires deterministic metrics and build assets to match and timing medians to remain within 15%; the accepted aggregate therefore contains six retained measurements. GitHub's scheduled authoritative command exercises the same workflow but remains informational because hosted-runner timing is not a baseline source.

Use `npm run perf:baseline -- --accept` only after reviewing a passing `performance-results/repeatability-report.json`. Baseline acceptance verifies the aggregate checksum so stale or hand-combined results cannot be accepted.

Set `FND_PERF_RUN_ID` to give a benchmark pair a stable name. `FND_PERF_REFERENCE_MACHINE` identifies the controlled machine; `FND_PERF_JAVA_HOME` may select the Java 21+ runtime used by the emulators.

The checked-in artifacts are:

- `scenarios.json` and `fixture-manifest.json`
- `budgets.json`
- `baselines/v1.json` and `baselines/v1.md`

Raw traces, screenshots, authentication state, emulator data and logs, detailed network captures, and heap data are written only to ignored output directories and are uploaded as CI artifacts.

## Task 07 media validation

Task 07 has deliberately serial entry points so local validation cannot create a
large browser or test-worker fan-out:

- `npm run perf:check-media-boundaries` compares the client and Functions policy
  copies and rejects raw object URLs, direct Storage operations, and reserved
  generated/staging paths outside reviewed adapters.
- `npm run test:task07` runs the Task 07 Node tests with concurrency 1, then the
  focused frontend tests with Jest `--runInBand --watchman=false`.
- `npm run perf:media` runs the read-only Task 07 Chromium media routes with one
  Playwright worker against `demo-fnd-perf` only.
- `npm run perf:media:cross-browser` runs the reduced read-only smoke in Firefox
  and WebKit, still with one worker.
- `npm run perf:media:soak` runs for at least ten minutes and at least three
  complete cycles by default. Each cycle activates all 50 deterministic maps,
  renders the 200-token fixture board, and proves that the named active-board
  and outgoing-crossfade leases overlap during every map change before checking
  settled registry ownership, the exact desktop caps, and no greater than 5%
  upward trend across the final three samples. `FND_TASK07_SOAK_CYCLES=3..5`
  changes the minimum cycle count. A shorter developer smoke is accepted only
  with `FND_TASK07_SOAK_SMOKE=1`; its
  `FND_TASK07_SOAK_DURATION_MS=30000..300000` setting is not acceptance
  evidence. Production/scheduled durations can be extended from 600000 through
  3600000 milliseconds but cannot be shortened. The project always uses one
  Playwright worker and does not run as part of the ordinary Chromium project.

The pull-request `task07-pr-gate` runs the focused frontend suite, Functions
lint/build/tests, the media boundary check, Task 07 rules, and Task 07 callable
integration in one serial job. Node tests use concurrency 1 and the browser
entry points use one Playwright worker.

The Task 07 fixture uses valid deterministic PNG/JPEG/WebP objects, an EXIF
orientation case, corrupt and unsupported inputs, a short WAV, a video poster,
50 maps split across two fixture folders, and the existing large collections.
Storage seeding is sequential.

The soak is the one state-changing browser benchmark: it refuses any origin
other than its owned loopback server and the harness is hard-bound to the exact
`demo-fnd-perf` project. It activates only deterministic fixture maps, and the
owned emulator process is discarded afterward. It never targets an online
Firebase project or a live Grigliata board. The smoke override remains a wiring
check; only a full-duration run can supply ten-minute lifecycle evidence.

## Budget policy

Blocking budgets reject missing required scenarios or metrics, fixture drift, runtime errors, failed requests, leaked route resources, exposed normal-build instrumentation, and regressions from the accepted baseline. Long-term targets remain visibly failed until their owning implementation task resolves them; target failures do not make Task 01 fail.

GitHub-hosted timing data is informational. Authoritative timing comparisons require matching commit, fixture hash, Node version, browser name/version, CPU identity, build hashes, and `FND_PERF_REFERENCE_MACHINE`; local runs default to `local-reference`.
