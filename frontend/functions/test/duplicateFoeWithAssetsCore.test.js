const test = require("node:test");
const assert = require("node:assert/strict");

const {
  assessCanonicalOnlyFoeDuplication,
  canonicalFoeClonePlanBudgetIssue,
  classifyFoeNestedEntryIdentities,
  duplicateFoeNestedEntryId,
  foeDuplicationControlFenceMatches,
  foeHasNestedPersistedMedia,
  foeHasPersistedMedia,
  stripTask07MediaFromDuplicatedFoe,
} = require("../lib/duplicateFoeWithAssetsCore");

test("nested foe duplication rekeys media-free and retired entry identities", () => {
  const source = {
    tecniche: [{
      name: "No media",
      task07MediaEntryId: "source-technique",
    }],
    spells: [{
      name: "Retired media",
      task07MediaEntryId: "source-spell",
    }],
    task07EmbeddedMedia: {
      "source-spell": {
        targetKind: "foe-spell",
        task07MediaRevision: 3,
        mediaUpdatedAt: {seconds: 1, nanoseconds: 0},
      },
    },
  };

  assert.deepEqual(classifyFoeNestedEntryIdentities(source), {
    entries: [{
      kind: "foe-spell",
      entryIndex: 0,
      sourceEntryId: "source-spell",
      sourceAssetId: null,
    }, {
      kind: "foe-technique",
      entryIndex: 0,
      sourceEntryId: "source-technique",
      sourceAssetId: null,
    }],
    issue: null,
  });

  const techniqueId = duplicateFoeNestedEntryId({
    receiptId: "receipt-a",
    kind: "foe-technique",
    sourceEntryId: "source-technique",
  });
  const spellId = duplicateFoeNestedEntryId({
    receiptId: "receipt-a",
    kind: "foe-spell",
    sourceEntryId: "source-spell",
  });
  assert.match(techniqueId, /^n_[a-f0-9]{40}$/);
  assert.match(spellId, /^n_[a-f0-9]{40}$/);
  assert.notEqual(techniqueId, "source-technique");
  assert.notEqual(spellId, "source-spell");
  assert.notEqual(techniqueId, spellId);
  assert.equal(duplicateFoeNestedEntryId({
    receiptId: "receipt-a",
    kind: "foe-technique",
    sourceEntryId: "source-technique",
  }), techniqueId);
});

test("nested foe identity classification clones active media and blocks ambiguity", () => {
  const assetId = `m_${"a".repeat(40)}`;
  assert.deepEqual(classifyFoeNestedEntryIdentities({
    spells: [{task07MediaEntryId: "spell-active"}],
    task07EmbeddedMedia: {
      "spell-active": {
        targetKind: "foe-spell",
        media: {assetId},
      },
    },
  }), {
    entries: [{
      kind: "foe-spell",
      entryIndex: 0,
      sourceEntryId: "spell-active",
      sourceAssetId: assetId,
    }],
    issue: null,
  });
  for (const source of [{
    spells: [{task07MediaEntryId: "spell-wrong-kind"}],
    task07EmbeddedMedia: {
      "spell-wrong-kind": {targetKind: "foe-technique"},
    },
  }, {
    spells: [{
      task07MediaEntryId: "spell-declared",
      imagePath: "foes/spells/legacy.png",
    }],
  }, {
    spells: [{task07MediaEntryId: "spell-malformed"}],
    task07EmbeddedMedia: {
      "spell-malformed": {
        targetKind: "foe-spell",
        media: {assetId: "not-an-asset"},
      },
    },
  }]) {
    assert.deepEqual(classifyFoeNestedEntryIdentities(source), {
      entries: [],
      issue: "canonical-reference-invalid",
    });
  }
});

test("canonical foe clone plans are conservatively bounded", () => {
  const family = (objects = 5, padding = "") => ({
    entries: Array.from({length: objects}, (_, index) => ({index, padding})),
  });
  assert.equal(canonicalFoeClonePlanBudgetIssue(
    Array.from({length: 20}, () => family(5))
  ), null);
  assert.equal(canonicalFoeClonePlanBudgetIssue(
    Array.from({length: 21}, () => family(1))
  ), "too-many-families");
  assert.equal(canonicalFoeClonePlanBudgetIssue([family(101)]),
    "too-many-objects");
  assert.equal(canonicalFoeClonePlanBudgetIssue([
    family(1, "x".repeat(256 * 1024)),
  ]), "plan-too-large");
});

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
    tecniche: [{
      name: "Nested",
      task07MediaEntryId: "entry-a",
      imagePath: "foes/technique.png",
    }],
    task07EmbeddedMedia: {
      "entry-a": {media: nestedMedia, targetKind: "foe-technique"},
    },
  };

  const copyable = stripTask07MediaFromDuplicatedFoe(source, {
    canonicalClone: true,
  });

  assert.equal(Object.hasOwn(copyable, "media"), false);
  assert.equal(Object.hasOwn(copyable.General, "media"), false);
  assert.equal(copyable.General.label, "legacy metadata");
  assert.deepEqual(copyable.stats, {hpTotal: 12});
  assert.equal(Object.hasOwn(copyable, "task07EmbeddedMedia"), false);
  assert.equal(Object.hasOwn(copyable.tecniche[0], "task07MediaEntryId"), false);
  assert.equal(Object.hasOwn(copyable.tecniche[0], "imagePath"), false);
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

test("media-bearing detection fails closed across root, General, and nested aliases", () => {
  assert.equal(foeHasPersistedMedia({}), false);
  assert.equal(foeHasPersistedMedia({imagePath: ""}), false);
  assert.equal(foeHasPersistedMedia({imagePath: "foes/main/a.png"}), true);
  assert.equal(foeHasPersistedMedia({General: {media: {}}}), true);
  assert.equal(foeHasPersistedMedia({videoUrl: "https://example.test/a.mp4"}), true);
  assert.equal(foeHasPersistedMedia({
    tecniche: [{imageUrl: "https://example.test/technique.png"}],
  }), true);
  assert.equal(foeHasPersistedMedia({
    spells: [{media: {assetId: "malformed"}}],
  }), true);
  assert.equal(foeHasNestedPersistedMedia({
    spells: [{imagePath: "foes/spells/a.png"}],
  }), true);
  assert.equal(foeHasNestedPersistedMedia({
    imagePath: "foes/main/a.png",
  }), false);
  assert.equal(foeHasNestedPersistedMedia({
    spells: [{task07MediaEntryId: "spell-a"}],
    task07EmbeddedMedia: {
      "spell-a": {media: {assetId: `m_${"d".repeat(40)}`}},
    },
  }), true);
});

test("nested General media is detected and stripped for canonical clones", () => {
  const source = {
    tecniche: [{
      name: "General technique",
      task07MediaEntryId: "technique-entry",
      General: {
        media: {assetId: `m_${"a".repeat(40)}`},
        imageUrl: "https://legacy.example/technique.png",
        marker: "preserve",
      },
    }],
    spells: [{
      name: "General spell",
      General: {downloadUrl: "https://legacy.example/spell.png"},
    }],
  };
  assert.equal(foeHasNestedPersistedMedia(source), true);
  assert.deepEqual(assessCanonicalOnlyFoeDuplication(source, false, false), {
    allowed: false,
    reason: "nested-media-unsupported",
  });
  const stripped = stripTask07MediaFromDuplicatedFoe(source, {
    canonicalClone: true,
  });
  assert.equal(stripped.tecniche[0].task07MediaEntryId, undefined);
  assert.equal(stripped.tecniche[0].General.media, undefined);
  assert.equal(stripped.tecniche[0].General.imageUrl, undefined);
  assert.equal(stripped.tecniche[0].General.marker, "preserve");
  assert.equal(stripped.spells[0].General.downloadUrl, undefined);
});

test("Task 07 control fences bind both exact hash and effective mode", () => {
  const matching = {
    storedControlHash: "hash-a",
    storedMode: "canonical-only",
    currentControlHash: "hash-a",
    currentMode: "canonical-only",
  };
  assert.equal(foeDuplicationControlFenceMatches(matching), true);
  assert.equal(foeDuplicationControlFenceMatches({
    ...matching,
    currentControlHash: "hash-b",
  }), false);
  assert.equal(foeDuplicationControlFenceMatches({
    ...matching,
    currentMode: "v1-write",
  }), false);
  assert.equal(foeDuplicationControlFenceMatches({
    ...matching,
    storedControlHash: "",
  }), false);
});

test("canonical-only assessment requires one valid main clone and no nested media", () => {
  assert.deepEqual(
    assessCanonicalOnlyFoeDuplication({name: "No media"}, false),
    {allowed: true, reason: null}
  );
  assert.deepEqual(
    assessCanonicalOnlyFoeDuplication({imagePath: "foes/main/a.png"}, false),
    {allowed: false, reason: "canonical-media-required"}
  );
  assert.deepEqual(
    assessCanonicalOnlyFoeDuplication({media: {assetId: "canonical"}}, true),
    {allowed: true, reason: null}
  );
  assert.deepEqual(
    assessCanonicalOnlyFoeDuplication({
      media: {assetId: "canonical"},
      spells: [{imagePath: "foes/spells/a.png"}],
    }, true),
    {allowed: false, reason: "nested-media-unsupported"}
  );
  assert.deepEqual(
    assessCanonicalOnlyFoeDuplication({
      media: {assetId: "canonical"},
      spells: [{imagePath: "foes/spells/a.png"}],
    }, true, true),
    {allowed: true, reason: null}
  );
  assert.deepEqual(
    assessCanonicalOnlyFoeDuplication({
      spells: [{imagePath: "foes/spells/a.png"}],
    }, false, true),
    {allowed: true, reason: null}
  );
});
