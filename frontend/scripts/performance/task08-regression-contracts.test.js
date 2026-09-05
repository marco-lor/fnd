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

test('Home inventory settles the expanded media window before filtering it away', () => {
  const source = fs.readFileSync(
    path.join(frontendRoot, 'performance/tests/browser/task08-baseline.performance.js'),
    'utf8'
  );
  const expandedWindow = source.indexOf(
    'toBe(HOME_INVENTORY_INITIAL_WINDOW * 2);'
  );
  const mediaSettlement = source.indexOf(
    "'home inventory expanded window before filter'",
    expandedWindow
  );
  const filterInput = source.indexOf(
    "await search.fill('Fixture item 315');",
    expandedWindow
  );
  const restoredExpandedWindow = source.indexOf(
    'toBe(HOME_INVENTORY_INITIAL_WINDOW * 2);',
    expandedWindow + 1
  );
  const restoredMediaSettlement = source.indexOf(
    "'home restored inventory window before consumable'",
    restoredExpandedWindow
  );
  const consumableStart = source.indexOf(
    'await useFixtureConsumable(session.page);',
    restoredExpandedWindow
  );

  assert.ok(expandedWindow >= 0, 'Home scenario must expand the inventory window');
  assert.ok(
    mediaSettlement > expandedWindow && mediaSettlement < filterInput,
    'Home scenario must settle newly-mounted finite media before the filter unmounts it'
  );
  assert.ok(
    restoredMediaSettlement > restoredExpandedWindow
      && restoredMediaSettlement < consumableStart,
    'Home scenario must settle the restored media window before consumption resets it'
  );
});
