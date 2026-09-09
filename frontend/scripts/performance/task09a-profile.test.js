const test = require('node:test');
const assert = require('node:assert/strict');
const { summarizeBazaarProfile } = require('./task09a-profile');
const event = value => ({ category: 'react', metric: 'commit', value, tags: { id: 'Bazaar' } });
const snapshot = events => ({ events, droppedEventCount: 0 });
test('missing profiler evidence remains unavailable', () => {
  assert.deepEqual(summarizeBazaarProfile(snapshot([])), { available: false, count: null, totalMs: null, p95Ms: null, maximumMs: null });
});
test('phase metrics exclude earlier commits and unrelated profilers', () => {
  const before = snapshot([event(100)]);
  const next = snapshot([...before.events, event(5), { ...event(999), tags: { id: 'Home' } }, event(15)]);
  assert.deepEqual(summarizeBazaarProfile(next, before), { available: true, count: 2, totalMs: 20, p95Ms: 15, maximumMs: 15 });
});
test('zero new commits is measured count zero with no latency sample', () => {
  const current = snapshot([event(5)]);
  assert.deepEqual(summarizeBazaarProfile(current, current), { available: true, count: 0, totalMs: 0, p95Ms: null, maximumMs: null });
});
test('dropped events or invalid durations invalidate measurements', () => {
  assert.throws(() => summarizeBazaarProfile({ ...snapshot([event(5)]), droppedEventCount: 1 }), /Incomplete/);
  assert.throws(() => summarizeBazaarProfile(snapshot([event(NaN)])), /Invalid/);
});
