# Task 04 - Firestore access foundation

Depends on Task 03.

## Outcome

Create one observable, testable data-access layer for shared documents, bounded queries, indexes, and subscription lifecycle before page/schema migrations begin.

## Evidence

- Production code contains 58 `onSnapshot` call sites and 125 direct reads.
- `frontend/firestore.indexes.json` is empty despite compound and ordered query requirements.
- `utils/varie`, schemas, Codex data, user profiles, and collection directories are repeatedly fetched.
- Snapshot handlers frequently remap every document rather than applying `docChanges()`.

## Implementation elements

1. Introduce small repository modules by domain, not one global service. Expose typed query keys, subscribe/get APIs, and explicit cleanup.
2. Add shared in-flight promise caches for versioned/static configuration. Cache failures only with bounded backoff; support invalidation after admin edits.
3. Add subscription deduplication for identical targets and selector-friendly structurally shared results.
4. Define an initial page size, stable ordering, cursor contract, and realtime scope for every collection-backed page.
5. Use `snapshot.docChanges()` for high-churn entity collections so one changed document preserves other object identities.
6. Check in every required composite index and add emulator tests that execute the production query shapes under player/DM/webmaster rules.
7. Introduce minimal, security-reviewed directory/summary models instead of downloading full users solely for labels/selectors.
8. Evaluate Firestore persistent cache only through a separate experiment covering account switch, multi-tab, stale data, quota, and eviction. Enable it only if those gates pass.
9. Expose Task 01 counters by repository/query key so read and listener budgets are enforceable.

## Boundaries and non-goals

- Do not migrate inventory, Codex, or encounter schemas in this task.
- Do not hide correctness behind long TTLs; configuration invalidation must be explicit.
- Do not create broadly readable directories containing privileged user fields.
- Do not add query limits that silently omit currently visible records; add pagination/retention or postpone the limit until migration exists.

## Tests

- In-flight deduplication, invalidation, retry/backoff, unsubscribe/refcount, and account-switch isolation.
- Emulator authorization and index/query tests for every repository method.
- One-document change preserves unaffected entity identities and normalizes only one document.
- Pagination order/deduplication with equal timestamps and missing legacy timestamps.
- Route unmount returns active listeners to the shell baseline.

## Acceptance gates

- No page creates a direct shared-config read outside the repository allowlist.
- Checked-in indexes deploy cleanly and emulator query tests pass.
- Instrumentation can attribute all active listeners/reads to a stable query key.
- The subsequent schema/page tasks can adopt the layer incrementally without a flag day.
