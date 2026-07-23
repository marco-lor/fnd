# ADR 05: versioned user domains and inventory instances

- Status: accepted for implementation; production rollout not authorized
- Schema version: `2`
- Rollout configuration: `app_config/user_data_v2`
- Migration state: descendants of `migration_state/user-data-v2`
- Decision owner: Task 05

## Context and invariants

The legacy `users/{uid}` document combines identity, authorization, creation
state, parameters, resources, inventory snapshots, equipment, settings, and
personal content. Any narrow change retransmits and often rewrites this growing
aggregate. Task 05 separates write contention and read payload without changing
the following invariants:

- role and fresh-role authorization remain server-verified;
- every Bazaar purchase is an independent acquired instance;
- explicit custom `varie` quantities remain stacks, while legacy non-Varie
  `qty > 1` expands into unit instances;
- acquired snapshots survive catalog edits, hiding, and deletion;
- equipment effects, belt capacity (`slotCintura === 99` included), dynamic
  `beltC*` slots, two-handed constraints, and parameter thresholds remain
  behavior-compatible;
- action-specific resource semantics remain intact; there is no universal clamp;
- legacy clients remain supported until adoption and mismatch gates pass;
- backfill is additive and never deletes or compacts legacy data.

## Authoritative Firestore model

| Path | Contract | Owner | Budget |
|---|---|---|---:|
| `users/{uid}` | Identity/authorization shell: `email`, `role`, `username`, `characterId`, `race`, `imageUrl`, `imagePath`, creation/deletion flags/timestamps, `modelVersion`, and server-owned `summary.level` | Auth/profile commands; server owns summary | 16 KiB |
| `users/{uid}/state/progression` | `schemaVersion`, `revision`, progression `stats`, `Parametri`, and `AltriParametri` | Progression command and derived-state owner | 64 KiB |
| `users/{uid}/state/resources` | `schemaVersion`, `revision`, resource `stats`, and `active_turn_effect` | Resource, consumable, combat, and Grigliata commands | 64 KiB |
| `users/{uid}/state/settings` | `schemaVersion`, `revision`, `settings` (owner preferences and DM locks), and `grigliata` preferences | Settings command with field-level authorization | 64 KiB |
| `users/{uid}/state/equipment` | `schemaVersion`, `revision`, `slots: {slot: inventoryId|null}`, and `beltCapacity` | Equipment command | 64 KiB |
| `users/{uid}/state/profileContent` | `schemaVersion`, `revision`, `lingue`, `conoscenze`, `professioni` | Profile-content command | 64 KiB |
| `users/{uid}/inventory/{inventoryId}` | One acquired instance or explicit Varie stack | Inventory/purchase/equipment/consumable commands | 256 KiB |
| `users/{uid}/spells/{contentId}` | Stable-ID personal spell with `displayName`, `normalizedName`, revision, and payload | Personal-content command | 256 KiB |
| `users/{uid}/tecniche/{contentId}` | Stable-ID personal technique with the same ordering contract | Personal-content command | 256 KiB |
| `users/{uid}/content_names/{nameHash}` | Exact-name reservation containing kind, content ID, and exact name | Server only | 16 KiB |
| `user_operations/{receiptId}` | Operation/request hash, state/result, actor/target, and 30-day expiry | Server only | 64 KiB |
| `app_config/user_data_v2` | Global stage, optional per-user canary overrides, bounded active `legacyDrain` fences, and the completion lock | Admin deployment/cutover operator; reads are restricted to DM and webmaster | 16 KiB |
| `migration_state/user-data-v2/...` | Run metadata, checkpoints, subject verification, archives, and rollback reports | Offline Admin tool only | Per normal document limit |

Budgets are measured with canonical serialized values. A write warns at 80% and
is rejected at the limit; no value is truncated. Persistent Firestore cache
remains disabled.

### Field partition

- Resource `stats`: `gold`, HP, mana, essenza, shield/barrier current and total
  fields. `active_turn_effect` stays with resources because barrier/resource
  mutations must remain atomic.
- Progression `stats`: level, point/token pools, negative-stat count, and any
  legacy stat not classified as a resource. Unknown legacy stats are preserved,
  not silently discarded.
- `settings` preserves existing preference/lock names. `grigliata` groups draw
  color, live-interaction sharing, mute, and hidden board/token preferences that
  were legacy root fields.
- Root fields outside the declared shell are archived but are not copied into
  the compact shell without an explicit contract amendment.

### Inventory document

An inventory document contains:

- `schemaVersion`, document `revision`, `kind`, and positive integer `quantity`;
- `catalogItemId` and nullable `catalogVersion`;
- immutable `acquisitionSnapshot` and `acquisitionHash`;
- revisioned `currentSnapshot`, `currentHash`, and `currentRevision` for explicit
  DM edits without rewriting history;
- `displayName`/`normalizedName`, `acquiredAt`, `pricePaid`, and `source`;
- migration-only legacy index/occurrence/unit metadata and owned-media paths.

ID precedence is a valid `_instance.instanceId`, then a deterministic ID from
the canonical acquisition snapshot fingerprint, duplicate occurrence, and unit
ordinal. Collisions receive a deterministic suffix. Equipment backfill matches
instance ID first, then catalog ID plus snapshot hash and stable ordinal. An
unmatched equipped value becomes a marked preservation inventory instance.

The migration preserves existing `Parametri.*.Equip` values and reports drift.
The next explicit equipment operation recomputes all equipment contributions
from occupied slots using shared pure derivation logic.

### Personal content

Personal content uses stable document IDs so rename does not change identity.
Queries order by `normalizedName`, then document ID, with 50-document cursor
pages. Exact-name uniqueness retains legacy case-sensitive behavior: the
reservation ID is SHA-256 of `kind + NUL + exact trimmed name`. Rename creates
the new reservation, updates the content, and removes the old reservation in one
transaction.

Before a fenced backfill, an approved pre-drain `stabilize` pass stamps any
missing spell/technique IDs into the legacy projection using the same canonical
identity algorithm as the offline transformer and bridge. It may execute only
for an exact global or user scope whose effective stage is `shadow-verify`, and
each write rechecks the scope fingerprint, source version, and frozen legacy
projection hash. Drain backfill/verification fails closed if any personal
content identity is still missing or invalid.

Bridge identity reuse is fail-closed. Existing object entries bind by exact
legacy key even when insertion, deletion, or reordering changes their index; an
unchanged-size single unmatched object key may reuse the sole unmatched ID as a
structural rename. Multiple unmatched pairs are ambiguous. Once migrated array
candidates exist, every array entry must carry an explicit stamped ID because
positional edits, reorders, and insert/delete shifts cannot prove identity.

Inventory remains a complete subscription in Task 05 so the existing search and
counts cannot silently omit records. Task 08 owns bounded inventory rendering.

## Repository and rollout behavior

Components consume domain hooks and never choose the read/write source. Mutation
controls may check only whether stage resolution is complete so an unknown or
null stage disables writes with a retryable result; they must not branch into a
legacy fallback. One shared legacy root subscription derives requested domains
during compatibility; V2 stages subscribe to the corresponding fixed document
or collection. Structural sharing preserves unrelated object identities. Auth
context retains session and shell only; complex consumers compose an explicit
compatibility view.

Compatibility intentionally permits at most two root listeners for one Auth UID:
one dedicated, session-resilient Auth profile listener and one ref-counted,
actor-scoped aggregate listener shared by ordinary domains. A role/access change
increments the repository access generation, closes the actor-scoped listener,
masks data from the previous scope immediately, and reattaches its consumers.
The dedicated Auth listener survives that reset so it cannot cancel itself while
publishing the new actor role.

`app_config/user_data_v2` supports these stages:

| Stage | Reads | Server command writes | Exit condition |
|---|---|---|---|
| `legacy-read` | Legacy root | Legacy projection; V2 code remains dark | Additive code/rules/indexes/Functions healthy |
| `shadow-verify` | Legacy root | Legacy plus server reconciliation to V2 | Backfill complete; zero mismatch in two passes 24h apart |
| `dual-write` | Legacy root | V2 plus required legacy projection | Canary concurrency and mismatch metrics clean |
| `new-read-dual-write` | V2 | V2 plus legacy projection | Seven-day rollback soak and zero legacy-only mutations; enter scoped drain |
| `new-only` | V2 | V2 only | Frozen drain sweep/verification complete; archive and reverse materialization verified; explicit approval |

The checked-in default and a missing remote config both resolve to
`legacy-read`. Remote mode is opt-in. Firestore permits direct rollout-config
reads only to DM and webmaster identities and denies all client writes. Player
activation is therefore hard-blocked until a privacy-preserving server-owned
effective-stage resolver exists; a player must not be granted the raw global or
per-user canary configuration. Once remote mode is enabled for an authorized
identity, a config read failure is surfaced as retryable data failure; it must
not silently switch that user between sources.

Direct client creation of `users/{uid}` is denied for a drained or `new-only`
scope. Global activation therefore remains blocked until Login and Character
Creation use a server-owned V2-first initializer that creates the shell and
required domain documents as one reviewed workflow.

### Cutover runbook

Cutover uses a pre-drain identity phase followed by a two-phase, server-owned
drain fence inside the same config document; timestamp processing is never
permitted in `new-only`:

0. In an exact `shadow-verify` scope, run approved/resumable `stabilize` and
   additive backfill plans under the pre-drain scope fingerprint. Stabilization
   persists canonical personal-content IDs into the legacy source before the
   bridge or later edits can derive a different identity. Any rollout-stage,
   scope-membership, source-version, or frozen-input change invalidates the plan.

1. Keep the effective rollout stage in an active bridge mode and atomically add
   an immutable drain record. A global-scope record is stored at
   `legacyDrain.global`; a user-scope record is stored at
   `legacyDrain.users.{uid}` while that user has an explicit valid override.
   Each record is `{ drainId, closedAt }`, where `drainId` is a unique 8-100
   character URL-safe identifier and `closedAt` is a Firestore server
   timestamp. Global fences apply only to users inheriting the global mode;
   explicit overrides have independent user fences, so successive canary
   cutovers cannot widen one another's cutoff.
2. While that record is present, rules reject migrated legacy-root mutations
   and every authoritative V2 callable fails retryably before work. The bridge
   accepts only source events whose original root update time is at or before
   the scoped cutoff. Every bridge write transaction re-reads the config and is
   bound to the original `drainId` and cutoff; changing or removing the record
   aborts in-flight work. Malformed drain records fail closed.
3. Run the migration backfill as the frozen-state sweep, then the read-only
   verification passes. The approved sweep retains its exact root
   source-version fence for every write and binds its attestation to the exact
   drain plus the frozen legacy-projection input hash. The whole root update
   time is not compared with `closedAt`: permitted shell-only updates and
   bridge identity persistence can legitimately advance it. Only the original
   legacy trigger event time is cutoff-qualified. A scoped sweep or
   verification refuses `deletionState: pending` and every non-completed
   `user_deletion_jobs` record, including a job whose user root is already gone.
   Keep the exact drain record and atomically set only the matching global mode
   or user override to `new-only`. This creates a sealed `new-only` barrier:
   the bridge is hard-off, legacy-root writes remain frozen, and V2 callables
   remain frozen because the drain still exists.
4. In that sealed barrier, rerun the scope-bound authoritative sweep and final
   verification passes. An approved `complete` first installs a server-owned
   `userDataCompletionLock` and durable `finalizing` attestation while retaining
   the exact drain. The lock blocks migration writes; the retained drain already
   freezes legacy-root and V2 command mutations. The cutover tool then launches
   a fresh authoritative migration verification and requires its plan and
   subject fingerprints to equal the approved sealed evidence.
5. Only a matching fresh verification may atomically remove both the exact
   completion lock and reviewed drain and mark the attestation complete. A
   failed, changed, or stale verification leaves the sealed drain and lock in
   place for exact resume or explicit reviewed abort; it never opens V2 by
   falling back to old evidence. Removing the drain opens V2 callables while
   legacy writes and the bridge remain disabled by `new-only`. The config write
   conflicts with any transaction that read the old fence, so bridge work must
   commit before the barrier or retry and abort; it cannot overlap the opened
   V2 mutation window. A drain record is write-once while active; changing its
   ID or cutoff requires abandoning that drain and starting a new reviewed
   cycle.

## Authoritative mutations

All new mutations use `europe-west8` callable commands. Every request carries an
operation ID matching the public pattern and a canonical request hash. A replay
with the same hash returns the receipt result; reuse with different input is
rejected. Receipts expire after 30 days.

- Purchase accepts catalog item ID only. The server reads current catalog
  visibility/version/price, verifies access/funds, creates one inventory
  document, and updates gold transactionally. Client snapshots and prices are
  untrusted.
- Resource, gold, progression, inventory, equipment, settings, profile content,
  and personal-content commands validate actor/target permission and permitted
  fields before a transaction.
- Consumables use prepare/commit. Prepare records the authoritative roll without
  mutation; commit re-reads resources, inventory, and equipment, then atomically
  applies capped results and decrements/removes the item.
- Metadata commits precede idempotent owned-media cleanup. Shared catalog media
  is never deleted by user cleanup.
- Existing Grigliata operations that combine board and user resource documents
  move behind an authoritative command without changing the board schema.
- React never dual-writes. The server command owns V2 plus any compatibility
  projection; legacy-trigger reconciliation re-reads latest state and ignores
  stale/out-of-order events by revision/hash.

See the [mutation matrix](./access-and-mutation-matrix.md#mutation-matrix) for
transaction boundaries and compatibility projections.

## Migration, archive, and rollback

`frontend/scripts/task05/user-data-migration.js` is default-dry-run and imports
Admin SDK only after argument and target checks. It deterministically pages root
users, canonicalizes Firestore values, calculates per-subject hashes/counts and
document budgets, and emits a redacted report conforming to
`user-data-migration-report.schema.json`.

Ordinary emulator planning retains the existing all-user behavior. A frozen
sweep is explicit: `--drain-scope global --drain-id <id>` selects only users
inheriting the global stage, while `--drain-scope user --drain-user <uid>
--drain-id <id>` selects exactly one valid override. The tool loads the
server-owned config and requires the exact installed record. Reports bind the
scope membership fingerprint, exact drain/cutoff, frozen legacy-projection
hashes, and a UID-redacted active-deletion-job fingerprint. The user-scope UID
is represented only by its subject hash.

Execution requires all of the following:

1. explicit project ID and environment-project match;
2. loopback emulator plus `demo-*`, or explicit live acknowledgement and exact
   repeated live project ID; live backfill execution additionally requires an
   exact installed drain fence or exact `shadow-verify` pre-drain fence, live
   stabilization requires the latter, and unfenced execution is emulator-only;
3. a complete, error-free dry-run report for the same project/operation/model;
4. exact `--approve-fingerprint` equality with the current re-planned data;
5. a new checkpoint, or `--resume` with an exact compatible checkpoint.

Writes are deterministic and restartable. Pre-drain stabilization and backfill
re-read their exact `shadow-verify` scope, source, and frozen inputs. For a drain
sweep, every V2 write chunk and the shell merge transaction re-read config,
source, and the canonical deletion job; a changed fence, scope, exact source
version, frozen input hash, pending deletion, or active deletion job aborts.
Staged subcollection writes are safe to overwrite on rerun. Reports and console
output contain hashes and counts, never profiles or a user-scope UID.

Backfill never deletes legacy fields. Archive planning/emulator execution is
allowed only when the subject's V2 projection hash verifies, and existing
immutable archive documents must match exactly. Reverse materialization
reconstructs current legacy domains from V2 and merges them into the root in
approved emulator evidence. Live archive and reverse execution remain hard-
blocked until an exact compatible pause fence is implemented and reviewed.
Before `new-only`, rollback is a stage switch; any future rollback after
compaction must pause mutations, reverse-materialize, verify, and only then
switch.

## Backup and deletion contract

The backend V2 backup recursively enumerates every root collection, document,
and descendant subcollection. Each Firestore value is unambiguously typed; each
document and the canonical manifest is SHA-256 verified. The CLI prints only
counts/hashes/path to the ignored local file. Restore is non-destructive (no
deletion of extra target documents), defaults to a redacted dry run, and requires
the exact approved plan fingerprint before writes. Live restore dry runs retain
the explicit project double-confirmation, but live restore execution is hard-
blocked until a compatible mutation-pause fence exists. Restore planning also
refuses changes to rollout, migration, deletion, cleanup, and operation-control
documents; identical protected documents may be reported as unchanged.

User deletion is an idempotent server state machine. Fresh webmaster
authorization, rollout/drain validation, the durable job tombstone, and the
root pending marker share one transaction. Rules consult that state to block
root recreation and owner writes across Firestore and Storage. The worker then
disables sign-in, revokes refresh tokens, performs and verifies media plus
recursive Firestore cleanup, deletes the Auth record, and repeats both cleanup
and verification sweeps before marking the job complete. Unauthorized callers
cannot create failed jobs; a failed-state write is allowed only after the
authorized pending job exists. A partial failure resumes from its recorded
state.

## Rejected alternatives

- Keeping the aggregate and memoizing React does not reduce Firestore payload or
  contention.
- Client dual-write cannot guarantee authority, ordering, or old-client safety.
- Catalog-only inventory pointers destroy acquired history.
- Destructive in-place migration prevents rollback.
- A generic resource clamp changes established gameplay semantics.
- Route-time migration would mutate live Grigliata state during ordinary use.
