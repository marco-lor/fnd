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
