# Task 22 - Final validation and rollout

Final combined acceptance depends on accepted scope from Tasks 01-21; preparation of scorecards and operational gates can start earlier. Every earlier release owns its own rollback, staging and migration safeguards.

## Outcome

Prove the end-to-end gains under production-shaped load, deploy high-risk changes gradually, and leave measurable budgets, rollback paths, and operational ownership in place.

## Evidence

- The audit found intertwined transfer, listener, read/write, rendering, media, data-model, Cloud Function, and lifecycle costs; isolated microbenchmarks cannot prove the combined user outcome.
- Tasks 05, 06, 09, 11, 12, 14, and 16-21 change high-risk data or collaboration paths and require staged migration/rollout evidence.
- The July audit recorded passing tests and console noise. Re-run relevant gates for the release candidate; those counts and warnings are not current evidence.
- `.github/workflows/performance.yml` and `frontend/performance/budgets.json` already provide gates. Extend verified coverage and identify remaining runtime/field telemetry gaps; do not build a duplicate CI system.

## Implementation elements

1. Freeze code/config/data-migration candidate versions and generate the complete Task 01 benchmark on the same reference environment, fixtures, routes, and scenarios.
2. Produce a before/after scorecard for route transfer and readiness, listeners, reads/writes, query latency, React commits, Konva draws, frame time, long tasks, heap, media bytes, callable latency, failures, and estimated cost.
3. Run cross-feature journeys: Login to Home, character creation, Bazaar purchase/edit, DM/Admin bulk work, Codex, Tecniche/Foes, Combat Tool removal/direct-link handling, Echi, retained Grigliata turn advancement, and multi-peer Grigliata.
4. Resolve test-console noise in owned paths so new warnings/errors fail the relevant verification. Record any environment-only exception with owner and expiry.
5. Execute data migration verification by counts, hashes/samples, invariant queries, orphan detection, version coverage, and comparison appropriate to the chosen cutover protocol before disabling legacy paths; dual writing is not required.
6. Roll out high-risk behavior behind independently reversible flags: internal/test users and supported cohorts, then authorized adoption. Verify actual flag/cohort capability; use a controlled release window when percentage canaries are unavailable. Separate data migration, read-path, write-path, and cleanup switches.
7. Define automatic/manual rollback thresholds for errors, permission failures, p95/p99 latency, retries, listener/read/write amplification, convergence, frame time, memory, and cost.
8. Run sustained load and soak tests for five-peer Grigliata including retained turns/effects, batch/admin functions, trigger cascades, media caches, and offline/reconnect queues.
9. Validate target browsers, device classes, slow network/CPU, reduced motion, hidden/background lifecycle, accessibility, and direct navigation to every route.
10. Publish dashboards, alerts, runbooks, feature-flag ownership, migration status, rollback commands, data-retention jobs, and a recurring budget-review cadence.
11. Remove legacy collections/fields/assets/flags only after the observation window, backup/rollback requirements, and explicit verification checklist are satisfied.
12. Archive trace/build/query artifacts and update architecture documentation with final ownership and data-flow diagrams.

## Boundaries and non-goals

- Do not average away regressions in a critical role, route, browser, or large-data fixture.
- Do not delete legacy data or turn off compatible readers during the rollback observation window.
- Synthetic success does not replace field telemetry; field telemetry does not replace deterministic correctness and migration tests.
- A budget exception must name the metric, evidence, owner, expiry, and follow-up task. It cannot be silently accepted.

## Tests

- Full frontend test suite with Watchman-independent CI configuration, production build verification, Functions typecheck/lint/tests, backend tests, and Firestore emulator rule/index tests.
- Automated route crawl for direct navigation, lazy-load failures, permission states, console errors, listener cleanup, media cleanup, and accessibility smoke checks.
- Standard fixture benchmark repeated enough times to report median and high-percentile variance; retain raw traces rather than only summaries.
- Load/soak, offline/reconnect, multi-tab, multi-peer, auth change, failure injection, retry/idempotency, migration/rollback, and stale-client compatibility suites.
- Compare supported staged cohorts or controlled pre/post windows using predefined stop/rollback decisions; record sample limitations.
- Restore drill from backup plus rollback of flags/readers/writers without data loss.

## Acceptance gates

- Every retained Task 01 route and runtime budget passes (retire Combat feature budgets explicitly and replace them with Task 14 removal plus retained-turn checks), or has an approved time-limited exception with evidence and owner.
- No correctness, authorization, accessibility, direct-navigation, offline, or collaboration regression remains open at rollout severity.
- Supported staged cohorts or controlled release windows remain within thresholds for the agreed observation periods.
- Migration verification, restore drill, and rollback drill complete successfully before legacy cleanup.
- CI, dashboards, alerts, runbooks, ownership, and retained benchmark artifacts are operational.
- Final documentation records actual measured gains rather than expected gains, and the optimization sequence can be audited end to end.

## Release units and measurement contract

22A: extend existing gates/scorecard early. 22B: combined release-candidate validation after all accepted units. 22C: authorized release observation and operations handoff; cleanup needs its own explicit authorization.

Use README fixtures and named target browser/device/network combinations. Repeat compatible before/after runs, report median/p95 and variance with sample counts, and choose a written soak duration from real session lengths and risk. No obsolete Combat scaling benchmark is an acceptance requirement.

Follow the [roadmap release/evidence rules](../README.md#rules-for-every-task) for each unit. Source observations identify work to verify, not fresh timing or deployed status. Record current measured values and numeric targets separately before implementation; use existing budget keys where available.
