import {
  Task07MediaPipelineError,
  summarizeTask07Error,
  throwIfTask07Aborted,
} from './mediaErrors';
import { uploadTask07Source } from './mediaUpload';
export { TASK07_MEDIA_PIPELINE_ENABLED } from './mediaFeatureFlags';

export const TASK07_MEDIA_CALLABLES = Object.freeze({
  prepare: 'task07PrepareMediaUpload',
  status: 'task07GetMediaStatus',
  attach: 'task07AttachMediaAsset',
  confirm: 'task07ConfirmMediaReference',
  abandon: 'task07AbandonMediaAsset',
  retire: 'task07RetireMediaAsset',
  retryCleanup: 'task07RetryMediaCleanup',
});

export const TASK07_ITEM_REFERENCE_SCOPES = Object.freeze([
  'user-inventory',
  'global-catalog',
]);
export const TASK07_MEDIA_STATUS_POLL_INTERVAL_MS = 1000;
export const TASK07_MEDIA_STATUS_TIMEOUT_MS = 10 * 60 * 1000;
export const TASK07_MEDIA_ATTACH_RECONCILIATION_ATTEMPTS = 3;
export const TASK07_MEDIA_ATTACH_RECONCILIATION_INTERVAL_MS = 250;

const TERMINAL_FAILURE_STATES = new Set([
  'cancelled',
  'deleted',
  'failed',
  'rejected',
  'superseded',
]);

const PREPARE_RESUME_STATES = new Set([
  'intent',
  'uploaded',
  'processing',
  'ready',
  'attached',
  'failed',
  'rejected',
  'cancelled',
  'superseded',
  'cleanup-pending',
  'deleted',
]);

const unwrapCallableResult = (value) => (
  value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'data')
    ? value.data
    : value
);

export const invokeTask07MediaCallable = async (name, payload) => {
  const registry = await import('../functions/callableRegistry');
  const callable = registry.getCallable(name);
  return unwrapCallableResult(await callable(payload));
};

const requireCallableSuccess = (value, operation) => {
  const result = unwrapCallableResult(value);
  if (!result || result.ok !== true) {
    throw new Task07MediaPipelineError(`Task 07 ${operation} callable returned an invalid result.`, {
      code: `invalid-${operation}-response`,
      stage: operation,
    });
  }
  return result;
};

export const prepareTask07MediaUpload = async (input, {
  invokeCallable = invokeTask07MediaCallable,
} = {}) => requireCallableSuccess(
  await invokeCallable(TASK07_MEDIA_CALLABLES.prepare, {
    ownerUid: input.ownerUid,
    entityId: input.entityId,
    operationId: input.operationId,
    kind: input.kind,
    sourceContentType: input.sourceContentType,
    sourceBytes: input.sourceBytes,
    ...(input.referenceScope ? { referenceScope: input.referenceScope } : {}),
    ...(input.previousAssetId != null ? { previousAssetId: input.previousAssetId } : {}),
  }),
  'prepare'
);

export const getTask07MediaStatus = async (assetId, {
  invokeCallable = invokeTask07MediaCallable,
} = {}) => requireCallableSuccess(
  await invokeCallable(TASK07_MEDIA_CALLABLES.status, { assetId }),
  'status'
);

export const attachTask07MediaAsset = async (assetId, {
  expectedRevision,
  invokeCallable = invokeTask07MediaCallable,
} = {}) => {
  const result = requireCallableSuccess(
    await invokeCallable(TASK07_MEDIA_CALLABLES.attach, {
      assetId,
      ...(expectedRevision == null ? {} : { expectedRevision }),
    }),
    'attach'
  );
  if (result.assetId !== assetId || result.state !== 'attached') {
    throw new Task07MediaPipelineError(
      'Task 07 attach callable returned an invalid attachment acknowledgement.',
      {
        code: 'invalid-attach-response',
        stage: 'attach',
        assetId,
      }
    );
  }
  return result;
};

export const abandonTask07MediaAsset = async (assetId, {
  invokeCallable = invokeTask07MediaCallable,
} = {}) => requireCallableSuccess(
  await invokeCallable(TASK07_MEDIA_CALLABLES.abandon, { assetId }),
  'abandon'
);

export const retireTask07MediaAsset = async (assetId, {
  invokeCallable = invokeTask07MediaCallable,
} = {}) => requireCallableSuccess(
  await invokeCallable(TASK07_MEDIA_CALLABLES.retire, { assetId }),
  'retire'
);

export const retryTask07MediaCleanup = async (assetId, {
  invokeCallable = invokeTask07MediaCallable,
} = {}) => requireCallableSuccess(
  await invokeCallable(TASK07_MEDIA_CALLABLES.retryCleanup, { assetId }),
  'retry-cleanup'
);

const abortableDelay = (delayMs, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) {
    try {
      throwIfTask07Aborted(signal);
    } catch (error) {
      reject(error);
    }
    return;
  }
  const timer = setTimeout(() => {
    signal?.removeEventListener('abort', handleAbort);
    resolve();
  }, delayMs);
  const handleAbort = () => {
    clearTimeout(timer);
    signal?.removeEventListener('abort', handleAbort);
    try {
      throwIfTask07Aborted(signal);
    } catch (error) {
      reject(error);
    }
  };
  signal?.addEventListener('abort', handleAbort, { once: true });
});

export const reconcileTask07MediaAttachment = async (assetId, {
  invokeCallable = invokeTask07MediaCallable,
  signal,
  onProgress,
  maxAttempts = TASK07_MEDIA_ATTACH_RECONCILIATION_ATTEMPTS,
  pollIntervalMs = TASK07_MEDIA_ATTACH_RECONCILIATION_INTERVAL_MS,
  delay = abortableDelay,
} = {}) => {
  const attemptsLimit = Number.isSafeInteger(maxAttempts) && maxAttempts > 0
    ? maxAttempts
    : TASK07_MEDIA_ATTACH_RECONCILIATION_ATTEMPTS;
  let lastStatus = null;

  for (let attempts = 1; attempts <= attemptsLimit; attempts += 1) {
    throwIfTask07Aborted(signal);
    let statusUnavailable = false;
    try {
      lastStatus = await getTask07MediaStatus(assetId, { invokeCallable });
    } catch (error) {
      throwIfTask07Aborted(signal);
      statusUnavailable = true;
      onProgress?.({
        stage: 'attach-reconcile',
        assetId,
        attached: false,
        attempts,
        statusUnavailable: true,
      });
    }

    if (!statusUnavailable) {
      throwIfTask07Aborted(signal);
      onProgress?.({
        stage: 'attach-reconcile',
        assetId,
        state: lastStatus.state,
        attached: lastStatus.attached === true,
        attempts,
      });
      if (lastStatus.attached === true) {
        return { attached: true, attempts, status: lastStatus };
      }
    }

    if (attempts < attemptsLimit) {
      await delay(pollIntervalMs, signal);
    }
  }

  return { attached: false, attempts: attemptsLimit, status: lastStatus };
};

export const waitForTask07MediaReady = async (assetId, {
  invokeCallable = invokeTask07MediaCallable,
  signal,
  onProgress,
  pollIntervalMs = TASK07_MEDIA_STATUS_POLL_INTERVAL_MS,
  timeoutMs = TASK07_MEDIA_STATUS_TIMEOUT_MS,
  delay = abortableDelay,
  now = Date.now,
} = {}) => {
  const startedAt = now();
  let attempts = 0;
  while (true) {
    throwIfTask07Aborted(signal);
    attempts += 1;
    const status = await getTask07MediaStatus(assetId, { invokeCallable });
    onProgress?.({
      stage: 'process',
      assetId,
      state: status.state,
      retryable: status.retryable === true,
      attempts,
    });
    if (status.ready === true || status.attached === true) return status;
    const automaticRetryPending = status.state === 'failed' && status.retryable === true;
    if (TERMINAL_FAILURE_STATES.has(status.state) && !automaticRetryPending) {
      throw new Task07MediaPipelineError('Server media processing did not complete.', {
        code: status.errorCode || `processing-${status.state}`,
        stage: 'process',
        assetId,
      });
    }
    const elapsed = now() - startedAt;
    if (!Number.isFinite(elapsed) || elapsed >= timeoutMs) {
      throw new Task07MediaPipelineError('Server media processing timed out.', {
        code: 'processing-timeout',
        stage: 'process',
        assetId,
      });
    }
    await delay(Math.min(pollIntervalMs, timeoutMs - elapsed), signal);
  }
};

const validatePipelineInput = (input) => {
  if (
    !input?.file
    || typeof input.file.type !== 'string'
    || !Number.isSafeInteger(input.file.size)
    || input.file.size <= 0
  ) {
    throw new TypeError('Task 07 media pipeline requires a non-empty File or Blob.');
  }
  if (
    typeof input.operationId !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(input.operationId.trim())
  ) {
    throw new TypeError('A deterministic caller-supplied Task 07 operationId is required.');
  }
  if (typeof input.entityId !== 'string' || !input.entityId.trim()) {
    throw new TypeError('Task 07 media pipeline requires an entityId.');
  }
  if (typeof input.kind !== 'string' || !input.kind.trim()) {
    throw new TypeError('Task 07 media pipeline requires a media kind.');
  }
  if (input.kind === 'item' && !TASK07_ITEM_REFERENCE_SCOPES.includes(input.referenceScope)) {
    throw new TypeError('Task 07 item media requires an explicit referenceScope.');
  }
  if (input.kind !== 'item' && input.referenceScope != null && input.referenceScope !== '') {
    throw new TypeError('Task 07 referenceScope is supported only for item media.');
  }
  if (
    input.expectedRevision != null
    && (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0)
  ) {
    throw new TypeError('Task 07 expected media revision must be a non-negative integer.');
  }
  if (input.prepareEntity != null && typeof input.prepareEntity !== 'function') {
    throw new TypeError('Task 07 prepareEntity must be a function.');
  }
  if (input.rollbackPreparedEntity != null && typeof input.rollbackPreparedEntity !== 'function') {
    throw new TypeError('Task 07 rollbackPreparedEntity must be a function.');
  }
};

export const runTask07MediaPipeline = async (input, {
  invokeCallable = invokeTask07MediaCallable,
  upload = uploadTask07Source,
  waitForReady = waitForTask07MediaReady,
  reconcileAttachment = reconcileTask07MediaAttachment,
} = {}) => {
  validatePipelineInput(input);
  const {
    file,
    ownerUid,
    entityId,
    operationId,
    kind,
    referenceScope,
    previousAssetId = null,
    expectedRevision,
    prepareEntity,
    rollbackPreparedEntity,
    signal,
    onProgress,
  } = input;
  let stage = prepareEntity ? 'prepare-target' : 'prepare';
  let assetId = null;
  let attached = false;
  let attachAttempted = false;
  let targetPrepared = false;
  let abandonment = null;
  let targetRollback = null;

  try {
    if (prepareEntity) {
      throwIfTask07Aborted(signal);
      onProgress?.({ stage });
      await prepareEntity();
      targetPrepared = true;
    }

    stage = 'prepare';
    throwIfTask07Aborted(signal);
    onProgress?.({ stage });
    const prepared = await prepareTask07MediaUpload({
      ownerUid,
      entityId,
      operationId: operationId.trim(),
      kind,
      sourceContentType: file.type,
      sourceBytes: file.size,
      referenceScope,
      previousAssetId,
    }, { invokeCallable });
    const uploadPlan = prepared.upload;
    const preparedAssetId = uploadPlan?.assetId || null;
    const hasResumeContract = (
      typeof prepared.replay === 'boolean'
      && typeof prepared.sourcePresent === 'boolean'
      && PREPARE_RESUME_STATES.has(prepared.state)
      && (
        prepared.replay === true
        || (prepared.state === 'intent' && prepared.sourcePresent === false)
      )
    );
    if (!preparedAssetId || !uploadPlan?.sourcePath || !hasResumeContract) {
      throw new Task07MediaPipelineError('Prepare response is missing its staging contract.', {
        code: 'invalid-prepare-response',
        stage,
        assetId: preparedAssetId,
      });
    }
    assetId = preparedAssetId;

    const shouldUploadSource = (
      prepared.replay === false
      || (prepared.state === 'intent' && prepared.sourcePresent === false)
    );

    let uploaded = { entries: [] };
    if (shouldUploadSource) {
      stage = 'upload';
      throwIfTask07Aborted(signal);
      onProgress?.({ stage, assetId, fraction: 0 });
      uploaded = await upload({
        upload: uploadPlan,
        file,
        signal,
        onProgress,
      });
    } else {
      onProgress?.({
        stage: 'resume',
        assetId,
        state: prepared.state,
        sourcePresent: prepared.sourcePresent,
      });
    }

    stage = 'process';
    let status = await waitForReady(assetId, {
      invokeCallable,
      signal,
      onProgress,
    });

    stage = 'attach';
    let confirmation;
    if (status.attached === true) {
      attached = true;
      confirmation = { ok: true, assetId, state: 'attached', replay: true };
    } else {
      throwIfTask07Aborted(signal);
      onProgress?.({ stage, assetId });
      attachAttempted = true;
      try {
        confirmation = await attachTask07MediaAsset(assetId, {
          expectedRevision,
          invokeCallable,
        });
        attached = true;
      } catch (attachError) {
        const reconciliation = await reconcileAttachment(assetId, {
          invokeCallable,
          signal,
          onProgress,
        });
        if (
          reconciliation?.attached === true
          && reconciliation?.status?.attached === true
        ) {
          status = reconciliation.status;
          attached = true;
          confirmation = {
            ok: true,
            assetId,
            state: 'attached',
            replay: true,
            reconciled: true,
          };
        } else {
          throw attachError;
        }
      }
    }
    onProgress?.({ stage: 'complete', assetId, confirmation });
    return {
      assetId,
      upload: { entries: uploaded?.entries || [] },
      status,
      confirmation,
    };
  } catch (error) {
    if (assetId && !attachAttempted) {
      try {
        onProgress?.({ stage: 'abandon', assetId, failedStage: stage });
        const result = await abandonTask07MediaAsset(assetId, { invokeCallable });
        abandonment = { ok: true, result };
      } catch (abandonError) {
        abandonment = { ok: false, error: summarizeTask07Error(abandonError) };
      }
    }
    if (
      targetPrepared
      && rollbackPreparedEntity
      && (!assetId || abandonment?.ok === true)
    ) {
      try {
        await rollbackPreparedEntity();
        targetRollback = { ok: true };
      } catch (rollbackError) {
        targetRollback = { ok: false, error: summarizeTask07Error(rollbackError) };
      }
    }

    if (error instanceof Task07MediaPipelineError) {
      error.stage = stage;
      error.assetId = assetId;
      error.committed = attached;
      error.commitAttempted = attachAttempted;
      error.abandonment = abandonment;
      error.targetRollback = targetRollback;
      throw error;
    }
    const wrapped = new Task07MediaPipelineError(
      error?.message || `Task 07 media pipeline failed during ${stage}.`,
      {
        code: error?.code || (error?.name === 'AbortError' ? 'aborted' : 'media-pipeline-failed'),
        stage,
        assetId,
        committed: attached,
        commitAttempted: attachAttempted,
        cause: error,
        abandonment,
      }
    );
    wrapped.targetRollback = targetRollback;
    throw wrapped;
  }
};
