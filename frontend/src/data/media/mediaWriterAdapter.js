import {
  getTask07PreviousAssetId,
  runTask07ConsumerUpload,
} from './mediaConsumerAdapter';
import { isTask07MediaV1WriteEnabled } from './mediaFeatureFlags';
import { runWithTask07MediaOperationReceipt } from './mediaOperationReceiptStore';

const VIDEO_KINDS = new Set([
  'map-video',
  'spell-video',
  'technique-video',
]);

const normalizeRevision = (value) => (
  Number.isSafeInteger(value) && value >= 0 ? value : 0
);

const stableDigest = (value) => {
  const text = String(value);
  return [0x811c9dc5, 0x9e3779b9].map((seed) => {
    let hash = seed;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }).join('');
};

export const task07MediaSlotForKind = (kind) => (
  VIDEO_KINDS.has(kind) ? 'videoMedia' : 'media'
);

export const task07MediaRevisionFieldForKind = (kind) => (
  VIDEO_KINDS.has(kind)
    ? 'task07VideoMediaRevision'
    : 'task07MediaRevision'
);

export const getTask07ExpectedRevisionForKind = (entity, kind) => (
  normalizeRevision(entity?.[task07MediaRevisionFieldForKind(kind)])
);

export const getTask07PreviousAssetIdForKind = (entity, kind) => {
  const slot = task07MediaSlotForKind(kind);
  if (slot === 'media') return getTask07PreviousAssetId(entity);
  return getTask07PreviousAssetId({ media: entity?.videoMedia });
};

export const buildTask07PrepareRetryKey = ({
  kind,
  ownerUid,
  entityHint,
  file,
}) => {
  const fingerprint = JSON.stringify({
    entityHint: String(entityHint || ''),
    fileLastModified: Number(file?.lastModified) || 0,
    fileName: typeof file?.name === 'string' ? file.name : '',
    fileSize: Number(file?.size) || 0,
    fileType: typeof file?.type === 'string' ? file.type : '',
    kind: String(kind || ''),
    ownerUid: String(ownerUid || ''),
  });
  return `task07-prepare-${String(kind || 'media').slice(0, 24)}-${stableDigest(fingerprint)}`;
};

export const buildTask07DetachRetryKey = ({
  kind,
  ownerUid,
  entityId,
  assetId,
}) => {
  const fingerprint = JSON.stringify({
    assetId: String(assetId || ''),
    entityId: String(entityId || ''),
    kind: String(kind || ''),
    ownerUid: String(ownerUid || ''),
  });
  return `task07-detach-${String(kind || 'media').slice(0, 24)}-${stableDigest(fingerprint)}`;
};

/**
 * Shared writer entry point. It resolves the exact Task 07 cohort before any
 * target preparation, persists an opaque durable operation receipt, and
 * forwards the caller-owned AbortSignal through the complete pipeline.
 */
export const runTask07ControlledWriterUpload = async (
  {
    actorUid,
    role,
    purpose,
    ownerUid,
    entityId,
    kind,
    nestedTarget,
    referenceScope,
    file,
    target = null,
    previousAssetId: requestedPreviousAssetId,
    expectedRevision: requestedExpectedRevision,
    prepareEntity,
    rollbackPreparedEntity,
    signal,
    onProgress,
    enabled: requestedEnabled,
  },
  {
    isEnabled = isTask07MediaV1WriteEnabled,
    runConsumer = runTask07ConsumerUpload,
    runWithReceipt = runWithTask07MediaOperationReceipt,
  } = {}
) => {
  const enabled = requestedEnabled === true
    || (
      requestedEnabled !== false
      && await isEnabled({
        purpose: purpose || kind,
        role,
        uid: actorUid,
      })
    );
  if (!enabled) {
    return {
      handled: false,
      status: 'legacy',
    };
  }

  const expectedRevision = requestedExpectedRevision == null
    ? getTask07ExpectedRevisionForKind(target, kind)
    : normalizeRevision(requestedExpectedRevision);
  const previousAssetId = requestedPreviousAssetId === undefined
    ? getTask07PreviousAssetIdForKind(target, kind)
    : requestedPreviousAssetId;

  return runWithReceipt({
    actorUid,
    ownerUid,
    entityId,
    kind,
    file,
    expectedRevision,
    previousAssetId,
    referenceScope,
    nestedTarget,
    signal,
    invoke: ({ operationId, signal: receiptSignal }) => runConsumer({
      file,
      ownerUid,
      entityId,
      operationId,
      kind,
      nestedTarget,
      referenceScope,
      previousAssetId,
      expectedRevision,
      prepareEntity,
      rollbackPreparedEntity,
      signal: receiptSignal,
      onProgress,
    }),
  });
};
