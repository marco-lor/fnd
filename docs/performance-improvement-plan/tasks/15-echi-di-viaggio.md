# Task 15 - Echi di Viaggio

Depends on Tasks 04 and 07.

## Outcome

Reduce map transfer by at least 70%, use one NPC data source, and keep marker/NPC rendering bounded and isolated from hover state.

## Evidence

- `mappa_art.png` is 7,994,651 bytes and `mappa_precisa.png` is 6,894,688 bytes; both are imported in `EchiDiViaggio.js:5-6`.
- Page and `NpcSidebar` independently subscribe to all `echi_npcs` (`EchiDiViaggio.js:310-342`, `NpcSidebar.js:561-591`).
- Public/private marker collections are unbounded (`MapEditor.js:68-84`).
- Sidebar hover is lifted to the page and rebuilds marker trees; each marker carries state/effects and a hidden hover-card subtree.
- NPC sidebar renders the complete list and original portraits (`NpcSidebar.js:1053-1084`).

## Implementation elements

1. Generate responsive AVIF/WebP map variants plus fallback. Preserve exact aspect ratio and marker percentage-coordinate behavior.
2. Lazy-load the lower map near viewport and assign correct priority to the initially visible map.
3. Lift one NPC repository subscription and derive ordered list and ID map with structural sharing.
4. Define marker map/scope partition, retention/archive, ordering, and cursor contract. Do not apply a truncating limit before visible-marker semantics are safe.
5. Pre-group markers by map/scope. Memoize map layers so sidebar opacity/hover does not rerender every marker.
6. Render one shared accessible hover portal instead of one hidden detail subtree per marker.
7. Use NPC/marker thumbnails and bounded/virtualized sidebar list while preserving drag, focus, and keyboard behavior.
8. Move/chunk NPC deletion and linked marker cleanup through the server operation framework; explicitly decide private-marker cleanup.

## Boundaries and non-goals

- Preserve marker pixel placement within an agreed tolerance across responsive sizes.
- Preserve public/private authorization, marker drag/drop, hover information, and map fallback.
- Do not hide old markers with an arbitrary query limit.

## Tests

- Visual regression at desktop/mobile widths and marker coordinate tolerance on every format/fallback.
- Network assertion: lower map is not requested before it approaches viewport.
- Exactly one NPC listener; page/sidebar update from the same snapshot and unsubscribe once.
- Marker hover changes only the shared portal/target marker, with render counters.
- 500-NPC/2,000-marker fixture for DOM, media requests, commits, and memory.
- Delete beyond 500 linked markers, retry, authorization, and private-marker policy.

## Acceptance gates

- Combined modern map transfer is <=30% of current PNG bytes on target viewports.
- NPC listener cardinality is one per mounted route.
- Hover/list scrolling remains responsive and original portraits are not fetched for thumbnails.
- Marker work is bounded by active map/page policy rather than total history.
