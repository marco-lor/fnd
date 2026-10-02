const { test } = require('node:test');
const assert = require('node:assert/strict');
const { classifyRetirementRequest, summarizeEncounterHistory, summarizeRetirementActivity } = require('./task14-retirement');

test('retirement telemetry detects transient encounter listeners and writes after cleanup', () => {
  const activity = summarizeRetirementActivity({ events: [
    { category: 'firestore', metric: 'listener-open', tags: { target: 'legacy.encounters.subscribe.v1' } },
    { category: 'firestore', metric: 'listener-close', tags: { target: 'legacy.encounters.subscribe.v1' } },
    { category: 'firestore', metric: 'write-attempt', tags: { target: 'legacy.encounters.document.update.v1' } },
    { category: 'firestore', metric: 'listener-open', tags: { target: 'legacy.grigliata-token-placements.subscribe.v1' } },
  ], activeListeners: {} });
  assert.equal(activity.encounterListenerOpens, 1);
  assert.equal(activity.encounterWriteAttempts, 1);
  assert.equal(activity.activeEncounterListeners, 0);
});

test('shared settings attribution on a retired URL is preserved while encounter listeners still fail', () => {
  assert.equal(summarizeRetirementActivity({ activeListeners: {
    '/combat::users.settings.subscribe.v2': 1,
    'shell::users.shell.subscribe.v2': 1,
  } }).activeEncounterListeners, 0);
  assert.equal(summarizeRetirementActivity({ activeListeners: {
    '/home::legacy.encounters.subscribe.v1': 1,
  } }).activeEncounterListeners, 1);
});

test('retirement request evidence includes encoded WebChannel query and batch write targets', () => {
  for (const payload of [
    'req0___data__=' + encodeURIComponent(JSON.stringify({ addTarget: { query: { structuredQuery: { from: [{ collectionId: 'encounters' }] } } } })),
    'req0___data__=' + encodeURIComponent(JSON.stringify({ writes: [{ delete: 'projects/demo-fnd-perf/databases/(default)/documents/encounters/history' }] })),
  ]) assert.equal(classifyRetirementRequest({ url: () => 'http://127.0.0.1:8080/google.firestore.v1.Firestore/Listen/channel', postData: () => payload }).encounterTarget, true);
  assert.equal(classifyRetirementRequest({ url: () => 'http://127.0.0.1:8080/query', postData: () => 'grigliata_token_placements' }).encounterTarget, false);
});

test('history fingerprint detects content changes without conflating retained gameplay collections', () => {
  const rows = [{ path: 'encounters/history', data: { status: 'active' } },
    { path: 'encounters/history/participants/one', data: { hp: 5 } },
    { path: 'encounters/history/logs/one', data: { event: 'turn' } },
    { path: 'grigliata_token_placements/one', data: {} }];
  const before = summarizeEncounterHistory(rows);
  assert.deepEqual([before.encounters, before.participants, before.logs], [1, 1, 1]);
  assert.deepEqual(summarizeEncounterHistory([...rows].reverse()), before);
  assert.notEqual(summarizeEncounterHistory(rows.map(row => row.path.endsWith('/participants/one') ? { ...row, data: { hp: 4 } } : row)).digest, before.digest);
});
