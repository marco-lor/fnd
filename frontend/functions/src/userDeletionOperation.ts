import {randomUUID} from "crypto";
import * as admin from "firebase-admin";
import {HttpsError} from "firebase-functions/v2/https";
import {FieldValue, Timestamp} from "firebase-admin/firestore";
import {assertActiveCaller} from "./callerAuthorization";
import {
  BACKEND_OPERATION_LEASE_MS,
  backendOperationExpiry,
  backendOperationReceiptId,
  backendOperationRequestHash,
  operationViewFromData,
  validateBackendOperationId,
} from "./backendOperationCore";

// Drain sibling RPCs before releasing a failed claim. RPCs already sent before
// lease loss remain idempotent fixed-target cleanup under the permanent fence.
export const drainDeletionWork = async <T>(work: Promise<T>[]): Promise<T[]> => {
  const settled = await Promise.allSettled(work);
  const failed = settled.find((entry) => entry.status === "rejected");
  if (failed?.status === "rejected") throw failed.reason;
  return settled.map((entry) => (entry as PromiseFulfilledResult<T>).value);
};

export const claimUserDeletion = async (
  db: admin.firestore.Firestore,
  actorUid: string,
  targetUid: string,
  suppliedOperationId: unknown
) => {
  const deadline = Date.now() + 50 * 1000;
  if (actorUid === targetUid) {
    throw new HttpsError("failed-precondition", "You cannot delete your own account.");
  }
  const operationId = suppliedOperationId === undefined ? "" :
    validateBackendOperationId(suppliedOperationId);
  if (suppliedOperationId !== undefined && !operationId) {
    throw new HttpsError("invalid-argument", "operationId is invalid.");
  }
  const invocationId = randomUUID();
  const jobRef = db.doc(`user_deletion_jobs/${targetUid}`);
  const targetRef = db.doc(`users/${targetUid}`);
  const operationRef = operationId ? db.doc(
    `backend_operations/${backendOperationReceiptId(actorUid, operationId)}`
  ) : null;
  const requestHash = backendOperationRequestHash("delete-user", {userId: targetUid});
  const claim = await db.runTransaction(async (tx) => {
    const [actor, target, job, actorJob, operation] = await Promise.all([
      tx.get(db.doc(`users/${actorUid}`)), tx.get(targetRef), tx.get(jobRef),
      tx.get(db.doc(`user_deletion_jobs/${actorUid}`)),
      operationRef ? tx.get(operationRef) : Promise.resolve(null),
    ]);
    assertActiveCaller(actor);
    if (actor.get("role") !== "webmaster" || actorJob.exists) {
      throw new HttpsError("permission-denied", "Only active webmasters can delete users.");
    }
    if (operation?.exists && (operation.get("actorUid") !== actorUid ||
      operation.get("requestHash") !== requestHash ||
      operation.get("kind") !== "delete-user" ||
      operation.get("targetUid") !== targetUid)) {
      throw new HttpsError("already-exists", "operationId belongs to another request.");
    }
    if (operation?.get("status") === "completed") {
      return {run: false, operation: operationViewFromData(operation.data(), true)};
    }
    const lease = job.get("leaseExpiresAt");
    if (job.get("stage") !== "completed" && lease instanceof Timestamp &&
      lease.toMillis() > Date.now()) {
      if (operation?.exists && job.get("activeReceiptId") === operationRef?.id) {
        return {run: false, operation: operationViewFromData(operation.data(), true)};
      }
      throw new HttpsError("aborted", "User deletion is already in progress. Retry later.");
    }
    const completed = job.get("stage") === "completed";
    const progress = {planned: 5, processed: completed ? 5 : 0,
      succeeded: completed ? 5 : 0, skipped: 0, failed: 0};
    const receipt = {schemaVersion: 1, operationId, actorUid, targetUid,
      kind: "delete-user", requestHash, invocationId,
      status: completed ? "completed" : "running", progress, retryable: false,
      stage: completed ? "completed" : "pending",
      leaseExpiresAt: Timestamp.fromMillis(Date.now() + BACKEND_OPERATION_LEASE_MS),
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: operation?.get("createdAt") || FieldValue.serverTimestamp(),
      expiresAt: backendOperationExpiry()};
    if (operationRef) tx.set(operationRef, receipt);
    if (!completed) {
      tx.set(jobRef, {schemaVersion: 3, targetUid, requestedBy: actorUid,
        stage: "pending", invocationId, activeReceiptId: operationRef?.id || "",
        leaseExpiresAt: receipt.leaseExpiresAt,
        attempts: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp(),
        createdAt: job.get("createdAt") || FieldValue.serverTimestamp()}, {merge: true});
      if (target.exists) tx.update(targetRef, {deletionState: "pending",
        deletionRequestedAt: FieldValue.serverTimestamp(), deletionRequestedBy: actorUid});
    }
    return {run: !completed,
      operation: operationRef ? operationViewFromData(receipt, completed) : null};
  });
  const check = (job: admin.firestore.DocumentSnapshot) => {
    const lease = job.get("leaseExpiresAt");
    if (Date.now() >= deadline || job.get("invocationId") !== invocationId ||
      !(lease instanceof Timestamp) || lease.toMillis() <= Date.now()) {
      throw new HttpsError("aborted", "Deletion runner lease expired. Retry the operation.");
    }
  };
  const assertLease = async () => check(await jobRef.get());
  const step = async <T>(work: () => Promise<T>): Promise<T> => {
    await assertLease();
    const result = await work();
    await assertLease();
    return result;
  };
  const progress = async (
    stage: string,
    processed: number,
    extra: Record<string, unknown> = {}
  ) => db.runTransaction(async (tx) => {
    check(await tx.get(jobRef));
    const completed = stage === "completed";
    const failed = stage === "failed";
    const terminal = completed || failed;
    const update = {...extra, stage, updatedAt: FieldValue.serverTimestamp(),
      ...(terminal ? {leaseExpiresAt: Timestamp.fromMillis(0)} : {}),
      ...(completed ? {completedAt: FieldValue.serverTimestamp()} : {})};
    tx.set(jobRef, update, {merge: true});
    if (operationRef) tx.set(operationRef, {...update,
      status: completed ? "completed" : failed ? "failed" : "running",
      retryable: failed,
      progress: {planned: 5, processed, succeeded: processed, skipped: 0,
        failed: failed ? 1 : 0}}, {merge: true});
  });
  const view = async () => operationRef ? operationViewFromData(
    (await operationRef.get()).data()
  ) : null;
  return {...claim, assertLease, step, progress, view};
};
