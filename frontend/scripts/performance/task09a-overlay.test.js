const test = require('node:test');
const assert = require('node:assert/strict');
const {
  TASK09A_ACTOR_UID,
  TASK09A_INVENTORY_COUNT,
  TASK09A_ITEM_COUNT,
  TASK09A_OVERLAY_MARKER,
  buildTask09aCatalogFields,
  buildTask09aFixtureSummary,
  overlayCatalogItem,
  overlayInventoryDocument,
} = require('./task09a-overlay');

test('Task09A overlay is deterministic at the canonical 1000/500 scale', () => {
  const first = buildTask09aFixtureSummary();
  const second = buildTask09aFixtureSummary();
  assert.deepEqual(first, second);
  assert.equal(first.itemCount, TASK09A_ITEM_COUNT);
  assert.equal(first.inventoryCount, TASK09A_INVENTORY_COUNT);
  assert.equal(first.prezzoCount, 1000);
  assert.equal(first.legacyCostoCount, 91);
  assert.equal(first.embeddedDetailCount, 1000);
  assert.equal(first.customDeniedToPlayerCount, 50);
  assert.equal(first.crossPageDirectoryUserCount, 30);
  assert.deepEqual(first.directoryReferenceCounts, { firstPage: 15, laterPage: 30, missing: 5 });
  assert.match(first.sourceHash, /^[a-f0-9]{64}$/);
});

test('overlay preserves source fields but gives every item real facets, params, price, and detail payload', () => {
  const original = {
    imageUrl: 'fixture-image',
    createdAt: 'fixed',
    General: { Costo: 99 },
    Specific: { legacy: true },
    Parametri: { Legacy: { old: true } },
  };
  const next = overlayCatalogItem(20, original);
  assert.equal(next.imageUrl, 'fixture-image');
  assert.equal(next.createdAt, 'fixed');
  assert.equal(next.task09aFixture.marker, TASK09A_OVERLAY_MARKER);
  assert.equal(next.General.Costo, 99);
  assert.equal(next.General.prezzo, 25);
  assert.equal(next.General.Slot, 'main-hand');
  assert.equal(next.Specific.Hands, 3);
  assert.equal(next.Specific.Tipo, 'arcane');
  assert.equal(next.Parametri.Legacy.old, true);
  assert.equal(next.Parametri.Combattimento.Attacco['1'], '5');
  assert.equal(next.Parametri.Base.Forza['1'], 10);
  assert.equal(next.spells.length, 1);
  assert.equal(Object.keys(next.General.spells).length, 1);
  assert.equal(next.General.spells['Task09A Spell 20'].descrizione, 'Embedded detail 20');
  assert.equal(next.tecniche.length, 1);
  assert.equal(next.visibility, 'custom');
  assert.deepEqual(next.allowed_users, [TASK09A_ACTOR_UID, 'perf-user-0060']);
});

test('denied custom rows and directory-page references are deterministic', () => {
  const denied = buildTask09aCatalogFields(10);
  const allowed = buildTask09aCatalogFields(20);
  assert.equal(denied.visibility, 'custom');
  assert.equal(denied.allowed_users.includes(TASK09A_ACTOR_UID), false);
  assert.equal(allowed.allowed_users.includes(TASK09A_ACTOR_UID), true);
  assert.equal(allowed.task09aFixture.hasCrossPageDirectoryUser, true);
  assert.equal(allowed.task09aFixture.directoryUid, 'perf-user-0060');
});

test('inventory overlay is bounded and reversible as a merge-only marker', () => {
  assert.equal(TASK09A_INVENTORY_COUNT, 500);
  assert.deepEqual(overlayInventoryDocument(499), {
    task09aFixture: {
      marker: TASK09A_OVERLAY_MARKER,
      index: 499,
      catalogFieldsAvailable: true,
    },
  });
});
