# Task 12 - Codex data-model migration

Depends on Tasks 04 and 06.

## Outcome

Replace the monolithic `utils/codex` document with versioned, paged category/item data while preserving every consumer and a rollback path.

## Evidence

- `Codex.js:71-111` subscribes to one document containing every category/item.
- All add/edit/delete actions contend on nested fields in the same document.
- Opening one category downloads and materializes all categories.
- Race Selection and DM language/knowledge/profession editors consume the legacy structure.

## Implementation elements

1. Define category metadata documents and item documents/subcollections with stable IDs, ordering, search fields, visibility/ownership, and version.
2. Add a versioned Codex repository adapter used by the page and all secondary consumers.
3. Create idempotent dry-run/backfill/verify tooling with category/item counts, content hashes, invalid-key reporting, checkpoints, and rollback markers.
4. Roll out legacy read -> dual read comparison -> dual write -> new read -> legacy retirement. Define the authoritative writer at each phase.
5. Subscribe to compact category metadata and only the active category's bounded item page.
6. Centralize one edit and one delete modal rather than one state machine per visible item.
7. Update RaceSelection and all DM knowledge/language/profession consumers before new-only mode.
8. Reduce Codex background work: reduced motion, hidden-tab pause, explicit background interaction only, and compositor-friendly layers.

## Boundaries and non-goals

- Preserve category/item text, identity, ordering, editor permissions, and all consumer option lists.
- Do not delete `utils/codex` until comparison metrics are clean and rollback window closes.
- Do not use client-only dual writes without conflict/error ownership.

## Tests

- Migration rerun/resume/partial/corrupt data and old/new equality across all consumers.
- Active category paging, edit/delete/add contention, stable order, and rules/index tests.
- Rollback from every rollout phase.
- Large fixture with 20 categories/5,000 items: initial reads/bytes are bounded by metadata plus active page.
- Reduced-motion, hidden-tab, and UI-click background behavior.

## Acceptance gates

- Editing one item does not redownload or rewrite unrelated categories.
- Codex document-size growth is no longer a single-document failure mode.
- All secondary consumers show identical options during comparison mode.
- Legacy retirement occurs only after verification and rollback sign-off.
