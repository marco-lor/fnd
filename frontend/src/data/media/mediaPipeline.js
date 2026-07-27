import { generateMediaDerivatives } from './mediaDerivatives';
import {
  Task07MediaPipelineError,
  summarizeTask07Error,
  throwIfTask07Aborted,
} from './mediaErrors';
import { uploadGeneratedTask07Media } from './mediaUpload';
export { TASK07_MEDIA_PIPELINE_ENABLED } from './mediaFeatureFlags';

export const TASK07_MEDIA_CALLABLES = Object.freeze({
  prepare: 'task07PrepareMediaUpload',
  finalize: 'task07FinalizeMediaUpload',
  confirm: 'task07ConfirmMediaReference',
  abandon: 'task07AbandonMediaAsset',
  retire: 'task07RetireMediaAsset',
  retryCleanup: 'task07RetryMediaCleanup',
});

export const TASK07_ITEM_REFERENCE_SCOPES = Object.freeze([
  'user-inventory',
  'global-catalog',
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
    ...(input.referenceScope
      ? { referenceScope: input.referenceScope }
      : {}),
    ...(input.previousAssetId != null
      ? { previousAssetId: input.previousAssetId }
      : {}),
  }),
  'prepare'
);

export const finalizeTask07MediaUpload = async (assetId, {
  invokeCallable = invokeTask07MediaCallable,
} = {}) => requireCallableSuccess(
  await invokeCallable(TASK07_MEDIA_CALLABLES.finalize, { assetId }),
  'finalize'
);

export const confirmTask07MediaReference = async (assetId, {
  invokeCallable = invokeTask07MediaCallable,
} = {}) => requireCallableSuccess(
  await invokeCallable(TASK07_MEDIA_CALLABLES.confirm, { assetId }),
  'confirm'
);

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

const validatePipelineInput = (input) => {
  if (!input?.file || typeof input.file.type !== 'string') {
    throw new TypeError('Task 07 media pipeline requires a File or Blob.');
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
  if (
    input.kind === 'item'
    && !TASK07_ITEM_REFERENCE_SCOPES.includes(input.referenceScope)
  ) {
    throw new TypeError('Task 07 item media requires an explicit referenceScope.');
  }
  if (
    input.kind !== 'item'
    && input.referenceScope != null
    && input.referenceScope !== ''
  ) {
    throw new TypeError('Task 07 referenceScope is supported only for item media.');
  }
  if (typeof input.commitEntity !== 'function') {
    throw new TypeError('Task 07 media pipeline requires commitEntity(media).');
  }
};

const requireAtomicRetirementResult = (confirmation, previousAssetId, assetId) => {
  const expectedAssetId = previousAssetId || null;
  const retirement = confirmation?.retirement;
  const requested = expectedAssetId != null;
  const allowedReplayStates = new Set([
    'superseded',
    'cleanup-pending',
    'cleanup-failed',
    'cleaned',
  ]);
  const valid = retirement
    && retirement.requested === requested
    && retirement.assetId === expectedAssetId
    && typeof retirement.replay === 'boolean'
    && (
      requested
        ? (
          allowedReplayStates.has(retirement.state)
          && Number.isFinite(retirement.graceHours)
          && retirement.graceHours >= 0
        )
        : (
          retirement.state === 'not-requested'
          && retirement.graceHours === null
        )
    );
  if (!valid) {
    throw new Task07MediaPipelineError(
      'Confirm response is missing the atomic previous-asset retirement result.',
      {
        code: 'invalid-confirm-retirement',
        stage: 'confirm',
        assetId,
      }
    );
  }
  return retirement;
};

export const runTask07MediaPipeline = async (input, {
  invokeCallable = invokeTask07MediaCallable,
  generate = generateMediaDerivatives,
  upload = uploadGeneratedTask07Media,
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
    commitEntity,
    signal,
    onProgress,
  } = input;
  let stage = 'prepare';
  let assetId = null;
  let committed = false;
  let commitAttempted = false;
  let media = null;
  let abandonment = null;

  try {
    throwIfTask07Aborted(signal);
    onProgress?.({ stage });
    const prepared = await prepareTask07MediaUpload({
      ownerUid,
      entityId,
      operationId: operationId.trim(),
      kind,
      sourceContentType: file.type,
      referenceScope,
      previousAssetId,
    }, { invokeCallable });
    const uploadPlan = prepared.upload;
    assetId = uploadPlan?.assetId || null;
    if (!assetId || !uploadPlan?.contract) {
      throw new Task07MediaPipelineError('Prepare response is missing its server upload contract.', {
        code: 'invalid-prepare-response',
        stage,
        assetId,
      });
    }

    stage = 'generate';
    throwIfTask07Aborted(signal);
    onProgress?.({ stage, assetId });
    const generated = await generate({
      file,
      upload: uploadPlan,
      signal,
      onProgress,
    });

    stage = 'upload';
    throwIfTask07Aborted(signal);
    onProgress?.({ stage, assetId, fraction: 0 });
    const uploaded = await upload({
      upload: uploadPlan,
      generated,
      signal,
      onProgress,
    });

    stage = 'finalize';
    throwIfTask07Aborted(signal);
    onProgress?.({ stage, assetId });
    const finalized = await finalizeTask07MediaUpload(assetId, { invokeCallable });
    media = finalized.media;
    if (!media || media.assetId !== assetId) {
      throw new Task07MediaPipelineError('Finalize response is missing authoritative media metadata.', {
        code: 'invalid-finalize-media',
        stage,
        assetId,
      });
    }

    stage = 'commit';
    throwIfTask07Aborted(signal);
    onProgress?.({ stage, assetId });
    commitAttempted = true;
    await commitEntity(media);
    committed = true;

    // Once the entity commit has succeeded, consistency work must finish even
    // if the initiating view unmounts or its AbortSignal is cancelled. The
    // backend sweeper is the fallback for an ambiguous commit acknowledgement,
    // but a resolved commit should be confirmed immediately.
    stage = 'confirm';
    onProgress?.({ stage, assetId });
    const confirmation = await confirmTask07MediaReference(assetId, { invokeCallable });
    const retirement = requireAtomicRetirementResult(confirmation, previousAssetId, assetId);
    onProgress?.({
      stage: 'complete',
      assetId,
      retirement,
    });
    return {
      assetId,
      upload: {
        entries: uploaded?.entries || [],
      },
      media,
      confirmation,
      retirement,
    };
  } catch (error) {
    if (assetId && !commitAttempted) {
      try {
        onProgress?.({ stage: 'abandon', assetId, failedStage: stage });
        const result = await abandonTask07MediaAsset(assetId, { invokeCallable });
        abandonment = { ok: true, result };
      } catch (abandonError) {
        abandonment = {
          ok: false,
          error: summarizeTask07Error(abandonError),
        };
      }
    }

    if (error instanceof Task07MediaPipelineError) {
      error.stage = stage;
      error.assetId = assetId;
      error.committed = committed;
      error.commitAttempted = commitAttempted;
      error.abandonment = abandonment;
      throw error;
    }
    throw new Task07MediaPipelineError(
      error?.message || `Task 07 media pipeline failed during ${stage}.`,
      {
        code: error?.code || (error?.name === 'AbortError' ? 'aborted' : 'media-pipeline-failed'),
        stage,
        assetId,
        committed,
        commitAttempted,
        cause: error,
        abandonment,
      }
    );
  }
};
