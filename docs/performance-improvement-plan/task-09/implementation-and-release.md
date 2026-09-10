# Task09 Bazaar catalog implementation and release status

The default Bazaar loads 50 catalog summaries at a time and fetches full detail on demand. Search, combined filters and stat sorting preserve the existing result semantics through measured Firebase-only scans of the actor-visible catalog. Advanced filtered loads are deliberately not page-bounded.

## Implementation

- Trusted catalog page/detail/write callables, deterministic ranks, cursor/revision fencing, visibility checks, projection indexes and guarded source/summary/media updates.
- Four editors and deletion use trusted catalog writes. Task07 media lifecycle updates retain catalog projections; acquired inventory snapshots remain independent of catalog changes.
- Shared bounded detail cache, delayed hover reads, immediate pinning, stable comparison panel, memoized cards/filters and debounced search/persistence.
- Resumable catalog migration with reviewed plans, state/code/runtime checks and exclusive backups before writes. The live operator binds production to main/fatins and staging to devs/fatin-test; the separate performance operator is emulator-only.

## Verification and known limits

Fresh pre-commit checks on September 9, 2026:

- Functions build and unit suite: 220 passed.
- Performance harness unit suite: 489 passed.
- New Task09 migration/overlay/profile/build-mode checks: 27 passed.
- Release guards: 62 passed.
- Frontend full suite after PR remediation: 165 suites and 1,549 tests passed with the default timeout. The Inventory test previously spent over five seconds repeating whole-DOM accessibility queries before its filter assertions. Its 120-item fixture now expands with one explicit click and verifies the button disappears; both filter/reset assertions remain.
- Strict CI normal build, disabled-instrumentation verification, query/import/callable/media boundary checks and 23 focused query/browser-harness tests passed. The query registry now describes the revision listener and three catalog indexes. Browser setup activates the seeded catalog with background triggers disabled and accounts for Task09 HTTP calls as foreground activity.

Prior isolated emulator evidence includes catalog visibility/rules, trusted writes, price/idempotency and media lifecycle coverage. These checks are distinct from actual staging acceptance.

On the richer 1,000-item fixture (950 player-visible), the default page measured 50 summary reads and 24,649 estimated catalog JSON bytes, versus 950 reads and 850,438 bytes for the old full reader. Mounted DOM measured 913 nodes versus 53,982. Advanced scans still read all 950 visible summaries. These are observed fixture measurements, not universal latency guarantees.

Full Task09 performance acceptance remains open: the real 20-card rapid cold/warm pointer trace is unverified, and cold commit p95 was not repeatably within 16.7 ms. One remaining-gates run explicitly skipped the rapid trace. Do not mark these gates passed from the unit suite or staging smoke.

## Staging verification

September 6 deployment to fatin-test included seven catalog/media Functions, Firestore rules/indexes and Hosting. All three catalog indexes reached READY. Migration activated generation1/revision2 with 59 source items, 59 summaries and 59 media documents; source business fields were unchanged. Temporary backend smoke identity was removed after testing first-page50, 53 unique visible rows across two pages, full detail, advanced search and anonymous rejection.

September 9 manual QA reused the user's existing in-app player tab. The loaded script was main.f8a0a331.js. Images, 50-card first page, three-card last page, pinned Arco Corto detail across page/search changes, substring plus affordability filters, persistence after reload, empty/reset states, sort selection, purchase dialog cancellation and Home/Bazaar navigation passed. Error-level Browser logs were empty. No purchase was confirmed and no business data was changed. Admin editing, completed purchases and numerical sort correctness were not independently exercised in this live pass.

## Staging migration runbook

Run from frontend on the actual devs branch using the same Node/ICU runtime as the reviewed plan. Deploy the required Functions and rules/indexes through the repository's guarded staging wrapper, then wait for indexes to become READY. Never run raw firebase deploy.

Create a fresh read-only plan:

```powershell
node --use-system-ca scripts/task09/catalog-migration.js --environment staging --project fatin-test --site fatin-test --bucket fatin-test.firebasestorage.app --mode inspect --action begin --output performance-results/task09-staging/begin-plan.json
```

Review counts, hashes, control state, runtime identity and planHash, then apply that exact plan:

```powershell
node --use-system-ca scripts/task09/catalog-migration.js --environment staging --project fatin-test --site fatin-test --bucket fatin-test.firebasestorage.app --mode apply --action begin --confirm-target fatin-test --plan performance-results/task09-staging/begin-plan.json --reviewed-plan-hash REVIEWED_SHA256 --backup performance-results/task09-staging/begin-backup.json --output performance-results/task09-staging/begin-report.json
```

Repeat inspect/review/apply for step with unique filenames until the projected catalog is complete, then activate with another fresh plan. Steps project up to150 items. Require unchanged business hash, active generation, matching ICU and complete summary/media projections. Verify a deployed callable before Hosting rollout. Never replay an old plan after mutation.

Backups include private catalog cursor data: retain them locally under ignored performance-results, never print or commit them. On failure retain artifacts and inspect actual state before retry; a post-commit error can mean the mutation succeeded. Rollback only marks the catalog inactive; it does not restore backups or source documents.

## Production migration and rollout

The new reader requires catalog projection activation. Production migration uses only existing fatins data. It adds catalogVersion metadata to valid source items, derives summaries/media records, cleans orphan media projections and activates catalogControl/bazaar. It does not alter item business fields or owned inventory. Catalog and catalog-media writes are fenced during building. Rollback marks the catalog inactive and requires serving the previous frontend; it does not restore data.

Run from frontend on the actual main branch with Node 22 and the reviewed Node/ICU identity. The operator rejects mixed project/site/bucket values, conflicting environment variables, emulator configuration, staging plans and reused artifacts before writing. Each apply requires an exact target confirmation, fresh plan hash and exclusive local backup.

1. Take and validate a fresh recursive fatins Firestore backup; retain the previous Hosting release and backend/rules configuration for recovery.
2. Run npm run fb:deploy:task09:functions and npm run fb:deploy:task09:rules. These deploy the three catalog callables, four catalog/media integrations and Firestore rules/indexes. Wait for catalog indexes to reach READY.
3. Inspect the production source using the command below; review counts, control, code/runtime identity and hashes. Apply that exact begin plan with a unique backup/report path.
4. Repeat fresh inspect/review/apply for step until all items are projected (up to 150 per step), then for activate. Require unchanged source business hash, complete summary/media projections and matching generation/ICU.
5. Verify deployed page/detail callables and visibility, then run npm run fb:deploy:hosting. Verify the deployed bundle and authenticated Bazaar flow. The numerical performance gates above remain separate.

```powershell
npm.cmd run catalog:migrate -- --mode inspect --action begin --output performance-results/task09-production/begin-plan.json
npm.cmd run catalog:migrate -- --mode apply --action begin --confirm-target fatins --plan performance-results/task09-production/begin-plan.json --reviewed-plan-hash REVIEWED_SHA256 --backup performance-results/task09-production/begin-backup.json --output performance-results/task09-production/begin-report.json
```

Never copy staging catalog data or reuse staging fingerprints. Retain private backups under ignored local paths. After any failure inspect current state before retry; the transaction may already have committed.
