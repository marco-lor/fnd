#!/usr/bin/env node

const path = require('path');
const {
  OWNED_PERFORMANCE_ENVIRONMENT,
  assertPerformanceProject,
  configureOwnedPerformanceEnvironment,
  projectId,
  resultsDir,
  sha256,
  writeJson,
} = require('./common');
const { buildUserDirectoryProjection } = require('../backfill-user-directory');

configureOwnedPerformanceEnvironment();
assertPerformanceProject(projectId);

const { withBackgroundTriggersDisabled } = require('./emulator-control');
const PERFORMANCE_STORAGE_BUCKET = `${projectId}.appspot.com`;

let auth;
let db;
let bucket;

const initializeAdmin = () => {
  if (db) return;
  const { initializeApp, getApps } = require('firebase-admin/app');
  const { getAuth } = require('firebase-admin/auth');
  const { getFirestore } = require('firebase-admin/firestore');
  const { getStorage } = require('firebase-admin/storage');
  const app = getApps()[0] || initializeApp({
    projectId,
    storageBucket: PERFORMANCE_STORAGE_BUCKET,
  });
  auth = getAuth(app);
  db = getFirestore(app);
  bucket = getStorage(app).bucket();
};

const FIXTURE_VERSION = 'fnd-performance-v1';
const FIXED_TIME = '2026-01-01T00:00:00.000Z';
const PASSWORD = 'PerfTest!123';
const BATCH_SIZE = 350;
const TASK06_OPERATION_KINDS = Object.freeze([
  'level-up-all',
  'set-parameter-locks',
  'delete-npc',
  'delete-encounter',
  'delete-grigliata-custom-token',
  'duplicate-foe',
]);
const TASK06_BACKEND_CONFIG = Object.freeze({
  schemaVersion: 1,
  derivedOwnerMode: 'authoritative',
  enabledOperationKinds: TASK06_OPERATION_KINDS,
});

const pad = (value, width = 4) => String(value).padStart(width, '0');
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const fixtureEmail = (uid) => `${uid}@example.test`;
const mediaUrl = (index) => {
  const objectName = `performance/image-${pad(index % 128, 3)}.svg`;
  return `${OWNED_PERFORMANCE_ENVIRONMENT.STORAGE_EMULATOR_HOST}/v0/b/${PERFORMANCE_STORAGE_BUCKET}/o/${encodeURIComponent(objectName)}?alt=media&token=performance-token`;
};

const accountDefinitions = [
  { uid: 'perf-new-player', role: 'player', characterCreationDone: false },
  { uid: 'perf-player', role: 'player', characterCreationDone: true },
  { uid: 'perf-dm', role: 'dm', characterCreationDone: true },
  { uid: 'perf-webmaster', role: 'webmaster', characterCreationDone: true },
  ...Array.from({ length: 4 }, (_, index) => ({
    uid: `perf-peer-${index + 2}`,
    role: 'player',
    characterCreationDone: true,
  })),
];

const buildInventory = (count) => Array.from({ length: count }, (_, index) => ({
  id: `item-${pad(index)}`,
  name: `Fixture item ${index}`,
  item_type: ['weapon', 'armatura', 'accessorio', 'consumabile'][index % 4],
  qty: 1,
  imageUrl: mediaUrl(index),
  General: { Nome: `Fixture item ${index}`, Costo: index % 100 },
  Specific: { fixtureIndex: index },
  Parametri: {},
}));

const buildUser = ({ uid, role = 'player', characterCreationDone = true }, index = 0) => ({
  uid,
  email: fixtureEmail(uid),
  role,
  characterId: characterCreationDone ? `Performance Hero ${index + 1}` : '',
  created_at: FIXED_TIME,
  flags: { characterCreationDone },
  imageUrl: mediaUrl(index),
  imagePath: `performance/image-${pad(index % 128, 3)}.svg`,
  settings: { grigliata_music_muted: false },
  stats: {
    level: 5,
    hpCurrent: 45,
    hpTotal: 50,
    manaCurrent: 24,
    manaTotal: 30,
    essenzaCurrent: 8,
    essenzaTotal: 10,
    shieldCurrent: 0,
    shieldTotal: 0,
    basePointsAvailable: 0,
    basePointsSpent: 20,
    combatTokensAvailable: 0,
    combatTokensSpent: 5,
    negativeBaseStatCount: 0,
  },
  Parametri: {
    Base: {
      Forza: { Base: 4, Anima: 0, Equip: 0, Mod: 0, Tot: 4 },
      Destrezza: { Base: 4, Anima: 0, Equip: 0, Mod: 0, Tot: 4 },
    },
    Combattimento: {
      Attacco: { Base: 4, Anima: 0, Equip: 0, Mod: 0, Tot: 4 },
      Difesa: { Base: 4, Anima: 0, Equip: 0, Mod: 0, Tot: 4 },
      Salute: { Base: 4, Anima: 0, Equip: 0, Mod: 0, Tot: 4 },
      Disciplina: { Base: 4, Anima: 0, Equip: 0, Mod: 0, Tot: 4 },
    },
    Special: {},
  },
  AltriParametri: { Anima_1: 'Spirito', Anima_4: 'Astuzia', Anima_7: 'Potenza' },
  inventory: uid === 'perf-player' ? buildInventory(500) : buildInventory(index % 8),
  equipped: {},
  spells: Array.from({ length: 20 }, (_, spellIndex) => ({ id: `spell-${spellIndex}`, nome: `Spell ${spellIndex}` })),
  tecniche: Array.from({ length: 20 }, (_, techniqueIndex) => ({ id: `technique-${techniqueIndex}`, nome: `Technique ${techniqueIndex}` })),
  lingue: [],
  conoscenze: [],
  professioni: [],
});

const buildCodex = () => Object.fromEntries(
  Array.from({ length: 20 }, (_, categoryIndex) => {
    const key = `categoria_${pad(categoryIndex, 2)}`;
    const values = Array.from({ length: 250 }, (_, itemIndex) => ({
      id: `${key}_${pad(itemIndex)}`,
      nome: `Codex ${categoryIndex}-${itemIndex}`,
      descrizione: `Deterministic fixture entry ${categoryIndex}-${itemIndex}`,
    }));
    return [key, values];
  })
);

const buildDocuments = () => {
  const documents = [];
  const add = (documentPath, data) => documents.push({ path: documentPath, data });

  add('app_config/task06_backend', TASK06_BACKEND_CONFIG);

  const primaryAccounts = new Map(accountDefinitions.map((account, index) => [account.uid, buildUser(account, index)]));
  for (let index = 0; index < 200; index += 1) {
    const uid = index < accountDefinitions.length ? accountDefinitions[index].uid : `perf-user-${pad(index)}`;
    const userData = primaryAccounts.get(uid) || buildUser({ uid }, index);
    add(`users/${uid}`, userData);
    // Bulk fixture writes intentionally suppress Functions triggers. Seed the
    // deterministic projection explicitly, then exercise the real trigger via
    // the readiness sentinel below.
    add(`user_directory/${uid}`, buildUserDirectoryProjection(userData));
  }

  add('utils/schema_pg', buildUser({ uid: 'schema', characterCreationDone: false }, 0));
  add('utils/varie', {
    starting_values: { hp: 10, mana: 5 },
    races_extra: { human: { extraAbilityCreation: 0, extraTokenCreation: 0 } },
    dadi: [4, 6, 8, 10, 12, 20],
    dadiAnimaByLevel: [null, 'd4', 'd4', 'd6', 'd6', 'd8', 'd8', 'd10', 'd10', 'd12', 'd12'],
    cost_params_combat: {
      Attacco: 1,
      Difesa: 1,
      Salute: 1,
      Disciplina: 1,
    },
  });
  add('utils/possible_lists', { roles: ['player', 'dm', 'webmaster'], ruoli: ['player', 'dm', 'webmaster'] });
  add('utils/tecniche_common', { tecniche: Array.from({ length: 250 }, (_, index) => ({ id: `technique-${index}`, nome: `Technique ${index}` })) });
  add('utils/spells_common', { spells: Array.from({ length: 250 }, (_, index) => ({ id: `spell-${index}`, nome: `Spell ${index}` })) });
  add('utils/codex', buildCodex());
  ['weapon', 'armatura', 'accessorio', 'consumabile', 'spell', 'tecnica'].forEach((schemaName) => {
    add(`utils/schema_${schemaName}`, { fixture: true, General: {}, Specific: {}, Parametri: {} });
  });

  for (let index = 0; index < 1000; index += 1) {
    add(`items/item-${pad(index)}`, {
      item_type: ['weapon', 'armatura', 'accessorio', 'consumabile'][index % 4],
      visibility: index % 10 === 0 ? 'custom' : 'all',
      allowed_users: index % 10 === 0 ? ['perf-player'] : [],
      imageUrl: mediaUrl(index),
      General: { Nome: `Bazaar item ${index}`, Costo: 1 + (index % 1000) },
      Specific: { fixtureIndex: index },
      Parametri: {},
      createdAt: FIXED_TIME,
    });
  }

  for (let index = 0; index < 500; index += 1) {
    add(`foes/foe-${pad(index)}`, {
      nome: `Fixture foe ${index}`,
      name: `Fixture foe ${index}`,
      category: ['minion', 'elite', 'boss'][index % 3],
      rank: String(1 + (index % 10)),
      dadoAnima: 'd8',
      imageUrl: mediaUrl(index),
      Parametri: {},
      stats: { hpCurrent: 20, hpTotal: 20, manaCurrent: 5, manaTotal: 5 },
      spells: [],
      tecniche: [],
      createdAt: FIXED_TIME,
    });
    add(`echi_npcs/npc-${pad(index)}`, {
      nome: `Fixture NPC ${index}`,
      imageUrl: mediaUrl(index),
      mapId: index % 2 === 0 ? 'art' : 'precisa',
      x: 5 + (index % 90),
      y: 5 + ((index * 7) % 90),
      createdAt: FIXED_TIME,
    });
  }

  for (let index = 0; index < 2000; index += 1) {
    add(`map_markers/marker-${pad(index, 5)}`, {
      text: `Marker ${index}`,
      mapId: index % 2 === 0 ? 'art' : 'precisa',
      x: 1 + (index % 98),
      y: 1 + ((index * 13) % 98),
      createdBy: 'perf-player',
      createdAt: FIXED_TIME,
    });
  }

  for (let encounterIndex = 0; encounterIndex < 100; encounterIndex += 1) {
    const encounterId = `encounter-${pad(encounterIndex)}`;
    const participantCount = encounterIndex === 0 ? 40 : 4;
    const participantIds = Array.from({ length: participantCount }, (_, index) => (
      index === 0 ? 'perf-player' : `perf-user-${pad((index + encounterIndex) % 200)}`
    ));
    add(`encounters/${encounterId}`, {
      name: `Encounter ${encounterIndex}`,
      status: 'active',
      createdAt: FIXED_TIME,
      participantIds,
      participantCharacterIds: participantIds.map((_, index) => `Performance Hero ${index + 1}`),
      turnIndex: 0,
    });
    for (let participantIndex = 0; participantIndex < participantCount; participantIndex += 1) {
      const uid = participantIds[participantIndex];
      add(`encounters/${encounterId}/participants/participant-${pad(participantIndex, 2)}`, {
        uid,
        userUid: uid,
        name: `Participant ${participantIndex}`,
        initiative: participantCount - participantIndex,
        hpCurrent: 20,
        hpTotal: 20,
      });
    }
    if (encounterIndex === 0) {
      for (let logIndex = 0; logIndex < 1000; logIndex += 1) {
        add(`encounters/${encounterId}/logs/log-${pad(logIndex, 5)}`, {
          message: `Fixture log ${logIndex}`,
          createdAt: FIXED_TIME,
          order: logIndex,
        });
      }
    }
  }

  add('grigliata_state/current', {
    activeBackgroundId: 'perf-map',
    presentationBackgroundId: '',
    presentationPlacements: [],
    gridVisible: true,
    updatedAt: FIXED_TIME,
  });
  add('grigliata_backgrounds/perf-map', {
    name: 'Performance map',
    imageUrl: mediaUrl(0),
    imagePath: 'performance/image-000.svg',
    assetType: 'image',
    galleryFolderId: '',
    width: 5000,
    height: 5000,
    grid: { cellSizePx: 50, offsetXPx: 0, offsetYPx: 0 },
    fogOfWarEnabled: true,
    createdAt: FIXED_TIME,
    updatedAt: FIXED_TIME,
  });
  add('grigliata_music_playback/current', { status: 'stopped', volume: 0.65, updatedAt: FIXED_TIME });

  for (let index = 0; index < 200; index += 1) {
    const ownerUid = index < 5 ? ['perf-player', 'perf-peer-2', 'perf-peer-3', 'perf-peer-4', 'perf-peer-5'][index] : `perf-user-${pad(index)}`;
    const tokenId = `perf-token-${pad(index)}`;
    add(`grigliata_tokens/${tokenId}`, {
      ownerUid,
      characterId: `Performance Hero ${index + 1}`,
      label: `Token ${index}`,
      imageUrl: mediaUrl(index),
      imagePath: `performance/image-${pad(index % 128, 3)}.svg`,
      tokenType: 'custom',
      customTokenRole: 'template',
      customTemplateId: tokenId,
      imageSource: 'uploaded',
      notes: '',
      stats: { hpCurrent: 20, hpTotal: 20, manaCurrent: 5, manaTotal: 5, shieldCurrent: 0, shieldTotal: 0 },
      updatedAt: FIXED_TIME,
      updatedBy: ownerUid,
    });
    add(`grigliata_token_placements/perf-map__${tokenId}`, {
      backgroundId: 'perf-map',
      tokenId,
      ownerUid,
      label: `Token ${index}`,
      imageUrl: mediaUrl(index),
      col: index % 20,
      row: Math.floor(index / 20),
      sizeSquares: 1,
      isVisibleToPlayers: true,
      isDead: false,
      statuses: [],
      updatedAt: FIXED_TIME,
      updatedBy: 'perf-dm',
    });
  }

  const walls = Array.from({ length: 200 }, (_, index) => ({
    id: `wall-${pad(index)}`,
    x1: (index % 20) * 200,
    y1: Math.floor(index / 20) * 200,
    x2: (index % 20) * 200 + 150,
    y2: Math.floor(index / 20) * 200 + 100,
    enabled: true,
    wallType: 'wall',
  }));
  add('grigliata_wall_state/perf-map', { backgroundId: 'perf-map', walls, updatedAt: FIXED_TIME });
  add('grigliata_background_lighting/perf-map', {
    lights: Array.from({ length: 10 }, (_, index) => ({ id: `light-${index}`, x: 200 + index * 300, y: 500, brightRadiusSquares: 3, dimRadiusSquares: 6 })),
    darknessSources: Array.from({ length: 10 }, (_, index) => ({ id: `dark-${index}`, x: 200 + index * 300, y: 1500, radiusSquares: 4 })),
    updatedAt: FIXED_TIME,
  });
  add('grigliata_lighting_render_inputs/perf-map', { walls, lights: [], darknessSources: [], updatedAt: FIXED_TIME });

  const fogMaskBase64 = Buffer.alloc(2048).toString('base64');
  for (let index = 0; index < 1024; index += 1) {
    const tileCol = index % 32;
    const tileRow = Math.floor(index / 32);
    const tileKey = `${tileCol}:${tileRow}`;
    const rasterProfileId = 'fog-raster-c8-s16-v1';
    add(`grigliata_fog_memory_tiles/perf-map__perf-player__${rasterProfileId}__${tileKey}`, {
      schemaVersion: 1,
      backgroundId: 'perf-map',
      ownerUid: 'perf-player',
      tileKey,
      tileCol,
      tileRow,
      rasterProfileId,
      tileSizeCells: 8,
      samplesPerCell: 16,
      cellSizePx: 50,
      offsetXPx: 0,
      offsetYPx: 0,
      maskEncoding: 'base64-bitset-v1',
      maskBase64: fogMaskBase64,
      updatedAt: new Date(FIXED_TIME),
      updatedBy: 'perf-dm',
    });
  }

  for (let index = 0; index < 500; index += 1) {
    add(`grigliata_music_tracks/track-${pad(index)}`, {
      name: `Track ${index}`,
      audioUrl: '',
      audioPath: '',
      contentType: 'audio/mpeg',
      sizeBytes: 8192,
      durationMs: 60000,
      createdAt: FIXED_TIME,
      updatedAt: FIXED_TIME,
    });
  }

  return documents.sort((left, right) => left.path.localeCompare(right.path));
};

const clearEmulators = async ({
  fetchImpl = global.fetch,
  getBucketImpl = () => bucket,
  initializeAdminImpl = initializeAdmin,
} = {}) => {
  initializeAdminImpl();
  const storageBucket = getBucketImpl();
  if (storageBucket?.name !== PERFORMANCE_STORAGE_BUCKET) {
    throw new Error(
      `Performance fixture cleanup requires Storage bucket ${PERFORMANCE_STORAGE_BUCKET}; `
      + `found ${storageBucket?.name || 'missing'}.`
    );
  }
  const endpoints = [
    `http://${OWNED_PERFORMANCE_ENVIRONMENT.FIREBASE_AUTH_EMULATOR_HOST}/emulator/v1/projects/${projectId}/accounts`,
    `http://${OWNED_PERFORMANCE_ENVIRONMENT.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${projectId}/databases/(default)/documents`,
  ];
  for (const endpoint of endpoints) {
    const response = await fetchImpl(endpoint, { method: 'DELETE' });
    if (!response.ok) throw new Error(`Failed to clear emulator at ${endpoint}: ${response.status}`);
  }
  try {
    await storageBucket.deleteFiles();
  } catch (error) {
    if (!/not found/i.test(error.message)) throw error;
  }
};

const seedAccounts = async () => {
  initializeAdmin();
  for (const account of accountDefinitions) {
    await auth.createUser({
      uid: account.uid,
      email: fixtureEmail(account.uid),
      password: PASSWORD,
      emailVerified: true,
      displayName: account.uid,
    });
  }
};

const seedStorage = async () => {
  initializeAdmin();
  const uploads = Array.from({ length: 128 }, (_, index) => async () => {
    const targetBytes = index < 112 ? 8192 : index < 126 ? 65536 : 524288;
    const prefix = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#${(index * 7919).toString(16).padStart(6, '0').slice(-6)}"/><text x="4" y="34">${index}</text><!--`;
    const suffix = '--></svg>';
    const padding = 'x'.repeat(Math.max(0, targetBytes - Buffer.byteLength(prefix) - Buffer.byteLength(suffix)));
    const contents = Buffer.from(`${prefix}${padding}${suffix}`);
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await bucket.file(`performance/image-${pad(index, 3)}.svg`).save(contents, {
          resumable: false,
          metadata: {
            contentType: 'image/svg+xml',
            metadata: { firebaseStorageDownloadTokens: 'performance-token' },
          },
        });
        return;
      } catch (error) {
        lastError = error;
        await delay(250 * attempt);
      }
    }
    throw lastError;
  });
  for (let offset = 0; offset < uploads.length; offset += 4) {
    await Promise.all(uploads.slice(offset, offset + 4).map((upload) => upload()));
  }
};

const writeDocuments = async (documents) => {
  initializeAdmin();
  for (let offset = 0; offset < documents.length; offset += BATCH_SIZE) {
    const batch = db.batch();
    for (const entry of documents.slice(offset, offset + BATCH_SIZE)) {
      batch.set(db.doc(entry.path), entry.data);
    }
    await batch.commit();
  }
};

const normalizeCanonical = (value) => {
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value.toDate === 'function') return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(normalizeCanonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalizeCanonical(value[key])]));
  }
  return value;
};

const buildManifest = (documents) => {
  const counts = documents.reduce((result, entry) => {
    const pathSegments = entry.path.split('/');
    if (pathSegments.length === 2) {
      const collectionName = pathSegments[0];
      result[collectionName] = (result[collectionName] || 0) + 1;
    }
    return result;
  }, {});
  const canonical = JSON.stringify(normalizeCanonical(documents));
  return { version: FIXTURE_VERSION, counts, hash: sha256(canonical), documentCount: documents.length };
};

const waitForFunctionsReady = async () => {
  initializeAdmin();
  // The demo Functions environment exports only the consolidated owner. Seed
  // its fail-closed control document before creating the readiness sentinel.
  await db.doc('app_config/task06_backend').set(TASK06_BACKEND_CONFIG);
  const readiness = db.doc('users/perf-function-readiness');
  const directory = db.doc('user_directory/perf-function-readiness');
  const readinessData = {
    characterId: '  Émulator Sentinel  ',
    role: 'player',
    Parametri: { Base: { Signal: { Base: 1, Anima: 0, Equip: 0, Mod: 0 } } },
    stats: { level: 1 },
  };
  const expectedDirectory = buildUserDirectoryProjection(readinessData);
  await readiness.set(readinessData);
  const deadline = Date.now() + 120_000;
  try {
    while (Date.now() < deadline) {
      const [snapshot, directorySnapshot] = await Promise.all([
        readiness.get(),
        directory.get(),
      ]);
      const projectedData = directorySnapshot.data();
      if (
        snapshot.data()?.Parametri?.Base?.Signal?.Tot === 1
        && directorySnapshot.exists
        && JSON.stringify(normalizeCanonical(projectedData))
          === JSON.stringify(normalizeCanonical(expectedDirectory))
      ) return;
      await delay(500);
    }
    throw new Error(
      'Functions emulator did not process derived fields and the user directory readiness sentinel within 120 seconds.'
    );
  } finally {
    await readiness.delete().catch(() => {});
    const deletionDeadline = Date.now() + 120_000;
    while (Date.now() < deletionDeadline) {
      if (!(await directory.get()).exists) break;
      await delay(500);
    }
    if ((await directory.get()).exists) {
      throw new Error('User directory readiness projection was not deleted within 120 seconds.');
    }
  }
};

const waitForDerivedState = async () => {
  let previousSignature = null;
  let stableChecks = 0;
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const users = await db.collection('users').get();
    const normalized = users.docs.map((snapshot) => ({
      id: snapshot.id,
      Parametri: snapshot.data().Parametri,
      stats: snapshot.data().stats,
    }));
    const totalsValid = normalized.every(({ Parametri = {} }) => (
      ['Base', 'Combattimento', 'Special'].every((section) => (
        Object.values(Parametri[section] || {}).every((parameter = {}) => (
          Number(parameter.Tot || 0) === ['Base', 'Anima', 'Equip', 'Mod']
            .reduce((total, key) => total + Number(parameter[key] || 0), 0)
        ))
      ))
    ));
    const signature = sha256(JSON.stringify(normalizeCanonical(normalized)));
    stableChecks = totalsValid && signature === previousSignature ? stableChecks + 1 : 0;
    if (stableChecks >= 2) return;
    previousSignature = signature;
    await delay(1000);
  }
  throw new Error('Functions-derived fixture fields did not reach a stable state within 120 seconds.');
};

const readLiveDocuments = async (documents) => {
  const live = [];
  for (let offset = 0; offset < documents.length; offset += 200) {
    const slice = documents.slice(offset, offset + 200);
    const references = [];
    for (const entry of slice) references.push(db.doc(entry.path));
    const snapshots = await db.getAll(...references);
    for (let index = 0; index < snapshots.length; index += 1) {
      const snapshot = snapshots[index];
      if (!snapshot.exists) throw new Error(`Fixture document is missing: ${slice[index].path}`);
      live.push({ path: slice[index].path, data: snapshot.data() });
    }
  }
  return live;
};

const verifyFixture = async () => {
  initializeAdmin();
  const metadata = await db.doc('perf_meta/fixture').get();
  if (!metadata.exists) throw new Error('Fixture metadata is missing. Run npm run perf:seed.');
  const manifest = metadata.data();
  const checks = ['users', 'user_directory', 'items', 'foes', 'echi_npcs', 'map_markers', 'encounters', 'grigliata_token_placements', 'grigliata_fog_memory_tiles'];
  for (const collectionName of checks) {
    const snapshot = await db.collection(collectionName).count().get();
    const actual = snapshot.data().count;
    const expected = manifest.counts[collectionName] || 0;
    if (actual !== expected) throw new Error(`${collectionName}: expected ${expected}, found ${actual}`);
  }
  const expectedDocuments = buildDocuments();
  const liveManifest = buildManifest(await readLiveDocuments(expectedDocuments));
  if (liveManifest.hash !== manifest.hash || liveManifest.documentCount !== manifest.documentCount) {
    throw new Error(`Canonical fixture mismatch: expected ${manifest.hash}, found ${liveManifest.hash}.`);
  }
  const authUsers = await auth.listUsers(1000);
  if (authUsers.users.length !== accountDefinitions.length) {
    throw new Error(`Auth fixture count mismatch: expected ${accountDefinitions.length}, found ${authUsers.users.length}.`);
  }
  const [storageFiles] = await bucket.getFiles({ prefix: 'performance/' });
  if (storageFiles.length !== 128) throw new Error(`Storage fixture count mismatch: expected 128, found ${storageFiles.length}.`);
  const report = { ...manifest, verifiedAt: new Date().toISOString(), projectId };
  writeJson(path.join(resultsDir, 'fixture-report.json'), report);
  console.log(`Fixture verified (${manifest.documentCount} documents, ${manifest.hash}).`);
  return report;
};

const writeFixtureMetadata = async (manifest) => {
  await db.doc('perf_meta/fixture').set(manifest);
};

const runSeedFixture = async ({
  waitForFunctionsReadyImpl = waitForFunctionsReady,
  withBackgroundTriggersDisabledImpl = withBackgroundTriggersDisabled,
  clearEmulatorsImpl = clearEmulators,
  seedAccountsImpl = seedAccounts,
  writeDocumentsImpl = writeDocuments,
  seedStorageImpl = seedStorage,
  waitForDerivedStateImpl = waitForDerivedState,
  writeFixtureMetadataImpl = writeFixtureMetadata,
  verifyFixtureImpl = verifyFixture,
  documents = buildDocuments(),
  manifest = buildManifest(documents),
} = {}) => {
  // Prove the Functions runtime before suppressing the bulk seed. Disabling
  // background triggers also flushes every event produced by this sentinel.
  await waitForFunctionsReadyImpl();

  await withBackgroundTriggersDisabledImpl(async () => {
    await clearEmulatorsImpl();
    await seedAccountsImpl();
    await writeDocumentsImpl(documents);
    await seedStorageImpl();
    await waitForDerivedStateImpl();
    await writeFixtureMetadataImpl(manifest);
  });

  // Re-enabling reloads trigger definitions. Exercise one real trigger, then
  // use an empty suppression scope as a deterministic queue flush so browser
  // scenarios never race fixture-derived background work.
  await waitForFunctionsReadyImpl();
  await withBackgroundTriggersDisabledImpl(async () => {});

  return verifyFixtureImpl();
};

const seedFixture = async () => {
  initializeAdmin();
  const documents = buildDocuments();
  const manifest = buildManifest(documents);
  return runSeedFixture({ documents, manifest });
};

if (require.main === module) {
  const command = process.argv[2];
  const operation = command === 'seed'
    ? seedFixture()
    : command === 'verify'
      ? verifyFixture()
      : command === 'determinism'
        ? Promise.resolve().then(() => {
          const first = buildManifest(buildDocuments());
          const second = buildManifest(buildDocuments());
          if (JSON.stringify(first) !== JSON.stringify(second)) throw new Error('Fixture generation is not deterministic.');
          console.log(`Fixture generator is deterministic (${first.documentCount} documents, ${first.hash}).`);
        })
        : null;
  if (!operation) {
    console.error('Usage: fixtures.js <seed|verify|determinism>');
    process.exit(1);
  }
  operation.catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}

module.exports = {
  buildDocuments,
  buildManifest,
  clearEmulators,
  FIXTURE_VERSION,
  PERFORMANCE_STORAGE_BUCKET,
  runSeedFixture,
  TASK06_BACKEND_CONFIG,
};
