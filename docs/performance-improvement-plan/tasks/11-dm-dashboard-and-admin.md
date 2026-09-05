# Task 11 - DM Dashboard and Admin

Depends on Tasks 04-07.

## Outcome

Make administrative pages load compact paged summaries, fetch heavy detail/editors on demand, and execute bulk work through scalable authoritative operations.

## Evidence

- `DMDashboard.js` already uses `useManagerUserData`. `frontend/src/data/userData/managerUserData.js` pages 10 users but subscribes eight domains per listed user, including inventory, spells and techniques.
- `frontend/src/components/dmDashboard/elements/playerInfo.js` has a no-op `refreshUserData`; do not implement removal of a nonexistent reload.
- `playerInfo.js` already uses `lazyPlayerInfoOverlays` and `lazyBazaarEditors`; preserve lazy code boundaries and measure residual catalog data loading separately.
- `frontend/src/components/admin/adminPage.js` already uses `getAdminUsersPage` and `getCallable`; verify payload fields, paging and remaining operation costs independently.
- Reuse Task 06 bulk-operation infrastructure; establish current lock/level-up limits and failure behavior before proposing any additional scaling work.

## Implementation elements

1. Define security-reviewed player/admin summary projections with only card/table fields, stable ordering, page cursors, and search.
2. Load selected/expanded user detail separately. Subscribe only while visible and return to zero detail listeners on collapse.
3. Depend on stable UID/role, not full auth profile identity.
4. Preserve shared reconciliation and the no-op refresh behavior. Reuse existing directory and Task 06 operation infrastructure; verify remaining Admin paths independently from Dashboard.
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
- One overlay save performs no full-users read; one gold change performs no full-users reload. Count required transaction/authorization reads separately from avoidable UI reads; preserve authoritative concurrency checks.
- Collapsed dashboard has zero dice/detail listeners; expanding N users stays within the stated budget and collapse cleans up.
- Bulk operation progress, retry, duplicate request, partial failure, and >500-write fixture.
- Admin role/delete pending, double-submit, error recovery, and large table behavior.

## Acceptance gates

- Initial DM/Admin reads are bounded and transfer compact summaries only.
- A mutation rerenders/reloads only the relevant user row/detail.
- Heavy editor/catalog code and data are not loaded for a collapsed dashboard.
- Preserve the established capacity, progress and retry behavior of current operations; improve limits only where a fresh large-fixture test demonstrates a remaining ceiling.

## Release units and measurement contract

11A: Dashboard summary/detail ownership. 11B: separate Admin source/operation audit and targeted fix. Bulk-operation changes are separate releases using existing infrastructure.

200 users; page size 10 with 0, 1 and 3 expanded rows. Record listeners per domain and transferred bytes. Collapsed rows must own zero inventory/spell/technique detail listeners; required summary/resource feeds are counted explicitly.

Follow the [roadmap release/evidence rules](../README.md#rules-for-every-task) for each unit. Source observations identify work to verify, not fresh timing or deployed status. Record current measured values and numeric targets separately before implementation; use existing budget keys where available.
