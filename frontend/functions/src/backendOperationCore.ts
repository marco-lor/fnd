import {Timestamp} from "firebase-admin/firestore";
import {
  asRecord,
  asTrimmedString,
  hashValue,
  operationReceiptId,
  operationRequestHash,
  validateOperationId,
} from "./userDataV2";

export const BACKEND_OPERATION_SCHEMA_VERSION = 1;
export const BACKEND_OPERATION_TTL_DAYS = 30;
export const BACKEND_OPERATION_PAGE_SIZE = 100;
export const BACKEND_OPERATION_MAX_WRITES = 400;
export const BACKEND_OPERATION_LEASE_MS = 2 * 60 * 1000;
export const BACKEND_OPERATION_STEP_BUDGET_MS = 20 * 1000;
export const BACKEND_OPERATION_STORAGE_CONCURRENCY = 4;

export const BACKEND_OPERATION_KINDS = [
  "level-up-all",
  "set-parameter-locks",
  "delete-npc",
  "delete-encounter",
  "delete-grigliata-custom-token",
  "duplicate-foe",
] as const;

export type BackendOperationKind =
  typeof BACKEND_OPERATION_KINDS[number];

export type BackendOperationStatus =
  | "pending"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cleanup-pending";

export interface BackendOperationProgress {
  planned: number;
  processed: number;
  succeeded: number;
  skipped: number;
  failed: number;
}

export interface BackendOperationView {
  operationId: string;
  kind: BackendOperationKind;
  status: BackendOperationStatus;
  progress: BackendOperationProgress;
  replayed: boolean;
  retryable: boolean;
  result?: Record<string, unknown>;
  errorClass?: string;
}

export interface Task06BackendConfig {
  schemaVersion: 1;
  derivedOwnerMode: "legacy" | "shadow" | "authoritative";
  enabledOperationKinds: BackendOperationKind[];
}

export const emptyOperationProgress = (): BackendOperationProgress => ({
  planned: 0,
  processed: 0,
  succeeded: 0,
  skipped: 0,
  failed: 0,
});

export const resolveTask06BackendConfig = (
  value: unknown
): Task06BackendConfig => {
  const data = asRecord(value);
  const rawMode = asTrimmedString(data.derivedOwnerMode);
  const derivedOwnerMode = (
    data.schemaVersion === BACKEND_OPERATION_SCHEMA_VERSION &&
    ["legacy", "shadow", "authoritative"].includes(rawMode)
  ) ? rawMode as Task06BackendConfig["derivedOwnerMode"] : "legacy";
  const enabledOperationKinds = (
    data.schemaVersion === BACKEND_OPERATION_SCHEMA_VERSION &&
    Array.isArray(data.enabledOperationKinds)
  ) ? data.enabledOperationKinds
    .map(asTrimmedString)
    .filter((kind): kind is BackendOperationKind => (
      BACKEND_OPERATION_KINDS.includes(kind as BackendOperationKind)
    )) : [];
  return {
    schemaVersion: BACKEND_OPERATION_SCHEMA_VERSION,
    derivedOwnerMode,
    enabledOperationKinds: [...new Set(enabledOperationKinds)],
  };
};

export const validateBackendOperationId = (value: unknown): string => (
  validateOperationId(value)
);

export const backendOperationReceiptId = (
  actorUid: string,
  operationId: string
): string => operationReceiptId(actorUid, operationId);

export const backendOperationRequestHash = (
  kind: BackendOperationKind,
  input: unknown
): string => operationRequestHash(kind, input);

export const backendOperationExpiry = (): Timestamp => (
  Timestamp.fromMillis(
    Date.now() + BACKEND_OPERATION_TTL_DAYS * 24 * 60 * 60 * 1000
  )
);

const finiteCount = (value: unknown): number => {
  const count = Number(value);
  return Number.isFinite(count) && count >= 0 ? Math.trunc(count) : 0;
};

export const operationViewFromData = (
  value: unknown,
  replayed = false
): BackendOperationView => {
  const data = asRecord(value);
  const progress = asRecord(data.progress);
  const rawKind = asTrimmedString(data.kind);
  const kind = BACKEND_OPERATION_KINDS.includes(
    rawKind as BackendOperationKind
  ) ? rawKind as BackendOperationKind : "level-up-all";
  const rawStatus = asTrimmedString(data.status);
  const statuses: BackendOperationStatus[] = [
    "pending",
    "running",
    "paused",
    "completed",
    "failed",
    "cleanup-pending",
  ];
  const status = statuses.includes(rawStatus as BackendOperationStatus)
    ? rawStatus as BackendOperationStatus
    : "failed";
  const errorClass = asTrimmedString(data.errorClass);
  const result = asRecord(data.result);
  return {
    operationId: asTrimmedString(data.operationId),
    kind,
    status,
    progress: {
      planned: finiteCount(progress.planned),
      processed: finiteCount(progress.processed),
      succeeded: finiteCount(progress.succeeded),
      skipped: finiteCount(progress.skipped),
      failed: finiteCount(progress.failed),
    },
    replayed,
    retryable: data.retryable === true,
    ...(Object.keys(result).length ? {result} : {}),
    ...(errorClass ? {errorClass} : {}),
  };
};

export const operationCorrelationHash = (receiptId: string): string => (
  hashValue(receiptId).slice(0, 12)
);

export const getTokenGrantForLevel = (level: number): number => {
  if (level >= 2 && level <= 4) return 4;
  if (level >= 5 && level <= 7) return 6;
  if (level >= 8 && level <= 10) return 8;
  return 0;
};

export const isSafeOwnedStoragePath = (
  value: unknown,
  allowedPrefixes: readonly string[]
): boolean => {
  const path = asTrimmedString(value);
  if (
    !path ||
    path.includes("://") ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.split("/").some((segment) => segment === "..")
  ) return false;
  return allowedPrefixes.some((prefix) => path.startsWith(prefix));
};

export const ownedStoragePath = (
  value: unknown,
  allowedPrefixes: readonly string[],
  expectedBucket = ""
): string => {
  const directPath = asTrimmedString(value);
  if (isSafeOwnedStoragePath(directPath, allowedPrefixes)) {
    return directPath;
  }
  try {
    const parsed = new URL(directPath);
    if (
      parsed.protocol !== "https:" ||
      parsed.hostname !== "firebasestorage.googleapis.com"
    ) return "";
    const match = /^\/v0\/b\/([^/]+)\/o\/([^/]+)$/.exec(
      parsed.pathname
    );
    if (!match) return "";
    const bucket = decodeURIComponent(match[1]);
    if (expectedBucket && bucket !== expectedBucket) return "";
    const decodedPath = decodeURIComponent(match[2]);
    return isSafeOwnedStoragePath(decodedPath, allowedPrefixes)
      ? decodedPath
      : "";
  } catch {
    return "";
  }
};

export const mapWithConcurrency = async <Input, Output>(
  values: Input[],
  concurrency: number,
  work: (value: Input, index: number) => Promise<Output>
): Promise<Output[]> => {
  const limit = Math.max(1, Math.trunc(concurrency));
  const output = new Array<Output>(values.length);
  let cursor = 0;
  let firstError: unknown;
  const runner = async (): Promise<void> => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      try {
        output[index] = await work(values[index], index);
      } catch (error) {
        firstError ??= error;
      }
    }
  };
  await Promise.all(
    Array.from(
      {length: Math.min(limit, values.length)},
      () => runner()
    )
  );
  if (firstError) throw firstError;
  return output;
};
