// file ./frontend/src/components/firebaseConfig.js
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getAuth } from "firebase/auth";

// Your existing config
const firebaseConfig = {
  apiKey: "AIzaSyAVSeJEuvgzpsVJoxXPZe_jhFJbyAdfCWY",
  authDomain: "fatins.firebaseapp.com",
  projectId: "fatins",
  storageBucket: "fatins.firebasestorage.app",
  messagingSenderId: "65565416227",
  appId: "1:65565416227:web:77dcc904f276932d424a96",
  measurementId: "G-ME2YPD5ZHC"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);

// Initialize Firebase Auth
const auth = getAuth(app);

// Export the auth so we can use it in other components
export { auth };
