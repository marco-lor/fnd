# Task 07 implementation plan - media and global shell runtime

Date: 2026-07-24. Status: planning only.

This document plans Task 07 from
`docs/performance-improvement-plan/tasks/07-media-and-global-shell-runtime.md`.
Creating this plan does not authorize source changes, a Firebase deployment, an
online configuration change, a Storage or Firestore backfill, a performance
baseline update, or interaction with the live Grigliata board.

## Outcome

Task 07 is complete when the application has:

- one versioned, authorization-preserving media upload, derivative, attachment,
  replacement, and cleanup lifecycle;
- approved thumbnail/card/poster contracts for avatars, items, NPCs, foes,
  tokens, and map galleries while the active board still uses its full-quality
  source;
- shared image rendering that reserves layout space and chooses an appropriate
  derivative without requesting offscreen originals;
- a bounded image registry with request-concurrency, decoded-byte, record-count,
  failure-backoff, reference-count, and active/crossfade protection;
- one safe object-URL owner and one cancellable upload client used by all
  in-scope editors;
- a low-node global aurora that does not update React state for ordinary form or
  navigation clicks, stops work while hidden, and has no continuous motion
  under reduced motion;
- a compact, bounded global music stream with `preload="none"`, zero audio-byte
  transfer while idle or locally muted, a finite audio-node cap, and preserved
  seek/pause/loop/autoplay/disconnect and cross-route behavior; and
- measured evidence that the normal `npm start` workflow, routes,
  authorization, media fallbacks, Firebase emulator behavior, and existing
  gameplay contracts still work.

## Current evidence and planning gaps

The current source still has the conditions Task 07 is meant to remove:

- `frontend/src/components/common/Layout.js` mounts a 140-star aurora and the
  global Grigliata music player on every authenticated route.
- `frontend/src/components/common/imageAssets/imageAssetRegistry.js` retains
  decoded `Image` objects indefinitely and starts every preload through one
  unbounded `Promise.all`.
- `frontend/src/components/backgrounds/GlobalAuroraBackground.js` stores
  shooting stars in React state, listens to every window click, runs a periodic
  spawn loop, and retains completed timeout IDs until unmount.
- `frontend/src/components/grigliata/GlobalGrigliataMusicPlayer.js` opens two
  Firestore listeners and renders one `preload="auto"` audio element for every
  normalized active session.
- navigation/list surfaces such as `common/navbar.js`, `bazaar/Bazaar.js`,
  `home/elements/Inventory.js`, `echiDiViaggio/NpcSidebar.js`,
  `foesHub/FoesHub.js`, and `grigliata/BackgroundGalleryPanel.js` use original
  URLs directly and generally omit intrinsic dimensions, lazy loading,
  asynchronous decoding, and responsive sources.
- Character Creation's object-URL cleanup is returned from an event handler and
  is therefore never owned by React. Several Bazaar, Foes, DM, and Varie
  editors create replacement object URLs without a common replacement/unmount
  cleanup contract.
- the navbar and Bazaar editors contain paths that can delete old media before
  the replacement document write has committed.
- `frontend/storage.rules` uses broad `image/*`, `video/*`, and `audio/*`
  checks. It cannot validate decoded dimensions, duration, orientation, or
  derivative completeness.
- `frontend/scripts/backfill-image-cache-metadata.js` changes only cache
  metadata and can target an arbitrary supplied project; it is not a Task 07
  derivative migration.

A read-only `/home` inspection on 2026-07-24 found 140 aurora star nodes, one
`preload="auto"` audio element with a source, and 16 image elements. None of the
16 images had `loading="lazy"`, `decoding="async"`, intrinsic `width` and
`height`, or a responsive source. This was an aggregate DOM inspection only;
the live `/grigliata` tab was not claimed, refreshed, navigated, or read.

Two acceptance gates are currently undefined:

- `frontend/performance/budgets.json` has no decoded-media-memory or
  media-request-concurrency budget even though Task 07 requires both.
- `frontend/performance/tests/browser/helpers.js` records resource count,
  transfer bytes, and encoded bytes but drops `decodedBodySize`, does not track
  peak request concurrency, and cannot by itself estimate decoded bitmap
  memory.

The deterministic fixture also needs expansion. It currently reuses 128 small
SVG Storage objects, seeds only one map, and gives the music records empty audio
URLs. That cannot prove the required 50-map/token soak or the
idle/muted/active audio transfer matrix.

## Hard entry and safety gates

### Gate 0A - close the preceding task

Task 06 was accepted as locally validated for roadmap progression on
2026-07-27, so Task 07 product work may start. Its final evidence records:

1. corrected Firestore WebChannel watchdog ownership;
2. corrected protected-route cleanup accounting;
3. 19/19 broad browser-performance cases and every blocking comparison gate
   passed;
4. passing full frontend, Functions, backend, emulator, build, and startup
   checks; and
5. exact local validation commits and deterministic fixture identity.

The two-run authoritative repeatability certification was not accepted: the
first clean pair exceeded its timing-variance threshold, and the fresh rerun
was explicitly waived for Task 06 closure. This waiver is sufficient only to
open Task 07. It must not be treated as an accepted performance baseline or as
authorization for deployment, online configuration, or production rollout.

### Gate 0B - isolate implementation from the active battle

`frontend/src/components/grigliata/GrigliataPage.js` writes page presence on
mount, refreshes it every 25 seconds, and deletes it on unmount. In addition,
editing `Layout`, `GlobalGrigliataMusicPlayer`, `GrigliataPage`, or their
dependencies in the checkout watched by the port-3000 development server can
hot-reload the active battle without a browser click.

Therefore implementation must follow these rules:

1. Create a clean isolated worktree/checkout and a dedicated
   `codex/task-07-media-shell` branch. It must not be under the source tree
   watched by the current port-3000 process.
2. Do not edit Task 07 source files in
   `C:\Users\Marco\OneDrive\git_projects\fnd` while the battle/dev server is
   active.
3. Do not stop, restart, inspect, claim, refresh, navigate, or close the current
   port-3000 `/grigliata` tab or its process.
4. Use only the exact local project ID `demo-fnd-perf` for Firebase Auth,
   Firestore, Functions, Storage, and Hosting integration tests. Every
   mutating script must require exact equality after resolving its CLI
   argument, Firebase config, and inherited project environment; a missing,
   conflicting, or non-`demo-fnd-perf` value is a hard failure.
5. Browser checks of ordinary shell behavior use `/home` on an owned alternate
   port. Grigliata browser checks use only the isolated demo emulator at
   `127.0.0.1:5000`.
6. No `firebase deploy`, online control-document write, online backfill,
   `--write` migration, index/TTL activation, or accepted baseline is part of
   local implementation.
7. Do not merge or copy the source changes into the checkout watched by the
   active battle until the user confirms that the battle and its development
   server are no longer active.

If an isolated worktree cannot be created safely, implementation pauses until
the battle is over. That is a hard stop, not a reason to work in the watched
checkout.

### Gate 0C - freeze a trustworthy before state

From the isolated, clean, committed worktree:

- record `git status`, commit ID, Node/npm/Java/Firebase CLI/browser versions,
  fixture version/checksum, and available memory;
- require Java 21 before starting Firestore/Storage rules integration;
- create and commit one harness-only measurement change containing the new
  deterministic media fixture and neutral instrumentation, with no Task 07
  product behavior, schema, rules, or reader changes;
- prove the harness-only commit's unit tests and determinism check before using
  it for either side of the comparison;
- run the completed Task 06 gate and two compatible baseline scenarios;
- capture current `/home`, Bazaar, Echi, Foes Hub, and demo Grigliata media
  request count/bytes, image element attributes, DOM nodes, peak JS heap,
  shell listeners, audio nodes, and active media sources;
- capture a 50-map/large-token pre-change soak after adding the deterministic
  fixture, without accepting the result as an improved baseline; and
- store before evidence separately from after evidence. Never overwrite the
  accepted Task 01 baseline during development.

## Scope boundaries

Task 07 includes the shared media and shell foundations plus enough adoption to
make list/navigation surfaces use approved derivatives. It does not absorb the
later page tasks:

- Task 08 still owns Login, Character Creation, and Home data-path work.
- Tasks 09 and 10 still own Bazaar pagination and editor consolidation.
- Task 13 still owns Tecniche/Spell and Foes Hub data/list restructuring.
- Task 15 still owns Echi map compression, map rendering, and marker/list
  scaling.
- Tasks 16-20 still own the Grigliata realtime, render, video, visibility, and
  fog algorithms.
- Task 21 still owns final consolidation to one Grigliata music
  service/subscription/playback graph and all Grigliata write/migration work.
- Task 22 still owns production-shaped rollout, monitoring, baseline
  acceptance, and operational handoff.

Task 07 may adapt those pages to a shared renderer/upload lifecycle, but it must
not change pagination, gameplay rules, map quality, visibility, placement
ownership, music controls, or domain schemas unrelated to media references.

## Target media policy

Create matching frontend and Functions policy modules and a static parity
check. The Functions copy is authoritative; the browser copy is an early UX
check only. A server always revalidates bytes and decoded metadata.

Initial version-1 limits are blocking implementation targets:

| Purpose | New-upload MIME allowlist | Source cap | Decoded cap | Required outputs |
| --- | --- | ---: | --- | --- |
| Profile avatar | JPEG, PNG, WebP | 5 MiB | 4096 x 4096 and 16 MP | square 64, 128, 256 WebP plus original |
| Item/token/NPC/foe/technique/spell art | JPEG, PNG, WebP | 8 MiB | 4096 x 4096 and 24 MP | thumbnail 96/192 and card 320/640 WebP plus original |
| Board/map image | JPEG, PNG, WebP | 15 MiB | 8192 x 8192 and 32 MP | gallery 384/768 WebP plus untouched full-quality original |
| Technique/spell video | MP4 or WebM with supported browser codec | 25 MiB | 1920 x 1080, at most 10 minutes | poster 384/768 WebP plus original video |
| Board/map video | MP4 or WebM with supported browser codec | 25 MiB | 3840 x 2160, at most 10 minutes | poster 384/768 WebP plus original video |
| Shared music | MP3, M4A/AAC, Ogg, or WAV with supported browser codec | 25 MiB | at most 60 minutes | normalized metadata only; never transcode in Task 07 |

Additional policy decisions:

- Reject SVG, HEIC/HEIF, and new animated GIF uploads with an explicit
  unsupported-format message. Existing legacy files remain readable through
  the original fallback until separately migrated.
- Inspect file signatures and decoded metadata; never trust a filename,
  extension, browser MIME string, or Storage `contentType` alone.
- Apply EXIF orientation before resizing and record normalized width, height,
  and orientation.
- Preserve transparency. Use a pinned encoder and deterministic settings:
  quality 78 for thumbnails/cards and 75 for map/video posters.
- Use contain/inside fitting for item and map art. Use cover fitting only for
  explicitly square avatar/portrait contracts.
- Version every output path by policy version and source generation. Never
  overwrite an immutable derivative URL in place.
- Generated originals and derivatives use
  `private, max-age=31536000, immutable`; no Task 07 path uses `public`.
- An unsupported or failed derivative never silently replaces the source.
  Readers show the tested legacy/original fallback and an observable
  redacted error state.

### Runtime budgets to add to Task 01

Add blocking entries to `frontend/performance/budgets.json` and surface the
corresponding metrics:

| Metric | Desktop gate | Compact/save-data gate |
| --- | ---: | ---: |
| Peak image requests/decodes owned by the registry | 4 | 2 |
| Unpinned registry records after a soak settles | 96 | 64 |
| Unpinned estimated decoded bytes after a soak settles | 128 MiB | 64 MiB |
| Total estimated decoded bytes including at most two 32-MP full-map pins | 384 MiB | 320 MiB |
| Low-priority queued preloads | 32 | 16 |
| Active global music audio nodes | 4 | 4 |
| Authenticated-shell music stream listeners after candidate switch | 1 | 1 |
| Audio transfer while stream is stopped/empty | 0 bytes | 0 bytes |
| Audio transfer while locally muted | 0 bytes | 0 bytes |
| Active object URLs after replacement/unmount | 0 | 0 |
| Continuously animated aurora elements under reduced motion | 0 | 0 |
| Aurora timers/frames while the document is hidden | 0 | 0 |

Use `naturalWidth * naturalHeight * 4` as a conservative decoded-image
estimate. Record response decoded bytes separately; do not present
`decodedBodySize` as bitmap memory. A plateau means the settled unpinned record
count and estimated decoded bytes, plus the total including active pins, stay
at or below their respective caps after each of the final three 50-map cycles,
with no upward trend above 5%.

## Versioned metadata and Storage layout

### Firestore lifecycle

Add a server-owned `media_assets/{assetId}` ledger with this bounded schema:

```text
schemaVersion, policyVersion, generation
state: intent | uploaded | processing | ready | attached | superseded |
       cleanup-pending | deleted | cancelled | rejected | failed
purpose, audience, ownerUid, targetKind, targetId
source: path, mime, bytes, width, height, durationMs, checksum, orientation
variants: bounded map of name -> path, mime, bytes, width, height
attachment: target revision/reference and attachedAt
retention: cleanupAfter and supersededAt
error: redacted code, retryable flag, attempts
createdAt, updatedAt
```

Do not put filenames, URLs, UIDs, document IDs, or checksums into performance
telemetry. Client-readable status must expose only the fields required to show
progress/failure and render the attached media.

Owning documents retain their current URL/path fields during the compatibility
period and add one bounded versioned media reference. Readers:

1. prefer a ready version-1 variant appropriate to the requested use;
2. fall back to the version-1 original when full quality is required;
3. fall back to the existing legacy URL/path when version-1 metadata is absent
   or rejected; and
4. show the shared placeholder/error UI when no safe source remains.

Missing, malformed, or wrong-version Task 07 configuration resolves to
`legacy`; it must never enable a partial candidate.

Version-1 Firestore records store Storage paths, never permanent Firebase
download-token URLs or long-lived signed URLs. A token URL is a bearer
capability and cannot be made private merely with `Cache-Control: private`.
Existing legacy URL fields remain a documented compatibility risk until their
owners are migrated; Task 07 must not create new ones.

### Storage layout and authorization

Use two non-overlapping roots:

```text
media_uploads/{ownerUid}/{assetId}/source
media_assets/v1/{audienceScope}/{ownerKey}/{assetId}/{generation}/{variant}
```

- A begin-upload callable creates an expiring intent before Storage accepts a
  source.
- Storage rules allow only the authenticated owner and intended role to create
  the exact staging object described by that intent.
- Staging objects are not listable or generally readable.
- Only Admin SDK code writes/deletes generated originals and derivatives.
- Generated-path reads reproduce the existing purpose-specific audience:
  signed-in, owner-or-manager, or DM-only as recorded in a checked-in access
  matrix. Do not collapse them into one broad signed-in rule.
- Browser clients retrieve version-1 assets through the authenticated Firebase
  Storage SDK (`getBlob` with the policy byte cap) after selecting one approved
  candidate. The UI owns and revokes the resulting document-local object URL.
  It must not call `getDownloadURL` for a version-1 asset.
- Rules deny client writes to the ledger, generated objects, cleanup queue,
  and music projection.
- Firestore and Storage emulator tests cover owner, other player, DM,
  webmaster, anonymous, deleted/pending user, wrong purpose/path, forged MIME,
  oversized bytes, and cross-scope attempts.

Before writing rules, create
`docs/performance-improvement-plan/task-07/media-access-matrix.md` from the
current Firestore/Storage/read-path behavior. A rule change cannot broaden
access merely to make a derivative load.

## Authoritative pipeline and safe replacement

Implement a second-generation Storage-finalize processor in the bucket's
compatible region. Use `sharp` for raster metadata/orientation/derivatives and
a pinned, deployment-tested ffmpeg/ffprobe binary for video metadata/posters.
The worker must:

1. ignore every generated prefix and every generation it already completed;
2. claim the intent idempotently and reject missing, expired, cancelled,
   wrong-owner, wrong-purpose, or already-attached input;
3. stream/hash the source with a hard byte cap;
4. verify magic bytes, codec, dimensions, pixel count, duration, and policy;
5. write derivatives to generation-specific temporary names;
6. verify every output's metadata and checksum;
7. promote the complete set and atomically mark the ledger `ready`;
8. remove partial temporary outputs on failure; and
9. emit bounded, redacted telemetry and an explicit retryable/non-retryable
   state.

Run an implementation spike before schema adoption to prove the pinned
ffmpeg/ffprobe binary works on Windows tests, the emulator, and the Node 22
Functions build without exceeding deployment/package limits. If it fails, use
a separately containerized worker with the same contract; do not merge a
pipeline that silently omits video posters.

### Client lifecycle

Create one shared upload client around `uploadBytesResumable`:

- client validation uses the same policy for fast feedback;
- at most two image uploads or one video/audio upload run concurrently;
- each task exposes progress and a cancellation method;
- replacement, dialog close, route unmount, sign-out, and explicit cancel
  cancel queued/in-flight work when safe;
- a cancelled intent is marked server-side so a finalize race cannot attach it;
- status polling/listening is bounded and can resume by operation ID after an
  ambiguous disconnect; and
- an uploaded asset is not shown as persisted until the authoritative processor
  reports `ready` and the metadata attachment commits.

Do not add a callable that accepts an arbitrary Firestore path. Add an
enumerated target adapter registry for profile, user inventory/content,
catalog item, NPC, foe, Grigliata token, and Grigliata background. Each adapter
revalidates actor, role, target ownership, expected revision, purpose, and
audience in the same transaction that attaches the new media.

Register every new callable through the Task 06 callable registry with an
explicit App Check policy. Preserve the current single production App Check
initialization and demo-emulator behavior; never initialize a second provider
or add a production bypass. Before candidate rollout, document whether
enforcement is already supportable for every affected client. If it is not,
leave the candidate reader disabled rather than weakening authorization.
Tests cover one-time initialization, production enforcement options, emulator
invocation, missing/invalid App Check, authenticated authorization, and
sign-out cleanup.

Every copy, duplicate, move, and delete path for an owning document must carry
or clean the complete bounded media reference: asset ID, generation, original,
all derivatives, and ownership metadata. Add explicit coverage for foe/NPC,
inventory/content, catalog, token, and background duplication so copied
documents cannot strand a derivative family or point at another owner's
private asset.

Reuse the Task 05/06 operation-ID and receipt pattern. Extend the Task 05
profile/inventory/personal-content commands instead of bypassing their rollout,
document-budget, identity, and cleanup invariants.

### Replacement and cleanup ordering

The required ordering is:

1. create intent;
2. upload source;
3. finish and verify every derivative;
4. transactionally attach the new generation and mark the prior generation
   superseded;
5. render the newly committed metadata;
6. enqueue old source and all old derivatives; and
7. delete only after the worker proves no supported reference still points to
   that generation.

Never delete the old object from browser code. On a metadata failure, keep the
old attachment and mark the new family orphaned. On a cleanup failure, keep the
new attachment and retry cleanup.

Retention defaults:

- cancelled/failed staging data: retry cleanup immediately, dead-letter after
  bounded attempts;
- ready but unattached assets: cleanup after 24 hours;
- superseded version-1 families: retain seven days before verified deletion;
- legacy originals discovered by backfill: retain through Task 22 and a
  separately approved production migration.

Use deterministic retry intervals and a bounded attempt count. A dead-letter
entry remains observable and manually retryable; it must not loop forever.

## Shared rendering contract

Add a small common media package, for example:

```text
frontend/src/components/common/media/MediaImage.js
frontend/src/components/common/media/MediaPoster.js
frontend/src/components/common/media/mediaContract.js
frontend/src/components/common/media/resolveMediaSource.js
frontend/src/components/common/media/useObjectUrl.js
frontend/src/components/common/media/mediaUploadClient.js
```

`MediaImage` must:

- accept version-1 metadata plus the legacy fallback;
- choose only an approved variant for `avatar`, `thumbnail`, `card`,
  `map-gallery`, or `full`;
- wait for measured visibility unless the caller explicitly requests an
  approved eager source, then select exactly one 1x/2x path from rendered size
  and device pixel ratio and retrieve it with the authenticated Storage SDK;
- render intrinsic `width`/`height` or an equivalent stable `aspect-ratio`;
- use `loading="lazy"` and `decoding="async"` for list/offscreen media;
- expose deliberate eager/fetch-priority options only for measured above-fold
  and active-board uses;
- expose responsive candidate metadata and `sizes`, but do not eagerly fetch
  both candidates merely to manufacture a blob-backed `srcSet`;
- use a deterministic aspect-ratio placeholder and a shared error fallback;
- retain accessible alt text; and
- never fall back from a list contract to a multi-megabyte original merely
  because a derivative is still processing. Shadow/legacy rollout is the only
  explicit compatibility exception.

Adopt the component in this Task 07 scope:

- navbar/sidebar avatar and shell-cache avatar projection;
- Bazaar list cards and purchase confirmation;
- Home inventory/equipment rows;
- Echi NPC list/hover cards;
- Foes Hub foe/technique/spell list images;
- Grigliata background gallery and token/library trays.

The active Grigliata board and an active/crossfading presentation placement
continue to resolve the full-quality original. Gallery video rows render a
poster image rather than instantiating an offscreen `<video>`.

## Bounded image registry

Refactor the existing common image registry without breaking its public
snapshot semantics:

- each record tracks `status`, promise/image/error, subscribers, `refCount`,
  explicit pin leases, last access, estimated decoded bytes, failure time,
  retry count, and queue priority;
- `useImageAsset` acquires a reference on mount/source change and releases it
  on cleanup;
- active board and the one incoming/outgoing crossfade counterpart acquire the
  two named full-map pin leases; visible presentation assets use their approved
  derivative and acquire a normal visible lease;
- visible work has priority over route prefetch and idle gallery preloads;
- request/decode starts pass through the 4/2 concurrency semaphore;
- low-priority queues are bounded and cancellable;
- LRU eviction considers only loaded/error records with zero references, zero
  pins, and no in-flight request;
- eviction clears image handlers/source, removes the record, and updates byte
  accounting;
- failures back off for 1 second, 5 seconds, then 30 seconds. An explicit user
  retry may bypass the current delay once;
- a legacy active/crossfade source that alone exceeds the pinned allowance is
  still never evicted: the registry evicts all unpinned work, admits no new
  preload, emits one redacted budget exception, and keeps acceptance non-green
  until the compatibility case is explicitly dispositioned;
- public preload functions retain compatible return/cancel behavior while
  using the queue; and
- test-only inspection/reset APIs expose counts and bytes without shipping
  private URLs to telemetry.

The soak must cycle at least 50 distinct maps repeatedly, include a large token
list, hold an active map and one crossfade pin, and prove:

- settled records/bytes plateau under the configured cap;
- the active and crossfading assets are never evicted;
- a recently hot asset is not redownloaded;
- evicted cold assets can reload correctly;
- failure backoff prevents a retry storm; and
- unmount/cancel leaves no queued or in-flight work owned by the route.

## Object URLs and editor adoption

Create one hook for preview ownership and one `withObjectUrl` helper for
short-lived metadata reads. They revoke the previous URL before replacement,
revoke on clear/unmount, and use `finally` for non-React work.

Migrate every raw preview creator, not only the audit examples, including:

- Character Creation;
- Home/DM Varie editors;
- all four Bazaar editors and nested spell previews;
- personal technique/spell editors and overlays;
- Foe, technique, and spell editors;
- Echi NPC create/edit;
- Grigliata image/video/audio metadata readers.

Add a static check that fails when `URL.createObjectURL` appears outside the
approved helper modules and tests. Add tests for select A -> select B, clear,
cancel, save success, save failure, modal close, route unmount, and sign-out.

Move in-scope direct `uploadBytes`, `uploadBytesResumable`, `getDownloadURL`,
and `deleteObject` flows behind the shared service or a reviewed domain adapter.
Task 07 must remove old-before-commit deletion from navbar and Bazaar paths
without prematurely consolidating the whole Bazaar editor UI.

Rules/integration coverage must prove that owner/role-authorized `getBlob`
succeeds, anonymous and wrong-audience reads of a copied path fail, version-1
metadata never contains a token URL, and a document-local object URL stops
working after revocation. Legacy token URLs are inventoried separately and
cannot be used as proof of the version-1 authorization contract.

## Low-node aurora

Keep the visual identity with a bounded DOM implementation:

- two aurora gradient layers;
- at most two starfield layers using CSS backgrounds/box-shadow or one canvas;
- a pool of at most two shooting-star elements manipulated through refs/CSS
  variables, not React state; and
- no more than six continuously animatable decorative elements.

Lifecycle rules:

- register `matchMedia('(prefers-reduced-motion: reduce)')` and
  `visibilitychange` once;
- reduced motion renders a static gradient/star field, starts no meteor
  timer, and attaches no click-spawn listener;
- hidden documents pause CSS animation and cancel scheduled spawns;
- becoming visible schedules one fresh bounded spawn rather than replaying a
  backlog;
- clicks on `button`, `a`, `input`, `textarea`, `select`, `option`, `label`,
  `[role="button"]`, `[contenteditable]`, dialogs, and explicit interactive
  containers never create a meteor;
- a non-interactive background click may reuse one pooled meteor without a
  component rerender;
- timeout IDs live in a `Set`, are removed when they fire, and are all cleared
  on unmount; and
- CSS includes a final `prefers-reduced-motion` guard even if JavaScript setup
  fails.

Tests cover listener stability, form/navigation clicks, background clicks,
pool cap, mobile density, hidden/visible transitions, reduced-motion changes,
unmount, and ten minutes of fake time with zero retained handles.

## Compact global music stream

Task 07 introduces a compatibility projection, not Task 21's final playback
service.

Add a server-owned bounded document:

```text
grigliata_music_stream/current
  schemaVersion, revision, volume
  sessions[0..3]:
    id, status, trackId, trackName, audioUrl, durationMs, offsetMs,
    loop, startedAtMs, updatedAtMs
  sourceHash, updatedAt
```

- Existing manager controls remain behaviorally unchanged and update their
  current compatibility documents.
- A server projection produces the bounded stream deterministically and
  idempotently. It rejects malformed/unbounded values and never copies stopped
  history into the stream.
- Shadow mode compares the stream with legacy state before any reader switch.
- Candidate global playback uses one stream-document listener rather than the
  current state plus unbounded sessions listeners.
- The Grigliata manager UI may retain its route-owned control/library
  subscriptions until Task 21; Task 07 must not claim the final one-listener
  acceptance gate early.
- The measurable Task 07 gate is exactly one authenticated-shell music stream
  listener after the candidate switch. Route-owned manager/library listeners
  are counted and reported separately; they do not change this shell gate.

Update the global player so:

- the stream is empty/stopped or the local user is muted -> clear every source,
  render zero active nodes, and transfer zero audio bytes;
- paused sessions retain authoritative offset metadata but do not need to
  preload bytes;
- playing unmuted sessions create/lease nodes only up to the four-session cap
  on every viewport/save-data profile and use
  `preload="none"`;
- unmuting or resuming computes the correct current offset before play;
- navigation across authenticated routes does not remount or restart audible
  playback;
- sign-out, disconnect, session removal, or stream downgrade clears source,
  listeners, blocked-autoplay state, and node ownership; and
- an over-cap stream fails closed with a redacted diagnostic rather than
  creating more nodes.

The current muted test expects a source to remain loaded. Task 07 intentionally
changes that internal expectation to satisfy the zero-byte muted requirement;
the audible state and authoritative timeline remain continuous.

Test stopped, empty, muted-before-mount, mute-during-play, unmute, one through
four sessions, rejected fifth session, pause/resume, seek, loop, ended,
autoplay block/unlock, rapid route navigation, reconnect, sign-out, and legacy
rollback.

## Backfill and compatibility rollout

Add a Task 07 migration under `frontend/scripts/task07/` with shared,
unit-tested planning/execution code.

The command is dry-run by default and must:

- require `--project`, `--bucket`, policy version, and fixture/plan version;
- require exact `demo-fnd-perf` equality for write mode after resolving CLI,
  Firebase config, bucket ownership, and inherited project environment;
- scan Firestore and Storage in bounded pages;
- classify purpose, owner, audience, source reference, and legacy anomalies;
- hash source metadata/content and derive a deterministic generation key;
- emit a redacted manifest, counts, bytes, unsupported formats, collisions,
  and proposed outputs;
- checkpoint after each page and resume without duplicating derivatives;
- use the same processor and policy as new uploads;
- verify every ready family before proposing metadata attachment;
- leave existing URL/path fields and original objects intact;
- support verify-only and rollback-plan modes; and
- require a reviewed approval fingerprint before any future production write
  mode can exist.

Extend the demo fixture with deterministic JPEG/PNG/WebP sources at realistic
dimensions and transfer sizes, 50 distinct maps, large token/item/NPC/foe
sets, valid/invalid orientation cases, corrupt/unsupported files, short audio,
and video poster cases. Keep an explicitly stopped/muted fixture with no media
request and an active fixture with bounded sessions.

No production backfill runs during the battle. A future approved production
run must generate/verify derivatives before switching readers, exclude active
Grigliata metadata from destructive cleanup, and retain originals through
Task 22.

## Implementation sequence and review checkpoints

### Phase 0 - prerequisite and isolation

- Gate 0A is closed by the 2026-07-27 Task 06 validation decision.
- Create the isolated branch/worktree and prove it does not affect port 3000.
- Land the deterministic media fixture and neutral measurement hooks as a
  clean, harness-only commit. Prove those changes do not alter product readers,
  writers, rules, or shell behavior.
- Record before evidence from that commit and freeze its fixture checksum for
  every after-run.
- Deliverable: updated Task 06 evidence, the harness-only commit ID/checksum,
  and the Task 07 before report.
- Stop condition: any live-board/HMR contact or regression that reopens the preceding gate.

### Phase 1 - contracts, budgets, and failing tests

- Write the media policy, access matrix, metadata schema, rollout modes, and
  runtime budgets.
- Add failing unit/browser/rules tests for policy, authorization, lifecycle,
  decoded/request budgets, object URLs, aurora, and music.
- Add checked-in Task 07 scripts and wire blocking PR checks plus retained
  artifacts into `.github/workflows/performance.yml`. Put the ten-minute soak
  in a scheduled/manual job, not every routine PR.
- Deliverable: `task-07/architecture-decision.md`,
  `media-access-matrix.md`, policy parity check, and red tests.
- Review checkpoint: exact policy/caps and authorization matrix approved before
  Storage/Firestore schema changes.

### Phase 2 - authoritative processor and rules

- Implement upload intents, processor, derivative verification, ledger,
  status, target adapters, retry/dead-letter cleanup, and generated-path rules.
- Prove the ffmpeg/ffprobe packaging gate before enabling video intent types.
- Run Functions unit tests and demo Firestore/Storage/Functions integration.
- Deliverable: ready/rejected/cancelled/orphaned lifecycle evidence.
- Stop condition: trigger recursion, partial-ready metadata, access widening,
  or unverified output.

### Phase 3 - shared upload/object-URL lifecycle

- Add the cancellable client and object-URL helpers.
- Migrate profile, Character Creation, Varie, Bazaar, Echi, Foes, personal
  content, and Grigliata upload adapters.
- Remove browser-side old-object deletion and add static boundary checks.
- Deliverable: replacement/cancellation/orphan retry matrix.
- Stop condition: old media disappears before durable attachment or an
  unmount leaves a task/blob URL alive.

### Phase 4 - derivatives and shared rendering

- Add versioned/legacy normalization and shared renderers.
- Adopt avatar/item/NPC/foe/token/map-gallery surfaces.
- Keep full original resolution for active board/crossfade.
- Run offscreen request, intrinsic layout, error fallback, direct-route, and
  authorization tests.
- Deliverable: per-route before/after transfer/request/CLS report.
- Stop condition: a list fetches originals, a private derivative is exposed,
  or active-board quality changes.

### Phase 5 - bounded registry

- Add refcounts, pins, priorities, concurrency queue, byte accounting, LRU,
  failure backoff, cancellation, and instrumentation.
- Update Grigliata consumers to lease active/crossfade assets.
- Run unit, 50-map, large-token, failure, and teardown soaks.
- Deliverable: plateau, cache-hit, eviction, and pin evidence.
- Stop condition: active/crossfade eviction, retry storm, upward heap trend, or
  hot-asset redownload.

### Phase 6 - aurora

- Replace the star DOM and React click state with the bounded pool.
- Add hidden/reduced-motion/control-click behavior and timer cleanup.
- Run desktop/mobile and ten-minute lifecycle tests.
- Deliverable: DOM/animation/timer/commit before-after report.
- Stop condition: control clicks rerender the shell, reduced motion animates,
  or hidden work continues.

### Phase 7 - music stream and player

- Add the bounded compatibility projection and shadow comparison.
- Switch the candidate global player to one stream listener and bounded
  `preload="none"` nodes.
- Run the full playback and transfer matrix, including route continuity.
- Deliverable: listener/node/bytes/continuity report.
- Stop condition: idle/muted transfer, timeline discontinuity, autoplay
  regression, over-cap nodes, or manager-control behavior change.

### Phase 8 - backfill rehearsal and full regression

- Run dry-run, interrupted run/resume, verify-only, duplicate run, corrupted
  source, partial output, rollback-plan, and cleanup retry on `demo-fnd-perf`.
- Freeze a clean candidate commit before authoritative after-runs and verify its
  fixture checksum exactly matches the Phase-0 before run.
- Run the full regression/production/startup/performance matrix below.
- Produce `implementation-evidence.md` and `operations-runbook.md`.
- Do not merge to the watched checkout or deploy online.

## Test and validation matrix

### Focused correctness

Add/run focused suites for:

- media policy parity and client/server validation;
- processor orientation, dimensions, output metadata, corruption, unsupported
  codec, idempotency, cancellation, partial failure, and retry;
- Firestore/Storage rules and generated-path authorization;
- callable App Check options, one-time client initialization, and emulator
  behavior;
- shared renderer source selection, attributes, placeholders, and legacy
  fallback;
- object-URL and upload lifecycle;
- image registry refcount/pin/LRU/concurrency/backoff;
- aurora reduced-motion/visibility/click/timer lifecycle; and
- music stream projection/player lifecycle.

Add a checked-in `test:task07` script that expands to the exact Task 07 Jest
files for the shared media package, upload adapters, image registry, aurora,
and global music player. Use the Windows-safe invocation:

```powershell
$env:CI='true'
npm.cmd run test:task07
```

### Backend and rules

From `frontend/functions`:

```powershell
npm.cmd run lint
npm.cmd run build
npm.cmd test
```

From `frontend`, with Java 21 and exact `demo-fnd-perf` emulators:

```powershell
npm.cmd run perf:functions-integration
npm.cmd run perf:media
```

`perf:media` is a new isolated Task 07 integration command. It must start/stop
only its own Auth/Firestore/Functions/Storage emulator processes, seed the
frozen fixture, run the existing `perf:rules` suites plus new Task 07 rules and
pipeline tests while those emulators are alive, and fail unless every resolved
project source equals `demo-fnd-perf`.

### Full frontend and static boundaries

```powershell
$env:CI='true'
npm.cmd test -- --watch=false --runInBand --watchman=false
npm.cmd run perf:test
npm.cmd run perf:check-firestore-imports
npm.cmd run perf:check-callable-registry
npm.cmd run perf:check-media-boundaries
npm.cmd run perf:build
npm.cmd run build:production
npm.cmd run verify:production-build
npm.cmd run perf:verify-disabled
```

The new boundary command checks policy parity, raw object-URL creation, direct
in-scope Storage mutation, original-in-list fallbacks, and unsafe public cache
headers.

### Browser performance

On the isolated demo environment:

- `/home`: avatar/list attributes, zero idle/muted audio transfer, navigation
  continuity, reduced motion, hidden lifecycle, and control-click filtering;
- `/bazaar`: approved thumbnails, offscreen originals not requested, fallback;
- `/echi-di-viaggio`: NPC thumbnails and access;
- `/foes-hub`: foe/content thumbnails and DM authorization;
- demo `/grigliata`: gallery posters, active full-quality board source,
  crossfade pinning, 50-map/token soak, music lifecycle; and
- mobile viewport/save-data profile: 2-request/64-MiB registry caps and reduced
  aurora density.

Record request type/count/transfer/encoded/decoded response bytes, peak request
concurrency, registry count/estimated decoded bytes, JS heap, DOM nodes, React
commits, active listeners/resources/timers/media, audio nodes/bytes, and CLS.
For stopped or cold-muted startup, require zero audio requests and zero audio
bytes. For mute-during-play, timestamp the transition, release nodes/sources,
and require the post-transition audio request/byte delta to remain zero;
cumulative bytes transferred before mute are reported separately.

Add and run exact checked-in scripts:

```powershell
npm.cmd run perf:media:cross-browser
npm.cmd run perf:media:soak
npm.cmd run perf:ci
npm.cmd run perf:authoritative
```

`perf:media:cross-browser` owns its emulators and runs the Task 07 media smoke
in Chromium, Firefox, and WebKit. `perf:media:soak` runs the 50-map/token and
ten-minute lifecycle gates and is also the scheduled/manual CI job.
`perf:authoritative` runs two compatible candidate passes and the existing
repeatability comparison. A partial scenario run is partial evidence and
cannot accept a baseline; Task 07 does not accept a new baseline locally.

### `npm start` and route smoke

The unchanged `frontend/package.json` contract remains:

```json
"start": "react-scripts start"
```

Run:

```powershell
npm.cmd run verify:start
```

This must invoke the normal `npm start` workflow on its owned port 3001, compile
without warnings/errors, request `/home` with HTML navigation headers, and stop
only its own process. If an additional interactive smoke is required, use
`BROWSER=none` and an owned alternate port; never bind, stop, or reuse port
3000.

Verify direct navigation/refresh for all existing routes and fresh-role
authorization. Browser visual checks use read-only `/home` on the owned server
and demo-emulator routes only. Do not open the live `/grigliata`.

### Final repository checks

From the repository root:

```powershell
python -m unittest discover -s backend -p "test_*.py"
git diff --check
```

Also require:

- generated policy/manifest outputs are current;
- no unexpected build/test console warning;
- no accepted baseline change;
- no online Firebase change;
- no source-map/public-cache authorization regression; and
- the original current checkout and port-3000 process remain untouched.

## Rollout and rollback design

Use a versioned Task 07 control document through the Task 04 config repository:

```text
mode: legacy | shadow | derivative-read | v1-write
schemaVersion, policyVersion
enabledPurposes, enabledRoles, enabledUids
```

Unknown/missing configuration is `legacy`.

Local implementation exercises all modes only in `demo-fnd-perf`:

1. `legacy`: existing readers/writers; new code inert.
2. `shadow`: processor/backfill can generate and compare metadata, but readers
   and writers remain legacy.
3. `derivative-read`: an allowlisted demo cohort reads ready variants and falls
   back safely; uploads remain compatibility writes.
4. `v1-write`: allowlisted demo users use intents/attachments and dual metadata.

A future production rollout is outside this implementation and requires
separate approval after the battle:

1. deploy additive rules/functions/indexes with mode still `legacy`;
2. confirm no trigger loop, denied-read spike, or cleanup backlog;
3. run reviewed dry-run and shadow generation while retaining every original;
4. compare authorization, dimensions, hashes, transfer, and fallbacks;
5. enable derivative reads for a tiny non-battle cohort, then widen only after
   monitoring gates;
6. enable new writes after replacement/cancellation/orphan drills; and
7. defer legacy deletion and baseline acceptance to Task 22.

Immediate rollback sets mode to `legacy`; readers use preserved legacy
URL/path fields and originals. Processor/cleanup can be paused independently.
Never make rollback depend on regenerating a deleted source.

## Risks and explicit mitigations

| Risk | Mitigation / stop rule |
| --- | --- |
| HMR changes the active battle | Isolated worktree outside the watched source; no merge until battle/server ends |
| Derivative broadens private access | Checked-in access matrix plus Firestore/Storage emulator role matrix |
| Storage trigger processes its own outputs | Separate roots, generated metadata, generation claim, recursion test |
| New attachment loses old media | Upload/process/verify/commit before queued verified deletion |
| Cancellation races finalization | Server-owned intent state checked before ready/attach |
| Cache evicts active board/crossfade | Named pin leases; soak asserts non-eviction |
| Decoded memory gate is misreported | Conservative registry estimate plus response/heap metrics; document limitations |
| Unsupported codec silently changes behavior | Signature/codec validation and explicit fallback/error; no silent transcode |
| ffmpeg dependency is not deployable | Phase-2 packaging spike; container worker fallback; no partial merge |
| Backfill mutates production or current board | Demo-only write guard, dry-run default, approval fingerprint, post-battle rollout |
| Muted player still downloads bytes | Release sources/nodes while muted; restore offset from authoritative stream |
| Session cap drops expected playback | Four-session compatibility cap, over-cap diagnostic, full continuity matrix |
| Task 21 duplicates/replaces Task 07 music work | Task 07 projection is explicitly transitional and schema-versioned |
| Baseline looks better because fixtures became easier | Deterministic realistic media fixture and same checksum for before/after |

## Definition of done

Task 07 may be reported locally complete only when:

- the preceding Task 06 gate remains closed for roadmap progression under the
  2026-07-27 validation decision;
- every Task 07 policy, schema, access, lifecycle, and rollback decision is
  documented;
- lists/navigation use approved ready derivatives with tested legacy fallback;
- the active board/crossfade still use full quality and cannot be evicted;
- request concurrency, registry records, decoded-byte estimate, audio nodes,
  object URLs, animations, timers, and transfers meet the new blocking budgets;
- replacement, cancellation, orphan retry, authorization, orientation,
  unsupported format, and backfill resume/rollback tests pass;
- focused, full frontend, Functions, backend, rules, production-build,
  performance, and repeatability gates pass with no unexplained warnings;
- `npm run verify:start` proves the unchanged `npm start` path on an owned port
  and `/home` responds;
- only the isolated demo Grigliata was exercised;
- no deployment, online config/data/rules/index change, baseline acceptance, or
  legacy deletion occurred;
- `architecture-decision.md`, `media-access-matrix.md`,
  `implementation-evidence.md`, and `operations-runbook.md` contain exact
  commands/results and unresolved production gates; and
- source integration into the user's watched checkout remains deferred until
  the active battle/dev server is confirmed stopped.
