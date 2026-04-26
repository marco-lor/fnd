import {defineString} from "firebase-functions/params";
import {onRequest} from "firebase-functions/v2/https";

const REGION = "europe-west1";

const firebaseApiKey = defineString("FATINS_FIREBASE_API_KEY");
const firebaseAuthDomain = defineString("FATINS_FIREBASE_AUTH_DOMAIN");
const firebaseProjectId = defineString("FATINS_FIREBASE_PROJECT_ID");
const firebaseStorageBucket = defineString("FATINS_FIREBASE_STORAGE_BUCKET");
const firebaseMessagingSenderId = defineString(
  "FATINS_FIREBASE_MESSAGING_SENDER_ID"
);
const firebaseAppId = defineString("FATINS_FIREBASE_APP_ID");
const firebaseMeasurementId = defineString(
  "FATINS_FIREBASE_MEASUREMENT_ID",
  {default: ""}
);

const buildClientConfig = () => {
  const measurementId = firebaseMeasurementId.value();
  const config: Record<string, string> = {
    apiKey: firebaseApiKey.value(),
    authDomain: firebaseAuthDomain.value(),
    projectId: firebaseProjectId.value(),
    storageBucket: firebaseStorageBucket.value(),
    messagingSenderId: firebaseMessagingSenderId.value(),
    appId: firebaseAppId.value(),
  };

  if (measurementId) {
    config.measurementId = measurementId;
  }

  return config;
};

export const clientFirebaseConfig = onRequest(
  {
    region: REGION,
    cors: false,
  },
  (request, response): void => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.set("Allow", "GET, HEAD");
      response.status(405).send("Method Not Allowed");
      return;
    }

    response.set("Cache-Control", "private, max-age=300");
    response.set("Content-Type", "application/json; charset=utf-8");
    response.status(200).json(buildClientConfig());
  }
);
