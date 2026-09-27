const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { buildDocuments, buildManifest } = require('../../scripts/performance/fixtures');
const { projectLegacyCodex, restoreLegacyCodex, createPage } = require('../../src/data/codexModel');

test('Task12 deterministic 20/5000 serialized budget and exact page/consumer equality', () => {
  const documents = buildDocuments();
  const legacy = documents.find(x => x.path === 'utils/codex').data;
  const serialized = JSON.stringify(legacy);
  assert.equal(crypto.createHash('sha256').update(serialized).digest('hex'), '51ba5a4664489389e07a2edf29df450989dbc352ca8951bda4d85ce08a6e176c');
  assert.equal(Buffer.byteLength(serialized), 250941);
  const groups = projectLegacyCodex(legacy, 'en-US');
  assert.equal(groups.length, 20);
  assert.equal(groups.reduce((n, x) => n + x.items.length, 0), 5000);
  assert.deepEqual(restoreLegacyCodex(groups), legacy);
  const control = { schemaVersion: 2, mode: 'v2', epoch: 1, generation: 'fixture', metadataRevision: 1, collationLocale: 'en-US' };
  const metadata = groups.map(x => x.category).sort((a, b) => a.displayRank - b.displayRank);
  const active = groups.find(x => x.category.id === metadata[0].id);
  const sorted = [...active.items].sort((a, b) => a.displayRank - b.displayRank);
  const activeRows = sorted.slice(0, 26);
  // Full JSON payload including IDs/control deliberately overstates stored
  // document data. This is modeled serialization, never actual network bytes.
  const initialBytes = Buffer.byteLength(JSON.stringify({ control, metadata, items: activeRows }));
  // The active subscription also observes the compact category document for
  // revision changes; count its initial delivery even when SDK cache may reuse it.
  const listenerInitialBytes = Buffer.byteLength(JSON.stringify({ control, metadata, activeCategory: active.category, items: activeRows }));
  assert.ok(initialBytes <= Buffer.byteLength(serialized) * 0.1);
  assert.ok(listenerInitialBytes <= Buffer.byteLength(serialized) * 0.1);
  assert.equal(activeRows.length, 26);
  const page = createPage(activeRows, { control, category: active.category });
  assert.equal(page.items.length, 25);
  assert.equal(page.hasMore, true);
  let reached = 0;
  for (const group of groups) {
    const ordered = [...group.items].sort((a, b) => a.displayRank - b.displayRank);
    const collected = [];
    let cursor = null;
    do {
      const offset = cursor ? ordered.findIndex(row => row.id === cursor.id) + 1 : 0;
      const next = createPage(ordered.slice(offset, offset + 26), { control, category: group.category, cursor });
      collected.push(...next.items);
      cursor = next.cursor;
    } while (cursor);
    assert.deepEqual(collected, ordered);
    reached += collected.length;
  }
  assert.equal(reached, 5000);
  const untouched = JSON.stringify(groups.slice(1));
  active.items[0] = { ...active.items[0], value: 'One edited body', revision: 2 };
  active.category = { ...active.category, revision: 2 };
  assert.equal(JSON.stringify(groups.slice(1)), untouched);
  const editBytes = Buffer.byteLength(JSON.stringify([active.items[0], active.category]));
  console.log(JSON.stringify({ kind: 'modeled-serialized-not-network', fixtureHash: buildManifest(documents).hash,
    before: { serializedBytes: 250941, documents: 1, bodies: 5000 },
    after: { serializedBytes: initialBytes, documentDeliveries: 47, listenerSerializedBytes: listenerInitialBytes,
      listenerDocumentDeliveries: 48, itemBodies: 26, unrelatedBodies: 0, ratio: listenerInitialBytes / 250941 },
    oneItemEdit: { documentsWritten: 2, serializedBytes: editBytes, unrelatedCategoryBodies: 0 } }));
});
