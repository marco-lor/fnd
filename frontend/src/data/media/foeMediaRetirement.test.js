import {
  abandonDurableFoeMediaRetirement,
  buildFoeMediaRetirementReconciliationMarker,
  buildFoeMediaRetirementIntent,
  FoeMediaRetirementClientError,
  isDefinitiveFoeRetirementError,
  isReceiptAbsentFoeRetirementError,
  planFoeMediaRetirementRecovery,
  runFoeMediaRetirement,
  shouldSaveCurrentFoeAfterRetirementRecovery,
  uploadPreparedFoeRetirementImages,
} from './foeMediaRetirement';

const file = (overrides = {}) => ({
  size: 10,
  type: 'image/png',
  arrayBuffer: async () => new Uint8Array(10).buffer,
  ...overrides,
});

test('builds JSON-only mutation intents with exact keep/remove/upload images', async () => {
  const selected = file();
  const result = await buildFoeMediaRetirementIntent({
    assetId: `m_${'a'.repeat(40)}`,
    expectedRevision: 4,
    expectedUpdatedAt: { seconds: 12, nanoseconds: 3 },
    payload: {
      id: 'foe-private',
      name: 'Foe',
      updated_at: { seconds: 12, nanoseconds: 3 },
      tecniche: [{
        name: 'Keep',
        description: '',
        danni: '',
        effetti: '',
        imagePath: 'foes/keep.png',
        imageUrl: 'https://example.test/keep.png',
      }],
      spells: [{
        name: 'Upload',
        description: '',
        danni: '',
        effetti: '',
        imageFile: selected,
      }],
    },
  }, { digestFile: async () => 'b'.repeat(64) });

  expect(result.immutableIntent.mutation.fields).toEqual({ name: 'Foe' });
  expect(result.immutableIntent.mutation.tecniche[0].image).toEqual({
    mode: 'keep',
    path: 'foes/keep.png',
    url: 'https://example.test/keep.png',
  });
  expect(result.immutableIntent.mutation.spells[0].image).toEqual({
    mode: 'upload',
    key: 'spells-0',
    sha256: 'b'.repeat(64),
    bytes: 10,
    contentType: 'image/png',
  });
  expect(result.filesByKey.get('spells-0')).toBe(selected);
  expect(JSON.stringify(result.immutableIntent)).not.toContain('imageFile');
});

test('reuses an exact create-only object and rejects metadata drift', async () => {
  const upload = {
    key: 'spells-0',
    path: 'foes/task07-operations/dm/receipt/foe/spells-0/hash.png',
    bytes: 10,
    contentType: 'image/png',
    cacheControl: 'private, max-age=31536000, immutable',
    contentDisposition: 'inline',
    metadata: { task07Slot: 'spells-0' },
  };
  const exact = {
    size: 10,
    contentType: 'image/png',
    cacheControl: upload.cacheControl,
    contentDisposition: 'inline',
    customMetadata: {
      ...upload.metadata,
      firebaseStorageDownloadTokens: 'firebase-token',
    },
  };
  const uploadBytes = jest.fn();
  await expect(uploadPreparedFoeRetirementImages({
    uploads: [upload],
    filesByKey: new Map([['spells-0', file()]]),
  }, {
    loadApi: async () => ({
      storage: {},
      ref: (_storage, path) => ({ fullPath: path }),
      getMetadata: async () => exact,
      uploadBytes,
    }),
  })).resolves.toEqual([expect.objectContaining({ outcome: 'reused' })]);
  expect(uploadBytes).not.toHaveBeenCalled();

  await expect(uploadPreparedFoeRetirementImages({
    uploads: [upload],
    filesByKey: new Map([['spells-0', file()]]),
  }, {
    loadApi: async () => ({
      storage: {},
      ref: () => ({}),
      getMetadata: async () => ({ ...exact, size: 11 }),
      uploadBytes,
    }),
  })).rejects.toThrow('conflicts with its receipt');
});

test('classifies only definitive retirement outcomes for abandonment', () => {
  expect(isDefinitiveFoeRetirementError(
    new FoeMediaRetirementClientError('changed', 'client-upload-changed')
  )).toBe(true);
  expect(isDefinitiveFoeRetirementError({ code: 'storage/unauthorized' }))
    .toBe(true);
  expect(isDefinitiveFoeRetirementError({ code: 'functions/failed-precondition' }))
    .toBe(true);
  expect(isDefinitiveFoeRetirementError({ code: 'functions/not-found' }))
    .toBe(false);
  expect(isDefinitiveFoeRetirementError({
    code: 'functions/not-found',
    details: { reason: 'receipt-absent' },
  })).toBe(true);
  expect(isDefinitiveFoeRetirementError({
    code: 'functions/internal',
    details: { abandonRecommended: true },
  })).toBe(true);
  expect(isDefinitiveFoeRetirementError({ code: 'functions/unavailable' }))
    .toBe(false);
  expect(isDefinitiveFoeRetirementError({ code: 'functions/internal' }))
    .toBe(false);
  expect(isDefinitiveFoeRetirementError({ code: 'storage/retry-limit-exceeded' }))
    .toBe(false);
});

const protocolInput = {
  actorUid: 'dm-one',
  immutableIntent: {
    schemaVersion: 1,
    assetId: `m_${'a'.repeat(40)}`,
    expectedRevision: 4,
    expectedUpdatedAt: { seconds: 12, nanoseconds: 3 },
    mutation: { fields: {}, tecniche: [], spells: [] },
  },
  filesByKey: new Map(),
};

const runIntentImmediately = ({ invoke }) => invoke('retirement-operation-0001');

test('reconciles a lost-ack completion before saving a different current edit', () => {
  const pendingRetirement = {
    actorUid: 'dm-one',
    immutableIntent: protocolInput.immutableIntent,
    filesByKey: new Map([['spells-0', file()]]),
  };
  const currentRetirement = {
    immutableIntent: {
      ...protocolInput.immutableIntent,
      mutation: {
        fields: { name: 'Changed after timeout' },
        tecniche: [],
        spells: [],
      },
    },
    filesByKey: new Map(),
  };

  const recovery = planFoeMediaRetirementRecovery({
    currentRetirement,
    foeId: 'foe-one',
    liveAssetId: null,
    pendingRetirement,
  });

  expect(recovery.action).toBe('reconcile-pending-then-save-current');
  expect(recovery.retirement.immutableIntent)
    .toBe(pendingRetirement.immutableIntent);
  expect(currentRetirement.immutableIntent.mutation.fields.name)
    .toBe('Changed after timeout');
});

test('replays the pending identity only when the current intent is exact', () => {
  const pendingRetirement = {
    actorUid: 'dm-one',
    immutableIntent: protocolInput.immutableIntent,
    filesByKey: new Map(),
  };
  const currentRetirement = {
    immutableIntent: JSON.parse(JSON.stringify(protocolInput.immutableIntent)),
    filesByKey: new Map(),
  };

  expect(planFoeMediaRetirementRecovery({
    currentRetirement,
    foeId: 'foe-one',
    liveAssetId: null,
    pendingRetirement,
  })).toEqual({
    action: 'run-pending',
    retirement: {
      immutableIntent: pendingRetirement.immutableIntent,
      filesByKey: pendingRetirement.filesByKey,
    },
  });
});

test('abandons a different pending intent while its binding is still live', () => {
  const pendingRetirement = {
    actorUid: 'dm-one',
    immutableIntent: protocolInput.immutableIntent,
    filesByKey: new Map(),
  };
  const currentRetirement = {
    immutableIntent: {
      ...protocolInput.immutableIntent,
      mutation: {
        fields: { name: 'Current edit' },
        tecniche: [],
        spells: [],
      },
    },
    filesByKey: new Map(),
  };

  expect(planFoeMediaRetirementRecovery({
    currentRetirement,
    foeId: 'foe-one',
    liveAssetId: protocolInput.immutableIntent.assetId,
    pendingRetirement,
  })).toEqual({
    action: 'abandon-pending-then-run-current',
    pendingRetirement,
    retirement: currentRetirement,
  });
});

test('saves the current edit when reconciliation confirms a stale live snapshot', () => {
  expect(shouldSaveCurrentFoeAfterRetirementRecovery({
    action: 'abandon-pending-then-run-current',
    settlement: { status: 'completed' },
  })).toBe(true);
  expect(shouldSaveCurrentFoeAfterRetirementRecovery({
    action: 'abandon-pending-then-run-current',
    settlement: { status: 'absent' },
  })).toBe(false);
  expect(shouldSaveCurrentFoeAfterRetirementRecovery({
    action: 'reconcile-pending-then-save-current',
    settlement: { status: 'absent' },
  })).toBe(true);
});

test('reuses a durable save-current marker without abandoning again', () => {
  const pendingRetirement = {
    ...protocolInput,
    reconciliation: {
      status: 'save-current',
      foeId: 'foe-one',
      expectedUpdatedAt: { seconds: 20, nanoseconds: 4 },
    },
  };
  const currentRetirement = {
    immutableIntent: {
      ...protocolInput.immutableIntent,
      mutation: { fields: { name: 'Retry' }, tecniche: [], spells: [] },
    },
    filesByKey: new Map(),
  };

  expect(planFoeMediaRetirementRecovery({
    currentRetirement,
    foeId: 'foe-one',
    liveAssetId: null,
    pendingRetirement,
  })).toEqual({
    action: 'save-current',
    marker: pendingRetirement,
    retirement: currentRetirement,
  });
});

test('uses the server commit timestamp as the reconciliation fence', () => {
  const pendingRetirement = { ...protocolInput };
  expect(buildFoeMediaRetirementReconciliationMarker({
    currentUpdatedAt: { seconds: 12, nanoseconds: 3 },
    foeId: 'foe-one',
    pendingRetirement,
    settlement: {
      status: 'completed',
      updatedAt: { seconds: 21, nanoseconds: 7 },
    },
  })).toEqual({
    ...pendingRetirement,
    reconciliation: {
      schemaVersion: 1,
      status: 'save-current',
      foeId: 'foe-one',
      expectedUpdatedAt: { seconds: 21, nanoseconds: 7 },
    },
  });
});

test('treats only an explicit missing abandonment receipt as already absent', async () => {
  const notFound = Object.assign(new Error('missing receipt'), {
    code: 'functions/not-found',
    details: { reason: 'receipt-absent' },
  });
  const abandon = jest.fn().mockRejectedValue(notFound);
  const runIntent = async (input) => {
    expect(input.isDefinitiveError(notFound)).toBe(true);
    return input.invoke('retirement-operation-0001');
  };

  await expect(abandonDurableFoeMediaRetirement(protocolInput, {
    abandon,
    runIntent,
  })).resolves.toEqual({
    schemaVersion: 1,
    status: 'absent',
    assetId: protocolInput.immutableIntent.assetId,
  });
  expect(abandon).toHaveBeenCalledWith({
    schemaVersion: 1,
    operationId: 'retirement-operation-0001',
    assetId: protocolInput.immutableIntent.assetId,
  });
});

test.each([
  ['an undeployed endpoint', { code: 'functions/not-found' }],
  ['a receipt identity mismatch', {
    code: 'functions/not-found',
    details: { reason: 'receipt-identity-mismatch' },
  }],
])('retains abandonment identity for %s', async (_label, shape) => {
  const notFound = Object.assign(new Error('not safe absence'), shape);
  const abandon = jest.fn().mockRejectedValue(notFound);
  const runIntent = async (input) => {
    expect(input.isDefinitiveError(notFound)).toBe(false);
    return input.invoke('retirement-operation-0001');
  };

  expect(isReceiptAbsentFoeRetirementError(notFound)).toBe(false);
  await expect(abandonDurableFoeMediaRetirement(protocolInput, {
    abandon,
    runIntent,
  })).rejects.toBe(notFound);
});

test('abandons a prepared operation after a definitive client upload failure', async () => {
  const failure = new FoeMediaRetirementClientError(
    'changed after prepare',
    'client-upload-changed'
  );
  const abandon = jest.fn().mockResolvedValue({
    data: { status: 'cleanup-pending' },
  });
  const commit = jest.fn();

  await expect(runFoeMediaRetirement(protocolInput, {
    runIntent: runIntentImmediately,
    prepare: jest.fn().mockResolvedValue({
      data: { status: 'pending', uploads: [] },
    }),
    uploadImages: jest.fn().mockRejectedValue(failure),
    commit,
    abandon,
  })).rejects.toBe(failure);

  expect(commit).not.toHaveBeenCalled();
  expect(abandon).toHaveBeenCalledWith({
    schemaVersion: 1,
    operationId: 'retirement-operation-0001',
    assetId: protocolInput.immutableIntent.assetId,
  });
});

test('retains a prepared operation after an ambiguous upload failure', async () => {
  const failure = Object.assign(new Error('timed out'), {
    code: 'storage/retry-limit-exceeded',
  });
  const abandon = jest.fn();

  await expect(runFoeMediaRetirement(protocolInput, {
    runIntent: runIntentImmediately,
    prepare: jest.fn().mockResolvedValue({
      data: { status: 'pending', uploads: [] },
    }),
    uploadImages: jest.fn().mockRejectedValue(failure),
    commit: jest.fn(),
    abandon,
  })).rejects.toBe(failure);

  expect(abandon).not.toHaveBeenCalled();
});

test('completed prepare replay skips uploads and another commit', async () => {
  const completed = {
    status: 'completed',
    operationId: 'retirement-operation-0001',
    revision: 5,
  };
  const uploadImages = jest.fn();
  const commit = jest.fn();

  await expect(runFoeMediaRetirement(protocolInput, {
    runIntent: runIntentImmediately,
    prepare: jest.fn().mockResolvedValue({ data: completed }),
    uploadImages,
    commit,
    abandon: jest.fn(),
  })).resolves.toEqual(completed);

  expect(uploadImages).not.toHaveBeenCalled();
  expect(commit).not.toHaveBeenCalled();
});
