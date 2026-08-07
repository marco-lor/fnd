import { subscribeCatalogItem } from './catalogItemRepository';
import {
  __resetRepositoryRuntimeForTests,
  setRepositoryActor,
} from './repositoryRuntime';
import {
  doc,
  labelFirestoreTarget,
  onSnapshot,
} from '../performance/firestore';

jest.mock('../components/firebaseConfig', () => ({ db: {} }));

jest.mock('../performance/firestore', () => ({
  doc: jest.fn((_db, ...segments) => ({ path: segments.join('/') })),
  labelFirestoreTarget: jest.fn((target) => target),
  onSnapshot: jest.fn(),
}));

describe('catalogItemRepository', () => {
  beforeEach(() => {
    __resetRepositoryRuntimeForTests();
    jest.clearAllMocks();
    setRepositoryActor('user-1');
    doc.mockImplementation((_db, ...segments) => ({ path: segments.join('/') }));
    labelFirestoreTarget.mockImplementation((target) => target);
  });

  test('shares one actor-scoped catalog listener across Home consumers', async () => {
    let publish;
    const physicalUnsubscribe = jest.fn();
    onSnapshot.mockImplementation((_target, next) => {
      publish = next;
      return physicalUnsubscribe;
    });
    const first = jest.fn();
    const second = jest.fn();

    const unsubscribeFirst = subscribeCatalogItem('sword-1', first);
    const unsubscribeSecond = subscribeCatalogItem('sword-1', second);

    expect(onSnapshot).toHaveBeenCalledTimes(1);
    expect(doc).toHaveBeenCalledWith(expect.anything(), 'items', 'sword-1');
    expect(labelFirestoreTarget).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'items/sword-1' }),
      'catalog.item.subscribe.v1'
    );

    const media = { assetId: `m_${'a'.repeat(40)}` };
    publish({
      exists: () => true,
      data: () => ({ id: 'untrusted-id', General: { Nome: 'Spada' }, media }),
    });

    expect(first).toHaveBeenCalledWith(expect.objectContaining({ id: 'sword-1', media }));
    expect(second).toHaveBeenCalledWith(expect.objectContaining({ id: 'sword-1', media }));

    unsubscribeFirst();
    unsubscribeSecond();
    await Promise.resolve();
    expect(physicalUnsubscribe).toHaveBeenCalledTimes(1);
  });

  test('publishes null for a deleted or inaccessible catalog document snapshot', () => {
    let publish;
    onSnapshot.mockImplementation((_target, next) => {
      publish = next;
      return jest.fn();
    });
    const observer = jest.fn();
    subscribeCatalogItem('retired-item', observer);

    publish({ exists: () => false });

    expect(observer).toHaveBeenCalledWith(null);
  });
});
