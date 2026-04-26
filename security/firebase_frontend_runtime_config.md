# Firebase Frontend Runtime Config Mitigation

This note documents the frontend change made to remove Firebase Web API key
findings from the public resource scan.

## What Changed

- `frontend/src/components/firebaseConfig.js` no longer contains a hardcoded
  Firebase config. It loads the client config from
  `/fatins-runtime/firebase-client` before initializing Firebase.
- `frontend/functions/src/clientFirebaseConfig.ts` exposes the Firebase client
  config from Firebase Functions params.
- `frontend/firebase.json` rewrites `/fatins-runtime/firebase-client` to the
  `clientFirebaseConfig` HTTPS function in `europe-west1`.
- `frontend/scripts/build-production.js` now fails production verification if
  built JS, CSS, or HTML contains a Google API key pattern such as `AIza...`.
- The Firebase Hosting site is expected to stay unlinked from the Firebase Web
  App, so Firebase reserved init endpoints such as `/__/firebase/init.js` should
  not expose the linked Web App config.

## Required Runtime Values

Populate these Functions params before deploying. Do not commit real values.

```text
FATINS_FIREBASE_API_KEY=
FATINS_FIREBASE_AUTH_DOMAIN=
FATINS_FIREBASE_PROJECT_ID=
FATINS_FIREBASE_STORAGE_BUCKET=
FATINS_FIREBASE_MESSAGING_SENDER_ID=
FATINS_FIREBASE_APP_ID=
FATINS_FIREBASE_MEASUREMENT_ID=
```

`FATINS_FIREBASE_MEASUREMENT_ID` is optional and may be left empty if Analytics
is not needed.

For local `npm start`, create `frontend/.env.local` with the matching
`FATINS_FIREBASE_*` values from `frontend/.env.example`. CRA's development
server serves `/fatins-runtime/firebase-client` through `src/setupProxy.js`,
which reads those values server-side. Do not commit `.env.local`.

## Deployment Steps

1. Set or populate the Functions params listed above.
2. Build and verify the frontend:

   ```powershell
   npm --prefix frontend run build:production
   ```

3. Build the Functions project:

   ```powershell
   npm --prefix frontend/functions run build
   ```

4. Deploy Functions and Hosting:

   ```powershell
   npm --prefix frontend run fb:deploy:functions
   npm --prefix frontend run fb:deploy:hosting
   ```

5. Confirm the Hosting site remains unlinked from the Firebase Web App in
   Firebase Console. Hosting releases, domains, deploys, and rollbacks remain
   usable after unlinking.

## Verification Steps

Run the public resource scanner:

```powershell
python security/frontend_mapper_previews.py
```

Confirm the report has no `high_google_api_key` finding for:

- `https://fatins.web.app/__/firebase/init.js`
- `https://fatins.web.app/static/js/main.*.js`

Then manually verify login and Firestore-backed pages. The app now depends on
the same-origin runtime config endpoint before Firebase can initialize.

## Operational Note

Do not relink the Firebase Web App to the Hosting site unless you accept that
Firebase reserved init endpoints may expose the Web App config again.
