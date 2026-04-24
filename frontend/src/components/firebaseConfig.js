// file ./frontend/src/components/firebaseConfig.js # do not remove this line
import { initializeApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";
// import { getAnalytics } from "firebase/analytics";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getFunctions } from "firebase/functions";
import { getStorage } from "firebase/storage";

// Your Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyAVSeJEuvgzpsVJoxXPZe_jhFJbyAdfCWY",
  authDomain: "fatins.firebaseapp.com",
  projectId: "fatins",
  storageBucket: "fatins.firebasestorage.app",
  messagingSenderId: "65565416227",
  appId: "1:65565416227:web:77dcc904f276932d424a96",
  measurementId: "G-ME2YPD5ZHC",
};

// Initialize Firebase
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
