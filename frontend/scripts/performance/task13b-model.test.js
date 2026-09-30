const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const {buildDocuments, FIXTURE_VERSION} = require('./fixtures');
const budgets = require('../../performance/budgets.json').task13Foes;
test('Task13B deterministic 500-foe first-page serialized budget (not network latency)', () => {
  const rows = buildDocuments().filter(row => row.path.startsWith('foes/')).map(row => ({id: row.path.split('/')[1], ...row.data}));
  const serialized = JSON.stringify(rows);
  assert.equal(createHash('sha256').update(serialized).digest('hex'), 'b80b237a1ca2b1093b724c66c55a9a3ccef26accb3d66703dee79539448b145e');
  const paged = rows.slice(0, 26).map(row => ({...row, task13OrderSeconds: 0}));
  const bytes = Buffer.byteLength(JSON.stringify(paged)), baselineBytes = Buffer.byteLength(serialized);
  assert.ok(paged.length <= budgets.maxSnapshotDocuments);
  assert.ok(bytes / baselineBytes <= budgets.maxSerializedRatio);
  console.log(JSON.stringify({fixture: FIXTURE_VERSION, baselineBytes, firstPageBytes: bytes,
    serializedRatio: bytes / baselineBytes, snapshotDocuments: paged.length, renderedRows: 25, initialThumbnails: 25}));
});
