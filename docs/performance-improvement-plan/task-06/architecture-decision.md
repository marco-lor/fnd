# Task 06 architecture decision

Date: 2026-07-23. Status: local/demo-emulator candidate. Nothing in this
decision authorizes a Firebase deployment or a production rollout change.

## Decision

Use one `europe-west8` owner for user-derived state and one server-owned,
receipt-based operation framework for bounded bulk/destructive work. Retain the
Python deployment as a dependency-light health service, with maintenance
commands isolated behind explicit CLI entry points.

The local performance environment sets
`FND_TASK06_CONSOLIDATED_OWNER=1`. In that demo-only environment, the Functions
entry point omits these six compatibility triggers:

- `updateHpTotal`
- `updateManaTotal`
- `updateTotParameters`
- `updateAnimaModifier`
- `expireBarriera`
- `syncUserDirectory`

It continues to export `syncUserDerivedState`, which owns field-level derived
updates plus the user-directory projection. Without that environment variable,
all compatibility exports remain present. This keeps normal source behavior
unchanged until a separate production rollout is reviewed and deployed.

## Control plane

`app_config/task06_backend` has schema version 1:

```json
{
  "schemaVersion": 1,
  "derivedOwnerMode": "legacy | shadow | authoritative",
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

Missing, malformed, or wrong-version configuration resolves to `legacy` with
no enabled operation kinds. The demo fixture explicitly seeds
`authoritative` plus all known operation kinds before its first Functions
readiness write.

Clients cannot read operation documents directly. Authenticated callables
return a bounded view containing operation ID, kind, status, counters,
retryability, result, and sanitized error class. Actor IDs, request input,
cursors, leases, and subject receipts remain server-only.

## Operation model

- The caller supplies an 8-80 character operation ID.
- The server hashes actor plus operation ID into a private receipt document and
  binds it to an immutable kind/request hash.
- `backend_operations` stores status, phase, cursor, bounded progress, retry
  state, and a 30-day expiry.
- `backend_operation_work` schedules one generation at a time. A Firestore
  create trigger claims a finite lease and processes at most one bounded page.
- Per-subject receipts prevent already-completed work from running twice after
  pause, retry, or replay.
- A paused/failed cleanup can be resumed only after the current actor role and
  enabled-kind configuration are revalidated.

The rules deny every client read/write to operation, work, and receipt
collections. TTL applies to operation roots, work items, and subjects.

## Client operation intent durability

Candidate-mode clients create the operation ID before calling the server and
persist it in `sessionStorage` under `fnd.task06.operation-intents.v1`. The
record contains only schema/kind, operation ID, an SHA-256 digest of canonical
actor/kind/immutable-request input, and its timestamp; request payloads and
actor IDs are not stored. Entries are bounded to 32 records, 64 KiB, and 30
days.

The same actor, kind, and immutable request reuses the same operation ID after
a reload. The entry is written before the callable starts, retained after an
ambiguous or rejected call, and cleared only after confirmed success.
Synchronous duplicate submissions share the in-flight intent. Malformed,
oversized, unavailable, or cryptographically unsupported storage fails closed
instead of silently minting a second destructive operation. This behavior is
enabled only by the local candidate switch; cross-tab and tab-close recovery
remain production-hardening gates.

## Destructive fences

NPC deletion first marks `echi_npcs/{npcId}.deletionState = "pending"`.
Security rules then reject client edits/deletion of that NPC and reject public
or private marker writes that reference it. The worker deletes marker pages,
cleans the owned Storage path, verifies no references remain, and deletes the
NPC root last.

Encounter deletion first marks the root `status = "deleted"` and
`deletionState = "pending"`. Rules preserve the existing query-compatible read
audience but reject all client parent, participant, and log writes while the
fence is active. The worker traverses descendant collections in bounded pages,
verifies they are empty, and deletes the root last.

The private-marker cleanup query requires the declared ascending
collection-group index on `map_markers_private.npcId`. The index exists only in
`firestore.indexes.json`; it has not been deployed or activated online.

## Non-decisions

- No Firebase resource was deployed or changed online.
- No production Task 06 config is created by this implementation.
- No existing Grigliata callable is moved while the battle board is live.
- The durable intent store is enabled only for the local performance candidate;
  normal frontend behavior remains on the compatibility path.
- No accepted performance baseline is rewritten. The fixture manifest changes
  because its new Task 06 control document is part of the deterministic input;
  a later authoritative candidate must earn a new compatible baseline.
- `minInstances` remains disabled pending measured cold-start evidence.
