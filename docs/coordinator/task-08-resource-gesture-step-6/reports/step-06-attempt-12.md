# Task 08 Step 6 — Attempt 12 recovery and integration

Status: `DONE_WITH_CONCERNS`  
Date: 2026-09-01  
Checkout: `C:\Users\Marco\OneDrive\git_projects\fnd-devs`  
Branch / baseline HEAD: `devs` / `9c7fcc7c5799a458768512b7cbab49e4d9b301a9`  
Dispatch tracked/source fingerprints: `3cca79dbdf051640a887472b6b1ed6a3ad79acb000b38bee3569c37138950e65` / `fb5d45086c70bf51490de3a6fd10f61db9d63d6d62d01911599b1dd489d550c5`.

## Attempt 11 reconciliation

Attempt 11 ended without a report or callback. Its terminal evidence showed the owned Task 08 callable-emulator command start Firestore and then report `"node" is not recognized as an internal or external command` while loading Functions. The source tree contains its narrow Windows PATH-casing repair: Firebase CLI environments collapse `Path`/`PATH`, `environmentPath()` reads an inherited path irrespective of spelling, and the main/rules emulator launchers retain that inherited node path after prepending portable Java. The original RED output is recoverable from this task's terminal history; no source state will be undone merely to reproduce it.

This report will be updated after each major gate.

## Attempt 12 focused recovery

- Confirmed `devs` at `9c7fcc7c5799a458768512b7cbab49e4d9b301a9`.
- Original red evidence is retained from Attempt 11: the Functions emulator reported `"node" is not recognized as an internal or external command` after portable Java prepended an environment that had inherited `Path` rather than `PATH`.
- Added the narrow owner-level assertion `rules emulator child keeps inherited node PATH behind portable Java with one Windows PATH key`. It captures the exact `firebase emulators:exec` environment and proves one canonical `PATH`, portable Java first, inherited Node retained, and unrelated variables preserved.
- Green: `node --test scripts/performance/emulators.test.js scripts/performance/firebase-emulator-supervisor.test.js scripts/performance/task07-harness.test.js` — `53/53` passed.
- Green: `node --test scripts/performance/task07-harness.test.js` — `21/21` passed, including the added exact-spawn assertion.
- The retained Firebase debug log includes a later successful Functions initialization and callable activity after the older `"node"` entry.

## Complete owned local verification

- `npm run perf:test`: `450/450` passed.
- Fresh owned callable/emulator behavior run (`npm run perf:task08:behavior -- --skip-browser`): Jest `65/65`, Node rules `4/4`, and callable integration `17/17` passed. The Functions emulator initialized successfully; all owned emulator processes exited and all harness ports were then free.
- Fresh full Chromium run (`npm run perf:task08`): Playwright `6/6` passed (asset warmup, auth setup, Login, Character Creation, Home, and two-client) in 4.0 minutes. The result is `complete: true`, `officialBaseline: false`, run ID `f7b38e3c-790e-4448-bba3-437154ccb81f`, and source fingerprint `6235c283cf134a4e2c3d6b9a015da4bf2e05a47a02b8300f4d0a0e2ecc9dc902` at baseline HEAD `9c7fcc7c5799a458768512b7cbab49e4d9b301a9`.
- Full observed metric records are retained in `frontend/performance-results/task08-baseline.json`. Highlights: Login performed 1 sign-in, 1 account creation request, 2 profile reads, 7 config reads, and a 4278.3 ms navigation; Character Creation made 1 codex read, 1 config-varie read, 2 authoritative writes, and exact object-URL create/revoke cleanup; Home verified 500 initial items, a 60/120 virtualization window, one resource mutation of -11, and an atomic consumable commit; two-client convergence ended at resource value 40, visible on both clients, with the consumed item absent on both clients.
- `npm run perf:verify-fixture`: verified 9,139 documents, 136 storage objects, and fixture hash `fbabc02a3376d466cf717e3886e0d12a9e15568c17b654322cff4909dc6eaca8` for `demo-fnd-perf`.
- Staging restoration completed without opening or changing the user staging tab: `FND_GIT_BRANCH=devs npm run build:staging`, `FND_GIT_BRANCH=devs npm run verify:staging-build`, and `FND_GIT_BRANCH=devs npm run perf:verify-disabled` all passed.

## Concerns and boundaries

- Expected local-only warnings remain: Firebase MOTD certificate retrieval, an outdated `firebase-functions` advisory, Storage's unsafe-rule warning, and Node `punycode` deprecation. They did not fail any gate.
- No remote Firebase action, deployment, commit, push, merge, reset, stash, cleanup of user files, or staging-browser interaction occurred.
- The already user-modified tracked Task 08 README was intentionally not altered during this attempt: doing so after the source-matched full run would change its tracked fingerprint and invalidate the recorded build/report identity. This untracked attempt report preserves the durable evidence without that risk.
- Coordinator review/manual Browser acceptance remains external to this local developer attempt.

## Callback delivery

- The one required callback attempt to coordinator task `01a047ff-5aee-7c22-8ec8-d74c7ade949d` was rejected by the app risk policy because the payload contains a callback token and detailed project evidence. No retry or workaround was attempted. Delivery status: `failed`.
