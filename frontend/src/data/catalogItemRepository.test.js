import {
  CATALOG_ITEM_QUERY_MAX_IDS,
  subscribeCatalogItems,
} from './catalogItemRepository';
import {
  __resetRepositoryRuntimeForTests,
  setRepositoryActor,
} from './repositoryRuntime';
import {
  collection,
  documentId,
  labelFirestoreTarget,
  onSnapshot,
  query,
  where,
} from '../performance/firestore';

jest.mock('../components/firebaseConfig', () => ({ db: {} }));

jest.mock('../performance/firestore', () => ({
  collection: jest.fn((_db, ...segments) => ({ path: segments.join('/') })),
  documentId: jest.fn(() => '__name__'),
  labelFirestoreTarget: jest.fn((target) => target),
  onSnapshot: jest.fn(),
  query: jest.fn((base, ...constraints) => ({ base, constraints })),
  where: jest.fn((field, operator, value) => ({ field, operator, value })),
}));

describe('catalogItemRepository', () => {
  beforeEach(() => {
    __resetRepositoryRuntimeForTests();
    jest.clearAllMocks();
    setRepositoryActor('user-1');
    collection.mockImplementation((_db, ...segments) => ({ path: segments.join('/') }));
    documentId.mockReturnValue('__name__');
    labelFirestoreTarget.mockImplementation((target) => target);
    query.mockImplementation((base, ...constraints) => ({ base, constraints }));
    where.mockImplementation((field, operator, value) => ({ field, operator, value }));
  });

  test('shares one actor-scoped sorted query listener across Home consumers', async () => {
    let publish;
    const physicalUnsubscribe = jest.fn();
    onSnapshot.mockImplementation((_target, next) => {
      publish = next;
      return physicalUnsubscribe;
    });
    const first = jest.fn();
    const second = jest.fn();

    const unsubscribeFirst = subscribeCatalogItems(
      ['sword-1', 'shield-1', 'sword-1'],
      first
    );
    const unsubscribeSecond = subscribeCatalogItems(
      ['shield-1', 'sword-1', 'shield-1'],
      second
    );

    expect(onSnapshot).toHaveBeenCalledTimes(1);
    expect(collection).toHaveBeenCalledWith(expect.anything(), 'items');
    expect(where).toHaveBeenCalledWith(
      '__name__',
      'in',
      ['shield-1', 'sword-1']
    );
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'items' }),
      expect.objectContaining({ operator: 'in' })
    );
    expect(labelFirestoreTarget).toHaveBeenCalledWith(
      expect.objectContaining({ base: expect.objectContaining({ path: 'items' }) }),
      'catalog.items-batch.subscribe.v1'
    );

    const media = { assetId: `m_${'a'.repeat(40)}` };
    publish({
      docs: [
        {
          id: 'sword-1',
          data: () => ({ id: 'untrusted-id', General: { Nome: 'Spada' }, media }),
        },
        {
          id: 'unexpected-item',
          data: () => ({ General: { Nome: 'Not requested' } }),
        },
      ],
    });
    const expected = {
      'sword-1': expect.objectContaining({ id: 'sword-1', media }),
    };
    expect(first).toHaveBeenCalledWith(expected);
    expect(second).toHaveBeenCalledWith(expected);

    unsubscribeFirst();
    await Promise.resolve();
    expect(physicalUnsubscribe).not.toHaveBeenCalled();
    unsubscribeSecond();
    await Promise.resolve();
    expect(physicalUnsubscribe).toHaveBeenCalledTimes(1);
  });

  test('publishes an empty map for missing documents and fences an actor transition', () => {
    let publish;
    const physicalUnsubscribe = jest.fn();
    onSnapshot.mockImplementation((_target, next) => {
      publish = next;
      return physicalUnsubscribe;
    });
    const observer = jest.fn();
    subscribeCatalogItems(['retired-item'], observer);

    publish({ docs: [] });
    expect(observer).toHaveBeenLastCalledWith({});

    setRepositoryActor('user-2');
    expect(physicalUnsubscribe).toHaveBeenCalledTimes(1);
    publish({
      docs: [{ id: 'retired-item', data: () => ({ General: { Nome: 'Stale' } }) }],
    });
    expect(observer).toHaveBeenCalledTimes(1);
  });

  test('rejects empty, unsafe, or oversized query batches before opening a listener', () => {
    expect(() => subscribeCatalogItems([], jest.fn())).toThrow(RangeError);
    expect(() => subscribeCatalogItems(['bad/id'], jest.fn())).toThrow(TypeError);
    expect(() => subscribeCatalogItems(
      Array.from({ length: CATALOG_ITEM_QUERY_MAX_IDS + 1 }, (_, index) => `item-${index}`),
      jest.fn()
    )).toThrow(RangeError);

    expect(onSnapshot).not.toHaveBeenCalled();
  });

  test('does not alias distinct ID sets that contain the former key delimiter', () => {
    onSnapshot.mockReturnValue(jest.fn());

    subscribeCatalogItems(['item-a', 'item-b'], jest.fn());
    subscribeCatalogItems(['item-a\u001fitem-b'], jest.fn());

    expect(onSnapshot).toHaveBeenCalledTimes(2);
    expect(where.mock.calls.map(([, , ids]) => ids)).toEqual([
      ['item-a', 'item-b'],
      ['item-a\u001fitem-b'],
    ]);
  });
});
