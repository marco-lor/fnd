# Task 14 - Remove Combat Tool and its exclusive wiring

Depends on Tasks 03, 04 and 05 foundations. No dependency on later Grigliata optimization.

## Outcome and decision

Retire the Combat Tool page and exclusive functionality. This supersedes the former scaling proposal completely. This document specifies future implementation only; no page, data or product code is removed by this roadmap revision. Preserve Grigliata turn advancement and every other consumer of shared gameplay logic.

## Verified removal inventory (source review 2026-09-05)

Paths below are repository-relative. Recheck references at implementation time before deletion.

| Surface | Current paths / symbols | Planned treatment |
|---|---|---|
| Route and navigation | `frontend/src/App.js` `/combat`; `frontend/src/routes/routeRegistry.js` `ROUTE_DESCRIPTORS.combat`, importer and route entry; `frontend/src/components/common/navbar.js` | Remove page entry, navigation, preload and importer. Choose an explicit retired-page response or safe replacement redirect for bookmarked `/combat`, including signed-out handling. |
| Feature implementation | `frontend/src/components/combatTool/combatPage.js`, `elements/EncounterCreator.js`, `EncounterDetails.js`, `EncounterSidebarList.js`, `EncounterLog.js`, `AddFoesOverlay.js`, `elements/buttons/advanceTurn.js` | Inventory the entire folder and inbound imports. Remove exclusive UI, listeners and encounter mutations only after protected dependencies are separated. |
| Route delivery and contracts | `frontend/firebase.json` `/combat`; `frontend/src/data/query-contracts.json`; `frontend/performance/scenarios.json`; `frontend/performance/required-chunks.json` `route-combat` | Review hosting/direct-link behavior and retire exclusive query/chunk/scenario requirements. Replace the active encounter scenario with removal and retained-turn coverage. |
| Tests and guards | `frontend/src/App.test.js`; `frontend/src/components/combatTool/combatPage.test.js`; `frontend/scripts/performance/check-user-data-boundaries.test.js` | Replace exclusive expectations; keep shared command boundaries and add absence/direct-link tests. |
| Rules and stored data | `frontend/firestore.rules` encounter access helpers and `match /encounters/{encounterId}`; `encounters` participants/log subcollections | Trace helper consumers and stale-client access. Retire exclusive writes deliberately; retain the agreed historical read/retention policy. No recursive historical deletion is authorized or implied. |

Also audit Functions exports/triggers, Storage rules/assets, indexes, links and fixtures by references and actual data paths. A combat-named field is not evidence of exclusivity. Preserve historical audit/baseline artifacts, including old `/combat` observations, with current explanatory notes only where necessary.

## Protected shared-dependency inventory

| Path / symbols | Required preservation |
|---|---|
| `frontend/src/data/userData/userDataCommands.js`: `consumeTurnEffects`, `callWithOperation` | Shared operation identity/retry behavior. Both encounter `advanceTurn` and Grigliata call this adapter today. |
| `frontend/functions/src/userDataCommands.ts`: `task05ConsumeTurnEffects`, `runIdempotent`, `normalizeGrigliataTurnTransition` | DM authorization, transactional resource/effect updates and Grigliata background/placement transition checks. Preserve callable export in `frontend/functions/src/index.ts` and the `task05ConsumeTurnEffects` entry in `frontend/src/data/functions/callableManifest.json`. |
| `frontend/src/components/grigliata/GrigliataPage.js`: `handleAdvanceTurnOrder`, `consumeTurnEffects` call with `grigliataTransition` | Retain initiative ordering, turn cursor, wrapping, hidden entries, resource/shield effects, retry and UI error behavior. This does not import the encounter-specific `advanceTurn` helper in the reviewed source. |
| `frontend/src/components/grigliata/turnOrder.js`: `normalizeTurnCounter`, `normalizeTurnEffects`, `reconcileTurnEffectsAtTurnCounter`, `computeTurnEffectRemainingTurns` | Preserve turn/effect semantics and all consumers. Keep `turnOrder.test.js`, Grigliata page/board tests and shared Functions tests. |
| Grigliata background/token/placement rules and shared user resource rules | Preserve ownership, role checks, initiative/effects/resources and any retained log behavior. Encounter log removal does not authorize deleting other logging. |

Trace the full dependency graph first. If any retained consumer imports code inside `combatTool`, extract the minimal shared unit to a neutral module with parity tests before deleting the exclusive feature. Do not delete shared combat parameters, initiative, shield, effects, resource, logging or rule helpers by name.

## Independent acceptance units

- **14A: dependency separation.** Freeze the removal/protection manifest and direct-link/stale-client policy; test retained turn journeys. Extract shared code only if inbound references require it. No behavior change.
- **14B: retire UI and exclusive writes.** Requires 14A. Remove route/nav/preload/chunks and exclusive listeners; apply the reviewed rules/writer retirement policy and compatibility rollback. Historical data stays intact.
- **14C: verify retirement.** Requires 14B. Update current tests/contracts and verify production build manifests, route crawl and rules. Destructive historical data cleanup, if ever requested, is a separately authorized task with backup/retention/restore decisions.

## Tests and acceptance

- No Combat navigation or page loader exists; direct `/combat`, reload and signed-out navigation follow the declared retirement behavior without a lazy-chunk error or redirect loop.
- Build manifest contains zero exclusive Combat implementation chunks; entering/leaving the retired URL opens zero encounter listeners and issues zero encounter writes.
- Retained Grigliata fixture covers next turn and wrap, hidden entries, joined/removed participants, shield expiry and resources, rapid double action, retry, permission denial and background change. Compare state/effects and retained logs with the pre-removal reference.
- Shared callable replay with the same operation identity applies effects once; unauthorized actor remains denied. Exercise client retry and transaction conflict in emulator tests.
- Reference scan finds no live imports of deleted files. Existing shared turn/rule regression tests remain meaningful and pass; do not merely delete failing shared expectations.
- Inventory/history counts are unchanged by retirement; no migration or navigation path deletes historical encounters, participants or logs.
- Local verification, staging Browser/manual acceptance and separately authorized production release each have their own recorded result and rollback boundary, as required in the README.
