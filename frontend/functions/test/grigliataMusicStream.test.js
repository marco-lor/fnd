const test = require("node:test");
const assert = require("node:assert/strict");
const {FieldValue} = require("firebase-admin/firestore");

test("writes timestamps without the legacy admin namespace", async (t) => {
  const admin = require("firebase-admin");
  const writes = [];
  const snapshots = {
    "utils/task07_media": {
      exists: true,
      data: () => ({
        schemaVersion: 1,
        policyVersion: 1,
        mode: "canonical-only",
        enabledPurposes: [],
        enabledRoles: [],
        enabledUids: [],
      }),
    },
    "grigliata_music_playback/current": {exists: false},
    "grigliata_music_stream/current": {exists: false},
  };
  const db = {
    collection: (name) => ({
      where: () => ({
        limit: () => ({kind: "query", name}),
      }),
    }),
    doc: (path) => ({kind: "document", path}),
    runTransaction: async (operation) => operation({
      get: async (target) => target.kind === "query" ?
        {docs: []} : snapshots[target.path],
      set: (reference, data) => writes.push({reference, data}),
    }),
  };
  const fakeFirestore = () => db;
  Object.defineProperty(admin, "firestore", {
    configurable: true,
    value: fakeFirestore,
  });
  t.after(() => {
    delete admin.firestore;
  });

  const modulePath = require.resolve("../lib/grigliataMusicStream");
  delete require.cache[modulePath];
  const {
    rebuildTask07GrigliataMusicStream,
  } = require("../lib/grigliataMusicStream");
  const result = await rebuildTask07GrigliataMusicStream();

  assert.equal(result.written, true);
  assert.equal(writes.length, 1);
  assert.equal(
    writes[0].data.updatedAt.isEqual(FieldValue.serverTimestamp()),
    true
  );
});
