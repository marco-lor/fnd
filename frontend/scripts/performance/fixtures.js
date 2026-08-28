#!/usr/bin/env node

const path = require('path');
const zlib = require('node:zlib');
const {
  OWNED_PERFORMANCE_ENVIRONMENT,
  assertPerformanceProject,
  configureOwnedPerformanceEnvironment,
  PERFORMANCE_STORAGE_BUCKET,
  projectId,
  resultsDir,
  sha256,
  writeJson,
} = require('./common');
const { buildUserDirectoryProjection } = require('../backfill-user-directory');
const { buildUserV2Plan } = require('../task05/user-data-model');

configureOwnedPerformanceEnvironment();
assertPerformanceProject(projectId);

const { withBackgroundTriggersDisabled } = require('./emulator-control');

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

const FIXTURE_VERSION = 'fnd-performance-v2-task05-runtime-retired-task07-media-codex-map';
const FUNCTIONS_READINESS_TIMEOUT_MS = 180_000;
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
const TASK07_MEDIA_CONTROL = Object.freeze({
  schemaVersion: 1,
  policyVersion: 1,
  mode: 'derivative-read',
  enabledPurposes: ['*'],
  enabledRoles: ['*'],
  enabledUids: ['*'],
});
const TASK07_EMPTY_MUSIC_STREAM = Object.freeze({
  schemaVersion: 2,
  controlMode: 'derivative-read',
  volume: 0.65,
  sessions: [],
});
const TASK07_EMPTY_MUSIC_STREAM_HASH = sha256(
  JSON.stringify(TASK07_EMPTY_MUSIC_STREAM)
);

const pad = (value, width = 4) => String(value).padStart(width, '0');
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const fixtureEmail = (uid) => `${uid}@example.test`;
const mediaUrl = (index) => {
  const objectName = `performance/image-${pad(index % 128, 3)}.png`;
  return `${OWNED_PERFORMANCE_ENVIRONMENT.STORAGE_EMULATOR_HOST}/v0/b/${PERFORMANCE_STORAGE_BUCKET}/o/${encodeURIComponent(objectName)}?alt=media&token=performance-token`;
};

const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');
const JPEG_FIXTURE = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EB//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EB//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EB//2Q==',
  'base64'
);
const WEBP_FIXTURE = Buffer.from(
  'UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAUAmJaQAA3AA/v89WAAAAA==',
  'base64'
);
const GIF_FIXTURE = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
  'base64'
);

const buildCrc32Table = () => Array.from({ length: 256 }, (_, value) => {
  let current = value;
  for (let bit = 0; bit < 8; bit += 1) {
    current = (current & 1) ? (0xedb88320 ^ (current >>> 1)) : (current >>> 1);
  }
  return current >>> 0;
});
const CRC32_TABLE = buildCrc32Table();

const crc32 = (contents) => {
  let checksum = 0xffffffff;
  for (const byte of contents) {
    checksum = CRC32_TABLE[(checksum ^ byte) & 0xff] ^ (checksum >>> 8);
  }
  return (checksum ^ 0xffffffff) >>> 0;
};

const pngChunk = (type, contents) => {
  const typeBytes = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(contents.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, contents])));
  return Buffer.concat([length, typeBytes, contents, checksum]);
};

const buildDeterministicPng = ({ width, height, seed = 0 }) => {
  const rowBytes = 1 + width * 3;
  const pixels = Buffer.alloc(rowBytes * height);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * rowBytes;
    pixels[rowOffset] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = rowOffset + 1 + x * 3;
      pixels[offset] = (seed * 29 + x * 3 + y) % 256;
      pixels[offset + 1] = (seed * 47 + x + y * 2) % 256;
      pixels[offset + 2] = (seed * 71 + x * 2 + y * 3) % 256;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(pixels, { level: 6 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
};

const buildOrientationSixJpeg = () => {
  const exif = Buffer.from(
    '4578696600004d4d002a00000008000101120003000000010006000000000000',
    'hex'
  );
  const segment = Buffer.alloc(4);
  segment.writeUInt16BE(0xffe1, 0);
  segment.writeUInt16BE(exif.length + 2, 2);
  return Buffer.concat([JPEG_FIXTURE.subarray(0, 2), segment, exif, JPEG_FIXTURE.subarray(2)]);
};

const buildShortWav = () => {
  const sampleRate = 8000;
  const sampleCount = 2000;
  const dataBytes = sampleCount * 2;
  const wav = Buffer.alloc(44 + dataBytes);
  wav.write('RIFF', 0, 'ascii');
  wav.writeUInt32LE(36 + dataBytes, 4);
  wav.write('WAVEfmt ', 8, 'ascii');
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36, 'ascii');
  wav.writeUInt32LE(dataBytes, 40);
  for (let index = 0; index < sampleCount; index += 1) {
    const sample = Math.round(Math.sin((index / sampleRate) * Math.PI * 440 * 2) * 4096);
    wav.writeInt16LE(sample, 44 + index * 2);
  }
  return wav;
};

const primaryImageDimensions = (index) => (
  index < 96 ? { width: 96, height: 96 }
    : index < 120 ? { width: 320, height: 240 }
      : index < 126 ? { width: 640, height: 360 }
        : { width: 768, height: 512 }
);

const buildDeterministicMediaObjects = () => [
  ...Array.from({ length: 128 }, (_, index) => ({
    caseId: 'valid-png',
    contentType: 'image/png',
    contents: buildDeterministicPng({ ...primaryImageDimensions(index), seed: index }),
    path: `performance/image-${pad(index, 3)}.png`,
  })),
  { caseId: 'valid-jpeg', contentType: 'image/jpeg', contents: JPEG_FIXTURE, path: 'performance/formats/valid.jpg' },
  { caseId: 'valid-webp', contentType: 'image/webp', contents: WEBP_FIXTURE, path: 'performance/formats/valid.webp' },
  { caseId: 'exif-orientation-6', contentType: 'image/jpeg', contents: buildOrientationSixJpeg(), path: 'performance/formats/orientation-6.jpg' },
  { caseId: 'corrupt-image', contentType: 'image/jpeg', contents: Buffer.from('not-a-jpeg'), path: 'performance/formats/corrupt.jpg' },
  { caseId: 'unsupported-gif', contentType: 'image/gif', contents: GIF_FIXTURE, path: 'performance/formats/unsupported.gif' },
  { caseId: 'short-audio', contentType: 'audio/wav', contents: buildShortWav(), path: 'performance/media/short.wav' },
  { caseId: 'video-poster', contentType: 'image/png', contents: buildDeterministicPng({ width: 384, height: 216, seed: 991 }), path: 'performance/media/video-poster.png' },
  { caseId: 'corrupt-video', contentType: 'video/mp4', contents: Buffer.from('000000186674797069736f6d00000200', 'hex'), path: 'performance/media/corrupt.mp4' },
];

const TASK07_STORAGE_OBJECT_COUNT = 136;

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

// Task 08 uses one stable account in two independent browser contexts. The
// consumable is an existing deterministic V2 inventory instance; its zero-roll
// fixture keeps the two-client atomicity probe independent from randomness.
const TASK08_FIXTURE_ACCOUNT = Object.freeze({
  uid: 'perf-player',
  role: 'player',
});
const TASK08_CONSUMABLE_INVENTORY_ID = 'legacy_0141de11bc577d0c2d9789b3_1_1';
const TASK08_TWO_CLIENT_SESSION = Object.freeze({
  clientA: Object.freeze({ label: 'client-a', uid: TASK08_FIXTURE_ACCOUNT.uid }),
  clientB: Object.freeze({ label: 'client-b', uid: TASK08_FIXTURE_ACCOUNT.uid }),
  distinctClients: true,
  environment: 'demo-fnd-perf',
});

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
  imagePath: `performance/image-${pad(index % 128, 3)}.png`,
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
    const values = Object.fromEntries(
      Array.from({ length: 250 }, (_, itemIndex) => ([
        `Codex ${categoryIndex}-${itemIndex}`,
        `Deterministic fixture entry ${categoryIndex}-${itemIndex}`,
      ]))
    );
    return [key, values];
  })
);

const buildDocuments = () => {
  const documents = [];
  const add = (documentPath, data) => documents.push({ path: documentPath, data });

  add('app_config/task06_backend', TASK06_BACKEND_CONFIG);
  add('utils/task07_media', TASK07_MEDIA_CONTROL);

  const primaryAccounts = new Map(accountDefinitions.map((account, index) => [account.uid, buildUser(account, index)]));
  for (let index = 0; index < 200; index += 1) {
    const uid = index < accountDefinitions.length ? accountDefinitions[index].uid : `perf-user-${pad(index)}`;
    const userData = primaryAccounts.get(uid) || buildUser({ uid }, index);
    const v2Plan = buildUserV2Plan(uid, userData);
    const fatalIssue = v2Plan.issues.find(({severity}) => severity === 'error');
    if (fatalIssue) {
      throw new Error(`Invalid V2 fixture projection for ${uid}: ${fatalIssue.code}`);
    }
    for (const document of v2Plan.documents) {
      if (document.path === `users/${uid}` || primaryAccounts.has(uid)) {
        add(document.path, document.data);
      }
    }
    // Bulk fixture writes intentionally suppress Functions triggers. Seed the
    // deterministic projection explicitly, then exercise the real trigger via
    // the readiness sentinel below.
    const shell = v2Plan.documents.find(({path: documentPath}) => documentPath === `users/${uid}`)?.data;
    add(`user_directory/${uid}`, buildUserDirectoryProjection(shell));
  }

  add('utils/schema_pg', buildUser({ uid: 'schema', characterCreationDone: false }, 0));
  add('utils/varie', {
    starting_values: { hp: 10, mana: 5 },
    races_extra: { human: { extraAbilityCreation: 0, extraTokenCreation: 0 } },
    modAnima: { Spirito: { Forza: 1 } },
    levelUpAnimaBonus: { Spirito: { Salute: 1 } },
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

  add('grigliata_gallery_folders/fixture-atlas-a', {
    name: 'Fixture Atlas A',
    normalizedName: 'fixture atlas a',
    createdAt: FIXED_TIME,
    updatedAt: FIXED_TIME,
  });
  add('grigliata_gallery_folders/fixture-atlas-b', {
    name: 'Fixture Atlas B',
    normalizedName: 'fixture atlas b',
    createdAt: FIXED_TIME,
    updatedAt: FIXED_TIME,
  });
  add('grigliata_state/current', {
    activeBackgroundId: 'perf-map',
    presentationBackgroundId: '',
    presentationPlacements: [],
    gridVisible: true,
    legacyTokenPlacementCleanupCompletedAt: FIXED_TIME,
    legacyPlacementDeadStateCleanupCompletedAt: FIXED_TIME,
    legacyPlacementVisibilityCleanupCompletedAt: FIXED_TIME,
    updatedAt: FIXED_TIME,
  });
  for (let index = 0; index < 50; index += 1) {
    const backgroundId = index === 0 ? 'perf-map' : `perf-map-${pad(index, 3)}`;
    add(`grigliata_backgrounds/${backgroundId}`, {
      name: `Performance map ${index + 1}`,
      imageUrl: mediaUrl(index),
      imagePath: `performance/image-${pad(index % 128, 3)}.png`,
      assetType: 'image',
      galleryFolderId: index < 25 ? 'fixture-atlas-a' : 'fixture-atlas-b',
      width: index < 48 ? 5000 : 7680,
      height: index < 48 ? 5000 : 4320,
      grid: { cellSizePx: 50, offsetXPx: 0, offsetYPx: 0 },
      fogOfWarEnabled: true,
      createdAt: FIXED_TIME,
      updatedAt: FIXED_TIME,
    });
  }
  add('grigliata_music_playback/current', {
    status: 'stopped',
    trackId: '',
    trackName: '',
    audioUrl: '',
    durationMs: 0,
    offsetMs: 0,
    volume: 0.65,
    startedAt: null,
    commandId: 'music_perf_fixture',
    updatedAt: FIXED_TIME,
    updatedBy: 'perf-dm',
  });
  add('grigliata_music_stream/current', {
    ...TASK07_EMPTY_MUSIC_STREAM,
    revision: 1,
    sourceHash: TASK07_EMPTY_MUSIC_STREAM_HASH,
    updatedAt: FIXED_TIME,
  });

  for (let index = 0; index < 200; index += 1) {
    const ownerUid = index < 5 ? ['perf-player', 'perf-peer-2', 'perf-peer-3', 'perf-peer-4', 'perf-peer-5'][index] : `perf-user-${pad(index)}`;
    const tokenId = `perf-token-${pad(index)}`;
    add(`grigliata_tokens/${tokenId}`, {
      ownerUid,
      characterId: `Performance Hero ${index + 1}`,
      label: `Token ${index}`,
      imageUrl: mediaUrl(index),
      imagePath: `performance/image-${pad(index % 128, 3)}.png`,
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
    backgroundId: 'perf-map',
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
  const objects = buildDeterministicMediaObjects();
  if (objects.length !== TASK07_STORAGE_OBJECT_COUNT) {
    throw new Error(
      `Task 07 fixture catalog expected ${TASK07_STORAGE_OBJECT_COUNT} objects; `
      + `built ${objects.length}.`
    );
  }
  for (const object of objects) {
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await bucket.file(object.path).save(object.contents, {
          resumable: false,
          metadata: {
            cacheControl: 'private, no-store',
            contentType: object.contentType,
            metadata: {
              firebaseStorageDownloadTokens: 'performance-token',
              task07FixtureCase: object.caseId,
            },
          },
        });
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        await delay(250 * attempt);
      }
    }
    if (lastError) throw lastError;
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
  return {
    version: FIXTURE_VERSION,
    counts,
    hash: sha256(canonical),
    documentCount: documents.length,
    storageObjectCount: TASK07_STORAGE_OBJECT_COUNT,
  };
};

const waitForFunctionsReady = async (
  timeoutMs = FUNCTIONS_READINESS_TIMEOUT_MS
) => {
  initializeAdmin();
  // Seed the fail-closed Task 06 control document before creating the
  // directory-projection readiness sentinel.
  await db.doc('app_config/task06_backend').set(TASK06_BACKEND_CONFIG);
  const readiness = db.doc('users/perf-function-readiness');
  const directory = db.doc('user_directory/perf-function-readiness');
  let readinessData = {
    characterId: '  Émulator Sentinel  ',
    role: 'player',
    schemaVersion: 2,
    summary: { level: 1 },
  };
  let expectedDirectory = buildUserDirectoryProjection(readinessData);
  await readiness.set(readinessData);
  const deadline = Date.now() + timeoutMs;
  let nextProbeAt = Date.now() + 3_000;
  let probeRevision = 0;
  try {
    while (Date.now() < deadline) {
      const [snapshot, directorySnapshot] = await Promise.all([
        readiness.get(),
        directory.get(),
      ]);
      const projectedData = directorySnapshot.data();
      if (
        snapshot.exists
        && directorySnapshot.exists
        && JSON.stringify(normalizeCanonical(projectedData))
          === JSON.stringify(normalizeCanonical(expectedDirectory))
      ) return;
      // The emulator's trigger-enable endpoint can return while the reloaded
      // Functions worker is still becoming ready. Periodically change a
      // projected shell field so a missed first event is retried naturally.
      if (Date.now() >= nextProbeAt) {
        probeRevision += 1;
        readinessData = {
          ...readinessData,
          characterId: `Émulator Sentinel ${probeRevision}`,
        };
        expectedDirectory = buildUserDirectoryProjection(readinessData);
        await readiness.set(readinessData);
        nextProbeAt = Date.now() + 3_000;
      }
      await delay(500);
    }
    throw new Error(
      `Functions emulator did not process the user directory readiness sentinel within ${timeoutMs} ms.`
    );
  } finally {
    await readiness.delete().catch(() => {});
    const deletionDeadline = Date.now() + timeoutMs;
    while (Date.now() < deletionDeadline) {
      if (!(await directory.get()).exists) break;
      await delay(500);
    }
    if ((await directory.get()).exists) {
      throw new Error(
        `User directory readiness projection was not deleted within ${timeoutMs} ms.`
      );
    }
  }
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
  const checks = ['users', 'user_directory', 'items', 'foes', 'echi_npcs', 'map_markers', 'encounters', 'grigliata_backgrounds', 'grigliata_gallery_folders', 'grigliata_token_placements', 'grigliata_fog_memory_tiles'];
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
  if (storageFiles.length !== TASK07_STORAGE_OBJECT_COUNT) {
    throw new Error(
      `Storage fixture count mismatch: expected ${TASK07_STORAGE_OBJECT_COUNT}, `
      + `found ${storageFiles.length}.`
    );
  }
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
  buildDeterministicMediaObjects,
  buildDeterministicPng,
  buildDocuments,
  buildManifest,
  buildShortWav,
  clearEmulators,
  FIXTURE_VERSION,
  PERFORMANCE_STORAGE_BUCKET,
  runSeedFixture,
  TASK08_CONSUMABLE_INVENTORY_ID,
  TASK08_FIXTURE_ACCOUNT,
  TASK08_TWO_CLIENT_SESSION,
  TASK06_BACKEND_CONFIG,
  TASK07_MEDIA_CONTROL,
  TASK07_STORAGE_OBJECT_COUNT,
};
