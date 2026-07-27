# Task 07 architecture decision

Date: 2026-07-26

Status: implemented local candidate; default off; production activation blocked

## Context

Task 07 reduces the cost and lifetime of application media and the global shell
without changing the existing routes or weakening access control. The original
plan requires a versioned private-media pipeline, bounded rendering and cache
lifecycles, a low-node aurora, compact music ownership, migration tooling, and
blocking performance evidence.

The implementation is intentionally isolated from the user's watched checkout
and the active Grigliata battle. It has not been committed, staged, deployed, or
enabled against an online Firebase project.

## Decision

### 1. Use versioned canonical media records

Canonical media uses schema and contract version 1. The entity stores a
privacy-minimized descriptor containing the media identity, state, source, and
approved variants. It does not store a bearer download URL.

Storage objects use immutable paths:

```text
media/v1/<kind>/<ownerUid>/<assetId>/original/source.<ext>
media/v1/<kind>/<ownerUid>/<assetId>/derivatives/v1/<variant>.webp
```

Supported kinds are `avatar`, `item`, `npc`, `foe`, `map`, and `map-video`.
Item media also carries the explicit scope `global-catalog` or
`user-inventory`. Asset IDs are deterministic operation receipts of the form
`m_<40 lowercase hex characters>`.

The source and every derivative are bound to the same asset, actor, owner,
entity, kind, and contract version. A replacement receives a new asset ID and
new object paths; an existing generation is never overwritten.

### 2. Keep lifecycle authority in authenticated callables

Clients cannot read or write `media_assets` or `media_asset_cleanup` directly.
The callable lifecycle is:

1. `task07PrepareMediaUpload` authenticates the actor, validates the role,
   owner, entity, reference scope, operation ID, source type, and optional
   previous asset, then creates an idempotent prepared manifest.
2. The browser decodes the selected file, follows the server-returned variant
   contract, creates the source/variant upload set, and uploads only to the
   planned immutable paths with exact custom metadata.
3. `task07FinalizeMediaUpload` obtains authoritative Storage metadata for every
   expected object, validates generation, byte count, MIME type, custom
   metadata, dimensions, and completeness, and writes the finalized canonical
   descriptor to the server-owned manifest.
4. The consumer commits that exact descriptor to the target entity through its
   existing authorized data boundary.
5. `task07ConfirmMediaReference` proves that the target entity contains the
   exact finalized descriptor and atomically marks the new asset referenced.
   When replacing media, it also supersedes and queues the previous asset.
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

The current shell still owns two Firestore listeners: the playback document and
a bounded query for up to four playing/paused sessions. This is safer than the
previous unbounded session stream, but it does not meet the original one-listener
compact-stream target and therefore remains an open production gate.

### 7. Default the new write path off

The client media pipeline is enabled only when either
`REACT_APP_TASK07_MEDIA_PIPELINE=1` or the exact performance harness flag
`REACT_APP_FND_PERF=1` is present. Normal and production builds leave the path
off. The exact `demo-fnd-perf` harness enables it for emulator-only evidence.

A missing or false flag returns the existing legacy upload behavior. This
candidate does not implement the original four-mode remote control document
(`legacy`, `shadow`, `derivative-read`, `v1-write`); that staged control plane
must exist before production rollout.

### 8. Keep migration read-only

`task07:media-backfill:plan` accepts only project `demo-fnd-perf`, requires a
loopback Firestore emulator, refuses `--write`, `--execute`, and live-read
options, skips already canonical records, and reports unsupported WebM as an
explicit legacy fallback. It never writes Firestore or Storage.

A resumable production backfill with receipts, backups, restore, rate limits,
and rollback is outside this candidate.

## Actual processing boundary versus the original plan

The original plan makes server-side `sharp`/`ffmpeg` generation authoritative.
This candidate instead generates raster derivatives in the browser from a
server-issued contract, then makes the server authoritative for inspection,
identity, completeness, and attachment. No server trusts browser-declared
metadata without reading the stored objects, but the server does not regenerate
or independently pixel-compare the derivatives.

This is an intentional candidate limitation, not an accepted architectural
replacement. Production activation stays blocked until one of these reviewed
decisions is completed:

- implement server-side derivative generation and verification as planned; or
- amend the plan through an explicit security/performance review with equivalent
  cross-browser orientation, codec, decompression-bomb, and pixel-integrity
  evidence.

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

## Consequences

The local candidate now has a coherent versioned contract, private rendering,
bounded cache, lifecycle cleanup, low-node shell, and default-off consumer
integration. Existing records continue to render through legacy fallbacks, and
`npm start` retains its existing contract.

The trade-off is that the candidate is deliberately additive and incomplete
relative to the full Task 07 definition of done. Production activation remains
blocked by the preceding Task 06 gate, authoritative server generation,
centralized Task 01 budgets, the one-listener music target, full soak and
cross-browser evidence, the staged rollout control document, and a reviewed
write-capable migration/restore path.
