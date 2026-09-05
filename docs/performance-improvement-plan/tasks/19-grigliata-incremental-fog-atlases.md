# Task 19 - Grigliata incremental fog atlases

Depends on Tasks 04 and 07. Agree tile identity/version/render contracts with Task 20; Task 18 is required only if consuming its changed visibility outputs.

## Outcome

Make fog rendering work proportional to changed tiles and atlas groups, avoiding full decode, sort, rasterization, and atlas reconstruction for a small brush change.

## Evidence

- A 128 x 128 fog tile can require 16,384 sample tests during rasterization.
- Current snapshot/update paths can decode and sort the full tile set and rebuild complete atlases when only one tile changed.
- The same logical tile data can be rasterized repeatedly for different owners/consumers.
- High-frequency brush movement can generate redundant samples and invalidate more state than the touched tile region.

## Implementation elements

1. Instrument tile decodes, bytes decoded, rasterizations, pixel/sample tests, atlas builds, dirty rectangles, allocations, and duration by update cause.
2. Maintain an ID/coordinate-keyed decoded tile store updated from `docChanges()`. Preserve identity and cached bitmap/raster output for unchanged tiles.
3. First measure the gain from incremental invalidation alone. Change atlas layout only if residual cost justifies it; assign tiles to stable, bounded atlas groups when needed. Mark only changed groups dirty and update their dirty rectangles or replace those group canvases; do not rebuild every group.
4. Rasterize shared logical tile content once per content/version key and fan out references to applicable owner/view compositions where authorization allows.
5. Replace repeated polygon/sample membership work with a profiled scanline, mask, bitmap, or equivalent representation. Keep exact edge and opacity semantics under golden tests.
6. Coalesce brush samples to animation frames and minimum board-space distance. Derive the complete touched-tile set for each segment so fast movement cannot leave gaps.
7. Cache normalized polygon/mask results by content version. Define strict eviction for decoded tiles, raster outputs, atlases, and failed/aborted work.
8. Prioritize visible/nearby dirty groups and bound concurrent raster jobs. Cancel or ignore superseded work through generation IDs.
9. Evaluate OffscreenCanvas/worker rasterization only after incremental invalidation works. Keep a deterministic main-thread fallback and cap transfer/copy overhead.
10. Publish a fog-render revision only after a coherent affected group is ready, preventing partial-frame flashing or temporary hidden-area disclosure.

## Boundaries and non-goals

- Preserve fog pixel semantics, brush continuity, role/owner isolation, reveal/hide behavior, board transforms, and supported-browser fallback.
- Do not alter persistence/concurrency semantics in this task; Task 20 owns durable writes.
- Never share a decoded/raster artifact across authorization scopes if its content reveals restricted fog state.
- Atlas size must respect browser canvas/GPU limits and memory budgets on target devices.

## Tests

- Golden tile raster tests for polygon edges, holes, empty/full tiles, boundary crossings, transforms, opacity, and owner isolation.
- Apply one changed tile in a 512-1,024-tile fixture: assert one decode/raster and only its atlas group/dirty region updates.
- Fast diagonal and curved brush traces at low/high zoom: assert no gaps and bounded sample count.
- Repeated update/delete/restore and rapid supersession tests for correct generation cancellation.
- Browser performance/heap trace during a sustained brush session and a five-peer update burst.
- Hidden-tab/unmount cancellation and cache-eviction tests; worker/main-thread equivalence only if a worker is introduced.

## Acceptance gates

- A one-tile snapshot change performs no full-collection decode/sort or all-atlas rebuild.
- Decode, raster, and atlas counters grow with changed tiles/groups, not total stored tiles.
- Sustained brushing meets Task 01 frame-time and memory budgets with no visible gaps or stale fog frames.
- Cache memory plateaus under the standard fixture and returns within the agreed margin after route unmount.
- Golden rendering and authorization-isolation tests pass on the selected main-thread path and on the worker path if introduced.

## Release units and measurement contract

19A: profile/update invalidation on existing representation. 19B: atlas/layout change only if 19A leaves a measured bottleneck. Worker is an optional later experiment.

512 and 1,024 tiles, one-tile change and sustained brush traces; count decodes, rasters, group rebuilds and peak/settled heap. One tile affects only its decode/raster and documented affected atlas groups; verify all edges, zooms and owner isolation.

Follow the [roadmap release/evidence rules](../README.md#rules-for-every-task) for each unit. Source observations identify work to verify, not fresh timing or deployed status. Record current measured values and numeric targets separately before implementation; use existing budget keys where available.
