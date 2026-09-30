import * as admin from "firebase-admin";
import {onDocumentWritten} from "firebase-functions/v2/firestore";
import {asRecord} from "./userDataV2";

export const foeOrderSeconds = (data: Record<string, unknown>): number => {
  const seconds = Number(asRecord(data.updated_at).seconds ||
    asRecord(data.created_at).seconds || 0);
  if (!Number.isFinite(seconds)) throw new Error("Invalid foe timestamp seconds.");
  return seconds;
};

// Read the current document transactionally: reordered trigger deliveries must
// never restore an older sort key. The source timestamps are never rewritten.
export const reconcileFoeOrder = async (
  db: admin.firestore.Firestore, id: string
): Promise<boolean> => db.runTransaction(async (transaction) => {
  const ref = db.doc(`foes/${id}`);
  const current = await transaction.get(ref);
  if (!current.exists) return false;
  const seconds = foeOrderSeconds(current.data()!);
  if (current.get("task13OrderSeconds") === seconds) return false;
  transaction.update(ref, {task13OrderSeconds: seconds});
  return true;
});

export const syncFoeOrder = onDocumentWritten({
  document: "foes/{foeId}", region: "europe-west8",
}, async (event) => {
  if (!event.data?.after.exists) return;
  if (event.data.after.get("task13OrderSeconds") ===
      foeOrderSeconds(event.data.after.data()!)) return;
  await reconcileFoeOrder(admin.firestore(), event.params.foeId);
});
