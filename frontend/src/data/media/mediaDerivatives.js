import {
  Task07MediaPipelineError,
  Task07UnsupportedMediaError,
  createTask07AbortError,
  throwIfTask07Aborted,
} from './mediaErrors';

export const TASK07_MAX_QUALITY_ATTEMPTS = 4;
export const TASK07_MAX_SCALE_ATTEMPTS = 3;

const DEFAULT_MIN_VARIANT_SCALE = 0.7;
const QUALITY_STEP = 0.08;
const SCALE_STEP = 0.15;
const MIN_WEBP_QUALITY = 0.45;

const normalizeContentType = (value) => (
  typeof value === 'string' ? value.split(';')[0].trim().toLowerCase() : ''
);

const asPositiveInteger = (value) => {
  const numeric = Math.round(Number(value));
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : 0;
};

const normalizeOrientation = (value) => (
  [0, 90, 180, 270].includes(Number(value)) ? Number(value) : 0
);

export const getOrientedDimensions = ({
  width,
  height,
  orientationDegrees = 0,
}) => {
  const resolvedWidth = asPositiveInteger(width);
  const resolvedHeight = asPositiveInteger(height);
  const orientation = normalizeOrientation(orientationDegrees);
  if (!resolvedWidth || !resolvedHeight) {
    throw new Task07MediaPipelineError('Decoded media dimensions are invalid.', {
      code: 'invalid-source-dimensions',
      stage: 'generate',
    });
  }
  return orientation === 90 || orientation === 270
    ? { width: resolvedHeight, height: resolvedWidth }
    : { width: resolvedWidth, height: resolvedHeight };
};

export const buildVariantRenderPlan = (source, variantContract) => {
  const oriented = getOrientedDimensions(source);
  const targetWidth = asPositiveInteger(variantContract?.width);
  const targetHeight = asPositiveInteger(variantContract?.height);
  const fit = variantContract?.fit;
  if (!targetWidth || !targetHeight || !['cover', 'inside'].includes(fit)) {
    throw new Task07MediaPipelineError('Server media variant contract is invalid.', {
      code: 'invalid-variant-contract',
      stage: 'generate',
    });
  }

  if (fit === 'cover') {
    const targetRatio = targetWidth / targetHeight;
    const sourceRatio = oriented.width / oriented.height;
    const sourceWidth = sourceRatio > targetRatio
      ? oriented.height * targetRatio
      : oriented.width;
    const sourceHeight = sourceRatio > targetRatio
      ? oriented.height
      : oriented.width / targetRatio;
    return {
      fit,
      orientationDegrees: normalizeOrientation(source.orientationDegrees),
      oriented,
      source: {
        x: (oriented.width - sourceWidth) / 2,
        y: (oriented.height - sourceHeight) / 2,
        width: sourceWidth,
        height: sourceHeight,
      },
      output: { width: targetWidth, height: targetHeight },
    };
  }

  const scale = Math.min(
    targetWidth / oriented.width,
    targetHeight / oriented.height,
    1
  );
  return {
    fit,
    orientationDegrees: normalizeOrientation(source.orientationDegrees),
    oriented,
    source: {
      x: 0,
      y: 0,
      width: oriented.width,
      height: oriented.height,
    },
    output: {
      width: Math.max(1, Math.round(oriented.width * scale)),
      height: Math.max(1, Math.round(oriented.height * scale)),
    },
  };
};

export const buildVariantEncodingAttempts = (variantContract) => {
  const quality = Math.min(1, Math.max(
    MIN_WEBP_QUALITY,
    Number(variantContract?.quality || 0) / 100
  ));
  const declaredMinScale = Number(variantContract?.minScale);
  const minScale = (
    Number.isFinite(declaredMinScale)
    && declaredMinScale > 0
    && declaredMinScale <= 1
  ) ? declaredMinScale : DEFAULT_MIN_VARIANT_SCALE;
  const attempts = [];
  const scales = Array.from(
    { length: TASK07_MAX_SCALE_ATTEMPTS },
    (_, scaleIndex) => Math.max(minScale, 1 - scaleIndex * SCALE_STEP)
  ).filter((scale, index, values) => index === 0 || scale !== values[index - 1]);
  for (const scale of scales) {
    for (
      let qualityIndex = 0;
      qualityIndex < TASK07_MAX_QUALITY_ATTEMPTS;
      qualityIndex += 1
    ) {
      attempts.push({
        scale,
        quality: Math.max(MIN_WEBP_QUALITY, quality - qualityIndex * QUALITY_STEP),
      });
    }
  }
  return attempts;
};

const scaleRenderPlan = (plan, scale) => ({
  ...plan,
  output: {
    width: Math.max(1, Math.round(plan.output.width * scale)),
    height: Math.max(1, Math.round(plan.output.height * scale)),
  },
});

const createBrowserCanvas = (width, height) => {
  if (typeof document === 'undefined') {
    throw new Task07MediaPipelineError('Canvas is unavailable in this environment.', {
      code: 'canvas-unavailable',
      stage: 'generate',
    });
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

const requireCanvasContext = (canvas) => {
  const context = canvas?.getContext?.('2d', { alpha: false });
  if (!context) {
    throw new Task07MediaPipelineError('2D canvas rendering is unavailable.', {
      code: 'canvas-context-unavailable',
      stage: 'generate',
    });
  }
  return context;
};

const renderOrientedSource = (decoded, createCanvas) => {
  const orientation = normalizeOrientation(decoded.orientationDegrees);
  if (orientation === 0) return decoded.source;

  const oriented = getOrientedDimensions(decoded);
  const canvas = createCanvas(oriented.width, oriented.height);
  const context = requireCanvasContext(canvas);
  switch (orientation) {
  case 90:
    context.translate(oriented.width, 0);
    context.rotate(Math.PI / 2);
    break;
  case 180:
    context.translate(oriented.width, oriented.height);
    context.rotate(Math.PI);
    break;
  case 270:
    context.translate(0, oriented.height);
    context.rotate(-Math.PI / 2);
    break;
  default:
    break;
  }
  context.drawImage(decoded.source, 0, 0, decoded.width, decoded.height);
  return canvas;
};

export const renderDecodedSourceToCanvas = (
  decoded,
  plan,
  { createCanvas = createBrowserCanvas } = {}
) => {
  const canvas = createCanvas(plan.output.width, plan.output.height);
  const context = requireCanvasContext(canvas);
  const source = renderOrientedSource(decoded, createCanvas);
  context.drawImage(
    source,
    plan.source.x,
    plan.source.y,
    plan.source.width,
    plan.source.height,
    0,
    0,
    plan.output.width,
    plan.output.height
  );
  return canvas;
};

const encodeCanvasAsBlob = (canvas, contentType, quality) => new Promise(
  (resolve, reject) => {
    if (typeof canvas?.toBlob !== 'function') {
      reject(new Task07MediaPipelineError('Canvas blob encoding is unavailable.', {
        code: 'canvas-encoding-unavailable',
        stage: 'generate',
      }));
      return;
    }
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Task07MediaPipelineError('Browser failed to encode a media variant.', {
          code: 'variant-encoding-failed',
          stage: 'generate',
        }));
        return;
      }
      resolve(blob);
    }, contentType, quality);
  }
);

const waitForMediaEvent = (
  target,
  successEvents,
  errorEvents,
  signal
) => new Promise((resolve, reject) => {
  if (signal?.aborted) {
    reject(createTask07AbortError(signal.reason));
    return;
  }
  const cleanup = () => {
    successEvents.forEach((eventName) => target.removeEventListener(eventName, handleSuccess));
    errorEvents.forEach((eventName) => target.removeEventListener(eventName, handleError));
    signal?.removeEventListener('abort', handleAbort);
  };
  const handleSuccess = () => {
    cleanup();
    resolve();
  };
  const handleError = () => {
    cleanup();
    reject(new Task07MediaPipelineError('Browser could not decode the selected media.', {
      code: 'media-decode-failed',
      stage: 'generate',
    }));
  };
  const handleAbort = () => {
    cleanup();
    reject(createTask07AbortError(signal?.reason));
  };
  successEvents.forEach((eventName) => target.addEventListener(eventName, handleSuccess, { once: true }));
  errorEvents.forEach((eventName) => target.addEventListener(eventName, handleError, { once: true }));
  signal?.addEventListener('abort', handleAbort, { once: true });
});

const decodeImageWithElement = async (file, { signal } = {}) => {
  if (
    typeof Image === 'undefined'
    || typeof URL === 'undefined'
    || typeof URL.createObjectURL !== 'function'
  ) {
    throw new Task07MediaPipelineError('Browser image decoding is unavailable.', {
      code: 'image-decoder-unavailable',
      stage: 'generate',
    });
  }
  const objectUrl = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = 'async';
  try {
    const loaded = waitForMediaEvent(image, ['load'], ['error'], signal);
    image.src = objectUrl;
    await loaded;
    throwIfTask07Aborted(signal);
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      orientationDegrees: 0,
      dispose: () => URL.revokeObjectURL(objectUrl),
    };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
};

export const decodeImageFile = async (file, { signal } = {}) => {
  throwIfTask07Aborted(signal);
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      if (signal?.aborted) {
        bitmap.close?.();
        throw createTask07AbortError(signal.reason);
      }
      throwIfTask07Aborted(signal);
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        orientationDegrees: 0,
        dispose: () => bitmap.close?.(),
      };
    } catch (error) {
      if (signal?.aborted) throw createTask07AbortError(signal.reason);
    }
  }
  return decodeImageWithElement(file, { signal });
};

export const decodeMp4PosterFrame = async (
  file,
  { signal, posterFrameMs = 0 } = {}
) => {
  throwIfTask07Aborted(signal);
  if (
    typeof document === 'undefined'
    || typeof URL === 'undefined'
    || typeof URL.createObjectURL !== 'function'
  ) {
    throw new Task07MediaPipelineError('Browser video decoding is unavailable.', {
      code: 'video-decoder-unavailable',
      stage: 'generate',
    });
  }
  const video = document.createElement('video');
  const objectUrl = URL.createObjectURL(file);
  video.muted = true;
  video.playsInline = true;
  video.preload = 'metadata';
  try {
    const metadataLoaded = waitForMediaEvent(video, ['loadedmetadata'], ['error'], signal);
    video.src = objectUrl;
    await metadataLoaded;
    throwIfTask07Aborted(signal);
    const durationMs = Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : 0;
    const latestFrameMs = Math.max(0, durationMs - 50);
    const frameTimeMs = Math.min(Math.max(0, Number(posterFrameMs) || 0), latestFrameMs);
    if (frameTimeMs > 0) {
      const seeked = waitForMediaEvent(video, ['seeked'], ['error'], signal);
      video.currentTime = frameTimeMs / 1000;
      await seeked;
    } else if (video.readyState < 2) {
      await waitForMediaEvent(video, ['loadeddata'], ['error'], signal);
    }
    throwIfTask07Aborted(signal);
    return {
      source: video,
      width: video.videoWidth,
      height: video.videoHeight,
      durationMs,
      frameTimeMs,
      orientationDegrees: 0,
      dispose: () => {
        video.pause();
        video.removeAttribute('src');
        video.load();
        URL.revokeObjectURL(objectUrl);
      },
    };
  } catch (error) {
    video.removeAttribute('src');
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
};

const validateSourceAgainstContract = (file, decoded, upload) => {
  const sourceContract = upload?.contract?.source;
  const contentType = normalizeContentType(file?.type);
  if (
    !sourceContract
    || !Array.isArray(sourceContract.contentTypes)
    || !sourceContract.contentTypes.includes(contentType)
  ) {
    throw new Task07UnsupportedMediaError('The selected media type is not supported by the server contract.');
  }
  if (Number(file?.size || 0) <= 0 || Number(file.size) > Number(sourceContract.maxBytes)) {
    throw new Task07MediaPipelineError('The selected media exceeds the server source byte budget.', {
      code: 'source-byte-budget-exceeded',
      stage: 'generate',
    });
  }
  if (!decoded) return;
  const dimensions = getOrientedDimensions(decoded);
  if (
    dimensions.width > Number(sourceContract.maxWidth)
    || dimensions.height > Number(sourceContract.maxHeight)
    || dimensions.width * dimensions.height > Number(sourceContract.maxPixels)
  ) {
    throw new Task07MediaPipelineError('The selected media exceeds the server dimension budget.', {
      code: 'source-dimension-budget-exceeded',
      stage: 'generate',
    });
  }
  if (
    sourceContract.maxDurationMs !== null
    && (
      !Number.isSafeInteger(decoded.durationMs)
      || decoded.durationMs <= 0
      || decoded.durationMs > Number(sourceContract.maxDurationMs)
    )
  ) {
    throw new Task07MediaPipelineError('The selected video exceeds the server duration budget.', {
      code: 'source-duration-budget-exceeded',
      stage: 'generate',
    });
  }
};

const validateUploadContract = (file, upload) => {
  if (!file || typeof file.type !== 'string' || typeof file.size !== 'number') {
    throw new TypeError('A browser File or Blob is required.');
  }
  if (
    !upload
    || typeof upload.assetId !== 'string'
    || typeof upload.originalPath !== 'string'
    || !upload.contract
    || typeof upload.variants !== 'object'
    || Array.isArray(upload.variants)
  ) {
    throw new Task07MediaPipelineError('Server media upload plan is malformed.', {
      code: 'invalid-upload-plan',
      stage: 'generate',
    });
  }
  if (normalizeContentType(file.type) !== normalizeContentType(upload.sourceContentType)) {
    throw new Task07MediaPipelineError('Selected media no longer matches the prepared upload.', {
      code: 'source-content-type-changed',
      stage: 'generate',
    });
  }
};

export const encodeVariantWithinBudget = async ({
  decoded,
  variantContract,
  signal,
  renderToCanvas = renderDecodedSourceToCanvas,
  encodeCanvas = encodeCanvasAsBlob,
  createCanvas = createBrowserCanvas,
}) => {
  const basePlan = buildVariantRenderPlan(decoded, variantContract);
  const attempts = buildVariantEncodingAttempts(variantContract);
  for (let index = 0; index < attempts.length; index += 1) {
    throwIfTask07Aborted(signal);
    const attempt = attempts[index];
    const plan = scaleRenderPlan(basePlan, attempt.scale);
    const canvas = renderToCanvas(decoded, plan, { createCanvas });
    const blob = await encodeCanvas(
      canvas,
      variantContract.contentType,
      attempt.quality,
      signal,
      { attemptIndex: index, plan }
    );
    if (
      blob
      && Number(blob.size) > 0
      && Number(blob.size) <= Number(variantContract.maxBytes)
      && normalizeContentType(blob.type || variantContract.contentType)
        === normalizeContentType(variantContract.contentType)
    ) {
      return {
        blob,
        width: plan.output.width,
        height: plan.output.height,
        quality: attempt.quality,
        scale: attempt.scale,
        attemptCount: index + 1,
      };
    }
  }
  throw new Task07MediaPipelineError(
    'Browser could not encode the variant within the server byte budget.',
    {
      code: 'variant-byte-budget-exceeded',
      stage: 'generate',
    }
  );
};

export const generateMediaDerivatives = async ({
  file,
  upload,
  signal,
  onProgress,
}, {
  decodeImage = decodeImageFile,
  decodeVideo = decodeMp4PosterFrame,
  encodeVariant = encodeVariantWithinBudget,
  renderToCanvas = renderDecodedSourceToCanvas,
  encodeCanvas = encodeCanvasAsBlob,
  createCanvas = createBrowserCanvas,
} = {}) => {
  throwIfTask07Aborted(signal);
  validateUploadContract(file, upload);
  const contentType = normalizeContentType(file.type);
  const variantNames = Object.keys(upload.variants).sort();
  const contractVariantNames = Object.keys(upload.contract?.variants || {}).sort();
  if (
    upload.passthrough
    && variantNames.length > 0
  ) {
    throw new Task07MediaPipelineError('Passthrough upload declared unexpected variants.', {
      code: 'invalid-passthrough-plan',
      stage: 'generate',
    });
  }
  if (!upload.passthrough && variantNames.some((name) => !contractVariantNames.includes(name))) {
    throw new Task07MediaPipelineError('Upload plan declares a variant absent from its contract.', {
      code: 'invalid-variant-plan',
      stage: 'generate',
    });
  }

  validateSourceAgainstContract(file, null, upload);
  const original = {
    blob: file,
    contentType,
    bytes: Number(file.size),
  };
  if (upload.passthrough) {
    if (contentType !== 'image/gif') {
      throw new Task07UnsupportedMediaError('Only GIF images may use Task 07 passthrough.');
    }
    return { original, variants: {} };
  }

  let decoded;
  if (contentType.startsWith('image/')) {
    decoded = await decodeImage(file, { signal });
  } else if (contentType === 'video/mp4') {
    decoded = await decodeVideo(file, {
      signal,
      posterFrameMs: upload.contract.posterFrameMs,
    });
  } else {
    throw new Task07UnsupportedMediaError(
      contentType === 'video/webm'
        ? 'WebM is unsupported; keep the legacy original fallback.'
        : 'The selected media format is unsupported.'
    );
  }

  try {
    validateSourceAgainstContract(file, decoded, upload);
    const variants = {};
    for (let index = 0; index < variantNames.length; index += 1) {
      throwIfTask07Aborted(signal);
      const name = variantNames[index];
      const variantContract = upload.contract.variants[name];
      if (!variantContract) {
        throw new Task07MediaPipelineError(`Missing server contract for ${name}.`, {
          code: 'missing-variant-contract',
          stage: 'generate',
        });
      }
      const encoded = await encodeVariant({
        decoded,
        variantContract,
        signal,
        renderToCanvas,
        encodeCanvas,
        createCanvas,
      });
      variants[name] = {
        blob: encoded.blob,
        contentType: variantContract.contentType,
        bytes: encoded.blob.size,
        width: encoded.width,
        height: encoded.height,
      };
      onProgress?.({
        stage: 'generate',
        variant: name,
        completed: index + 1,
        total: variantNames.length,
      });
    }
    return { original, variants };
  } finally {
    decoded?.dispose?.();
  }
};
