const assert = require('node:assert/strict');
const test = require('node:test');
const minimatch = require('minimatch');
const config = require('../firebase.json').hosting;

// Hosting evaluates headers against the requested path; the final matching value wins.
const cacheFor = (requestedPath) => {
  let cache;
  for (const rule of config.headers) {
    if (minimatch(requestedPath, rule.source, {nonegate: true, dot: true})) {
      for (const header of rule.headers) {
        if (header.key.toLowerCase() === 'cache-control') cache = header.value;
      }
    }
  }
  return cache;
};
for (const route of ['/', '/index.html', '/echi-di-viaggio', '/echi-di-viaggio/', '/home', '/unknown/client/route', '/unknown/client/route/']) {
  test(`requested SPA path ${route} revalidates even when rewritten`, () => {
    assert.equal(cacheFor(route), 'no-cache, max-age=0, must-revalidate');
  });
}
for (const [resource, cache] of [
  ['/static/js/main.1234abcd.js', 'public, max-age=0, must-revalidate'],
  ['/static/media/map.1234abcd.avif', 'public, max-age=0, must-revalidate'],
  ['/favicon.ico', 'public, max-age=86400, must-revalidate'],
  ['/logo192.png', 'public, max-age=86400, must-revalidate'],
  ['/logo512.png', 'public, max-age=86400, must-revalidate'],
  ['/fatins-runtime/firebase-client', 'private, max-age=300'],
]) {
  test(`explicit cache policy survives for ${resource}`, () => assert.equal(cacheFor(resource), cache));
}
test('missing static assets never enter the SPA rewrite', () => {
  assert.equal(config.rewrites.find(rule => minimatch('/static/js/missing.1234abcd.js', rule.source)), undefined);
  assert.equal(config.rewrites.find(rule => minimatch('/unknown/client/route/', rule.source))?.destination, '/index.html');
  assert.equal(config.rewrites.find(rule => rule.source === '/fatins-runtime/firebase-client')?.function?.functionId, 'clientFirebaseConfig');
});
test('Hosting release runs retention between the hardened build and verify-only check', () => {
  const phases = config.predeploy.map(command => {
    if (/firebase-backend-release-guard\.js/.test(command)) return 'guard';
    if (/verify-runtime-prerequisites\.js/.test(command)) return 'prerequisites';
    if (/retain-hosting-assets\.js/.test(command)) return 'retain';
    if (/build-production\.js/.test(command)) return /--verify-only/.test(command) ? 'verify' : 'build';
    return 'unknown';
  });
  assert.deepEqual(phases, ['guard', 'prerequisites', 'build', 'retain', 'verify']);
});
