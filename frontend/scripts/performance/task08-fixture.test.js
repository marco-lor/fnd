const test = require('node:test');
const assert = require('node:assert/strict');
const {
  TASK08_CONSUMABLE_INVENTORY_ID,
  TASK08_FIXTURE_ACCOUNT,
  TASK08_TWO_CLIENT_SESSION,
  buildDocuments,
} = require('./fixtures');

test('Task 08 fixture exposes a deterministic 500-item inventory and a real same-session pair', () => {
  const documents = buildDocuments();
  const inventory = documents.filter(({ path }) => (
    path.startsWith(`users/${TASK08_FIXTURE_ACCOUNT.uid}/inventory/`)
  ));
  assert.equal(inventory.length, 500);
  assert.equal(inventory.filter(({ path }) => path.endsWith(`/${TASK08_CONSUMABLE_INVENTORY_ID}`)).length, 1);

  assert.deepEqual(TASK08_TWO_CLIENT_SESSION, {
    clientA: { label: 'client-a', uid: TASK08_FIXTURE_ACCOUNT.uid },
    clientB: { label: 'client-b', uid: TASK08_FIXTURE_ACCOUNT.uid },
    distinctClients: true,
    environment: 'demo-fnd-perf',
  });
  assert.notEqual(TASK08_TWO_CLIENT_SESSION.clientA.label, TASK08_TWO_CLIENT_SESSION.clientB.label);
  assert.equal(TASK08_TWO_CLIENT_SESSION.clientA.uid, TASK08_TWO_CLIENT_SESSION.clientB.uid);
});

test('Task 08 character-creation fixture contains selectable anima configuration', () => {
  const varie = buildDocuments().find(({ path }) => path === 'utils/varie')?.data;

  assert.deepEqual(varie?.modAnima, {
    Spirito: { Forza: 1 },
  });
  assert.deepEqual(varie?.levelUpAnimaBonus, {
    Spirito: { Salute: 1 },
  });
});
