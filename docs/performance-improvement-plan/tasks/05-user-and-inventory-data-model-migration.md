# Task 05 - User and inventory data-model migration

Depends on Task 04. The implementation contract is now frozen in the
[Task 05 architecture decision](../task-05/architecture-decision.md). The
[access and mutation matrix](../task-05/access-and-mutation-matrix.md) is the
ownership inventory, and [implementation evidence](../task-05/implementation-evidence.md)
records the current validation state and remaining rollout gates.

## Outcome

Separate the compact user shell, high-frequency character state, growing
inventory, equipment references, and personal content. A resource mutation must
not transfer or rewrite inventory, while acquired-item history and all legacy
gameplay behavior remain recoverable.

## Implemented foundation

- Version-aware repositories and hooks expose profile, progression, resources,
  settings, equipment, inventory, profile content, spells, and techniques.
- Server-owned command boundaries and idempotency receipts cover purchase,
  resource/progression changes, inventory/equipment, personal content,
  settings/profile content, and consumable prepare/commit flows.
- `scripts/task05/user-data-migration.js` provides deterministic, default-dry-run
  backfill, verification, immutable archive, and reverse-materialization plans.
- Migration execution requires the exact completed dry-run fingerprint, writes
  resumable checkpoints, and fails closed against implicit live-project access.
- An exact `shadow-verify` pre-drain `stabilize` pass persists canonical legacy
  personal-content IDs before additive backfill; source, scope, and frozen-input
  changes invalidate the approved plan.
- Frozen sweeps explicitly name a global or exact-user drain scope and drain ID;
  live backfill execution is refused without that fence or an exact
  `shadow-verify` pre-drain fence. UID-redacted evidence binds scope membership,
  cutoff, frozen legacy inputs, and active deletion-job state, and every write
  transaction rechecks those conditions.
- Cutover completion retains the sealed drain while installing a durable
  completion lock, runs fresh authoritative verification, and removes both only
  when the fresh fingerprints match the approved sealed evidence.
- The backend exports every Firestore document and descendant subcollection in a
  typed, hash-verified V2 format and restores non-destructively only after an
  exact redacted dry-run report is approved.
- CI tracks recognized residual direct `users/{uid}` aggregate expressions and
  binds them to Firestore operation, target, and mutation payload context. This
  lexical guard does not alone prove transaction or authorization semantics, so
  review and behavior tests remain required.

## Hard boundaries

- Runtime defaults to `legacy-read`; the remote rollout document is opt-in.
- Raw rollout configuration is readable only by DM/webmaster identities and is
  never client-writable. Player activation is hard-blocked until a
  privacy-preserving server-owned effective-stage resolver is implemented.
- No deployment, production backfill, archive, reverse materialization, root
  compaction, or rollout-stage change is part of implementation validation.
- Live archive/reverse execute modes remain blocked until an exact compatible
  pause fence is implemented and reviewed.
- No migration deletes legacy fields. Root compaction is a separately approved
  `new-only` action after archives and reverse materialization verify.
- Live Grigliata is not mounted or mutated. Its user-data behavior is validated
  only through source/unit/emulator evidence after the current battle.
- Codex migration, inventory UI pagination, Task 06 trigger consolidation, and
  Grigliata board-schema work remain in their dedicated tasks.

## Completion gates

- The legacy-access baseline reaches zero outside the repository adapter before
  `new-only`; compatibility residuals are not accepted as final cleanup.
- The intentional Auth-UID root-listener ceiling remains two (dedicated Auth
  profile plus shared actor-scoped aggregate), and role changes prove ordinary
  domains close/reattach through a new access generation without canceling Auth.
- Two complete verification passes at least 24 hours apart report zero errors,
  semantic mismatches, orphaned equipment, or unsupported oversized documents.
- Purchase/removal touches O(1) inventory documents and a resource mutation
  transfers zero inventory documents in an authoritative 500-item fixture.
- Rules, indexes, Functions, frontend regression, recursive backup/restore,
  reverse materialization, normal production build, and alternate-port
  `npm start` smoke all pass from the same candidate revision.
- The rules/index/callable emulator matrix passes under Java 21. This workstation
  currently has Java 8, so Java 21 emulator evidence is still an activation gate.
- A privacy-preserving player effective-stage resolver is implemented and
  validated before any player canary or remote rollout activation.
- Any production action requires a separate approval after the ongoing battle.
