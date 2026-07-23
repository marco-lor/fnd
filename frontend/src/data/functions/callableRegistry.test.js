describe('Firebase callable registry', () => {
  const callableManifest = require('./callableManifest.json');
  const previousPerformanceMode = process.env.REACT_APP_FND_PERF;

  const loadRegistry = ({ performanceMode = false } = {}) => {
    jest.resetModules();
    jest.clearAllMocks();
    if (performanceMode) process.env.REACT_APP_FND_PERF = '1';
    else delete process.env.REACT_APP_FND_PERF;

    const app = { name: 'test-app' };
    const connectFunctionsEmulator = jest.fn();
    const getFunctions = jest.fn((_app, region) => ({ region }));
    const delegates = new Map();
    const httpsCallable = jest.fn((_functions, functionId) => {
      const delegate = jest.fn((payload) => Promise.resolve({
        data: { functionId, payload },
      }));
      delegates.set(functionId, delegate);
      return delegate;
    });

    jest.doMock('../../components/firebaseConfig', () => ({ app }));
    jest.doMock('firebase/functions', () => ({
      connectFunctionsEmulator,
      getFunctions,
      httpsCallable,
    }));

    return {
      app,
      connectFunctionsEmulator,
      delegates,
      getFunctions,
      httpsCallable,
      registry: require('./callableRegistry'),
    };
  };

  afterAll(() => {
    if (previousPerformanceMode === undefined) delete process.env.REACT_APP_FND_PERF;
    else process.env.REACT_APP_FND_PERF = previousPerformanceMode;
  });

  test('keeps Functions and callable delegates lazy and caches both', async () => {
    const {
      app,
      getFunctions,
      httpsCallable,
      registry,
    } = loadRegistry();

    const first = registry.getCallable('deleteUser');
    const second = registry.getCallable('deleteUser');
    expect(first).toBe(second);
    expect(getFunctions).not.toHaveBeenCalled();
    expect(httpsCallable).not.toHaveBeenCalled();

    await first({ userId: 'user-1' });
    await second({ userId: 'user-2' });

    expect(getFunctions).toHaveBeenCalledTimes(1);
    expect(getFunctions).toHaveBeenCalledWith(app, 'europe-west8');
    expect(httpsCallable).toHaveBeenCalledTimes(1);
    expect(httpsCallable).toHaveBeenCalledWith(
      { region: 'europe-west8' },
      'deleteUser'
    );
  });

  test.each([
    ['deleteUser', 'europe-west8'],
    ['deleteGrigliataCustomToken', 'europe-west1'],
    ['spendCharacterPoint', 'us-central1'],
    ['spendCharacterPointV2', 'europe-west8'],
  ])('uses the declared region for %s', async (logicalKey, region) => {
    const { app, getFunctions, registry } = loadRegistry();

    await registry.getCallable(logicalKey)({});

    expect(getFunctions).toHaveBeenCalledWith(app, region);
  });

  test('acquires every manifest entry by its exact function ID and region', async () => {
    const {
      getFunctions,
      httpsCallable,
      registry,
    } = loadRegistry();
    const entries = Object.entries(callableManifest.callables);

    for (const [logicalKey] of entries) {
      await registry.getCallable(logicalKey)({probe: true});
    }

    expect(entries).toHaveLength(30);
    expect(getFunctions).toHaveBeenCalledTimes(
      callableManifest.supportedRegions.length
    );
    expect(httpsCallable).toHaveBeenCalledTimes(entries.length);
    entries.forEach(([, entry]) => {
      expect(httpsCallable).toHaveBeenCalledWith(
        {region: entry.region},
        entry.functionId
      );
    });
    expect(callableManifest.callables.duplicateFoeWithAssets)
      .toEqual(expect.objectContaining({
        region: 'europe-west1',
        compatibilityAliasOf: 'duplicateFoeWithAssetsV2',
      }));
    expect(callableManifest.callables.duplicateFoeWithAssetsV2.region)
      .toBe('europe-west8');
    expect(callableManifest.callables.spendCharacterPoint)
      .toEqual(expect.objectContaining({
        region: 'us-central1',
        compatibilityAliasOf: 'spendCharacterPointV2',
      }));
    expect(callableManifest.callables.spendCharacterPointV2.region)
      .toBe('europe-west8');
  });

  test('connects the performance emulator once for each acquired region', async () => {
    const {
      connectFunctionsEmulator,
      registry,
    } = loadRegistry({ performanceMode: true });

    await registry.getCallable('deleteUser')({});
    await registry.getCallable('updateUserRole')({});
    await registry.getCallable('deleteGrigliataCustomToken')({});
    await registry.getCallable('spawnGrigliataFoeToken')({});

    expect(connectFunctionsEmulator).toHaveBeenCalledTimes(2);
    expect(connectFunctionsEmulator).toHaveBeenCalledWith(
      { region: 'europe-west8' },
      '127.0.0.1',
      5001
    );
    expect(connectFunctionsEmulator).toHaveBeenCalledWith(
      { region: 'europe-west1' },
      '127.0.0.1',
      5001
    );
  });

  test('rejects unregistered keys and regions before touching Firebase', () => {
    const { getFunctions, registry } = loadRegistry();

    expect(() => registry.getCallable('notRegistered')).toThrow(
      'Unknown Firebase callable key'
    );
    expect(() => registry.getFunctionsForRegion('moon-base-1')).toThrow(
      'Unknown Firebase Functions region'
    );
    expect(getFunctions).not.toHaveBeenCalled();
  });
});
