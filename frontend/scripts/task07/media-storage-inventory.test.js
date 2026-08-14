'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  assertSafeEnvironment,
  buildInventoryReport,
  compareInventoryReports,
  parseArguments,
  validateInventoryReport,
} = require('./media-storage-inventory');

const object = (name, overrides = {}) => ({
  name,
  generation: '10',
  metageneration: '1',
  bytes: 1024,
  contentType: 'image/png',
  md5Hash: 'md5-value',
  crc32c: 'crc-value',
  ...overrides,
});

const report = (objects) => buildInventoryReport({
  projectId: 'fatin-test',
  storageBucket: 'fatin-test.firebasestorage.app',
  objects,
});

test('inventory is deterministic, complete, and fingerprinted', () => {
  const value = report([
    object('z-last.png'),
    object('a-first.png', {generation: '11', bytes: 2048}),
  ]);
  assert.equal(value.complete, true);
  assert.deepEqual(value.objects.map(({name}) => name), [
    'a-first.png',
    'z-last.png',
  ]);
  assert.equal(value.counts.bytes, 3072);
  assert.doesNotThrow(() => validateInventoryReport(value));
  assert.throws(() => validateInventoryReport({
    ...value,
    counts: {...value.counts, objects: 99},
  }), /malformed/);
});

test('comparison permits additions but rejects loss or replacement', () => {
  const before = report([object('one.png'), object('two.png')]);
  const after = report([
    object('one.png'),
    object('two.png'),
    object('three.png'),
  ]);
  const preserved = compareInventoryReports({before, after});
  assert.equal(preserved.preserved, true);
  assert.equal(preserved.counts.additions, 1);

  const missing = compareInventoryReports({
    before,
    after: report([object('one.png')]),
  });
  assert.equal(missing.preserved, false);
  assert.deepEqual(missing.missing, ['two.png']);

  const changed = compareInventoryReports({
    before,
    after: report([
      object('one.png', {generation: '12'}),
      object('two.png'),
    ]),
  });
  assert.equal(changed.preserved, false);
  assert.equal(changed.changed[0].name, 'one.png');
});

test('inventory CLI is hard-locked and emulator-free', () => {
  const options = parseArguments([
    '--project', 'fatin-test',
    '--confirm-project', 'fatin-test',
    '--allow-live-project',
    '--auth', 'firebase-cli',
    '--report', 'after.json',
    '--compare', 'before.json',
  ]);
  assert.equal(options.projectId, 'fatin-test');
  assert.equal(options.pageSize, 100);
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
