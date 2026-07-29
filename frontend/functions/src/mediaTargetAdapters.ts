import * as admin from "firebase-admin";
import {
  asStoredTask07MediaUploadPlan,
  isTask07MediaRequestAuthorized,
  MediaUploadPlan,
  task07MediaReferencePath,
  task07MediaTargetFields,
  task07MediaTargetSlotReferencesAsset,
} from "./mediaAssetLifecycleCore";
import {
  InspectedMediaObject,
  MEDIA_CONTRACTS,
  MEDIA_CONTRACT_VERSION,
  MEDIA_SCHEMA_VERSION,
  MediaVariantName,
  parseCanonicalMediaPath,
} from "./mediaContracts";
import {
  evaluateDocumentBudget,
  USER_ITEM_MAX_BYTES,
} from "./userDataV2";
import {task07MediaWritesV1ForActor} from "./task07MediaControl";

export class Task07TargetAdapterError extends Error {
  readonly code:
    "permission-denied" | "not-found" | "failed-precondition" |
    "already-exists" | "invalid-argument";

  constructor(
    code: Task07TargetAdapterError["code"],
    message: string
  ) {
    super(message);
    this.name = "Task07TargetAdapterError";
    this.code = code;
  }
}

export type StoredTask07MediaObject = InspectedMediaObject & {
  checksum: string;
  role?: "original" | MediaVariantName;
};

export type ReadyTask07GeneratedMedia = {
  generation: string;
  original: StoredTask07MediaObject;
  variants: Partial<Record<MediaVariantName, StoredTask07MediaObject>>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const asGeneratedObject = (
  value: unknown,
  plan: MediaUploadPlan,
  generation: string,
  expectedVariant: MediaVariantName | null
): StoredTask07MediaObject | null => {
  if (!isRecord(value)) return null;
  const parsed = parseCanonicalMediaPath(value.path);
  const checksum = typeof value.checksum === "string" ? value.checksum : "";
  if (!parsed ||
    parsed.assetId !== plan.assetId ||
    parsed.ownerKey !== plan.ownerKey ||
    parsed.audienceScope !== plan.audienceScope ||
    parsed.sourceGeneration !== generation ||
    parsed.variant !== expectedVariant ||
    !/^[a-f0-9]{64}$/.test(checksum) ||
    typeof value.contentType !== "string" ||
    !Number.isSafeInteger(value.bytes) ||
    Number(value.bytes) <= 0 ||
    !Number.isSafeInteger(value.width) ||
    !Number.isSafeInteger(value.height) ||
    !/^[1-9][0-9]*$/.test(String(value.generation)) ||
    typeof value.cacheControl !== "string") {
    return null;
  }
  return value as unknown as StoredTask07MediaObject;
};

export const task07ReadyGeneratedMediaFromManifest = (
  data: admin.firestore.DocumentData,
  plan: MediaUploadPlan
): ReadyTask07GeneratedMedia => {
  const generated = isRecord(data.generated) ? data.generated : {};
  const sourceGeneration = typeof generated.generation === "string" ?
    generated.generation :
    "";
  if (!/^[1-9][0-9]*$/.test(sourceGeneration)) {
    throw new Task07TargetAdapterError(
      "failed-precondition",
      "Media generation is invalid."
    );
  }
  const original = asGeneratedObject(
    generated.original,
    plan,
    sourceGeneration,
    null
  );
  if (!original) {
    throw new Task07TargetAdapterError(
      "failed-precondition",
      "Media original is invalid."
    );
  }
  const storedVariants = isRecord(generated.variants) ?
    generated.variants :
    {};
  const expectedVariants = Object.keys(
    MEDIA_CONTRACTS[plan.kind].variants
  ).sort() as MediaVariantName[];
  if (Object.keys(storedVariants).sort().join(",") !==
    expectedVariants.join(",")) {
    throw new Task07TargetAdapterError(
      "failed-precondition",
      "Media variant set is incomplete."
    );
  }
  const variants: Partial<
    Record<MediaVariantName, StoredTask07MediaObject>
  > = {};
  expectedVariants.forEach((variant) => {
    const object = asGeneratedObject(
      storedVariants[variant],
      plan,
      sourceGeneration,
      variant
    );
    if (!object) {
      throw new Task07TargetAdapterError(
        "failed-precondition",
        "Media derivative is invalid."
      );
    }
    variants[variant] = object;
  });
  return {generation: sourceGeneration, original, variants};
};

const exactAttachedMedia = (
  data: admin.firestore.DocumentData | undefined,
  plan: MediaUploadPlan
): Record<string, unknown> | null => (
  isRecord(data?.[task07MediaTargetFields(plan).mediaField]) ?
    data?.[task07MediaTargetFields(plan).mediaField] as Record<string, unknown> :
    null
);

const targetRevision = (
  data: admin.firestore.DocumentData | undefined,
  plan: MediaUploadPlan
): number => {
  const value = data?.[task07MediaTargetFields(plan).revisionField];
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0;
};

const attachmentMatchesTargetSlot = (input: {
  asset: admin.firestore.DocumentSnapshot;
  referencePath: string;
  plan: MediaUploadPlan;
}): boolean => {
  if (input.asset.get("attachment.referencePath") !== input.referencePath) {
    return false;
  }
  const expectedSlot = task07MediaTargetFields(input.plan).slot;
  const storedSlot = input.asset.get("attachment.targetSlot");
  // Version-one primary attachments created before personal video slots were
  // introduced have no targetSlot. Keep only that exact compatibility case.
  return storedSlot === expectedSlot ||
    (storedSlot === undefined && expectedSlot === "media");
};

export const validateTask07MediaTarget = (input: {
  plan: MediaUploadPlan;
  target: admin.firestore.DocumentSnapshot;
}): void => {
  if (!input.target.exists) {
    throw new Task07TargetAdapterError("not-found", "Media target not found.");
  }
  const data = input.target.data() || {};
  const referencePath = task07MediaReferencePath(input.plan);
  if (input.target.ref.path !== referencePath ||
    (input.plan.targetKind !== "profile" &&
      input.target.id !== input.plan.entityId)) {
    throw new Task07TargetAdapterError(
      "failed-precondition",
      "Media target identity is invalid."
    );
  }
  if (data.deletionState === "pending" ||
    data.pendingDeletion === true ||
    data.deleted === true) {
    throw new Task07TargetAdapterError(
      "failed-precondition",
      "Media target is pending deletion."
    );
  }
  if (input.plan.targetKind === "profile" &&
    input.target.id !== input.plan.ownerUid) {
    throw new Task07TargetAdapterError(
      "failed-precondition",
      "Profile target identity is invalid."
    );
  }
  if ([
    "user-inventory", "user-technique", "user-spell",
  ].includes(input.plan.targetKind) &&
    input.target.ref.parent.parent?.id !== input.plan.ownerUid) {
    throw new Task07TargetAdapterError(
      "failed-precondition",
      "User-owned media target ownership is invalid."
    );
  }
  const expectedPersonalCollection = input.plan.targetKind === "user-technique" ?
    "tecniche" :
    input.plan.targetKind === "user-spell" ? "spells" : null;
  if (expectedPersonalCollection &&
    input.target.ref.parent.id !== expectedPersonalCollection) {
    throw new Task07TargetAdapterError(
      "failed-precondition",
      "Personal media target collection is invalid."
    );
  }
  if (input.plan.targetKind === "grigliata-token" &&
    data.ownerUid !== input.plan.ownerUid) {
    throw new Task07TargetAdapterError(
      "failed-precondition",
      "Token target ownership is invalid."
    );
  }
  if (input.plan.targetKind === "grigliata-background") {
    const expectedAssetType = input.plan.kind === "map-video" ?
      "video" : "image";
    if (data.assetType !== expectedAssetType) {
      throw new Task07TargetAdapterError(
        "failed-precondition",
        "Background media purpose is invalid."
      );
    }
  }
};

export const task07MediaValueFromReadyManifest = (
  data: admin.firestore.DocumentData,
  plan: MediaUploadPlan
): Record<string, unknown> => {
  const generated = task07ReadyGeneratedMediaFromManifest(data, plan);
  return {
    schemaVersion: MEDIA_SCHEMA_VERSION,
    contractVersion: MEDIA_CONTRACT_VERSION,
    assetId: plan.assetId,
    kind: plan.kind,
    state: "ready",
    generation: generated.generation,
    audience: plan.audienceScope,
    ownerUid: plan.ownerUid,
    original: generated.original,
    variants: generated.variants,
    processing: {
      authoritative: true,
      fallbackCode: null,
    },
  };
};

export const task07TargetAttachmentPatch = (input: {
  current?: admin.firestore.DocumentData;
  media: Record<string, unknown>;
  plan: MediaUploadPlan;
  revision: number;
  timestamp: admin.firestore.Timestamp;
}): admin.firestore.UpdateData<admin.firestore.DocumentData> => {
  const original = input.media.original as StoredTask07MediaObject;
  const fields = task07MediaTargetFields(input.plan);
  const current = input.current || {};
  const currentImageUrl = typeof current.imageUrl === "string" ?
    current.imageUrl.trim() :
    "";
  const currentImagePath = typeof current.imagePath === "string" ?
    current.imagePath.trim() :
    "";
  const preservesLegacyImageReference = Boolean(
    currentImageUrl ||
    (currentImagePath && !parseCanonicalMediaPath(currentImagePath))
  );
  const patch: admin.firestore.UpdateData<admin.firestore.DocumentData> = {
    [fields.mediaField]: input.media,
    [fields.revisionField]: input.revision,
    [fields.updatedAtField]: input.timestamp,
  };
  if ([
    "profile", "npc", "foe", "grigliata-token", "grigliata-background",
  ].includes(input.plan.targetKind) && !preservesLegacyImageReference) {
    patch.imagePath = original.path;
    patch.imageUrl = "";
  }
  if (input.plan.targetKind === "grigliata-background" &&
    !preservesLegacyImageReference) {
    patch.imageWidth = original.width;
    patch.imageHeight = original.height;
    patch.contentType = original.contentType;
    patch.sizeBytes = original.bytes;
    patch.assetType = input.plan.kind === "map-video" ? "video" : "image";
    if (input.plan.kind === "map-video") {
      patch.durationMs = original.durationMs || 0;
    }
  }
  return patch;
};

export const assertTask07TargetDocumentBudget = (input: {
  current: admin.firestore.DocumentData;
  patch: admin.firestore.UpdateData<admin.firestore.DocumentData>;
  plan: MediaUploadPlan;
}): void => {
  if (![
    "user-inventory", "user-technique", "user-spell",
  ].includes(input.plan.targetKind)) return;
  const budget = evaluateDocumentBudget(
    {...input.current, ...input.patch},
    USER_ITEM_MAX_BYTES
  );
  if (budget.warning) {
    console.warn("Task07 target document budget warning", {
      targetKind: input.plan.targetKind,
      bytes: budget.bytes,
      limit: budget.limit,
    });
  }
  if (!budget.accepted) {
    throw new Task07TargetAdapterError(
      "failed-precondition",
      "Media target exceeds its document-size budget."
    );
  }
};

export const buildTask07NewTargetAttachment = (input: {
  assetData: admin.firestore.DocumentData;
  plan: MediaUploadPlan;
  targetData: admin.firestore.DocumentData;
  timestamp: admin.firestore.Timestamp;
}): {
  targetData: admin.firestore.DocumentData;
  referencePath: string;
  targetSlot: "media" | "videoMedia";
  revision: 1;
} => {
  if (input.assetData.state !== "ready" ||
    input.plan.previousAssetId !== null) {
    throw new Task07TargetAdapterError(
      "failed-precondition",
      "New-target media must be ready and have no previous attachment."
    );
  }
  const referencePath = task07MediaReferencePath(input.plan);
  const targetSlot = task07MediaTargetFields(input.plan).slot;
  const media = task07MediaValueFromReadyManifest(
    input.assetData,
    input.plan
  );
  const patch = task07TargetAttachmentPatch({
    current: input.targetData,
    media,
    plan: input.plan,
    revision: 1,
    timestamp: input.timestamp,
  });
  assertTask07TargetDocumentBudget({
    current: input.targetData,
    patch,
    plan: input.plan,
  });
  return {
    targetData: {...input.targetData, ...patch},
    referencePath,
    targetSlot,
    revision: 1,
  };
};

export const attachTask07ReadyAssetTransaction = async (input: {
  db: admin.firestore.Firestore;
  actorUid: string;
  actorRole: string;
  assetId: string;
  expectedRevision?: number | null;
  nowMs?: number;
}): Promise<{
  attached: boolean;
  assetId: string;
  previousAssetId: string | null;
  referencePath: string;
  targetSlot: "media" | "videoMedia";
  revision: number;
}> => {
  if (!/^m_[a-f0-9]{40}$/.test(input.assetId) ||
    (input.expectedRevision !== undefined &&
      input.expectedRevision !== null &&
      (!Number.isSafeInteger(input.expectedRevision) ||
        input.expectedRevision < 0))) {
    throw new Task07TargetAdapterError(
      "invalid-argument",
      "Media attachment identity is invalid."
    );
  }
  const assetRef = input.db.doc(`media_assets/${input.assetId}`);
  const controlRef = input.db.doc("utils/task07_media");
  const nowMs = input.nowMs ?? Date.now();
  return input.db.runTransaction(async (transaction) => {
    const [asset, control] = await transaction.getAll(assetRef, controlRef);
    const plan = asStoredTask07MediaUploadPlan(asset.get("plan"));
    if (!asset.exists || !plan || plan.assetId !== input.assetId) {
      throw new Task07TargetAdapterError(
        "not-found",
        "Media asset not found."
      );
    }
    if (plan.actorUid !== input.actorUid ||
      !isTask07MediaRequestAuthorized({
        kind: plan.kind,
        actorUid: input.actorUid,
        ownerUid: plan.ownerUid,
        referenceScope: plan.referenceScope,
        actorRole: input.actorRole,
      })) {
      throw new Task07TargetAdapterError(
        "permission-denied",
        "Media attachment is not authorized."
      );
    }
    if (!task07MediaWritesV1ForActor({
      control: control.data(),
      purpose: plan.kind,
      role: input.actorRole,
      uid: input.actorUid,
    })) {
      throw new Task07TargetAdapterError(
        "failed-precondition",
        "Task 07 media writes are not enabled."
      );
    }
    const referencePath = task07MediaReferencePath(plan);
    const targetSlot = task07MediaTargetFields(plan).slot;
    if (asset.get("state") === "attached" &&
      attachmentMatchesTargetSlot({asset, referencePath, plan})) {
      const target = await transaction.get(input.db.doc(referencePath));
      if (!task07MediaTargetSlotReferencesAsset(
        target.data(),
        targetSlot,
        input.assetId
      )) {
        throw new Task07TargetAdapterError(
          "failed-precondition",
          "Attached media target no longer references this asset."
        );
      }
      return {
        attached: false,
        assetId: input.assetId,
        previousAssetId: plan.previousAssetId,
        referencePath,
        targetSlot,
        revision: targetRevision(target.data(), plan),
      };
    }
    if (asset.get("state") !== "ready") {
      throw new Task07TargetAdapterError(
        "failed-precondition",
        "Media asset is not ready."
      );
    }
    const media = task07MediaValueFromReadyManifest(asset.data() || {}, plan);
    const referenceRef = input.db.doc(referencePath);
    const target = await transaction.get(referenceRef);
    validateTask07MediaTarget({plan, target});
    const revision = targetRevision(target.data(), plan);
    if (input.expectedRevision !== undefined &&
      input.expectedRevision !== null &&
      input.expectedRevision !== revision) {
      throw new Task07TargetAdapterError(
        "failed-precondition",
        "Media target revision changed."
      );
    }
    const currentMedia = exactAttachedMedia(target.data(), plan);
    const currentAssetId = typeof currentMedia?.assetId === "string" ?
      currentMedia.assetId :
      null;
    if (currentAssetId !== plan.previousAssetId) {
      throw new Task07TargetAdapterError(
        "failed-precondition",
        "Previous media does not match the target."
      );
    }
    const previousRef = plan.previousAssetId ?
      input.db.doc(`media_assets/${plan.previousAssetId}`) :
      null;
    const previous = previousRef ?
      await transaction.get(previousRef) :
      null;
    if (previousRef && (
      !previous ||
      !previous.exists ||
      previous.get("state") !== "attached" ||
      !attachmentMatchesTargetSlot({
        asset: previous,
        referencePath,
        plan,
      })
    )) {
      throw new Task07TargetAdapterError(
        "failed-precondition",
        "Previous media manifest is not attached to this target."
      );
    }
    const timestamp = admin.firestore.Timestamp.fromMillis(nowMs);
    const targetPatch = task07TargetAttachmentPatch({
      current: target.data() || {},
      media,
      plan,
      revision: revision + 1,
      timestamp,
    });
    assertTask07TargetDocumentBudget({
      current: target.data() || {},
      patch: targetPatch,
      plan,
    });
    transaction.update(referenceRef, targetPatch);
    transaction.update(assetRef, {
      state: "attached",
      attachment: {
        referencePath,
        targetSlot,
        revision: revision + 1,
        attachedAt: timestamp,
      },
      "retention.cleanupAfter": admin.firestore.FieldValue.delete(),
      updatedAt: timestamp,
    });
    if (previousRef && previous) {
      const cleanupAfter = admin.firestore.Timestamp.fromMillis(
        nowMs +
        MEDIA_CONTRACTS[plan.kind].retention.supersededGraceHours *
        60 * 60 * 1000
      );
      transaction.update(previousRef, {
        state: "superseded",
        supersededByAssetId: plan.assetId,
        retention: {
          supersededAt: timestamp,
          cleanupAfter,
        },
        updatedAt: timestamp,
      });
      transaction.set(
        input.db.doc(`media_asset_cleanup/${plan.previousAssetId}`),
        {
          schemaVersion: MEDIA_SCHEMA_VERSION,
          assetId: plan.previousAssetId,
          state: "pending",
          reason: "superseded",
          attempts: 0,
          cleanupAfter,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        {merge: false}
      );
    }
    return {
      attached: true,
      assetId: input.assetId,
      previousAssetId: plan.previousAssetId,
      referencePath,
      targetSlot,
      revision: revision + 1,
    };
  });
};
