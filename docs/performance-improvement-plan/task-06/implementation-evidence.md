# Task 06 implementation evidence

Date: 2026-07-26. Closure date: 2026-07-27. Status: locally validated for
roadmap progression; Task 07 may start. Evidence scope: repository plus local
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
    `135be517702ba0edb56ea4e7821944f6d2994c3032b35cf6d34c26699434e8f0`

## Validation record

These results are from local commands against the exact demo project
`demo-fnd-perf`; no online project was contacted or mutated.

| Gate | Command | Status |
| --- | --- | --- |
| Functions compile | `cd frontend/functions && npm run build` | Passed locally on 2026-07-26. |
| Functions lint | `cd frontend/functions && npm run lint` | Passed locally on 2026-07-26. |
| Modular Firestore sentinel regression | `cd frontend/functions && node --test test/legacyRootMutationGate.test.js` | 7/7 passed on 2026-07-26, including CRLF-safe source guards. |
| Demo rules and callable matrix | exact `demo-fnd-perf` Auth/Firestore/Functions/Storage emulator wrapper | 14/14, 3/3, and 11/11 groups passed on 2026-07-26. |
| Harness/static tests | `cd frontend && npm run perf:test` | 169/169 passed on 2026-07-26. |
| Callable registry | `cd frontend && npm run perf:check-callable-registry` | Passed on 2026-07-26: 30 callables across 3 regions. |
| Deterministic fixture | `cd frontend && npm run perf:fixture-determinism` | 7,879 documents and hash `135be517702ba0edb56ea4e7821944f6d2994c3032b35cf6d34c26699434e8f0`. |
| Task 06 Functions acceptance | `cd frontend && npm run perf:functions-integration` | Unfiltered 7/7 passed on 2026-07-26, including pause/resume/replay, bounded cleanup, and every declared callable region. |
| Full Functions suite | `cd frontend/functions && npm test` | 77/77 passed on 2026-07-26. |
| Full frontend suite | CI-mode serial React/Jest run | 90/90 suites and 847/847 tests passed on 2026-07-26. |
| Python backend suite | `python -m unittest -v backend.test_backend_health_and_maintenance backend.test_firestore_backup` | 21/21 passed on 2026-07-26. |
| Production build | `cd frontend && npm run build:production` | Compiled successfully on 2026-07-26. |
| Production-build verification | `cd frontend && npm run verify:production-build` | Passed on 2026-07-26. |
| `npm start` smoke | `cd frontend && npm run verify:start` | `/home` returned HTTP 200 on owned port 3001; the existing port-3000 process was untouched. |
| Instrumented-build safeguard | `cd frontend && npm run perf:build` | Passed with exactly 2 pinned callback occurrences and 1 executable WebChannel callsite. |
| Broad performance CI | `cd frontend && npm run perf:ci` | 157/157 harness checks, 14/14 plus 3/3 emulator rules groups, and 19/19 browser tests passed; every blocking comparison gate passed. |
| Authoritative repeatability | `cd frontend && npm run perf:authoritative` | Not accepted. The first clean two-run pair completed 61/61 browser cases per run but exceeded the timing-repeatability threshold, with 92.42% maximum relative variance. After the measurement contract was hardened, a fresh pair was deliberately not rerun; the user accepted the remaining evidence as sufficient to close Task 06. No baseline was accepted. |

## Closure decision

On 2026-07-27, the user accepted Task 06 as validated for local roadmap
progression based on the complete correctness, emulator, build, startup, and
broad performance-CI evidence above. This closes Task 06 as a prerequisite and
allows Task 07 to start.

This sequencing decision does not turn the repeatability result into a pass.
Authoritative repeatability remains unavailable as performance-baseline
evidence, and production deployment/rollout remains a separate gated decision.

The current pass closed the two prior browser cleanup blockers. The deterministic
fixture now records all three completed legacy-placement migrations, so the
manager does not perform obsolete serial cleanup during measured startup. The
auth aggregate listener is shell-owned, and the pinned WebChannel watchdog is
transport-owned without a five-second timing assumption. The performance build
now refuses to proceed unless the minified callback remains unique to exactly
one executable WebChannel callsite.

The emulator rules wrapper also exposed legacy namespace access to
`admin.firestore.Timestamp` and `admin.firestore.FieldValue` in
`userDataCommands.ts`. Using the repository's modular `firebase-admin/firestore`
sentinels restored all Task 05 callable acceptance cases under the emulator.

The broad comparison passed every blocking gate. Five advisory targets
(`initial collection view`, LCP, INP, CLS, and Grigliata long task) remain above target.
They are recorded as non-blocking and no baseline was rewritten or accepted.

Passing local evidence does not authorize `firebase deploy`, a Task 06 config
write online, a TTL/index deployment, or acceptance of a new performance
baseline.

All validation was repository-local or used exact project `demo-fnd-perf`.
Playwright exercised only the isolated demo-emulator `/grigliata`; no browser
navigated to the live board, its presence was not read or changed, and no
Firebase deployment, online config/data/rules/index mutation, baseline
acceptance, push, or production rollout was performed. The declared index
and TTL policies remain undeployed.

The scoped local validation commits are
`c606309df3eee2ce3609c48c0c1a6c9fd6599d27` and
`22781c432097ca7479e10e4a89f64d31b581c48c`. They were not pushed and do not
authorize deployment or baseline acceptance.
