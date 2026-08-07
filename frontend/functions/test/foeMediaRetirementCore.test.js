const test = require("node:test");
const assert = require("node:assert/strict");

const {
  FoeMediaRetirementContractError,
  buildFoeRetirementFinalDocument,
  buildFoeRetirementUploadPlans,
  collectFoeLegacyStoragePaths,
  foeTimestampsMatch,
  legacyFoeCleanupCandidates,
  materializeFoeRetirementMutation,
  sanitizeFoeRetirementMutation,
} = require("../lib/foeMediaRetirementCore");

const current = {
  name: "Old foe",
  created_at: {seconds: 10, nanoseconds: 0},
  updated_at: {seconds: 20, nanoseconds: 5},
  imagePath: "foes/legacy-main.png",
  imageUrl: "https://legacy.example/main.png",
  media: {assetId: `m_${"a".repeat(40)}`},
  task07MediaRevision: 4,
  tecniche: [{
    name: "Old technique",
    imagePath: "foes/old-technique.png",
    imageUrl: "https://legacy.example/old-technique.png",
  }],
  spells: [],
  General: {
    label: "preserved",
    imagePath: "foes/general-fallback.png",
    media: {assetId: `m_${"a".repeat(40)}`},
  },
};

const mutation = {
  fields: {name: "Updated foe", stats: {hpTotal: 12}},
  tecniche: [{
    name: "Old technique",
    description: "description",
    danni: "1d6",
    effetti: "none",
    image: {
      mode: "keep",
      path: "foes/old-technique.png",
      url: "https://legacy.example/old-technique.png",
    },
  }],
  spells: [{
    name: "New spell",
    description: "description",
    danni: "2d6",
    effetti: "burn",
    image: {
      mode: "upload",
      key: "spells-0",
      sha256: "b".repeat(64),
      bytes: 1024,
      contentType: "image/png",
    },
  }],
};

test("sanitizer binds keep intents to the server document", () => {
  const sanitized = sanitizeFoeRetirementMutation({mutation, current});
  assert.deepEqual(sanitized.tecniche[0].image, {
    mode: "keep",
    path: "foes/old-technique.png",
    url: "https://legacy.example/old-technique.png",
  });
  assert.throws(
    () => sanitizeFoeRetirementMutation({
      current,
      mutation: {
        ...mutation,
        tecniche: [{
          ...mutation.tecniche[0],
          image: {
            mode: "keep",
            path: "foes/injected.png",
            url: "https://attacker.example/injected.png",
          },
        }],
      },
    }),
    (error) => error instanceof FoeMediaRetirementContractError &&
      error.code === "mutation-retained-image-mismatch"
  );
});

test("sanitizer rejects server fields, nested arrays, blobs, and extras", () => {
  for (const invalid of [
    {...mutation, fields: {...mutation.fields, updated_at: 1}},
    {...mutation, fields: {...mutation.fields, tecniche: []}},
    {...mutation, fields: {...mutation.fields, notes: "data:image/png;base64,x"}},
    {
      ...mutation,
      fields: {
        ...mutation.fields,
        notes:
          "https://firebasestorage.googleapis.com/v0/b/demo/o/" +
          "media_assets%2Fv1%2Fdm-only%2Fdm%2Fasset%2Foriginal?alt=media",
      },
    },
    {
      ...mutation,
      fields: {
        ...mutation.fields,
        nested: {assetId: `m_${"c".repeat(40)}`},
      },
    },
    {...mutation, unexpected: true},
    {
      ...mutation,
      spells: [{...mutation.spells[0], arbitrary: true}],
    },
  ]) {
    assert.throws(
      () => sanitizeFoeRetirementMutation({mutation: invalid, current}),
      FoeMediaRetirementContractError
    );
  }
});

test("upload planner is deterministic and server-owned", () => {
  const sanitized = sanitizeFoeRetirementMutation({mutation, current});
  const uploads = buildFoeRetirementUploadPlans({
    mutation: sanitized,
    actorUid: "dm-one",
    operationId: "retirement-operation-0001",
    receiptId: "receipt-one",
    foeId: "foe-one",
    assetId: `m_${"a".repeat(40)}`,
  });
  assert.equal(uploads.length, 1);
  assert.equal(
    uploads[0].path,
    `foes/task07-operations/dm-one/receipt-one/foe-one/` +
      `spells-0/${"b".repeat(64)}.png`
  );
  assert.deepEqual(Object.keys(uploads[0].metadata).sort(), [
    "task07ActorUid",
    "task07AssetId",
    "task07Bytes",
    "task07Digest",
    "task07FoeId",
    "task07OperationId",
    "task07ReceiptId",
    "task07Slot",
  ]);
});

test("materialization removes canonical aliases and preserves audit creation", () => {
  const sanitized = sanitizeFoeRetirementMutation({mutation, current});
  const materialized = materializeFoeRetirementMutation({
    mutation: sanitized,
    uploads: [{
      key: "spells-0",
      path: "foes/task07-operations/dm/receipt/foe/spells-0/hash.png",
      url: "https://storage.example/new.png",
      generation: "7",
    }],
  });
  const updatedAt = {seconds: 30, nanoseconds: 0};
  const finalDocument = buildFoeRetirementFinalDocument({
    current,
    materialized,
    revision: 4,
    updatedAt,
  });
  assert.equal(finalDocument.name, "Updated foe");
  assert.deepEqual(finalDocument.created_at, current.created_at);
  assert.equal(finalDocument.updated_at, updatedAt);
  assert.equal(finalDocument.task07MediaRevision, 5);
  assert.equal(Object.hasOwn(finalDocument, "media"), false);
  assert.equal(Object.hasOwn(finalDocument, "imagePath"), false);
  assert.equal(finalDocument.General.label, "preserved");
  assert.equal(Object.hasOwn(finalDocument.General, "media"), false);
  assert.equal(finalDocument.spells[0].imagePath.includes("task07-operations"), true);
});

test("legacy cleanup is an exact old-minus-final path set", () => {
  const after = {
    tecniche: [{
      imagePath: "foes/old-technique.png",
      imageUrl: "https://legacy.example/old-technique.png",
    }],
    spells: [{
      imageUrl:
        "https://firebasestorage.googleapis.com/v0/b/demo/o/" +
        "foes%2Fnew-spell.png?alt=media&token=t",
    }],
  };
  assert.deepEqual(collectFoeLegacyStoragePaths(after), [
    "foes/new-spell.png",
    "foes/old-technique.png",
  ]);
  assert.deepEqual(legacyFoeCleanupCandidates({before: current, after}), [
    "foes/general-fallback.png",
    "foes/legacy-main.png",
  ]);
});

test("timestamp fence compares seconds and nanoseconds exactly", () => {
  assert.equal(foeTimestampsMatch(
    {seconds: 20, nanoseconds: 5},
    {seconds: 20, nanoseconds: 5}
  ), true);
  assert.equal(foeTimestampsMatch(
    {seconds: 20, nanoseconds: 5},
    {seconds: 20, nanoseconds: 6}
  ), false);
  assert.equal(foeTimestampsMatch(null, null), true);
});
