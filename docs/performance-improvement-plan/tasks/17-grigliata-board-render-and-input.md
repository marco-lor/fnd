# Task 17 - Grigliata board render and input

Depends on Task 16.

## Outcome

Contain React/Konva updates to the affected board subsystem, coalesce high-frequency input to frames, and keep interaction smooth on the standard large-board fixture.

## Evidence

- `GrigliataBoard` is a very large non-memoized component with static scene, grid, tokens, fog, lighting, selection, and transient overlays sharing update paths (`GrigliataBoard.js:6735-7078`).
- `GrigliataPage.js:6368-6411` constructs large control objects and inline callbacks that can invalidate board props.
- Raw pointer/mouse movement flows through stateful handlers (`GrigliataBoard.js:4848-5211`).
- Ping animation schedules React state on every animation frame (`GrigliataBoard.js:3626-3656`).
- Token nodes and several static/derived layers are not isolated by stable props; unrelated clocks in `useGrigliataPageData.js:639-659` can propagate work.

## Implementation elements

1. Add React render counters, Konva layer-draw counters, input-event rate, frame time, long-task, and heap sampling for the named Grigliata fixture before restructuring.
2. Stabilize page-to-board callbacks and control models. Split controls by domain and revision so a change in one subsystem cannot invalidate unrelated subsystems.
3. Decompose the board into measured scene, background/grid, placement/token, fog, lighting/visibility, selection, and transient overlay boundaries.
4. Apply memoization only after props/selectors have stable identity. Use entity-level selectors so one placement update affects the corresponding node and required overlays, not every token.
5. Keep ephemeral drag, marquee, cursor, ping, hover, and preview state in the narrowest owner. Use refs or Konva-native animation where React output is unnecessary.
6. Coalesce pointer movement to at most one computation/state publication per animation frame. Cache stage bounds and transformations until resize/zoom/pan invalidates them.
7. Isolate pings and other animations in a dedicated layer and stop their frame loops immediately when complete, hidden, or unmounted.
8. Reduce grid and static-scene node/draw work through cached layers, patterns, or equivalent measured techniques while preserving coordinate precision and zoom appearance.
9. Reuse spatial indexes from the visibility work where hit-testing and snapping need nearby candidates; do not scan every entity on every move.
10. Establish explicit z-order and pointer-event contracts before splitting layers so optimization cannot silently change interaction priority.

## Boundaries and non-goals

- Preserve zoom, pan, drag, selection, snapping, placement, context menus, keyboard controls, touch behavior, and exact layer order.
- Do not blanket-apply `React.memo`, cache mutable Konva nodes in application data, or trade correctness for lower render counts.
- This task does not redesign visibility geometry or fog persistence; it prepares clean invalidation boundaries for Tasks 18-20.
- Keep accessibility and non-pointer alternatives for actions exposed outside the canvas.

## Tests

- Existing board/unit tests plus interaction integration tests for mouse, touch, keyboard, zoom, pan, selection, drag, snapping, and overlapping targets.
- Render-counter assertions: update one token, clock, ping, control, fog revision, and light source independently and record affected components/layers.
- Browser trace on the standard 200-placement board during drag, pan, marquee, zoom, ping, and multi-peer updates.
- Flood pointer input faster than refresh rate; verify computations/publications are frame-coalesced and the final coordinate is not lost.
- Visual regression at representative zoom levels, device-pixel ratios, grid modes, and layer combinations.
- Mount/unmount/hidden-tab tests proving no animation frame, timer, or pointer listener leaks.

## Acceptance gates

- The standard interaction trace meets Task 01 frame-time, long-task, and dropped-frame budgets on the reference machine.
- A single-token update redraws only the documented entity/layers and does not rerender all tokens or static layers.
- Pointer-rate input produces no more than one expensive publication per animation frame.
- Completed/hidden animations consume no ongoing frames, and repeated route mounts leave no listeners or animation handles.
- Visual and interaction parity tests pass before visibility/fog work begins.
