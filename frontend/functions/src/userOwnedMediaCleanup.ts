import * as admin from "firebase-admin";
import {getStorage} from "firebase-admin/storage";
import {onDocumentWritten} from "firebase-functions/v2/firestore";
import {asTrimmedString, hashValue} from "./userDataV2";

const REGION = "europe-west8";
const QUEUE_COLLECTION = "user_media_cleanup";

export type OwnedMediaScope = "profile" | "inventory" | "spells" | "tecniche";

export interface OwnedMediaPath {
  uid: string;
  scope: OwnedMediaScope;
  entityId: string;
  path: string;
}

const storagePathFromValue = (value: unknown): string => {
  const text = asTrimmedString(value);
  if (!text) return "";
  if (!text.includes("://")) return text;
  try {
    const encoded = text.split("/o/")[1]?.split("?")[0];
    return encoded ? decodeURIComponent(encoded) : "";
  } catch {
    return "";
  }
};

const escapeRegExp = (value: string): string => (
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
);

export const parseOwnedMediaPath = (
  value: unknown,
  expectedUid = "",
  expectedScope: OwnedMediaScope | "" = "",
  expectedEntityId = ""
): OwnedMediaPath | null => {
  const path = storagePathFromValue(value);
  if (!path || path.includes("\\") || path.split("/").some((part) => (
    !part || part === "." || part === ".."
  ))) return null;
  const parts = path.split("/");
  if (parts[0] === "users" && parts[1] &&
    parts[2] === "profile" && parts.length === 4) {
    return {uid: parts[1], scope: "profile", entityId: "profile", path};
  }
  if (parts[0] === "users" && parts[1] &&
    ["inventory", "spells", "tecniche"].includes(parts[2]) &&
    parts.length === 5 && parts[3]) {
    return {
      uid: parts[1],
      scope: parts[2] as OwnedMediaScope,
      entityId: parts[3],
      path,
    };
  }
  if (!expectedUid || !expectedScope || !expectedEntityId) return null;
  const uid = escapeRegExp(expectedUid);
  const legacyPatterns: Partial<Record<OwnedMediaScope, RegExp>> = {
    profile: new RegExp(`^characters/[^/]*_${uid}_(?:[^/]+)$`),
    inventory: new RegExp(`^items/varie_${uid}_[^/]+$`),
    spells: new RegExp(`^spells/(?:videos/)?spell_${uid}_[^/]+$`),
    tecniche: new RegExp(`^tecnicas/(?:videos/)?tecnica_${uid}_[^/]+$`),
  };
  if (legacyPatterns[expectedScope]?.test(path)) {
    return {
      uid: expectedUid,
      scope: expectedScope,
      entityId: expectedEntityId,
      path,
    };
  }
  return null;
};

export const collectOwnedMediaPaths = (
  value: unknown,
  uid: string,
  scope: OwnedMediaScope,
  entityId: string
): string[] => {
  const result = new Set<string>();
  const visit = (entry: unknown): void => {
    if (typeof entry === "string") {
      const parsed = parseOwnedMediaPath(entry, uid, scope, entityId);
      if (parsed && parsed.uid === uid && parsed.scope === scope &&
        parsed.entityId === entityId) result.add(parsed.path);
      return;
    }
    if (Array.isArray(entry)) {
      entry.forEach(visit);
      return;
    }
    if (!entry || typeof entry !== "object") return;
    Object.values(entry as Record<string, unknown>).forEach(visit);
  };
  visit(value);
  return [...result].sort();
};

export const planOwnedMediaCleanup = (input: {
  before: unknown;
  after: unknown;
  uid: string;
  scope: OwnedMediaScope;
  entityId: string;
}): string[] => {
  const before = collectOwnedMediaPaths(
    input.before,
    input.uid,
    input.scope,
    input.entityId
  );
  const after = new Set(collectOwnedMediaPaths(
    input.after,
    input.uid,
    input.scope,
    input.entityId
  ));
  return before.filter((path) => !after.has(path));
};

export const enqueueOwnedMediaCleanup = (
  transaction: admin.firestore.Transaction,
  db: admin.firestore.Firestore,
  input: {
    paths: string[];
    uid: string;
    scope: OwnedMediaScope;
    entityId: string;
    source: string;
    requestedBy: string;
  }
): void => {
  [...new Set(input.paths)].forEach((path) => {
    const parsed = parseOwnedMediaPath(
      path,
      input.uid,
      input.scope,
      input.entityId
    );
    if (!parsed || parsed.uid !== input.uid || parsed.scope !== input.scope ||
      parsed.entityId !== input.entityId) return;
    const cleanupId = hashValue([input.uid, path]).slice(0, 48);
    transaction.set(db.doc(`${QUEUE_COLLECTION}/${cleanupId}`), {
      schemaVersion: 2,
      ownerUid: input.uid,
      scope: input.scope,
      entityId: input.entityId,
      storagePath: path,
      source: input.source,
      requestedBy: input.requestedBy,
      state: "pending",
      attempts: 0,
      deletionVerified: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, {merge: true});
  });
};

const referencePath = (parsed: OwnedMediaPath): string => (
  parsed.scope === "profile"
    ? `users/${parsed.uid}`
    : `users/${parsed.uid}/${parsed.scope}/${parsed.entityId}`
);

const containsStoragePath = (value: unknown, path: string): boolean => {
  if (typeof value === "string") return storagePathFromValue(value) === path;
  if (Array.isArray(value)) return value.some((entry) => (
    containsStoragePath(entry, path)
  ));
  if (!value || typeof value !== "object") return false;
  return Object.values(value as Record<string, unknown>).some((entry) => (
    containsStoragePath(entry, path)
  ));
};

export const cleanupUserOwnedMedia = onDocumentWritten(
  {
    document: `${QUEUE_COLLECTION}/{cleanupId}`,
    region: REGION,
  },
  async (event) => {
    if (!event.data?.after.exists || event.data.after.get("state") !== "pending") {
      return;
    }
    const db = admin.firestore();
    const queueRef = event.data.after.ref;
    const claimed = await db.runTransaction(async (transaction) => {
      const current = await transaction.get(queueRef);
      if (!current.exists || current.get("state") !== "pending") return null;
      const parsed = parseOwnedMediaPath(
        current.get("storagePath"),
        asTrimmedString(current.get("ownerUid")),
        current.get("scope") as OwnedMediaScope,
        asTrimmedString(current.get("entityId"))
      );
      if (!parsed || parsed.uid !== current.get("ownerUid") ||
        parsed.scope !== current.get("scope") ||
        parsed.entityId !== current.get("entityId")) {
        transaction.update(queueRef, {
          state: "rejected",
          errorCode: "invalid-owned-path",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return null;
      }
      transaction.update(queueRef, {
        state: "processing",
        attempts: admin.firestore.FieldValue.increment(1),
        processingAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return parsed;
    });
    if (!claimed) return;

    try {
      const sourceRef = db.doc(referencePath(claimed));
      const source = await sourceRef.get();
      if (source.exists && containsStoragePath(source.data(), claimed.path)) {
        await queueRef.update({
          state: "blocked-reference",
          deletionVerified: false,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return;
      }
      const file = getStorage().bucket().file(claimed.path);
      await file.delete({ignoreNotFound: true});
      const [exists] = await file.exists();
      if (exists) throw new Error("storage-delete-not-verified");
      await queueRef.update({
        state: "completed",
        deletionVerified: true,
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        errorCode: admin.firestore.FieldValue.delete(),
      });
    } catch (error) {
      console.error("Task05 owned-media cleanup failed", {
        cleanupId: event.params.cleanupId,
        error,
      });
      await queueRef.update({
        state: "failed",
        deletionVerified: false,
        errorCode: error instanceof Error ? error.message : "unknown",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  }
);
