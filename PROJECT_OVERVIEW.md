<!-- LAST VERIFIED: 2026-08-13 -->

# FND (Fantasy & Dragons)

FND is a React and Firebase tabletop-RPG web application for character
progression, personal inventory and content, the Bazaar, combat management,
foes, and the shared Grigliata battle board.

> This is the current `fatins` production architecture after the Task 05 V2 cutover,
> physical root compaction, and runtime-compatibility retirement. Earlier Task
> 05 and Task 06 documents describe historical rollout states only when they
> carry a superseded or historical label.

## Runtime status

- User data is V2-only. The frontend has no legacy-read, dual-write, shadow,
  user-override, or rollback-bridge route.
- `users/{uid}` is a compact shell for model version, identity, authorization,
  avatar, flags, deletion state, and bounded summary fields.
- Character domains live in fixed V2 state documents and normalized V2
  collections. Migrated root-domain fields are denied by Firestore rules.
- Derived parameter and resource values are calculated in the same server
  transaction as their V2 command. No user-root derived-state trigger remains.
- `user_directory/{uid}` is a server-owned compact projection maintained by
  `syncUserDirectory` from shell identity and role fields only.

## Main components

- `frontend/`: React 18 application hosted by Firebase Hosting.
- `frontend/functions/`: Firebase Functions v2 in TypeScript.
- Firestore, Firebase Auth, Cloud Storage, and App Check provide the primary
  data, identity, media, and abuse-protection planes.
- `backend/`: dependency-light FastAPI health service plus explicit local-only
  maintenance commands. It is not the active user-data plane.

The browser talks directly to Firebase through reviewed repositories,
Firestore listeners, and callable Functions. Local maintenance tools use the
Admin SDK only after explicit project and execution confirmation.

## Current user-data model

```text
users/{uid}                         compact identity/auth/profile shell
  state/progression                 level, points, Parametri, AltriParametri
  state/resources                   HP, mana, gold and other resources
  state/settings                    character and UI settings
  state/equipment                   equipped item references
  state/profileContent              bounded profile content
  inventory/{entryId}               normalized inventory entries
  spells/{spellId}                  normalized personal spells
  tecniche/{techniqueId}            normalized personal techniques

user_directory/{uid}                server-owned list/search projection
```

Repositories subscribe independently to the compact shell, required state
documents, and required collections. They do not read or reconstruct migrated
domains from the root. Bazaar catalog documents remain under `items/{itemId}`;
catalog entries can include nested spell or technique payloads without changing
the per-user storage contract.

Task 05 migration, cutover-attestation, compaction, verification, and archive
reconstruction utilities remain under `frontend/scripts/task05/`. They are
offline operator tools for auditing, verification, and guarded recovery, not a
runtime V1 data path.

## Functions and regions

`frontend/src/data/functions/callableManifest.json` is the machine-enforced
callable source of truth. It currently contains 43 logical callable keys:
38 in `europe-west8` and 5 in `europe-west1`.

- `europe-west8` owns admin, progression, Task 05 V2 user-data, Task 06 bounded
  operations, canonical foe duplication, and Task 07 media callables.
- `europe-west1` retains the active Grigliata callables and the reviewed
  `duplicateFoeWithAssets` compatibility alias. The canonical duplication
  endpoint is `duplicateFoeWithAssetsV2` in `europe-west8`.
- There is no callable in `us-central1`; the old
  `spendCharacterPoint(us-central1)` alias is retired.

Background Functions include the compact directory projection, bounded Task 06
worker, Grigliata cleanup/synchronization, and Task 07 media lifecycle jobs.
The following former user-root owners are retired and must not be exported or
present in compiled Functions output:

- `updateHpTotal`
- `updateManaTotal`
- `updateTotParameters`
- `updateAnimaModifier`
- `expireBarriera`
- `syncUserDerivedState`

Files named `legacyMediaCleanup` are a separate Task 07 storage-retention
compatibility plane. They do not read or write the retired Task 05 user-data
model and remain intentionally deployed until the media rollout retires them.

## Core data flows

1. Firebase Auth establishes the session; `AuthContext` subscribes to the
   compact user shell and gates routes by role and deletion state.
2. Character screens subscribe only to the V2 domains they display.
3. Progression, level-up, consumable, inventory, personal-content, settings,
   equipment, Bazaar purchase, and Grigliata resource mutations use callable
   Functions that validate actor/target scope and update V2 documents.
4. Parameter totals, Anima effects, HP, and mana are derived in the owning
   command transaction, preventing trigger chains and intermediate UI states.
5. DM bulk/destructive work uses receipt-backed Task 06 operations with bounded
   pages, leases, idempotent subjects, and resumable status.
6. Task 07 owns canonical media manifests, generated variants, attachment,
   retirement, and bounded cleanup. Foe duplication preserves its reviewed
   region alias while the client registry selects the exact endpoint.

## Security and deletion

- Firestore rules deny direct client writes to V2 state and personal-data
  collections; mutations go through authenticated, role-aware callables.
- Direct client creation of a user shell is denied. Character creation is a
  server transaction that creates the shell and required V2 state.
- Migrated legacy root fields cannot be created or changed by clients.
- `deleteUser` removes Auth state, the shell and descendants, directory data,
  Task 05 migration/compaction archives, and owned media references before it
  verifies completion.
- Task 06 operation/work/receipt collections and Task 07 media control data are
  server-owned.

## Validation and release

From `frontend`:

```text
npm test -- --watch=false --runInBand
npm run perf:test
npm run perf:functions-integration
npm run users:test-v2-tools
npm run release:test
npm run build:production
```

From `frontend/functions`:

```text
npm run lint
npm test
```

The Functions build first deletes only `frontend/functions/lib`, compiles from
TypeScript, then fails if any retired Task 05 module or export survives. Review
the live Function inventory before deployment so removal of old exports is
intentional. For this retirement, deploy Functions before rules and Hosting,
then smoke authenticated Home, DM, Bazaar (including nested spells), Combat,
and Grigliata interactions.

## Production release invariant

The production rollout completed on 2026-08-13 through the reviewed sequence:

1. proved the production V2 migration, new-only cutover attestation, and physical
   root compaction independently;
2. deployed the archive-aware `deleteUser` path before creating compaction
   archives;
3. applied the runtime, rules, manifest, harness, and documentation changes as one
   reviewed commit;
4. ran the clean Functions build and all local gates against the production
   candidate checkout;
5. inspected the production Function delete plan and preserved unrelated Task 06,
   Task 07, and Grigliata compatibility endpoints;
6. deployed Functions, then Firestore rules, then Hosting, and completed an
   authenticated manual smoke before accepting the release.

The dated activation record and access matrix under
`docs/performance-improvement-plan/task-05/` explain the historical counts and
point to the current V2-only state.
