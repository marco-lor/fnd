# fatins Media V2 canonical-only activation record

Date: 2026-08-15

Status: complete. Production `fatins` is serving the reviewed Media V2 runtime
with the live control in `canonical-only`.

This record contains production-only evidence. The reusable procedure is
[activation-runbook.md](activation-runbook.md), with the production boundary
and evidence checklist in
[fatins-production-migration.md](fatins-production-migration.md). Test project
counts, UIDs, reports, checkpoints, receipts, and approval fingerprints were
not used as production evidence.

## Backup, release, and starting state

- Verified Firestore point-in-time recovery and the ready production backup
  `5ee1f9b6-2d38-4350-9817-451e3b8b26ef`, whose snapshot time is
  `2026-08-14T13:20:01.487822Z`.
- Verified the production bucket is `fatins.firebasestorage.app`, has a
  seven-day soft-delete policy, and retained the immutable whole-bucket
  inventory used by this release.
- Verified the exact wildcard `v1-write` control before deployment and again
  immediately before planning the switch.
- Confirmed the active production webmaster in both Auth and `users/{uid}` and
  used a quiet window with no active Grigliata turn order.
- Deployed only the changed Firestore rules, the dependency-closed set of 31
  Functions, and Hosting, in that order, while the control still remained
  `v1-write`. No Function was added, deleted, or moved between regions.
- Verified the served bundle `main.3ef42d08.js` byte-for-byte against the local
  reviewed build. Its SHA-256 is
  `39466345db76c222c1fb7217d71cde7f3e9adee6ae359f4b6a62e6a29f2e26ad`.
- Firestore indexes, Storage rules, bucket CORS, App Check, and callable IAM
  were unchanged and independently verified rather than redeployed.

## Staging hygiene and preservation baseline

- The production-only staging scan found five old `.tmp-` objects belonging to
  one superseded token asset. An independent review proved that every object
  was byte- and metadata-identical to its manifest-bound canonical final and
  was absent from every active and legacy source.
- Executed only the generation-fenced cleanup plan with fingerprint
  `717255afe4f09bbf17ca9b3bdf5c19e930b7785514bbadc200ed448b39c2c4f7`.
  Exactly five temporary objects were deleted and the follow-up scan found
  zero temporary objects and zero issues.
- Took the immutable activation baseline after staging hygiene: 968 objects,
  580,447,674 bytes, zero invalid entries, zero duplicate names, fingerprint
  `1902b04fa17f863ad6bc3a4f094b635dc5ca10227eccd718138d8d341bbd9a4a`.

## Production repair and backfill

- The first all-source discovery failed closed because one existing duplicated
  Foe still referenced three missing nested legacy images. Its completed
  duplication receipt also retained a fourth root legacy reference required
  for rollback proof.
- Independently reviewed and restored only those four exact soft-deleted object
  generations with `ifGenerationMatch=0`. The restore could not overwrite a
  concurrently recreated object. Post-restore verification proved exact size,
  MIME, MD5, CRC32C, private metadata, operation binding, and target URL bytes.
- The post-restore inventory contained 972 objects. All 968 activation-baseline
  objects were unchanged; the four additions were exactly the reviewed legacy
  restorations.
- Replanned all 15 sources. The count-bound plan contained exactly four
  missing-canonical repairs: three nested Foe images and one nested Bazaar
  catalog-spell image. It had 205 separately hashed exclusions, zero errors,
  complete source coverage, and fingerprint
  `b1891df88c5500ad01d5d900beb3cb852379b3e34807cf36d08328281c9b6b17`.
- Executed only that approved plan. Durable receipt verification passed 4/4,
  and every retained legacy source remained present.
- The post-backfill/pre-control inventory contained 992 objects and
  583,627,314 bytes. No preserved object was missing or changed. The 24
  additions relative to the activation baseline were exactly four restored
  legacy objects plus four complete five-role canonical asset families.

## Canonical audit and control switch

- The count-bound active audit completed across all 15 sources with 336
  records, 183 verified candidates, 26 reviewed unplaced-Foe-token exclusions,
  zero errors, and fingerprint
  `0005731a453c0bc4738dadd17c90ca422e323d1300a566981df4bdd07375a5b2`.
- The independently reproduced control plan bound 340 unique documents: 183
  manifests, 146 targets, and 11 owners. It also bound 160 tokens, 97
  placements, seven canonical music tracks, and the current owner, target,
  manifest, token, placement, music, and control versions.
- Executed only control fingerprint
  `7515ca5071067ab8dd94f4bbaeb49477c0086ef63d0eb7c3d1a17eb704cd5d26`.
  The transaction re-read and rehashed every bound input before replacing only
  `utils/task07_media` from exact wildcard `v1-write` to exact wildcard
  `canonical-only`.
- The bounded music-stream readiness check completed after the write. There
  were zero active music sessions, and no Storage object was created, changed,
  or deleted by the control mutation.
- The immediate post-cutover audit reproduced the exact 183/26/0 counts and
  audit fingerprint. The immediate inventory was byte-identical to the
  992-object cutover inventory, and the temporary-object scan remained zero.

## Authenticated Browser acceptance

The in-app Browser used only the production test account.

| Surface | Acceptance evidence |
| --- | --- |
| Home | Character avatar plus equipped and inventory images rendered through authenticated media resolution. |
| Bazaar | Visible catalog images rendered after filter reset with no missing active media or diagnostic error. The production-only nested catalog repair remained covered by the full canonical audit. |
| Techniques and spells | Existing common technique images rendered in `canonical-only`; the account's media-free personal section remained valid. |
| Grigliata | The active dynamic-lighting map rendered, the character portrait and existing custom-token portrait rendered, and the turn order remained empty. |
| Disposable write flow | Created a test-account custom token with a PNG, verified its 96 x 96 authenticated blob, replaced it with a different PNG, reloaded and verified the replacement, deleted the token, then reloaded and proved it remained absent. |
| Browser diagnostics | No console warning or error was captured during the final read/write/reload pass. |

## Final preservation evidence

After the disposable Firestore record was deleted:

- the final active audit remained exactly 183 verified candidates, 26 reviewed
  exclusions, zero errors, and the same approved fingerprint;
- the final bucket inventory contained 1,002 objects and 583,734,017 bytes;
- all 992 post-backfill/pre-control objects remained present and unchanged;
- the only ten additions were two complete five-role canonical families from
  the intentional disposable upload and replacement; and
- the final staging scan found zero temporary objects, zero candidates, and
  zero issues.

The disposable record is gone. Its two immutable object families remain only
under the normal superseded/deleted-manifest retention and cleanup policy; they
are not referenced by an active target and must not be manually deleted merely
to reduce the inventory count.

Generated production evidence uses run ID `20260814T235035` under
`frontend/performance-results/`. That directory is ignored by Git. Preserve
the reports in the release archive before cleaning the checkout.

## Rollback boundary

The routine rollback remains a newly planned and independently reviewed
`canonical-only` to exact wildcard `v1-write` transition. It restores legacy
read fallback without disabling canonical writes. Do not use `legacy`, and do
not delete or rewrite canonical manifests, descriptors, receipts, restored
legacy objects, or canonical object families during the retention window.
