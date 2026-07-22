import {
  getCommonSpells,
  getCommonTechniques,
  getPossibleLists,
  getSchema,
  getVarie,
  invalidateConfig,
} from './configRepository';
import {
  __resetRepositoryRuntimeForTests,
  RepositorySessionChangedError,
  setRepositoryActor,
} from './repositoryRuntime';
import {
  doc,
  getDoc,
  labelFirestoreTarget,
} from '../performance/firestore';

jest.mock('../components/firebaseConfig', () => ({ db: {} }));

jest.mock('../performance/firestore', () => ({
  doc: jest.fn((_db, ...segments) => ({ path: segments.join('/') })),
  getDoc: jest.fn(),
  labelFirestoreTarget: jest.fn((target) => target),
}));

const snapshot = (data) => ({
  exists: () => data !== null,
  data: () => data,
});

const deferred = () => {
  let resolve;
  const promise = new Promise((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
};

describe('configRepository', () => {
  beforeEach(() => {
    __resetRepositoryRuntimeForTests();
    jest.clearAllMocks();
    doc.mockImplementation((_db, ...segments) => ({ path: segments.join('/') }));
    labelFirestoreTarget.mockImplementation((target) => target);
  });

  test('deduplicates concurrent and successful varie reads until invalidated', async () => {
    const first = { dadiAnimaByLevel: [null, 'd6'] };
    const second = { dadiAnimaByLevel: [null, 'd8'] };
    getDoc
      .mockResolvedValueOnce(snapshot(first))
      .mockResolvedValueOnce(snapshot(second));

    const [left, right] = await Promise.all([getVarie(), getVarie()]);
    expect(left).toBe(first);
    expect(right).toBe(first);
    expect(getDoc).toHaveBeenCalledTimes(1);
    await expect(getVarie()).resolves.toBe(first);
    expect(getDoc).toHaveBeenCalledTimes(1);

    expect(invalidateConfig('varie')).toBe(true);
    await expect(getVarie()).resolves.toBe(second);
    expect(getDoc).toHaveBeenCalledTimes(2);
    expect(labelFirestoreTarget).toHaveBeenLastCalledWith(
      expect.objectContaining({ path: 'utils/varie' }),
      'config.varie.get.v1'
    );
  });

  test('shared config retries across both auth and first-profile bootstrap transitions', async () => {
    const preAuthRead = deferred();
    const preProfileRead = deferred();
    const preProfileReadStarted = deferred();
    const configValue = { source: 'shared-config' };
    getDoc
      .mockImplementationOnce(() => preAuthRead.promise)
      .mockImplementationOnce(() => {
        preProfileReadStarted.resolve();
        return preProfileRead.promise;
      })
      .mockResolvedValueOnce(snapshot(configValue));

    const pending = getVarie();
    await Promise.resolve();
    await Promise.resolve();
    expect(getDoc).toHaveBeenCalledTimes(1);

    setRepositoryActor('new-user');
    preAuthRead.resolve(snapshot({ source: 'pre-auth' }));
    await preProfileReadStarted.promise;
    expect(getDoc).toHaveBeenCalledTimes(2);

    setRepositoryActor('new-user');
    preProfileRead.resolve(snapshot({ source: 'pre-profile' }));

    await expect(pending).resolves.toBe(configValue);
    expect(getDoc).toHaveBeenCalledTimes(3);
    await expect(getVarie()).resolves.toBe(configValue);
    expect(getDoc).toHaveBeenCalledTimes(3);
  });

  test('logout and account changes invalidate successful config and failed backoff entries', async () => {
    const denied = new Error('permission denied before authentication');
    const firstUserValue = { source: 'first-user' };
    const secondUserValue = { source: 'second-user' };
    getDoc
      .mockRejectedValueOnce(denied)
      .mockResolvedValueOnce(snapshot(firstUserValue))
      .mockResolvedValueOnce(snapshot(secondUserValue));

    setRepositoryActor(null);
    await expect(getVarie()).rejects.toBe(denied);
    setRepositoryActor('first-user');
    await expect(getVarie()).resolves.toBe(firstUserValue);
    setRepositoryActor('second-user');
    await expect(getVarie()).resolves.toBe(secondUserValue);
    expect(getDoc).toHaveBeenCalledTimes(3);
  });

  test('does not retry a pending config read under a different account', async () => {
    const firstAccountRead = deferred();
    getDoc.mockImplementationOnce(() => firstAccountRead.promise);
    setRepositoryActor('first-user');

    const pending = getVarie();
    await Promise.resolve();
    await Promise.resolve();
    setRepositoryActor('second-user');
    firstAccountRead.resolve(snapshot({ source: 'first-user' }));

    await expect(pending).rejects.toBeInstanceOf(RepositorySessionChangedError);
    expect(getDoc).toHaveBeenCalledTimes(1);
  });

  test('returns null for missing documents and accepts only reviewed schemas', async () => {
    getDoc.mockResolvedValue(snapshot(null));

    await expect(getSchema('schema_pg')).resolves.toBeNull();
    expect(doc).toHaveBeenCalledWith(expect.anything(), 'utils', 'schema_pg');
    expect(() => getSchema('schema_unreviewed')).toThrow('Unsupported shared schema');
    expect(invalidateConfig('schema_pg')).toBe(true);
    expect(() => invalidateConfig('unknown')).toThrow('Unsupported shared config document');
  });

  test('keeps the Bazaar legacy common-techniques document ahead of its standalone fallback', async () => {
    const legacyTechniques = { Guard: { Costo: 1 } };
    getDoc.mockResolvedValueOnce(snapshot({ tecniche_common: legacyTechniques }));

    await expect(getCommonTechniques({ legacyFirst: true })).resolves.toBe(legacyTechniques);
    expect(getDoc).toHaveBeenCalledTimes(1);
    expect(doc).toHaveBeenCalledWith(expect.anything(), 'utils', 'utils');
  });

  test('uses the standalone common-techniques document directly for its original consumers', async () => {
    const standaloneTechniques = { Dash: { Costo: 2 } };
    getDoc.mockResolvedValueOnce(snapshot(standaloneTechniques));

    await expect(getCommonTechniques()).resolves.toBe(standaloneTechniques);
    expect(getDoc).toHaveBeenCalledTimes(1);
    expect(doc).toHaveBeenCalledWith(expect.anything(), 'utils', 'tecniche_common');
  });

  test('falls back to the standalone document for legacy-first Bazaar consumers', async () => {
    const standaloneTechniques = { Dash: { Costo: 2 } };
    getDoc
      .mockResolvedValueOnce(snapshot({ unrelated: true }))
      .mockResolvedValueOnce(snapshot(standaloneTechniques));

    await expect(getCommonTechniques({ legacyFirst: true })).resolves.toBe(standaloneTechniques);
    expect(doc).toHaveBeenNthCalledWith(1, expect.anything(), 'utils', 'utils');
    expect(doc).toHaveBeenNthCalledWith(2, expect.anything(), 'utils', 'tecniche_common');
  });

  test('normalizes the remaining shared documents without exposing snapshots', async () => {
    const possibleLists = { ruoli: ['player', 'dm'] };
    const commonSpells = { Luce: { Costo: 1 } };
    getDoc
      .mockResolvedValueOnce(snapshot(possibleLists))
      .mockResolvedValueOnce(snapshot(commonSpells));

    await expect(getPossibleLists()).resolves.toBe(possibleLists);
    await expect(getCommonSpells()).resolves.toBe(commonSpells);
    expect(labelFirestoreTarget.mock.calls.map(([, metricKey]) => metricKey)).toEqual([
      'config.possible-lists.get.v1',
      'config.common-spells.get.v1',
    ]);
  });
});
