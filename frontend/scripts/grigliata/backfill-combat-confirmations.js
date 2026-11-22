// Older journals say "done" while an owner can still apply damage. Make those
// actions discoverable by the existing unbounded pending-action query.
const {initializeApp, deleteApp} = require('firebase-admin/app');
const {FieldPath, getFirestore} = require('firebase-admin/firestore');
const {combatNeedsConfirmation} = require('../../functions/lib/grigliataCombatCore');
const {resolveOperatorTarget, FRONTEND_ROOT} = require('../firebase-operator-target');
const {createFirebaseCliAdcFile} = require('../firebase-cli-admin-credential');

const needsConfirmation = event => event?.status === 'done' && Array.isArray(event.targets) &&
  combatNeedsConfirmation(event.targets, event.effects);

async function main() {
  const [mode, ...extra] = process.argv.slice(2);
  if (!['--check', '--apply'].includes(mode) || extra.length) throw new Error('Use --check or --apply.');
  const target = resolveOperatorTarget({options: {
    environmentName: 'staging', hostingSite: 'fatin-test', projectId: 'fatin-test', storageBucket: 'fatin-test.firebasestorage.app',
  }});
  if (process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Use the staging Firestore connection.');
  const adc = await createFirebaseCliAdcFile({projectId: target.projectId, cwd: FRONTEND_ROOT});
  const previous = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  let app;
  try {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = adc.filePath;
    app = initializeApp({projectId: target.projectId});
    const db = getFirestore(app);
    db.settings({preferRest: true});
    const query = db.collection('grigliata_combat_actions').where('status', '==', 'done')
      .orderBy(FieldPath.documentId()).limit(100);
    let last;
    let candidates = 0;
    let updated = 0;
    do {
      const page = await (last ? query.startAfter(last) : query).get();
      for (const row of page.docs) {
        if (!needsConfirmation(row.data())) continue;
        candidates++;
        if (mode === '--apply') {
          const changed = await db.runTransaction(async transaction => {
            const current = await transaction.get(row.ref);
            if (!needsConfirmation(current.data())) return false;
            transaction.update(row.ref, {status: 'awaitingConfirmation', resolvedAt: null});
            return true;
          });
          if (changed) updated++;
        }
      }
      last = page.size === 100 ? page.docs[page.size - 1] : null;
    } while (last);
    console.log(JSON.stringify({project: target.projectId, mode, candidates, updated}));
  } finally {
    try {
      if (app) await deleteApp(app);
    } finally {
      if (previous === undefined) delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
      else process.env.GOOGLE_APPLICATION_CREDENTIALS = previous;
      adc.cleanup();
    }
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
