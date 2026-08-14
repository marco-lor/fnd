'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  assertSafeEnvironment,
  buildCleanupPlan,
  parseArguments,
  parseTemporaryObjectName,
  validateCleanupPlan,
} = require('./media-temporary-object-cleanup');

const assetId = `m_${'a'.repeat(40)}`;
const finalPath = `media_assets/v1/signed-in/user-a/${assetId}/7/original`;
const temporaryPath = `${finalPath}.tmp-event_1`;
const metadata = {
  task07AssetId: assetId,
  task07Checksum: 'b'.repeat(64),
  task07ContractVersion: '1',
  task07EntityId: 'token-a',
  task07Kind: 'token',
  task07OwnerUid: 'user-a',
  task07Role: 'original',
};
const storageObject = (name, generation) => ({
  name,
  generation,
  metageneration: '1',
  bytes: 2048,
  contentType: 'image/png',
  md5Hash: 'same-md5',
  crc32c: 'same-crc32c',
  metadata,
});
const subject = (overrides = {}) => ({
  temporary: storageObject(temporaryPath, '20'),
  final: storageObject(finalPath, '10'),
  manifest: {
    exists: true,
    updateTime: '2026-08-14T00:00:00.000Z',
    data: {
      state: 'superseded',
      generation: '7',
      plan: {
        assetId,
        audienceScope: 'signed-in',
        ownerKey: 'user-a',
        ownerUid: 'user-a',
        kind: 'token',
      },
      generated: {
        original: {
          path: finalPath,
          generation: '10',
          bytes: 2048,
          contentType: 'image/png',
          checksum: 'b'.repeat(64),
        },
        variants: {},
      },
    },
  },
  cleanup: {
    exists: false,
    data: {},
    updateTime: '',
  },
  ...overrides,
});

test('temporary object parsing excludes every canonical final path', () => {
  assert.deepEqual(parseTemporaryObjectName(temporaryPath), {
    temporaryPath,
    finalPath,
    audienceScope: 'signed-in',
    ownerKey: 'user-a',
    assetId,
    sourceGeneration: '7',
    role: 'original',
    eventId: 'event_1',
  });
  assert.equal(parseTemporaryObjectName(finalPath), null);
  assert.equal(parseTemporaryObjectName(`${finalPath}.tmp-bad.event`), null);
});

test('cleanup plan requires a byte-identical manifest-bound final', () => {
  const plan = buildCleanupPlan({
    projectId: 'fatin-test',
    storageBucket: 'fatin-test.firebasestorage.app',
    scannedObjects: 2,
    subjects: [subject()],
    expectedCandidates: 1,
  });
  assert.equal(plan.complete, true);
  assert.equal(plan.counts.candidates, 1);
  assert.equal(plan.counts.duplicateStagingCopies, 1);
  assert.equal(plan.counts.deletedManifestResidues, 0);
  assert.doesNotThrow(() => validateCleanupPlan(plan, {
    requireExecutable: true,
  }));

  const mismatch = buildCleanupPlan({
    projectId: 'fatin-test',
    storageBucket: 'fatin-test.firebasestorage.app',
    scannedObjects: 2,
    subjects: [subject({
      final: storageObject(finalPath, '11'),
    })],
    expectedCandidates: 1,
  });
  assert.equal(mismatch.complete, false);
  assert.deepEqual(mismatch.issues[0].codes, [
    'canonical-descriptor-object-mismatch',
  ]);
});

test('completed deleted manifests authorize only their leftover temp copy', () => {
  const deletedSubject = subject({
    final: null,
    manifest: {
      exists: true,
      updateTime: '2026-08-14T01:00:00.000Z',
      data: {
        ...subject().manifest.data,
        state: 'deleted',
        generated: undefined,
      },
    },
    cleanup: {
      exists: true,
      updateTime: '2026-08-14T01:00:00.000Z',
      data: {assetId, state: 'complete'},
    },
  });
  const plan = buildCleanupPlan({
    projectId: 'fatin-test',
    storageBucket: 'fatin-test.firebasestorage.app',
    scannedObjects: 1,
    subjects: [deletedSubject],
    expectedCandidates: 1,
  });
  assert.equal(plan.complete, true);
  assert.equal(plan.entries[0].category, 'deleted-manifest-residue');
  assert.equal(plan.entries[0].final, null);
  assert.equal(plan.counts.deletedManifestResidues, 1);

  const incomplete = buildCleanupPlan({
    projectId: 'fatin-test',
    storageBucket: 'fatin-test.firebasestorage.app',
    scannedObjects: 1,
    subjects: [{...deletedSubject, cleanup: {exists: false, data: {}}}],
    expectedCandidates: 1,
  });
  assert.equal(incomplete.complete, false);
  assert.deepEqual(incomplete.issues[0].codes, [
    'deleted-manifest-cleanup-not-complete',
  ]);
});

test('cleanup CLI is dry-run by default and execution is exact', () => {
  const base = [
    '--project', 'fatin-test',
    '--confirm-project', 'fatin-test',
    '--allow-live-project',
    '--auth', 'firebase-cli',
    '--report', 'plan.json',
  ];
  assert.equal(parseArguments(base).execute, false);
  assert.throws(() => parseArguments([
    ...base,
    '--execute',
  ]), /Execution requires/);
  const execute = parseArguments([
    ...base,
    '--execute',
    '--approved-report', 'approved.json',
    '--approve-fingerprint', 'c'.repeat(64),
    '--expected-candidates', '1',
  ]);
  assert.equal(execute.execute, true);
  assert.equal(execute.expectedCandidates, 1);
  assert.throws(() => parseArguments([
    '--project', 'fatins',
    '--confirm-project', 'fatins',
    '--allow-live-project',
    '--auth', 'firebase-cli',
  ]), /exact project fatin-test/);
  assert.equal(assertSafeEnvironment({}), true);
  assert.throws(() => assertSafeEnvironment({
    FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:9199',
  }), /refuses all emulator/);
});
