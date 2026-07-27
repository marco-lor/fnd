import policy from './mediaPolicy.json';

export const TASK07_MEDIA_POLICY = Object.freeze(policy);
export const TASK07_MEDIA_POLICY_VERSION = policy.policyVersion;
export const TASK07_MEDIA_PURPOSES = Object.freeze(
  Object.keys(policy.purposes)
);

const MIME_LABELS = Object.freeze({
  'image/gif': 'Animated GIF',
  'image/heic': 'HEIC',
  'image/heif': 'HEIF',
  'image/svg+xml': 'SVG',
});

export const normalizeTask07ContentType = (value) => (
  typeof value === 'string'
    ? value.split(';')[0].trim().toLowerCase()
    : ''
);

export const getTask07MediaPurpose = (purpose) => {
  const normalized = typeof purpose === 'string' ? purpose.trim() : '';
  return policy.purposes[normalized] || null;
};

export const validateTask07UploadCandidate = ({ file, purpose }) => {
  const contract = getTask07MediaPurpose(purpose);
  if (!contract) {
    return {
      ok: false,
      code: 'unknown-purpose',
      message: 'This media purpose is not supported.',
    };
  }
  const contentType = normalizeTask07ContentType(file?.type);
  if (!contract.contentTypes.includes(contentType)) {
    const label = MIME_LABELS[contentType] || contentType || 'This format';
    return {
      ok: false,
      code: 'unsupported-format',
      message: `${label} uploads are not supported. Use an approved non-animated format.`,
    };
  }
  const bytes = Number(file?.size);
  if (!Number.isSafeInteger(bytes) || bytes <= 0) {
    return {
      ok: false,
      code: 'invalid-byte-size',
      message: 'The selected media file is empty or invalid.',
    };
  }
  if (bytes > contract.maxBytes) {
    return {
      ok: false,
      code: 'source-byte-budget-exceeded',
      message: 'The selected media file exceeds the upload size limit.',
    };
  }
  return { ok: true, code: null, message: '' };
};

const VARIANT_USE_PREFIXES = Object.freeze({
  avatar: ['thumbnail', 'card'],
  thumbnail: ['thumbnail'],
  card: ['card'],
  'map-gallery': ['gallery'],
  poster: ['poster'],
});

export const getTask07VariantCandidates = (purpose, use) => {
  const contract = getTask07MediaPurpose(purpose);
  const prefixes = VARIANT_USE_PREFIXES[use] || [];
  if (!contract || !prefixes.length) return [];
  return Object.entries(contract.variants)
    .filter(([name]) => prefixes.some((prefix) => name.startsWith(prefix)))
    .map(([name, variant]) => ({ name, ...variant }))
    .sort((left, right) => (
      left.width - right.width
      || left.height - right.height
      || left.name.localeCompare(right.name)
    ));
};

export const selectTask07VariantName = ({
  purpose,
  use,
  renderedWidth,
  devicePixelRatio = 1,
}) => {
  const candidates = getTask07VariantCandidates(purpose, use);
  if (!candidates.length) return '';
  const cssWidth = Number(renderedWidth);
  const density = Math.min(2, Math.max(1, Number(devicePixelRatio) || 1));
  const targetWidth = Number.isFinite(cssWidth) && cssWidth > 0
    ? cssWidth * density
    : candidates[0].width;
  return (
    candidates.find(({ width }) => width >= targetWidth)
    || candidates[candidates.length - 1]
  ).name;
};

export const getTask07RuntimeBudgetProfile = ({
  compact = false,
  saveData = false,
} = {}) => (
  compact || saveData
    ? policy.runtimeBudgets.compact
    : policy.runtimeBudgets.desktop
);
