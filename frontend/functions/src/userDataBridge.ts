import * as admin from "firebase-admin";
import {
  buildLegacyContentProjection,
  buildLegacyDomainProjection,
  buildLegacyEquipmentSlotProjection,
  buildLegacyInventoryProjection,
  asRecord,
  asTrimmedString,
  hashValue,
  materializeLegacyInventoryIdentities,
  planLegacyContentIdentityPersistence,
  planLegacyManagedProjection,
  resolveUserDataRollout,
  resolveUserDataRolloutStage,
  stabilizeLegacyInventoryProjection,
} from "./userDataV2";

const ACTIVE_BRIDGE_MODES = new Set([
  "shadow-verify",
  "dual-write",
  "new-read-dual-write",
]);
const MODE_DOCUMENT = "app_config/user_data_v2";
export const MAX_BRIDGED_INVENTORY_DOCUMENTS = 2000;
export const MAX_BRIDGED_CONTENT_DOCUMENTS = 2000;
const LEGACY_DRAIN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{7,99}$/;

export const isLegacyUserBridgeActive = (
  config: unknown,
  uid: string
): boolean => ACTIVE_BRIDGE_MODES.has(resolveUserDataRolloutStage(config, uid));

interface TimestampParts {
  seconds: number;
  nanoseconds: number;
}

export interface UserDataLegacyDrainResolution {
  scope: "global" | "user";
  present: boolean;
  valid: boolean;
  drainId: string;
  closedAt: TimestampParts | null;
}

const timestampParts = (value: unknown): TimestampParts | null => {
  if (!value || typeof value !== "object") return null;
  const timestamp = value as {
    seconds?: unknown;
    nanoseconds?: unknown;
    _seconds?: unknown;
    _nanoseconds?: unknown;
  };
  const seconds = Number(timestamp.seconds ?? timestamp._seconds);
  const nanoseconds = Number(timestamp.nanoseconds ?? timestamp._nanoseconds);
  if (
    !Number.isInteger(seconds) ||
    !Number.isInteger(nanoseconds) ||
    nanoseconds < 0 ||
    nanoseconds >= 1_000_000_000
  ) return null;
  return {seconds, nanoseconds};
};

const timestampIsAtOrBefore = (
  candidate: TimestampParts,
  cutoff: TimestampParts
): boolean => candidate.seconds < cutoff.seconds || (
  candidate.seconds === cutoff.seconds &&
  candidate.nanoseconds <= cutoff.nanoseconds
);

const hasOwn = (value: Record<string, unknown>, key: string): boolean => (
  Object.prototype.hasOwnProperty.call(value, key)
);

const isObjectRecord = (value: unknown): value is Record<string, unknown> => (
  value !== null && typeof value === "object" && !Array.isArray(value)
);

export const resolveUserDataLegacyDrain = (
  config: unknown,
  uid: string
): UserDataLegacyDrainResolution => {
  const data = asRecord(config);
  const rollout = resolveUserDataRollout(data, uid);
  const drainFieldPresent = hasOwn(data, "legacyDrain");
  if (drainFieldPresent && !isObjectRecord(data.legacyDrain)) {
    return {
      scope: rollout.scope,
      present: true,
      valid: false,
      drainId: "",
      closedAt: null,
    };
  }
  const drain = asRecord(data.legacyDrain);
  if (
    rollout.scope === "user" &&
    hasOwn(drain, "users") &&
    !isObjectRecord(drain.users)
  ) {
    return {
      scope: rollout.scope,
      present: true,
      valid: false,
      drainId: "",
      closedAt: null,
    };
  }
  const users = asRecord(drain.users);
  const present = rollout.scope === "user"
    ? hasOwn(users, uid)
    : hasOwn(drain, "global");
  const record = asRecord(
    rollout.scope === "user" ? users[uid] : drain.global
  );
  const drainId = asTrimmedString(record.drainId);
  const closedAt = timestampParts(record.closedAt);
  return {
    scope: rollout.scope,
    present,
    valid: present && LEGACY_DRAIN_ID_PATTERN.test(drainId) && Boolean(closedAt),
    drainId,
    closedAt,
  };
};

const drainIdentity = (drain: UserDataLegacyDrainResolution): string => (
  drain.present && drain.valid && drain.closedAt
    ? [
      drain.scope,
      drain.drainId,
      drain.closedAt.seconds,
      drain.closedAt.nanoseconds,
    ].join(":")
    : `${drain.scope}:${drain.present ? "invalid" : "none"}`
);

export const isUserDataLegacyDrainFrozen = (
  config: unknown,
  uid: string
): boolean => resolveUserDataLegacyDrain(config, uid).present;

export const canProcessLegacyUserBridgeEvent = (
  config: unknown,
  uid: string,
  sourceEventUpdateTime: unknown,
  expectedDrain?: UserDataLegacyDrainResolution
): boolean => {
  const stage = resolveUserDataRolloutStage(config, uid);
  if (!ACTIVE_BRIDGE_MODES.has(stage)) return false;
  const drain = resolveUserDataLegacyDrain(config, uid);
  if (expectedDrain && drainIdentity(drain) !== drainIdentity(expectedDrain)) {
    return false;
  }
  if (!drain.present) return true;
  if (!drain.valid || !drain.closedAt) return false;
  const eventTime = timestampParts(sourceEventUpdateTime);
  return Boolean(eventTime && timestampIsAtOrBefore(eventTime, drain.closedAt));
};

export const isLegacyInventoryBridgeSizeSupported = (count: number): boolean => (
  Number.isInteger(count) &&
  count >= 0 &&
  count <= MAX_BRIDGED_INVENTORY_DOCUMENTS
);

type DocumentData = admin.firestore.DocumentData;
type DocumentReference = admin.firestore.DocumentReference;

interface FencedMutation {
  type: "set" | "delete";
  ref: DocumentReference;
  data?: DocumentData;
  merge?: boolean;
}

const applyFencedMutations = async (input: {
  db: admin.firestore.Firestore;
  modeRef: DocumentReference;
  sourceRef: DocumentReference;
  sourceEventUpdateTime: unknown;
  expectedDrain: UserDataLegacyDrainResolution;
  uid: string;
  expectedFields: Record<string, unknown>;
  mutations: FencedMutation[];
}): Promise<boolean> => {
  const chunks: FencedMutation[][] = [];
  for (let index = 0; index < input.mutations.length; index += 400) {
    chunks.push(input.mutations.slice(index, index + 400));
  }
  for (const chunk of chunks) {
    const applied = await input.db.runTransaction(async (transaction) => {
      const [modeSnapshot, source] = await transaction.getAll(
        input.modeRef,
        input.sourceRef
      );
      if (
        !canProcessLegacyUserBridgeEvent(
          modeSnapshot.data(),
          input.uid,
          input.sourceEventUpdateTime,
          input.expectedDrain
        ) ||
        !source.exists ||
        source.get("deletionState") === "pending" ||
        Object.entries(input.expectedFields).some(
          ([field, value]) => hashValue(source.get(field)) !== hashValue(value)
        )
      ) return false;
      chunk.forEach((mutation) => {
        if (mutation.type === "delete") {
          transaction.delete(mutation.ref);
        } else if (mutation.merge) {
          transaction.set(mutation.ref, mutation.data ?? {}, {merge: true});
        } else {
          transaction.set(mutation.ref, mutation.data ?? {});
        }
      });
      return true;
    });
    if (!applied) return false;
  }
  return true;
};

const sourceChanged = (
  beforeData: DocumentData | null | undefined,
  afterData: DocumentData | null | undefined,
  key: string
): boolean => hashValue(beforeData?.[key]) !== hashValue(afterData?.[key]);

export const shouldReconcileLegacyInventory = (
  beforeData: DocumentData | null | undefined,
  afterData: DocumentData | null | undefined
): boolean => (
  sourceChanged(beforeData, afterData, "inventory") ||
  sourceChanged(beforeData, afterData, "equipped")
);

export const shouldReconcileLegacyContent = (
  beforeData: DocumentData | null | undefined,
  afterData: DocumentData | null | undefined,
  key: "spells" | "tecniche"
): boolean => sourceChanged(beforeData, afterData, key);

export const reconcileLegacyUserDomains = async (
  uid: string,
  beforeData: DocumentData | null | undefined,
  afterData: DocumentData | null | undefined,
  sourceEventUpdateTime: unknown
): Promise<void> => {
  if (!afterData) return;

  const db = admin.firestore();
  const modeRef = db.doc(MODE_DOCUMENT);
  const modeSnapshot = await modeRef.get();
  const expectedDrain = resolveUserDataLegacyDrain(modeSnapshot.data(), uid);
  if (!canProcessLegacyUserBridgeEvent(
    modeSnapshot.data(),
    uid,
    sourceEventUpdateTime,
    expectedDrain
  )) return;
  if (afterData.deletionState === "pending") return;

  const sourceRef = db.doc(`users/${uid}`);
  const stateCollection = sourceRef.collection("state");
  const sourceSnapshot = await sourceRef.get();
  if (!sourceSnapshot.exists) return;
  const currentSource = sourceSnapshot.data() ?? {};
  const projection = buildLegacyDomainProjection(currentSource);
  const domainEntries = Object.entries(projection);

  const sourceFingerprint = hashValue(currentSource);
  const domainsApplied = await db.runTransaction(async (transaction) => {
    const [latestMode, latestSource, ...domainSnapshots] =
      await transaction.getAll(
        modeRef,
        sourceRef,
        ...domainEntries.map(([domain]) => stateCollection.doc(domain))
      );
    if (
      !canProcessLegacyUserBridgeEvent(
        latestMode.data(),
        uid,
        sourceEventUpdateTime,
        expectedDrain
      ) ||
      !latestSource.exists ||
      hashValue(latestSource.data()) !== sourceFingerprint
    ) return false;

    domainEntries.forEach(([domain, data], index) => {
      const target = stateCollection.doc(domain);
      const existing = domainSnapshots[index];
      const sourceHash = hashValue(data);
      const payload = Object.fromEntries(Object.entries(data).filter(
        ([key]) => key !== "revision"
      ));
      const existingPayload = existing.exists ? {...existing.data()} : {};
      [
        "revision",
        "legacySourceHash",
        "legacySourceUpdateTime",
        "updatedAt",
        "updatedBy",
      ].forEach((key) => delete existingPayload[key]);
      const payloadMatches = existing.exists &&
        hashValue(existingPayload) === hashValue(payload);
      if (payloadMatches && existing.get("legacySourceHash") === sourceHash) {
        return;
      }
      const previousRevision = Number(existing.get("revision")) || 0;
      transaction.set(target, {
        ...payload,
        revision: previousRevision + 1,
        legacySourceHash: sourceHash,
        legacySourceUpdateTime: sourceSnapshot.updateTime ?? null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: "legacy-bridge",
      });
    });
    return true;
  });
  if (!domainsApplied) return;

  if (shouldReconcileLegacyInventory(beforeData, currentSource)) {
    const inventoryProjection = buildLegacyInventoryProjection(
      currentSource.inventory,
      currentSource.equipped
    );
    if (!isLegacyInventoryBridgeSizeSupported(inventoryProjection.length)) {
      console.error("Task05 legacy inventory bridge refused oversized user", {
        uid,
        count: inventoryProjection.length,
      });
      return;
    }

    const inventoryCollection = sourceRef.collection("inventory");
    const [existingInventory, existingEquipment] = await Promise.all([
      inventoryCollection.get(),
      stateCollection.doc("equipment").get(),
    ]);
    const existingEntries = existingInventory.docs.map((snapshot) => ({
      id: snapshot.id,
      data: snapshot.data(),
    }));
    const preferredIds = Object.values(asRecord(existingEquipment.get("slots")))
      .map(asTrimmedString)
      .filter(Boolean);
    const stabilizedProjection = stabilizeLegacyInventoryProjection(
      inventoryProjection,
      existingEntries,
      preferredIds
    );
    const plan = planLegacyManagedProjection(
      existingEntries,
      stabilizedProjection
    );
    const stableSlots = buildLegacyEquipmentSlotProjection(
      currentSource.equipped,
      stabilizedProjection
    );
    const identityInventory = materializeLegacyInventoryIdentities(
      currentSource.inventory,
      stabilizedProjection
    );
    const identityEquipped = Object.fromEntries(Object.entries(
      asRecord(currentSource.equipped)
    ).map(([slot, rawEntry]) => {
      const inventoryId = asTrimmedString(stableSlots[slot]);
      return [slot, inventoryId && rawEntry && typeof rawEntry === "object"
        ? {
          ...asRecord(rawEntry),
          _instance: {
            ...asRecord(asRecord(rawEntry)._instance),
            instanceId: inventoryId,
          },
        }
        : rawEntry];
    }));
    const identityPersisted = await db.runTransaction(async (transaction) => {
      const equipmentRef = stateCollection.doc("equipment");
      const [latestMode, latest, latestEquipment] = await transaction.getAll(
        modeRef,
        sourceRef,
        equipmentRef
      );
      if (!canProcessLegacyUserBridgeEvent(
        latestMode.data(),
        uid,
        sourceEventUpdateTime,
        expectedDrain
      ) ||
        !latest.exists ||
        latest.get("deletionState") === "pending" ||
        hashValue(latest.get("inventory")) !== hashValue(currentSource.inventory) ||
        hashValue(latest.get("equipped")) !== hashValue(currentSource.equipped)) {
        return false;
      }
      const update: DocumentData = {};
      if (hashValue(identityInventory) !== hashValue(currentSource.inventory)) {
        update.inventory = identityInventory;
      }
      if (hashValue(identityEquipped) !== hashValue(currentSource.equipped)) {
        update.equipped = identityEquipped;
      }
      if (Object.keys(update).length) transaction.update(sourceRef, update);
      if (hashValue(latestEquipment.get("slots")) !== hashValue(stableSlots)) {
        const equipmentPayload = {
          ...projection.equipment,
          slots: stableSlots,
        };
        transaction.set(equipmentRef, {
          ...equipmentPayload,
          revision: (Number(latestEquipment.get("revision")) || 0) + 1,
          legacySourceHash: hashValue(equipmentPayload),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedBy: "legacy-bridge",
        });
      }
      return true;
    });
    if (!identityPersisted) return;
    // Identity persistence changes the root update time, so establish a fresh
    // source fence before writing any descendants.
    const refreshedSource = await sourceRef.get();
    if (!refreshedSource.exists ||
      hashValue(refreshedSource.get("inventory")) !== hashValue(identityInventory) ||
      hashValue(refreshedSource.get("equipped")) !== hashValue(identityEquipped)) {
      return;
    }
    const existingById = new Map(existingEntries.map((entry) => [
      entry.id,
      entry.data,
    ]));
    const mutations: FencedMutation[] = [
      ...plan.sets.map(({id, data}) => ({
        type: "set" as const,
        ref: inventoryCollection.doc(id),
        data: {
          ...data,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedBy: "legacy-bridge",
        },
        merge: asRecord(existingById.get(id)).legacyManaged === false,
      })),
      ...plan.deletes.map((id) => ({
        type: "delete" as const,
        ref: inventoryCollection.doc(id),
      })),
    ];
    const inventoryApplied = await applyFencedMutations({
      db,
      modeRef,
      sourceRef,
      sourceEventUpdateTime,
      expectedDrain,
      uid,
      expectedFields: {
        inventory: identityInventory,
        equipped: identityEquipped,
      },
      mutations,
    });
    if (!inventoryApplied) return;
  }

  for (const descriptor of [
    {legacyKey: "spells" as const, kind: "spell" as const},
    {legacyKey: "tecniche" as const, kind: "tecnica" as const},
  ]) {
    if (!shouldReconcileLegacyContent(
      beforeData,
      currentSource,
      descriptor.legacyKey
    )) continue;
    // Read the migrated descendants before assigning a missing root identity.
    // This is the lifecycle where an offline backfill already created ID_A,
    // then the first legacy edit changes the id-less payload to B. Reusing the
    // owned document's migration location prevents delete/recreate churn.
    const collectionName = descriptor.legacyKey;
    const existingBeforeIdentity = await sourceRef
      .collection(collectionName)
      .get();
    const existingIdentityEntries = existingBeforeIdentity.docs.map(
      (snapshot) => ({id: snapshot.id, data: snapshot.data()})
    );
    const initialIdentityPlan = planLegacyContentIdentityPersistence(
      descriptor.kind,
      currentSource[descriptor.legacyKey],
      currentSource[descriptor.legacyKey],
      existingIdentityEntries
    );
    if (!initialIdentityPlan.ok ||
      initialIdentityPlan.projection.documents.length >
        MAX_BRIDGED_CONTENT_DOCUMENTS) {
      console.error("Task05 legacy content bridge refused unsafe projection", {
        uid,
        kind: descriptor.kind,
        count: initialIdentityPlan.projection.documents.length,
        reason: initialIdentityPlan.reason || "oversized",
      });
      continue;
    }
    const identityPlan = await db.runTransaction(async (transaction) => {
      const [latestMode, latestSource] = await transaction.getAll(
        modeRef,
        sourceRef
      );
      if (!canProcessLegacyUserBridgeEvent(
        latestMode.data(),
        uid,
        sourceEventUpdateTime,
        expectedDrain
      ) || !latestSource.exists ||
        latestSource.get("deletionState") === "pending") {
        return null;
      }
      const plan = planLegacyContentIdentityPersistence(
        descriptor.kind,
        currentSource[descriptor.legacyKey],
        latestSource.get(descriptor.legacyKey),
        existingIdentityEntries
      );
      if (!plan.ok ||
        plan.projection.documents.length > MAX_BRIDGED_CONTENT_DOCUMENTS) {
        return null;
      }
      if (plan.changed) {
        transaction.update(sourceRef, {
          [descriptor.legacyKey]: plan.content,
        } as DocumentData);
      }
      return plan;
    });
    if (!identityPlan) return;

    // Identity persistence advances the root update time. Re-establish the
    // exact field fence before reading or mutating descendants.
    const refreshedSource = await sourceRef.get();
    if (!refreshedSource.exists ||
      hashValue(refreshedSource.get(descriptor.legacyKey)) !==
        hashValue(identityPlan.content)) {
      return;
    }
    const projection = buildLegacyContentProjection(
      descriptor.kind,
      identityPlan.content
    );
    if (!projection.ok ||
      projection.documents.length > MAX_BRIDGED_CONTENT_DOCUMENTS) return;
    const [existingContent, existingReservations] = await Promise.all([
      sourceRef.collection(collectionName).get(),
      sourceRef.collection("content_names").get(),
    ]);
    const existingContentEntries = existingContent.docs.map((snapshot) => ({
      id: snapshot.id,
      data: snapshot.data(),
    }));
    const existingReservationEntries = existingReservations.docs
      .filter((snapshot) => snapshot.get("kind") === descriptor.kind)
      .map((snapshot) => ({id: snapshot.id, data: snapshot.data()}));
    const contentPlan = planLegacyManagedProjection(
      existingContentEntries,
      projection.documents
    );
    const reservationPlan = planLegacyManagedProjection(
      existingReservationEntries,
      projection.reservations
    );
    const mutations: FencedMutation[] = [
      ...contentPlan.sets.map(({id, data}) => ({
        type: "set" as const,
        ref: sourceRef.collection(collectionName).doc(id),
        data: {
          ...data,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedBy: "legacy-bridge",
        },
        // Personal content is replacement-shaped. Exact writes ensure an old
        // client removing a media field does not leave the stale reference.
        merge: false,
      })),
      ...contentPlan.deletes.map((id) => ({
        type: "delete" as const,
        ref: sourceRef.collection(collectionName).doc(id),
      })),
      ...reservationPlan.sets.map(({id, data}) => ({
        type: "set" as const,
        ref: sourceRef.collection("content_names").doc(id),
        data: {
          ...data,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        merge: false,
      })),
      ...reservationPlan.deletes.map((id) => ({
        type: "delete" as const,
        ref: sourceRef.collection("content_names").doc(id),
      })),
    ];
    const applied = await applyFencedMutations({
      db,
      modeRef,
      sourceRef,
      sourceEventUpdateTime,
      expectedDrain,
      uid,
      expectedFields: {
        [descriptor.legacyKey]: identityPlan.content,
      },
      mutations,
    });
    if (!applied) return;
  }
};
