const test = require("node:test");
const assert = require("node:assert/strict");

const {
  hardenLegacyInventoryProjectionMedia,
  hasUntrustedTask07InventoryMedia,
  isTask07CanonicalStoragePath,
  mergeUntrustedInventorySnapshotPatch,
  preserveTrustedTask07PersonalContent,
  stripTask07PersonalContentProjection,
  stripUntrustedTask07InventoryMedia,
} = require("../lib/task07ServerBoundary");

const assetId = `m_${"a".repeat(40)}`;
const canonicalPath = (
  `media_assets/v1/signed-in/dm-one/${assetId}/123/original`
);
const legacyCanonicalPath = `media/v1/item/dm-one/${assetId}/original/source.png`;
const catalogMedia = {
  schemaVersion: 1,
  contractVersion: 1,
  assetId,
  kind: "item",
  state: "ready",
  original: {path: canonicalPath},
  variants: {},
  processing: {authoritative: true, fallbackCode: null},
};

test("canonical Task 07 paths are detected in raw and Firebase URL forms", () => {
  assert.equal(isTask07CanonicalStoragePath(canonicalPath), true);
  assert.equal(isTask07CanonicalStoragePath(legacyCanonicalPath), true);
  assert.equal(isTask07CanonicalStoragePath(
    "https://firebasestorage.googleapis.com/v0/b/demo/o/" +
      encodeURIComponent(canonicalPath) +
      "?alt=media"
  ), true);
  assert.equal(isTask07CanonicalStoragePath(
    `gs://demo/${canonicalPath}`
  ), true);
  assert.equal(isTask07CanonicalStoragePath("items/legacy.png"), false);
  assert.equal(isTask07CanonicalStoragePath(
    "notes mention media/v1/item but are not a storage path"
  ), false);
});

test("untrusted inventory inputs cannot inject descriptors or canonical paths", () => {
  assert.equal(hasUntrustedTask07InventoryMedia({
    media: catalogMedia,
  }), true);
  assert.equal(hasUntrustedTask07InventoryMedia({
    General: {media: catalogMedia},
  }), true);
  assert.equal(hasUntrustedTask07InventoryMedia({
    nested: {imagePath: canonicalPath},
  }), true);
  assert.equal(hasUntrustedTask07InventoryMedia({
    media: null,
    General: {media: null},
    imagePath: "",
  }), false);
});

test("ordinary inventory edits preserve trusted media and explicit null removes it", () => {
  const current = {
    id: "catalog-sword",
    media: catalogMedia,
    General: {
      Nome: "Sword",
      Rarita: "rare",
      media: catalogMedia,
    },
  };
  const edited = mergeUntrustedInventorySnapshotPatch(current, {
    General: {Nome: "Renamed sword"},
  });
  assert.equal(edited.media, catalogMedia);
  assert.equal(edited.General.media, catalogMedia);
  assert.equal(edited.General.Nome, "Renamed sword");
  assert.equal(edited.General.Rarita, "rare");

  const removed = mergeUntrustedInventorySnapshotPatch(current, {
    media: null,
    General: {
      Nome: "Sword without media",
      media: null,
    },
  });
  assert.equal(Object.hasOwn(removed, "media"), false);
  assert.equal(Object.hasOwn(removed.General, "media"), false);

  assert.throws(() => mergeUntrustedInventorySnapshotPatch(current, {
    media: {
      ...catalogMedia,
      assetId: `m_${"b".repeat(40)}`,
    },
  }), /task07-inventory-media-injection/);
});

test("legacy bridge strips injected media but preserves command-owned projections", () => {
  const projected = {
    media: catalogMedia,
    unexpectedSelector: canonicalPath,
    legacyManaged: true,
    acquisitionSnapshot: {
      id: "catalog-sword",
      media: {
        ...catalogMedia,
        assetId: `m_${"b".repeat(40)}`,
      },
      imagePath: canonicalPath.replace(assetId, `m_${"b".repeat(40)}`),
      General: {Nome: "Injected"},
    },
    currentSnapshot: {
      id: "catalog-sword",
      General: {
        Nome: "Injected",
        media: catalogMedia,
      },
    },
  };
  const stripped = hardenLegacyInventoryProjectionMedia(projected, {});
  assert.equal(Object.hasOwn(stripped, "media"), false);
  assert.equal(Object.hasOwn(stripped, "unexpectedSelector"), false);
  assert.equal(
    Object.hasOwn(stripped.acquisitionSnapshot, "media"),
    false
  );
  assert.equal(
    Object.hasOwn(stripped.acquisitionSnapshot, "imagePath"),
    false
  );
  assert.equal(
    Object.hasOwn(stripped.currentSnapshot.General, "media"),
    false
  );

  const trusted = hardenLegacyInventoryProjectionMedia(projected, {
    legacyManaged: false,
    acquisitionSnapshot: {
      id: "catalog-sword",
      media: catalogMedia,
      imagePath: canonicalPath,
    },
    currentSnapshot: {
      id: "catalog-sword",
      media: catalogMedia,
      imagePath: canonicalPath,
    },
  });
  assert.equal(trusted.acquisitionSnapshot.media, catalogMedia);
  assert.equal(trusted.acquisitionSnapshot.imagePath, canonicalPath);
  assert.equal(trusted.currentSnapshot.media, catalogMedia);
  assert.equal(trusted.currentSnapshot.imagePath, canonicalPath);

  const explicitlyRemoved = hardenLegacyInventoryProjectionMedia({
    legacyManaged: true,
    acquisitionSnapshot: {
      id: "catalog-sword",
      media: null,
    },
    currentSnapshot: {
      id: "catalog-sword",
      General: {
        Nome: "Media removed",
        media: null,
      },
    },
  }, {
    legacyManaged: false,
    acquisitionSnapshot: {
      id: "catalog-sword",
      media: catalogMedia,
    },
    currentSnapshot: {
      id: "catalog-sword",
      General: {media: catalogMedia},
    },
  });
  assert.equal(
    Object.hasOwn(explicitlyRemoved.acquisitionSnapshot, "media"),
    false
  );
  assert.equal(
    Object.hasOwn(explicitlyRemoved.currentSnapshot.General, "media"),
    false
  );
});

test("recursive stripping leaves legacy media and Firestore value objects intact", () => {
  class TimestampLike {
    constructor(seconds) {
      this.seconds = seconds;
    }
  }
  const timestamp = new TimestampLike(12);
  const stripped = stripUntrustedTask07InventoryMedia({
    media: catalogMedia,
    task07MediaRevision: 7,
    mediaUpdatedAt: {seconds: 7},
    videoMedia: {
      ...catalogMedia,
      assetId: `m_${"b".repeat(40)}`,
    },
    task07VideoMediaRevision: 8,
    videoMediaUpdatedAt: {seconds: 8},
    imagePath: canonicalPath,
    legacyImagePath: "items/legacy.png",
    General: {
      Nome: "Legacy item",
      media: catalogMedia,
      task07MediaRevision: 9,
    },
    updatedAt: timestamp,
  });
  [
    "media",
    "task07MediaRevision",
    "mediaUpdatedAt",
    "videoMedia",
    "task07VideoMediaRevision",
    "videoMediaUpdatedAt",
  ].forEach((field) => assert.equal(Object.hasOwn(stripped, field), false));
  assert.equal(Object.hasOwn(stripped.General, "media"), false);
  assert.equal(Object.hasOwn(stripped.General, "task07MediaRevision"), false);
  assert.equal(stripped.General.Nome, "Legacy item");
  assert.equal(Object.hasOwn(stripped, "imagePath"), false);
  assert.equal(stripped.legacyImagePath, "items/legacy.png");
  assert.equal(stripped.updatedAt, timestamp);
});

test("personal commands preserve trusted slots but keep the root projection legacy-only", () => {
  const videoMedia = {
    ...catalogMedia,
    assetId: `m_${"b".repeat(40)}`,
    kind: "spell-video",
  };
  const mediaUpdatedAt = {seconds: 10};
  const videoMediaUpdatedAt = {seconds: 11};
  const preserved = preserveTrustedTask07PersonalContent({
    Nome: "Luce",
    image_url: "spells/legacy-image.png",
    video_url: "spells/legacy-video.mp4",
  }, {
    media: catalogMedia,
    videoMedia,
    task07MediaRevision: 4,
    task07VideoMediaRevision: 7,
    mediaUpdatedAt,
    videoMediaUpdatedAt,
  });

  assert.equal(preserved.media, catalogMedia);
  assert.equal(preserved.videoMedia, videoMedia);
  assert.equal(preserved.task07MediaRevision, 4);
  assert.equal(preserved.task07VideoMediaRevision, 7);
  assert.equal(preserved.mediaUpdatedAt, mediaUpdatedAt);
  assert.equal(preserved.videoMediaUpdatedAt, videoMediaUpdatedAt);
  assert.equal(preserved.image_url, "spells/legacy-image.png");
  assert.equal(preserved.video_url, "spells/legacy-video.mp4");

  const projected = stripTask07PersonalContentProjection(preserved);
  [
    "media",
    "videoMedia",
    "task07MediaRevision",
    "task07VideoMediaRevision",
    "mediaUpdatedAt",
    "videoMediaUpdatedAt",
  ].forEach((field) => assert.equal(Object.hasOwn(projected, field), false));
  assert.equal(projected.image_url, "spells/legacy-image.png");
  assert.equal(projected.video_url, "spells/legacy-video.mp4");
});

test("personal commands reject client-supplied canonical slots and paths", () => {
  assert.throws(() => preserveTrustedTask07PersonalContent({
    Nome: "Injected",
    media: catalogMedia,
  }, {}), /task07-personal-media-injection/);
  assert.throws(() => preserveTrustedTask07PersonalContent({
    Nome: "Injected",
    media: null,
  }, {}), /task07-personal-media-injection/);
  assert.throws(() => preserveTrustedTask07PersonalContent({
    Nome: "Injected",
    nested: {imagePath: canonicalPath},
  }, {}), /task07-personal-media-injection/);
});
