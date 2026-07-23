# Task 05 implementation evidence

Date: 2026-07-23. This file records repository-local evidence plus a read-only
browser smoke of `/home`. No Firebase deployment, administrative production
migration/backup read, backfill, archive, restore, rollout change, or live
Grigliata navigation was performed.

## Implemented and locally verified

- Versioned runtime boundary:
  - fixed-document subscriptions for progression, resources, settings,
    equipment, and profile content;
  - collection subscriptions for inventory, spells, and techniques;
  - structural sharing, stale/error propagation, and legacy compatibility
    composition without silent source fallback;
  - an intentional ceiling of two root listeners per Auth UID: a dedicated
    session-resilient profile listener and one ref-counted actor-scoped aggregate;
  - access-generation invalidation closes/reopens actor-scoped domains on role
    changes while keeping Auth subscribed and masking prior-scope data;
  - raw rollout config reads are DM/webmaster-only; player remote-stage
    activation remains blocked pending a privacy-preserving effective-stage
    resolver;
  - caller-owned logical-action retry keys, so transport retries reuse an
    operation ID without collapsing two intentional identical mutations.
- Server-owned mutation boundary:
  - regional callable commands and actor-scoped idempotency receipts;
  - atomic purchases, resources, progression, inventory/equipment, personal
    content, settings/profile content, and consumable prepare/commit;
  - scoped two-phase legacy drains freeze both old root mutations and V2
    commands, fence bridge work by immutable drain identity/cutoff, and disable
    the bridge completely in `new-only`.
  - target UIDs are accepted only as one bounded Firestore document ID;
  - level-up reads the requester's current DM role inside the same transaction
    as rollout, target, and mutation reads;
  - deletion authorizes and publishes its tombstone transactionally, blocks all
    owner write planes, and performs a verified post-Auth final cleanup sweep.

- Deterministic user-model transformer:
  - splits shell/progression/resources/settings/equipment/profile content;
  - preserves custom Varie stacks and expands non-Varie quantities;
  - preserves valid instance IDs and unmatched equipped objects;
  - creates stable personal-content documents and exact-name reservations;
  - preserves exact object-key identities and a sole structural rename, while
    refusing every implicit migrated-array reuse, including same-length reorder;
  - calculates canonical SHA-256 source/target hashes and size issues;
  - reverse-materializes current V2 state into a legacy-compatible aggregate.
- Migration orchestration:
  - default dry run with redacted subject hashes/counts;
  - strict ordering, stable plan fingerprint, source-version checks;
  - exact dry-run approval and resumable checkpoints;
  - an exact `shadow-verify` pre-drain `stabilize` pass that stamps canonical
    personal-content IDs before backfill, with scope/source/input rechecks;
  - exact global/user drain scope selection, immutable fence and scope
    fingerprints, frozen legacy-projection hashes, and sealed `new-only`
    verification;
  - final completion installs a durable completion lock, reruns fresh
    authoritative verification, and removes the lock plus drain only when fresh
    fingerprints still match; failure leaves both installed;
  - live backfill execution requires an exact drain or exact `shadow-verify`
    pre-drain fence; pending deletions and active deletion jobs block drain
    evidence without exposing target UIDs;
  - each drain write chunk and shell merge transaction rechecks config, source,
    frozen inputs, and the canonical deletion job;
  - backfill, read-only verify, immutable archive, and reverse operations;
  - loopback `demo-*` emulator default and explicit live-project double opt-in.
- Direct-access boundary:
  - root document/collection detection while allowing nested `diceRolls`;
  - schema-V2 fingerprints bind each recognized legacy expression to its
    Firestore operation, target, and mutation payload expressions/bindings;
  - CI rejects new/changed/stale recognized expressions or operation contexts;
  - this remains a lightweight lexical guard: transaction ordering,
    authorization semantics, and indirect helper behavior still require
    behavior tests and review.
- Backend maintenance:
  - recursive root/subcollection traversal;
  - typed null/boolean/integer/double/string/bytes/timestamp/reference/geopoint,
    array, and map encoding;
  - per-document and canonical manifest hashes;
  - non-destructive restore, redacted plan, exact approval, post-write verify;
  - protected control documents cannot be created or updated by restore;
  - live restore execution is blocked pending a compatible mutation pause,
    while live dry-run and loopback `demo-*` execution retain their safe gates;
  - no private document printing.

## Commands and results

Focused security/restore validation from the repository root:

```text
cd frontend/functions && npm test
49 tests passed (TypeScript build included)

cd frontend/functions && npm run lint
passed

python -m unittest -v backend.test_firestore_backup
11 tests passed

node --check frontend/performance/tests/firestore-rules.test.js
passed
```

The Firestore/Storage rules emulator suite includes deletion-tombstone and
manager-to-pending-target cases, but local execution remains blocked because
firebase-tools requires Java 21 and this machine provides Java 8.

Run from `frontend`:

```text
npm test -- --watch=false --runInBand --watchman=false --silent
87 suites / 818 tests passed

npm run perf:test
159 tests passed, including migration, cutover, boundary, and npm-start tests

npm run perf:check-user-data-boundaries
43 legacy files / 87 references / 155 operation associations locked, plus one
stage-gated adapter; no new direct access

npm run perf:check-query-contracts
56 listeners, 10 repository query shapes, 6 composite indexes verified

npm run build:production
compiled successfully with no lint warnings

npm run verify:start
npm start compiled; /home returned HTTP 200 on owned port 3001; cleanup passed
```

Run from `frontend/functions`:

```text
npm run lint
passed

npm test
TypeScript build and 49/49 tests passed
```

Run from the repository root:

```text
python -m unittest -v backend.test_firestore_backup
11 tests passed
```

Python compilation also passed for `backend/main.py`,
`backend/firestore_backup.py`, and `backend/test_firestore_backup.py`.

## Schemas and privacy

- `frontend/scripts/task05/user-data-migration-report.schema.json`
- `backend/firestore_backup_v2.schema.json`
- `backend/firestore_restore_report_v1.schema.json`

Migration and restore reports deliberately omit raw user IDs, document paths,
emails, names, and payloads. Execution checkpoints retain an opaque/raw cursor
locally because exact resume requires it; the checkpoint directory is ignored
and must not be published. Full backup files necessarily contain private data in
typed form and are written only under ignored local backup paths.

## Gates still requiring environment evidence

- Reduce the 43-file legacy aggregate baseline as each consumer moves to domain
  hooks/commands; it must be zero outside the adapter before `new-only`.
- Implement and authorize a privacy-preserving server-owned effective-stage
  resolver before enabling remote rollout for players; never expose raw canary
  overrides or drain state to them.
- Run the checked-in rules/index/callable matrix under Java 21. This machine has
  Java 8 (`1.8.0_411`), so Firebase Emulator Suite execution was not treated as
  local evidence. Java 21 emulator validation remains an activation gate for
  this candidate.
- Run the checked-in authoritative 500-item fixture to prove a resource update
  transfers zero inventory documents and inventory mutation remains O(1).
- Exercise backfill/verify/archive/reverse against the demo emulator, including
  interruption, source mutation, wrong fingerprint, and rerun scenarios.
- Keep live archive/reverse execution disabled until a compatible pause fence is
  implemented, reviewed, and validated; the checked-in tool intentionally
  refuses those live execute modes.
- Keep live restore execution disabled until the same class of compatible pause
  fence is implemented and reviewed; only redacted live dry-run planning is
  available with explicit project confirmation.
- Exercise recursive backup/restore round-trip against the demo emulator.
- Complete the scoped frozen-drain sweep and two zero-mismatch verification
  passes at least 24 hours apart before any `new-only` transition.
- After the ongoing battle only, obtain separate approval for any production
  deployment, live dry run, backfill, stage change, archive, or compaction.

## Explicit non-evidence

Checked-in rules, indexes, Functions, scripts, and docs do not prove deployment.
A passing offline transformer does not prove live data compatibility. A tracked
legacy direct-access baseline locks recognized operations and payload context,
but is not acceptance of residual aggregate access or proof of transaction and
authorization semantics. A DM/webmaster config rule does not provide player
rollout resolution; that activation path remains intentionally absent.
