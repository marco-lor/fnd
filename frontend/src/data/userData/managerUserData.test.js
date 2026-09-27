import { act, renderHook, waitFor } from '@testing-library/react';
import { USER_DATA_DOMAINS } from './domainSchema';
import { composeManagerUser, useManagerUserData, useManagerUserDetail } from './managerUserData';
import {
  getUserDirectoryPage,
  subscribeUserDirectoryPage,
} from '../userDirectoryRepository';
import { subscribeManagerSummary } from './managerSummaryRepository';
import { subscribeUserDomain } from './userDataRepository';

jest.mock('../../AuthContext', () => ({
  useAuthSession: () => ({ repositoryAccessGeneration: 0 }),
}));

jest.mock('../userDirectoryRepository', () => ({
  USER_DIRECTORY_PAGE_SIZE: 50,
  getUserDirectoryPage: jest.fn(),
  subscribeUserDirectoryPage: jest.fn(),
}));

jest.mock('./managerSummaryRepository', () => ({ subscribeManagerSummary: jest.fn() }));
jest.mock('./userDataRepository', () => ({
  subscribeUserDomain: jest.fn(),
}));

describe('composeManagerUser', () => {
  beforeEach(() => jest.clearAllMocks());
  test('a missing summary remains an actionable error after later directory publications', async () => {
    subscribeUserDirectoryPage.mockImplementation((observer) => {
      observer.next({items: [{id: 'missing', label: 'Missing'}]});
      return jest.fn();
    });
    subscribeManagerSummary.mockImplementation((_uid, observer) => {
      observer.error(new Error('Run the summary backfill.'));
      return jest.fn();
    });
    const {result} = renderHook(() => useManagerUserData(true));
    await waitFor(() => expect(result.current.unavailableUsers?.[0]?.error.message).toMatch(/backfill/));
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(subscribeUserDomain).not.toHaveBeenCalled();
  });
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

  test('one bounded directory subscription, compact summaries and stable rows', async () => {
    const entries = [{id: 'a', label: 'Alba'}, {id: 'b', label: 'Bora'}];
    const directoryStop = jest.fn();
    const observers = {};
    const stops = [];
    subscribeUserDirectoryPage.mockImplementation((observer) => {
      observer.next({items: entries, hasMore: true, cursor: {version: 1}});
      return directoryStop;
    });
    subscribeManagerSummary.mockImplementation((uid, observer) => {
      observers[uid] = observer;
      observer.next({stats: {level: 1}, settings: {}});
      const stop = jest.fn(); stops.push(stop); return stop;
    });
    const {result, unmount} = renderHook(() => useManagerUserData(true, {search: 'al', pageSize: 10}));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getUserDirectoryPage).not.toHaveBeenCalled();
    expect(subscribeUserDomain).not.toHaveBeenCalled();
    expect(subscribeUserDirectoryPage).toHaveBeenCalledWith(expect.any(Object), {role: 'player', search: 'al', pageSize: 10, cursor: null});
    const original = result.current.users;
    act(() => observers.a.next({stats: {level: 2}, settings: {}}));
    expect(result.current.users[0]).not.toBe(original[0]);
    expect(result.current.users[1]).toBe(original[1]);
    const unchanged = result.current.users;
    act(() => observers.a.next({stats: {level: 2}, settings: {}}));
    expect(result.current.users).toBe(unchanged);
    unmount(); expect(directoryStop).toHaveBeenCalledTimes(1);
    stops.forEach((stop) => expect(stop).toHaveBeenCalledTimes(1));
  });

  test('errors belong to their UID; unrelated successes cannot hide them and removal clears them', () => {
    let directory;
    const observers = {};
    const stops = {};
    const entries = ['a', 'b', 'c'].map((id) => ({id, label: id}));
    subscribeUserDirectoryPage.mockImplementation((observer) => { directory = observer; observer.next({items: entries}); return jest.fn(); });
    subscribeManagerSummary.mockImplementation((uid, observer) => { observers[uid] = observer; stops[uid] = jest.fn(); return stops[uid]; });
    const {result} = renderHook(() => useManagerUserData(true));
    act(() => { observers.a.error(new Error('a missing')); observers.b.error(new Error('b denied')); });
    act(() => observers.c.next({stats: {}, settings: {}}));
    expect(result.current.error).toBeNull();
    expect(result.current.unavailableUsers.map(({id, error}) => [id, error.message])).toEqual([
      ['a', 'a missing'], ['b', 'b denied'],
    ]);
    expect(result.current.users.map(({id}) => id)).toEqual(['c']);
    expect(result.current.loading).toBe(false);
    act(() => observers.a.next({stats: {}, settings: {}}));
    expect(result.current.unavailableUsers.map(({id}) => id)).toEqual(['b']);
    const stableA = result.current.users.find((user) => user.id === 'a');
    act(() => directory.next({items: [entries[0], entries[2]]}));
    expect(result.current.error).toBeNull();
    expect(result.current.unavailableUsers).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.users[0]).toBe(stableA);
    expect(stops.b).toHaveBeenCalledTimes(1);
    act(() => observers.b.error(new Error('late removed error')));
    expect(result.current.error).toBeNull();
  });

  test('a denied summary removes stale controls without blocking healthy players, including during retry', () => {
    const observers = {};
    subscribeUserDirectoryPage.mockImplementation((observer) => {
      observer.next({items: [{id: 'deleting', label: 'Deleting'}, {id: 'healthy', label: 'Healthy'}]});
      return jest.fn();
    });
    subscribeManagerSummary.mockImplementation((uid, observer) => {
      observers[uid] = observer;
      observer.next({stats: {level: 7}, settings: {}});
      return jest.fn();
    });
    const {result} = renderHook(() => useManagerUserData(true));
    const healthy = result.current.users[1];
    act(() => observers.deleting.error(new Error('permission-denied')));
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.users).toEqual([healthy]);
    expect(result.current.users[0]).toBe(healthy);
    expect(result.current.unavailableUsers[0]).toMatchObject({id: 'deleting', label: 'Deleting'});
    subscribeManagerSummary.mockImplementation((uid, observer) => { observers[uid] = observer; return jest.fn(); });
    act(() => result.current.retry());
    expect(result.current.users).toEqual([healthy]);
    expect(result.current.loading).toBe(false);
    act(() => observers.deleting.next({stats: {level: 8}, settings: {}}));
    expect(result.current.unavailableUsers).toEqual([]);
    expect(result.current.users[1]).toBe(healthy);
  });

  test('retry restarts only failed summary owners and separately recovers the directory', () => {
    const directories = [];
    const observers = {};
    const stops = [];
    subscribeUserDirectoryPage.mockImplementation((observer) => { directories.push(observer); observer.next({items: [{id: 'a'}, {id: 'b'}]}); return jest.fn(); });
    subscribeManagerSummary.mockImplementation((uid, observer) => {
      observers[uid] = observer; observer.next({stats: {}, settings: {}});
      const stop = jest.fn(); stops.push(stop); return stop;
    });
    const {result} = renderHook(() => useManagerUserData(true));
    const stableB = result.current.users[1];
    const staleA = observers.a;
    act(() => observers.a.error(new Error('terminal a')));
    act(() => result.current.retry());
    expect(subscribeManagerSummary).toHaveBeenCalledTimes(3);
    expect(subscribeUserDirectoryPage).toHaveBeenCalledTimes(1);
    expect(stops[0]).toHaveBeenCalledTimes(1);
    expect(stops[1]).not.toHaveBeenCalled();
    expect(result.current.error).toBeNull();
    expect(result.current.users[1]).toBe(stableB);
    act(() => staleA.error(new Error('stale attempt')));
    expect(result.current.error).toBeNull();
    act(() => directories[0].error(new Error('directory failed')));
    act(() => observers.b.next({stats: {level: 2}, settings: {}}));
    expect(result.current.error.message).toBe('directory failed');
    act(() => result.current.retry());
    expect(subscribeUserDirectoryPage).toHaveBeenCalledTimes(2);
    expect(subscribeManagerSummary).toHaveBeenCalledTimes(3);
    expect(result.current.error).toBeNull();
  });

  test('one detail error survives other domain successes until that domain recovers or retries', () => {
    const observers = {};
    const stops = [];
    subscribeUserDomain.mockImplementation((_uid, domain, observer) => { observers[domain] = observer; const stop = jest.fn(); stops.push(stop); return stop; });
    const {result, unmount} = renderHook(() => useManagerUserDetail({id: 'a'}, true));
    act(() => observers.inventory.error(new Error('inventory denied')));
    act(() => { observers.profileContent.next({}); observers.spells.next({}); observers.techniques.next({}); });
    expect(result.current.error.message).toBe('inventory denied');
    expect(result.current.loading).toBe(false);
    act(() => result.current.retry());
    expect(subscribeUserDomain).toHaveBeenCalledTimes(8);
    stops.slice(0, 4).forEach((stop) => expect(stop).toHaveBeenCalledTimes(1));
    act(() => { observers.profileContent.next({}); observers.spells.next({}); observers.techniques.next({}); observers.inventory.next([]); });
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
    unmount(); stops.forEach((stop) => expect(stop).toHaveBeenCalledTimes(1));
  });
});
