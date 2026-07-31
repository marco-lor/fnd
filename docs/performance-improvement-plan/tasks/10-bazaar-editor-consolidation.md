# Task 10 - Bazaar editor consolidation

Depends on Task 09.

## Outcome

Replace four duplicated, eager, high-read editor implementations with on-demand shared infrastructure and type-specific adapters.

## Evidence

- `addWeapon`, `addArmatura`, `addAccessorio`, and `addConsumabile` are each roughly 1,000-1,120 lines and statically imported.
- Editors fetch full users even when custom visibility is unused.
- Effects refetch multiple schemas/common documents when local `customSpells` changes.
- Accessorio/Consumabile add whole-collection live spell/technique listeners.
- Deep-cloned controlled form objects cause broad rerenders on each nested change.

## Implementation elements

1. Lazy-load the editor framework only after authorized editor intent.
2. Create a schema-driven core for common identity, visibility, parameters, requirements, spells/techniques, media, validation, save, and inventory-edit behavior.
3. Keep explicit Weapon/Armor/Accessory/Consumable adapters for genuine contract differences; avoid a generic form that hides rules.
4. Load common schemas/data once in parallel and cache them. Load the minimal user directory only when custom visibility opens.
5. Remove local form state from remote-fetch dependencies; merge custom names through pure selectors.
6. Replace whole-form deep clones with structurally shared reducer actions and memoized field sections.
7. Use bounded independent media upload concurrency, upload-first metadata commit, and retryable orphan cleanup from Task 07.
8. Keep one shared source for common spells/techniques; use realtime only if a documented editor requirement needs it.

## Boundaries and non-goals

- Preserve all four schemas, edit/create modes, inventory-edit behavior, media fields, and validation.
- Do not merge fields that have different gameplay meaning merely to reduce source lines.
- Do not fetch full user aggregates for a selector.
- Do not delete existing media until replacement metadata is durably committed.

## Tests

- Create/edit parity fixtures for all four types, including nested parameters, visibility, custom spells, and inventory mode.
- First open/read budget; switching editor type and local spell/form changes issue zero unexpected reads.
- Field render-count tests prove typing updates only the affected section.
- Media concurrency cap, upload failure, metadata failure, cleanup retry, and cancellation.
- Bundle assertion: ordinary player Bazaar chunk contains no editor implementation.

## Acceptance gates

- Common data is loaded once per editor session and user directory only on demand.
- Local editor changes cause zero Firestore reads.
- Source and route chunk duplication fall measurably while behavioral parity remains green.
