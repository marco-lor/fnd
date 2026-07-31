export class Task07MediaPipelineError extends Error {
  constructor(message, {
    code = 'media-pipeline-failed',
    stage = 'unknown',
    assetId = null,
    committed = false,
    commitAttempted = false,
    cause = null,
    abandonment = null,
  } = {}) {
    super(message);
    this.name = 'Task07MediaPipelineError';
    this.code = code;
    this.stage = stage;
    this.assetId = assetId;
    this.committed = committed;
    this.commitAttempted = commitAttempted;
    this.abandonment = abandonment;
    if (cause) this.cause = cause;
  }
}

export class Task07UnsupportedMediaError extends Task07MediaPipelineError {
  constructor(message, options = {}) {
    super(message, {
      ...options,
      code: options.code || 'unsupported-media',
      stage: options.stage || 'generate',
    });
    this.name = 'Task07UnsupportedMediaError';
  }
}

export const createTask07AbortError = (reason) => {
  const message = reason instanceof Error
    ? reason.message
    : typeof reason === 'string' && reason
      ? reason
      : 'Task 07 media operation was cancelled.';
  const error = new Error(message);
  error.name = 'AbortError';
  error.code = 'aborted';
  return error;
};

export const throwIfTask07Aborted = (signal) => {
  if (signal?.aborted) {
    throw createTask07AbortError(signal.reason);
  }
};

export const summarizeTask07Error = (error) => ({
  name: typeof error?.name === 'string' ? error.name : 'Error',
  code: typeof error?.code === 'string' ? error.code : 'unknown',
  message: typeof error?.message === 'string' ? error.message : String(error || 'Unknown error'),
});
