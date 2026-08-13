import { USER_DATA_DOMAINS, USER_DATA_SCHEMA_VERSION } from './domainSchema';

const EMPTY_OBJECT = Object.freeze({});

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const copyRecord = (value) => (isRecord(value) ? { ...value } : {});

const omitStateMetadata = (value) => {
  const result = copyRecord(value);
  delete result.schemaVersion;
  delete result.revision;
  return result;
};

export const normalizeUserRole = (role) => {
  const normalized = typeof role === 'string' ? role.trim().toLowerCase() : '';
  return normalized === 'players' ? 'player' : normalized;
};

export const normalizeUserShell = (value) => {
  if (!isRecord(value)) return null;
  const role = normalizeUserRole(value.role);
  return {
    schemaVersion: Number(value.modelVersion) || USER_DATA_SCHEMA_VERSION,
    role: role || null,
    email: value.email || null,
    username: value.username || null,
    characterId: value.characterId || null,
    race: value.race || null,
    imageUrl: value.imageUrl || null,
    imagePath: value.imagePath || null,
    media: isRecord(value.media) ? value.media : null,
    flags: copyRecord(value.flags),
    summary: {
      level: value.summary?.level ?? null,
    },
  };
};

export const normalizeV2StateDocument = (domain, value) => {
  if (!isRecord(value)) return null;
  const source = { ...value, schemaVersion: Number(value.schemaVersion) || USER_DATA_SCHEMA_VERSION };
  if (domain === USER_DATA_DOMAINS.EQUIPMENT) {
    const slots = copyRecord(source.slots || source.equipped);
    return { ...source, slots, equipped: slots };
  }
  if (domain === USER_DATA_DOMAINS.SETTINGS) {
    return { ...source, settings: copyRecord(source.settings) };
  }
  if (domain === USER_DATA_DOMAINS.PROFILE_CONTENT) {
    return {
      ...source,
      lingue: copyRecord(source.lingue),
      conoscenze: copyRecord(source.conoscenze),
      professioni: copyRecord(source.professioni),
    };
  }
  return source;
};

export const normalizeV2InventoryDocument = (document) => {
  if (!document || typeof document.id !== 'string' || typeof document.data !== 'function') {
    throw new TypeError('Inventory results require Firestore-like documents with stable IDs.');
  }
  const data = document.data();
  if (!isRecord(data)) throw new TypeError(`Inventory document ${document.id} must be an object.`);
  const snapshot = data.currentSnapshot || data.acquisitionSnapshot || data.item || EMPTY_OBJECT;
  const compatibleSnapshot = isRecord(snapshot) ? snapshot : EMPTY_OBJECT;
  const catalogItemId = typeof data.catalogItemId === 'string' && data.catalogItemId.trim()
    ? data.catalogItemId.trim()
    : null;
  const displayItemId = catalogItemId || compatibleSnapshot.id || document.id;
  return Object.freeze({
    ...compatibleSnapshot,
    ...(isRecord(data.media) ? { media: data.media } : {}),
    ...(Number.isSafeInteger(data.task07MediaRevision)
      ? { task07MediaRevision: data.task07MediaRevision }
      : {}),
    ...(data.mediaUpdatedAt !== undefined
      ? { mediaUpdatedAt: data.mediaUpdatedAt }
      : {}),
    id: displayItemId,
    qty: Number(data.quantity) > 0 ? Number(data.quantity) : compatibleSnapshot.qty,
    _instance: {
      ...copyRecord(compatibleSnapshot._instance),
      instanceId: document.id,
      acquiredAt: data.acquiredAt ?? compatibleSnapshot._instance?.acquiredAt ?? null,
      pricePaid: data.pricePaid ?? compatibleSnapshot._instance?.pricePaid ?? null,
      source: data.source ?? compatibleSnapshot._instance?.source ?? null,
      catalogVersion: data.catalogVersion ?? compatibleSnapshot._instance?.catalogVersion ?? null,
    },
    _task05: Object.freeze({
      inventoryId: document.id,
      schemaVersion: Number(data.schemaVersion) || USER_DATA_SCHEMA_VERSION,
      revision: Number(data.revision) || 0,
      catalogItemId,
    }),
  });
};

export const normalizeV2PersonalContentDocument = (document) => {
  if (!document || typeof document.id !== 'string' || typeof document.data !== 'function') {
    throw new TypeError('Personal-content results require Firestore-like documents with stable IDs.');
  }
  const data = document.data();
  if (!isRecord(data)) throw new TypeError(`Personal-content document ${document.id} must be an object.`);
  const nested = isRecord(data.data) ? data.data : omitStateMetadata(data);
  const name = data.displayName || data.name || nested.name || nested.Nome || document.id;
  return Object.freeze({
    ...nested,
    ...(isRecord(data.media) ? { media: data.media } : {}),
    ...(isRecord(data.videoMedia) ? { videoMedia: data.videoMedia } : {}),
    ...(Number.isSafeInteger(data.task07MediaRevision)
      ? { task07MediaRevision: data.task07MediaRevision }
      : {}),
    ...(Number.isSafeInteger(data.task07VideoMediaRevision)
      ? { task07VideoMediaRevision: data.task07VideoMediaRevision }
      : {}),
    ...(data.mediaUpdatedAt !== undefined
      ? { mediaUpdatedAt: data.mediaUpdatedAt }
      : {}),
    ...(data.videoMediaUpdatedAt !== undefined
      ? { videoMediaUpdatedAt: data.videoMediaUpdatedAt }
      : {}),
    name,
    _task05ContentId: document.id,
  });
};

export const mapV2PersonalContentItems = (items) => {
  if (!Array.isArray(items)) return {};
  return items.reduce((result, entry) => {
    if (!entry || typeof entry !== 'object') return result;
    const preferredKey = entry.name || entry._task05ContentId;
    const key = Object.prototype.hasOwnProperty.call(result, preferredKey)
      ? `${preferredKey}#${entry._task05ContentId}`
      : preferredKey;
    result[key] = entry;
    return result;
  }, {});
};

const isPlainObject = (value) => (
  value !== null
  && typeof value === 'object'
  && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype
);

export const areUserDomainValuesEqual = (left, right) => {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((entry, index) => areUserDomainValuesEqual(entry, right[index]));
  }
  if (!isPlainObject(left) || !isPlainObject(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => (
    Object.prototype.hasOwnProperty.call(right, key)
    && areUserDomainValuesEqual(left[key], right[key])
  ));
};

export const preserveUserDomainIdentity = (previous, next) => (
  previous !== undefined && areUserDomainValuesEqual(previous, next) ? previous : next
);
