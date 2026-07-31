const test = require("node:test");
const assert = require("node:assert/strict");

const {
  duplicateCleanupCallableCode,
  duplicateCleanupReceiptState,
  isTerminalDuplicateFailureCode,
  resolveRetryOperationAfterCleanup,
} = require("../lib/duplicateFoeRecoveryCore");

test("schema-v2 cleanup receipts without a disposition default to retry", () => {
  assert.equal(resolveRetryOperationAfterCleanup(undefined), true);
  assert.equal(resolveRetryOperationAfterCleanup(null), true);
  assert.equal(resolveRetryOperationAfterCleanup(true), true);
  assert.equal(resolveRetryOperationAfterCleanup(false), false);
});

test("incomplete cleanup always remains cleanup-pending and retryable", () => {
  assert.deepEqual(duplicateCleanupReceiptState({
    cleanupComplete: false,
    storedRetryOperationAfterCleanup: true,
  }), {
    status: "cleanup-pending",
    retryable: true,
    retryOperationAfterCleanup: true,
  });
  assert.deepEqual(duplicateCleanupReceiptState({
    cleanupComplete: false,
    storedRetryOperationAfterCleanup: false,
  }), {
    status: "cleanup-pending",
    retryable: true,
    retryOperationAfterCleanup: false,
  });
});

test("completed cleanup exposes only the original retry disposition", () => {
  assert.deepEqual(duplicateCleanupReceiptState({
    cleanupComplete: true,
    storedRetryOperationAfterCleanup: true,
  }), {status: "failed", retryable: true});
  assert.deepEqual(duplicateCleanupReceiptState({
    cleanupComplete: true,
    storedRetryOperationAfterCleanup: false,
  }), {status: "failed", retryable: false});
});

test("cleanup result codes retain ambiguous IDs and retire terminal IDs", () => {
  assert.equal(duplicateCleanupCallableCode({
    cleanupComplete: false,
    retryOperationAfterCleanup: false,
  }), "unavailable");
  assert.equal(duplicateCleanupCallableCode({
    cleanupComplete: true,
    retryOperationAfterCleanup: true,
  }), "unavailable");
  assert.equal(duplicateCleanupCallableCode({
    cleanupComplete: true,
    retryOperationAfterCleanup: false,
  }), "failed-precondition");
});

test("only post-claim terminal fence codes request terminal cleanup", () => {
  [
    "aborted", "failed-precondition", "already-exists", "not-found",
    "invalid-argument",
  ].forEach((code) => assert.equal(isTerminalDuplicateFailureCode(code), true));
  [
    "unavailable", "deadline-exceeded", "internal", "unknown",
    "permission-denied", "unauthenticated", "",
  ].forEach((code) => assert.equal(isTerminalDuplicateFailureCode(code), false));
});
