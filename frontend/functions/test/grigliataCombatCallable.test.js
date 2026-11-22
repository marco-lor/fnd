const assert = require('node:assert/strict');
const {randomBytes, randomUUID} = require('node:crypto');
const Module = require('node:module');
const test = require('node:test');
const {Timestamp} = require('firebase-admin/firestore');

// The callable handlers run on in-memory documents with fixed dice: no network.
let db;
let dice = () => 1;
const stubs = {
  'crypto': {randomInt: (minimum, maximum) => dice(minimum, maximum), randomBytes, randomUUID},
  'firebase-admin': {firestore: () => db},
  'firebase-admin/app': {getApp: () => ({options: {projectId: 'demo-fnd-perf'}})},
  'firebase-admin/firestore': {
    getFirestore: () => db,
    Timestamp,
    FieldValue: {serverTimestamp: () => 'now', increment: value => value},
  },
};
const loadModule = Module._load;
Module._load = function(request, parent, ...rest) {
  return stubs[request] && /(?:grigliataCombat|userDataCommands)\.js$/.test(parent?.filename ?? '')
    ? stubs[request]
    : loadModule.call(this, request, parent, ...rest);
};
process.env.FUNCTIONS_EMULATOR = 'true';
const {getGrigliataCombatArsenal, mutateGrigliataCombat} = require('../lib/grigliataCombat');
const {
  task05AdjustGold, task05CommitConsumable, task05ConsumeTurnEffects, task05PrepareConsumable,
  task05UpdateGrigliataCharacterResources, task05UpdateResource,
} = require('../lib/userDataCommands');
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
  const versions = new Map();
  let commit = 0;
  const write = (path, data) => {
    const version = String(commit).padStart(10, '0');
    versions.set(path, {createTime: versions.get(path)?.createTime ?? version, updateTime: version});
    return documents.set(path, data);
  };
  // Every read, tagged with how it was made: `transaction` documents and queries join the
  // transaction's read set; a `query` runs outside it.
  const reads = [];
  // The path of every write that lands.
  const writes = [];
  let aborts = 0;
  let afterQuery = null;
  const doc = path => ({id: path.split('/').at(-1), path});
  const snapshot = ref => {
    const value = structuredClone(documents.get(ref.path));
    return {
      id: ref.id, ref, exists: value !== undefined, data: () => value, ...versions.get(ref.path),
      get: field => field.split('.').reduce((node, key) => node?.[key], value),
    };
  };
  const children = ({path, match}) => [...documents.keys()].filter(file => file.startsWith(path + '/')
    && file.split('/').length === path.split('/').length + 1 && (!match || match(documents.get(file))));
  const listed = ref => ({docs: children(ref).map(file => snapshot(doc(file)))});
  const transaction = {
    get: async ref => {
      reads.push({via: ref.collection ? 'transaction-query' : 'transaction', path: ref.path});
      return ref.collection ? listed(ref) : snapshot(ref);
    },
    getAll: async (...refs) => {
      refs.forEach(ref => reads.push({via: 'transaction', path: ref.path}));
      return refs.map(snapshot);
    },
    set: (ref, data, options) => {
      writes.push(ref.path);
      const value = storable(data);
      if (options?.mergeFields) {
        // Top-level field paths only: each named field is replaced whole, the rest is kept.
        assert.ok(options.mergeFields.every(field => !field.includes('.') && field in value));
        const named = Object.fromEntries(options.mergeFields.map(field => [field, value[field]]));
        return write(ref.path, {...documents.get(ref.path), ...named});
      }
      return write(ref.path, options?.merge ? merge(documents.get(ref.path), value) : value);
    },
    create: (ref, data) => {
      assert.equal(documents.has(ref.path), false);
      writes.push(ref.path);
      write(ref.path, storable(data));
    },
    update: (ref, data) => {
      writes.push(ref.path);
      write(ref.path, {...documents.get(ref.path), ...storable(data)});
    },
  };
  const query = (path, match) => ({
    path, collection: true, match,
    // Outside any transaction: the snapshot is taken now, and whatever changes afterwards is not in it.
    get: async () => {
      reads.push({via: 'query', path});
      const result = listed({path, match});
      const next = afterQuery;
      afterQuery = null;
      next?.();
      return result;
    },
  });
  return {
    doc,
    collection: path => ({
      ...query(path),
      where: (key, _operator, value) => query(path, item => item[key] === value),
    }),
    // An aborted attempt reads like the real one, but none of its writes land.
    runTransaction: async operation => {
      for (; aborts > 0; aborts -= 1) {
        await operation({...transaction, set: () => {}, create: () => {}, update: () => {}});
      }
      commit += 1;
      return operation(transaction);
    },
    abortNext: (count = 1) => { aborts = count; },
    onNextQuery: change => { afterQuery = change; },
    reads,
    writes,
    seed: (path, data) => { commit += 1; return write(path, structuredClone(data)); },
    remove: path => { versions.delete(path); return documents.delete(path); },
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

test('the arsenal shows and the launch charges the PM cost after equipped per-card reductions', async () => {
  const pike = {...greatsword, General: {Nome: 'Picca', ridCostoTecSingola: {Impedimento: 3}}};
  const ring = {General: {Nome: 'Anello', ridCostoTecSingola: {Impedimento: 4, 'AttaccoOpportunità': 2}}};
  fixture({slots: {weaponMain: pike, accessorio: ring}});
  db.seed(`users/${attacker}/state/progression`, {
    stats: {level: 6}, Parametri: {...parametri, Special: {ridCostoTec: {Tot: 2, Equip: 2}}},
  });
  db.seed('utils/tecniche_common', {
    Impedimento: {Nome: 'Impedimento', Costo: 12, Azione: 'Tattica'},
    'AttaccoOpportunità': {Nome: 'Attacco d\'Opportunità', Costo: 4, Azione: 'Movimento'},
    Carica: {Nome: 'Carica', Costo: 4, Azione: 'Movimento'},
  });
  const listed = async () => Object.fromEntries((await arsenal()).actions
    .filter(({scope}) => scope === 'common').map(action => [action.id, action]));
  const priced = actions => Object.values(actions).map(({id, baseCost, cost}) => [id, baseCost, cost]);
  const shown = await listed();
  assert.deepEqual(priced(shown), [
    ['common:Impedimento', 12, 3], ['common:AttaccoOpportunità', 4, 1], ['common:Carica', 4, 2],
  ]);
  const impediment = await launch('tecnica', 'common:Impedimento', {actionVersion: shown['common:Impedimento'].version});
  assert.deepEqual([impediment.resources.mana, journal(impediment.combatId).cost.mana], [97, 3]);
  assert.equal(db.read(`users/${attacker}/state/resources`).stats.manaCurrent, 97);

  // One inventory item reached from two slots is still one item.
  db.seed(`users/${attacker}/state/equipment`, {
    slots: {weaponMain: 'item-weaponMain', accessorio: 'item-accessorio', headArmor: 'item-accessorio'},
  });
  assert.equal((await listed())['common:Impedimento'].cost, 3);

  // Without the ring the card costs more, and a launch of the card shown before is refused.
  db.seed(`users/${attacker}/state/equipment`, {slots: {weaponMain: 'item-weaponMain'}});
  const bare = await listed();
  assert.deepEqual(priced(bare), [
    ['common:Impedimento', 12, 7], ['common:AttaccoOpportunità', 4, 2], ['common:Carica', 4, 2],
  ]);
  await assert.rejects(
    () => launch('tecnica', 'common:Impedimento', {actionVersion: shown['common:Impedimento'].version}),
    /azione è cambiata/
  );
  const full = await launch('tecnica', 'common:Impedimento', {actionVersion: bare['common:Impedimento'].version});
  assert.deepEqual([full.resources.mana, journal(full.combatId).cost.mana], [90, 7]);
});

test('a two-handed attack rolls with the Mira 2H of the equipped sheath', async () => {
  fixture({slots: {weaponMain: greatsword, foderoArma: {
    General: {Nome: 'Fodero Arma a due Mani di Qualità'}, Parametri: {Special: {'Mira 2H': {1: 1, 4: 2, 7: 3, 10: 4}}},
  }}});
  const weapon = (await arsenal()).actions.find(({id}) => id === 'weaponMain');
  assert.deepEqual([weapon.attackBonus, weapon.attackModifiers], [6, [{label: 'Mira', value: 4}, {label: 'Mira 2H', value: 2}]]);
  const {combatId} = await launch('weapon', 'weaponMain', {actionVersion: weapon.version});
  const {bonus, total} = journal(combatId).attack;
  assert.deepEqual([bonus, total, request(combatId).attack.total], [6, 7, 7]);
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

test('a canonical slot link that no longer resolves stays empty; only unlinked embedded gear counts', async () => {
  const granting = {...greatsword, General: {...greatsword.General, spells: {
    'Stasi Personale': {Nome: 'Stasi Personale', Costo: 1, Gittata: 10},
  }}};
  const equipped = async slots => {
    db.seed(`users/${attacker}/state/equipment`, {slots});
    return (await arsenal()).actions.filter(({scope}) => scope === 'equipped').map(({id}) => id);
  };
  fixture({slots: {}});
  // Copies of inventory entries that were sold or deleted: neither the weapon nor its grant survives.
  assert.deepEqual(await equipped({weaponMain: {...granting, _task05: {inventoryId: 'sold'}}}), []);
  assert.deepEqual(await equipped({weaponMain: {currentSnapshot: granting, _instance: {instanceId: 'sold'}}}), []);
  assert.deepEqual(await equipped({weaponMain: {...granting, _task05: {inventoryId: ''}, _instance: {instanceId: 'sold'}}}), []);
  assert.deepEqual(await equipped({weaponMain: {...granting, _task05: {inventoryId: 'not/an/id'}}}), []);
  // A live link reads the inventory entry, not the copy embedded with it.
  db.seed(`users/${attacker}/inventory/kept`, {currentSnapshot: greatsword});
  assert.deepEqual(await equipped({weaponMain: {...granting, _task05: {inventoryId: 'kept'}}}), ['weaponMain']);
  // Older slots that embed the item itself, with no canonical link, keep working.
  assert.deepEqual(await equipped({weaponMain: granting}), ['weaponMain', 'item:weaponMain:Stasi Personale']);
  assert.deepEqual(await equipped({weaponMain: {currentSnapshot: granting, inventoryId: 'legacy'}}), [
    'weaponMain', 'item:weaponMain:Stasi Personale',
  ]);
  const launched = await launch('weapon', 'weaponMain');
  assert.equal(journal(launched.combatId).action.name, 'Spadone');
});

test('ally actions reach only allies: own pawns on the same side and any player character', async () => {
  const foe = {tokenType: 'foe', Parametri: parametri, stats, dadoAnima: 'd12', spells: [
    {name: 'Ululato', combat: {relation: 'ally'}},
  ]};
  // The DM runs the foes and a custom pawn of their own.
  const setup = (dmUid = 'dm') => {
    fixture();
    db.seed(`grigliata_backgrounds/${board}`, {});
    db.seed(`users/${dmUid}`, {role: 'dm'});
    seedSpell('guard', {Nome: 'Scudo amico', Costo: 1, Gittata: '30 ft', combat: {relation: 'ally'}});
    seedSpell('mend', {Nome: 'Cura amica', Costo: 1, Gittata: '30 ft', Cura: '1d4', combat: {relation: 'selfOrAlly'}});
    seedPawn('summon', 2, {tokenType: 'custom', stats}, attacker);
    seedPawn('companion', 2, {tokenType: 'custom', stats}, defender);
    seedPawn('wolf', 1, foe, dmUid);
    seedPawn('bear', 2, foe, dmUid);
    seedPawn('npc', 2, {tokenType: 'custom', stats}, dmUid);
  };
  const cast = (actionId, target) => launch('spell', actionId, {targetPlacementIds: [place(target)]});
  const refused = {code: 'invalid-argument', message: 'Questa azione richiede un alleato.'};

  setup();
  assert.ok((await cast('personal:guard', defender)).combatId);
  assert.ok((await cast('personal:guard', 'summon')).combatId);
  assert.ok((await cast('personal:mend', attacker)).combatId);
  await assert.rejects(() => cast('personal:guard', attacker), /un'altra pedina/);
  // Another account's non-character pawn answers alike, foe or not: a player's board cannot tell them apart.
  for (const other of ['wolf', 'npc', 'companion']) {
    await assert.rejects(() => cast('personal:guard', other), refused);
    await assert.rejects(() => cast('personal:mend', other), refused);
  }
  // A weapon has no relation: it still reaches the foe. A refusal spends nothing.
  assert.ok((await launch('weapon', 'weaponMain', {targetPlacementIds: [place('wolf')]})).combatId);
  const before = db.read(`users/${attacker}/state/resources`);
  await assert.rejects(() => cast('personal:guard', 'wolf'), refused);
  assert.deepEqual(db.read(`users/${attacker}/state/resources`), before);

  // The DM is a player too: their character's allies are the party, never the foes they run.
  setup(attacker);
  assert.ok((await cast('personal:guard', defender)).combatId);
  assert.ok((await cast('personal:guard', 'npc')).combatId);
  await assert.rejects(() => cast('personal:guard', 'wolf'), refused);
  const howl = (await getGrigliataCombatArsenal.run({
    auth: {uid: attacker}, data: {backgroundId: board, actorPlacementId: place('wolf')},
  })).actions.find(({name}) => name === 'Ululato');
  assert.equal(howl.relation, 'ally');
  const foeCast = target => launch('spell', howl.id, {
    actorPlacementId: place('wolf'), targetPlacementIds: [place(target)],
  });
  assert.ok((await foeCast('bear')).combatId);
  for (const target of [attacker, defender, 'npc']) await assert.rejects(() => foeCast(target), refused);
});

test('a square area lists its pawns from a roster read outside the transaction and checked live', async () => {
  const setup = () => {
    fixture();
    db.seed(`grigliata_backgrounds/${board}`, {turnOrderActive: {tokenId: attacker}, fogOfWarEnabled: false});
    seedSpell('rain', {
      Nome: 'Pioggia di sassi', Costo: 1, Gittata: '60 ft',
      combat: {mode: 'area', area: {shape: 'square', sideSquares: 3}},
    });
    // The area centred on column 3 covers columns 2 to 4.
    seedPawn('inside', 3, {tokenType: 'custom', stats}, defender);
    seedPawn('mover', 4, {tokenType: 'custom', stats}, defender);
    seedPawn('veiled', 2, {tokenType: 'custom', stats}, defender);
    seedPawn('unveiled', 3, {tokenType: 'custom', stats}, defender);
    db.seed(`grigliata_token_placements/${place('unveiled')}`, {
      tokenId: 'unveiled', backgroundId: board, ownerUid: defender, col: 3, row: 0, isVisibleToPlayers: false,
    });
    seedPawn('far', 10, {tokenType: 'custom', stats}, defender);
    // Between the roster snapshot and the transaction: one pawn leaves, one is hidden, one is revealed.
    db.onNextQuery(() => {
      db.seed(`grigliata_token_placements/${place('mover')}`, {
        tokenId: 'mover', backgroundId: board, ownerUid: defender, col: 9, row: 0,
      });
      db.seed(`grigliata_token_placements/${place('veiled')}`, {
        tokenId: 'veiled', backgroundId: board, ownerUid: defender, col: 2, row: 0, isVisibleToPlayers: false,
      });
      db.seed(`grigliata_token_placements/${place('unveiled')}`, {
        tokenId: 'unveiled', backgroundId: board, ownerUid: defender, col: 3, row: 0,
      });
    });
  };
  const rain = () => launch('spell', 'personal:rain', {targetPlacementIds: [], point: {col: 3, row: 0}});
  const placementReads = via => db.reads.filter(read => read.via === via &&
    read.path.startsWith('grigliata_token_placements')).map(({path}) => path.split('/').at(-1));

  setup();
  db.abortNext();
  const {combatId} = await rain();
  const entry = journal(combatId);
  assert.deepEqual(entry.affected.map(({placementId}) => placementId).sort(), [place('inside'), place('unveiled')]);
  assert.equal(entry.shared, true);
  // One roster read for both attempts, never a transactional scan of the map, and only
  // the actor and the pawns the roster put in the area join the transaction.
  assert.deepEqual(placementReads('query'), ['grigliata_token_placements']);
  assert.deepEqual(placementReads('transaction-query'), []);
  assert.deepEqual([...new Set(placementReads('transaction'))].sort(), [
    place(attacker), place('inside'), place('mover'), place('unveiled'), place('veiled'),
  ].sort());
  // A retry of the same operation answers from its receipt.
  assert.equal((await call(attacker, {
    command: 'launch', operationId: `combat-test-${operations}`, backgroundId: board,
    actorPlacementId: place(attacker), targetPlacementIds: [], kind: 'spell', actionId: 'personal:rain',
    point: {col: 3, row: 0},
  })).combatId, combatId);

  // The DM's journal names the pawn hidden since the snapshot and stays private for it.
  setup();
  db.seed(`users/${attacker}`, {role: 'dm'});
  const hidden = journal((await rain()).combatId);
  assert.deepEqual(hidden.affected.map(({placementId}) => placementId).sort(), [
    place('inside'), place('unveiled'), place('veiled'),
  ]);
  assert.equal(hidden.shared, false);

  // With fog on, the area lists nobody and reads no roster.
  setup();
  db.seed(`grigliata_backgrounds/${board}`, {turnOrderActive: {tokenId: attacker}});
  assert.deepEqual(journal((await rain()).combatId).affected, []);
  assert.deepEqual(placementReads('query'), []);
});

test('square areas fill their limit with live eligible allies instead of the first placements', async () => {
  fixture();
  db.seed(`grigliata_backgrounds/${board}`, {fogOfWarEnabled: false});
  seedSpell('ward', {
    Nome: 'Cerchio protettivo', Costo: 1, Gittata: '60 ft',
    combat: {mode: 'area', relation: 'selfOrAlly', area: {shape: 'square', sideSquares: 3}},
  });
  for (let i = 0; i < 100; i += 1) {
    const id = `fallen-${i}`;
    seedPawn(id, 3, {tokenType: 'character', stats}, defender);
    const path = `grigliata_token_placements/${place(id)}`;
    db.seed(path, {...db.read(path), isDead: true});
  }
  seedPawn('foe-in-area', 3, {tokenType: 'foe', stats}, attacker);
  seedPawn('changed-owner', 3, {tokenType: 'character', stats}, defender);
  seedPawn('ally-in-area', 3, {tokenType: 'character', stats}, defender);
  db.onNextQuery(() => db.seed('grigliata_tokens/changed-owner', {ownerUid: attacker, tokenType: 'character'}));
  const {combatId} = await launch('spell', 'personal:ward', {targetPlacementIds: [], point: {col: 3, row: 0}});
  assert.deepEqual(journal(combatId).affected.map(({placementId}) => placementId), [place('ally-in-area')]);
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
  const {combatShieldActivation, ...balances} = resources(defender);
  assert.equal(typeof combatShieldActivation, 'string');
  assert.equal(db.read(`${privateReceiptPath(combatId)}/damage/${place(defender)}`).shieldActivation, combatShieldActivation);
  assert.deepEqual(balances, {
    stats: {hpCurrent: 97, manaCurrent: 100, barrieraCurrent: 0, barrieraTotal: 6, essenzaCurrent: 5},
    schemaVersion: 2, revision: 1, updatedAt: 'now', updatedBy: dm,
  });
  // The journal keeps the agreed amount on that target and nothing else: no balances, no split.
  const after = journal(combatId);
  assert.deepEqual(after, {...before, status: 'done', resolvedAt: 'now', updatedAt: 'now',
    targets: [{...before.targets[0], damageApplied: {amount: 7}}]});

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
  const {combatShieldActivation, ...damagedFoe} = db.read(`grigliata_tokens/${foe}`);
  assert.equal(typeof combatShieldActivation, 'string');
  assert.deepEqual(damagedFoe, {
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

  // The owner confirms the hit's 9 damage.
  const receipt = await applyDamage(combatId, {amount: 9}, defender);
  assert.deepEqual(receipt, {combatId, damageApplied: {amount: 9}});
  const {combatShieldActivation, ...balances} = resources(defender);
  assert.equal(typeof combatShieldActivation, 'string');
  assert.deepEqual(balances, {
    stats: {hpCurrent: 95, manaCurrent: 100, barrieraCurrent: 0},
    schemaVersion: 2, revision: 1, updatedAt: 'now', updatedBy: defender,
  });
  assert.deepEqual(journal(combatId).targets[0].damageApplied, {amount: 9});
  // The map marker stays the only authority on who has fallen.
  assert.equal(db.read(`grigliata_token_placements/${place(defender)}`).isDead, undefined);
  const applied = structuredClone([journal(combatId), resources(defender), requestOf(combatId)]);
  // First writer wins: the owner's retry, even below the minimum, and the DM both get the owner's receipt; others
  // still get none.
  assert.deepEqual(await applyDamage(combatId, {amount: 30}, defender), receipt);
  assert.deepEqual(await applyDamage(combatId, {amount: 0}, defender), receipt);
  assert.deepEqual(await applyDamage(combatId, {amount: 2}), receipt);
  for (const uid of [attacker, 'stranger']) await assert.rejects(applyDamage(combatId, {}, uid), denied);
  assert.deepEqual([journal(combatId), resources(defender), requestOf(combatId)], applied);
});

test('an owner confirms at least the proposed damage and may raise it; only the DM lowers it', async () => {
  damageFixture();
  const combatId = await weaponHit();
  const untouched = structuredClone([journal(combatId), resources(defender), requestOf(combatId)]);
  const belowNine = {code: 'permission-denied', message: 'Il danno non può essere inferiore a 9: solo il DM può ridurlo.'};
  for (const amount of [0, 8]) await assert.rejects(applyDamage(combatId, {amount}, defender), belowNine);
  assert.deepEqual([journal(combatId), resources(defender), requestOf(combatId)], untouched);
  assert.deepEqual(await applyDamage(combatId, {amount: 12}, defender), {combatId, damageApplied: {amount: 12}});
  assert.equal(resources(defender).stats.hpCurrent, 88);
  assert.deepEqual(requestOf(combatId).ownerDamage.target.damageApplied, {amount: 12});

  // The DM keeps any whole amount from 0 up, and the owner's later confirmation gets that receipt.
  const lowered = await weaponHit();
  assert.deepEqual(await applyDamage(lowered, {amount: 2}), {combatId: lowered, damageApplied: {amount: 2}});
  assert.deepEqual(await applyDamage(lowered, {amount: 0}, defender), {combatId: lowered, damageApplied: {amount: 2}});
  assert.equal(resources(defender).stats.hpCurrent, 86);

  // A rolled critical is the minimum, even when the owner sends the base the hit proposed before it.
  const blow = await weaponHit();
  const {critical} = await confirmCritical(blow, 13);
  assert.equal(critical.total, 12);
  await assert.rejects(applyDamage(blow, {amount: 9, criticalScore: 13}, defender), {
    code: 'permission-denied', message: 'Il danno non può essere inferiore a 12: solo il DM può ridurlo.',
  });
  // A critical the owner did not see is reported before the minimum.
  await assert.rejects(applyDamage(blow, {amount: 0}, defender), {code: 'failed-precondition', message: /critico è cambiato/});
  assert.deepEqual(await applyDamage(blow, {amount: 12, criticalScore: 13}, defender),
    {combatId: blow, damageApplied: {amount: 12}});
});

test('a critical left to the table is applied by the DM, never confirmed by the owner', async () => {
  damageFixture();
  const tableBlade = {...greatsword, Parametri: {Special: {Danno: {4: '2d4'}, 'Danno Critico': {4: '2d6 + Forza'}}}};
  db.seed(`users/${attacker}/inventory/item-weaponMain`, {currentSnapshot: tableBlade});
  const combatId = await weaponHit();
  const {critical} = await confirmCritical(combatId, 13);
  assert.match(critical.tableRoll, /2d6 \+ Forza/);
  assert.deepEqual(requestOf(combatId).ownerDamage.target.critical, critical);
  const untouched = structuredClone([journal(combatId), resources(defender), requestOf(combatId)]);
  for (const amount of [0, 9, 99]) {
    await assert.rejects(applyDamage(combatId, {amount, criticalScore: 13}, defender), {
      code: 'permission-denied', message: 'Il critico va calcolato al tavolo: il danno lo applica il DM.',
    });
  }
  assert.deepEqual([journal(combatId), resources(defender), requestOf(combatId)], untouched);
  const receipt = await applyDamage(combatId, {amount: 5, criticalScore: 13});
  assert.deepEqual(receipt, {combatId, damageApplied: {amount: 5}});
  assert.deepEqual(await applyDamage(combatId, {amount: 0, criticalScore: 13}, defender), receipt);
  assert.deepEqual([requestOf(combatId).status, requestOf(combatId).ownerDamage.target.damageApplied], ['done', {amount: 5}]);
});

test('typed defense values mark their trial without copying private defaults to the journal', async () => {
  fixture();
  const trialsOf = combatId => journal(combatId).targets[0].trials;
  const untouched = await launch('weapon', 'weaponMain');
  assert.deepEqual([request(untouched.combatId).defense.value, request(untouched.combatId).defense.reduction,
    request(untouched.combatId).defense.die], [2, 2, 12]);
  // Sending the defaults themselves changes nothing either.
  const reply = await defend(untouched.combatId, {defense: 2, reduction: 2, die: 12});
  assert.equal(reply.outcome, 'hit');
  assert.deepEqual(Object.keys(trialsOf(untouched.combatId)[0]), ['round', 'attack', 'defense', 'outcome', 'damage']);

  // The server compares what it rolled with what it stored, and the defender's reply stays as it was.
  const dodged = await launch('weapon', 'weaponMain');
  const answer = await defend(dodged.combatId, {defense: 90, reduction: 0, die: 20});
  assert.deepEqual([answer.outcome, answer.overrides], ['resisted', undefined]);
  assert.deepEqual(Object.keys(trialsOf(dodged.combatId)[0]), ['round', 'attack', 'defense', 'outcome', 'damage', 'defenseAdjusted']);
  assert.equal(trialsOf(dodged.combatId)[0].defenseAdjusted, true);
  assert.deepEqual(await defend(dodged.combatId, {defense: 2}), answer);
  assert.deepEqual(trialsOf(dodged.combatId).length, 1);

  // Each round keeps its own: a tie forced with a typed bonus, then an untouched retry.
  const tied = await launch('weapon', 'weaponMain');
  assert.equal((await defend(tied.combatId, {defense: 4})).outcome, 'tie');
  await call(attacker, {command: 'retry', combatId: tied.combatId, round: 1, targetPlacementId: place(defender)});
  assert.equal((await defend(tied.combatId, {round: 2})).outcome, 'hit');
  const [tie, decisive] = trialsOf(tied.combatId);
  assert.equal(tie.defenseAdjusted, true);
  assert.equal('defenseAdjusted' in decisive, false);

  // A spell defense without RD audits only what it asked for; a consent has nothing to audit.
  seedSpell('barrier', {
    Nome: 'Barriera Cosmica (offensiva)', Costo: 19, Gittata: '30 ft',
    'TPC Fisico': {Param1: 'Intelligenza', Param2: 'Saggezza', ParamTarget: 'Costituzione'},
  });
  const spell = await launch('spell', 'personal:barrier');
  await defend(spell.combatId, {defense: 3, reduction: 50});
  assert.equal(trialsOf(spell.combatId)[0].defenseAdjusted, true);
  seedSpell('pact', {Nome: 'Patto', Costo: 1, danni: '1d8', Cura: '1d4', combat: {targetConsent: true}});
  for (const consent of [true, false]) {
    const pact = await launch('spell', 'personal:pact');
    await defend(pact.combatId, {consent, defense: 50});
    assert.equal('defenseAdjusted' in trialsOf(pact.combatId)[0], false);
  }
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
  const transferred = await applyDamage(combatId, {amount: 9}, defender).catch(error => error);
  await assert.rejects(applyDamage(combatId, {}, 'stranger'), denied);
  db.remove(placementPath);
  db.seed(tokenPath, token);
  const removed = await applyDamage(combatId, {amount: 9}, defender).catch(error => error);
  for (const error of [transferred, removed]) {
    assert.deepEqual([error.code, error.message], [absentPawn.code, absentPawn.message]);
  }
  assert.deepEqual([resources(defender), journal(combatId), requestOf(combatId)], untouched);

  db.seed(placementPath, hidden);
  assert.deepEqual(await applyDamage(combatId, {amount: 9}, defender), {combatId, damageApplied: {amount: 9}});
  assert.equal(resources(defender).stats.hpCurrent, 91);
  assert.deepEqual(requestOf(combatId).ownerDamage.target.damageApplied, {amount: 9});
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
  assert.deepEqual(await applyDamage(shared, {amount: 2}, defender), {combatId: shared, damageApplied: {amount: 2}});
  assert.equal(request(shared), undefined);

  // A defense answered before projections existed gains one when its damage is applied.
  const answered = await weaponHit();
  const {ownerDamage, ownerDamageUpdatedAt, ...older} = requestOf(answered);
  assert.ok(ownerDamage && ownerDamageUpdatedAt);
  db.seed(`grigliata_combat_requests/${hashValue([answered, place(defender)])}`, older);
  await applyDamage(answered, {amount: 9}, defender);
  assert.deepEqual(requestOf(answered), {...older, ...projection(answered, {damageApplied: {amount: 9}})});

  const broken = await bolt(event => ({...event, targets: null}));
  await assert.rejects(applyDamage(broken, {}, defender), denied);
  await assert.rejects(applyDamage(broken), {code: 'failed-precondition', message: /non fa parte/});
  const ownerless = await bolt(event => ({...event, targets: event.targets.map(({ownerUid, ...target}) => target)}));
  await assert.rejects(applyDamage(ownerless, {}, defender), denied);
  const effectless = await bolt(event => ({...event, effects: null}));
  await assert.rejects(applyDamage(effectless, {}, defender), {code: 'failed-precondition', message: /danno concreto/});
  assert.equal(resources(defender).stats.hpCurrent, 100 - 2 - 2 - 2 - 9);
});

// Guided mode: damage with dice waits for the actor's throw (rollDamage).
// Each roll takes the next face; a roll beyond them fails the test, so a replay that rolls is caught.
// The fixture's defender is unarmed, so a greatsword attack rolls twice (advantage).
const faces = (...values) => {
  dice = () => (values.length ? values.shift() : assert.fail('unexpected roll'));
};
const guided = (kind, actionId, options = {}) => launch(kind, actionId, {rollMode: 'guided', ...options});
const rollDamage = (combatId, options = {}, uid = attacker) => call(uid, {
  command: 'rollDamage', combatId, targetPlacementId: place(defender), round: 1, ...options,
});
const die = (sides, value) => ({sides, value});

const cancel = (combatId, uid = attacker) => call(uid, {command: 'cancel', combatId});
const cancellationDetails = (combatId, uid = dm) => call(uid, {command: 'getCancellationDetails', combatId});
const privateReceiptPath = combatId => `grigliata_combat_receipts/${combatId}`;

const damageOneOfTwoTargets = async (token = defender) => {
  seedElf();
  seedSpell('volley', {Nome: 'Raffica', Costo: 0, combat: {mode: 'multiple', targetCount: 2, damageExpr: '4'}});
  const {combatId} = await launch('spell', 'personal:volley', {targetPlacementIds: [place(token), place('elf')]});
  await applyDamage(combatId, {targetPlacementId: place(token), amount: 2});
  return combatId;
};

const spendHomeMana = () => updateDefenderResource({resource: 'mana', mode: 'delta', value: -3});
const updateDefenderResource = data => task05UpdateResource.run({
  auth: {uid: defender}, data: {operationId: `resource-test-${++operations}`, ...data},
});

for (const tokenType of ['character', 'foe']) {
  test(`cancellation restores a ${tokenType}'s barrier after it pays only PM for another spell`, async () => {
    damageFixture();
    const spell = {Nome: 'Dardo Cosmico', Costo: 3};
    if (tokenType === 'character') {
      seedStats(defender, {barrieraCurrent: 5, barrieraTotal: 5});
      db.seed(`users/${defender}/spells/bolt`, spell);
    } else {
      seedPawn(defender, 1, {tokenType, Parametri: parametri, dadoAnima: 'd12',
        stats: {...stats, shieldCurrent: 5, shieldTotal: 5}, spells: [spell]}, dm);
    }
    const combatId = await damageOneOfTwoTargets();
    seedTurn(defender);
    const uid = tokenType === 'character' ? defender : dm;
    const actorPlacementId = place(defender);
    const {actions} = await getGrigliataCombatArsenal.run({auth: {uid}, data: {backgroundId: board, actorPlacementId}});
    const bolt = actions.find(({name}) => name === spell.Nome);
    assert.ok(bolt);
    const {combatId: boltId} = await call(uid, {
      command: 'launch', operationId: `combat-test-${++operations}`, backgroundId: board,
      actorPlacementId, targetPlacementIds: [place(attacker)], kind: 'spell', actionId: bolt.id,
    });
    assert.deepEqual(journal(boltId).cost, {hp: 0, mana: 3, essenza: 0, extra: null});
    assert.deepEqual((await cancel(combatId)).cancellation, {needsReview: false});
    const balances = tokenType === 'character' ? resources(defender).stats : db.read(`grigliata_tokens/${defender}`).stats;
    assert.equal(balances[tokenType === 'character' ? 'barrieraCurrent' : 'shieldCurrent'], 5);
    assert.equal(balances.manaCurrent, 97);
  });
}

test('a Home mana spend preserves the continuity of a legacy barrier', async () => {
  damageFixture();
  seedStats(defender, {barriera: 5});
  const combatId = await damageOneOfTwoTargets();
  const damagePath = `${privateReceiptPath(combatId)}/damage/${place(defender)}`;
  const {shieldActivation, ...legacyReceipt} = db.read(damagePath);
  db.seed(damagePath, legacyReceipt);
  await spendHomeMana();
  assert.deepEqual((await cancel(combatId)).cancellation, {needsReview: false});
  assert.deepEqual(resources(defender).stats, {...stats, manaCurrent: 97, barriera: 5, barrieraCurrent: 5});
});

test('a PM potion keeps its gain when cancelling a pending character barrier hit', async () => {
  damageFixture();
  seedStats(defender, {manaCurrent: 99, manaTotal: 100, barrieraCurrent: 5, barrieraTotal: 5});
  const combatId = await damageOneOfTwoTargets();
  const inventoryId = 'potion';
  db.seed(`users/${defender}/inventory/${inventoryId}`, {
    quantity: 2,
    currentSnapshot: {
      type: 'consumabile', Parametri: {Special: {'Rigenera Dado Anima Mana': {4: 1}}},
    },
  });
  const {preparationId} = await task05PrepareConsumable.run({auth: {uid: defender}, data: {
    operationId: `resource-test-${++operations}`, inventoryId, resource: 'mana',
  }});
  const potion = await task05CommitConsumable.run({auth: {uid: defender}, data: {
    operationId: `resource-test-${++operations}`, preparationId,
  }});
  assert.equal(potion.resourceValue, 100);
  assert.deepEqual((await cancel(combatId)).cancellation, {needsReview: false});
  assert.deepEqual(resources(defender).stats, {...stats, manaTotal: 100, barrieraCurrent: 5, barrieraTotal: 5});
});

test('the DM gold adjustment survives a character barrier refund', async () => {
  damageFixture();
  seedStats(defender, {gold: 10, barrieraCurrent: 5, barrieraTotal: 5});
  const combatId = await damageOneOfTwoTargets();
  const gold = await task05AdjustGold.run({auth: {uid: dm}, data: {
    operationId: `resource-test-${++operations}`, userId: defender, delta: 2,
  }});
  assert.equal(gold.newGold, 12);
  assert.deepEqual((await cancel(combatId)).cancellation, {needsReview: false});
  assert.deepEqual(resources(defender).stats, {...stats, gold: 12, barrieraCurrent: 5, barrieraTotal: 5});
});

const editGrigliataDefender = (changes, tokenPatch) => task05UpdateGrigliataCharacterResources.run({
  auth: {uid: defender}, data: {
    operationId: `resource-test-${++operations}`, backgroundId: board, tokenId: defender,
    resources: changes, tokenPatch,
  },
});

test('editing only PM in Grigliata preserves the barrier refund', async () => {
  damageFixture();
  seedStats(defender, {barrieraCurrent: 5, barrieraTotal: 5});
  const combatId = await damageOneOfTwoTargets();
  await editGrigliataDefender({manaCurrent: 97}, {notes: 'A note'});
  assert.deepEqual((await cancel(combatId)).cancellation, {needsReview: false});
  assert.deepEqual(resources(defender).stats, {...stats, manaCurrent: 97, barrieraCurrent: 5, barrieraTotal: 5});
});

test('an explicit Grigliata barrier edit breaks continuity even at the same value', async () => {
  damageFixture();
  seedStats(defender, {barrieraCurrent: 5, barrieraTotal: 5});
  const combatId = await damageOneOfTwoTargets();
  await editGrigliataDefender({barrieraCurrent: 3}, {});
  await editGrigliataDefender({manaCurrent: 97}, {});
  assert.deepEqual((await cancel(combatId)).cancellation, {needsReview: true});
  assert.deepEqual(resources(defender).stats, {...stats, manaCurrent: 97, barrieraCurrent: 3, barrieraTotal: 5});
});

for (const endBarrier of ['reset', 'expiry']) {
  test(`cancellation leaves an identical reactivation alone after barrier ${endBarrier}`, async () => {
    damageFixture();
    const setBarrier = (value, turns, totalValue = value) => updateDefenderResource({
      resource: 'barriera', mode: 'set', value, totalValue, remainingTurns: turns, totalTurns: turns,
    });
    await setBarrier(5, 1);
    const combatId = await damageOneOfTwoTargets();
    const damaged = resources(defender).stats;
    if (endBarrier === 'reset') {
      await setBarrier(0, 0);
    } else {
      await task05ConsumeTurnEffects.run({auth: {uid: dm},
        data: {userId: defender, operationId: `resource-test-${++operations}`}});
    }
    assert.equal(resources(defender).stats.barrieraTotal, 0);
    await setBarrier(3, 1, 5);
    assert.deepEqual(resources(defender).stats, damaged);
    await spendHomeMana();
    assert.deepEqual((await cancel(combatId)).cancellation, {needsReview: true});
    assert.deepEqual(resources(defender).stats, {...damaged, manaCurrent: 97});
  });
}

test('cancelling one hit keeps a later hit on the same barrier refundable', async () => {
  damageFixture();
  seedStats(defender, {barrieraCurrent: 5, barrieraTotal: 5});
  const first = await damageOneOfTwoTargets();
  const second = await damageOneOfTwoTargets();
  assert.equal(resources(defender).stats.barrieraCurrent, 1);
  assert.deepEqual((await cancel(first)).cancellation, {needsReview: false});
  assert.equal(resources(defender).stats.barrieraCurrent, 3);
  assert.deepEqual((await cancel(second)).cancellation, {needsReview: false});
  assert.equal(resources(defender).stats.barrieraCurrent, 5);
});

test('a later combat write cannot vouch for a replaced token shield', async () => {
  damageFixture();
  const path = `grigliata_tokens/${defender}`;
  seedPawn(defender, 1, {tokenType: 'custom', stats: {...stats, shieldCurrent: 5, shieldTotal: 5}});
  const first = await damageOneOfTwoTargets();
  const damaged = db.read(path);
  const replacement = {...damaged};
  delete replacement.combatShieldActivation;
  db.seed(path, {...replacement, stats: {...replacement.stats, shieldCurrent: 0, shieldTotal: 0}});
  db.seed(path, replacement);
  const second = await damageOneOfTwoTargets();
  assert.notEqual(db.read(path).combatShieldActivation, damaged.combatShieldActivation);
  assert.deepEqual((await cancel(first)).cancellation, {needsReview: true});
  assert.equal(db.read(path).stats.shieldCurrent, 1);
  assert.deepEqual((await cancel(second)).cancellation, {needsReview: false});
  assert.equal(db.read(path).stats.shieldCurrent, 3);
});

test('a non-expiring turn preserves continuity even when it changes the barrier timer', async () => {
  damageFixture();
  await updateDefenderResource({resource: 'barriera', mode: 'set', value: 5, totalValue: 5, remainingTurns: 2, totalTurns: 2});
  const combatId = await damageOneOfTwoTargets();
  await task05ConsumeTurnEffects.run({auth: {uid: dm},
    data: {userId: defender, operationId: `resource-test-${++operations}`}});
  assert.deepEqual((await cancel(combatId)).cancellation, {needsReview: false});
  assert.equal(resources(defender).stats.barrieraCurrent, 5);
  assert.equal(resources(defender).active_turn_effect.barriera.remainingTurns, 1);
});

test('zero damage awaits confirmation and cancellation blocks every previously returned reply', async () => {
  damageFixture();
  seedSpell('zero', {Nome: 'Zero', Costo: 3, combat: {damageExpr: '1d4 - 1'}});
  const operationId = 'cancel-guided-zero';
  const launchZero = () => guided('spell', 'personal:zero', {operationId});
  const {combatId} = await launchZero();
  assert.equal(journal(combatId).status, 'awaitingDamage');
  assert.equal((await rollDamage(combatId)).damage, 0);
  assert.deepEqual([journal(combatId).status, journal(combatId).resolvedAt], ['awaitingConfirmation', null]);
  assert.deepEqual(await cancel(combatId), {combatId, status: 'cancelled', cancellation: {needsReview: false}});
  assert.equal(resources(attacker).stats.manaCurrent, 100);
  assert.deepEqual(requestOf(combatId), {
    combatId, backgroundId: board, ownerUid: defender, status: 'cancelled', createdAt: 'now', updatedAt: 'now',
  });
  const cancelled = {code: 'failed-precondition', message: /annullata/};
  await assert.rejects(launchZero, cancelled);
  await assert.rejects(rollDamage(combatId), cancelled);
  await assert.rejects(applyDamage(combatId, {amount: 0}, defender), cancelled);

  const weapon = await weaponHit();
  assert.equal(journal(weapon).status, 'awaitingConfirmation');
  await confirmCritical(weapon, 13);
  await cancel(weapon, dm);
  await assert.rejects(defend(weapon), cancelled);
  await assert.rejects(confirmCritical(weapon, 13), cancelled);
  const tied = await launch('weapon', 'weaponMain');
  await defend(tied.combatId, {defense: 4});
  const retry = () => call(attacker, {command: 'retry', combatId: tied.combatId, targetPlacementId: place(defender), round: 1});
  await retry();
  await cancel(tied.combatId);
  await assert.rejects(retry, cancelled);
});

test('cancellation rebases and aggregates real cost and self damage, even after changing maps and retrying', async () => {
  damageFixture();
  seedElf();
  seedStats(attacker, {hpCurrent: 10, manaCurrent: 2, essenzaCurrent: 5, barrieraCurrent: 3, barrieraTotal: 6});
  seedSpell('volley', {Nome: 'Raffica', Costo: 5, combat: {
    mode: 'multiple', targetCount: 2, allowSelf: true, damageExpr: '7', extraResource: {name: 'Essenza', amount: 2},
  }});
  const {combatId} = await launch('spell', 'personal:volley', {
    targetPlacementIds: [place(attacker), place('elf')], confirmHp: true, maxHpCost: 3, confirmExtra: true,
  });
  assert.equal(journal(combatId).status, 'awaitingConfirmation');
  assert.deepEqual(journal(combatId).cost, {hp: 3, mana: 2, essenza: 2, extra: {name: 'Essenza', amount: 2}});
  assert.deepEqual(db.read(privateReceiptPath(combatId)).cost.amounts, {hpCurrent: 3, manaCurrent: 2, essenzaCurrent: 2});
  await applyDamage(combatId, {targetPlacementId: place(attacker), amount: 20});
  assert.deepEqual(db.read(`${privateReceiptPath(combatId)}/damage/${place(attacker)}`).amounts,
    {hpCurrent: 7, barrieraCurrent: 3});
  assert.deepEqual(resources(attacker).stats, {hpCurrent: 0, manaCurrent: 0, essenzaCurrent: 3, barrieraCurrent: 0, barrieraTotal: 6});
  assert.equal(journal(combatId).status, 'awaitingConfirmation');
  seedStats(attacker, {hpCurrent: 1, manaCurrent: 3, essenzaCurrent: 6, barrieraCurrent: 1, barrieraTotal: 6});
  db.remove(`grigliata_token_placements/${place(attacker)}`);
  db.remove(`grigliata_tokens/${attacker}`);
  db.seed('grigliata_state/current', {activeBackgroundId: 'another-map'});
  const resourcePath = `users/${attacker}/state/resources`;
  const oldWrites = db.writes.length;
  db.abortNext();
  const receipt = await cancel(combatId, dm);
  assert.deepEqual(receipt.cancellation, {needsReview: true});
  assert.deepEqual(resources(attacker).stats, {hpCurrent: 11, manaCurrent: 5, essenzaCurrent: 8, barrieraCurrent: 1, barrieraTotal: 6});
  assert.deepEqual((await cancellationDetails(combatId)).corrections.map(item => [item.reason, item.amounts]),
    [['barrierAmbiguous', {barrieraCurrent: 3}]]);
  assert.equal(db.writes.slice(oldWrites).filter(path => path === resourcePath).length, 1);
  assert.equal(requestOf(combatId, attacker).status, 'cancelled');
  assert.equal(requestOf(combatId, 'elf').status, 'cancelled');
  await assert.rejects(applyDamage(combatId, {targetPlacementId: place(attacker), amount: 20}), {code: 'failed-precondition'});
  const totalWrites = db.writes.length;
  assert.deepEqual(await cancel(combatId), receipt);
  assert.equal(db.writes.length, totalWrites);
});

test('private legacy cancellation refunds proven costs and sends unresolved corrections only to the DM', async () => {
  damageFixture();
  seedElf();
  db.seed('users/stranger', {role: 'player'});
  seedSpell('volley', {Nome: 'Raffica', Costo: 3, combat: {mode: 'multiple', targetCount: 2, damageExpr: '5'}});
  const {combatId} = await launch('spell', 'personal:volley', {targetPlacementIds: [place(defender), place('elf')]});
  await applyDamage(combatId, {amount: 7});
  const path = `grigliata_combat_actions/${combatId}`;
  db.seed(path, {...journal(combatId), shared: false, status: 'done', cost: {hp: 0, mana: 3, essenza: 0}});
  db.remove(privateReceiptPath(combatId));
  db.remove(`${privateReceiptPath(combatId)}/damage/${place(defender)}`);
  const staleRequestPath = `grigliata_combat_requests/${hashValue([combatId, place(defender)])}`;
  db.seed(staleRequestPath, {combatId, backgroundId: board, ownerUid: defender, status: 'waiting', defense: {value: 5}});
  for (const uid of [defender, 'stranger']) await assert.rejects(cancel(combatId, uid), {code: 'not-found'});
  assert.deepEqual((await cancel(combatId, dm)).cancellation, {needsReview: true});
  assert.equal(resources(attacker).stats.manaCurrent, 100);
  assert.equal(resources(defender).stats.hpCurrent, 93);
  assert.equal(db.read(staleRequestPath).status, 'cancelled');
  assert.equal(db.read(staleRequestPath).defense, undefined);
  assert.deepEqual(journal(combatId).cancellation, {needsReview: true});
  for (const uid of [attacker, defender, 'stranger']) {
    await assert.rejects(cancellationDetails(combatId, uid), {code: 'permission-denied'});
  }
  assert.deepEqual((await cancellationDetails(combatId)).corrections.map(item => item.reason), ['legacyDamageUnknown']);
});

test('cancellation restores a proven token shield up to its maximum, and leaves removed or replaced shields alone', async () => {
  for (const scenario of ['same', 'over-cap', 'removed', 'recreated', 'new-token']) {
    damageFixture();
    seedPawn('custom', 2, {tokenType: 'custom', stats: {hpCurrent: 8, shieldCurrent: 3, shieldTotal: scenario === 'over-cap' ? 2 : 3}});
    seedSpell('volley', {Nome: 'Raffica', Costo: 0, combat: {mode: 'multiple', targetCount: 2, damageExpr: '4'}});
    const {combatId} = await launch('spell', 'personal:volley', {targetPlacementIds: [place('custom'), place(defender)]});
    await applyDamage(combatId, {targetPlacementId: place('custom'), amount: 5});
    const path = 'grigliata_tokens/custom';
    const injured = db.read(path);
    db.remove(`grigliata_token_placements/${place('custom')}`);
    if (scenario === 'removed' || scenario === 'recreated') {
      const replacement = {...injured};
      delete replacement.combatShieldActivation;
      db.seed(path, {...replacement, stats: {...replacement.stats, shieldTotal: 0}});
      if (scenario === 'recreated') db.seed(path, replacement);
    }
    if (scenario === 'new-token') {
      db.remove(path);
      db.seed(path, injured);
    }
    await cancel(combatId);
    assert.equal(db.read(path).stats.hpCurrent, scenario === 'new-token' ? 6 : 8, scenario);
    assert.equal(db.read(path).stats.shieldCurrent, {same: 3, 'over-cap': 2}[scenario] ?? 0, scenario);
    const {corrections} = await cancellationDetails(combatId);
    const reason = {removed: 'barrierUnavailable', recreated: 'barrierAmbiguous',
      'new-token': 'entityUnavailable', 'over-cap': 'barrierCapacity'}[scenario];
    assert.deepEqual(corrections.map(item => item.reason), reason ? [reason] : [], scenario);
  }
});

test('the last confirmation closes combat including legacy events, and closed actions stay closed', async () => {
  damageFixture();
  const combatId = await weaponHit();
  const path = `grigliata_combat_actions/${combatId}`;
  db.seed(path, {...journal(combatId), status: 'done'});
  await applyDamage(combatId, {amount: 0});
  assert.deepEqual([journal(combatId).status, journal(combatId).resolvedAt], ['done', 'now']);
  await assert.rejects(cancel(combatId), {code: 'failed-precondition'});
  assert.equal(journal(combatId).status, 'done');
});

const seedElf = () => {
  seedPawn('elf', 2);
  db.seed('users/elf', {role: 'player'});
  seedStats('elf', {});
};
// Answers the same as before, and writes nothing.
const replays = async (command, expected) => {
  faces();
  const before = structuredClone([db.writes.length, journal(expected.combatId)]);
  assert.deepEqual(await command(), expected);
  assert.deepEqual([db.writes.length, journal(expected.combatId)], before);
};
// A guided journal once thrown, read as the journal an immediate launch of the same faces writes.
const asImmediate = combatId => {
  const {rollMode, requestHash, pendingDamage, damageRoll, action: {criticalHasDice, ...action}, targets, ...entry} =
    journal(combatId);
  assert.deepEqual([rollMode, typeof criticalHasDice, pendingDamage ?? null], ['guided', 'boolean', null]);
  return {...entry, action, targets: targets.map(({damageRoll: _thrown, ...target}) => target)};
};
const immediateEntry = combatId => {
  const {requestHash, ...entry} = journal(combatId);
  return entry;
};
// The owner's copy of a guided throw, as the immediate one. An answered defense also says the throw is no
// longer owed, and reopens for confirmation.
const sameRequest = (guidedId, immediateId, token = defender) => {
  const {damagePending, ...copy} = requestOf(guidedId, token);
  const answered = Boolean(requestOf(immediateId, token).defense);
  assert.equal(damagePending, answered ? false : undefined);
  assert.deepEqual({...copy, combatId: immediateId, ...(answered && {status: 'done'})}, requestOf(immediateId, token));
};

test('without a roll mode a launch journals as before; its replies gain only the faces it rolled', async () => {
  damageFixture();
  faces(7, 2);
  const legacy = await launch('weapon', 'weaponMain');
  const operationId = `combat-test-${operations}`;
  // Both faces of the advantage, in the order rolled.
  assert.deepEqual(legacy, {
    combatId: legacy.combatId, rolls: [die(12, 7), die(12, 2)], resources: {hp: 100, mana: 100, essenza: null},
  });
  const entry = journal(legacy.combatId);
  for (const key of ['rollMode', 'pendingDamage', 'damageRoll']) assert.equal(key in entry, false, key);
  assert.equal('criticalHasDice' in entry.action, false);
  assert.equal('pendingDamage' in entry.targets[0], false);
  assert.equal((await arsenal()).actions.some(action => 'criticalHasDice' in action), false);
  // A retry answers from the receipt with the same faces.
  await replays(() => launch('weapon', 'weaponMain', {operationId}), {combatId: legacy.combatId, rolls: [die(12, 7), die(12, 2)]});
  const writes = db.writes.length;
  for (const rollMode of ['auto', 'GUIDED', '', null, true, 1]) {
    await assert.rejects(launch('weapon', 'weaponMain', {rollMode}), {
      code: 'invalid-argument', message: 'La modalità di tiro non è valida.',
    });
  }
  assert.equal(db.writes.length, writes);

  // The hit rolls its damage inside the answer as before; nothing waits, and there is nothing to throw.
  faces(1, 4, 3);
  const hit = await defend(legacy.combatId);
  assert.deepEqual([hit.damage, 'damagePending' in hit], [17, false]);
  assert.deepEqual([requestOf(legacy.combatId).status, 'damagePending' in requestOf(legacy.combatId)], ['done', false]);
  await assert.rejects(rollDamage(legacy.combatId), {code: 'failed-precondition', message: /Non c'è un danno da tirare/});
  // Its critical keeps the earlier shape: no faces stored, none returned.
  faces(5, 2);
  const critical = await confirmCritical(legacy.combatId, 13);
  assert.deepEqual(Object.keys(critical), ['combatId', 'critical']);
  assert.equal('rolls' in journal(legacy.combatId).targets[0].critical, false);
  assert.equal('rolls' in requestOf(legacy.combatId).ownerDamage.target.critical, false);

  // The roll mode is no part of the launch identity: a guided launch stores the hash of the same fields without it.
  faces(1, 1);
  const thrown = await guided('weapon', 'weaponMain');
  assert.equal(journal(thrown.combatId).requestHash, hashValue({
    backgroundId: board, actorPlacementId: place(attacker), actionId: 'weaponMain', kind: 'weapon',
    channel: '', point: null, ids: [place(defender)],
    approval: {confirmHp: false, maxHpCost: undefined, confirmExtra: false, variableCost: undefined},
  }));
  assert.equal(journal(thrown.combatId).rollMode, 'guided');
});

test('the first committed launch decides the roll mode: a retry with the other mode replays it, paid once', async () => {
  damageFixture();
  seedSpell('bolt', {Nome: 'Saetta', Costo: 3, combat: {damageExpr: '2d4', attackDie: true}});
  // Paid and resolved before the upgrade: its attack, then its damage, at launch.
  faces(9, 2, 3);
  const paid = await launch('spell', 'personal:bolt');
  const operationId = `combat-test-${operations}`;
  assert.deepEqual(paid, {combatId: paid.combatId, rolls: [die(12, 9)], resources: {hp: 100, mana: 97, essenza: null}});
  const untouched = structuredClone([journal(paid.combatId), resources(attacker), db.writes.length]);
  // Retried by a client that now asks for guided mode: the original faces, no cost, no write, still immediate.
  faces();
  assert.deepEqual(await guided('spell', 'personal:bolt', {operationId}), {combatId: paid.combatId, rolls: [die(12, 9)]});
  assert.deepEqual([journal(paid.combatId), resources(attacker), db.writes.length], untouched);
  const [entry] = untouched;
  assert.deepEqual(['rollMode' in entry, 'pendingDamage' in entry.targets[0], entry.effects.map(({kind, amount}) => [kind, amount])],
    [false, false, [['damage', 5]]]);

  // The reverse: a guided launch retried without the mode keeps its mode and its waiting damage.
  faces(4);
  const thrown = await guided('spell', 'personal:bolt');
  const guidedOperation = `combat-test-${operations}`;
  assert.deepEqual([thrown.rolls, thrown.resources.mana], [[die(12, 4)], 94]);
  const waiting = structuredClone([journal(thrown.combatId), resources(attacker), db.writes.length]);
  faces();
  assert.deepEqual(await launch('spell', 'personal:bolt', {operationId: guidedOperation}), {
    combatId: thrown.combatId, rolls: [die(12, 4)],
  });
  assert.deepEqual([journal(thrown.combatId), resources(attacker), db.writes.length], waiting);
  assert.deepEqual([waiting[0].rollMode, waiting[0].targets[0].pendingDamage.expr], ['guided', '2d4']);

  // Any substantive difference is another action, whatever the mode.
  for (const id of [operationId, guidedOperation]) {
    for (const mode of [{}, {rollMode: 'guided'}]) {
      for (const change of [{targetPlacementIds: [place(attacker)]}, {channel: 'Mentale'}, {confirmHp: true},
        {actionVersion: 'other'}]) {
        await assert.rejects(launch('spell', 'personal:bolt', {operationId: id, ...mode, ...change}), {code: 'already-exists'});
      }
    }
  }
  assert.deepEqual([resources(attacker), db.writes.length], [waiting[1], waiting[2]]);
});

test('a guided immediate action waits for one throw per target; each lands as an immediate roll would', async () => {
  damageFixture();
  seedElf();
  seedStats(defender, {barrieraCurrent: 3});
  seedSpell('volley', {
    Nome: 'Raffica', Costo: 1, Cura: '1d4', combat: {mode: 'multiple', targetCount: 2, damageExpr: '2d4'},
  });
  const both = {targetPlacementIds: [place(defender), place('elf')]};
  // Immediate: each target's damage, then its cure, all at launch.
  faces(4, 1, 2, 2, 2, 3);
  const immediate = await launch('spell', 'personal:volley', both);
  // Guided: the cures at once, and no attack die means no faces.
  faces(2, 3);
  const launched = await guided('spell', 'personal:volley', both);
  const {combatId} = launched;
  assert.deepEqual(launched, {combatId, rolls: [], resources: {hp: 100, mana: 98, essenza: null}});
  const cure = (amount, token) => ({
    kind: 'heal', label: 'Cura proposta', expr: '1d4', amount, targetPlacementId: place(token),
  });
  const pendingDamage = {round: 1, kind: 'effect', label: 'Danno proposto', expr: '2d4'};
  const launchedEntry = journal(combatId);
  assert.deepEqual([launchedEntry.status, launchedEntry.resolvedAt, launchedEntry.action.criticalHasDice],
    ['awaitingDamage', null, false]);
  assert.deepEqual(launchedEntry.effects, [cure(2, defender), cure(3, 'elf')]);
  for (const target of launchedEntry.targets) {
    assert.deepEqual([target.status, target.outcome, target.damage, target.pendingDamage],
      ['done', 'applied', null, pendingDamage]);
  }
  // Nothing to confirm yet: no copy for either owner, and nothing to apply.
  assert.equal(request(combatId), undefined);
  await assert.rejects(applyDamage(combatId), {code: 'failed-precondition', message: /danno concreto/});
  await assert.rejects(applyDamage(combatId, {amount: 9}, defender), {code: 'failed-precondition', message: /danno concreto/});

  // The throw needs no active map and reads no board, placement or token.
  db.seed('grigliata_state/current', {activeBackgroundId: 'elsewhere'});
  const readsBefore = db.reads.length;
  faces(4, 1);
  const thrown = await rollDamage(combatId);
  const landed = (amount, token) => ({
    kind: 'damage', label: 'Danno proposto', expr: '2d4', amount, targetPlacementId: place(token),
  });
  // The damage takes its immediate place, before the target's cure.
  assert.deepEqual(thrown, {
    combatId, targetPlacementId: place(defender), round: 1, damage: 5, rolls: [die(4, 4), die(4, 1)],
    effects: [landed(5, defender), cure(2, defender)], damageDetails: null,
  });
  assert.deepEqual(db.reads.slice(readsBefore).map(({path}) => path.split('/')[0]),
    ['users', 'user_deletion_jobs', 'grigliata_combat_actions', 'grigliata_combat_requests']);
  const thrownEntry = journal(combatId);
  // The other target still waits for its own throw.
  assert.deepEqual([thrownEntry.status, thrownEntry.resolvedAt], ['awaitingDamage', null]);
  const {pendingDamage: _waited, ...settled} = launchedEntry.targets[0];
  assert.deepEqual(thrownEntry.targets, [{...settled, damageRoll: {
    ...pendingDamage, rolls: thrown.rolls, raw: 5, total: 5,
  }}, launchedEntry.targets[1]]);
  const spell = {kind: 'spell', action: {name: 'Raffica', hands: 0}, outcome: 'applied'};
  assert.deepEqual(requestOf(combatId), {
    ...projection(combatId, {...spell, damage: 5}), status: 'damagePending', createdAt: 'now',
  });
  assert.equal(requestOf(combatId, 'elf'), undefined);
  await replays(() => rollDamage(combatId), thrown);
  await assert.rejects(applyDamage(combatId, {targetPlacementId: place('elf')}), {
    code: 'failed-precondition', message: /danno concreto/,
  });

  faces(2, 2);
  const elf = await rollDamage(combatId, {targetPlacementId: place('elf')});
  assert.deepEqual([elf.damage, elf.effects], [4, [landed(4, 'elf'), cure(3, 'elf')]]);
  assert.deepEqual([journal(combatId).status, journal(combatId).resolvedAt], ['awaitingConfirmation', null]);
  // Journal and owners' copies are those of the immediate launch with the same faces.
  assert.deepEqual(asImmediate(combatId), immediateEntry(immediate.combatId));
  sameRequest(combatId, immediate.combatId);
  sameRequest(combatId, immediate.combatId, 'elf');
  // Each owner's copy names their own pawn only.
  assert.doesNotMatch(JSON.stringify(requestOf(combatId, 'elf')), /defender|attacker/);

  // The owner confirms at least the thrown damage; the barrier takes it first.
  db.seed('grigliata_state/current', {activeBackgroundId: board});
  await assert.rejects(applyDamage(combatId, {amount: 4}, defender), {code: 'permission-denied'});
  assert.deepEqual(await applyDamage(combatId, {amount: 5}, defender), {combatId, damageApplied: {amount: 5}});
  assert.deepEqual(resources(defender).stats, {hpCurrent: 98, manaCurrent: 100, barrieraCurrent: 0});
  assert.equal(requestOf(combatId).status, 'done');
});

test('the actor or the DM throws; others get the answer critical gives them, and nothing is written', async () => {
  damageFixture();
  db.seed('users/stranger', {role: 'player'});
  seedSpell('dart', {Nome: 'Dardo', Costo: 1, combat: {damageExpr: '2d4'}});
  const shared = await guided('spell', 'personal:dart');
  assert.equal(journal(shared.combatId).shared, true);
  const untouched = structuredClone([db.writes.length, journal(shared.combatId)]);
  faces();
  const refused = {code: 'permission-denied', message: 'Può tirare il danno solo chi controlla l\'attore, o il DM.'};
  // Authority comes first: a valid and an invalid target or round get the same answer.
  for (const uid of ['stranger', defender]) {
    await assert.rejects(rollDamage(shared.combatId, {}, uid), refused);
    await assert.rejects(rollDamage(shared.combatId, {targetPlacementId: place('nobody'), round: 7}, uid), refused);
  }
  const missing = {code: 'not-found', message: 'Combattimento non disponibile.'};
  for (const uid of [attacker, dm, 'stranger']) await assert.rejects(rollDamage('missing', {}, uid), missing);
  for (const options of [{round: 0}, {round: '1'}, {round: 1.5}, {targetPlacementId: undefined},
    {targetPlacementId: 'not/an/id'}]) {
    await assert.rejects(rollDamage(shared.combatId, options), {code: 'invalid-argument'});
  }
  const nothing = {code: 'failed-precondition', message: 'Non c\'è un danno da tirare per questa prova.'};
  await assert.rejects(rollDamage(shared.combatId, {round: 2}), nothing);
  await assert.rejects(rollDamage(shared.combatId, {targetPlacementId: null}), nothing);
  await assert.rejects(rollDamage(shared.combatId, {targetPlacementId: place('nobody')}), {
    code: 'failed-precondition', message: /non fa parte/,
  });
  assert.deepEqual([db.writes.length, journal(shared.combatId)], untouched);

  // The DM may throw for an actor who left: same dice, same stored throw, same replay for the actor.
  faces(2, 4);
  const byDm = await rollDamage(shared.combatId, {}, dm);
  assert.deepEqual([byDm.damage, byDm.rolls], [6, [die(4, 2), die(4, 4)]]);
  assert.deepEqual(journal(shared.combatId).targets[0].damageRoll.rolls, byDm.rolls);
  await replays(() => rollDamage(shared.combatId), byDm);

  // A journal hidden from the others is not even found by them; the DM still throws.
  hideAttacker();
  const hidden = await guided('spell', 'personal:dart');
  assert.equal(journal(hidden.combatId).shared, false);
  faces();
  for (const uid of ['stranger', defender]) {
    await assert.rejects(rollDamage(hidden.combatId, {}, uid), missing);
    await assert.rejects(rollDamage(hidden.combatId, {targetPlacementId: place('nobody'), round: 7}, uid), missing);
  }
  // An attempt that aborts rolls dice nobody sees: what is stored is what the reply shows.
  db.abortNext();
  faces(1, 1, 3, 3);
  const thrown = await rollDamage(hidden.combatId);
  assert.deepEqual([thrown.damage, thrown.rolls], [6, [die(4, 3), die(4, 3)]]);
  assert.deepEqual(journal(hidden.combatId).targets[0].damageRoll.rolls, thrown.rolls);
  assert.equal(journal(hidden.combatId).effects.length, 1);
  // The owner gets the same private copy an immediate roll gives: no actor, no other target.
  assert.deepEqual(requestOf(hidden.combatId), {
    ...projection(hidden.combatId, {kind: 'spell', action: {name: 'Dardo', hands: 0}, outcome: 'applied', damage: 6}),
    status: 'damagePending', createdAt: 'now',
  });
  assert.deepEqual(await applyDamage(hidden.combatId, {amount: 6}, defender), {
    combatId: hidden.combatId, damageApplied: {amount: 6},
  });
  // A thrown damage is not thrown again, whoever asks.
  await assert.rejects(rollDamage(hidden.combatId, {round: 2}, dm), nothing);

  // A legacy journal has nothing to throw.
  faces(1, 1);
  const legacy = await launch('spell', 'personal:dart');
  const writes = db.writes.length;
  await assert.rejects(rollDamage(legacy.combatId), nothing);
  assert.equal(db.writes.length, writes);
});

test('a malformed guided journal is refused with a code, never an internal error', async () => {
  damageFixture();
  seedSpell('dart', {Nome: 'Dardo', Costo: 1, combat: {damageExpr: '2d4'}});
  const broken = async change => {
    const {combatId} = await guided('spell', 'personal:dart');
    const path = `grigliata_combat_actions/${combatId}`;
    db.seed(path, change(structuredClone(db.read(path))));
    return combatId;
  };
  for (const change of [
    event => ({...event, targets: null}),
    event => ({...event, effects: null}),
    event => ({...event, targets: event.targets.map(({trials, ...target}) => target)}),
    event => ({...event, targets: [null, ...event.targets]}),
  ]) {
    const combatId = await broken(change);
    const before = structuredClone([db.writes.length, journal(combatId)]);
    await assert.rejects(rollDamage(combatId), {code: 'failed-precondition'});
    assert.deepEqual([db.writes.length, journal(combatId)], before);
  }
});

test('a guided opposed spell hit answers without damage until the actor throws it', async () => {
  damageFixture();
  seedSpell('barrier', {
    Nome: 'Barriera Cosmica (offensiva)', Costo: 19, Gittata: '30 ft',
    'TPC Fisico': {Param1: 'Intelligenza', Param2: 'Saggezza', ParamTarget: 'Costituzione'},
  });
  // Immediate: attack, defense, then the damage dice inside the answer.
  faces(1, 1, 10, 5, 1);
  const immediate = await launch('spell', 'personal:barrier');
  await defend(immediate.combatId);
  faces(1);
  const {combatId, rolls} = await guided('spell', 'personal:barrier');
  assert.deepEqual([rolls, journal(combatId).status], [[die(12, 1)], 'waiting']);
  const waiting = structuredClone(requestOf(combatId));
  faces(1);
  const reply = await defend(combatId);
  assert.deepEqual(reply, {
    combatId, round: 1, outcome: 'hit', damage: null,
    attack: roll('max(Intelligenza, Saggezza)', 7), defense: roll('Costituzione', 2),
    effects: [], damagePending: true,
  });
  const answered = journal(combatId);
  assert.deepEqual([answered.status, answered.resolvedAt, answered.effects], ['awaitingDamage', null, []]);
  const [target] = answered.targets;
  assert.deepEqual([target.status, target.outcome, target.damage, target.damageDetails, target.trials[0].damage],
    ['done', 'hit', null, null, null]);
  assert.deepEqual(target.pendingDamage, {round: 1, kind: 'effect', label: 'Danno proposto', expr: '3d10'});
  // The answer settles the defense and marks the throw as owed; no damage reaches the owner's copy yet.
  assert.deepEqual(requestOf(combatId), {...waiting, status: 'done', damagePending: true});
  await replays(() => defend(combatId), reply);
  await assert.rejects(applyDamage(combatId), {code: 'failed-precondition', message: /danno concreto/});

  faces(10, 5, 1);
  const thrown = await rollDamage(combatId);
  const landed = {kind: 'damage', label: 'Danno proposto', expr: '3d10', amount: 16, targetPlacementId: place(defender)};
  assert.deepEqual(thrown, {
    combatId, targetPlacementId: place(defender), round: 1, damage: 16,
    rolls: [die(10, 10), die(10, 5), die(10, 1)], effects: [landed], damageDetails: null,
  });
  const resolved = journal(combatId);
  assert.deepEqual([resolved.status, resolved.resolvedAt], ['awaitingConfirmation', null]);
  // As an immediate answer writes it: the target's damage and its trial's.
  const {pendingDamage, ...settled} = target;
  assert.deepEqual(resolved.targets[0], {
    ...settled, damage: 16, trials: [{...target.trials[0], damage: 16}],
    damageRoll: {...pendingDamage, rolls: thrown.rolls, raw: 16, total: 16},
  });
  assert.deepEqual(asImmediate(combatId), immediateEntry(immediate.combatId));
  // The throw is no longer owed, and the answered defense reopens for the owner's confirmation;
  // defense, round and attack stay as they were.
  assert.deepEqual(requestOf(combatId), {
    ...waiting, ...projection(combatId, {kind: 'spell', action: {name: 'Barriera Cosmica (offensiva)', hands: 0},
      damage: 16}), status: 'damagePending', damagePending: false,
  });
  sameRequest(combatId, immediate.combatId);
  // The defender's replay now carries the damage, with the shape of an immediate answer; a re-roll is refused as ever.
  const {damagePending: _waited, ...answer} = reply;
  await replays(() => defend(combatId), {...answer, damage: 16, effects: [landed]});
  await assert.rejects(call(attacker, {command: 'retry', combatId, round: 1, targetPlacementId: place(defender)}), {
    code: 'failed-precondition',
  });
  // The first application settles the copy.
  assert.deepEqual(await applyDamage(combatId, {amount: 16}, defender), {combatId, damageApplied: {amount: 16}});
  assert.equal(requestOf(combatId).status, 'done');
});

test('a guided weapon hit throws its dice, then RD and hands, and journals what an immediate hit would', async () => {
  damageFixture();
  // Immediate: two attack faces, the defense, then the weapon dice 4 and 3 inside the answer.
  faces(1, 1, 1, 4, 3);
  const immediate = await weaponHit();
  faces(1, 1);
  const {combatId} = await guided('weapon', 'weaponMain');
  assert.equal(journal(combatId).action.criticalHasDice, true);
  faces(1);
  const reply = await defend(combatId);
  assert.deepEqual([reply.outcome, reply.damage, reply.effects, reply.damagePending], ['hit', null, [], true]);
  assert.deepEqual(journal(combatId).targets[0].pendingDamage, {
    round: 1, kind: 'weapon', label: 'Danno base', expr: '2d4', reduction: 2,
  });
  assert.deepEqual([requestOf(combatId).status, requestOf(combatId).damagePending], ['done', true]);
  // Neither the critical nor the application comes before the weapon's damage.
  await assert.rejects(confirmCritical(combatId, 13), {
    code: 'failed-precondition', message: 'Tira prima il danno dell\'arma, poi conferma il critico.',
  });
  await assert.rejects(applyDamage(combatId), {code: 'failed-precondition', message: /danno concreto/});

  faces(4, 3);
  const thrown = await rollDamage(combatId);
  assert.deepEqual(thrown, {
    combatId, targetPlacementId: place(defender), round: 1, damage: 17, rolls: [die(4, 4), die(4, 3)],
    effects: [{kind: 'damage', label: 'Danno base', expr: '2d4', amount: 17, targetPlacementId: place(defender)}],
    damageDetails: {raw: 7, subtotal: 13, reduction: 2, hands: 2},
  });
  assert.deepEqual(journal(combatId).targets[0].damageRoll, {
    round: 1, kind: 'weapon', label: 'Danno base', expr: '2d4', rolls: thrown.rolls, raw: 7, total: 17,
  });
  assert.deepEqual(asImmediate(combatId), immediateEntry(immediate));
  sameRequest(combatId, immediate);
  await replays(() => rollDamage(combatId), thrown);

  // The critical rolls once with the server's dice and keeps those faces through every correction.
  faces(5, 2);
  const first = await confirmCritical(combatId, 13);
  assert.deepEqual(Object.keys(first), ['combatId', 'critical', 'rolls']);
  assert.deepEqual([first.rolls, first.critical.rolls, first.critical.roll, first.critical.total],
    [[die(6, 5), die(6, 2)], [die(6, 5), die(6, 2)], 7, 27]);
  assert.deepEqual(journal(combatId).targets[0].critical, first.critical);
  // The same critical on the immediate hit: equal but for the faces.
  faces(5, 2);
  const {rolls: _faces, ...legacyCritical} = first.critical;
  assert.deepEqual((await confirmCritical(immediate, 13)).critical, legacyCritical);
  faces();
  const corrected = await confirmCritical(combatId, 41);
  assert.deepEqual([corrected.rolls, corrected.critical.rolls, corrected.critical.roll, corrected.critical.total],
    [first.rolls, first.rolls, 7, 93]);
  await replays(() => confirmCritical(combatId, 41), corrected);
  // The owner's private copy carries the critical as stored, faces included, and still awaits confirmation.
  assert.deepEqual(requestOf(combatId).ownerDamage, projection(combatId, {damage: 17, critical: corrected.critical}).ownerDamage);
  assert.equal(requestOf(combatId).status, 'damagePending');
  await assert.rejects(applyDamage(combatId, {amount: 92, criticalScore: 41}, defender), {code: 'permission-denied'});
  assert.deepEqual(await applyDamage(combatId, {amount: 93, criticalScore: 41}, defender), {combatId, damageApplied: {amount: 93}});
  assert.deepEqual([resources(defender).stats.hpCurrent, requestOf(combatId).status], [7, 'done']);
  // After the application the stored critical still answers, faces included; another row is refused.
  await replays(() => confirmCritical(combatId, 41), corrected);
  await assert.rejects(confirmCritical(combatId, 13), {code: 'failed-precondition', message: /già stato applicato/});
  assert.deepEqual(journal(combatId).targets[0].critical, corrected.critical);
});

test('a guided critical stores the faces of its first confirmation, whatever the row, or none for the table', async () => {
  damageFixture();
  const hit = async () => {
    faces(1, 1, 1, 1, 1);
    const {combatId} = await guided('weapon', 'weaponMain');
    await defend(combatId);
    assert.equal((await rollDamage(combatId)).damage, 9);
    return combatId;
  };
  // A ×0 row rolls the formula already; the ×1 row after it keeps those faces.
  const zero = await hit();
  faces(3, 4);
  const plain = await confirmCritical(zero, 1);
  assert.deepEqual([plain.critical.factor, plain.critical.total, plain.rolls], [0, 9, [die(6, 3), die(6, 4)]]);
  faces();
  const one = await confirmCritical(zero, 7);
  assert.deepEqual([one.critical.factor, one.critical.roll, one.rolls, one.critical.total], [1, 7, plain.rolls, 20]);

  // No critical at all: the thrown damage applies as it is.
  const bare = await hit();
  assert.deepEqual(await applyDamage(bare, {amount: 9}, defender), {combatId: bare, damageApplied: {amount: 9}});

  // A formula left to the table has no dice: no faces, and the DM settles the amount.
  const tableBlade = {...greatsword, Parametri: {Special: {Danno: {4: '2d4'}, 'Danno Critico': {4: '2d6 + Forza'}}}};
  db.seed(`users/${attacker}/inventory/item-weaponMain`, {currentSnapshot: tableBlade});
  const table = await hit();
  assert.equal(journal(table).action.criticalHasDice, false);
  faces();
  const left = await confirmCritical(table, 13);
  assert.deepEqual([left.rolls, left.critical.rolls, left.critical.roll], [[], [], null]);
  assert.match(left.critical.tableRoll, /2d6 \+ Forza/);
  assert.deepEqual(await applyDamage(table, {amount: 20, criticalScore: 13}), {combatId: table, damageApplied: {amount: 20}});
});

test('a guided weapon spell waits with the RD the defender typed and keeps its table effect', async () => {
  damageFixture();
  seedSpell('investment', {
    Nome: 'INVESTIMENTO', Costo: 5, Gittata: '10 m', ...physicalCheck, 'Effetti Positivi': 'Effettua un attacco fisico.',
  });
  const {combatId} = await guided('spell', 'personal:investment');
  assert.deepEqual(journal(combatId).effects.map(({kind}) => kind), ['manual']);
  assert.equal((await defend(combatId, {reduction: 5})).damagePending, true);
  assert.deepEqual(journal(combatId).targets[0].pendingDamage, {
    round: 1, kind: 'weapon', label: 'Danno base', expr: '2d4', reduction: 5,
  });
  faces(4, 4);
  const thrown = await rollDamage(combatId);
  assert.deepEqual([thrown.damage, thrown.damageDetails], [14, {raw: 8, subtotal: 14, reduction: 5, hands: 2}]);
  assert.deepEqual(journal(combatId).effects.map(({kind, amount}) => [kind, amount]), [['manual', null], ['damage', 14]]);
  assert.equal(journal(combatId).targets[0].trials[0].defenseAdjusted, true);
});

test('an accepted guided effect waits only for its damage: the cure is rolled with the answer', async () => {
  damageFixture();
  seedSpell('pact', {Nome: 'Patto', Costo: 1, danni: '1d8', Cura: '1d4', combat: {targetConsent: true, allowSelf: true}});
  // Immediate: the damage, then the cure, inside the answer.
  const immediate = await launch('spell', 'personal:pact');
  faces(6, 3);
  await defend(immediate.combatId, {consent: true});
  const accepted = await guided('spell', 'personal:pact');
  assert.deepEqual([accepted.rolls, journal(accepted.combatId).status], [[], 'waiting']);
  faces(3);
  const reply = await defend(accepted.combatId, {consent: true});
  const cure = {kind: 'heal', label: 'Cura proposta', expr: '1d4', amount: 3, targetPlacementId: place(defender)};
  assert.deepEqual(reply, {
    combatId: accepted.combatId, round: 1, outcome: 'accepted', damage: null, attack: null, defense: null,
    effects: [cure], damagePending: true,
  });
  assert.deepEqual(journal(accepted.combatId).targets[0].pendingDamage, {
    round: 1, kind: 'effect', label: 'Danno proposto', expr: '1d8',
  });
  assert.equal(journal(accepted.combatId).status, 'awaitingDamage');
  assert.equal(requestOf(accepted.combatId).damagePending, true);
  faces(6);
  const landed = {kind: 'damage', label: 'Danno proposto', expr: '1d8', amount: 6, targetPlacementId: place(defender)};
  // The damage keeps its immediate place before the cure, so the Registro's line reads the same.
  assert.deepEqual((await rollDamage(accepted.combatId)).effects, [landed, cure]);
  const [target] = journal(accepted.combatId).targets;
  assert.deepEqual([target.damage, target.trials[0].damage, target.outcome], [6, 6, 'accepted']);
  assert.deepEqual(asImmediate(accepted.combatId), immediateEntry(immediate.combatId));
  sameRequest(accepted.combatId, immediate.combatId);
  const {damagePending: _waited, ...answer} = reply;
  await replays(() => defend(accepted.combatId, {consent: true}), {...answer, damage: 6, effects: [landed, cure]});

  // A refusal lands nothing and leaves nothing to throw.
  const declined = await guided('spell', 'personal:pact');
  assert.equal((await defend(declined.combatId, {consent: false})).damagePending, undefined);
  assert.deepEqual([journal(declined.combatId).status, 'pendingDamage' in journal(declined.combatId).targets[0]],
    ['done', false]);
  await assert.rejects(rollDamage(declined.combatId), {code: 'failed-precondition'});

  // On oneself the card needs no consent: its damage waits at launch, its cure does not, and the throw opens the
  // actor's own confirmation.
  faces(2);
  const own = await guided('spell', 'personal:pact', {targetPlacementIds: [place(attacker)]});
  const ownEntry = journal(own.combatId);
  assert.deepEqual([ownEntry.status, ownEntry.targets[0].outcome, ownEntry.effects.map(({kind, amount}) => [kind, amount])],
    ['awaitingDamage', 'accepted', [['heal', 2]]]);
  faces(5);
  assert.equal((await rollDamage(own.combatId, {targetPlacementId: place(attacker)})).damage, 5);
  assert.deepEqual(requestOf(own.combatId, attacker), {
    ...projection(own.combatId, {token: attacker, kind: 'spell', action: {name: 'Patto', hands: 0}, outcome: 'accepted',
      damage: 5}), status: 'damagePending', createdAt: 'now',
  });
});

test('ties and re-rolls keep their faces round by round; only the decisive round has damage to throw', async () => {
  damageFixture();
  const {combatId} = await guided('weapon', 'weaponMain');
  const operationId = `combat-test-${operations}`;
  const retry = round => call(attacker, {command: 'retry', combatId, round, targetPlacementId: place(defender)});
  assert.equal((await defend(combatId, {defense: 4})).outcome, 'tie');
  // Each re-roll keeps the advantage: two faces.
  faces(6, 2);
  assert.deepEqual(await retry(1), {combatId, rolls: [die(12, 6), die(12, 2)]});
  faces(1);
  assert.equal((await defend(combatId, {round: 2, defense: 9})).outcome, 'tie');
  faces(8, 3);
  assert.deepEqual(await retry(2), {combatId, rolls: [die(12, 8), die(12, 3)]});
  faces(1);
  const hit = await defend(combatId, {round: 3});
  assert.deepEqual([hit.outcome, hit.damage, hit.damagePending], ['hit', null, true]);
  assert.deepEqual(journal(combatId).targets[0].pendingDamage, {
    round: 3, kind: 'weapon', label: 'Danno base', expr: '2d4', reduction: 2,
  });
  // Each retry answers with the attack of the round it opened, the launch with the first one.
  await replays(() => retry(1), {combatId, rolls: [die(12, 6), die(12, 2)]});
  await replays(() => retry(2), {combatId, rolls: [die(12, 8), die(12, 3)]});
  await replays(() => guided('weapon', 'weaponMain', {operationId}), {combatId, rolls: [die(12, 1), die(12, 1)]});
  for (const round of [1, 2, 4]) {
    await assert.rejects(rollDamage(combatId, {round}), {code: 'failed-precondition', message: /Non c'è un danno/});
  }
  faces(2, 2);
  const thrown = await rollDamage(combatId, {round: 3});
  assert.deepEqual([thrown.round, thrown.damage], [3, 12]);
  const [target] = journal(combatId).targets;
  assert.deepEqual([target.damage, target.trials.map(trial => trial.damage)], [12, [null, null, 12]]);
  assert.deepEqual(requestOf(combatId).ownerDamage.target, projection(combatId, {round: 3, damage: 12}).ownerDamage.target);
});

test('guided mode waits for any formula with dice, of a band or on the ground, never for a constant', async () => {
  damageFixture();
  seedSpell('mixed', {Nome: 'Morso composto', Costo: 1, combat: {damageExpr: '2d6 + 1d4 - 2'}});
  seedSpell('drain', {Nome: 'Risucchio', Costo: 1, combat: {damageExpr: '1d8 - 1d4'}});
  seedSpell('flat', {Nome: 'Puntura', Costo: 1, combat: {damageExpr: '3'}});
  seedSpell('thorn', {Nome: 'Spina', Costo: 1, combat: {damageExpr: '1d4 - 3'}});
  const pendingOf = combatId => journal(combatId).targets[0].pendingDamage;
  const mixed = await guided('spell', 'personal:mixed');
  assert.equal(pendingOf(mixed.combatId).expr, '2d6 + 1d4 - 2');
  faces(6, 5, 4);
  assert.deepEqual(await rollDamage(mixed.combatId).then(({rolls, damage}) => [rolls, damage]),
    [[die(6, 6), die(6, 5), die(4, 4)], 13]);
  const drain = await guided('spell', 'personal:drain');
  faces(7, 3);
  assert.deepEqual(await rollDamage(drain.combatId).then(({rolls, damage}) => [rolls, damage]),
    [[die(8, 7), {sides: 4, value: 3, sign: -1}], 4]);
  assert.deepEqual(journal(drain.combatId).targets[0].damageRoll.rolls, [die(8, 7), {sides: 4, value: 3, sign: -1}]);
  // A negative total lands as the immediate roll's would: nothing for the owner to confirm, nothing to apply.
  const thorn = await guided('spell', 'personal:thorn');
  faces(1);
  assert.equal((await rollDamage(thorn.combatId)).damage, -2);
  assert.deepEqual([journal(thorn.combatId).status, request(thorn.combatId)], ['done', undefined]);
  await assert.rejects(applyDamage(thorn.combatId), {code: 'failed-precondition', message: /danno concreto/});
  // A constant lands at once, with the owner's confirmation, as without a roll mode.
  const flat = await guided('spell', 'personal:flat');
  assert.deepEqual([journal(flat.combatId).status, pendingOf(flat.combatId)], ['awaitingConfirmation', undefined]);
  assert.deepEqual(journal(flat.combatId).effects.map(({kind, amount}) => [kind, amount]), [['damage', 3]]);
  assert.equal(requestOf(flat.combatId).status, 'damagePending');
  await assert.rejects(rollDamage(flat.combatId), {code: 'failed-precondition'});

  // Singolarità waits with the band of the distance at launch; outside every band, or on a constant band,
  // nothing waits.
  seedSpell('singularity', {Nome: 'Singolarità', Costo: 1, Gittata: '50 ft'});
  const moveDefender = col => db.seed(`grigliata_token_placements/${place(defender)}`, {
    tokenId: defender, backgroundId: board, ownerUid: defender, col, row: 0,
  });
  const at = async col => {
    moveDefender(col);
    const {combatId} = await guided('spell', 'personal:singularity');
    return [journal(combatId), combatId];
  };
  const [near, nearId] = await at(2);
  assert.deepEqual([near.status, near.effects, near.targets[0].pendingDamage],
    ['awaitingDamage', [], {round: 1, kind: 'effect', label: 'Danno proposto · 10 ft', expr: '3d10'}]);
  // The stored band is thrown, wherever the target has moved since.
  moveDefender(1);
  faces(10, 9, 8);
  assert.deepEqual((await rollDamage(nearId)).effects, [{
    kind: 'damage', label: 'Danno proposto · 10 ft', expr: '3d10', amount: 27, targetPlacementId: place(defender),
  }]);
  const [between] = await at(3);
  assert.deepEqual([between.status, 'pendingDamage' in between.targets[0], between.effects],
    ['done', false, [{kind: 'manual', label: 'Fascia di danno da concordare al tavolo · 15 ft', expr: '', amount: null,
      targetPlacementId: place(defender)}]]);
  const [far] = await at(8);
  assert.deepEqual([far.status, 'pendingDamage' in far.targets[0], far.effects.map(({expr, amount}) => [expr, amount])],
    ['awaitingConfirmation', false, [['1', 1]]]);

  // Damage on the ground waits on the event, for a throw with no target.
  moveDefender(1);
  seedSpell('blast', {Nome: 'Esplosione', Costo: 1, Cura: '1d4', combat: {mode: 'ground', damageExpr: '2d6'}});
  const ground = {targetPlacementIds: [], point: {col: 1, row: 0}};
  faces(2, 5, 3);
  const immediate = await launch('spell', 'personal:blast', ground);
  faces(3);
  const thrownGround = await guided('spell', 'personal:blast', ground);
  assert.deepEqual(thrownGround.rolls, []);
  const groundEntry = journal(thrownGround.combatId);
  const cure = {kind: 'heal', label: 'Cura proposta', expr: '1d4', amount: 3, targetPlacementId: null};
  assert.deepEqual([groundEntry.status, groundEntry.resolvedAt, groundEntry.effects, groundEntry.pendingDamage],
    ['awaitingDamage', null, [cure], {round: 1, kind: 'effect', label: 'Danno proposto', expr: '2d6'}]);
  await assert.rejects(rollDamage(thrownGround.combatId), {code: 'failed-precondition', message: /non fa parte/});
  await assert.rejects(rollDamage(thrownGround.combatId, {targetPlacementId: null, round: 2}), {code: 'failed-precondition'});
  faces(2, 5);
  const thrown = await rollDamage(thrownGround.combatId, {targetPlacementId: null});
  const landed = {kind: 'damage', label: 'Danno proposto', expr: '2d6', amount: 7, targetPlacementId: null};
  assert.deepEqual(thrown, {
    combatId: thrownGround.combatId, targetPlacementId: null, round: 1, damage: 7, rolls: [die(6, 2), die(6, 5)],
    effects: [landed, cure], damageDetails: null,
  });
  assert.deepEqual(journal(thrownGround.combatId), {
    ...groundEntry, status: 'done', resolvedAt: 'now', updatedAt: 'now', effects: [landed, cure], pendingDamage: null,
    damageRoll: {round: 1, kind: 'effect', label: 'Danno proposto', expr: '2d6', rolls: thrown.rolls, raw: 7, total: 7},
  });
  assert.deepEqual(asImmediate(thrownGround.combatId), immediateEntry(immediate.combatId));
  assert.equal(request(thrownGround.combatId), undefined);
  await replays(() => rollDamage(thrownGround.combatId, {targetPlacementId: null}), thrown);

  // A targetless attack shows its own faces.
  seedSpell('flare', {Nome: 'Bagliore', Costo: 1, combat: {mode: 'ground', damageExpr: '1d6', attackDie: true}});
  faces(9);
  assert.deepEqual((await guided('spell', 'personal:flare', ground)).rolls, [die(12, 9)]);
  faces(4, 9);
  assert.deepEqual((await launch('spell', 'personal:flare', ground)).rolls, [die(12, 9)]);
});

test('guided mode adds no step to table effects, cures, constant weapons or actions without damage', async () => {
  damageFixture();
  seedSpell('veil', {Nome: 'Velo', Costo: 1, Descrizione: 'Nasconde il bersaglio.'});
  seedSpell('venom', {Nome: 'Morso velenoso', Costo: 1, danni: '2d6 + veleno'});
  seedSpell('cure', {Nome: 'Inversione Cellulare', Costo: 1});
  seedSpell('spark', {Nome: 'Scintilla', Costo: 1});
  seedSpell('rift', {Nome: 'Varco', Costo: 1, combat: {mode: 'manual', damageExpr: '1'}});
  // The same journal as without a roll mode, but for the mode itself.
  for (const [id, kinds, options] of [['veil', ['manual']], ['venom', ['manual']], ['cure', ['heal']], ['spark', []],
    ['rift', ['damage', 'manual'], {targetPlacementIds: []}]]) {
    const thrown = await guided('spell', `personal:${id}`, options);
    const immediate = await launch('spell', `personal:${id}`, options);
    assert.deepEqual(thrown.rolls, [], id);
    const entry = journal(thrown.combatId);
    assert.deepEqual([entry.status, entry.resolvedAt, entry.effects.map(({kind}) => kind)], ['done', 'now', kinds], id);
    assert.deepEqual(asImmediate(thrown.combatId), immediateEntry(immediate.combatId), id);
    await assert.rejects(rollDamage(thrown.combatId, options && {targetPlacementId: null}), {code: 'failed-precondition'});
  }
  assert.equal(journal((await guided('spell', 'personal:cure')).combatId).effects[0].amount, 2);

  // A weapon whose damage is a constant hits at once, with its damage in the answer.
  const club = {...greatsword, Parametri: {Special: {Danno: {4: '5'}, 'Danno Critico': {4: '2d6'}}}};
  db.seed(`users/${attacker}/inventory/item-weaponMain`, {currentSnapshot: club});
  const blunt = await guided('weapon', 'weaponMain');
  const blow = await defend(blunt.combatId);
  assert.deepEqual([blow.damage, 'damagePending' in blow, journal(blunt.combatId).status], [14, false, 'awaitingConfirmation']);
  const control = await weaponHit();
  assert.deepEqual(asImmediate(blunt.combatId), immediateEntry(control));
  db.seed(`users/${attacker}/inventory/item-weaponMain`, {currentSnapshot: greatsword});

  // Parte del Leone: the cure reaches the second target at once, hit or resisted; only the blow's damage waits.
  seedSpell('lion', {Nome: 'PARTE DEL LEONE', Costo: 0, ...physicalCheck});
  seedPawn('ally', 6, {tokenType: 'custom', Parametri: parametri, stats, dadoAnima: 'd12'}, attacker);
  const lion = () => guided('spell', 'personal:lion', {targetPlacementIds: [place(defender), place('ally')], confirmExtra: true});
  const cure = {kind: 'heal', label: 'Cura proposta', expr: '1d10', amount: 1, targetPlacementId: place('ally')};
  const heals = combatId => journal(combatId).effects.filter(({kind}) => kind === 'heal');
  const missed = await lion();
  assert.equal((await defend(missed.combatId, {defense: 90})).outcome, 'resisted');
  assert.deepEqual([journal(missed.combatId).status, heals(missed.combatId)], ['done', [cure]]);
  const struck = await lion();
  const reply = await defend(struck.combatId);
  assert.deepEqual([reply.outcome, reply.effects, reply.damagePending], ['hit', [], true]);
  const [attacked, recipient] = journal(struck.combatId).targets;
  assert.deepEqual([journal(struck.combatId).status, heals(struck.combatId)], ['awaitingDamage', [cure]]);
  assert.equal(attacked.pendingDamage.kind, 'weapon');
  assert.deepEqual([recipient.outcome, 'pendingDamage' in recipient], ['applied', false]);
  await assert.rejects(rollDamage(struck.combatId, {targetPlacementId: place('ally')}), {code: 'failed-precondition'});
  assert.equal((await rollDamage(struck.combatId)).damage, 24);
  assert.equal(journal(struck.combatId).status, 'awaitingConfirmation');
});

test('each target throws its own damage while another still answers; no one sees another target’s damage', async () => {
  damageFixture();
  seedElf();
  seedSpell('storm', {
    Nome: 'Tempesta', Costo: 1, Gittata: '30 ft', combat: {mode: 'multiple', targetCount: 2, damageExpr: '2d6'},
    'TPC Fisico': {Param1: 'Intelligenza', Param2: '---', ParamTarget: 'Costituzione'},
  });
  // Both attacks at launch, then the first defense.
  faces(1, 2, 1);
  const {combatId, rolls} = await guided('spell', 'personal:storm', {targetPlacementIds: [place(defender), place('elf')]});
  assert.deepEqual(rolls, [die(12, 1), die(12, 2)]);
  const elfWaiting = structuredClone(requestOf(combatId, 'elf'));
  assert.equal((await defend(combatId)).damagePending, true);
  assert.equal(journal(combatId).status, 'waiting');
  const answered = structuredClone(requestOf(combatId));
  faces(3, 4);
  const thrown = await rollDamage(combatId);
  assert.deepEqual(thrown.effects.map(({targetPlacementId}) => targetPlacementId), [place(defender)]);
  // The other defense still waits: so does the event.
  assert.deepEqual([journal(combatId).status, journal(combatId).resolvedAt], ['waiting', null]);
  assert.deepEqual(requestOf(combatId, 'elf'), elfWaiting);
  assert.equal(answered.damagePending, true);
  assert.deepEqual(requestOf(combatId), {
    ...answered, ...projection(combatId, {kind: 'spell', action: {name: 'Tempesta', hands: 0}, damage: 7}),
    status: 'damagePending', damagePending: false,
  });
  assert.doesNotMatch(JSON.stringify(requestOf(combatId).ownerDamage), /elf/);

  // The other target ties: the re-roll comes before the waiting damage.
  faces(1);
  assert.equal((await call('elf', {command: 'defend', combatId, round: 1, targetPlacementId: place('elf'), defense: 7})).outcome,
    'tie');
  assert.equal(journal(combatId).status, 'retry');
  faces(5);
  assert.deepEqual(await call(attacker, {command: 'retry', combatId, round: 1, targetPlacementId: place('elf')}),
    {combatId, rolls: [die(12, 5)]});
  assert.equal(journal(combatId).status, 'waiting');
  // It lands and waits for its own throw; its owner's reply holds nothing of the first target.
  faces(1);
  const elfAnswer = await call('elf', {command: 'defend', combatId, round: 2, targetPlacementId: place('elf'), defense: 0});
  assert.deepEqual([elfAnswer.outcome, elfAnswer.damagePending, elfAnswer.effects], ['hit', true, []]);
  assert.equal(journal(combatId).status, 'awaitingDamage');
  assert.deepEqual([requestOf(combatId, 'elf').ownerDamage, requestOf(combatId, 'elf').damagePending], [undefined, true]);
  faces(6, 6);
  assert.equal((await rollDamage(combatId, {targetPlacementId: place('elf'), round: 2})).damage, 12);
  assert.deepEqual([journal(combatId).status, journal(combatId).resolvedAt], ['awaitingConfirmation', null]);
  assert.deepEqual([requestOf(combatId, 'elf').ownerDamage.target.damage, requestOf(combatId, 'elf').status,
    requestOf(combatId, 'elf').damagePending], [12, 'damagePending', false]);
  assert.equal(requestOf(combatId).ownerDamage.target.damage, 7);
  // The first defender's replay still shows only their own damage.
  assert.deepEqual((await defend(combatId)).effects.map(({amount}) => amount), [7]);
});

test('an opposed guided hit whose throw totals below zero ends the defender\u2019s wait with nothing to confirm', async () => {
  damageFixture();
  seedSpell('sting', {
    Nome: 'Puntura maligna', Costo: 1, Gittata: '30 ft', combat: {damageExpr: '1d4 - 3'},
    'TPC Fisico': {Param1: 'Intelligenza', Param2: '---', ParamTarget: 'Costituzione'},
  });
  // Immediate, for the same faces: attack, defense, then the damage inside the answer.
  faces(1, 1, 1);
  const immediate = await launch('spell', 'personal:sting');
  await defend(immediate.combatId);
  faces(1, 1);
  const {combatId} = await guided('spell', 'personal:sting');
  const waiting = structuredClone(requestOf(combatId));
  const reply = await defend(combatId);
  assert.deepEqual([reply.outcome, reply.damage, reply.damagePending], ['hit', null, true]);
  assert.deepEqual(requestOf(combatId), {...waiting, status: 'done', damagePending: true});
  faces(1);
  const thrown = await rollDamage(combatId);
  const landed = {kind: 'damage', label: 'Danno proposto', expr: '1d4 - 3', amount: -2, targetPlacementId: place(defender)};
  assert.deepEqual([thrown.damage, thrown.effects], [-2, [landed]]);
  // The journal holds the negative amount as an immediate answer does.
  const [target] = journal(combatId).targets;
  assert.deepEqual([target.damage, target.trials[0].damage], [-2, -2]);
  assert.deepEqual([journal(combatId).status, journal(combatId).resolvedAt], ['done', 'now']);
  assert.deepEqual(asImmediate(combatId), immediateEntry(immediate.combatId));
  // The throw is over, with no damage to confirm: no projection, the request stays settled.
  assert.deepEqual(requestOf(combatId), {...waiting, status: 'done', damagePending: false});
  for (const uid of [defender, dm]) {
    await assert.rejects(applyDamage(combatId, {amount: 0}, uid), {code: 'failed-precondition', message: /danno concreto/});
  }
  const {damagePending: _waited, ...answer} = reply;
  await replays(() => defend(combatId), {...answer, damage: -2, effects: [landed]});
});
