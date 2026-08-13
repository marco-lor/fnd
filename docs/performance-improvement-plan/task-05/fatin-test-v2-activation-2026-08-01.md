# fatin-test User Data V2 activation record - 2026-08-01

> Historical activation record, superseded on 2026-08-12. The original
> activation ended in `new-read-dual-write`; that is no longer the runtime or
> deployed data plane. Current evidence lives in
> [`frontend/FATIN_TEST_V2_ROLLOUT_20260801.md`](../../../frontend/FATIN_TEST_V2_ROLLOUT_20260801.md)
> and [`legacy-root-compaction.md`](./legacy-root-compaction.md).

## Current status

`fatin-test` is now permanently V2-only for migrated user data:

- the global cutover completed at `new-only` for all 11 users;
- migrated fields were transactionally archived and physically removed from
  every `users/{uid}` shell;
- frontend domain reads use only V2 state documents and collections;
- server mutations write only V2 domains plus the intentionally small user
  shell;
- the V1 callable aliases, derived-root triggers, legacy normalizers, rollout
  resolver, dual-write paths, and rollback bridge were retired after the test
  environment's rollback-retention window;
- the private `app_config/user_data_v2` record and the offline migration,
  cutover, compaction, verification, and reconstruction tools remain as
  historical/production-replication evidence. They are not consulted by the
  webapp runtime;
- production project `fatins` was later aligned independently on 2026-08-13;
  no test-project approval, count, UID, or fingerprint was reused.

There is no supported runtime switch back to V1 in this source revision. A
production rollout was not permitted to copy the retirement commit until
`fatins` independently completed and verified its own `new-only` cutover,
retention period, and physical compaction; that guarded sequence is now complete.

## What happened on 2026-08-01

This section is retained only as historical evidence. At that time the isolated
project was deliberately left in `new-read-dual-write`:

- the frontend read V2;
- supported server mutations wrote V2 and legacy root projections;
- legacy root fields were preserved;
- no new-only drain, archive, deletion, or destructive cleanup occurred;
- only `fatin-test` Firestore and Hosting were changed.

Historical source and release identifiers:

- repository: `C:/Users/Marco/OneDrive/git_projects/fatins-test`;
- starting commit: `c5d38d532221620d6cc00f2a62bac357df6bc7b9`;
- activation commit: `5056d4a`;
- Hosting release:
  `projects/fatin-test/sites/fatin-test/channels/live/releases/1785582111346000`;
- Hosting version: `projects/fatin-test/sites/fatin-test/versions/855bbe11c4a55ca9`;
- historical asset: `/static/js/main.9eb00d76.js`;
- historical config hash:
  `b219cd1c2b2c3fd96303e8df3be71a1f021ced807963b8086db528be50a93a73`.

## Historical activation sequence

Every write used a dry-run fingerprint and explicit `fatin-test` confirmation.
The sequence was:

1. `legacy-read -> shadow-verify`.
2. Stabilize legacy identifiers: 11 users, 7 writes, 4 unchanged, 0 issues.
3. Initial V2 backfill: 11 writes, 0 issues.
4. Verification found 6 pending writes and 7 errors, so rollout stopped.
5. Idempotent convergence repair: 6 writes, 5 unchanged, 0 issues.
6. Immediate and settled verification: 11 unchanged, 0 issues; fingerprint
   `1523aa1f847d9f5733339a3ba42157cf948f20ffc9813703a5e723ee0a64310e`.
7. `shadow-verify -> dual-write`, followed by a clean verification.
8. `dual-write -> new-read-dual-write`, followed by a clean verification.

The source-boundary checker then reported a historical migration baseline of
42 explicitly tracked legacy files. That number described the 2026-08-01
transition build; it is not the current runtime baseline.

## Superseding cutover and cleanup

The later guarded sequence opened the legacy drain, reverified all 11 users,
sealed `new-only`, removed the drain, and then compacted the migrated root
fields. The compaction archived each full source root outside `users/{uid}`
before deleting only the explicit migrated-field allowlist. Final verification
reported 11 compacted users, zero pending subjects, and zero issues.

The current source-boundary contract is:

- zero tracked production aggregate-root accesses outside the dedicated user
  shell adapter;
- zero runtime V1 read/write paths;
- zero runtime reads of rollout stage or drain state;
- account deletion discovers owned media in both migration archive formats,
  recursively deletes those archives, and verifies their removal;
- Firestore rules permanently reject migrated user-data fields on root shells.

## Production replication record

The test-project counts, UIDs, fingerprints, and deployment identifiers were not
reused. The production rollout satisfied the required sequence:

1. preserved a fresh export and immutable cutover evidence;
2. deployed the archive-aware account-deletion Function before creating any
   compaction archive;
3. ran the legacy-compatible migration/cutover source through production's own
   guarded `new-only` sequence;
4. honored the separately approved rollback-retention decision;
5. regenerated production counts and fingerprints, compacted, and verified;
6. only then applied the V2-only runtime-retirement source and deployed explicit
   Functions, rules, and Hosting targets.

The retained offline tools deliberately still understand historical rollout
stages and reconstruction. Their presence is migration support, not an active
compatibility data plane.
