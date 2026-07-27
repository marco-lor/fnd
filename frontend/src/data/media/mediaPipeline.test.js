import {
  prepareTask07MediaUpload,
  retryTask07MediaCleanup,
  runTask07MediaPipeline,
  TASK07_MEDIA_CALLABLES,
} from './mediaPipeline';

const file = new Blob(['source'], { type: 'image/jpeg' });
const uploadPlan = {
  schemaVersion: 1,
  contractVersion: 1,
  assetId: 'm_new',
  kind: 'avatar',
  ownerUid: 'user-1',
  entityId: 'avatar',
  sourceContentType: 'image/jpeg',
  originalPath: 'media/v1/avatar/user-1/m_new/original/source.jpg',
  variants: {},
  passthrough: false,
  contract: {
    kind: 'avatar',
    source: {
      contentTypes: ['image/jpeg'],
      passthroughContentTypes: [],
      maxBytes: 1024,
      maxWidth: 1000,
      maxHeight: 1000,
      maxPixels: 1_000_000,
      maxDurationMs: null,
    },
    variants: {},
    posterFrameMs: null,
  },
};
const media = {
  schemaVersion: 1,
  contractVersion: 1,
  assetId: 'm_new',
  kind: 'avatar',
  state: 'ready',
  original: {
    path: uploadPlan.originalPath,
    contentType: 'image/jpeg',
    bytes: file.size,
  },
  variants: {},
  processing: {
    authoritative: true,
    fallbackCode: null,
  },
};

const createHarness = ({
  failAt = null,
} = {}) => {
  const order = [];
  const invokeCallable = jest.fn(async (name, payload) => {
    order.push(name);
    if (name === TASK07_MEDIA_CALLABLES.prepare) {
      expect(payload.operationId).toBe('avatar:entity:revision-0001');
      return { ok: true, upload: uploadPlan };
    }
    if (name === TASK07_MEDIA_CALLABLES.finalize) {
      if (failAt === 'finalize') throw new Error('finalize failed');
      return { ok: true, media };
    }
    if (name === TASK07_MEDIA_CALLABLES.confirm) {
      if (failAt === 'confirm') throw new Error('confirm failed');
      return {
        ok: true,
        state: 'referenced',
        retirement: {
          requested: true,
          assetId: 'm_previous',
          state: 'superseded',
          replay: false,
          graceHours: 24,
        },
      };
    }
    if (name === TASK07_MEDIA_CALLABLES.abandon) {
      return { ok: true, state: 'cleanup-pending' };
    }
    if (name === TASK07_MEDIA_CALLABLES.retryCleanup) {
      return { ok: true, state: 'pending' };
    }
    throw new Error(`Unexpected callable: ${name}`);
  });
  const generate = jest.fn(async () => {
    order.push('generate');
    return {
      original: { blob: file, contentType: file.type },
      variants: {},
    };
  });
  const upload = jest.fn(async () => {
    order.push('upload');
    if (failAt === 'upload') throw new Error('upload failed');
    return {
      entries: [{ role: 'original', variant: null, path: uploadPlan.originalPath }],
    };
  });
  const commitEntity = jest.fn(async (value) => {
    order.push('commit');
    expect(value).toBe(media);
    if (failAt === 'commit') throw new Error('commit failed');
  });
  return {
    order,
    invokeCallable,
    generate,
    upload,
    commitEntity,
  };
};

const runWithHarness = (harness, extra = {}) => runTask07MediaPipeline({
  file,
  ownerUid: 'user-1',
  entityId: 'avatar',
  operationId: 'avatar:entity:revision-0001',
  kind: 'avatar',
  previousAssetId: 'm_previous',
  commitEntity: harness.commitEntity,
  ...extra,
}, harness);

describe('Task 07 media orchestration', () => {
  test('hash-binds replacement retirement and completes it atomically during confirm', async () => {
    const harness = createHarness();
    const result = await runWithHarness(harness);

    expect(harness.order).toEqual([
      TASK07_MEDIA_CALLABLES.prepare,
      'generate',
      'upload',
      TASK07_MEDIA_CALLABLES.finalize,
      'commit',
      TASK07_MEDIA_CALLABLES.confirm,
    ]);
    expect(harness.invokeCallable.mock.calls[0][1]).toMatchObject({
      previousAssetId: 'm_previous',
    });
    expect(result.media).toBe(media);
    expect(result.retirement).toMatchObject({
      requested: true,
      assetId: 'm_previous',
      state: 'superseded',
    });
    expect(JSON.stringify(result)).not.toMatch(/downloadURL|bearer|authorization/i);
  });

  test('hash-binds an explicit reference scope for item prepare requests', async () => {
    const invokeCallable = jest.fn(async () => ({
      ok: true,
      upload: { assetId: 'm_item' },
    }));
    await prepareTask07MediaUpload({
      ownerUid: 'dm-1',
      entityId: 'catalog-item-1',
      operationId: 'item:catalog-item-1:revision-0001',
      kind: 'item',
      sourceContentType: 'image/png',
      referenceScope: 'global-catalog',
    }, { invokeCallable });
    expect(invokeCallable).toHaveBeenCalledWith(
      TASK07_MEDIA_CALLABLES.prepare,
      {
        ownerUid: 'dm-1',
        entityId: 'catalog-item-1',
        operationId: 'item:catalog-item-1:revision-0001',
        kind: 'item',
        sourceContentType: 'image/png',
        referenceScope: 'global-catalog',
      }
    );
  });

  test('rejects item media without a reference scope before allocating an asset', async () => {
    const harness = createHarness();
    await expect(runWithHarness(harness, {
      kind: 'item',
    })).rejects.toThrow('explicit referenceScope');
    expect(harness.invokeCallable).not.toHaveBeenCalled();
    expect(harness.generate).not.toHaveBeenCalled();
    expect(harness.upload).not.toHaveBeenCalled();
    expect(harness.commitEntity).not.toHaveBeenCalled();
  });

  test.each(['upload', 'finalize'])(
    'abandons the prepared asset when %s fails before the entity commit attempt',
    async (failAt) => {
      const harness = createHarness({ failAt });
      await expect(runWithHarness(harness)).rejects.toMatchObject({
        stage: failAt,
        assetId: 'm_new',
        committed: false,
        abandonment: { ok: true },
      });
      expect(harness.order.at(-1)).toBe(TASK07_MEDIA_CALLABLES.abandon);
      expect(harness.order).not.toContain(TASK07_MEDIA_CALLABLES.confirm);
      expect(harness.order).not.toContain(TASK07_MEDIA_CALLABLES.retire);
    }
  );

  test('does not abandon after an ambiguous entity commit failure', async () => {
    const harness = createHarness({ failAt: 'commit' });
    await expect(runWithHarness(harness)).rejects.toMatchObject({
      stage: 'commit',
      assetId: 'm_new',
      committed: false,
      commitAttempted: true,
      abandonment: null,
    });
    expect(harness.order).not.toContain(TASK07_MEDIA_CALLABLES.abandon);
    expect(harness.order).not.toContain(TASK07_MEDIA_CALLABLES.confirm);
    expect(harness.order).not.toContain(TASK07_MEDIA_CALLABLES.retire);
  });

  test('never abandons the new asset after commit succeeds even when confirm fails', async () => {
    const harness = createHarness({ failAt: 'confirm' });
    await expect(runWithHarness(harness)).rejects.toMatchObject({
      stage: 'confirm',
      assetId: 'm_new',
      committed: true,
      abandonment: null,
      commitAttempted: true,
    });
    expect(harness.order).not.toContain(TASK07_MEDIA_CALLABLES.abandon);
    expect(harness.order).not.toContain(TASK07_MEDIA_CALLABLES.retire);
  });

  test('treats a missing atomic retirement result as a committed confirm failure', async () => {
    const harness = createHarness();
    harness.invokeCallable.mockImplementationOnce(async (name) => {
      harness.order.push(name);
      return { ok: true, upload: uploadPlan };
    });
    const baseInvoke = harness.invokeCallable.getMockImplementation();
    harness.invokeCallable.mockImplementation(async (name, payload) => {
      if (name === TASK07_MEDIA_CALLABLES.confirm) {
        harness.order.push(name);
        return { ok: true, state: 'referenced' };
      }
      return baseInvoke(name, payload);
    });
    await expect(runWithHarness(harness)).rejects.toMatchObject({
      code: 'invalid-confirm-retirement',
      stage: 'confirm',
      committed: true,
      commitAttempted: true,
    });
    expect(harness.order).not.toContain(TASK07_MEDIA_CALLABLES.abandon);
    expect(harness.order).not.toContain(TASK07_MEDIA_CALLABLES.retire);
  });

  test('finishes atomic confirmation when cancellation arrives after commit', async () => {
    const harness = createHarness();
    const controller = new AbortController();
    harness.commitEntity.mockImplementationOnce(async (value) => {
      harness.order.push('commit');
      expect(value).toBe(media);
      controller.abort('view unmounted after commit');
    });

    await expect(runWithHarness(harness, {
      signal: controller.signal,
    })).resolves.toMatchObject({
      assetId: 'm_new',
      confirmation: { ok: true, state: 'referenced' },
      retirement: { requested: true, assetId: 'm_previous', state: 'superseded' },
    });
    expect(harness.order).toEqual([
      TASK07_MEDIA_CALLABLES.prepare,
      'generate',
      'upload',
      TASK07_MEDIA_CALLABLES.finalize,
      'commit',
      TASK07_MEDIA_CALLABLES.confirm,
    ]);
  });

  test('abandons after cancellation once prepare has allocated an asset', async () => {
    const harness = createHarness();
    harness.generate.mockImplementationOnce(async () => {
      harness.order.push('generate');
      const error = new Error('cancelled');
      error.name = 'AbortError';
      throw error;
    });
    await expect(runWithHarness(harness)).rejects.toMatchObject({
      code: 'aborted',
      stage: 'generate',
      abandonment: { ok: true },
    });
    expect(harness.order).toEqual([
      TASK07_MEDIA_CALLABLES.prepare,
      'generate',
      TASK07_MEDIA_CALLABLES.abandon,
    ]);
  });

  test('uses retry cleanup only when explicitly requested', async () => {
    const harness = createHarness();
    await expect(retryTask07MediaCleanup('m_previous', harness)).resolves.toMatchObject({
      ok: true,
      state: 'pending',
    });
    expect(harness.order).toEqual([TASK07_MEDIA_CALLABLES.retryCleanup]);
    expect(harness.order).not.toContain(TASK07_MEDIA_CALLABLES.retire);
  });
});
