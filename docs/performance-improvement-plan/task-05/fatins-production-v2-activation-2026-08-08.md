# fatins production V2 activation — 2026-08-08

## Scope and immutable boundaries

- Target repository/branch: `fnd` / `devs`.
- Architecture baseline: `fatins-test/main` at
  `0f994e661c9e8267cb3d7a6d49388149f3763b0b`.
- Port commits before production activation:
  - `4a798702c44ee43f4addfb07d0d34a5ce90a6d55` — architecture port.
  - `ca5d83ecd8744a612d86dc78af322f01b219f571` — production bucket-region binding.
- No Firestore or Storage data was copied from `fatin-test`/`fatins-test`.
  Only code/configuration architecture was used as the baseline.
- The production database was migrated in place under maintenance. Legacy User
  Data fields and legacy media objects were preserved.
- User Data final mode is `new-only`. Media final mode is `v1-write`; no
  canonical-only transition or legacy-media deletion was performed.

## Pre-write production backup

- File: `backend/backups/firestore_backup_v2_20260807_234647.json`
- Size: 7,034,319 bytes.
- Coverage: 25 root collections, 811 documents, 21 subcollections.
- Canonical data hash:
  `3fa373fc2e68cf07d9b03095a3e22a33739e3bc51b13ee945b18252d68855ba5`.
- File SHA-256:
  `1ed5b9d6a3aaf8f694b9f3cbaa1a11e90a7577289bcc9d34a6012bbe7461b0d8`.
- The backup was reopened and validated before any production migration write.
  It remains ignored/private and is not committed.

## Firebase infrastructure release

- Firestore rules and all 7 checked-in composite indexes deployed to `fatins`.
- Storage rules deployed. Bucket `fatins.firebasestorage.app` is in
  `EUROPE-CENTRAL2` and its checked-in GET/HEAD CORS policy verified with hash
  `b53d818ba85cb918d0c962693dc9aaff5f966b1946d5b8f526c1f4a98d96339e`.
- Functions inventory: 84 expected and 84 deployed, with no extra deletion.
  `task07ProcessMediaUpload` is active as a Gen 2 function in
  `europe-central2`. Callable IAM checks passed in `europe-west8`,
  `europe-west1`, and `us-central1`.
- App Check service-wide enforcement remains un-enforced, matching the source
  configuration. Application callables continue to enforce App Check in code.

## User Data migration

The guarded production sequence completed as:

1. `legacy-read` -> `shadow-verify`.
2. Stabilization and initial backfill for 11 users.
3. Deterministic convergence repair for the six initially divergent subjects.
4. `dual-write` -> `new-read-dual-write`.
5. Global drain `fatins-global-20260808-ca5d83e`.
6. Sealed `new-only` verification, completion, and exact drain removal.

The initial final unscoped verifier reported 11 unchanged users and zero
writes/errors/warnings with fingerprint
`c5d6e515d96bd48b01762ab9cc7501401b869672e688b7674bd6a68ed819a74e`.

After Media activation, the Task 05 verifier correctly received an integration
fix so that Task 07's six server-owned top-level media fields coexist on user,
inventory, spell, and technique documents. A redacted production diagnostic
showed that every apparent post-media mismatch was one of those exact fields;
no arbitrary User Data drift was present and no destructive repair was run.
The corrected final production verification reported:

- users: 11;
- unchanged: 11;
- writes required: 0;
- errors/warnings/cleanup documents: 0/0/0;
- fingerprint:
  `69233d685fb0a874c488562162e9613b34ec480c35da18c96dffd64486eac1a4`.

## App Check activation

- Approved pre-write fingerprint:
  `448f95c78654a9d3f7762e704d823d4d115f80b88aa4b5513008e6cc8c663fcc`.
- One reCAPTCHA Enterprise score key was created and bound to the production
  Firebase web app.
- Key SHA-256 (the raw public identifier is deliberately omitted):
  `42312284c300176e3a6bf1e03f51a60e339bc679643ab820668f01d69767b415`.
- Allowed domains are exactly `fatins.firebaseapp.com` and `fatins.web.app`;
  `allowAllDomains` is false and token TTL is 3600 seconds.

## Media migration

- All 15 required sources were scanned.
- Reviewed backfill plan:
  - 332 source records;
  - 179 executable candidates;
  - 26 signed exclusions, all permitted unplaced foe-token roots;
  - 0 errors;
  - fingerprint
    `a12df8ff3a7b162a692ff2e868fc964ed9097352e341e54241d6ddcd6d19e3ba`.
- Media control changed from `legacy` to `v1-write` under fingerprint
  `21afd8c6c81c7a1dd5ccd5f26a0f2f344e0efa9239d4482b60fa3fefd325f5c5`.
- Serial checkpointed execution completed 179/179 candidates.
- Independent all-source verification reported 179/179 verified, zero errors,
  zero exclusions, and fingerprint
  `b731b01e8ed1903f94153190a6de4cd0218520940bc1e49b584b33cfa3f67b5c`.
- Final live control hash is
  `016e366965259325f31262f0245028fb7d7911d698db617bc36d9d7d2b64392f`
  and exactly matches `v1-write`.

## Hosting and live evidence

- Hosting release: `sites/fatins/releases/1786143048497000`.
- Hosting version: `sites/fatins/versions/4147938c9ad1e76b`.
- Release time: `2026-08-07T22:50:48.497Z` (2026-08-08 Europe/Rome).
- Main asset: `/static/js/main.af35b933.js`.
- Main asset SHA-256:
  `0f7b79f6a5acf6f9b517cb7a9ae37375171871fafbf4679da1f298d22638fe79`.
- The remote asset exactly matched the locally hardened build, contained the
  forced `new-only` stage, and embedded the App Check key matching the recorded
  key hash.
- `https://fatins.web.app/`, `/home`, and
  `/fatins-runtime/firebase-client` returned HTTP 200. Runtime configuration
  resolved to project `fatins`, auth domain `fatins.firebaseapp.com`, and bucket
  `fatins.firebasestorage.app`.
- HSTS, `nosniff`, `DENY` frame policy, and strict-origin referrer policy were
  present. No `/grigliata` page was opened or interacted with during validation.

## 2026-08-11 production prerequisite repair

The first authenticated production browser pass exposed two omitted runtime
prerequisites that were not covered by the original activation checks:

- `firebaseappcheck.googleapis.com` was disabled and the Firebase App Check
  service identity did not have `roles/firebaseappcheck.serviceAgent`. The API
  was enabled, the service identity was generated, and the exact service-agent
  role was bound. The existing reCAPTCHA Enterprise key, domains, score mode,
  and TTL were not changed.
- The 11 migrated `users/{uid}` documents had no corresponding server-owned
  `user_directory/{uid}` projections. The approved directory dry-run reported
  11 creates, zero updates, and fingerprint
  `95061deccced4e4186f3877412faa6615011eca580b769b53a5fee5f58c4d4f9`.
  The write created exactly those 11 projections without changing source user
  documents. A second read-only pass reported 11 unchanged and zero pending
  creates or updates.

Live verification in the signed-in in-app browser then showed 11 admin user
rows and 11 role selectors on `/admin`, no empty-state message, and zero new
warning/error console entries on fresh `/home` and `/admin` loads. The active
`/grigliata` route was not opened or interacted with.

To prevent recurrence, Hosting and Functions predeploy now run the read-only
`production:verify-runtime-prerequisites` gate. It fails closed unless both App
Check APIs are enabled, the exact App Check service-agent IAM binding exists,
every production user has a current canonical `user_directory` projection, and
the directory count exactly matches the source-user count (no orphan entries).
Directory verification uses a separate ignored report and can never enter
write mode.

## Validation

- Pre-activation regression evidence: frontend 135 suites / 1,277 tests,
  Functions 231 tests, backend 22 tests, performance 285/285 tests, full Firebase
  rules emulator matrix, production build verification, and unchanged
  `npm start` `/home` HTTP 200 smoke all passed.
- Post-integration Task 05 + Task 07 operator tests: 96/96 passed.
- Known non-fatal tool warnings were Node's deprecated `punycode` dependency and
  stale Browserslist metadata; neither affected compilation, deployment, or
  production verification.

All private reports, checkpoints, credentials, raw UIDs, API values, and backup
contents remain ignored and are intentionally absent from this document.
