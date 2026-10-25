const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const {FIREBASE_ENVIRONMENTS} = require('./firebase-environment');
let retention = {};
try { retention = require('./retain-hosting-assets'); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
const call = (name, args) => {
  assert.equal(typeof retention[name], 'function', `${name} must implement the release-continuity contract`);
  return retention[name](args);
};
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const now = Date.parse('2026-10-25T12:00:00Z');
const week = 7 * 24 * 60 * 60 * 1000;
const oldMain = '/static/js/main.1111aaaa.js';
const oldChunk = '/static/js/route-echi.2222bbbb.chunk.js';
const newMain = '/static/js/main.3333cccc.js';
const manifestPath = '/retained-static-assets.json';
const version = 'sites/fatin-test/versions/oldversion';
function fixture(t, contents = {[oldMain]: 'old main', [oldChunk]: 'old lazy chunk'}) {
  const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fnd-retention-test-'));
  t.after(() => fs.rmSync(buildDir, {recursive: true, force: true}));
  fs.mkdirSync(path.join(buildDir, 'static/js'), {recursive: true});
  fs.writeFileSync(path.join(buildDir, 'index.html'), '<script src="'+newMain+'"></script>');
  fs.writeFileSync(path.join(buildDir, newMain), 'new main');
  const bodies = new Map(Object.entries(contents).map(([p, b]) => [p, Buffer.from(b)]));
  const files = [...bodies].map(([p, b]) => ({path: p, hash: sha(zlib.gzipSync(b, {level: 9})), status: 'ACTIVE'}));
  const requests = [];
  const state = {liveCalls: 0, files, pages: null};
  const api = {
    latestVersion: async () => { state.liveCalls++; return version; },
    listFiles: async ({pageToken}) => state.pages ? state.pages[pageToken || 'first'] : {files},
  };
  const download = async (url) => {
    const parsed = new URL(url); requests.push(parsed);
    const bytes = bodies.get(parsed.pathname);
    if (!bytes) return {statusCode: 404, headers: {}, body: Buffer.from('missing')};
    return {statusCode: 200, headers: {'content-encoding': 'gzip'}, body: zlib.gzipSync(bytes, {level: 9})};
  };
  const options = {selection: FIREBASE_ENVIRONMENTS.staging, buildDir, api, download, now: () => now};
  return {options, buildDir, bodies, files, requests, state};
}
const retainedManifest = assets => JSON.stringify({schemaVersion: 1, projectId: 'fatin-test', hostingSite: 'fatin-test', assets});

test('first transition keeps old entry and lazy chunk bytes alongside the new release', async t => {
  const f = fixture(t);
  const summary = await call('retainPreviousAssets', f.options);
  assert.equal(fs.readFileSync(path.join(f.buildDir, oldMain), 'utf8'), 'old main');
  assert.equal(fs.readFileSync(path.join(f.buildDir, oldChunk), 'utf8'), 'old lazy chunk');
  assert.equal(fs.readFileSync(path.join(f.buildDir, newMain), 'utf8'), 'new main');
  const manifest = JSON.parse(fs.readFileSync(path.join(f.buildDir, manifestPath)));
  assert.deepEqual(manifest, {schemaVersion: 1, projectId: 'fatin-test', hostingSite: 'fatin-test', assets: [
    {path: oldMain, sha256: sha(Buffer.from('old main')), expiresAt: new Date(now+week).toISOString()},
    {path: oldChunk, sha256: sha(Buffer.from('old lazy chunk')), expiresAt: new Date(now+week).toISOString()},
  ]});
  assert.equal(summary.retainedFiles, 2);
  assert.equal(summary.retainedBytes, 22);
  assert.ok(f.requests.every(url => url.origin === 'https://fatin-test.web.app'));
});
test('every version-file page is included and live version is checked after enumeration and downloads', async t => {
  const f = fixture(t);
  f.state.pages = {first: {files: [f.files[0]], nextPageToken: 'next'}, next: {files: [f.files[1]]}};
  await call('retainPreviousAssets', f.options);
  assert.equal(fs.readFileSync(path.join(f.buildDir, oldChunk), 'utf8'), 'old lazy chunk');
  assert.equal(f.state.liveCalls, 3);
});
test('retained expiry is never renewed while a newly retired native file starts seven days now', async t => {
  const expiry = new Date(now+1000).toISOString();
  const f = fixture(t, {[oldMain]: 'old main', [oldChunk]: 'old lazy chunk', [manifestPath]: retainedManifest([{path: oldMain, sha256: sha(Buffer.from('old main')), expiresAt: expiry}])});
  await call('retainPreviousAssets', f.options);
  const assets = JSON.parse(fs.readFileSync(path.join(f.buildDir, manifestPath))).assets;
  assert.equal(assets.find(a => a.path === oldMain).expiresAt, expiry);
  assert.equal(assets.find(a => a.path === oldChunk).expiresAt, new Date(now+week).toISOString());
});
test('expired retained files disappear and are not downloaded or reclassified as native', async t => {
  const f = fixture(t, {[oldMain]: 'old main', [manifestPath]: retainedManifest([{path: oldMain, sha256: sha(Buffer.from('old main')), expiresAt: new Date(now-1).toISOString()}])});
  await call('retainPreviousAssets', f.options);
  assert.equal(fs.existsSync(path.join(f.buildDir, oldMain)), false);
  assert.equal(f.requests.some(url => url.pathname === oldMain), false);
});
test('same native file bytes are preserved and not put on a retirement timer', async t => {
  const f = fixture(t, {[newMain]: 'new main'});
  await call('retainPreviousAssets', f.options);
  assert.equal(fs.readFileSync(path.join(f.buildDir, newMain), 'utf8'), 'new main');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.buildDir, manifestPath))).assets, []);
});
test('different bytes at a current native hashed path abort without replacing the native file', async t => {
  const f = fixture(t, {[newMain]: 'different old bytes'});
  await assert.rejects(() => call('retainPreviousAssets', f.options), /collision/i);
  assert.equal(fs.readFileSync(path.join(f.buildDir, newMain), 'utf8'), 'new main');
  assert.equal(fs.existsSync(path.join(f.buildDir, manifestPath)), false);
});
for (const [label, contents] of [
  ['target mismatch', {[oldMain]: 'old main', [manifestPath]: retainedManifest([]).replaceAll('fatin-test', 'fatins')}],
  ['traversal', {'/static/js/../../outside.1234abcd.js': 'bad'}],
  ['manifest traversal', {[manifestPath]: retainedManifest([{path: '/static/../outside.1234abcd.js', sha256: 'a'.repeat(64), expiresAt: new Date(now+1000).toISOString()}])}],
]) test(`rejects ${label} before writing old assets`, async t => {
  const f = fixture(t, contents);
  await assert.rejects(() => call('retainPreviousAssets', f.options), /target|path|traversal/i);
  assert.equal(fs.existsSync(path.join(f.buildDir, manifestPath)), false);
});
test('debug, source maps, config, unversioned files and nonstatic paths are never retained', async t => {
  const f = fixture(t, {
    [oldMain]: 'old main', '/static/js/main.1234abcd.js.map': 'map', '/static/js/config.1234abcd.js': 'secret config',
    '/static/js/debug.1234abcd.js': 'debug', '/static/js/main.js': 'unhashed', '/index.html': 'old HTML',
    '/__/firebase/init.js': 'config', '/static/js/module.1234abcd.cjs': 'bad module', '/asset-manifest.json': '{}',
  });
  await call('retainPreviousAssets', f.options);
  assert.deepEqual(f.requests.map(url => url.pathname), [oldMain]);
});
for (const failure of ['hash mismatch', 'partial download', 'HTTP failure', 'redirect', 'hardening']) test(`fails closed on ${failure} without a partially retained release`, async t => {
  const f = fixture(t);
  const baseDownload = f.options.download;
  f.options.download = async url => {
    if (new URL(url).pathname !== oldChunk) return baseDownload(url);
    if (failure === 'HTTP failure') return {statusCode: 404, headers: {}, body: Buffer.from('gone')};
    if (failure === 'redirect') return {statusCode: 302, headers: {location: 'https://elsewhere.invalid/secret'}, body: Buffer.alloc(0)};
    if (failure === 'partial download') { const r = await baseDownload(url); r.body = r.body.subarray(0, 5); return r; }
    const body = Buffer.from(failure === 'hardening' ? '//# sourceMappingURL=secret.map' : 'tampered');
    if (failure === 'hardening') f.files.find(x => x.path === oldChunk).hash = sha(zlib.gzipSync(body, {level: 9}));
    return {statusCode: 200, headers: {}, body};
  };
  await assert.rejects(() => call('retainPreviousAssets', f.options), /hash|digest|gzip|download|HTTP|redirect|hardening|debug/i);
  assert.equal(fs.existsSync(path.join(f.buildDir, oldMain)), false);
  assert.equal(fs.existsSync(path.join(f.buildDir, manifestPath)), false);
});
test('identity HTTP response still verifies the actual gzip upload digest', async t => {
  const f = fixture(t);
  f.options.download = async url => ({statusCode: 200, headers: {}, body: f.bodies.get(new URL(url).pathname)});
  await call('retainPreviousAssets', f.options);
  assert.equal(fs.readFileSync(path.join(f.buildDir, oldMain), 'utf8'), 'old main');
});
for (const limits of [{maxFiles: 1}, {maxTotalBytes: 5}, {maxFileBytes: 5}, {timeoutMs: 1}]) test(`enforces resource bound ${JSON.stringify(limits)}`, async t => {
  const f = fixture(t); f.options.limits = limits;
  if (limits.timeoutMs) { let tick = now; f.options.now = () => tick += 100; }
  await assert.rejects(() => call('retainPreviousAssets', f.options), /limit|bound|deadline|timeout/i);
  assert.equal(fs.existsSync(path.join(f.buildDir, manifestPath)), false);
});
test('a changed live version aborts after pagination before downloading', async t => {
  const f = fixture(t); let reads = 0;
  f.options.api.latestVersion = async () => ++reads === 1 ? version : 'sites/fatin-test/versions/newversion';
  await assert.rejects(() => call('retainPreviousAssets', f.options), /changed|version/i);
  assert.equal(f.requests.length, 0);
});
test('a changed live version during downloads aborts before copying files', async t => {
  const f = fixture(t); let reads = 0;
  f.options.api.latestVersion = async () => ++reads < 3 ? version : 'sites/fatin-test/versions/newversion';
  await assert.rejects(() => call('retainPreviousAssets', f.options), /changed|version/i);
  assert.equal(fs.existsSync(path.join(f.buildDir, oldMain)), false);
});
test('symlinks in the build tree cannot write outside build output', async t => {
  const f = fixture(t); fs.symlinkSync(os.tmpdir(), path.join(f.buildDir, 'static/media'));
  await assert.rejects(() => call('retainPreviousAssets', f.options), /symlink/i);
  assert.equal(fs.existsSync(path.join(f.buildDir, manifestPath)), false);
});
test('direct hook execution on a feature branch refuses before credentials or network', async () => {
  let authenticated = false;
  await assert.rejects(() => call('run', {
    environment: {FND_FIREBASE_ENVIRONMENT: 'staging', FND_FIREBASE_PROJECT_ID: 'fatin-test', FND_FIREBASE_HOSTING_SITE: 'fatin-test', FND_FIREBASE_STORAGE_BUCKET: 'fatin-test.firebasestorage.app', FND_GIT_BRANCH: 'devs', GCLOUD_PROJECT: 'fatin-test'},
    execFileSyncImpl: () => 'feat/task15a-echi-maps',
    createCredential: async () => { authenticated = true; throw Error('credentials must not run'); },
  }), /branch|devs/i);
  assert.equal(authenticated, false);
});
test('plain HTTP SHA256 is never mistaken for the Hosting gzip upload digest', async t => {
  const f = fixture(t);
  f.files[0].hash = sha(f.bodies.get(oldMain));
  await assert.rejects(() => call('retainPreviousAssets', f.options), /hash|digest/i);
  assert.equal(fs.existsSync(path.join(f.buildDir, oldMain)), false);
});
test('an exact uploaded gzip stream validates even when its platform header differs', async t => {
  const f = fixture(t);
  f.options.download = async url => {
    const body = zlib.gzipSync(f.bodies.get(new URL(url).pathname), {level: 9});
    body[9] = 0; // Windows-uploaded gzip OS byte; raw upload digest remains authoritative.
    f.files.find(file => file.path === new URL(url).pathname).hash = sha(body);
    return {statusCode: 200, headers: {'content-encoding': 'gzip'}, body};
  };
  await call('retainPreviousAssets', f.options);
  assert.equal(fs.readFileSync(path.join(f.buildDir, oldMain), 'utf8'), 'old main');
});
test('retention cannot reintroduce a Google API key into a hardened build', async t => {
  const f = fixture(t, {[oldMain]: `const key="AIza${'a'.repeat(35)}";`});
  await assert.rejects(() => call('retainPreviousAssets', f.options), /hardening|API key/i);
  assert.equal(fs.existsSync(path.join(f.buildDir, oldMain)), false);
});
test('a request that never completes is bounded by the retention deadline', async t => {
  const f = fixture(t);
  f.options.limits = {timeoutMs: 30};
  f.options.download = () => new Promise(() => {});
  await assert.rejects(() => call('retainPreviousAssets', f.options), /deadline|timeout/i);
  assert.equal(fs.existsSync(path.join(f.buildDir, manifestPath)), false);
});
test('retention rejects a repeated pagination token instead of looping', async t => {
  const f = fixture(t);
  f.state.pages = {first: {files: [f.files[0]], nextPageToken: 'again'}, again: {files: [f.files[1]], nextPageToken: 'again'}};
  await assert.rejects(() => call('retainPreviousAssets', f.options), /repeated|token/i);
  assert.equal(f.requests.length, 0);
});
test('pagination and total inventory counts are independently bounded', async t => {
  for (const limits of [{maxPages: 1}, {maxInventoryFiles: 1}]) {
    const f = fixture(t); f.options.limits = limits;
    f.state.pages = {first: {files: [f.files[0]], nextPageToken: 'next'}, next: {files: [f.files[1]]}};
    await assert.rejects(() => call('retainPreviousAssets', f.options), /limit/i);
    assert.equal(f.requests.length, 0);
  }
});
test('a previously retained file with a changed content digest aborts rather than renewing it', async t => {
  const f = fixture(t, {[oldMain]: 'old main', [manifestPath]: retainedManifest([{path: oldMain, sha256: 'a'.repeat(64), expiresAt: new Date(now+1000).toISOString()}])});
  await assert.rejects(() => call('retainPreviousAssets', f.options), /digest/i);
  assert.equal(fs.existsSync(path.join(f.buildDir, oldMain)), false);
});
