# Task 09 - Bazaar catalog data path

Depends on Tasks 04, 05, and 07.

## Outcome

Replace the full-catalog realtime payload and hover-triggered reads with bounded summary pages, on-demand details, while preserving the existing server-authoritative purchase contract.

## Source review (2026-09-05; not runtime measurements)

- `Bazaar.js` subscribes to all visible full item documents.
- `ComparisonPanel` is keyed by hovered item (`Bazaar.js`), so hover remounts the detail component.
- `comparisonComponent.js` already uses `useProgression` and cached `getSchema`; measure remaining remount, derivation and detail work without reintroducing private listeners.
- Custom visibility resolution already uses `getUserDirectoryPage` in `comparisonComponent.js`; verify cache reuse and completeness when allowed users span directory pages.
- Facet/filter/sort work repeats across the entire collection; comparator debug logging occurs in `Bazaar.js`.

`frontend/functions/src/userDataCommands.ts` already implements `task05PurchaseItem` through `runIdempotent`, authoritative transactional catalog access/price/gold checks and constant inventory writes. Preserve this foundation. Source references describe residual structure, not fresh runtime measurements.

## Implementation elements

1. Define a catalog summary document/projection containing card, filter, search, price, visibility, thumbnail, version, and ordering fields only.
2. Query summaries with deterministic server ordering, visibility-safe constraints, page size, and cursors. Decide which first page remains realtime; historical pages may be fetched/cached.
3. Fetch full detail only for click/lock/final hover after a short debounce. Keep one panel mounted and reset item-dependent state explicitly.
4. Preserve the existing minimal directory/config repositories; verify custom-name resolution across pages, missing/deleted users, authorization and cache invalidation.
5. Precompute normalized search/facet/sort fields; memoize filter options/results and cards; defer search and debounce persistence.
6. Move `FilterDropdown` out of `FiltersSection` render scope and use a stable outside-click subscription.
7. Add pagination or accessible virtualization so DOM/media work is bounded.
8. Purchase through the Task 05 authoritative API: server reads catalog item/version/price/visibility and writes O(1) inventory state.

## Boundaries and non-goals

- Preserve all visibility modes, allowed-user semantics, locked/hover detail UX, filter persistence, DM capabilities, and acquired-item history.
- Do not expose privileged directory fields to resolve names.
- Do not silently change results because filters span pages; specify server/query or indexed-search behavior first.

## Tests

- Emulator visibility rules and compound indexes for player, allowed user, DM, and anonymous denial.
- Cursor order/deduplication, live first-page changes, filter/search parity, missing legacy ordering fields, and load-more behavior.
- With cold detail cache, move across 20 cards faster than the declared debounce interval, then dwell on the final card: zero additional profile registrations and at most one final detail fetch. Repeat warm with zero fetches; deliberate dwell on distinct uncached cards may fetch each detail.
- Preserve authoritative item/visibility/gold checks and retry idempotency. Specify stale displayed-price behavior before implementation: explicit reconfirmation on changed price or a clearly disclosed authoritative-price contract. Test that contract, concurrent buys, insufficient gold and duplicate retries; do not assume version rejection already exists.
- 1,000-item fixture tracks initial reads, transferred bytes, commit count/duration, and offscreen media requests.

## Acceptance gates

- Initial work is bounded by page size, not total catalog size.
- Card payload excludes embedded spells/full parameter detail.
- Hovering rerenders only previous/current card state and detail, not the entire list derivation.
- Purchase touches O(1) inventory documents and never trusts client price/item data.

## Release units and measurement contract

09A: measure catalog/filter semantics and purchase price contract. 09B: summary projection/query migration after 09A. 09C: panel/render isolation after 09A; integrate 09B only when using summaries.

1,000 items / 500 inventory entries; record cold/warm initial documents and bytes at a declared page size, a 20-card hover trace, filter result equality and duplicate purchase document counts. Initial summary work must be page-bounded; retain O(1) inventory writes.

Follow the [roadmap release/evidence rules](../README.md#rules-for-every-task) for each unit. Source observations identify work to verify, not fresh timing or deployed status. Record current measured values and numeric targets separately before implementation; use existing budget keys where available.
