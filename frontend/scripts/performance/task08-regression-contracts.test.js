const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  TASK08_REGRESSION_CONTRACTS,
} = require('./task08-contract');
const { buildInventoryDocuments } = require('../task05/user-data-model');

const frontendRoot = path.resolve(__dirname, '..', '..');

test('Task 08 regression matrix keeps every gameplay boundary tied to a source and suite', () => {
  for (const [name, contract] of Object.entries(TASK08_REGRESSION_CONTRACTS)) {
    assert.ok(contract.source, `${name} needs a source`);
    assert.ok(contract.tests.length > 0, `${name} needs a behavior suite`);
    const source = fs.readFileSync(path.join(frontendRoot, contract.source), 'utf8');
    for (const marker of contract.markers) {
      assert.ok(source.includes(marker), `${name} lost marker ${marker}`);
    }
    for (const suite of contract.tests) {
      assert.ok(fs.existsSync(path.join(frontendRoot, suite)), `${name} lost suite ${suite}`);
    }
  }
});

test('inventory history retains acquisition and current snapshots across unit projection', () => {
  const sourceSnapshot = {
    id: 'contract-sword',
    item_type: 'weapon',
    General: { Nome: 'Contract sword' },
    Specific: { fixtureIndex: 8 },
  };
  const documents = buildInventoryDocuments('task08-contract-user', [{
    ...sourceSnapshot,
    qty: 2,
    _instance: { instanceId: 'contract-sword-instance', source: 'fixture' },
  }]);

  assert.equal(documents.length, 2);
  assert.notEqual(documents[0].id, documents[1].id);
  for (const document of documents) {
    assert.deepEqual(document.data.acquisitionSnapshot, sourceSnapshot);
    assert.deepEqual(document.data.currentSnapshot, sourceSnapshot);
    assert.equal(document.data.currentRevision, 1);
    assert.equal(document.data.acquisitionHash, document.data.currentHash);
  }
});
