export type DuplicateCleanupReceiptState = {
  status: "failed" | "cleanup-pending";
  retryable: boolean;
  retryOperationAfterCleanup?: boolean;
};

export const resolveRetryOperationAfterCleanup = (
  value: unknown
): boolean => value !== false;

export const duplicateCleanupReceiptState = (input: {
  cleanupComplete: boolean;
  storedRetryOperationAfterCleanup: unknown;
}): DuplicateCleanupReceiptState => {
  const retryOperationAfterCleanup = resolveRetryOperationAfterCleanup(
    input.storedRetryOperationAfterCleanup
  );
  if (!input.cleanupComplete) {
    return {
      status: "cleanup-pending",
      retryable: true,
      retryOperationAfterCleanup,
    };
  }
  return {
    status: "failed",
    retryable: retryOperationAfterCleanup,
  };
};

export const duplicateCleanupCallableCode = (input: {
  cleanupComplete: boolean;
  retryOperationAfterCleanup: boolean;
}): "unavailable" | "failed-precondition" => (
  input.cleanupComplete && !input.retryOperationAfterCleanup ?
    "failed-precondition" : "unavailable"
);

export const isTerminalDuplicateFailureCode = (
  value: unknown
): boolean => [
  "aborted",
  "failed-precondition",
  "already-exists",
  "not-found",
  "invalid-argument",
].includes(typeof value === "string" ? value : "");
