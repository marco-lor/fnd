# Task 05 - User and inventory data-model migration

Depends on Task 04.

## Outcome

Separate high-frequency stats/profile state from growing inventory/content so a small mutation no longer transfers, serializes, rerenders, and triggers the entire character aggregate.

## Evidence

- Home opens five listeners to `users/{uid}`.
- Purchase deep-copies a Bazaar item into the embedded inventory and rewrites the array (`acquireItem.js:35-68`).
- Inventory/equipment/spells/techniques/settings/stats share the auth profile document.
- Server functions and rules use broad user-document triggers and field comparisons.

## Target contract

Finalize the model in an architecture decision before coding. A likely boundary is:

- Compact identity/role/profile shell.
- High-frequency resources/stats with a narrow authoritative write API.
- Inventory instance/stack subcollection with item version/reference and required acquisition snapshot.
- Separate equipment projection or deterministic derivation.
- Personal spells/techniques as paged subcollections where scale requires it.
- Minimal summary fields only where a page needs an efficient list.

## Implementation elements

1. Inventory every reader, writer, rule, trigger, callable, script, and backup path for affected fields.
2. Define document ownership, transaction boundaries, version fields, size budgets, and historical item semantics.
3. Implement versioned repository adapters supporting legacy read, new read, dual write, verification, and new-only modes.
4. Add resumable, idempotent backfill with dry-run counts, checkpoints, per-user verification hashes/counts, and rollback markers.
5. Update Firestore/Storage rules and indexes before enabling writes.
6. Make purchase authority read current catalog price/visibility server-side. Never trust the client-supplied item snapshot.
7. Update purchase, remove, equip/unequip, quantity, consume, DM edit, deletion, and character-deletion flows atomically.
8. Keep old clients safe during the compatibility window; stop legacy writes only after adoption and mismatch metrics pass.
9. Remove large fields from auth cache/context and from summary queries after cutover.

## Boundaries and non-goals

- Preserve acquired-item history, instance identity, stack behavior, price rules, equipment effects, and permissions.
- Do not delete legacy data during backfill or initial cutover.
- Do not duplicate mutable source-of-truth fields without a reconciliation owner.
- Do not combine Codex migration; it has its own task.

## Tests

- Migration dry run, rerun, interruption/resume, partial legacy data, and rollback.
- Concurrent purchase/use/remove/equip from two clients.
- Price/visibility tampering and unauthorized directory access.
- Old/new client interoperability through each rollout mode.
- 500-item user fixture: profile document size remains stable and a stat update transfers no inventory payload.
- Trigger/callable and backup/restore compatibility.

## Acceptance gates

- Purchase/removal changes O(1) inventory documents, not the whole user aggregate.
- Home uses one subscription per actual data domain with measured payload/read budgets.
- Verification reports zero unresolved count/value mismatches before new-only reads.
- Rollback can restore legacy-read mode without data loss.
