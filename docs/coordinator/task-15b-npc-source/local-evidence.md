# Task 15B local implementation evidence

Verified on `devs` on 2026-11-02, starting at `9f770f3d6551b38f5adbfb31765f11abf8dd65fe`. Latest user scope is code for `fatin-test` and a reviewed `devs` to `main` PR left unmerged. No deployment, live edits or production work occurred. Browser acceptance was skipped by request.

## Listener gate and compatibility

The new `EchiNpcs.integration.test.js` mounts the real page, sidebar and map readers. Only auth/layout configuration and the Firestore boundary are replaced. The same deterministic fixture has 500 NPCs with the existing ISO-string timestamp and 2,000 map markers with the existing coordinate distribution. Portrait URLs are omitted because this measures reader ownership, not media requests.

| Measurement | Before | After | Gate |
| --- | ---: | ---: | ---: |
| Active physical NPC listeners | 2 | 1 | 1 |
| Initial NPC documents delivered at the mocked listener boundary | 1,000 | 500 | One complete 500-record delivery |
| Active NPC listeners after route cleanup | Not reached in red test | 0 | 0 |

The pre-change test failed with expected listener count 1, actual 2. Both fixture row/marker counts passed first. The after test also asserts one physical unsubscribe, stable ownership on rerender, StrictMode, route re-entry, same-UID access reconnect, stale callback suppression, and coherent updates to sidebar/map. These are client-boundary measurements, not billed reads or network bytes. No FPS, memory, DOM bounding or map-transfer improvement is claimed.

Repository/hook tests cover raw fields and authoritative IDs, missing-timestamp map membership, null/pending values, timestamp nanoseconds, mixed string/Timestamp order and descending ID ties, incremental add/modify/remove, no-op wrapper identity and unchanged entity identity. Existing hover/focus/media/deletion tests remain. An additional red/green regression proved that an old edit draft survived an access-generation change; a key tied only to UID/access generation now resets that local UI. Ordinary snapshots retain popup DOM/focus and local drafts; portrait saves use the latest shared media revision.

## Commands and results

Run from `frontend` after `source /workspace/.fnd-onboarding/activate.sh`, which selected Node 22.

- Red: `CI=true npm test -- --watch=false --watchman=false --runInBand --runTestsByPath src/components/echiDiViaggio/EchiNpcs.integration.test.js -t '500 NPCs'`. Expected failure: one listener required, two observed.
- Focused: `CI=true npm test -- --watch=false --watchman=false --runInBand --runTestsByPath src/data/echiNpcsRepository.test.js src/data/useEchiNpcs.test.js src/components/echiDiViaggio/EchiNpcs.integration.test.js src/components/echiDiViaggio/EchiDiViaggio.test.js src/components/echiDiViaggio/NpcSidebar.test.js src/components/echiDiViaggio/MapEditor.test.js src/components/echiDiViaggio/EchiMapPicture.test.js`. PASS, 7 suites / 59 tests.
- `node --test scripts/performance/check-query-contracts.test.js scripts/performance/check-media-boundaries.test.js`. PASS, 2 Node test files.
- `npm run perf:check-firestore-imports`. PASS.
- `npm run perf:check-query-contracts`. PASS, 42 listener call sites / 19 repository query shapes / 11 activated indexes. These are source inventory totals, not concurrent route listeners.
- `npm run perf:check-media-boundaries`. PASS.
- `CI=true npm test -- --watch=false --watchman=false --runInBand`. PASS, 195 suites / 1,839 tests, one complete run. Existing negative-path tests emit expected console errors; no test failed.
- Guarded `npm run build:staging` and `npm run verify:staging-build`. PASS, exit 0. The controller-provided staging app ID and App Check site key were loaded from a workspace-only configuration file into the child environment. No guard was bypassed and no values were copied into source. This compiled the implementation tree before its commit; it is not a deployed release identity. Build emitted the existing stale Browserslist database notice.
- `git diff --check`. PASS.

## Native Firestore ordering comparison

Repeatable one-off local command, separate from existing CI:

```sh
source /workspace/.fnd-onboarding/activate.sh
node node_modules/firebase-tools/lib/bin/firebase.js emulators:exec --project demo-fnd-perf --only firestore --config firebase.json 'node --test --test-force-exit performance/tests/task15b-npc-order.test.js'
```

PASS, 1 test, test runner and Firebase CLI exit 0; emulator shutdown confirmed. The test loads the actual shipped projector/runtime, compares IDs against native `orderBy('createdAt', 'desc')`, and checks acknowledged Timestamp/ISO-string mixtures, nanosecond distinctions, null/missing fields, Unicode/ID ties, offline pending server timestamps, and their server acknowledgment. Pending timestamps sort above even future acknowledged timestamps while raw `createdAt` stays null. Local test data is cleared.

The Node Firestore SDK retained one HTTP/2 TCP socket to the local emulator after awaited public `db.terminate()` and test-environment cleanup. Natural-exit attempts completed assertions but hung; one interim cleanup attempt also used the wrong modular termination entrypoint for the compatibility client and failed before correction. The documented command uses Node's `--test-force-exit` after test/cleanup completion. It preserves test failures and lets Firebase CLI shut down its emulator. This is an ordering check, not proof of natural Node transport shutdown; production reader cleanup is independently asserted at the subscription boundary in Jest.

## Remaining scope

Independent reviewer approval, PR creation/check monitoring and waiting for merge belong to the controller. The PR stays unmerged. Browser/manual acceptance, deployments, production checks and real billed-read measurements are outside the latest request. Marker queries, map delivery, writers, rules, indexes, thumbnails/fade and private-marker deletion policy were not redesigned.
