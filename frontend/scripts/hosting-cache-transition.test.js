const assert = require('node:assert/strict');
const test = require('node:test');
let harness = {};
try { harness = require('./hosting-cache-transition'); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
const call = (name, args) => { assert.equal(typeof harness[name], 'function', `${name} must enforce actual changed-release cache proof`); return harness[name](args); };
const time = Date.parse('2026-10-25T12:00:00Z');
test('freshness includes Date, Age, and resident time rather than assuming max-age starts now', () => {
  const result = call('cacheFreshness', {cacheControl: 'max-age=3600', date: 'Sun, 25 Oct 2026 11:55:00 GMT', age: '600', observedAt: time, now: time + 120000});
  assert.equal(result.remainingMs, 2880000);
  assert.equal(result.freshUntil, '2026-10-25T12:50:00.000Z');
});
test('revalidated, missing, or expired cache metadata cannot claim old fresh HTML', () => {
  for (const cacheControl of ['no-cache, max-age=3600', 'no-store', undefined]) {
    assert.throws(() => call('cacheFreshness', {cacheControl, date: 'Sun, 25 Oct 2026 12:00:00 GMT', observedAt: time, now: time}), /fresh|cache/i);
  }
  assert.throws(() => call('cacheFreshness', {cacheControl: 'max-age=10', date: 'Sun, 25 Oct 2026 11:55:00 GMT', observedAt: time, now: time}), /fresh|expired/i);
});
const prepared = {projectId: 'fatin-test', engine: 'chromium', mainPath: '/static/js/main.1111aaaa.js', html: {cacheControl: 'max-age=3600', date: 'Sun, 25 Oct 2026 12:00:00 GMT', age: '0', observedAt: time}};
test('unchanged bundles cannot be reported as a changed-release transition', () => {
  assert.throws(() => call('assertReadyForTransition', {prepared, projectId: 'fatin-test', engine: 'chromium', newMainPath: prepared.mainPath, now: time+1000}), /changed|distinct|hash/i);
});
test('transition is bound to the prepared site, engine and positive freshness timeline', () => {
  assert.throws(() => call('assertReadyForTransition', {prepared, projectId: 'fatins', engine: 'chromium', newMainPath: '/static/js/main.2222bbbb.js', now: time+1000}), /target|site/i);
  assert.throws(() => call('assertReadyForTransition', {prepared, projectId: 'fatin-test', engine: 'firefox', newMainPath: '/static/js/main.2222bbbb.js', now: time+1000}), /engine/i);
  assert.throws(() => call('assertReadyForTransition', {prepared, projectId: 'fatin-test', engine: 'chromium', newMainPath: '/static/js/main.2222bbbb.js', now: time+3600001}), /fresh|expired/i);
  assert.equal(call('assertReadyForTransition', {prepared, projectId: 'fatin-test', engine: 'chromium', newMainPath: '/static/js/main.2222bbbb.js', now: time+1000}).remainingMs, 3599000);
});
test('only a high-entropy owned QA identity for the explicit site can be used', () => {
  assert.throws(() => call('validateQaIdentity', {credentials: {projectId: 'fatin-test', uid: 'original-user', email: 'x', password: 'x'}, projectId: 'fatin-test'}), /owned|QA/i);
  assert.throws(() => call('validateQaIdentity', {credentials: {projectId: 'fatins', uid: 'codex-echi-qa-12345678-1234-4234-a234-123456789abc', email: 'x', password: 'x'}, projectId: 'fatin-test'}), /target|project/i);
});
test('freshness subtracts the request delay when Age is the larger age estimate', () => {
  const result = call('cacheFreshness', {cacheControl: 'max-age=3600', date: 'Sun, 25 Oct 2026 12:00:00 GMT', age: '600', requestStartedAt: time-10000, observedAt: time, now: time});
  assert.equal(result.remainingMs, 2990000);
});
test('intentional route-unmount cancellations are recorded separately from failed static requests', () => {
  assert.equal(call('staticFailureKind', 'net::ERR_ABORTED'), 'aborted');
  assert.equal(call('staticFailureKind', 'NS_BINDING_ABORTED'), 'aborted');
  assert.equal(call('staticFailureKind', 'net::ERR_CONNECTION_RESET'), 'failed');
});
test('Chromium transition proof requires the old main in a real disk-cache document before reload', () => {
  const base = {engine: 'chromium', oldMainPath: '/static/js/main.1111aaaa.js', observedMainPath: '/static/js/main.1111aaaa.js', documentCache: [{path: '/echi-di-viaggio', fromDiskCache: true, fromServiceWorker: false}]};
  assert.doesNotThrow(() => call('assertOldNavigation', base));
  assert.throws(() => call('assertOldNavigation', {...base, observedMainPath: '/static/js/main.2222bbbb.js'}), /old HTML|old main/i);
  assert.throws(() => call('assertOldNavigation', {...base, documentCache: [{path: '/echi-di-viaggio', fromDiskCache: false, fromServiceWorker: false}]}), /disk.cache/i);
  assert.throws(() => call('assertOldNavigation', {...base, documentCache: [{path: '/echi-di-viaggio', fromDiskCache: true, fromServiceWorker: true}]}), /disk.cache/i);
});
