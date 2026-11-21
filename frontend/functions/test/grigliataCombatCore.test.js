const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildWeaponActions,
  buildContentAction,
  combatCost,
  combatCritical,
  combatDamageBalances,
  combatDamageBase,
  combatDamageEligible,
  combatDamageProposal,
  combatDamageSplit,
  compareCombatRolls,
  combatDistance,
  combatRoleRange,
  combatStatus,
  equippedItemSpells,
  rollCombatDamage,
} = require('../lib/grigliataCombatCore');

const profile = {level: 6, die: 12, parametri: {
  Base: {Forza: {Tot: 4}}, Combattimento: {Mira: {Tot: 4}, Attacco: {Tot: 6}}, Special: {},
}};
const makeHandItem = (Nome, Tipo, Danno, Hands = 1) => ({
  General: {Nome}, Specific: {Tipo, Hands}, Parametri: {Special: {Danno: {4: Danno}, 'Danno Critico': {4: '2d6'}}},
});
const armed = buildWeaponActions({...profile, slots: {weaponMain: makeHandItem('Spadone', 'Mischia', '2d4', 2)}}).actions;
const physicalCheck = {'TPC Fisico': {Param1: 'Mira', Param2: '---', ParamTarget: 'Difesa'}};
const card = (name, entry, options = {}) => buildContentAction({
  id: 'personal:card', scope: 'personal', kind: 'spell', name, entry, profile, ...options,
});

test('the selected hand uses its tier and excludes the other offensive weapon bonus', () => {
  const makeWeapon = (name, damage, bonus) => ({
    General: {Nome: name}, Specific: {Tipo: 'Mischia', Hands: 1},
    Parametri: {Special: {Danno: {1: '1d4', 4: damage}, 'Bonus Danno': {4: bonus}}},
  });
  const {actions} = buildWeaponActions({
    level: 6, die: 12,
    parametri: {Combattimento: {Mira: {Tot: 4}, Attacco: {Tot: 6}}, Special: {
      'Bonus Danno': {Tot: 9, Equip: 7}, 'Mira 1H': {Tot: 2, Equip: 2},
    }},
    slots: {weaponMain: makeWeapon('Daga', '2d4', 3), weaponOff: makeWeapon('Spada', '2d6', 4),
      foderoArma: {Parametri: {Special: {'Mira 1H': {4: 2}}}}},
  });
  assert.equal(actions[0].damageExpr, '2d4');
  assert.equal(actions[0].attackBonus, 6);
  assert.equal(actions[0].damageBonus, 5);
  assert.equal(actions[1].damageBonus, 6);
});

test('a stored opposed spell retains its channel and the mana reduction floor', () => {
  const action = buildContentAction({
    id: 'personal:storm', scope: 'personal', kind: 'spell', name: 'Tempesta',
    entry: {Costo: 5, Gittata: 30, 'TPC Fisico': {Param1: 'Saggezza', Param2: 'Intelligenza', ParamTarget: 'Costituzione'},
      'Effetti Negativi': 'Infligge 2d8 danni.'},
    profile: {level: 4, die: 12, parametri: {Base: {Saggezza: {Tot: 5}, Intelligenza: {Tot: 3}}, Special: {ridCostoSpell: {Tot: 9}}}},
  });
  assert.equal(action.cost, 1);
  assert.equal(action.damageExpr, '2d8');
  assert.equal(action.rangeFt, 30);
  assert.equal(action.opposed, true);
  assert.equal(action.attackBonus, 5);
  assert.deepEqual(action.defenseStats, ['Costituzione']);
});

test('a declared mana deficit consumes PF with explicit confirmation', () => {
  const input = {cost: 7, extraResource: {name: 'Essenza', amount: 2}};
  const balances = {hp: 9, mana: 4, essenza: 2};
  assert.throws(() => combatCost(input, balances, {confirmExtra: true}), /Conferma.*PF/);
  assert.throws(() => combatCost(input, balances, {confirmHp: true, maxHpCost: 2, confirmExtra: true}), /costo in PF è cambiato/);
  assert.throws(() => combatCost(input, {...balances, essenza: 1}, {confirmHp: true, maxHpCost: 3, confirmExtra: true}), /Essenza insufficiente/);
  assert.deepEqual(combatCost(input, balances, {confirmHp: true, maxHpCost: 3, confirmExtra: true}), {mana: 4, hp: 3, essenza: 2});
});

test('a tied target can retry while another target is still waiting', () => {
  assert.equal(compareCombatRolls(12, 12), 'tie');
  assert.equal(compareCombatRolls(13, 12), 'hit');
  assert.equal(combatStatus([{status: 'retry'}, {status: 'waiting'}]), 'retry');
  assert.equal(combatStatus([{status: 'done'}, {status: 'waiting'}]), 'waiting');
  assert.equal(combatStatus([{status: 'done'}, {status: 'done'}]), 'done');
});

test('diagonal range measures from the edge of large tokens', () => {
  assert.equal(combatDistance({col: 0, row: 0, sizeSquares: 2}, {col: 2, row: 2, sizeSquares: 2}), 5);
});

test('Codex crits reuse the initial dice and apply reduction before the two-handed multiplier', () => {
  const base = {raw: 5, subtotal: 18, reduction: 7, hands: 2};
  const action = {criticalExpr: '2d4', criticalBonus: 1};
  const first = combatCritical(13, base, action, null, () => 2);
  assert.deepEqual(first, {
    score: 13, multiplier: 'x1', factor: 1, effect: 'ATTACCO FURTIVO + IMPEDIMENTO',
    total: 24, tableRoll: '', roll: 4, bonus: 1, reduction: 7,
  });
  const reroll = () => assert.fail('selecting a different row must preserve the original dice');
  assert.equal(combatCritical(4, base, action, first, reroll).total, 22);
  assert.equal(combatCritical(17, base, action, first, reroll).total, 35);
  assert.equal(combatCritical(41, base, action, first, reroll).total, 80);
  assert.throws(() => combatCritical(42, base, action, first, reroll), /tra 1 e 41/);
});

test('a dice expression rolls every term of its sum', () => {
  const highest = sides => sides;
  assert.equal(rollCombatDamage('2d6 + 1d4', highest), 16);
  assert.equal(rollCombatDamage('3d8 - 2', highest), 22);
  assert.equal(rollCombatDamage('d6+2d4-1+3', () => 1), 5);
  assert.equal(rollCombatDamage('1', highest), 1);
  for (const invalid of ['', '0', '2d6 +', '2d6 + veleno', '2d6 danni', '21d6', '2d1', '1d4d6']) {
    assert.equal(rollCombatDamage(invalid, highest), null, invalid);
  }
  const {actions: [blade]} = buildWeaponActions({...profile, slots: {
    weaponMain: {General: {Nome: 'Lama'}, Specific: {Tipo: 'Mischia'},
      Parametri: {Special: {Danno: '1d8 + 1d4', 'Danno Critico': '1d6 + 2'}}},
  }});
  assert.equal(blade.damageExpr, '1d8 + 1d4');
  assert.equal(combatCritical(7, {raw: 2, subtotal: 8, reduction: 0, hands: 1}, blade, null, highest).roll, 8);
  assert.deepEqual([blade.damageBands, blade.sourceItem, blade.roleRangesFt], [[], '', null]);
});

test('a structured damage or heal field is the whole expression or a table roll, never a prefix', () => {
  assert.equal(card('Morso', {danni: '2d6 + 1d4'}).damageExpr, '2d6 + 1d4');
  const venom = card('Morso', {danni: '2d6 + veleno', description: 'Morde il bersaglio.'});
  assert.equal(venom.damageExpr, '');
  assert.equal(venom.manualEffect, 'Danno da tirare al tavolo: 2d6 + veleno');
  const balm = card('Balsamo', {Cura: '1d8 per 2 turni'});
  assert.equal(balm.healExpr, '');
  assert.equal(balm.manualEffect, 'Cura da tirare al tavolo: 1d8 per 2 turni');
  assert.equal(card('Morso', {danni: '2d6 + 1d4 fuoco'}).damageExpr, '2d6 + 1d4');
  const burning = card('Morso', {danni: '2d6 danni per turno'});
  assert.deepEqual([burning.damageExpr, burning.manualEffect], ['2d6', 'Danno: 2d6 danni per turno']);
  assert.equal(card('Morso', {danni: '2d6'}).manualEffect, '');
  // A card's own field wins over the rule named after it.
  const dart = card('Dardo Cosmico', {danni: '2d6 danni per turno'});
  assert.deepEqual([dart.damageExpr, dart.manualEffect], ['2d6', 'Danno: 2d6 danni per turno']);
  assert.equal(card('Dardo Cosmico', {}).damageExpr, '2d10');
  for (const formula of ['1d8 per turno', '2d6 x2', '2d6  + Forza', '2d6 x Forza', '2d6 × Forza']) {
    assert.equal(card('Morso', {danni: formula}).damageExpr, '', formula);
  }
  const critical = (text) => buildWeaponActions({...profile, slots: {weaponMain: {
    General: {Nome: 'Daga'}, Specific: {Tipo: 'Mischia', Hands: 1},
    Parametri: {Special: {Danno: {4: '2d4'}, 'Danno Critico': {4: text}}},
  }}}).actions[0].criticalExpr;
  assert.deepEqual([critical('2d6 fuoco'), critical('2d6 + Forza')], ['2d6', '2d6 + Forza']);
  const base = {raw: 2, subtotal: 6, reduction: 0, hands: 1};
  const unsupported = combatCritical(7, base, {criticalExpr: '2d6 + Forza', criticalBonus: 0}, null, () => 1);
  assert.equal(unsupported.total, 6);
  assert.deepEqual([unsupported.effect, unsupported.tableRoll], ['–', 'max(0, 6 + x1 (2d6 + Forza) − 0 RD), arrotondato per eccesso']);
  const twoHanded = combatCritical(7, {...base, reduction: 4, hands: 2}, {criticalExpr: '2d6 + Forza', criticalBonus: 2}, null, () => 1);
  assert.equal(twoHanded.tableRoll, 'max(0, 8 + x1 (2d6 + Forza) − 4 RD) × 1,5, arrotondato per eccesso');
  assert.equal(combatCritical(1, base, {criticalExpr: '2d6 + Forza', criticalBonus: 0}, null, () => 1).tableRoll, '');
  assert.equal(combatCritical(7, base, {criticalExpr: '2d6', criticalBonus: 0}, null, () => 1).tableRoll, '');
  assert.equal(card('Rogo', {'Effetti Negativi': 'Infligge 2d6 + 1d4 danni da fuoco.'}).damageExpr, '2d6 + 1d4');
  assert.equal(card('Rogo', {'Effetti Negativi': 'Infligge 2d6 + veleno danni.'}).damageExpr, '');
  assert.equal(card('Rogo', {'Effetti Negativi': 'Infligge 5 danni.'}).damageExpr, '');
});

test('cards with a physical attack take the wielded weapon and keep their own table effect', () => {
  const investment = card('INVESTIMENTO', {
    Costo: 5, Gittata: '10 m', ...physicalCheck, 'Effetti Positivi': 'Ottieni 1 Investimento.',
  }, {weapons: armed});
  assert.deepEqual(
    [investment.hands, investment.melee, investment.damageExpr, investment.criticalExpr, investment.attackStat],
    [2, true, '2d4', '2d6', 6]
  );
  assert.equal(investment.rangeFt, 32.81);
  assert.equal(investment.opposed, true);
  assert.equal(investment.description, 'Ottieni 1 Investimento.\nArma impugnata · Spadone');
  assert.equal(investment.manualEffect, investment.description);

  const cut = card('TAGLIO DEI COSTI', {Costo: 0, ...physicalCheck}, {weapons: armed});
  assert.deepEqual([cut.rangeFt, cut.hands, cut.extraResource], [5, 2, {name: 'Investimento', amount: 1}]);
  const speculation = card('SPECULAZIONE', {Costo: 0}, {weapons: armed});
  assert.deepEqual([speculation.attackLabel, speculation.defenseStats, speculation.hands], ['Mira', ['Difesa'], 2]);

  const unarmed = card('INVESTIMENTO', {Costo: 5, ...physicalCheck}, {weapons: []});
  assert.deepEqual([unarmed.hands, unarmed.damageExpr], [0, '']);
  assert.match(unarmed.manualEffect, /Danno fisico da concordare al tavolo/);
});

test('the three weapon cards that were special cases still resolve the same way', () => {
  const lion = card('PARTE DEL LEONE', {Costo: 0, ...physicalCheck}, {weapons: armed});
  assert.deepEqual([lion.attackStat, lion.damageExpr, lion.hands, lion.healExpr], [16, '2d4', 2, '1d10']);
  assert.match(lion.description, /Arma impugnata · Spadone\nAttacco 6 \+ 10/);
  assert.equal(lion.healOnResist, true);
  assert.deepEqual(lion.targetRoles, ['Bersaglio dell’attacco', 'Te o un alleato da curare']);
  assert.deepEqual(lion.roleRangesFt, [5, 30]);
  assert.deepEqual([combatRoleRange(lion, 0), combatRoleRange(lion, 1), combatRoleRange(armed[0], 1)], [5, 30, 5]);
  const bareHanded = card('PARTE DEL LEONE', {Costo: 0}, {weapons: []});
  assert.deepEqual([bareHanded.attackStat, bareHanded.damageExpr, bareHanded.roleRangesFt], [16, '', [null, 30]]);
  assert.equal(bareHanded.manualEffect, 'Danno fisico da concordare al tavolo.');

  const technique = (name, weapons, scope = 'common', entry = {Costo: 4, Effetto: 'Attacco fisico.'}) =>
    buildContentAction({id: 'common:card', scope, kind: 'tecnica', name, entry, profile, weapons});
  const attack = technique('Attacco', armed);
  assert.deepEqual(
    [attack.id, attack.kind, attack.cost, attack.hands, attack.damageExpr, attack.rangeFt, attack.attackStat],
    ['common:card', 'tecnica', 4, 2, '2d4', 5, 6]
  );
  assert.equal(technique('Attacco', []), null);
  const bow = buildWeaponActions({...profile, slots: {weaponMain: makeHandItem('Arco', 'Distanza', '1d8', 2)}}).actions;
  assert.equal(technique('Attacco', bow).damageExpr, '1d8');
  assert.equal(technique('Attacco d\'Opportunità', bow), null);
  const opportunity = technique('Attacco d\'Opportunità', armed);
  assert.deepEqual([opportunity.melee, opportunity.rangeFt, opportunity.canActOffTurn], [true, 5, true]);
  const foeBite = technique('Attacco', [], 'personal', {danni: '2d6'});
  assert.deepEqual([foeBite.hands, foeBite.damageExpr, foeBite.opposed], [0, '2d6', true]);
});

test('spells embedded in equipped items follow their cards', () => {
  const blank = {Param1: '---', Param2: '---', ParamTarget: '---'};
  const itemSpell = (Nome, Costo, Gittata, text) => ({
    Nome, Costo, Gittata, Azione: '', Turni: 0, TPC: blank, 'TPC Fisico': blank, 'TPC Mentale': blank,
    'Effetti Positivi': text, 'Effetti Negativi': '',
  });
  const slots = {
    weaponOff: {General: {Nome: 'Catena del Predatore', spells: {
      Afferra: {...itemSpell('Afferra', 8, 30, 'FORZA + ANIMA VS FORZA + ANIMA'), Azione: 'Consumabile',
        'TPC Fisico': {...blank, Param1: 'Forza'}},
      'Dardo Cosmico': true,
    }}},
    accessorio: {General: {Nome: 'destino test', spells: {
      Resurrezione: itemSpell('Resurrezione', 3, 0, 'Riporta in vita un essere vivente.'),
      'Stasi Personale': itemSpell('Stasi Personale', 1, 10, 'Quando vieni colpito puoi spendere 1 carica.'),
      'Stasi Protettiva': itemSpell('Stasi Protettiva', 2, 10, 'Un alleato entro 10 metri.'),
      'Fenditura Temporale': itemSpell('Fenditura Temporale', 1, 0, '+10 mira e +10 critico.'),
    }}},
    stivali: {General: {Nome: 'Stivali di Cuoio'}},
  };
  const granted = equippedItemSpells(slots);
  assert.deepEqual(granted.map(({id, sourceItem}) => [id, sourceItem]), [
    ['item:weaponOff:Afferra', 'Catena del Predatore'],
    ['item:accessorio:Resurrezione', 'destino test'],
    ['item:accessorio:Stasi Personale', 'destino test'],
    ['item:accessorio:Stasi Protettiva', 'destino test'],
    ['item:accessorio:Fenditura Temporale', 'destino test'],
  ]);
  const [grab, resurrection, selfStasis, allyStasis, rift] = granted.map(({id, key, entry, sourceItem}) =>
    buildContentAction({id, kind: 'spell', scope: 'equipped', name: key, entry, profile, sourceItem}));
  const charges = amount => ({cost: 0, baseCost: 0, extraResource: {name: 'Cariche', amount}});
  const paid = ({cost, baseCost, extraResource}) => ({cost, baseCost, extraResource});

  assert.deepEqual([grab.scope, grab.kind, grab.sourceItem], ['equipped', 'spell', 'Catena del Predatore']);
  assert.deepEqual([grab.opposed, grab.channel, grab.attackLabel, grab.defenseStats], [true, 'Fisico', 'Forza', ['Forza']]);
  assert.deepEqual([grab.rangeFt, grab.actionEconomy], [30, 'Consumabile']);
  assert.deepEqual(paid(grab), {cost: 8, baseCost: 8, extraResource: null});

  assert.deepEqual([resurrection.requireDead, resurrection.allowDead, resurrection.rangeFt], [true, true, null]);
  assert.deepEqual(paid(resurrection), charges(3));
  assert.deepEqual([selfStasis.mode, selfStasis.actionEconomy, selfStasis.canActOffTurn], ['self', 'Reazione', true]);
  assert.deepEqual(paid(selfStasis), charges(1));
  assert.deepEqual([allyStasis.relation, allyStasis.rangeFt, allyStasis.canActOffTurn], ['ally', 32.81, true]);
  assert.deepEqual(paid(allyStasis), charges(2));
  assert.deepEqual([rift.mode, rift.manualEffect], ['self', '+10 mira e +10 critico.']);
  assert.deepEqual(paid(rift), charges(1));
});

test('review round 1: charges, melee reach and role ranges follow the card', () => {
  const ring = {Costo: 30, 'Effetti Positivi': 'Riporta in vita.'};
  const learned = card('Resurrezione', ring);
  assert.deepEqual([learned.cost, learned.extraResource], [30, null]);
  const granted = card('Resurrezione', ring, {sourceItem: 'Destino'});
  assert.deepEqual([granted.cost, granted.extraResource], [0, {name: 'Cariche', amount: 30}]);
  const stasis = card('Stasi Personale', {Costo: 1, combat: {baseCost: 1}}, {sourceItem: 'Destino'});
  assert.deepEqual([stasis.baseCost, stasis.cost, stasis.extraResource], [0, 0, {name: 'Cariche', amount: 1}]);

  const bow = {...makeHandItem('Arco', 'Distanza', '2d8', 1)};
  const dagger = makeHandItem('Pugnale', 'Mischia', '2d4');
  const mixed = buildWeaponActions({...profile, slots: {weaponMain: bow, weaponOff: dagger}}).actions;
  const investment = card('INVESTIMENTO', {Costo: 5, ...physicalCheck}, {weapons: mixed});
  assert.deepEqual([investment.damageExpr, investment.melee, investment.rangeFt], ['2d4', true, 32.81]);

  const lion = card('PARTE DEL LEONE', {...physicalCheck, combat: {targetRoles: ['Nemico', 'Alleato']}}, {weapons: armed});
  assert.deepEqual([lion.targetRoles, lion.roleRangesFt], [['Nemico', 'Alleato'], [5, 30]]);
});

test('a foe spell keeps both its description and its separate effects', () => {
  const bite = card('Morso', {danni: '2d6', description: 'Morde alla gola.', effetti: 'Il bersaglio non può muoversi.'});
  assert.equal(bite.description, ['Morde alla gola.', 'Il bersaglio non può muoversi.'].join('\n'));
  assert.equal(card('Morso', {effetti: 'Uguale', description: 'Uguale'}).description, 'Uguale');
});

test('Singolarità proposes the damage of the band that covers the distance', () => {
  const spell = card('Singolarità', {Costo: 20, Gittata: '50 ft', Descrizione: 'Danno variabile con la distanza.'});
  assert.deepEqual([spell.damageExpr, spell.manualEffect, spell.damageBands.length], ['', '', 5]);
  const proposed = feet => {
    const {kind, label, expr} = combatDamageProposal(spell, feet);
    return [kind, label, expr];
  };
  assert.deepEqual(proposed(0), ['damage', 'Danno proposto · 0 ft', '4d10']);
  assert.deepEqual(proposed(5), ['damage', 'Danno proposto · 5 ft', '4d10']);
  assert.deepEqual(proposed(10), ['damage', 'Danno proposto · 10 ft', '3d10']);
  assert.deepEqual(proposed(20), ['damage', 'Danno proposto · 20 ft', '2d10']);
  assert.deepEqual(proposed(30), ['damage', 'Danno proposto · 30 ft · Attacco Furtivo', '1d10']);
  assert.deepEqual(proposed(45), ['damage', 'Danno proposto · 45 ft · Attacco Furtivo', '1']);
  assert.deepEqual(proposed(15), ['manual', 'Fascia di danno da concordare al tavolo · 15 ft', '']);
  assert.deepEqual(combatDamageProposal({damageExpr: '2d10'}, 15), {kind: 'damage', label: 'Danno proposto', expr: '2d10'});
  assert.equal(combatDamageProposal({damageExpr: ''}, 15), null);
});

test('only a decisive landing with a concrete number bound to the target can take damage', () => {
  const target = {placementId: 'map__orc', status: 'done', outcome: 'hit', damage: null};
  const bound = (amount, kind = 'damage', targetPlacementId = 'map__orc') => [{kind, amount, targetPlacementId}];
  assert.equal(combatDamageEligible({...target, damage: 9}, []), true);
  assert.equal(combatDamageEligible({...target, damage: 0}, []), true);
  assert.equal(combatDamageEligible(target, bound(4)), true);
  assert.equal(combatDamageEligible({...target, outcome: 'applied'}, bound(4)), true);
  assert.equal(combatDamageEligible({...target, outcome: 'accepted'}, bound(1)), true);
  // Not decisive, not landed, or not a concrete number for this target.
  assert.equal(combatDamageEligible({...target, status: 'waiting', outcome: null}, bound(4)), false);
  assert.equal(combatDamageEligible({...target, status: 'retry', outcome: null}, bound(4)), false);
  for (const outcome of ['resisted', 'declined', 'manual', null]) {
    assert.equal(combatDamageEligible({...target, outcome, damage: 9}, bound(4)), false);
  }
  assert.equal(combatDamageEligible(target, bound(4, 'heal')), false);
  assert.equal(combatDamageEligible(target, bound(null, 'manual')), false);
  assert.equal(combatDamageEligible(target, bound(4, 'damage', null)), false);
  assert.equal(combatDamageEligible(target, bound(4, 'damage', 'map__elf')), false);
  for (const amount of [null, -1, 2.5, '4', Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(combatDamageEligible(target, bound(amount)), false);
    assert.equal(combatDamageEligible({...target, damage: amount}, []), false);
  }
});

test('the base damage is the target roll, else the last concrete effect naming it, as the panel shows', () => {
  const target = {placementId: 'map__orc', status: 'done', outcome: 'applied', damage: null};
  const effects = [
    {kind: 'damage', amount: 3, targetPlacementId: 'map__orc'},
    {kind: 'damage', amount: 8, targetPlacementId: 'map__elf'},
    {kind: 'damage', amount: 5, targetPlacementId: 'map__orc'},
    {kind: 'damage', amount: -1, targetPlacementId: 'map__orc'},
    {kind: 'heal', amount: 6, targetPlacementId: 'map__orc'},
  ];
  assert.equal(combatDamageBase(target, effects), 5);
  assert.equal(combatDamageBase({...target, outcome: 'hit', damage: 9}, effects), 9);
  assert.equal(combatDamageBase({...target, damage: 0}, effects), 0);
  assert.equal(combatDamageBase({...target, outcome: 'resisted', damage: 9}, effects), null);
  // A journal with malformed effects proposes nothing instead of failing.
  for (const malformed of [null, undefined, {}, [null, 'x']]) {
    assert.equal(combatDamageBase(target, malformed), null);
    assert.equal(combatDamageEligible(target, malformed), false);
  }
});

test('damage consumes the barrier first, then PF, never below zero', () => {
  assert.deepEqual(combatDamageSplit(7, {barrier: 4, hp: 100}), {barrier: 4, hp: 3});
  assert.deepEqual(combatDamageSplit(3, {barrier: 4, hp: 100}), {barrier: 3, hp: 0});
  assert.deepEqual(combatDamageSplit(50, {barrier: 3, hp: 10}), {barrier: 3, hp: 10});
  assert.deepEqual(combatDamageSplit(5, {barrier: null, hp: null}), {barrier: 0, hp: 0});
  assert.deepEqual(combatDamageSplit(5, {barrier: -2, hp: -1}), {barrier: 0, hp: 0});
  assert.deepEqual(combatDamageSplit(0, {barrier: 4, hp: 10}), {barrier: 0, hp: 0});

  // Characters keep the barrier as barrieraCurrent (or the legacy barriera); tokens as shieldCurrent.
  assert.deepEqual(combatDamageBalances({hpCurrent: 8, hpTotal: 20, barrieraCurrent: 2, barriera: 9}, true),
    {hp: 8, barrier: 2});
  assert.deepEqual(combatDamageBalances({hpTotal: 20, barriera: 9}, true), {hp: 20, barrier: 9});
  assert.deepEqual(combatDamageBalances({hpCurrent: 8, shieldCurrent: 3, barrieraCurrent: 5}, false),
    {hp: 8, barrier: 3});
  assert.deepEqual(combatDamageBalances({}, false), {hp: null, barrier: null});
});

test('the common Ostruzione card can be used during the opponent turn', () => {
  const entry = {Nome: 'Ostruzione', Costo: 4, Azione: 'Movimento'};
  const obstruction = scope => buildContentAction({id: 'card', scope, kind: 'tecnica', name: 'Ostruzione', entry, profile});
  assert.deepEqual([obstruction('common').canActOffTurn, obstruction('common').actionEconomy], [true, 'Movimento']);
  assert.equal(obstruction('personal').canActOffTurn, false);
});
