# Task 06 implementation evidence

Date: 2026-07-23. Candidate scope: repository plus local
`demo-fnd-perf` emulators. No Firebase deployment, production configuration,
online data/rules/index change, or live Grigliata navigation is evidence here.

## Checked-in evidence surfaces

- Callable registry and manifest with three explicit regions.
- Demo-only consolidated trigger export switch; normal exports remain
  compatible.
- One field-level derived owner with legacy/shadow/authoritative modes.
- Server-only operation/work/subject records with bounded pages, leases,
  progress, resume, idempotency, and sanitized telemetry.
- Candidate-only durable session intent IDs for migrated bulk, destructive, and
  point-spend flows, with same-tab reload recovery and fail-closed limits.
- Callable manifest validation and emulator reachability for all 30 logical
  callables across three regions.
- Bounded foe Storage copy plus failure cleanup.
- Chunked custom-token reference deletion.
- Pending NPC and encounter deletion fences.
- Declared ascending collection-group index for
  `map_markers_private.npcId`; declaration only, not deployed.
- Dependency-light Python health app and separate maintenance CLI.
- Deterministic fixture control document:
  - document count: `7,879`
  - `app_config` count: `1`
  - canonical hash:
    `a2abfe524d38fd0f1f8540c44353cafe942d7c7fc71f31cedeacabe52621d9c9`

## Validation record

These results are from local commands against the exact demo project
`demo-fnd-perf`; no online project was contacted or mutated.

| Gate | Command | Status |
| --- | --- | --- |
| Functions compile | `cd frontend/functions && npm run build` | Passed locally on 2026-07-23. |
| Functions lint | `cd frontend/functions && npm run lint` | Passed locally on 2026-07-23. |
| Demo export boundary | `cd frontend/functions && node --test test/demoConsolidatedExports.test.js` | 3/3 passed on 2026-07-23. |
| Task 06 rules | integrated demo Firestore/Storage emulator suite | 6/6 passed on 2026-07-23. |
| Harness/static tests | `cd frontend && npm run perf:test` | 169/169 passed on 2026-07-23. |
| Callable registry | `cd frontend && npm run perf:check-callable-registry` | Passed on 2026-07-23: 30 callables across 3 regions. |
| Task 06 Functions acceptance | `cd frontend && npm run perf:functions-integration` | 7/7 passed on 2026-07-23: one derived-root write/no loop; 526 planned/processed, 524 succeeded, 2 skipped, 0 failed; pause/resume/replay; paged lock, token, NPC, encounter, and Storage cleanup; and all 30 callable routes verified. |
| Full Functions suite | `cd frontend/functions && npm test -- --runInBand` | 76/76 passed on 2026-07-23. |
| Full frontend suite | CI-mode React/Jest run | 90/90 suites and 846/846 tests passed on 2026-07-23. |
| Python backend suite | repository backend test command | 21/21 passed on 2026-07-23. |
| Production build | `cd frontend && npm run build:production` | Compiled successfully on 2026-07-23. |
| Production-build verification | `cd frontend && npm run verify:production-build` | Passed on 2026-07-23. |
| `npm start` smoke | `cd frontend && npm run verify:start` | Compiled and `/home` returned HTTP 200 on owned port 3001 on 2026-07-23; the existing port-3000 process was untouched. |
| Broad performance CI | `cd frontend && npm run perf:ci` | Static checks, deterministic fixtures, production builds, emulator health, and 14/14 seeded Firestore rules passed. The non-authoritative browser phase remained blocked at 6/19 passed by the existing cleanup-accounting gate: a shared 45-second Firestore WebChannel watchdog was attributed to `/grigliata`, and protected-route cleanup retained one route-counted listener. The comparison/baseline stage did not run. |

The broad rules run initially exposed Firestore's expression ceiling in the
Task 05 aggregate-freeze helper. Consolidating rollout/drain evaluation to one
config read removed that evaluator failure. It also exposed two ineffective
fixtures: one expected `stage` to override canonical `mode`, and one wrote an
already-stored boolean. The fixtures now use canonical `new-only` plus an
explicit peer override and perform a real boolean transition; all 14 seeded
rules cases pass.

Passing local evidence does not authorize `firebase deploy`, a Task 06 config
write online, a TTL/index deployment, or acceptance of a new performance
baseline.

All validation was repository-local or used exact project `demo-fnd-perf`.
Playwright exercised only the isolated demo-emulator `/grigliata`; no browser
navigated to the live board, its presence was not read or changed, and no
Firebase deployment, online config/data/rules/index mutation, baseline
acceptance, commit, or production rollout was performed. The declared index
and TTL policies remain undeployed.
