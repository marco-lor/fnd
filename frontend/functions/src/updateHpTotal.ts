import {onDocumentUpdated} from "firebase-functions/v2/firestore";
import * as admin from "firebase-admin";
import {applyLegacyRootTriggerUpdate} from "./legacyRootMutationGate";

// eslint-disable-next-line max-len
// Do NOT initialize Firebase Admin here because it's already initialized in index.ts.

export const updateHpTotal = onDocumentUpdated(
  {
    document: "users/{userId}",
    region: "europe-west8", // Deploy to the same region as updateTotParameters
  },
  async (event) => {
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

    // Retrieve the userId from event.params.
    const userId = event.params.userId;

    // Safely access the "Salute[Tot]" parameter in Parametri.Combattimento.
    const oldSaluteTot = beforeData?.Parametri?.Combattimento?.Salute?.Tot;
    const newSaluteTot = afterData?.Parametri?.Combattimento?.Salute?.Tot;

    // Check if level has changed
    const oldLevel = beforeData?.stats?.["level"];
    const newLevel = afterData?.stats?.["level"];

    // Exit early if neither Salute[Tot] nor level has changed.
    if (oldSaluteTot === newSaluteTot && oldLevel === newLevel) {
      // eslint-disable-next-line max-len
      console.log("No change in Salute[Tot] or level, skipping hpTotal update.");
      return;
    }

    // Get the current salute value and level
    const currentSaluteTot = newSaluteTot || oldSaluteTot;
    const currentLevel = newLevel || oldLevel;

    if (!currentSaluteTot || !currentLevel) {
      console.error("Missing required values: Salute[Tot] or level");
      return;
    }

    // Fetch the HP multiplier for the user's level from the database
    try {
      const hpMultDoc = await admin.firestore().doc("utils/varie").get();
      const hpMultByLevel = hpMultDoc.data()?.hpMultByLevel || {};

      // eslint-disable-next-line max-len
      // Get the multiplier for the current level (as a string key) or default to 5
      const levelKey = currentLevel.toString();
      const hpMultiplier = hpMultByLevel[levelKey] || 5;

      // Calculate hpTotal using the correct multiplier
      const hpTotal = hpMultiplier * currentSaluteTot + 8;

      // The source/config fence prevents delayed Admin SDK writes after drain.
      return applyLegacyRootTriggerUpdate({
        uid: userId,
        label: "updateHpTotal",
        expectedFields: {
          "Parametri.Combattimento.Salute.Tot": newSaluteTot,
          "stats.level": newLevel,
        },
        update: {"stats.hpTotal": hpTotal},
      });
    } catch (error) {
      console.error("Error updating hpTotal:", error);
      return null;
    }
  }
);
