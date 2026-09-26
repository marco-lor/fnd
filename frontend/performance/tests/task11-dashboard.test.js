const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {initializeTestEnvironment, assertFails, assertSucceeds} = require('@firebase/rules-unit-testing');
const sdk = require('firebase/firestore');
const admin = require('../../functions/node_modules/firebase-admin');
const {buildDocuments} = require('../../scripts/performance/fixtures');
const {buildUserDirectoryQuery} = require('../../src/data/userDirectoryQueryFactory');
const {buildManagerUserSummary, reconcileManagerUserSummary, inspectManagerUserSummary, syncManagerUserSummary, syncManagerUserSummaryShell, maintainManagerSummaryInTransaction, summaryMaintainedInCommit} = require('../../functions/lib/managerUserSummary');
const {task05AdjustGold, task05UpdateProgression, task05UpdateResource} = require('../../functions/lib/userDataCommands');
const {run: backfill} = require('../../scripts/task11/backfill-manager-summaries');

let env, db;
const fixture = buildDocuments();
const {task11Dashboard: budget} = require('../budgets.json');
const byteSize = (data) => Buffer.byteLength(JSON.stringify(data));
const cursor = (doc, queryKey) => ({version: 1, queryKey, sortValues: [doc.data().normalizedLabel], documentId: doc.id});
before(async () => {
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8080');
  admin.initializeApp({projectId: 'demo-fnd-perf'});
  db = admin.firestore();
  env = await initializeTestEnvironment({projectId: 'demo-fnd-perf', firestore: {
    host: '127.0.0.1', port: 8080, rules: fs.readFileSync(path.resolve(__dirname, '../../firestore.rules'), 'utf8'),
  }});
  await env.clearFirestore();
  const docs = fixture.filter(({path}) => /^(users|user_directory)\//.test(path) || path === 'utils/varie');
  for (let start = 0; start < docs.length; start += 400) {
    const batch = db.batch();
    docs.slice(start, start + 400).forEach(({path, data}) => batch.set(db.doc(path), data));
    await batch.commit();
  }
  const report = await backfill({db});
  const first = await backfill({db, write: true, report, approveFingerprint: report.planFingerprint, maxBatches: 1});
  assert.equal(first.complete, false);
  const result = await backfill({db, write: true, report, approveFingerprint: report.planFingerprint, checkpoint: first});
  assert.equal(result.complete, true);
  assert.equal(result.counts.set, 198);
});
after(async () => { await env?.cleanup(); await admin.app().delete(); });

test('exact directory query: every player reachable, prefix normalized, cursor scoped, role matrix', async () => {
  const dm = env.authenticatedContext('perf-dm').firestore();
  const query = (firestore, options = {}) => buildUserDirectoryQuery({firestore, sdk, role: 'player', pageSize: 10, ...options});
  const ids = [];
  let next = null;
  do {
    const built = query(dm, {cursor: next});
    const page = await sdk.getDocs(built.target);
    assert.ok(page.size <= 10);
    ids.push(...page.docs.map((doc) => doc.id));
    next = page.size === 10 ? cursor(page.docs.at(-1), built.queryKey) : null;
  } while (next);
  assert.equal(ids.length, 198);
  assert.equal(new Set(ids).size, 198);
  const built = query(dm, {search: ' PÉRFORMANCE   Hero 1 '});
  const page = await sdk.getDocs(built.target);
  assert.equal(page.size, 10);
  assert.ok(page.docs.every((doc) => doc.data().normalizedLabel.startsWith('performance hero 1')));
  assert.throws(() => query(dm, {search: 'other', cursor: cursor(page.docs.at(-1), built.queryKey)}), /queryKey/);
  for (const actor of [env.unauthenticatedContext(), env.authenticatedContext('perf-player')]) {
    await assertFails(sdk.getDocs(query(actor.firestore(), {search: 'performance'}).target));
    await assertFails(sdk.getDoc(sdk.doc(actor.firestore(), 'manager_user_summaries/perf-player')));
  }
  for (const uid of ['perf-dm', 'perf-webmaster']) {
    const firestore = env.authenticatedContext(uid).firestore();
    await assertSucceeds(sdk.getDocs(query(firestore, {search: 'performance'}).target));
    const summary = await assertSucceeds(sdk.getDoc(sdk.doc(firestore, 'manager_user_summaries/perf-player')));
    assert.ok(byteSize(summary.data()) < 350);
    await assertFails(sdk.setDoc(sdk.doc(firestore, 'manager_user_summaries/perf-player'), {}));
    await assertFails(sdk.getDocs(sdk.collection(firestore, 'manager_user_summaries')));
  }
});

test('Unicode prefix queries retain supplementary names, scalar boundaries and tied pagination', async () => {
  const labels = ['anna', 'anna😀', 'anna😀', 'annb', '\ud7ff', '\ud7ff😀', '\ue000'];
  const ids = labels.map((_label, index) => `task11-unicode-${index}`);
  try {
    await Promise.all(labels.map((normalizedLabel, index) => db.doc(`user_directory/${ids[index]}`).set({
      schemaVersion: 1, characterId: normalizedLabel, label: normalizedLabel, normalizedLabel, role: 'player',
    })));
    for (const [search, expected] of [['anna', ids.slice(0, 3)], ['\ud7ff', ids.slice(4, 6)]]) {
      for (const uid of ['perf-dm', 'perf-webmaster']) {
        const reached = [];
        let next = null;
        do {
          const query = buildUserDirectoryQuery({firestore: env.authenticatedContext(uid).firestore(), sdk,
            role: 'player', search, pageSize: 1, cursor: next});
          const page = await assertSucceeds(sdk.getDocs(query.target));
          reached.push(...page.docs.map(({id}) => id));
          next = page.size ? cursor(page.docs[0], query.queryKey) : null;
        } while (next);
        assert.deepEqual(reached, expected);
      }
      for (const actor of [env.unauthenticatedContext(), env.authenticatedContext('perf-player')]) {
        await assertFails(sdk.getDocs(buildUserDirectoryQuery({firestore: actor.firestore(), sdk,
          role: 'player', search, pageSize: 1}).target));
      }
    }
  } finally {
    await Promise.all(ids.map((id) => db.doc(`user_directory/${id}`).delete()));
  }
});

test('Dashboard resource floors are transactional, optional, concurrent and replay safe', async () => {
  const target = db.doc('users/perf-player/state/resources');
  const original = (await target.get()).data();
  const invoke = (data) => task05UpdateResource.run({auth: {uid: 'perf-dm', token: {}},
    data: {userId: 'perf-player', mode: 'delta', floorAtZero: true, ...data}});
  try {
    for (const resource of ['hp', 'mana', 'essenza']) {
      await target.set({stats: {[`${resource}Current`]: 2}}, {merge: true});
      const requests = [0, 1].map((index) => ({resource, value: -5, operationId: `task11-floor-${resource}-${index}`}));
      const results = await Promise.all(requests.map(invoke));
      assert.deepEqual(results.map(({appliedDelta}) => appliedDelta).sort((a, b) => a - b), [-2, 0]);
      assert.equal((await target.get()).get(`stats.${resource}Current`), 0);
      const revision = (await target.get()).get('revision');
      await invoke(requests[0]);
      assert.equal((await target.get()).get('revision'), revision);
      await assert.rejects(invoke({...requests[0], floorAtZero: false}), /different|reused|payload|operation/i);
      await invoke({resource, value: -1, floorAtZero: false, operationId: `task11-unfloored-${resource}`});
      assert.equal((await target.get()).get(`stats.${resource}Current`), -1);
      const added = await invoke({resource, value: 100, operationId: `task11-floor-add-${resource}`});
      assert.equal(added.newValue, 99);
    }
    await assert.rejects(invoke({resource: 'hp', value: -1, floorAtZero: 'yes', operationId: 'task11-bad-floor'}), /boolean/);
    await target.set({stats: {barrieraCurrent: 2, barrieraTotal: 3}}, {merge: true});
    assert.equal((await invoke({resource: 'barriera', value: 9, operationId: 'task11-floor-barrier-up'})).newValue, 3);
    assert.equal((await invoke({resource: 'barriera', value: -9, operationId: 'task11-floor-barrier-down'})).newValue, 0);
  } finally { await target.set(original); }
});

test('real SDK snapshot payload and onSnapshot ownership: 0/1/3 expanded populated users', async () => {
  const firestore = env.authenticatedContext('perf-dm').firestore();
  const ids = ['perf-player', 'perf-peer-2', 'perf-peer-3', 'perf-user-0009', 'perf-user-0099', 'perf-user-0100', 'perf-user-0101', 'perf-user-0102', 'perf-user-0103', 'perf-user-0104'];
  const stops = new Map();
  let receivedBytes = 0;
  const listen = (key, target) => new Promise((resolve, reject) => {
    const stop = sdk.onSnapshot(target, (snapshot) => {
      receivedBytes += snapshot.docs ? snapshot.docs.reduce((sum, doc) => sum + byteSize(doc.data()), 0)
        : snapshot.exists() ? byteSize(snapshot.data()) : 0;
      resolve();
    }, reject);
    stops.set(key, stop);
  });
  try {
    // This supplemental view intentionally selects three populated fixture users;
    // the directory query itself is the exact production first-page query.
    await listen('directory', buildUserDirectoryQuery({firestore, sdk, role: 'player', pageSize: 10}).target);
    await Promise.all(ids.map((uid) => listen(`summary:${uid}`, sdk.doc(firestore, `manager_user_summaries/${uid}`))));
    const samples = [{expanded: 0, listeners: stops.size, serializedSnapshotBytes: receivedBytes}];
    const expand = async (uid) => {
      await Promise.all([
        listen(`detail:${uid}:profileContent`, sdk.doc(firestore, `users/${uid}/state/profileContent`)),
        listen(`detail:${uid}:inventory`, sdk.collection(firestore, `users/${uid}/inventory`)),
        ...['spells', 'tecniche'].map((domain) => listen(`detail:${uid}:${domain}`, sdk.query(sdk.collection(firestore, `users/${uid}/${domain}`), sdk.orderBy('normalizedName'), sdk.orderBy(sdk.documentId())))),
        listen(`detail:${uid}:dice`, sdk.query(sdk.collection(firestore, `users/${uid}/diceRolls`), sdk.orderBy('createdAt', 'desc'), sdk.limit(20))),
      ]);
    };
    await expand(ids[0]); samples.push({expanded: 1, listeners: stops.size, serializedSnapshotBytes: receivedBytes});
    await expand(ids[1]); await expand(ids[2]); samples.push({expanded: 3, listeners: stops.size, serializedSnapshotBytes: receivedBytes});
    assert.deepEqual(samples.map((sample) => sample.listeners), budget.listeners);
    assert.ok(samples[0].serializedSnapshotBytes <= budget.serializedPayloadBytes[0]);
    assert.ok(samples[1].serializedSnapshotBytes <= budget.serializedPayloadBytes[1]);
    assert.ok(samples[2].serializedSnapshotBytes <= budget.serializedPayloadBytes[2]);
    for (const [key, stop] of stops) if (key.startsWith('detail:')) { stop(); stops.delete(key); }
    assert.equal(stops.size, 11);
    console.log('TASK11_REAL_SDK_SNAPSHOTS', JSON.stringify({method: 'serialized SDK snapshot data, not wire bytes', samples, collapsed: stops.size}));
  } finally { stops.forEach((stop) => stop()); stops.clear(); }
  assert.equal(stops.size, 0);
});

test('summary maintenance is current-state, no-op, resumable, and fences stale role/deletion events', async () => {
  const first = await backfill({db, write: false, maxBatches: 1});
  assert.equal(first.complete, false);
  await assert.rejects(backfill({db, write: true, report: first, approveFingerprint: first.planFingerprint}), /complete/);
  assert.equal((await backfill({db})).complete, true);
  assert.equal(await reconcileManagerUserSummary(db, 'perf-player'), 'unchanged');
  const root = db.doc('users/task11-fenced');
  await root.set({role: 'player'});
  await root.collection('state').doc('resources').set({stats: {gold: 10}});
  assert.equal(await reconcileManagerUserSummary(db, root.id), 'set');
  const before = await root.collection('state').doc('resources').get();
  await before.ref.set({stats: {gold: 20}});
  const after = await before.ref.get();
  await before.ref.set({stats: {gold: 30}});
  await syncManagerUserSummary.run({params: {uid: root.id, domain: 'resources'}, data: {before, after}});
  assert.equal((await db.doc(`manager_user_summaries/${root.id}`).get()).get('stats.gold'), 30);
  const approval = await inspectManagerUserSummary(db, root.id);
  await before.ref.set({stats: {gold: 31}});
  await assert.rejects(inspectManagerUserSummary(db, root.id, true, approval), /Stale summary approval/);
  assert.equal((await db.doc(`manager_user_summaries/${root.id}`).get()).get('stats.gold'), 30);
  await reconcileManagerUserSummary(db, root.id);
  const reader = env.authenticatedContext('perf-dm').firestore();
  for (const fence of [{deletionState: 'pending'}, {role: 'dm', deletionState: 'active'}]) {
    await root.set(fence, {merge: true});
    await assertFails(sdk.getDoc(sdk.doc(reader, `manager_user_summaries/${root.id}`)));
    await syncManagerUserSummary.run({params: {uid: root.id, domain: 'resources'}, data: {before, after}});
    assert.equal((await db.doc(`manager_user_summaries/${root.id}`).get()).exists, false);
  }
  await root.delete();
  assert.equal(await reconcileManagerUserSummary(db, root.id), 'unchanged');
});

test('actual Firestore transactions preserve concurrent token/gold deltas, replay and permissions', async () => {
  const invoke = (fn, data, uid = 'perf-dm') => fn.run({auth: {uid, token: {}}, data});
  const progression = db.doc('users/perf-player/state/progression');
  const resources = db.doc('users/perf-player/state/resources');
  await progression.set({stats: {combatTokensAvailable: 0}}, {merge: true});
  await resources.set({stats: {gold: 0}}, {merge: true});
  const tokenInput = {userId: 'perf-player', combatTokenDelta: 2, operationId: 'task11-token-a'};
  await Promise.all([invoke(task05UpdateProgression, tokenInput), invoke(task05UpdateProgression, {...tokenInput, combatTokenDelta: 3, operationId: 'task11-token-b'})]);
  assert.equal((await progression.get()).get('stats.combatTokensAvailable'), 5);
  assert.equal((await invoke(task05UpdateProgression, tokenInput)).replayed, true);
  assert.equal((await progression.get()).get('stats.combatTokensAvailable'), 5);
  await Promise.all([1, 2].map((n) => invoke(task05AdjustGold, {userId: 'perf-player', delta: n, operationId: `task11-gold-${n}`})));
  assert.equal((await resources.get()).get('stats.gold'), 3);
  await assert.rejects(invoke(task05UpdateProgression, {...tokenInput, operationId: 'task11-forbidden'}, 'perf-player'), (error) => error.code === 'permission-denied');
  await assert.rejects(invoke(task05UpdateProgression, {...tokenInput, combatTokenDelta: 0, operationId: 'task11-zero'}), (error) => error.code === 'invalid-argument');
  await reconcileManagerUserSummary(db, 'perf-player');
  const summary = await db.doc('manager_user_summaries/perf-player').get();
  assert.equal(summary.get('stats.combatTokensAvailable'), 5);
  assert.equal(summary.get('stats.gold'), 3);
});


test('atomic bulk summary marker survives readers but cannot suppress later canonical writes or revive fenced users', async () => {
  const root = db.doc('users/task11-marker');
  const progressionRef = root.collection('state').doc('progression');
  const resourcesRef = root.collection('state').doc('resources');
  const settingsRef = root.collection('state').doc('settings');
  const summaryRef = db.doc(`manager_user_summaries/${root.id}`);
  await root.set({role: 'player'});
  await progressionRef.set({stats: {level: 1, combatTokensAvailable: 2}});
  await resourcesRef.set({stats: {gold: 7}});
  const before = await progressionRef.get();
  await db.runTransaction(async transaction => {
    const [user, progression, resources, settings, existing] = await transaction.getAll(root, progressionRef, resourcesRef, settingsRef, summaryRef);
    const stats = {...progression.get('stats'), level: 2};
    const marker = maintainManagerSummaryInTransaction(transaction, summaryRef, user, existing, {
      progression: {stats}, resources: resources.data(), settings: settings.data(),
    });
    transaction.set(progressionRef, {stats, ...marker}, {merge: true});
  });
  const marked = await progressionRef.get();
  assert.equal(summaryMaintainedInCommit(before, marked), true);
  const summary = await summaryRef.get();
  assert.equal(summary.get('stats.level'), 2);
  assert.equal(summary.get('stats.gold'), 7);
  assert.equal(summary.get('managerSummaryCommitId'), undefined);
  const invokeEvent = (after, previous = before) => syncManagerUserSummary.run({params: {uid: root.id, domain: 'progression'}, data: {before: previous, after}});
  await invokeEvent(marked);
  assert.ok((await summaryRef.get()).updateTime.isEqual(summary.updateTime));
  await task05UpdateProgression.run({auth: {uid: 'perf-dm', token: {}}, data: {userId: root.id, combatTokenDelta: 3, operationId: 'task11-marker-delta'}});
  const later = await progressionRef.get();
  assert.equal(later.get('managerSummaryCommitId'), marked.get('managerSummaryCommitId'));
  assert.equal(summaryMaintainedInCommit(marked, later), false);
  await invokeEvent(later, marked);
  assert.equal((await summaryRef.get()).get('stats.combatTokensAvailable'), 5);
  await invokeEvent(marked);
  assert.equal((await summaryRef.get()).get('stats.combatTokensAvailable'), 5);
  // The separate single-player level-up callable remains an unmarked writer.
  const {levelUpUser} = require('../../functions/lib/levelUpUser');
  await levelUpUser.run({auth: {uid: 'perf-dm', token: {}}, data: {userId: root.id, operationId: 'task11-marker-level'}});
  const leveled = await progressionRef.get();
  assert.equal(leveled.get('stats.level'), 3);
  assert.equal(summaryMaintainedInCommit(later, leveled), false);
  await invokeEvent(leveled, later);
  assert.equal((await summaryRef.get()).get('stats.level'), 3);
  const reader = env.authenticatedContext('perf-dm').firestore();
  await assertFails(sdk.setDoc(sdk.doc(reader, progressionRef.path), {managerSummaryCommitId: '12345678-1234-4123-8123-123456789012'}, {merge: true}));
  for (const fence of [{deletionState: 'pending'}, {role: 'dm', deletionState: 'active'}]) {
    const oldRoot = await root.get();
    await root.set(fence, {merge: true});
    await syncManagerUserSummaryShell.run({params: {uid: root.id}, data: {before: oldRoot, after: await root.get()}});
    await invokeEvent(marked);
    assert.equal((await summaryRef.get()).exists, false);
  }
  const oldRoot = await root.get();
  await root.delete();
  await syncManagerUserSummaryShell.run({params: {uid: root.id}, data: {before: oldRoot, after: await root.get()}});
  await invokeEvent(marked);
  assert.equal((await summaryRef.get()).exists, false);
});
