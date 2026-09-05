# Task 15 - Echi di Viaggio

Depends on Tasks 04 and 07.

## Outcome

Reduce map transfer by at least 70%, use one NPC data source, and keep marker/NPC rendering bounded and isolated from hover state.

## Evidence

- `mappa_art.png` is 7,994,651 bytes and `mappa_precisa.png` is 6,894,688 bytes; both are imported in `EchiDiViaggio.js`.
- Page and `NpcSidebar` independently subscribe to all `echi_npcs` (`EchiDiViaggio.js`, `NpcSidebar.js`).
- Public/private marker collections are unbounded (`MapEditor.js`).
- Sidebar hover is lifted to the page and rebuilds marker trees; each marker carries state/effects and a hidden hover-card subtree.
- NPC sidebar renders the complete list and original portraits (`NpcSidebar.js`).

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

## Release units and measurement contract

15A: map formats/delivery with visual approval. 15B: one NPC subscription shared by page/sidebar. 15C: marker query/render redesign only after complete-marker semantics are specified. A/B are independent early candidates.

500 NPCs / 2,000 markers; exact PNG sizes remain 7,994,651 and 6,894,688 bytes in this checkout. Target <=30% combined modern transfer at declared viewport/zoom with readable labels, complete maps and <=1 CSS pixel marker displacement. Do not trade readability for the byte target; record approved exception if necessary.

Follow the [roadmap release/evidence rules](../README.md#rules-for-every-task) for each unit. Source observations identify work to verify, not fresh timing or deployed status. Record current measured values and numeric targets separately before implementation; use existing budget keys where available.
