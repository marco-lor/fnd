import {
  asRecord,
  asTrimmedString,
  hashValue,
  isValidFirestoreDocumentId,
  operationReceiptId,
  validateOperationId,
} from "./userDataV2";

export const TASK07_FOE_TOKEN_SPAWN_KIND =
  "spawn-grigliata-foe-token" as const;

export const task07FoeTokenSpawnMode = (
  task07WritesEnabled: boolean
): "canonical" | "legacy" => (
  task07WritesEnabled ? "canonical" : "legacy"
);

export interface SpawnGrigliataFoeTokenInput {
  foeId: string;
  backgroundId: string;
  col: number;
  row: number;
  operationId: string;
}

export interface SpawnGrigliataFoeTokenIdentity {
  receiptId: string;
  tokenId: string;
  placementId: string;
}

const integer = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
};

export const normalizeSpawnGrigliataFoeTokenInput = (
  value: unknown
): SpawnGrigliataFoeTokenInput => {
  const input = asRecord(value);
  const foeId = asTrimmedString(input.foeId);
  const backgroundId = asTrimmedString(input.backgroundId);
  const operationId = validateOperationId(input.operationId);
  const col = integer(input.col);
  const row = integer(input.row);
  if (!isValidFirestoreDocumentId(foeId) ||
    !isValidFirestoreDocumentId(backgroundId) ||
    !operationId || col === null || row === null) {
    throw new TypeError(
      "foeId, backgroundId, integer coordinates, and operationId are required."
    );
  }
  return {foeId, backgroundId, col, row, operationId};
};

export const spawnGrigliataFoeTokenIdentity = (
  actorUid: string,
  operationId: string,
  backgroundId: string
): SpawnGrigliataFoeTokenIdentity => {
  const receiptId = operationReceiptId(actorUid, operationId);
  const tokenId = `foe_${receiptId.slice(0, 24)}`;
  return {
    receiptId,
    tokenId,
    placementId: `${backgroundId}__${tokenId}`,
  };
};

export const spawnGrigliataFoeTokenRequestHash = (
  input: SpawnGrigliataFoeTokenInput
): string => hashValue({
  kind: TASK07_FOE_TOKEN_SPAWN_KIND,
  foeId: input.foeId,
  backgroundId: input.backgroundId,
  col: input.col,
  row: input.row,
});

export const isActiveGrigliataDm = (value: unknown): boolean => {
  const data = asRecord(value);
  return asTrimmedString(data.role).toLowerCase() === "dm" &&
    data.deletionState !== "pending" &&
    data.disabled !== true;
};

const deepClone = <T>(value: T): T => JSON.parse(
  JSON.stringify(value ?? null)
);

const finite = (value: unknown, fallback = 0): number => {
  if (value === null || value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizedStats = (value: unknown): Record<string, unknown> => {
  const stats = deepClone(asRecord(value));
  const hpTotal = finite(stats.hpTotal);
  const manaTotal = finite(stats.manaTotal);
  return {
    ...stats,
    hpTotal,
    hpCurrent: finite(stats.hpCurrent, hpTotal),
    manaTotal,
    manaCurrent: finite(stats.manaCurrent, manaTotal),
  };
};

const normalizedEntries = (value: unknown): Record<string, unknown>[] => (
  Array.isArray(value) ?
    deepClone(value.map((entry) => asRecord(entry))) :
    []
);

export const buildSpawnedFoeTokenDocument = (input: {
  actorUid: string;
  foeId: string;
  source: Record<string, unknown>;
  timestamp: unknown;
}): Record<string, unknown> => ({
  ownerUid: input.actorUid,
  label: asTrimmedString(input.source.name) || "Foe",
  imageUrl: asTrimmedString(input.source.imageUrl),
  imagePath: asTrimmedString(input.source.imagePath),
  tokenType: "foe",
  imageSource: "foesHub",
  foeSourceId: input.foeId,
  category: asTrimmedString(input.source.category),
  rank: asTrimmedString(input.source.rank),
  dadoAnima: asTrimmedString(input.source.dadoAnima),
  notes: asTrimmedString(input.source.notes),
  stats: normalizedStats(input.source.stats),
  Parametri: deepClone(asRecord(input.source.Parametri)),
  spells: normalizedEntries(input.source.spells),
  tecniche: normalizedEntries(input.source.tecniche),
  createdAt: input.timestamp,
  createdBy: input.actorUid,
  updatedAt: input.timestamp,
  updatedBy: input.actorUid,
});

export const buildSpawnedFoePlacementDocument = (input: {
  actorUid: string;
  backgroundId: string;
  tokenId: string;
  col: number;
  row: number;
  label: string;
  imageUrl: string;
  timestamp: unknown;
}): Record<string, unknown> => ({
  backgroundId: input.backgroundId,
  tokenId: input.tokenId,
  ownerUid: input.actorUid,
  label: input.label,
  imageUrl: input.imageUrl,
  col: input.col,
  row: input.row,
  isVisibleToPlayers: true,
  isDead: false,
  statuses: [],
  updatedAt: input.timestamp,
  updatedBy: input.actorUid,
});

export const task07SpawnReceiptMatches = (input: {
  receipt: unknown;
  actorUid: string;
  requestHash: string;
  tokenId: string;
  placementId: string;
}): boolean => {
  const receipt = asRecord(input.receipt);
  return receipt.actorUid === input.actorUid &&
    receipt.kind === TASK07_FOE_TOKEN_SPAWN_KIND &&
    receipt.requestHash === input.requestHash &&
    receipt.tokenId === input.tokenId &&
    receipt.placementId === input.placementId;
};

export const task07SpawnRegenerationPlansMatch = (
  first: unknown,
  second: unknown
): boolean => hashValue(first) === hashValue(second);
