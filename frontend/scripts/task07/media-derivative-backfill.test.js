'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  assertReadOnlyTarget,
  buildLegacyMediaBackfillPlan,
  collectMediaPaths,
  isCanonicalTask07Path,
  loadLegacyMediaRecords,
  parseOptions,
  storagePathFromValue,
} = require('./media-derivative-backfill');

test('backfill path parsing redacts Firebase download tokens', () => {
  const path = 'characters/avatar_user-a.png';
  const url = `https://firebasestorage.googleapis.com/v0/b/demo/o/` +
    `${encodeURIComponent(path)}?alt=media&token=must-not-leak`;
  assert.equal(storagePathFromValue(url), path);
  assert.deepEqual(collectMediaPaths({imageUrl: url}), [path]);
});

test('versioned media is excluded while nested legacy media is planned', () => {
  const canonical = 'media/v1/foe/dm/m_1234567890abcdef1234567890abcdef12345678/' +
    'original/source.png';
  assert.equal(isCanonicalTask07Path(canonical), true);
  const paths = collectMediaPaths({
    media: {
      schemaVersion: 1,
      original: {path: canonical},
    },
    spells: [
      {imagePath: 'foes/dm/legacy-spell.png'},
    ],
  });
  assert.deepEqual(paths, ['foes/dm/legacy-spell.png']);
});

test('dry-run plan is deterministic, deduplicated, and blocks unknown owners', () => {
  const records = [
    {
      kind: 'avatar',
      ownerUid: 'player-one',
      entityId: 'player-one',
      data: {imagePath: 'characters/avatar_player-one.png'},
    },
    {
      kind: 'avatar',
      ownerUid: 'player-one',
      entityId: 'player-one',
      data: {imageUrl: 'characters/avatar_player-one.png'},
    },
    {
      kind: 'npc',
      ownerUid: '',
      entityId: 'npc-one',
      data: {imagePath: 'legacy/unowned-npc.png'},
    },
    {
      kind: 'map',
      ownerUid: '',
      entityId: 'map-one',
      data: {imagePath: 'grigliata/backgrounds/dm-one/map.png'},
    },
  ];
  const report = buildLegacyMediaBackfillPlan(records);
  assert.equal(report.mode, 'dry-run');
  assert.deepEqual(report.counts, {
    records: 4,
    candidates: 3,
    ready: 2,
    fallback: 0,
    blocked: 1,
  });
  assert.equal(
    report.entries.find(({entityId}) => entityId === 'map-one').ownerUid,
    'dm-one'
  );
  assert.equal(
    report.entries.find(({entityId}) => entityId === 'npc-one').status,
    'blocked-missing-owner'
  );
  assert.ok(report.entries.every((entry) => !('imageUrl' in entry)));
});

test('global catalog items are inventoried with an explicit reference scope', async () => {
  const snapshot = (records) => ({
    docs: records.map(({id, data}) => ({
      id,
      data: () => data,
    })),
  });
  const snapshots = {
    users: snapshot([]),
    items: snapshot([{
      id: 'catalog-sword',
      data: {
        General: {image_url: 'items/catalog-sword.png'},
      },
    }]),
    echi_npcs: snapshot([]),
    foes: snapshot([]),
    grigliata_backgrounds: snapshot([]),
  };
  const db = {
    collection: (name) => ({
      get: async () => snapshots[name],
    }),
  };
  const records = await loadLegacyMediaRecords(db);
  assert.deepEqual(records, [{
    kind: 'item',
    ownerUid: '',
    entityId: 'catalog-sword',
    referenceScope: 'global-catalog',
    data: {
      General: {image_url: 'items/catalog-sword.png'},
    },
  }]);
  const report = buildLegacyMediaBackfillPlan(records);
  assert.equal(report.entries[0].referenceScope, 'global-catalog');
  assert.equal(report.entries[0].status, 'blocked-missing-owner');
});

test('inventory items retain their separate user-owned reference scope', () => {
  const report = buildLegacyMediaBackfillPlan([{
    kind: 'item',
    ownerUid: 'player-one',
    entityId: 'inventory-sword',
    referenceScope: 'user-inventory',
    data: {imagePath: 'users/player-one/items/sword.png'},
  }]);
  assert.equal(report.entries[0].referenceScope, 'user-inventory');
  assert.equal(report.entries[0].status, 'needs-derivatives');
});

test('CLI options permanently reject write and require explicit project', () => {
  assert.throws(() => parseOptions([]), /--project is required/);
  assert.throws(() => parseOptions([
    '--project', 'demo-fnd-perf', '--write',
  ]), /dry-run-only/);
  assert.deepEqual(parseOptions([
    '--project', 'demo-fnd-perf', '--json',
  ]), {
    projectId: 'demo-fnd-perf',
    json: true,
  });
  assert.throws(() => parseOptions([
    '--project', 'demo-fnd-perf', '--allow-live-read',
  ]), /restricted to demo-fnd-perf/);
});

test('backfill requires the exact demo project and loopback emulator', () => {
  assert.doesNotThrow(() => assertReadOnlyTarget({
    projectId: 'demo-fnd-perf',
  }, {
    FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
  }));
  assert.throws(() => assertReadOnlyTarget({
    projectId: 'fatins',
  }, {
    FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
  }), /only permits demo-fnd-perf/);
  assert.throws(() => assertReadOnlyTarget({
    projectId: 'demo-fnd-perf',
  }, {}), /loopback Firestore emulator/);
});

test('WebM map videos are explicit unsupported fallbacks', () => {
  const report = buildLegacyMediaBackfillPlan([{
    kind: 'map-video',
    ownerUid: 'dm-one',
    entityId: 'map-video-one',
    data: {
      imagePath: 'grigliata/backgrounds/dm-one/legacy.webm',
      contentType: 'video/webm',
    },
  }]);
  assert.equal(report.counts.ready, 0);
  assert.equal(report.counts.fallback, 1);
  assert.equal(report.entries[0].status, 'unsupported-webm-fallback');
  assert.equal(
    report.entries[0].action,
    'retain-legacy-original-or-convert-explicitly'
  );
});
