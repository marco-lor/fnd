# PR 45 second independent review

Reviewed current remote head `bbdfd1bfea5295b2a09927b93573d706bd986176` against `main` at `d1d021fe5270a5934575fd634b3ab34be7643e6c`. Permanent `fnd-devs` checkout was independently verified clean on `devs`, with no applicable AGENTS.md and no active development/test processes. Remote refs were fetched using the Windows certificate store. Current PR checks passed and there were no inline review comments. The actual diff and surrounding implementation were examined before prior review conclusions.

## Findings established before fixes

- **P2 — Derived order changes split retirement retry identity.** `frontend/src/data/media/foeMediaRetirement.js:160` includes the new `task13OrderSeconds` field from the editor payload in the immutable mutation. `FoesHub.js:832` builds that intent from persisted foe data. A real intent-store regression simulates a lost prepare response, reopens the same edit after order changes from 11 to 12, and receives `retirement-order-operation-2` instead of reusing `retirement-order-operation-1`. The server's order-insensitive content fence does not prevent this client-side split. Exclude derived order from new retirement intents; preserve different-edit identities.
- **P2 — Refresh does not restart first-page or control listeners.** `frontend/src/components/foesHub/useFoePage.js:15,45` subscribes to control once and refreshes only by replacing `[null]`; page effect dependencies remain the same on page one. After a terminal Firestore error, the visible refresh action cannot recover the subscription. Hook regressions fail to close/restart both the page listener and the control listener. Add an explicit refresh generation while preserving one active page and stale-callback fencing.

- **P2 — Legacy and V2 duplication disagree on accepted operation IDs.** `frontend/functions/src/duplicateFoeWithAssetsLegacy.ts:80` validates a trimmed operation ID but discards the normalized return value, then hashes/stores the untrimmed input at lines 88 and 204. V2 uses the normalized ID. An actual handler/emulator sequence with `" task13-normalized-operation-0001 "` through legacy, followed by the same normalized ID through V2, creates two different foe IDs. The new integration regression fails its result-ID equality assertion while all eight existing integration tests pass. Use the validated normalized ID consistently for the receipt and routing.

## Fixes and fresh validation

The client now omits derived ordering from new retirement intents. The real durable-store regression retains one pending identity across order-only changes and creates a distinct identity for a real edit. Refresh now restarts the paging control and active-page subscription even when already on page one; late page callbacks remain fenced. The legacy callable uses the validator's normalized operation ID for all receipt reads/writes and V2 routing. The integration regression now confirms one result and one backend receipt across the legacy/V2 retry.

Local Windows / Node 22.22.2 results:

- Focused frontend retirement/intent/paging/render suites: 4 suites, 42 tests passed. All new regressions were observed failing before their fixes.
- Full frontend Jest at unchanged defaults: 191/192 suites and 1,779/1,780 tests passed. The unchanged `Task11 deterministic Dashboard data ownership / three-primary page: 0/1/3 expansions and cleanup` timed out at five seconds. A subsequent isolated run with the same command/options and no timeout override passed all 3 tests; the three-primary case reported 6.283 seconds of elapsed work. No test source, assertion, budget or timeout configuration was changed.
- Functions: clean build, 266 tests passed; lint passed with the six existing warnings; TypeScript `--noEmit` passed.
- Task 13 isolated Firestore integration: 9 tests passed. Covers 500-record traversal including missing timestamps/ties, DM-only access, active cursor crossing/detachment, guarded backfill/resume/cutover/create race/rollback, legacy/V2 replay, order-insensitive retirement and rejection of real edits, and concurrent authoritative mana/retry semantics. Emulator shutdown completed.
- Performance harness: 517 tests passed with host process permissions; focused models/operator/measurement tests: 67 passed.
- All six Firestore/config/user/media/query/callable architecture guards passed. Fixture still delivers 26 documents / 25 rows / 10,748 serialized bytes versus 196,332 baseline bytes (5.47%); one changed-row commit and zero unrelated row/chart commits. Budgets were preserved.
- Final production diff was reviewed against each finding; `git diff --check` passed.

## Scope and residual limits

Reviewed current production handlers and surrounding shared domain/config/media/operation contracts, deferred filtering and load-more focus, order reconciliation/backfill/cutover/rollback and realtime cursor behavior, media validation/retirement/cleanup, and duplication source fences/retry routing. No additional introduced defect was confirmed. Existing full-hash receipts cannot recover an unknown historical order value after it changes; that documented compatibility boundary remains. Persisted intents created by an older client with derived order in their digest are not automatically migrated by this client-only exclusion. Exact old-operation recovery and server receipt cleanup remain available; the regression guarantees stable identity for newly built intents.

No live deployment or live-project data mutation, merge, dependency installation, additional worktree, or primary-checkout edit was performed. The permanent `devs` checkout is preserved. Updated-head GitHub CI is verified separately after the authorized commit/push.
