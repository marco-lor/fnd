import {createHash} from "crypto";

export const USER_DATA_SCHEMA_VERSION = 2 as const;
export const USER_DATA_OPERATION_TTL_DAYS = 30;
export const USER_SHELL_MAX_BYTES = 16 * 1024;
export const USER_STATE_MAX_BYTES = 64 * 1024;
export const USER_ITEM_MAX_BYTES = 256 * 1024;
export const USER_DATA_BUDGET_WARNING_RATIO = 0.8;
export const USER_DATA_OPERATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{7,79}$/;
export const USER_DATA_ROLLOUT_STAGES = [
  "legacy-read",
  "shadow-verify",
  "dual-write",
  "new-read-dual-write",
  "new-only",
] as const;

export type UserDataRolloutStage = typeof USER_DATA_ROLLOUT_STAGES[number];

export interface FirestoreTimestampValue {
  seconds: number;
  nanoseconds: number;
}

export interface UserDataLegacyDrainRecord {
  drainId: string;
  closedAt: FirestoreTimestampValue;
}

export interface UserDataLegacyDrainConfig {
  global?: UserDataLegacyDrainRecord;
  users?: Record<string, UserDataLegacyDrainRecord>;
}

export interface UserDataRolloutConfig {
  mode?: UserDataRolloutStage;
  stage?: UserDataRolloutStage;
  userOverrides?: Record<string, UserDataRolloutStage>;
  legacyDrain?: UserDataLegacyDrainConfig;
}

export interface UserDataRolloutResolution {
  stage: UserDataRolloutStage;
  scope: "global" | "user";
}

export const RESOURCE_FIELDS = [
  "gold",
  "hpCurrent",
  "hpTotal",
  "manaCurrent",
  "manaTotal",
  "essenzaCurrent",
  "essenzaTotal",
  "barrieraCurrent",
  "barrieraTotal",
  "shieldCurrent",
  "shieldTotal",
] as const;

export type ResourceName = "hp" | "mana" | "essenza" | "barriera";
export type UserDataCommandTargetPolicy =
  | "actor-only"
  | "request-user-or-actor";

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord => (
  value !== null && typeof value === "object" && !Array.isArray(value)
);

export const asRecord = (value: unknown): UnknownRecord => (
  isRecord(value) ? value : {}
);

export const asTrimmedString = (value: unknown): string => (
  typeof value === "string" ? value.trim() : ""
);

/**
 * Validates one Firestore document identifier, rather than a slash-delimited
 * document path. Firestore document IDs are UTF-8 strings no larger than
 * 1,500 bytes and cannot be the path sentinel values `.` or `..`.
 */
export const isValidFirestoreDocumentId = (value: unknown): boolean => {
  const candidate = asTrimmedString(value);
  return Boolean(candidate) &&
    candidate !== "." &&
    candidate !== ".." &&
    !candidate.includes("/") &&
    Buffer.byteLength(candidate, "utf8") <= 1500;
};

export const resolveUserDataCommandTargetUid = (
  actorUid: unknown,
  requestedUserId: unknown,
  policy: UserDataCommandTargetPolicy
): string => {
  const actor = asTrimmedString(actorUid);
  if (!isValidFirestoreDocumentId(actor)) return "";
  if (policy === "actor-only") return actor;
  const requested = asTrimmedString(requestedUserId);
  return requested
    ? (isValidFirestoreDocumentId(requested) ? requested : "")
    : actor;
};

export const asFiniteNumber = (value: unknown, fallback = 0): number => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const validateOperationId = (value: unknown): string => {
  const operationId = asTrimmedString(value);
  if (!USER_DATA_OPERATION_ID_PATTERN.test(operationId)) return "";
  return operationId;
};

export const resolveUserDataRollout = (
  config: unknown,
  uid = ""
): UserDataRolloutResolution => {
  const data = asRecord(config);
  const globalConfigured = asTrimmedString(data.mode ?? data.stage);
  const globalStage = USER_DATA_ROLLOUT_STAGES.includes(
    globalConfigured as UserDataRolloutStage
  ) ? globalConfigured as UserDataRolloutStage : "legacy-read";
  const override = asTrimmedString(
    uid ? asRecord(data.userOverrides)[uid] : undefined
  );
  return USER_DATA_ROLLOUT_STAGES.includes(override as UserDataRolloutStage)
    ? {stage: override as UserDataRolloutStage, scope: "user"}
    : {stage: globalStage, scope: "global"};
};

export const resolveUserDataRolloutStage = (
  config: unknown,
  uid = ""
): UserDataRolloutStage => resolveUserDataRollout(config, uid).stage;

export const writesLegacyUserProjection = (
  stage: UserDataRolloutStage
): boolean => stage !== "new-only";

export const hasAnyOwnField = (
  value: unknown,
  fields: readonly string[]
): boolean => Object.keys(asRecord(value)).some((key) => fields.includes(key));

const canonicalize = (value: unknown, inArray = false): unknown => {
  if (value === undefined) return inArray ? {$type: "undefined"} : undefined;
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (Number.isNaN(value)) return {$type: "number", value: "NaN"};
    if (value === Number.POSITIVE_INFINITY) {
      return {$type: "number", value: "Infinity"};
    }
    if (value === Number.NEGATIVE_INFINITY) {
      return {$type: "number", value: "-Infinity"};
    }
    if (Object.is(value, -0)) return {$type: "number", value: "-0"};
    return value;
  }
  if (typeof value === "bigint") {
    return {$type: "integer", value: value.toString()};
  }
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return {$type: "bytes", value: Buffer.from(value).toString("base64")};
  }
  if (value instanceof Date) return {$type: "timestamp", value: value.toISOString()};
  if (Array.isArray(value)) return value.map((entry) => canonicalize(entry, true));
  if (isRecord(value)) {
    const timestamp = value as {
      seconds?: unknown;
      nanoseconds?: unknown;
      toDate?: unknown;
    };
    if (
      typeof timestamp.toDate === "function" &&
      Number.isFinite(timestamp.seconds as number)
    ) {
      return {
        $type: "timestamp",
        seconds: String(timestamp.seconds),
        nanoseconds: Number(timestamp.nanoseconds || 0),
      };
    }
    const reference = value as {path?: unknown; firestore?: unknown};
    if (typeof reference.path === "string" && reference.firestore) {
      return {$type: "reference", path: reference.path};
    }
    const geopoint = value as {latitude?: unknown; longitude?: unknown};
    if (
      Number.isFinite(geopoint.latitude as number) &&
      Number.isFinite(geopoint.longitude as number)
    ) {
      return {
        $type: "geopoint",
        latitude: geopoint.latitude,
        longitude: geopoint.longitude,
      };
    }
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])])
        .filter(([, entry]) => entry !== undefined)
    );
  }
  return {};
};

export const stableJson = (value: unknown): string => (
  JSON.stringify(canonicalize(value)) ?? "{\"$type\":\"undefined\"}"
);

export const hashValue = (value: unknown): string => (
  createHash("sha256").update(stableJson(value)).digest("hex")
);

export const operationReceiptId = (
  actorUid: string,
  operationId: string
): string => hashValue([actorUid, operationId]).slice(0, 48);

export const operationRequestHash = (
  action: string,
  data: unknown
): string => hashValue({action, data});

export const isOperationExpired = (
  expiresAt: unknown,
  nowMillis = Date.now()
): boolean => {
  const value = expiresAt as {
    toMillis?: () => number;
    seconds?: unknown;
    nanoseconds?: unknown;
  } | null;
  if (!value) return false;
  const millis = typeof value.toMillis === "function"
    ? value.toMillis()
    : Number.isFinite(Number(value.seconds))
      ? Number(value.seconds) * 1000 + Number(value.nanoseconds || 0) / 1e6
      : Number.NaN;
  return Number.isFinite(millis) && millis <= nowMillis;
};

export interface DocumentBudgetResult {
  bytes: number;
  limit: number;
  warning: boolean;
  accepted: boolean;
}

export const evaluateDocumentBudget = (
  value: unknown,
  limit: number
): DocumentBudgetResult => {
  const bytes = Buffer.byteLength(stableJson(value), "utf8");
  return {
    bytes,
    limit,
    warning: bytes >= limit * USER_DATA_BUDGET_WARNING_RATIO,
    accepted: bytes <= limit,
  };
};

export const normalizeDisplayName = (value: unknown): string => (
  asTrimmedString(value)
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
);

export const exactNameKey = (value: unknown): string => (
  createHash("sha256").update(asTrimmedString(value)).digest("hex")
);

export const parseCatalogPrice = (value: unknown): number | null => {
  const parsed = typeof value === "number" ? value : Number.parseInt(
    asTrimmedString(value),
    10
  );
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : null;
};

export const canAccessCatalogItem = (
  item: unknown,
  uid: string,
  role: string
): boolean => {
  if (role === "dm") return true;
  const data = asRecord(item);
  const visibility = asTrimmedString(data.visibility) || "all";
  if (visibility === "all") return true;
  if (visibility !== "custom" || !Array.isArray(data.allowed_users)) {
    return false;
  }
  return data.allowed_users.some((candidate) => candidate === uid);
};

export const resolveResourceFields = (resource: ResourceName): {
  current: string;
  total: string;
} => ({
  current: `${resource}Current`,
  total: `${resource}Total`,
});

export const applyResourceMutation = (
  current: unknown,
  mode: "set" | "delta",
  value: unknown
): number | null => {
  const amount = asFiniteNumber(value, Number.NaN);
  if (!Number.isFinite(amount)) return null;
  return mode === "delta" ? asFiniteNumber(current) + amount : amount;
};

export const applyConsumableCap = (
  current: unknown,
  gain: unknown,
  total: unknown
): number => {
  const next = asFiniteNumber(current) + asFiniteNumber(gain);
  const maximum = asFiniteNumber(total);
  return maximum > 0 ? Math.min(maximum, next) : next;
};

export const resolveLevelThreshold = (level: unknown): string => {
  const normalized = Math.max(1, Math.trunc(asFiniteNumber(level, 1)));
  if (normalized >= 10) return "10";
  if (normalized >= 7) return "7";
  if (normalized >= 4) return "4";
  return "1";
};

export interface ConsumableRollPlan {
  resource: "hp" | "mana" | null;
  count: number;
  faces: number;
  modifier: number;
}

export const buildConsumableRollPlan = (
  item: unknown,
  resource: unknown,
  level: unknown,
  diceByLevel: unknown
): ConsumableRollPlan => {
  const normalizedResource = resource === "hp" || resource === "mana"
    ? resource
    : null;
  if (!normalizedResource) {
    return {resource: null, count: 0, faces: 0, modifier: 0};
  }

  const data = asRecord(item);
  const parameters = asRecord(data.Parametri);
  const special = asRecord(parameters.Special);
  const fieldName = normalizedResource === "hp"
    ? "Rigenera Dado Anima HP"
    : "Rigenera Dado Anima Mana";
  const levelValues = asRecord(special[fieldName]);
  const count = Math.max(0, Math.trunc(asFiniteNumber(
    levelValues[resolveLevelThreshold(level)]
  )));
  const specific = asRecord(data.Specific);
  const bonus = asFiniteNumber(specific["Bonus Creazione"]);
  const dice = Array.isArray(diceByLevel) ? diceByLevel : [];
  const numericLevel = Math.max(1, Math.trunc(asFiniteNumber(level, 1)));
  const label = asTrimmedString(dice[numericLevel] ?? dice[dice.length - 1]);
  const facesMatch = /^d(\d+)$/i.exec(label);
  const faces = facesMatch ? Number.parseInt(facesMatch[1], 10) : 10;

  return {
    resource: normalizedResource,
    count,
    faces,
    modifier: bonus * count,
  };
};

const pickFields = (source: UnknownRecord, keys: readonly string[]) => (
  Object.fromEntries(
    keys
      .filter((key) => source[key] !== undefined)
      .map((key) => [key, source[key]])
  )
);

const GRIGLIATA_SETTING_FIELDS = [
  "drawColorKey",
  "shareLiveInteractions",
  "grigliataMuted",
  "hiddenGrigliataBackgrounds",
  "hiddenGrigliataTokens",
] as const;

const USER_SHELL_FIELDS = [
  "email",
  "role",
  "username",
  "characterId",
  "race",
  "imageUrl",
  "imagePath",
  "created_at",
  "createdAt",
  "updated_at",
  "updatedAt",
  "flags",
  "deletionState",
  "deletionRequestedAt",
  "deletionRequestedBy",
  "modelVersion",
  "summary",
] as const;

export const buildUserShellProjection = (source: unknown): UnknownRecord => (
  pickFields(asRecord(source), USER_SHELL_FIELDS)
);

export interface LegacyDomainProjection {
  progression: UnknownRecord;
  resources: UnknownRecord;
  settings: UnknownRecord;
  equipment: UnknownRecord;
  profileContent: UnknownRecord;
}

export interface InventoryProjectionEntry {
  id: string;
  data: UnknownRecord;
}

export interface ProjectionMutationPlan {
  sets: InventoryProjectionEntry[];
  deletes: string[];
}

const projectedFieldsMatch = (
  existing: unknown,
  desired: UnknownRecord
): boolean => {
  const source = asRecord(existing);
  return Object.keys(desired).every((key) => (
    hashValue(source[key]) === hashValue(desired[key])
  ));
};

const legacyManagedProjectionMatches = (
  existing: unknown,
  desired: UnknownRecord
): boolean => {
  const payload = {...asRecord(existing)};
  [
    "legacySourceHash",
    "legacySourceUpdateTime",
    "updatedAt",
    "updatedBy",
  ].forEach((key) => delete payload[key]);
  return hashValue(payload) === hashValue(desired);
};

export const planLegacyManagedProjection = (
  existing: InventoryProjectionEntry[],
  desired: InventoryProjectionEntry[]
): ProjectionMutationPlan => {
  const existingById = new Map(existing.map((entry) => [entry.id, entry.data]));
  const desiredIds = new Set(desired.map(({id}) => id));
  const sets: InventoryProjectionEntry[] = [];
  desired.forEach(({id, data}) => {
    const current = existingById.get(id);
    if (!current) {
      sets.push({id, data: {...data, legacySourceHash: hashValue(data)}});
      return;
    }
    const currentData = asRecord(current);
    if (currentData.legacyManaged === false && currentData.acquisitionSnapshot) {
      const mutable = {
        kind: data.kind,
        quantity: data.quantity,
        catalogItemId: data.catalogItemId,
        currentSnapshot: data.currentSnapshot,
        currentHash: data.currentHash,
        displayName: data.displayName,
        normalizedName: data.normalizedName,
      };
      if (projectedFieldsMatch(currentData, mutable)) return;
      sets.push({
        id,
        data: {
          ...mutable,
          revision: Math.max(1, Math.trunc(asFiniteNumber(
            currentData.revision,
            1
          ))) + 1,
          currentRevision: Math.max(1, Math.trunc(asFiniteNumber(
            currentData.currentRevision,
            1
          ))) + 1,
          legacyManaged: false,
          legacySourceHash: hashValue(data),
        },
      });
      return;
    }
    if (currentData.legacyManaged === false) {
      const mutable = Object.fromEntries(Object.entries(data).filter(
        ([key]) => ![
          "migration",
          "legacyManaged",
          "revision",
        ].includes(key)
      ));
      if (projectedFieldsMatch(currentData, mutable)) return;
      sets.push({
        id,
        data: {
          ...mutable,
          revision: Math.max(1, Math.trunc(asFiniteNumber(
            currentData.revision,
            1
          ))) + 1,
          legacyManaged: false,
          legacySourceHash: hashValue(data),
        },
      });
      return;
    }
    if (!legacyManagedProjectionMatches(currentData, data)) {
      sets.push({id, data: {...data, legacySourceHash: hashValue(data)}});
    }
  });
  const deletes = existing
    .filter(({id, data}) => (
      asRecord(data).legacyManaged === true && !desiredIds.has(id)
    ))
    .map(({id}) => id);
  return {sets, deletes};
};

export interface LegacyInventoryBinding {
  index: number;
  unit: number;
  kind: string;
  quantity: number;
  projectedIds: string[];
}

export type LegacyInventoryResolution =
  | {ok: true; binding: LegacyInventoryBinding}
  | {ok: false; reason: string};

export interface LegacyInventoryMutationResult {
  ok: boolean;
  inventory?: unknown[];
  reason?: string;
}

const inventoryDocumentId = (
  requestedId: unknown,
  fingerprint: string,
  occurrence: number,
  unit: number
): string => {
  const instanceId = asTrimmedString(requestedId);
  if (/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(instanceId)) {
    return unit === 0 ? instanceId : `${instanceId}_${unit + 1}`;
  }
  return `legacy_${fingerprint.slice(0, 24)}_${occurrence + 1}_${unit + 1}`;
};

export const buildLegacyInventoryProjection = (
  inventory: unknown,
  equipped: unknown = null
): InventoryProjectionEntry[] => {
  const occurrences = new Map<string, number>();
  const usedIds = new Set<string>();
  const output: InventoryProjectionEntry[] = [];

  (Array.isArray(inventory) ? inventory : []).forEach((rawEntry, legacyIndex) => {
    const snapshot = isRecord(rawEntry)
      ? cloneWithoutUndefined(rawEntry) as UnknownRecord
      : {id: asTrimmedString(rawEntry), name: asTrimmedString(rawEntry)};
    const instance = asRecord(snapshot._instance);
    const itemType = asTrimmedString(
      snapshot.type ?? snapshot.item_type
    ).toLowerCase();
    const kind = itemType || "legacy";
    const isVarie = kind === "varie";
    const rawQuantity = Math.max(1, Math.trunc(asFiniteNumber(
      snapshot.quantity ?? snapshot.qty,
      1
    )));
    const units = isVarie ? 1 : rawQuantity;
    const quantity = isVarie ? rawQuantity : 1;
    const itemSnapshot = {...snapshot};
    delete itemSnapshot._instance;
    delete itemSnapshot.qty;
    delete itemSnapshot.quantity;
    const fingerprint = hashValue(itemSnapshot);
    const occurrence = occurrences.get(fingerprint) ?? 0;
    occurrences.set(fingerprint, occurrence + 1);

    for (let unit = 0; unit < units; unit += 1) {
      let id = inventoryDocumentId(
        instance.instanceId,
        fingerprint,
        occurrence,
        unit
      );
      let collision = 1;
      while (usedIds.has(id)) {
        collision += 1;
        id = `${inventoryDocumentId(
          "",
          fingerprint,
          occurrence,
          unit
        )}_${collision}`;
      }
      usedIds.add(id);

      const general = asRecord(itemSnapshot.General);
      const name = general.Nome ?? itemSnapshot.name ?? itemSnapshot.id;
      const catalogItemId = asTrimmedString(
        itemSnapshot.id ?? itemSnapshot.itemId
      );
      output.push({
        id,
        data: {
          schemaVersion: USER_DATA_SCHEMA_VERSION,
          revision: 1,
          kind,
          quantity,
          catalogItemId: catalogItemId || null,
          catalogVersion: instance.catalogVersion ?? null,
          acquisitionSnapshot: itemSnapshot,
          acquisitionHash: fingerprint,
          currentSnapshot: itemSnapshot,
          currentHash: fingerprint,
          currentRevision: 1,
          displayName: asTrimmedString(name),
          normalizedName: normalizeDisplayName(name),
          acquiredAt: instance.acquiredAt ?? null,
          pricePaid: asFiniteNumber(instance.pricePaid),
          source: asTrimmedString(instance.source) || "legacy",
          migration: {
            index: legacyIndex,
            unit,
            originalInstanceId: instance.instanceId ?? null,
          },
          legacyManaged: true,
        },
      });
    }
  });

  Object.entries(asRecord(equipped)).forEach(([slot, rawEntry]) => {
    if (!isRecord(rawEntry)) return;
    const instance = asRecord(rawEntry._instance);
    const requestedId = asTrimmedString(instance.instanceId);
    const itemSnapshot = {...rawEntry};
    delete itemSnapshot._instance;
    delete itemSnapshot.qty;
    delete itemSnapshot.quantity;
    const fingerprint = hashValue(itemSnapshot);
    const catalogItemId = asTrimmedString(
      itemSnapshot.id ?? itemSnapshot.itemId
    );
    const alreadyProjected = output.some(({id, data}) => (
      (requestedId && id === requestedId) ||
      (
        data.acquisitionHash === fingerprint &&
        (!catalogItemId || data.catalogItemId === catalogItemId)
      )
    ));
    if (alreadyProjected) return;

    let id = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(requestedId)
      ? requestedId
      : `preserved_${fingerprint.slice(0, 24)}_${normalizeDisplayName(slot)
        .replace(/[^a-z0-9]+/g, "_") || "slot"}`;
    let collision = 1;
    const baseId = id;
    while (usedIds.has(id)) {
      collision += 1;
      id = `${baseId}_${collision}`;
    }
    usedIds.add(id);
    const kind = asTrimmedString(
      itemSnapshot.type ?? itemSnapshot.item_type
    ).toLowerCase() || "legacy";
    const name = asRecord(itemSnapshot.General).Nome ??
      itemSnapshot.name ?? itemSnapshot.id;
    output.push({
      id,
      data: {
        schemaVersion: USER_DATA_SCHEMA_VERSION,
        revision: 1,
        kind,
        quantity: 1,
        catalogItemId: catalogItemId || null,
        catalogVersion: instance.catalogVersion ?? null,
        acquisitionSnapshot: itemSnapshot,
        acquisitionHash: fingerprint,
        currentSnapshot: itemSnapshot,
        currentHash: fingerprint,
        currentRevision: 1,
        displayName: asTrimmedString(name),
        normalizedName: normalizeDisplayName(name),
        acquiredAt: instance.acquiredAt ?? null,
        pricePaid: asFiniteNumber(instance.pricePaid),
        source: asTrimmedString(instance.source) || "legacy",
        migration: {
          unmatchedEquipmentSlot: slot,
          originalInstanceId: instance.instanceId ?? null,
        },
        legacyManaged: true,
      },
    });
  });

  return output;
};

const inventoryProjectionGroupKey = (data: unknown): string => {
  const source = asRecord(data);
  return hashValue({
    acquisitionHash: source.acquisitionHash,
    catalogItemId: source.catalogItemId ?? null,
    kind: source.kind,
  });
};

export const stabilizeLegacyInventoryProjection = (
  desired: InventoryProjectionEntry[],
  existing: InventoryProjectionEntry[],
  preferredIds: string[] = []
): InventoryProjectionEntry[] => {
  const preferred = new Set(preferredIds);
  const used = new Set(desired
    .filter(({data}) => asTrimmedString(
      asRecord(data.migration).originalInstanceId
    ))
    .map(({id}) => id));
  const candidates = new Map<string, InventoryProjectionEntry[]>();
  existing.forEach((entry) => {
    const data = asRecord(entry.data);
    if (
      data.legacyManaged !== true ||
      asTrimmedString(asRecord(data.migration).originalInstanceId)
    ) return;
    const key = inventoryProjectionGroupKey(data);
    const group = candidates.get(key) ?? [];
    group.push(entry);
    candidates.set(key, group);
  });
  candidates.forEach((group) => group.sort((left, right) => {
    const leftPreferred = preferred.has(left.id) ? 0 : 1;
    const rightPreferred = preferred.has(right.id) ? 0 : 1;
    return leftPreferred - rightPreferred || left.id.localeCompare(right.id);
  }));

  return desired.map((entry) => {
    if (asTrimmedString(asRecord(entry.data.migration).originalInstanceId)) {
      return entry;
    }
    const group = candidates.get(inventoryProjectionGroupKey(entry.data)) ?? [];
    const match = group.find((candidate) => !used.has(candidate.id));
    const id = match?.id ?? entry.id;
    if (used.has(id)) return entry;
    used.add(id);
    return {...entry, id};
  });
};

export const materializeLegacyInventoryIdentities = (
  inventory: unknown,
  projection = buildLegacyInventoryProjection(inventory)
): unknown[] => {
  const source = Array.isArray(inventory) ? inventory : [];
  const byIndex = new Map<number, InventoryProjectionEntry[]>();
  projection.forEach((entry) => {
    const index = Math.trunc(asFiniteNumber(
      asRecord(entry.data.migration).index,
      Number.NaN
    ));
    if (!Number.isInteger(index) || index < 0 || index >= source.length) return;
    const group = byIndex.get(index) ?? [];
    group.push(entry);
    byIndex.set(index, group);
  });
  const result: unknown[] = [];
  source.forEach((raw, index) => {
    const entries = (byIndex.get(index) ?? []).sort((left, right) => (
      asFiniteNumber(asRecord(left.data.migration).unit) -
      asFiniteNumber(asRecord(right.data.migration).unit)
    ));
    if (!entries.length) {
      result.push(cloneWithoutUndefined(raw));
      return;
    }
    const original = isRecord(raw)
      ? asRecord(raw)
      : {id: asTrimmedString(raw), name: asTrimmedString(raw)};
    const snapshot = {...original};
    const instance = asRecord(snapshot._instance);
    delete snapshot._instance;
    delete snapshot.qty;
    delete snapshot.quantity;
    const kind = asTrimmedString(entries[0].data.kind);
    if (kind === "varie") {
      result.push({
        ...snapshot,
        qty: Math.max(1, Math.trunc(asFiniteNumber(entries[0].data.quantity, 1))),
        _instance: {...instance, instanceId: entries[0].id},
      });
      return;
    }
    entries.forEach(({id}) => result.push({
      ...snapshot,
      qty: 1,
      _instance: {...instance, instanceId: id},
    }));
  });
  return result;
};

export interface LegacyContentProjection {
  ok: boolean;
  documents: InventoryProjectionEntry[];
  reservations: InventoryProjectionEntry[];
  reason?: string;
}

export interface LegacyContentIdentityPlan {
  ok: boolean;
  changed: boolean;
  content: unknown;
  projection: LegacyContentProjection;
  reason?: string;
}

const legacyContentLocation = (data: unknown): {
  legacyIndex: number;
  legacyKey: string;
} | null => {
  const migration = asRecord(asRecord(data).migration);
  const legacyIndex = Math.trunc(asFiniteNumber(
    migration.legacyIndex,
    Number.NaN
  ));
  if (!Number.isInteger(legacyIndex) || legacyIndex < 0) return null;
  return {
    legacyIndex,
    legacyKey: typeof migration.legacyKey === "string"
      ? migration.legacyKey
      : "",
  };
};

const normalizeContentDocumentId = (value: unknown): string => {
  const candidate = asTrimmedString(value);
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(candidate)
    ? candidate
    : "";
};

const contentEntries = (value: unknown): Array<[string, unknown]> => {
  if (Array.isArray(value)) {
    return value.map((entry, index) => [String(index), entry]);
  }
  return Object.entries(asRecord(value));
};

export const buildLegacyContentProjection = (
  kind: "spell" | "tecnica",
  legacyContent: unknown
): LegacyContentProjection => {
  const documents: InventoryProjectionEntry[] = [];
  const reservations: InventoryProjectionEntry[] = [];
  const usedIds = new Set<string>();
  const usedReservations = new Map<string, string>();

  for (const [legacyIndex, [legacyKey, rawValue]] of
    contentEntries(legacyContent).entries()) {
    const value = isRecord(rawValue)
      ? cloneWithoutUndefined(rawValue) as UnknownRecord
      : {value: cloneWithoutUndefined(rawValue)};
    const displayName = asTrimmedString(
      value.nome ?? value.name ??
      (Number.isInteger(Number(legacyKey)) ? "" : legacyKey)
    );
    if (!displayName) {
      return {
        ok: false,
        documents: [],
        reservations: [],
        reason: "missing-display-name",
      };
    }
    let contentId = normalizeContentDocumentId(value.id) ||
      `${kind}_${hashValue({
        displayName,
        legacyIndex,
        legacyKey,
        value,
      }).slice(0, 32)}`;
    if (usedIds.has(contentId)) {
      contentId = `${kind}_${hashValue({
        contentId,
        legacyIndex,
        legacyKey,
      }).slice(0, 32)}`;
    }
    usedIds.add(contentId);
    const reservationId = exactNameKey(`${kind}\0${displayName}`);
    const previousContentId = usedReservations.get(reservationId);
    if (previousContentId && previousContentId !== contentId) {
      return {
        ok: false,
        documents: [],
        reservations: [],
        reason: "duplicate-exact-name",
      };
    }
    usedReservations.set(reservationId, contentId);
    documents.push({
      id: contentId,
      data: {
        ...value,
        id: contentId,
        schemaVersion: USER_DATA_SCHEMA_VERSION,
        revision: 1,
        displayName,
        normalizedName: normalizeDisplayName(displayName),
        migration: {legacyIndex, legacyKey},
        legacyManaged: true,
      },
    });
    reservations.push({
      id: reservationId,
      data: {
        schemaVersion: USER_DATA_SCHEMA_VERSION,
        kind,
        contentId,
        exactName: displayName,
        legacyManaged: true,
      },
    });
  }
  return {ok: true, documents, reservations};
};

export const materializeLegacyContentIdentities = (
  legacyContent: unknown,
  projection: LegacyContentProjection
): unknown => {
  if (!projection.ok) return cloneWithoutUndefined(legacyContent);
  const idByLocation = new Map<string, string>();
  projection.documents.forEach(({id, data}) => {
    const migration = asRecord(data.migration);
    const legacyIndex = Math.trunc(asFiniteNumber(
      migration.legacyIndex,
      Number.NaN
    ));
    const legacyKey = typeof migration.legacyKey === "string"
      ? migration.legacyKey
      : "";
    if (Number.isInteger(legacyIndex) && legacyIndex >= 0) {
      idByLocation.set(`${legacyIndex}\0${legacyKey}`, id);
    }
  });
  const entries = contentEntries(legacyContent).map(
    ([legacyKey, rawValue], legacyIndex): [string, unknown] => {
      const contentId = idByLocation.get(`${legacyIndex}\0${legacyKey}`);
      if (!contentId) return [legacyKey, cloneWithoutUndefined(rawValue)];
      const value = isRecord(rawValue)
        ? cloneWithoutUndefined(rawValue) as UnknownRecord
        : {value: cloneWithoutUndefined(rawValue)};
      return [legacyKey, {...value, id: contentId}];
    }
  );
  return Array.isArray(legacyContent)
    ? entries.map(([, value]) => value)
    : (isRecord(legacyContent)
      ? Object.fromEntries(entries)
      : cloneWithoutUndefined(legacyContent));
};

/**
 * Reuses identities written by an earlier offline backfill when the legacy
 * root has not yet been stamped. Object keys are stable even when insertions,
 * deletions, or reordering change their legacy indexes. A positional reuse is
 * allowed only for an unchanged-size, structurally proven single object-key
 * rename. Every implicit array reuse is ambiguous and fails closed once prior
 * candidates exist. Explicit valid IDs remain authoritative.
 */
export const stabilizeLegacyContentProjection = (
  legacyContent: unknown,
  desired: LegacyContentProjection,
  existing: InventoryProjectionEntry[] = []
): LegacyContentProjection => {
  if (!desired.ok) return desired;
  const sourceEntries = contentEntries(legacyContent);
  const sourceIsArray = Array.isArray(legacyContent);
  const candidates = existing
    .filter(({id, data}) => (
      asRecord(data).legacyManaged === true &&
      Boolean(normalizeContentDocumentId(id)) &&
      Boolean(legacyContentLocation(data))
    ))
    .sort((left, right) => left.id.localeCompare(right.id));
  const usedIds = new Set<string>();
  const replacements = new Map<string, string>();
  const unresolved: number[] = [];
  let ambiguousExactMatch = false;
  const documents = desired.documents.map((entry, entryIndex) => {
    const location = legacyContentLocation(entry.data);
    const rawValue = location ? sourceEntries[location.legacyIndex]?.[1] : null;
    const explicitId = normalizeContentDocumentId(asRecord(rawValue).id);
    let id = entry.id;
    if (!explicitId && location) {
      const exactMatches = candidates.filter((candidate) => {
        const candidateLocation = legacyContentLocation(candidate.data);
        return !usedIds.has(candidate.id) &&
          candidateLocation?.legacyKey === location.legacyKey &&
          (!sourceIsArray ||
            candidateLocation.legacyIndex === location.legacyIndex);
      });
      if (exactMatches.length > 1) {
        ambiguousExactMatch = true;
        return entry;
      }
      if (exactMatches.length === 1) {
        id = exactMatches[0].id;
      } else {
        unresolved.push(entryIndex);
      }
    }
    if (usedIds.has(id)) return entry;
    usedIds.add(id);
    replacements.set(entry.id, id);
    return {
      id,
      data: {...entry.data, id},
    };
  });

  if (ambiguousExactMatch) {
    return {
      ok: false,
      documents: [],
      reservations: [],
      reason: "ambiguous-content-identity-shift",
    };
  }

  const implicitCount = desired.documents.filter((entry) => {
    const location = legacyContentLocation(entry.data);
    const rawValue = location ? sourceEntries[location.legacyIndex]?.[1] : null;
    return !normalizeContentDocumentId(asRecord(rawValue).id);
  }).length;
  if (sourceIsArray && candidates.length > 0 && implicitCount > 0) {
    return {
      ok: false,
      documents: [],
      reservations: [],
      reason: "ambiguous-content-identity-shift",
    };
  }

  const unusedCandidates = candidates.filter(({id}) => !usedIds.has(id));
  if (unresolved.length && unusedCandidates.length) {
    const isProvenSingleRename = !sourceIsArray &&
      unresolved.length === 1 &&
      unusedCandidates.length === 1 &&
      candidates.length === desired.documents.length;
    if (!isProvenSingleRename) {
      return {
        ok: false,
        documents: [],
        reservations: [],
        reason: "ambiguous-content-identity-shift",
      };
    }
    const documentIndex = unresolved[0];
    const previousId = documents[documentIndex].id;
    const reusedId = unusedCandidates[0].id;
    if (usedIds.has(reusedId)) {
      return {
        ok: false,
        documents: [],
        reservations: [],
        reason: "ambiguous-content-identity-shift",
      };
    }
    usedIds.delete(previousId);
    usedIds.add(reusedId);
    replacements.set(previousId, reusedId);
    documents[documentIndex] = {
      id: reusedId,
      data: {...documents[documentIndex].data, id: reusedId},
    };
  }
  const reservations = desired.reservations.map((entry) => ({
    ...entry,
    data: {
      ...entry.data,
      contentId: replacements.get(asTrimmedString(entry.data.contentId)) ??
        entry.data.contentId,
    },
  }));
  return {ok: true, documents, reservations};
};

export const planLegacyContentIdentityPersistence = (
  kind: "spell" | "tecnica",
  expectedContent: unknown,
  latestContent: unknown,
  existingContent: InventoryProjectionEntry[] = []
): LegacyContentIdentityPlan => {
  const projection = stabilizeLegacyContentProjection(
    expectedContent,
    buildLegacyContentProjection(kind, expectedContent),
    existingContent
  );
  if (hashValue(expectedContent) !== hashValue(latestContent)) {
    return {
      ok: false,
      changed: false,
      content: cloneWithoutUndefined(latestContent),
      projection,
      reason: "stale-source",
    };
  }
  if (!projection.ok) {
    return {
      ok: false,
      changed: false,
      content: cloneWithoutUndefined(expectedContent),
      projection,
      reason: projection.reason || "unsafe-projection",
    };
  }
  const content = materializeLegacyContentIdentities(
    expectedContent,
    projection
  );
  const stabilized = buildLegacyContentProjection(kind, content);
  const projectedIds = projection.documents.map(({id}) => id);
  const stabilizedIds = stabilized.documents.map(({id}) => id);
  if (!stabilized.ok || hashValue(projectedIds) !== hashValue(stabilizedIds)) {
    return {
      ok: false,
      changed: false,
      content: cloneWithoutUndefined(expectedContent),
      projection,
      reason: "identity-collision",
    };
  }
  return {
    ok: true,
    changed: hashValue(content) !== hashValue(expectedContent),
    content,
    projection: stabilized,
  };
};

export const buildLegacyEquipmentSlotProjection = (
  equipped: unknown,
  inventoryProjection: InventoryProjectionEntry[]
): UnknownRecord => {
  const usedFallbackIds = new Set<string>();
  return Object.fromEntries(Object.entries(asRecord(equipped)).map(
    ([slot, rawEntry]) => {
      if (rawEntry === null) return [slot, null];
      if (typeof rawEntry === "string") {
        const direct = inventoryProjection.find(({id}) => id === rawEntry);
        const catalogMatch = inventoryProjection.find(({id, data}) => (
          !usedFallbackIds.has(id) && data.catalogItemId === rawEntry
        ));
        const resolved = direct ?? catalogMatch;
        if (resolved) usedFallbackIds.add(resolved.id);
        return [slot, resolved?.id ?? null];
      }
      const entry = asRecord(rawEntry);
      const instanceId = asTrimmedString(asRecord(entry._instance).instanceId);
      const exactInstance = inventoryProjection.find(({id}) => id === instanceId);
      if (exactInstance) return [slot, exactInstance.id];

      const itemSnapshot = {...entry};
      delete itemSnapshot._instance;
      delete itemSnapshot.qty;
      delete itemSnapshot.quantity;
      const fingerprint = hashValue(itemSnapshot);
      const catalogItemId = asTrimmedString(
        itemSnapshot.id ?? itemSnapshot.itemId
      );
      const candidate = inventoryProjection.find(({id, data}) => (
        !usedFallbackIds.has(id) &&
        data.acquisitionHash === fingerprint &&
        (!catalogItemId || data.catalogItemId === catalogItemId)
      ));
      if (!candidate) return [slot, null];
      usedFallbackIds.add(candidate.id);
      return [slot, candidate.id];
    }
  ));
};

export const resolveLegacyInventoryBinding = (
  inventory: unknown,
  inventoryId: string,
  v2Data: unknown
): LegacyInventoryResolution => {
  const entries = Array.isArray(inventory) ? inventory : [];
  const projection = buildLegacyInventoryProjection(entries);
  let matches = projection.filter(({id}) => id === inventoryId);
  const expectedMigration = asRecord(asRecord(v2Data).migration);
  if (!matches.length && expectedMigration.index !== undefined &&
    expectedMigration.unit !== undefined) {
    const expectedIndex = Math.trunc(asFiniteNumber(
      expectedMigration.index,
      Number.NaN
    ));
    const expectedUnit = Math.trunc(asFiniteNumber(
      expectedMigration.unit,
      Number.NaN
    ));
    matches = projection.filter(({data}) => {
      const migration = asRecord(data.migration);
      return migration.index === expectedIndex && migration.unit === expectedUnit;
    });
    const expectedHash = asTrimmedString(asRecord(v2Data).acquisitionHash);
    if (expectedHash && matches.some(({data}) => (
      data.acquisitionHash !== expectedHash
    ))) {
      return {ok: false, reason: "acquisition-hash-mismatch"};
    }
  }
  if (matches.length !== 1) {
    return {ok: false, reason: matches.length ? "ambiguous-id" : "id-not-found"};
  }
  const match = matches[0];
  const migration = asRecord(match.data.migration);
  const index = Math.trunc(asFiniteNumber(migration.index, Number.NaN));
  const unit = Math.trunc(asFiniteNumber(migration.unit, Number.NaN));
  if (
    !Number.isInteger(index) || index < 0 || index >= entries.length ||
    !Number.isInteger(unit) || unit < 0
  ) {
    return {ok: false, reason: "invalid-position"};
  }

  if (
    expectedMigration.index !== undefined &&
    Math.trunc(asFiniteNumber(expectedMigration.index, Number.NaN)) !== index
  ) {
    return {ok: false, reason: "migration-index-mismatch"};
  }
  if (
    expectedMigration.unit !== undefined &&
    Math.trunc(asFiniteNumber(expectedMigration.unit, Number.NaN)) !== unit
  ) {
    return {ok: false, reason: "migration-unit-mismatch"};
  }
  const v2Kind = asTrimmedString(asRecord(v2Data).kind);
  if (v2Kind && v2Kind !== match.data.kind) {
    return {ok: false, reason: "kind-mismatch"};
  }
  const v2CatalogItemId = asTrimmedString(asRecord(v2Data).catalogItemId);
  const projectedCatalogItemId = asTrimmedString(match.data.catalogItemId);
  if (v2CatalogItemId && v2CatalogItemId !== projectedCatalogItemId) {
    return {ok: false, reason: "catalog-id-mismatch"};
  }

  const siblings = projection.filter(({data}) => (
    asRecord(data.migration).index === index
  ));
  if (!siblings.some(({data}) => asRecord(data.migration).unit === unit)) {
    return {ok: false, reason: "position-mismatch"};
  }
  const raw = asRecord(entries[index]);
  return {
    ok: true,
    binding: {
      index,
      unit,
      kind: asTrimmedString(match.data.kind),
      quantity: Math.max(1, Math.trunc(asFiniteNumber(
        raw.qty ?? raw.quantity,
        1
      ))),
      projectedIds: siblings
        .sort((left, right) => (
          asFiniteNumber(asRecord(left.data.migration).unit) -
          asFiniteNumber(asRecord(right.data.migration).unit)
        ))
        .map(({id, data}) => (
          asRecord(data.migration).unit === unit ? inventoryId : id
        )),
    },
  };
};

export const removeLegacyInventoryDocuments = (
  inventory: unknown,
  v2Documents: Record<string, unknown>
): LegacyInventoryMutationResult => {
  const baseProjection = buildLegacyInventoryProjection(inventory);
  const groups = new Map<number, {
    binding: LegacyInventoryBinding;
    removedIds: Set<string>;
  }>();
  for (const [inventoryId, v2Data] of Object.entries(v2Documents)) {
    const resolution = resolveLegacyInventoryBinding(
      inventory,
      inventoryId,
      v2Data
    );
    if (!resolution.ok) return resolution;
    const existing = groups.get(resolution.binding.index);
    if (existing && existing.binding.kind !== resolution.binding.kind) {
      return {ok: false, reason: "ambiguous-category"};
    }
    const group = existing ?? {
      binding: resolution.binding,
      removedIds: new Set<string>(),
    };
    group.removedIds.add(inventoryId);
    groups.set(resolution.binding.index, group);
  }
  const overrides = new Map<string, string>();
  groups.forEach((group) => group.removedIds.forEach((inventoryId) => {
    const binding = resolveLegacyInventoryBinding(
      inventory,
      inventoryId,
      v2Documents[inventoryId]
    );
    if (binding.ok) {
      overrides.set(`${binding.binding.index}:${binding.binding.unit}`, inventoryId);
    }
  }));
  const identityProjection = baseProjection.map((entry) => {
    const migration = asRecord(entry.data.migration);
    const override = overrides.get(`${migration.index}:${migration.unit}`);
    return override ? {...entry, id: override} : entry;
  });
  const removedIds = new Set(Object.keys(v2Documents));
  const entries = materializeLegacyInventoryIdentities(
    inventory,
    identityProjection
  ).filter((entry) => !removedIds.has(asTrimmedString(
    asRecord(asRecord(entry)._instance).instanceId
  )));
  return {ok: true, inventory: entries};
};

export const updateLegacyInventoryQuantity = (
  inventory: unknown,
  inventoryId: string,
  v2Data: unknown,
  quantity: number
): LegacyInventoryMutationResult => {
  const resolution = resolveLegacyInventoryBinding(
    inventory,
    inventoryId,
    v2Data
  );
  if (!resolution.ok) return resolution;
  if (
    resolution.binding.kind !== "varie" ||
    resolution.binding.projectedIds.length !== 1
  ) {
    return {ok: false, reason: "ambiguous-quantity-target"};
  }
  const projection = buildLegacyInventoryProjection(inventory).map((entry) => {
    const migration = asRecord(entry.data.migration);
    return migration.index === resolution.binding.index &&
      migration.unit === resolution.binding.unit
      ? {...entry, id: inventoryId}
      : entry;
  });
  const entries = materializeLegacyInventoryIdentities(inventory, projection);
  const index = entries.findIndex((entry) => asTrimmedString(
    asRecord(asRecord(entry)._instance).instanceId
  ) === inventoryId);
  if (index < 0) return {ok: false, reason: "materialized-id-not-found"};
  entries[index] = {
    ...asRecord(entries[index]),
    qty: quantity,
  };
  return {ok: true, inventory: entries};
};

export const replaceLegacyInventorySnapshot = (
  inventory: unknown,
  inventoryId: string,
  v2Data: unknown,
  snapshot: unknown
): LegacyInventoryMutationResult => {
  const resolution = resolveLegacyInventoryBinding(
    inventory,
    inventoryId,
    v2Data
  );
  if (!resolution.ok) return resolution;
  const projection = buildLegacyInventoryProjection(inventory).map((entry) => {
    const migration = asRecord(entry.data.migration);
    return migration.index === resolution.binding.index &&
      migration.unit === resolution.binding.unit
      ? {...entry, id: inventoryId}
      : entry;
  });
  const entries = materializeLegacyInventoryIdentities(inventory, projection);
  const index = entries.findIndex((entry) => asTrimmedString(
    asRecord(asRecord(entry)._instance).instanceId
  ) === inventoryId);
  if (index < 0) return {ok: false, reason: "materialized-id-not-found"};
  const original = asRecord(entries[index]);
  entries[index] = {
    ...asRecord(snapshot),
    _instance: {
      ...asRecord(original._instance),
      instanceId: inventoryId,
    },
  };
  return {ok: true, inventory: entries};
};

export const buildLegacyDomainProjection = (
  source: unknown
): LegacyDomainProjection => {
  const root = asRecord(source);
  const stats = asRecord(root.stats);
  const settings = asRecord(root.settings);
  const inventoryProjection = buildLegacyInventoryProjection(
    root.inventory,
    root.equipped
  );
  const progressionStats = {...stats};
  RESOURCE_FIELDS.forEach((field) => delete progressionStats[field]);
  delete progressionStats.barriera;
  const resourceStats = pickFields(stats, RESOURCE_FIELDS);
  if (stats.barriera !== undefined) {
    if (resourceStats.barrieraCurrent === undefined) {
      resourceStats.barrieraCurrent = stats.barriera;
    }
    if (resourceStats.barrieraTotal === undefined) {
      resourceStats.barrieraTotal = stats.barriera;
    }
  }
  return {
    progression: {
      schemaVersion: USER_DATA_SCHEMA_VERSION,
      revision: 1,
      stats: progressionStats,
      Parametri: asRecord(root.Parametri),
      AltriParametri: asRecord(root.AltriParametri),
      flags: asRecord(root.flags),
    },
    resources: {
      schemaVersion: USER_DATA_SCHEMA_VERSION,
      revision: 1,
      stats: resourceStats,
      active_turn_effect: root.active_turn_effect ?? null,
    },
    settings: {
      schemaVersion: USER_DATA_SCHEMA_VERSION,
      revision: 1,
      settings,
      parameterLocks: asRecord(root.parameterLocks),
      paramLocks: asRecord(root.paramLocks),
      grigliata: pickFields(root, GRIGLIATA_SETTING_FIELDS),
    },
    equipment: {
      schemaVersion: USER_DATA_SCHEMA_VERSION,
      revision: 1,
      slots: buildLegacyEquipmentSlotProjection(
        root.equipped,
        inventoryProjection
      ),
      beltCapacity: asFiniteNumber(
        asRecord(asRecord(asRecord(root.equipped).cintura).Specific)
          .slotCintura ?? root.beltCapacity ?? root.slotCintura,
        0
      ),
    },
    profileContent: {
      schemaVersion: USER_DATA_SCHEMA_VERSION,
      revision: 1,
      lingue: asRecord(root.lingue),
      conoscenze: asRecord(root.conoscenze),
      professioni: asRecord(root.professioni),
    },
  };
};

export const cloneWithoutUndefined = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(cloneWithoutUndefined);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .map(([key, entry]) => [key, cloneWithoutUndefined(entry)])
  );
};

export const deepMergeRecords = (
  base: unknown,
  patch: unknown
): UnknownRecord => {
  const output: UnknownRecord = {...asRecord(base)};
  Object.entries(asRecord(patch)).forEach(([key, value]) => {
    const previous = output[key];
    output[key] = isRecord(previous) && isRecord(value)
      ? deepMergeRecords(previous, value)
      : cloneWithoutUndefined(value);
  });
  return output;
};

export const deriveParameterTotals = (value: unknown): UnknownRecord => {
  const parametri = deepMergeRecords({}, value);
  ["Base", "Combattimento", "Special"].forEach((groupName) => {
    Object.values(asRecord(parametri[groupName])).forEach((stat) => {
      if (!isRecord(stat)) return;
      stat.Tot = asFiniteNumber(stat.Base) +
        asFiniteNumber(stat.Anima) +
        asFiniteNumber(stat.Equip) +
        asFiniteNumber(stat.Mod);
    });
  });
  return parametri;
};

export const deriveAnimaParameters = (input: {
  parametri: unknown;
  altriParametri: unknown;
  level: unknown;
  utils: unknown;
}): UnknownRecord => {
  const parametri = deepMergeRecords({}, input.parametri);
  const altri = asRecord(input.altriParametri);
  const utils = asRecord(input.utils);
  const level = Math.max(1, Math.trunc(asFiniteNumber(input.level, 1)));
  const baseAccum: UnknownRecord = {};
  const combatAccum: UnknownRecord = {};
  const modAnima = asRecord(utils.modAnima);
  const levelUpBonus = asRecord(utils.levelUpAnimaBonus);
  [
    {key: "Anima_1", start: 2, end: 4},
    {key: "Anima_4", start: 5, end: 7},
    {key: "Anima_7", start: 8, end: 10},
  ].forEach(({key, start, end}) => {
    const name = asTrimmedString(altri[key]);
    if (!name) return;
    Object.entries(asRecord(modAnima[name])).forEach(([stat, bonus]) => {
      baseAccum[stat] = asFiniteNumber(baseAccum[stat]) + asFiniteNumber(bonus);
    });
    if (level < start) return;
    const levels = Math.min(level, end) - (start - 1);
    Object.entries(asRecord(levelUpBonus[name])).forEach(([stat, bonus]) => {
      combatAccum[stat] = asFiniteNumber(combatAccum[stat]) +
        asFiniteNumber(bonus) * levels;
    });
  });
  Object.entries(asRecord(parametri.Base)).forEach(([name, stat]) => {
    if (!isRecord(stat)) return;
    stat.Anima = asFiniteNumber(baseAccum[name]) +
      asFiniteNumber(combatAccum[name]);
  });
  Object.entries(asRecord(parametri.Combattimento)).forEach(([name, stat]) => {
    if (!isRecord(stat)) return;
    stat.Anima = asFiniteNumber(combatAccum[name]);
  });
  return deriveParameterTotals(parametri);
};

/**
 * Recomputes Anima from the latest root snapshot but returns only leaf updates.
 * This lets the legacy Anima trigger coexist with the Tot trigger regardless
 * of delivery order without replacing unrelated Parametri fields.
 */
export const buildAnimaModifierFieldUpdate = (
  source: unknown,
  utils: unknown
): UnknownRecord => {
  const root = asRecord(source);
  const currentParametri = asRecord(root.Parametri);
  const derived = deriveAnimaParameters({
    parametri: currentParametri,
    altriParametri: root.AltriParametri,
    level: asRecord(root.stats).level,
    utils,
  });
  const update: UnknownRecord = {};
  ["Base", "Combattimento"].forEach((groupName) => {
    const currentGroup = asRecord(currentParametri[groupName]);
    Object.entries(asRecord(derived[groupName])).forEach(([name, value]) => {
      const nextAnima = asFiniteNumber(asRecord(value).Anima);
      if (asRecord(currentGroup[name]).Anima !== nextAnima) {
        update[`Parametri.${groupName}.${name}.Anima`] = nextAnima;
      }
    });
  });
  return update;
};

export const deriveResourceTotals = (input: {
  parametri: unknown;
  level: unknown;
  utils: unknown;
}): UnknownRecord => {
  const parametri = asRecord(input.parametri);
  const level = Math.max(1, Math.trunc(asFiniteNumber(input.level, 1)));
  const utils = asRecord(input.utils);
  const salute = asFiniteNumber(
    asRecord(asRecord(parametri.Combattimento).Salute).Tot,
    Number.NaN
  );
  const disciplina = asFiniteNumber(
    asRecord(asRecord(parametri.Combattimento).Disciplina).Tot,
    Number.NaN
  );
  const result: UnknownRecord = {};
  if (Number.isFinite(salute) && salute !== 0) {
    const multiplier = asFiniteNumber(
      asRecord(utils.hpMultByLevel)[String(level)],
      5
    ) || 5;
    result.hpTotal = multiplier * salute + 8;
  }
  if (Number.isFinite(disciplina) && disciplina !== 0) {
    const multiplier = asFiniteNumber(
      asRecord(utils.manaMultByLevel)[String(level)],
      7
    ) || 7;
    result.manaTotal = multiplier * disciplina + 5;
  }
  return result;
};

export const buildLegacyEquippedSnapshot = (
  slots: unknown,
  inventoryById: unknown
): UnknownRecord => {
  const inventory = asRecord(inventoryById);
  return Object.fromEntries(Object.entries(asRecord(slots)).map(
    ([slot, value]) => {
      const id = asTrimmedString(value);
      return [slot, id ? {
        ...asRecord(inventory[id]),
        _instance: {instanceId: id},
      } : null];
    }
  ));
};

const EQUIPMENT_SLOT_LABELS: Record<string, string> = {
  headArmor: "Testa",
  chestArmor: "Corpo",
  cintura: "Cintura",
  stivali: "Stivali",
  weaponMain: "Mano Principale",
  weaponOff: "Mano Secondaria",
  foderoArma: "Fodero",
  accessorio: "Accessorio",
};

const itemSlotValues = (item: unknown): string[] => {
  const slot = asRecord(asRecord(item).General).Slot;
  if (Array.isArray(slot)) return slot.map(asTrimmedString).filter(Boolean);
  const normalized = asTrimmedString(slot);
  return normalized ? [normalized] : [];
};

const normalizedWeaponSlot = (slot: string): {
  allowed: string[];
  twoHanded: boolean;
} => {
  const normalized = slot.trim().toLowerCase();
  const isTwoHanded = (
    (normalized.includes("doppia") && normalized.includes("mano")) ||
    (normalized.includes("due") && /man[oi]/.test(normalized))
  );
  if (isTwoHanded) {
    return {
      allowed: ["Mano Principale", "Mano Secondaria"],
      twoHanded: true,
    };
  }
  const isInterchangeable = /mano\s+principale/.test(normalized) &&
    /secondaria/.test(normalized);
  if (isInterchangeable) {
    return {
      allowed: ["Mano Principale", "Mano Secondaria"],
      twoHanded: false,
    };
  }
  return {allowed: [slot.trim()], twoHanded: false};
};

export const isTwoHandedEquipmentItem = (item: unknown): boolean => {
  const data = asRecord(item);
  const hands = asFiniteNumber(
    asRecord(data.Specific).Hands ?? data.hands ?? data.Hands,
    Number.NaN
  );
  return hands === 2 || itemSlotValues(item).some((slot) => (
    normalizedWeaponSlot(slot).twoHanded
  ));
};

export const isItemCompatibleWithEquipmentSlot = (
  item: unknown,
  slot: string
): boolean => {
  const label = /^beltC\d+$/.test(slot)
    ? "Consumabile"
    : EQUIPMENT_SLOT_LABELS[slot];
  if (!label) return false;
  return itemSlotValues(item).some((rawSlot) => (
    normalizedWeaponSlot(rawSlot).allowed.includes(label)
  ));
};

const parameterValue = (parametri: UnknownRecord, variable: string): number => {
  const base = asRecord(asRecord(parametri.Base)[variable]);
  const combat = asRecord(asRecord(parametri.Combattimento)[variable]);
  const baseTotal = asFiniteNumber(base.Tot) - asFiniteNumber(base.Equip);
  const combatTotal = asFiniteNumber(combat.Tot) - asFiniteNumber(combat.Equip);
  return baseTotal + combatTotal;
};

const evaluateEquipmentFormula = (
  raw: unknown,
  parametri: UnknownRecord
): number => {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : 0;
  const source = asTrimmedString(raw);
  if (!source || /\b\d+d\d+\b/i.test(source)) return 0;
  if (!/[+\-*/()]|\bMAX\b|\bMIN\b|[A-Za-z]/i.test(source)) {
    return asFiniteNumber(source);
  }
  let formula = source;
  const replaceFunction = (name: "MAX" | "MIN"): void => {
    const matcher = new RegExp(`${name}\\(([^()]*)\\)`, "gi");
    let previous = "";
    while (formula !== previous && matcher.test(formula)) {
      previous = formula;
      formula = formula.replace(matcher, (_match, inner: string) => {
        const values = inner.split(/[;,]/).map((part) => (
          evaluateEquipmentFormula(part, parametri)
        ));
        return String(name === "MAX" ? Math.max(...values) : Math.min(...values));
      });
      matcher.lastIndex = 0;
    }
  };
  replaceFunction("MAX");
  replaceFunction("MIN");
  formula = formula.replace(/\b([A-Za-z]+)\b/g, (_match, variable) => (
    String(parameterValue(parametri, variable))
  ));
  if (!/^[0-9+\-*/().\s]+$/.test(formula)) return 0;
  try {
    // The strict character allowlist above excludes identifiers and property
    // access; this evaluates arithmetic only.
    // eslint-disable-next-line no-new-func
    const result = Function(`"use strict"; return (${formula});`)();
    return Number.isFinite(result) ? result : 0;
  } catch {
    return 0;
  }
};

export interface EquipmentTransition {
  ok: boolean;
  error?: string;
  slots: UnknownRecord;
  beltCapacity: number;
  parametri: UnknownRecord;
}

export const deriveEquipmentTransition = (input: {
  slots: unknown;
  inventoryById: unknown;
  slot: string;
  inventoryId: string | null;
  parametri: unknown;
  level: unknown;
}): EquipmentTransition => {
  const inventory = asRecord(input.inventoryById);
  const slots: UnknownRecord = {...asRecord(input.slots)};
  const item = input.inventoryId ? inventory[input.inventoryId] : null;
  if (input.inventoryId && !isRecord(item)) {
    return {ok: false, error: "inventory-not-found", slots, beltCapacity: 0,
      parametri: asRecord(input.parametri)};
  }
  if (item && !isItemCompatibleWithEquipmentSlot(item, input.slot)) {
    return {ok: false, error: "incompatible-slot", slots, beltCapacity: 0,
      parametri: asRecord(input.parametri)};
  }
  slots[input.slot] = input.inventoryId;

  const occupiedIds = Object.values(slots).map(asTrimmedString).filter(Boolean);
  if (new Set(occupiedIds).size !== occupiedIds.length) {
    return {ok: false, error: "duplicate-inventory-reference", slots,
      beltCapacity: 0, parametri: asRecord(input.parametri)};
  }

  const mainItem = asTrimmedString(slots.weaponMain)
    ? inventory[asTrimmedString(slots.weaponMain)]
    : null;
  const offItem = asTrimmedString(slots.weaponOff)
    ? inventory[asTrimmedString(slots.weaponOff)]
    : null;
  if (
    mainItem && offItem &&
    (isTwoHandedEquipmentItem(mainItem) || isTwoHandedEquipmentItem(offItem))
  ) {
    return {ok: false, error: "two-handed-conflict", slots, beltCapacity: 0,
      parametri: asRecord(input.parametri)};
  }

  const beltItem = asTrimmedString(slots.cintura)
    ? asRecord(inventory[asTrimmedString(slots.cintura)])
    : {};
  const rawCapacity = Math.trunc(asFiniteNumber(
    asRecord(beltItem.Specific).slotCintura,
    0
  ));
  const beltCapacity = rawCapacity === 99 ? 99 : Math.max(0, rawCapacity);
  if (beltCapacity !== 99) {
    Object.keys(slots).forEach((key) => {
      const match = /^beltC(\d+)$/.exec(key);
      if (match && Number.parseInt(match[1], 10) > beltCapacity) {
        slots[key] = null;
      }
    });
  }

  const formulaParametri = deepMergeRecords({}, input.parametri);
  const parametri = deepMergeRecords({}, input.parametri);
  ["Base", "Combattimento", "Special"].forEach((groupName) => {
    const group = asRecord(parametri[groupName]);
    Object.values(group).forEach((stat) => {
      if (isRecord(stat)) stat.Equip = 0;
    });
  });
  const levelKey = resolveLevelThreshold(input.level);
  Object.values(slots).forEach((value) => {
    const equippedItem = inventory[asTrimmedString(value)];
    if (!isRecord(equippedItem)) return;
    const itemParameters = asRecord(equippedItem.Parametri);
    ["Base", "Combattimento", "Special"].forEach((groupName) => {
      const sourceGroup = asRecord(itemParameters[groupName]);
      const targetGroup = asRecord(parametri[groupName]);
      Object.entries(sourceGroup).forEach(([statName, levels]) => {
        const raw = asRecord(levels)[levelKey];
        const contribution = evaluateEquipmentFormula(raw, formulaParametri);
        if (!contribution) return;
        const targetStat = asRecord(targetGroup[statName]);
        targetStat.Equip = asFiniteNumber(targetStat.Equip) + contribution;
        targetGroup[statName] = targetStat;
      });
      parametri[groupName] = targetGroup;
    });
  });
  ["Base", "Combattimento", "Special"].forEach((groupName) => {
    Object.values(asRecord(parametri[groupName])).forEach((stat) => {
      if (!isRecord(stat)) return;
      stat.Tot = asFiniteNumber(stat.Base) +
        asFiniteNumber(stat.Anima) +
        asFiniteNumber(stat.Equip) +
        asFiniteNumber(stat.Mod);
    });
  });
  return {ok: true, slots, beltCapacity, parametri};
};
