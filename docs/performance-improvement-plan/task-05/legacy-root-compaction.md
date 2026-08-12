# Task 05 legacy-root compaction runbook

This runbook removes only the migrated User Data V2 fields from
`users/{uid}`. The identity, authorization, creation, profile, avatar/media,
and server summary shell remains in place, so application routes keep the same
root-document contract.

The operator is `frontend/scripts/task05/user-data-compaction.js`. It is dry-run
by default and is intentionally hard-locked to `fatin-test` for live access.
Applying the design to `fatins` requires a deliberate project-binding change,
a fresh review, and fingerprints generated from production state.

## Safety contract

Before a user can be compacted, the operator requires all of the following:

- global rollout mode is exactly `new-only`;
- there are no user overrides, active legacy drains, or completion lock;
- the exact completed global cutover attestation still exists and matches the
  sealed verification report durably recorded during completion;
- the root has `modelVersion: 2` and no active deletion;
- all five fixed V2 state documents exist with `schemaVersion: 2`;
- every document read from `inventory`, `spells`, `tecniche`, and
  `content_names` has `schemaVersion: 2`;
- the root, rollout config, deletion state, and fixed-state schemas still match
  inside the write transaction;
- the current plan exactly matches an error-free saved report and its approved
  SHA-256 fingerprint.

For each user, one Firestore transaction first creates an immutable archive of
every original root field under
`migration_state/user-data-v2/root_compaction_archives/{uid}` and then deletes
only the explicit migrated-field allowlist from the root. Each field has its
own archive document to stay below Firestore's document limit. The marker binds
the exact source, retained shell, legacy payload, field list, and field hashes.
An archive that is partial, oversized, malformed, tampered, or conflicts with
the current root blocks execution.

Reports contain subject hashes, counts, field names, and fingerprints only.
They contain no UIDs or field values. The ignored checkpoint contains the raw
document cursor required for exact resume and must never be committed.
The public report shape is recorded in
`frontend/scripts/task05/user-data-compaction-report.schema.json`.

## Test-project sequence

Run these commands from `frontend`.

1. After local tests and independent review are green, deploy the archive-aware
   account-deletion Function before creating any compaction archive:

   ```powershell
   npm.cmd run fb:deploy:delete-user
   ```

   This prevents an account deletion from completing during compaction without
   also removing and inspecting the new archive namespace.

2. Produce a new redacted dry-run plan:

   ```powershell
   npm.cmd run users:compact-v2 -- `
     --project fatin-test --auth firebase-cli `
     --cutover-id fatin-test-v2-20260801 `
     --cutover-verification-report `
       performance-results/task05-drain-verify-sealed-20260801.json `
     --report performance-results/task05-compaction-plan-20260812.json `
     --allow-live-project --confirm-project fatin-test
   ```

3. Review that the plan has zero errors and preserve the printed fingerprint.
   Do not edit the report.

4. Execute only that report and fingerprint:

   ```powershell
   npm.cmd run users:compact-v2 -- `
     --project fatin-test --auth firebase-cli `
     --cutover-id fatin-test-v2-20260801 `
     --cutover-verification-report `
       performance-results/task05-drain-verify-sealed-20260801.json `
     --execute `
     --approved-report performance-results/task05-compaction-plan-20260812.json `
     --approve-fingerprint <exact-plan-fingerprint> `
     --checkpoint performance-results/task05-compaction-checkpoint-20260812.json `
     --result performance-results/task05-compaction-result-20260812.json `
     --allow-live-project --confirm-project fatin-test
   ```

5. If execution stops after one or more verified users, rerun the same command
   with `--resume`. Never regenerate or edit its checkpoint.

6. Run an independent read-only verification:

   ```powershell
   npm.cmd run users:compact-v2 -- `
     --project fatin-test --auth firebase-cli --verify `
     --cutover-id fatin-test-v2-20260801 `
     --cutover-verification-report `
       performance-results/task05-drain-verify-sealed-20260801.json `
     --report performance-results/task05-compaction-verify-20260812.json `
     --allow-live-project --confirm-project fatin-test
   ```

   Acceptance requires zero pending users, every subject classified as
   `compacted` or native V2, zero subject/global issues, unchanged V2 document
   counts, and the same plan fingerprint. `counts.legacyFields` remains the
   historical number of allowlisted fields preserved in verified archives; it
   is not a count of fields still present on compacted roots.

## Deployment and browser acceptance

Compaction changes Firestore data but does not change client contracts, rules,
indexes, or Storage. It does extend the existing user-deletion Function so
account deletion also removes and verifies both Task 05 archive namespaces.
Deploy that explicit Function before compaction as required above. Deploy
Hosting after compaction verification. Then use the logged-in DM account to
verify Home, inventory,
equipment, spells, techniques, Bazaar/DM views, Combat, and Grigliata. Perform
at least one small reversible V2 mutation, reload to prove persistence, and
restore the original value. Inspect browser errors and warnings after the
reload.

The deployment selectors are intentionally narrow:

```powershell
# Before compaction:
npm.cmd run fb:deploy:delete-user
# After compaction verification:
npm.cmd run fb:deploy:hosting
```

Do not deploy a bare `functions` or `all` selector for this change.

## fatin-test result - 2026-08-12

- `deleteUser(europe-west8)` was deployed before the first compaction write;
  postdeploy IAM verification remained clean for 38 west8, 5 west1, and 1
  us-central1 managed callables.
- The approved live plan covered 11 users and 128 allowlisted historical root
  fields, with 283 archive documents, 55 fixed V2 state documents, 136 V2
  collection documents, and zero errors.
- Plan and execution fingerprint:
  `ddb1e6087a6431c1dd06ff548112834e8eb1cff1477b1000d2f83804d6494c53`.
- Execution processed all 11 users. Final verification classified all 11 as
  `compacted`, with zero pending users, zero subject/global issues, all 283
  archive documents verified, and unchanged V2 counts.
- Hosting redeployed the unchanged client contract with
  `main.18633ba6.js` and `route-grigliata.433c2146.chunk.js`.
- Logged-in DM Browser acceptance passed for Home, DM Dashboard,
  Tecniche/Spell, Bazaar, Combat, and Grigliata. HP `28 -> 27 -> 28` and the
  Grigliata shared-music preference `muted -> enabled -> muted` each persisted
  across reload and were restored. The final browser diagnostic log was empty.

## Recovery and production replication

The per-user transaction prevents an unarchived deletion. An interrupted cohort
is intentionally mixed: completed users have verified archives and compacted
shells, while later users are untouched. The same approved fingerprint remains
stable because already compacted roots are reconstructed from their archives.

Do not switch away from `new-only` after compaction: legacy projections are no
longer present. A rollback must first pause V2 mutations, reconstruct and merge
the archived legacy fields, verify both the exact archive and materialized root,
and only then change rollout mode. That restore path is intentionally not part
of this live-delete operator and requires its own review.

Before repeating this in `fatins`, preserve a fresh project export, use a
maintenance window, confirm zero legacy consumers, inspect existing migration
and compaction archives, regenerate all counts and fingerprints, review the
retargeted hard lock independently, execute one guarded stage at a time, and
repeat the full browser acceptance against production data.
