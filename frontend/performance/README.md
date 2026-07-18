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

Use `npm run perf:baseline -- --accept` only after a reviewed authoritative run. An authoritative run sets `FND_PERF_AUTHORITATIVE=1` and `FND_PERF_ITERATIONS=3`, producing one discarded warmup and three retained measurements per single-context scenario.

The checked-in artifacts are:

- `scenarios.json` and `fixture-manifest.json`
- `budgets.json`
- `baselines/v1.json` and `baselines/v1.md`

Raw traces, screenshots, authentication state, emulator data and logs, detailed network captures, and heap data are written only to ignored output directories and are uploaded as CI artifacts.

## Budget policy

Blocking budgets reject missing required scenarios or metrics, fixture drift, runtime errors, failed requests, leaked route resources, exposed normal-build instrumentation, and regressions from the accepted baseline. Long-term targets remain visibly failed until their owning implementation task resolves them; target failures do not make Task 01 fail.

GitHub-hosted timing data is informational. Authoritative timing comparisons use the `FND_PERF_REFERENCE_MACHINE` name recorded in the baseline environment; local runs default to `local-reference`.
