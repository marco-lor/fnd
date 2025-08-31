// file ./frontend/src/components/firebaseConfig.js # do not remove this line
import { initializeApp } from "firebase/app";
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

// Log the window location hostname for debugging
console.log("Window Location Hostname:", window.location.hostname);

// Dynamically set our backend URL
const isLocalhost = window.location.hostname === "localhost";
const API_BASE_URL = isLocalhost
  ? "http://127.0.0.1:8000"   // Your local FastAPI endpoint
  : "https://fnd-64ts.onrender.com"; // Your Render URL

// Initialize Firebase
const app = initializeApp(firebaseConfig);
// const analytics = getAnalytics(app);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app); // Initialize Storage
const functions = getFunctions(app, 'europe-west1');

// Export Firebase services and API base URL
export { auth, db, storage, API_BASE_URL, app, functions };
