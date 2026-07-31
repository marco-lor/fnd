# Fatin Test

This repository is an isolated test copy of the FND `devs` working tree at
commit `ca5bca36b505271a95701330390aec41952b6e6f`.

## Firebase project

- Project ID: `fatin-test`
- Hosting: `https://fatin-test.web.app`
- Firestore location: `europe-west8` (Milan)
- Default Storage bucket: `fatin-test.firebasestorage.app`
- Functions: preserve the regions declared in source (`europe-west8`,
  `europe-west1`, and `us-central1`)
- Billing: linked to the same billing account as the source project

The initial clone copied the source Firestore documents, Storage objects, and
Firebase Authentication users. Password credentials were imported with the
source Firebase SCRYPT parameters, so existing passwords continue to work.
Existing browser sessions and Firebase tokens are project-specific and were not
copied; users must sign in again on the test site.

## Isolation rules

Production project `fatins` is never a valid deployment target from this
repository. The deployment guard accepts only `fatin-test`, and the npm deploy
commands specify that project explicitly.

Do not weaken or bypass `frontend/scripts/firebase-backend-release-guard.js`.
Production may be inspected only through intentionally read-only procedures.

Local SDK settings live in ignored files:

- `frontend/.env.local`
- `frontend/functions/.env.fatin-test`

These files must remain untracked. Never commit account credentials, Firebase
CLI login state, service-account keys, browser login state, or data exports.

## Common commands

Run frontend commands from `frontend/`:

```powershell
npm.cmd start
npm.cmd test -- --watch=false
npm.cmd run build:production
npm.cmd run fb:deploy:hosting
npm.cmd run fb:deploy:rules
npm.cmd run fb:deploy:functions -- --force
```

All deploy commands are hard-bound to `fatin-test` and run the exact-target
guard before changing Firebase resources.

## External Python service

The repository includes the Python backend code, but the external Render
service itself is not a Firebase resource and was not duplicated. If a separate
Render service is later created, configure it only with test-project credentials
and test origins.
