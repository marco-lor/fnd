import type {DocumentReference, DocumentSnapshot, Firestore, Transaction} from "firebase-admin/firestore";
import {asFiniteNumber, asRecord} from "./userDataV2";

type BarrierContinuity = {
  ref: DocumentReference;
  since: string | null;
  previousVersion: string | null;
};

export const combatResourceVersion = (snapshot: DocumentSnapshot): string | null =>
  snapshot.updateTime?.valueOf() ?? null;

export const readShieldActivation = (value: unknown): string | null =>
  typeof value === "string" && value.length ? value : null;

export const readBarrierContinuity = async (
  db: Firestore, transaction: Transaction, resource: DocumentSnapshot, barrierDebited = false
): Promise<BarrierContinuity | null> => {
  const stats = asRecord(resource.get("stats"));
  const characterBarrier = (stats.barrieraCurrent ?? stats.barriera) != null &&
    asFiniteNumber(stats.barrieraTotal ?? stats.barriera, 1) > 0;
  const tokenBarrier = stats.shieldCurrent != null && asFiniteNumber(stats.shieldTotal, 1) > 0;
  if (!barrierDebited && !characterBarrier && !tokenBarrier) return null;

  // This subcollection is server-only, including for tokens that clients can edit.
  const ref = db.doc(`${resource.ref.path}/combat_barrier/continuity`);
  const proof = await transaction.get(ref);
  const previousVersion = combatResourceVersion(resource);
  const since = proof.get("since");
  // Both writes share a commit timestamp. A reset or an untracked write breaks
  // the chain, even if it leaves the balance and capacity looking identical.
  return {
    ref,
    previousVersion,
    since: previousVersion !== null && combatResourceVersion(proof) === previousVersion &&
      typeof since === "string" && since <= previousVersion ? since : previousVersion,
  };
};

// Only write this alongside a resource mutation that keeps the same activation.
export const writeBarrierContinuity = (transaction: Transaction, continuity: BarrierContinuity | null): void => {
  if (!continuity) return;
  const {ref, since, previousVersion} = continuity;
  // The input version changes on each write even while the activation is stable.
  transaction.set(ref, {since, previousVersion});
};
