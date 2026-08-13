# Task 07 inactive-deployment readiness

Date: 2026-07-31

This document separates two operations that have different risk:

1. **Deploying Hosting while Task 07 remains inactive.** This is the safe
   compatibility target for the current `devs` candidate.
2. **Activating derivative reads or V1 writes.** This is a later data rollout
   and is not implied by deploying the code.

No command in this document is authorization to deploy or mutate production.

## Inactive deployment invariant

Task 07 is inactive when `utils/task07_media` is missing, malformed, or resolves
to `mode: "legacy"`. Both the client and Functions normalize those states to
legacy behavior. The former `REACT_APP_TASK07_MEDIA_PIPELINE` build flag is a
compatibility no-op and must not be used as an activation mechanism.

Before deploying any plane, inspect the production control document read-only
and prove that it is missing or exactly legacy. Stop if it contains `shadow`,
`derivative-read`, or `v1-write`; that is an already-active rollout requiring a
separate reconciliation plan.

An explicit legacy document, if one already exists, has this schema:

```json
{
  "schemaVersion": 1,
  "policyVersion": 1,
  "mode": "legacy",
  "enabledPurposes": [],
  "enabledRoles": [],
  "enabledUids": []
}
```

Do not create or edit this document merely to perform local validation.

## Required gates for the current Hosting-only candidate

The exact merged commit must pass:

- release-guard tests proving that every backend npm command and raw Firebase
  predeploy hook fails before a backend plane can change;
- full frontend tests, hardened production build, production-build verification,
  and proof that performance instrumentation is absent;
- an HTTP 200 `/home` smoke from the hardened production artifact on an owned
  loopback port;
- a final diff review proving that legacy routes, fields, Storage paths, and
  callable names used by the current deployed version remain compatible; and
- a post-run process/port check proving that no owned Node, Java, browser, or
  emulator process survived.

A bounded `npm start` smoke remains supporting development-path evidence. The
current cold OneDrive compile completed with warnings but crossed its 300-second
HTTP-probe deadline; the verifier then released port 3001. That timeout is
recorded, but it does not override the direct production-artifact `/home` proof.

## Backend reactivation gates

The guarded Functions, Firestore rules/indexes, and Storage rules planes have
separate acceptance gates. These are required before guard removal, not for the
current Hosting-only release:

- Functions TypeScript build, lint, and tests;
- full Firestore and Storage rules tests on exact project `demo-fnd-perf`;
- bounded Task 07 callable/media integration; and
- live inventory reconciliation for Functions, indexes, TTL policies, rules,
  runtime parameters, App Check, CORS, and rollout controls.

On the current 2026-07-31 snapshot, Functions build/lint/tests are green, but
the full rules run passed only 21 of 30 tests because positive Firestore paths
hit rule-evaluation errors or the 1,000-expression ceiling. The focused Task 07
rules subset passed 10 of 10. The bounded media run completed the main pipeline,
then stopped on an outdated exact-result assertion after the foe callable added
its intentional reconciliation timestamp; the assertion was corrected and was
not rerun.

Those results keep every backend guard in place. A focused backend success does
not supersede a failed full-plane gate, and no performance threshold may justify
removing the guard.

Performance thresholds inform rollout quality but are not, by themselves, a
compatibility blocker for an inactive deployment. A crash, authorization
regression, data loss risk, unbounded trigger loop, leaked process tree, or
failed legacy flow is a blocker.

## Production prerequisites

Archive the currently deployed Hosting release, Functions revisions, Firestore
rules and indexes, Storage rules, runtime configuration, App Check settings,
and bucket CORS policy before changing anything.

Confirm these facts separately:

- production Hosting has the existing reCAPTCHA v3 site key if Task 07 V1
  callable writes will ever be enabled; production Task 07 callables enforce
  App Check;
- every Functions runtime parameter/secret required by the current deployed
  application is available to the new Functions build;
- the production bucket and approved web origins are known; and
- no existing production record already contains an unsupported partial Task
  07 descriptor or a non-legacy control document.

Missing App Check configuration does not activate Task 07 and does not affect
legacy behavior, but it is a hard stop for `v1-write` activation.

## Current deployable scope: Hosting only

The current candidate intentionally blocks Functions, Firestore rules/indexes,
Storage rules, and bare all-plane deployments. Those planes are not safe to
apply merely because Task 07 resolves to legacy:

- Functions exports include new scheduled jobs and document triggers that are
  created and invoked independently of the client rollout mode;
- the indexes file is a desired-state inventory and must first be reconciled
  with every live composite index so an omitted production index is not
  deleted; and
- field overrides enable TTL on multiple collections and can delete matching
  live documents after deployment.

`firebase.json` predeploy guards stop raw backend and all-plane deployments,
and the corresponding npm commands fail before invoking Firebase. Removing the
guards requires a separate reviewed backend-release change with archived live
Functions, indexes, TTL policies, rules, runtime parameters, App Check state,
and rollout controls.

After every local gate in this document passes, the only approved command from
this commit is:

```powershell
npm.cmd run fb:deploy:hosting
```

That command is documented for a later authorized release; it must not be run
as part of local validation. Its Hosting predeploy builds the production bundle
from the exact checkout. After the 2026-08-12 Task 05 retirement there is no
frontend user-data routing override: user data remains server-enforced V2-only.
Do not set the obsolete Task 07 build flag, change bucket CORS, or widen a media
rollout control. Smoke ordinary non-battle routes and current V2
create/edit/delete flows after an authorized Hosting release.

## Activation is a separate change

The actual rollout switch is the server-readable Firestore document
`utils/task07_media`. Non-legacy modes require all of these fields to validate:

- `schemaVersion: 1`;
- `policyVersion: 1`;
- `mode`: `shadow`, `derivative-read`, or `v1-write`;
- `enabledPurposes`: a reviewed subset of the shared media-policy purpose keys;
- `enabledRoles`: reviewed lower-case roles; and
- `enabledUids`: explicit canary UIDs.

All three allowlists must match an actor for the non-legacy mode to apply. Use
explicit canary values first; do not start with `"*"`. Before `v1-write`, App
Check, exact-origin CORS, callable deployment, cleanup monitoring, duplicate-foe
V2 ownership, backup, reconciliation, and rollback must all be proven.

## Rollback

For an inactive deployment regression, roll back the failing plane to the
archived revision. Do not delete new manifests or Storage objects as a shortcut.

For a later active rollout, first return the reviewed control document to
legacy, then reconcile non-terminal manifests and cleanup records before
rolling back Functions or rules. Keep canonical and legacy media intact until
every affected record is accounted for.
