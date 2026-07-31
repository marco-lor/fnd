import {
  __buildUserDirectoryQuery,
  getUserDirectoryPage,
  normalizeUserDirectoryDocument,
  subscribeUserDirectoryFirstPage,
  USER_DIRECTORY_PAGE_SIZE,
} from './userDirectoryRepository';
import { __resetRepositoryRuntimeForTests } from './repositoryRuntime';
import {
  collection,
  documentId,
  getDocs,
  labelFirestoreTarget,
  limit,
  onSnapshot,
  orderBy,
  query,
  startAfter,
  where,
} from '../performance/firestore';

jest.mock('../components/firebaseConfig', () => ({ db: { id: 'db' } }));

jest.mock('../performance/firestore', () => ({
  collection: jest.fn((_db, path) => ({ type: 'collection', path })),
  documentId: jest.fn(() => '__name__'),
  getDocs: jest.fn(),
  labelFirestoreTarget: jest.fn((target) => target),
  limit: jest.fn((value) => ({ type: 'limit', value })),
  onSnapshot: jest.fn(),
  orderBy: jest.fn((field, direction) => ({ type: 'orderBy', field, direction })),
  query: jest.fn((target, ...constraints) => ({ target, constraints })),
  startAfter: jest.fn((...values) => ({ type: 'startAfter', values })),
  where: jest.fn((field, operator, value) => ({ type: 'where', field, operator, value })),
}));

const projection = (overrides = {}) => ({
  schemaVersion: 1,
  characterId: 'Alba',
  label: 'Alba',
  normalizedLabel: 'alba',
  role: 'player',
  ...overrides,
});

const firestoreDocument = (id, data = projection()) => ({
  id,
  data: () => data,
});

describe('userDirectoryRepository', () => {
  beforeEach(() => {
    __resetRepositoryRuntimeForTests();
    jest.clearAllMocks();
    collection.mockImplementation((_db, path) => ({ type: 'collection', path }));
    documentId.mockReturnValue('__name__');
    labelFirestoreTarget.mockImplementation((target) => target);
    limit.mockImplementation((value) => ({ type: 'limit', value }));
    orderBy.mockImplementation((field, direction) => ({ type: 'orderBy', field, direction }));
    query.mockImplementation((target, ...constraints) => ({ target, constraints }));
    startAfter.mockImplementation((...values) => ({ type: 'startAfter', values }));
    where.mockImplementation((field, operator, value) => ({ type: 'where', field, operator, value }));
  });

  test('builds the activated 50-row ordering with an ID tiebreaker', () => {
    __buildUserDirectoryQuery();

    expect(collection).toHaveBeenCalledWith({ id: 'db' }, 'user_directory');
    expect(orderBy).toHaveBeenNthCalledWith(1, 'normalizedLabel', 'asc');
    expect(documentId).toHaveBeenCalledTimes(1);
    expect(orderBy).toHaveBeenNthCalledWith(2, '__name__', 'asc');
    expect(limit).toHaveBeenCalledWith(USER_DIRECTORY_PAGE_SIZE);
    expect(query.mock.calls[0][1]).toEqual({
      type: 'orderBy', field: 'normalizedLabel', direction: 'asc',
    });
  });

  test('executes the role-indexed real builder and scalar deleted-document cursor', () => {
    const cursor = {
      version: 1,
      queryKey: 'directory.users.by-role.dm.page.v1',
      sortValues: ['alba'],
      documentId: 'deleted-user',
    };
    __buildUserDirectoryQuery({ role: 'dm', cursor });

    expect(where).toHaveBeenCalledWith('role', '==', 'dm');
    expect(startAfter).toHaveBeenCalledWith('alba', 'deleted-user');
    expect(query.mock.calls[0][1]).toEqual({
      type: 'where', field: 'role', operator: '==', value: 'dm',
    });
  });

  test('injects an emulator role-context Firestore instance into the real builder', () => {
    const roleContextFirestore = { id: 'dm-role-context' };
    __buildUserDirectoryQuery({ role: 'dm', firestore: roleContextFirestore });
    expect(collection).toHaveBeenCalledWith(roleContextFirestore, 'user_directory');
  });

  test('rejects a cursor created for another role scope', () => {
    expect(() => __buildUserDirectoryQuery({
      role: 'webmaster',
      cursor: {
        version: 1,
        queryKey: 'directory.users.by-role.dm.page.v1',
        sortValues: ['alba'],
        documentId: 'dm-cursor',
      },
    })).toThrow('queryKey does not match');
  });

  test('deduplicates reads and returns normalized data with a versioned cursor', async () => {
    const documents = [
      firestoreDocument('a'),
      firestoreDocument('b', projection({ characterId: 'Àlba', label: 'Àlba' })),
    ];
    getDocs.mockResolvedValueOnce({ docs: documents, size: documents.length });

    const [left, right] = await Promise.all([
      getUserDirectoryPage(),
      getUserDirectoryPage(),
    ]);

    expect(getDocs).toHaveBeenCalledTimes(1);
    expect(left).toBe(right);
    expect(left.items).toEqual([
      { id: 'a', ...projection() },
      { id: 'b', ...projection({ characterId: 'Àlba', label: 'Àlba' }) },
    ]);
    expect(left.cursor).toEqual({
      version: 1,
      queryKey: 'directory.users.page.v1',
      sortValues: ['alba'],
      documentId: 'b',
    });
    expect(left.hasMore).toBe(false);
    expect(labelFirestoreTarget).toHaveBeenCalledWith(
      expect.any(Object),
      'directory.users.list.v1'
    );
  });

  test('strict projection validation prevents unexpected source-user fields leaking', () => {
    expect(() => normalizeUserDirectoryDocument(firestoreDocument('unsafe', {
      ...projection(),
      email: 'private@example.test',
    }))).toThrow('unexpected fields');
    expect(() => normalizeUserDirectoryDocument(firestoreDocument('bad', {
      ...projection(),
      role: 'admin',
    }))).toThrow('invalid');
  });

  test('shares one first-page listener and preserves unaffected entity identity', async () => {
    const physicalUnsubscribe = jest.fn();
    let listener;
    onSnapshot.mockImplementation((_target, observer) => {
      listener = observer;
      return physicalUnsubscribe;
    });
    const firstObserver = jest.fn();
    const secondObserver = jest.fn();
    const unsubscribeFirst = subscribeUserDirectoryFirstPage(firstObserver);
    const unsubscribeSecond = subscribeUserDirectoryFirstPage(secondObserver);

    const firstA = firestoreDocument('a');
    const firstB = firestoreDocument('b', projection({
      characterId: 'Bruno', label: 'Bruno', normalizedLabel: 'bruno',
    }));
    listener.next({
      docChanges: () => [
        { type: 'added', doc: firstA, oldIndex: -1, newIndex: 0 },
        { type: 'added', doc: firstB, oldIndex: -1, newIndex: 1 },
      ],
    });
    const firstRevision = firstObserver.mock.calls[0][0];

    const changedB = firestoreDocument('b', projection({
      characterId: 'Bruno II', label: 'Bruno II', normalizedLabel: 'bruno ii',
    }));
    listener.next({
      docChanges: () => [
        { type: 'modified', doc: changedB, oldIndex: 1, newIndex: 1 },
      ],
    });
    const secondRevision = firstObserver.mock.calls[1][0];

    expect(onSnapshot).toHaveBeenCalledTimes(1);
    expect(secondObserver).toHaveBeenCalledTimes(2);
    expect(secondRevision.byId.a).toBe(firstRevision.byId.a);
    expect(secondRevision.byId.b).not.toBe(firstRevision.byId.b);
    unsubscribeFirst();
    unsubscribeSecond();
    await Promise.resolve();
    expect(physicalUnsubscribe).toHaveBeenCalledTimes(1);
  });
});
