# fatin-test Media V2 canonical-only activation record

Date: 2026-08-14

Status: complete. `fatin-test` is serving the reviewed Media V2 runtime with
the live control in `canonical-only`.

This record is evidence for the test rollout. The reusable production
procedure is [activation-runbook.md](activation-runbook.md). Never copy this
record's UID, counts, report fingerprints, object inventory, or approvals to
`fatins`; production must discover and independently review its own values.

## Release and cutover

- Deployed the reviewed Functions, Firestore rules, and Hosting planes while
  the control was still the exact wildcard `v1-write` contract.
- Verified all expected callable routes and IAM bindings after deployment.
- Took a bucket-wide read-only baseline before any migration: 1,026 objects,
  594,934,729 bytes, zero invalid entries, and zero duplicate names.
- Planned and independently reviewed a bounded backfill. It contained exactly
  seven missing nested-media targets: one Bazaar catalog spell and six Foe
  spell/technique images. The plan was complete across all 15 sources, with
  zero errors and fingerprint
  `8873270b0ff80070c5b0f2f210ab9af3c589bf30b7e1fd7ce903945caeff66f4`.
- Executed only that approved seven-entry plan. Receipt verification passed
  7/7, and the original seven legacy objects remained unchanged.
- The post-backfill inventory contained 1,061 objects. All 1,026 baseline
  objects were present and byte/metadata-identical; the 35 additions were the
  expected five immutable roles for each repaired target.
- Ran the active canonical audit twice with the bound expected count of 185.
  Both reports were complete with 185 verified candidates, 28 reviewed
  unplaced-Foe-token exclusions, zero errors, and fingerprint
  `c3371275cdd71ae769deb04b4ab6e2dcff61f6a949b347d42a0e00fbfe1417d0`.
- Independently reviewed and executed the single transaction-fenced control
  mutation. Its approved plan fingerprint was
  `7bdaeda0555c692e01935c4c2ad0de1265905091f46de69708386cade1bb235d`.
  The transaction re-read all 341 bound documents plus current token, music,
  owner, and control evidence before changing only `utils/task07_media` to
  `canonical-only`.
- The music readiness fence completed after the control write. No legacy or
  canonical Storage object was deleted by the cutover.

## Browser acceptance

The authenticated in-app browser used a DM account against the deployed site.

| Surface | Acceptance evidence |
| --- | --- |
| Home | Character avatar rendered through an authenticated `blob:` URL at 128 x 128. |
| Bazaar existing data | Catalog root media and the previously omitted `Catena del Predatore` nested spell rendered after canonical backfill. |
| Bazaar disposable flow | Created an accessory with root image plus nested-spell image, reloaded it, replaced both images, reloaded again, and deleted the item. Both replacement derivatives rendered through authenticated `blob:` URLs. |
| Foes existing data | Existing Foe root, technique, and spell images rendered through authenticated `blob:` URLs. |
| Foes disposable flow | Created a Foe with root, technique, and spell images; reloaded it; duplicated it through the durable canonical clone path; verified distinct working root/nested assets and canonical edit previews; deleted clone and source. |
| Techniques and spells | Existing common technique media rendered through authenticated `blob:` URLs; media-free entries remained valid placeholders. |
| Grigliata | Active map, DM Gallery, and shared music loaded in canonical-only. Music advanced while playing and was restored to paused. |
| Browser diagnostics | No console warnings or errors were captured during the final browser pass. |

## Final preservation evidence

After every disposable Firestore record was removed:

- the final active audit remained exactly 185 verified candidates, zero
  errors, and the same approved fingerprint;
- the final bucket inventory contained 1,111 objects and 672,298,993 bytes;
- all 1,026 baseline objects remained present and unchanged; and
- all 85 additions were accounted for: 35 backfill derivatives plus 50
  derivatives from ten intentional browser upload, replacement, and clone
  operations.

The disposable records are gone. Their immutable object families remain only
for the normal superseded/deleted-manifest retention window and server cleanup;
they are not referenced by active targets. Do not manually delete them to make
the inventory count smaller.

Generated local evidence files use the `20260814` suffix in
`frontend/performance-results/`, including the baseline/final inventories,
backfill plan/checkpoint/verification, approved/final audits, and control plan.
That directory is ignored by Git, so an operator must copy these artifacts to
the release archive before cleaning the checkout.

## Production replication boundary

Use the activation runbook from a clean, reviewed `fatins` checkout. The safe
order is mandatory:

1. discover the production Firebase target and active webmaster; take a new
   bucket inventory and backup, and verify the exact starting control;
2. build the production Functions contracts and generate an unbound all-source
   backfill plan;
3. bind the discovered candidate count, independently review the exact report,
   and execute only its fingerprinted missing-canonical repair set;
4. verify only those receipts and prove every production baseline object is
   still present and unchanged;
5. generate a fresh expected-count canonical audit, then independently review
   the production-only control plan;
6. deploy reviewed runtime/rules first if production is not already on the
   exact code, repeat the evidence after deployment, and use a quiet window
   outside any live Grigliata battle;
7. execute only the transaction-fenced production control plan, then repeat
   audit, browser mutation tests, and bucket preservation inventory; and
8. retain `v1-write` as the immediate rollback mode. Do not use `legacy`
   without a separate record-by-record compatibility proof.

Any count, version, owner, object, target, manifest, relationship, or control
drift invalidates the approval and requires a fresh production plan and review.
