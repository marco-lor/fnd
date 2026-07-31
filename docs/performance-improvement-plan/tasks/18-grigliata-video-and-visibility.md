# Task 18 - Grigliata video and visibility

Depends on Task 17.

## Outcome

Drive video redraws only when a decoded frame is available and compute one reusable visibility scene per relevant revision instead of repeating expensive geometry in page, board, and lighting paths.

## Evidence

- The video loop in `GrigliataBoard.js:2954-2997` can request continuous animation frames and draw the full stage plus individual layers.
- Visibility filtering is duplicated between page, board, and lighting consumers.
- The current geometry can approach `sources x (rays + segments) x segments`; the ray set includes about 256 directions before additional endpoints.
- Wall/source preprocessing and visibility results are rebuilt on updates that do not always change visibility inputs.

## Implementation elements

1. Replace the free-running video redraw loop with `requestVideoFrameCallback` where available and a bounded fallback keyed to media progress. Draw only the background/video layer.
2. Stop callbacks when media is paused, ended, offscreen, route-hidden, document-hidden, replaced, errored, or unmounted. Restart from the current frame without duplicate callback chains.
3. Define one canonical immutable visibility-scene input: wall revision, source revisions, board bounds, role/ownership rules, and relevant settings.
4. Build walls, endpoints, source ownership, and spatial indexes once per matching revision. Precompute invariant ray directions and reuse typed/compact structures where measurement supports it.
5. Cache per-source visibility polygons by source/wall/bounds revision. Recompute only sources affected by a changed source or nearby wall; compose outputs for board, lighting, and token filtering.
6. Remove consumer-local visibility filters and establish a single semantic API for visible, hidden, dimmed, and game-master override states.
7. Use a spatial acceleration structure to query candidate wall segments per ray/source rather than scanning all segments. Document degeneracy, endpoint epsilon, and boundary behavior.
8. Evaluate a worker only after the canonical algorithm and invalidation rules are correct. If used, version messages and discard stale results without one-frame information leaks.
9. Add counters for video callbacks/draws, visibility scene builds, per-source recomputations, candidate-segment tests, cache hits, and calculation duration.

## Boundaries and non-goals

- Visibility is a gameplay and privacy rule: no optimization may briefly reveal hidden tokens, walls, or light state.
- Preserve existing polygon semantics, source ownership, darkness/light precedence, game-master overrides, and video controls.
- A worker is optional and must not become a prerequisite for correctness or supported-browser fallback.
- This task does not change persisted fog masks or brush-save semantics.

## Tests

- Golden geometry suite covering convex/concave walls, shared endpoints, collinear/zero-length segments, bounds, darkness, overlapping sources, and ownership roles.
- Pixel/scene regression comparing canonical results with approved existing fixtures before deleting duplicate implementations.
- Change one wall/source/unrelated UI control and assert the exact visibility caches invalidated.
- Standard worst-case geometry benchmark recording calculation time, segment tests, cache hit rate, allocations, and main-thread long tasks.
- Video tests for play, pause, seek, loop, source replacement, fallback browser, offscreen, hidden tab, error, and unmount.
- Security regression that rapidly changes sources/walls and asserts stale async results never render restricted content.

## Acceptance gates

- Video produces no continuous callback/draw loop while paused, hidden, offscreen, ended, or unmounted.
- Each decoded video frame redraws only its designated layer and does not force full-stage drawing.
- There is one authoritative visibility implementation consumed by all board/page/lighting paths.
- An unrelated update performs zero visibility recomputations; a single-source update recomputes only the documented affected set.
- Worst-case visibility calculation and frame behavior meet the Task 01 budget with golden geometry and privacy tests passing.
