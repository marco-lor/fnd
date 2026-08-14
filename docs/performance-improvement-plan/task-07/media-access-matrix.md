# Task 07 media access matrix

Date: 2026-07-26

Status: canonical contract implemented. The default-off activation note in the
original matrix is historical; use `activation-runbook.md` for the current
loss-preserving `canonical-only` gate and production replication procedure.

## Terminology

- **Active user**: authenticated user whose root user document exists and is not
  in deletion state `pending`.
- **Owner**: `request.auth.uid` equals the canonical media `ownerUid`.
- **Actor**: user who prepared the immutable media operation. The manifest and
  every planned object bind this UID.
- **Catalog manager**: DM or webmaster.
- **Shared state**: `ready`, `fallback`, `referenced`, or `superseded`.
- **Server**: trusted Admin SDK Functions and triggers. Admin SDK access is not
  granted to browser clients by these rules.

All permissions below are conjunctive with active-user, valid-contract,
identity, path, and state checks. A role alone is never sufficient.

## Callable and read matrix

| Kind / scope | Prepare a new immutable operation | Finalize, confirm, or abandon | Retire or retry cleanup | Read a canonical object after shared state | Entity reference path |
| --- | --- | --- | --- | --- | --- |
| Avatar | Owner | Same manifest actor only | Owner | Any active signed-in user | `users/<ownerUid>` |
| Item, global catalog | Owner who is DM or webmaster | Same manifest actor only | DM or webmaster | Any active signed-in user | `items/<entityId>` |
| Item, user inventory | Owner, DM, or webmaster | Same manifest actor only | Owner, DM, or webmaster | Owner, DM, or webmaster | `users/<ownerUid>/inventory/<entityId>` |
| NPC | Owner who is DM or webmaster | Same manifest actor only | DM or webmaster | Any active signed-in user | `echi_npcs/<entityId>` |
| Foe | Owner who is DM | Same manifest actor only | DM | DM only | `foes/<entityId>` |
| Map image | Owner who is DM | Same manifest actor only | DM | Any active signed-in user | `grigliata_backgrounds/<entityId>` |
| Map video | Owner who is DM | Same manifest actor only | DM | Any active signed-in user | `grigliata_backgrounds/<entityId>` |

Prepared, finalizing, and failed assets are not shared merely because their path
is known. The manifest actor can read their own object only when the kind's
audience rule also allows that actor. Once an asset enters a shared state, the
kind/scope audience in the table applies.

A superseded object remains readable during its cleanup grace period. Cleanup
then removes the immutable object family server-side. Client delete remains
denied throughout.

## Direct resource permissions

| Resource | Anonymous | Active player | Owner | DM | Webmaster | Server/Admin |
| --- | --- | --- | --- | --- | --- | --- |
| `media_assets/<assetId>` | Denied | Denied | Denied | Denied | Denied | Read/write lifecycle authority |
| `media_asset_cleanup/<assetId>` | Denied | Denied | Denied | Denied | Denied | Read/write cleanup authority |
| Canonical original object | Denied | Read only when audience permits; create only as exact prepared actor | Same, with owner audience where required | Same, with DM audience where required | Same, except foe/map prepare remains DM-only | Inspect/read/delete under lifecycle validation |
| Canonical derivative object | Denied | Same as original | Same as original | Same as original | Same as original | Inspect/read/delete under lifecycle validation |
| Existing canonical object update | Denied | Denied | Denied | Denied | Denied | Not used; replacements get new paths |
| Existing canonical object delete | Denied | Denied | Denied | Denied | Denied | Cleanup only after manifest/queue revalidation |
| Public download token creation | Not part of contract | Not part of contract | Not part of contract | Not part of contract | Not part of contract | Not emitted by lifecycle |

## Storage create conditions

A client create is allowed only when all of these checks pass:

1. the caller is an active user;
2. `media_assets/<assetId>` exists and reconstructs a valid schema/contract v1
   plan;
3. kind, owner, asset, actor, entity, reference scope, source path, and every
   variant path match the manifest exactly;
4. the caller is the manifest actor;
5. manifest state is `prepared` or `failed`;
6. the object does not already exist;
7. original filename and MIME type, or derivative filename and WebP type, match
   the planned role;
8. the payload is non-empty and within the kind/role byte cap; and
9. the custom metadata map contains exactly the six expected Task 07 identity
   fields, with no missing, altered, or additional custom metadata.

The client cannot update or delete an object after creation. Standard
`cacheControl` and `contentDisposition` are inspected and normalized by the
server finalizer before the descriptor becomes shared.

## Entity attachment permissions

The lifecycle manifest being ready is not enough to attach media. The target
entity must accept the exact finalized descriptor under its existing business
rules:

| Entity | Existing client boundary retained by Task 07 |
| --- | --- |
| User/avatar | Safe owner or privileged user update; canonical identity must bind to that user |
| Global item | DM/webmaster create or update; canonical identity must bind to that item and `global-catalog` |
| Private inventory item | Direct browser writes remain denied by Task 05; mutations pass through the server-owned user-data command boundary |
| NPC | DM/webmaster create or constrained update; canonical identity must bind to that NPC |
| Foe | DM-only create/update; canonical identity must bind to that foe |
| Grigliata background image/video | DM-only create/update; canonical identity must bind to that background and the correct media kind |

Firestore validation compares the attached canonical value with the finalized
server-owned manifest and verifies owner, entity, scope, kind, state, source,
variants, and exact reference path. An existing media asset ID cannot be kept
while silently changing its nested path or generation.

## Read path and cache boundary

The browser receives private Storage paths and immutable generations, not
bearer URLs. The resolver rejects absolute URLs, `gs:` paths, traversal,
control characters, unknown variants, unsupported content types, invalid byte
or dimension declarations, and path/kind mismatches before calling Storage.

For an accepted descriptor it:

1. calls authenticated Firebase Storage `getBlob` with the declared byte cap;
2. verifies actual blob size and MIME type;
3. creates a local object URL;
4. shares that URL only among leases for the same path/generation; and
5. revokes it after final release or safe eviction.

CORS allows the browser to perform the authenticated blob request from an exact
approved web origin. It does not grant read access and never substitutes for
Storage rules.

## Fail-closed and deletion behavior

- Missing user documents and users pending deletion cannot read or create
  canonical Storage objects.
- Missing, malformed, mismatched, or unauthorized manifests deny Storage access.
- Direct client reads/writes of lifecycle ledgers are always denied.
- Cleanup validates the queue, manifest, canonical prefix, generation family,
  reference absence, and lifecycle state before server deletion.
- Unknown item reference scope is denied.
- Unsupported media never broadens the audience; it remains an explicit legacy
  fallback until a reviewed conversion exists.
- Legacy rendering compatibility does not make a canonical private path public.

## Test coverage and remaining authorization gates

Emulator tests cover anonymous, player, owner, DM, and webmaster behavior;
manifest privacy; prepared/shared states; exact object metadata; immutable
create-only writes; cross-owner and cross-entity rejection; item scopes; foe
and NPC roles; entity attachment; replacement; and cleanup denial paths.

Production authorization remains blocked until the full original Task 07
matrix is rerun with App Check and intended production configuration, the
server-side derivative decision is closed, the staged rollout control document
exists, and the active battle has ended. No production rule, index, Storage,
manifest, or entity change was made by this candidate.
