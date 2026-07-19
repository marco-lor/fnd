describe('optional Firebase services', () => {
  const previousPerformanceMode = process.env.REACT_APP_FND_PERF;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env.REACT_APP_FND_PERF = '1';
    jest.doMock('./firebaseConfig', () => ({ app: { name: 'test-app' } }));
  });

  afterAll(() => {
    if (previousPerformanceMode === undefined) delete process.env.REACT_APP_FND_PERF;
    else process.env.REACT_APP_FND_PERF = previousPerformanceMode;
  });

  test('acquires Storage and connects its emulator only when imported', () => {
    const storage = { service: 'storage' };
    const getStorage = jest.fn(() => storage);
    const connectStorageEmulator = jest.fn();
    jest.doMock('firebase/storage', () => ({ getStorage, connectStorageEmulator }));
    expect(require('./firebaseStorage').storage).toBe(storage);
    expect(getStorage).toHaveBeenCalledTimes(1);
    expect(connectStorageEmulator).toHaveBeenCalledWith(storage, '127.0.0.1', 9199);
  });

  test('acquires Functions in europe-west1 only when imported', () => {
    const functions = { service: 'functions' };
    const getFunctions = jest.fn(() => functions);
    const connectFunctionsEmulator = jest.fn();
    jest.doMock('firebase/functions', () => ({ getFunctions, connectFunctionsEmulator }));
    expect(require('./firebaseFunctions').functions).toBe(functions);
    expect(getFunctions).toHaveBeenCalledWith({ name: 'test-app' }, 'europe-west1');
    expect(connectFunctionsEmulator).toHaveBeenCalledWith(functions, '127.0.0.1', 5001);
  });
});
