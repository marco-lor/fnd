# Task 07 - Media and global shell runtime

Depends on Tasks 03 and 04. Complete before page-specific media work.

## Outcome

Provide one secure media derivative/lifecycle pipeline and reduce always-on visual/audio shell CPU, memory, and transfer cost.

## Evidence

- Original uploads are reused for small avatars, cards, tokens, NPC portraits, inventory rows, and gallery entries.
- `imageAssetRegistry.js:1-180` retains decoded images indefinitely and preloads with unbounded `Promise.all`.
- `GlobalAuroraBackground` renders 140 animated nodes and updates React state on every page click.
- Global music holds two listeners and one `preload="auto"` audio element per session on every authenticated page.
- Multiple preview paths leak object URLs; replacement uploads sometimes delete old media before new metadata is safely committed.

## Implementation elements

1. Define product media budgets by use: MIME allowlist, source bytes/dimensions/duration, thumbnail/card/board variants, poster frames, quality, and retention.
2. Generate versioned derivatives in an authoritative pipeline. Store original and derivative metadata; use thumbnails in lists and full quality only where required.
3. Add intrinsic dimensions, `loading`, `decoding`, responsive sources, fetch priority, and placeholder/error behavior through shared components.
4. Replace the unbounded image registry with refcount/LRU eviction, decoded-byte and request-concurrency budgets, failure backoff, and protection for active/crossfading assets.
5. Standardize object URL replacement/unmount cleanup, cancellable uploads, upload-first metadata commit, and retryable orphan deletion.
6. Replace/reduce global star DOM with a low-node implementation. Isolate it from form state, ignore ordinary control clicks, pause while hidden, respect reduced motion, and clean timeout handles.
7. Consolidate active music state to a compact bounded stream. Preload no audio bytes while idle/muted; cap active audio nodes while preserving cross-route playback.
8. Create avatar/item/NPC/foe/map thumbnail contracts and a backfill for legacy assets.

## Boundaries and non-goals

- Preserve private asset authorization and do not mark media publicly cacheable without a visibility threat model.
- Preserve full-quality board rendering and music continuity.
- Do not transcode unsupported formats silently; provide a tested fallback/error path.
- Do not evict an asset still referenced by the active board/crossfade.

## Tests

- Upload validation, derivative generation, orientation, fallback, cancellation, replacement failure, and orphan retry.
- Browser assertions that offscreen list media is not requested and dimensions prevent layout shift.
- Cache soak: cycle 50 maps and large token lists; heap/record count reaches a plateau and hot assets are not redownloaded.
- Reduced-motion, hidden-tab, interactive-click filtering, mobile density, and 10-minute timeout leak test.
- Idle/muted/active music transfer and listener/node budgets; seek/pause/loop/autoplay/disconnect continuity.

## Acceptance gates

- List and navigation UI use approved derivatives rather than originals.
- Decoded media memory and active requests remain within Task 01 budgets.
- No active music means zero audio-byte transfer.
- Global visual shell produces no continuous animation under reduced motion and pauses while hidden.
