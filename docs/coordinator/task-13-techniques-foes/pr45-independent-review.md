# PR 45 independent review

Review baseline: `28d85578f272ee5d67b5017d122b244d8f7235d7`, `devs` against remote `main` at `d1d021fe5270a5934575fd634b3ab34be7643e6c`. Clean permanent `fnd-devs` checkout; no applicable AGENTS.md. No outstanding review threads; the connector summary is not correctness evidence. No deployment or merge is authorized by this review.

## Actionable findings recorded before fixes

- **P2 — Missing render measurement fails every smoke comparison.** `frontend/performance/budgets.json:8` requires `foes-hub:react.unaffectedRowChartCommits`, but the Foes interaction at `frontend/performance/tests/browser/helpers.js:1469` only pages/expands and its aggregator at line 1711 never emits the metric. The actual PR run 36721796255 completed all 28 browser tests, then failed comparison with this blocking budget `status: missing`. Independently replaying the downloaded browser report through `buildMetricMap`/`evaluateBudget` reproduced that result. Add committed-render probes and a verified single-foe update measurement; keep the zero budget and missing-evidence failure.
- **P2 — Median aggregation can hide render-isolation regressions.** `frontend/scripts/performance/report.js:94` uses the median for the newly added zero-commit metric. A three-iteration fixture `[0, 1, 0]` reports zero and passes. A new regression test fails with `0 !== 1`. Treat this zero gate as a worst-case metric, as existing leak gates are treated.

- **P1 — Order maintenance invalidates pending foe media retirement.** The additive order write in `frontend/functions/src/foeOrder.ts:22` changes the full target hash recorded by `frontend/functions/src/foeMediaRetirement.ts:348` and checked at line 480. A real prepare → order reconciliation → commit emulator sequence fails with `aborted: Foe document changed before retirement commit`, although no gameplay/media content changed. This breaks pending operations across the backfill and can also break new operations during trigger reconciliation. Reuse the existing order-insensitive content fence, accepting pre-field full hashes while preserving rejection of actual content/media edits.

## Fixes and independent validation

Retirement now uses the existing derived-order-insensitive source fence. The emulator regression verifies a pre-field historical full-hash receipt and a newly prepared receipt whose existing order value is reconciled. Both commit, create cleanup work and replay; a concurrent content edit is rejected without losing the media binding or edit. The old source-text assertion requiring the incorrect full hash was replaced with executable content/media fence assertions; other atomic-commit infrastructure assertions remain.

The smoke interaction now expands two real foes, waits for committed-render instrumentation, updates one fixture name through the demo emulator, verifies its UI update/commit and restores the original name. Only the bounded update window contributes to the budget. Missing probes/markers/observed update retain a missing metric, and repeated runs retain the worst count. The zero budget is unchanged. The actual browser window recorded exactly one changed-row committed probe and no unrelated row or chart probes.

Fresh local checks on Windows / Node 22.22.2:

- Full frontend Jest: 191 suites, 1,777 tests passed at the default timeout. The earlier Task 11 timeout did not reproduce.
- Functions: clean build, lint with zero errors (six existing warnings), 266 tests passed.
- Full performance harness: 517 tests passed with host process permissions. The sandbox run failed three Windows supervisor-tree cleanup probes; those same probes passed on the host, and all six verified sandbox test processes were cleaned up. No supervisor source changes were made.
- Task 13 models/operator guards: 4 tests passed; first-page fixture remains 26 documents / 25 rows / 10,748 serialized bytes out of 196,332 (5.47%).
- Task 13 Firestore integration: 8 tests passed, including all 500 foes, DM-only authorization, cutover/create race, cursor boundary updates/detachment, rollback, legacy/V2 duplication replay, retirement compatibility/cleanup and authoritative mana semantics.
- All six architecture/query/callable guards passed.
- Normal performance build and instrumentation-absence guard passed; instrumented build passed.
- Complete Chromium run: 28/28 passed with strict teardown. `perf:compare` exits zero; every blocking evaluation passes, including the real `foes-hub:react.unaffectedRowChartCommits = 0` measurement.

## Scope and remaining limits

No additional introduced correctness finding was confirmed in search/filter ordering, domain/config subscriptions, mana commands, pagination/query/rules, additive migration/cutover/rollback, or duplication/media fences. The same content fence preserves unchanged historical full-hash receipts that already include the order field; it cannot recover an unknown prior order value from such a hash after that value changes. This is the existing duplication compatibility boundary, not a relaxation of content checks.

Non-blocking collection-delivery, INP, CLS and Grigliata long-task targets still miss on other routes; they are not the CI exit-code cause and their budgets were retained. The existing FoeRow nested-button Enter interception is unchanged at the review baseline. Prior staging/manual/deployment claims were not used as proof of these fixes. This review performed no staging or production deployment, merge, dependency installation or primary-checkout mutation; the permanent devs checkout is retained.
