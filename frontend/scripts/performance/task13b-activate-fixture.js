const {configureOwnedPerformanceEnvironment, assertPerformanceProject} = require('./common');
const {inspect, apply} = require('../task13/foe-order-migration');
async function main() {
  configureOwnedPerformanceEnvironment(); assertPerformanceProject('demo-fnd-perf');
  if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080') throw Error('Owned loopback emulator required.');
  const req = require('node:module').createRequire(require('node:path').resolve(__dirname, '../../functions/package.json'));
  const {initializeApp, deleteApp} = req('firebase-admin/app'), {getFirestore} = req('firebase-admin/firestore');
  const app = initializeApp({projectId: 'demo-fnd-perf'}, 'task13-fixture');
  try {
    const db = getFirestore(app);
    for (const action of ['backfill', 'activate']) {const plan = await inspect(db, action); await apply(db, plan, plan.fingerprint);}
    console.log('Task13 fixture: additive order fields verified; bounded paging active.');
  } finally {await deleteApp(app);}
}
if (require.main === module) main().catch(error => {console.error(error); process.exitCode = 1;});
