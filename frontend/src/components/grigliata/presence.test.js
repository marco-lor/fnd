import {
  filterActiveGrigliataPagePresence,
  GRIGLIATA_PAGE_PRESENCE_STALE_MS,
} from './presence';
import { DEFAULT_GRIGLIATA_DRAW_COLOR_KEY } from './constants';

describe('presence', () => {
  test('filters stale viewers and viewers without character names', () => {
    const now = Date.UTC(2026, 3, 25, 12, 0, 0);

    expect(filterActiveGrigliataPagePresence([
      {
        ownerUid: 'fresh-user',
        characterId: 'Nyra',
        colorKey: 'ion-cyan',
        lastSeenAt: { toMillis: () => now - 10_000 },
        updatedBy: 'fresh-user',
      },
      {
        ownerUid: 'stale-user',
        characterId: 'Old Mage',
        colorKey: 'nova-teal',
        lastSeenAt: { toMillis: () => now - GRIGLIATA_PAGE_PRESENCE_STALE_MS - 1 },
        updatedBy: 'stale-user',
      },
      {
        ownerUid: 'blank-name-user',
        characterId: '   ',
        colorKey: 'solar-amber',
        lastSeenAt: { toMillis: () => now - 10_000 },
        updatedBy: 'blank-name-user',
      },
    ], now)).toEqual([
      expect.objectContaining({
        ownerUid: 'fresh-user',
        characterId: 'Nyra',
        colorKey: 'ion-cyan',
      }),
    ]);
  });

  test('resolves invalid drawing colors to the default color', () => {
    const now = Date.UTC(2026, 3, 25, 12, 0, 0);

    expect(filterActiveGrigliataPagePresence([
      {
        ownerUid: 'user-1',
        characterId: 'Kael',
        colorKey: 'not-a-color',
        lastSeenAt: now,
        updatedBy: 'user-1',
      },
    ], now)).toEqual([
      expect.objectContaining({
        ownerUid: 'user-1',
        characterId: 'Kael',
        colorKey: DEFAULT_GRIGLIATA_DRAW_COLOR_KEY,
      }),
    ]);
  });
});
