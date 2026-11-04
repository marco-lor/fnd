# Task 15B: shared Echi NPC source

## Intent and authorization

Implement release unit 15B from `docs/performance-improvement-plan/tasks/15-echi-di-viaggio.md`. The latest user instruction limits this work to code for `fatin-test`, local tests, a guarded staging build, and a reviewed `devs` to `main` PR that remains unmerged. Do not deploy or change production. Browser control/acceptance is skipped in this scope. The user requested Astra xhigh prerequisite verification, Sol 6.1 xhigh developer and reviewer, at most four attempts in each review loop, and fixes limited to worthwhile real issues.

## Current source and targets

Baseline: `9f770f3d6551b38f5adbfb31765f11abf8dd65fe`, initially identical on remote `main` and `devs`. The page subscribes to the full `echi_npcs` collection; the sidebar separately orders it by `createdAt DESC`. The page normalizes presentation fields; the editor needs the original values. Existing Echi page/sidebar/map-editor/map-picture tests pass: 4 suites, 46 tests. These are source observations and local test results, not live acceptance.

Numeric 15B gates: one active physical NPC listener per mounted authenticated route (currently two source paths); zero after route cleanup; no extra subscription for rerenders with the same UID/access generation; unchanged NPC records retain identity across incremental updates. Measure the listener boundary on a repeatable 500-NPC/2,000-marker fixture before and after. This unit makes no map-transfer, FPS, memory, or live billed-read claim.

## Approach

Use the existing repository runtime for one full-collection subscription, structural updates and route ownership. A route-owned hook supplies both the ordered sidebar records and ID lookup. Pass the list/loading/error state into `NpcSidebar`, which retains its mutation and interaction handlers.

Reusing the sidebar's ordered Firestore query would remove records without `createdAt` from the map lookup. Keeping two subscriptions would miss 15B's objective. Read the full collection once and derive the existing sidebar semantics locally: records with a `createdAt` field in Firestore descending value order, document ID descending for ties; missing timestamps remain available to map lookup. The existing fixture uses ISO strings while UI writes use Firestore timestamps: preserve their mixed-type ordering and timestamp nanoseconds rather than parsing all values as dates. Null/pending server timestamps remain supported. Keep raw NPC fields and authoritative document IDs; apply display fallbacks at the existing presentation boundary. Sort a copy of the structural result, whose native collection order is required by incremental snapshot indices; preserve the derived result on no-op snapshots.

Use `useAuthSession().repositoryAccessGeneration` alongside UID. Reset visible state on account/access change and logout; ignore stale callbacks; clear both consumers on terminal subscription error. Keep the sidebar's mutation error state separate from the supplied read error so local button actions cannot erase a read failure. Use the existing shared runtime rather than a second cache or generic store.

## Boundaries

Preserve marker data/coordinates, all public/private authorization, sidebar ordering, NPC forms and writes, canonical/legacy media, thumbnails and zoom, hover/fade/popup accessibility, drag/drop and linked-marker deletion behavior. No marker query limits, virtualization, map delivery changes, deletion redesign, migrations, security-rule changes or backend deployment belong to 15B. Update the query-contract registry to point at the actual shared listener without promising truncating pagination.

## Verification and release

Tests cover the real page/sidebar integration, consistent live add/edit/delete data, raw editor values, map-only records missing `createdAt`, ordering/ties/pending timestamps, structural sharing, loading/error, StrictMode/repeated renders, unmount/remount, UID changes and same-UID access changes. Run focused Echi/repository tests, relevant source-boundary checks, full frontend tests and a guarded staging build.

Run only local/emulator validation and the guarded staging build in this scope. A mocked-boundary fixture measures listener cardinality and client document deliveries; it does not measure live billed reads, network bytes, FPS or memory. Emulator query comparisons establish ordering compatibility for the supported values. Browser workflows remain unverified by user choice.

The controller owns pushing reviewed `devs`, opening the `devs` to `main` PR, independent review and monitoring. Leave it unmerged. Do not deploy to staging or production, promote branches or edit live data. A future release requires separate authorization and its environment-specific validation.

Rollback of the reader is a source revert; no data migration is needed.
