#!/usr/bin/env node
'use strict';
// One explicitly reviewed action per invocation. Re-inspect after a committed
// batch or an uncertain/crashed invocation; the server marker is authoritative.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const {execFileSync} = require('node:child_process');
const {createRequire} = require('node:module');
const {FRONTEND_ROOT, resolveOperatorTarget} = require('../firebase-operator-target');
const {createFirebaseCliAdcFile} = require('../firebase-cli-admin-credential');
const {validatePath} = require('../task09/catalog-migration');
const core = require('../../functions/lib/codexCore');
const GIT_SAFE = 'safe.directory=' + path.resolve(FRONTEND_ROOT, '..').replace(/\\/g, '/');
function parse(argv) {
  const names = {'--environment': 'environmentName', '--project': 'projectId', '--site': 'hostingSite', '--bucket': 'storageBucket',
    '--mode': 'mode', '--action': 'action', '--generation': 'generation', '--output': 'output', '--backup': 'backup', '--plan': 'plan',
    '--reviewed-fingerprint': 'reviewedFingerprint', '--confirm-target': 'confirmTarget', '--auth': 'auth', '--resume': 'resume', '--rollback': 'rollback'};
  const options = {mode: 'inspect'}, seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    const name = names[argv[i]];
    if (!name || seen.has(name) || !argv[i + 1] || argv[i + 1].startsWith('--')) throw Error('Unknown, missing or duplicate argument.');
    seen.add(name); options[name] = argv[++i];
  }
  return options;
}
function guard(o, environment, branch) {
  if (!['staging', 'production'].includes(o.environmentName) || o.auth !== 'firebase-cli') throw Error('Explicit staging/production target and --auth firebase-cli required.');
  if (Object.keys(environment).some(k => /EMULATOR|FIREBASE_CONFIG/.test(k) && environment[k])) throw Error('Ambiguous emulator/Firebase environment rejected.');
  const target = resolveOperatorTarget({options: o, environment: {FND_GIT_BRANCH: branch}, cwd: FRONTEND_ROOT});
  for (const [key, value] of Object.entries({FND_GIT_BRANCH: branch, GITHUB_HEAD_REF: branch, GITHUB_REF_NAME: branch, BRANCH_NAME: branch,
    GCLOUD_PROJECT: target.projectId, GOOGLE_CLOUD_PROJECT: target.projectId, FND_FIREBASE_ENVIRONMENT: target.name,
    FND_FIREBASE_PROJECT_ID: target.projectId, FND_FIREBASE_HOSTING_SITE: target.hostingSite, FND_FIREBASE_STORAGE_BUCKET: target.storageBucket})) {
    if (environment[key] && environment[key] !== value) throw Error('Conflicting inherited target/branch rejected.');
  }
  if (!['inspect', 'apply'].includes(o.mode) || !core.ACTIONS.includes(o.action) || !/^[A-Za-z0-9_-]{1,128}$/.test(o.generation || '')) throw Error('Explicit mode, action and safe generation required.');
  if (o.mode === 'apply' && (o.confirmTarget !== target.projectId || !o.plan || !/^[a-f0-9]{64}$/.test(o.reviewedFingerprint || ''))) throw Error('Apply requires target confirmation and reviewed plan fingerprint.');
  if (o.mode === 'apply' && o.action.startsWith('rollback') && o.rollback !== o.generation) throw Error('Rollback requires --rollback with exact generation.');
  if (o.mode === 'apply' && o.action === 'resume-v2' && o.resume !== o.generation) throw Error('Resuming v2 requires --resume with exact generation.');
  return target;
}
function codeIdentity() {
  const files = ['src/data/codexModel.js', 'functions/src/codexCore.js', 'functions/src/codex.ts', 'functions/lib/codexCore.js', 'functions/lib/codexModel.js', 'functions/lib/codex.js',
    'functions/scripts/package-codex.js', 'scripts/task12/codex-migration.js', 'scripts/task09/catalog-migration.js', 'scripts/firebase-operator-target.js',
    'scripts/firebase-environment.js', 'scripts/firebase-cli-admin-credential.js', 'firestore.rules', 'firestore.indexes.json'];
  for (const [a, b] of [['src/data/codexModel.js', 'functions/lib/codexModel.js'], ['functions/src/codexCore.js', 'functions/lib/codexCore.js']]) {
    if (!fs.readFileSync(path.join(FRONTEND_ROOT, a)).equals(fs.readFileSync(path.join(FRONTEND_ROOT, b)))) throw Error('Rebuild Functions: Codex package parity mismatch.');
  }
  return core.hash(files.map(file => [file, core.hash(fs.readFileSync(path.join(FRONTEND_ROOT, file)).toString('base64'))]));
}
function writeExclusive(file, value) {
  validatePath(file); fs.mkdirSync(path.dirname(file), {recursive: true});
  const fd = fs.openSync(file, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
async function connect(target) {
  const req = createRequire(path.join(FRONTEND_ROOT, 'functions/package.json'));
  const {initializeApp, deleteApp} = req('firebase-admin/app'), {getFirestore} = req('firebase-admin/firestore');
  const previous = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const credential = await createFirebaseCliAdcFile({projectId: target.projectId, cwd: FRONTEND_ROOT, tempDirectory: fs.realpathSync(os.tmpdir())});
  let app;
  const close = async () => { try { if (app) await deleteApp(app); } finally { if (previous === undefined) delete process.env.GOOGLE_APPLICATION_CREDENTIALS; else process.env.GOOGLE_APPLICATION_CREDENTIALS = previous; credential.cleanup(); } };
  try { process.env.GOOGLE_APPLICATION_CREDENTIALS = credential.filePath; app = initializeApp({projectId: target.projectId}, 'task12-' + process.pid); return {db: getFirestore(app), close}; }
  catch (error) { await close(); throw error; }
}
async function run(o, injected = {}) {
  const branch = injected.branch ?? execFileSync('git', ['-c', GIT_SAFE, 'rev-parse', '--abbrev-ref', 'HEAD'], {cwd: FRONTEND_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim();
  const target = guard(o, injected.environment || process.env, branch);
  if (!process.versions.node.startsWith('22.') || !process.versions.icu) throw Error('Node22 and ICU required.');
  const scope = {target, branch, codeHash: (injected.codeIdentity || codeIdentity)()};
  const output = validatePath(o.output), backup = o.mode === 'apply' ? validatePath(o.backup) : null;
  if (fs.existsSync(output) || (backup && fs.existsSync(backup)) || output === backup) throw Error('Use distinct new artifact paths.');
  let plan;
  if (o.mode === 'apply') {
    const file = validatePath(o.plan);
    if (file === output || file === backup) throw Error('Plan/output/backup must differ.');
    plan = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (plan.action !== o.action || plan.generation !== o.generation) throw Error('Plan action/generation mismatch.');
  }
  const connection = await (injected.connect || connect)(target);
  try {
    const before = await core.readState(connection.db, o.generation);
    if (o.mode === 'inspect') {
      const result = core.makePlan(before, o.action, o.generation, scope);
      writeExclusive(output, result); return result;
    }
    core.validatePlan(plan, o.reviewedFingerprint, before, o.action, o.generation, scope);
    const marker = before.documents.find(d => d.path === `codex_versions/${o.generation}`)?.data;
    if (o.action === 'backfill' && marker?.offset > 0 && o.resume !== o.generation) throw Error('Existing checkpoint requires --resume with exact generation.');
    writeExclusive(backup, {kind: 'task12-pre-action-backup', fingerprint: plan.fingerprint, scope, state: before});
    try {
      const result = await core.applyPlan(connection.db, plan, o.reviewedFingerprint, scope);
      const after = await core.readState(connection.db, o.generation);
      if (o.action === 'rollback' && result.digest && core.sourceHash(after.source) !== result.digest) throw Error('Persisted rollback content/order verification failed.');
      writeExclusive(output, {kind: 'task12-checkpoint', status: 'committed', action: o.action, generation: o.generation, fingerprint: plan.fingerprint, result, stateDigest: core.hash(after), scope});
      return {status: 'committed', ...result};
    } catch (_) {
      writeExclusive(output, {kind: 'task12-checkpoint', status: 'inspect-required', generation: o.generation, fingerprint: plan.fingerprint, scope,
        recovery: 'Retain backup. Inspect current state with a fresh output; never reuse a stale plan. Resume backfill with exact generation or review rollback.'});
      throw Error('Action failed or outcome uncertain; retained checkpoint/backup require fresh inspect.');
    }
  } finally { await connection.close(); }
}
if (require.main === module) run(parse(process.argv.slice(2))).then(result => console.log(JSON.stringify(result))).catch(() => { console.error('Codex operator stopped. Check explicit target, reviewed fingerprint, checkpoint and retained backup; SDK details suppressed.'); process.exitCode = 1; });
module.exports = {parse, guard, codeIdentity, run};
