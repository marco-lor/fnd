import {onDocumentUpdated} from "firebase-functions/v2/firestore";
import * as admin from "firebase-admin";
import {applyLegacyRootTriggerUpdate} from "./legacyRootMutationGate";
import {buildAnimaModifierFieldUpdate} from "./userDataV2";

// eslint-disable-next-line max-len
// Cloud function to calculate Anima modifiers based on user selections and level
export const updateAnimaModifier = onDocumentUpdated(
  {
    document: "users/{userId}",
    region: "europe-west8",
  },
  async (event) => {
    // Prevent loops: only proceed if relevant fields changed
    const beforeData = event.data?.before?.data();
    const afterData = event.data?.after?.data();
    const userId = event.params?.userId;
    if (!userId || !beforeData || !afterData) return;
    const oldAltri = JSON.stringify(beforeData.AltriParametri || {});
    const newAltri = JSON.stringify(afterData.AltriParametri || {});
    const oldLevel = beforeData.stats?.level;
    const newLevel = afterData.stats?.level;
    if (oldAltri === newAltri && oldLevel === newLevel) {
      // eslint-disable-next-line max-len
      console.log("No change in AltriParametri or stats.level, skipping animaModifier update.");
      return;
    }

    // Fetch anima configs from utils/varie doc
    const utilsRef = admin.firestore().collection("utils").doc("varie");
    const utilsSnap = await utilsRef.get();
    const utilsData = utilsSnap.data() || {};

    // Update Firestore if changes detected
    try {
      const result = await applyLegacyRootTriggerUpdate({
        uid: userId,
        label: "updateAnimaModifier",
        expectedFields: {
          AltriParametri: afterData.AltriParametri,
          "stats.level": afterData.stats?.level,
        },
        buildUpdate: (currentSource) => buildAnimaModifierFieldUpdate(
          currentSource,
          utilsData
        ),
      });
      if (result === "applied") {
        console.log(`Anima modifiers updated for user ${userId}`);
      }
    } catch (err) {
      console.error("Failed to update Anima modifiers", err);
    }
  }
);
