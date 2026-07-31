import { summarizeTask07Error } from './mediaErrors';
import { runTask07MediaPipeline } from './mediaPipeline';

export { createTask07MediaOperationOwner } from './mediaOperationOwner';
export {
  TASK07_MEDIA_OPERATION_RECEIPT_STORAGE_KEY,
  Task07MediaOperationReceiptError,
  buildTask07MediaStableRevision,
  runWithTask07MediaOperationReceipt,
  task07MediaFailureCanRotateReceipt,
  task07MediaReceiptOutcomeIsAmbiguous,
} from './mediaOperationReceiptStore';

const TASK07_OPERATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const TASK07_ASSET_ID_PATTERN = /^m_[a-f0-9]{40}$/;

const normalizeRequiredString = (value, label) => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    throw new TypeError(`Task 07 ${label} is required.`);
  }
  return normalized;
};

const operationSegment = (value, maxLength) => (
  String(value)
    .trim()
    .replace(/[^A-Za-z0-9._:-]+/g, '_')
    .replace(/^[^A-Za-z0-9]+/, '')
    .slice(0, maxLength)
);

const stableDigest = (value) => {
  const input = String(value);
  const seeds = [0x811c9dc5, 0x9e3779b9];
  return seeds.map((seed) => {
    let hash = seed;
    for (let index = 0; index < input.length; index += 1) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }).join('');
};

export const buildTask07MediaOperationId = ({
  kind,
  ownerUid,
  entityId,
  file,
  revision,
}) => {
  const normalizedKind = normalizeRequiredString(kind, 'media kind');
  const normalizedOwnerUid = normalizeRequiredString(ownerUid, 'media owner');
  const normalizedEntityId = normalizeRequiredString(entityId, 'entity ID');
  const normalizedRevision = normalizeRequiredString(String(revision ?? ''), 'operation revision');
  if (!file || typeof file.type !== 'string') {
    throw new TypeError('Task 07 media operation requires a File or Blob.');
  }

  const fingerprint = JSON.stringify({
    entityId: normalizedEntityId,
    fileLastModified: Number(file.lastModified) || 0,
    fileName: typeof file.name === 'string' ? file.name : '',
    fileSize: Number(file.size) || 0,
    fileType: file.type,
    kind: normalizedKind,
    ownerUid: normalizedOwnerUid,
    revision: normalizedRevision,
  });
  const operationId = [
    'task07',
    operationSegment(normalizedKind, 24),
    operationSegment(normalizedRevision, 32),
    stableDigest(fingerprint),
  ].join(':');

  if (!TASK07_OPERATION_ID_PATTERN.test(operationId)) {
    throw new TypeError('Task 07 media operation identity is invalid.');
  }
  return operationId;
};

export const getTask07PreviousAssetId = (entity) => {
  const media = entity?.media && typeof entity.media === 'object'
    ? entity.media
    : entity?.General?.media && typeof entity.General.media === 'object'
      ? entity.General.media
      : null;
  const assetId = typeof media?.assetId === 'string'
    ? media.assetId.trim()
    : '';
  return TASK07_ASSET_ID_PATTERN.test(assetId) ? assetId : null;
};

export const buildTask07MediaEntityPatch = (
  media,
  {
    includeImagePath = true,
    includeEmptyImageUrl = false,
  } = {}
) => {
  const originalPath = typeof media?.original?.path === 'string'
    ? media.original.path.trim()
    : '';
  if (!media || typeof media !== 'object' || !originalPath) {
    throw new TypeError('Task 07 finalized media metadata is invalid.');
  }

  const patch = { media };
  if (includeImagePath) patch.imagePath = originalPath;
  if (includeEmptyImageUrl) patch.imageUrl = '';
  return patch;
};

export const task07ConsumerNeedsAttention = (outcome) => (
  outcome?.status === 'attached-result-unknown'
  || outcome?.status === 'attach-acknowledgement-unknown'
);

export const describeTask07ConsumerOutcome = (outcome, subject = 'Media') => {
  if (outcome?.status === 'attached-result-unknown') {
    return `${subject} was attached, but the final response was interrupted. Do not upload it again.`;
  }
  if (outcome?.status === 'attach-acknowledgement-unknown') {
    return `${subject} attachment acknowledgement is uncertain. Do not upload it again while status recovery verifies the reference.`;
  }
  return '';
};

export const runTask07ConsumerUpload = async (
  input,
  {
    enabled = true,
    runPipeline = runTask07MediaPipeline,
  } = {}
) => {
  if (!enabled) {
    return {
      handled: false,
      status: 'legacy',
    };
  }
  try {
    const result = await runPipeline(input);
    return {
      ...result,
      handled: true,
      status: 'complete',
    };
  } catch (error) {
    const errorCode = typeof error?.code === 'string'
      ? error.code.replace(/^functions\//, '')
      : '';
    const attachResultIsUncertain = (
      error?.committed === true
      || (
        error?.commitAttempted === true
        && (
          !errorCode
          || [
            'aborted',
            'cancelled',
            'deadline-exceeded',
            'internal',
            'invalid-attach-response',
            'resource-exhausted',
            'unavailable',
            'unknown',
          ].includes(errorCode)
        )
      )
    );
    if (attachResultIsUncertain) {
      return {
        handled: true,
        status: error?.committed === true
          ? 'attached-result-unknown'
          : 'attach-acknowledgement-unknown',
        assetId: error.assetId || null,
        error: summarizeTask07Error(error),
      };
    }
    throw error;
  }
};
