import { resolveMediaAsset } from '../common/MediaImage';

// Board token portrait sizing.
//
// Every visible token always shows its portrait; what adapts is the longest
// drawable edge each distinct portrait source is decoded to. The edge is
// chosen so that the required battlemap decode plus the whole renderable
// portrait working set fits the shared decoded-image budget:
//
//   mapDecodedBytes + distinctSources * edge^2 * 4 <= maxTotalDecodedBytes
//
// The working set is every portrait source this viewer can render (role and
// fog filtering happen before), counted once per shared source. At fit zoom
// all of them are on screen at once, so budgeting for that set keeps every
// zoom level within budget, and the edge does not change on pan, zoom, fit or
// stage resize (each change would re-key and re-decode every portrait).
// Offscreen priority portraits (active turn, selected, owned) are a subset of
// that set, so they are never budgeted on top of it.

const BYTES_PER_PIXEL = 4;

// Coarse tiers keep the edge stable when the working set changes by a few
// tokens; each step down keeps roughly half to two-thirds of the decoded area.
// The top tier matches TokenNode's TOKEN_PORTRAIT_MAX_DRAWABLE_EDGE (kept as a
// literal so this helper stays free of react-konva; the board test pins it).
export const TOKEN_PORTRAIT_EDGE_TIERS = Object.freeze([512, 384, 256, 192, 128, 96, 64, 32, 16, 8, 4, 2, 1]);
// Graceful-degradation floor when the required map alone exhausts the
// budget: still a recognizable portrait (16 KiB decoded), never a blank.
export const TOKEN_PORTRAIT_OVER_BUDGET_EDGE = 64;
// A higher tier is adopted only if it fits within this share of the headroom,
// so a token toggling in and out at a tier boundary cannot flip-flop the edge.
export const TOKEN_PORTRAIT_UPGRADE_HEADROOM_RATIO = 0.9;

const toNonNegativeInteger = (value) => {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number > 0 ? number : 0;
};

export const getDecodedImageBytes = (width, height) => {
  const safeWidth = toNonNegativeInteger(width);
  const safeHeight = toNonNegativeInteger(height);
  if (!safeWidth || !safeHeight) return 0;
  return Math.min(Number.MAX_SAFE_INTEGER, safeWidth * safeHeight * BYTES_PER_PIXEL);
};

export const getTokenPortraitDecodedBytes = (edge) => getDecodedImageBytes(edge, edge);

const tokenMediaSourceKeyCache = new WeakMap();

// Tokens share one portrait drawable only if their candidates match in both
// legacy and derivative reader modes for the same media purpose.
export const getTokenMediaSourceKey = (token) => {
  if (!token || typeof token !== 'object') return '';
  if (tokenMediaSourceKeyCache.has(token)) return tokenMediaSourceKeyCache.get(token);

  const fallbackSrc = token.imageUrl || '';
  const legacy = resolveMediaAsset(token, {fallbackSrc});
  const derivative = resolveMediaAsset(token, {fallbackSrc, compatibilityMode: 'derivative-read'});
  const sourceKey = legacy.candidates.length || derivative.candidates.length
    ? JSON.stringify([derivative.purpose, legacy.assetKey, derivative.assetKey])
    : '';
  tokenMediaSourceKeyCache.set(token, sourceKey);
  return sourceKey;
};

export const countDistinctTokenPortraitSources = (tokens) => {
  const sourceKeys = new Set();
  (Array.isArray(tokens) ? tokens : []).forEach((token) => {
    if (!token?.tokenId) return;
    const sourceKey = getTokenMediaSourceKey(token);
    if (sourceKey) sourceKeys.add(sourceKey);
  });
  return sourceKeys.size;
};

const findLargestFittingTier = (portraitSourceCount, headroomBytes) => (
  TOKEN_PORTRAIT_EDGE_TIERS.find((edge) => (
    portraitSourceCount * getTokenPortraitDecodedBytes(edge) <= headroomBytes
  )) || 0
);

// Pure tier selection. `previousEdge` (the edge currently in use) adds
// hysteresis: downgrades apply as soon as the current tier no longer fits,
// upgrades only once the higher tier fits with slack.
export const resolveTokenPortraitMaxEdge = ({
  maxTotalDecodedBytes,
  requiredMapDecodedBytes = 0,
  portraitSourceCount = 0,
  previousEdge = 0,
} = {}) => {
  const sourceCount = toNonNegativeInteger(portraitSourceCount);
  const topEdge = TOKEN_PORTRAIT_EDGE_TIERS[0];
  if (!sourceCount) return topEdge;

  const headroomBytes = toNonNegativeInteger(maxTotalDecodedBytes)
    - toNonNegativeInteger(requiredMapDecodedBytes);
  if (headroomBytes <= 0) return TOKEN_PORTRAIT_OVER_BUDGET_EDGE;
  const fittingEdge = findLargestFittingTier(sourceCount, headroomBytes);
  if (!fittingEdge) return 1;

  const currentEdge = TOKEN_PORTRAIT_EDGE_TIERS.includes(previousEdge) ? previousEdge : 0;
  if (!currentEdge || fittingEdge <= currentEdge) return fittingEdge;

  const upgradedEdge = findLargestFittingTier(
    sourceCount,
    headroomBytes * TOKEN_PORTRAIT_UPGRADE_HEADROOM_RATIO
  );
  return Math.max(currentEdge, upgradedEdge);
};
