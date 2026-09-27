import * as admin from "firebase-admin";
import {onDocumentWritten} from "firebase-functions/v2/firestore";
import {createHash, randomUUID} from "crypto";
import {isDeepStrictEqual} from "util";

import {buildManagerUserSummary} from "./managerUserSummaryProjection";
export {buildManagerUserSummary} from "./managerUserSummaryProjection";

// Stable hashes make dry-run approval independent of Firestore map ordering.
const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical) :
  value && typeof value === "object" ? Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const hash = (value: unknown): string => createHash("sha256")
  .update(JSON.stringify(canonical(value))).digest("hex");

export interface SummaryPlanEntry {
  uid: string;
  action: string;
  currentHash: string;
  projectionHash: string;
}

const summaryForShell = (
  shell: admin.firestore.DocumentSnapshot, domains: Record<string, unknown>
): Record<string, any> | null => shell.exists &&
    shell.get("deletionState") !== "pending" &&
    ["player", "players"].includes(shell.get("role")) ?
    buildManagerUserSummary(domains) : null;

// Bulk commands already read their canonical inputs in an authoritative
// transaction. Maintain the projection there rather than enqueue a second
// transaction per subject. The marker is private server-owned state metadata.
export const maintainManagerSummaryInTransaction = (
  transaction: admin.firestore.Transaction,
  target: admin.firestore.DocumentReference,
  shell: admin.firestore.DocumentSnapshot,
  existing: admin.firestore.DocumentSnapshot,
  domains: Record<string, unknown>
): Record<string, unknown> => {
  const summary = summaryForShell(shell, domains);
  if (summary && !isDeepStrictEqual(existing.data(), summary)) {
    transaction.set(target, summary);
  } else if (!summary && existing.exists) {
    transaction.delete(target);
  }
  return {managerSummaryCommitId: randomUUID()};
};

export const summaryMaintainedInCommit = (
  before: admin.firestore.DocumentSnapshot,
  after: admin.firestore.DocumentSnapshot
): boolean => {
  const marker = after.get("managerSummaryCommitId");
  // Only a new server-owned commit ID certifies this atomic projection write.
  // Later merges retain the ID and MUST reconcile, even if values revert to a
  // previously projected value. No timestamp precision assumptions are needed.
  return after.exists && typeof marker === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(marker) &&
    (!before.exists || marker !== before.get("managerSummaryCommitId"));
};

export const inspectManagerUserSummary = async (
  db: admin.firestore.Firestore, uid: string, write = false,
  approved?: SummaryPlanEntry
): Promise<SummaryPlanEntry> => {
  const root = db.doc(`users/${uid}`);
  const target = db.doc(`manager_user_summaries/${uid}`);
  // Five backend reads per transaction attempt, at most one write. Approval
  // preconditions are checked in this same transaction, including on retries.
  return db.runTransaction(async (transaction) => {
    const [shell, progression, resources, settings, existing] =
      await transaction.getAll(root, root.collection("state").doc("progression"),
        root.collection("state").doc("resources"),
        root.collection("state").doc("settings"), target);
    const summary = summaryForShell(shell, {
      progression: progression.data(), resources: resources.data(),
      settings: settings.data(),
    });
    const currentHash = hash(existing.exists ? existing.data() : null);
    const projectionHash = hash(summary);
    if (approved && (approved.uid !== uid || approved.projectionHash !== projectionHash ||
        ![approved.currentHash, projectionHash].includes(currentHash))) {
      throw new Error(`Stale summary approval for ${uid}; create a new dry-run report.`);
    }
    const action = currentHash === projectionHash ? "unchanged" : summary ? "set" : "delete";
    if (write && action === "set") transaction.set(target, summary!);
    if (write && action === "delete") transaction.delete(target);
    return {uid, action, currentHash, projectionHash};
  });
};

export const reconcileManagerUserSummary = async (
  db: admin.firestore.Firestore, uid: string, write = true
): Promise<string> => (await inspectManagerUserSummary(db, uid, write)).action;

export const syncManagerUserSummary = onDocumentWritten({
  document: "users/{uid}/state/{domain}", region: "europe-west8",
}, async (event) => {
  const domain = event.params.domain;
  if (!["progression", "resources", "settings"].includes(domain) || !event.data) return;
  if (summaryMaintainedInCommit(event.data.before, event.data.after)) return;
  const before = buildManagerUserSummary({[domain]: event.data.before.data()});
  const after = buildManagerUserSummary({[domain]: event.data.after.data()});
  if (event.data.before.exists && event.data.after.exists &&
      JSON.stringify(before) === JSON.stringify(after)) return;
  await reconcileManagerUserSummary(admin.firestore(), event.params.uid);
});

export const syncManagerUserSummaryShell = onDocumentWritten({
  document: "users/{uid}", region: "europe-west8",
}, async (event) => {
  if (!event.data) return;
  if (event.data.before.exists && event.data.after.exists &&
      event.data.before.get("role") === event.data.after.get("role") &&
      event.data.before.get("deletionState") === event.data.after.get("deletionState")) return;
  await reconcileManagerUserSummary(admin.firestore(), event.params.uid);
});
