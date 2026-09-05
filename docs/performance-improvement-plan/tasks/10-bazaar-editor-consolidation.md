# Task 10 - Bazaar editor consolidation

Depends on Tasks 04 and 07. Task 09 summary contracts are required only for editor changes that consume them.

## Outcome

Replace measured duplicated data/form work in the four editor implementations with on-demand shared infrastructure and type-specific adapters.

## Evidence

- `frontend/src/components/bazaar/lazyBazaarEditors.js` already dynamically imports all four editors. Keep that boundary; module length is not a performance measurement.
- All four editors already use `getUserDirectoryPage`. Measure whether directory calls happen before custom visibility intent, and verify paging completeness and cache reuse; full-user fetching is not the current gap.
- Effects invoke cached `getSchema`/common repositories when `customSpells` changes. Count effect runs, repository calls and actual backend reads separately; repeated calls do not prove backend refetches.
- Accessorio/Consumabile add whole-collection live spell/technique listeners.
- Deep-cloned controlled form objects cause broad rerenders on each nested change.

## Implementation elements

1. Preserve existing lazy imports; measure cold open, reopen and switching types before changing loading.
2. Extract a small common data/form unit only when profiling or parity tests justify it. Start with directory/config ownership; a generic schema-driven framework is not required.
3. Keep explicit Weapon/Armor/Accessory/Consumable adapters for genuine contract differences; avoid a generic form that hides rules.
4. Preserve cached schema/common repositories; eliminate measured redundant effect/derivation work. Defer the existing minimal directory path until custom visibility intent and preserve complete option resolution.
5. Separate pure custom-name derivation from cached repository loading where measured effect repetition warrants it; retain required invalidation when remote data changes.
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
- The selected read/render/byte metric improves while four-type behavioral parity remains green; source-line reduction is not a gate.

## Release units and measurement contract

10A: on-demand directory/config ownership. 10B: one measured common form extraction after parity fixtures; independent of 09B unless using its catalog contract.

All four create/edit/inventory modes; measure cold/reopen reads and typing commits. Local field changes cause zero new reads; user directory opens only on custom visibility intent.

Follow the [roadmap release/evidence rules](../README.md#rules-for-every-task) for each unit. Source observations identify work to verify, not fresh timing or deployed status. Record current measured values and numeric targets separately before implementation; use existing budget keys where available.
