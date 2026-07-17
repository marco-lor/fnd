# Task 11 - DM Dashboard and Admin

Depends on Tasks 04-07.

## Outcome

Make administrative pages load compact paged summaries, fetch heavy detail/editors on demand, and execute bulk work through scalable authoritative operations.

## Evidence

- `DMDashboard.js:40-66` subscribes to all full user aggregates and restarts based on the broad auth object.
- `playerInfo.js:93-101` refetches all users after many mutations despite the live listener.
- Item catalog and many editors load before expansion/intent (`playerInfo.js:10-39,103-122`).
- Admin downloads full user documents for a small table (`adminPage.js:44-100`).
- Lock-all and level-up bulk paths have fixed batch ceilings.

## Implementation elements

1. Define security-reviewed player/admin summary projections with only card/table fields, stable ordering, page cursors, and search.
2. Load selected/expanded user detail separately. Subscribe only while visible and return to zero detail listeners on collapse.
3. Depend on stable UID/role, not full auth profile identity.
4. Remove `refreshUserData` full collection reads. Let shared subscriptions reconcile successful writes.
5. Use atomic increment/transactions for gold and other concurrent counters.
6. Load item catalog and editor chunks on first relevant expansion/open; cache/search through summaries rather than full catalog download.
7. Use a `Set` and identity-preserving reconciliation for selected users.
8. Keep dice-roll listeners on demand; document and test a simultaneous expansion/listener budget.
9. Route lock-all, level-up-all, and destructive operations through Task 06 operation IDs/progress/idempotency.
10. Memoize callable construction through the centralized region registry.

## Boundaries and non-goals

- Do not weaken DM/webmaster authorization or make admin summaries generally readable.
- Preserve level-up, gold, locks, selected-user, and audit rules.
- Do not optimistically hide failed administrative changes.

## Tests

- Summary pagination/search/order/authorization and detail subscribe/unsubscribe.
- One overlay save performs no full-users read; one gold change performs one atomic write without surrounding reads.
- Collapsed dashboard has zero dice/detail listeners; expanding N users stays within the stated budget and collapse cleans up.
- Bulk operation progress, retry, duplicate request, partial failure, and >500-write fixture.
- Admin role/delete pending, double-submit, error recovery, and large table behavior.

## Acceptance gates

- Initial DM/Admin reads are bounded and transfer compact summaries only.
- A mutation rerenders/reloads only the relevant user row/detail.
- Heavy editor/catalog code and data are not loaded for a collapsed dashboard.
- Bulk actions succeed beyond previous fixed batch ceilings.
