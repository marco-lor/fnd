# Task 01 - Performance baseline and budgets

## Outcome

Create the reproducible measurement harness that every later task must use. This task changes no product behavior and makes no optimization claim.

## Why this is first

- The current build has one 700,738-byte gzip main asset, but it is an existing artifact rather than a recorded CI baseline.
- `reportWebVitals()` is called without a reporter (`frontend/src/index.js:21`).
- There are no listener/read/write, route chunk, media transfer, React commit, Konva draw, heap, or browser timing budgets.
- The 52-suite/624-test run passes but emits async/media errors, which reduces signal quality.

## Implementation elements

1. Define named emulator fixtures from the standard sizes in the plan README, including representative nested document/media metadata sizes.
2. Add a production-build report containing raw, gzip, and Brotli sizes for the entry, shared, route, and feature chunks. Keep analysis artifacts private to CI; do not re-expose source maps in Hosting.
3. Add route scenarios for cold Login, warm Login, Character Creation, Home, Bazaar, Combat, Echi, DM/Admin, and Grigliata player/manager.
4. Instrument Firestore subscription targets, active listener count, initial/change reads, normalization counts, writes, and request payload size in development/test builds.
5. Add React Profiler and browser traces for the named large fixtures. Add Konva draw counters and fog/visibility benchmark entry points without changing algorithms.
6. Wire current Web Vitals to an approved telemetry sink or a local capture adapter, tagged by route, role, release, device class, and connection class. Capture LCP, CLS, INP, and TTFB.
7. Add CI jobs for frontend tests, Functions lint/type-check, emulator integration tests, production build verification, bundle/media budgets, and controlled browser performance tests.
8. Make test output actionable: mock media APIs correctly and eliminate unexpected `act(...)` warnings before treating console errors as failures.

## Initial project budgets

These are implementation targets, not claims about the present application. Record the current value beside each target and refine only through a reviewed baseline change:

- Login entry JavaScript: no more than 250 KiB gzip.
- No route chunk may grow by more than 10% or 30 KiB gzip, whichever is larger, without an approved budget update.
- No synchronous network API on the main thread during bootstrap.
- All collection-backed initial views are bounded by a declared page size.
- Normal route unmount returns listener count to the authenticated-shell baseline.
- Project field targets: p75 LCP <= 2.5 s, INP <= 200 ms, CLS <= 0.1 on supported profiles.
- Grigliata normal interactions: no task over 50 ms in the controlled reference workload; exact frame/commit gates are set from the fresh trace.

## Boundaries and non-goals

- Do not change queries, rendering, Firebase initialization, schemas, or user-visible behavior.
- Do not use microbenchmark timings from Jest as browser-performance gates.
- Do not upload private document contents or media URLs to telemetry.
- Do not publish source maps or bundle analysis output with Hosting.

## Tests

- Run the full frontend suite with Watchman disabled on Windows.
- Prove fixture generation is deterministic and idempotent.
- Prove instrumentation is tree-shaken or disabled in production unless explicitly required for RUM.
- Verify browser scenarios fail when a synthetic listener, chunk, or media budget is exceeded.
- Store machine/browser versions and variance for controlled timing runs.

## Acceptance gates

Commit the baseline report, fixture version, commands, dashboards, budgets, and CI output. Later tasks may not begin until the same scenario can be run twice with acceptable variance and no unexplained console errors.
