# Task 13 - Tecniche/Spell and Foes Hub

Depends on Tasks 04-07.

## Outcome

Remove duplicate player/config work from technique/spell cards and make foe browsing, media, rendering, and duplication bounded.

## Tecniche/Spell elements

- Remove the duplicate authenticated-user listener in `TecnicheSpell.js:64-117`; consume selector slices from the shared player store.
- Load dice/config once through the shared in-flight cache. Prevent one `utils/varie` read per simultaneously mounted SpellCard (`spell_side.js:32-58`).
- Precompute normalized searchable/sorted entries when sources change; defer search and stabilize callbacks.
- Add pagination/incremental rendering or accessible virtualization at the measured list threshold.
- Consolidate duplicated technique/spell card behavior where contracts match; keep distinct gameplay behavior explicit.
- Enforce Task 07 media limits/derivatives/preload policy.
- Spend mana through a transaction/callable with a non-negative guard instead of stale snapshot overwrite.

## Foes Hub elements

- Replace the full collection listener (`FoesHub.js:401-416`) with stable server order, bounded first page, cursor, and legacy timestamp backfill.
- Keep realtime behavior on the active page only unless product requirements prove a broader need.
- Use derivatives for row/detail spell/technique media and validate uploads before transfer.
- Preserve object identity on one-foe changes; memoize rows and a stable radar chart model.
- Create modal initial state only on open, not every parent render.
- Send a client idempotency key to duplication; use Task 06 bounded parallel copy and partial cleanup.

## Boundaries and non-goals

- Preserve mana rules, media editing, technique/spell effects, foe schemas, sorting semantics, and DM-only access.
- Do not virtualize small lists without measured benefit; retain keyboard/focus behavior when enabled.
- Do not silently omit foes missing timestamps; backfill/fallback first.

## Tests

- Zero additional user listener on Tecniche/Spell; 100 cards cause one config read.
- Search/sort parity, deferred input, card render counts, media validation, and concurrent mana use.
- Foe cursor/order/live first-page behavior, row/chart render counts, derivative loading, and stable modal state.
- Duplicate request retry/idempotency, bounded copy concurrency, and Storage partial failure cleanup.

## Acceptance gates

- One user update produces one relevant page-state update.
- Initial foe reads/media/DOM are bounded by page size.
- Unrelated foe updates do not rerender every row/radar chart.
- Duplicate clicks/retries create one foe result.
