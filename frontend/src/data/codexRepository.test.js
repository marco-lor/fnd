import {
  getCodex,
  patchCodex,
  subscribeCodex,
} from './codexRepository';
import {
  __resetRepositoryRuntimeForTests,
  RepositorySessionChangedError,
  setRepositoryActor,
} from './repositoryRuntime';
import {
  doc,
  getDoc,
  labelFirestoreTarget,
  onSnapshot,
  updateDoc,
} from '../performance/firestore';

jest.mock('../components/firebaseConfig', () => ({ db: {} }));

jest.mock('../performance/firestore', () => ({
  doc: jest.fn((_db, ...segments) => ({ path: segments.join('/') })),
  getDoc: jest.fn(),
  labelFirestoreTarget: jest.fn((target) => target),
  onSnapshot: jest.fn(),
  updateDoc: jest.fn(),
}));

const snapshot = (data) => ({
  exists: () => data !== null,
  data: () => data,
});

describe('codexRepository', () => {
  beforeEach(() => {
    __resetRepositoryRuntimeForTests();
    jest.clearAllMocks();
    doc.mockImplementation((_db, ...segments) => ({ path: segments.join('/') }));
    labelFirestoreTarget.mockImplementation((target) => target);
  });

  test('deduplicates reads and returns normalized data or null', async () => {
    const codex = { Razze: { Umana: 'Versatile' } };
    getDoc.mockResolvedValueOnce(snapshot(codex));

    const [left, right] = await Promise.all([getCodex(), getCodex()]);
    expect(left).toBe(codex);
    expect(right).toBe(codex);
    expect(getDoc).toHaveBeenCalledTimes(1);
    expect(labelFirestoreTarget).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'utils/codex' }),
      'codex.document.get.v1'
    );

    __resetRepositoryRuntimeForTests();
    getDoc.mockResolvedValueOnce(snapshot(null));
    await expect(getCodex()).resolves.toBeNull();
  });

  test('retries bounded auth and profile session transitions without publishing stale data', async () => {
    const resolvers = [];
    getDoc.mockImplementation(() => new Promise((resolve) => resolvers.push(resolve)));
    const takeNextResolver = async () => {
      for (let attempt = 0; attempt < 10 && resolvers.length === 0; attempt += 1) {
        await Promise.resolve();
      }
      const resolver = resolvers.shift();
      if (!resolver) throw new Error('Codex retry did not start another read.');
      return resolver;
    };

    setRepositoryActor('new-player');
    const pending = getCodex();
    const resolveAuthRead = await takeNextResolver();
    setRepositoryActor('new-player');
    resolveAuthRead(snapshot({ Razze: { StaleAuth: 'old' } }));

    const resolveProfileRead = await takeNextResolver();
    setRepositoryActor('new-player');
    resolveProfileRead(snapshot({ Razze: { StaleProfile: 'old' } }));

    const current = { Razze: { Evocazione: 'current' } };
    const resolveCurrentRead = await takeNextResolver();
    resolveCurrentRead(snapshot(current));
    await expect(pending).resolves.toBe(current);
    expect(getDoc).toHaveBeenCalledTimes(3);
  });

  test('does not retry a pending Codex read under a different account', async () => {
    let resolveFirstAccountRead;
    getDoc.mockImplementationOnce(() => new Promise((resolve) => {
      resolveFirstAccountRead = resolve;
    }));
    setRepositoryActor('first-user');

    const pending = getCodex();
    await Promise.resolve();
    await Promise.resolve();
    setRepositoryActor('second-user');
    resolveFirstAccountRead(snapshot({ Razze: { Private: 'first-user' } }));

    await expect(pending).rejects.toBeInstanceOf(RepositorySessionChangedError);
    expect(getDoc).toHaveBeenCalledTimes(1);
  });

  test('shares one physical listener, replays the latest value, and tears down once', async () => {
    const physicalUnsubscribe = jest.fn();
    let listenerNext;
    onSnapshot.mockImplementation((_target, next) => {
      listenerNext = next;
      return physicalUnsubscribe;
    });
    const first = jest.fn();
    const second = jest.fn();

    const unsubscribeFirst = subscribeCodex(first);
    listenerNext(snapshot({ lingue: { Elfico: 'Antica' } }));
    const unsubscribeSecond = subscribeCodex(second);

    expect(onSnapshot).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledWith({ lingue: { Elfico: 'Antica' } });
    unsubscribeFirst();
    unsubscribeSecond();
    unsubscribeSecond();
    await Promise.resolve();
    expect(physicalUnsubscribe).toHaveBeenCalledTimes(1);
  });

  test('passes dotted and delete sentinels unchanged and invalidates reads only after success', async () => {
    const oldCodex = { lingue: { Elfico: 'Old' } };
    const newCodex = { lingue: { Elfico: 'New' } };
    getDoc
      .mockResolvedValueOnce(snapshot(oldCodex))
      .mockResolvedValueOnce(snapshot(newCodex));
    updateDoc.mockResolvedValueOnce('patched');
    await expect(getCodex()).resolves.toBe(oldCodex);

    const deleteSentinel = { __type: 'deleteField' };
    const fields = {
      'lingue.Elfico': 'New',
      'lingue.Obsoleta': deleteSentinel,
    };
    await expect(patchCodex(fields)).resolves.toBe('patched');
    expect(updateDoc.mock.calls[0][1]).toBe(fields);
    expect(updateDoc.mock.calls[0][1]['lingue.Obsoleta']).toBe(deleteSentinel);
    await expect(getCodex()).resolves.toBe(newCodex);
    expect(getDoc).toHaveBeenCalledTimes(2);

    updateDoc.mockRejectedValueOnce(new Error('denied'));
    await expect(patchCodex({ 'lingue.Elfico': 'Denied' })).rejects.toThrow('denied');
    await expect(getCodex()).resolves.toBe(newCodex);
    expect(getDoc).toHaveBeenCalledTimes(2);
  });
});
