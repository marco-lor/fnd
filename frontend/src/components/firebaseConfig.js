// file ./frontend/src/components/firebaseConfig.js # do not remove this line
import { initializeApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";
// import { getAnalytics } from "firebase/analytics";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getFunctions } from "firebase/functions";
import { getStorage } from "firebase/storage";

const firebaseConfigEndpoint = "/fatins-runtime/firebase-client";
const requiredConfigKeys = [
  "apiKey",
  "authDomain",
  "projectId",
  "storageBucket",
  "messagingSenderId",
  "appId",
];

const testFirebaseConfig = {
  apiKey: "test-api-key",
  authDomain: "test.firebaseapp.com",
  projectId: "test",
  storageBucket: "test.appspot.com",
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:test",
};

const validateFirebaseConfig = (config) => {
  const missingKeys = requiredConfigKeys.filter((key) => !config?.[key]);

  if (missingKeys.length) {
    throw new Error(
      `Firebase runtime config is missing: ${missingKeys.join(", ")}`
    );
  }

  return config;
};

const loadFirebaseConfig = () => {
  if (process.env.NODE_ENV === "test") {
    return testFirebaseConfig;
  }

  if (typeof XMLHttpRequest === "undefined") {
    throw new Error("Firebase runtime config requires XMLHttpRequest.");
  }

  const request = new XMLHttpRequest();
  request.open("GET", firebaseConfigEndpoint, false);
  request.setRequestHeader("Accept", "application/json");
  request.send(null);

  if (request.status < 200 || request.status >= 300) {
    throw new Error(
      `Failed to load Firebase runtime config (${request.status}).`
    );
  }

  return validateFirebaseConfig(JSON.parse(request.responseText));
};

// Initialize Firebase
const firebaseConfig = loadFirebaseConfig();
const app = initializeApp(firebaseConfig);
const appCheckSiteKey = process.env.REACT_APP_RECAPTCHA_V3_SITE_KEY;

if (process.env.NODE_ENV === "production" && appCheckSiteKey) {
  initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(appCheckSiteKey),
    isTokenAutoRefreshEnabled: true,
  });
}

// const analytics = getAnalytics(app);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app); // Initialize Storage
const functions = getFunctions(app, 'europe-west1');

// Export Firebase services
export { auth, db, storage, app, functions };
