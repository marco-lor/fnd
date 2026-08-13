import {
  __resetRepositoryRuntimeForTests,
  setRepositoryActor,
} from '../repositoryRuntime';
import {
  subscribeAuthProfile,
  subscribeUserDomain,
  updateUserProfileMedia,
} from './userDataRepository';
import { USER_DATA_DOMAINS } from './domainSchema';
import {
  mapV2PersonalContentItems,
  normalizeUserShell,
  normalizeV2InventoryDocument,
  normalizeV2PersonalContentDocument,
} from './normalizers';
import { stableDataJson } from './stableDataJson';
import { doc, labelFirestoreTarget, onSnapshot, updateDoc } from '../../performance/firestore';

const mockListeners = new Map();

jest.mock('../../components/firebaseConfig', () => ({ db: {} }));

jest.mock('../../performance/firestore', () => ({
  collection: jest.fn((_db, ...segments) => ({ path: segments.join('/') })),
  doc: jest.fn((_db, ...segments) => ({ path: segments.join('/') })),
  documentId: jest.fn(() => '__name__'),
  getDoc: jest.fn(),
  labelFirestoreTarget: jest.fn((target) => target),
  onSnapshot: jest.fn((target, observer) => {
    mockListeners.set(target.path, observer);
    return () => mockListeners.delete(target.path);
  }),
  orderBy: jest.fn((field) => ({ type: 'orderBy', field })),
  query: jest.fn((base) => base),
  updateDoc: jest.fn(() => Promise.resolve()),
}));

const emitDocument = (path, data) => {
  mockListeners.get(path)?.next({
    exists: () => data !== null,
    data: () => data,
  });
};

describe('V2 user-data repository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListeners.clear();
    doc.mockImplementation((_db, ...segments) => ({ path: segments.join('/') }));
    labelFirestoreTarget.mockImplementation((target) => target);
    onSnapshot.mockImplementation((target, observer) => {
      mockListeners.set(target.path, observer);
      return () => mockListeners.delete(target.path);
    });
    __resetRepositoryRuntimeForTests();
    setRepositoryActor('user-1');
  });

  afterEach(() => {
    __resetRepositoryRuntimeForTests();
  });

  test('labels the Auth-owned root listener as a shell listener', () => {
    const values = [];
    const unsubscribe = subscribeAuthProfile('user-1', (value) => values.push(value));

    expect(labelFirestoreTarget).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'users/user-1' }),
      'users.shell.subscribe.v2',
      'shell'
    );
    emitDocument('users/user-1', {
      role: 'players',
      username: 'Aster',
      summary: { level: 4 },
    });
    expect(values[0]).toEqual(expect.objectContaining({
      role: 'player',
      username: 'Aster',
      summary: { level: 4 },
    }));
    unsubscribe();
  });

  test('subscribes progression and resources directly to V2 state documents', () => {
    const progressionValues = [];
    const resourceValues = [];
    const unsubscribeProgression = subscribeUserDomain(
      'user-1',
      USER_DATA_DOMAINS.PROGRESSION,
      (value) => progressionValues.push(value)
    );
    const unsubscribeResources = subscribeUserDomain(
      'user-1',
      USER_DATA_DOMAINS.RESOURCES,
      (value) => resourceValues.push(value)
    );

    expect(mockListeners.has('users/user-1/state/progression')).toBe(true);
    expect(mockListeners.has('users/user-1/state/resources')).toBe(true);
    expect(mockListeners.has('users/user-1')).toBe(false);

    emitDocument('users/user-1/state/progression', { stats: { level: 4 } });
    emitDocument('users/user-1/state/resources', { stats: { gold: 20 } });
    const firstProgression = progressionValues[0];
    emitDocument('users/user-1/state/progression', { stats: { level: 4 } });

    expect(progressionValues[1]).toBe(firstProgression);
    expect(resourceValues[0]).toEqual(expect.objectContaining({ stats: { gold: 20 } }));
    unsubscribeProgression();
    unsubscribeResources();
  });

  test('writes only validated profile media fields through the shell boundary', async () => {
    const media = { assetId: `m_${'a'.repeat(40)}`, state: 'ready' };
    await updateUserProfileMedia('user-1', {
      imageUrl: '',
      imagePath: 'media/v1/avatar/user-1/original.png',
      media,
    });

    expect(updateDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'users/user-1' }),
      { imageUrl: '', imagePath: 'media/v1/avatar/user-1/original.png', media }
    );
    expect(() => updateUserProfileMedia('user-1', { role: 'dm' }))
      .toThrow('Profile media patches may update only media fields.');
    expect(() => updateUserProfileMedia('user-1', { media: [] }))
      .toThrow('Profile media metadata must be an object or null.');
  });

  test('normalizes V2 inventory without exposing retired migration metadata', () => {
    const normalized = normalizeV2InventoryDocument({
      id: 'inventory-123',
      data: () => ({
        schemaVersion: 2,
        revision: 3,
        catalogItemId: 'sword-1',
        quantity: 1,
        pricePaid: 15,
        migration: { source: 'old-root' },
        legacyManaged: true,
        currentSnapshot: {
          General: { Nome: 'Spada' },
          item_type: 'weapon',
        },
      }),
    });

    expect(normalized).toEqual(expect.objectContaining({
      id: 'sword-1',
      General: { Nome: 'Spada' },
      _instance: expect.objectContaining({ instanceId: 'inventory-123', pricePaid: 15 }),
      _task05: {
        inventoryId: 'inventory-123',
        schemaVersion: 2,
        revision: 3,
        catalogItemId: 'sword-1',
      },
    }));
    expect(normalized._task05).not.toHaveProperty('migration');
    expect(normalized._task05).not.toHaveProperty('legacyManaged');
  });

  test('keeps all stable personal-content documents and independent media revisions', () => {
    const items = Array.from({ length: 51 }, (_, index) => normalizeV2PersonalContentDocument({
      id: `spell-${index}`,
      data: () => ({
        displayName: `Spell ${String(index).padStart(2, '0')}`,
        data: { Costo: index },
        task07MediaRevision: index,
      }),
    }));
    const result = mapV2PersonalContentItems(items);

    expect(Object.keys(result)).toHaveLength(51);
    expect(result['Spell 50']).toEqual(expect.objectContaining({
      Costo: 50,
      task07MediaRevision: 50,
      _task05ContentId: 'spell-50',
    }));
  });

  test('normalizes shell roles and serializes equivalent object keys deterministically', () => {
    expect(normalizeUserShell({ role: 'players' })).toEqual(expect.objectContaining({ role: 'player' }));
    expect(stableDataJson({ b: 2, a: 1 })).toBe(stableDataJson({ a: 1, b: 2 }));
  });
});
