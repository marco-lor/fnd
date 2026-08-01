# fatin-test V2 rollout record - 2026-08-01

This file records the isolated `fatin-test` rollout. It is not an authorization
to change `fatins`. All production replication must be separately reviewed,
must regenerate fingerprints from production state, and must keep explicit
rollback evidence.

## Current deployed state

- Project: `fatin-test` only.
- User Data: global `new-only`; 11 users verified; legacy drain completed and
  removed; zero final errors or warnings.
- Hosting build: fixed User Data stage `new-only` with dynamic rollout config
  disabled.
- Media: `v1-write` only. New eligible writes use canonical media, while reads
  retain legacy fallback.
- Media backfill: 180 of 180 receipts attached and verified.
- Media `canonical-only`: deliberately not activated.
- Production `fatins`: not changed by this rollout.
- Git: all changes remain uncommitted and there is no remote in the isolated
  repository.

## Cloud changes made

1. Deployed Firestore and Storage rules to `fatin-test`. The only later rules
   source correction simplified the Grigliata character-media expression
   without changing its authorization decision.
2. Did not replace the cloud index set: the nine deployed indexes were a
   superset of the seven checked-in indexes.
3. Deployed the reviewed explicit Function selectors; post-deploy callable
   checks were clean: 38/38 in `europe-west8`, 5/5 in `europe-west1`, and 1/1
   in `us-central1`.
4. Later deployed only
   `functions:task07ProcessMediaUpload` in `europe-west8` for the bounded
   legacy-map backfill path.
5. Deployed Hosting only after the hardened production build passed.

Never use a bare `firebase deploy` when reproducing this rollout.

## User Data V2 sequence and evidence

The guarded global cutover sequence was:

1. Final pre-cutover verification:
   `2894a79de7d23c448a683d82a3350cd1287ef5cd3c876e42a9a621e350c0d92e`.
2. Open drain plan and execution:
   `a8978588660f0f4da57b35a02ff9397f23159131d10edcf176ada6c318fe32fb`.
3. Drain backfill plan and execution, 11 unchanged users and zero errors:
   `da2a381bca019e775ddd588cba75b419ddf84dab3c4d5372ba03fef3c386f4a5`.
4. Frozen verification:
   `77cfe1ff72e6b0001dcc14037d60028df0864271eb76c51278687354f8ab49e9`.
5. Seal to `new-only`:
   `02b41eeb0105e58bb463065f4b10fef1e7c3cbe5fd585f82105681486f826db1`.
6. Sealed verification:
   `fe4425518bdf3e8acaa9862ad44ebfa1c5107f8d896b39f00a7ccd47efe68cd1`.
7. Complete/remove drain:
   `0369bd57c4c0ffc371894bc8795d6e86020281e438b113bc6eaeca635806d308`.
8. Final verification: 11 users, zero writes required, zero errors, zero
   warnings.

Saved evidence is under `performance-results/task05-*`. That directory is
ignored and must be preserved outside Git before workspace cleanup.

The Hosting build stage is fixed in
`scripts/forced-release-environment.js` as:

```text
REACT_APP_FND_USER_DATA_ROLLOUT_CONFIG=0
REACT_APP_FND_USER_DATA_STAGE=new-only
```

## Media V2 preparation sequence and evidence

1. Plan: 206 discovered records, 26 signed unplaced-foe exclusions, 180
   executable receipts, zero plan errors.
2. Exact approved backfill fingerprint:
   `e91b32fd3be30b12e6d775fa19da42168913d91a5669f60e33c6b3328faac208`.
3. Activated reversible `v1-write` with fingerprint:
   `7e63e1b4e28e6a990fdbcdaee1be7c65e78091091fc60aa06229d40ce4fca665`.
4. Executed the plan serially with checkpoint file
   `performance-results/task07-media-backfill-checkpoint-v1write-20260801.json`.
5. Final checkpoint: 180 processed, complete `true`, same approved
   fingerprint.
6. Read-only final verification fingerprint:
   `3feea8e5e8bf4f93be4774d5ff7f2955c538c4d70254da72f6a98dafbe5f7386`.
   Counts: 180 records, 180 verified/skipped, zero errors, zero exclusions.

Exact resume command used after each safe stop:

```powershell
$env:NODE_OPTIONS='--use-system-ca'
node scripts/task07/media-derivative-backfill.js `
  --project fatin-test --auth firebase-cli `
  --allow-live-project --confirm-project fatin-test `
  --catalog-owner-uid TQAmmVfIpOeNiRflXKSeL1NX2ak2 `
  --confirm-catalog-owner-uid TQAmmVfIpOeNiRflXKSeL1NX2ak2 `
  --source avatars --source catalog-items --source inventory-items `
  --source npcs --source foes --source custom-token-templates `
  --source foe-tokens --source common-technique-art `
  --source common-technique-video --source technique-art `
  --source technique-video --source spell-art --source spell-video `
  --source backgrounds --source music-tracks `
  --operation backfill --expected-candidates 180 `
  --page-size 25 --max-pages 20 --poll-timeout-ms 600000 `
  --report performance-results/task07-media-backfill-plan-v1write-20260801.json `
  --checkpoint performance-results/task07-media-backfill-checkpoint-v1write-20260801.json `
  --resume --execute `
  --approve-fingerprint e91b32fd3be30b12e6d775fa19da42168913d91a5669f60e33c6b3328faac208
```

These test-project IDs, counts, and fingerprints must not be reused for
production.

## Narrow migration corrections made

- One 9600 x 9600 legacy JPEG exceeded the normal 8192/32 MP upload policy.
  The global policy was not changed. A server-owned marker, exact migration
  receipt, current policy hash, source fingerprint, and approved plan
  fingerprint authorize a fixed 9600 x 9600 / 92,160,000-pixel decode ceiling
  for legacy map backfill only. Ordinary uploads retain 8192/32 MP.
- Failed map identity:
  receipt `r_006d734b3f7f45dc2c08d1aeceb644e9a860dbab`, asset
  `m_3a634509ff230d473faa928f5712bce8faa4eed6`. Recovery was one-shot and
  required the deleted manifest, exact decode error, complete cleanup queue,
  unchanged legacy source, and unattached target.
- Legacy background documents may omit `assetType`; an explicit conflicting
  value still fails. This aligns attachment with the existing planner.
- Foe-token source proofs initially saw the expected media attachment of their
  source foe as drift. The runner now accepts only an exact reconstruction of
  the reviewed pre-migration SHA-256 using that source foe's attached receipt
  and manifest. Any gameplay-field change, incomplete before-state, wrong
  plan fingerprint, or wrong receipt remains blocked.
- The migration runner and compiled adapters load one Firebase Admin SDK
  instance to avoid incompatible Timestamp/FieldValue realms.

## Validation performed

- Functions build passed.
- Functions lint: zero errors; three pre-existing warnings.
- Full Functions tests: 216/216 passed.
- Migration and rollout-controller tests: 44/44 passed after the final runner
  corrections.
- Focused adapter/processor tests: 26/26 passed.
- Hardened Hosting build and forced-environment tests: passed.
- Final Media verification: 180/180, zero errors.

## Deliberately deferred

- Do not activate Media `canonical-only` yet.
- Do not remove legacy Firestore documents or legacy Storage objects.
- Do not interact with or modify a Grigliata board as part of this stage.
- Do not deploy any additional Function, rule, index, or production resource.

## Manual test for this stage

1. Hard-refresh `https://fatin-test.web.app/home` and sign in.
2. Confirm the profile, resources, gold, inventory, equipped items, techniques,
   and spells load normally.
3. Make one small reversible User Data change and confirm it survives refresh.
4. Test one canonical media write only if desired; reads still have legacy
   fallback because Media remains `v1-write`.
5. Report any error before planning the separate `canonical-only` step.

## Production replication gates

Before changing `fatins`: preserve a fresh export, use a maintenance window,
apply the same reviewed code, deploy only explicit resources, regenerate every
plan/count/fingerprint from production, execute each guarded stage separately,
and verify after every write. The current operators intentionally hard-lock
live execution to `fatin-test`; extend that protection deliberately rather
than replacing project IDs by search-and-replace.
