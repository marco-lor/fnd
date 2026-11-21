// Run against a local Firestore emulator after building frontend/functions.
// The fixture contains combat fields only. It covers the fatin-test catalog,
// owned inventory variants, learned/common cards, foe repertoires and embedded grants.
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const {after, before, test} = require('node:test');
const {createRequire} = require('node:module');
const path = require('node:path');
const catalog = require('./fixtures/grigliata-combat-catalog.json');
const functionsRequire = createRequire(path.resolve(__dirname, '../../functions/package.json'));
const {initializeApp, deleteApp} = functionsRequire('firebase-admin/app');
const {getFirestore} = functionsRequire('firebase-admin/firestore');
const {getGrigliataCombatArsenal, mutateGrigliataCombat} = require('../../functions/lib/grigliataCombat');
const {isItemCompatibleWithEquipmentSlot} = require('../../functions/lib/userDataV2');

if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) {
  throw new Error('Set FIRESTORE_EMULATOR_HOST to a local emulator for this catalog test.');
}
process.env.FUNCTIONS_EMULATOR = 'true';
const board = 'guided-' + randomUUID();
const actor = board + '-attacker';
const defender = board + '-receiver';
const ally = board + '-wingmate';
const foe = board + '-foe';
const dm = board + '-dm';
const place = token => board + '__' + token;
const actorOf = token => token === foe ? dm : token;
const sword = catalog.items.find(({item}) => item.General.Nome === 'Spada').item;
const progression = level => ({
  stats: {level},
  Parametri: {
    Base: {Forza: {Tot: 5}, Costituzione: {Tot: 4}, Saggezza: {Tot: 3}, Intelligenza: {Tot: 6}},
    Combattimento: {Attacco: {Tot: 8}, Mira: {Tot: 9}, Difesa: {Tot: 16}, RiduzioneDanni: {Tot: 4}},
  },
});
const balances = {hpCurrent: 99999, manaCurrent: 99999, essenzaCurrent: 9999, barrieraCurrent: 10};
const ownedDocs = new Set();
const sharedOriginals = new Map();
const counters = {launches: 0, damageThrows: 0, criticalThrows: 0, confirmations: 0};
let app, db;
const write = (p, value) => {
  ownedDocs.add(p);
  return db.doc(p).set(value);
};
const read = async p => (await db.doc(p).get()).data();
const journal = combatId => read('grigliata_combat_actions/' + combatId);
const mutate = (uid, data) => mutateGrigliataCombat.run({auth: {uid}, data});
const arsenal = token => getGrigliataCombatArsenal.run({
  auth: {uid: actorOf(token)}, data: {backgroundId: board, actorPlacementId: place(token)},
});
const cardId = i => 'card-' + i;
const equip = slots => write('users/' + actor + '/state/equipment', {slots});

before(async () => {
  app = initializeApp({projectId: 'demo-fnd-perf'});
  db = getFirestore(app);
  const shared = {
    'grigliata_state/current': {activeBackgroundId: board},
    'utils/spells_common': {},
    'utils/tecniche_common': {},
    'utils/varie': {dadiAnimaByLevel: {'1': 10, '4': 12, '7': 12, '8': 20, '10': 20}},
  };
  for (const p of Object.keys(shared)) sharedOriginals.set(p, await read(p));
  const seed = db.batch();
  const add = (p, value) => {
    ownedDocs.add(p);
    seed.set(db.doc(p), value);
  };
  const foeCards = {spells: [], tecniche: []};
  for (const [i, {scope, kind, entry, key}] of catalog.cards.entries()) {
    const collection = kind === 'spell' ? 'spells' : 'tecniche';
    if (scope === 'common') shared['utils/' + collection + '_common'][key || entry.Nome] = entry;
    else if (scope === 'foe') foeCards[collection].push({...entry, id: cardId(i)});
    else add('users/' + actor + '/' + collection + '/' + cardId(i), entry);
  }
  for (const [p, value] of Object.entries(shared)) seed.set(db.doc(p), value);
  add('grigliata_backgrounds/' + board, {fogOfWarEnabled: true});
  for (const [uid, label, col] of [[actor, 'QA Combat Attacker', 22], [defender, 'QA Combat Receiver', 21],
    [ally, 'QA Combat Wingmate', 27], [foe, 'Foe', 22]]) {
    const ownerUid = actorOf(uid);
    const character = uid !== foe;
    add('users/' + ownerUid, {role: character ? 'player' : 'dm'});
    add('grigliata_tokens/' + uid, {
      ownerUid, label, tokenType: character ? 'character' : 'foe',
      ...(!character && {...foeCards, ...progression(8), stats: {...balances, level: 8}, dadoAnima: 'd20'}),
    });
    add('grigliata_token_placements/' + place(uid), {ownerUid, label, tokenId: uid,
      col, row: 13, backgroundId: board, isVisibleToPlayers: true});
    if (character) {
      add('users/' + uid + '/state/progression', progression(8));
      add('users/' + uid + '/state/resources', {stats: balances});
    }
  }
  for (const [i, {item}] of catalog.items.entries()) {
    add('users/' + actor + '/inventory/item-' + i, {currentSnapshot: item});
  }
  // An armed receiver gives every melee attack its ordinary single attack die.
  add('users/' + defender + '/inventory/sword', {currentSnapshot: sword});
  add('users/' + defender + '/state/equipment', {slots: {weaponMain: 'sword'}});
  await seed.commit();
});

after(async () => {
  if (!db) return;
  try {
    for (const collection of ['grigliata_combat_actions', 'grigliata_combat_requests']) {
      const docs = await db.collection(collection).where('backgroundId', '==', board).select().get();
      docs.docs.forEach(doc => ownedDocs.add(doc.ref.path));
    }
    const paths = [...ownedDocs];
    for (let i = 0; i < paths.length; i += 400) {
      const batch = db.batch();
      paths.slice(i, i + 400).forEach(p => batch.delete(db.doc(p)));
      await batch.commit();
    }
    for (const [p, original] of sharedOriginals) {
      if (original) await db.doc(p).set(original);
      else await db.doc(p).delete();
    }
    console.log('Guided catalog coverage', counters);
  } finally {
    await deleteApp(app);
  }
});

// Independent face-by-face check against the original formula, including mixed
// pools, constants and negative terms. Every displayed face must be possible.
function rolledValue(expr, faces) {
  let i = 0, total = 0;
  for (const match of expr.replace(/\s+/g, '').matchAll(/([+-]?)(?:(\d*)d(\d+)|(\d+))/gi)) {
    const sign = match[1] === '-' ? -1 : 1;
    if (match[4]) { total += sign * Number(match[4]); continue; }
    for (let n = 0; n < Number(match[2] || 1); n++) {
      const die = faces[i++];
      assert.equal(die?.sides, Number(match[3]), expr);
      assert.ok(Number.isInteger(die.value) && die.value >= 1 && die.value <= die.sides, expr);
      total += sign * die.value;
    }
  }
  assert.equal(i, faces.length, expr);
  return total;
}

const weaponCards = new Set(['Attacco', "Attacco d'Opportunità", 'INVESTIMENTO', 'PARTE DEL LEONE',
  'TAGLIO DEI COSTI', 'SPECULAZIONE']);
const cardDamage = new Map(Object.entries({
  'Dardo Cosmico': '2d10', 'Barriera Cosmica (offensiva)': '3d10', 'Bomba Scasso': '3d10',
  Fiammata: '3d12', 'Miccetta Scasso': '2d10', Sentenza: '1d10', b: '2d10', haia: '5d62',
}));
const singularity = new Map([[5, '4d10'], [10, '3d10'], [15, ''], [20, '2d10'], [30, '1d10'], [40, '1'], [50, '1']]);

async function confirmDamage(combatId, target, amount, criticalScore) {
  const p = 'users/' + target.ownerUid + '/state/resources';
  const before = (await read(p)).stats;
  const command = {command: 'applyDamage', combatId, targetPlacementId: target.placementId, amount, criticalScore};
  const applied = await mutate(target.ownerUid, command);
  assert.equal(applied.damageApplied.amount, amount);
  const after = (await read(p)).stats;
  const absorbed = Math.min(before.barrieraCurrent, amount);
  assert.equal(after.barrieraCurrent, before.barrieraCurrent - absorbed);
  assert.equal(after.hpCurrent, Math.max(0, before.hpCurrent - amount + absorbed));
  counters.confirmations++;
}

async function exercise(token, action, check, expected, distance, criticalExpr) {
  const uid = actorOf(token);
  const targetRef = db.doc('grigliata_token_placements/' + place(defender));
  await targetRef.update({col: 22 - distance / 5, isDead: action.requireDead === true});
  const ground = ['area', 'ground', 'point'].includes(action.mode) && action.area?.shape !== 'cone';
  let ids = [place(defender)];
  if (ground || action.mode === 'manual' && action.minTargets === 0) ids = [];
  if (action.mode === 'self') ids = [place(token)];
  if (action.mode === 'multiple') ids.push(place(ally));
  const launch = {
    command: 'launch', rollMode: 'guided', operationId: randomUUID(), backgroundId: board, actorPlacementId: place(token),
    kind: action.kind, actionId: action.id, actionVersion: action.version, targetPlacementIds: ids,
    ...(ground && {point: {col: 22 - distance / 5, row: 13}}),
    ...(action.extraResource && {confirmExtra: true}), ...(action.variableCost && {variableCost: 3}),
    ...(check?.channel && {channel: check.channel}),
  };
  const {combatId, rolls} = await mutate(uid, launch);
  counters.launches++;
  const launched = await journal(combatId);
  const attacks = ids.length ? launched.targets.map(t => t.attack) : [launched.attack];
  assert.deepEqual(rolls, attacks.filter(Boolean).flatMap(a => a.rolls.map(value => ({sides: a.sides, value}))));
  for (const t of launched.targets.filter(t => t.status === 'waiting')) {
    const answer = await mutate(t.ownerUid, {command: 'defend', combatId, round: t.round, targetPlacementId: t.placementId,
      ...(launched.action.consent ? {consent: true} : {defense: -99, reduction: 4})});
    assert.equal(answer.outcome, launched.action.consent ? 'accepted' : 'hit');
    if (/d/i.test(expected)) assert.equal(answer.damage, null);
  }
  const answered = await journal(combatId);
  const recipients = ids.length ? answered.targets.filter((_, i) => !action.targetRoles || i === 0) : [null];
  for (const target of recipients) {
    const pending = target ? target.pendingDamage : answered.pendingDamage;
    const targetPlacementId = target?.placementId ?? null;
    const effects = answered.effects.filter(e => e.kind === 'damage' && e.targetPlacementId === targetPlacementId);
    if (!/d/i.test(expected)) {
      assert.ok(!pending, action.name);
      assert.equal(effects.length, expected ? 1 : 0, action.name);
      if (expected && target) {
        assert.equal(effects[0].amount, Number(expected));
        await confirmDamage(combatId, target, effects[0].amount, null);
      }
      continue;
    }
    assert.equal(pending?.expr, expected, action.name);
    assert.equal(effects.length, 0);
    const command = {command: 'rollDamage', combatId, targetPlacementId, round: target?.round ?? 1};
    const first = await mutate(uid, command);
    const raw = rolledValue(expected, first.rolls);
    let amount = action.hands ? Math.ceil(Math.max(0, action.attackStat + raw + action.damageBonus - 4) *
      (action.hands === 2 ? 1.5 : 1)) : raw;
    assert.equal(first.damage, amount, action.name);
    const replay = await mutate(uid, command);
    assert.deepEqual(replay.rolls, first.rolls);
    assert.equal(replay.damage, amount);
    const rolled = await journal(combatId);
    const stored = target ? rolled.targets.find(t => t.placementId === targetPlacementId) : rolled;
    assert.deepEqual(stored.damageRoll.rolls, first.rolls);
    assert.equal(stored.damageRoll.raw, raw);
    assert.ok(!stored.pendingDamage);
    counters.damageThrows++;
    let criticalScore = null;
    if (criticalExpr && /\d*d\d+/i.test(criticalExpr) && target) {
      const critical = {command: 'critical', combatId, targetPlacementId, round: target.round, score: 7};
      const receipt = await mutate(uid, critical);
      assert.equal(rolledValue(criticalExpr, receipt.rolls), receipt.critical.roll);
      const correction = await mutate(uid, {...critical, score: 41});
      assert.equal(correction.critical.roll, receipt.critical.roll);
      criticalScore = 41;
      amount = correction.critical.total;
      counters.criticalThrows++;
    }
    if (target) await confirmDamage(combatId, target, amount, criticalScore);
  }
  assert.equal((await journal(combatId)).status, 'done');
}

const swordId = 'item-' + catalog.items.findIndex(({item}) => item.General.Nome === 'Spada');
for (const [i, {kind, item}] of catalog.items.entries()) {
  const name = item.General.Nome;
  if (kind === 'weapon') {
    test('weapon tiers and eligible hands · ' + name + ' · ' + (i + 1), async () => {
      const hands = ['weaponMain', 'weaponOff'].filter(slot => isItemCompatibleWithEquipmentSlot(item, slot));
      assert.ok(hands.length, name);
      for (const slot of hands) {
        await equip({[slot]: 'item-' + i});
        for (const level of [1, 4, 7, 10]) {
          await write('users/' + actor + '/state/progression', progression(level));
          const {actions} = await arsenal(actor);
          const action = actions.find(a => a.kind === 'weapon' && a.id === slot);
          const special = item.Parametri?.Special;
          const expected = special?.Danno?.[level];
          if (!expected) { assert.equal(action, undefined, name); continue; }
          assert.equal(action?.damageExpr, expected, name);
          await exercise(actor, action, null, expected, 5, special['Danno Critico']?.[level]);
        }
      }
    });
  }
  for (const [key, entry] of Object.entries(item.General.spells || {})) {
    test('item spell · ' + name + ' → ' + key, async () => {
      await write('users/' + actor + '/state/progression', progression(8));
      const slots = ['weaponMain', 'weaponOff', 'headArmor', 'accessorio', 'beltC1'];
      const slot = slots.find(candidate => isItemCompatibleWithEquipmentSlot(item, candidate));
      assert.ok(slot, name);
      await equip({weaponMain: swordId, [slot]: 'item-' + i});
      let actionId = 'item:' + slot + ':' + key;
      if (slot === 'beltC1') {
        // Belt contents confer no equipped action. Exercise their actual spell
        // definitions through the learned repertoire too.
        assert.ok(!(await arsenal(actor)).actions.some(a => a.id === actionId));
        const learnedId = 'consumable-' + i;
        await write('users/' + actor + '/spells/' + learnedId, entry);
        actionId = 'personal:' + learnedId;
      }
      const action = (await arsenal(actor)).actions.find(a => a.id === actionId);
      assert.equal(action?.name, entry.Nome);
      if (slot !== 'beltC1') assert.equal(action.sourceItem, name);
      for (const check of action.checks.length ? action.checks : [null]) {
        await exercise(actor, action, check, cardDamage.get(action.name) || '', 5);
      }
    });
  }
}

for (const [i, {scope, kind, key, entry}] of catalog.cards.entries()) {
  test(scope + ' ' + kind + ' · ' + entry.Nome + ' · ' + (i + 1), async () => {
    const token = scope === 'foe' ? foe : actor;
    await write('users/' + actor + '/state/progression', progression(8));
    await equip({weaponMain: swordId});
    const id = scope === 'common' ? 'common:' + (key || entry.Nome)
      : (scope === 'foe' ? 'personal:legacy:' : 'personal:') + cardId(i);
    const action = (await arsenal(token)).actions.find(a => a.id === id && a.kind === kind);
    assert.equal(action?.name, entry.Nome);
    const damage = weaponCards.has(action.name) ? '3d8' : cardDamage.get(action.name) || '';
    const bands = action.name === 'Singolarita' ? singularity : [[Math.max(5, action.minRangeFt), damage]];
    for (const [distance, expected] of bands) {
      for (const check of action.checks.length ? action.checks : [null]) {
        await exercise(token, action, check, expected, distance);
      }
    }
  });
}
