import {randomUUID} from "crypto";
import {onCall, HttpsError, CallableRequest} from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import {FieldValue, Timestamp} from "firebase-admin/firestore";
import {
  BACKEND_OPERATION_LEASE_MS,
  backendOperationExpiry,
  backendOperationReceiptId,
  backendOperationRequestHash,
  resolveTask06BackendConfig,
  validateBackendOperationId,
} from "./backendOperationCore";
import {
  deleteGrigliataCustomTokenLegacyHandler,
} from "./deleteGrigliataCustomTokenLegacy";
import {isUserDataLegacyDrainFrozen} from "./userDataBridge";
import {
  asFiniteNumber,
  asRecord,
  asTrimmedString,
  resolveUserDataRolloutStage,
  writesLegacyUserProjection,
} from "./userDataV2";

type DeleteGrigliataCustomTokenPayload = {
  tokenId?: string;
  operationId?: string;
};

const REGION = "europe-west1";
const HIDDEN_TOKEN_FIELD = "grigliata_hidden_token_ids_by_background";
const IN_QUERY_SIZE = 30;
const INSTANCE_PAGE_SIZE = 100;
const PLACEMENT_PAGE_SIZE = 300;
const WORK_DEADLINE_MS = 45 * 1000;
const TASK06_CONFIG_PATH = "app_config/task06_backend";
const FUNCTION_TIMEOUT_SECONDS = 60;

const isManagerRole = (role: unknown) => (
  asTrimmedString(role).toLowerCase() === "dm"
);

const normalizeHiddenTokenIdsByBackground = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {} as Record<string, string[]>;
  }
  return Object.entries(value as Record<string, unknown>).reduce(
    (nextMap, [backgroundId, tokenIds]) => {
      if (!backgroundId) return nextMap;
      const normalized = [...new Set(
        (Array.isArray(tokenIds) ? tokenIds : [])
          .map(asTrimmedString)
          .filter(Boolean)
      )];
      if (normalized.length) nextMap[backgroundId] = normalized;
      return nextMap;
    },
    {} as Record<string, string[]>
  );
};

const chunkValues = <Value>(values: Value[], size: number): Value[][] => {
  const output: Value[][] = [];
  for (let index = 0; index < values.length; index += size) {
    output.push(values.slice(index, index + size));
  }
  return output;
};

const task06DeleteGrigliataCustomTokenHandler = async (
  request: CallableRequest<DeleteGrigliataCustomTokenPayload>
): Promise<Record<string, unknown>> => {
    const requesterUid = asTrimmedString(request.auth?.uid);
    if (!requesterUid) {
      throw new HttpsError("unauthenticated", "Authentication required.");
    }
    const tokenId = asTrimmedString(request.data?.tokenId);
    if (!tokenId) {
      throw new HttpsError("invalid-argument", "tokenId is required.");
    }
    const suppliedOperationId = asTrimmedString(request.data?.operationId);
    if (!suppliedOperationId) {
      throw new HttpsError(
        "invalid-argument",
        "operationId is required for Task 06 token deletion."
      );
    }
    const operationId = validateBackendOperationId(
      suppliedOperationId
    );
    if (!operationId) {
      throw new HttpsError("invalid-argument", "operationId is invalid.");
    }
    const db = admin.firestore();
    const invocationId = randomUUID();
    const tokenRef = db.doc(`grigliata_tokens/${tokenId}`);
    const requesterRef = db.doc(`users/${requesterUid}`);
    const receiptId = backendOperationReceiptId(
      requesterUid,
      operationId
    );
    const operationRef = db.doc(`backend_operations/${receiptId}`);
    const configRef = db.doc(TASK06_CONFIG_PATH);
    const requestHash = backendOperationRequestHash(
      "delete-grigliata-custom-token",
      {tokenId}
    );
    const claim = await db.runTransaction(async (transaction) => {
      const [operation, requester, token, config] =
        await transaction.getAll(
        operationRef,
        requesterRef,
        tokenRef,
        configRef
      );
      if (
        !requester.exists ||
        requester.get("deletionState") === "pending"
      ) {
        throw new HttpsError(
          "permission-denied",
          "An active user profile is required."
        );
      }
      const task06Config = resolveTask06BackendConfig(config.data());
      if (
        !task06Config.enabledOperationKinds.includes(
          "delete-grigliata-custom-token"
        )
      ) {
        throw new HttpsError(
          "failed-precondition",
          "Task 06 custom-token deletion is not enabled."
        );
      }
      if (operation.exists) {
        if (
          operation.get("actorUid") !== requesterUid ||
          operation.get("kind") !== "delete-grigliata-custom-token" ||
          operation.get("requestHash") !== requestHash
        ) {
          throw new HttpsError(
            "already-exists",
            "operationId belongs to a different request."
          );
        }
        if (operation.get("status") === "completed") {
          return {
            replayed: true,
            completedResult: asRecord(operation.get("result")),
            ownerUid: asTrimmedString(operation.get("ownerUid")),
          };
        }
        const leaseOwner = asTrimmedString(operation.get("leaseOwner"));
        const leaseExpiresAt = operation.get("leaseExpiresAt");
        if (
          leaseOwner &&
          leaseExpiresAt instanceof Timestamp &&
          leaseExpiresAt.toMillis() > Date.now()
        ) {
          throw new HttpsError(
            "aborted",
            "This custom-token deletion is already running."
          );
        }
      }
      if (!token.exists) {
        throw new HttpsError("not-found", "Custom token not found.");
      }
      const tokenData = token.data() ?? {};
      const ownerUid = asTrimmedString(tokenData.ownerUid);
      if (
        !ownerUid ||
        asTrimmedString(tokenData.tokenType) !== "custom"
      ) {
        throw new HttpsError(
          "failed-precondition",
          "Only custom tokens can be deleted through this function."
        );
      }
      const isManager = isManagerRole(requester.get("role"));
      if (requesterUid !== ownerUid && !isManager) {
        throw new HttpsError(
          "permission-denied",
          "You can only delete your own custom tokens."
        );
      }
      const pendingReceiptId = asTrimmedString(
        token.get("task06Deletion.operationReceiptId")
      );
      if (pendingReceiptId && pendingReceiptId !== receiptId) {
        throw new HttpsError(
          "failed-precondition",
          "This custom token is already pending deletion."
        );
      }
      const owner = await transaction.get(db.doc(`users/${ownerUid}`));
      if (
        owner.exists &&
        owner.get("deletionState") === "pending"
      ) {
        throw new HttpsError(
          "failed-precondition",
          "The token owner is pending account deletion."
        );
      }
      transaction.set(tokenRef, {
        task06Deletion: {
          status: "pending",
          operationReceiptId: receiptId,
          requestedAt: FieldValue.serverTimestamp(),
        },
      }, {merge: true});
      if (operation.exists) {
        transaction.update(operationRef, {
          status: "running",
          phase: "discover",
          retryable: false,
          attempt: FieldValue.increment(1),
          leaseOwner: invocationId,
          leaseExpiresAt: Timestamp.fromMillis(
            Date.now() + BACKEND_OPERATION_LEASE_MS
          ),
          updatedAt: FieldValue.serverTimestamp(),
        });
      } else {
        transaction.create(operationRef, {
          schemaVersion: 1,
          operationId,
          actorUid: requesterUid,
          ownerUid,
          kind: "delete-grigliata-custom-token",
          requestHash,
          status: "running",
          phase: "discover",
          retryable: false,
          attempt: 1,
          deletedPlacementCount: 0,
          deletedInstanceCount: 0,
          leaseOwner: invocationId,
          leaseExpiresAt: Timestamp.fromMillis(
            Date.now() + BACKEND_OPERATION_LEASE_MS
          ),
          progress: {
            planned: 0,
            processed: 0,
            succeeded: 0,
            skipped: 0,
            failed: 0,
          },
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          expiresAt: backendOperationExpiry(),
        });
      }
      return {
        replayed: false,
        completedResult: {},
        ownerUid,
      };
    });
    if (claim.replayed) {
      return {
        ...claim.completedResult,
        operationId,
        replayed: true,
      };
    }
    const deadlineAt = Date.now() + WORK_DEADLINE_MS;
    const ensureWorkTime = async (): Promise<void> => {
      if (Date.now() < deadlineAt) return;
      await db.runTransaction(async (transaction) => {
        const operation = await transaction.get(operationRef);
        if (
          operation.exists &&
          operation.get("status") === "running" &&
          operation.get("leaseOwner") === invocationId
        ) {
          transaction.update(operationRef, {
            status: "paused",
            retryable: true,
            leaseOwner: FieldValue.delete(),
            leaseExpiresAt: FieldValue.delete(),
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
      });
      throw new HttpsError(
        "deadline-exceeded",
        "Custom-token deletion paused safely. Retry with the same operationId."
      );
    };
    const ownerRef = db.doc(`users/${claim.ownerUid}`);
    const settingsRef = db.doc(
      `users/${claim.ownerUid}/state/settings`
    );
    const rolloutRef = db.doc("app_config/user_data_v2");
    const removeHiddenTokenIds = async (
      tokenIds: string[]
    ): Promise<void> => {
      const removedIds = new Set(tokenIds);
      await db.runTransaction(async (transaction) => {
        const [rollout, owner, settings] = await transaction.getAll(
          rolloutRef,
          ownerRef,
          settingsRef
        );
        if (
          !owner.exists ||
          owner.get("deletionState") === "pending"
        ) return;
        if (isUserDataLegacyDrainFrozen(rollout.data(), claim.ownerUid)) {
          throw new HttpsError(
            "unavailable",
            "User settings are temporarily frozen. Retry later."
          );
        }
        const currentSettings = {
          ...asRecord(owner.get("settings")),
          ...asRecord(settings.get("settings")),
        };
        const hidden = normalizeHiddenTokenIdsByBackground(
          currentSettings[HIDDEN_TOKEN_FIELD]
        );
        let changed = false;
        Object.keys(hidden).forEach((backgroundId) => {
          const filtered = hidden[backgroundId].filter(
            (hiddenTokenId) => !removedIds.has(hiddenTokenId)
          );
          if (filtered.length !== hidden[backgroundId].length) {
            changed = true;
          }
          if (filtered.length) {
            hidden[backgroundId] = filtered;
          } else {
            delete hidden[backgroundId];
          }
        });
        if (!changed) return;
        transaction.set(settingsRef, {
          schemaVersion: 2,
          revision: Math.max(
            0,
            Math.trunc(asFiniteNumber(settings.get("revision")))
          ) + 1,
          settings: {
            ...asRecord(settings.get("settings")),
            [HIDDEN_TOKEN_FIELD]: hidden,
          },
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: requesterUid,
        }, {merge: true});
        if (writesLegacyUserProjection(resolveUserDataRolloutStage(
          rollout.data(),
          claim.ownerUid
        ))) {
          transaction.set(ownerRef, {
            settings: {
              ...asRecord(owner.get("settings")),
              [HIDDEN_TOKEN_FIELD]: hidden,
            },
          }, {merge: true});
        }
      });
    };
    const drainPlacementPages = async (
      tokenIds: string[]
    ): Promise<void> => {
      for (const ids of chunkValues(tokenIds, IN_QUERY_SIZE)) {
        while (true) {
          await ensureWorkTime();
          const placements = await db
            .collection("grigliata_token_placements")
            .where("tokenId", "in", ids)
            .limit(PLACEMENT_PAGE_SIZE)
            .get();
          if (placements.empty) break;
          const batch = db.batch();
          placements.docs.forEach((snapshot) => {
            batch.delete(snapshot.ref);
          });
          batch.update(operationRef, {
            "progress.planned": FieldValue.increment(
              placements.size
            ),
            "progress.processed": FieldValue.increment(
              placements.size
            ),
            "progress.succeeded": FieldValue.increment(
              placements.size
            ),
            deletedPlacementCount: FieldValue.increment(
              placements.size
            ),
            phase: "placements",
            updatedAt: FieldValue.serverTimestamp(),
          });
          await batch.commit();
        }
      }
    };

    const tokenSnapshot = await tokenRef.get();
    if (!tokenSnapshot.exists) {
      throw new HttpsError(
        "aborted",
        "Custom token changed during deletion."
      );
    }
    const isTemplate = asTrimmedString(
      tokenSnapshot.get("customTokenRole")
    ) !== "instance";
    await removeHiddenTokenIds([tokenId]);
    await drainPlacementPages([tokenId]);

    if (isTemplate) {
      while (true) {
        await ensureWorkTime();
        const instances = await db.collection("grigliata_tokens")
          .where("customTemplateId", "==", tokenId)
          .limit(INSTANCE_PAGE_SIZE)
          .get();
        const instanceDocs = instances.docs.filter(
          (snapshot) => snapshot.id !== tokenId
        );
        if (!instanceDocs.length) break;
        const fenceOutcome = await db.runTransaction(
          async (transaction) => {
            const [operation, ...latestInstances] =
              await transaction.getAll(
                operationRef,
                ...instanceDocs.map((snapshot) => snapshot.ref)
              );
            if (
              !operation.exists ||
              operation.get("status") !== "running" ||
              operation.get("leaseOwner") !== invocationId
            ) {
              throw new HttpsError(
                "aborted",
                "Custom-token deletion lost its invocation lease."
              );
            }
            const conflict = latestInstances.some((snapshot) => {
              const pendingReceiptId = asTrimmedString(
                snapshot.get(
                  "task06Deletion.operationReceiptId"
                )
              );
              return snapshot.exists &&
                !!pendingReceiptId &&
                pendingReceiptId !== receiptId;
            });
            if (conflict) {
              transaction.update(operationRef, {
                status: "paused",
                retryable: true,
                errorClass: "dependency",
                leaseOwner: FieldValue.delete(),
                leaseExpiresAt: FieldValue.delete(),
                updatedAt: FieldValue.serverTimestamp(),
              });
              return {
                conflict: true,
                documents: [] as admin.firestore.DocumentSnapshot[],
              };
            }
            const documents = latestInstances.filter(
              (snapshot) => snapshot.exists
            );
            documents.forEach((snapshot) => {
              transaction.set(snapshot.ref, {
                task06Deletion: {
                  status: "pending",
                  operationReceiptId: receiptId,
                  requestedAt: FieldValue.serverTimestamp(),
                },
              }, {merge: true});
            });
            transaction.update(operationRef, {
              phase: "fence-instances",
              updatedAt: FieldValue.serverTimestamp(),
            });
            return {conflict: false, documents};
          }
        );
        if (fenceOutcome.conflict) {
          throw new HttpsError(
            "unavailable",
            "A custom-token instance is being deleted separately. Retry."
          );
        }
        const fencedInstanceDocs = fenceOutcome.documents;
        if (!fencedInstanceDocs.length) continue;
        const instanceIds = fencedInstanceDocs.map(
          (snapshot) => snapshot.id
        );
        await removeHiddenTokenIds(instanceIds);
        await drainPlacementPages(instanceIds);
        await ensureWorkTime();
        const deleteBatch = db.batch();
        fencedInstanceDocs.forEach((snapshot) => {
          deleteBatch.delete(snapshot.ref);
        });
        deleteBatch.update(operationRef, {
          "progress.planned": FieldValue.increment(
            fencedInstanceDocs.length
          ),
          "progress.processed": FieldValue.increment(
            fencedInstanceDocs.length
          ),
          "progress.succeeded": FieldValue.increment(
            fencedInstanceDocs.length
          ),
          deletedInstanceCount: FieldValue.increment(
            fencedInstanceDocs.length
          ),
          phase: "instances",
          updatedAt: FieldValue.serverTimestamp(),
        });
        await deleteBatch.commit();
      }
    }
    const remainingInstances = isTemplate
      ? await db.collection("grigliata_tokens")
        .where("customTemplateId", "==", tokenId)
        .limit(2)
        .get()
      : null;
    if (
      remainingInstances &&
      remainingInstances.docs.some(
        (snapshot) => snapshot.id !== tokenId
      )
    ) {
      throw new HttpsError(
        "unavailable",
        "Custom-token instances changed during deletion. Retry."
      );
    }
    const remainingPlacements = await db
      .collection("grigliata_token_placements")
      .where("tokenId", "==", tokenId)
      .limit(1)
      .get();
    if (!remainingPlacements.empty) {
      throw new HttpsError(
        "unavailable",
        "Custom-token placements changed during deletion. Retry."
      );
    }
    const result = await db.runTransaction(async (transaction) => {
      const [operation, latestToken] = await transaction.getAll(
        operationRef,
        tokenRef
      );
      if (!operation.exists) {
        throw new HttpsError("aborted", "Deletion receipt is missing.");
      }
      if (
        operation.get("status") !== "running" ||
        operation.get("leaseOwner") !== invocationId
      ) {
        throw new HttpsError(
          "aborted",
          "Custom-token deletion lost its invocation lease."
        );
      }
      if (latestToken.exists) {
        if (
          latestToken.get(
            "task06Deletion.operationReceiptId"
          ) !== receiptId
        ) {
          throw new HttpsError(
            "aborted",
            "Custom-token deletion lost its root fence."
          );
        }
        transaction.delete(tokenRef);
      }
      const completedResult = {
        success: true,
        tokenId,
        deletedPlacementCount: Math.max(
          0,
          Math.trunc(asFiniteNumber(
            operation.get("deletedPlacementCount")
          ))
        ),
        deletedInstanceCount: Math.max(
          0,
          Math.trunc(asFiniteNumber(
            operation.get("deletedInstanceCount")
          ))
        ),
      };
      transaction.update(operationRef, {
        status: "completed",
        phase: "completed",
        retryable: false,
        result: completedResult,
        completedAt: FieldValue.serverTimestamp(),
        leaseOwner: FieldValue.delete(),
        leaseExpiresAt: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return completedResult;
    });
    return {
      ...result,
      operationId,
      replayed: false,
      replayable: Boolean(suppliedOperationId),
    };
};

export const deleteGrigliataCustomToken = onCall<
  DeleteGrigliataCustomTokenPayload
>(
  {region: REGION, timeoutSeconds: FUNCTION_TIMEOUT_SECONDS},
  async (request) => (
    asTrimmedString(request.data?.operationId)
      ? task06DeleteGrigliataCustomTokenHandler(request)
      : deleteGrigliataCustomTokenLegacyHandler(request)
  )
);
