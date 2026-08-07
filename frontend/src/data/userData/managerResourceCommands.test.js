import { buildManagerResourceTotalOptions } from './managerResourceCommands';

describe('buildManagerResourceTotalOptions', () => {
  test('preserves valid barrier turn metadata for a total update', () => {
    expect(buildManagerResourceTotalOptions({
      active_turn_effect: {
        barriera: { remainingTurns: 2, totalTurns: 4 },
      },
    }, 'barriera')).toEqual({
      remainingTurns: 2,
      totalTurns: 4,
    });
  });

  test('defaults missing barrier turns to a valid zero-duration effect', () => {
    expect(buildManagerResourceTotalOptions({}, 'barriera')).toEqual({
      remainingTurns: 0,
      totalTurns: 0,
    });
  });

  test('does not send barrier-only fields for ordinary resources', () => {
    expect(buildManagerResourceTotalOptions({}, 'hp')).toEqual({});
  });
});
