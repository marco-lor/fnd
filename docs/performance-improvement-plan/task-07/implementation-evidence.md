# Task 07 implementation evidence

Evidence date: 2026-07-29

Integration target: `devs`

Verdict: the fundamental Task 07 media and global-shell implementation is in
place and remains default-off for production. The code is approximately 90-95%
implemented. Local validation is approximately 60% complete because the final
heavy emulator, full-regression, browser, soak, and repeatability gates have
not been rerun after the last implementation changes.

## Implemented

- Versioned private media policy and canonical contracts for avatars, catalog
  and user items, NPCs, foes, personal art/video, tokens, backgrounds, and map
  video.
- Authenticated prepare, status, attach, abandon, retire, and cleanup-retry
  callables with deterministic operation ownership and durable receipts.
- Authoritative Functions processing: source validation, `sharp` image
  derivatives, `ffmpeg` video poster generation, immutable output metadata,
  bounded child-process runtime, and fail-closed terminal states.
- Transactional target adapters, revision checks, strict owner/role checks,
  reference revalidation, bounded cleanup retries, dead-letter handling,
  recovery authorization, and a starvation-safe orphan sweeper.
- Firestore and Storage rules that keep canonical media fields server-owned
  while allowing ordinary target edits to preserve them.
- Task 07 writers for profile/Character Creation, private inventory, personal
  techniques/spells, catalog items, NPCs, foes, tokens, and backgrounds. The
  writers preserve the old attachment until the new one is durably attached
  and roll back prepared targets when receipt acquisition fails.
- Operation-owned foe duplication for canonical images. V2 validates the
  attached source manifest, creates a distinct five-object private family,
  resumes partial copies by deterministic receipt, rewrites private ownership
  metadata, and atomically creates the foe and attaches the ready manifest.
  Current clients route canonical or malformed Task 07 state through V2; the
  compatibility callable rejects canonical state instead of losing it.
- Shared canonical/legacy readers, authenticated blob URLs, bounded registry
  leases, full-quality active-board/crossfade pinning, and list-safe variants.
- A bounded aurora runtime and one compact authenticated-shell music stream
  with stopped/muted source release.
- Staged Task 07 controls, desktop/compact budgets, deterministic 50-map and
  200-token fixtures, serial integration ownership, cross-browser/soak scripts,
  and a resumable demo-only migration executor with verification and rollback
  receipts.
- Static confinement of direct Storage access, object URLs, canonical paths,
  callable acquisition, shared config, and user-data access.

## Validation completed on the current worktree

All commands were run one process at a time with bounded Node heaps.

| Gate | Result |
| --- | --- |
| Functions lint | PASS: 0 errors; 4 non-blocking style warnings |
| Full Functions build and unit suite | PASS: 138/138 |
| Canonical clone planner/copier/attachment tests | PASS: 15/15 in the focused run; also green in the full suite |
| Task 07 Node harness, fixture, boundary, soak-contract, and migration tests | PASS: 37/37 |
| Focused frontend foe lifecycle/routing tests | PASS: 4/4 |
| Touched frontend module lint | PASS |
| Media boundary | PASS: policy parity and reviewed adapters only |
| Normal production build | PASS with 2 pre-existing warnings in untouched media modules |
| CI-strict production build | NON-GREEN: the same 2 warnings are escalated to errors |
| Owned `npm start` `/home` smoke | PASS: HTTP 200 on port 3001; owned process cleaned |
| Broader Task 07 Jest batch | NON-GREEN: 348/357; 9 failures across 6 untouched media/Grigliata suites |
| Demo Auth/Firestore/Storage/Functions integration | BLOCKED: two bounded attempts stalled during Storage emulator startup, before the test runner launched; owned processes and ports were cleaned |

Previously reported full frontend, rules, callable, route, browser, soak, and
repeatability results are not counted as final evidence for this increment
unless listed above.

## Remaining Task 07 implementation gap

The V1 foe-duplication gap is closed for canonical images: a duplicate owns a
new manifest and immutable family, never the source foe's private family.
Malformed, detached, conflicting, or video-backed foe media fails closed.

The remaining material product-code gap is V1 token copy/spawn ownership. Full
completion still requires an operation-owned canonical copy or an explicitly
reviewed reference-ledger acquisition for the new token entity, with idempotent
resume and partial-Storage-failure tests.

Production migration remains intentionally unavailable. The checked-in
executor is restricted to the exact demo emulator; a production rollout still
needs reviewed backup, write approval, reconciliation, restore, and retention
controls.

## Remaining Task 07 validation

- Resolve or explicitly disposition the 9 broader Task 07 Jest failures and the
  2 CI-strict warnings, then run the full frontend suite from the clean merged
  revision. The full Functions suite is green on this worktree.
- Run exact `demo-fnd-perf` Firestore, Storage, Auth, and Functions integration,
  including the canonical foe clone and final immutable-field rules case, after
  fixing the Storage emulator startup stall.
- Run the route matrix and Chromium, Firefox, and WebKit media cases.
- Run the ten-minute 50-map/200-token lifecycle soak and confirm registry,
  object-URL, timer, audio, transfer, and decoded-byte plateaus.
- Run `perf:ci` and two compatible authoritative passes before accepting any
  performance comparison or baseline.
- Rehearse interrupted migration resume, verification, rollback, and cleanup
  against the final committed demo candidate.
- Review App Check, CORS, canary activation, rollback, and production migration
  evidence before any deployment or production flag change.

No deployment, production data change, online rule/index/config change, or
baseline acceptance is part of this implementation merge.
