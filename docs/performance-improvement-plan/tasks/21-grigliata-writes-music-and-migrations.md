# Task 21 - Grigliata writes, music, and migrations

Depends on Tasks 16-20.

## Outcome

Finish Grigliata optimization by narrowing routine writes, making multi-document actions atomic and conflict-aware, using one music runtime, and removing migrations from route mount.

## Evidence

- Placement movement can also write user settings (`useGrigliataPlacementActions.js:269-320`), amplifying a high-frequency gameplay path.
- Lighting operations in `GrigliataPage.js:5286-5628` can perform sequential full-array writes and expose partial intermediate state.
- Global and Grigliata music paths can each own subscriptions/audio work, duplicating listeners and playback resources.
- Route startup performs migration/repair work (`GrigliataPage.js:1784-1977`), adding reads/writes and contention to normal navigation.
- Large page/control modules obscure ownership and make unrelated state changes more likely to propagate.

## Implementation elements

1. Catalog every Grigliata write by gesture/action, documents, payload bytes, frequency, transactionality, derived trigger fan-out, and retry behavior.
2. Make placement movement a narrow coordinate/revision patch. Separate per-user preferences from shared placement data so a move writes no unrelated settings or full aggregates.
3. Debounce/coalesce only transient movement that is semantically replaceable; preserve final position, ownership validation, optimistic rollback, and peer convergence.
4. Give lighting/source updates canonical per-entity documents or bounded chunks with revisions. Commit multi-entity actions atomically through batch/transaction/server orchestration.
5. Detect concurrent lighting edits and stale revisions rather than last-writer-wins replacement of an entire array. Keep client retries idempotent.
6. Consolidate global and Grigliata playback into one lifecycle-owned music service/store with one active session subscription, one media element/graph, stable selectors, and explicit priority rules.
7. Bound track metadata/artwork preloads and clean up listeners, object URLs, media sources, timers, and audio nodes on sign-out/route/session change.
8. Move schema repair/migration out of Grigliata route mount into explicit, versioned, resumable, idempotent administrative jobs with progress and dry-run support.
9. Remove route-time repair branches only after migration verification proves all supported versions readable and rollback remains available.
10. Split large page/control modules along the measured data/render boundaries created in Tasks 16-20. Preserve public behavior; module count is not itself an acceptance metric.

## Boundaries and non-goals

- Preserve placement ownership, collision/snapping, optimistic UX, lighting precedence, collaborative convergence, and music controls/session behavior.
- Atomicity and conflict handling take precedence over reducing write count.
- Do not perform migrations implicitly on ordinary page navigation or silently rewrite legacy data from read paths.
- Module extraction must not introduce new global stores or duplicate subscriptions.

## Tests

- Instrumented gesture tests: move one placement N times and assert bounded coordinate writes, one authoritative final state, and zero user-settings writes.
- Multi-client placement and lighting conflict tests, permission denial, retry, stale revision, disconnect, and optimistic rollback.
- Assert each lighting action exposes only pre- or post-action state, never a partial source set.
- Music lifecycle matrix across global pages, Grigliata sessions, track change, pause/resume, sign-out, reconnect, and rapid navigation; assert one listener and one playback graph.
- Migration dry-run, partial failure/resume, duplicate execution, verification, rollback, and incompatible-version tests.
- Module-boundary regression suite plus listener/render/write counters proving extraction did not duplicate work.

## Acceptance gates

- Routine placement movement writes only placement coordinates/revision and stays within the Task 01 write-rate budget.
- Lighting actions are atomic, bounded, idempotent, and conflict-aware; sequential full-array replacement is absent from routine paths.
- A mounted application owns exactly one active music subscription/runtime under the documented priority contract.
- Grigliata route mount performs no schema migration or bulk repair writes.
- Standard-session Grigliata reads, writes, renders, draw calls, frames, and heap now meet the complete Task 01 budgets.
