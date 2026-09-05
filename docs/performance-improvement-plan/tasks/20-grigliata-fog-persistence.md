# Task 20 - Grigliata fog persistence

Depends on Tasks 04 and 05. Assess concurrency/durability early; neither Tasks 16-19 nor a new renderer is a prerequisite.

## Outcome

Persist fog edits without lost updates, unbounded request bursts, or dependence on best-effort unmount writes, while keeping brush latency local and recoverable.

## Source risk evidence (not a reproduced live data-loss incident)

- `useGrigliataFogOfWarPersistence.js` uses a non-transactional read/merge/write pattern that can lose concurrent edits.
- Flush paths can launch unbounded `Promise.all` work as the touched tile set grows.
- Durability relies partly on lifecycle cleanup even though asynchronous work is not guaranteed to finish during unload.
- A delayed or superseded write can target stale board/background context without explicit generation/version checks.

## Implementation elements

1. Specify the fog operation model before implementation: reveal/hide ordering, commutativity, tile version, author/session ID, board/background generation, and conflict semantics.
2. Replace client read/merge/set with a concurrency-safe protocol: Firestore transaction for bounded contention, atomic/versioned operation documents with server compaction, or another proven equivalent.
3. Keep brush response local. Determine the actual offline/reload promise. If pending edits must survive reload, persist a bounded local queue with identity and retry metadata before reporting locally saved state. Distinguish authoritative acknowledgement, durable local enqueue and crash-before-enqueue; no guarantee can recover an edit that was never persisted.
4. Flush through a concurrency-limited scheduler with per-tile ordering, batch-size ceilings, exponential backoff/jitter, retry classification, and cancellation/supersession rules.
5. Acknowledge operations only after authoritative commit. Reconcile snapshots with the pending queue without double-applying or flashing stale data.
6. Use visibility/pagehide checkpoints only as an early flush signal, never the sole durability mechanism. Recover durably enqueued work on reload/reconnect if that contract is selected; otherwise state the unsaved pending-work boundary clearly.
7. Reject or quarantine work whose board/background generation no longer matches. Expose pending, retrying, failed, and conflicted states to diagnostics and appropriate UI.
8. Make retries safe under the selected protocol. Add operation records, server compaction and retention only if needed; transactions with bounded contention may be sufficient.
9. Establish write-rate, pending-queue, retry, conflict, commit-latency, failure telemetry, and compaction lag only when a compactor is selected with alert thresholds.
10. Define compatibility and rollback for the selected protocol. Migrate formats only if needed; operation introduction and compaction verification apply only to an operation-log design.

## Boundaries and non-goals

- No acknowledged reveal/hide edit may be lost, duplicated, applied to the wrong background, or reordered contrary to the specified semantics.
- Preserve verified current offline behavior and immediate feedback; document any additional durability promise explicitly. Do not require a new offline architecture without evidence.
- Do not assume client clocks, unmount handlers, or browser unload requests are reliable.
- Keep operation payloads and transaction contention within Firestore limits; do not move unbounded masks into a single document.

## Tests

- Emulator test with two to five clients concurrently revealing/hiding overlapping pixels and tiles; compare final state with the reference operation model.
- Inject out-of-order snapshots, duplicate acknowledgements, transaction conflicts, permission denial, quota errors, timeouts, and transient network failures.
- Offline brush, reload/crash before flush, reconnect, auth change, route change, and board/background switch recovery.
- Large stroke spanning many tiles: assert request concurrency/batch ceilings and no `Promise.all` burst.
- Idempotency tests across client retries and duplicate delivery; include callable/compactor retries only when those components are used.
- Compatibility, rollback, stale-generation rejection and authorization-rule tests; migration/compaction tests only for selected components.
- Five-peer load/soak test for write rate, conflict rate, convergence time, queue size, memory, and server cost.

## Acceptance gates

- The concurrent-client suite has zero lost or cross-background updates and converges deterministically.
- Flush concurrency and batch/request sizes remain within documented hard ceilings for every tested stroke.
- Authoritatively acknowledged work is retained. Durably enqueued pending work survives reload under the documented recovery contract; crash-before-enqueue is an explicit limit.
- No correctness path depends solely on component unmount or page unload.
- Standard-session fog writes, commit latency, failures, and compaction lag where applicable meet Task 01 budgets and operational thresholds.

## Release units and measurement contract

20A: verify rules/ownership, current reveal/hide semantics and concurrent/reload behavior early. 20B: smallest safe bounded persistence protocol after 20A. 20C: additional durable local recovery only if the chosen user contract requires it.

Two same-account tabs where rules allow, then two-to-five authorized peers; overlapping reveal/reveal and reveal/hide, retries and background switches. Compare to the specified reference ordering, with zero lost acknowledged updates. Declare numeric request concurrency, queue capacity and retry ceilings; operation log/compactor is optional.

Follow the [roadmap release/evidence rules](../README.md#rules-for-every-task) for each unit. Source observations identify work to verify, not fresh timing or deployed status. Record current measured values and numeric targets separately before implementation; use existing budget keys where available.
