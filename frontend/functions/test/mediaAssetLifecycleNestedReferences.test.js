const test = require("node:test");
const assert = require("node:assert/strict");

process.env.GCLOUD_PROJECT = "demo-fnd-perf";
process.env.FUNCTIONS_EMULATOR = "true";

const {
  mediaAssetIdsByTargetSlot,
} = require("../lib/mediaAssetLifecycle");

test("reference removal scan includes nested item and foe registry slots", () => {
  const image = `m_${"a".repeat(40)}`;
  const video = `m_${"b".repeat(40)}`;
  const root = `m_${"c".repeat(40)}`;
  assert.deepEqual(mediaAssetIdsByTargetSlot({
    media: {assetId: root},
    General: {
      spells: {Spark: {task07MediaEntryId: "entry1"}},
    },
    tecniche: [{task07MediaEntryId: "entry2"}],
    task07EmbeddedMedia: {
      entry1: {
        targetKind: "catalog-item-spell",
        media: {assetId: image},
        videoMedia: {assetId: video},
      },
      entry2: {
        targetKind: "foe-technique",
        media: {assetId: image},
      },
    },
  }), {
    media: [root, image],
    videoMedia: [video],
  });
  assert.deepEqual(mediaAssetIdsByTargetSlot(undefined), {
    media: [],
    videoMedia: [],
  });
});

test("removing the embedded entry makes its registry asset removable", () => {
  const image = `m_${"d".repeat(40)}`;
  const before = {
    spells: [{task07MediaEntryId: "foe-spell-1"}],
    task07EmbeddedMedia: {
      "foe-spell-1": {
        targetKind: "foe-spell",
        media: {assetId: image},
      },
    },
  };
  assert.deepEqual(mediaAssetIdsByTargetSlot(before).media, [image]);
  assert.deepEqual(mediaAssetIdsByTargetSlot({...before, spells: []}).media, []);
});

test("malformed nested registry values never fabricate asset IDs", () => {
  assert.deepEqual(mediaAssetIdsByTargetSlot({
    task07EmbeddedMedia: {
      broken: {media: {assetId: "not-canonical"}},
      scalar: "bad",
    },
  }), {media: [], videoMedia: []});
});
