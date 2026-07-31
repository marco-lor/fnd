const test = require("node:test");
const assert = require("node:assert/strict");

const {
  stripTask07MediaFromDuplicatedFoe,
} = require("../lib/duplicateFoeWithAssetsCore");

test("duplicated foes never inherit canonical media bindings", () => {
  const rootMedia = {
    assetId: `m_${"a".repeat(40)}`,
    kind: "foe",
    original: {
      path: `media/v1/foe/dm/m_${"a".repeat(40)}/original/source.png`,
    },
  };
  const nestedMedia = {
    assetId: `m_${"b".repeat(40)}`,
    kind: "foe",
    original: {
      path: `media/v1/foe/dm/m_${"b".repeat(40)}/original/source.png`,
    },
  };
  const source = {
    name: "Source foe",
    media: rootMedia,
    mediaUpdatedAt: 123,
    task07MediaRevision: 7,
    videoMedia: rootMedia,
    videoMediaUpdatedAt: 456,
    task07VideoMediaRevision: 8,
    imagePath: "foes/source.png",
    imageUrl: "https://legacy.example/source.png",
    image_url: "https://legacy.example/source-alt.png",
    url: "https://legacy.example/source-url.png",
    downloadUrl: "https://legacy.example/source-download.png",
    General: {
      media: nestedMedia,
      mediaUpdatedAt: 321,
      task07MediaRevision: 9,
      videoMedia: nestedMedia,
      videoMediaUpdatedAt: 654,
      task07VideoMediaRevision: 10,
      imagePath: "foes/nested-source.png",
      imageUrl: "https://legacy.example/nested.png",
      image_url: "https://legacy.example/nested-alt.png",
      url: "https://legacy.example/nested-url.png",
      downloadUrl: "https://legacy.example/nested-download.png",
      label: "legacy metadata",
    },
    stats: {hpTotal: 12},
  };

  const copyable = stripTask07MediaFromDuplicatedFoe(source, {
    canonicalClone: true,
  });

  assert.equal(Object.hasOwn(copyable, "media"), false);
  assert.equal(Object.hasOwn(copyable.General, "media"), false);
  assert.equal(copyable.General.label, "legacy metadata");
  assert.deepEqual(copyable.stats, {hpTotal: 12});
  assert.equal(source.media, rootMedia);
  assert.equal(source.General.media, nestedMedia);
  for (const field of [
    `mediaUpdatedAt`,
    `task07MediaRevision`,
    `videoMedia`,
    `videoMediaUpdatedAt`,
    `task07VideoMediaRevision`,
    `imagePath`,
    `imageUrl`,
    `image_url`,
    `url`,
    `downloadUrl`,
  ]) {
    assert.equal(Object.hasOwn(copyable, field), false);
    assert.equal(Object.hasOwn(copyable.General, field), false);
  }
});

test("legacy foe duplication preserves media fields and unrelated General data", () => {
  const media = {assetId: `m_${"c".repeat(40)}`, state: "ready"};
  const source = {
    media,
    mediaUpdatedAt: 11,
    task07MediaRevision: 2,
    imagePath: "foes/legacy.png",
    imageUrl: "https://legacy.example/legacy.png",
    General: {
      media,
      task07MediaRevision: 2,
      image_url: "https://legacy.example/nested.png",
      label: "keep me",
    },
  };

  assert.deepEqual(stripTask07MediaFromDuplicatedFoe(source), source);
});
