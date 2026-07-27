import {
  buildVariantEncodingAttempts,
  buildVariantRenderPlan,
  encodeVariantWithinBudget,
  generateMediaDerivatives,
  getOrientedDimensions,
  TASK07_MAX_QUALITY_ATTEMPTS,
} from './mediaDerivatives';

const imageContract = ({
  fit = 'cover',
  width = 100,
  height = 100,
  maxBytes = 100,
  minScale = 0.7,
} = {}) => ({
  width,
  height,
  fit,
  quality: 80,
  maxBytes,
  contentType: 'image/webp',
  minScale,
});

const uploadPlan = ({
  contentType = 'image/jpeg',
  passthrough = false,
  variants = { thumbnail: 'media/v1/avatar/user/asset/derivatives/v1/thumbnail.webp' },
  contractVariants = { thumbnail: imageContract() },
  posterFrameMs = null,
} = {}) => ({
  schemaVersion: 1,
  contractVersion: 1,
  assetId: 'm_asset',
  kind: contentType.startsWith('video/') ? 'map-video' : 'avatar',
  ownerUid: 'user',
  entityId: 'entity',
  sourceContentType: contentType,
  originalPath: `media/v1/avatar/user/asset/original/source.${contentType === 'image/gif' ? 'gif' : 'jpg'}`,
  variants,
  passthrough,
  contract: {
    kind: contentType.startsWith('video/') ? 'map-video' : 'avatar',
    source: {
      contentTypes: [contentType],
      unsupportedContentTypes: ['video/webm'],
      passthroughContentTypes: contentType === 'image/gif' ? ['image/gif'] : [],
      maxBytes: 1024,
      maxWidth: 1000,
      maxHeight: 1000,
      maxPixels: 1_000_000,
      maxDurationMs: contentType.startsWith('video/') ? 20_000 : null,
    },
    variants: contractVariants,
    posterFrameMs,
  },
});

describe('Task 07 browser media derivatives', () => {
  test('builds orientation-aware cover and inside render plans', () => {
    expect(getOrientedDimensions({
      width: 400,
      height: 200,
      orientationDegrees: 90,
    })).toEqual({ width: 200, height: 400 });

    const cover = buildVariantRenderPlan({
      width: 400,
      height: 200,
      orientationDegrees: 90,
    }, imageContract());
    expect(cover.output).toEqual({ width: 100, height: 100 });
    expect(cover.source).toEqual({
      x: 0,
      y: 100,
      width: 200,
      height: 200,
    });

    const inside = buildVariantRenderPlan({
      width: 400,
      height: 200,
      orientationDegrees: 90,
    }, imageContract({ fit: 'inside' }));
    expect(inside.output).toEqual({ width: 50, height: 100 });
  });

  test('uses bounded quality attempts before falling back to a smaller scale', async () => {
    const contract = imageContract({ maxBytes: 100 });
    const attempts = buildVariantEncodingAttempts(contract);
    const renderToCanvas = jest.fn((_decoded, plan) => ({ plan }));
    const encodeCanvas = jest.fn((_canvas, _type, _quality, _signal, context) => ({
      size: context.attemptIndex < TASK07_MAX_QUALITY_ATTEMPTS ? 200 : 90,
      type: 'image/webp',
    }));
    const result = await encodeVariantWithinBudget({
      decoded: {
        source: {},
        width: 400,
        height: 200,
        orientationDegrees: 0,
      },
      variantContract: contract,
      renderToCanvas,
      encodeCanvas,
    });

    expect(attempts).toHaveLength(12);
    expect(result.attemptCount).toBe(TASK07_MAX_QUALITY_ATTEMPTS + 1);
    expect(result.scale).toBeLessThan(1);
    expect(result.width).toBe(85);
    expect(result.height).toBe(85);
  });

  test('never encodes below the server-declared minimum scale', () => {
    const attempts = buildVariantEncodingAttempts(imageContract({
      minScale: 0.85,
    }));
    expect(attempts).toHaveLength(8);
    expect(Math.min(...attempts.map(({ scale }) => scale))).toBe(0.85);
  });

  test('passes GIF originals through without decoding or generating variants', async () => {
    const file = new Blob(['gif-source'], { type: 'image/gif' });
    const decodeImage = jest.fn();
    const generated = await generateMediaDerivatives({
      file,
      upload: uploadPlan({
        contentType: 'image/gif',
        passthrough: true,
        variants: {},
        contractVariants: {},
      }),
    }, { decodeImage });

    expect(generated.original.blob).toBe(file);
    expect(generated.variants).toEqual({});
    expect(decodeImage).not.toHaveBeenCalled();
  });

  test('uses the server poster frame for MP4 and emits only its declared poster', async () => {
    const file = new Blob(['mp4-source'], { type: 'video/mp4' });
    const decodeVideo = jest.fn(async (_file, options) => {
      expect(options.posterFrameMs).toBe(1000);
      return {
        source: {},
        width: 640,
        height: 360,
        durationMs: 10_000,
        orientationDegrees: 0,
        dispose: jest.fn(),
      };
    });
    const encodeVariant = jest.fn(async () => ({
      blob: { size: 80, type: 'image/webp' },
      width: 100,
      height: 100,
    }));
    const generated = await generateMediaDerivatives({
      file,
      upload: uploadPlan({
        contentType: 'video/mp4',
        variants: { poster: 'media/v1/map-video/user/asset/derivatives/v1/poster.webp' },
        contractVariants: { poster: imageContract() },
        posterFrameMs: 1000,
      }),
    }, { decodeVideo, encodeVariant });

    expect(Object.keys(generated.variants)).toEqual(['poster']);
    expect(decodeVideo).toHaveBeenCalledTimes(1);
  });

  test('rejects WebM and unsupported source formats without a silent transcode', async () => {
    const file = new Blob(['webm-source'], { type: 'video/webm' });
    await expect(generateMediaDerivatives({
      file,
      upload: uploadPlan({
        contentType: 'video/webm',
        variants: {},
        contractVariants: {},
      }),
    })).rejects.toMatchObject({
      name: 'Task07UnsupportedMediaError',
      code: 'unsupported-media',
    });
  });
});
