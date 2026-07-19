const validConfig = {
  apiKey: "api-key",
  authDomain: "example.firebaseapp.com",
  projectId: "example",
  storageBucket: "example.appspot.com",
  messagingSenderId: "123",
  appId: "1:123:web:abc",
};

describe("Firebase async bootstrap", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  const loadModule = () => {
    jest.doMock("firebase/app", () => ({
      getApp: jest.fn(),
      getApps: jest.fn(() => []),
      initializeApp: jest.fn((config) => ({ config })),
    }));
    jest.doMock("firebase/app-check", () => ({
      initializeAppCheck: jest.fn(),
      ReCaptchaV3Provider: jest.fn(),
    }));
    jest.doMock("firebase/auth", () => ({
      connectAuthEmulator: jest.fn(),
      getAuth: jest.fn(() => ({ service: "auth" })),
    }));
    jest.doMock("../performance/firestore", () => ({
      connectFirestoreEmulator: jest.fn(),
      getFirestore: jest.fn(() => ({ service: "db" })),
    }));
    return require("./firebaseConfig");
  };

  test("loads a delayed runtime config asynchronously and validates it", async () => {
    const firebaseConfig = loadModule();
    let resolveResponse;
    const fetchImpl = jest.fn(() => new Promise((resolve) => { resolveResponse = resolve; }));

    const pending = firebaseConfig.loadFirebaseConfig({ fetchImpl, forceRuntime: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    resolveResponse({ ok: true, status: 200, json: async () => validConfig });
    await expect(pending).resolves.toEqual(validConfig);
  });

  test("uses the deterministic Jest configuration without a network request", async () => {
    const firebaseConfig = loadModule();
    const fetchImpl = jest.fn();

    await expect(firebaseConfig.loadFirebaseConfig({ fetchImpl })).resolves.toEqual(
      firebaseConfig.testFirebaseConfig
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test.each([
    [{ ok: false, status: 503, json: async () => ({}) }, "Failed to load"],
    [{ ok: true, status: 200, json: async () => ({ apiKey: "only-one-key" }) }, "is missing"],
    [{ ok: true, status: 200, json: async () => { throw new Error("bad json"); } }, "is malformed"],
  ])("rejects failed or malformed runtime config", async (response, message) => {
    const firebaseConfig = loadModule();
    await expect(firebaseConfig.loadFirebaseConfig({
      fetchImpl: jest.fn().mockResolvedValue(response),
      forceRuntime: true,
    })).rejects.toThrow(message);
  });

  test("coalesces initialization and permits retry after a failure", async () => {
    const firebaseConfig = loadModule();
    firebaseConfig.__resetFirebaseForTests();
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })
      .mockResolvedValue({ ok: true, status: 200, json: async () => validConfig });

    await expect(firebaseConfig.initializeFirebase({ fetchImpl, forceRuntime: true })).rejects.toThrow();

    const first = firebaseConfig.initializeFirebase({ fetchImpl, forceRuntime: true });
    const second = firebaseConfig.initializeFirebase({ fetchImpl, forceRuntime: true });
    expect(first).toBe(second);
    await expect(first).resolves.toMatchObject({
      auth: { service: "auth" },
      db: { service: "db" },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(require("firebase/app").initializeApp).toHaveBeenCalledTimes(2); // eager test app + retried runtime app
  });

  test("initializes one app and App Check exactly once", () => {
    const firebaseConfig = loadModule();
    firebaseConfig.__resetFirebaseForTests();
    jest.clearAllMocks();

    firebaseConfig.__initializeFirebaseServicesForTests(validConfig, {
      production: true,
      appCheckSiteKey: "site-key",
    });
    firebaseConfig.__initializeFirebaseServicesForTests(validConfig, {
      production: true,
      appCheckSiteKey: "site-key",
    });

    expect(require("firebase/app").initializeApp).toHaveBeenCalledTimes(1);
    expect(require("firebase/app-check").initializeAppCheck).toHaveBeenCalledTimes(1);
    expect(require("firebase/app-check").ReCaptchaV3Provider).toHaveBeenCalledTimes(1);
  });

  test("uses the static demo config and connects emulators in an ordinary performance build", async () => {
    const previousPerformanceMode = process.env.REACT_APP_FND_PERF;
    const previousProjectId = process.env.REACT_APP_FND_PERF_PROJECT_ID;
    process.env.REACT_APP_FND_PERF = "1";
    process.env.REACT_APP_FND_PERF_PROJECT_ID = "demo-fnd-perf";

    try {
      const firebaseConfig = loadModule();
      const fetchImpl = jest.fn();
      const config = await firebaseConfig.loadFirebaseConfig({ fetchImpl });

      expect(config.projectId).toBe("demo-fnd-perf");
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(require("firebase/auth").connectAuthEmulator).toHaveBeenCalledTimes(1);
      expect(require("../performance/firestore").connectFirestoreEmulator).toHaveBeenCalledTimes(1);
    } finally {
      if (previousPerformanceMode === undefined) delete process.env.REACT_APP_FND_PERF;
      else process.env.REACT_APP_FND_PERF = previousPerformanceMode;
      if (previousProjectId === undefined) delete process.env.REACT_APP_FND_PERF_PROJECT_ID;
      else process.env.REACT_APP_FND_PERF_PROJECT_ID = previousProjectId;
    }
  });
});
