const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

// The callable handlers run on in-memory documents with fixed dice: no network.
let db;
let dice = () => 1;
const stubs = {
  'crypto': {randomInt: (minimum, maximum) => dice(minimum, maximum)},
  'firebase-admin/app': {getApp: () => ({options: {projectId: 'demo-fnd-perf'}})},
  'firebase-admin/firestore': {
    getFirestore: () => db,
    FieldValue: {serverTimestamp: () => 'now', increment: value => value},
  },
};
const loadModule = Module._load;
Module._load = function(request, parent, ...rest) {
  return stubs[request] && parent?.filename.endsWith('grigliataCombat.js')
    ? stubs[request]
    : loadModule.call(this, request, parent, ...rest);
};
process.env.FUNCTIONS_EMULATOR = 'true';
const {getGrigliataCombatArsenal, mutateGrigliataCombat} = require('../lib/grigliataCombat');
Module._load = loadModule;

const merge = (target = {}, delta) => Object.entries(delta).reduce((result, [key, value]) => ({
  ...result,
  [key]: value && typeof value === 'object' && !Array.isArray(value) ? merge(result[key], value) : value,
}), target);

// Firestore rejects undefined values and arrays nested directly in arrays.
const storable = (value, inArray = false) => {
  assert.notEqual(value, undefined);
  if (Array.isArray(value)) assert.equal(inArray, false);
  if (value && typeof value === 'object') {
    Object.values(value).forEach(item => storable(item, Array.isArray(value)));
  }
  return structuredClone(value);
};

const memoryFirestore = () => {
  const documents = new Map();
  const doc = path => ({id: path.split('/').at(-1), path});
  const snapshot = ref => {
    const value = structuredClone(documents.get(ref.path));
    return {
      id: ref.id, ref, exists: value !== undefined, data: () => value,
      get: field => field.split('.').reduce((node, key) => node?.[key], value),
    };
  };
  const children = ({path, match}) => [...documents.keys()].filter(file => file.startsWith(path + '/')
    && file.split('/').length === path.split('/').length + 1 && (!match || match(documents.get(file))));
  const transaction = {
    get: async ref => ref.collection ? {docs: children(ref).map(file => snapshot(doc(file)))} : snapshot(ref),
    getAll: async (...refs) => refs.map(snapshot),
    set: (ref, data, options) => {
      const value = storable(data);
      if (options?.mergeFields) {
        // Top-level field paths only: each named field is replaced whole, the rest is kept.
        assert.ok(options.mergeFields.every(field => !field.includes('.') && field in value));
        const named = Object.fromEntries(options.mergeFields.map(field => [field, value[field]]));
        return documents.set(ref.path, {...documents.get(ref.path), ...named});
      }
      return documents.set(ref.path, options?.merge ? merge(documents.get(ref.path), value) : value);
    },
    create: (ref, data) => {
      assert.equal(documents.has(ref.path), false);
      documents.set(ref.path, storable(data));
    },
    update: (ref, data) => documents.set(ref.path, {...documents.get(ref.path), ...storable(data)}),
  };
  return {
    doc,
    collection: path => ({
      path, collection: true,
      where: (key, _operator, value) => ({path, collection: true, match: item => item[key] === value}),
    }),
    runTransaction: async operation => operation(transaction),
    seed: (path, data) => documents.set(path, structuredClone(data)),
    remove: path => documents.delete(path),
    read: path => documents.get(path),
    find: (prefix, matches) => [...documents].find(([path, value]) => path.startsWith(prefix) && matches(value))?.[1],
  };
};

const board = 'map';
const attacker = 'attacker';
const defender = 'defender';
const place = token => `${board}__${token}`;
const parametri = {
  Base: {Forza: {Tot: 4}, Saggezza: {Tot: 7}, Intelligenza: {Tot: 6}, Costituzione: {Tot: 2}},
  Combattimento: {Mira: {Tot: 4}, Difesa: {Tot: 2}, Attacco: {Tot: 6}, RiduzioneDanni: {Tot: 2}},
  Special: {},
};
const stats = {hpCurrent: 100, manaCurrent: 100};
const greatsword = {
  General: {Nome: 'Spadone'}, Specific: {Tipo: 'Mischia', Hands: 2},
  Parametri: {Special: {Danno: {4: '2d4'}, 'Danno Critico': {4: '2d6'}}},
};
const physicalCheck = {'TPC Fisico': {Param1: 'Mira', Param2: '---', ParamTarget: 'Difesa'}};

const seedPawn = (token, col, data = {tokenType: 'character'}, ownerUid = token) => {
  db.seed(`grigliata_tokens/${token}`, {ownerUid, label: token, ...data});
  db.seed(`grigliata_token_placements/${place(token)}`, {tokenId: token, backgroundId: board, ownerUid, col, row: 0});
};
const seedTurn = token => db.seed(`grigliata_backgrounds/${board}`, {turnOrderActive: {tokenId: token}});
const seedSpell = (id, spell) => db.seed(`users/${attacker}/spells/${id}`, spell);
const seedStats = (uid, values) => db.seed(`users/${uid}/state/resources`, {stats: {...stats, ...values}});

// Attacker and defender are level-6 characters `distance` cells apart; every die rolls 1.
const fixture = ({distance = 1, slots = {weaponMain: greatsword}, foeSpells} = {}) => {
  db = memoryFirestore();
  dice = () => 1;
  for (const uid of [attacker, defender]) {
    db.seed(`users/${uid}`, {role: 'player'});
    db.seed(`users/${uid}/state/progression`, {stats: {level: 6}, Parametri: parametri});
    seedStats(uid, {});
  }
  seedPawn(attacker, 0, foeSpells
    ? {tokenType: 'foe', Parametri: parametri, stats, dadoAnima: 'd12', spells: foeSpells}
    : undefined);
  seedPawn(defender, distance);
  db.seed('grigliata_state/current', {activeBackgroundId: board});
  seedTurn(attacker);
  db.seed(`users/${attacker}/state/equipment`, {
    slots: Object.fromEntries(Object.keys(slots).map(slot => [slot, `item-${slot}`])),
  });
  Object.entries(slots).forEach(([slot, item]) =>
    db.seed(`users/${attacker}/inventory/item-${slot}`, {currentSnapshot: item}));
};

let operations = 0;
const call = (uid, data) => mutateGrigliataCombat.run({auth: {uid}, data});
const launch = (kind, actionId, options = {}) => call(attacker, {
  command: 'launch', operationId: `combat-test-${++operations}`, backgroundId: board,
  actorPlacementId: place(attacker), targetPlacementIds: [place(defender)], kind, actionId, ...options,
});
const defend = (combatId, options = {}) => call(defender, {
  command: 'defend', combatId, round: 1, targetPlacementId: place(defender), ...options,
});
const arsenal = () => getGrigliataCombatArsenal.run({
  auth: {uid: attacker}, data: {backgroundId: board, actorPlacementId: place(attacker)},
});
const journal = combatId => db.read(`grigliata_combat_actions/${combatId}`);
const request = combatId => db.find('grigliata_combat_requests/', value => value.combatId === combatId);
const roll = (label, bonus, rolls = [1]) => ({label, bonus, sides: 12, rolls, total: bonus + 1});

test('the defender reply carries both rolls and the proposed damage, and a retry returns it unchanged', async () => {
  fixture();
  seedSpell('barrier', {
    Nome: 'Barriera Cosmica (offensiva)', Costo: 19, Gittata: '30 ft',
    'TPC Fisico': {Param1: 'Intelligenza', Param2: 'Saggezza', ParamTarget: 'Costituzione'},
  });
  const spell = await launch('spell', 'personal:barrier');
  const reply = await defend(spell.combatId);
  assert.deepEqual(reply, {
    combatId: spell.combatId, round: 1, outcome: 'hit', damage: 3,
    attack: roll('max(Intelligenza, Saggezza)', 7), defense: roll('Costituzione', 2),
    effects: [{
      kind: 'damage', label: 'Danno proposto', expr: '3d10', amount: 3, targetPlacementId: place(defender),
    }],
  });
  assert.deepEqual(await defend(spell.combatId), reply);
  assert.equal(journal(spell.combatId).effects.length, 1);
  assert.equal(journal(spell.combatId).targets[0].damage, 3);

  const weapon = await launch('weapon', 'weaponMain');
  const hit = await defend(weapon.combatId);
  assert.deepEqual([hit.outcome, hit.damage, hit.attack.total, hit.defense], [
    'hit', 9, 5, roll('Difesa', 2),
  ]);
  assert.deepEqual(hit.effects, [{
    kind: 'damage', label: 'Danno base', expr: '2d4', amount: 9, targetPlacementId: place(defender),
  }]);
  assert.deepEqual(await defend(weapon.combatId), hit);

  const tied = await launch('weapon', 'weaponMain');
  const tie = await defend(tied.combatId, {defense: 4});
  assert.deepEqual([tie.outcome, tie.damage, tie.effects], ['tie', null, []]);
  assert.deepEqual(await defend(tied.combatId, {defense: 4}), tie);
});

test('a target is fallen when the board marks it, whatever its PF', async () => {
  fixture();
  seedStats(defender, {hpCurrent: 0});
  seedStats(attacker, {essenzaCurrent: 13});
  seedSpell('rune', {Nome: 'runa della resurrezione', Costo: '10 Essenza'});
  const rune = () => launch('spell', 'personal:rune', {confirmExtra: true});
  assert.equal(journal((await launch('weapon', 'weaponMain')).combatId).status, 'waiting');
  await assert.rejects(rune, /bersaglio caduto/);

  db.seed(`grigliata_token_placements/${place(defender)}`, {
    tokenId: defender, backgroundId: board, ownerUid: defender, col: 1, row: 0, isDead: true,
  });
  await assert.rejects(() => launch('weapon', 'weaponMain'), /bersaglio attivo/);
  assert.equal(journal((await rune()).combatId).status, 'done');

  seedStats(attacker, {hpCurrent: 0});
  await assert.rejects(() => launch('weapon', 'weaponMain'), /incapacitato/);
});

test('physical-attack spells ask for Riduzione Danni and propose the weapon damage', async () => {
  const names = ['INVESTIMENTO', 'TAGLIO DEI COSTI', 'SPECULAZIONE'];
  const seedSpells = () => names.forEach((Nome, index) => seedSpell(`physical-${index}`, {
    Nome, Costo: index ? 0 : 5, Gittata: index ? 0 : '10 m', ...physicalCheck,
    'Effetti Positivi': 'Effettua un attacco fisico.',
  }));
  fixture();
  seedSpells();
  for (const index of names.keys()) {
    const {combatId} = await launch('spell', `personal:physical-${index}`, {confirmExtra: true});
    assert.equal(request(combatId).defense.showReduction, true);
    assert.equal((await defend(combatId)).damage, 9);
    assert.deepEqual(journal(combatId).effects.map(({kind, label, amount}) => [kind, label, amount]), [
      ['manual', 'Effetto da confermare al tavolo', null], ['damage', 'Danno base', 9],
    ]);
  }
  const weapon = await launch('weapon', 'weaponMain');
  assert.equal((await defend(weapon.combatId)).damage, 9);

  fixture({distance: 6});
  seedSpells();
  assert.equal(journal((await launch('spell', 'personal:physical-0')).combatId).status, 'waiting');
  await assert.rejects(() => launch('spell', 'personal:physical-1', {confirmExtra: true}), /fuori gittata/);
});

test('spells granted by equipped items are listed with their source and resolve per their cards', async () => {
  const blank = {Param1: '---', Param2: '---', ParamTarget: '---'};
  const itemSpell = (Nome, Costo, Gittata, Azione = '') => ({
    Nome, Costo, Gittata, Azione, TPC: blank, 'TPC Fisico': blank, 'TPC Mentale': blank,
    'Effetti Positivi': `Effetto di ${Nome}.`,
  });
  fixture({distance: 6, slots: {
    weaponOff: {
      General: {Nome: 'Catena del Predatore', spells: {
        'Afferra': {...itemSpell('Afferra', 8, 30, 'Consumabile'), 'TPC Fisico': {...blank, Param1: 'Forza'}},
        'Dardo Cosmico': true,
      }},
      Specific: {Tipo: 'Distanza', Gittata: 30}, Parametri: {Special: {Danno: {4: '2d8'}}},
    },
    accessorio: {General: {Nome: 'Destino', spells: {
      'Resurrezione': itemSpell('Resurrezione', 3, 0),
      'Stasi Personale': itemSpell('Stasi Personale', 1, 10),
      'Stasi Protettiva': itemSpell('Stasi Protettiva', 2, 10),
    }}},
  }});
  seedSpell('own', {Nome: 'Fulmine', Costo: 1});
  const listed = (await arsenal()).actions;
  const granted = listed.filter(({sourceItem}) => sourceItem);
  // Grants of what is equipped now come before the learned repertoire.
  assert.ok(listed.findIndex(({sourceItem}) => sourceItem) < listed.findIndex(({id}) => id === 'personal:own'));
  assert.deepEqual(granted.map(({id, kind, scope, sourceItem}) => [id, kind, scope, sourceItem]), [
    ['item:weaponOff:Afferra', 'spell', 'equipped', 'Catena del Predatore'],
    ['item:accessorio:Resurrezione', 'spell', 'equipped', 'Destino'],
    ['item:accessorio:Stasi Personale', 'spell', 'equipped', 'Destino'],
    ['item:accessorio:Stasi Protettiva', 'spell', 'equipped', 'Destino'],
  ]);

  const grab = await launch('spell', 'item:weaponOff:Afferra');
  assert.deepEqual([request(grab.combatId).ownerUid, request(grab.combatId).defense.label], [defender, 'Forza']);
  assert.equal(grab.resources.mana, 92);

  const ring = (name, options) => launch('spell', `item:accessorio:${name}`, options);
  await assert.rejects(() => ring('Stasi Protettiva'), /Conferma la risorsa/);
  const shield = await ring('Stasi Protettiva', {confirmExtra: true});
  assert.deepEqual(journal(shield.combatId).cost, {
    mana: 0, hp: 0, essenza: 0, extra: {name: 'Cariche', amount: 2},
  });
  assert.equal(shield.resources.mana, 92);

  await assert.rejects(() => ring('Resurrezione', {confirmExtra: true}), /bersaglio caduto/);
  db.seed(`grigliata_token_placements/${place(defender)}`, {
    tokenId: defender, backgroundId: board, ownerUid: defender, col: 6, row: 0, isDead: true,
  });
  assert.equal(journal((await ring('Resurrezione', {confirmExtra: true})).combatId).cost.extra.amount, 3);

  seedTurn(defender);
  const stasis = await ring('Stasi Personale', {targetPlacementIds: [], confirmExtra: true});
  assert.deepEqual(journal(stasis.combatId).targets.map(({placementId}) => placementId), [place(attacker)]);

  db.seed(`users/${attacker}/state/equipment`, {slots: {}});
  assert.deepEqual((await arsenal()).actions.filter(({sourceItem}) => sourceItem), []);
  await assert.rejects(() => ring('Stasi Personale', {targetPlacementIds: [], confirmExtra: true}), /repertorio/);
});

test('Singolarità journals the damage of its distance band', async () => {
  const cast = async feet => {
    fixture({distance: feet / 5});
    seedSpell('singularity', {
      Nome: 'Singolarità', Costo: 20, Gittata: '50 ft', Descrizione: 'Danno variabile con la distanza.',
    });
    const {combatId, resources} = await launch('spell', 'personal:singularity');
    assert.equal(resources.mana, 80);
    return journal(combatId).effects.map(({kind, label, expr, amount, targetPlacementId}) => {
      assert.equal(targetPlacementId, place(defender));
      return [kind, label, expr, amount];
    });
  };
  assert.deepEqual(await cast(5), [['damage', 'Danno proposto · 5 ft', '4d10', 4]]);
  assert.deepEqual(await cast(10), [['damage', 'Danno proposto · 10 ft', '3d10', 3]]);
  assert.deepEqual(await cast(20), [['damage', 'Danno proposto · 20 ft', '2d10', 2]]);
  assert.deepEqual(await cast(30), [['damage', 'Danno proposto · 30 ft · Attacco Furtivo', '1d10', 1]]);
  assert.deepEqual(await cast(40), [['damage', 'Danno proposto · 40 ft · Attacco Furtivo', '1', 1]]);
  assert.deepEqual(await cast(50), [['damage', 'Danno proposto · 50 ft · Attacco Furtivo', '1', 1]]);
  assert.deepEqual(await cast(15), [['manual', 'Fascia di danno da concordare al tavolo · 15 ft', '', null]]);
});

test('Ostruzione launches during the opponent turn while a weapon attack waits', async () => {
  fixture();
  seedTurn(defender);
  db.seed('utils/tecniche_common', {Ostruzione: {Nome: 'Ostruzione', Costo: 4, Azione: 'Movimento'}});
  const {combatId} = await launch('tecnica', 'common:Ostruzione');
  assert.equal(request(combatId).defense.label, 'Forza');
  await assert.rejects(() => launch('weapon', 'weaponMain'), /turno della pedina/);
});

test('Parte del Leone reaches the attack with the weapon and the cure within 30 ft, hit or not', async () => {
  fixture();
  seedSpell('lion', {Nome: 'PARTE DEL LEONE', Costo: 0, ...physicalCheck});
  const ally = 'ally';
  seedPawn(ally, 6, {tokenType: 'custom', Parametri: parametri, stats, dadoAnima: 'd12'}, attacker);
  const lion = targets => launch('spell', 'personal:lion', {
    targetPlacementIds: targets.map(place), confirmExtra: true,
  });
  const action = (await arsenal()).actions.find(({id}) => id === 'personal:lion');
  assert.deepEqual([action.roleRangesFt, action.rangeFt, action.attackStat], [[5, 30], 5, 16]);

  const {combatId} = await lion([defender, ally]);
  assert.equal(request(combatId).defense.showReduction, true);
  assert.equal((await defend(combatId, {defense: 90})).outcome, 'resisted');
  assert.deepEqual(journal(combatId).effects.filter(({kind}) => kind === 'heal'), [{
    kind: 'heal', label: 'Cura proposta', expr: '1d10', amount: 1, targetPlacementId: place(ally),
  }]);
  await assert.rejects(() => lion([ally, defender]), /ally è fuori gittata/);
  seedPawn(ally, 7, {tokenType: 'custom', Parametri: parametri, stats, dadoAnima: 'd12'}, attacker);
  await assert.rejects(() => lion([defender, ally]), /ally è fuori gittata/);
});

test('a foe spell rolls every die of its damage and leaves what it cannot roll to the table', async () => {
  fixture({foeSpells: [{name: 'Morso composto', danni: '2d6 + 1d4'}, {name: 'Morso velenoso', danni: '2d6 + veleno'}]});
  dice = (_minimum, maximum) => maximum - 1;
  const [compound, venom] = (await arsenal()).actions.filter(({kind}) => kind === 'spell');
  assert.deepEqual([compound.damageExpr, venom.damageExpr], ['2d6 + 1d4', '']);
  assert.equal(venom.manualEffect, 'Danno da tirare al tavolo: 2d6 + veleno');
  const effects = async action => journal((await launch('spell', action.id)).combatId).effects
    .map(({kind, expr, amount}) => [kind, expr, amount]);
  assert.deepEqual(await effects(compound), [['damage', '2d6 + 1d4', 16]]);
  assert.deepEqual(await effects(venom), [['manual', '', null]]);
});

test('an accepted effect proposes the card damage as well as its cure', async () => {
  fixture();
  seedSpell('pact', {Nome: 'Patto', Costo: 1, danni: '1d8', Cura: '1d4', combat: {targetConsent: true}});
  const {combatId} = await launch('spell', 'personal:pact');
  const reply = await defend(combatId, {consent: true});
  assert.deepEqual(
    [reply.outcome, reply.damage, reply.effects.map(({kind}) => kind)],
    ['accepted', 1, ['damage', 'heal']]
  );
  assert.deepEqual(await defend(combatId, {consent: true}), reply);
});

test('a hidden attacker stays hidden in the defense request', async () => {
  fixture();
  db.seed(`users/${attacker}`, {role: 'dm'});
  db.seed(`grigliata_token_placements/${place(attacker)}`, {
    tokenId: attacker, backgroundId: board, ownerUid: attacker, col: 0, row: 0, isVisibleToPlayers: false,
  });
  const {combatId} = await launch('weapon', 'weaponMain');
  assert.deepEqual(request(combatId).actor, {name: 'Attaccante nascosto'});
  // The defender's request names the pawns and nothing else: no token, no cell.
  assert.deepEqual(request(combatId).target, {placementId: place(defender), name: defender});
  assert.equal(journal(combatId).shared, false);
  assert.equal(journal(combatId).actor.placementId, place(attacker));
});

test('review round 3: legacy placements, hidden targets and changed definitions', async () => {
  fixture();
  // An older character placement without tokenId is read as the owner's token, like the board does.
  db.seed(`grigliata_token_placements/${place(attacker)}`, {backgroundId: board, ownerUid: attacker, col: 0, row: 0});
  const {actions} = await arsenal();
  const sword = actions.find(({id}) => id === 'weaponMain');
  assert.match(sword.version, /^[0-9a-f]{16}$/);

  // A changed definition is refused before anything is rolled or spent.
  const before = db.read(`users/${attacker}/state/resources`);
  await assert.rejects(launch('weapon', 'weaponMain', {actionVersion: 'stale-version'}), {
    code: 'failed-precondition', message: "L'azione è cambiata: controlla l'arsenale aggiornato.",
  });
  assert.deepEqual(db.read(`users/${attacker}/state/resources`), before);
  assert.ok((await launch('weapon', 'weaponMain', {actionVersion: sword.version})).combatId);

  // A hidden target answers exactly like an absent one.
  db.seed(`grigliata_token_placements/${place(defender)}`, {
    tokenId: defender, backgroundId: board, ownerUid: defender, col: 1, row: 0, isVisibleToPlayers: false,
  });
  const hidden = await launch('weapon', 'weaponMain').catch(error => error);
  const absent = await launch('weapon', 'weaponMain', {targetPlacementIds: [place('nobody')]}).catch(error => error);
  assert.deepEqual([hidden.code, hidden.message], [absent.code, absent.message]);
});

test('review round 4: hidden pawns, artwork and requests from older clients', async () => {
  fixture();
  // Whoever calls, a hidden pawn fails exactly like an absent one, before anything else is read.
  db.seed(`grigliata_tokens/ghost`, {ownerUid: 'ghost', label: 'ghost', tokenType: 'character'});
  db.seed(`grigliata_token_placements/${place('ghost')}`, {
    tokenId: 'ghost', backgroundId: board, ownerUid: 'ghost', col: 2, row: 0, isVisibleToPlayers: false,
  });
  const asDefender = targetPlacementIds => call(defender, {
    command: 'launch', operationId: `combat-test-${++operations}`, backgroundId: board,
    actorPlacementId: place(attacker), targetPlacementIds, kind: 'weapon', actionId: 'weaponMain',
  }).catch(error => error);
  const hidden = await asDefender([place('ghost')]);
  const absent = await asDefender([place('nobody')]);
  assert.deepEqual([hidden.code, hidden.message], [absent.code, absent.message]);

  // Artwork is not part of the definition a launch is checked against.
  const before = (await arsenal()).actions.find(({id}) => id === 'weaponMain').version;
  db.seed(`users/${attacker}/inventory/item-weaponMain`, {currentSnapshot: {
    ...greatsword, General: {...greatsword.General, image_url: 'https://example.test/new.png'},
  }});
  assert.equal((await arsenal()).actions.find(({id}) => id === 'weaponMain').version, before);

  // A request without a version keeps the hash an earlier server stored for it.
  const {combatId} = await launch('weapon', 'weaponMain');
  const operationId = `combat-test-${operations}`;
  const replay = await call(attacker, {
    command: 'launch', operationId, backgroundId: board, actorPlacementId: place(attacker),
    targetPlacementIds: [place(defender)], kind: 'weapon', actionId: 'weaponMain',
  });
  assert.equal(replay.combatId, combatId);
  const {hashValue} = require('../lib/userDataV2');
  assert.equal(journal(combatId).requestHash, hashValue({
    backgroundId: board, actorPlacementId: place(attacker), actionId: 'weaponMain', kind: 'weapon',
    channel: '', point: null, ids: [place(defender)],
    approval: {confirmHp: false, maxHpCost: undefined, confirmExtra: false, variableCost: undefined},
  }));
});

const dm = 'dm';
const applyDamage = (combatId, options = {}, uid = dm) => call(uid, {
  command: 'applyDamage', combatId, targetPlacementId: place(defender), amount: 7, criticalScore: null, ...options,
});
const resources = uid => db.read(`users/${uid}/state/resources`);
const damageFixture = () => {
  fixture();
  db.seed(`users/${dm}`, {role: 'dm'});
};
const weaponHit = async (target = defender, owner = target) => {
  const {combatId} = await launch('weapon', 'weaponMain', {targetPlacementIds: [place(target)]});
  assert.equal((await call(owner, {
    command: 'defend', combatId, round: 1, targetPlacementId: place(target),
  })).outcome, 'hit');
  return combatId;
};

test('the board DM applies agreed damage once, barrier first, then PF', async () => {
  damageFixture();
  seedStats(defender, {barrieraCurrent: 4, barrieraTotal: 6, essenzaCurrent: 5});
  const combatId = await weaponHit();
  await assert.rejects(applyDamage(combatId, {}, attacker), {code: 'permission-denied'});
  const before = journal(combatId);
  const receipt = await applyDamage(combatId);
  assert.deepEqual(receipt, {combatId, damageApplied: {amount: 7}});
  assert.deepEqual(resources(defender), {
    stats: {hpCurrent: 97, manaCurrent: 100, barrieraCurrent: 0, barrieraTotal: 6, essenzaCurrent: 5},
    schemaVersion: 2, revision: 1, updatedAt: 'now', updatedBy: dm,
  });
  // The journal keeps the agreed amount on that target and nothing else: no balances, no split.
  const after = journal(combatId);
  assert.deepEqual(after, {...before, updatedAt: 'now', targets: [{...before.targets[0], damageApplied: {amount: 7}}]});

  // A retry, whatever its amount or critical, returns the first receipt and leaves resources alone.
  const applied = structuredClone(resources(defender));
  assert.deepEqual(await applyDamage(combatId, {amount: 50}), receipt);
  assert.deepEqual(await applyDamage(combatId, {criticalScore: 13}), receipt);
  assert.deepEqual(resources(defender), applied);
  assert.deepEqual(journal(combatId), after);
});

test('applyDamage validates its input and records an agreed zero without touching resources', async () => {
  damageFixture();
  const combatId = await weaponHit();
  for (const amount of [-1, 1.5, '3', null, undefined, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(applyDamage(combatId, {amount}), {code: 'invalid-argument'});
  }
  for (const criticalScore of [undefined, 0, 42, 2.5, '13']) {
    await assert.rejects(applyDamage(combatId, {criticalScore}), {code: 'invalid-argument'});
  }
  await assert.rejects(applyDamage('missing-combat'), {code: 'not-found'});
  await assert.rejects(applyDamage(combatId, {targetPlacementId: place('nobody')}), {code: 'failed-precondition'});
  const untouched = structuredClone(resources(defender));
  assert.deepEqual(await applyDamage(combatId, {amount: 0}), {combatId, damageApplied: {amount: 0}});
  assert.deepEqual(resources(defender), untouched);
  assert.deepEqual(journal(combatId).targets[0].damageApplied, {amount: 0});
  assert.deepEqual(await applyDamage(combatId, {amount: 4}), {combatId, damageApplied: {amount: 0}});
  assert.deepEqual(resources(defender), untouched);
});

test('only a decisive landing with concrete damage for that target can be applied', async () => {
  damageFixture();
  const refused = {code: 'failed-precondition', message: /danno concreto/};
  const pending = await launch('weapon', 'weaponMain');
  await assert.rejects(applyDamage(pending.combatId), refused);
  const tied = await launch('weapon', 'weaponMain');
  assert.equal((await defend(tied.combatId, {defense: 4})).outcome, 'tie');
  await assert.rejects(applyDamage(tied.combatId), refused);
  const resisted = await launch('weapon', 'weaponMain');
  assert.equal((await defend(resisted.combatId, {defense: 90})).outcome, 'resisted');
  await assert.rejects(applyDamage(resisted.combatId), refused);

  seedSpell('pact', {Nome: 'Patto', Costo: 1, danni: '1d8', Cura: '1d4', combat: {targetConsent: true}});
  const declined = await launch('spell', 'personal:pact');
  assert.equal((await defend(declined.combatId, {consent: false})).outcome, 'declined');
  await assert.rejects(applyDamage(declined.combatId), refused);
  seedSpell('cure', {Nome: 'Inversione Cellulare', Costo: 1});
  const healed = await launch('spell', 'personal:cure');
  assert.deepEqual(journal(healed.combatId).effects.map(({kind}) => kind), ['heal']);
  await assert.rejects(applyDamage(healed.combatId), refused);
  // Nothing to confirm leaves no copy for the owner either.
  assert.equal(request(healed.combatId), undefined);
  seedSpell('band', {Nome: 'Singolarità', Costo: 1, Gittata: '50 ft'});
  db.seed(`grigliata_token_placements/${place(defender)}`, {
    tokenId: defender, backgroundId: board, ownerUid: defender, col: 3, row: 0,
  });
  const band = await launch('spell', 'personal:band');
  assert.deepEqual(journal(band.combatId).effects.map(({kind}) => kind), ['manual']);
  await assert.rejects(applyDamage(band.combatId), refused);
  assert.equal(request(band.combatId), undefined);
  // Damage that lands on the ground binds to no target.
  seedSpell('blast', {Nome: 'Esplosione', Costo: 1, combat: {mode: 'ground', damageExpr: '2d6'}});
  const ground = await launch('spell', 'personal:blast', {targetPlacementIds: [], point: {col: 1, row: 0}});
  assert.equal(journal(ground.combatId).effects[0].targetPlacementId, null);
  await assert.rejects(applyDamage(ground.combatId), {code: 'failed-precondition'});
  assert.equal(request(ground.combatId), undefined);
  assert.deepEqual(resources(defender).stats, {hpCurrent: 100, manaCurrent: 100});

  // An accepted card and an unopposed one each carry a concrete amount for their target.
  db.seed(`grigliata_token_placements/${place(defender)}`, {
    tokenId: defender, backgroundId: board, ownerUid: defender, col: 1, row: 0,
  });
  const accepted = await launch('spell', 'personal:pact');
  assert.equal((await defend(accepted.combatId, {consent: true})).outcome, 'accepted');
  assert.deepEqual((await applyDamage(accepted.combatId, {amount: 2})).damageApplied, {amount: 2});
  seedSpell('bolt', {Nome: 'Dardo Cosmico', Costo: 1});
  const bolt = await launch('spell', 'personal:bolt');
  assert.equal(journal(bolt.combatId).targets[0].outcome, 'applied');
  assert.deepEqual((await applyDamage(bolt.combatId, {amount: 3})).damageApplied, {amount: 3});
  assert.equal(resources(defender).stats.hpCurrent, 95);
});

test('the critical shown to the DM is the one applied, and it is locked once damage lands', async () => {
  damageFixture();
  const combatId = await weaponHit();
  const critical = score => call(attacker, {command: 'critical', combatId, targetPlacementId: place(defender), score});
  const first = (await critical(13)).critical;
  const stale = {code: 'failed-precondition', message: /critico è cambiato/};
  await assert.rejects(applyDamage(combatId), stale);
  await assert.rejects(applyDamage(combatId, {criticalScore: 14}), stale);
  assert.deepEqual(resources(defender).stats, {hpCurrent: 100, manaCurrent: 100});
  assert.deepEqual(await applyDamage(combatId, {amount: first.total, criticalScore: 13}),
    {combatId, damageApplied: {amount: first.total}});
  await assert.rejects(critical(41), {code: 'failed-precondition', message: /danno è già stato applicato/});
  assert.deepEqual((await critical(13)).critical, first);
  assert.deepEqual(journal(combatId).targets[0].critical, first);
  assert.equal(resources(defender).stats.hpCurrent, 100 - first.total);
});

test('characters read canonical balances with the legacy barrier as fallback', async () => {
  damageFixture();
  db.seed(`users/${defender}`, {role: 'player', stats: {barriera: 5, hpCurrent: 40}});
  const combatId = await weaponHit();
  await applyDamage(combatId, {amount: 8});
  assert.deepEqual(resources(defender).stats, {hpCurrent: 97, manaCurrent: 100, barrieraCurrent: 0});
  assert.deepEqual(db.read(`users/${defender}`), {role: 'player', stats: {barriera: 5, hpCurrent: 40}});
});

test('the canonical legacy barrier wins over the current field on a stale profile', async () => {
  damageFixture();
  db.seed(`users/${defender}`, {role: 'player', stats: {barrieraCurrent: 1}});
  seedStats(defender, {barriera: 8});
  const combatId = await weaponHit();
  await applyDamage(combatId, {amount: 5});
  assert.equal(resources(defender).stats.barrieraCurrent, 3);
  assert.equal(resources(defender).stats.hpCurrent, 100);
});

test('a custom pawn pending deletion cannot take damage from a resolved action', async () => {
  damageFixture();
  const pawn = 'custom-npc';
  const pawnPath = `grigliata_tokens/${pawn}`;
  seedPawn(pawn, 1, {tokenType: 'custom', Parametri: parametri, stats, dadoAnima: 'd12'}, dm);
  const combatId = await weaponHit(pawn, dm);
  const pending = {...db.read(pawnPath), task06Deletion: {status: 'pending'}};
  db.seed(pawnPath, pending);
  await assert.rejects(applyDamage(combatId, {targetPlacementId: place(pawn)}), {
    code: 'failed-precondition', message: /non è più disponibile/,
  });
  assert.deepEqual(db.read(pawnPath), pending);
  assert.equal(journal(combatId).targets[0].damageApplied, undefined);
});

test('an instance cannot take damage while its template is pending deletion', async () => {
  damageFixture();
  const pawn = 'custom-instance';
  const pawnPath = `grigliata_tokens/${pawn}`;
  const templateId = 'custom-template';
  const templatePath = `grigliata_tokens/${templateId}`;
  seedPawn(pawn, 1, {
    tokenType: 'custom', customTokenRole: 'instance', customTemplateId: templateId, Parametri: parametri,
    dadoAnima: 'd12', stats: {...stats, shieldCurrent: 3},
  }, dm);
  db.seed(templatePath, {ownerUid: dm, tokenType: 'custom', customTokenRole: 'template', customTemplateId: templateId});
  const combatId = await weaponHit(pawn, dm);
  const snapshot = db.read(pawnPath);
  db.seed(templatePath, {...db.read(templatePath), task06Deletion: {status: 'pending'}});
  await assert.rejects(applyDamage(combatId, {targetPlacementId: place(pawn), amount: 7}), {
    code: 'failed-precondition', message: /non è più disponibile/,
  });
  assert.deepEqual(db.read(pawnPath), snapshot);
  assert.equal(journal(combatId).targets[0].damageApplied, undefined);
});

test('damage spends the barrier without increasing or further debiting already negative PF', async () => {
  damageFixture();
  seedStats(defender, {barrieraCurrent: 3, hpCurrent: -4});
  await applyDamage(await weaponHit(), {amount: 8});
  assert.deepEqual(resources(defender).stats, {hpCurrent: -4, manaCurrent: 100, barrieraCurrent: 0});
});

test('a foe loses its token shield then PF; stale boards, tokens and accounts are refused', async () => {
  damageFixture();
  const foe = 'orc';
  const foeStats = {hpCurrent: 10, hpTotal: 20, shieldCurrent: 3, shieldTotal: 5, manaCurrent: 4};
  const foeToken = {tokenType: 'foe', Parametri: parametri, stats: foeStats, dadoAnima: 'd12', notes: 'Ruggisce.'};
  seedPawn(foe, 1, foeToken, dm);
  const foePlacement = `grigliata_token_placements/${place(foe)}`;
  db.seed(foePlacement, {...db.read(foePlacement), statuses: ['bleeding'], turnEffects: [{kind: 'shield'}]});
  const placementBefore = structuredClone(db.read(foePlacement));
  const combatId = await weaponHit(foe, dm);
  assert.deepEqual(await applyDamage(combatId, {targetPlacementId: place(foe), amount: 20}),
    {combatId, damageApplied: {amount: 20}});
  assert.deepEqual(db.read(`grigliata_tokens/${foe}`), {
    ownerUid: dm, label: foe, ...foeToken, stats: {...foeStats, shieldCurrent: 0, hpCurrent: 0},
    updatedAt: 'now', updatedBy: dm,
  });
  // The map marker stays the only authority on who has fallen.
  assert.deepEqual(db.read(foePlacement), placementBefore);

  const token = db.read(`grigliata_tokens/${foe}`);
  const refusedAfter = async (target, change, restore, message) => {
    const id = await weaponHit(target, target === foe ? dm : target);
    const snapshot = structuredClone([resources(defender), db.read(`grigliata_tokens/${foe}`)]);
    change();
    await assert.rejects(applyDamage(id, {targetPlacementId: place(target)}), {code: 'failed-precondition', message});
    restore();
    assert.deepEqual([resources(defender), db.read(`grigliata_tokens/${foe}`)], snapshot);
    assert.equal(journal(id).targets[0].damageApplied, undefined);
  };
  const reseed = (path, data) => () => db.seed(path, data);
  const state = db.read('grigliata_state/current');
  await refusedAfter(defender, reseed('grigliata_state/current', {activeBackgroundId: 'other'}),
    reseed('grigliata_state/current', state), /non è più attiva/);
  const defenderPlacement = `grigliata_token_placements/${place(defender)}`;
  const placed = db.read(defenderPlacement);
  await refusedAfter(defender, () => db.remove(defenderPlacement), reseed(defenderPlacement, placed),
    /non è più piazzata/);
  await refusedAfter(foe, reseed(`grigliata_tokens/${foe}`, {...token, deletionState: 'pending'}),
    reseed(`grigliata_tokens/${foe}`, token), /non è più disponibile/);
  // The same placement now holding someone else's token is not the target the journal recorded.
  await refusedAfter(foe, () => {
    db.seed(`grigliata_tokens/${foe}`, {...token, ownerUid: defender});
    db.seed(foePlacement, {...placementBefore, ownerUid: defender});
  }, () => {
    db.seed(`grigliata_tokens/${foe}`, token);
    db.seed(foePlacement, placementBefore);
  }, /bersaglio è cambiato/);
  // A character whose account is being deleted keeps its resources untouched.
  await refusedAfter(defender, reseed(`user_deletion_jobs/${defender}`, {stage: 'pending'}),
    () => db.remove(`user_deletion_jobs/${defender}`), /account del bersaglio/);
  const profile = db.read(`users/${defender}`);
  await refusedAfter(defender, reseed(`users/${defender}`, {...profile, deletionState: 'pending'}),
    reseed(`users/${defender}`, profile), /account del bersaglio/);
});

// Owner-applied damage and the ownerDamage projection on the owner's private request.
const {hashValue} = require('../lib/userDataV2');
const requestOf = (combatId, token = defender) =>
  db.read(`grigliata_combat_requests/${hashValue([combatId, place(token)])}`);
const denied = {code: 'permission-denied', message: 'Puoi applicare il danno solo a una pedina che controlli.'};
const absentPawn = {code: 'failed-precondition', message: 'Una pedina non è più piazzata sulla mappa.'};
const projection = (combatId, {token = defender, kind = 'weapon', action = {name: 'Spadone', hands: 2}, ...target}) => ({
  ownerUid: token, backgroundId: board, combatId, ownerDamageUpdatedAt: 'now',
  ownerDamage: {kind, action, target: {
    placementId: place(token), name: token, ownerUid: token, status: 'done', round: 1, outcome: 'hit',
    damage: 9, critical: null, damageApplied: null, ...target,
  }},
});
const hideAttacker = () => {
  db.seed(`users/${attacker}`, {role: 'dm'});
  db.seed(`grigliata_token_placements/${place(attacker)}`, {
    tokenId: attacker, backgroundId: board, ownerUid: attacker, col: 0, row: 0, isVisibleToPlayers: false,
  });
};
const confirmCritical = (combatId, score, token = defender) => call(attacker, {
  command: 'critical', combatId, targetPlacementId: place(token), score,
});

test('the target owner applies their own damage; anyone else gets one answer whatever the journal holds', async () => {
  damageFixture();
  db.seed('users/stranger', {role: 'player'});
  seedStats(defender, {barrieraCurrent: 4});
  const pending = await launch('weapon', 'weaponMain');
  const combatId = await weaponHit();
  // Authorization comes first: no one else learns whether a journal, a target or its damage exists.
  for (const [id, options, uid] of [
    [combatId, {}, attacker], [combatId, {}, 'stranger'], [pending.combatId, {}, 'stranger'],
    ['missing-combat', {}, defender], [combatId, {targetPlacementId: place('nobody')}, defender],
    [combatId, {targetPlacementId: place(attacker)}, defender],
  ]) {
    await assert.rejects(applyDamage(id, options, uid), denied);
  }
  await assert.rejects(applyDamage(combatId, {amount: -1}, 'stranger'), {code: 'invalid-argument'});
  await assert.rejects(applyDamage(pending.combatId, {}, defender), {code: 'failed-precondition', message: /danno concreto/});
  assert.deepEqual(resources(defender).stats, {hpCurrent: 100, manaCurrent: 100, barrieraCurrent: 4});

  const receipt = await applyDamage(combatId, {}, defender);
  assert.deepEqual(receipt, {combatId, damageApplied: {amount: 7}});
  assert.deepEqual(resources(defender), {
    stats: {hpCurrent: 97, manaCurrent: 100, barrieraCurrent: 0},
    schemaVersion: 2, revision: 1, updatedAt: 'now', updatedBy: defender,
  });
  assert.deepEqual(journal(combatId).targets[0].damageApplied, {amount: 7});
  // The map marker stays the only authority on who has fallen.
  assert.equal(db.read(`grigliata_token_placements/${place(defender)}`).isDead, undefined);
  const applied = structuredClone([journal(combatId), resources(defender), requestOf(combatId)]);
  // First writer wins: the owner's retry and the DM both get the owner's receipt; others still get none.
  assert.deepEqual(await applyDamage(combatId, {amount: 30}, defender), receipt);
  assert.deepEqual(await applyDamage(combatId, {amount: 2}), receipt);
  for (const uid of [attacker, 'stranger']) await assert.rejects(applyDamage(combatId, {}, uid), denied);
  assert.deepEqual([journal(combatId), resources(defender), requestOf(combatId)], applied);
});

test('a shared defense that lands damage settles with the damage its owner may apply, kept current', async () => {
  damageFixture();
  const {combatId} = await launch('weapon', 'weaponMain');
  const waiting = structuredClone(requestOf(combatId));
  assert.equal(waiting.ownerDamage, undefined);
  assert.equal((await defend(combatId)).outcome, 'hit');
  assert.equal(journal(combatId).shared, true);
  // The answer and the damage arrive in one write; the rest of the request stays as it was.
  assert.deepEqual(requestOf(combatId), {...waiting, ...projection(combatId, {}), status: 'done'});

  const {critical: first} = await confirmCritical(combatId, 13);
  assert.deepEqual(requestOf(combatId), {...waiting, ...projection(combatId, {critical: first}), status: 'done'});
  const {critical: next} = await confirmCritical(combatId, 41);
  assert.notDeepEqual(next, first);
  assert.deepEqual(requestOf(combatId).ownerDamage.target.critical, next);
  await assert.rejects(applyDamage(combatId, {criticalScore: 13}, defender), {
    code: 'failed-precondition', message: /critico è cambiato/,
  });
  const receipt = await applyDamage(combatId, {amount: next.total, criticalScore: 41}, defender);
  assert.deepEqual(receipt, {combatId, damageApplied: {amount: next.total}});
  const settled = {
    ...waiting, ...projection(combatId, {critical: next, damageApplied: {amount: next.total}}), status: 'done',
  };
  assert.deepEqual(requestOf(combatId), settled);
  assert.deepEqual(await applyDamage(combatId, {amount: 1}), receipt);
  await assert.rejects(confirmCritical(combatId, 13), {code: 'failed-precondition'});
  assert.deepEqual(requestOf(combatId), settled);

  // Nothing to apply, nothing projected: a resisted answer, and a tie until its retry lands.
  const resisted = await launch('weapon', 'weaponMain');
  assert.equal((await defend(resisted.combatId, {defense: 90})).outcome, 'resisted');
  assert.equal(requestOf(resisted.combatId).ownerDamage, undefined);
  const tied = await launch('weapon', 'weaponMain');
  assert.equal((await defend(tied.combatId, {defense: 4})).outcome, 'tie');
  assert.equal(requestOf(tied.combatId).ownerDamage, undefined);
  await call(attacker, {command: 'retry', combatId: tied.combatId, round: 1, targetPlacementId: place(defender)});
  assert.equal(requestOf(tied.combatId).ownerDamage, undefined);
  assert.equal((await defend(tied.combatId, {round: 2})).outcome, 'hit');
  assert.deepEqual(requestOf(tied.combatId).ownerDamage, projection(tied.combatId, {round: 2}).ownerDamage);

  // Damage that lands at once on a shared journal also waits for its owner, until its first application.
  seedSpell('bolt', {Nome: 'Dardo Cosmico', Costo: 1});
  const bolt = await launch('spell', 'personal:bolt');
  assert.equal(journal(bolt.combatId).shared, true);
  assert.equal(requestOf(bolt.combatId).status, 'damagePending');
  assert.deepEqual(await applyDamage(bolt.combatId, {amount: 2}, defender),
    {combatId: bolt.combatId, damageApplied: {amount: 2}});
  assert.deepEqual([requestOf(bolt.combatId).status, requestOf(bolt.combatId).ownerDamage.target.damageApplied],
    ['done', {amount: 2}]);
});

test('immediate concrete damage waits for each owner in Home, shared or hidden, until its first application', async () => {
  damageFixture();
  seedSpell('bolt', {Nome: 'Dardo Cosmico', Costo: 1});
  const spell = {kind: 'spell', action: {name: 'Dardo Cosmico', hands: 0}, outcome: 'applied', damage: 2};
  const pending = (combatId, target = {}) =>
    ({...projection(combatId, {...spell, ...target}), status: 'damagePending', createdAt: 'now'});
  const settled = (combatId, amount) =>
    ({...pending(combatId, {damageApplied: {amount}}), status: 'done'});

  // A shared action gains the same minimal copy a hidden one has, now marked as awaiting confirmation.
  const shared = await launch('spell', 'personal:bolt');
  assert.equal(journal(shared.combatId).shared, true);
  assert.deepEqual(requestOf(shared.combatId), pending(shared.combatId));
  // A confirmation is no defense: nobody answers it or rerolls it.
  const unavailable = {code: 'not-found', message: 'Richiesta di combattimento non disponibile.'};
  const round = {combatId: shared.combatId, round: 1, targetPlacementId: place(defender)};
  await assert.rejects(call(defender, {...round, command: 'defend'}), unavailable);
  await assert.rejects(call(attacker, {...round, command: 'retry'}), unavailable);
  assert.deepEqual(requestOf(shared.combatId), pending(shared.combatId));

  // The owner's first application settles it with the receipt, journal and balances in one write.
  const receipt = await applyDamage(shared.combatId, {amount: 2}, defender);
  assert.deepEqual(requestOf(shared.combatId), settled(shared.combatId, 2));
  assert.deepEqual(journal(shared.combatId).targets[0].damageApplied, {amount: 2});
  assert.equal(resources(defender).stats.hpCurrent, 98);
  // A retry from anyone allowed returns that receipt and leaves the settled copy as it is.
  const applied = structuredClone([journal(shared.combatId), resources(defender), requestOf(shared.combatId)]);
  assert.deepEqual(await applyDamage(shared.combatId, {amount: 5}, defender), receipt);
  assert.deepEqual(await applyDamage(shared.combatId, {amount: 9}), receipt);
  assert.deepEqual([journal(shared.combatId), resources(defender), requestOf(shared.combatId)], applied);

  // The DM's application settles it just the same.
  const byDm = await launch('spell', 'personal:bolt');
  await applyDamage(byDm.combatId, {amount: 1});
  assert.deepEqual(requestOf(byDm.combatId), settled(byDm.combatId, 1));

  // A hidden attacker's damage waits as well, with the very same fields.
  hideAttacker();
  const hidden = await launch('spell', 'personal:bolt');
  assert.equal(journal(hidden.combatId).shared, false);
  assert.deepEqual(requestOf(hidden.combatId), pending(hidden.combatId));
  await applyDamage(hidden.combatId, {amount: 3}, defender);
  assert.deepEqual(requestOf(hidden.combatId), settled(hidden.combatId, 3));
});

test('private results outside the caller’s scope remain unavailable to defense and critical commands', async () => {
  damageFixture();
  hideAttacker();
  db.seed('users/stranger', {role: 'player'});
  seedSpell('dart', {Nome: 'Dardo', Costo: 1, combat: {damageExpr: '2d4'}});
  const immediate = await launch('spell', 'personal:dart');
  const opposed = await launch('weapon', 'weaponMain');
  assert.ok(requestOf(immediate.combatId).ownerDamage);
  assert.ok(requestOf(opposed.combatId).defense);

  const defenseInput = {targetPlacementId: place(defender), round: 1};
  const unavailable = {code: 'not-found', message: 'Richiesta di combattimento non disponibile.'};
  for (const command of ['defend', 'retry']) {
    for (const combatId of ['missing', immediate.combatId, opposed.combatId]) {
      await assert.rejects(call('stranger', {...defenseInput, command, combatId}), unavailable);
    }
  }
  await assert.rejects(call(defender, {...defenseInput, command: 'defend', combatId: immediate.combatId}), unavailable);
  await assert.rejects(call(attacker, {...defenseInput, command: 'retry', combatId: immediate.combatId}), unavailable);
  for (const combatId of ['missing', opposed.combatId]) {
    await assert.rejects(call('stranger', {command: 'critical', combatId, targetPlacementId: place(defender), score: 13}),
      {code: 'not-found', message: 'Combattimento non disponibile.'});
  }
  assert.equal((await defend(opposed.combatId)).outcome, 'hit');
  assert.equal((await confirmCritical(opposed.combatId, 13)).critical.score, 13);
});

test('an unshared journal reaches each owner only as their own pawn damage, kept current', async () => {
  damageFixture();
  hideAttacker();
  seedPawn('elf', 2);
  db.seed('users/elf', {role: 'player'});
  seedStats('elf', {});
  seedSpell('volley', {Nome: 'Raffica', Costo: 1, combat: {mode: 'multiple', targetCount: 2, damageExpr: '2d4'}});
  const {combatId} = await launch('spell', 'personal:volley', {targetPlacementIds: [place(defender), place('elf')]});
  assert.equal(journal(combatId).shared, false);
  const spell = {kind: 'spell', action: {name: 'Raffica', hands: 0}, outcome: 'applied', damage: 2};
  const awaiting = {status: 'damagePending', createdAt: 'now'};
  assert.deepEqual(requestOf(combatId), {...projection(combatId, spell), ...awaiting});
  assert.deepEqual(requestOf(combatId, 'elf'), {...projection(combatId, {...spell, token: 'elf'}), ...awaiting});
  // Nothing about the actor or the other target, and no defense prompt for the inbox.
  assert.doesNotMatch(JSON.stringify(requestOf(combatId)), /attacker|elf/);
  assert.equal(db.find('grigliata_combat_requests/', value => value.defense !== undefined), undefined);

  const elfBefore = structuredClone(requestOf(combatId, 'elf'));
  await assert.rejects(applyDamage(combatId, {targetPlacementId: place('elf')}, defender), denied);
  assert.deepEqual(await applyDamage(combatId, {amount: 2}, defender), {combatId, damageApplied: {amount: 2}});
  assert.deepEqual(requestOf(combatId),
    {...projection(combatId, {...spell, damageApplied: {amount: 2}}), ...awaiting, status: 'done'});
  assert.deepEqual(requestOf(combatId, 'elf'), elfBefore);
  assert.equal(resources(defender).stats.hpCurrent, 98);
  // The DM first, then the owner: the owner gets the DM's receipt.
  await applyDamage(combatId, {targetPlacementId: place('elf'), amount: 5});
  assert.deepEqual(await applyDamage(combatId, {targetPlacementId: place('elf'), amount: 1}, 'elf'),
    {combatId, damageApplied: {amount: 5}});
  assert.deepEqual(requestOf(combatId, 'elf'),
    {...projection(combatId, {...spell, token: 'elf', damageApplied: {amount: 5}}), ...awaiting, status: 'done'});
  assert.equal(resources('elf').stats.hpCurrent, 95);

  // An opposed blow from the hidden attacker: the waiting prompt gets the damage once the defense lands.
  const blow = await launch('weapon', 'weaponMain');
  const waiting = structuredClone(requestOf(blow.combatId));
  assert.deepEqual([waiting.ownerDamage, waiting.actor], [undefined, {name: 'Attaccante nascosto'}]);
  assert.equal((await defend(blow.combatId)).outcome, 'hit');
  assert.deepEqual(requestOf(blow.combatId), {...waiting, ...projection(blow.combatId, {}), status: 'done'});
  const {critical} = await confirmCritical(blow.combatId, 13);
  assert.deepEqual(requestOf(blow.combatId).ownerDamage.target.critical, critical);
  const missed = await launch('weapon', 'weaponMain');
  await defend(missed.combatId, {defense: 90});
  assert.equal(requestOf(missed.combatId).ownerDamage, undefined);
});

test('an owner reaches their hidden pawn, and only while that very token is still theirs', async () => {
  damageFixture();
  db.seed(`users/${attacker}`, {role: 'dm'});
  db.seed('users/stranger', {role: 'player'});
  const placementPath = `grigliata_token_placements/${place(defender)}`;
  const tokenPath = `grigliata_tokens/${defender}`;
  const hidden = {tokenId: defender, backgroundId: board, ownerUid: defender, col: 1, row: 0, isVisibleToPlayers: false};
  db.seed(placementPath, hidden);
  const combatId = await weaponHit();
  assert.equal(journal(combatId).shared, false);
  const token = db.read(tokenPath);
  const untouched = structuredClone([resources(defender), journal(combatId), requestOf(combatId)]);
  // Given away while hidden, or gone: the former owner gets the answer of an absent pawn either way.
  db.seed(placementPath, {...hidden, ownerUid: 'stranger'});
  db.seed(tokenPath, {...token, ownerUid: 'stranger'});
  const transferred = await applyDamage(combatId, {}, defender).catch(error => error);
  await assert.rejects(applyDamage(combatId, {}, 'stranger'), denied);
  db.remove(placementPath);
  db.seed(tokenPath, token);
  const removed = await applyDamage(combatId, {}, defender).catch(error => error);
  for (const error of [transferred, removed]) {
    assert.deepEqual([error.code, error.message], [absentPawn.code, absentPawn.message]);
  }
  assert.deepEqual([resources(defender), journal(combatId), requestOf(combatId)], untouched);

  db.seed(placementPath, hidden);
  assert.deepEqual(await applyDamage(combatId, {}, defender), {combatId, damageApplied: {amount: 7}});
  assert.equal(resources(defender).stats.hpCurrent, 93);
  assert.deepEqual(requestOf(combatId).ownerDamage.target.damageApplied, {amount: 7});
  assert.equal(db.read(placementPath).isDead, undefined);
});

test('older journals stay applicable as they are, and malformed ones are refused safely', async () => {
  damageFixture();
  seedSpell('bolt', {Nome: 'Dardo Cosmico', Costo: 1});
  // Launches today, then rewinds the journal and the owner's copy to what an earlier server stored.
  const bolt = async (change = event => event, olderCopy = copy => copy) => {
    const {combatId} = await launch('spell', 'personal:bolt');
    const path = `grigliata_combat_actions/${combatId}`;
    db.seed(path, change(structuredClone(db.read(path))));
    const copyPath = `grigliata_combat_requests/${hashValue([combatId, place(defender)])}`;
    const copy = olderCopy(structuredClone(db.read(copyPath)));
    if (copy === undefined) db.remove(copyPath);
    else db.seed(copyPath, copy);
    return combatId;
  };
  const noCopy = () => undefined;
  const spell = {kind: 'spell', action: {name: 'Dardo Cosmico', hands: 0}, outcome: 'applied', damage: 2};

  // A journal from before `shared` was recorded is not readable by players: applying it projects it to the
  // owner, as a plain copy that never reopens a confirmation.
  const unmarked = await bolt(({shared, ...event}) => ({
    ...event, targets: event.targets.map(({critical, ...target}) => target),
  }), noCopy);
  assert.equal(request(unmarked), undefined);
  assert.deepEqual(await applyDamage(unmarked, {amount: 2}), {combatId: unmarked, damageApplied: {amount: 2}});
  assert.deepEqual(requestOf(unmarked), projection(unmarked, {...spell, damageApplied: {amount: 2}}));

  // A copy written before confirmations existed gains the receipt and stays without a status.
  const copied = await bolt(({shared, ...event}) => event, ({status, createdAt, ...copy}) => copy);
  await applyDamage(copied, {amount: 2}, defender);
  assert.deepEqual(requestOf(copied), projection(copied, {...spell, damageApplied: {amount: 2}}));

  // An older shared one is applied from the journal and no request appears.
  const shared = await bolt(event => event, noCopy);
  assert.deepEqual(await applyDamage(shared, {amount: 1}, defender), {combatId: shared, damageApplied: {amount: 1}});
  assert.equal(request(shared), undefined);

  // A defense answered before projections existed gains one when its damage is applied.
  const answered = await weaponHit();
  const {ownerDamage, ownerDamageUpdatedAt, ...older} = requestOf(answered);
  assert.ok(ownerDamage && ownerDamageUpdatedAt);
  db.seed(`grigliata_combat_requests/${hashValue([answered, place(defender)])}`, older);
  await applyDamage(answered, {}, defender);
  assert.deepEqual(requestOf(answered), {...older, ...projection(answered, {damageApplied: {amount: 7}})});

  const broken = await bolt(event => ({...event, targets: null}));
  await assert.rejects(applyDamage(broken, {}, defender), denied);
  await assert.rejects(applyDamage(broken), {code: 'failed-precondition', message: /non fa parte/});
  const ownerless = await bolt(event => ({...event, targets: event.targets.map(({ownerUid, ...target}) => target)}));
  await assert.rejects(applyDamage(ownerless, {}, defender), denied);
  const effectless = await bolt(event => ({...event, effects: null}));
  await assert.rejects(applyDamage(effectless, {}, defender), {code: 'failed-precondition', message: /danno concreto/});
  assert.equal(resources(defender).stats.hpCurrent, 100 - 2 - 2 - 1 - 7);
});
