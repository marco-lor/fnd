import { normalizePrivateMediaDescriptor } from '../common/privateMediaAssets';
import {
  buildTask07GeneratedFamilyPrefix,
} from '../../data/media/mediaPaths';
import { isTask07ReadyCanonicalMedia } from './tokenMediaProjection';

const MAX_CHARACTER_TOKEN_IDS = 60;
const AVATAR_VARIANTS = Object.freeze([
  'thumbnail',
  'thumbnail2x',
  'card',
]);

const normalizeString = (value) => (
  typeof value === 'string' ? value.trim() : ''
);

const isSafeTokenId = (value) => (
  Boolean(value)
  && value !== '.'
  && value !== '..'
  && value.length <= 256
  && !value.includes('/')
);

export const normalizeTask07CharacterTokenIds = (value) => {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(normalizeString).filter(isSafeTokenId))]
    .slice(0, MAX_CHARACTER_TOKEN_IDS);
};

const sanitizeDescriptor = (value, expectedPath) => {
  const descriptor = normalizePrivateMediaDescriptor(value);
  if (!descriptor || descriptor.path !== expectedPath) return null;
  return descriptor;
};

export const sanitizeTask07CharacterAvatarMedia = (
  value,
  expectedOwnerUid
) => {
  const ownerUid = normalizeString(expectedOwnerUid);
  if (
    !ownerUid
    || !isTask07ReadyCanonicalMedia(value, ['avatar'])
    || normalizeString(value.ownerUid) !== ownerUid
    || value.audience !== 'signed-in'
    || !/^[1-9][0-9]*$/.test(String(value.generation || ''))
  ) {
    return null;
  }

  const prefix = buildTask07GeneratedFamilyPrefix({
    audience: 'signed-in',
    ownerKey: ownerUid,
    assetId: value.assetId,
    sourceGeneration: String(value.generation),
  }).replace(/\/$/, '');
  const original = sanitizeDescriptor(value.original, `${prefix}/original`);
  if (!original) return null;

  const variants = {};
  AVATAR_VARIANTS.forEach((variant) => {
    const descriptor = sanitizeDescriptor(
      value?.variants?.[variant],
      `${prefix}/${variant}`
    );
    if (descriptor) variants[variant] = descriptor;
  });
  if (!variants.thumbnail) return null;

  return {
    schemaVersion: 1,
    contractVersion: 1,
    assetId: value.assetId,
    kind: 'avatar',
    state: 'ready',
    generation: String(value.generation),
    audience: 'signed-in',
    ownerUid,
    original,
    variants,
  };
};

export const normalizeTask07CharacterMediaResponse = (value) => {
  const response = value?.data && typeof value.data === 'object'
    ? value.data
    : value;
  const entries = response?.schemaVersion === 1 && Array.isArray(response.entries)
    ? response.entries
    : [];

  return Object.fromEntries(entries.flatMap((entry) => {
    const tokenId = normalizeString(entry?.tokenId);
    const ownerUid = normalizeString(entry?.media?.ownerUid);
    const media = sanitizeTask07CharacterAvatarMedia(entry?.media, ownerUid);
    return isSafeTokenId(tokenId) && media ? [[tokenId, media]] : [];
  }));
};

const invokeResolver = async (payload) => {
  const registry = await import('../../data/functions/callableRegistry');
  return registry.getCallable('task07ResolveCharacterMedia')(payload);
};

export const resolveTask07CharacterCanonicalMedia = async (
  tokenIds,
  { invoke = invokeResolver } = {}
) => {
  const normalizedTokenIds = normalizeTask07CharacterTokenIds(tokenIds);
  if (!normalizedTokenIds.length) return {};
  const result = await invoke({ tokenIds: normalizedTokenIds });
  return normalizeTask07CharacterMediaResponse(result);
};
