import {
  normalizeTokenStatuses,
  splitTokenStatusesForDisplay,
  toggleTokenStatus,
} from './tokenStatuses';

describe('tokenStatuses helpers', () => {
  test('drops invalid status ids during normalization', () => {
    expect(normalizeTokenStatuses([
      'burning',
      'unknown-status',
      '',
      null,
      'sleeping',
    ])).toEqual(['burning', 'sleeping']);
  });

  test('removes duplicate status ids while preserving order', () => {
    expect(normalizeTokenStatuses([
      'sleeping',
      'burning',
      'sleeping',
      'burning',
      'marked',
    ])).toEqual(['sleeping', 'burning', 'marked']);
  });

  test('toggle-on inserts a new status at the front of the stack', () => {
    expect(toggleTokenStatus(['burning', 'sleeping'], 'marked')).toEqual([
      'marked',
      'burning',
      'sleeping',
    ]);
  });

  test('toggle-off removes an existing status without reordering the remaining stack', () => {
    expect(toggleTokenStatus(['burning', 'sleeping', 'marked'], 'sleeping')).toEqual([
      'burning',
      'marked',
    ]);
  });

  test('splits visible badges from overflow statuses', () => {
    expect(splitTokenStatusesForDisplay([
      'burning',
      'sleeping',
      'marked',
      'poisoned',
      'slowed',
    ], 3)).toEqual({
      visibleStatuses: ['burning', 'sleeping', 'marked'],
      overflowStatuses: ['poisoned', 'slowed'],
      overflowCount: 2,
    });
  });
});
