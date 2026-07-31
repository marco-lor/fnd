# Task 06 function-region inventory

Date: 2026-07-23. The checked-in callable manifest is the machine-enforced
source of truth:
`frontend/src/data/functions/callableManifest.json`.

## Callable ownership

| Region | Logical keys | Owner / compatibility decision |
| --- | --- | --- |
| `europe-west8` | `deleteUser`, `updateUserRole` | Existing admin ownership retained. |
| `europe-west8` | `levelUpAll`, `levelUpUser`, `spendCharacterPointV2` | Canonical progression endpoints. `spendCharacterPoint` remains a `us-central1` compatibility alias. |
| `europe-west8` | `task05PurchaseItem`, `task05AdjustGold`, `task05UpdateResource`, `task05UpdateGrigliataCharacterResources`, `task05SetEquipment`, `task05MutateInventory`, `task05MutatePersonalContent`, `task05UpdateProfile`, `task05UpdateSettings`, `task05UpdateProfileContent`, `task05UpdateProgression`, `task05PrepareConsumable`, `task05CommitConsumable` | Existing user-data V2 ownership retained. |
| `europe-west8` | `setAllParameterLocks`, `deleteNpcV2`, `deleteEncounterV2`, `getBackendOperationStatus`, `resumeBackendOperation` | New bounded backend-operation API. |
| `europe-west8` | `duplicateFoeWithAssetsV2` | Canonical bounded-copy endpoint. The `europe-west1` name stays as a compatibility alias. |
| `europe-west1` | `duplicateFoeWithAssets` | Compatibility alias only; no silent client region guessing. |
| `europe-west1` | `deleteGrigliataCustomToken`, `spawnGrigliataCustomTokenInstance`, `spawnGrigliataFoeToken`, `updateGrigliataCustomTokenTemplate` | Existing Grigliata locality retained; no region move during an active board. |
| `us-central1` | `spendCharacterPoint` | Compatibility alias only. |

Every UI acquisition goes through the registry, which memoizes one Functions
instance per region and connects to `127.0.0.1:5001` only when the explicit
performance flag is active. The static checker rejects missing manifest
entries, region drift, and direct `firebase/functions` acquisition outside the
registry.

## Background triggers

| Region | Trigger | Local candidate behavior |
| --- | --- | --- |
| `europe-west8` | `syncUserDerivedState` | Sole authoritative user-derived owner in the demo candidate. |
| `europe-west8` | `updateHpTotal`, `updateManaTotal`, `updateTotParameters`, `updateAnimaModifier`, `expireBarriera`, `syncUserDirectory` | Preserved in normal builds; exported as `undefined` only when the generated demo Functions environment sets `FND_TASK06_CONSOLIDATED_OWNER=1`. |
| `europe-west8` | `runBackendOperationWorker` | Processes one work generation with a finite lease/page. |
| existing regions | Other domain cleanup triggers | Unchanged by the consolidation switch. |

## Region decision

New user-data and operation endpoints use `europe-west8`, matching the current
canonical user-data Functions owner. Existing Grigliata endpoints stay in
`europe-west1` and the old point-spend endpoint stays in `us-central1` until
client latency, cold starts, deployment order, and alias traffic are measured.
This candidate does not claim a production region migration.

