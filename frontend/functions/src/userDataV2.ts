import {createHash} from "crypto";

export const USER_DATA_SCHEMA_VERSION = 2 as const;
export const USER_DATA_OPERATION_TTL_DAYS = 30;
export const USER_SHELL_MAX_BYTES = 16 * 1024;
export const USER_STATE_MAX_BYTES = 64 * 1024;
export const USER_ITEM_MAX_BYTES = 256 * 1024;
export const USER_DATA_BUDGET_WARNING_RATIO = 0.8;
export const USER_DATA_OPERATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{7,79}$/;
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
export interface AdminUserListPagination {
  cursor: string | null;
  limit: number;
}

export interface AdminUserListItem {
  id: string;
  characterId: string;
  username: string;
  email: string;
  role: string;
}

export const normalizeAdminUserListPagination = (
  input: unknown
): AdminUserListPagination => {
  const data = asRecord(input);
  const limit = data.limit === undefined ? 100 : data.limit;
  if (typeof limit !== "number" || !Number.isInteger(limit) ||
    limit < 1 || limit > 100) {
    throw new TypeError("limit must be an integer from 1 to 100.");
  }
  if (data.cursor === undefined) return {cursor: null, limit};
  const cursor = asTrimmedString(data.cursor);
  if (!isValidFirestoreDocumentId(cursor)) {
    throw new TypeError("cursor must be a valid user document ID.");
  }
  return {cursor, limit};
};

export const canListPrivateUserLabels = (role: unknown): boolean => (
  asTrimmedString(role).toLowerCase() === "webmaster"
);

export const buildAdminUserListItem = (
  documentId: unknown,
  source: unknown
): AdminUserListItem => {
  const id = asTrimmedString(documentId);
  if (!isValidFirestoreDocumentId(id)) {
    throw new TypeError("A valid user document ID is required.");
  }
  const data = asRecord(source);
  return {
    id,
    characterId: asTrimmedString(data.characterId),
    username: asTrimmedString(data.username),
    email: asTrimmedString(data.email),
    role: asTrimmedString(data.role).toLowerCase(),
  };
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

export const normalizeResourceTotalValue = (value: unknown): number | null => {
  const total = asFiniteNumber(value, Number.NaN);
  return Number.isFinite(total) && total >= 0 ? total : null;
};

export interface TurnEffectConsumption {
  changed: boolean;
  effects: UnknownRecord;
  barrierExpired: boolean;
}

export const consumeActiveTurnEffects = (
  source: unknown
): TurnEffectConsumption => {
  const effects = asRecord(source);
  let changed = false;
  const nextEffects = Object.fromEntries(Object.entries(effects).map(
    ([key, value]) => {
      const effect = asRecord(value);
      const remaining = typeof effect.remainingTurns === "number" &&
        Number.isFinite(effect.remainingTurns)
        ? effect.remainingTurns
        : null;
      if (remaining === null) return [key, value];
      const nextRemaining = Math.max(0, remaining - 1);
      if (nextRemaining !== remaining) changed = true;
      return [key, {...effect, remainingTurns: nextRemaining}];
    }
  ));
  const barrier = asRecord(nextEffects.barriera);
  const barrierExpired = asFiniteNumber(
    barrier.totalTurns,
    0
  ) > 0 && asFiniteNumber(barrier.remainingTurns, 0) <= 0;
  if (barrierExpired) {
    nextEffects.barriera = {
      ...barrier,
      remainingTurns: 0,
      totalTurns: 0,
    };
  }
  return {
    changed,
    effects: nextEffects,
    barrierExpired,
  };
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

export interface InitialUserDomainProjection {
  progression: UnknownRecord;
  resources: UnknownRecord;
  settings: UnknownRecord;
  equipment: UnknownRecord;
  profileContent: UnknownRecord;
}

const initialEquipmentSlotIds = (value: unknown): UnknownRecord => (
  Object.fromEntries(Object.entries(asRecord(value)).map(([slot, entry]) => {
    if (typeof entry === "string") return [slot, asTrimmedString(entry) || null];
    const instanceId = asTrimmedString(asRecord(asRecord(entry)._instance).instanceId);
    return [slot, instanceId || null];
  }))
);

export const buildInitialUserDomainProjection = (
  source: unknown
): InitialUserDomainProjection => {
  const root = asRecord(source);
  const stats = asRecord(root.stats);
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
  const equipped = asRecord(root.equipped);
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
      settings: asRecord(root.settings),
      parameterLocks: asRecord(root.parameterLocks),
      paramLocks: asRecord(root.paramLocks),
      grigliata: pickFields(root, GRIGLIATA_SETTING_FIELDS),
    },
    equipment: {
      schemaVersion: USER_DATA_SCHEMA_VERSION,
      revision: 1,
      slots: initialEquipmentSlotIds(equipped),
      beltCapacity: asFiniteNumber(
        asRecord(asRecord(asRecord(equipped).cintura).Specific).slotCintura ??
          root.beltCapacity ?? root.slotCintura,
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
