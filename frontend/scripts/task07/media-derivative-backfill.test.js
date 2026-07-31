'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MIGRATION_CONCURRENCY,
  PLAN_VERSION,
  POLICY_HASH,
  REPORT_SCHEMA_VERSION,
  assertApprovedReport,
  assertCheckpoint,
  assertSafeTarget,
  buildLegacyMediaBackfillPlan,
  buildReceiptOperationPlan,
  collectMediaPaths,
  computePlanFingerprint,
  executeMigrationPlan,
  isCanonicalTask07Path,
  loadLegacyMediaRecords,
  loadPaged,
  parseOptions,
  stagingActionForManifest,
  storagePathFromValue,
} = require('./media-derivative-backfill');

const source = ({
  contentType = 'image/png',
  bytes = 1024,
  generation = '7',
  checksum = 'checksum-7',
} = {}) => ({
  exists: true,
  contentType,
  bytes,
  generation,
  checksum,
});

const activeOwner = (role = 'player') => ({
  exists: true,
  role,
  deletionState: '',
});

const avatarRecord = (id, imagePath = `characters/${id}.png`) => ({
  kind: 'avatar',
  ownerUid: id,
  entityId: id,
  targetPath: `users/${id}`,
  targetVersion: `10:00000000${id.length}`,
  data: {imagePath},
});

const planFor = async (records, overrides = {}) => (
  buildLegacyMediaBackfillPlan(records, {
    readSourceObject: async () => source(),
    readOwner: async () => activeOwner(),
    scan: {
      complete: true,
      pageSize: 2,
      maxPages: 5,
      concurrency: 1,
      pagesBySource: {fixtures: 1},
      truncatedSources: [],
    },
    ...overrides,
  })
);

const executionOptions = (report, overrides = {}) => ({
  projectId: 'demo-fnd-perf',
  operation: report.operation,
  execute: true,
  approveFingerprint: report.planFingerprint,
  pollTimeoutMs: 1000,
  ...overrides,
});

test('backfill path parsing strips Firebase tokens and foreign URLs', () => {
  const storagePath = 'characters/avatar_user-a.png';
  const url = `https://firebasestorage.googleapis.com/v0/b/demo/o/` +
    `${encodeURIComponent(storagePath)}?alt=media&token=must-not-leak`;
  assert.equal(storagePathFromValue(url), storagePath);
  assert.deepEqual(collectMediaPaths({imageUrl: url}), [storagePath]);
  assert.equal(
    storagePathFromValue('https://example.com/private/object.png'),
    ''
  );
});

test('both current and compatibility Task 07 generated paths are excluded', () => {
  const assetId = `m_${'1'.repeat(40)}`;
  const current = `media_assets/v1/signed-in/player/${assetId}/7/original`;
  const compatibility = `media/v1/foe/dm/${assetId}/original/source.png`;
  assert.equal(isCanonicalTask07Path(current), true);
  assert.equal(isCanonicalTask07Path(compatibility), true);
  assert.deepEqual(collectMediaPaths({
    media: {
      schemaVersion: 1,
      original: {path: current},
    },
    imagePath: current,
    nested: {imagePath: 'legacy/image.png'},
  }), ['legacy/image.png', current]);
});

test('backfill plan is deterministic, deduplicated, and contract-bound', async () => {
  const records = [
    {
      ...avatarRecord('player-one'),
      data: {
        imagePath: 'characters/player-one.png',
        imageUrl: 'characters/player-one.png',
      },
    },
    {
      kind: 'npc',
      ownerUid: '',
      entityId: 'npc-one',
      targetPath: 'echi_npcs/npc-one',
      targetVersion: '11:000000001',
      data: {imagePath: 'legacy/unowned-npc.png'},
    },
    {
      kind: 'map',
      ownerUid: '',
      entityId: 'map-one',
      targetPath: 'grigliata_backgrounds/map-one',
      targetVersion: '12:000000001',
      data: {
        imagePath: 'grigliata/backgrounds/dm-one/map.png',
        assetType: 'image',
      },
    },
  ];
  const options = {
    readSourceObject: async () => source(),
    readOwner: async (uid) => (
      uid === 'dm-one' ? activeOwner('dm') : activeOwner()
    ),
    scan: {
      complete: true,
      pageSize: 25,
      maxPages: 20,
      concurrency: 1,
      pagesBySource: {fixtures: 1},
      truncatedSources: [],
    },
  };
  const first = await buildLegacyMediaBackfillPlan(records, options);
  const second = await buildLegacyMediaBackfillPlan(records, options);
  assert.equal(first.planVersion, PLAN_VERSION);
  assert.equal(first.policyHash, POLICY_HASH);
  assert.equal(first.planFingerprint, second.planFingerprint);
  assert.equal(first.planFingerprint, computePlanFingerprint(first));
  assert.deepEqual(first.counts, {
    records: 3,
    candidates: 3,
    executable: 2,
    skipped: 0,
    errors: 1,
  });
  const map = first.entries.find(({entityId}) => entityId === 'map-one');
  assert.equal(map.ownerUid, 'dm-one');
  assert.match(map.assetId, /^m_[a-f0-9]{40}$/);
  assert.equal(
    map.stagingPath,
    `media_uploads/dm-one/${map.assetId}/source`
  );
  const npc = first.entries.find(({entityId}) => entityId === 'npc-one');
  assert.equal(npc.status, 'blocked');
  assert.ok(npc.issues.some(({code}) => code === 'missing-owner'));
  assert.ok(first.entries.every((entry) => !('imageUrl' in entry)));
});

test('root target planning does not absorb nested personal media', async () => {
  const report = await planFor([{
    ...avatarRecord('nested-owner'),
    data: {
      imagePath: 'characters/nested-owner.png',
      spells: {
        Spark: {image_url: 'users/nested-owner/spark.png'},
      },
    },
  }]);
  assert.equal(report.entries.length, 1);
  assert.equal(report.entries[0].sourcePath,
    'characters/nested-owner.png');
  assert.equal(report.entries[0].status, 'ready');
});

test('source generation, policy type, and size are fail-closed', async () => {
  const records = [
    avatarRecord('missing-generation', 'legacy/a.png'),
    avatarRecord('gif', 'legacy/a.gif'),
    avatarRecord('oversize', 'legacy/huge.png'),
    {
      kind: 'map-video',
      ownerUid: 'dm-one',
      entityId: 'video',
      targetPath: 'grigliata_backgrounds/video',
      targetVersion: '20:000000001',
      data: {imagePath: 'legacy/video.webm', assetType: 'video'},
    },
  ];
  const report = await planFor(records, {
    readSourceObject: async (storagePath) => {
      if (storagePath.endsWith('a.png')) return source({generation: ''});
      if (storagePath.endsWith('.gif')) {
        return source({contentType: 'image/gif'});
      }
      if (storagePath.endsWith('huge.png')) {
        return source({bytes: 6 * 1024 * 1024});
      }
      return source({contentType: 'video/webm', bytes: 4096});
    },
    readOwner: async (uid) => (
      uid === 'dm-one' ? activeOwner('dm') : activeOwner()
    ),
  });
  assert.equal(report.counts.executable, 1);
  assert.equal(report.counts.errors, 3);
  assert.equal(
    report.entries.find(({entityId}) => entityId === 'video').status,
    'ready'
  );
});

test('personal technique art and video are independent executable slots', async () => {
  const target = {
    ownerUid: 'player-one',
    entityId: 'technique-one',
    targetPath: 'users/player-one/tecniche/technique-one',
    targetVersion: '30:000000001',
  };
  const report = await planFor([{
    ...target,
    kind: 'technique',
    data: {image_url: 'users/player-one/technique.png'},
  }, {
    ...target,
    kind: 'technique-video',
    data: {video_url: 'users/player-one/technique.mp4'},
  }], {
    readSourceObject: async (storagePath) => (
      storagePath.endsWith('.mp4') ?
        source({contentType: 'video/mp4', bytes: 4096}) :
        source()
    ),
  });
  assert.equal(report.counts.executable, 2);
  assert.equal(report.counts.errors, 0);
  assert.deepEqual(
    report.entries.map(({targetSlot}) => targetSlot).sort(),
    ['media', 'videoMedia']
  );
  assert.ok(report.entries.every(({targetKind}) => (
    targetKind === 'user-technique'
  )));
});

test('bounded pagination is serial and reports truncation', async () => {
  let active = 0;
  let maxActive = 0;
  const calls = [];
  const loaded = await loadPaged({
    sourceKeys: ['a', 'b'],
    pageSize: 2,
    maxPages: 2,
    readPage: async (sourceKey, cursor) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      calls.push([sourceKey, cursor]);
      await Promise.resolve();
      active -= 1;
      const page = cursor == null ? 0 : Number(cursor);
      return {
        records: [`${sourceKey}-${page}-1`, `${sourceKey}-${page}-2`],
        cursor: page + 1,
        hasMore: true,
      };
    },
  });
  assert.equal(MIGRATION_CONCURRENCY, 1);
  assert.equal(maxActive, 1);
  assert.equal(calls.length, 4);
  assert.equal(loaded.records.length, 8);
  assert.equal(loaded.scan.complete, false);
  assert.deepEqual(loaded.scan.truncatedSources, ['a', 'b']);
});

test('legacy record loader visits each source with bounded serial pages', async () => {
  const sourceKeys = [];
  const loaded = await loadLegacyMediaRecords({
    readLegacyPage: async (sourceKey, _cursor, pageSize) => {
      sourceKeys.push(sourceKey);
      assert.equal(pageSize, 3);
      return {records: [], cursor: null, hasMore: false};
    },
  }, {pageSize: 3, maxPages: 1});
  assert.deepEqual(sourceKeys, [
    'avatars',
    'catalog-items',
    'inventory-items',
    'npcs',
    'foes',
    'technique-art',
    'technique-video',
    'spell-art',
    'spell-video',
    'backgrounds',
  ]);
  assert.equal(loaded.scan.complete, true);
  assert.equal(loaded.scan.concurrency, 1);
});

test('CLI defaults to planning and gates every execution fingerprint', () => {
  const planned = parseOptions([
    '--project', 'demo-fnd-perf',
    '--page-size', '4',
    '--max-pages', '3',
  ]);
  assert.equal(planned.operation, 'backfill');
  assert.equal(planned.execute, false);
  assert.equal(planned.pageSize, 4);
  assert.equal(planned.maxPages, 3);
  assert.throws(() => parseOptions([]), /--project is required/);
  assert.throws(() => parseOptions([
    '--project', 'demo-fnd-perf', '--write',
  ]), /not supported/);
  assert.throws(() => parseOptions([
    '--project', 'demo-fnd-perf', '--execute',
  ]), /approve-fingerprint/);
  assert.throws(() => parseOptions([
    '--project', 'demo-fnd-perf',
    '--operation', 'verify',
    '--execute',
    '--approve-fingerprint', 'a'.repeat(64),
  ]), /always read-only/);
  const applied = parseOptions([
    '--project', 'demo-fnd-perf',
    '--operation', 'rollback',
    '--apply',
    '--approve-fingerprint', 'a'.repeat(64),
  ]);
  assert.equal(applied.execute, true);
  assert.equal(applied.operation, 'rollback');
});

test('staging retries only intents and retryable failures', () => {
  assert.equal(stagingActionForManifest('intent', false), 'stage');
  assert.equal(stagingActionForManifest('failed', true), 'stage');
  assert.equal(stagingActionForManifest('processing', false), 'poll');
  assert.equal(stagingActionForManifest('ready', false), 'complete');
  assert.throws(() => stagingActionForManifest('failed', false),
    /stopped in failed/);
  assert.throws(() => stagingActionForManifest('cancelled', true),
    /stopped in cancelled/);
});

test('Firebase target is exact demo project on loopback emulators only', () => {
  const base = {
    projectId: 'demo-fnd-perf',
    operation: 'backfill',
    execute: false,
  };
  const emulatorEnv = {
    FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
    FIREBASE_STORAGE_EMULATOR_HOST: 'localhost:9199',
  };
  assert.deepEqual(assertSafeTarget(base, emulatorEnv), {
    projectId: 'demo-fnd-perf',
    live: false,
    concurrency: 1,
  });
  assert.throws(() => assertSafeTarget(
    {...base, projectId: 'fatins'},
    emulatorEnv
  ), /only permits demo-fnd-perf/);
  assert.throws(() => assertSafeTarget(base, {
    ...emulatorEnv,
    FIREBASE_STORAGE_EMULATOR_HOST: 'storage.example.com:9199',
  }), /loopback Storage emulator/);
  assert.throws(() => assertSafeTarget({...base, execute: true}, emulatorEnv),
    /loopback Functions emulator/);
  assert.doesNotThrow(() => assertSafeTarget({...base, execute: true}, {
    ...emulatorEnv,
    FUNCTIONS_EMULATOR_HOST: '127.0.0.1:5001',
  }));
});

test('approval rejects tampering, incomplete scans, and policy drift', async () => {
  const report = await planFor([avatarRecord('approved')]);
  const options = executionOptions(report);
  assert.equal(assertApprovedReport(report, options), report);
  assert.throws(() => assertApprovedReport({
    ...report,
    entries: [{...report.entries[0], sourceBytes: 999}],
  }, options), /exact completed/);
  const incomplete = {
    ...report,
    complete: false,
  };
  incomplete.planFingerprint = computePlanFingerprint(incomplete);
  assert.throws(() => assertApprovedReport(
    incomplete,
    {...options, approveFingerprint: incomplete.planFingerprint}
  ), /exact completed/);
  assert.throws(() => assertApprovedReport(report, {
    ...options,
    approveFingerprint: 'f'.repeat(64),
  }), /exactly match/);
});

test('execution is strictly serial and checkpoints only verified receipts', async () => {
  const report = await planFor([
    avatarRecord('a'),
    avatarRecord('b'),
  ]);
  let active = 0;
  let maxActive = 0;
  const applied = [];
  const checkpoints = [];
  const result = await executeMigrationPlan({
    backend: {
      applyBackfillEntry: async (entry) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        applied.push(entry.receiptId);
        await Promise.resolve();
        active -= 1;
        return {verified: true};
      },
    },
    options: executionOptions(report),
    report,
    onCheckpoint: async (checkpoint) => checkpoints.push(checkpoint),
  });
  assert.equal(maxActive, 1);
  assert.deepEqual(applied, report.entries.map(({receiptId}) => receiptId));
  assert.equal(checkpoints.length, 2);
  assert.equal(checkpoints[0].complete, false);
  assert.equal(checkpoints[1].complete, true);
  assert.deepEqual(result, {processed: 2, complete: true});
});

test('checkpoint resume continues after the exact durable receipt cursor', async () => {
  const report = await planFor([
    avatarRecord('a'),
    avatarRecord('b'),
  ]);
  const firstCheckpoint = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    planVersion: PLAN_VERSION,
    policyVersion: report.policyVersion,
    policyHash: POLICY_HASH,
    mode: 'execute',
    operation: 'backfill',
    projectId: 'demo-fnd-perf',
    planFingerprint: report.planFingerprint,
    lastReceiptId: report.entries[0].receiptId,
    processed: 1,
    complete: false,
  };
  const options = executionOptions(report, {
    resumeCheckpoint: firstCheckpoint,
  });
  assert.equal(assertCheckpoint(firstCheckpoint, report, options),
    firstCheckpoint);
  const applied = [];
  const result = await executeMigrationPlan({
    backend: {
      applyBackfillEntry: async (entry) => {
        applied.push(entry.receiptId);
        return {verified: true};
      },
    },
    options,
    report,
  });
  assert.deepEqual(applied, [report.entries[1].receiptId]);
  assert.deepEqual(result, {processed: 2, complete: true});
  assert.throws(() => assertCheckpoint({
    ...firstCheckpoint,
    policyHash: '0'.repeat(64),
  }, report, options), /does not match/);
  assert.throws(() => assertCheckpoint({
    ...firstCheckpoint,
    processed: 2,
  }, report, options), /does not match/);
});

test('post-write failure never advances a checkpoint', async () => {
  const report = await planFor([avatarRecord('failure')]);
  const checkpoints = [];
  await assert.rejects(executeMigrationPlan({
    backend: {
      applyBackfillEntry: async () => ({verified: false}),
    },
    options: executionOptions(report),
    report,
    onCheckpoint: async (checkpoint) => checkpoints.push(checkpoint),
  }), /Post-write verification failed/);
  assert.deepEqual(checkpoints, []);
});

test('receipt verification and rollback plans bind current inspection', async () => {
  const receipt = {
    id: 'r_receipt',
    receiptId: 'r_receipt',
    schemaVersion: REPORT_SCHEMA_VERSION,
    planVersion: PLAN_VERSION,
    policyVersion: 1,
    policyHash: POLICY_HASH,
    subjectHash: 'a'.repeat(64),
    assetId: `m_${'b'.repeat(40)}`,
    previousAssetId: null,
    targetPath: 'users/player',
    targetSlot: 'media',
    state: 'attached',
    attachedRevision: 4,
  };
  const backend = {
    readReceiptPage: async () => ({
      records: [receipt],
      cursor: null,
      hasMore: false,
    }),
    inspectReceipt: async () => ({
      manifestState: 'attached',
      targetAssetId: receipt.assetId,
      targetRevision: 4,
      generatedObjectsPresent: true,
    }),
  };
  const verify = await buildReceiptOperationPlan({
    backend,
    operation: 'verify',
    pageSize: 5,
    maxPages: 1,
  });
  assert.equal(verify.entries[0].status, 'verified');
  assert.equal(verify.counts.errors, 0);
  const rollback = await buildReceiptOperationPlan({
    backend,
    operation: 'rollback',
    pageSize: 5,
    maxPages: 1,
  });
  assert.equal(rollback.entries[0].status, 'rollback-ready');
  assert.equal(rollback.counts.executable, 1);
  assert.notEqual(rollback.entries[0].inspectionHash, '');
});

test('drifted receipts block verification and rollback execution', async () => {
  const receipt = {
    receiptId: 'r_drifted',
    schemaVersion: REPORT_SCHEMA_VERSION,
    planVersion: PLAN_VERSION,
    policyVersion: 1,
    policyHash: POLICY_HASH,
    subjectHash: 'c'.repeat(64),
    assetId: `m_${'d'.repeat(40)}`,
    previousAssetId: null,
    targetPath: 'users/player',
    targetSlot: 'media',
    state: 'attached',
    attachedRevision: 2,
  };
  const report = await buildReceiptOperationPlan({
    backend: {
      readReceiptPage: async () => ({
        records: [receipt],
        cursor: null,
        hasMore: false,
      }),
      inspectReceipt: async () => ({
        manifestState: 'attached',
        targetAssetId: null,
        targetRevision: 2,
        generatedObjectsPresent: true,
      }),
    },
    operation: 'rollback',
    pageSize: 5,
    maxPages: 1,
  });
  assert.equal(report.entries[0].status, 'blocked');
  assert.equal(report.counts.errors, 1);
  await assert.rejects(executeMigrationPlan({
    backend: {rollbackEntry: async () => ({verified: true})},
    options: executionOptions(report),
    report,
  }), /exact completed, error-free/);
});

test('already rolled-back receipts remain idempotent during rollback apply', async () => {
  const receipt = {
    receiptId: 'r_done',
    schemaVersion: REPORT_SCHEMA_VERSION,
    planVersion: PLAN_VERSION,
    policyVersion: 1,
    policyHash: POLICY_HASH,
    subjectHash: 'e'.repeat(64),
    assetId: `m_${'f'.repeat(40)}`,
    previousAssetId: null,
    targetPath: 'users/player',
    targetSlot: 'media',
    state: 'rolled-back',
  };
  const report = await buildReceiptOperationPlan({
    backend: {
      readReceiptPage: async () => ({
        records: [receipt],
        cursor: null,
        hasMore: false,
      }),
      inspectReceipt: async () => ({
        manifestState: 'cleanup-pending',
        targetAssetId: null,
        targetRevision: 3,
        generatedObjectsPresent: true,
      }),
    },
    operation: 'rollback',
    pageSize: 5,
    maxPages: 1,
  });
  let rollbackCalls = 0;
  const result = await executeMigrationPlan({
    backend: {
      rollbackEntry: async () => {
        rollbackCalls += 1;
        return {verified: true};
      },
    },
    options: executionOptions(report),
    report,
  });
  assert.equal(report.entries[0].status, 'already-rolled-back');
  assert.equal(rollbackCalls, 0);
  assert.deepEqual(result, {processed: 1, complete: true});
});
