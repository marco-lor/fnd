#!/usr/bin/env node
// Additive and reversible: never rewrite source timestamps or remove fields.
// Deploy writer/trigger/rules/indexes first; backfill, verify, activate; Hosting
// may ship earlier because the reader uses explicit legacy fallback by default.
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {parseArguments, assertSafeTarget} = require('../backfill-user-directory');
const {createFirebaseCliAdcFile} = require('../firebase-cli-admin-credential');
const {foeOrderSeconds} = require('../../functions/lib/foeOrder');
const KIND = 'task13-foe-order-v1', CONTROL = 'utils/foes_paging', BATCH = 100, MAX_ACTIVATION = 5000;
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fingerprint = plan => hash({...plan, fingerprint: undefined});
const subject = snapshot => ({id: snapshot.id, seconds: foeOrderSeconds(snapshot.data()),
  prior: snapshot.get('task13OrderSeconds') ?? null});

async function inspect(db, operation = 'backfill') {
  const subjects = []; let cursor = null;
  for (;;) {
    let query = db.collection('foes').orderBy('__name__').limit(BATCH);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    subjects.push(...page.docs.map(subject));
    if (page.size < BATCH) break;
    cursor = page.docs.at(-1);
  }
  const control = (await db.doc(CONTROL).get()).data() || null;
  if (control && (control.version !== 1 || !['legacy', 'paged'].includes(control.mode))) {
    throw Error('Unsupported foe paging control version/mode; do not overwrite it.');
  }
  const plan = {kind: KIND, projectId: db.projectId, operation, createdAt: new Date().toISOString(), control,
    subjects, changes: subjects.filter(row => row.prior !== row.seconds).length};
  return {...plan, fingerprint: fingerprint(plan)};
}
function validate(plan, db, approval) {
  if (!plan || plan.kind !== KIND || plan.projectId !== db.projectId || !Array.isArray(plan.subjects)
    || !['backfill', 'activate', 'rollback'].includes(plan.operation)
    || approval !== plan.fingerprint || fingerprint(plan) !== approval) throw Error('Invalid project/plan approval fingerprint.');
  const age = Date.now() - Date.parse(plan.createdAt);
  if (!Number.isFinite(age) || age < 0 || age > 86400000) throw Error('Plan expired; inspect again.');
}
async function apply(db, plan, approval, {offset = 0, maxBatches = Infinity, checkpoint = async () => {}} = {}) {
  validate(plan, db, approval);
  if (!Number.isInteger(offset) || offset < 0 || offset > plan.subjects.length) throw Error('Invalid checkpoint offset.');
  if (plan.operation !== 'backfill') {
    return db.runTransaction(async transaction => {
      const controlRef = db.doc(CONTROL), current = await transaction.get(controlRef);
      if (hash(current.data() || null) !== hash(plan.control)) throw Error('Stale control; inspect again.');
      if (plan.operation === 'activate') {
        // One serializable verification/cutover transaction closes the scan/write
        // race. Limit is an explicit operator safety ceiling, never truncation.
        const rows = await transaction.get(db.collection('foes').orderBy('__name__').limit(MAX_ACTIVATION + 1));
        if (rows.size > MAX_ACTIVATION) throw Error('Activation exceeds the reviewed 5000-foe ceiling.');
        const subjects = rows.docs.map(subject);
        if (subjects.some(row => row.prior !== row.seconds) || hash(subjects) !== hash(plan.subjects)) {
          throw Error('Foe order changed or is incomplete; backfill/inspect again.');
        }
      }
      transaction.set(controlRef, {version: 1, mode: plan.operation === 'activate' ? 'paged' : 'legacy'});
      return {operation: plan.operation, complete: true, records: plan.subjects.length};
    });
  }
  const end = Math.min(plan.subjects.length, offset + maxBatches * BATCH);
  let writes = 0;
  for (let index = offset; index < end; index += 1) {
    const row = plan.subjects[index];
    writes += await db.runTransaction(async transaction => {
      const ref = db.doc('foes/' + row.id), current = await transaction.get(ref);
      if (!current.exists || foeOrderSeconds(current.data()) !== row.seconds ||
        ![row.prior, row.seconds].includes(current.get('task13OrderSeconds') ?? null)) {
        throw Error('Stale source ' + row.id + '; inspect again.');
      }
      if (current.get('task13OrderSeconds') === row.seconds) return 0;
      transaction.update(ref, {task13OrderSeconds: row.seconds}); return 1;
    });
    await checkpoint({kind: KIND, projectId: db.projectId, fingerprint: plan.fingerprint,
      offset: index + 1, complete: index + 1 === plan.subjects.length});
  }
  return {operation: 'backfill', offset: end, complete: end === plan.subjects.length, writes};
}
function options(argv) {
  const args = [...argv]; let operation = 'backfill';
  const at = args.indexOf('--operation');
  if (at !== -1) {operation = args[at + 1]; args.splice(at, 2);}
  if (!['backfill', 'activate', 'rollback'].includes(operation)) throw Error('Invalid --operation.');
  const result = parseArguments(args);
  if (!result.environmentName) throw Error('Explicit --environment required.');
  if (!result.reportPathExplicit) throw Error('Explicit --report required (preserve each reviewed plan).');
  if (result.shouldWrite && operation === 'backfill' && !args.includes('--checkpoint')) throw Error('Explicit --checkpoint required.');
  return {...result, operation};
}
async function main() {
  const opts = options(process.argv.slice(2)); assertSafeTarget(opts);
  // Keep the Admin SDK/credential in one module installation on Windows.
  const req = require('node:module').createRequire(path.resolve(__dirname, '../../functions/package.json'));
  const {initializeApp, deleteApp} = req('firebase-admin/app');
  const {getFirestore} = req('firebase-admin/firestore');
  const previousAdc = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const credential = opts.authMode === 'firebase-cli' ? await createFirebaseCliAdcFile({projectId: opts.projectId}) : null;
  if (credential) process.env.GOOGLE_APPLICATION_CREDENTIALS = credential.filePath;
  let app;
  try {
    app = initializeApp({projectId: opts.projectId}, 'task13-order');
    const db = getFirestore(app);
    if (!opts.shouldWrite) {
      const plan = await inspect(db, opts.operation);
      fs.mkdirSync(path.dirname(opts.reportPath), {recursive: true});
      fs.writeFileSync(opts.reportPath, JSON.stringify(plan, null, 2));
      console.log(JSON.stringify({operation: opts.operation, records: plan.subjects.length, changes: plan.changes, fingerprint: plan.fingerprint}));
      if (opts.verifyOnly && plan.changes) throw Error('Missing or stale order fields.');
    } else {
      const plan = JSON.parse(fs.readFileSync(opts.reportPath, 'utf8'));
      if (plan.operation !== opts.operation) throw Error('Operation does not match the reviewed plan.');
      let offset = 0;
      if (opts.resume) {
        const saved = JSON.parse(fs.readFileSync(opts.checkpointPath, 'utf8'));
        if (saved.kind !== KIND || saved.projectId !== opts.projectId || saved.fingerprint !== plan.fingerprint) throw Error('Foreign checkpoint.');
        offset = saved.offset;
      } else if (opts.operation === 'backfill' && fs.existsSync(opts.checkpointPath)) throw Error('Checkpoint exists; use --resume or a new path.');
      const result = await apply(db, plan, opts.approveFingerprint, {offset, maxBatches: opts.maxBatches, checkpoint: async value => {
        fs.mkdirSync(path.dirname(opts.checkpointPath), {recursive: true});
        const temporary = opts.checkpointPath + '.tmp';
        fs.writeFileSync(temporary, JSON.stringify(value, null, 2)); fs.renameSync(temporary, opts.checkpointPath);
      }});
      console.log(JSON.stringify(result));
    }
  } finally {
    try {if (app) await deleteApp(app);}
    finally {
      if (previousAdc === undefined) delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
      else process.env.GOOGLE_APPLICATION_CREDENTIALS = previousAdc;
      credential?.cleanup();
    }
  }
}
if (require.main === module) main().catch(error => {console.error(error.message); process.exitCode = 1;});
module.exports = {inspect, apply, options, validate, fingerprint, CONTROL};
