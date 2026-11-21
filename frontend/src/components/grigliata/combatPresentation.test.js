import {
  combatCostLabel, combatDefenderOutcomeLabel, combatProposalLabel, combatResourceConfirmLabel, combatSpentLabel, combatStepRange, combatStepRangeFt,
  combatTime, combatDamageProposal, combatAppliedDamage, parseCombatDamage, combatDamageFloor, combatDefenseOverrideLabel,
} from './combatPresentation';

test('costs show only their non-zero parts and charges read as table-tracked', () => {
  expect(combatCostLabel({cost:0,extraResource:{name:'Cariche',amount:3}})).toBe('3 Cariche');
  expect(combatCostLabel({cost:0})).toBe('0 PM');
  expect(combatCostLabel({cost:4,extraResource:{name:'Essenza',amount:1}})).toBe('4 PM + 1 Essenza');
  expect(combatCostLabel({variableCost:true,extraResource:{name:'Investimento',amount:2}})).toBe('PM variabili + 2 Investimento');
  expect(combatResourceConfirmLabel({name:'Essenza',amount:1})).toBe('Spendi 1 Essenza');
  expect(combatResourceConfirmLabel({name:'Investimento',amount:2})).toBe('Usa 2 Investimento (da scalare al tavolo)');
});

test('the defender reads the outcome from their own side and the proposed damage or healing', () => {
  expect(combatDefenderOutcomeLabel('hit','spell')).toBe('Non hai resistito');
  expect(combatDefenderOutcomeLabel('resisted','tecnica')).toBe('Hai resistito');
  expect(combatDefenderOutcomeLabel('hit','weapon')).toBe('Colpito');
  expect(combatDefenderOutcomeLabel('hit','tecnica',2)).toBe('Colpito');
  expect(combatDefenderOutcomeLabel('tie','spell')).toBe('Parità · l’attaccante può rilanciare');
  expect(combatDefenderOutcomeLabel('accepted','spell')).toBe('Effetto accettato');
  expect(combatProposalLabel(17)).toBe('17 danni proposti');
  expect(combatProposalLabel(null,[{kind:'heal',amount:6},{kind:'manual',amount:null}])).toBe('6 PF di cura proposti');
  expect(combatProposalLabel(null,undefined)).toBe('');
});

test('the step range follows the ordered role and is empty when nothing limits the pick', () => {
  const roles = {rangeFt:5,targetRoles:['A','B'],roleRangesFt:[5,null]};
  expect(combatStepRange(roles,0)).toBe('5 ft');
  expect(combatStepRangeFt(roles,1)).toBeNull();
  expect(combatStepRange(roles,2)).toBe('');
  expect(combatStepRange({rangeFt:30,minRangeFt:10})).toBe('10–30 ft');
  expect(combatStepRangeFt({})).toBeNull();
});

test('a logged cost adds what the table tracks and never prints Essenza twice', () => {
  expect(combatSpentLabel({mana:0,hp:0,essenza:0,extra:{name:'Cariche',amount:1}})).toBe('1 Carica');
  expect(combatSpentLabel({mana:2,hp:1,essenza:0,extra:{name:'Investimento',amount:2}})).toBe('2 PM + 1 PF + 2 Investimento');
  expect(combatSpentLabel({mana:4,hp:0,essenza:1,extra:{name:'Essenza',amount:1}})).toBe('4 PM + 1 Essenza');
  expect(combatSpentLabel({mana:3,hp:0})).toBe('3 PM');
  expect(combatSpentLabel(undefined)).toBe('');
});

test('a server timestamp still pending counts as the newest', () => {
  expect(combatTime({toMillis:() => 5})).toBe(5);
  expect(combatTime(null)).toBeGreaterThan(Date.now());
});

test('damage is offered only for a landed, answered target with a whole damage from 0 up tied to that very pawn', () => {
  const bro = { placementId: 'map__bro', status: 'done', outcome: 'hit', damage: 7 };
  const own = amount => ({ kind: 'damage', label: 'Danno proposto', expr: '2d6', amount, targetPlacementId: 'map__bro' });
  expect(combatDamageProposal({}, bro)).toEqual({ amount: 7, formula: '' });
  expect(combatDamageProposal({}, { ...bro, damage: 0 })).toEqual({ amount: 0, formula: '' });
  // A spell or technique carries its damage as an effect naming the target; the latest one counts.
  const applied = { ...bro, outcome: 'applied', damage: null };
  expect(combatDamageProposal({ effects: [own(4), own(9)] }, applied)).toEqual({ amount: 9, formula: '' });
  expect(combatDamageProposal({ effects: [own(6)] }, { ...applied, outcome: 'accepted' })).toEqual({ amount: 6, formula: '' });

  // Healing, area suggestions bound to no pawn, another pawn's damage and unusable amounts propose nothing.
  expect(combatDamageProposal({ effects: [{ kind: 'heal', amount: 6, targetPlacementId: 'map__bro' }] }, applied)).toBeNull();
  expect(combatDamageProposal({ effects: [{ ...own(5), targetPlacementId: null }] }, applied)).toBeNull();
  expect(combatDamageProposal({ effects: [{ ...own(5), targetPlacementId: 'map__orc' }] }, applied)).toBeNull();
  [-2, 1.5, null, Number.MAX_SAFE_INTEGER + 1].forEach(amount => (
    expect(combatDamageProposal({ effects: [own(amount)] }, applied)).toBeNull()
  ));
  // Unanswered, tied, resisted, declined or table-only targets propose nothing.
  ['waiting', 'retry'].forEach(status => expect(combatDamageProposal({}, { ...bro, status })).toBeNull());
  ['resisted', 'declined', 'manual', null].forEach(outcome => expect(combatDamageProposal({}, { ...bro, outcome })).toBeNull());
  expect(combatDamageProposal({}, undefined)).toBeNull();
});

test('a completed critical proposes its total; one still to roll at the table proposes no number but its formula', () => {
  const hit = { placementId: 'map__bro', status: 'done', outcome: 'hit', damage: 7 };
  expect(combatDamageProposal({}, { ...hit, critical: { score: 13, total: 15, tableRoll: '' } })).toEqual({ amount: 15, formula: '' });
  expect(combatDamageProposal({}, { ...hit, critical: { score: 13, total: 0 } })).toEqual({ amount: 0, formula: '' });
  expect(combatDamageProposal({}, { ...hit, critical: { score: 30, total: 9, tableRoll: 'max(0, 6 + 2d6 − 1 RD)' } }))
    .toEqual({ amount: null, formula: 'max(0, 6 + 2d6 − 1 RD)' });
  expect(combatDamageProposal({}, { ...hit, critical: { score: 13, total: null } })).toEqual({ amount: 7, formula: '' });
  // A critical never makes a target without damage eligible.
  expect(combatDamageProposal({}, { ...hit, damage: null, critical: { score: 13, total: 15 } })).toBeNull();
});

test('an owner confirms at least the proposal and leaves a critical rolled at the table to the DM, who sets any amount', () => {
  expect(combatDamageFloor({ amount: 9, formula: '' }, false)).toEqual({ minimum: 9 });
  expect(combatDamageFloor({ amount: 0, formula: '' }, false)).toEqual({ minimum: 0 });
  expect(combatDamageFloor({ amount: null, formula: 'max(0, 6 + 2d6 − 1 RD)' }, false)).toEqual({ table: true });
  expect(combatDamageFloor({ amount: 9, formula: '' }, true)).toBeNull();
  expect(combatDamageFloor({ amount: null, formula: 'max(0, 6 + 2d6 − 1 RD)' }, true)).toBeNull();
  expect(combatDamageFloor(null, false)).toBeNull();
});

test('the DM reads each defense value typed instead of the stored one; consents and older trials read nothing', () => {
  const defense = { label: 'Difesa', total: 91, bonus: 90, sides: 20, rolls: [1] };
  expect(combatDefenseOverrideLabel({ defense, overrides: {
    bonus: { value: 90, default: 2 }, reduction: { value: 0, default: 2 }, die: { value: 20, default: 12 },
  } })).toBe('Difesa 90 invece di 2 · RD 0 invece di 2 · Dado Anima d20 invece di d12');
  expect(combatDefenseOverrideLabel({ defense: { ...defense, label: 'Costituzione' }, overrides: { bonus: { value: -3, default: null } } }))
    .toBe('Costituzione −3 (nessun valore in scheda)');
  expect(combatDefenseOverrideLabel({ defense: null, overrides: { reduction: { value: 4, default: -1 } } })).toBe('RD 4 invece di −1');
  expect(combatDefenseOverrideLabel({ defense })).toBe('');
  expect(combatDefenseOverrideLabel({ defense: null, outcome: 'accepted' })).toBe('');
  expect(combatDefenseOverrideLabel({ defense, overrides: { bonus: { value: '9', default: 2 } } })).toBe('');
  expect(combatDefenseOverrideLabel(undefined)).toBe('');
});

test('applied damage includes 0, and a typed final damage is a whole number from 0 up', () => {
  expect(combatAppliedDamage({ damageApplied: { amount: 0 } })).toEqual({ amount: 0 });
  expect(combatAppliedDamage({ damageApplied: null })).toBeNull();
  expect(combatAppliedDamage({})).toBeNull();
  expect(parseCombatDamage('0')).toBe(0);
  expect(parseCombatDamage(' 12 ')).toBe(12);
  ['', '  ', '-1', '1.5', '1e3', '0x1', '+4', '12a', '9007199254740992', undefined].forEach(text => (
    expect(parseCombatDamage(text)).toBeNull()
  ));
});
