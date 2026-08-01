# fatin-test User Data V2 activation record - 2026-08-01

## Outcome

The isolated Firebase project fatin-test is active in new-read-dual-write mode.

- Frontend reads the V2 user-data projection.
- Supported server mutations continue writing both V2 and legacy data.
- Legacy Firestore documents were preserved.
- No new-only drain, archive, deletion, or destructive cleanup was performed.
- Only fatin-test Firestore and Hosting were changed. The production project fatins was not written to or deployed.
- Hosting URL: https://fatin-test.web.app

## Source and deployed state

- Isolated repository: C:/Users/Marco/OneDrive/git_projects/fatins-test
- Starting commit: c5d38d532221620d6cc00f2a62bac357df6bc7b9
- V2 activation code commit: 5056d4a
- Hosting release:
  - release: projects/fatin-test/sites/fatin-test/channels/live/releases/1785582111346000
  - version: projects/fatin-test/sites/fatin-test/versions/855bbe11c4a55ca9
  - created: 2026-08-01T11:01:43.239041Z
  - released: 2026-08-01T11:01:51.346Z
- Live main asset: /static/js/main.9eb00d76.js
- Final Firestore config:
  - path: app_config/user_data_v2
  - mode: new-read-dual-write
  - update time: 2026-08-01T10:58:09.602Z
  - config hash: b219cd1c2b2c3fd96303e8df3be71a1f021ced807963b8086db528be50a93a73
- Frontend release profile:
  - REACT_APP_FND_USER_DATA_ROLLOUT_CONFIG=0
  - REACT_APP_FND_USER_DATA_STAGE=new-read-dual-write
  - REACT_APP_FND_PERF=0

The frontend stage is deliberately fixed in the reviewed Hosting build. Normal player accounts do not need permission to read a rollout-control document.

## Authentication prerequisite

All Firebase CLI and Admin SDK commands in this run used the signed-in Firebase CLI account and Node's Windows system certificate store:

~~~powershell
$env:NODE_OPTIONS = '--use-system-ca'
firebase login
firebase login:list
~~~

The local helper creates a short-lived authorized-user ADC file under the Windows temporary directory and deletes it when the command exits. No token or credential file is stored in Git.

Run the commands below from:

~~~text
C:/Users/Marco/OneDrive/git_projects/fatins-test/frontend
~~~

## Exact activation sequence

Every write was preceded by a dry-run, and execution was bound to the dry-run SHA-256 fingerprint.

### 1. Enter shadow verification

~~~powershell
npm.cmd run users:set-v2-stage -- --project fatin-test --stage shadow-verify --auth firebase-cli --report performance-results/task05-stage-shadow.json --allow-live-project --confirm-project fatin-test

npm.cmd run users:set-v2-stage -- --project fatin-test --stage shadow-verify --auth firebase-cli --report performance-results/task05-stage-shadow.json --allow-live-project --confirm-project fatin-test --execute --approve-fingerprint 94ec0517a69f325dcb9aa4a7fd742b3fdfa6ab57eed2d3e206bc298b8d5049ed
~~~

Transition: legacy-read -> shadow-verify.

### 2. Stabilize legacy identifiers

~~~powershell
npm.cmd run users:migrate-v2 -- --project fatin-test --auth firebase-cli --operation stabilize --pre-drain-scope global --report performance-results/task05-stabilize.json --checkpoint performance-results/task05-stabilize-checkpoint.json --allow-live-project --confirm-project fatin-test

npm.cmd run users:migrate-v2 -- --project fatin-test --auth firebase-cli --operation stabilize --pre-drain-scope global --report performance-results/task05-stabilize.json --checkpoint performance-results/task05-stabilize-checkpoint.json --allow-live-project --confirm-project fatin-test --execute --approve-fingerprint 97634e58506ae5decdb938d5dd07ff584de672d972aafb6487669e3236a9a1c7
~~~

Evidence:

- users: 11
- writes required: 7
- unchanged: 4
- errors/warnings/deletion conflicts: 0
- pre-drain scope fingerprint: 42a13af7e757a1a7cfd7e53b8f16b728cab50cd1ff57bf3cb15467c6470dd0a7

### 3. Initial V2 backfill

~~~powershell
npm.cmd run users:migrate-v2 -- --project fatin-test --auth firebase-cli --operation backfill --pre-drain-scope global --report performance-results/task05-backfill.json --checkpoint performance-results/task05-backfill-checkpoint.json --allow-live-project --confirm-project fatin-test

npm.cmd run users:migrate-v2 -- --project fatin-test --auth firebase-cli --operation backfill --pre-drain-scope global --report performance-results/task05-backfill.json --checkpoint performance-results/task05-backfill-checkpoint.json --allow-live-project --confirm-project fatin-test --execute --approve-fingerprint 2d32f0c39534a6648423b5b246ae20cbc122f97a031572a97fb3cb4ebdfd7643
~~~

Evidence:

- users: 11
- writes required: 11
- unchanged: 0
- errors/warnings/deletion conflicts: 0

### 4. Verification stopped the rollout

~~~powershell
npm.cmd run users:migrate-v2 -- --project fatin-test --auth firebase-cli --operation verify --report performance-results/task05-verify-shadow.json --allow-live-project --confirm-project fatin-test
~~~

The first verification reported:

- fingerprint: 1a839dd9e9eb1b591614992e8bc5984659970680e3483fa25639f45b84de61fa
- users: 11
- writes required: 6
- unchanged: 5
- errors: 7
- warnings/cleanup: 0

The same verification was repeated after a bridge-settling delay into task05-verify-shadow-settled.json. It returned the identical fingerprint and counts. The rollout therefore remained in shadow-verify.

### 5. Idempotent convergence repair

~~~powershell
npm.cmd run users:migrate-v2 -- --project fatin-test --auth firebase-cli --operation backfill --pre-drain-scope global --report performance-results/task05-backfill-repair.json --checkpoint performance-results/task05-backfill-repair-checkpoint.json --allow-live-project --confirm-project fatin-test

npm.cmd run users:migrate-v2 -- --project fatin-test --auth firebase-cli --operation backfill --pre-drain-scope global --report performance-results/task05-backfill-repair.json --checkpoint performance-results/task05-backfill-repair-checkpoint.json --allow-live-project --confirm-project fatin-test --execute --approve-fingerprint 535e918d51faa8c731c2f7a06908b58bf20a2a99ab5ec1ac5dea6e53f1aa20d2
~~~

Evidence:

- users: 11
- writes required: 6
- unchanged: 5
- errors/warnings/deletion conflicts: 0

The exact reason a second convergence pass was necessary was not proven. It was treated as a gate failure, repaired idempotently, and reverified rather than ignored.

### 6. Immediate and settled clean verification

~~~powershell
npm.cmd run users:migrate-v2 -- --project fatin-test --auth firebase-cli --operation verify --report performance-results/task05-verify-after-repair-immediate.json --allow-live-project --confirm-project fatin-test

npm.cmd run users:migrate-v2 -- --project fatin-test --auth firebase-cli --operation verify --report performance-results/task05-verify-after-repair-settled.json --allow-live-project --confirm-project fatin-test
~~~

Both reports were identical:

- fingerprint: 1523aa1f847d9f5733339a3ba42157cf948f20ffc9813703a5e723ee0a64310e
- users: 11
- writes required: 0
- unchanged: 11
- errors/warnings/cleanup: 0

### 7. Enter dual-write and verify

~~~powershell
npm.cmd run users:set-v2-stage -- --project fatin-test --stage dual-write --auth firebase-cli --report performance-results/task05-stage-dual-write.json --allow-live-project --confirm-project fatin-test

npm.cmd run users:set-v2-stage -- --project fatin-test --stage dual-write --auth firebase-cli --report performance-results/task05-stage-dual-write.json --allow-live-project --confirm-project fatin-test --execute --approve-fingerprint 4365e26f2f532b05ed70214b2a32086fa07b4ae239b885968196fa5ed2d65188

npm.cmd run users:migrate-v2 -- --project fatin-test --auth firebase-cli --operation verify --report performance-results/task05-verify-dual-write.json --allow-live-project --confirm-project fatin-test
~~~

Transition: shadow-verify -> dual-write. Verification remained 11 unchanged, 0 writes, and 0 errors.

### 8. Enable V2 reads and verify

~~~powershell
npm.cmd run users:set-v2-stage -- --project fatin-test --stage new-read-dual-write --auth firebase-cli --report performance-results/task05-stage-new-read-dual-write.json --allow-live-project --confirm-project fatin-test

npm.cmd run users:set-v2-stage -- --project fatin-test --stage new-read-dual-write --auth firebase-cli --report performance-results/task05-stage-new-read-dual-write.json --allow-live-project --confirm-project fatin-test --execute --approve-fingerprint 7ede87a5fcf11412e63c8cf8883b14030f1a933b9785d9f3c865b91a44ff9970

npm.cmd run users:migrate-v2 -- --project fatin-test --auth firebase-cli --operation verify --report performance-results/task05-verify-new-read-dual-write.json --allow-live-project --confirm-project fatin-test
~~~

Transition: dual-write -> new-read-dual-write. Final verification remained 11 unchanged, 0 writes, and 0 errors.

## Release gates and deployment

The following gates passed before deployment:

~~~powershell
npm.cmd run users:test-v2-tools
npm.cmd run release:test
npm.cmd run perf:check-user-data-boundaries
$env:CI = 'true'
npm.cmd test -- --watch=false --runInBand src/components/common/MediaImage.test.js src/data/media/mediaUpload.test.js
npm.cmd run build:production
~~~

Results:

- V2 tooling: 53/53 tests passed.
- Release guards/profile: 6/6 tests passed.
- Media warning regression: 22/22 tests passed.
- Boundary checker: passed; 42 explicitly tracked legacy files and no new direct access.
- Production build: compiled successfully with main.9eb00d76.js.
- The remaining Browserslist age notice and Node punycode deprecation are tooling notices, not application compiler warnings.

Hosting-only deployment:

~~~powershell
npm.cmd run fb:deploy:hosting
~~~

The release guard bound the deployment to fatin-test, built again successfully, and deployed only Hosting. Functions, Firestore rules, indexes, Storage rules, and production were not deployed in this activation.

Live checks:

- https://fatin-test.web.app returned HTTP 200.
- https://fatin-test.web.app/fatins-runtime/firebase-client returned HTTP 200 and projectId=fatin-test.
- The live index referenced /static/js/main.9eb00d76.js.
- The live main asset contains new-read-dual-write and does not contain a fixed legacy-read stage.
- Firebase Hosting reported the live release and version listed above.
- Post-deploy projection verification remained 11 unchanged, 0 writes, and 0 errors with fingerprint 1523aa1f847d9f5733339a3ba42157cf948f20ffc9813703a5e723ee0a64310e (task05-verify-post-deploy.json).

## Manual acceptance checklist

Start with existing cloned accounts and avoid creating a new account or character in the first pass.

1. Sign in as an existing player and load /home.
2. Reload the page and confirm character, inventory, resources, gold, progression, spells, and techniques persist.
3. Equip and unequip one item, then reload.
4. Use one consumable or make one reversible inventory change, then reload.
5. Exercise one supported Bazaar purchase/change and confirm both UI and reload behavior.
6. Sign in as the DM and inspect the same user's data through normal DM views.
7. Sign out, sign back in, and repeat the read check.
8. Initially avoid Grigliata mutations and destructive character/account operations until the ordinary user flows pass.

There are 12 cloned Authentication accounts but only 11 Firestore user documents. The Auth-only account has no user projection to migrate; test its initialization separately if it is expected to use the app.

## Rollback procedure

Do not execute the stored rollback fingerprint later; Firestore state may have changed. Always regenerate and approve a fresh plan.

Rollback order:

1. Change the fixed Hosting profile in frontend/scripts/forced-release-environment.js to legacy-read.
2. Run release:test and build:production.
3. Deploy Hosting only and have testers refresh or close every old V2 tab.
4. Move server configuration from new-read-dual-write to dual-write with a fresh dry-run and fingerprint.
5. Verify all projections.
6. If desired, move from dual-write to legacy-read with another fresh dry-run and fingerprint.

Current read-only rollback preview:

- transition: new-read-dual-write -> dual-write
- preview fingerprint: ebdb452be1c7810303db22c14a529e2ad680f1177e2b1e73aacb02a20539bade
- generated from config update time: 2026-08-01T10:58:09.602Z

Fresh stage rollback command pattern:

~~~powershell
npm.cmd run users:set-v2-stage -- --project fatin-test --stage dual-write --auth firebase-cli --report performance-results/task05-rollback-dual-write.json --allow-live-project --confirm-project fatin-test

npm.cmd run users:set-v2-stage -- --project fatin-test --stage dual-write --auth firebase-cli --report performance-results/task05-rollback-dual-write.json --allow-live-project --confirm-project fatin-test --execute --approve-fingerprint <fresh-fingerprint>
~~~

## Limits before applying this to production

This test activation is not approval for a fatins production cutover.

- The migration and stage operator are intentionally hard-locked to fatin-test. Any production version must be deliberately retargeted and re-reviewed.
- new-only remains disabled because legacy-drain and residual-consumer gates are not complete.
- The app still has 42 explicitly tracked legacy-access files.
- A 24-hour second verification/soak was not performed.
- Full authorization and index testing against a Java 21 Firestore emulator was not repeated in this activation.
- Manual browser acceptance is still required.
- The initial backfill needed one additional idempotent convergence pass; production planning must account for this and stop on any non-zero verification result.
