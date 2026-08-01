import {randomUUID} from "crypto";
import * as admin from "firebase-admin";
import {FieldValue, Timestamp} from "firebase-admin/firestore";
import {getStorage} from "firebase-admin/storage";
import {CallableRequest, HttpsError, onCall} from "firebase-functions/v2/https";
import {Readable} from "stream";
import {
  BACKEND_OPERATION_LEASE_MS,
  backendOperationExpiry,
} from "./backendOperationCore";
import {
  buildTask07FoeTokenMediaRegenerationPlan,
  task07CanonicalFoeMediaAssetId,
  task07FoeTokenMediaRegenerationPlansMatch,
  Task07FoeTokenMediaRegenerationPlan,
  Task07MediaClonePlanError,
} from "./mediaAssetCloneCore";
import {
  uploadTask07GeneratedSet,
} from "./mediaAssetProcessor";
import {
  processTask07MediaSource,
  Task07ProcessorError,
} from "./mediaAssetProcessorCore";
import {createTask07DefaultMediaTransformer} from "./mediaProcessorRuntime";
import {
  buildTask07PrivateStorageMetadata,
  MEDIA_CONTRACTS,
  MEDIA_CONTRACT_VERSION,
  MEDIA_SCHEMA_VERSION,
  parseCanonicalMediaPath,
  validateTask07PrivateStorageMetadata,
} from "./mediaContracts";
import {
  buildTask07NewTargetAttachment,
  StoredTask07MediaObject,
  task07ReadyGeneratedMediaFromManifest,
} from "./mediaTargetAdapters";
import {task07MediaWritesV1ForActor} from "./task07MediaControl";
import {
  buildSpawnedFoePlacementDocument,
  buildSpawnedFoeTokenDocument,
  isActiveGrigliataDm,
  normalizeSpawnGrigliataFoeTokenInput,
  spawnGrigliataFoeTokenIdentity,
  spawnGrigliataFoeTokenRequestHash,
  SpawnGrigliataFoeTokenInput,
  task07FoeTokenSpawnMode,
  task07SpawnReceiptMatches,
  TASK07_FOE_TOKEN_SPAWN_KIND,
} from "./grigliataFoeTokenSpawnCore";
import {
  asRecord,
  asTrimmedString,
  hashValue,
} from "./userDataV2";

type SpawnPayload = {
  foeId?: string;
  backgroundId?: string;
  col?: number;
  row?: number;
  operationId?: string;
};

type SpawnClaim =
  {mode: "completed"; result: Record<string, unknown>} |
  {mode: "legacy"; result: Record<string, unknown>} |
  {
    mode: "execute";
    attempt: number;
    plan: Task07FoeTokenMediaRegenerationPlan;
    source: Record<string, unknown>;
    manifestReady: boolean;
  } |
  {
    mode: "terminal";
    attempt: number;
    plan: Task07FoeTokenMediaRegenerationPlan;
    reason: string;
  };

const REGION = "europe-west1";
const TASK07_CONFIG_PATH = "utils/task07_media";
const OPERATION_COLLECTION = "backend_operations";
const SPAWN_OPTIONS = {
  region: REGION,
  cpu: 1,
  concurrency: 1,
  maxInstances: 2,
  memory: "1GiB" as const,
  timeoutSeconds: 180,
};

const leaseExpiry = (): Timestamp => Timestamp.fromMillis(
  Date.now() + BACKEND_OPERATION_LEASE_MS
);

const retentionExpiry = (): Timestamp => Timestamp.fromMillis(
  Date.now() +
  MEDIA_CONTRACTS.token.retention.uncommittedHours * 60 * 60 * 1000
);

const activeLease = (
  snapshot: admin.firestore.DocumentSnapshot
): boolean => {
  const lease = snapshot.get("leaseExpiresAt");
  return lease instanceof Timestamp && lease.toMillis() > Date.now();
};

const manifestMatchesPlan = (
  data: admin.firestore.DocumentData | undefined,
  plan: Task07FoeTokenMediaRegenerationPlan
): boolean => Boolean(
  data &&
  data.schemaVersion === MEDIA_SCHEMA_VERSION &&
  data.policyVersion === MEDIA_CONTRACT_VERSION &&
  data.assetId === plan.destinationPlan.assetId &&
  data.purpose === "token" &&
  data.audience === "signed-in" &&
  data.ownerUid === plan.destinationPlan.ownerUid &&
  data.actorUid === plan.destinationPlan.actorUid &&
  data.targetKind === "grigliata-token" &&
  data.targetId === plan.destinationTokenId &&
  data.previousAssetId === null &&
  data.requestHash === plan.destinationPlan.requestHash &&
  hashValue(data.plan) === hashValue(plan.destinationPlan) &&
  task07FoeTokenMediaRegenerationPlansMatch(
    data.regenerationPlan,
    plan
  )
);

const buildProcessingManifest = (input: {
  plan: Task07FoeTokenMediaRegenerationPlan;
  attempt: number;
  now: Timestamp;
}): admin.firestore.DocumentData => ({
  schemaVersion: MEDIA_SCHEMA_VERSION,
  policyVersion: MEDIA_CONTRACT_VERSION,
  assetId: input.plan.destinationPlan.assetId,
  generation: input.plan.sourceGeneration,
  state: "processing",
  purpose: "token",
  audience: input.plan.destinationPlan.audienceScope,
  ownerUid: input.plan.destinationPlan.ownerUid,
  actorUid: input.plan.destinationPlan.actorUid,
  targetKind: input.plan.destinationPlan.targetKind,
  targetId: input.plan.destinationPlan.entityId,
  previousAssetId: null,
  requestHash: input.plan.destinationPlan.requestHash,
  plan: input.plan.destinationPlan,
  source: {
    mode: "foe-canonical-regeneration",
    path: input.plan.sourceOriginal.path,
    generation: input.plan.sourceOriginal.generation,
    mime: input.plan.sourceOriginal.contentType,
    bytes: input.plan.sourceOriginal.bytes,
    checksum: input.plan.sourceOriginal.checksum,
    clonedFromAssetId: input.plan.sourceAssetId,
  },
  generated: null,
  variants: {},
  attachment: null,
  regenerationPlan: input.plan,
  processing: {
    mode: "foe-canonical-regeneration",
    sourceAssetId: input.plan.sourceAssetId,
    leaseUntil: leaseExpiry(),
  },
  retention: {cleanupAfter: retentionExpiry()},
  error: {code: null, retryable: false, attempts: input.attempt},
  createdAt: input.now,
  updatedAt: input.now,
});

const readStreamWithExactCap = async (input: {
  file: {createReadStream(options: {validation: "crc32c"}): Readable};
  expectedBytes: number;
}): Promise<Buffer> => new Promise((resolve, reject) => {
  const chunks: Buffer[] = [];
  let bytes = 0;
  const stream = input.file.createReadStream({validation: "crc32c"});
  stream.on("data", (chunk: Buffer) => {
    bytes += chunk.byteLength;
    if (bytes > input.expectedBytes ||
      bytes > MEDIA_CONTRACTS.foe.source.maxBytes) {
      stream.destroy(new Task07ProcessorError(
        "source-byte-budget-exceeded"
      ));
      return;
    }
    chunks.push(chunk);
  });
  stream.on("error", reject);
  stream.on("end", () => {
    if (bytes !== input.expectedBytes) {
      reject(new Task07ProcessorError("source-byte-size-mismatch"));
      return;
    }
    resolve(Buffer.concat(chunks, bytes));
  });
});

const descriptorMatchesMetadata = (input: {
  descriptor: StoredTask07MediaObject;
  metadata: Record<string, unknown>;
  expected: ReturnType<typeof buildTask07PrivateStorageMetadata>;
}): boolean => {
  const metadata = input.metadata;
  const validation = validateTask07PrivateStorageMetadata({
    cacheControl: metadata.cacheControl,
    contentDisposition: metadata.contentDisposition,
    metadata: metadata.metadata,
    expected: input.expected,
  });
  return validation.ok &&
    Number(metadata.size) === input.descriptor.bytes &&
    metadata.contentType === input.descriptor.contentType &&
    String(metadata.generation || "") === input.descriptor.generation &&
    asTrimmedString(asRecord(metadata.metadata).task07Checksum) ===
      input.descriptor.checksum;
};

const readCanonicalFoeOriginal = async (
  plan: Task07FoeTokenMediaRegenerationPlan
): Promise<Buffer> => {
  const parsed = parseCanonicalMediaPath(plan.sourceOriginal.path);
  if (!parsed ||
    parsed.assetId !== plan.sourceAssetId ||
    parsed.role !== "original" ||
    parsed.audienceScope !== "dm-only" ||
    parsed.sourceGeneration !== plan.sourceGeneration) {
    throw new Task07ProcessorError("source-path-invalid");
  }
  const file = getStorage().bucket().file(plan.sourceOriginal.path, {
    generation: plan.sourceOriginal.generation,
  });
  let metadata: Record<string, unknown>;
  try {
    const [rawMetadata] = await file.getMetadata();
    metadata = rawMetadata as unknown as Record<string, unknown>;
  } catch (error) {
    const code = Number(asRecord(error).code);
    throw new Task07ProcessorError(
      code === 404 ? "source-object-missing" : "source-metadata-unavailable",
      code !== 404
    );
  }
  if (!descriptorMatchesMetadata({
    descriptor: plan.sourceOriginal,
    metadata,
    expected: buildTask07PrivateStorageMetadata({
      assetId: plan.sourceAssetId,
      entityId: plan.sourceFoeId,
      kind: "foe",
      ownerUid: parsed.ownerUid,
      role: "original",
    }),
  })) {
    throw new Task07ProcessorError("source-object-invalid");
  }
  return readStreamWithExactCap({
    file,
    expectedBytes: plan.sourceOriginal.bytes,
  });
};

const allGeneratedDescriptors = (
  manifest: admin.firestore.DocumentData,
  plan: Task07FoeTokenMediaRegenerationPlan
): StoredTask07MediaObject[] => {
  const generated = task07ReadyGeneratedMediaFromManifest(
    manifest,
    plan.destinationPlan
  );
  return [
    generated.original,
    ...Object.values(generated.variants),
  ].filter((entry): entry is StoredTask07MediaObject => Boolean(entry));
};

const verifyGeneratedFamily = async (
  manifest: admin.firestore.DocumentData,
  plan: Task07FoeTokenMediaRegenerationPlan
): Promise<void> => {
  const descriptors = allGeneratedDescriptors(manifest, plan);
  for (const descriptor of descriptors) {
    const parsed = parseCanonicalMediaPath(descriptor.path);
    const storageRole = descriptor.role;
    if (!parsed ||
      parsed.assetId !== plan.destinationPlan.assetId ||
      parsed.audienceScope !== "signed-in" ||
      parsed.sourceGeneration !== plan.sourceGeneration ||
      !storageRole) {
      throw new Task07ProcessorError("destination-path-invalid");
    }
    const [metadata] = await getStorage().bucket().file(descriptor.path, {
      generation: descriptor.generation,
    }).getMetadata();
    if (!descriptorMatchesMetadata({
      descriptor,
      metadata: metadata as unknown as Record<string, unknown>,
      expected: buildTask07PrivateStorageMetadata({
        assetId: plan.destinationPlan.assetId,
        entityId: plan.destinationTokenId,
        kind: "token",
        ownerUid: plan.destinationPlan.ownerUid,
        role: storageRole,
      }),
    })) {
      throw new Task07ProcessorError("destination-object-invalid");
    }
  }
};

const buildCurrentPlan = async (input: {
  transaction: admin.firestore.Transaction;
  db: admin.firestore.Firestore;
  actorUid: string;
  receiptId: string;
  tokenId: string;
  foeId: string;
  source: admin.firestore.DocumentSnapshot;
}): Promise<Task07FoeTokenMediaRegenerationPlan | null> => {
  if (!input.source.exists) return null;
  let sourceAssetId: string | null;
  try {
    sourceAssetId = task07CanonicalFoeMediaAssetId(
      input.source.data() || {}
    );
  } catch (error) {
    if (error instanceof Task07MediaClonePlanError) return null;
    throw error;
  }
  if (!sourceAssetId) return null;
  const sourceManifest = await input.transaction.get(
    input.db.doc(`media_assets/${sourceAssetId}`)
  );
  try {
    return buildTask07FoeTokenMediaRegenerationPlan({
      actorUid: input.actorUid,
      backendReceiptId: input.receiptId,
      destinationTokenId: input.tokenId,
      sourceFoeId: input.foeId,
      source: input.source.data() || {},
      sourceManifest: sourceManifest.data() || null,
    });
  } catch (error) {
    if (error instanceof Task07MediaClonePlanError) return null;
    throw error;
  }
};

const retryableError = (error: unknown): boolean => {
  if (error instanceof Task07ProcessorError) return error.retryable;
  if (error instanceof HttpsError) {
    return ["aborted", "deadline-exceeded", "internal", "unavailable"]
      .includes(error.code);
  }
  const status = Number(asRecord(error).code);
  return status === 408 || status === 409 || status === 429 || status >= 500;
};

const callableError = (error: unknown): HttpsError => {
  if (error instanceof HttpsError) return error;
  if (error instanceof Task07ProcessorError) {
    return new HttpsError(
      error.retryable ? "unavailable" : "failed-precondition",
      `Foe token media regeneration failed: ${error.code}.`
    );
  }
  return new HttpsError(
    retryableError(error) ? "unavailable" : "internal",
    "Unable to create the canonical foe token."
  );
};

const failOwnedOperation = async (input: {
  db: admin.firestore.Firestore;
  operationRef: admin.firestore.DocumentReference;
  invocationId: string;
  requestHash: string;
  plan: Task07FoeTokenMediaRegenerationPlan;
  code: string;
  retryable: boolean;
  attempt: number;
}): Promise<void> => {
  await input.db.runTransaction(async (transaction) => {
    const manifestRef = input.db.doc(
      `media_assets/${input.plan.destinationPlan.assetId}`
    );
    const cleanupRef = input.db.doc(
      `media_asset_cleanup/${input.plan.destinationPlan.assetId}`
    );
    const tokenRef = input.db.doc(input.plan.destinationReferencePath);
    const [operation, manifest, cleanup, token] =
      await transaction.getAll(
        input.operationRef,
        manifestRef,
        cleanupRef,
        tokenRef
      );
    if (!operation.exists ||
      operation.get("requestHash") !== input.requestHash ||
      operation.get("leaseOwner") !== input.invocationId) return;
    if (token.exists || manifest.get("state") === "attached") {
      return;
    }
    const now = Timestamp.now();
    transaction.update(input.operationRef, {
      status: "failed",
      phase: input.retryable ? "regenerate" : "cleanup",
      retryable: input.retryable,
      errorClass: input.code,
      leaseOwner: FieldValue.delete(),
      leaseExpiresAt: FieldValue.delete(),
      updatedAt: now,
    });
    if (manifest.exists && manifestMatchesPlan(
      manifest.data(),
      input.plan
    )) {
      transaction.update(manifestRef, {
        state: input.retryable ? "failed" : "rejected",
        processing: FieldValue.delete(),
        error: {
          code: input.code,
          retryable: input.retryable,
          attempts: input.attempt,
        },
        ...(input.retryable ? {} : {
          retention: {cleanupAfter: now},
        }),
        updatedAt: now,
      });
      if (!input.retryable && !cleanup.exists) {
        transaction.create(cleanupRef, {
          schemaVersion: MEDIA_SCHEMA_VERSION,
          assetId: input.plan.destinationPlan.assetId,
          state: "pending",
          reason: input.code,
          attempts: 0,
          cleanupAfter: now,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
  });
};

const spawnHandler = async (
  request: CallableRequest<SpawnPayload>
): Promise<Record<string, unknown>> => {
  const actorUid = asTrimmedString(request.auth?.uid);
  if (!actorUid) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }
  let input: SpawnGrigliataFoeTokenInput;
  try {
    input = normalizeSpawnGrigliataFoeTokenInput(request.data);
  } catch (error) {
    throw new HttpsError(
      "invalid-argument",
      error instanceof Error ? error.message : "Invalid foe token request."
    );
  }
  const identity = spawnGrigliataFoeTokenIdentity(
    actorUid,
    input.operationId,
    input.backgroundId
  );
  const requestHash = spawnGrigliataFoeTokenRequestHash(input);
  const db = admin.firestore();
  const invocationId = randomUUID();
  const operationRef = db.doc(
    `${OPERATION_COLLECTION}/${identity.receiptId}`
  );
  const actorRef = db.doc(`users/${actorUid}`);
  const sourceRef = db.doc(`foes/${input.foeId}`);
  const backgroundRef = db.doc(
    `grigliata_backgrounds/${input.backgroundId}`
  );
  const tokenRef = db.doc(`grigliata_tokens/${identity.tokenId}`);
  const placementRef = db.doc(
    `grigliata_token_placements/${identity.placementId}`
  );
  const controlRef = db.doc(TASK07_CONFIG_PATH);
  let ownedPlan: Task07FoeTokenMediaRegenerationPlan | null = null;
  let attempt = 1;
  try {
    const claim = await db.runTransaction(async (
      transaction
    ): Promise<SpawnClaim> => {
      const [
        operation,
        actor,
        source,
        background,
        token,
        placement,
        control,
      ] = await transaction.getAll(
        operationRef,
        actorRef,
        sourceRef,
        backgroundRef,
        tokenRef,
        placementRef,
        controlRef
      );
      if (operation.exists && !task07SpawnReceiptMatches({
        receipt: operation.data(),
        actorUid,
        requestHash,
        tokenId: identity.tokenId,
        placementId: identity.placementId,
      })) {
        throw new HttpsError(
          "already-exists",
          "operationId belongs to a different foe-token request."
        );
      }
      if (operation.exists && operation.get("status") === "completed") {
        return {
          mode: "completed",
          result: asRecord(operation.get("result")),
        };
      }
      if (operation.exists && activeLease(operation)) {
        throw new HttpsError(
          "aborted",
          "This foe-token spawn is already running."
        );
      }
      const currentPlan = await buildCurrentPlan({
        transaction,
        db,
        actorUid,
        receiptId: identity.receiptId,
        tokenId: identity.tokenId,
        foeId: input.foeId,
        source,
      });
      const storedPlan = operation.exists ?
        operation.get("regenerationPlan") as
          Task07FoeTokenMediaRegenerationPlan :
        null;
      const sourceHash = source.exists ? hashValue(source.data()) : "";
      const task07Enabled = task07MediaWritesV1ForActor({
        control: control.data(),
        purpose: "token",
        role: "dm",
        uid: actorUid,
      });
      const spawnMode = task07FoeTokenSpawnMode(task07Enabled);
      if (spawnMode === "legacy" && !operation.exists) {
        if (!isActiveGrigliataDm(actor.data())) {
          throw new HttpsError(
            "permission-denied",
            "Only the active DM can spawn foe tokens."
          );
        }
        if (!source.exists || !background.exists) {
          throw new HttpsError(
            "not-found",
            !source.exists ? "Foe not found." : "Background not found."
          );
        }
        if (token.exists || placement.exists) {
          throw new HttpsError(
            "already-exists",
            "The deterministic foe-token target already exists."
          );
        }
        const timestamp = Timestamp.now();
        const tokenPayload = buildSpawnedFoeTokenDocument({
          actorUid,
          foeId: input.foeId,
          source: source.data() || {},
          timestamp,
        });
        const placementPayload = buildSpawnedFoePlacementDocument({
          actorUid,
          backgroundId: input.backgroundId,
          tokenId: identity.tokenId,
          col: input.col,
          row: input.row,
          label: asTrimmedString(tokenPayload.label),
          imageUrl: asTrimmedString(tokenPayload.imageUrl),
          timestamp,
        });
        const completed = {
          success: true,
          tokenId: identity.tokenId,
          placementId: identity.placementId,
        };
        transaction.create(tokenRef, tokenPayload);
        transaction.create(placementRef, placementPayload);
        transaction.create(operationRef, {
          schemaVersion: 1,
          operationId: input.operationId,
          actorUid,
          kind: TASK07_FOE_TOKEN_SPAWN_KIND,
          mode: "legacy",
          requestHash,
          sourceFoeId: input.foeId,
          sourceHash,
          backgroundId: input.backgroundId,
          tokenId: identity.tokenId,
          placementId: identity.placementId,
          status: "completed",
          phase: "completed",
          retryable: false,
          attempt: 1,
          result: completed,
          completedAt: timestamp,
          createdAt: timestamp,
          updatedAt: timestamp,
          expiresAt: backendOperationExpiry(),
        });
        return {mode: "legacy", result: completed};
      }
      const terminalReason = !isActiveGrigliataDm(actor.data()) ?
        "actor-not-active-dm" :
        !source.exists ? "source-removed" :
          !background.exists ? "background-removed" :
            !task07Enabled ? "task07-token-writes-disabled" :
              !currentPlan ? "canonical-source-unavailable" :
                operation.exists &&
                operation.get("sourceHash") !== sourceHash ?
                  "source-drift" :
                  operation.exists &&
                  !task07FoeTokenMediaRegenerationPlansMatch(
                    storedPlan,
                    currentPlan
                  ) ? "canonical-source-drift" :
                    token.exists || placement.exists ?
                      "deterministic-target-conflict" : "";
      // An existing operation owns its stored destination. If the source has
      // drifted, cleanup must still target that original destination rather
      // than the newly-derived plan.
      const effectivePlan = operation.exists ? storedPlan : currentPlan;
      if (terminalReason) {
        if (!operation.exists || !effectivePlan) {
          throw new HttpsError(
            terminalReason === "actor-not-active-dm" ?
              "permission-denied" :
              terminalReason.includes("removed") ? "not-found" :
                "failed-precondition",
            "Canonical foe-token spawn preconditions are not satisfied."
          );
        }
        attempt = Math.max(1, Number(operation.get("attempt") || 1));
        transaction.update(operationRef, {
          status: "running",
          phase: "cleanup",
          retryable: false,
          errorClass: terminalReason,
          leaseOwner: invocationId,
          leaseExpiresAt: leaseExpiry(),
          updatedAt: Timestamp.now(),
        });
        return {
          mode: "terminal",
          plan: effectivePlan,
          attempt,
          reason: terminalReason,
        };
      }
      const plan = currentPlan as Task07FoeTokenMediaRegenerationPlan;
      const manifestRef = db.doc(
        `media_assets/${plan.destinationPlan.assetId}`
      );
      const cleanupRef = db.doc(
        `media_asset_cleanup/${plan.destinationPlan.assetId}`
      );
      const [manifest, cleanup] = await transaction.getAll(
        manifestRef,
        cleanupRef
      );
      if (cleanup.exists ||
        (manifest.exists && (
          !manifestMatchesPlan(manifest.data(), plan) ||
          !["processing", "failed", "ready"].includes(
            asTrimmedString(manifest.get("state"))
          )
        ))) {
        if (!operation.exists) {
          throw new HttpsError(
            "already-exists",
            "Canonical token media identity is already bound."
          );
        }
        attempt = Math.max(1, Number(operation.get("attempt") || 1));
        transaction.update(operationRef, {
          status: "running",
          phase: "cleanup",
          retryable: false,
          errorClass: "canonical-destination-conflict",
          leaseOwner: invocationId,
          leaseExpiresAt: leaseExpiry(),
          updatedAt: Timestamp.now(),
        });
        return {
          mode: "terminal",
          plan,
          attempt,
          reason: "canonical-destination-conflict",
        };
      }
      attempt = operation.exists ?
        Math.max(1, Number(operation.get("attempt") || 0) + 1) :
        1;
      const now = Timestamp.now();
      if (operation.exists) {
        transaction.update(operationRef, {
          status: "running",
          phase: manifest.get("state") === "ready" ?
            "commit" :
            "regenerate",
          retryable: false,
          attempt,
          sourceHash,
          regenerationPlan: plan,
          leaseOwner: invocationId,
          leaseExpiresAt: leaseExpiry(),
          errorClass: FieldValue.delete(),
          updatedAt: now,
        });
      } else {
        transaction.create(operationRef, {
          schemaVersion: 1,
          operationId: input.operationId,
          actorUid,
          kind: TASK07_FOE_TOKEN_SPAWN_KIND,
          requestHash,
          sourceFoeId: input.foeId,
          sourceHash,
          backgroundId: input.backgroundId,
          tokenId: identity.tokenId,
          placementId: identity.placementId,
          regenerationPlan: plan,
          status: "running",
          phase: "regenerate",
          retryable: false,
          attempt,
          leaseOwner: invocationId,
          leaseExpiresAt: leaseExpiry(),
          createdAt: now,
          updatedAt: now,
          expiresAt: backendOperationExpiry(),
        });
      }
      if (!manifest.exists) {
        transaction.create(manifestRef, buildProcessingManifest({
          plan,
          attempt,
          now,
        }));
      } else if (manifest.get("state") !== "ready") {
        transaction.update(manifestRef, {
          state: "processing",
          generation: plan.sourceGeneration,
          processing: {
            mode: "foe-canonical-regeneration",
            sourceAssetId: plan.sourceAssetId,
            leaseUntil: leaseExpiry(),
          },
          retention: {cleanupAfter: retentionExpiry()},
          error: {code: null, retryable: false, attempts: attempt},
          updatedAt: now,
        });
      }
      return {
        mode: "execute",
        plan,
        attempt,
        source: source.data() || {},
        manifestReady: manifest.get("state") === "ready",
      };
    });
    if (claim.mode === "completed") {
      return {...claim.result, operationId: input.operationId, replayed: true};
    }
    if (claim.mode === "legacy") {
      return {...claim.result, operationId: input.operationId, replayed: false};
    }
    ownedPlan = claim.plan;
    attempt = claim.attempt;
    if (claim.mode === "terminal") {
      await failOwnedOperation({
        db,
        operationRef,
        invocationId,
        requestHash,
        plan: claim.plan,
        code: claim.reason,
        retryable: false,
        attempt,
      });
      throw new HttpsError(
        "failed-precondition",
        "This canonical foe-token spawn cannot be resumed."
      );
    }

    let manifestReady = claim.manifestReady;
    if (!manifestReady) {
      const sourceBuffer = await readCanonicalFoeOriginal(claim.plan);
      const processed = await processTask07MediaSource({
        plan: claim.plan.destinationPlan,
        sourceGeneration: claim.plan.sourceGeneration,
        source: sourceBuffer,
        transformer: createTask07DefaultMediaTransformer(),
      });
      const promoted = await uploadTask07GeneratedSet({
        assetId: claim.plan.destinationPlan.assetId,
        eventId: invocationId.replace(/[^A-Za-z0-9_-]/g, "_"),
        objects: processed.objects,
        plan: claim.plan.destinationPlan,
      });
      await db.runTransaction(async (transaction) => {
        const [operation, source] = await transaction.getAll(
          operationRef,
          sourceRef
        );
        const currentPlan = await buildCurrentPlan({
          transaction,
          db,
          actorUid,
          receiptId: identity.receiptId,
          tokenId: identity.tokenId,
          foeId: input.foeId,
          source,
        });
        const manifestRef = db.doc(
          `media_assets/${claim.plan.destinationPlan.assetId}`
        );
        const manifest = await transaction.get(manifestRef);
        if (!operation.exists ||
          operation.get("status") !== "running" ||
          operation.get("leaseOwner") !== invocationId ||
          operation.get("requestHash") !== requestHash ||
          operation.get("sourceHash") !== hashValue(source.data()) ||
          !task07FoeTokenMediaRegenerationPlansMatch(
            operation.get("regenerationPlan"),
            claim.plan
          ) ||
          !task07FoeTokenMediaRegenerationPlansMatch(
            currentPlan,
            claim.plan
          ) ||
          !manifest.exists ||
          !manifestMatchesPlan(manifest.data(), claim.plan)) {
          throw new HttpsError(
            "aborted",
            "Foe-token regeneration lost its source fence."
          );
        }
        const generated = {
          generation: claim.plan.sourceGeneration,
          original: promoted.original,
          variants: promoted.variants,
        };
        if (manifest.get("state") === "ready") {
          if (hashValue(manifest.get("generated")) !== hashValue(generated)) {
            throw new HttpsError(
              "failed-precondition",
              "Canonical token outputs conflict with their checkpoint."
            );
          }
        } else if (["processing", "failed"].includes(
          asTrimmedString(manifest.get("state"))
        )) {
          transaction.update(manifestRef, {
            state: "ready",
            source: {
              mode: "foe-canonical-regeneration",
              path: claim.plan.sourceOriginal.path,
              generation: claim.plan.sourceOriginal.generation,
              ...processed.source,
              clonedFromAssetId: claim.plan.sourceAssetId,
            },
            generated,
            processing: FieldValue.delete(),
            error: {code: null, retryable: false, attempts: attempt},
            retention: {cleanupAfter: retentionExpiry()},
            updatedAt: Timestamp.now(),
          });
        } else {
          throw new HttpsError(
            "failed-precondition",
            "Canonical token manifest cannot become ready."
          );
        }
        transaction.update(operationRef, {
          phase: "commit",
          leaseExpiresAt: leaseExpiry(),
          updatedAt: Timestamp.now(),
        });
      });
      manifestReady = true;
    }

    const readyManifest = await db.doc(
      `media_assets/${claim.plan.destinationPlan.assetId}`
    ).get();
    if (!manifestReady ||
      !readyManifest.exists ||
      readyManifest.get("state") !== "ready" ||
      !manifestMatchesPlan(readyManifest.data(), claim.plan)) {
      throw new HttpsError(
        "aborted",
        "Canonical token outputs are not ready to attach."
      );
    }
    await verifyGeneratedFamily(readyManifest.data() || {}, claim.plan);

    const result = await db.runTransaction(async (transaction) => {
      const [
        operation,
        actor,
        source,
        background,
        token,
        placement,
        control,
      ] = await transaction.getAll(
        operationRef,
        actorRef,
        sourceRef,
        backgroundRef,
        tokenRef,
        placementRef,
        controlRef
      );
      const currentPlan = await buildCurrentPlan({
        transaction,
        db,
        actorUid,
        receiptId: identity.receiptId,
        tokenId: identity.tokenId,
        foeId: input.foeId,
        source,
      });
      const manifestRef = db.doc(
        `media_assets/${claim.plan.destinationPlan.assetId}`
      );
      const cleanupRef = db.doc(
        `media_asset_cleanup/${claim.plan.destinationPlan.assetId}`
      );
      const [manifest, cleanup] = await transaction.getAll(
        manifestRef,
        cleanupRef
      );
      if (!operation.exists ||
        operation.get("status") !== "running" ||
        operation.get("phase") !== "commit" ||
        operation.get("leaseOwner") !== invocationId ||
        operation.get("requestHash") !== requestHash ||
        operation.get("sourceHash") !== hashValue(source.data()) ||
        !isActiveGrigliataDm(actor.data()) ||
        !background.exists ||
        !task07MediaWritesV1ForActor({
          control: control.data(),
          purpose: "token",
          role: "dm",
          uid: actorUid,
        }) ||
        !task07FoeTokenMediaRegenerationPlansMatch(
          operation.get("regenerationPlan"),
          claim.plan
        ) ||
        !task07FoeTokenMediaRegenerationPlansMatch(
          currentPlan,
          claim.plan
        ) ||
        token.exists ||
        placement.exists ||
        cleanup.exists ||
        !manifest.exists ||
        manifest.get("state") !== "ready" ||
        !manifestMatchesPlan(manifest.data(), claim.plan)) {
        throw new HttpsError(
          "aborted",
          "Foe-token attachment lost its final state fence."
        );
      }
      const timestamp = Timestamp.now();
      const tokenPayload = buildSpawnedFoeTokenDocument({
        actorUid,
        foeId: input.foeId,
        source: source.data() || {},
        timestamp,
      });
      const attachment = buildTask07NewTargetAttachment({
        assetData: manifest.data() || {},
        plan: claim.plan.destinationPlan,
        targetData: tokenPayload,
        timestamp,
      });
      const placementPayload = buildSpawnedFoePlacementDocument({
        actorUid,
        backgroundId: input.backgroundId,
        tokenId: identity.tokenId,
        col: input.col,
        row: input.row,
        label: asTrimmedString(tokenPayload.label),
        imageUrl: asTrimmedString(tokenPayload.imageUrl),
        timestamp,
      });
      const completed = {
        success: true,
        tokenId: identity.tokenId,
        placementId: identity.placementId,
        assetId: claim.plan.destinationPlan.assetId,
      };
      transaction.create(tokenRef, attachment.targetData);
      transaction.create(placementRef, placementPayload);
      transaction.update(manifestRef, {
        state: "attached",
        attachment: {
          referencePath: attachment.referencePath,
          targetSlot: attachment.targetSlot,
          revision: attachment.revision,
          attachedAt: timestamp,
        },
        "retention.cleanupAfter": FieldValue.delete(),
        updatedAt: timestamp,
      });
      transaction.update(operationRef, {
        status: "completed",
        phase: "completed",
        retryable: false,
        result: completed,
        completedAt: timestamp,
        leaseOwner: FieldValue.delete(),
        leaseExpiresAt: FieldValue.delete(),
        updatedAt: timestamp,
      });
      return completed;
    });
    return {...result, operationId: input.operationId, replayed: false};
  } catch (error) {
    const retryable = retryableError(error);
    if (ownedPlan) {
      await failOwnedOperation({
        db,
        operationRef,
        invocationId,
        requestHash,
        plan: ownedPlan,
        code: error instanceof Task07ProcessorError ?
          error.code :
          asTrimmedString(asRecord(error).code) || "spawn-failed",
        retryable,
        attempt,
      }).catch(() => undefined);
    }
    throw callableError(error);
  }
};

export const spawnGrigliataFoeToken = onCall<SpawnPayload>(
  SPAWN_OPTIONS,
  spawnHandler
);
