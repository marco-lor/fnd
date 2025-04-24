import {onDocumentUpdated} from "firebase-functions/v2/firestore";
import * as admin from "firebase-admin";

// Define parameter interfaces
interface SingleParam {
  Base?: number;
  Anima?: number;
  Equip?: number;
  Mod?: number;
  Tot?: number;
}
interface Parametri {
  Base?: Record<string, SingleParam>;
  Combattimento?: Record<string, SingleParam>;
}

// eslint-disable-next-line max-len
// Cloud function to calculate Anima modifiers based on user selections and level
export const updateAnimaModifier = onDocumentUpdated(
  {
    document: "users/{userId}",
    region: "europe-west8",
  },
  async (event) => {
    const userId = event.params?.userId;
    const beforeData = event.data?.before?.data();
    const afterData = event.data?.after?.data();
    if (!userId || !beforeData || !afterData) return;

    // Only proceed if one of the Anima shard selections has changed
    // eslint-disable-next-line max-len
    const beforeAltri = beforeData.AltriParametri as Record<string, string> || {};
    const afterAltri = afterData.AltriParametri as Record<string, string> || {};
    const keys = ["Anima_1", "Anima_4", "Anima_7"];
    const changed = keys.some((k) => beforeAltri[k] !== afterAltri[k]);
    if (!changed) {
      // eslint-disable-next-line max-len
      console.log("No Anima shard change detected, skipping updateAnimaModifier");
      return;
    }

    const altri = afterData.AltriParametri as Record<string, string> || {};
    const stats = afterData.stats as Record<string, any> || {};
    const parametri = afterData.Parametri as Parametri || {};
    // Fetch anima configs from utils/varie doc
    const utilsRef = admin.firestore().collection("utils").doc("varie");
    const utilsSnap = await utilsRef.get();
    const utilsData = utilsSnap.data() || {};
    // eslint-disable-next-line max-len
    const levelUpBonus = (utilsData.levelUpAnimaBonus as Record<string, Record<string, number>>) || {};
    // eslint-disable-next-line max-len
    const modAnima = (utilsData.modAnima as Record<string, Record<string, number>>) || {};

    const userLevel = stats.level || 1;
    // Prepare accumulators
    const baseAnimaAccum: Record<string, number> = {};
    const combatAnimaAccum: Record<string, number> = {};

    // Define shards with their level windows
    const shards = [
      {key: "Anima_1", start: 2, end: 4},
      {key: "Anima_4", start: 5, end: 7},
      {key: "Anima_7", start: 8, end: 10},
    ];

    for (const shard of shards) {
      const name = altri[shard.key];
      if (!name) continue;
      // Permanent base mods
      const baseMods = modAnima[name] || {};
      for (const [param, bonus] of Object.entries(baseMods)) {
        const b = bonus as number;
        baseAnimaAccum[param] = (baseAnimaAccum[param] || 0) + b;
      }
      // Level-up bonus count
      const from = shard.start;
      const to = shard.end;
      if (userLevel >= from) {
        const levels = Math.min(userLevel, to) - (from - 1);
        const levelMods = levelUpBonus[name] || {};
        for (const [param, bonus] of Object.entries(levelMods)) {
          const b = bonus as number;
          combatAnimaAccum[param] = (combatAnimaAccum[param] || 0) + b * levels;
        }
      }
    }

    // Prepare updated parameters
    const updated: Parametri = {...parametri};
    // Apply to Base section
    if (updated.Base) {
      for (const [param, cfg] of Object.entries(updated.Base)) {
        // eslint-disable-next-line max-len
        const animaVal = (baseAnimaAccum[param] || 0) + (combatAnimaAccum[param] || 0);
        cfg.Anima = animaVal;
      }
    }
    // Apply to Combattimento section
    if (updated.Combattimento) {
      for (const [param, cfg] of Object.entries(updated.Combattimento)) {
        const animaVal = combatAnimaAccum[param] || 0;
        cfg.Anima = animaVal;
      }
    }

    // Update Firestore if changes detected
    try {
      // eslint-disable-next-line max-len
      await admin.firestore().collection("users").doc(userId).update({Parametri: updated});
      console.log(`Anima modifiers updated for user ${userId}`);
    } catch (err) {
      console.error("Failed to update Anima modifiers", err);
    }
  }
);
