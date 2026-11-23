const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createRequire} = require('node:module');
const {after, before, test} = require('node:test');
const {assertFails, assertSucceeds, initializeTestEnvironment} = require('@firebase/rules-unit-testing');
const {collection, deleteField, doc, getDoc, getDocs, getDocsFromServer, limit, orderBy, query, serverTimestamp, setDoc, where} = require('firebase/firestore');
const functionsRequire = createRequire(path.join(__dirname, '../../functions/package.json'));
const {initializeApp, deleteApp} = functionsRequire('firebase-admin/app');
const {FieldValue, getFirestore} = functionsRequire('firebase-admin/firestore');
const {getGrigliataCombatArsenal, mutateGrigliataCombat} = require('../../functions/lib/grigliataCombat');
const {
  task05AdjustGold, task05CommitConsumable, task05PrepareConsumable, task05UpdateGrigliataCharacterResources,
} = require('../../functions/lib/userDataCommands');

const projectId = 'demo-fnd-perf';
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST || '';
const host = emulatorHost.match(/^(127\.0\.0\.1):(\d+)$/);
if (!host) throw new Error('Use a local Firestore emulator for the combat integration test.');
process.env.FUNCTIONS_EMULATOR = 'true';

const board = 'combat-integration-board';
const attacker = 'combat-integration-attacker';
const defender = 'combat-integration-first';
const npcOwner = 'combat-integration-npc-owner';
const otherDm = 'combat-integration-other-dm';
const npc = 'combat-integration-npc';
const tokens = [attacker, defender, npc];
const placementId = (token) => `${board}__${token}`;
const mutate = (uid, data) => mutateGrigliataCombat.run({auth: {uid}, data});

let app;
let db;
let environment;
const seeded = new Set();
const seed = (document, data) => {
  seeded.add(document);
  return db.doc(document).set(data);
};

before(async () => {
  app = initializeApp({projectId});
  db = getFirestore(app);
  environment = await initializeTestEnvironment({
    projectId, firestore: {host: host[1], port: Number(host[2]),
      rules: fs.readFileSync(path.join(__dirname, '../../firestore.rules'), 'utf8')},
  });
  const stats = {hpCurrent: 20, manaCurrent: 3};
  const Parametri = {Combattimento: {Difesa: {Tot: 3}, Mira: {Tot: 3}}};
  await Promise.all([
    ...[attacker, defender, npcOwner, otherDm].map((uid) => seed(`users/${uid}`, {
      role: uid === otherDm || uid === npcOwner ? 'dm' : 'player',
    })),
    ...tokens.flatMap((token, col) => {
      const ownerUid = token === npc ? npcOwner : token;
      const tokenType = token === npc ? 'custom' : 'character';
      return [
        seed(`grigliata_tokens/${token}`, {ownerUid, label: token, tokenType, stats, Parametri}),
        seed(`grigliata_token_placements/${placementId(token)}`, {
          backgroundId: board, ownerUid, tokenId: token, col, row: 0, label: token,
          isVisibleToPlayers: token !== npc,
        }),
        ...(tokenType === 'character' ? [
          seed(`users/${ownerUid}/state/resources`, {stats}),
          seed(`users/${ownerUid}/state/progression`, {stats: {level: 6}, Parametri}),
        ] : []),
      ];
    }),
    seed(`grigliata_backgrounds/${board}`, {}),
    seed('grigliata_state/current', {activeBackgroundId: board}),
    seed(`users/${attacker}/spells/test-spell`, {
      Nome: 'Prova multipla', Costo: 5,
      combat: {mode: 'multiple', targetCount: 2, rangeFt: 20, attackStats: ['Mira'],
        defenseStats: ['Difesa'], attackDie: false, defenseDie: false},
    }),
    seed(`users/${attacker}/state/equipment`, {slots: {weaponMain: 'test-weapon'}}),
    seed(`users/${attacker}/inventory/test-weapon`, {
      currentSnapshot: {
        General: {Nome: 'Spadone'}, Specific: {Tipo: 'Mischia', Hands: 2},
        Parametri: {Special: {Danno: {4: '2d4'}, 'Danno Critico': {4: '2d6'}}},
      },
    }),
  ]);
});

after(async () => {
  try {
    await Promise.all([...seeded].map((document) => db?.doc(document).delete()));
  } finally {
    await environment?.cleanup();
    if (app) await deleteApp(app);
  }
});

test('multi-target actions debit once, bind each request to the actual owner and persist tie retries', async () => {
  const playerArsenal = await getGrigliataCombatArsenal.run({
    auth: {uid: attacker}, data: {backgroundId: board, actorPlacementId: placementId(attacker)},
  });
  assert.equal(playerArsenal.actor.mana, 3);
  assert.equal(playerArsenal.actions.find(({kind}) => kind === 'spell')?.id, 'personal:test-spell');

  const launch = {
    command: 'launch', operationId: 'test-combat-operation', backgroundId: board,
    actorPlacementId: placementId(attacker), kind: 'spell', actionId: 'personal:test-spell',
    targetPlacementIds: [placementId(defender), placementId(npc)], confirmHp: true, maxHpCost: 2,
  };
  // A player cannot tell a hidden pawn from an absent one.
  await assert.rejects(() => mutate(attacker, launch), {code: 'failed-precondition'});
  await seed(`grigliata_token_placements/${placementId(npc)}`, {
    backgroundId: board, ownerUid: npcOwner, tokenId: npc, col: 2, row: 0,
    isVisibleToPlayers: true,
  });
  await assert.rejects(() => mutate(attacker, {...launch, maxHpCost: 1}), {code: 'failed-precondition'});
  const {combatId} = await mutate(attacker, launch);
  const eventPath = `grigliata_combat_actions/${combatId}`;
  seeded.add(eventPath);
  const event = db.doc(eventPath);
  const requests = await db.collection('grigliata_combat_requests')
    .where('combatId', '==', combatId).get();
  requests.docs.forEach(({ref}) => seeded.add(ref.path));
  assert.equal(requests.size, 2);
  assert.deepEqual(new Set(requests.docs.map(item => item.get('ownerUid'))), new Set([defender, npcOwner]));
  assert.equal((await mutate(attacker, launch)).combatId, combatId);
  assert.deepEqual((await db.doc(`users/${attacker}/state/resources`).get()).get('stats'),
    {manaCurrent: 0, hpCurrent: 18});

  const ownerClient = environment.authenticatedContext(npcOwner).firestore();
  const otherClient = environment.authenticatedContext(otherDm).firestore();
  const inbox = await assertSucceeds(getDocs(query(collection(ownerClient, 'grigliata_combat_requests'),
    where('ownerUid', '==', npcOwner), where('status', '==', 'waiting'))));
  assert.equal(inbox.size, 1);
  const privateRequestPath = inbox.docs[0].ref.path;
  await assertFails(getDoc(doc(otherClient, privateRequestPath)));
  await assertFails(setDoc(doc(ownerClient, privateRequestPath), {status: 'done'}, {merge: true}));
  await assertFails(setDoc(doc(ownerClient, eventPath), {status: 'done'}, {merge: true}));

  const defendNpc = {command: 'defend', combatId, round: 1, targetPlacementId: placementId(npc)};
  await assert.rejects(() => mutate(otherDm, defendNpc), {code: 'permission-denied'});
  assert.equal((await mutate(npcOwner, defendNpc)).outcome, 'tie');
  const defendFirst = {command: 'defend', combatId, round: 1, targetPlacementId: placementId(defender)};
  assert.equal((await mutate(defender, {...defendFirst, defense: 4})).outcome, 'resisted');
  assert.equal((await event.get()).get('status'), 'retry');

  const retry = {...defendNpc, command: 'retry'};
  await assert.rejects(() => mutate(npcOwner, retry), {code: 'permission-denied'});
  await mutate(attacker, retry);
  assert.equal((await mutate(npcOwner, {...defendNpc, round: 2, defense: 2})).outcome, 'hit');
  assert.equal((await event.get()).get('status'), 'done');
  assert.deepEqual((await event.get()).get('targets').map(({trials}) => trials.map(({outcome}) => outcome)),
    [['resisted'], ['tie', 'hit']]);
  assert.deepEqual((await db.doc(`users/${attacker}/state/resources`).get()).get('stats'),
    {manaCurrent: 0, hpCurrent: 18});
});

test('critical confirmation stays with the owner and changes only the original ledger entry', async () => {
  const {combatId} = await mutate(attacker, {
    command: 'launch', operationId: 'test-critical-operation', backgroundId: board,
    actorPlacementId: placementId(attacker), kind: 'weapon', actionId: 'weaponMain',
    targetPlacementIds: [placementId(defender)],
  });
  const eventPath = `grigliata_combat_actions/${combatId}`;
  seeded.add(eventPath);
  const event = db.doc(eventPath);
  const requests = await db.collection('grigliata_combat_requests').where('combatId', '==', combatId).get();
  requests.docs.forEach(({ref}) => seeded.add(ref.path));
  const targetPlacementId = placementId(defender);
  assert.equal((await mutate(defender, {
    command: 'defend', combatId, targetPlacementId, round: 1, defense: -99, reduction: 3,
  })).outcome, 'hit');
  const critical = {command: 'critical', combatId, targetPlacementId, score: 13};
  await assert.rejects(() => mutate(otherDm, critical), {code: 'permission-denied'});
  const {critical: first} = await mutate(attacker, critical);
  assert.equal(first.multiplier, 'x1');
  assert.deepEqual((await mutate(attacker, critical)).critical, first);
  const {critical: next} = await mutate(attacker, {...critical, score: 41});
  const [target] = (await event.get()).get('targets');
  assert.equal(next.roll, first.roll);
  assert.equal(next.total, Math.ceil((target.damageDetails.subtotal + next.roll * 7) * 1.5));
  assert.deepEqual(target.critical, next);
  assert.equal((await db.doc(`users/${defender}/state/resources`).get()).get('stats.hpCurrent'), 20);
});

const trackCombat = async (combatId) => {
  seeded.add(`grigliata_combat_actions/${combatId}`);
  const requests = await db.collection('grigliata_combat_requests').where('combatId', '==', combatId).get();
  requests.docs.forEach(({ref}) => seeded.add(ref.path));
  return db.doc(`grigliata_combat_actions/${combatId}`);
};
const applyDamage = (uid, combatId, target, amount, criticalScore = null) => mutate(uid, {
  command: 'applyDamage', combatId, targetPlacementId: placementId(target), amount, criticalScore,
});

test('cancelling one volley refunds the real losses, retires both prompts and preserves a second volley', async () => {
  const payer = db.doc(`users/${attacker}/state/resources`);
  const recipient = db.doc(`users/${defender}/state/resources`);
  await db.doc(`grigliata_token_placements/${placementId(npc)}`).update({isVisibleToPlayers: true});
  await seed(payer.path, {stats: {hpCurrent: 20, manaCurrent: 3}});
  await seed(recipient.path, {stats: {hpCurrent: 3, barrieraCurrent: 2, barrieraTotal: 2}});
  await seed(`users/${attacker}/spells/undo-volley`, {
    Nome: 'Fiammata di prova', Costo: 5,
    combat: {mode: 'multiple', targetCount: 2, rangeFt: 20, attackStats: ['Mira'], defenseStats: ['Difesa'],
      attackDie: false, defenseDie: false, damageExpr: '9'},
  });
  const volley = {
    command: 'launch', backgroundId: board, actorPlacementId: placementId(attacker),
    kind: 'spell', actionId: 'personal:undo-volley', targetPlacementIds: [placementId(defender), placementId(npc)],
    confirmHp: true, maxHpCost: 5,
  };
  const {combatId} = await mutate(attacker, {...volley, operationId: 'undo-volley-first'});
  const action = await trackCombat(combatId);
  const second = await mutate(attacker, {...volley, operationId: 'undo-volley-second'});
  const other = await trackCombat(second.combatId);
  const defend = {command: 'defend', combatId, round: 1, targetPlacementId: placementId(defender), defense: -99};
  assert.equal((await mutate(defender, defend)).outcome, 'hit');
  await applyDamage(otherDm, combatId, defender, 9);
  assert.deepEqual((await recipient.get()).get('stats'), {hpCurrent: 0, barrieraCurrent: 0, barrieraTotal: 2});
  const publicClient = environment.authenticatedContext(defender).firestore();
  await assertFails(getDoc(doc(publicClient, 'grigliata_combat_receipts', combatId)));
  await assertFails(getDoc(doc(publicClient, 'grigliata_combat_receipts', combatId, 'damage', placementId(defender))));

  const cancel = {command: 'cancel', combatId};
  await assert.rejects(() => mutate(defender, cancel), error => ['permission-denied', 'not-found'].includes(error.code));
  const lateDefense = {...defend, targetPlacementId: placementId(npc)};
  const [, , reply] = await Promise.all([
    mutate(attacker, cancel),
    mutate(otherDm, cancel),
    mutate(npcOwner, lateDefense).catch(error => error.code),
  ]);
  assert.ok(reply === 'failed-precondition' || reply.outcome === 'hit');
  assert.equal((await action.get()).get('status'), 'cancelled');
  assert.deepEqual((await payer.get()).get('stats'), {hpCurrent: 15, manaCurrent: 3});
  assert.deepEqual((await recipient.get()).get('stats'), {hpCurrent: 3, barrieraCurrent: 2, barrieraTotal: 2});
  assert.equal((await other.get()).get('status'), 'waiting');
  const requests = id => db.collection('grigliata_combat_requests').where('combatId', '==', id).get();
  assert.deepEqual((await requests(combatId)).docs.map(item => item.get('status')), ['cancelled', 'cancelled']);
  assert.deepEqual((await requests(second.combatId)).docs.map(item => item.get('status')), ['waiting', 'waiting']);
  await assert.rejects(() => mutate(npcOwner, lateDefense), {code: 'failed-precondition'});
  await assert.rejects(() => applyDamage(otherDm, combatId, defender, 9), {code: 'failed-precondition'});
});

test('the private Registro query returns a cancelled visible outcome on a fresh client and retires the other invitation', async () => {
  await seed(`grigliata_tokens/${npcOwner}`, {tokenType: 'character', ownerUid: npcOwner, label: 'Hidden caster'});
  await seed(`grigliata_token_placements/${placementId(npcOwner)}`, {
    backgroundId: board, tokenId: npcOwner, ownerUid: npcOwner, col: 2, row: 1, isVisibleToPlayers: false,
  });
  await seed(`users/${npcOwner}/spells/private-volley`, {Nome: 'Raffica privata', Costo: 0, combat: {
    mode: 'multiple', targetCount: 2, rangeFt: 20, attackStats: ['Mira'], defenseStats: ['Difesa'],
    attackDie: false, defenseDie: false, damageExpr: '4',
  }});
  const {combatId} = await mutate(npcOwner, {command: 'launch', operationId: 'private-volley-cancel',
    backgroundId: board, actorPlacementId: placementId(npcOwner), kind: 'spell', actionId: 'personal:private-volley',
    targetPlacementIds: [placementId(defender), placementId(attacker)]});
  const event = await trackCombat(combatId);
  assert.equal((await event.get()).get('shared'), false);
  // Age is not a cancellation condition. A different DM can still cancel after one defender answers.
  await event.update({createdAt: new Date(0)});
  const defense = {command: 'defend', combatId, round: 1, targetPlacementId: placementId(defender), defense: -99};
  assert.equal((await mutate(defender, defense)).outcome, 'hit');
  const client = uid => environment.authenticatedContext(uid).firestore();
  const register = async (firestore, uid) => (await assertSucceeds(getDocsFromServer(query(
    collection(firestore, 'grigliata_combat_requests'), where('ownerUid', '==', uid), where('backgroundId', '==', board),
    orderBy('ownerDamageUpdatedAt', 'desc'), limit(40)
  )))).docs.filter(row => row.get('combatId') === combatId);
  const inbox = async (firestore, uid) => (await assertSucceeds(getDocsFromServer(query(
    collection(firestore, 'grigliata_combat_requests'), where('ownerUid', '==', uid),
    where('status', 'in', ['waiting', 'damagePending'])
  )))).docs.filter(row => row.get('combatId') === combatId);
  const owner = client(defender);
  const waitingOwner = client(attacker);
  const [before] = await register(owner, defender);
  assert.equal(before.get('ownerDamage.target.damage'), 4);
  // Old private entries sometimes only carry the projection timestamp used by Registro.
  await db.doc(before.ref.path).update({createdAt: FieldValue.delete(), ownerDamageUpdatedAt: new Date(0)});
  assert.equal((await inbox(waitingOwner, attacker)).length, 1);
  assert.deepEqual(await register(waitingOwner, attacker), []);
  await assert.rejects(() => mutate(defender, {command: 'cancel', combatId}), {code: 'not-found'});
  await mutate(otherDm, {command: 'cancel', combatId});

  const fresh = client(defender);
  const rows = await register(fresh, defender);
  assert.deepEqual(rows.map(row => row.id), [before.id]);
  const {createdAt, updatedAt, ownerDamageUpdatedAt, ...summary} = rows[0].data();
  assert.equal(createdAt.toMillis(), 0);
  assert.ok(updatedAt.isEqual(ownerDamageUpdatedAt));
  assert.deepEqual(summary, {combatId, backgroundId: board, ownerUid: defender, status: 'cancelled',
    ownerDamage: {kind: 'spell', action: {name: 'Raffica privata'},
      target: {placementId: placementId(defender), name: defender, ownerUid: defender}}});
  await assertFails(getDoc(doc(fresh, event.path)));
  await assertFails(getDoc(doc(waitingOwner, before.ref.path)));
  assert.deepEqual(await register(waitingOwner, attacker), []);
  assert.deepEqual(await inbox(waitingOwner, attacker), []);
  assert.deepEqual(await inbox(fresh, defender), []);
  await assert.rejects(() => mutate(attacker, {...defense, targetPlacementId: placementId(attacker)}), {code: 'failed-precondition'});
  await assert.rejects(() => applyDamage(defender, combatId, defender, 4), {code: 'failed-precondition'});
});

test('only one of the final damage confirmation and cancellation can commit', async () => {
  const payer = db.doc(`users/${attacker}/state/resources`);
  const recipient = db.doc(`users/${defender}/state/resources`);
  await seed(payer.path, {stats: {hpCurrent: 20, manaCurrent: 10}});
  await seed(recipient.path, {stats: {hpCurrent: 8}});
  await seed(`users/${attacker}/spells/undo-final`, {
    Nome: 'Ultima conferma', Costo: 3, combat: {mode: 'single', opposed: false, damageExpr: '2'},
  });
  const {combatId} = await mutate(attacker, {
    command: 'launch', operationId: 'undo-volley-final', actionId: 'personal:undo-final', kind: 'spell',
    backgroundId: board, actorPlacementId: placementId(attacker), targetPlacementIds: [placementId(defender)],
  });
  const event = await trackCombat(combatId);
  assert.equal((await event.get()).get('status'), 'awaitingConfirmation');
  const outcomes = await Promise.allSettled([
    mutate(attacker, {command: 'cancel', combatId}), applyDamage(defender, combatId, defender, 2),
  ]);
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(outcomes.find(result => result.status === 'rejected').reason.code, 'failed-precondition');
  const cancelled = outcomes[0].status === 'fulfilled';
  assert.equal((await event.get()).get('status'), cancelled ? 'cancelled' : 'done');
  assert.equal((await payer.get()).get('stats.manaCurrent'), cancelled ? 10 : 7);
  assert.equal((await recipient.get()).get('stats.hpCurrent'), cancelled ? 8 : 6);
});

test('a defender who casts another spell keeps that expense when a cancelled hit restores their barrier', async () => {
  const recipient = db.doc(`users/${defender}/state/resources`);
  await seed(recipient.path, {stats: {hpCurrent: 10, manaCurrent: 10, barrieraCurrent: 3, barrieraTotal: 3}});
  await db.doc(`grigliata_token_placements/${placementId(npc)}`).update({isVisibleToPlayers: true});
  await seed(`users/${attacker}/spells/undo-barrier`, {
    Nome: 'Fiammata di prova', Costo: 0, combat: {mode: 'multiple', targetCount: 2, damageExpr: '2'},
  });
  await seed(`users/${defender}/spells/own-action`, {Nome: 'Concentrazione di prova', Costo: 1, combat: {mode: 'self'}});
  const {combatId} = await mutate(attacker, {
    command: 'launch', operationId: 'undo-barrier-hit', backgroundId: board, actorPlacementId: placementId(attacker),
    kind: 'spell', actionId: 'personal:undo-barrier', targetPlacementIds: [placementId(defender), placementId(npc)],
  });
  await trackCombat(combatId);
  await applyDamage(defender, combatId, defender, 2);
  const ownAction = await mutate(defender, {
    command: 'launch', operationId: 'undo-barrier-second-spell', backgroundId: board, actorPlacementId: placementId(defender),
    kind: 'spell', actionId: 'personal:own-action', targetPlacementIds: [placementId(defender)],
  });
  await trackCombat(ownAction.combatId);
  assert.equal((await recipient.get()).get('stats.barrieraCurrent'), 1);
  const reply = await mutate(attacker, {command: 'cancel', combatId});
  assert.equal(reply.cancellation.needsReview, false);
  assert.deepEqual((await recipient.get()).get('stats'), {hpCurrent: 10, manaCurrent: 9, barrieraCurrent: 3, barrieraTotal: 3});
});

test('a character barrier refund preserves a sheet PM edit, potion gain, and gold adjustment', async () => {
  const recipient = db.doc(`users/${defender}/state/resources`);
  await seed(recipient.path, {stats: {
    hpCurrent: 10, manaCurrent: 8, manaTotal: 10, gold: 10, barrieraCurrent: 3, barrieraTotal: 3,
  }});
  await seed(`users/${defender}/inventory/test-mana-potion`, {
    quantity: 2,
    currentSnapshot: {type: 'consumabile', Parametri: {Special: {'Rigenera Dado Anima Mana': {4: 1}}}},
  });
  await db.doc(`grigliata_token_placements/${placementId(npc)}`).update({isVisibleToPlayers: true});
  await seed(`users/${attacker}/spells/token-sheet-hit`, {
    Nome: 'Raffica di prova', Costo: 0, combat: {mode: 'multiple', targetCount: 2, damageExpr: '2'},
  });
  const {combatId} = await mutate(attacker, {
    command: 'launch', operationId: 'token-sheet-hit', backgroundId: board, actorPlacementId: placementId(attacker),
    kind: 'spell', actionId: 'personal:token-sheet-hit', targetPlacementIds: [placementId(defender), placementId(npc)],
  });
  await trackCombat(combatId);
  await applyDamage(defender, combatId, defender, 2);
  assert.equal((await recipient.get()).get('stats.barrieraCurrent'), 1);

  await task05UpdateGrigliataCharacterResources.run({auth: {uid: defender}, data: {
    operationId: 'token-sheet-edit-pm', backgroundId: board, tokenId: defender, resources: {manaCurrent: 9},
  }});
  const {preparationId} = await task05PrepareConsumable.run({auth: {uid: defender}, data: {
    operationId: 'token-sheet-prepare-potion', inventoryId: 'test-mana-potion', resource: 'mana',
  }});
  await task05CommitConsumable.run({auth: {uid: defender}, data: {
    operationId: 'token-sheet-commit-potion', preparationId,
  }});
  await task05AdjustGold.run({auth: {uid: otherDm}, data: {
    operationId: 'token-sheet-adjust-gold', userId: defender, delta: 2,
  }});

  assert.deepEqual((await mutate(attacker, {command: 'cancel', combatId})).cancellation, {needsReview: false});
  assert.deepEqual((await recipient.get()).get('stats'), {
    hpCurrent: 10, manaCurrent: 10, manaTotal: 10, gold: 12, barrieraCurrent: 3, barrieraTotal: 3,
  });
});

test('concurrent damage retries apply once per target from fresh balances', async () => {
  await seed(`grigliata_backgrounds/${board}`, {});
  await seed(`users/${attacker}/state/resources`, {stats: {hpCurrent: 20, manaCurrent: 30}});
  const npcPlacement = {
    backgroundId: board, ownerUid: npcOwner, tokenId: npc, col: 2, row: 0, label: npc,
    isVisibleToPlayers: true, statuses: ['bleeding'], turnEffects: [{kind: 'shield', remainingTurns: 2}],
  };
  await seed(`grigliata_token_placements/${placementId(npc)}`, npcPlacement);
  const npcStats = {hpCurrent: 20, hpTotal: 20, shieldCurrent: 4, shieldTotal: 4, manaCurrent: 3};
  await seed(`grigliata_tokens/${npc}`, {
    ownerUid: npcOwner, label: npc, tokenType: 'custom', stats: npcStats,
    Parametri: {Combattimento: {Difesa: {Tot: 3}, Mira: {Tot: 3}}},
  });
  await seed(`users/${attacker}/spells/test-volley`, {
    Nome: 'Raffica', Costo: 0,
    combat: {mode: 'multiple', targetCount: 2, rangeFt: 20, attackStats: ['Mira'], defenseStats: ['Difesa'],
      attackDie: false, defenseDie: false, damageExpr: '2d4'},
  });
  const {combatId} = await mutate(attacker, {
    command: 'launch', operationId: 'test-damage-volley', backgroundId: board,
    actorPlacementId: placementId(attacker), kind: 'spell', actionId: 'personal:test-volley',
    targetPlacementIds: [placementId(defender), placementId(npc)],
  });
  const event = await trackCombat(combatId);
  for (const [uid, token] of [[defender, defender], [npcOwner, npc]]) {
    assert.equal((await mutate(uid, {
      command: 'defend', combatId, round: 1, targetPlacementId: placementId(token), defense: 2,
    })).outcome, 'hit');
  }
  // Balances are read inside the transaction: a barrier raised after the hit still absorbs first.
  const defenderResources = db.doc(`users/${defender}/state/resources`);
  await seed(defenderResources.path, {
    stats: {hpCurrent: 20, manaCurrent: 3, barrieraCurrent: 3, barrieraTotal: 5}, revision: 7,
  });
  await assert.rejects(() => applyDamage(attacker, combatId, defender, 5), {code: 'permission-denied'});
  await assert.rejects(() => applyDamage(attacker, combatId, npc, 5), {code: 'permission-denied'});
  await assert.rejects(() => applyDamage(defender, combatId, npc, 5), {code: 'permission-denied'});

  // The target's owner races the DM: one of them is first, and both get that receipt.
  const receipts = await Promise.all([
    applyDamage(otherDm, combatId, defender, 5), applyDamage(defender, combatId, defender, 9),
    applyDamage(otherDm, combatId, defender, 5), applyDamage(otherDm, combatId, npc, 6),
    applyDamage(npcOwner, combatId, npc, 6),
  ]);
  const [first] = receipts;
  assert.ok([5, 9].includes(first.damageApplied.amount));
  receipts.slice(0, 3).forEach((receipt) => assert.deepEqual(receipt, first));
  receipts.slice(3).forEach((receipt) => assert.deepEqual(receipt, {combatId, damageApplied: {amount: 6}}));
  const amount = first.damageApplied.amount;
  const stored = (await defenderResources.get()).data();
  assert.deepEqual(stored.stats, {
    hpCurrent: 20 - (amount - 3), manaCurrent: 3, barrieraCurrent: 0, barrieraTotal: 5,
  });
  assert.equal(stored.revision, 8);
  assert.equal(stored.schemaVersion, 2);
  assert.equal(stored.updatedBy, amount === 9 ? defender : otherDm);
  const token = (await db.doc(`grigliata_tokens/${npc}`).get()).data();
  assert.deepEqual(token.stats, {...npcStats, shieldCurrent: 0, hpCurrent: 18});
  // Turn markers, statuses and the fallen marker stay with the map.
  assert.deepEqual((await db.doc(`grigliata_token_placements/${placementId(npc)}`).get()).data(), npcPlacement);
  const targets = (await event.get()).get('targets');
  assert.deepEqual(targets.map(({damageApplied}) => damageApplied), [{amount}, {amount: 6}]);
  assert.ok(targets.every((target) => Object.keys(target.damageApplied).length === 1));
  // Each answered defense request shows its owner the receipt that won.
  const requests = await db.collection('grigliata_combat_requests').where('combatId', '==', combatId).get();
  assert.deepEqual(new Map(requests.docs.map((request) => [
    request.get('ownerDamage.target.placementId'),
    [request.get('status'), request.get('ownerDamage.target.damageApplied')],
  ])), new Map([[placementId(defender), ['done', {amount}]], [placementId(npc), ['done', {amount: 6}]]]));

  // A later retry with any amount answers with the receipt and changes nothing.
  assert.deepEqual(await applyDamage(otherDm, combatId, defender, 1), first);
  assert.deepEqual((await defenderResources.get()).data(), stored);
});

test('a racing critical change and damage application commit in one consistent order', async () => {
  await seed(`grigliata_backgrounds/${board}`, {});
  await seed(`users/${defender}/state/resources`, {stats: {hpCurrent: 200, manaCurrent: 3}});
  const {combatId} = await mutate(attacker, {
    command: 'launch', operationId: 'test-damage-critical', backgroundId: board,
    actorPlacementId: placementId(attacker), kind: 'weapon', actionId: 'weaponMain',
    targetPlacementIds: [placementId(defender)],
  });
  const event = await trackCombat(combatId);
  const targetPlacementId = placementId(defender);
  assert.equal((await mutate(defender, {
    command: 'defend', combatId, targetPlacementId, round: 1, defense: -99, reduction: 3,
  })).outcome, 'hit');
  const critical = (score) => mutate(attacker, {command: 'critical', combatId, targetPlacementId, score});
  const {critical: shown} = await critical(13);
  await assert.rejects(() => applyDamage(otherDm, combatId, defender, shown.total), {code: 'failed-precondition'});

  const [changed, applied] = await Promise.allSettled([
    critical(41), applyDamage(defender, combatId, defender, shown.total, 13),
  ]);
  assert.equal([changed, applied].filter(({status}) => status === 'fulfilled').length, 1);
  const [target] = (await event.get()).get('targets');
  const hp = (await db.doc(`users/${defender}/state/resources`).get()).get('stats.hpCurrent');
  // The owner's request shows the same critical and receipt as the journal, whichever committed first.
  const [request] = (await db.collection('grigliata_combat_requests').where('combatId', '==', combatId).get()).docs;
  assert.deepEqual(request.get('ownerDamage.target.critical'), target.critical);
  assert.deepEqual(request.get('ownerDamage.target.damageApplied'), target.damageApplied ?? null);
  if (applied.status === 'fulfilled') {
    assert.equal(changed.reason.code, 'failed-precondition');
    assert.deepEqual([target.critical.score, target.damageApplied, hp], [13, {amount: shown.total}, 200 - shown.total]);
  } else {
    assert.equal(applied.reason.code, 'failed-precondition');
    assert.deepEqual([target.critical.score, target.damageApplied, hp], [41, undefined, 200]);
  }
});

test('off-turn protection can launch while a normal weapon action must wait', async () => {
  await seed(`grigliata_backgrounds/${board}`, {turnOrderActive: {tokenId: defender}});
  await seed('utils/tecniche_common', {Protezione: {Costo: 0, Azione: 'Comunicazione'}});
  const base = {
    command: 'launch', backgroundId: board, actorPlacementId: placementId(attacker),
    targetPlacementIds: [placementId(defender)],
  };
  await assert.rejects(() => mutate(attacker, {
    ...base, operationId: 'test-offturn-normal', kind: 'weapon', actionId: 'weaponMain',
  }), {code: 'failed-precondition'});
  const {combatId} = await mutate(attacker, {
    ...base, operationId: 'test-offturn-protection', kind: 'tecnica', actionId: 'common:Protezione',
  });
  const eventPath = `grigliata_combat_actions/${combatId}`;
  seeded.add(eventPath);
  assert.equal((await db.doc(eventPath).get()).get('status'), 'done');
});

test('area journals omit the inferred roster under fog and filter fallen pawns otherwise', async () => {
  await seed(`users/${attacker}/spells/test-area`, {
    Nome: 'Elisse', Costo: 0,
    combat: {mode: 'area', rangeFt: 20, area: {shape: 'square', sideSquares: 3}},
  });
  await db.doc(`grigliata_token_placements/${placementId(npc)}`).update({isDead: true});
  const launch = {
    command: 'launch', backgroundId: board, actorPlacementId: placementId(attacker),
    kind: 'spell', actionId: 'personal:test-area', targetPlacementIds: [],
    point: {col: 1, row: 0},
  };
  for (const fogOfWarEnabled of [true, false]) {
    await seed(`grigliata_backgrounds/${board}`, {fogOfWarEnabled});
    const {combatId} = await mutate(attacker, {
      ...launch, operationId: `test-area-with-fog-${fogOfWarEnabled}`,
    });
    const eventPath = `grigliata_combat_actions/${combatId}`;
    seeded.add(eventPath);
    const affected = (await db.doc(eventPath).get()).get('affected');
    assert.deepEqual(new Set(affected.map(({tokenId}) => tokenId)),
      fogOfWarEnabled ? new Set() : new Set([attacker, defender]));
  }
});

test('Parte del Leone grants +10 Attacco and proposes one cure after either definitive result', async () => {
  await seed(`grigliata_backgrounds/${board}`, {});
  await db.doc(`users/${attacker}/state/progression`).update({'Parametri.Combattimento.Attacco.Tot': 6});
  await seed(`users/${attacker}/spells/test-leone`, {
    Nome: 'PARTE DEL LEONE', Costo: 0,
    combat: {attackDie: false, defenseDie: false},
  });
  const playerArsenal = await getGrigliataCombatArsenal.run({
    auth: {uid: attacker}, data: {backgroundId: board, actorPlacementId: placementId(attacker)},
  });
  const action = playerArsenal.actions.find(({id}) => id === 'personal:test-leone');
  assert.equal(action.attackBonus, 3);
  assert.equal(action.attackStat, 16);
  assert.equal(action.damageExpr, '2d4');
  assert.match(action.description, /Arma impugnata · Spadone/);
  const resourceRefs = [attacker, defender].map((uid) => db.doc(`users/${uid}/state/resources`));
  const initialHp = await Promise.all(resourceRefs.map(async ref => (await ref.get()).get('stats.hpCurrent')));

  for (const outcome of ['resisted', 'hit']) {
    const targetPlacementId = placementId(defender);
    const recipientPlacementId = placementId(attacker);
    const {combatId} = await mutate(attacker, {
      command: 'launch', backgroundId: board, actorPlacementId: placementId(attacker),
      kind: 'spell', actionId: action.id, operationId: `test-leone-${outcome}`,
      targetPlacementIds: [targetPlacementId, recipientPlacementId], confirmExtra: true,
    });
    const eventPath = `grigliata_combat_actions/${combatId}`;
    seeded.add(eventPath);
    const event = db.doc(eventPath);
    const requests = await db.collection('grigliata_combat_requests').where('combatId', '==', combatId).get();
    requests.docs.forEach(({ref}) => seeded.add(ref.path));
    assert.equal(requests.size, 1);

    const proposedCures = async () => (await event.get()).get('effects').filter(effect => effect.kind === 'heal');
    assert.deepEqual(await proposedCures(), []);
    const response = {command: 'defend', combatId, round: 1, targetPlacementId, defense: 3, reduction: 2};
    assert.equal((await mutate(defender, response)).outcome, 'tie');
    assert.deepEqual(await proposedCures(), []);
    await mutate(attacker, {...response, command: 'retry'});
    const decisive = {...response, round: 2, defense: outcome === 'resisted' ? 4 : 2};
    assert.equal((await mutate(defender, decisive)).outcome, outcome);
    await mutate(defender, decisive);
    const cures = await proposedCures();
    assert.equal(cures.length, 1);
    assert.equal(cures[0].targetPlacementId, recipientPlacementId);
    assert.ok(cures[0].amount >= 1 && cures[0].amount <= 10);
    const [primary, recipient] = (await event.get()).get('targets');
    assert.equal(recipient.outcome, 'applied');
    if (outcome === 'hit') {
      assert.equal(primary.damageDetails.subtotal, 16 + primary.damageDetails.raw);
    } else {
      assert.equal(primary.damage, null);
    }
  }
  assert.deepEqual(await Promise.all(resourceRefs.map(async ref => (await ref.get()).get('stats.hpCurrent'))), initialHp);
});

test('Parte del Leone remains available without a weapon and leaves the damage to the table', async () => {
  await seed(`grigliata_backgrounds/${board}`, {});
  await seed(`users/${attacker}/state/equipment`, {slots: {}});
  await db.doc(`users/${attacker}/state/progression`).update({'Parametri.Combattimento.Attacco.Tot': 6});
  await seed(`users/${attacker}/spells/test-leone`, {
    Nome: 'PARTE DEL LEONE', Costo: 0,
    combat: {attackDie: false, defenseDie: false},
  });
  const arsenal = await getGrigliataCombatArsenal.run({
    auth: {uid: attacker}, data: {backgroundId: board, actorPlacementId: placementId(attacker)},
  });
  const action = arsenal.actions.find(({id}) => id === 'personal:test-leone');
  assert.equal(action.attackBonus, 3);
  assert.equal(action.attackStat, 16);
  assert.equal(action.damageExpr, '');
  assert.match(action.description, /Danno fisico da concordare al tavolo/);
  const targetPlacementId = placementId(defender);
  const {combatId} = await mutate(attacker, {
    command: 'launch', backgroundId: board, actorPlacementId: placementId(attacker),
    kind: 'spell', actionId: action.id, operationId: 'test-leone-unarmed',
    targetPlacementIds: [targetPlacementId, placementId(attacker)], confirmExtra: true,
  });
  const eventPath = `grigliata_combat_actions/${combatId}`;
  seeded.add(eventPath);
  const requests = await db.collection('grigliata_combat_requests').where('combatId', '==', combatId).get();
  requests.docs.forEach(({ref}) => seeded.add(ref.path));
  const {outcome, damage} = await mutate(defender, {
    command: 'defend', combatId, round: 1, targetPlacementId, defense: 2,
  });
  assert.equal(outcome, 'hit');
  assert.equal(damage, null);
  const effects = (await db.doc(eventPath).get()).get('effects');
  assert.ok(effects.some(effect => effect.kind === 'manual'));
  assert.ok(effects.some(effect => effect.kind === 'heal'));
});

test('a hidden attacker damage reaches only its target owner, who applies it from their private request', async () => {
  await seed(`grigliata_backgrounds/${board}`, {});
  await seed(`users/${defender}/state/resources`, {stats: {hpCurrent: 20, manaCurrent: 3}});
  await seed(`grigliata_tokens/${npc}`, {
    ownerUid: npcOwner, label: npc, tokenType: 'custom', stats: {hpCurrent: 20, manaCurrent: 3},
    Parametri: {Combattimento: {Difesa: {Tot: 3}, Mira: {Tot: 3}}}, spells: [{name: 'Dardo nascosto', danni: '2d4'}],
  });
  await seed(`grigliata_token_placements/${placementId(npc)}`, {
    backgroundId: board, ownerUid: npcOwner, tokenId: npc, col: 2, row: 0, label: npc, isVisibleToPlayers: false,
  });
  const {actions} = await getGrigliataCombatArsenal.run({
    auth: {uid: npcOwner}, data: {backgroundId: board, actorPlacementId: placementId(npc)},
  });
  const dart = actions.find(({name}) => name === 'Dardo nascosto');
  const {combatId} = await mutate(npcOwner, {
    command: 'launch', operationId: 'test-hidden-dart', backgroundId: board,
    actorPlacementId: placementId(npc), kind: 'spell', actionId: dart.id,
    targetPlacementIds: [placementId(defender)],
  });
  const event = await trackCombat(combatId);
  const journal = (await event.get()).data();
  assert.equal(journal.shared, false);
  const [{amount: damage}] = journal.effects;
  const requests = await db.collection('grigliata_combat_requests').where('combatId', '==', combatId).get();
  assert.equal(requests.size, 1);
  const [{ref}] = requests.docs;
  const {ownerDamageUpdatedAt, createdAt, ...projected} = requests.docs[0].data();
  assert.ok(ownerDamageUpdatedAt && createdAt);
  assert.deepEqual(projected, {
    ownerUid: defender, backgroundId: board, combatId, status: 'damagePending',
    ownerDamage: {kind: 'spell', action: {name: 'Dardo nascosto', hands: 0}, target: {
      placementId: placementId(defender), name: defender, ownerUid: defender, status: 'done', round: 1,
      outcome: 'applied', damage, critical: null, damageApplied: null,
    }},
  });

  // Only the owner reads it, nobody writes it, it is no defense prompt, and the journal stays with the DM.
  const ownerClient = environment.authenticatedContext(defender).firestore();
  await assertSucceeds(getDoc(doc(ownerClient, ref.path)));
  for (const uid of [attacker, otherDm]) {
    await assertFails(getDoc(doc(environment.authenticatedContext(uid).firestore(), ref.path)));
  }
  await assertFails(getDoc(doc(ownerClient, event.path)));
  await assertFails(setDoc(doc(ownerClient, ref.path), {ownerDamage: null}, {merge: true}));
  const inbox = await assertSucceeds(getDocs(query(collection(ownerClient, 'grigliata_combat_requests'),
    where('ownerUid', '==', defender), where('status', '==', 'waiting'))));
  assert.ok(inbox.docs.every(({id}) => id !== ref.id));

  // Home asks once for what its owner still has to do: defenses to answer and damage to confirm.
  await seed(`users/${attacker}/state/equipment`, {slots: {weaponMain: 'test-weapon'}});
  const blow = await mutate(attacker, {
    command: 'launch', operationId: 'test-home-blow', backgroundId: board,
    actorPlacementId: placementId(attacker), kind: 'weapon', actionId: 'weaponMain',
    targetPlacementIds: [placementId(defender)],
  });
  await trackCombat(blow.combatId);
  const [defense] = (await db.collection('grigliata_combat_requests')
    .where('combatId', '==', blow.combatId).get()).docs;
  assert.equal(defense.get('status'), 'waiting');
  const home = async () => {
    const open = await assertSucceeds(getDocs(query(collection(ownerClient, 'grigliata_combat_requests'),
      where('ownerUid', '==', defender), where('status', 'in', ['waiting', 'damagePending']))));
    assert.ok(open.docs.every((item) => ['waiting', 'damagePending'].includes(item.get('status'))));
    return new Set(open.docs.map(({id}) => id));
  };
  const listed = await home();
  assert.ok(listed.has(ref.id) && listed.has(defense.id));

  await assert.rejects(() => applyDamage(attacker, combatId, defender, 1), {code: 'permission-denied'});
  const receipts = await Promise.all([
    applyDamage(defender, combatId, defender, damage), applyDamage(otherDm, combatId, defender, damage + 1),
  ]);
  assert.deepEqual(receipts[1], receipts[0]);
  const {amount} = receipts[0].damageApplied;
  assert.ok([damage, damage + 1].includes(amount));
  assert.equal((await db.doc(`users/${defender}/state/resources`).get()).get('stats.hpCurrent'), 20 - amount);
  assert.deepEqual((await ref.get()).get('ownerDamage.target.damageApplied'), {amount});
  assert.deepEqual((await event.get()).get('targets')[0].damageApplied, {amount});

  // Confirmed, the damage leaves Home while its owner still reads the receipt; the defense stays until answered.
  const remaining = await home();
  assert.ok(!remaining.has(ref.id) && remaining.has(defense.id));
  const receipt = await assertSucceeds(getDoc(doc(ownerClient, ref.path)));
  assert.equal(receipt.get('status'), 'done');
  assert.deepEqual(receipt.get('ownerDamage.target.damageApplied'), {amount});
  assert.notEqual((await mutate(defender, {
    command: 'defend', combatId: blow.combatId, round: 1, targetPlacementId: placementId(defender),
    defense: 99, reduction: 0,
  })).outcome, 'tie');
  assert.equal((await home()).has(defense.id), false);
});

test('a DM can finish another player’s damage beyond the latest 40 while the board-wide feed stays private', async () => {
  await seed('grigliata_state/current', {activeBackgroundId: board});
  await seed('grigliata_token_placements/' + placementId(attacker), {
    backgroundId: board, ownerUid: attacker, tokenId: attacker, col: 0, row: 0, label: attacker, isVisibleToPlayers: true,
  });
  await seed('users/' + attacker + '/spells/late-dart', {Nome: 'Dardo nascosto', danni: '2d4'});
  const {combatId} = await mutate(attacker, {
    command: 'launch', operationId: 'old-pending-dice', rollMode: 'guided', backgroundId: board,
    actorPlacementId: placementId(attacker), kind: 'spell', actionId: 'personal:late-dart',
    targetPlacementIds: [placementId(defender)],
  });
  const event = await trackCombat(combatId);
  assert.equal((await event.get()).get('status'), 'awaitingDamage');
  const hiddenId = 'unshared-waiting-on-this-board';
  await seed('grigliata_combat_actions/' + hiddenId, {
    backgroundId: board, actorUid: npcOwner, shared: false, status: 'waiting', createdAt: new Date(0),
  });
  const later = Date.now() + 1000;
  await Promise.all(Array.from({length: 40}, (_, i) => seed('grigliata_combat_actions/later-' + i, {
    backgroundId: board, actorUid: defender, shared: true, status: 'done', createdAt: new Date(later + i),
  })));
  const manager = environment.authenticatedContext(otherDm).firestore();
  const player = environment.authenticatedContext(defender).firestore();
  const actions = client => collection(client, 'grigliata_combat_actions');
  const outstanding = client => getDocs(query(actions(client), where('backgroundId', '==', board),
    where('status', 'in', ['waiting', 'retry', 'awaitingDamage'])));
  const recent = await assertSucceeds(getDocs(query(actions(manager), where('backgroundId', '==', board),
    orderBy('createdAt', 'desc'), limit(40))));
  assert.equal(recent.size, 40);
  assert.ok(!recent.docs.some(d => d.id === combatId));
  const pending = (await assertSucceeds(outstanding(manager))).docs.map(d => d.id);
  assert.ok(pending.includes(combatId) && pending.includes(hiddenId));
  await assertFails(outstanding(player));
  const command = {command: 'rollDamage', combatId, targetPlacementId: placementId(defender), round: 1};
  const recovered = await mutate(otherDm, command);
  assert.deepEqual(recovered.rolls.map(die => die.sides), [4, 4]);
  assert.deepEqual((await mutate(attacker, command)).rolls, recovered.rolls);
  assert.ok(!(await outstanding(manager)).docs.some(d => d.id === combatId));
  await trackCombat(combatId);
});

for (const tokenType of ['custom', 'foe']) {
  for (const replaceShield of [false, true]) {
    test(`DM cancellation handles a ${tokenType} shield after ${replaceShield ? 'same-value reactivation' : 'a PF, PM and notes edit'}`, async () => {
      const ownerUid = tokenType === 'custom' ? defender : npcOwner;
      const editor = tokenType === 'custom' ? ownerUid : otherDm;
      const tokenPath = `grigliata_tokens/${npc}`;
      const target = db.doc(tokenPath);
      const client = environment.authenticatedContext(editor).firestore();
      const token = doc(client, tokenPath);
      await seed(tokenPath, {
        ownerUid, label: npc, tokenType, imageUrl: '', imagePath: '', updatedBy: ownerUid,
        updatedAt: new Date(0), stats: {hpCurrent: 9, manaCurrent: 4, shieldCurrent: 5, shieldTotal: 5},
        ...(tokenType === 'foe' ? {
          imageSource: 'foesHub', foeSourceId: 'test-foe', Parametri: {}, spells: [], tecniche: [],
        } : {imageSource: 'uploaded'}),
      });
      await seed(`grigliata_token_placements/${placementId(npc)}`, {
        backgroundId: board, ownerUid, tokenId: npc, col: 2, row: 0, isVisibleToPlayers: true,
      });
      await seed(`users/${attacker}/spells/token-shield`, {
        Nome: 'Colpo alla barriera', Costo: 0, combat: {mode: 'multiple', targetCount: 2, damageExpr: '2'},
      });
      const {combatId} = await mutate(attacker, {
        command: 'launch', operationId: `undo-${tokenType}-shield-${replaceShield}`, backgroundId: board,
        actorPlacementId: placementId(attacker), kind: 'spell', actionId: 'personal:token-shield',
        targetPlacementIds: [placementId(npc), placementId(defender)],
      });
      await trackCombat(combatId);
      const damageReceipt = `grigliata_combat_receipts/${combatId}/damage/${placementId(npc)}`;
      seeded.add(`grigliata_combat_receipts/${combatId}`);
      seeded.add(damageReceipt);
      seeded.add(`${tokenPath}/combat_barrier/continuity`);
      await applyDamage(otherDm, combatId, npc, 2);
      assert.equal((await target.get()).get('stats.shieldCurrent'), 3);
      await assertSucceeds(setDoc(token, {
        ...(replaceShield && {combatShieldActivation: deleteField()}),
        stats: {hpCurrent: 8, manaCurrent: 2, ...(replaceShield && {shieldCurrent: 3, shieldTotal: 5})},
        notes: 'Edited after the hit', updatedAt: serverTimestamp(), updatedBy: editor,
      }, {merge: true}));
      const reply = await mutate(otherDm, {command: 'cancel', combatId});
      assert.equal(reply.cancellation.needsReview, replaceShield);
      assert.deepEqual((await target.get()).get('stats'), {
        hpCurrent: 8, manaCurrent: 2, shieldCurrent: replaceShield ? 3 : 5, shieldTotal: 5,
      });
      assert.equal((await target.get()).get('notes'), 'Edited after the hit');
    });
  }
}
