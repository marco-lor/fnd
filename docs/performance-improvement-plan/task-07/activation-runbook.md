# Task 07 activation runbook

Date: 2026-07-31

Task 07 activation is controlled by Firestore document `utils/task07_media`,
not by a React build flag. Missing, malformed, and `legacy` control all fail
closed to the deployed legacy behavior. The compatibility export
`TASK07_MEDIA_PIPELINE_ENABLED` is permanently false, and
`REACT_APP_TASK07_MEDIA_PIPELINE` must not be used for rollout.

See `deployment-readiness.md` for deploying the code while this control remains
legacy. That inactive deployment is separate from the activation described
here.

## Current gate status

Broad `derivative-read` and `v1-write` activation remain blocked until the
production prerequisites below are reviewed. This does not prohibit deploying
the compatibility-preserving code in legacy mode after its release gates pass.

## Activation prerequisites

1. Freeze and validate a clean, reviewed commit; archive the current Hosting,
   Functions, Firestore rules/indexes, Storage rules, runtime/App Check config,
   bucket CORS policy, and media-object inventory.
2. Confirm the production bucket and every approved web origin. Never use a
   wildcard origin.
3. Configure and verify the existing production reCAPTCHA v3 site key. Task 07
   production callables enforce App Check; only exact `demo-fnd-perf` Functions
   emulators bypass it.
4. Deploy and canary all Task 07 callables, rules, indexes, and cleanup handlers
   while `utils/task07_media` still resolves to legacy.
5. Confirm `duplicateFoeWithAssetsV2` and Task 06 `duplicate-foe` are deployed,
   enabled, and receipt-replay tested before enabling foe `v1-write`.
6. Review backup, restore, reconciliation, monitoring, and immediate control-
   document rollback. Do not use a live battle board for canaries.

## Control contract

The non-legacy control document must contain:

```json
{
  "schemaVersion": 1,
  "policyVersion": 1,
  "mode": "shadow",
  "enabledPurposes": ["avatar"],
  "enabledRoles": ["webmaster"],
  "enabledUids": ["<explicit-canary-uid>"]
}
```

Allowed modes are `legacy`, `shadow`, `derivative-read`, and `v1-write`.
All three allowlists must match the actor for a non-legacy mode to apply.
Start with one explicit purpose, role, and UID. Do not begin with `"*"`.

## Why CORS is required

Canonical media stores private Storage paths and generations, never bearer
download URLs. The renderer uses authenticated Firebase Storage `getBlob` and
a short-lived object URL. Browser blob reads therefore require exact-origin
bucket CORS before `derivative-read` or `v1-write` is enabled.

The reviewed candidate is `frontend/storage.cors.task07.json`. Inspect the
current bucket policy before any update and add every reviewed custom domain to
the file; do not add a wildcard. Applying CORS is a separate production change
and is not required for an inactive deployment.

## Activation order

1. Complete the inactive deployment sequence from `deployment-readiness.md`.
2. Verify authenticated/App Check callable canaries, private blob reads, and
   cleanup on non-production-shaped test records while the control is legacy.
3. Apply and verify exact-origin bucket CORS.
4. Set one explicit canary cohort to `shadow`; verify no legacy behavior
   changes and inspect logs/denials.
5. Advance that cohort to `derivative-read` only after canonical records for it
   are reconciled and readable.
6. Advance a single purpose/UID to `v1-write`; exercise prepare, upload,
   processing, attach, replacement, cancellation, retirement, and cleanup.
7. Widen one allowlist dimension at a time, with a monitoring interval between
   changes.

Never use bare `firebase deploy`, and never widen the control document to work
around a partially deployed plane.

## Backfill

The checked-in planner is restricted to exact project `demo-fnd-perf` and
loopback emulators. It is not a production-writing migration tool. Production
backfill requires a separately reviewed implementation with backup/restore,
durable receipts, rate limits, dry-run diff approval, resumability, and
rollback.

## Rollback

1. Return `utils/task07_media` to a reviewed valid legacy document before
   rolling back code. This stops new derivative reads and V1 writes.
2. Preserve canonical manifests, generations, objects, and legacy fields.
3. Keep lifecycle Functions and rules until every prepared or cleanup-pending
   record has reached a reconciled terminal state.
4. Restore the previous Hosting/Functions/rules plane only after checking its
   compatibility with records created during the canary.
5. Restore the old CORS policy only when no enabled client still needs
   authenticated blob reads.

Do not mount, refresh, or manipulate a live Grigliata board as a rollback
presence check. Use an isolated canary or `demo-fnd-perf`.
