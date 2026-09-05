# Task 13 - Tecniche/Spell and Foes Hub

Depends on Tasks 04-07.

## Outcome

Reduce measured residual technique/spell card work and foe browsing/media costs while preserving existing shared data, resource commands and durable duplication.

## Tecniche/Spell elements

- Preserve the existing `useProgression`, `useResources`, `usePersonalSpells` and `usePersonalTechniques` domain hooks in `TecnicheSpell.js`. Profile residual search/card work before adding new stores.
- Preserve shared `getCommonTechniques` and cached `getVarie` in `spell_side.js`; verify cold/warm card mounting does not multiply underlying reads.
- Precompute normalized searchable/sorted entries when sources change; defer search and stabilize callbacks.
- Add pagination/incremental rendering or accessible virtualization at the measured list threshold.
- Consolidate duplicated technique/spell card behavior where contracts match; keep distinct gameplay behavior explicit.
- Enforce Task 07 media limits/derivatives/preload policy.
- Preserve `updateResource` delta commands and retry keys already used by `spell_side.js` and `tecniche_side.js`. Verify exact client/server insufficient-mana, clamping/rejection, concurrent-use and retry semantics before changing anything; do not introduce a new purchase-like rejection contract silently.

## Foes Hub elements

- Replace the full collection listener (`FoesHub.js`) with stable server order, bounded first page, cursor, and legacy timestamp backfill.
- Keep realtime behavior on the active page only unless product requirements prove a broader need.
- Use derivatives for row/detail spell/technique media and validate uploads before transfer.
- Preserve object identity on one-foe changes; memoize rows and a stable radar chart model.
- Create modal initial state only on open, not every parent render.
- `FoesHub.js` already calls `duplicateFoeWithAssetsV2` with an `operationId` through `runWithDurableOperationIntent`, selected by `shouldUseDurableFoeDuplication`; it also retains `duplicateFoeWithAssetsLegacy`. Preserve V2 identity/recovery semantics. Investigate remaining legacy eligibility, compatibility and retirement conditions before extending V2 coverage; reuse Task 06 copy/cleanup infrastructure.

## Boundaries and non-goals

- Preserve mana rules, media editing, technique/spell effects, foe schemas, sorting semantics, and DM-only access.
- Do not virtualize small lists without measured benefit; retain keyboard/focus behavior when enabled.
- Do not silently omit foes missing timestamps; backfill/fallback first.

## Tests

- No duplicate domain subscriptions on Tecniche/Spell; 100 cards cause at most one underlying read per cold config key and zero on warm cache.
- Search/sort parity, deferred input, card render counts, media validation, and concurrent mana use.
- Foe cursor/order/live first-page behavior, row/chart render counts, derivative loading, and stable modal state.
- V2 duplicate retry/reload identity, bounded copy concurrency and Storage partial failure cleanup; test the legacy eligibility branch separately and record its guarantees before deciding migration/retirement.

## Acceptance gates

- One user update produces one relevant page-state update.
- Initial foe reads/media/DOM are bounded by page size.
- Unrelated foe updates do not rerender every row/radar chart.
- V2 duplicate clicks/retries create one foe result using the same durable intent. Any legacy path retained at release has explicit compatibility guarantees and an accepted retirement or remediation decision; do not claim V2 guarantees for an unverified legacy path.

## Release units and measurement contract

13A: residual Tecniche/Spell profiling and targeted fix. 13B: Foes pagination/media/duplication; independent of 13A.

100 technique/spell cards and 500 foes; cold/warm config read counts, relevant card commits, first-page bytes and duplicate-retry result count. Preserve current domain hooks and authoritative mana behavior.

Follow the [roadmap release/evidence rules](../README.md#rules-for-every-task) for each unit. Source observations identify work to verify, not fresh timing or deployed status. Record current measured values and numeric targets separately before implementation; use existing budget keys where available.
