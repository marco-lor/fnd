import { Task07MediaPipelineError } from './mediaErrors';
import {
  prepareTask07MediaUpload,
  reconcileTask07MediaAttachment,
  retryTask07MediaCleanup,
  runTask07MediaPipeline,
  TASK07_MEDIA_CALLABLES,
  waitForTask07MediaReady,
} from './mediaPipeline';

const assetId = `m_${'a'.repeat(40)}`;
const previousAssetId = `m_${'b'.repeat(40)}`;
const file = new Blob(['source'], { type: 'image/jpeg' });
const uploadPlan = {
  assetId,
  purpose: 'avatar',
  targetKind: 'profile',
  sourcePath: `media_uploads/user-1/${assetId}/source`,
  sourceContentType: file.type,
  sourceBytes: file.size,
  sourceMetadata: { task07AssetId: assetId, task07Role: 'source' },
  cacheControl: 'private, no-store',
  contentDisposition: 'inline',
  expiresInSeconds: 3600,
};
const readyStatus = {
  ok: true,
  assetId,
  state: 'ready',
  ready: true,
  attached: false,
  generation: '7',
};
const attachedStatus = {
  ...readyStatus,
  state: 'attached',
  attached: true,
};
const confirmation = {
  ok: true,
  assetId,
  state: 'attached',
  replay: false,
  retirement: {
    requested: true,
    assetId: previousAssetId,
    state: 'superseded',
  },
};
const freshPrepareResult = {
  ok: true,
  replay: false,
  state: 'intent',
  sourcePresent: false,
  upload: uploadPlan,
};

const createHarness = ({
  failAt = null,
  status = readyStatus,
  prepareResult = freshPrepareResult,
  reconciliation = { attached: false, attempts: 3, status: readyStatus },
} = {}) => {
  const order = [];
  const invokeCallable = jest.fn(async (name, payload) => {
    order.push(name);
    if (name === TASK07_MEDIA_CALLABLES.prepare) {
      if (failAt === 'prepare') throw new Error('prepare failed');
      return prepareResult;
    }
    if (name === TASK07_MEDIA_CALLABLES.attach) {
      if (failAt === 'attach') throw new Error('attach response unavailable');
      expect(payload).toEqual({ assetId, expectedRevision: 4 });
      return confirmation;
    }
    if (name === TASK07_MEDIA_CALLABLES.abandon) {
      return { ok: true, assetId, state: 'cleanup-pending' };
    }
    if (name === TASK07_MEDIA_CALLABLES.retryCleanup) {
      return { ok: true, assetId: payload.assetId, state: 'pending' };
    }
    throw new Error(`Unexpected callable: ${name}`);
  });
  const upload = jest.fn(async ({ upload: intent }) => {
    order.push('upload-source');
    expect(intent).toBe(uploadPlan);
    if (failAt === 'upload') throw new Error('upload failed');
    return { entries: [{ role: 'source', path: intent.sourcePath }] };
  });
  const waitForReady = jest.fn(async (receivedAssetId) => {
    order.push(TASK07_MEDIA_CALLABLES.status);
    expect(receivedAssetId).toBe(assetId);
    if (failAt === 'process') {
      throw new Task07MediaPipelineError('processor rejected source', {
        code: 'invalid-media',
        stage: 'process',
        assetId,
      });
    }
    return status;
  });
  const reconcileAttachment = jest.fn(async (receivedAssetId) => {
    expect(receivedAssetId).toBe(assetId);
    return reconciliation;
  });
  return { order, invokeCallable, upload, waitForReady, reconcileAttachment };
};

const runWithHarness = (harness, extra = {}) => runTask07MediaPipeline({
  file,
  ownerUid: 'user-1',
  entityId: 'user-1',
  operationId: 'avatar:entity:revision-0001',
  kind: 'avatar',
  previousAssetId,
  expectedRevision: 4,
  ...extra,
}, harness);

describe('Task 07 server-authoritative media orchestration', () => {
  test('uploads only the staging source, polls status, and asks the server to attach', async () => {
    const harness = createHarness();
    const result = await runWithHarness(harness);

    expect(harness.order).toEqual([
      TASK07_MEDIA_CALLABLES.prepare,
      'upload-source',
      TASK07_MEDIA_CALLABLES.status,
      TASK07_MEDIA_CALLABLES.attach,
    ]);
    expect(harness.invokeCallable.mock.calls[0]).toEqual([
      TASK07_MEDIA_CALLABLES.prepare,
      {
        ownerUid: 'user-1',
        entityId: 'user-1',
        operationId: 'avatar:entity:revision-0001',
        kind: 'avatar',
        sourceContentType: 'image/jpeg',
        sourceBytes: file.size,
        previousAssetId,
      },
    ]);
    expect(result).toEqual({
      assetId,
      upload: { entries: [{ role: 'source', path: uploadPlan.sourcePath }] },
      status: readyStatus,
      confirmation,
    });
    expect(JSON.stringify(result)).not.toMatch(/downloadURL|bearer|authorization/i);
  });

  test.each([
    ['processing', true, readyStatus, true],
    ['ready', false, readyStatus, true],
    ['attached', false, attachedStatus, false],
  ])(
    'resumes a replayed %s operation without re-uploading the staging source',
    async (prepareState, sourcePresent, status, expectsAttach) => {
      const harness = createHarness({
        prepareResult: {
          ok: true,
          replay: true,
          state: prepareState,
          sourcePresent,
          upload: uploadPlan,
        },
        status,
      });

      await expect(runWithHarness(harness)).resolves.toMatchObject({
        assetId,
        upload: { entries: [] },
        status,
      });
      expect(harness.upload).not.toHaveBeenCalled();
      expect(harness.order).toEqual([
        TASK07_MEDIA_CALLABLES.prepare,
        TASK07_MEDIA_CALLABLES.status,
        ...(expectsAttach ? [TASK07_MEDIA_CALLABLES.attach] : []),
      ]);
    }
  );

  test('resumes a replayed intent when the server confirms the staging source exists', async () => {
    const harness = createHarness({
      prepareResult: {
        ok: true,
        replay: true,
        state: 'intent',
        sourcePresent: true,
        upload: uploadPlan,
      },
    });

    await expect(runWithHarness(harness)).resolves.toMatchObject({
      assetId,
      upload: { entries: [] },
    });
    expect(harness.upload).not.toHaveBeenCalled();
  });

  test('uploads a replayed intent only when the server confirms its source is absent', async () => {
    const harness = createHarness({
      prepareResult: {
        ok: true,
        replay: true,
        state: 'intent',
        sourcePresent: false,
        upload: uploadPlan,
      },
    });

    await runWithHarness(harness);
    expect(harness.upload).toHaveBeenCalledTimes(1);
  });

  test('fails closed without cleanup when prepare omits the replay/source-presence contract', async () => {
    const harness = createHarness({
      prepareResult: { ok: true, state: 'intent', replay: false, upload: uploadPlan },
    });

    await expect(runWithHarness(harness)).rejects.toMatchObject({
      code: 'invalid-prepare-response',
      stage: 'prepare',
      assetId: null,
      abandonment: null,
    });
    expect(harness.upload).not.toHaveBeenCalled();
    expect(harness.order).toEqual([TASK07_MEDIA_CALLABLES.prepare]);
  });

  test('hash-binds the source byte count and explicit item reference scope', async () => {
    const invokeCallable = jest.fn(async () => ({
      ok: true,
      upload: { assetId },
    }));
    await prepareTask07MediaUpload({
      ownerUid: 'dm-1',
      entityId: 'catalog-item-1',
      operationId: 'item:catalog-item-1:revision-0001',
      kind: 'item',
      sourceContentType: 'image/png',
      sourceBytes: 321,
      referenceScope: 'global-catalog',
    }, { invokeCallable });

    expect(invokeCallable).toHaveBeenCalledWith(TASK07_MEDIA_CALLABLES.prepare, {
      ownerUid: 'dm-1',
      entityId: 'catalog-item-1',
      operationId: 'item:catalog-item-1:revision-0001',
      kind: 'item',
      sourceContentType: 'image/png',
      sourceBytes: 321,
      referenceScope: 'global-catalog',
    });
  });

  test('rejects item media without a reference scope before allocating an asset', async () => {
    const harness = createHarness();
    await expect(runWithHarness(harness, { kind: 'item' }))
      .rejects.toThrow('explicit referenceScope');
    expect(harness.invokeCallable).not.toHaveBeenCalled();
    expect(harness.upload).not.toHaveBeenCalled();
    expect(harness.waitForReady).not.toHaveBeenCalled();
  });

  test.each(['upload', 'process'])(
    'abandons the allocated asset when %s fails before attachment',
    async (failAt) => {
      const harness = createHarness({ failAt });
      await expect(runWithHarness(harness)).rejects.toMatchObject({
        stage: failAt,
        assetId,
        committed: false,
        commitAttempted: false,
        abandonment: { ok: true },
      });
      expect(harness.order.at(-1)).toBe(TASK07_MEDIA_CALLABLES.abandon);
      expect(harness.order).not.toContain(TASK07_MEDIA_CALLABLES.attach);
    }
  );

  test('rolls back a newly prepared target only after server abandonment succeeds', async () => {
    const harness = createHarness({ failAt: 'upload' });
    const prepareEntity = jest.fn(async () => harness.order.push('prepare-target'));
    const rollbackPreparedEntity = jest.fn(async () => harness.order.push('rollback-target'));

    await expect(runWithHarness(harness, {
      prepareEntity,
      rollbackPreparedEntity,
    })).rejects.toMatchObject({
      stage: 'upload',
      abandonment: { ok: true },
      targetRollback: { ok: true },
    });
    expect(harness.order).toEqual([
      'prepare-target',
      TASK07_MEDIA_CALLABLES.prepare,
      'upload-source',
      TASK07_MEDIA_CALLABLES.abandon,
      'rollback-target',
    ]);
  });

  test('does not abandon after an ambiguous server attachment attempt', async () => {
    const harness = createHarness({ failAt: 'attach' });
    await expect(runWithHarness(harness)).rejects.toMatchObject({
      stage: 'attach',
      assetId,
      committed: false,
      commitAttempted: true,
      abandonment: null,
    });
    expect(harness.reconcileAttachment).toHaveBeenCalledTimes(1);
    expect(harness.order).not.toContain(TASK07_MEDIA_CALLABLES.abandon);
  });

  test('resolves an ambiguous attach response when status reconciliation confirms attachment', async () => {
    const harness = createHarness({
      failAt: 'attach',
      reconciliation: { attached: true, attempts: 2, status: attachedStatus },
    });

    await expect(runWithHarness(harness)).resolves.toEqual({
      assetId,
      upload: { entries: [{ role: 'source', path: uploadPlan.sourcePath }] },
      status: attachedStatus,
      confirmation: {
        ok: true,
        assetId,
        state: 'attached',
        replay: true,
        reconciled: true,
      },
    });
    expect(harness.reconcileAttachment).toHaveBeenCalledTimes(1);
    expect(harness.order).not.toContain(TASK07_MEDIA_CALLABLES.abandon);
  });

  test('preserves abort semantics without abandonment after attach was attempted', async () => {
    const harness = createHarness({ failAt: 'attach' });
    const abortError = new Error('view-unmounted');
    abortError.name = 'AbortError';
    abortError.code = 'aborted';
    harness.reconcileAttachment.mockRejectedValueOnce(abortError);

    await expect(runWithHarness(harness)).rejects.toMatchObject({
      code: 'aborted',
      stage: 'attach',
      assetId,
      committed: false,
      commitAttempted: true,
      abandonment: null,
    });
    expect(harness.order).not.toContain(TASK07_MEDIA_CALLABLES.abandon);
  });

  test('abandons the allocated asset when the caller aborts during processing', async () => {
    const harness = createHarness();
    const controller = new AbortController();
    harness.waitForReady.mockImplementationOnce(async (receivedAssetId, options) => {
      harness.order.push(TASK07_MEDIA_CALLABLES.status);
      expect(receivedAssetId).toBe(assetId);
      expect(options.signal).toBe(controller.signal);
      controller.abort('view-unmounted');
      const error = new Error('view-unmounted');
      error.name = 'AbortError';
      error.code = 'aborted';
      throw error;
    });

    await expect(runWithHarness(harness, { signal: controller.signal }))
      .rejects.toMatchObject({
        code: 'aborted',
        stage: 'process',
        assetId,
        abandonment: { ok: true },
      });
    expect(harness.order).toEqual([
      TASK07_MEDIA_CALLABLES.prepare,
      'upload-source',
      TASK07_MEDIA_CALLABLES.status,
      TASK07_MEDIA_CALLABLES.abandon,
    ]);
  });

  test('does not call attach again when status reports the asset already attached', async () => {
    const harness = createHarness({ status: attachedStatus });
    await expect(runWithHarness(harness)).resolves.toMatchObject({
      assetId,
      status: attachedStatus,
      confirmation: { ok: true, assetId, state: 'attached', replay: true },
    });
    expect(harness.order).toEqual([
      TASK07_MEDIA_CALLABLES.prepare,
      'upload-source',
      TASK07_MEDIA_CALLABLES.status,
    ]);
  });

  test('polls processing status serially until the processor reports ready', async () => {
    const invokeCallable = jest.fn()
      .mockResolvedValueOnce({ ok: true, assetId, state: 'processing', ready: false })
      .mockResolvedValueOnce(readyStatus);
    const delay = jest.fn(async () => {});
    const progress = [];

    await expect(waitForTask07MediaReady(assetId, {
      invokeCallable,
      delay,
      now: () => 0,
      pollIntervalMs: 25,
      timeoutMs: 100,
      onProgress: (value) => progress.push(value),
    })).resolves.toBe(readyStatus);
    expect(invokeCallable).toHaveBeenCalledTimes(2);
    expect(invokeCallable).toHaveBeenNthCalledWith(
      1,
      TASK07_MEDIA_CALLABLES.status,
      { assetId }
    );
    expect(delay).toHaveBeenCalledTimes(1);
    expect(progress.map(({ state }) => state)).toEqual(['processing', 'ready']);
  });

  test('reconciles an ambiguous attachment with bounded serial status checks', async () => {
    const invokeCallable = jest.fn()
      .mockResolvedValueOnce(readyStatus)
      .mockResolvedValueOnce(attachedStatus);
    const delay = jest.fn(async () => {});
    const progress = [];

    await expect(reconcileTask07MediaAttachment(assetId, {
      invokeCallable,
      delay,
      maxAttempts: 3,
      pollIntervalMs: 25,
      onProgress: (value) => progress.push(value),
    })).resolves.toEqual({
      attached: true,
      attempts: 2,
      status: attachedStatus,
    });
    expect(invokeCallable).toHaveBeenCalledTimes(2);
    expect(invokeCallable).toHaveBeenNthCalledWith(
      1,
      TASK07_MEDIA_CALLABLES.status,
      { assetId }
    );
    expect(delay).toHaveBeenCalledTimes(1);
    expect(progress).toEqual([
      expect.objectContaining({ stage: 'attach-reconcile', attempts: 1, attached: false }),
      expect.objectContaining({ stage: 'attach-reconcile', attempts: 2, attached: true }),
    ]);
  });

  test('leaves a ready non-attached asset unresolved after the bounded reconciliation limit', async () => {
    const invokeCallable = jest.fn(async () => readyStatus);
    const delay = jest.fn(async () => {});

    await expect(reconcileTask07MediaAttachment(assetId, {
      invokeCallable,
      delay,
      maxAttempts: 3,
      pollIntervalMs: 25,
    })).resolves.toEqual({
      attached: false,
      attempts: 3,
      status: readyStatus,
    });
    expect(invokeCallable).toHaveBeenCalledTimes(3);
    expect(delay).toHaveBeenCalledTimes(2);
  });

  test('stops attach reconciliation when its abort signal is raised', async () => {
    const controller = new AbortController();
    const invokeCallable = jest.fn(async () => {
      controller.abort('view-unmounted');
      return attachedStatus;
    });
    const delay = jest.fn(async () => {});

    await expect(reconcileTask07MediaAttachment(assetId, {
      invokeCallable,
      delay,
      signal: controller.signal,
    })).rejects.toMatchObject({
      name: 'AbortError',
      code: 'aborted',
    });
    expect(invokeCallable).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
  });

  test('keeps bounded polling while a failed processor attempt is automatically retryable', async () => {
    const retryableFailure = {
      ok: true,
      assetId,
      state: 'failed',
      ready: false,
      attached: false,
      retryable: true,
      errorCode: 'processor-internal-failure',
    };
    const invokeCallable = jest.fn()
      .mockResolvedValueOnce(retryableFailure)
      .mockResolvedValueOnce({ ok: true, assetId, state: 'processing', ready: false })
      .mockResolvedValueOnce(readyStatus);
    const delay = jest.fn(async () => {});
    const progress = [];

    await expect(waitForTask07MediaReady(assetId, {
      invokeCallable,
      delay,
      now: () => 0,
      pollIntervalMs: 25,
      timeoutMs: 100,
      onProgress: (value) => progress.push(value),
    })).resolves.toBe(readyStatus);
    expect(invokeCallable).toHaveBeenCalledTimes(3);
    expect(delay).toHaveBeenCalledTimes(2);
    expect(progress).toEqual([
      expect.objectContaining({ state: 'failed', retryable: true, attempts: 1 }),
      expect.objectContaining({ state: 'processing', retryable: false, attempts: 2 }),
      expect.objectContaining({ state: 'ready', retryable: false, attempts: 3 }),
    ]);
  });

  test('still applies the processing timeout while retryable failures remain pending', async () => {
    const invokeCallable = jest.fn(async () => ({
      ok: true,
      assetId,
      state: 'failed',
      ready: false,
      retryable: true,
      errorCode: 'processor-internal-failure',
    }));
    const delay = jest.fn();
    const now = jest.fn()
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(100);

    await expect(waitForTask07MediaReady(assetId, {
      invokeCallable,
      delay,
      now,
      timeoutMs: 100,
    })).rejects.toMatchObject({
      code: 'processing-timeout',
      stage: 'process',
      assetId,
    });
    expect(invokeCallable).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
  });

  test('stops polling and reports the processor terminal failure code', async () => {
    const invokeCallable = jest.fn(async () => ({
      ok: true,
      assetId,
      state: 'rejected',
      ready: false,
      errorCode: 'unsupported-media',
    }));
    const delay = jest.fn();

    await expect(waitForTask07MediaReady(assetId, { invokeCallable, delay }))
      .rejects.toMatchObject({
        code: 'unsupported-media',
        stage: 'process',
        assetId,
      });
    expect(delay).not.toHaveBeenCalled();
  });

  test('uses retry cleanup only when explicitly requested', async () => {
    const harness = createHarness();
    await expect(retryTask07MediaCleanup(previousAssetId, harness))
      .resolves.toMatchObject({ ok: true, state: 'pending' });
    expect(harness.order).toEqual([TASK07_MEDIA_CALLABLES.retryCleanup]);
    expect(harness.order).not.toContain(TASK07_MEDIA_CALLABLES.retire);
  });
});
