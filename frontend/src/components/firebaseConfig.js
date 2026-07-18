// file ./frontend/src/components/firebaseConfig.js # do not remove this line
import { getApp, getApps, initializeApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore } from "../performance/firestore";
import { connectFunctionsEmulator, getFunctions } from "firebase/functions";
import { connectStorageEmulator, getStorage } from "firebase/storage";

export const FIREBASE_CONFIG_ENDPOINT = "/fatins-runtime/firebase-client";

const performanceMode = process.env.REACT_APP_FND_PERF === "1";
const performanceProjectId = process.env.REACT_APP_FND_PERF_PROJECT_ID || "demo-fnd-perf";
const requiredConfigKeys = [
  "apiKey",
  "authDomain",
  "projectId",
  "storageBucket",
  "messagingSenderId",
  "appId",
];

export const testFirebaseConfig = {
  apiKey: "test-api-key",
  authDomain: "test.firebaseapp.com",
  projectId: "test",
  storageBucket: "test.appspot.com",
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:test",
};

export let app;
export let auth;
export let db;
export let storage;
export let functions;

let initializationPromise = null;
let appCheckInitialized = false;
let emulatorsConnected = false;

export const validateFirebaseConfig = (config) => {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("Firebase runtime config is malformed.");
  }

  const missingKeys = requiredConfigKeys.filter((key) => (
    typeof config[key] !== "string" || !config[key].trim()
  ));

  if (missingKeys.length) {
    throw new Error(`Firebase runtime config is missing: ${missingKeys.join(", ")}`);
  }

  return config;
};

const getStaticFirebaseConfig = () => {
  const browserPerformanceProbeForcesRuntime = (
    performanceMode
    && typeof window !== "undefined"
    && window.__FND_PERF_FORCE_RUNTIME_CONFIG__ === true
  );

  if (performanceMode && !browserPerformanceProbeForcesRuntime) {
    if (!performanceProjectId.startsWith("demo-")) {
      throw new Error(
        `Performance mode requires a demo Firebase project, received: ${performanceProjectId}`
      );
    }

    return {
      ...testFirebaseConfig,
      authDomain: `${performanceProjectId}.firebaseapp.com`,
      projectId: performanceProjectId,
      storageBucket: `${performanceProjectId}.appspot.com`,
    };
  }

  if (process.env.NODE_ENV === "test") {
    return testFirebaseConfig;
  }

  return null;
};

export const loadFirebaseConfig = async ({ fetchImpl, forceRuntime = false } = {}) => {
  const staticConfig = forceRuntime ? null : getStaticFirebaseConfig();
  if (staticConfig) return validateFirebaseConfig(staticConfig);

  const resolvedFetch = fetchImpl || (
    typeof window !== "undefined" && typeof window.fetch === "function"
      ? window.fetch.bind(window)
      : null
  );

  if (typeof resolvedFetch !== "function") {
    throw new Error("Firebase runtime config requires Fetch API support.");
  }

  const response = await resolvedFetch(FIREBASE_CONFIG_ENDPOINT, {
    method: "GET",
    headers: { Accept: "application/json" },
    credentials: "same-origin",
  });

  if (!response?.ok) {
    throw new Error(`Failed to load Firebase runtime config (${response?.status || "network"}).`);
  }

  let config;
  try {
    config = await response.json();
  } catch (_error) {
    throw new Error("Firebase runtime config is malformed.");
  }

  return validateFirebaseConfig(config);
};

const initializeFirebaseServices = (config, {
  production = process.env.NODE_ENV === "production",
  appCheckSiteKey = process.env.REACT_APP_RECAPTCHA_V3_SITE_KEY,
} = {}) => {
  if (app && auth && db && storage && functions) {
    return { app, auth, db, storage, functions };
  }

  app = getApps().length ? getApp() : initializeApp(validateFirebaseConfig(config));

  if (
    production
    && appCheckSiteKey
    && !appCheckInitialized
  ) {
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(appCheckSiteKey),
      isTokenAutoRefreshEnabled: true,
    });
    appCheckInitialized = true;
  }

  auth = getAuth(app);
  db = getFirestore(app);
  storage = getStorage(app);
  functions = getFunctions(app, "europe-west1");

  if (performanceMode && !emulatorsConnected) {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    connectFirestoreEmulator(db, "127.0.0.1", 8080);
    connectStorageEmulator(storage, "127.0.0.1", 9199);
    connectFunctionsEmulator(functions, "127.0.0.1", 5001);
    emulatorsConnected = true;
  }

  return { app, auth, db, storage, functions };
};

export const initializeFirebase = ({ fetchImpl, onPhase, forceRuntime = false } = {}) => {
  if (app && auth && db && storage && functions) {
    return Promise.resolve({ app, auth, db, storage, functions });
  }

  if (initializationPromise) return initializationPromise;

  onPhase?.("config-loading");
  initializationPromise = loadFirebaseConfig({ fetchImpl, forceRuntime })
    .then((config) => {
      onPhase?.("firebase-initializing");
      return initializeFirebaseServices(config);
    })
    .catch((error) => {
      initializationPromise = null;
      throw error;
    });

  return initializationPromise;
};

export const __resetFirebaseForTests = () => {
  if (process.env.NODE_ENV !== "test") return;
  app = undefined;
  auth = undefined;
  db = undefined;
  storage = undefined;
  functions = undefined;
  initializationPromise = null;
  appCheckInitialized = false;
  emulatorsConnected = false;
};

export const __initializeFirebaseServicesForTests = (config, options) => {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("The Firebase service test hook is unavailable outside Jest.");
  }
  return initializeFirebaseServices(config, options);
};

// Jest imports feature modules directly, and ordinary performance builds can use a
// deterministic static configuration. Initialize those configurations eagerly so
// existing service imports remain valid outside the browser bootstrap entrypoint.
const staticFirebaseConfig = getStaticFirebaseConfig();
if (staticFirebaseConfig) {
  initializeFirebaseServices(staticFirebaseConfig);
  initializationPromise = Promise.resolve({ app, auth, db, storage, functions });
}
