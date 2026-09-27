#!/usr/bin/env node
// Additive schema v1 rollout. Deploy triggers/rules, dry-run, write, verify,
// then release Hosting. Rollback Hosting leaves the old canonical reader valid.
const {parseArguments, assertSafeTarget} = require('../backfill-user-directory');
const {createFirebaseCliAdcFile} = require('../firebase-cli-admin-credential');
const {inspectManagerUserSummary} = require('../../functions/lib/managerUserSummary');

const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const KIND = 'task11-manager-summaries-v2';
const BATCH_SIZE = 50;
const fingerprint = (report) => createHash('sha256').update(JSON.stringify({
  kind: report.kind, mode: report.mode, projectId: report.projectId, batchSize: report.batchSize,
  createdAt: report.createdAt, complete: report.complete, subjects: report.subjects, counts: report.counts,
})).digest('hex');
const parseOptions = (argv) => {
  const options = parseArguments(argv);
  if (!['performance', 'staging', 'production'].includes(options.environmentName)) throw new Error('Task11 requires an explicit performance, staging or production environment.');
  if (!options.reportPathExplicit) options.reportPath = path.resolve('performance-results',
    options.verifyOnly ? 'task11-summary-verify.json' : 'task11-summary-dry-run.json');
  if (!argv.includes('--checkpoint')) options.checkpointPath = path.resolve('performance-results/task11-summary-checkpoint.json');
  if (options.reportPath === options.checkpointPath) throw new Error('Report and checkpoint paths must differ.');
  return options;
};
const validateReport = (report, projectId, approval, now = Date.now()) => {
  if (!report || report.kind !== KIND || report.mode !== 'dry-run' || report.projectId !== projectId ||
      report.batchSize !== BATCH_SIZE || report.complete !== true || !Array.isArray(report.subjects)) {
    throw new Error('A complete Task11 dry-run report for this project is required.');
  }
  if (!approval || !/^[a-f0-9]{64}$/.test(approval) || approval !== report.planFingerprint || approval !== fingerprint(report)) {
    throw new Error('Missing or mismatched --approve-fingerprint.');
  }
  const age = now - Date.parse(report.createdAt);
  if (!Number.isFinite(age) || age < 0 || age > 86400000) throw new Error('Dry-run approval expired; create a fresh report (24 hour limit).');
  let previous = '';
  for (const entry of report.subjects) {
    if (!entry.uid || entry.uid.includes('/') || entry.uid <= previous ||
        !['set', 'delete', 'unchanged'].includes(entry.action) ||
        ![entry.currentHash, entry.projectionHash].every((hash) => /^[a-f0-9]{64}$/.test(hash))) throw new Error('Invalid dry-run subjects.');
    previous = entry.uid;
  }
  return report;
};
const readPlan = async ({db, projectId, maxBatches = Infinity, mode = 'dry-run', inspect = inspectManagerUserSummary}) => {
  const ids = new Set();
  let batches = 0, complete = true;
  for (const collection of ['users', 'manager_user_summaries']) {
    let cursor = '';
    for (;;) {
      if (batches >= maxBatches) { complete = false; break; }
      let query = db.collection(collection).orderBy('__name__').limit(BATCH_SIZE);
      if (cursor) query = query.startAfter(cursor);
      const page = await query.get();
      batches += 1;
      page.docs.forEach((doc) => ids.add(doc.id));
      if (page.size < BATCH_SIZE) break;
      cursor = page.docs.at(-1).id;
    }
    if (!complete) break;
  }
  const subjects = [];
  for (const uid of [...ids].sort()) subjects.push(await inspect(db, uid, false));
  const counts = subjects.reduce((value, entry) => { value[entry.action] += 1; return value; }, {set: 0, delete: 0, unchanged: 0});
  const report = {kind: KIND, mode, projectId, batchSize: BATCH_SIZE, createdAt: new Date().toISOString(), complete, subjects, counts};
  report.planFingerprint = fingerprint(report);
  return report;
};
const run = async ({db, projectId = db.projectId, write = false, maxBatches = Infinity,
  report, approveFingerprint, checkpoint, mode = 'dry-run', onCheckpoint = () => {}, inspect = inspectManagerUserSummary}) => {
  if (!write) return readPlan({db, projectId, maxBatches, mode, inspect});
  validateReport(report, projectId, approveFingerprint);
  if (checkpoint && (checkpoint.kind !== KIND || checkpoint.projectId !== projectId ||
      checkpoint.planFingerprint !== report.planFingerprint || !Number.isInteger(checkpoint.nextIndex) ||
      checkpoint.nextIndex < 0 || checkpoint.nextIndex > report.subjects.length ||
      checkpoint.complete !== (checkpoint.nextIndex === report.subjects.length) ||
      !checkpoint.counts || ['set', 'delete', 'unchanged'].some((key) => !Number.isInteger(checkpoint.counts[key]) || checkpoint.counts[key] < 0) ||
      Object.values(checkpoint.counts).reduce((sum, value) => sum + value, 0) !== checkpoint.nextIndex)) throw new Error('Invalid or cross-plan checkpoint.');
  // Preflight the whole subject set before any write; apply itself is bounded.
  const current = await readPlan({db, projectId, inspect});
  const approved = new Map(report.subjects.map((entry) => [entry.uid, entry]));
  const completed = new Set(report.subjects.slice(0, checkpoint?.nextIndex || 0).map((entry) => entry.uid));
  for (const entry of current.subjects) {
    const original = approved.get(entry.uid);
    const allowed = completed.has(entry.uid) ? [original?.projectionHash] :
      checkpoint ? [original?.currentHash, original?.projectionHash] : [original?.currentHash];
    if (!original || original.projectionHash !== entry.projectionHash || !allowed.includes(entry.currentHash)) throw new Error(`Stale dry-run report for ${entry.uid}.`);
    approved.delete(entry.uid);
  }
  // An orphan delete can commit immediately before its checkpoint is saved.
  for (const entry of approved.values()) if (!checkpoint || entry.action !== 'delete') throw new Error(`Stale dry-run report for removed ${entry.uid}.`);
  const state = {kind: KIND, projectId, planFingerprint: report.planFingerprint,
    nextIndex: checkpoint?.nextIndex || 0, complete: false,
    counts: {...(checkpoint?.counts || {set: 0, delete: 0, unchanged: 0})}};
  const end = Math.min(report.subjects.length, state.nextIndex + maxBatches * BATCH_SIZE);
  state.complete = state.nextIndex === report.subjects.length;
  await onCheckpoint({...state, counts: {...state.counts}});
  while (state.nextIndex < end) {
    const entry = report.subjects[state.nextIndex];
    const result = await inspect(db, entry.uid, true, entry);
    state.counts[result.action] += 1;
    state.nextIndex += 1;
    state.complete = state.nextIndex === report.subjects.length;
    await onCheckpoint({...state, counts: {...state.counts}});
  }
  return state;
};
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2));
  fs.renameSync(temporary, file);
};

const main = async () => {
  const options = parseOptions(process.argv.slice(2));
  assertSafeTarget(options);
  let report, checkpoint;
  if (options.shouldWrite) {
    report = JSON.parse(fs.readFileSync(options.reportPath, 'utf8'));
    validateReport(report, options.projectId, options.approveFingerprint);
    if (options.resume) checkpoint = JSON.parse(fs.readFileSync(options.checkpointPath, 'utf8'));
    else if (fs.existsSync(options.checkpointPath)) throw new Error('Checkpoint already exists; use --resume or a new --checkpoint path.');
  }
  const {initializeApp, deleteApp} = require('firebase-admin/app');
  const {getFirestore} = require('firebase-admin/firestore');
  const previousAdc = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const credential = options.authMode === 'firebase-cli'
    ? await createFirebaseCliAdcFile({projectId: options.projectId}) : null;
  if (credential) process.env.GOOGLE_APPLICATION_CREDENTIALS = credential.filePath;
  let app;
  try {
    app = initializeApp({projectId: options.projectId}, 'task11-summary-backfill');
    const result = await run({db: getFirestore(app), projectId: options.projectId, write: options.shouldWrite,
      maxBatches: options.maxBatches, mode: options.verifyOnly ? 'verify' : 'dry-run', report, approveFingerprint: options.approveFingerprint, checkpoint,
      onCheckpoint: (value) => writeJson(options.checkpointPath, value)});
    if (!options.shouldWrite) writeJson(options.reportPath, result);
    console.log(JSON.stringify({projectId: options.projectId, mode: options.shouldWrite ? 'write' : options.verifyOnly ? 'verify' : 'dry-run', ...result}));
    if (options.verifyOnly && (!result.complete || result.counts.set || result.counts.delete)) throw new Error('Summary verification failed: incomplete, missing, stale or orphaned projections.');
  } finally {
    try { if (app) await deleteApp(app); }
    finally {
      if (previousAdc === undefined) delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
      else process.env.GOOGLE_APPLICATION_CREDENTIALS = previousAdc;
      credential?.cleanup();
    }
  }
};
if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = {parseOptions, run, validateReport, fingerprint};
