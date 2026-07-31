# Task 08 - Login, Character Creation, and Home

Depends on Tasks 02, 04, 05, and 07.

## Outcome

Make the core player journey use the shared auth/config/data/media paths, batch high-frequency interactions, and remain correct under concurrent updates.

## Login implementation elements

- Remove the separate post-login profile read and reuse the Task 02 authority.
- Start busy/idempotency state before any account request. Call account creation directly and map email-in-use rather than preflighting `fetchSignInMethodsForEmail` (`Login.js:84-96`).
- Remove the artificial 1.5-second navigation delay (`Login.js:146-151`); preserve success feedback in route state if needed.
- Isolate decorative background/buttons so controlled input changes do not rerender them.

## Character Creation implementation elements

- Preload Codex race data, schema, and `utils/varie` once in parallel through the shared config repository. Revisited steps must not refetch them.
- Replace the seven serial race-confirm operations (`CharacterCreation.js:143-181`) with cached reads plus one idempotent authoritative commit.
- Remove the profile listener duplicated by `PointsDistribution.js:48-62`.
- Use the centralized callable registry/region. Keep point allocation authoritative; if requests remain per click, define request and rollback budgets. Prefer a queued delta committed on Next if rules allow.
- Disable navigation while a transition is pending and prevent double commit.
- Use the shared media validator/derivatives and fix preview revocation on replacement/unmount (`CharacterCreation.js:98-116`).

## Home implementation elements

- Consume selector slices rather than listeners in StatsBars, Inventory, EquippedInventory, and paramTables.
- Replace 200 ms HP/mana/essenza/barrier write intervals with pointer-based optimistic accumulation and one authoritative delta commit on pointer-up/cancel. Clean all timers on unmount.
- Move DiceRoller into the existing React tree. Apply consumable result and quantity in one transaction/callable after the animation using current state, not the stale pre-animation read.
- Normalize inventory/equipment once in a shared memoized selector; precompute search fields and use deferred input for large lists.
- Use Task 07 thumbnails/lazy media and bounded list rendering.
- Remove repeated Home/param/consumable `utils/varie` and schema reads.

## Boundaries and non-goals

- Preserve character formulas, caps, race reset rules, negative-stat/point policy, inventory history, dice result semantics, and multi-client visibility.
- Do not accept client-computed final resource values without server guards.
- Do not change the visual flow or step order unless required for a deterministic loading/error state.

## Tests

- Login single request/double-click/error/navigation and render-count tests.
- Wizard read/write cardinality, step revisit, config failure/retry, double-click, partial legacy data, and image cleanup tests.
- Two-second hold performs one mutation with the correct accumulated delta; pointer cancel, touch cancel, lost capture, route unmount, and two-client changes.
- Consumable quantity/stat atomicity after delayed dice; cancel/unmount behavior.
- 500-item inventory filter/commit/media-request fixture and selector render-count assertions.

## Acceptance gates

- Home registers no duplicate target for the compact player data domains.
- One resource gesture creates one server mutation, not five writes per second.
- Race confirmation performs one write after cached configuration.
- A resource update does not rerender Navbar, inventory, Extra, or unrelated Home sections.
