import {
  __resetRepositoryRuntimeForTests,
  setRepositoryActor,
} from '../repositoryRuntime';
import {
  subscribeUserDomain,
  resolveUserDataRolloutDocumentStage,
  userDataRolloutInstanceKey,
} from './userDataRepository';
import {
  USER_DATA_DOMAINS,
  USER_DATA_READ_SOURCES,
  USER_DATA_ROLLOUT_STAGES,
  resolveUserDataReadSource,
} from './domainSchema';
import {
  composeLegacyCompatibleUserData,
  compareUserDomainValues,
  mapV2PersonalContentItems,
  normalizeV2InventoryDocument,
  normalizeV2PersonalContentDocument,
  selectLegacyResources,
  selectLegacySettings,
} from './normalizers';
import { doc, labelFirestoreTarget, onSnapshot } from '../../performance/firestore';

const mockListeners = new Map();

jest.mock('../../components/firebaseConfig', () => ({ db: {} }));

jest.mock('../../performance/firestore', () => ({
  collection: jest.fn((_db, ...segments) => ({ path: segments.join('/') })),
  doc: jest.fn((_db, ...segments) => ({ path: segments.join('/') })),
  documentId: jest.fn(() => '__name__'),
  labelFirestoreTarget: jest.fn((target) => target),
  limit: jest.fn((value) => ({ type: 'limit', value })),
  onSnapshot: jest.fn((target, observer) => {
    mockListeners.set(target.path, observer);
    return () => mockListeners.delete(target.path);
  }),
  orderBy: jest.fn((field) => ({ type: 'orderBy', field })),
  query: jest.fn((base) => base),
}));

const emitDocument = (path, data) => {
  mockListeners.get(path)?.next({
    exists: () => data !== null,
    data: () => data,
  });
};

describe('user-data repository compatibility', () => {
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

  test('deduplicates the legacy root listener across domains and preserves an unchanged domain identity', () => {
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

    expect(onSnapshot).toHaveBeenCalledTimes(1);
    expect(mockListeners.has('users/user-1')).toBe(true);

    emitDocument('users/user-1', {
      role: 'players',
      stats: { level: 4, gold: 20, hpCurrent: 9 },
      Parametri: { Base: { Forza: { Tot: 2 } } },
      AltriParametri: { Anima_4: 'Spirito' },
      settings: { grigliata_draw_color: 'blue' },
    });
    const firstProgression = progressionValues[0];

    emitDocument('users/user-1', {
      role: 'players',
      stats: { level: 4, gold: 20, hpCurrent: 9 },
      Parametri: { Base: { Forza: { Tot: 2 } } },
      AltriParametri: { Anima_4: 'Spirito' },
      settings: { grigliata_draw_color: 'red' },
    });

    expect(progressionValues).toHaveLength(2);
    expect(progressionValues[1]).toBe(firstProgression);
    expect(resourceValues).toHaveLength(2);

    unsubscribeProgression();
    unsubscribeResources();
  });

  test('selects V2 reads only after the new-read cutover stage', () => {
    expect(resolveUserDataReadSource(USER_DATA_ROLLOUT_STAGES.LEGACY_READ)).toBe(USER_DATA_READ_SOURCES.LEGACY);
    expect(resolveUserDataReadSource(USER_DATA_ROLLOUT_STAGES.DUAL_WRITE)).toBe(USER_DATA_READ_SOURCES.LEGACY);
    expect(resolveUserDataReadSource(USER_DATA_ROLLOUT_STAGES.NEW_READ_DUAL_WRITE)).toBe(USER_DATA_READ_SOURCES.V2);
    expect(resolveUserDataReadSource(USER_DATA_ROLLOUT_STAGES.NEW_ONLY)).toBe(USER_DATA_READ_SOURCES.V2);
  });

  test.each(Object.values(USER_DATA_ROLLOUT_STAGES))('reads canonical rollout mode %s and honors a per-user override', (mode) => {
    expect(resolveUserDataRolloutDocumentStage({ mode }, 'user-1')).toBe(mode);
    expect(resolveUserDataRolloutDocumentStage({
      mode: USER_DATA_ROLLOUT_STAGES.LEGACY_READ,
      userOverrides: { 'user-1': mode },
    }, 'user-1')).toBe(mode);
  });

  test('supports the legacy rollout stage field while mode is introduced', () => {
    expect(resolveUserDataRolloutDocumentStage({
      stage: USER_DATA_ROLLOUT_STAGES.SHADOW_VERIFY,
    }, 'user-1')).toBe(USER_DATA_ROLLOUT_STAGES.SHADOW_VERIFY);
  });

  test('prefers canonical mode when both rollout fields are present', () => {
    expect(resolveUserDataRolloutDocumentStage({
      mode: USER_DATA_ROLLOUT_STAGES.NEW_ONLY,
      stage: USER_DATA_ROLLOUT_STAGES.LEGACY_READ,
    }, 'user-1')).toBe(USER_DATA_ROLLOUT_STAGES.NEW_ONLY);
  });

  test('isolates per-user rollout overrides even though they share one config document', () => {
    const config = {
      mode: USER_DATA_ROLLOUT_STAGES.LEGACY_READ,
      userOverrides: {
        'user-1': USER_DATA_ROLLOUT_STAGES.SHADOW_VERIFY,
        'user-2': USER_DATA_ROLLOUT_STAGES.NEW_READ_DUAL_WRITE,
      },
    };

    expect(resolveUserDataRolloutDocumentStage(config, 'user-1'))
      .toBe(USER_DATA_ROLLOUT_STAGES.SHADOW_VERIFY);
    expect(resolveUserDataRolloutDocumentStage(config, 'user-2'))
      .toBe(USER_DATA_ROLLOUT_STAGES.NEW_READ_DUAL_WRITE);
    expect(userDataRolloutInstanceKey('user-1'))
      .not.toBe(userDataRolloutInstanceKey('user-2'));
  });

  test('reports bounded count and value mismatches without exposing domain values', () => {
    expect(compareUserDomainValues([{ id: 'one' }], [{ id: 'one' }])).toEqual(expect.objectContaining({
      countMismatch: false,
      valueMismatch: false,
    }));
    const mismatch = compareUserDomainValues([{ id: 'one' }], [{ id: 'two' }, { id: 'three' }]);
    expect(mismatch).toEqual(expect.objectContaining({ countMismatch: true, valueMismatch: true }));
    expect(JSON.stringify(mismatch)).not.toContain('three');
  });

  test('canonical shadow projections compare clean migrated state domains equally', () => {
    const pairs = [
      [USER_DATA_DOMAINS.PROFILE,
        { role: 'players', characterId: 'Aster', stats: { level: 5 }, flags: { ready: true } },
        { role: 'player', characterId: 'Aster', summary: { level: 5 }, flags: { ready: true }, modelVersion: 2 }],
      [USER_DATA_DOMAINS.PROGRESSION,
        { schemaVersion: 1, stats: { level: 5, hpCurrent: 8, gold: 10 }, Parametri: { Base: {} }, AltriParametri: {}, flags: {} },
        { schemaVersion: 2, revision: 4, stats: { level: 5 }, Parametri: { Base: {} }, AltriParametri: {}, flags: {}, updatedBy: 'bridge' }],
      [USER_DATA_DOMAINS.RESOURCES,
        { schemaVersion: 1, stats: { level: 5, hpCurrent: 8, gold: 10 }, active_turn_effect: null },
        { schemaVersion: 2, revision: 2, stats: { hpCurrent: 8, gold: 10 }, active_turn_effect: {} }],
      [USER_DATA_DOMAINS.SETTINGS,
        { settings: { theme: 'dark', lock_param_base: false }, grigliata: { drawColorKey: 'blue' }, parameterLocks: { strength: true } },
        { schemaVersion: 2, revision: 2, settings: { theme: 'dark', lock_param_base: false }, grigliata: { drawColorKey: 'blue' }, locks: { strength: true } }],
      [USER_DATA_DOMAINS.PROFILE_CONTENT,
        { lingue: { Comune: { livello: 1 } }, conoscenze: {}, professioni: {} },
        { schemaVersion: 2, revision: 2, lingue: { Comune: { livello: 1 } }, conoscenze: {}, professioni: {} }],
    ];

    pairs.forEach(([domain, legacyValue, v2Value]) => {
      expect(compareUserDomainValues(legacyValue, v2Value, { domain }).valueMismatch)
        .toBe(false);
    });
  });

  test('canonicalizes legacy-only barriera without mutating the aggregate', () => {
    const aggregate = {stats: {level: 2, barriera: 9}};
    expect(selectLegacyResources(aggregate).stats).toEqual({
      level: 2,
      barrieraCurrent: 9,
      barrieraTotal: 9,
    });
    expect(aggregate.stats).toEqual({level: 2, barriera: 9});
    expect(compareUserDomainValues(
      selectLegacyResources(aggregate),
      {stats: {barrieraCurrent: 9, barrieraTotal: 9}, active_turn_effect: {}},
      {domain: USER_DATA_DOMAINS.RESOURCES}
    ).valueMismatch).toBe(false);
  });

  test('preserves parameterLocks and paramLocks as distinct legacy settings maps', () => {
    expect(selectLegacySettings({
      parameterLocks: {},
      paramLocks: {legacy: true},
    })).toEqual(expect.objectContaining({
      parameterLocks: {},
      paramLocks: {legacy: true},
    }));
  });

  test('canonical inventory projection preserves duplicate cardinality and detects a changed duplicate', () => {
    const legacy = [{
      id: 'sword',
      item_type: 'weapon',
      qty: 2,
      General: { Nome: 'Sword' },
    }];
    const v2 = ['one', 'two'].map((id) => normalizeV2InventoryDocument({
      id,
      data: () => ({
        quantity: 1,
        source: 'legacy',
        currentSnapshot: { id: 'sword', item_type: 'weapon', General: { Nome: 'Sword' } },
      }),
    }));

    expect(compareUserDomainValues(legacy, v2, {
      domain: USER_DATA_DOMAINS.INVENTORY,
    }).valueMismatch).toBe(false);
    const changed = [v2[0], { ...v2[1], General: { Nome: 'Wrong Sword' } }];
    expect(compareUserDomainValues(legacy, changed, {
      domain: USER_DATA_DOMAINS.INVENTORY,
    }).valueMismatch).toBe(true);
  });

  test('canonical equipment projection resolves stable IDs to item semantics and detects a wrong duplicate', () => {
    const steel = {
      id: 'sword', item_type: 'weapon', General: { Nome: 'Sword' }, Specific: { rune: 'steel' },
      _instance: { instanceId: 'inventory-steel', source: 'legacy' },
    };
    const obsidian = {
      id: 'sword', item_type: 'weapon', General: { Nome: 'Sword' }, Specific: { rune: 'obsidian' },
      _instance: { instanceId: 'inventory-obsidian', source: 'legacy' },
    };
    const v2Inventory = [steel, obsidian].map((entry) => normalizeV2InventoryDocument({
      id: entry._instance.instanceId,
      data: () => ({
        quantity: 1,
        source: 'legacy',
        currentSnapshot: {
          id: entry.id,
          item_type: entry.item_type,
          General: entry.General,
          Specific: entry.Specific,
        },
      }),
    }));
    const options = {
      domain: USER_DATA_DOMAINS.EQUIPMENT,
      legacyInventory: [steel, obsidian],
      v2Inventory,
    };
    const legacy = { slots: { weaponMain: steel, weaponOff: obsidian }, beltCapacity: 0 };

    expect(compareUserDomainValues(legacy, {
      slots: { weaponMain: 'inventory-steel', weaponOff: 'inventory-obsidian' },
      beltCapacity: 0,
    }, options).valueMismatch).toBe(false);
    expect(compareUserDomainValues(legacy, {
      slots: { weaponMain: 'inventory-obsidian', weaponOff: 'inventory-steel' },
      beltCapacity: 0,
    }, options).valueMismatch).toBe(true);
  });

  test.each([
    [USER_DATA_DOMAINS.SPELLS, 'spell'],
    [USER_DATA_DOMAINS.TECHNIQUES, 'technique'],
  ])('canonical %s projection preserves duplicate names and detects the wrong item', (domain, prefix) => {
    const legacy = {
      first: { name: 'Echo', Costo: 1 },
      second: { name: 'Echo', Costo: 2 },
    };
    const normalized = ['first', 'second'].map((suffix, index) => normalizeV2PersonalContentDocument({
      id: `${prefix}-${suffix}`,
      data: () => ({
        displayName: 'Echo',
        data: { Costo: index + 1 },
        legacyManaged: false,
      }),
    }));
    const v2 = mapV2PersonalContentItems(normalized);

    expect(Object.keys(v2)).toHaveLength(2);
    expect(compareUserDomainValues(legacy, v2, { domain }).valueMismatch).toBe(false);
    const wrong = { ...v2, [Object.keys(v2)[1]]: { ...v2[Object.keys(v2)[1]], Costo: 9 } };
    expect(compareUserDomainValues(legacy, wrong, { domain }).valueMismatch).toBe(true);
  });

  test('canonical settings comparison detects grigliata and lock drift', () => {
    const legacy = {
      settings: { theme: 'dark' },
      grigliata: { drawColorKey: 'blue' },
      parameterLocks: { strength: true },
    };
    expect(compareUserDomainValues(legacy, {
      settings: { theme: 'dark' },
      grigliata: { drawColorKey: 'red' },
      locks: { strength: true },
    }, { domain: USER_DATA_DOMAINS.SETTINGS }).valueMismatch).toBe(true);
    expect(compareUserDomainValues(legacy, {
      settings: { theme: 'dark' },
      grigliata: { drawColorKey: 'blue' },
      locks: { strength: false },
    }, { domain: USER_DATA_DOMAINS.SETTINGS }).valueMismatch).toBe(true);
  });

  test('normalizes a V2 inventory instance into the legacy item shape without losing its stable ID', () => {
    const normalized = normalizeV2InventoryDocument({
      id: 'inventory-123',
      data: () => ({
        schemaVersion: 2,
        revision: 3,
        catalogItemId: 'sword-1',
        quantity: 1,
        pricePaid: 15,
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
      _task05: expect.objectContaining({ inventoryId: 'inventory-123', revision: 3 }),
    }));
  });

  test('composes the fixed V2 domains into the temporary legacy view', () => {
    const result = composeLegacyCompatibleUserData({
      profile: { role: 'player', characterId: 'Aster', summary: { level: 5 } },
      progression: { stats: { characterPoints: 2 }, Parametri: { Base: {} } },
      resources: { stats: { gold: 30, hpCurrent: 8 } },
      settings: { settings: { grigliata_music_muted: true } },
      equipment: { slots: { weaponMain: 'inventory-1' } },
      profileContent: { lingue: { Comune: {} } },
      inventory: [{ id: 'sword-1' }],
      spells: { Luce: { name: 'Luce' } },
      techniques: { Affondo: { name: 'Affondo' } },
    });

    expect(result).toEqual(expect.objectContaining({
      role: 'player',
      characterId: 'Aster',
      stats: expect.objectContaining({ level: 5, gold: 30, characterPoints: 2 }),
      equipped: { weaponMain: 'inventory-1' },
      inventory: [{ id: 'sword-1' }],
    }));
  });

  test('keeps more than 50 stable personal-content documents in the compatibility map', () => {
    const items = Array.from({ length: 51 }, (_, index) => normalizeV2PersonalContentDocument({
      id: `spell-${index}`,
      data: () => ({
        displayName: `Spell ${String(index).padStart(2, '0')}`,
        normalizedName: `spell ${String(index).padStart(2, '0')}`,
        data: { Costo: index },
      }),
    }));
    const result = mapV2PersonalContentItems(items);

    expect(Object.keys(result)).toHaveLength(51);
    expect(result['Spell 50']).toEqual(expect.objectContaining({
      Costo: 50,
      _task05ContentId: 'spell-50',
    }));
  });
});
