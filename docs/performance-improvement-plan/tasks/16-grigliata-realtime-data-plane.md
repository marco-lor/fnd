# Task 16 - Grigliata realtime data plane

Depends on Tasks 04, 05, 06, and 07.

## Outcome

Make Grigliata listener, read, memory, and React-update cost proportional to the active role, tab, viewport, and bounded library window instead of every available dataset.

## Evidence

- Grigliata contains 27 production `onSnapshot` calls; `useGrigliataPageData.js:148-637` mounts most core feeds for the route lifetime.
- Player AoE state can fan out to roughly 20 listeners, while some panels add their own user/library listeners.
- Manager panels are hidden by tab state but are imported eagerly and their repositories are not consistently scoped to visible work.
- Presence, interaction, image, foe, background, track, and placement collections can grow without a complete retention or pagination contract.
- Several snapshots replace full arrays, invalidating otherwise unchanged derived data and component props.

## Implementation elements

1. Inventory every Grigliata listener by owner, role, tab, query, payload, update rate, retention, and cleanup behavior. Persist listener-cardinality telemetry from Task 04.
2. Separate the always-required gameplay plane from manager libraries and optional overlays. Mount optional repositories only while their tab/feature is active, with a documented short cache if remount cost warrants it.
3. Replace per-entity/per-player subscription fan-out with bounded aggregate or chunked queries. Define a hard listener budget for player and game-master sessions.
4. Add TTL/archive cleanup for ephemeral presence, cursors, pings, interactions, requests, and other session artifacts. Perform cleanup in trusted, retryable server work.
5. Create one projected user directory source for names/avatars/roles rather than reading full user documents or mounting panel-local directory listeners.
6. Use `snapshot.docChanges()` and stable ID-keyed maps so one changed document preserves identity for every unchanged entity. Produce ordered arrays only at selector boundaries.
7. Add explicit cursor/page contracts for backgrounds, foes, images, tracks, users, and other libraries. Queries must have matching indexes and stable deterministic ordering.
8. Deduplicate repositories that currently serve the same collection to page, board, galleries, and dialogs. Define one owner and selectors for each feed.
9. Distinguish transient local interaction state from durable Firestore state. Do not publish pointer-rate or animation-rate updates to Firestore.
10. Add listener/read dashboards and development assertions that identify duplicate query signatures and subscriptions left alive by inactive tabs.

## Boundaries and non-goals

- Preserve role-based authorization, live collaboration semantics, direct links, and convergence between peers.
- Do not truncate a collection until pagination/search/selection behavior exists for data outside the first page.
- This task changes data ownership and subscription scope, not Konva drawing, fog encoding, or visibility algorithms.
- Do not use a client cache as an authorization boundary or show restricted entities while stale.

## Tests

- Emulator integration matrix for player/game-master roles, active tabs, reconnect, auth change, permission failure, and route unmount.
- Assert listener counts and query signatures after each tab transition; inactive manager tabs must retain zero live listeners unless an explicit cache contract says otherwise.
- Change one placement among 200 and assert one normalized store update while unchanged entity identities remain stable.
- Five-peer fixture for create/update/delete convergence, reconnect, and out-of-order snapshots.
- Pagination tests for stable ordering, no duplicates/gaps, search, deleted cursors, and selection that crosses a page boundary.
- TTL/archive tests for expired ephemeral records and retry/idempotency behavior.
- Firestore rule/index tests for every new query and projected document.

## Acceptance gates

- Player and game-master sessions stay within the listener budgets established in Task 01 for every supported tab combination.
- An inactive manager tab performs no reads and owns no listener unless the exception is measured and documented.
- A one-document change does not replace all unchanged entity identities or rerender every consumer.
- All unbounded Grigliata library queries have a bounded cursor or explicitly measured finite-domain exception.
- Read volume over the standard five-peer scenario meets the Task 01 budget without lost realtime behavior.
