import { resolveGrigliataDrawColorKey } from './constants';

export const GRIGLIATA_PAGE_PRESENCE_COLLECTION = 'grigliata_page_presence';
export const GRIGLIATA_PAGE_PRESENCE_HEARTBEAT_MS = 25 * 1000;
export const GRIGLIATA_PAGE_PRESENCE_STALE_MS = 75 * 1000;

const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;

const normalizeTimestampMillis = (timestamp) => {
  if (!timestamp) return 0;

  if (typeof timestamp?.toMillis === 'function') {
    return timestamp.toMillis();
  }

  if (timestamp instanceof Date) {
    return timestamp.getTime();
  }

  if (Number.isFinite(timestamp)) {
    return timestamp;
  }

  if (Number.isFinite(timestamp?.seconds)) {
    const nanoseconds = Number.isFinite(timestamp?.nanoseconds) ? timestamp.nanoseconds : 0;
    return (timestamp.seconds * 1000) + Math.floor(nanoseconds / 1e6);
  }

  return 0;
};

export const isGrigliataPagePresenceStale = (
  presence,
  now = Date.now(),
  staleMs = GRIGLIATA_PAGE_PRESENCE_STALE_MS
) => {
  const lastSeenAtMillis = normalizeTimestampMillis(presence?.lastSeenAt);
  if (!lastSeenAtMillis) {
    return true;
  }

  return (now - lastSeenAtMillis) > staleMs;
};

export const normalizeGrigliataPagePresence = (presence) => {
  const ownerUid = isNonEmptyString(presence?.ownerUid) ? presence.ownerUid.trim() : '';
  const characterId = isNonEmptyString(presence?.characterId) ? presence.characterId.trim() : '';

  if (!ownerUid || !characterId) {
    return null;
  }

  return {
    ownerUid,
    characterId,
    colorKey: resolveGrigliataDrawColorKey(presence?.colorKey),
    lastSeenAt: presence?.lastSeenAt || null,
    updatedBy: isNonEmptyString(presence?.updatedBy) ? presence.updatedBy.trim() : '',
  };
};

export const filterActiveGrigliataPagePresence = (
  presences,
  now = Date.now(),
  staleMs = GRIGLIATA_PAGE_PRESENCE_STALE_MS
) => (
  (presences || [])
    .map(normalizeGrigliataPagePresence)
    .filter(Boolean)
    .filter((presence) => !isGrigliataPagePresenceStale(presence, now, staleMs))
    .sort((left, right) => left.characterId.localeCompare(right.characterId))
);
