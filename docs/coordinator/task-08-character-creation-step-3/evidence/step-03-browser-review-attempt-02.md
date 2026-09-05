# Step 3 Browser review — attempt 2

## Pre-interaction record

- Review state: in progress after authenticated attempt-2 callback; no staging acceptance
- Git branch/SHA: `devs` / `9c7fcc7c5799a458768512b7cbab49e4d9b301a9`
- Tracked diff fingerprint: `1c4e5eb822a25c0b0346e4f4a0d4e8b11b94623bfcf9fb1411af8c4608796433`
- Source-tree fingerprint: `7904d127cebc1407aaaae1e089cb44f1e1e90f52560b6929f2ac90a6f8a0662c`
- Build identity: `9b5cd80060037a9078c73c06b18701e07daca803ecef933baf1464db65a83e4a`
- Main asset: `static/js/main.7dfd1aff.js`, SHA-256 `610167826a9f3b5e3790c27eddff80a7d7cb0d54339f3059eeed4fe7de29cd3d`
- Environment/URL: localhost-only Firebase Emulator Suite for project `demo-fnd-perf`, `http://127.0.0.1:5000/`
- Test identity: deterministic incomplete account `perf-new-player@example.test`; expected fixture count/hash `9139` / `fbabc02a3376d466cf717e3886e0d12a9e15568c17b654322cff4909dc6eaca8`
- Permitted mutations: only the disposable local `demo-fnd-perf` fixture through normal Character Creation actions. No remote `fatin-test` or production access.
- Media inputs: repository-local `frontend/public/logo192.png` and `frontend/public/logo512.png`; no final character submission or Storage upload is intended.

## Expected observations

1. Login reaches Character Creation and the current step becomes usable as its own required data settles.
2. Rapid repeated Next/Back activation produces one step movement, a visible disabled/busy interval, and no duplicate transition.
3. Forward/back/repeated visits retain the current selections without duplicate writes or stale state.
4. Avatar first select and replacement show only the current preview; reload/unmount leaves no stale preview.
5. Reload traverses auth/profile/shared-data readiness without another actor's state, a crash, or console/page errors.
6. A forced local read failure would show the appropriate current-step error/Retry behavior and recover after the fault is removed.
7. No final submit, unexpected remote request, remote mutation, or staging/production interaction occurs.

## Cleanup plan

- Stop only the task-owned emulator process through its existing terminal session.
- Reseed and verify the deterministic local fixture after Browser interaction.
- Prove ports `3000,3001,4000,4400,5000,5001,5002,8080,9099,9150,9199` are free.
- Record observed results, limitations, and artifact paths below before the verdict.

## Observations

1. The deterministic incomplete account logged in and reached `/character-creation`. Step 1 became usable with the permanent-summoning placeholder and no page or console error.
2. Selecting the race enabled Next. A Browser double-click produced one guarded transition: the Step 1 selection, Cancel, and Next controls were visibly disabled while the write settled, and the UI reached Step 2 rather than skipping a step.
3. Selecting `Spirito` reached Step 3, then Step 4. Back from Step 4 returned to Points Distribution; Next returned to Character Details with the selected race, shard, name, and avatar preview intact.
4. Selecting `frontend/public/logo192.png` produced one blob preview. Replacing it with `frontend/public/logo512.png` changed the blob URL while retaining exactly one Preview image.
5. Reloading while authenticated recovered at Step 1 with no stale avatar preview, crash, page error, or console warning/error.
6. No final character submission was performed. No staging or production URL, account, request, or mutation was used.
7. Browser-level actor switching and transport/read fault injection were unavailable through the selected in-app Browser surface. The overlapping-actor upload race, delayed-profile route behavior, unmount completion fencing, and independent-resource error behavior therefore remain source/automated-test review items rather than manually forced observations.

The normal Browser path did not expose a visual regression. Independent source review nevertheless found Important stale-unmount completion, cross-actor legacy-upload cleanup, post-upload URL-failure rollback, stale-profile redirect, delayed-profile confirmation-banner, and current-step incremental-loader gaps. Those findings block acceptance and are being returned to the same developer task.

## Cleanup result

- The agent-created Browser tab was closed without submitting character creation.
- The first post-run fixture restoration lost its emulator process while waiting for the Functions directory-projection sentinel. Only the exact stalled fixture worker (`PID 28344`) was stopped; no remote state was involved.
- The local suite was restarted, the fixture was reseeded, and an independent authoritative verification passed: `9139` documents, hash `fbabc02a3376d466cf717e3886e0d12a9e15568c17b654322cff4909dc6eaca8`.
- The exact task-owned listeners (`PIDs 8708`, `22496`, and `26516`) were stopped after the wrapper did not consume Ctrl+C. Their simultaneous start times and ownership of only the recorded Task 08 ports were verified first.
- Ports `3000`, `3001`, `4000`, `4400`, `5000`, `5001`, `5002`, `8080`, `9099`, `9150`, and `9199` were confirmed free; the exact reviewed process IDs were no longer present.
