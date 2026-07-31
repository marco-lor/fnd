# Task 14 - Combat Tool scaling

Depends on Tasks 04 and 06.

## Outcome

Bound encounter/user history and replace per-participant source listeners with a scalable live-combat model.

## Evidence

- DM encounter list subscribes to the entire collection and filters/sorts client-side (`EncounterSidebarList.js:14-36`). Players merge two unbounded listeners (`:39-97`).
- Encounter Creator subscribes to all assignable full users (`EncounterCreator.js:24-42`).
- Details create participant/encounter listeners plus one user and one foe listener per distinct source (`EncounterDetails.js:53-188`), approximately `2 + U + F` before logs.
- Missing foe snapshots are repaired through serial writes and broad serialized dependencies (`:190-230`).
- Recursive delete downloads all participants/logs in the client (`:642-672`).

## Implementation elements

1. Add server-side status/order queries, deterministic cursor, bounded initial pages, and explicit archived/deleted retention.
2. Preserve both player membership paths while paginating/merging without duplicates; check in required indexes.
3. Replace full users selector with minimal directory/search and memoized selected-ID options.
4. Choose and document the live source strategy: chunked `documentId in` listeners within supported query limits, or denormalized combat summaries in participant documents.
5. Ensure listener count grows by chunks, stale IDs are removed, and detached participants hold no source listener.
6. Create foe snapshot atomically when adding the participant. Keep a bounded idempotent batch repair for legacy records.
7. Memoize initiative/turn-order projections and replace repeated `find/filter` passes with indexed lookups after data work lands.
8. Move recursive deletion to the Task 06 operation framework with progress/retry and audit.

## Boundaries and non-goals

- Preserve UID/character membership behavior, live versus detached snapshots, initiative/turn order, HP/mana actions, log ordering, permissions, and audit history.
- Do not limit display logs or encounters by silently discarding records; use paging/archive.
- Do not denormalize without naming the authoritative source and update mechanism.

## Tests

- 100 encounters and equal-timestamp pagination across both membership paths.
- 40-participant encounter listener budget, source update propagation, remove/replace cleanup, and detached transitions.
- Snapshot-at-add and legacy repair idempotency/cancellation.
- Recursive delete of >1,000 subdocuments, interruption/retry, unauthorized request, and progress UI.
- React commit/lookup benchmark for initiative and turn-order changes.

## Acceptance gates

- Initial list work is bounded by page size.
- Detail listener count grows by documented chunks, not by each participant.
- Removing participants leaves no stale source state or listener.
- Large deletion never performs unbounded client reads/writes.
