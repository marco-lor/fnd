import { canTargetToken, combatDamageBand, combatRoleRange, withinCombatRange } from './combatTargeting';

const origin = { placementId: 'map__nyx', col: 0, row: 0, sizeSquares: 1 };
const at = (col, extra) => ({ placementId: 'map__' + col, col, row: 0, sizeSquares: 1, ...extra });

test('each ordered role is measured against its own range from roleRangesFt', () => {
  const leone = { mode: 'multiple', rangeFt: 5, allowSelf: true, targetRoles: ['Bersaglio', 'Alleato'], roleRangesFt: [5, 10] };
  const unlimited = { ...leone, roleRangesFt: [5, null] };
  expect(combatRoleRange(leone, 0)).toBe(5);
  expect(combatRoleRange(leone, 1)).toBe(10);
  expect(combatRoleRange(unlimited, 1)).toBeNull();
  expect(combatRoleRange({ rangeFt: 20, roleRangesFt: null }, 1)).toBe(20);

  expect(canTargetToken(origin, at(2), leone, 0)).toBe(false);
  expect(canTargetToken(origin, at(2), leone, 1)).toBe(true);
  expect(canTargetToken(origin, at(5), leone, 1)).toBe(false);
  expect(canTargetToken(origin, at(19), unlimited, 1)).toBe(true);
  expect(canTargetToken(origin, origin, leone, 0)).toBe(false);
  expect(canTargetToken(origin, origin, leone, 1)).toBe(true);
});

test('only the board marker makes a target fallen: PF never change who can be chosen', () => {
  const sword = { mode: 'single', rangeFt: 5 };
  const revive = { ...sword, allowDead: true, requireDead: true };
  const downed = at(1, { hp: 0, stats: { hpCurrent: 0 } });
  const marked = at(1, { isDead: true, hp: 12, stats: { hpCurrent: 12 } });
  expect(canTargetToken(origin, downed, sword)).toBe(true);
  expect(canTargetToken(origin, downed, revive)).toBe(false);
  expect(canTargetToken(origin, marked, sword)).toBe(false);
  expect(canTargetToken(origin, marked, revive)).toBe(true);
});

test('ally actions offer only allies, as the server decides: own pawns on the same side and any player character', () => {
  const guard = { mode: 'single', rangeFt: 30, relation: 'ally' };
  const mend = { ...guard, relation: 'selfOrAlly', allowSelf: true };
  const sword = { mode: 'single', rangeFt: 30 };
  const nyx = { ...origin, ownerUid: 'nyx', tokenType: 'character' };
  const kai = at(1, { ownerUid: 'kai', tokenType: 'character' });
  const summon = at(1, { ownerUid: 'nyx', tokenType: 'custom' });
  // A player's board reads another account's foe or custom pawn as `custom`: both stay out.
  const unknown = at(1, { ownerUid: 'dm', tokenType: 'custom' });
  const companion = at(1, { ownerUid: 'kai', tokenType: 'custom' });
  expect([kai, summon, unknown, companion].map(token => canTargetToken(nyx, token, guard))).toEqual([true, true, false, false]);
  expect(canTargetToken(nyx, nyx, guard)).toBe(false);
  expect(canTargetToken(nyx, nyx, mend)).toBe(true);
  expect(canTargetToken(nyx, unknown, mend)).toBe(false);
  expect(canTargetToken(nyx, unknown, sword)).toBe(true);

  // The DM is a player too: their character stands with the party, apart from the foes they run.
  const dmCharacter = { ...origin, ownerUid: 'dm', tokenType: 'character' };
  const wolf = at(1, { ownerUid: 'dm', tokenType: 'foe' });
  const bear = at(2, { ownerUid: 'dm', tokenType: 'foe' });
  const npc = at(1, { ownerUid: 'dm', tokenType: 'custom' });
  expect([kai, npc, wolf].map(token => canTargetToken(dmCharacter, token, guard))).toEqual([true, true, false]);
  expect([bear, npc, dmCharacter, kai].map(token => canTargetToken(wolf, token, guard))).toEqual([true, false, false, false]);
});

test('a farthest-anchored footprint must fit around a token too, as the server measures it', () => {
  const cone = { mode: 'multiple', rangeFt: 15, area: { shape: 'cone', sideSquares: 3, anchor: 'farthest' } };
  expect(withinCombatRange(origin, at(2), cone)).toBe(true);
  expect(withinCombatRange(origin, at(3), cone)).toBe(false);
  expect(canTargetToken(origin, at(3), cone)).toBe(false);
  expect(withinCombatRange(origin, at(3), { ...cone, area: { ...cone.area, anchor: 'center' } })).toBe(true);
});

test('a damage band is chosen by inclusive distance and a gap is left to the table', () => {
  const action = { damageBands: [
    { minFt: 0, maxFt: 5, expr: '4d6', note: 'Attacco Furtivo' },
    { minFt: 15, maxFt: 30, expr: '2d6', note: '' },
  ] };
  expect(combatDamageBand(action, 5)).toBe(action.damageBands[0]);
  expect(combatDamageBand(action, 15)).toBe(action.damageBands[1]);
  expect(combatDamageBand(action, 10)).toBeNull();
  expect(combatDamageBand({ damageBands: [] }, 5)).toBeNull();
  expect(combatDamageBand({}, 5)).toBeNull();
});
