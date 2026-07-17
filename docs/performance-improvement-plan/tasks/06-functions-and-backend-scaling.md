# Task 06 - Functions and backend scaling

Depends on Tasks 04 and 05.

## Outcome

Reduce user-trigger amplification, standardize callable locality/ownership, make bulk work idempotent and bounded, and decide whether the Python service should be slimmed or retired.

## Evidence

- Five triggers target every `users/{userId}` update.
- `updateTotParameters.ts:99-103` rewrites the full parameter map; HP and mana each read `utils/varie`.
- Callables span `us-central1`, `europe-west1`, and `europe-west8`, with region clients scattered through pages.
- `levelUpAll.ts:40-91` uses one batch with two writes per user and ignores its idempotency key.
- `duplicateFoeWithAssets.ts:129-179` copies assets serially.
- `deleteGrigliataCustomToken.ts:90-96` performs one placements query per token/instance.
- `backend/main.py` loads Firestore and maintenance schemas for a healthcheck-only API; bulk user maintenance refetches streamed users.

## Implementation elements

1. Publish a function-region inventory and select region ownership based on Firestore/Storage locality and measured client latency. Centralize callable handles; plan compatibility aliases before moving deployed endpoints.
2. Replace broad user trigger cascades with one derived-state owner or narrower schema-specific triggers from Task 05. Compute totals/HP/mana/anima once per relevant change and write only changed fields atomically.
3. Cache/version static calculation config safely within warm instances or include validated configuration in the authoritative transaction; define invalidation.
4. Add structured logs, correlation/operation IDs, latency/read/write metrics, and error classes without logging private game content.
5. Make `levelUpAll`, lock-all, NPC/encounter cleanup, and other bulk operations use bounded chunks/BulkWriter, progress state, resumability, and real idempotency.
6. Add client-generated idempotency for foe duplication, bounded parallel Storage copies, and orphan cleanup/operation recovery.
7. Replace N+1 deletion queries with chunked indexed queries or server-owned recursive operations.
8. Evaluate the Python service: either isolate a dependency-light health app and lazily import CLI maintenance, or remove the deployment if no production caller exists. Fix CLI N+1 reads and batch writes independently.
9. Narrow Functions lint to source/config and eliminate warnings from ignored compiled output. Add Functions and backend tests.

## Boundaries and non-goals

- Do not change gameplay formulas, role policy, audit requirements, or maximum levels.
- Do not move a function region without a client/deployment compatibility plan.
- Do not use unbounded `Promise.all`/BulkWriter concurrency.
- Do not enable `minInstances` until region/cold-start measurements justify its recurring cost.
- Keep destructive maintenance local/admin-authorized and dry-run by default.

## Tests

- Emulator formula equivalence for every relevant before/after field combination.
- Assert one authoritative derived write and no trigger loop for a representative stat/level change.
- Scale tests above 500 writes, interrupted/resumed operations, duplicate idempotency requests, and partial Storage failures.
- Region/alias integration tests from each frontend callable registry entry.
- Python import/startup and CLI dry-run/batch tests if retained.

## Acceptance gates

- A high-frequency stat write invokes only the intended server path and emits the minimum field update.
- Bulk operations succeed beyond former batch ceilings and can be safely retried.
- Callable latency and cold starts are observable by function/region.
- The production role of the Python service is documented and its startup path is proportional to that role.
