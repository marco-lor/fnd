import {onDocumentUpdated} from "firebase-functions/v2/firestore";
import * as admin from "firebase-admin";

// Cloud Function: expireBarriera
// Purpose: Mirror the frontend check in StatsBars.js that automatically
// zeros out the barrier (stats.barrieraCurrent/Total and related turn effect fields)
// when the tracked remainingTurns hits 0 (while totalTurns > 0) OR if remainingTurns becomes
// negative due to any client-side bug.
//
// Trigger: Any update to a user document under users/{userId}
// Region: europe-west8 (to stay consistent with existing functions)
// Logic:
// 1. Detect if active_turn_effect.barriera.remainingTurns changed.
// 2. If previous remainingTurns !== new remainingTurns and newRemaining <= 0 and totalTurns > 0,
//    then reset barrier values and set both remainingTurns and totalTurns to 0.
// 3. Only perform write if something actually needs to change to avoid infinite loops.
// 4. Log actions for observability.

export const expireBarriera = onDocumentUpdated(
  {
    document: "users/{userId}",
    region: "europe-west8",
  },
  async (event) => {
    if (!event.data) {
      console.error("expireBarriera: No event data");
      return;
    }

    const beforeData = event.data.before.data();
    const afterData = event.data.after.data();

    const beforeRemaining = beforeData?.active_turn_effect?.barriera?.remainingTurns;
    const afterRemaining = afterData?.active_turn_effect?.barriera?.remainingTurns;
    const afterTotalTurns = afterData?.active_turn_effect?.barriera?.totalTurns;

    // Only proceed if remaining turns field actually changed.
    if (beforeRemaining === afterRemaining) {
      return; // nothing to do
    }

    // If no barrier turn tracking, skip.
    if (afterTotalTurns == null || afterTotalTurns <= 0) {
      return;
    }

    // If remaining still > 0, nothing to do.
    if (afterRemaining == null || afterRemaining > 0) {
      return;
    }

    // Remaining <= 0 while totalTurns > 0 -> expire barrier.
    const userId = event.params.userId;

    // Current barrier stats (after snapshot)
    const barrieraCurrent = afterData?.stats?.barrieraCurrent ?? 0;
    const barrieraTotal = afterData?.stats?.barrieraTotal ?? 0;

    // If they're already zeroed, avoid redundant write.
    if (barrieraCurrent === 0 && barrieraTotal === 0 && afterRemaining === 0 && afterTotalTurns === 0) {
      return;
    }

    try {
      await admin.firestore().doc(`users/${userId}`).update({
        "stats.barrieraCurrent": 0,
        "stats.barrieraTotal": 0,
        "active_turn_effect.barriera.remainingTurns": 0,
        "active_turn_effect.barriera.totalTurns": 0,
      });
      console.log(`expireBarriera: Barrier expired for user ${userId}`);
    } catch (e) {
      console.error("expireBarriera: Failed to expire barrier", e);
    }
  }
);
