import { USER_DATA_DOMAINS, USER_DATA_SCHEMA_VERSION } from './domainSchema';
import { normalizeLegacyInventoryWithStableIds } from './legacyInventoryProjection';

const EMPTY_OBJECT = Object.freeze({});

const RESOURCE_STAT_FIELDS = new Set([
  'gold',
  'hpCurrent',
  'hpTotal',
  'manaCurrent',
  'manaTotal',
  'essenzaCurrent',
  'essenzaTotal',
  'barrieraCurrent',
  'barrieraTotal',
  'shieldCurrent',
  'shieldTotal',
  'barriera',
]);

const GRIGLIATA_SETTING_FIELDS = [
  'drawColorKey',
  'shareLiveInteractions',
  'grigliataMuted',
  'hiddenGrigliataBackgrounds',
  'hiddenGrigliataTokens',
];

const canonicalResourceStats = (value) => {
  const stats = copyRecord(value);
  if (stats.barriera !== undefined) {
    if (stats.barrieraCurrent === undefined) stats.barrieraCurrent = stats.barriera;
    if (stats.barrieraTotal === undefined) stats.barrieraTotal = stats.barriera;
    delete stats.barriera;
  }
  return stats;
};

const STATE_TRANSPORT_FIELDS = new Set([
  'schemaVersion',
  'modelVersion',
  'revision',
  'createdAt',
  'updatedAt',
  'updatedBy',
  'legacySourceHash',
  'legacySourceUpdateTime',
]);

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const copyRecord = (value) => (isRecord(value) ? { ...value } : {});

const omitMetadata = (value) => {
  const result = copyRecord(value);
  delete result.schemaVersion;
  delete result.revision;
  return result;
};

export const normalizeLegacyRole = (role) => {
  const normalized = typeof role === 'string' ? role.trim().toLowerCase() : '';
  return normalized === 'players' ? 'player' : normalized;
};

export const normalizeLegacyUserAggregate = (value) => {
  if (!isRecord(value)) return null;
  const role = normalizeLegacyRole(value.role);
  return role && role !== value.role ? { ...value, role } : value;
};

export const selectLegacyProfile = (aggregate) => {
  const source = normalizeLegacyUserAggregate(aggregate);
  if (!source) return null;
  return {
    schemaVersion: Number(source.schemaVersion) || 1,
    role: source.role || null,
    email: source.email || null,
    username: source.username || null,
    characterId: source.characterId || null,
    race: source.race || null,
    imageUrl: source.imageUrl || null,
    imagePath: source.imagePath || null,
    flags: copyRecord(source.flags),
    summary: {
      level: source.summary?.level ?? source.stats?.level ?? null,
    },
  };
};

export const selectLegacyProgression = (aggregate) => {
  const source = normalizeLegacyUserAggregate(aggregate);
  if (!source) return null;
  return {
    schemaVersion: Number(source.schemaVersion) || 1,
    stats: copyRecord(source.stats),
    Parametri: copyRecord(source.Parametri),
    AltriParametri: copyRecord(source.AltriParametri),
    flags: copyRecord(source.flags),
  };
};

export const selectLegacyResources = (aggregate) => {
  const source = normalizeLegacyUserAggregate(aggregate);
  if (!source) return null;
  return {
    schemaVersion: Number(source.schemaVersion) || 1,
    stats: canonicalResourceStats(source.stats),
    active_turn_effect: source.active_turn_effect ?? null,
  };
};

export const selectLegacySettings = (aggregate) => {
  const source = normalizeLegacyUserAggregate(aggregate);
  if (!source) return null;
  return {
    schemaVersion: Number(source.schemaVersion) || 1,
    settings: copyRecord(source.settings),
    parameterLocks: copyRecord(source.parameterLocks),
    paramLocks: copyRecord(source.paramLocks),
    grigliata: Object.fromEntries(GRIGLIATA_SETTING_FIELDS
      .filter((field) => source[field] !== undefined)
      .map((field) => [field, source[field]])),
  };
};

export const selectLegacyEquipment = (aggregate) => {
  const source = normalizeLegacyUserAggregate(aggregate);
  if (!source) return null;
  return {
    schemaVersion: Number(source.schemaVersion) || 1,
    slots: copyRecord(source.equipped),
    equipped: copyRecord(source.equipped),
    beltCapacity: source.equipped?.cintura?.Specific?.slotCintura
      ?? source.beltCapacity
      ?? source.slotCintura
      ?? 0,
  };
};

export const selectLegacyProfileContent = (aggregate) => {
  const source = normalizeLegacyUserAggregate(aggregate);
  if (!source) return null;
  return {
    schemaVersion: Number(source.schemaVersion) || 1,
    lingue: copyRecord(source.lingue),
    conoscenze: copyRecord(source.conoscenze),
    professioni: copyRecord(source.professioni),
  };
};

export const selectLegacyInventory = (aggregate) => {
  const source = normalizeLegacyUserAggregate(aggregate);
  return normalizeLegacyInventoryWithStableIds(
    source && Array.isArray(source.inventory) ? source.inventory : []
  );
};

export const selectLegacyPersonalContent = (aggregate, field) => {
  const source = normalizeLegacyUserAggregate(aggregate);
  return source ? copyRecord(source[field]) : {};
};

export const selectLegacyDomain = (aggregate, domain) => {
  switch (domain) {
    case USER_DATA_DOMAINS.PROFILE:
      return selectLegacyProfile(aggregate);
    case USER_DATA_DOMAINS.PROGRESSION:
      return selectLegacyProgression(aggregate);
    case USER_DATA_DOMAINS.RESOURCES:
      return selectLegacyResources(aggregate);
    case USER_DATA_DOMAINS.SETTINGS:
      return selectLegacySettings(aggregate);
    case USER_DATA_DOMAINS.EQUIPMENT:
      return selectLegacyEquipment(aggregate);
    case USER_DATA_DOMAINS.PROFILE_CONTENT:
      return selectLegacyProfileContent(aggregate);
    case USER_DATA_DOMAINS.INVENTORY:
      return selectLegacyInventory(aggregate);
    case USER_DATA_DOMAINS.SPELLS:
      return selectLegacyPersonalContent(aggregate, 'spells');
    case USER_DATA_DOMAINS.TECHNIQUES:
      return selectLegacyPersonalContent(aggregate, 'tecniche');
    default:
      throw new TypeError(`Unsupported user-data domain: ${String(domain)}`);
  }
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
  const catalogItemId = data.catalogItemId || compatibleSnapshot.id || document.id;
  return Object.freeze({
    ...compatibleSnapshot,
    id: catalogItemId,
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
      migration: copyRecord(data.migration),
      legacyManaged: data.legacyManaged === true,
    }),
  });
};

export const normalizeV2PersonalContentDocument = (document) => {
  if (!document || typeof document.id !== 'string' || typeof document.data !== 'function') {
    throw new TypeError('Personal-content results require Firestore-like documents with stable IDs.');
  }
  const data = document.data();
  if (!isRecord(data)) throw new TypeError(`Personal-content document ${document.id} must be an object.`);
  const nested = isRecord(data.data) ? data.data : omitMetadata(data);
  const name = data.displayName || data.name || nested.name || nested.Nome || document.id;
  return Object.freeze({
    ...nested,
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

const canonicalizeUserDomainValue = (value) => {
  if (Array.isArray(value)) return value.map(canonicalizeUserDomainValue);
  if (!value || typeof value !== 'object') return value;
  if (typeof value.toJSON === 'function') return value.toJSON();
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = canonicalizeUserDomainValue(value[key]);
    return result;
  }, {});
};

const serializeUserDomainValue = (value) => JSON.stringify(canonicalizeUserDomainValue(value));

const omitTopLevelFields = (value, fields) => Object.fromEntries(
  Object.entries(copyRecord(value)).filter(([key]) => !fields.has(key))
);

const pickDefinedFields = (value, fields) => Object.fromEntries(
  fields
    .filter((field) => value?.[field] !== undefined)
    .map((field) => [field, value[field]])
);

const projectProfileForComparison = (value) => ({
  role: normalizeLegacyRole(value?.role) || null,
  email: value?.email ?? null,
  username: value?.username ?? null,
  characterId: value?.characterId ?? null,
  race: value?.race ?? null,
  imageUrl: value?.imageUrl ?? null,
  imagePath: value?.imagePath ?? null,
  flags: copyRecord(value?.flags),
  summary: { level: value?.summary?.level ?? value?.stats?.level ?? null },
});

const projectProgressionForComparison = (value) => ({
  stats: Object.fromEntries(Object.entries(copyRecord(value?.stats))
    .filter(([field]) => !RESOURCE_STAT_FIELDS.has(field))),
  Parametri: copyRecord(value?.Parametri),
  AltriParametri: copyRecord(value?.AltriParametri),
  flags: copyRecord(value?.flags),
});

const projectResourcesForComparison = (value) => ({
  stats: pickDefinedFields(canonicalResourceStats(value?.stats), [...RESOURCE_STAT_FIELDS]),
  active_turn_effect: copyRecord(value?.active_turn_effect),
});

const projectSettingsForComparison = (value) => ({
  settings: copyRecord(value?.settings),
  grigliata: {
    ...pickDefinedFields(value, GRIGLIATA_SETTING_FIELDS),
    ...copyRecord(value?.grigliata),
  },
  locks: {
    ...copyRecord(value?.paramLocks),
    ...copyRecord(value?.parameterLocks),
    ...copyRecord(value?.locks),
  },
});

const projectProfileContentForComparison = (value) => ({
  lingue: copyRecord(value?.lingue),
  conoscenze: copyRecord(value?.conoscenze),
  professioni: copyRecord(value?.professioni),
});

const inventoryKind = (entry) => String(
  entry?.type ?? entry?.item_type ?? entry?.kind ?? 'legacy'
).trim().toLowerCase() || 'legacy';

const inventoryQuantity = (entry) => {
  const quantity = Number(entry?.qty ?? entry?.quantity ?? 1);
  return Number.isFinite(quantity) ? Math.max(1, Math.floor(Math.abs(quantity))) : 1;
};

const inventorySnapshotForComparison = (entry) => {
  const snapshot = omitTopLevelFields(entry, new Set([
    ...STATE_TRANSPORT_FIELDS,
    '_instance',
    '_task05',
    'qty',
    'quantity',
  ]));
  return snapshot;
};

const inventoryAcquisitionForComparison = (entry) => ({
  acquiredAt: entry?._instance?.acquiredAt ?? null,
  pricePaid: Number(entry?._instance?.pricePaid ?? 0) || 0,
  source: entry?._instance?.source || 'legacy',
  catalogVersion: entry?._instance?.catalogVersion ?? null,
});

const inventoryDescriptor = (entry) => ({
  snapshot: inventorySnapshotForComparison(entry),
  acquisition: inventoryAcquisitionForComparison(entry),
});

const projectInventoryForComparison = (value) => {
  const projected = [];
  (Array.isArray(value) ? value : []).forEach((rawEntry) => {
    const entry = isRecord(rawEntry)
      ? rawEntry
      : { id: String(rawEntry || ''), name: String(rawEntry || '') };
    if (entry?._task05?.migration?.unmatchedEquipmentSlot) return;
    const units = inventoryKind(entry) === 'varie' ? 1 : inventoryQuantity(entry);
    const descriptor = inventoryDescriptor(entry);
    for (let unit = 0; unit < units; unit += 1) projected.push(descriptor);
    if (inventoryKind(entry) === 'varie') {
      projected[projected.length - 1] = {
        ...descriptor,
        quantity: inventoryQuantity(entry),
      };
    }
  });
  return projected.sort((left, right) => (
    serializeUserDomainValue(left).localeCompare(serializeUserDomainValue(right))
  ));
};

const inventoryEntriesWithIdentity = (value) => {
  const output = [];
  (Array.isArray(value) ? value : []).forEach((rawEntry) => {
    const entry = isRecord(rawEntry)
      ? rawEntry
      : { id: String(rawEntry || ''), name: String(rawEntry || '') };
    const quantity = inventoryQuantity(entry);
    const units = inventoryKind(entry) === 'varie' ? 1 : quantity;
    const instanceId = entry?._task05?.inventoryId || entry?._instance?.instanceId || null;
    for (let unit = 0; unit < units; unit += 1) {
      output.push({
        identity: instanceId && unit > 0 ? `${instanceId}_${unit + 1}` : instanceId,
        catalogItemId: entry?.id || entry?.itemId || null,
        descriptor: inventoryDescriptor(entry),
      });
    }
  });
  return output;
};

const projectEquipmentForComparison = (value, inventory) => {
  const candidates = inventoryEntriesWithIdentity(inventory);
  const usedCandidates = new Set();
  const resolveSlot = (rawEntry) => {
    if (rawEntry === null || rawEntry === undefined || rawEntry === '') return null;
    if (isRecord(rawEntry)) return inventoryDescriptor(rawEntry);
    const requestedId = String(rawEntry);
    let index = candidates.findIndex((candidate, candidateIndex) => (
      !usedCandidates.has(candidateIndex) && candidate.identity === requestedId
    ));
    if (index < 0) {
      index = candidates.findIndex((candidate, candidateIndex) => (
        !usedCandidates.has(candidateIndex) && candidate.catalogItemId === requestedId
      ));
    }
    if (index < 0) return { unresolvedInventoryId: requestedId };
    usedCandidates.add(index);
    return candidates[index].descriptor;
  };
  const slots = Object.fromEntries(Object.entries(copyRecord(value?.slots || value?.equipped))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([slot, entry]) => [slot, resolveSlot(entry)]));
  return {
    slots,
    beltCapacity: Number(value?.beltCapacity) || 0,
  };
};

const personalContentEntries = (value) => {
  if (Array.isArray(value)) return value.map((entry, index) => [String(index), entry]);
  return Object.entries(copyRecord(value));
};

const projectPersonalContentForComparison = (value) => personalContentEntries(value)
  .map(([key, rawValue]) => {
    const entry = isRecord(rawValue) ? rawValue : { value: rawValue };
    const displayName = entry.displayName
      || entry.nome
      || entry.name
      || (/^\d+$/.test(key) ? '' : key.split('#')[0]);
    const data = omitTopLevelFields(entry, new Set([
      ...STATE_TRANSPORT_FIELDS,
      '_task05ContentId',
      'displayName',
      'normalizedName',
      'migration',
      'legacyManaged',
      'id',
      'name',
    ]));
    return { name: String(displayName || '').trim(), data };
  })
  .sort((left, right) => (
    serializeUserDomainValue(left).localeCompare(serializeUserDomainValue(right))
  ));

export const projectUserDomainForComparison = (domain, value, context = {}) => {
  switch (domain) {
    case USER_DATA_DOMAINS.PROFILE:
      return projectProfileForComparison(value);
    case USER_DATA_DOMAINS.PROGRESSION:
      return projectProgressionForComparison(value);
    case USER_DATA_DOMAINS.RESOURCES:
      return projectResourcesForComparison(value);
    case USER_DATA_DOMAINS.SETTINGS:
      return projectSettingsForComparison(value);
    case USER_DATA_DOMAINS.EQUIPMENT:
      return projectEquipmentForComparison(value, context.inventory);
    case USER_DATA_DOMAINS.PROFILE_CONTENT:
      return projectProfileContentForComparison(value);
    case USER_DATA_DOMAINS.INVENTORY:
      return projectInventoryForComparison(value);
    case USER_DATA_DOMAINS.SPELLS:
    case USER_DATA_DOMAINS.TECHNIQUES:
      return projectPersonalContentForComparison(value);
    default:
      return omitTopLevelFields(value, STATE_TRANSPORT_FIELDS);
  }
};

export const summarizeUserDomainValue = (value) => {
  const serialized = serializeUserDomainValue(value);
  let hash = 2166136261;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const count = Array.isArray(value)
    ? value.length
    : value && typeof value === 'object'
      ? Object.keys(value).length
      : value === null || value === undefined ? 0 : 1;
  return { count, hash: (hash >>> 0).toString(16).padStart(8, '0') };
};

export const compareUserDomainValues = (legacyValue, v2Value, options = {}) => {
  const legacyProjection = options.domain
    ? projectUserDomainForComparison(options.domain, legacyValue, {
      inventory: options.legacyInventory,
    })
    : legacyValue;
  const v2Projection = options.domain
    ? projectUserDomainForComparison(options.domain, v2Value, {
      inventory: options.v2Inventory,
    })
    : v2Value;
  const legacy = summarizeUserDomainValue(legacyProjection);
  const v2 = summarizeUserDomainValue(v2Projection);
  return {
    legacy,
    v2,
    countMismatch: legacy.count !== v2.count,
    valueMismatch: legacy.hash !== v2.hash,
  };
};

export const composeLegacyCompatibleUserData = ({
  profile,
  progression,
  resources,
  settings,
  equipment,
  profileContent,
  inventory,
  spells,
  techniques,
} = {}) => {
  if (!profile && !progression && !resources && !settings && !equipment && !profileContent) {
    return null;
  }
  return {
    ...omitMetadata(profile),
    flags: {
      ...copyRecord(profile?.flags),
      ...copyRecord(progression?.flags),
    },
    stats: {
      ...copyRecord(progression?.stats),
      ...copyRecord(resources?.stats),
      ...(profile?.summary?.level !== null && profile?.summary?.level !== undefined
        ? { level: profile.summary.level }
        : {}),
    },
    Parametri: copyRecord(progression?.Parametri),
    AltriParametri: copyRecord(progression?.AltriParametri),
    active_turn_effect: resources?.active_turn_effect ?? null,
    settings: copyRecord(settings?.settings),
    equipped: copyRecord(equipment?.slots || equipment?.equipped),
    beltCapacity: equipment?.beltCapacity ?? null,
    lingue: copyRecord(profileContent?.lingue),
    conoscenze: copyRecord(profileContent?.conoscenze),
    professioni: copyRecord(profileContent?.professioni),
    inventory: Array.isArray(inventory) ? inventory : [],
    spells: copyRecord(spells),
    tecniche: copyRecord(techniques),
  };
};
