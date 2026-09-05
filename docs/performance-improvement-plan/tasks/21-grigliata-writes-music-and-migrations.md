# Task 21 - Grigliata writes, music, and migrations

Depends on Tasks 04, 05, 06 and 07. Placement, lighting ownership, music and migration retirement are separate units; none waits for all of Tasks 16-20.

## Outcome

Finish Grigliata optimization by narrowing routine writes, making multi-document actions atomic and conflict-aware, using one music runtime, and removing migrations from route mount.

## Evidence

- Placement movement can also write user settings (`useGrigliataPlacementActions.js`), amplifying a high-frequency gameplay path.
- Lighting operations in `GrigliataPage.js` can perform sequential full-array writes and expose partial intermediate state.
- Global and Grigliata music paths can each own subscriptions/audio work, duplicating listeners and playback resources.
- Route startup performs migration/repair work (`GrigliataPage.js`), adding reads/writes and contention to normal navigation.
- Large page/control modules obscure ownership and make unrelated state changes more likely to propagate.

## Implementation elements

1. Catalog every Grigliata write by gesture/action, documents, payload bytes, frequency, transactionality, derived trigger fan-out, and retry behavior.
2. Make placement movement a narrow coordinate/revision patch. Separate per-user preferences from shared placement data so a move writes no unrelated settings or full aggregates.
3. Debounce/coalesce only transient movement that is semantically replaceable; preserve final position, ownership validation, optimistic rollback, and peer convergence.
4. Give lighting/source updates canonical per-entity documents or bounded chunks with revisions. Commit multi-entity actions atomically through batch/transaction/server orchestration.
5. Detect concurrent lighting edits and stale revisions rather than last-writer-wins replacement of an entire array. Keep client retries idempotent.
6. Audit existing Task 07 media/music lifecycle infrastructure first and extend it rather than introducing a second service. Consolidate remaining global and Grigliata playback into one lifecycle-owned music service/store with one active session subscription, one media element/graph, stable selectors, and explicit priority rules.
7. Bound track metadata/artwork preloads and clean up listeners, object URLs, media sources, timers, and audio nodes on sign-out/route/session change.
8. Move schema repair/migration out of Grigliata route mount into explicit, versioned, resumable, idempotent administrative jobs with progress and dry-run support.
9. Remove route-time repair branches only after migration verification proves all supported versions readable and rollback remains available.
10. Only when profiling justifies it, split large page/control modules along the measured data/render boundaries created in Tasks 16-20. Preserve public behavior; module count is not itself an acceptance metric.

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
- Each unit meets its affected metric budgets without regressing retained journeys. Complete integrated Grigliata budget acceptance belongs to Task 22.

## Release units and measurement contract

21A: narrow placement writes. 21B: lighting ownership/atomicity contract, decided before 18B visibility integration. 21C: music lifecycle using Task 07 infrastructure. 21D: explicit migration retirement. These are independent except their own consumed contracts; optional modularization follows measured need.

200 placements / 20 light sources and named music route-switch trace; count final coordinate writes, unrelated settings writes (target zero), atomic light-state observations, live audio graphs/listeners and route-mount migration writes (target zero). Recheck residual source paths against delivered foundations before changing them.

Follow the [roadmap release/evidence rules](../README.md#rules-for-every-task) for each unit. Source observations identify work to verify, not fresh timing or deployed status. Record current measured values and numeric targets separately before implementation; use existing budget keys where available.
