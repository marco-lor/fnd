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
      ReCaptchaEnterpriseProvider: jest.fn(),
    }));
    jest.doMock("firebase/auth", () => ({
      connectAuthEmulator: jest.fn(),
      getAuth: jest.fn(() => ({ service: "auth" })),
    }));
    jest.doMock("../performance/firestore", () => ({
      connectFirestoreEmulator: jest.fn(),
      getFirestore: jest.fn(() => ({ service: "db" })),
      initializeFirestore: jest.fn(() => ({ service: "db" })),
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

  test("rejects runtime configuration from a different explicit Firebase target", async () => {
    const previousTarget = {
      environment: process.env.REACT_APP_FND_ENVIRONMENT,
      authDomain: process.env.REACT_APP_FND_FIREBASE_AUTH_DOMAIN,
      projectId: process.env.REACT_APP_FND_FIREBASE_PROJECT_ID,
      storageBucket: process.env.REACT_APP_FND_FIREBASE_STORAGE_BUCKET,
    };
    process.env.REACT_APP_FND_ENVIRONMENT = "staging";
    process.env.REACT_APP_FND_FIREBASE_AUTH_DOMAIN = "fatin-test.firebaseapp.com";
    process.env.REACT_APP_FND_FIREBASE_PROJECT_ID = "fatin-test";
    process.env.REACT_APP_FND_FIREBASE_STORAGE_BUCKET = "fatin-test.firebasestorage.app";
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";

    try {
      const firebaseConfig = loadModule();
      await expect(firebaseConfig.loadFirebaseConfig({
        fetchImpl: jest.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({
            ...validConfig,
            authDomain: "fatins.firebaseapp.com",
            projectId: "fatins",
            storageBucket: "fatins.firebasestorage.app",
          }),
        }),
        forceRuntime: true,
      })).rejects.toThrow(/explicit build target|projectId expected fatin-test/);
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
      for (const [key, value] of Object.entries({
        REACT_APP_FND_ENVIRONMENT: previousTarget.environment,
        REACT_APP_FND_FIREBASE_AUTH_DOMAIN: previousTarget.authDomain,
        REACT_APP_FND_FIREBASE_PROJECT_ID: previousTarget.projectId,
        REACT_APP_FND_FIREBASE_STORAGE_BUCKET: previousTarget.storageBucket,
      })) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
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
    expect(require("firebase/app-check").ReCaptchaEnterpriseProvider).toHaveBeenCalledTimes(1);
    expect(require("../performance/firestore").getFirestore).toHaveBeenCalledTimes(1);
    expect(require("../performance/firestore").initializeFirestore).not.toHaveBeenCalled();
  });

  test("uses the static demo config and connects emulators in an ordinary performance build", async () => {
    const previousPerformanceMode = process.env.REACT_APP_FND_PERF;
    const previousProjectId = process.env.REACT_APP_FND_PERF_PROJECT_ID;
    const previousAppCheckSiteKey = process.env.REACT_APP_RECAPTCHA_ENTERPRISE_SITE_KEY;
    process.env.REACT_APP_FND_PERF = "1";
    process.env.REACT_APP_FND_PERF_PROJECT_ID = "demo-fnd-perf";
    process.env.REACT_APP_RECAPTCHA_ENTERPRISE_SITE_KEY = "production-site-key-must-not-run";

    try {
      const firebaseConfig = loadModule();
      const fetchImpl = jest.fn();
      const config = await firebaseConfig.loadFirebaseConfig({ fetchImpl });

      expect(config.projectId).toBe("demo-fnd-perf");
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(require("firebase/auth").connectAuthEmulator).toHaveBeenCalledTimes(1);
      expect(require("../performance/firestore").connectFirestoreEmulator).toHaveBeenCalledTimes(1);
      const firestore = require("../performance/firestore");
      expect(firestore.getFirestore).not.toHaveBeenCalled();
      expect(firestore.initializeFirestore).toHaveBeenCalledTimes(1);
      const [initializedApp, settings] = firestore.initializeFirestore.mock.calls[0];
      expect(initializedApp.config.projectId).toBe("demo-fnd-perf");
      expect(settings).toEqual({});
      expect(settings).not.toHaveProperty("experimentalAutoDetectLongPolling");
      expect(settings).not.toHaveProperty("experimentalForceLongPolling");

      firebaseConfig.__resetFirebaseForTests();
      jest.clearAllMocks();
      firebaseConfig.__initializeFirebaseServicesForTests(config, {
        production: true,
        appCheckSiteKey: "production-site-key-must-not-run",
      });

      expect(require("firebase/app-check").initializeAppCheck).not.toHaveBeenCalled();
      expect(require("firebase/app-check").ReCaptchaEnterpriseProvider).not.toHaveBeenCalled();
      expect(firestore.initializeFirestore).toHaveBeenCalledTimes(1);
      expect(firestore.connectFirestoreEmulator).toHaveBeenCalledTimes(1);
    } finally {
      if (previousPerformanceMode === undefined) delete process.env.REACT_APP_FND_PERF;
      else process.env.REACT_APP_FND_PERF = previousPerformanceMode;
      if (previousProjectId === undefined) delete process.env.REACT_APP_FND_PERF_PROJECT_ID;
      else process.env.REACT_APP_FND_PERF_PROJECT_ID = previousProjectId;
      if (previousAppCheckSiteKey === undefined) {
        delete process.env.REACT_APP_RECAPTCHA_ENTERPRISE_SITE_KEY;
      } else {
        process.env.REACT_APP_RECAPTCHA_ENTERPRISE_SITE_KEY = previousAppCheckSiteKey;
      }
    }
  });

  test("permits the owned WebKit emulator probe to force long polling", () => {
    const previousPerformanceMode = process.env.REACT_APP_FND_PERF;
    const previousProjectId = process.env.REACT_APP_FND_PERF_PROJECT_ID;
    process.env.REACT_APP_FND_PERF = "1";
    process.env.REACT_APP_FND_PERF_PROJECT_ID = "demo-fnd-perf";
    window.__FND_PERF_FORCE_FIRESTORE_LONG_POLLING__ = true;

    try {
      loadModule();
      const firestore = require("../performance/firestore");
      expect(firestore.initializeFirestore).toHaveBeenCalledWith(
        expect.anything(),
        { experimentalForceLongPolling: true }
      );
    } finally {
      delete window.__FND_PERF_FORCE_FIRESTORE_LONG_POLLING__;
      if (previousPerformanceMode === undefined) delete process.env.REACT_APP_FND_PERF;
      else process.env.REACT_APP_FND_PERF = previousPerformanceMode;
      if (previousProjectId === undefined) delete process.env.REACT_APP_FND_PERF_PROJECT_ID;
      else process.env.REACT_APP_FND_PERF_PROJECT_ID = previousProjectId;
    }
  });
});
