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

const runtimeProjectId = (): string => {
  const inherited = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
  if (inherited) return inherited.trim();
  try {
    const parsed = JSON.parse(process.env.FIREBASE_CONFIG || "{}") as {
      projectId?: unknown;
    };
    return typeof parsed.projectId === "string" ? parsed.projectId.trim() : "";
  } catch {
    return "";
  }
};

const expectedStorageBucket = (projectId: string): string => (
  projectId.startsWith("demo-")
    ? `${projectId}.appspot.com`
    : `${projectId}.firebasestorage.app`
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

  const deployedProjectId = runtimeProjectId();
  if (deployedProjectId && config.projectId !== deployedProjectId) {
    throw new Error("Firebase client project does not match the deployed Functions project.");
  }
  if (deployedProjectId && config.authDomain !== `${deployedProjectId}.firebaseapp.com`) {
    throw new Error("Firebase client auth domain does not match the deployed Functions project.");
  }
  if (deployedProjectId && config.storageBucket !== expectedStorageBucket(deployedProjectId)) {
    throw new Error("Firebase client storage bucket does not match the deployed Functions project.");
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
    try {
      response.status(200).json(buildClientConfig());
    } catch (_error) {
      response.status(500).json({
        error: "Firebase runtime configuration is inconsistent with the deployed project.",
      });
    }
  }
);
