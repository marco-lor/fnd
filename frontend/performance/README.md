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

Use `npm run perf:authoritative` on the named reference machine to perform two compatible runs. Each run produces one discarded warmup and three retained measurements per single-context scenario. `npm run perf:repeatability` requires deterministic metrics and build assets to match and timing medians to remain within 15%; the accepted aggregate therefore contains six retained measurements. GitHub's scheduled authoritative command exercises the same workflow but remains informational because hosted-runner timing is not a baseline source.

Use `npm run perf:baseline -- --accept` only after reviewing a passing `performance-results/repeatability-report.json`. Baseline acceptance verifies the aggregate checksum so stale or hand-combined results cannot be accepted.

Set `FND_PERF_RUN_ID` to give a benchmark pair a stable name. `FND_PERF_REFERENCE_MACHINE` identifies the controlled machine; `FND_PERF_JAVA_HOME` may select the Java 21+ runtime used by the emulators.

The checked-in artifacts are:

- `scenarios.json` and `fixture-manifest.json`
- `budgets.json`
- `baselines/v1.json` and `baselines/v1.md`

Raw traces, screenshots, authentication state, emulator data and logs, detailed network captures, and heap data are written only to ignored output directories and are uploaded as CI artifacts.

## Budget policy

Blocking budgets reject missing required scenarios or metrics, fixture drift, runtime errors, failed requests, leaked route resources, exposed normal-build instrumentation, and regressions from the accepted baseline. Long-term targets remain visibly failed until their owning implementation task resolves them; target failures do not make Task 01 fail.

GitHub-hosted timing data is informational. Authoritative timing comparisons require matching commit, fixture hash, Node version, browser name/version, CPU identity, build hashes, and `FND_PERF_REFERENCE_MACHINE`; local runs default to `local-reference`.
