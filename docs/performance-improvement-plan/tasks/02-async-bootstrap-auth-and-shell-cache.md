# Task 02 - Async bootstrap, auth, and shell cache

Depends on Task 01.

## Outcome

Remove the main-thread-blocking runtime-config request, use one authentication/profile authority, and make warm startup possible without synchronously caching the entire user document.

## Evidence

- `frontend/src/components/firebaseConfig.js:41-65` performs synchronous XHR during module evaluation.
- Hosting proxies it to `clientFirebaseConfig` in `europe-west1` (`frontend/firebase.json:140-145`).
- `frontend/src/index.js:5,13-17` mounts an unused `FirebaseProvider`; `context/FirebaseContext.js:17-33` adds a second auth observer and user read.
- `frontend/src/AuthContext.js:55-64` serializes the full user aggregate to localStorage on every snapshot.
- Login separately reads the profile (`frontend/src/components/Login.js:36-64`).

## Implementation elements

1. Replace synchronous module initialization with an async bootstrap state machine: config loading, Firebase initialization, auth readiness, profile freshness, ready, and recoverable error.
2. Preserve externalized runtime configuration. Either inject validated config into bootstrap HTML or fetch it asynchronously exactly once; preserve App Check semantics and single Firebase initialization.
3. Remove `FirebaseProvider` and `FirebaseContext` after confirming no consumers. Consolidate sign-out and profile readiness in the authoritative auth layer.
4. Make Login navigation consume the shared profile authority rather than issuing an independent profile read.
5. Split `authReady` from `profileFresh`. Show a deterministic shell/loading/error UI rather than a blank root.
6. Replace whole-document localStorage writes with a versioned, UID-scoped shell cache containing only approved fields such as role, display name/character ID, level, and avatar thumbnail.
7. If larger offline state is later required, use an asynchronous store with explicit eviction; do not expand this localStorage payload.
8. Split auth context values or add selectors so a high-frequency stat update does not broadcast to role-only/navigation consumers.

## Boundaries and non-goals

- Do not change route paths, role policy, App Check enforcement, Firebase project selection, or Firestore schema.
- Do not embed secrets; Firebase client configuration remains treated according to the existing security design.
- Do not show cached data until the authenticated UID matches the cache key.
- Do not remove live role/profile updates.

## Tests

- Delayed, failed, malformed, and successful config responses.
- Exactly one runtime-config request, Firebase app instance, and `onAuthStateChanged` registration.
- Exactly one initial profile subscription/read after login.
- Warm-cache paint, stale-cache refresh, sign-out, account switch, deleted profile, and role-change behavior.
- Render-count test: stats changes do not rerender role-only shell consumers.
- Security test: cache contains only the allowlisted fields and stays below a 5 KiB serialized budget.

## Acceptance gates

- Browser trace contains no synchronous XHR and remains responsive during delayed config.
- Startup removes the extra provider read and Login profile read.
- Whole `userData` is never written to localStorage.
- Authorization redirects and direct navigation behave exactly as before.

## Rollback

Keep bootstrap behind a release switch for one rollout. Roll back to the old async-compatible config endpoint contract, never to synchronous XHR.
