import { renderHook, waitFor } from '@testing-library/react';
import { USER_DATA_DOMAINS } from './domainSchema';
import { composeManagerUser, useManagerUserData } from './managerUserData';
import {
  getUserDirectoryPage,
  subscribeUserDirectoryPage,
} from '../userDirectoryRepository';
import { subscribeUserDomain } from './userDataRepository';

jest.mock('../../AuthContext', () => ({
  useAuthSession: () => ({ repositoryAccessGeneration: 0 }),
}));

jest.mock('../userDirectoryRepository', () => ({
  USER_DIRECTORY_PAGE_SIZE: 50,
  getUserDirectoryPage: jest.fn(),
  subscribeUserDirectoryPage: jest.fn(),
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

  test('keeps each manager page and its domain subscriptions explicitly bounded', async () => {
    const cursor = {
      version: 1,
      queryKey: 'directory.users.by-role.player.page.v1',
      sortValues: ['performance hero 1'],
      documentId: 'player-1',
    };
    const nextCursor = {
      version: 1,
      queryKey: 'directory.users.by-role.player.page.v1',
      sortValues: ['performance hero 10'],
      documentId: 'player-10',
    };
    getUserDirectoryPage.mockResolvedValue({
      items: [{
        id: 'player-10',
        role: 'player',
        label: 'Performance Hero 10',
        characterId: 'Performance Hero 10',
      }],
      cursor: nextCursor,
      hasMore: true,
    });
    const unsubscribeDirectory = jest.fn();
    subscribeUserDirectoryPage.mockReturnValue(unsubscribeDirectory);
    const domainUnsubscribes = [];
    subscribeUserDomain.mockImplementation((_uid, domain, observer) => {
      const unsubscribe = jest.fn();
      domainUnsubscribes.push(unsubscribe);
      observer.next(domain === USER_DATA_DOMAINS.INVENTORY ? [] : {});
      return unsubscribe;
    });

    const {result, unmount} = renderHook(() => useManagerUserData(true, {
      cursor,
      pageSize: 10,
    }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getUserDirectoryPage).toHaveBeenCalledWith({
      role: 'player',
      cursor,
      pageSize: 10,
    });
    expect(subscribeUserDirectoryPage).toHaveBeenCalledWith(
      expect.objectContaining({next: expect.any(Function), error: expect.any(Function)}),
      {role: 'player', cursor, pageSize: 10}
    );
    expect(subscribeUserDomain).toHaveBeenCalledTimes(8);
    expect(result.current).toEqual(expect.objectContaining({
      hasMore: true,
      nextCursor,
      pageSize: 10,
    }));

    unmount();
    expect(unsubscribeDirectory).toHaveBeenCalledTimes(1);
    domainUnsubscribes.forEach((unsubscribe) => {
      expect(unsubscribe).toHaveBeenCalledTimes(1);
    });
  });
});
