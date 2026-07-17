# Task 09 - Bazaar catalog data path

Depends on Tasks 04, 05, and 07.

## Outcome

Replace the full-catalog realtime payload and hover-triggered reads with bounded summary pages, on-demand details, and server-authoritative purchase validation.

## Evidence

- `Bazaar.js:257-319` subscribes to all visible full item documents.
- `ComparisonPanel` is keyed by hovered item (`Bazaar.js:775-780`), so hover remounts a 1,003-line component.
- Each remount can start a user listener/read and schema read (`comparisonComponent.js:412-478`).
- Custom visibility names are loaded through serial user reads (`:672-702`).
- Facet/filter/sort work repeats across the entire collection; comparator debug logging occurs in `Bazaar.js:515-580`.

## Implementation elements

1. Define a catalog summary document/projection containing card, filter, search, price, visibility, thumbnail, version, and ordering fields only.
2. Query summaries with deterministic server ordering, visibility-safe constraints, page size, and cursors. Decide which first page remains realtime; historical pages may be fetched/cached.
3. Fetch full detail only for click/lock/final hover after a short debounce. Keep one panel mounted and reset item-dependent state explicitly.
4. Replace user reads with the security-reviewed minimal directory from Task 04 and cache schema/config through the shared repository.
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
- Hover across 20 cards causes zero profile listener/read registrations and at most one final detail fetch.
- Price/item/version/visibility tampering is rejected server-side.
- 1,000-item fixture tracks initial reads, transferred bytes, commit count/duration, and offscreen media requests.

## Acceptance gates

- Initial work is bounded by page size, not total catalog size.
- Card payload excludes embedded spells/full parameter detail.
- Hovering rerenders only previous/current card state and detail, not the entire list derivation.
- Purchase touches O(1) inventory documents and never trusts client price/item data.
