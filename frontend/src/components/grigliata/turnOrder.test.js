import {
  buildShieldTurnEffect,
  computeTurnEffectRemainingTurns,
  reconcileTurnEffectsAtTurnCounter,
  resolveTurnEffectAppliesFromTurnCounter,
} from './turnOrder';

describe('turnOrder turn effects', () => {
  test('does not consume a turn effect on the applies-from turn', () => {
    const effect = {
      id: 'shield',
      kind: 'shield',
      totalTurns: 3,
      remainingTurns: 3,
      appliesFromTurnCounter: 1,
    };

    expect(computeTurnEffectRemainingTurns(effect, 1)).toBe(3);
  });

  test('decrements a turn effect on later turns and expires at zero', () => {
    const effect = {
      id: 'shield',
      kind: 'shield',
      totalTurns: 2,
      remainingTurns: 2,
      appliesFromTurnCounter: 1,
    };

    expect(computeTurnEffectRemainingTurns(effect, 2)).toBe(1);

    expect(reconcileTurnEffectsAtTurnCounter({
      turnCounter: 3,
      turnEffects: [effect],
    })).toEqual({
      turnEffects: [],
      expiredEffects: [{
        ...effect,
        remainingTurns: 0,
      }],
    });
  });

  test('buildShieldTurnEffect preserves the current remaining turns at the current counter', () => {
    const appliesFromTurnCounter = resolveTurnEffectAppliesFromTurnCounter({
      totalTurns: 3,
      remainingTurns: 2,
      turnCounter: 5,
    });

    expect(appliesFromTurnCounter).toBe(4);

    const effect = buildShieldTurnEffect({
      totalTurns: 3,
      remainingTurns: 2,
      turnCounter: 5,
    });

    expect(effect).toEqual({
      id: 'shield',
      kind: 'shield',
      totalTurns: 3,
      remainingTurns: 2,
      appliesFromTurnCounter: 4,
    });
    expect(computeTurnEffectRemainingTurns(effect, 5)).toBe(2);
  });
});
