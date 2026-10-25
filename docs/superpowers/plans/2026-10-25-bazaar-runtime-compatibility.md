# Bazaar runtime compatibility implementation plan

> Execute the authorized fix autonomously. Use tests first, independent review, and staged deployment. User explicitly delegated implementation choices, PR creation/review/merge and staging/production deploys.

**Goal:** Restore an active Bazaar across ICU runtime updates without rewriting production data or changing its materialized order.

**Design:** Treat the stored rank as the authoritative catalog order. Readers, details, deletes, unchanged-name edits and media synchronization do not depend on ICU equality. New items and renames may allocate a rank only after validating that the remaining stored ranks agree with the current comparator. Migration building/resume/activation retain strict runtime compatibility.

**Alternatives considered:** Rebuilding the catalog with Cloud ICU can restore service but repeats the outage after a runtime update and requires production writes. Removing the ICU guard alone permits inconsistent filtered ordering and unsafe allocations. Persisted ranks plus checked allocations is the smallest repair preserving the existing data contract. A bundled, versioned collator is a larger future change.

## Constraints and review focus

- main maps only to fatins; devs maps only to fatin-test. Never bypass target guards.
- Do not remove active-state, schema, collation, revision, cursor, visibility, generation or authentication checks.
- Production data must remain intact; no migration is needed for an already-active valid projection.
- Filter/stat ties use stored rank, including a historical order different from the current ICU comparator.
- Only create/rename may be blocked by incompatible ordering; safe edits/delete/media must remain usable.
- Rank duplicates, nonfinite values and exhaustion must reject before transaction writes.
- Migration cannot resume or activate a building generation under different ICU.
- Deploy and manual acceptance require Firebase credentials and browser access. These are currently missing; finish unaffected code/review/PR work and report any remaining block accurately.

## Task 1: Runtime-safe readers and mutations

Files: functions/src/bazaarCatalog.ts, functions/src/bazaarCatalogCore.ts, functions/test/bazaarCatalogRuntime.test.js, functions/test/bazaarCatalogCore.test.js.

- [x] Add failing real-handler transaction tests for historic ICU page/detail, unchanged-name update, delete, media synchronization and guard preservation.
- [x] Add failing core tests for rank ordering of filtered/stat ties and checked rank allocation.
- [x] Run those tests and confirm intended failures before implementation.
- [x] Implement separate reader compatibility and migration runtime checks, persisted rank tie-breaking, unchanged-name rank reuse and checked allocation.
- [x] Build Functions and run focused then full Functions tests plus catalog migration tests under Node 22.

## Task 2: Repeatable emulator coverage

Files: scripts/performance/rules-emulators.js, scripts/performance/rules-exec.js, associated tests, performance/tests/task09b-catalog.test.js, package.json.

- [x] Add an explicit catalog emulator entry point using the existing safe demo-project wrapper and existing Task09 catalog/rules/media suites.
- [x] Correct expected-result fixtures to materialize unique ranks exactly as migration does.
- [x] Add historical ICU acceptance coverage where practical and run real emulator integration.
- [x] Run frontend Bazaar tests and release/boundary checks appropriate to the change.

## Task 3: Review, integration and live acceptance

- [x] Update the release runbook for scoped Functions deploy and no-data-write recovery of active projections.
- [x] Independent code review, fix actionable findings, verify final diff and tests.
- [ ] Push branch; create and attach PR targeting devs; record review and merge once checks pass.
- [ ] On actual devs inspect authenticated staging metadata, deploy affected Functions and manually test Bazaar pages/search/filter/stat sort/details, visibility, editor create/update/rename/delete, root/nested media and purchase compatibility with test data.
- [ ] Only after staging acceptance, open/review/merge promotion PR to main; inspect production read-only, deploy affected Functions, and run non-destructive authenticated manual checks. Preserve rollback artifacts.
- [ ] Mark goal complete only with actual live verification; otherwise stop as blocked with exact outstanding access and work.

## Progress ledger

- Baseline branches: main = devs = 4b0810d250b107d71ad5f0906c8ee2c9015ec20e.
- Existing public Hosting/runtime configuration verified for both environments. Live metadata is protected and Firebase CLI has no authenticated account. No browser tool is available.
- Ruling: user delegated implementation and release decisions; proceed without extra design approval. Keep all environment safety guards.

- Task 1 complete: Functions build; 333/333 Functions + migration tests under Node 22.22.2/ICU 78.2; 31/31 catalog tests also passed under Node 22.23.4/ICU 78.3.
- Task 2 complete: 10/10 catalog/rules/real media/purchase emulator tests, 52/52 release/harness tests, initial 39/39 targeted frontend tests and query/callable/media boundary checks passed.
- Independent review found an orphan-summary rank reuse edge case; regression observed failing, then fixed by restricting reuse to existing source documents. No blocking findings remain.
- Firebase login now available. Live metadata both active/schema1/en-US/ICU78.2. A temporary owned QA identity reproduced staging FAILED_PRECONDITION through the deployed callable. Existing catalog data was not changed.
- Browser cloud is installed but TLS trust setup was rejected by automatic review; explicit user approval is pending. No bypass used.
