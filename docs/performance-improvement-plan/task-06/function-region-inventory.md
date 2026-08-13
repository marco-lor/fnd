# Task 06 function-region inventory

Last verified: 2026-08-12.

> The 2026-07-23 candidate inventory was superseded by the Task 05 V2-only
> runtime retirement. This file now records current ownership. The checked-in
> callable manifest remains the machine-enforced source of truth:
> `frontend/src/data/functions/callableManifest.json`.

## Callable ownership

| Region | Logical keys | Current ownership |
| --- | --- | --- |
| `europe-west8` | `deleteUser`, `updateUserRole` | Admin ownership. |
| `europe-west8` | `levelUpAll`, `levelUpUser`, `spendCharacterPointV2` | Canonical V2 progression endpoints. |
| `europe-west8` | Task 05 `task05*` keys | Canonical V2 character creation, user-data mutation, consumable, and admin-list endpoints. |
| `europe-west8` | `setAllParameterLocks`, `deleteNpcV2`, `deleteEncounterV2`, `getBackendOperationStatus`, `resumeBackendOperation` | Receipt-backed Task 06 bounded operations. |
| `europe-west8` | `duplicateFoeWithAssetsV2` | Canonical bounded foe-copy endpoint. |
| `europe-west8` | Task 07 `task07*` keys | Canonical media lifecycle and foe-retirement endpoints. |
| `europe-west1` | `duplicateFoeWithAssets` | Reviewed foe-copy compatibility alias of `duplicateFoeWithAssetsV2`. |
| `europe-west1` | `deleteGrigliataCustomToken`, `spawnGrigliataCustomTokenInstance`, `spawnGrigliataFoeToken`, `updateGrigliataCustomTokenTemplate` | Active Grigliata locality retained. |

The manifest contains 43 logical keys: 38 in `europe-west8` and 5 in
`europe-west1`. There is no `us-central1` callable. The old
`spendCharacterPoint(us-central1)` compatibility alias is retired; clients use
`spendCharacterPointV2(europe-west8)`.

Every UI acquisition goes through the callable registry, which memoizes one
Functions instance per region and uses the demo emulator only under the owned
performance environment. Static checks reject missing entries, region drift,
and direct callable acquisition outside the registry.

## Background ownership

| Region | Trigger or job | Current behavior |
| --- | --- | --- |
| `europe-west8` | `syncUserDirectory` | Projects only compact shell identity and role fields into `user_directory`. |
| `europe-west8` | `runBackendOperationWorker` | Processes one bounded Task 06 work generation with leases and receipts. |
| current declared regions | Task 07 media, Grigliata cleanup, and music-stream jobs | Unchanged by Task 05 user-data retirement. |

The former user-root derived owners `updateHpTotal`, `updateManaTotal`,
`updateTotParameters`, `updateAnimaModifier`, `expireBarriera`, and
`syncUserDerivedState` are deleted from source, exports, readiness allowlists,
and compiled output. Derived V2 values are computed synchronously by their
owning commands. No environment switch can reactivate those triggers.

Task 07 `legacyMediaCleanup` exports remain intentionally separate: they clean
Storage references during the media migration and are not a Task 05 V1
user-data plane.

## Region decision

Canonical user-data and bounded-operation endpoints use `europe-west8`.
Grigliata remains in `europe-west1` while a board can be active. The sole
cross-region compatibility alias retained by the callable manifest is foe
duplication; it is unrelated to retired user-data routing and must be preserved
when the same change is applied to production.
