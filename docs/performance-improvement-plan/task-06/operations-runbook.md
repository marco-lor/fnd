# Task 06 local operations runbook

This runbook is for `demo-fnd-perf` emulators only. It must not be adapted to a
live project by changing the project argument.

## Prerequisites

- Node 22+
- Java 21+ (the repository-local `.perf-tools/jdk-*` is detected)
- installed frontend and Functions dependencies
- ports `4000`, `4400`, `4500`, `5001`, `8080`, `9099`, `9150`, and `9199`
  available

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

## One safe integration command

From `frontend`:

```text
npm run perf:functions-integration
```

The command:

1. refuses any project other than exact `demo-fnd-perf`;
2. refuses inherited project/emulator settings that do not match the owned
   loopback environment;
3. builds Functions;
4. temporarily writes `.env.demo-fnd-perf` with demo Firebase settings and
   `FND_TASK06_CONSOLIDATED_OWNER=1`, then restores its prior contents;
5. starts only Auth, Firestore, Storage, and Functions emulators;
6. disables background triggers while the isolated Task 06 rules probes run;
7. runs six Task 06 rules probes and seven Functions acceptance scenarios
   sequentially;
8. verifies the authoritative derived owner performs exactly one user-root
   write and does not trigger a loop;
9. seeds 525 scale users, forces a scoped Task 05 drain pause, resumes the
   resulting 526-subject level-up operation, and verifies replay does not
   repeat completed subjects;
10. deletes 520 custom-token instances and 521 placements in bounded pages;
11. verifies lock-all completes beyond the former 500-write ceiling;
12. deletes an NPC referenced by 101 public and 101 private markers, including
    owned Storage media;
13. deletes an encounter with 101 participants, 101 logs, and nested effect
    collections;
14. verifies foe duplication cleans partial Storage copies and resumes using
    the same receipt;
15. sends an authenticated POST probe to all 30 callable manifest entries in
    their declared regions;
16. shuts down only its owned emulator process and requires its ports to become
    stably free.

The six-rule suite covers server-only operation/work/subject/receipt documents,
operator-only Task 06 config reads, pending NPC and public/private marker
fences, pending encounter parent/descendant fences, atomic encounter creation,
and pending custom-token instance/placement/token fences.

## Failure handling

- If preflight reports an occupied port, identify the owner manually. The
  harness deliberately does not kill it.
- If an operation is `paused`, fix only the documented emulator dependency or
  drain fence, re-enable the operation kind, and invoke
  `resumeBackendOperation` with the original operation ID.
- If it is `cleanup-pending`, preserve the operation record and Storage
  diagnostics; do not create a new logical operation ID until the orphan
  cleanup path is understood.
- After an ambiguous client error, do not clear
  `fnd.task06.operation-intents.v1`, change the immutable request, or invent a
  new operation ID. Retry the same action in the same tab so the stored ID can
  recover or replay the server receipt.
- Closing the tab discards `sessionStorage`; cross-tab and post-tab-close
  recovery are not production-ready.
- `FND_TASK06_FUNCTION_TEST_PATTERN` is diagnostic-only. A filtered run is not
  Task 06 acceptance; final acceptance requires all seven Functions scenarios
  with the variable unset.
- If the emulator process exits unexpectedly, keep `firebase-debug*.log` and
  `firestore-debug.log` as local evidence. They are ignored and must not be
  committed if they contain payload diagnostics.
- Never change `app_config/task06_backend` online as part of local validation.

## Production activation gates

Before any deployment or config change:

- pass the complete frontend, Functions, backend, rules, start, and production
  build suites from a clean reviewable worktree;
- inspect a function delete/create plan so compatibility aliases are not
  removed accidentally;
- run `shadow` parity and inspect sanitized mismatch metrics;
- measure `europe-west8` latency/cold starts and compatibility-alias traffic;
- verify TTL policies and required indexes are active;
- activate and verify the declared `map_markers_private.npcId`
  collection-group index before enabling NPC deletion;
- replace the tab-scoped intent store only after cross-tab and tab-close
  operation-ID recovery has equivalent privacy, bounding, and fail-closed
  behavior;
- define rollback to legacy trigger exports/config;
- schedule the change outside any live Grigliata battle.
