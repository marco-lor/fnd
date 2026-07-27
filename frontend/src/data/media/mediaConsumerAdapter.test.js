import { webcrypto } from 'node:crypto';
import { TextEncoder } from 'node:util';
import { Task07MediaPipelineError } from './mediaErrors';
import {
  TASK07_MEDIA_OPERATION_RECEIPT_STORAGE_KEY,
  Task07MediaOperationReceiptError,
  buildTask07MediaEntityPatch,
  buildTask07MediaOperationId,
  buildTask07MediaStableRevision,
  createTask07MediaOperationOwner,
  describeTask07ConsumerOutcome,
  getTask07PreviousAssetId,
  runTask07ConsumerUpload,
  runWithTask07MediaOperationReceipt,
  task07ConsumerNeedsAttention,
} from './mediaConsumerAdapter';

const file = {
  name: 'hero portrait.png',
  type: 'image/png',
  size: 1234,
  lastModified: 5678,
};
const previousAssetId = `m_${'a'.repeat(40)}`;
const assetId = `m_${'b'.repeat(40)}`;
const generatedPrefix = `media_assets/v1/signed-in/user-1/${assetId}/7/`;
const media = {
  schemaVersion: 1,
  contractVersion: 1,
  assetId,
  kind: 'avatar',
  state: 'ready',
  generation: '7',
  audience: 'signed-in',
  ownerUid: 'user-1',
  original: {
    path: `${generatedPrefix}original`,
    contentType: 'image/png',
    bytes: 1234,
    width: 400,
    height: 400,
    generation: '7',
  },
  variants: {},
};

const originalTextEncoder = global.TextEncoder;

beforeAll(() => {
  global.TextEncoder = TextEncoder;
});

afterAll(() => {
  global.TextEncoder = originalTextEncoder;
});

const createMemoryStorage = () => {
  const values = new Map();
  return {
    getItem: jest.fn((key) => values.get(key) ?? null),
    setItem: jest.fn((key, value) => values.set(key, value)),
    removeItem: jest.fn((key) => values.delete(key)),
    values,
  };
};

const readReceipts = (storage) => {
  const serialized = storage.values.get(
    TASK07_MEDIA_OPERATION_RECEIPT_STORAGE_KEY
  );
  return serialized ? JSON.parse(serialized).receipts : [];
};

const durableOperationInput = (overrides = {}) => ({
  actorUid: 'private-actor-uid',
  ownerUid: 'private-owner-uid',
  entityId: 'private-entity-id',
  kind: 'avatar',
  file,
  expectedRevision: 4,
  invoke: jest.fn().mockResolvedValue({ handled: true, status: 'complete' }),
  storage: createMemoryStorage(),
  cryptoImpl: webcrypto,
  now: () => 1_780_000_000_000,
  ...overrides,
});

describe('Task 07 media consumer adapter', () => {
  test('builds a stable bounded operation ID from the explicit upload revision', () => {
    const input = {
      kind: 'avatar',
      ownerUid: 'user-1',
      entityId: 'user-1',
      file,
      revision: 1700000000000,
    };
    const first = buildTask07MediaOperationId(input);
    const second = buildTask07MediaOperationId(input);

    expect(first).toBe(second);
    expect(first).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/);
    expect(first.length).toBeLessThanOrEqual(128);
    expect(buildTask07MediaOperationId({
      ...input,
      revision: 1700000000001,
    })).not.toBe(first);
  });

  test('does not invoke the pipeline when v1 writes are disabled', async () => {
    const runPipeline = jest.fn();

    await expect(runTask07ConsumerUpload({}, {
      enabled: false,
      runPipeline,
    })).resolves.toEqual({
      handled: false,
      status: 'legacy',
    });
    expect(runPipeline).not.toHaveBeenCalled();
  });

  test('passes the server attachment contract through without a client entity commit', async () => {
    const input = {
      file,
      ownerUid: 'user-1',
      entityId: 'user-1',
      operationId: 'task07:avatar:revision:0123456789abcdef',
      kind: 'avatar',
      previousAssetId,
      expectedRevision: 4,
    };
    const result = {
      assetId,
      upload: { entries: [{ role: 'source', path: `media_uploads/user-1/${assetId}/source` }] },
      status: { ok: true, assetId, state: 'ready', ready: true },
      confirmation: { ok: true, assetId, state: 'attached' },
    };
    const runPipeline = jest.fn(async (received) => {
      expect(received).toBe(input);
      expect(received).not.toHaveProperty('commitEntity');
      return result;
    });

    await expect(runTask07ConsumerUpload(input, {
      enabled: true,
      runPipeline,
    })).resolves.toEqual({
      ...result,
      handled: true,
      status: 'complete',
    });
    expect(runPipeline).toHaveBeenCalledTimes(1);
  });

  test('surfaces an interrupted result after confirmed server attachment', async () => {
    const error = new Task07MediaPipelineError('attach response interrupted', {
      code: 'unavailable',
      stage: 'attach',
      assetId,
      committed: true,
      commitAttempted: true,
    });
    const outcome = await runTask07ConsumerUpload({}, {
      enabled: true,
      runPipeline: jest.fn(async () => { throw error; }),
    });

    expect(outcome).toMatchObject({
      handled: true,
      status: 'attached-result-unknown',
      assetId,
      error: {
        code: 'unavailable',
        message: 'attach response interrupted',
      },
    });
    expect(task07ConsumerNeedsAttention(outcome)).toBe(true);
    expect(describeTask07ConsumerOutcome(outcome, 'Avatar'))
      .toMatch(/attached.*final response was interrupted.*Do not upload it again/i);
  });

  test('surfaces an unknown server attach acknowledgement without inviting retry', async () => {
    const error = new Task07MediaPipelineError('attach acknowledgement unknown', {
      code: 'unavailable',
      stage: 'attach',
      assetId,
      committed: false,
      commitAttempted: true,
    });
    const outcome = await runTask07ConsumerUpload({}, {
      enabled: true,
      runPipeline: jest.fn(async () => { throw error; }),
    });

    expect(outcome).toMatchObject({
      handled: true,
      status: 'attach-acknowledgement-unknown',
      assetId,
      error: {
        code: 'unavailable',
        message: 'attach acknowledgement unknown',
      },
    });
    expect(task07ConsumerNeedsAttention(outcome)).toBe(true);
    expect(describeTask07ConsumerOutcome(outcome, 'Map image'))
      .toMatch(/attachment acknowledgement is uncertain.*Do not upload it again/i);
  });

  test('rethrows a definitive attach rejection instead of retaining false ambiguity', async () => {
    const error = new Task07MediaPipelineError('revision changed', {
      code: 'functions/failed-precondition',
      stage: 'attach',
      assetId,
      committed: false,
      commitAttempted: true,
    });

    await expect(runTask07ConsumerUpload({}, {
      enabled: true,
      runPipeline: jest.fn(async () => { throw error; }),
    })).rejects.toBe(error);
  });

  test('rethrows pre-attach failures so the consumer cannot treat them as saved', async () => {
    const error = new Task07MediaPipelineError('upload failed', {
      stage: 'upload',
      committed: false,
      commitAttempted: false,
    });
    await expect(runTask07ConsumerUpload({}, {
      enabled: true,
      runPipeline: jest.fn(async () => { throw error; }),
    })).rejects.toBe(error);
  });

  test('keeps compatibility patches path-only and validates previous asset IDs', () => {
    const patch = buildTask07MediaEntityPatch(media, {
      includeEmptyImageUrl: true,
    });
    expect(patch).toEqual({
      media,
      imagePath: `${generatedPrefix}original`,
      imageUrl: '',
    });
    expect(JSON.stringify(patch)).not.toMatch(/https?:|downloadurl|bearer|token=/i);
    expect(getTask07PreviousAssetId({ media: { assetId: previousAssetId } }))
      .toBe(previousAssetId);
    expect(getTask07PreviousAssetId({ General: { media: { assetId: previousAssetId } } }))
      .toBe(previousAssetId);
    expect(getTask07PreviousAssetId({ media: { assetId: 'not-an-asset' } }))
      .toBeNull();
  });

  test('builds exact server-revision identities without a wall-clock component', () => {
    expect(buildTask07MediaStableRevision({
      expectedRevision: 4,
      attempt: 0,
    })).toBe('r4.a0');
    expect(buildTask07MediaStableRevision({
      expectedRevision: 4,
      attempt: 1,
    })).toBe('r4.a1');
    expect(() => buildTask07MediaStableRevision({
      expectedRevision: 4.5,
    })).toThrow(Task07MediaOperationReceiptError);
    expect(() => buildTask07MediaStableRevision({
      expectedRevision: Date.now(),
    })).toThrow(Task07MediaOperationReceiptError);
  });

  test('persists only an opaque receipt before invocation and clears it on success', async () => {
    const storage = createMemoryStorage();
    const invoke = jest.fn(async ({ operationId, stableRevision }) => {
      const serialized = storage.values.get(
        TASK07_MEDIA_OPERATION_RECEIPT_STORAGE_KEY
      );
      expect(stableRevision).toBe('r4.a0');
      expect(operationId).toMatch(/^task07:avatar:r4\.a0:[a-f0-9]{40}$/);
      expect(serialized).toContain(operationId);
      [
        'private-actor-uid',
        'private-owner-uid',
        'private-entity-id',
        file.name,
        'https://',
      ].forEach((privateValue) => {
        expect(serialized).not.toContain(privateValue);
      });
      return { handled: true, status: 'complete' };
    });

    await runWithTask07MediaOperationReceipt(durableOperationInput({
      storage,
      invoke,
    }));

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(readReceipts(storage)).toEqual([]);
    expect(storage.removeItem)
      .toHaveBeenCalledWith(TASK07_MEDIA_OPERATION_RECEIPT_STORAGE_KEY);
  });

  test('retains and reuses the exact operation ID after an ambiguous disconnect', async () => {
    const storage = createMemoryStorage();
    const disconnect = new Task07MediaPipelineError('connection interrupted', {
      code: 'unavailable',
      stage: 'attach',
      assetId,
      committed: false,
      commitAttempted: true,
    });
    const firstInvoke = jest.fn().mockRejectedValue(disconnect);

    await expect(runWithTask07MediaOperationReceipt(durableOperationInput({
      storage,
      invoke: firstInvoke,
    }))).rejects.toBe(disconnect);
    const retainedOperationId = readReceipts(storage)[0].operationId;

    const resumedInvoke = jest.fn().mockResolvedValue({
      handled: true,
      status: 'complete',
      replay: true,
    });
    await runWithTask07MediaOperationReceipt(durableOperationInput({
      storage,
      invoke: resumedInvoke,
    }));

    expect(firstInvoke.mock.calls[0][0].operationId).toBe(retainedOperationId);
    expect(resumedInvoke.mock.calls[0][0].operationId).toBe(retainedOperationId);
    expect(readReceipts(storage)).toEqual([]);
  });

  test('resumes original CAS inputs when entity state advanced after an ambiguous attach', async () => {
    const storage = createMemoryStorage();
    const firstInvoke = jest.fn().mockResolvedValue({
      handled: true,
      status: 'attach-acknowledgement-unknown',
      assetId,
    });

    await runWithTask07MediaOperationReceipt(durableOperationInput({
      storage,
      previousAssetId,
      invoke: firstInvoke,
    }));
    const retained = readReceipts(storage)[0];

    const resumedInvoke = jest.fn().mockResolvedValue({
      handled: true,
      status: 'complete',
      replay: true,
    });
    await runWithTask07MediaOperationReceipt(durableOperationInput({
      storage,
      expectedRevision: 5,
      previousAssetId: assetId,
      invoke: resumedInvoke,
    }));

    expect(resumedInvoke).toHaveBeenCalledWith(expect.objectContaining({
      operationId: retained.operationId,
      stableRevision: 'r4.a0',
      expectedRevision: 4,
      previousAssetId,
    }));
    expect(readReceipts(storage)).toEqual([]);
  });

  test('adopts current CAS inputs only after the retained operation is definitively rejected', async () => {
    const storage = createMemoryStorage();
    await runWithTask07MediaOperationReceipt(durableOperationInput({
      storage,
      previousAssetId,
      invoke: jest.fn().mockResolvedValue({
        handled: true,
        status: 'attach-acknowledgement-unknown',
        assetId,
      }),
    }));
    const definitiveRejection = new Task07MediaPipelineError('revision changed', {
      code: 'functions/failed-precondition',
      stage: 'attach',
      assetId,
      committed: false,
      commitAttempted: true,
    });

    await expect(runWithTask07MediaOperationReceipt(durableOperationInput({
      storage,
      expectedRevision: 5,
      previousAssetId: assetId,
      invoke: jest.fn().mockRejectedValue(definitiveRejection),
    }))).rejects.toBe(definitiveRejection);

    expect(readReceipts(storage)[0]).toMatchObject({
      attempt: 1,
      expectedRevision: 5,
      previousAssetId: assetId,
    });
    expect(readReceipts(storage)[0].operationId).toMatch(/^task07:avatar:r5\.a1:/);
  });

  test('retains attention outcomes but rotates after definitive pre-attach cleanup', async () => {
    const storage = createMemoryStorage();
    const uncertainInvoke = jest.fn().mockResolvedValue({
      handled: true,
      status: 'attach-acknowledgement-unknown',
      assetId,
    });
    await runWithTask07MediaOperationReceipt(durableOperationInput({
      storage,
      invoke: uncertainInvoke,
    }));
    const uncertainOperationId = readReceipts(storage)[0].operationId;

    const definitiveError = new Task07MediaPipelineError('upload cancelled', {
      code: 'aborted',
      stage: 'upload',
      assetId,
      committed: false,
      commitAttempted: false,
      abandonment: { ok: true },
    });
    await expect(runWithTask07MediaOperationReceipt(durableOperationInput({
      storage,
      invoke: jest.fn().mockRejectedValue(definitiveError),
    }))).rejects.toBe(definitiveError);

    const rotated = readReceipts(storage)[0];
    expect(rotated.attempt).toBe(1);
    expect(rotated.operationId).not.toBe(uncertainOperationId);
    expect(rotated.operationId).toMatch(/^task07:avatar:r4\.a1:/);
  });

  test('fails closed on malformed receipt state before invoking', async () => {
    const storage = createMemoryStorage();
    storage.values.set(
      TASK07_MEDIA_OPERATION_RECEIPT_STORAGE_KEY,
      '{malformed'
    );
    const invoke = jest.fn();

    await expect(runWithTask07MediaOperationReceipt(durableOperationInput({
      storage,
      invoke,
    }))).rejects.toBeInstanceOf(Task07MediaOperationReceiptError);
    expect(invoke).not.toHaveBeenCalled();
  });

  test('operation owner cancels replacement and unmount leases without stale release races', () => {
    const owner = createTask07MediaOperationOwner();
    const first = owner.start();
    const second = owner.start('replacement selected');

    expect(first.signal.aborted).toBe(true);
    expect(first.isCurrent()).toBe(false);
    expect(second.isCurrent()).toBe(true);
    first.release();
    expect(owner.hasActiveOperation()).toBe(true);

    expect(owner.dispose('route unmounted')).toBe(true);
    expect(second.signal.aborted).toBe(true);
    expect(owner.hasActiveOperation()).toBe(false);
    expect(() => owner.start()).toThrow(/disposed/i);
  });
});
