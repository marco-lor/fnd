# Task 07 architecture decision

Date: 2026-07-31

Status: inactive deployment candidate; non-legacy production activation gated

## Context

Task 07 reduces the cost and lifetime of application media and the global shell
without changing the existing routes or weakening access control. The original
plan requires a versioned private-media pipeline, bounded rendering and cache
lifecycles, a low-node aurora, compact music ownership, migration tooling, and
blocking performance evidence.

The implementation was developed and validated in an isolated worktree before
integration into `devs`. It has not been deployed or enabled against an online
Firebase project.

## Decision

### 1. Use versioned canonical media records

Canonical media uses schema and contract version 1. The entity stores a
privacy-minimized descriptor containing the media identity, state, source, and
approved variants. It does not store a bearer download URL.

Storage objects use immutable paths:

```text
media_uploads/<ownerUid>/<assetId>/source
media_assets/v1/<audience>/<ownerKey>/<assetId>/<sourceGeneration>/original
media_assets/v1/<audience>/<ownerKey>/<assetId>/<sourceGeneration>/<variant>
```

Supported kinds are `avatar`, `item`, `npc`, `foe`, `map`, and `map-video`.
Item media also carries the explicit scope `global-catalog` or
`user-inventory`. Asset IDs are deterministic operation receipts of the form
`m_<40 lowercase hex characters>`.

The source and every derivative are bound to the same asset, actor, owner,
entity, kind, and contract version. A replacement receives a new asset ID and
new object paths; an existing generation is never overwritten.

### 2. Keep lifecycle authority in authenticated callables and Functions

Clients cannot read or write `media_assets` or `media_asset_cleanup` directly.
The callable lifecycle is:

1. `task07PrepareMediaUpload` authenticates the actor, validates the role,
   owner, entity, reference scope, operation ID, source type, and optional
   previous asset, then creates an idempotent prepared manifest.
2. The browser uploads only the source bytes to the single planned staging path
   with exact custom metadata.
3. `task07ProcessMediaUpload` validates the source generation and bytes, then
   uses pinned `sharp`/`ffmpeg` processing to create the complete immutable
   original/derivative family. Partial families never become ready.
4. `task07GetMediaStatus` exposes bounded progress. Once ready,
   `task07AttachMediaAsset` transactionally revalidates the target, attaches
   the exact descriptor, advances its revision, and supersedes the prior asset.
5. `task07ConfirmMediaReference` remains as a compatibility alias for the same
   authoritative attach transaction; the browser no longer commits canonical
   fields directly.
6. `task07AbandonMediaAsset`, `task07RetireMediaAsset`, and
   `task07RetryMediaCleanup` provide explicit cancellation, retirement, and
   retry paths. Trigger and scheduled cleanup handlers validate each manifest
   and queue record again before deleting canonical objects.

The client never abandons a new asset after an entity commit may have occurred.
An ambiguous commit or failed confirmation is surfaced for reconciliation
instead of risking deletion of referenced content.

### 3. Preserve private access and immutable object semantics

Authenticated reads use Firebase Storage `getBlob`, validate the canonical
path, generation, declared bytes, dimensions, and content type, and render a
short-lived object URL. The shared cache revokes the object URL when its final
lease is released or the record is evicted.

Storage rules permit creation only when a matching server-owned manifest is in
`prepared` or `failed`, the caller is the manifest actor, the path and planned
variant match exactly, the payload is within its kind/role byte limit, and the
custom metadata map is exact. Client update and delete are always denied.
Direct manifest and cleanup-ledger access is always denied.

Audience rules remain purpose-specific. In particular, foes remain DM-only and
private inventory media remains visible only to its owner or a DM/webmaster.
The complete matrix is recorded in `media-access-matrix.md`.

### 4. Centralize rendering and legacy fallback

`MediaImage` and `MediaVideo` select an approved canonical variant by purpose,
fall through explicit canonical candidates, and retain legacy URL/path fallback
for records not yet migrated. List and navigation consumers request thumbnails
or cards; the active board requests its full-quality board/source candidate.

`MediaImage` uses intrinsic dimensions, native lazy loading, asynchronous image
decoding, an IntersectionObserver margin, and reversible attachment. A far-
offscreen image releases its private lease and removes the network-bearing
source; re-entry reacquires the source. Active board/crossfade sources can hold
protected leases so ordinary cache pressure cannot evict them mid-transition.

### 5. Bound private media resources

The shared private-media registry has explicit local caps:

| Resource | Candidate cap |
| --- | ---: |
| Active authenticated fetches | 4 |
| Cached encoded bytes | 32 MiB |
| Estimated decoded bytes | 96 MiB |
| Registry records | 128 |
| Delayed releases | 256 |
| Crossfade/release protection | 2 seconds maximum |
| Fetch failure backoff | 1 to 30 seconds |

Records are keyed by canonical path and immutable generation, not by a public
URL. Pending work is concurrency-limited; duplicate consumers share a record;
unpinned least-recently-used records are evicted; aborts and failures release
owned resources. Video accepts only canonical MP4. Image descriptors accept
only the declared image MIME types and exact canonical extensions/variants.

These implementation-local limits do not replace the original plan's required
Task 01 blocking budgets. That integration is an open acceptance gate.

### 6. Reduce global shell work

The aurora uses two CSS box-shadow star fields rather than hundreds of star DOM
nodes. Shooting-star timers are owned and cleared, interactive/control clicks
are filtered, animation pauses for reduced motion and hidden documents, and no
shooting stars are created while paused.

The global Grigliata music player bounds active session results to four and owns
at most one `<audio>` element. The element uses `preload="none"`; stopped,
empty, or locally muted state clears the source so it cannot continue fetching
bytes. Playback continuity derives from the authoritative session offset.

Functions project the playback/control/session documents into one bounded
`grigliata_music_stream/current` document. The global player subscribes only to
that compact authenticated-shell stream.

### 7. Default the new write path off

The client and Functions resolve Task 07 mode from the versioned Firestore
control document `utils/task07_media`. Missing, malformed, and explicit
`legacy` control all fail closed to existing legacy upload behavior. The former
`REACT_APP_TASK07_MEDIA_PIPELINE` build flag is a compatibility no-op and
cannot activate the pipeline.

The control supports `legacy`, `shadow`, `derivative-read`, and `v1-write`
with purpose, role, and UID allowlists. All three allowlists must match an actor
before a non-legacy mode applies. Exact `demo-fnd-perf` fixtures seed reviewed
control values for emulator-only evidence.

### 8. Keep migration emulator-only

`task07:media-backfill:plan` accepts only project `demo-fnd-perf`, requires a
loopback Firestore emulator, skips already canonical records, and reports
unsupported inputs as explicit legacy fallbacks. Its gated executor is serial,
uses durable receipts/checkpoints, verifies each write before advancing, and
supports resume, verification, and rollback plans only in the exact demo
environment.

A resumable production backfill with receipts, backups, restore, rate limits,
and rollback is outside this candidate.

## Processing boundary

Server-side `sharp`/`ffmpeg` generation is authoritative. Browser code cannot
provide derivative bytes or canonical descriptors. The processor reads the
generation-pinned staged source, enforces policy and runtime limits, generates
the approved family, verifies every output, and only then publishes a ready
manifest.

## Failure and rollback invariants

- Legacy source fields and originals remain available during rollout.
- Unknown, missing, malformed, unauthorized, or incomplete canonical metadata
  fails closed and does not create a public download URL.
- A failed pre-commit upload is abandoned and queued; an ambiguous post-commit
  result is reconciled rather than deleted.
- Old media is queued only after the replacement reference is confirmed.
- Cleanup deletes only paths derived from and revalidated against the exact
  manifest; it cannot delete an arbitrary bucket prefix.
- Disabling the write flag does not delete canonical objects or manifests.
- Rollback never requires mounting, refreshing, or manipulating a live battle.
- Canonical foe duplication uses the Task 06 V2 receipt as its operation owner,
  copies generation-pinned objects into a distinct Task 07 family, and attaches
  that family in the same transaction that creates the new foe. The legacy
  callable rejects canonical state rather than silently falling back.

## Consequences

The local candidate now has a coherent versioned contract, private rendering,
bounded cache, lifecycle cleanup, low-node shell, and default-off consumer
integration. Existing records continue to render through legacy fallbacks, and
`npm start` retains its existing contract.

The compatibility-preserving code can be reviewed for an inactive deployment
while the control remains legacy. Non-legacy production activation is a
separate operation and remains gated by App Check, exact-origin CORS, canary
lifecycle evidence, duplicate/copy ownership, cleanup monitoring, and reviewed
production backup, reconciliation, migration, and rollback procedures.
