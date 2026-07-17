# Task 20 - Grigliata fog persistence

Depends on Task 19.

## Outcome

Persist fog edits without lost updates, unbounded request bursts, or dependence on best-effort unmount writes, while keeping brush latency local and recoverable.

## Evidence

- `useGrigliataFogOfWarPersistence.js:465-549` uses a non-transactional read/merge/write pattern that can lose concurrent edits.
- Flush paths can launch unbounded `Promise.all` work as the touched tile set grows.
- Durability relies partly on lifecycle cleanup even though asynchronous work is not guaranteed to finish during unload.
- A delayed or superseded write can target stale board/background context without explicit generation/version checks.

## Implementation elements

1. Specify the fog operation model before implementation: reveal/hide ordering, commutativity, tile version, author/session ID, board/background generation, and conflict semantics.
2. Replace client read/merge/set with a concurrency-safe protocol: Firestore transaction for bounded contention, atomic/versioned operation documents with server compaction, or another proven equivalent.
3. Keep brush response local. Append pending operations to a bounded durable client queue with operation IDs, retry metadata, and board/background identity.
4. Flush through a concurrency-limited scheduler with per-tile ordering, batch-size ceilings, exponential backoff/jitter, retry classification, and cancellation/supersession rules.
5. Acknowledge operations only after authoritative commit. Reconcile snapshots with the pending queue without double-applying or flashing stale data.
6. Use visibility/pagehide checkpoints only as an early flush signal, never the sole durability mechanism. Recover the queue on reload/reconnect.
7. Reject or quarantine work whose board/background generation no longer matches. Expose pending, retrying, failed, and conflicted states to diagnostics and appropriate UI.
8. Add server-side idempotency and compaction/retention for operation records. Make retries safe across callable/timeouts and client restarts.
9. Establish write-rate, pending-queue, retry, conflict, commit-latency, compaction-lag, and failure telemetry with alert thresholds.
10. Provide a migration and rollback plan that can read old tile state while new operations are introduced, verified, compacted, and eventually made authoritative.

## Boundaries and non-goals

- No acknowledged reveal/hide edit may be lost, duplicated, applied to the wrong background, or reordered contrary to the specified semantics.
- Preserve offline interaction and immediate local feedback; network latency must not gate brush rendering.
- Do not assume client clocks, unmount handlers, or browser unload requests are reliable.
- Keep operation payloads and transaction contention within Firestore limits; do not move unbounded masks into a single document.

## Tests

- Emulator test with two to five clients concurrently revealing/hiding overlapping pixels and tiles; compare final state with the reference operation model.
- Inject out-of-order snapshots, duplicate acknowledgements, transaction conflicts, permission denial, quota errors, timeouts, and transient network failures.
- Offline brush, reload/crash before flush, reconnect, auth change, route change, and board/background switch recovery.
- Large stroke spanning many tiles: assert request concurrency/batch ceilings and no `Promise.all` burst.
- Idempotency tests across client retry, callable retry, compactor retry, and duplicate operation delivery.
- Migration compatibility, compaction, rollback, stale-generation rejection, and authorization-rule tests.
- Five-peer load/soak test for write rate, conflict rate, convergence time, queue size, memory, and server cost.

## Acceptance gates

- The concurrent-client suite has zero lost or cross-background updates and converges deterministically.
- Flush concurrency and batch/request sizes remain within documented hard ceilings for every tested stroke.
- Pending acknowledged/unacknowledged state survives reload and reconnect without duplicate visible application.
- No correctness path depends solely on component unmount or page unload.
- Standard-session fog writes, commit latency, failures, and compaction lag meet Task 01 budgets and operational thresholds.
