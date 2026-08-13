# Task 06 architecture decision

Original decision: 2026-07-23. Current amendment: 2026-08-12.

> The original local consolidated-owner candidate is superseded. Task 05 is now
> V2-only, the former user-root derived triggers are retired, and
> `FND_TASK06_CONSOLIDATED_OWNER` no longer exists. This amended record is the
> current Task 06 architecture; it does not by itself authorize a live config
> mutation or deployment.

## Current decision

Use V2 command transactions as the sole owners of character mutations and
derived character state. Use the Task 06 receipt-backed operation framework for
bounded bulk and destructive work. Retain the Python deployment as a
dependency-light health service with maintenance commands available only
through explicit local CLI entry points.

Parameter totals, Anima effects, HP, and mana are derived inside the callable
transaction that changes progression. The following root triggers are no
longer source files or exports in any environment:

- `updateHpTotal`
- `updateManaTotal`
- `updateTotParameters`
- `updateAnimaModifier`
- `expireBarriera`
- `syncUserDerivedState`

`syncUserDirectory` remains independent and projects only identity/role shell
changes. It never composes or derives migrated character domains.

## Control plane

`app_config/task06_backend` remains the schema-versioned enablement plane for
bounded operations. `enabledOperationKinds` is authoritative for these kinds:

```json
{
  "schemaVersion": 1,
  "enabledOperationKinds": [
    "level-up-all",
    "set-parameter-locks",
    "delete-npc",
    "delete-encounter",
    "delete-grigliata-custom-token",
    "duplicate-foe"
  ]
}
```

Existing deployed documents may still contain the historical
`derivedOwnerMode` property. Runtime parsing preserves schema compatibility,
but that property selects no Function export and cannot reactivate a root data
plane. Do not use it as a rollout control. A missing, malformed, or wrong-version
document enables no bounded operation kinds.

Clients cannot read operation documents directly. Authenticated callables
return a bounded view containing operation ID, kind, status, counters,
retryability, result, and sanitized error class. Actor IDs, request input,
cursors, leases, and subject receipts remain server-only.

## Operation model

- The caller supplies an 8-80 character operation ID.
- The server hashes actor plus operation ID into a private receipt and binds it
  to an immutable kind/request hash.
- `backend_operations` stores status, phase, cursor, bounded progress, retry
  state, and a 30-day expiry.
- `backend_operation_work` schedules one generation at a time. A Firestore
  create trigger claims a finite lease and processes at most one bounded page.
- Per-subject receipts prevent completed work from running twice after pause,
  retry, or replay.
- A paused or failed cleanup can resume only after current actor role and
  operation-kind enablement are revalidated.

## Client operation intent durability

Clients create the operation ID before calling and keep bounded intent metadata
in `sessionStorage` under `fnd.task06.operation-intents.v1`. Records contain
schema/kind, operation ID, a SHA-256 digest of canonical actor/kind/immutable
request input, and timestamp; request payloads and actor IDs are not stored.
Entries are bounded to 32 records, 64 KiB, and 30 days.

The same actor, kind, and immutable request reuses the same operation ID after
a reload. The intent is written before the callable starts and cleared only
after confirmed success. Malformed, oversized, unavailable, or
cryptographically unsupported storage fails closed instead of minting a second
destructive operation.

## Destructive fences

NPC deletion first sets `echi_npcs/{npcId}.deletionState = "pending"`. Rules
then reject client edits/deletion and marker writes that reference it. The
worker deletes marker pages, cleans owned Storage, verifies references, and
deletes the root last.

Encounter deletion first sets `status = "deleted"` and
`deletionState = "pending"`. Rules reject parent, participant, and log writes
while the worker traverses descendants, verifies they are empty, and deletes
the root last.

Custom-token deletion fences the template and instances before bounded
placement and media cleanup. Foe duplication uses immutable receipts and owns
partial-copy cleanup, including canonical Task 07 media families.

## Boundaries

- Task 06 operation enablement is independent of Task 05 user-data routing;
  there is no Task 05 runtime routing switch after retirement.
- Existing Grigliata callables remain in `europe-west1`.
- `duplicateFoeWithAssets(europe-west1)` remains a reviewed alias of the
  canonical V2 endpoint and is not a user-data rollback path.
- Task 07 legacy-media cleanup remains until its separate media-retention gate
  is completed.
- Deploying indexes, TTL policies, rules, Functions, or config requires its own
  reviewed release evidence.
