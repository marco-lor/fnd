#!/usr/bin/env node

/**
 * Deterministic Task 09A semantic fixture overlay.
 *
 * The normal performance fixture intentionally remains unchanged.  This
 * command snapshots only the owned demo emulator's items and perf-player
 * inventory, applies the richer Bazaar fields for a measurement window, and
 * restores the exact snapshot afterwards.
 */

const fs = require('node:fs');
const path = require('node:path');
const {
  assertPerformanceProject,
  configureOwnedPerformanceEnvironment,
  PERFORMANCE_STORAGE_BUCKET,
  projectId,
  resultsDir,
  readJson,
  sha256,
  writeJson,
} = require('./common');

configureOwnedPerformanceEnvironment();
assertPerformanceProject(projectId);

const TASK09A_OVERLAY_VERSION = 1;
const TASK09A_ITEM_COUNT = 1000;
const TASK09A_INVENTORY_COUNT = 500;
const TASK09A_ACTOR_UID = 'perf-player';
const TASK09A_OVERLAY_MARKER = `task09a-v${TASK09A_OVERLAY_VERSION}`;
const BACKUP_PATH = path.join(resultsDir, 'task09a-overlay-backup.json');
const BATCH_SIZE = 350;
const pad = (value, width = 4) => String(value).padStart(width, '0');

// The canonical fixture's directory projections are ordered by the generated
// label and then document ID.  Reconstruct that deterministic projection so
// the overlay report distinguishes first-page, later-page, and missing users.
const CANONICAL_PRIMARY_DIRECTORY_UIDS = [
  'perf-new-player',
  'perf-player',
  'perf-dm',
  'perf-webmaster',
  'perf-peer-2',
  'perf-peer-3',
  'perf-peer-4',
  'perf-peer-5',
];
const CANONICAL_DIRECTORY_ENTRIES = Array.from({ length: 200 }, (_, index) => {
  const uid = index < CANONICAL_PRIMARY_DIRECTORY_UIDS.length
    ? CANONICAL_PRIMARY_DIRECTORY_UIDS[index]
    : `perf-user-${pad(index)}`;
  return {
    uid,
    normalizedLabel: index === 0 ? 'unnamed character' : `performance hero ${index + 1}`,
  };
}).sort((left, right) => (
  left.normalizedLabel.localeCompare(right.normalizedLabel)
    || left.uid.localeCompare(right.uid)
));
const CANONICAL_FIRST_DIRECTORY_PAGE_UIDS = new Set(
  CANONICAL_DIRECTORY_ENTRIES.slice(0, 50).map(({ uid }) => uid)
);
const CANONICAL_DIRECTORY_UIDS = new Set(CANONICAL_DIRECTORY_ENTRIES.map(({ uid }) => uid));

const encodeValue = (value) => {
  if (value && typeof value.toDate === 'function') {
    return {
      __task09aType: 'timestamp',
      seconds: value.seconds?.toString?.() || String(value._seconds || 0),
      nanoseconds: Number(value.nanoseconds ?? value._nanoseconds ?? 0),
    };
  }
  if (Buffer.isBuffer(value)) {
    return { __task09aType: 'bytes', base64: value.toString('base64') };
  }
  if (Array.isArray(value)) return value.map(encodeValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, encodeValue(entry)]));
  }
  return value;
};

const decodeValue = (value) => {
  if (Array.isArray(value)) return value.map(decodeValue);
  if (value && typeof value === 'object') {
    if (value.__task09aType === 'timestamp') {
      const { Timestamp } = require('firebase-admin/firestore');
      return new Timestamp(Number(value.seconds), Number(value.nanoseconds || 0));
    }
    if (value.__task09aType === 'bytes') return Buffer.from(value.base64, 'base64');
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, decodeValue(entry)]));
  }
  return value;
};

const buildTask09aCatalogFields = (index) => {
  const itemType = ['weapon', 'armatura', 'accessorio', 'consumabile'][index % 4];
  const slot = ['main-hand', 'off-hand', 'body', 'ring'][index % 4];
  const tipo = ['steel', 'wood', 'arcane'][index % 3];
  const visibility = index % 10 === 0 ? 'custom' : 'all';
  const directoryUid = `perf-user-${pad((index * 13) % 200)}`;
  const allowedUsers = visibility === 'custom'
    ? (index % 20 === 0 ? [TASK09A_ACTOR_UID, directoryUid] : [directoryUid])
    : [];
  const sameName = index % 37 === 0;
  const name = sameName ? 'Task09A Shared Name' : `Task09A ${slot} ${pad(index)}`;
  const price = 5 + (index % 37);

  return {
    item_type: itemType,
    visibility,
    allowed_users: allowedUsers,
    normalizedName: name.toLocaleLowerCase(),
    General: {
      Nome: name,
      // Costo is retained on legacy-order rows so the contract proves that
      // old snapshots remain readable while prezzo is the purchase field.
      ...(index % 11 === 0 ? { Costo: String(price + 100) } : {}),
      prezzo: index % 17 === 0 ? String(price) : price,
      Slot: slot,
      spells: {
        [`Task09A Spell ${index}`]: { descrizione: `Embedded detail ${index}`, costo: 2 },
      },
    },
    Specific: {
      Hands: (index % 3) + 1,
      Tipo: tipo,
      fixtureIndex: index,
    },
    Parametri: {
      Special: {
        critico: index % 2 === 0 ? 0 : false,
        ...(index % 7 === 0 ? { elemento: tipo } : {}),
      },
      Combattimento: {
        Attacco: { '1': String((index * 3) % 11) },
        Difesa: { 1: (index * 5) % 9 },
      },
      Base: {
        Forza: { '1': (index * 7) % 13 },
        Destrezza: { 1: String((index * 11) % 17) },
      },
    },
    // These fields intentionally remain outside the summary projection.
    spells: [{ id: `task09a-spell-${index}`, nome: `Task09A Spell ${index}` }],
    tecniche: [{ id: `task09a-technique-${index}`, nome: `Task09A Technique ${index}` }],
    task09aFixture: {
      marker: TASK09A_OVERLAY_MARKER,
      index,
      directoryUid,
      hasCrossPageDirectoryUser: index % 20 === 0,
    },
  };
};

const overlayCatalogItem = (index, original = {}) => {
  const next = buildTask09aCatalogFields(index);
  return {
    ...original,
    ...next,
    General: { ...(original.General || {}), ...next.General },
    Specific: { ...(original.Specific || {}), ...next.Specific },
    Parametri: {
      ...(original.Parametri || {}),
      ...next.Parametri,
      Special: { ...(original.Parametri?.Special || {}), ...next.Parametri.Special },
      Combattimento: { ...(original.Parametri?.Combattimento || {}), ...next.Parametri.Combattimento },
      Base: { ...(original.Parametri?.Base || {}), ...next.Parametri.Base },
    },
  };
};

const overlayInventoryDocument = (index) => ({
  task09aFixture: {
    marker: TASK09A_OVERLAY_MARKER,
    index,
    catalogFieldsAvailable: true,
  },
});

const buildTask09aFixtureSummary = ({ itemCount = TASK09A_ITEM_COUNT, inventoryCount = TASK09A_INVENTORY_COUNT } = {}) => {
  const items = Array.from({ length: itemCount }, (_, index) => ({
    id: `item-${pad(index)}`,
    ...buildTask09aCatalogFields(index),
  }));
  const visibleToPlayer = items.filter((item) => (
    item.visibility === 'all'
    || item.allowed_users.includes(TASK09A_ACTOR_UID)
  ));
  const directoryReferences = items
    .filter((item) => item.task09aFixture.hasCrossPageDirectoryUser)
    .map((item) => item.task09aFixture.directoryUid);
  const directoryReferenceCounts = directoryReferences.reduce((counts, uid) => {
    const bucket = !CANONICAL_DIRECTORY_UIDS.has(uid)
      ? 'missing'
      : CANONICAL_FIRST_DIRECTORY_PAGE_UIDS.has(uid)
        ? 'firstPage'
        : 'laterPage';
    counts[bucket] += 1;
    return counts;
  }, { firstPage: 0, laterPage: 0, missing: 0 });
  return {
    overlayVersion: TASK09A_OVERLAY_VERSION,
    itemCount,
    inventoryCount,
    visibleToPlayerCount: visibleToPlayer.length,
    prezzoCount: items.filter((item) => item.General.prezzo != null).length,
    legacyCostoCount: items.filter((item) => item.General.Costo != null).length,
    embeddedDetailCount: items.filter((item) => Object.keys(item.General.spells || {}).length).length,
    customDeniedToPlayerCount: items.filter((item) => (
      item.visibility === 'custom' && !item.allowed_users.includes(TASK09A_ACTOR_UID)
    )).length,
    crossPageDirectoryUserCount: directoryReferenceCounts.laterPage,
    directoryReferenceCounts,
    levelOneScoreSample: {
      combat: items[1].Parametri.Combattimento.Attacco['1'],
      base: items[1].Parametri.Base.Forza['1'],
    },
    sourceHash: sha256(JSON.stringify(items)),
  };
};

const initializeAdmin = () => {
  const { initializeApp, getApps } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const app = getApps()[0] || initializeApp({ projectId, storageBucket: PERFORMANCE_STORAGE_BUCKET });
  return getFirestore(app);
};

const getSnapshots = async (db) => {
  const [itemsSnapshot, inventorySnapshot] = await Promise.all([
    db.collection('items').get(),
    db.collection(`users/${TASK09A_ACTOR_UID}/inventory`).get(),
  ]);
  return {
    items: itemsSnapshot.docs.map((snapshot) => ({ path: snapshot.ref.path, data: encodeValue(snapshot.data()) })),
    inventory: inventorySnapshot.docs.map((snapshot) => ({ path: snapshot.ref.path, data: encodeValue(snapshot.data()) })),
  };
};

const writeDocuments = async (db, documents, { merge = false } = {}) => {
  for (let offset = 0; offset < documents.length; offset += BATCH_SIZE) {
    const batch = db.batch();
    documents.slice(offset, offset + BATCH_SIZE).forEach(({ path: documentPath, data }) => {
      batch.set(db.doc(documentPath), data, merge ? { merge: true } : undefined);
    });
    await batch.commit();
  }
};

const assertOverlayData = (backup) => {
  if (!backup || backup.schemaVersion !== 1 || !Array.isArray(backup.items) || !Array.isArray(backup.inventory)) {
    throw new Error('Task09A overlay backup is malformed or uses an unsupported schema.');
  }
  if (backup.items.length !== TASK09A_ITEM_COUNT) {
    throw new Error(`Task09A overlay requires ${TASK09A_ITEM_COUNT} item documents; found ${backup.items.length}.`);
  }
  if (backup.inventory.length !== TASK09A_INVENTORY_COUNT) {
    throw new Error(`Task09A overlay requires ${TASK09A_INVENTORY_COUNT} inventory documents; found ${backup.inventory.length}.`);
  }
};

const applyOverlay = async () => {
  if (fs.existsSync(BACKUP_PATH)) {
    throw new Error(`Task09A overlay backup already exists at ${BACKUP_PATH}; restore it before applying again.`);
  }
  const db = initializeAdmin();
  const snapshots = await getSnapshots(db);
  const backup = {
    schemaVersion: 1,
    overlayVersion: TASK09A_OVERLAY_VERSION,
    projectId,
    generatedAt: new Date().toISOString(),
    ...snapshots,
  };
  assertOverlayData(backup);
  backup.sourceHash = sha256(JSON.stringify({ items: backup.items, inventory: backup.inventory }));
  writeJson(BACKUP_PATH, backup);

  await writeDocuments(db, snapshots.items.map((document, index) => ({
    path: document.path,
    data: overlayCatalogItem(index, decodeValue(document.data)),
  })), { merge: false });
  await writeDocuments(db, snapshots.inventory.map((document, index) => ({
    path: document.path,
    data: overlayInventoryDocument(index),
  })), { merge: true });
  return { backupPath: BACKUP_PATH, summary: buildTask09aFixtureSummary() };
};

const restoreOverlay = async () => {
  if (!fs.existsSync(BACKUP_PATH)) {
    throw new Error(`Task09A overlay backup does not exist at ${BACKUP_PATH}.`);
  }
  const backup = readJson(BACKUP_PATH);
  assertOverlayData(backup);
  if (backup.projectId !== projectId) {
    throw new Error(`Task09A overlay backup belongs to ${backup.projectId}, not ${projectId}.`);
  }
  const db = initializeAdmin();
  await writeDocuments(db, [...backup.items, ...backup.inventory].map(({ path: documentPath, data }) => ({
    path: documentPath,
    data: decodeValue(data),
  })));
  const restored = await getSnapshots(db);
  // Compare canonical JSON values, independent of Firestore map key ordering.
  const canonical = (value) => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  const expectedHash = sha256(JSON.stringify(canonical({ items: backup.items, inventory: backup.inventory })));
  const restoredHash = sha256(JSON.stringify(canonical(restored)));
  if (restoredHash !== expectedHash) throw new Error('Task09A exact fixture restoration verification failed; backup retained.');
  writeJson(path.join(resultsDir, 'task09a-restoration.json'), { expectedHash, restoredHash, exact: true, items: restored.items.length, inventory: restored.inventory.length });
  fs.unlinkSync(BACKUP_PATH);
  return { restoredItems: backup.items.length, restoredInventory: backup.inventory.length };
};

const inspectOverlay = async () => {
  const db = initializeAdmin();
  const snapshots = await getSnapshots(db);
  const markedItems = snapshots.items.filter(({ data }) => data.task09aFixture?.marker === TASK09A_OVERLAY_MARKER);
  const markedInventory = snapshots.inventory.filter(({ data }) => data.task09aFixture?.marker === TASK09A_OVERLAY_MARKER);
  return {
    projectId,
    backupPresent: fs.existsSync(BACKUP_PATH),
    itemCount: snapshots.items.length,
    inventoryCount: snapshots.inventory.length,
    markedItemCount: markedItems.length,
    markedInventoryCount: markedInventory.length,
    overlayActive: markedItems.length === TASK09A_ITEM_COUNT && markedInventory.length === TASK09A_INVENTORY_COUNT,
  };
};

const main = async () => {
  const operation = process.argv[2] || 'status';
  let result;
  if (operation === 'apply') result = await applyOverlay();
  else if (operation === 'restore') result = await restoreOverlay();
  else if (operation === 'status') result = await inspectOverlay();
  else throw new Error(`Unknown Task09A overlay operation: ${operation}. Use apply, restore, or status.`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
};

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  BACKUP_PATH,
  TASK09A_ACTOR_UID,
  TASK09A_INVENTORY_COUNT,
  TASK09A_ITEM_COUNT,
  TASK09A_OVERLAY_MARKER,
  TASK09A_OVERLAY_VERSION,
  buildTask09aCatalogFields,
  buildTask09aFixtureSummary,
  applyOverlay,
  overlayCatalogItem,
  overlayInventoryDocument,
  restoreOverlay,
};
