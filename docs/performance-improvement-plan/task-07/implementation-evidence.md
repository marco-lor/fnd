# Task 07 implementation evidence

Evidence date: 2026-07-27

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

## Validation completed on the final worktree

All commands were run one process at a time with bounded Node heaps.

| Gate | Result |
| --- | --- |
| Functions lint | PASS: 0 errors; 4 non-blocking style warnings |
| Functions TypeScript build | PASS |
| Focused Functions lifecycle/processor/adapter/control tests | PASS: 45/45 |
| Task 07 Node harness, fixture, boundary, soak-contract, and migration tests | PASS: 37/37 |
| Focused frontend repository/writer/avatar tests | PASS: 4 suites, 35/35 |
| Firestore import boundary | PASS |
| Callable registry boundary | PASS: 37 callables across 3 regions |
| Query-contract boundary | PASS: 58 listeners, 10 repository shapes, 7 indexes |
| Shared-config boundary | PASS |
| User-data boundary | PASS: no new direct user access |
| Media boundary | PASS: policy parity and reviewed adapters only |
| Final changed-module syntax parse | PASS |

The full frontend suite, production build/start smoke, emulator rules and
callable integration, and browser cases passed on an earlier candidate. They
are not counted as final evidence because the implementation changed afterward.

## Remaining Task 07 implementation gap

The remaining material product-code gap is V1-only copy/spawn ownership for
foes and tokens. Current duplication deliberately strips canonical Task 07
metadata so a copy cannot point at another owner's private derivative family;
legacy media continues to render. Full completion requires an operation-owned
canonical copy or explicit reference-ledger acquisition for the new entity,
with idempotent resume and partial-Storage-failure tests.

Production migration remains intentionally unavailable. The checked-in
executor is restricted to the exact demo emulator; a production rollout still
needs reviewed backup, write approval, reconciliation, restore, and retention
controls.

## Remaining Task 07 validation

- Run the full frontend and Functions suites from the clean merged revision.
- Run exact `demo-fnd-perf` Firestore, Storage, Auth, and Functions integration,
  including the final immutable-field rules case.
- Run the production build and normal `npm start`/`/home` smoke on an owned
  port.
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
