# Task 05 access and mutation matrix

Current as of 2026-08-13. `fatin-test` is `new-only`, its legacy root fields are
physically compacted, and the runtime compatibility layer has been retired.
This matrix describes the V2-only source, not the superseded activation build.

The lexical boundary checker remains a guard against reintroducing direct
aggregate-root access. It fingerprints the Firestore operation, target, and
mutation expressions, but does not replace transaction, authorization, rules,
or behavior tests.

## Data access matrix

| Consumer | Root shell access | Canonical V2 access | Runtime fallback |
|---|---|---|---|
| Auth/session | Dedicated `users/{uid}` shell subscription for identity, role, avatar, flags, and summary | None | None |
| Character creation | Server reads/writes the shell as part of one canonical command | Initializes progression, resources, settings, equipment, and profile content | None; direct client shell creation is denied |
| Home | Shell only through Auth/profile adapter | Progression, resources, profile content, inventory, and equipment hooks | None |
| Bazaar | Shell only for authorization | Catalog plus purchase/inventory commands and V2 resources | None |
| DM dashboard | Directory labels plus explicitly selected user shell | Explicit per-user V2 domain hooks and commands | None |
| Tecniche/Spell | Shell identity only | Personal-content collections, progression, and resources | None |
| Combat | Directory identity/labels | V2 resources and board-aware commands | None |
| Grigliata | Shell identity/role/avatar | Settings, progression, resources, and board collections | None |
| Navbar/media | Avatar/media metadata on shell | Media lifecycle callables and owned V2 documents | Legacy media read compatibility is Task 07, not User Data V1 |
| Admin deletion | Requester/target shell and deletion checkpoint | Recursively deletes V2 subcollections and both Task 05 archive formats | None; rollout drain is no longer consulted |
| Directory sync | Shell trigger reads only identity/label fields | Writes `user_directory` | None |
| Offline migration tools | May read historical roots and private rollout evidence under explicit project/approval guards | Backfill, verify, compact, archive, and reconstruct | Not imported or deployed as runtime code |

Nested `users/{uid}/diceRolls` is not an aggregate root and remains outside the
Task 05 migration boundary.

## Direct-access debt ledger

The current production-source baseline is zero tracked legacy aggregate files
outside `src/data/userData/userDataRepository.js`. That adapter may subscribe
only to the compact shell; it cannot select a legacy stage, compose V1 domains,
or compare shadow projections.

The previous counts of 42 and 43 files were historical snapshots taken at
different points in the migration. They are not current acceptance criteria.
Any new recognized aggregate access, root migrated-field write, or retired
adapter name fails the checked-in boundary/retirement tests.

## Mutation matrix

| Command | Canonical reads | Canonical writes | Legacy projection | Principal failures |
|---|---|---|---|---|
| Purchase | actor/target shell, catalog, V2 resources, receipt | one inventory document, V2 resources, receipt | None | hidden item, invalid price, insufficient gold, replay mismatch |
| Adjust gold | access, V2 resources, receipt | V2 resources, receipt | None | unauthorized target, non-finite delta |
| Update resource | access, V2 resources, receipt | V2 resources, receipt | None | invalid action/cap or stale request |
| Update progression | access, V2 progression, receipt | V2 progression, shell `summary.level`, receipt | None | protected field, stale revision |
| Inventory mutation | access, V2 inventory/equipment, receipt | O(1) inventory documents, equipment if needed, receipt | None | equipped removal, invalid quantity, oversized snapshot |
| Equipment | access, V2 inventory/equipment/progression, receipt | equipment and derived V2 progression, receipt | None | incompatible slot, two-hand/belt conflict |
| Personal content | access, V2 content/reservations, receipt | content and reservation documents, receipt | None | name collision, invalid ID, oversized data |
| Settings | access, V2 settings, receipt; optional board documents | V2 settings and atomic board state, receipt | None | unauthorized locks/preferences or stale board state |
| Profile content | access, V2 profile content, receipt | V2 profile content, receipt | None | unauthorized or oversized patch |
| Prepare/commit consumable | access, V2 inventory/progression/resources/equipment, receipts | V2 resources/inventory/equipment and receipts | None | invalid/expired/concurrent item state |
| Character creation | target shell existence, catalog/equipment inputs | compact shell plus initial V2 fixed documents | None | existing target, invalid/oversized initial model |
| Grigliata resource/turn action | board authorization/state and V2 resources | board documents, V2 resources, receipt | None | stale board revision or unauthorized owner |
| Level up / parameter locks | authorized shell and V2 progression/settings | V2 domains plus shell summary where needed | None | unauthorized caller, stale/invalid request |
| Delete custom token | canonical board/template state and operation receipt | canonical board/template deletion state | None | unauthorized or stale token context |
| Delete user | requester/target shell, V2 documents, archive media references, checkpoint | pending tombstone, recursive deletion, cleanup verification | None | unauthorized caller or incomplete Auth/Storage/archive cleanup |

All user-data commands bind an idempotent `operationId` to a canonical request
hash. Replaying the same ID and hash returns the stored result; reusing an ID
for a different request fails. Clients never supply authoritative prices,
visibility, equipment totals, or dice outcomes.

## Retired runtime inventory

The following Task 05 runtime categories are intentionally absent:

- rollout-stage and effective-stage resolution in the browser or Functions;
- legacy/shadow repository subscriptions and legacy normalizers;
- dual-write context and legacy root projections;
- V1 callable aliases for progression and Grigliata token deletion;
- root-derived HP, mana, total-parameter, Anima, barrier-expiry, and bridge
  triggers;
- client-side character-creation root transactions;
- rollback bridge and legacy mutation gate.

Offline migration/cutover/compaction/reconstruction scripts are retained for
auditing, verification, and guarded recovery. They are not bundled into Hosting
or exported from Functions.

## Verification ownership

- Repository/Auth tests own shell identity, subscription sharing, account
  switching, V2 normalization, and absence of stage/fallback logic.
- Functions tests own authorization, idempotency, atomic writes, formulas,
  board transitions, and absence of root projections.
- Rules/emulator tests own shell versus V2 path authorization and query shapes.
- Migration tests own historical stages, deterministic IDs, drain/cutover
  evidence, archives, compaction, and reconstruction.
- Boundary and retirement tests prevent reintroduction of dormant runtime
  files, exports, aliases, root triggers, and aggregate access.
- Logged-in browser acceptance owns the deployed Home, Bazaar, DM, Combat, and
  Grigliata interaction paths after release.
