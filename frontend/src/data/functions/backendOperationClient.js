/* global globalThis */
import { getCallable } from './callableRegistry';

const OPERATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{7,79}$/;
const TERMINAL_FAILURE_STATUSES = new Set([
  'paused',
  'failed',
  'cleanup-pending',
]);
const DEFAULT_TIMEOUT_MS = 2 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 400;
const MAX_POLL_INTERVAL_MS = 2000;

export const TASK06_LOCAL_CANDIDATE = process.env.REACT_APP_FND_PERF === '1';

const getBackendOperationStatus = getCallable('getBackendOperationStatus');
const resumeBackendOperation = getCallable('resumeBackendOperation');

const normalizePrefix = (value) => {
  const normalized = String(value || 'operation')
    .replace(/[^A-Za-z0-9_-]/g, '-')
    .replace(/^[^A-Za-z0-9]+/, '')
    .slice(0, 24);
  return normalized || 'operation';
};

const fallbackEntropy = () => (
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`
);

export const createBackendOperationId = (prefix = 'operation') => {
  const entropy = globalThis.crypto?.randomUUID?.() || fallbackEntropy();
  const operationId = `${normalizePrefix(prefix)}-${entropy}`.slice(0, 80);
  if (!OPERATION_ID_PATTERN.test(operationId)) {
    throw new Error('Unable to create a valid backend operation id.');
  }
  return operationId;
};

export const getBackendOperationView = (value) => {
  const payload = value?.data ?? value;
  return payload?.operation ?? payload;
};

const waitForDelay = (delayMs, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) {
    reject(new DOMException('The operation status request was aborted.', 'AbortError'));
    return;
  }

  const onAbort = () => {
    clearTimeout(timeoutId);
    reject(new DOMException('The operation status request was aborted.', 'AbortError'));
  };
  const timeoutId = setTimeout(() => {
    signal?.removeEventListener('abort', onAbort);
    resolve();
  }, Math.max(0, delayMs));
  signal?.addEventListener('abort', onAbort, { once: true });
});

export class BackendOperationError extends Error {
  constructor(message, operation) {
    super(message);
    this.name = 'BackendOperationError';
    this.operation = operation;
  }
}

export const waitForBackendOperation = async (
  operationId,
  {
    initialOperation,
    signal,
    statusCallable = getBackendOperationStatus,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  } = {}
) => {
  if (!OPERATION_ID_PATTERN.test(String(operationId || ''))) {
    throw new TypeError('operationId must be 8-80 URL-safe characters.');
  }

  const startedAt = Date.now();
  let operation = getBackendOperationView(initialOperation);
  let nextDelayMs = Math.max(0, pollIntervalMs);

  while (true) {
    if (signal?.aborted) {
      throw new DOMException('The operation status request was aborted.', 'AbortError');
    }
    if (operation?.status === 'completed') return operation;
    if (TERMINAL_FAILURE_STATUSES.has(operation?.status)) {
      throw new BackendOperationError(
        `Backend operation ${operation.status}.`,
        operation
      );
    }
    if (Date.now() - startedAt >= timeoutMs) {
      throw new BackendOperationError(
        'Timed out while waiting for the backend operation.',
        operation
      );
    }

    if (operation) {
      await waitForDelay(nextDelayMs, signal);
      nextDelayMs = Math.min(
        MAX_POLL_INTERVAL_MS,
        Math.max(DEFAULT_POLL_INTERVAL_MS, nextDelayMs * 1.5)
      );
    }

    const response = await statusCallable({ operationId });
    operation = getBackendOperationView(response);
  }
};

export const callBackendOperationAndWait = async (
  callable,
  payload,
  options = {}
) => {
  const operationId = options.operationId || createBackendOperationId(
    options.operationPrefix
  );
  const response = await callable({ ...payload, operationId });
  let initialOperation = getBackendOperationView(response);
  if (
    initialOperation?.replayed === true &&
    initialOperation?.retryable === true &&
    TERMINAL_FAILURE_STATUSES.has(initialOperation?.status)
  ) {
    const resumeCallable = options.resumeCallable || resumeBackendOperation;
    const resumed = await resumeCallable({ operationId });
    initialOperation = getBackendOperationView(resumed);
  }
  return waitForBackendOperation(operationId, {
    ...options,
    initialOperation,
  });
};
