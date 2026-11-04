const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const { createRequire } = require('node:module');
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const {
  collection, disableNetwork, doc, enableNetwork, getDocs, getDocsFromCache,
  orderBy, query, serverTimestamp, setDoc, Timestamp,
} = require('firebase/firestore');
const { transformFileSync } = require('@babel/core');

// Load the actual browser projector/runtime with only transport/config replaced.
// This keeps the emulator comparison on the shipped comparator and public SDK.
const loadSource = (relative, replacements = {}) => {
  const filename = path.resolve(__dirname, '../../src', relative);
  const code = transformFileSync(filename, {
    babelrc: false, configFile: false,
    plugins: [require.resolve('@babel/plugin-transform-modules-commonjs')],
  }).code;
  const exports = {};
  const nativeRequire = createRequire(filename);
  const localRequire = (name) => Object.prototype.hasOwnProperty.call(replacements, name)
    ? replacements[name] : nativeRequire(name);
  new Function('require', 'exports', code)(localRequire, exports);
  return exports;
};
const telemetry = loadSource('data/telemetryKeys.js');
const runtime = loadSource('data/repositoryRuntime.js', { './telemetryKeys': telemetry });
const { createEchiNpcsProjector } = loadSource('data/echiNpcsRepository.js', {
  '../components/firebaseConfig': { db: null }, '../performance/firestore': {}, './repositoryRuntime': runtime,
});

test('Task15B derived sidebar matches native DESC query for mixed types, missing/null, ties and pending/acknowledged timestamps', { timeout: 30_000 }, async () => {
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8080', 'Run only against the owned local emulator');
  const environment = await initializeTestEnvironment({
    projectId: 'demo-fnd-perf',
    firestore: { host: '127.0.0.1', port: 8080, rules: "rules_version = '2'; service cloud.firestore { match /databases/{database}/documents { match /{path=**} { allow read, write: if true; } } }" },
  });
  const db = environment.unauthenticatedContext().firestore();
  const target = collection(db, 'task15b_npc_order');
  const native = query(target, orderBy('createdAt', 'desc'));
  try {
    await environment.clearFirestore();
    const fixtures = [
      ['missing', { nome: 'Map only' }], ['null-a', { createdAt: null }], ['null-z', { createdAt: null }],
      ['timestamp-a', { createdAt: new Timestamp(100, 1000) }], ['timestamp-z', { createdAt: new Timestamp(100, 2000) }],
      ['future', { createdAt: new Timestamp(253402300799, 0) }],
      ['string-a', { createdAt: '2026-01-01T00:00:00.000Z' }], ['string-z', { createdAt: '2026-01-01T00:00:00.000Z' }],
      ['\ufffd', { createdAt: 'same' }], ['😀', { createdAt: 'same' }],
    ];
    await Promise.all(fixtures.map(([id, data]) => setDoc(doc(target, id), data)));
    const compareQueries = async (reader) => {
      const complete = await reader(target);
      const ordered = await reader(native);
      const projection = createEchiNpcsProjector()(complete);
      assert.deepEqual(projection.items.map((npc) => npc.id), ordered.docs.map((document) => document.id));
      assert.ok(projection.byId.missing);
      assert.ok(!projection.items.some((npc) => npc.id === 'missing'));
      return projection;
    };
    await compareQueries(getDocs);
    await disableNetwork(db);
    const write = setDoc(doc(target, 'pending'), { nome: 'Pending NPC', createdAt: serverTimestamp() });
    const pending = await compareQueries(getDocsFromCache);
    assert.equal(pending.byId.pending.createdAt, null);
    assert.ok(pending.items.findIndex((npc) => npc.id === 'pending') < pending.items.findIndex((npc) => npc.id === 'future'), 'pending timestamps sort above even future acknowledged timestamps');
    await enableNetwork(db);
    await write;
    const acknowledged = await compareQueries(getDocs);
    assert.ok(acknowledged.byId.pending.createdAt instanceof Timestamp);
    console.info('Task15B native order comparison: mixed/null/missing/Unicode/ties PASS; pending PASS; acknowledged PASS');
  } finally {
    await enableNetwork(db);
    await environment.clearFirestore();
    await db.terminate();
    await environment.cleanup();
  }
});
