const requiredConfig = {
  apiKey: "FATINS_FIREBASE_API_KEY",
  authDomain: "FATINS_FIREBASE_AUTH_DOMAIN",
  projectId: "FATINS_FIREBASE_PROJECT_ID",
  storageBucket: "FATINS_FIREBASE_STORAGE_BUCKET",
  messagingSenderId: "FATINS_FIREBASE_MESSAGING_SENDER_ID",
  appId: "FATINS_FIREBASE_APP_ID",
};

const optionalConfig = {
  measurementId: "FATINS_FIREBASE_MEASUREMENT_ID",
};

const buildFirebaseConfig = () => {
  const missing = Object.values(requiredConfig).filter((envName) => (
    !process.env[envName]
  ));

  if (missing.length) {
    return {
      config: null,
      missing,
    };
  }

  const config = Object.fromEntries(
    Object.entries(requiredConfig).map(([key, envName]) => [
      key,
      process.env[envName],
    ])
  );

  for (const [key, envName] of Object.entries(optionalConfig)) {
    if (process.env[envName]) {
      config[key] = process.env[envName];
    }
  }

  return {
    config,
    missing: [],
  };
};

module.exports = function setupProxy(app) {
  app.get("/fatins-runtime/firebase-client", (_request, response) => {
    const { config, missing } = buildFirebaseConfig();

    if (missing.length) {
      response.status(500).json({
        error: "Missing local Firebase runtime config.",
        missing,
      });
      return;
    }

    response.set("Cache-Control", "no-store");
    response.json(config);
  });
};
