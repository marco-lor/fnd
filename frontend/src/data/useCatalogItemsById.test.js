import { act, renderHook } from '@testing-library/react';
import { useAuthSession } from '../AuthContext';
import {
  CATALOG_ITEM_QUERY_MAX_IDS,
  subscribeCatalogItems,
} from './catalogItemRepository';
import {
  CATALOG_ITEM_QUERY_STARTUP_CONCURRENCY,
  chunkCatalogItemIds,
  useCatalogItemsById,
} from './useCatalogItemsById';

jest.mock('../AuthContext', () => ({
  useAuthSession: jest.fn(),
}));

jest.mock('./catalogItemRepository', () => ({
  CATALOG_ITEM_QUERY_MAX_IDS: 10,
  subscribeCatalogItems: jest.fn(),
}));

const subscriptions = [];

const installSubscriptionMock = () => {
  subscribeCatalogItems.mockImplementation((ids, observer) => {
    const unsubscribe = jest.fn();
    subscriptions.push({
      ids,
      observer,
      unsubscribe,
    });
    return unsubscribe;
  });
};

describe('useCatalogItemsById', () => {
  beforeEach(() => {
    subscriptions.length = 0;
    jest.clearAllMocks();
    useAuthSession.mockReturnValue({
      user: { uid: 'user-1' },
      repositoryAccessGeneration: 1,
    });
    installSubscriptionMock();
  });

  test('chunks 500 stable IDs into at most 50 bounded realtime listeners', () => {
    const ids = Array.from({ length: 500 }, (_, index) => `item-${String(index).padStart(3, '0')}`);

    const chunks = chunkCatalogItemIds([...ids].reverse());

    expect(chunks).toHaveLength(50);
    expect(chunks.every((chunk) => chunk.length <= CATALOG_ITEM_QUERY_MAX_IDS)).toBe(true);
    expect(chunks.flat()).toEqual(ids);
  });

  test('bounds physical listener startup until each initial chunk settles', () => {
    const ids = Array.from({ length: 500 }, (_, index) => `item-${String(index).padStart(3, '0')}`);
    renderHook(() => useCatalogItemsById(ids));

    expect(subscriptions).toHaveLength(CATALOG_ITEM_QUERY_STARTUP_CONCURRENCY);
    expect(subscriptions.flatMap(({ ids: chunkIds }) => chunkIds)).toEqual(ids.slice(0, 40));

    act(() => { subscriptions[0].observer.next({}); });
    expect(subscriptions).toHaveLength(CATALOG_ITEM_QUERY_STARTUP_CONCURRENCY + 1);

    act(() => { subscriptions[1].observer.error(new Error('missing chunk')); });
    expect(subscriptions).toHaveLength(CATALOG_ITEM_QUERY_STARTUP_CONCURRENCY + 2);
  });

  test('settles missing documents after every initial snapshot and applies realtime updates', () => {
    const ids = Array.from({ length: 12 }, (_, index) => `item-${String(index).padStart(2, '0')}`);
    const { result } = renderHook(() => useCatalogItemsById(ids));

    expect(subscriptions).toHaveLength(2);
    expect(result.current.status).toBe('loading');

    act(() => subscriptions[0].observer.next({
      'item-00': { id: 'item-00' },
    }));
    expect(result.current.status).toBe('loading');
    expect(result.current.itemsById).toEqual({ 'item-00': { id: 'item-00' } });

    act(() => subscriptions[1].observer.next({
      'item-10': { id: 'item-10' },
    }));
    expect(result.current.status).toBe('fresh');
    expect(result.current.itemsById).toEqual({
      'item-00': { id: 'item-00' },
      'item-10': { id: 'item-10' },
    });

    act(() => subscriptions[0].observer.next({
      'item-01': { id: 'item-01', name: 'updated' },
    }));
    expect(result.current.itemsById).toEqual({
      'item-01': { id: 'item-01', name: 'updated' },
      'item-10': { id: 'item-10' },
    });
  });

  test('settles chunk errors and ignores late snapshots after an access-generation change', () => {
    const ids = Array.from({ length: 12 }, (_, index) => `item-${String(index).padStart(2, '0')}`);
    const { result, rerender } = renderHook(() => useCatalogItemsById(ids));
    const firstGeneration = [...subscriptions];
    const expectedError = new Error('catalog chunk denied');

    useAuthSession.mockReturnValue({
      user: { uid: 'user-1' },
      repositoryAccessGeneration: 2,
    });
    rerender();

    expect(subscriptions).toHaveLength(4);
    expect(firstGeneration.every(({ unsubscribe }) => unsubscribe.mock.calls.length === 1)).toBe(true);
    expect(result.current.status).toBe('loading');
    expect(result.current.error).toBeNull();

    act(() => {
      firstGeneration[0].observer.next({ stale: { id: 'stale' } });
      firstGeneration[1].observer.next({});
    });
    expect(result.current.itemsById).toEqual({});

    act(() => {
      subscriptions[2].observer.error(expectedError);
      subscriptions[3].observer.next({});
    });
    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe(expectedError);
  });

  test('surfaces a listener error after the initial snapshot and closes on unmount', () => {
    const { result, unmount } = renderHook(() => useCatalogItemsById(['item-00']));

    act(() => subscriptions[0].observer.next({ 'item-00': { id: 'item-00' } }));
    expect(result.current.status).toBe('fresh');

    const expectedError = new Error('watch closed');
    act(() => subscriptions[0].observer.error(expectedError));
    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe(expectedError);

    unmount();
    expect(subscriptions[0].unsubscribe).toHaveBeenCalledTimes(1);
  });

  test('replaces a subscription when distinct ID sets contain the former key delimiter', () => {
    const { rerender } = renderHook(
      ({ ids }) => useCatalogItemsById(ids),
      { initialProps: { ids: ['item-a', 'item-b'] } }
    );
    const firstGeneration = [...subscriptions];

    rerender({ ids: ['item-a\u001fitem-b'] });

    expect(firstGeneration).toHaveLength(1);
    expect(firstGeneration[0].unsubscribe).toHaveBeenCalledTimes(1);
    expect(subscriptions).toHaveLength(2);
    expect(subscriptions[1].ids).toEqual(['item-a\u001fitem-b']);
  });
});
