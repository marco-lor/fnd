import { USER_DATA_DOMAINS } from './domainSchema';
import { composeManagerUser } from './managerUserData';

jest.mock('../../AuthContext', () => ({
  useAuthSession: () => ({ repositoryAccessGeneration: 0 }),
}));

jest.mock('../userDirectoryRepository', () => ({
  USER_DIRECTORY_PAGE_SIZE: 50,
  getUserDirectoryPage: jest.fn(),
  subscribeUserDirectoryFirstPage: jest.fn(),
}));

jest.mock('./userDataRepository', () => ({
  subscribeUserDomain: jest.fn(),
}));

describe('composeManagerUser', () => {
  test('composes the legacy-shaped dashboard view from canonical domains', () => {
    const user = composeManagerUser(
      {
        id: 'user-1',
        role: 'player',
        label: 'Aria',
        characterId: 'Aria',
      },
      {
        [USER_DATA_DOMAINS.PROFILE]: {
          role: 'player',
          email: 'private@example.test',
          characterId: 'Aria',
        },
        [USER_DATA_DOMAINS.PROGRESSION]: {
          stats: {
            level: 4,
            combatTokensAvailable: 2,
          },
          Parametri: { Forza: { Base: 3 } },
        },
        [USER_DATA_DOMAINS.RESOURCES]: {
          stats: {
            gold: 9,
            hpCurrent: 7,
            hpTotal: 10,
          },
        },
        [USER_DATA_DOMAINS.SETTINGS]: {
          settings: { lock_param_base: true },
        },
        [USER_DATA_DOMAINS.PROFILE_CONTENT]: {
          conoscenze: { Storia: { livello: 'Base' } },
          lingue: { Comune: 'known' },
          professioni: {},
        },
        [USER_DATA_DOMAINS.INVENTORY]: [{ id: 'item-1' }],
        [USER_DATA_DOMAINS.SPELLS]: {
          Luce: { _task05ContentId: 'spell-1' },
        },
        [USER_DATA_DOMAINS.TECHNIQUES]: {
          Parata: { _task05ContentId: 'tech-1' },
        },
      }
    );

    expect(user).toEqual(expect.objectContaining({
      id: 'user-1',
      label: 'Aria',
      characterId: 'Aria',
      stats: expect.objectContaining({
        level: 4,
        combatTokensAvailable: 2,
        gold: 9,
        hpCurrent: 7,
      }),
      settings: { lock_param_base: true },
      conoscenze: { Storia: { livello: 'Base' } },
      lingue: { Comune: 'known' },
      inventory: [{ id: 'item-1' }],
    }));
    expect(user.spells.Luce._task05ContentId).toBe('spell-1');
    expect(user.tecniche.Parata._task05ContentId).toBe('tech-1');
  });
});
