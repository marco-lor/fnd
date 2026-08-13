# Task 06 local operations runbook

Last verified: 2026-08-12.

This runbook is for the exact `demo-fnd-perf` emulator project only. It must not
be adapted to a live project by changing a project argument.

## Prerequisites

- Node 22+
- Java 21+ (the repository-local `.perf-tools/jdk-*` is detected)
- installed frontend and Functions dependencies
- ports `4000`, `4400`, `4500`, `5001`, `8080`, `9099`, `9150`, `9199`,
  `9299`, and `9499` available

The Task 06 harness does not start Hosting and does not own ports `3000` or
`5000`. It refuses occupied ports and never terminates their owners.

## Static checks

From `frontend`:

```text
npm run perf:check-callable-registry
npm run perf:fixture-determinism
npm run perf:test
```

From `frontend/functions`:

```text
npm run lint
npm test
```

The Functions build deletes only `functions/lib`, recompiles, then verifies no
retired Task 05 module or export remains in generated output.

## One safe integration command

From `frontend`:

```text
npm run perf:functions-integration
```

The command:

1. refuses every project except exact `demo-fnd-perf` and rejects inherited
   non-demo identities or emulator hosts;
2. builds a clean Functions output and temporarily writes only owned demo
   Firebase settings to `.env.demo-fnd-perf`;
3. starts Auth, Firestore, Storage, and Functions emulators;
4. disables background triggers around the six isolated rules probes and the
   initial high-volume Functions fixture seed, then proves side-effect-free
   callable registration in both deployed regions and the actual Task 06 worker
   registration with a disposable demo-only work probe. If the Functions
   Emulator loses that trigger during the seed reload, the harness performs at
   most two additional no-op disable/enable recovery cycles before failing
   closed. Later fixtures are seeded without reloading the Functions runtime;
   the one terminal-cleanup transition that must suppress triggers proves
   callable registration again before continuing;
5. proves retired legacy root-domain writes cause no derived root or V2 state
   mutation;
6. completes and idempotently replays a level-up operation across more than 500
   subjects using V2 progression/resources documents;
7. deletes more than 500 custom-token instances and placements in bounded
   pages and replays safely;
8. verifies lock-all beyond the former batch ceiling and exercises NPC,
   encounter, foe-copy, canonical-media, cleanup, lease, and operation-gate
   scenarios;
9. probes every callable manifest key in its declared emulator region, releasing
   idle emulator workers between bounded groups to avoid Windows process/commit
   exhaustion; and
10. shuts down only its owned emulator process and requires all owned ports to
    become stably free.

No Task 05 rollout/drain document and no consolidated-owner environment switch
participates in this harness.

## Failure handling

- If preflight reports an occupied port, identify the owner manually. The
  harness deliberately does not kill it.
- If an operation is `paused`, repair only the documented dependency or
  re-enable its Task 06 operation kind, then invoke `resumeBackendOperation`
  with the original operation ID.
- If it is `cleanup-pending`, preserve the operation and Storage diagnostics;
  do not create a new logical operation ID until the orphan path is understood.
- After an ambiguous client error, reuse the same operation ID. Do not clear
  `fnd.task06.operation-intents.v1` or change immutable request input.
- `FND_TASK06_FUNCTION_TEST_PATTERN` is diagnostic-only. A filtered run is not
  acceptance; final acceptance requires the complete suite with it unset.
- Preserve local emulator logs on unexpected exit, but never commit payload
  diagnostics.
- Never mutate `app_config/task06_backend` online as part of local validation.

## Live-release gates

Before a related production deployment or config change:

- pass complete frontend, Functions, rules, V2 tool, release, production-build,
  and emulator gates from the exact reviewable checkout;
- verify the target is already Task 05 new-only and physically compacted;
- inspect the live Function inventory and exact delete set;
- preserve the Grigliata region, foe-duplication alias, and Task 07 media
  compatibility exports;
- verify required indexes, TTL policies, App Check, and Storage cleanup state;
- obtain an independent review of the frozen diff and deployment order; and
- schedule the release outside a live Grigliata battle when the target is not a
  disposable test environment.

For the Task 05 runtime retirement, deploy Functions first so retired exports
are removed from the backend, then Firestore rules, then Hosting. Perform an
authenticated smoke of Home, DM, Bazaar, Combat, and Grigliata before accepting
the release.
