const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDocuments, buildManifest, FIXTURE_VERSION } = require('./fixtures');

test('fixture generation is stable and contains the required scale', () => {
  const firstDocuments = buildDocuments();
  const secondDocuments = buildDocuments();
  const first = buildManifest(firstDocuments);
  const second = buildManifest(secondDocuments);
  assert.deepEqual(first, second);
  assert.equal(first.version, FIXTURE_VERSION);
  assert.equal(first.counts.users, 200);
  assert.equal(first.counts.items, 1000);
  assert.equal(first.counts.foes, 500);
  assert.equal(first.counts.echi_npcs, 500);
  assert.equal(first.counts.map_markers, 2000);
  assert.equal(first.counts.encounters, 100);
  assert.equal(first.counts.grigliata_token_placements, 200);
  assert.equal(first.counts.grigliata_fog_memory_tiles, 1024);
  assert.equal(new Set(firstDocuments.map((entry) => entry.path)).size, firstDocuments.length);
});
