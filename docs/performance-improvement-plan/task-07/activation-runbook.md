# Task 07 canonical-only activation runbook

Updated: 2026-08-14

This is the successful, loss-preserving procedure for switching Task 07 Media
V2 from `v1-write` to `canonical-only`. It is deliberately environment-bound:
the scripts import `scripts/production-target.js`, so the `fatin-test` checkout
cannot operate on `fatins` and the production checkout cannot reuse test
approvals.

The cutover changes only `utils/task07_media`. It does not delete Firestore
fields, manifests, receipts, staging objects, legacy objects, or canonical
objects. Retain legacy media for rollback until a separately reviewed retention
decision is approved.

## Required state

- The exact deployed client and Functions understand `canonical-only`.
- Firestore and Storage rules, callable IAM, App Check, and exact-origin bucket
  CORS are already deployed and verified.
- Current control is the exact wildcard `v1-write` contract.
- Canonical writes, replacement, retirement, cleanup, Grigliata tokens, map
  image/video, and music have passed browser and integration tests.
- Work from a clean reviewed commit and a quiet media-maintenance window. Do not
  cut over during a live Grigliata battle or while another operator is changing
  media.
- Archive the deployed release, control document, rules, indexes, Functions,
  App Check/CORS state, and every generated report outside the ignored
  `performance-results` directory.

## Why historical backfill receipts are not the activation gate

Receipts remain the durable backfill/rollback ledger, but they describe the
asset and policy at migration time. A later compatible policy correction or a
legitimate replacement can make a historical receipt differ from the current
target even when current canonical media is healthy.

Activation therefore requires `canonical-audit`, which scans every current
media-bearing target across all 15 source families. It includes records with no
legacy path, such as newly uploaded map videos. It mirrors the client image
resolver precedence (`media`, then `General.media`) and video precedence
(`videoMedia`, then `General.videoMedia`, then the compatible media fallback).
Every non-empty media, path, or URL declaration is a candidate; malformed,
foreign-bucket, loopback-live, or external declarations block instead of
disappearing from the scan. For each active target it binds:

- target path, slot, revision, fingerprint, and Firestore update version;
- owner derived from the personal target path or explicit global provenance,
  with an active-role check and webmaster-only fallback for truly ownerless
  global records;
- attached manifest identity, plan, generated descriptor, and update version;
- exact current policy variant set, MIME/byte/dimension/duration budgets, valid
  SHA-256 checksums, role-specific WebP derivative dimensions, and private-only
  metadata with no Firebase download token;
- every immutable Storage path, generation, byte count, MIME type, checksum,
  cache contract, and Task 07 custom-metadata identity; and
- every still-referenced legacy Storage object.

Unplaced foe-token roots are preserved as hashed exclusions only when the
runtime proof confirms they are non-rendering. Placed foe roots, custom token
templates, character/template/placement relationships, and every music track
remain mandatory.

## Operator variables

Use values discovered in the target checkout. Never copy the UID, count, or a
fingerprint between `fatin-test` and `fatins`.

Start at the target checkout root, verify the reviewed branch and clean tree,
then enter the package that owns every command below. Stop if either assertion
does not match the reviewed release:

```powershell
git status --short --branch
git rev-parse --show-toplevel
Set-Location frontend
node -e "const t=require('./scripts/production-target'); console.log(t)"
```

```powershell
$ProjectId = '<target from scripts/production-target.js>'
$WebmasterUid = '<active webmaster UID in Auth and users/{uid}>'
$DateTag = '<YYYYMMDD-HHmmss-unique-run-id>'
$env:NODE_OPTIONS = '--use-system-ca'
```

The source arguments used in every live audit are:

```powershell
$Sources = @(
  'avatars', 'catalog-items', 'inventory-items', 'npcs', 'foes',
  'custom-token-templates', 'foe-tokens', 'common-technique-art',
  'common-technique-video', 'technique-art', 'technique-video',
  'spell-art', 'spell-video', 'backgrounds', 'music-tracks'
)
$SourceArgs = $Sources | ForEach-Object { @('--source', $_) }
```

PowerShell flattens `$SourceArgs` when passed to the command below. Review the
printed `sourceKeys` and stop unless all 15 appear in that exact order.

Build the exact Functions contracts before the first audit. The audit refuses
to trust a missing or stale `functions/lib` contract:

```powershell
npm --prefix functions run build
```

## 0. Canonical staging-object hygiene

The media processor promotes generated files through `.tmp-<eventId>` copies.
The reviewed runtime records and retries deletion of those copies, but an older
release may have left staging copies behind. They are not legacy media and are
not renderer inputs. Discover them before taking the cutover baseline:

```powershell
$TemporaryDiscovery = "performance-results/task07-media-temporary-discovery-$DateTag.json"
$TemporaryPlan = "performance-results/task07-media-temporary-plan-$DateTag.json"

node scripts/task07/media-temporary-object-cleanup.js `
  --project $ProjectId --confirm-project $ProjectId `
  --allow-live-project --auth firebase-cli `
  --report $TemporaryDiscovery
```

If `counts.candidates` is zero, require `complete: true` and archive the report.
If it is nonzero, do not delete from an unbound discovery. Record the count,
rerun with `--expected-candidates <exact count>`, and independently review every
entry. Each eligible entry must be a `.tmp-` generation with a byte-identical,
manifest-bound canonical final, or a residue whose manifest is `deleted`, final
is absent, and cleanup ledger is exactly `complete`. Any other missing final,
checksum/metadata mismatch, uncommitted manifest, or identity issue blocks
cleanup.

```powershell
$TemporaryCount = '<exact candidates from discovery>'

node scripts/task07/media-temporary-object-cleanup.js `
  --project $ProjectId --confirm-project $ProjectId `
  --allow-live-project --auth firebase-cli `
  --expected-candidates $TemporaryCount `
  --report $TemporaryPlan
```

The second accepted category is a temp copy whose manifest is already
`deleted`, canonical final is absent, and cleanup ledger is exactly `complete`.
This closes residue left by an older cleanup release without treating a
missing live final as safe. Every other missing-final case blocks.

Execute only the exact reviewed bound plan, writing the result to a different
file:

```powershell
$TemporaryFingerprint = '<exact fingerprint from the reviewed bound plan>'
$TemporaryExecution = "performance-results/task07-media-temporary-execution-$DateTag.json"

node scripts/task07/media-temporary-object-cleanup.js `
  --project $ProjectId --confirm-project $ProjectId `
  --allow-live-project --auth firebase-cli `
  --expected-candidates $TemporaryCount `
  --execute --approved-report $TemporaryPlan `
  --approve-fingerprint $TemporaryFingerprint `
  --report $TemporaryExecution
```

Archive both immutable reports and their hashes; never overwrite discovery
evidence with the count-bound plan. The command deletes only the reviewed
temporary object generations and
re-verifies every canonical final. Require `deleted == $TemporaryCount` and
zero remaining temporary objects. This is destructive and not a substitute
for the target-environment backup. Take the activation baseline inventory only
after this hygiene step finishes.

## 1. Baseline and preservation inventory

Confirm the web application is healthy in `v1-write`, then take a read-only
metadata inventory of the entire bucket:

```powershell
$StorageBaseline = "performance-results/task07-media-storage-before-$DateTag.json"

node scripts/task07/media-storage-inventory.js `
  --project $ProjectId --confirm-project $ProjectId `
  --allow-live-project --auth firebase-cli `
  --report $StorageBaseline
```

The report must be `complete: true`, with zero invalid and duplicate entries.
It records names, generations, sizes, content types, and checksums; it never
downloads or changes object data.

## 2. Backfill and active canonical audit

First create the all-source backfill plan without an expected count. The plan
is read-only:

```powershell
$BackfillDiscovery = "performance-results/task07-media-backfill-discovery-$DateTag.json"
$BackfillPlan = "performance-results/task07-media-backfill-plan-$DateTag.json"
$BackfillCheckpoint = "performance-results/task07-media-backfill-checkpoint-$DateTag.json"

node scripts/task07/media-derivative-backfill.js `
  --operation backfill `
  --project $ProjectId --auth firebase-cli `
  --allow-live-project --confirm-project $ProjectId `
  --catalog-owner-uid $WebmasterUid `
  --confirm-catalog-owner-uid $WebmasterUid `
  @SourceArgs --page-size 25 --max-pages 100 `
  --report $BackfillDiscovery
```

Require `scan.complete: true`, all 15 sources, zero errors, and no truncated
source. Review every root and nested entry. `counts.candidates` is only the
missing-canonical repair set; `excluded` contains separately hashed
`already-canonical` targets plus the narrowly proved unplaced foe-token roots.
Never execute an `already-canonical` exclusion: that would replace current
media with a potentially stale retained legacy object. In particular, the
approved executable set must include every renderer-active catalog spell and
foe technique/spell that still lacks a canonical attachment.
Archive this immutable discovery report and its hash. Record only its candidate
count:

```powershell
$ExpectedBackfillCandidates = '<exact counts.candidates from immutable discovery report>'
```

Re-run the plan with the reviewed count before executing. Adding
`expectedCandidates` deliberately changes the fingerprint, so the unbound
fingerprint is not an approval artifact:

```powershell
node scripts/task07/media-derivative-backfill.js `
  --operation backfill `
  --project $ProjectId --auth firebase-cli `
  --allow-live-project --confirm-project $ProjectId `
  --catalog-owner-uid $WebmasterUid `
  --confirm-catalog-owner-uid $WebmasterUid `
  @SourceArgs --page-size 25 --max-pages 100 `
  --expected-candidates $ExpectedBackfillCandidates `
  --report $BackfillPlan
```

Require the same complete source coverage and candidate count, zero errors,
and independently review this count-bound report. Only then capture the
fingerprint that will authorize execution:

```powershell
$BackfillFingerprint = '<exact planFingerprint from the count-bound plan>'
```

If the executable subjects or exclusions differ from the reviewed unbound
discovery for any reason other than the expected-candidate binding, discard
both reports and start again.

Execute the exact saved plan serially. This command reads `$BackfillPlan`; it
does not regenerate it:

```powershell
node scripts/task07/media-derivative-backfill.js `
  --operation backfill --execute `
  --project $ProjectId --auth firebase-cli `
  --allow-live-project --confirm-project $ProjectId `
  --catalog-owner-uid $WebmasterUid `
  --confirm-catalog-owner-uid $WebmasterUid `
  @SourceArgs --page-size 25 --max-pages 100 `
  --expected-candidates $ExpectedBackfillCandidates `
  --report $BackfillPlan `
  --checkpoint $BackfillCheckpoint `
  --approve-fingerprint $BackfillFingerprint
```

Require `complete: true` and `processed` equal to
`$ExpectedBackfillCandidates`. If the process stops, first preserve and inspect
both files, then run the identical command with `--resume`; the checkpoint is
accepted only when it binds the same operation, plan fingerprint, and last
durable receipt. Never delete a checkpoint to bypass a mismatch.

Verify every durable receipt against the current target, manifest, and
immutable objects:

```powershell
$BackfillVerify = "performance-results/task07-media-backfill-verify-$DateTag.json"

node scripts/task07/media-derivative-backfill.js `
  --operation verify `
  --project $ProjectId --auth firebase-cli `
  --allow-live-project --confirm-project $ProjectId `
  --catalog-owner-uid $WebmasterUid `
  --confirm-catalog-owner-uid $WebmasterUid `
  @SourceArgs --page-size 25 --max-pages 100 `
  --expected-candidates $ExpectedBackfillCandidates `
  --approved-backfill-report $BackfillPlan `
  --report $BackfillVerify
```

This command reads only the receipt IDs signed into `$BackfillPlan`; historical
receipts are deliberately outside the activation gate. Accept only a complete,
non-truncated verification whose `scope.planFingerprint` equals
`$BackfillFingerprint`, with zero errors and `counts.candidates` exactly
`$ExpectedBackfillCandidates`. Preserve every legacy object and all receipts
for the rollback window.

Rebuild `functions/lib` and start a new preservation inventory if any repair
or code change occurs.

Run once without an expected count to discover the current active set:

```powershell
node scripts/task07/media-derivative-backfill.js `
  --operation canonical-audit `
  --project $ProjectId --auth firebase-cli `
  --allow-live-project --confirm-project $ProjectId `
  --catalog-owner-uid $WebmasterUid `
  --confirm-catalog-owner-uid $WebmasterUid `
  @SourceArgs --page-size 25 --max-pages 100 `
  --report "performance-results/task07-media-canonical-audit-initial-$DateTag.json"
```

Review the source counts, exclusions, every issue, and the report fingerprint.
The only accepted result is a complete scan with zero errors. Record the exact
`counts.candidates` value as `$ExpectedCandidates`, then immediately rerun with
that binding:

```powershell
node scripts/task07/media-derivative-backfill.js `
  --operation canonical-audit `
  --project $ProjectId --auth firebase-cli `
  --allow-live-project --confirm-project $ProjectId `
  --catalog-owner-uid $WebmasterUid `
  --confirm-catalog-owner-uid $WebmasterUid `
  @SourceArgs --page-size 25 --max-pages 100 `
  --expected-candidates $ExpectedCandidates `
  --report "performance-results/task07-media-canonical-audit-approved-$DateTag.json"
```

Stop for any missing descriptor, detached manifest, version conflict, missing
variant/object/legacy source, malformed or unclassifiable media declaration,
owner/role mismatch, policy/private-metadata violation, token relationship
issue, truncation, or count change. Repair through normal Task 07 operations
while still in `v1-write`, then start again with a new bucket inventory.

After all approved backfill receipts verify and any due lifecycle cleanup is
terminal, take a second immutable inventory before planning the control write:

```powershell
$StorageCutover = "performance-results/task07-media-storage-post-backfill-$DateTag.json"

node scripts/task07/media-storage-inventory.js `
  --project $ProjectId --confirm-project $ProjectId `
  --allow-live-project --auth firebase-cli `
  --compare $StorageBaseline `
  --report $StorageCutover
```

Keep both inventories. Every addition must be an object family from the exact
approved backfill or another separately reviewed canonical operation. Changed
objects are never accepted. A baseline object reported missing blocks cutover
unless an independent reconciliation binds that exact name and generation to
a `deleted` manifest, a `complete` cleanup queue, and zero reference in the
fresh approved canonical audit. Archive that reconciliation; do not relabel an
explained deletion as `preserved`. Any unexplained addition, change, or
missing object restarts the procedure.

## 3. Review and plan the control transaction

Run the full Task 07 tests, Functions build/tests, rules tests, production
frontend build, and release guards appropriate to the checkout. Obtain an
independent code/evidence review before deployment or control mutation.

Create the dry-run control plan using the approved audit:

```powershell
$AuditPath = "performance-results/task07-media-canonical-audit-approved-$DateTag.json"
$AuditFingerprint = '<exact planFingerprint from that report>'
$ControlPlan = "performance-results/task07-media-canonical-control-plan-$DateTag.json"

node scripts/task07/media-rollout-control.js `
  --project $ProjectId --mode canonical-only --auth firebase-cli `
  --allow-live-project --confirm-project $ProjectId `
  --webmaster-uid $WebmasterUid `
  --confirm-webmaster-uid $WebmasterUid `
  --canonical-audit-report $AuditPath `
  --canonical-audit-fingerprint $AuditFingerprint `
  --expected-candidates $ExpectedCandidates `
  --report $ControlPlan
```

The controller independently repeats the entire audit and refuses any byte or
document drift. Review the control plan and its exact `planFingerprint`.

If runtime code changed, deploy only the explicitly reviewed planes while the
control remains `v1-write`, then repeat steps 1-3. Offline audit/runbook-only
changes do not require a Hosting or Functions deployment.

## 4. Execute canonical-only

```powershell
$ControlFingerprint = '<exact planFingerprint from the reviewed control plan>'

node scripts/task07/media-rollout-control.js `
  --project $ProjectId --mode canonical-only --auth firebase-cli `
  --allow-live-project --confirm-project $ProjectId `
  --webmaster-uid $WebmasterUid `
  --confirm-webmaster-uid $WebmasterUid `
  --canonical-audit-report $AuditPath `
  --canonical-audit-fingerprint $AuditFingerprint `
  --expected-candidates $ExpectedCandidates `
  --report $ControlPlan --execute `
  --approve-fingerprint $ControlFingerprint
```

Immediately before its single control write, the transaction rechecks the
token/music relationship hashes and every audited target and manifest update
version. A concurrent change fails closed and requires a fresh audit/plan. The
command also waits for the canonical-only music stream projection to become
ready.

Keep the media-maintenance quiet window in force from the final approved audit
until the transaction completes. Firestore can transactionally fence every
document already present in the approved audit and the complete bounded
token/music relationship queries, but it cannot fence the membership of all
other heterogeneous source collections as one query. A brand-new non-token,
non-music media target created after the final scan would not be part of those
document bindings; the operator quiet window closes that gap. Production must
use the same explicit maintenance window rather than claiming global set
atomicity.

## 5. Post-cutover acceptance

1. Rerun the expected-count active audit; require the same active-set
   fingerprint and zero errors.
2. Rerun the bucket inventory against the post-backfill cutover inventory:

   ```powershell
   node scripts/task07/media-storage-inventory.js `
     --project $ProjectId --confirm-project $ProjectId `
     --allow-live-project --auth firebase-cli `
     --compare $StorageCutover `
     --report "performance-results/task07-media-storage-after-$DateTag.json"
   ```

   `comparison.preserved` must be true with zero missing and changed objects.
   Before browser writes there should be no unexplained addition. Also run a
   second comparison against `$StorageBaseline` and confirm it reproduces only
   the already archived backfill additions and any independently reconciled
   completed cleanup; the original baseline is never replaced.
3. In an authenticated browser verify Home/avatar, Bazaar catalog and nested
   spells, personal techniques/spells (image and video), NPCs, foes, Grigliata
   image/video backgrounds, Gallery, character/custom/foe tokens, and music.
4. Create, replace, reload, and delete disposable media through the normal UI.
   Confirm the replacement remains visible and no console/network permission,
   App Check, CORS, manifest, or legacy-fallback error appears.
5. Confirm the served client exposes `canonical-only` and rendered canonical
   media resolves through authenticated blob URLs. A direct Admin SDK object
   check is not a substitute for this browser proof.
6. After the disposable browser records have been deleted and their cleanup is
   terminal, run one final expected-count active audit. Require zero errors and
   the same active-set fingerprint as the approved cutover audit. If the UI
   test intentionally retained a record, review and bind its new count and
   fingerprint instead of reusing the pre-test evidence.
7. Run the preservation inventory again against the cutover inventory so the
   archived final evidence covers the browser mutations themselves:

   ```powershell
   node scripts/task07/media-storage-inventory.js `
     --project $ProjectId --confirm-project $ProjectId `
     --allow-live-project --auth firebase-cli `
     --compare $StorageCutover `
     --report "performance-results/task07-media-storage-final-$DateTag.json"
   ```

   The final comparison must report zero unexplained missing or changed cutover
   objects. Additions must map to reviewed canonical browser-test writes.
   Repeat the final comparison against `$StorageBaseline`; its additions must
   be exactly the union of approved backfill families and reviewed browser
   writes, while every missing baseline generation must remain covered by the
   archived deleted-manifest/complete-cleanup/no-reference proof. Pending
   cleanup is not an explanation by itself. Any unexplained difference fails
   acceptance.
8. Run `media-temporary-object-cleanup.js` once more with
   `--expected-candidates 0`. The only accepted final state is a complete report
   with zero temporary objects. If a residue appears, freeze writes, create a
   new count-bound plan, obtain a new independent review, execute only that
   fingerprint, and repeat the final audit and inventory.

Archive the before/after/final inventories, approved/final audits, control plan,
control result, browser evidence, deployment release IDs (if any), reviewed
commit, and independent review.

## Immediate rollback

The normal rollback target is the exact wildcard `v1-write` contract. It keeps
canonical writes active and restores legacy read fallback. Generate and review
a new dry-run plan from the current exact `canonical-only` state, then execute
it with its own approval fingerprint:

```powershell
node scripts/task07/media-rollout-control.js `
  --project $ProjectId --mode v1-write --auth firebase-cli `
  --allow-live-project --confirm-project $ProjectId `
  --webmaster-uid $WebmasterUid `
  --confirm-webmaster-uid $WebmasterUid `
  --report "performance-results/task07-media-v1-write-rollback-$DateTag.json"
```

Repeat with `--execute --approve-fingerprint <reviewed fingerprint>`. Do not
delete, overwrite, or roll back canonical manifests/objects/target descriptors.
Do not use `legacy` as the routine rollback: media created after canonical
activation may have no legacy source reference. A legacy control requires a
separate record-by-record compatibility proof.
