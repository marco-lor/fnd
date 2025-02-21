import {onDocumentUpdated} from "firebase-functions/v2/firestore";
import * as admin from "firebase-admin";

// eslint-disable-next-line max-len
// Do NOT initialize Firebase Admin here because it's already initialized in index.ts.

export const updateHpTotal = onDocumentUpdated(
  {
    document: "users/{userId}",
    region: "europe-west8", // Deploy to the same region as updateTotParameters
  },
  (event) => {
    // Check if event data is available.
    if (!event.data) {
      console.error("No event data received");
      return;
    }

    // Use the before and after snapshots from the Change object.
    const beforeSnapshot = event.data.before;
    const afterSnapshot = event.data.after;

    const beforeData = beforeSnapshot.data();
    const afterData = afterSnapshot.data();

    // Safely access the "Salute[Tot]" parameter in Parametri.Combattimento.
    const oldSaluteTot = beforeData?.Parametri?.Combattimento?.Salute?.Tot;
    const newSaluteTot = afterData?.Parametri?.Combattimento?.Salute?.Tot;

    // Exit early if "Salute[Tot]" hasn't changed.
    if (oldSaluteTot === newSaluteTot) {
      console.log("No change in Salute[Tot], skipping hpTotal update.");
      return;
    }

    // Calculate hpTotal: 5 * Salute[Tot] + 8.
    const hpTotal = 5 * newSaluteTot + 8;

    // Retrieve the userId from event.params.
    const userId = event.params.userId;
    const docRef = admin.firestore().doc(`users/${userId}`);

    return docRef.update({
      "stats.hpTotal": hpTotal,
    });
  }
);
