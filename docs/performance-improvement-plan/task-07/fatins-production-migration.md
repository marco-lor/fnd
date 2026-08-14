# Fatins production Media V2 migration procedure

Updated: 2026-08-14

This is the production replication checklist for applying the successful
`fatin-test` Media V2 procedure to `fatins`. The detailed commands and evidence
contracts are in [activation-runbook.md](activation-runbook.md). That runbook
must exist in the production checkout with `scripts/production-target.js`
binding exactly:

- project `fatins`;
- bucket `fatins.firebasestorage.app`;
- Hosting site `fatins`.

No `fatin-test` Firestore document, Storage object, UID, count, report,
checkpoint, receipt, or approval fingerprint is production evidence. Never
copy test data into production.

## Release boundary and backup

1. Work on the reviewed production `main` branch for this release with a
   clean tree. Record the starting commit and prove the fetched remote branch
   is still an ancestor before the final push.
2. Apply the reviewed code and documentation changes only. Rebuild generated
   outputs locally; do not copy `build`, `functions/lib`, ignored
   `performance-results`, credentials, or test evidence between repositories.
3. Diff the two source trees and classify every remaining difference as an
   intentional environment binding or a reviewed product difference. The
   `fatins` Firebase identifiers must remain production-specific.
4. Before any production write, take and independently verify a restorable
   Firestore export and Storage backup/snapshot using the production project.
   Record backup locations, generations, completion timestamps, and restore
   ownership outside the repository.
5. Take a fresh read-only whole-bucket inventory and archive it with the backup.
   Do not use a prior `fatin-test` inventory as its comparison baseline.

## Pre-cutover deployment while reads still fall back

1. Verify the current `utils/task07_media` document and require the exact
   wildcard `v1-write` contract before planning `canonical-only`. Stop if the
   mode, roles, purposes, UIDs, or control version differ.
2. Build and run the complete frontend, Functions, Task 07, rules, integration,
   and release-guard suites in the `fatins` checkout.
3. Obtain an independent code and deployment review. Deploy the changed
   Firestore rules first, the complete reviewed transitive Functions set
   second, and Hosting last while control remains `v1-write`. Firestore
   indexes, Storage rules, and bucket CORS are unchanged by this port: archive
   and verify their exact live production state instead of importing test
   settings. Confirm Function regions, IAM invokers, App Check, and the served
   bundle.
4. Use an authenticated production test account to smoke existing media in
   Home, Bazaar, personal techniques/spells, NPCs, Foes, and Grigliata before
   changing control. Do not perform the release during an active battle.

## Production-only migration evidence

Follow sections 0-3 of the activation runbook from the production `frontend`
directory:

1. Run the temporary-object hygiene discovery. Zero is accepted directly. A
   nonzero result requires a separately named immutable count-bound plan,
   item-by-item independent review, exact fingerprint approval,
   generation-fenced deletion, and a new baseline inventory. Never overwrite
   the discovery report with the bound plan. Eligible `.tmp-` objects must
   either have a verified canonical twin or have a `deleted` manifest, absent
   final, and exactly `complete` cleanup ledger; all other missing-final cases
   block.
2. Create an immutable all-15-source backfill discovery from production.
   Derive the production candidate count; do not assume any `fatin-test`
   candidate count applies to `fatins`. Write the count-bound backfill plan to
   a different file and archive both hashes.
3. Replan with that exact count, independently review the bound plan, execute
   it serially, preserve its checkpoint, and verify only the receipts signed
   into that production plan.
4. After receipt verification and due cleanup reconciliation, take the
   post-backfill/pre-control inventory and compare it with the immutable backup
   inventory. Classify every approved backfill addition. Any changed object
   blocks; any missing baseline generation blocks unless independently bound
   to a deleted manifest, complete cleanup ledger, and zero current reference.
5. Run the production canonical audit twice: discovery, then exact-count
   binding. Require complete source coverage, zero errors, zero truncation, and
   verified owner/role, target, manifest, object, token, music, nested-media,
   and legacy-source evidence.
6. Create a fresh production control dry-run from the approved production
   audit. Independently recompute its fingerprint and confirm the live control
   is still exact `v1-write`.

Any target, owner, object, count, manifest, or control drift invalidates the
plan. Freeze the maintenance window, discard stale approval artifacts, and
start again from fresh read-only evidence.

## Switch and acceptance

1. Execute only the reviewed production control fingerprint to
   `canonical-only`. The controller must complete its transaction-time target,
   relationship, owner, and music fences and its music projection wait.
2. Immediately rerun the bound canonical audit and compare Storage against the
   post-backfill/pre-control inventory. Require zero missing or changed cutover
   objects, then compare against the original backup inventory and reproduce
   only the archived approved-backfill additions and independently reconciled
   completed cleanup.
3. With the authenticated production test account, verify every critical media
   surface listed in activation-runbook section 5. Create, replace, reload, and
   delete only clearly disposable test media. Confirm authenticated blob URLs,
   no fallback dependence, and no console/network/App Check/CORS errors.
4. Wait for the disposable records' normal retention/cleanup state, then run a
   final canonical audit, full-bucket comparisons against both the cutover and
   original backup inventories, and a temporary-object cleanup dry-run bound
   to expected count zero. Browser additions must be explicit; pending cleanup
   alone never explains a missing object.
5. Archive the backup, before/after/final inventories, backfill plan and
   checkpoint, receipt verification, approved/final audits, control plan and
   result, deployment release IDs, browser evidence, reviewed commit, and both
   independent reviews.

## Rollback and retention

The routine rollback is a newly planned and reviewed `canonical-only` to
`v1-write` control transition. It restores legacy read fallback without
discarding canonical writes. Never use `legacy` as an emergency shortcut and
never delete canonical manifests, descriptors, receipts, or objects during
rollback.

Retain all legacy media and migration evidence for the agreed rollback window.
Physical legacy-media deletion is a separate destructive project requiring a
new full inventory, reference proof, backup, dry-run, independent review, and
explicit production authorization.
