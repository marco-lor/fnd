# Task 07 activation runbook

Task 07 is implemented as a default-off candidate. `demo-fnd-perf` enables it
through `REACT_APP_FND_PERF=1`; a future production build must use the dedicated
`REACT_APP_TASK07_MEDIA_PIPELINE=1` flag. This implementation does not set that
flag, deploy Firebase resources, or mutate production data.

## Current gate status: activation blocked

This runbook describes a possible future rollout; it is not current permission
to perform one. Keep the production flag unset and do not deploy any Task 07
plane until all of the following blockers are closed and reviewed:

- the final full frontend, Functions, rules, build, startup, and demo integration
  gates pass from the clean merged revision;
- the full route matrix, Chromium/Firefox/WebKit media cases, 50-map/token soak,
  ten-minute lifecycle run, `perf:ci`, and two-pass authoritative comparison
  pass from a clean committed candidate;
- V1 foe/token copy and spawn operations acquire an owned canonical family or
  a reviewed reference-ledger entry rather than depending on legacy fallback;
- production backup, write-backfill, restore, and reconciliation tooling is
  implemented and approved.

The active Grigliata battle is an independent hard stop even if the technical
gates later become green.

## Safety prerequisites

1. Finish the active Grigliata battle and agree a rollout window with the DM.
2. Start from a clean, reviewed commit and archive the current Hosting release,
   Firestore rules, Storage rules, Functions revision, bucket CORS policy, and
   media-object inventory.
3. Re-run the Task 07 unit, rules, build, startup, and emulator browser gates
   against exact project `demo-fnd-perf`.
4. Confirm the production bucket name and every production web origin. Add any
   reviewed custom domain to `frontend/storage.cors.task07.json`; do not add a
   wildcard origin.
5. Confirm App Check and authenticated callable behavior in the intended
   production configuration before enabling the client flag.

## Why CORS is required

Canonical media records contain private Storage paths and generations, never
bearer download URLs. The shared renderer obtains bytes with authenticated
Firebase Storage `getBlob`, validates the returned byte count and MIME type,
and renders a short-lived object URL. Browser blob reads require a bucket CORS
policy for the exact Hosting origins.

The reviewed policy is stored in `frontend/storage.cors.task07.json`. Applying
it is an explicit production operation and is intentionally outside this task.
After selecting the exact bucket, an operator can review the current policy and
then use the Google Cloud Storage CLI to apply the file:

```powershell
gcloud storage buckets describe gs://<production-bucket> --format=json
gcloud storage buckets update gs://<production-bucket> --cors-file=storage.cors.task07.json
```

Do not run either command against `demo-fnd-perf` as part of ordinary tests;
the Storage emulator is locally owned and does not need production CORS.

## Activation order

1. Deploy the reviewed callable Functions and scheduled lifecycle sweeper.
2. Deploy the reviewed Firestore and Storage rules.
3. Apply and verify the exact-origin bucket CORS policy.
4. Exercise prepare, upload, finalize, entity commit, confirm, replacement,
   cancellation, and cleanup using non-battle canary records.
5. Build Hosting with `REACT_APP_TASK07_MEDIA_PIPELINE=1`.
6. Deploy Hosting only after the backend canaries and authenticated private
   reads pass.
7. Verify avatar, NPC, foe, and map/image-video create and replacement paths.
   Verify ordinary users cannot read foe assets and cannot write manifests.
8. Monitor lifecycle failures, orphan age, cleanup retry count, private media
   fetch failures, decoded-byte cache totals, and active request counts.

Never use a bare `firebase deploy` for this rollout. Each deployment plane must
be explicit, reviewed, and recorded.

## Legacy backfill

The repository command is deliberately read-only:

```powershell
npm.cmd run task07:media-backfill:plan -- --project demo-fnd-perf --json
```

It refuses production projects, requires a loopback Firestore emulator, and
rejects `--write`/`--execute`. It inventories avatars, private inventory items,
global catalog items, NPCs, foes, maps, and map videos; canonical Task 07 media
is skipped and unsupported WebM is reported as an explicit fallback.

A production-writing backfill is not authorized by this implementation. It
requires a separate reviewed task with backup/restore, resumable receipts,
per-entity authorization, rate limits, dry-run diff approval, and rollback.

## Rollback

1. Rebuild and deploy Hosting with
   `REACT_APP_TASK07_MEDIA_PIPELINE` unset.
2. Leave canonical media manifests and objects intact. Do not delete them as a
   rollback shortcut. Disabling the upload path does not disable canonical
   media rendering, and records that already had legacy fields keep those
   compatibility fields.
3. Keep the lifecycle Functions and rules until every prepared or cleanup-
   pending asset has reached a terminal state.
4. Restore the archived CORS policy only after no enabled client needs
   authenticated `getBlob`.
5. Investigate and reconcile ambiguous commits by checking the entity's exact
   media manifest before retrying or cleaning an asset.

Rollback must not refresh, mount, or manipulate a live Grigliata board merely
to test presence. Use an isolated canary board or the demo emulators.
