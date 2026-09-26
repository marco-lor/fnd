const test = require('node:test');
const assert = require('node:assert/strict');
const {buildManagerUserSummary} = require('../lib/managerUserSummary');

test('manager summary is an exact projection of card and lock fields', () => {
  const summary = buildManagerUserSummary({
    progression: {stats: {level: 7, combatTokensAvailable: 3, private: 'secret'}, Parametri: {secret: true}},
    resources: {stats: {hpCurrent: 4, hpTotal: 10, gold: 15}, active_turn_effect: {secret: true}},
    settings: {settings: {lock_param_base: true, private: 'secret'}, grigliata: {secret: true}},
  });
  assert.deepEqual(summary, {
    schemaVersion: 1,
    stats: {level: 7, basePointsAvailable: 0, basePointsSpent: 0,
      combatTokensAvailable: 3, combatTokensSpent: 0, gold: 15,
      hpCurrent: 4, hpTotal: 10, manaCurrent: 0, manaTotal: 0,
      essenzaCurrent: 0, essenzaTotal: 0},
    settings: {lock_param_base: true, lock_param_combat: false},
  });
  assert.ok(!JSON.stringify(summary).includes('secret'));
});

test('missing domains produce the same safe defaults as the existing cards', () => {
  const summary = buildManagerUserSummary({});
  assert.equal(summary.stats.level, 1);
  assert.equal(summary.stats.gold, 0);
  assert.deepEqual(summary.settings, {lock_param_base: false, lock_param_combat: false});
  assert.ok(Buffer.byteLength(JSON.stringify(summary)) < 350);
});
const {maintainManagerSummaryInTransaction, summaryMaintainedInCommit} = require('../lib/managerUserSummary');
test('bulk projection uses exact canonical inputs, no-op writes and role/deletion fences', () => {
  const writes = [];
  const transaction = {set: (target, data) => writes.push(['set', target, data]), delete: (target) => writes.push(['delete', target])};
  const shell = (role, deletionState) => ({exists: true, get: key => ({role, deletionState})[key]});
  const existing = data => ({exists: !!data, data: () => data});
  const domains = {resources: {stats: {gold: 3}}, progression: {stats: {level: 2}}, settings: {settings: {lock_param_base: true}}};
  const expected = buildManagerUserSummary(domains);
  const marker = maintainManagerSummaryInTransaction(transaction, 'target', shell('player'), existing(null), domains);
  assert.deepEqual(writes, [['set', 'target', expected]]);
  assert.deepEqual(Object.keys(marker), ['managerSummaryCommitId']);
  assert.equal(expected.managerSummaryCommitId, undefined);
  maintainManagerSummaryInTransaction(transaction, 'target', shell('player'), existing(expected), domains);
  assert.equal(writes.length, 1);
  for (const user of [shell('dm'), shell('player', 'pending'), {exists: false}]) {
    maintainManagerSummaryInTransaction(transaction, 'target', user, existing(expected), domains);
    assert.deepEqual(writes.at(-1), ['delete', 'target']);
  }
});
test('only a newly introduced server commit ID bypasses a duplicate reconciliation', () => {
  const first = '12345678-1234-4123-8123-123456789012';
  const second = '12345678-1234-4123-8123-123456789013';
  const snapshot = (marker, exists = true) => ({exists, get: () => marker});
  assert.equal(summaryMaintainedInCommit(snapshot(undefined, false), snapshot(first)), true);
  assert.equal(summaryMaintainedInCommit(snapshot(first), snapshot(second)), true);
  assert.equal(summaryMaintainedInCommit(snapshot(first), snapshot(first)), false);
  assert.equal(summaryMaintainedInCommit(snapshot(first), snapshot(undefined)), false);
  assert.equal(summaryMaintainedInCommit(snapshot(first), snapshot(second, false)), false);
  assert.equal(summaryMaintainedInCommit(snapshot(undefined), snapshot('fake-marker')), false);
});
