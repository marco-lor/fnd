const test = require("node:test");
const assert = require("node:assert/strict");

const {
  hardenLegacyInventoryProjectionMedia,
  hasUntrustedTask07InventoryMedia,
  isTask07CanonicalStoragePath,
  mergeUntrustedInventorySnapshotPatch,
  stripUntrustedTask07InventoryMedia,
} = require("../lib/task07ServerBoundary");

const assetId = `m_${"a".repeat(40)}`;
const canonicalPath = (
  `media/v1/item/dm-one/${assetId}/original/source.png`
);
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
    imagePath: canonicalPath,
    legacyImagePath: "items/legacy.png",
    updatedAt: timestamp,
  });
  assert.equal(Object.hasOwn(stripped, "media"), false);
  assert.equal(Object.hasOwn(stripped, "imagePath"), false);
  assert.equal(stripped.legacyImagePath, "items/legacy.png");
  assert.equal(stripped.updatedAt, timestamp);
});
