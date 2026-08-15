import { normalizePrivateMediaDescriptor } from '../common/privateMediaAssets';
import {
  buildTask07GeneratedFamilyPrefix,
} from '../../data/media/mediaPaths';
import { isTask07ReadyCanonicalMedia } from './tokenMediaProjection';

const MAX_CHARACTER_TOKEN_IDS = 60;
const CHARACTER_MEDIA_RESOLVE_CONCURRENCY = 2;
const AVATAR_VARIANTS = Object.freeze([
  'thumbnail',
  'thumbnail2x',
  'card',
]);
const TOKEN_VARIANTS = Object.freeze([
  'thumbnail',
  'thumbnail2x',
  'card',
  'card2x',
]);
const VARIANTS_BY_KIND = Object.freeze({
  avatar: AVATAR_VARIANTS,
  token: TOKEN_VARIANTS,
});

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
  return [...new Set(value.map(normalizeString).filter(isSafeTokenId))];
};

const resolveTask07CharacterMediaChunks = async ({
  tokenIds,
  buildPayload,
  normalizeResponse,
  invoke,
}) => {
  const chunks = [];
  for (let index = 0; index < tokenIds.length; index += MAX_CHARACTER_TOKEN_IDS) {
    chunks.push(tokenIds.slice(index, index + MAX_CHARACTER_TOKEN_IDS));
  }
  const results = new Array(chunks.length);
  let nextChunkIndex = 0;
  const worker = async () => {
    while (nextChunkIndex < chunks.length) {
      const chunkIndex = nextChunkIndex;
      nextChunkIndex += 1;
      const chunk = chunks[chunkIndex];
      const allowedTokenIds = new Set(chunk);
      const response = normalizeResponse(await invoke(buildPayload(chunk)));
      results[chunkIndex] = Object.fromEntries(Object.entries(response).filter(([tokenId]) => (
        allowedTokenIds.has(tokenId)
      )));
    }
  };
  await Promise.all(Array.from(
    { length: Math.min(CHARACTER_MEDIA_RESOLVE_CONCURRENCY, chunks.length) },
    () => worker()
  ));
  return Object.assign({}, ...results);
};

const sanitizeDescriptor = (value, expectedPath) => {
  const descriptor = normalizePrivateMediaDescriptor(value);
  if (!descriptor || descriptor.path !== expectedPath) return null;
  return descriptor;
};

export const sanitizeTask07PlacedTokenMedia = (
  value,
  expectedOwnerUid
) => {
  const ownerUid = normalizeString(expectedOwnerUid);
  const kind = normalizeString(value?.kind);
  const expectedVariants = VARIANTS_BY_KIND[kind];
  if (
    !ownerUid
    || !expectedVariants
    || !isTask07ReadyCanonicalMedia(value, [kind])
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
  expectedVariants.forEach((variant) => {
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
    kind,
    state: 'ready',
    generation: String(value.generation),
    audience: 'signed-in',
    ownerUid,
    original,
    variants,
  };
};

export const sanitizeTask07CharacterAvatarMedia = (
  value,
  expectedOwnerUid
) => {
  const media = sanitizeTask07PlacedTokenMedia(value, expectedOwnerUid);
  return media?.kind === 'avatar' ? media : null;
};

export const normalizeTask07PlacedTokenMediaResponse = (value) => {
  const response = value?.data && typeof value.data === 'object'
    ? value.data
    : value;
  const entries = response?.schemaVersion === 1 && Array.isArray(response.entries)
    ? response.entries
    : [];

  return Object.fromEntries(entries.flatMap((entry) => {
    const tokenId = normalizeString(entry?.tokenId);
    const ownerUid = normalizeString(entry?.media?.ownerUid);
    const media = sanitizeTask07PlacedTokenMedia(entry?.media, ownerUid);
    return isSafeTokenId(tokenId) && media ? [[tokenId, media]] : [];
  }));
};

export const normalizeTask07CharacterMediaResponse = (value) => {
  const response = value?.data && typeof value.data === 'object'
    ? value.data
    : value;
  const normalized = normalizeTask07PlacedTokenMediaResponse(response);
  return Object.fromEntries(Object.entries(normalized).filter(([, media]) => (
    media.kind === 'avatar'
  )));
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
  return resolveTask07CharacterMediaChunks({
    tokenIds: normalizedTokenIds,
    buildPayload: (chunk) => ({ tokenIds: chunk }),
    normalizeResponse: normalizeTask07CharacterMediaResponse,
    invoke,
  });
};

export const resolveTask07PlacedCanonicalMedia = async ({
  backgroundId,
  tokenIds,
}, { invoke = invokeResolver } = {}) => {
  const normalizedBackgroundId = normalizeString(backgroundId);
  const normalizedTokenIds = normalizeTask07CharacterTokenIds(tokenIds);
  if (!isSafeTokenId(normalizedBackgroundId) || !normalizedTokenIds.length) {
    return {};
  }
  return resolveTask07CharacterMediaChunks({
    tokenIds: normalizedTokenIds,
    buildPayload: (chunk) => ({
      backgroundId: normalizedBackgroundId,
      tokenIds: chunk,
    }),
    normalizeResponse: normalizeTask07PlacedTokenMediaResponse,
    invoke,
  });
};
