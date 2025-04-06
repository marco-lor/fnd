import {onDocumentUpdated} from "firebase-functions/v2/firestore";
import * as admin from "firebase-admin";

// eslint-disable-next-line max-len
// Do NOT initialize Firebase Admin here because it's already initialized in index.ts.

export const updateManaTotal = onDocumentUpdated(
  {
    document: "users/{userId}",
    region: "europe-west8", // same region as updateTotParameters
  },
  async (event) => {
    // Check if event data is available.
    if (!event.data) {
      console.error("No event data received");
      return;
    }

    // Retrieve before and after snapshots.
    const beforeSnapshot = event.data.before;
    const afterSnapshot = event.data.after;

    const beforeData = beforeSnapshot.data();
    const afterData = afterSnapshot.data();

    // Retrieve the userId from event.params.
    const userId = event.params.userId;

    // Safely access the "Disciplina[Tot]" parameter in Parametri.Combattimento.
    // eslint-disable-next-line max-len
    const oldDisciplinaTot = beforeData?.Parametri?.Combattimento?.Disciplina?.Tot;
    // eslint-disable-next-line max-len
    const newDisciplinaTot = afterData?.Parametri?.Combattimento?.Disciplina?.Tot;

    // Check if level has changed
    const oldLevel = beforeData?.stats?.["level"];
    const newLevel = afterData?.stats?.["level"];

    // Exit early if neither Disciplina[Tot] nor level has changed.
    if (oldDisciplinaTot === newDisciplinaTot && oldLevel === newLevel) {
      // eslint-disable-next-line max-len
      console.log("No change in Disciplina[Tot] or level, skipping manaTotal update.");
      return;
    }

    // Get the current disciplina value and level
    const currentDisciplinaTot = newDisciplinaTot || oldDisciplinaTot;
    const currentLevel = newLevel || oldLevel;

    if (!currentDisciplinaTot || !currentLevel) {
      console.error("Missing required values: Disciplina[Tot] or level");
      return;
    }

    // Fetch the mana multiplier for the user's level from the database
    try {
      const manaMultDoc = await admin.firestore().doc("utils/varie").get();
      const manaMultByLevel = manaMultDoc.data()?.manaMultByLevel || {};

      // eslint-disable-next-line max-len
      // Get the multiplier for the current level (as a string key) or default to 5
      const levelKey = currentLevel.toString();
      const manaMultiplier = manaMultByLevel[levelKey] || 7;

      // Calculate manaTotal using the correct multiplier
      const manaTotal = manaMultiplier * currentDisciplinaTot + 5;

      // Update the user's document with the new manaTotal
      return admin.firestore().doc(`users/${userId}`).update({
        "stats.manaTotal": manaTotal,
      });
    } catch (error) {
      console.error("Error updating manaTotal:", error);
      return null;
    }
  }
);
