# Task 05 access and mutation matrix

This is the human-readable ownership inventory. The exact current set of direct
frontend aggregate expressions is machine-locked in
`frontend/scripts/task05/legacy-user-access-baseline.json`; CI fails on any new,
changed, or stale entry. The baseline is migration debt and must reach zero
outside `data/userData/userDataRepository.js` before `new-only`.

The schema-V2 checker fingerprints each known direct aggregate expression with
its Firestore operation, target, and mutation payload expressions/bindings. It
is still a lightweight lexical guard: it does not prove transaction ordering,
authorization semantics, or behavior hidden behind indirect helpers. Command,
rules, and behavior tests plus code review own that assurance.

## Data access matrix

| Consumer group | Legacy fields / access | V2 domain/API | Migration rule |
|---|---|---|---|
| Auth, Login, Character Creation | root shell, flags, race, initial schema, progression | shell repository; progression/settings/profile-content commands | Intentional maximum two root listeners per Auth UID: dedicated session-resilient Auth profile plus one shared actor-scoped aggregate; access-generation changes reattach ordinary domains without canceling Auth |
| Rollout control plane | global stage, per-user overrides, drains, completion lock | private effective-stage resolver required for players | Raw config reads are DM/webmaster-only and all client writes are denied; player activation stays blocked until the resolver exists |
| Home | stats, parameters, Anima, content | progression, resources, profileContent hooks | Compose only requested domains; no inventory listener in parent Home |
| Home inventory/equipment/modals | `inventory`, `equipped`, parameter equipment deltas | inventory/equipment hooks and commands | Equipment stores inventory IDs; command recomputes effects |
| Bazaar purchase | root gold plus inventory array | purchase command | Server reads catalog, writes one inventory doc plus resources |
| Bazaar/DM catalog editors | full user list for labels/grants/edits | `user_directory`, inventory command | Labels never require private roots; grants are server-authorized |
| DM dashboard/player panels | full users, locks, resources, personal content, inventory | directory plus explicit per-user domain hooks/commands | No unbounded full-profile directory read |
| Tecniche/Spell | personal maps, mana, parameters | personal-content pages, progression/resources | Stable IDs; mana spend through resource command |
| Combat | user list, resources, active effects | directory/resources and combat command | Cross-document changes remain transactional server-side |
| Grigliata | preferences, selected-character stats, parameters, barrier resources | settings/progression/resources and board-aware commands | Unit/emulator only during battle; nested `diceRolls` is outside aggregate migration |
| Navbar/media | avatar shell and user-owned paths | shell/profile command plus media cleanup queue | Metadata commit before cleanup; shared catalog media excluded |
| Admin deletion | root, Auth, user subcollections, directory, Storage | deletion state machine | Fresh webmaster auth and pending tombstone are transactional; a post-Auth final sweep is verified before completion |
| Functions derived state | broad root triggers | shared pure calculators and domain owner | Task 06 consolidates remaining trigger fan-out |
| Backend maintenance | previous partial top-level JSON dump | recursive typed V2 export/restore | No document contents on stdout; live execute restore and protected control mutations are refused |

### Direct-access debt ledger

The current boundary snapshot contains 43 legacy production files (down from 50
after Bazaar purchase, Home domains, inventory/equipment/resource controls, and
Tecniche/Spell adoption). It is not a
waiver for final acceptance. Each consumer migration removes its file entry in
the same change; adding or changing a recognized direct expression fails CI.
Changing the associated operation or payload context also fails CI. Review and
behavior tests must still validate transaction and authorization semantics. The
notable residual groups are:

- Auth/Login and Character Creation;
- Bazaar edit/comparison paths outside the migrated purchase command;
- Home item-detail and parameter-table paths outside the migrated domain controls;
- DM dashboard and its item/content overlays;
- Combat and Grigliata resource integration;
- Tecniche/Spell legacy side-editor paths.

Nested `users/{uid}/diceRolls` access is explicitly not an aggregate root access
and remains permitted. The repository adapter and offline migration tooling are
the only allowed aggregate roots after cleanup.

## Mutation matrix

| Command | Accepted input | Reads in transaction | Writes in transaction | Compatibility projection | Key failures |
|---|---|---|---|---|---|
| Purchase | operation ID, catalog item ID | actor/target shell, catalog, resources, receipt | receipt, one inventory doc, resources | legacy gold and acquired snapshot while dual-write | hidden/unauthorized item, invalid price, insufficient gold, replay hash mismatch |
| Adjust gold | operation ID, target, signed delta | access, resources, receipt | resources, receipt | `stats.gold`; retains self-service clamp-at-zero behavior | unauthorized target, non-finite delta |
| Update resource | operation ID, target, resource, action/value | access, resources, receipt | resources, receipt | matching legacy stat/effect | action-specific cap violation; no universal clamp |
| Update progression | operation ID, target, allowlisted patch | access, progression, receipt | progression, shell `summary.level`, receipt | legacy stats/parameters | protected/unknown field, stale revision |
| Inventory mutation | operation ID, target, action, inventory ID/data | access, inventory, equipment, receipt | O(1) inventory docs, equipment if removal requires it, receipt | legacy array | equipped removal, invalid quantity, oversized snapshot |
| Equipment | operation ID, target, slot, inventory ID/null | access, inventory, equipment, progression, receipt | equipment, recomputed progression contributions, receipt | legacy equipped/parameter fields | incompatible slot, two-hand conflict, belt shrink conflict |
| Personal content | operation ID, target, kind/action/name/data/content ID | access, content, old/new reservations, receipt | content, reservation swap, receipt | legacy name-keyed map | exact-name collision, invalid ID, oversized payload |
| Settings | operation ID, target, allowlisted patch | access, settings, receipt | settings, receipt | legacy settings | owner changing DM lock or cross-user preference |
| Profile content | operation ID, target, allowlisted patch | access, profileContent, receipt | profileContent, receipt | legacy maps | unauthorized/oversized patch |
| Prepare consumable | operation ID, target, inventory ID, resource | access, inventory, progression, receipt | prepared receipt/result only | none | invalid item/effect/resource |
| Commit consumable | prepare operation ID plus commit operation ID | prepared receipt, inventory, equipment, resources | resources, inventory decrement/delete, equipment cleanup, receipt | legacy resources/inventory/equipment | expired/already committed prepare, missing item, concurrent revision |
| Grigliata resource action | operation ID, board context, target/action | board permissions/state and user resources | board docs plus resources | matching legacy resource fields | stale board revision, unauthorized owner |
| Delete user | single document-ID target | requester role, rollout, target, deletion checkpoint | authorized pending tombstone and root marker in one transaction; recursive deletes outside it | directory/root cleanup | unauthorized caller, drain fence, cleanup verification, resume after partial external/Auth/Storage failure |

All commands validate a canonical request hash against `user_operations`. A
same-ID same-hash replay returns the stored result; a same-ID different-hash
request fails. Client code never supplies authoritative catalog price,
visibility, derived equipment totals, or dice results.

## Storage ownership

| Asset | Canonical owner path | Delete policy |
|---|---|---|
| Avatar | user-scoped profile path recorded in shell | replace metadata, then queue old owned path |
| Custom inventory media | user/inventory scoped path recorded on inventory doc | delete only after inventory commit and reference check |
| Personal spell/technique media | user/content scoped path | stable content ID survives rename; cleanup after metadata commit |
| Bazaar catalog media | catalog-owned/shared | never deleted by user/item cleanup |
| Grigliata board media | board/session ownership | unchanged by Task 05 |

## Verification ownership

- Repository/Auth runtime tests own selector identity, account switch, the
  intentional two-root-listener ceiling, access-generation close/reattach,
  paging, and legacy/V2 normalization.
- Functions tests own authorization, idempotency, transactions, tamper rejection,
  formula compatibility, and compatibility projections.
- Rules/index emulator tests own role/path access and production query shapes.
- Migration tests own deterministic IDs, partial users, interruption/resume,
  pre-drain identity stabilization, size gates, archive immutability, reverse
  materialization, completion-lock resume, and fresh-verification mismatch.
- Backend tests own recursive traversal, Firestore type fidelity, manifest
  tampering, redacted restore planning, approval, idempotency, and target safety.
- Boundary-checker tests own expression, operation, target, and payload-context
  drift; they do not replace transaction/authorization behavior review.
- Browser checks are read-only on `/home`; Grigliata uses only the demo emulator.
