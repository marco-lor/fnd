import { getCallable } from '../functions/callableRegistry';
import { runWithDurableOperationIntent } from '../functions/backendOperationIntentStore';

const prepareRetirement = getCallable('task07PrepareFoeMediaRetirement');
const commitRetirement = getCallable('task07CommitFoeMediaRetirement');
const abandonRetirement = getCallable('task07AbandonFoeMediaRetirement');

const MAX_UPLOADS = 16;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const CACHE_CONTROL = 'private, max-age=31536000, immutable';
const SUPPORTED_CONTENT_TYPES = new Set([
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
]);
const FORBIDDEN_FIELDS = new Set([
  'General',
  'created_at',
  'downloadUrl',
  'id',
  'imagePath',
  'imageUrl',
  'image_url',
  'media',
  'mediaUpdatedAt',
  'spells',
  'task07MediaRevision',
  'task07VideoMediaRevision',
  'tecniche',
  'updated_at',
  'url',
  'videoMedia',
  'videoMediaUpdatedAt',
]);

export class FoeMediaRetirementClientError extends TypeError {
  constructor(message, code = 'client-contract-invalid') {
    super(message);
    this.name = 'FoeMediaRetirementClientError';
    this.code = code;
  }
}

const clientFailure = (message, code) => (
  new FoeMediaRetirementClientError(message, code)
);

const normalizeContentType = (value) => (
  typeof value === 'string' ? value.split(';')[0].trim().toLowerCase() : ''
);

const safeHttpsUrl = (value) => (
  typeof value === 'string' && /^https:\/\//i.test(value.trim())
    ? value.trim() : ''
);

const pathFromUrl = (value) => {
  const url = safeHttpsUrl(value);
  const encoded = url.split('/o/')[1]?.split('?')[0] || '';
  if (!encoded) return '';
  try {
    return decodeURIComponent(encoded);
  } catch {
    return '';
  }
};

const normalizeTimestamp = (value) => {
  if (value == null) return null;
  const seconds = Number(value.seconds);
  const nanoseconds = Number(value.nanoseconds || 0);
  if (!Number.isSafeInteger(seconds)
    || !Number.isSafeInteger(nanoseconds)
    || nanoseconds < 0
    || nanoseconds >= 1_000_000_000) {
    throw new TypeError('The foe edit timestamp is invalid.');
  }
  return { seconds, nanoseconds };
};

const sha256File = async (
  file,
  cryptoImpl = typeof window !== 'undefined' ? window.crypto : undefined
) => {
  if (!cryptoImpl?.subtle?.digest || typeof file?.arrayBuffer !== 'function') {
    throw clientFailure(
      'Secure foe image hashing is unavailable.',
      'client-hashing-unavailable'
    );
  }
  const digest = await cryptoImpl.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

const entryStrings = (entry) => ({
  name: String(entry?.name || ''),
  description: String(entry?.description || ''),
  danni: String(entry?.danni || ''),
  effetti: String(entry?.effetti || ''),
});

const buildEntry = async ({ entry, collectionName, index, digestFile }) => {
  const base = entryStrings(entry);
  if (entry?.imageFile) {
    const file = entry.imageFile;
    const contentType = normalizeContentType(file.type);
    if (!Number.isSafeInteger(file.size)
      || file.size <= 0
      || file.size > MAX_FILE_BYTES
      || !SUPPORTED_CONTENT_TYPES.has(contentType)) {
      throw clientFailure(
        'A nested foe image exceeds its upload contract.',
        'client-upload-contract-invalid'
      );
    }
    const key = `${collectionName}-${index}`;
    return {
      entry: {
        ...base,
        image: {
          mode: 'upload',
          key,
          sha256: await digestFile(file),
          bytes: file.size,
          contentType,
        },
      },
      upload: { key, file },
    };
  }
  if (entry?.removeImage) {
    return { entry: { ...base, image: { mode: 'remove' } }, upload: null };
  }
  const url = safeHttpsUrl(entry?.imageUrl);
  const path = typeof entry?.imagePath === 'string' && entry.imagePath.trim()
    ? entry.imagePath.trim() : pathFromUrl(url);
  if (path || url) {
    return {
      entry: { ...base, image: { mode: 'keep', path, url } },
      upload: null,
    };
  }
  return { entry: { ...base, image: { mode: 'remove' } }, upload: null };
};

export const buildFoeMediaRetirementIntent = async ({
  payload,
  assetId,
  expectedRevision,
  expectedUpdatedAt,
}, {
  digestFile = (file) => sha256File(file),
} = {}) => {
  const source = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload : {};
  const fields = Object.fromEntries(Object.entries(source).filter(([key]) => (
    !FORBIDDEN_FIELDS.has(key)
  )));
  const buildCollection = async (collectionName) => Promise.all(
    (Array.isArray(source[collectionName]) ? source[collectionName] : [])
      .map((entry, index) => buildEntry({
        entry,
        collectionName,
        index,
        digestFile,
      }))
  );
  const [tecniche, spells] = await Promise.all([
    buildCollection('tecniche'),
    buildCollection('spells'),
  ]);
  const uploads = [...tecniche, ...spells]
    .map(({ upload }) => upload)
    .filter(Boolean);
  const totalBytes = uploads.reduce((total, { file }) => total + file.size, 0);
  if (uploads.length > MAX_UPLOADS || totalBytes > MAX_TOTAL_BYTES) {
    throw clientFailure(
      'The foe edit exceeds its nested image upload budget.',
      'client-upload-budget-exceeded'
    );
  }
  return {
    immutableIntent: {
      schemaVersion: 1,
      assetId,
      expectedRevision,
      expectedUpdatedAt: normalizeTimestamp(expectedUpdatedAt),
      mutation: {
        fields,
        tecniche: tecniche.map(({ entry }) => entry),
        spells: spells.map(({ entry }) => entry),
      },
    },
    filesByKey: new Map(uploads.map(({ key, file }) => [key, file])),
  };
};

const requiredStringMap = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw clientFailure(
      'Server foe upload metadata is invalid.',
      'server-upload-plan-invalid'
    );
  }
  const entries = Object.entries(value);
  if (!entries.length || entries.some(([key, item]) => (
    !key || typeof item !== 'string' || !item
  ))) {
    throw clientFailure(
      'Server foe upload metadata is invalid.',
      'server-upload-plan-invalid'
    );
  }
  return Object.fromEntries(entries);
};

const metadataMatches = (metadata, upload) => {
  const custom = metadata?.customMetadata || {};
  const expected = requiredStringMap(upload.metadata);
  const actualKeys = Object.keys(custom)
    .filter((key) => key !== 'firebaseStorageDownloadTokens')
    .sort();
  const expectedKeys = Object.keys(expected).sort();
  return Number(metadata?.size) === upload.bytes
    && normalizeContentType(metadata?.contentType) === upload.contentType
    && metadata?.cacheControl === CACHE_CONTROL
    && metadata?.contentDisposition === 'inline'
    && actualKeys.length === expectedKeys.length
    && actualKeys.every((key, index) => key === expectedKeys[index])
    && expectedKeys.every((key) => custom[key] === expected[key]);
};

const loadStorageApi = async () => {
  const [{ storage }, api] = await Promise.all([
    import('../../components/firebaseStorage'),
    import('firebase/storage'),
  ]);
  return {
    storage,
    getMetadata: api.getMetadata,
    ref: api.ref,
    uploadBytes: api.uploadBytes,
  };
};

const objectMissing = (error) => error?.code === 'storage/object-not-found';

const uploadOne = async ({ upload, file, api }) => {
  if (!file || file.size !== upload.bytes
    || normalizeContentType(file.type) !== upload.contentType) {
    throw clientFailure(
      'A selected foe image changed after prepare.',
      'client-upload-changed'
    );
  }
  const objectRef = api.ref(api.storage, upload.path);
  try {
    const existing = await api.getMetadata(objectRef);
    if (!metadataMatches(existing, upload)) {
      throw clientFailure(
        'An existing foe upload conflicts with its receipt.',
        'client-upload-conflict'
      );
    }
    return { outcome: 'reused', key: upload.key, path: upload.path };
  } catch (error) {
    if (!objectMissing(error)) throw error;
  }
  try {
    await api.uploadBytes(objectRef, file, {
      contentType: upload.contentType,
      cacheControl: CACHE_CONTROL,
      contentDisposition: 'inline',
      customMetadata: requiredStringMap(upload.metadata),
    });
  } catch (error) {
    // A same-operation retry can race the first create. Rules reject the
    // overwrite; accept only the exact immutable object already present.
    const raced = await api.getMetadata(objectRef).catch(() => null);
    if (!raced || !metadataMatches(raced, upload)) throw error;
    return { outcome: 'reused', key: upload.key, path: upload.path };
  }
  const stored = await api.getMetadata(objectRef);
  if (!metadataMatches(stored, upload)) {
    throw clientFailure(
      'Stored foe upload metadata failed verification.',
      'client-upload-verification-failed'
    );
  }
  return { outcome: 'copied', key: upload.key, path: upload.path };
};

export const uploadPreparedFoeRetirementImages = async ({
  uploads,
  filesByKey,
}, {
  loadApi = loadStorageApi,
} = {}) => {
  const plans = Array.isArray(uploads) ? uploads : [];
  if (plans.length !== filesByKey.size) {
    throw clientFailure(
      'Server foe upload plan does not match selected files.',
      'server-upload-plan-mismatch'
    );
  }
  const api = await loadApi();
  const results = new Array(plans.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < plans.length) {
      const index = cursor++;
      const upload = plans[index];
      results[index] = await uploadOne({
        upload,
        file: filesByKey.get(upload.key),
        api,
      });
    }
  };
  await Promise.all(Array.from(
    { length: Math.min(2, plans.length) },
    () => worker()
  ));
  return results;
};

const errorCode = (error) => (
  typeof error?.code === 'string' ? error.code.replace(/^functions\//, '') : ''
);

export const isReceiptAbsentFoeRetirementError = (error) => (
  errorCode(error) === 'not-found'
  && error?.details?.reason === 'receipt-absent'
);

const immutableIntentsMatch = (left, right) => (
  JSON.stringify(left) === JSON.stringify(right)
);

export const planFoeMediaRetirementRecovery = ({
  currentRetirement,
  foeId,
  liveAssetId,
  pendingRetirement,
}) => {
  if (pendingRetirement?.reconciliation?.status === 'save-current') {
    if (pendingRetirement.reconciliation.foeId !== foeId) {
      throw clientFailure(
        'The pending foe recovery belongs to a different foe.',
        'client-recovery-foe-mismatch'
      );
    }
    return {
      action: 'save-current',
      marker: pendingRetirement,
      retirement: currentRetirement,
    };
  }
  if (
    !pendingRetirement
    || pendingRetirement?.immutableIntent?.assetId
      !== currentRetirement?.immutableIntent?.assetId
  ) {
    return { action: 'run-current', retirement: currentRetirement };
  }
  const pending = {
    immutableIntent: pendingRetirement.immutableIntent,
    filesByKey: pendingRetirement.filesByKey,
  };
  if (immutableIntentsMatch(
    pendingRetirement.immutableIntent,
    currentRetirement.immutableIntent
  )) {
    return { action: 'run-pending', retirement: pending };
  }
  if (liveAssetId) {
    return {
      action: 'abandon-pending-then-run-current',
      pendingRetirement,
      retirement: currentRetirement,
    };
  }
  return {
    action: 'reconcile-pending-then-save-current',
    retirement: pending,
  };
};

export const shouldSaveCurrentFoeAfterRetirementRecovery = ({
  action,
  settlement,
}) => (
  action === 'save-current'
  || action === 'reconcile-pending-then-save-current'
  || settlement?.status === 'completed'
);

export const buildFoeMediaRetirementReconciliationMarker = ({
  currentUpdatedAt,
  foeId,
  pendingRetirement,
  settlement,
}) => {
  const normalizedFoeId = typeof foeId === 'string' ? foeId.trim() : '';
  const expectedUpdatedAt = normalizeTimestamp(
    settlement?.status === 'completed'
      ? settlement?.updatedAt
      : currentUpdatedAt
  );
  if (!normalizedFoeId || !expectedUpdatedAt) {
    throw clientFailure(
      'The completed foe recovery has no safe write fence.',
      'client-recovery-fence-missing'
    );
  }
  return {
    ...pendingRetirement,
    reconciliation: {
      schemaVersion: 1,
      status: 'save-current',
      foeId: normalizedFoeId,
      expectedUpdatedAt,
    },
  };
};

export const isDefinitiveFoeRetirementError = (error) => (
  error instanceof FoeMediaRetirementClientError
  || new Set([
    'storage/canceled',
    'storage/invalid-argument',
    'storage/invalid-checksum',
    'storage/invalid-format',
    'storage/quota-exceeded',
    'storage/unauthenticated',
    'storage/unauthorized',
  ]).has(error?.code)
  || error?.details?.abandonRecommended === true
  || (
    errorCode(error) === 'not-found'
      ? isReceiptAbsentFoeRetirementError(error)
      : new Set([
        'aborted',
        'already-exists',
        'failed-precondition',
        'invalid-argument',
        'permission-denied',
        'unauthenticated',
      ]).has(errorCode(error))
  )
);

const receiptPayload = (operationId, assetId) => ({
  schemaVersion: 1,
  operationId,
  assetId,
});

export const runFoeMediaRetirement = async ({
  actorUid,
  immutableIntent,
  filesByKey,
  onOperation,
}, {
  uploadImages = uploadPreparedFoeRetirementImages,
  prepare = prepareRetirement,
  commit = commitRetirement,
  abandon = abandonRetirement,
  runIntent = runWithDurableOperationIntent,
} = {}) => runIntent({
  actorUid,
  kind: 'task07-foe-media-retirement',
  intent: immutableIntent,
  isDefinitiveError: isDefinitiveFoeRetirementError,
  invoke: async (operationId) => {
    onOperation?.({ operationId, assetId: immutableIntent.assetId, immutableIntent });
    let prepared = false;
    try {
      const preparedResponse = await prepare({
        ...immutableIntent,
        operationId,
      });
      const plan = preparedResponse.data;
      if (plan?.status === 'completed') return plan;
      prepared = true;
      await uploadImages({ uploads: plan?.uploads, filesByKey });
      const committed = await commit(
        receiptPayload(operationId, immutableIntent.assetId)
      );
      return committed.data;
    } catch (error) {
      if (!prepared || !isDefinitiveFoeRetirementError(error)) throw error;
      try {
        const abandoned = await abandon(
          receiptPayload(operationId, immutableIntent.assetId)
        );
        if (abandoned.data?.status === 'completed') return abandoned.data;
      } catch (abandonError) {
        const retained = new Error(
          'Foe retirement cleanup could not be confirmed; retry with the same operation.'
        );
        retained.code = 'functions/unavailable';
        retained.cause = abandonError;
        throw retained;
      }
      throw error;
    }
  },
});

export const abandonDurableFoeMediaRetirement = async ({
  actorUid,
  immutableIntent,
}, {
  abandon = abandonRetirement,
  runIntent = runWithDurableOperationIntent,
} = {}) => {
  try {
    return await runIntent({
      actorUid,
      kind: 'task07-foe-media-retirement',
      intent: immutableIntent,
      isDefinitiveError: isDefinitiveFoeRetirementError,
      invoke: async (operationId) => {
        const response = await abandon(
          receiptPayload(operationId, immutableIntent.assetId)
        );
        return response.data;
      },
    });
  } catch (error) {
    // onOperation runs before prepare. If prepare never created its receipt,
    // a definitive not-found response means there is nothing left to abandon.
    // runWithDurableOperationIntent has already cleared the local identity.
    if (!isReceiptAbsentFoeRetirementError(error)) throw error;
    return {
      schemaVersion: 1,
      status: 'absent',
      assetId: immutableIntent.assetId,
    };
  }
};
