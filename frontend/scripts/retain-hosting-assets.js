#!/usr/bin/env node
'use strict';

// Runs only in Hosting predeploy, after a fresh hardened build. Ordinary builds stay offline.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const https = require('node:https');
const childProcess = require('node:child_process');
const {getFirebaseEnvironment, resolveEnvironmentSelection} = require('./firebase-environment');
const {resolveProjectId} = require('./firebase-backend-release-guard');
const {createFirebaseCliAdminCredential} = require('./firebase-cli-admin-credential');

const MANIFEST_PATH = '/retained-static-assets.json';
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_LIMITS = Object.freeze({
  maxFiles: 2000, maxInventoryFiles: 10000, maxPages: 100,
  maxFileBytes: 32 * 1024 * 1024, maxTotalBytes: 256 * 1024 * 1024,
  maxManifestBytes: 512 * 1024, timeoutMs: 180000,
});
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const digestPattern = /^[a-f0-9]{64}$/;
function isRetainablePath(candidate) {
  if (typeof candidate !== 'string' || !candidate.startsWith('/static/')) return false;
  if (candidate.includes('..') || candidate.includes('\\') || candidate.includes('%') || candidate.includes('//')) {
    throw new Error(`Unsafe static path / traversal: ${candidate}`);
  }
  if (!/^\/static\/(?:js|css|media)\/[A-Za-z0-9_./-]+$/.test(candidate)) return false;
  if (candidate.slice(1).split('/').some(segment => !segment || segment.startsWith('.'))) return false;
  if (/config|debug|manifest|sourcemap|\.map(?:\.|$)/i.test(candidate)) return false;
  return /\.[a-f0-9]{8,64}(?:\.chunk)?\.(?:js(?:\.LICENSE\.txt)?|css|avif|webp|png|jpe?g|gif|svg|ico|woff2?|ttf|otf|eot|mp[34]|m4a|wav|ogg|webm)$/.test(candidate);
}
function assertBuildTree(directory) {
  const stat = fs.lstatSync(directory);
  if (stat.isSymbolicLink()) throw new Error('Symlinks are forbidden in Hosting build output.');
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(directory)) assertBuildTree(path.join(directory, name));
  } else if (!stat.isFile()) throw new Error('Only regular Hosting build files are permitted.');
}
function verifyDownloadedFile(response, expectedHash, maxBytes) {
  if (response?.statusCode !== 200) throw new Error(`Asset download HTTP ${response?.statusCode}; redirects are refused.`);
  const wire = response.body;
  if (!Buffer.isBuffer(wire) || wire.length > maxBytes + 65536) throw new Error('Download byte limit exceeded.');
  const encoding = String(response.headers?.['content-encoding'] || 'identity').toLowerCase();
  if (!['identity', 'gzip'].includes(encoding)) throw new Error(`Unsupported download encoding ${encoding}.`);
  let bytes;
  try { bytes = encoding === 'gzip' ? zlib.gunzipSync(wire, {maxOutputLength: maxBytes}) : wire; }
  catch (_error) { throw new Error('Invalid, partial, or byte-limit-exceeding gzip download.'); }
  if (bytes.length > maxBytes) throw new Error('Decoded file byte limit exceeded.');
  // Hosting VersionFile.hash hashes the uploaded gzip(level=9) bytes, not HTTP identity bytes.
  // Prefer the unchanged uploaded gzip stream. Recompression handles identity responses;
  // if a different compressor cannot reproduce the upload digest, stop the release.
  if (!(encoding === 'gzip' && sha256(wire) === expectedHash)
    && sha256(zlib.gzipSync(bytes, {level: 9})) !== expectedHash) {
    throw new Error('Downloaded asset upload hash / digest mismatch.');
  }
  return bytes;
}
function assertHardenedAsset(assetPath, bytes) {
  if (/\.(?:js|css)$/.test(assetPath)) {
    const text = bytes.toString('utf8');
    if (text.includes('sourceMappingURL') || /\bAIza[0-9A-Za-z_-]{35}\b/.test(text)) {
      throw new Error(`Retained asset violates build hardening (debug or API key): ${assetPath}`);
    }
  }
}
function readManifest(bytes, selection, currentTime, limits) {
  if (bytes.length > limits.maxManifestBytes) throw new Error('Retention manifest byte limit exceeded.');
  let manifest;
  try { manifest = JSON.parse(bytes.toString('utf8')); } catch (_error) { throw new Error('Invalid retention manifest JSON.'); }
  if (manifest.schemaVersion !== 1 || manifest.projectId !== selection.projectId || manifest.hostingSite !== selection.hostingSite) {
    throw new Error('Retention manifest target or schema mismatch.');
  }
  if (!Array.isArray(manifest.assets) || manifest.assets.length > limits.maxFiles) throw new Error('Retention manifest file count limit exceeded.');
  const assets = new Map();
  for (const asset of manifest.assets) {
    const expiry = Date.parse(asset.expiresAt);
    if (!isRetainablePath(asset.path) || !digestPattern.test(asset.sha256) || !Number.isFinite(expiry)
      || new Date(expiry).toISOString() !== asset.expiresAt || expiry > currentTime + RETENTION_MS || assets.has(asset.path)) {
      throw new Error('Invalid retention manifest asset path, digest, expiry, or duplicate.');
    }
    assets.set(asset.path, asset);
  }
  return assets;
}
async function retainPreviousAssets({selection, buildDir, api, download, now = Date.now, limits: overrides = {}}) {
  const knownTarget = getFirebaseEnvironment(selection?.name);
  if (!knownTarget.deployable || selection.projectId !== knownTarget.projectId || selection.hostingSite !== knownTarget.hostingSite) {
    throw new Error('Refusing unknown retention target.');
  }
  const limits = {...DEFAULT_LIMITS, ...overrides};
  for (const value of Object.values(limits)) if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Invalid retention resource limit.');
  const startedAt = now();
  const deadline = startedAt + limits.timeoutMs;
  const remaining = () => {
    const time = deadline - now();
    if (time <= 0) throw new Error('Retention deadline / timeout exceeded.');
    return time;
  };
  async function bounded(operation) {
    const time = remaining();
    let timer;
    try {
      return await Promise.race([operation(time), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Retention deadline / timeout exceeded.')), time);
      })]);
    } finally { clearTimeout(timer); }
  }
  assertBuildTree(buildDir);
  if (!fs.existsSync(path.join(buildDir, 'index.html'))) throw new Error('A fresh hardened build is required.');
  if (fs.existsSync(path.join(buildDir, MANIFEST_PATH))) throw new Error('Retention manifest already exists; run a fresh build first.');
  const liveVersion = await bounded(timeoutMs => api.latestVersion({timeoutMs}));
  const versionPrefix = `sites/${selection.hostingSite}/versions/`;
  if (typeof liveVersion !== 'string' || !liveVersion.startsWith(versionPrefix) || !/^[a-zA-Z0-9_-]+$/.test(liveVersion.slice(versionPrefix.length))) {
    throw new Error('Live Hosting version target mismatch.');
  }
  const inventory = new Map();
  const tokens = new Set();
  let pageToken;
  for (let page = 0; ; page++) {
    if (page >= limits.maxPages) throw new Error('Hosting inventory page limit exceeded.');
    const result = await bounded(timeoutMs => api.listFiles({version: liveVersion, pageToken, timeoutMs}));
    if (!result || !Array.isArray(result.files)) throw new Error('Invalid Hosting version file inventory.');
    for (const file of result.files) {
      if (typeof file.path !== 'string' || inventory.has(file.path)) throw new Error('Invalid or duplicate Hosting file path.');
      inventory.set(file.path, file);
      if (inventory.size > limits.maxInventoryFiles) throw new Error('Hosting inventory file limit exceeded.');
    }
    if (!result.nextPageToken) break;
    if (typeof result.nextPageToken !== 'string' || result.nextPageToken.length > 4096 || tokens.has(result.nextPageToken)) throw new Error('Invalid or repeated Hosting inventory page token.');
    tokens.add(result.nextPageToken);
    pageToken = result.nextPageToken;
  }
  async function assertLiveUnchanged() {
    if (await bounded(timeoutMs => api.latestVersion({timeoutMs})) !== liveVersion) throw new Error('Live Hosting version changed; rebuild and retry.');
  }
  await assertLiveUnchanged();
  const origin = `https://${selection.hostingSite}.web.app`;
  async function getFile(file, maxBytes) {
    if (!digestPattern.test(file.hash) || (file.status && file.status !== 'ACTIVE')) throw new Error('Invalid live Hosting file hash or status.');
    const url = new URL(file.path, origin);
    if (url.origin !== origin || url.pathname !== file.path || url.search || url.hash) throw new Error('Asset download target / path mismatch.');
    return verifyDownloadedFile(await bounded(timeoutMs => download(url.href, {maxBytes, timeoutMs})), file.hash, maxBytes);
  }
  let previouslyRetained = new Map();
  const oldManifest = inventory.get(MANIFEST_PATH);
  if (oldManifest) previouslyRetained = readManifest(await getFile(oldManifest, limits.maxManifestBytes), selection, startedAt, limits);
  for (const asset of previouslyRetained.values()) {
    if (Date.parse(asset.expiresAt) > startedAt && !inventory.has(asset.path)) throw new Error('Retention manifest references a missing live asset path.');
  }
  const candidates = [];
  let expiredFiles = 0;
  for (const file of inventory.values()) {
    if (!isRetainablePath(file.path)) continue;
    const prior = previouslyRetained.get(file.path);
    if (prior && Date.parse(prior.expiresAt) <= startedAt) { expiredFiles++; continue; }
    candidates.push({file, prior});
    if (candidates.length > limits.maxFiles) throw new Error('Retention file count limit exceeded.');
  }
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'fnd-hosting-retention-'));
  const copiedFiles = [];
  let retainedBytes = 0;
  let examinedBytes = 0;
  const assets = [];
  const staged = [];
  try {
    // Sequential downloads keep memory bounded to one decoded file; staging is outside build.
    for (const {file, prior} of candidates) {
      const bytes = await getFile(file, limits.maxFileBytes);
      examinedBytes += bytes.length;
      if (examinedBytes > limits.maxTotalBytes) throw new Error('Retention total byte limit exceeded.');
      const digest = sha256(bytes);
      if (prior && prior.sha256 !== digest) throw new Error('Retention manifest content digest mismatch.');
      assertHardenedAsset(file.path, bytes);
      const destination = path.join(buildDir, file.path);
      if (fs.existsSync(destination)) {
        const native = fs.readFileSync(destination);
        if (!bytes.equals(native)) throw new Error(`Hashed asset collision with native build: ${file.path}`);
        continue;
      }
      const stagedPath = path.join(staging, String(staged.length));
      fs.writeFileSync(stagedPath, bytes, {flag: 'wx'});
      staged.push({stagedPath, destination});
      assets.push({path: file.path, sha256: digest, expiresAt: prior?.expiresAt || new Date(startedAt + RETENTION_MS).toISOString()});
      retainedBytes += bytes.length;
    }
    await assertLiveUnchanged();
    remaining();
    assertBuildTree(buildDir);
    assets.sort((a, b) => a.path.localeCompare(b.path, 'en'));
    const manifest = {schemaVersion: 1, projectId: selection.projectId, hostingSite: selection.hostingSite, assets};
    const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
    if (manifestBytes.length > limits.maxManifestBytes) throw new Error('Retention manifest byte limit exceeded.');
    for (const {stagedPath, destination} of staged) {
      fs.mkdirSync(path.dirname(destination), {recursive: true});
      fs.copyFileSync(stagedPath, destination, fs.constants.COPYFILE_EXCL);
      copiedFiles.push(destination);
    }
    fs.writeFileSync(path.join(buildDir, MANIFEST_PATH), manifestBytes, {flag: 'wx'});
    return {liveVersion, retainedFiles: assets.length, retainedBytes, expiredFiles, examinedFiles: candidates.length};
  } catch (error) {
    for (const filePath of copiedFiles) fs.rmSync(filePath, {force: true});
    throw error;
  } finally { fs.rmSync(staging, {recursive: true, force: true}); }
}
function createHttpsReader() {
  // proxy-agent honors inherited HTTPS_PROXY/NO_PROXY; Node keeps inherited CA/TLS policy.
  const {ProxyAgent} = require('proxy-agent');
  const agent = new ProxyAgent();
  return (url, {headers = {}, maxBytes, timeoutMs}) => new Promise((resolve, reject) => {
    let timer;
    const request = https.get(url, {agent, headers}, response => {
      const chunks = [];
      let count = 0;
      response.on('data', chunk => {
        count += chunk.length;
        if (count > maxBytes + 65536) request.destroy(new Error('HTTP download byte limit exceeded.'));
        else chunks.push(chunk);
      });
      response.on('aborted', () => request.destroy(new Error('Partial HTTP download.')));
      response.on('error', reject);
      response.on('end', () => resolve({statusCode: response.statusCode, headers: response.headers, body: Buffer.concat(chunks)}));
    });
    timer = setTimeout(() => request.destroy(new Error('HTTP download timeout.')), timeoutMs);
    request.on('error', reject);
    request.on('close', () => clearTimeout(timer));
  });
}
function createHostingApi({selection, credential, read}) {
  async function get(resource, timeoutMs) {
    const {access_token: token} = await credential.getAccessToken();
    const response = await read(`https://firebasehosting.googleapis.com/v1beta1/${resource}`, {
      headers: {Authorization: `Bearer ${token}`, 'Accept-Encoding': 'identity'}, maxBytes: 4 * 1024 * 1024, timeoutMs,
    });
    if (response.statusCode !== 200) throw new Error(`Hosting metadata HTTP ${response.statusCode}; redirects are refused.`);
    return JSON.parse(response.body.toString('utf8'));
  }
  return {
    latestVersion: async ({timeoutMs}) => {
      const result = await get(`sites/${selection.hostingSite}/channels/live/releases?pageSize=1`, timeoutMs);
      const version = result.releases?.[0]?.version?.name;
      if (!version) throw new Error('Live Hosting release is missing.');
      return version;
    },
    listFiles: ({version, pageToken, timeoutMs}) => get(`${version}/files?pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`, timeoutMs),
  };
}
async function run({environment = process.env, execFileSyncImpl = childProcess.execFileSync, createCredential = createFirebaseCliAdminCredential} = {}) {
  const cwd = path.resolve(__dirname, '..');
  // Inspect actual checkout; an ambient FND_GIT_BRANCH cannot bypass the release branch guard.
  const branchName = execFileSyncImpl('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim();
  const selection = resolveEnvironmentSelection({branchName, environmentName: environment.FND_FIREBASE_ENVIRONMENT,
    projectId: environment.FND_FIREBASE_PROJECT_ID, hostingSite: environment.FND_FIREBASE_HOSTING_SITE, storageBucket: environment.FND_FIREBASE_STORAGE_BUCKET});
  if (!selection.deployable || resolveProjectId(environment) !== selection.projectId) throw new Error('Hosting retention requires the explicit matching Firebase CLI project.');
  const credential = await createCredential({projectId: selection.projectId, cwd});
  const read = createHttpsReader();
  const summary = await retainPreviousAssets({selection, buildDir: path.join(cwd, 'build'), api: createHostingApi({selection, credential, read}),
    download: (url, options) => read(url, {...options, headers: {'Accept-Encoding': 'gzip'}})});
  console.log(`Hosting previous-asset retention: ${JSON.stringify(summary)}`);
  return summary;
}
if (require.main === module) run().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = {MANIFEST_PATH, RETENTION_MS, DEFAULT_LIMITS, retainPreviousAssets, createHttpsReader, createHostingApi, run};
