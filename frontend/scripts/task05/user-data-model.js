const crypto = require('node:crypto');

const MODEL_VERSION = 2;
const SHELL_MAX_BYTES = 16 * 1024;
const STATE_MAX_BYTES = 64 * 1024;
const ENTRY_MAX_BYTES = 256 * 1024;
const PERSONAL_CONTENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;

const SHELL_FIELDS = Object.freeze([
  'email',
  'role',
  'username',
  'characterId',
  'race',
  'imageUrl',
  'imagePath',
  'created_at',
  'updated_at',
  'flags',
  'deletionState',
]);

const LEGACY_DOMAIN_FIELDS = new Set([
  'stats',
  'Parametri',
  'AltriParametri',
  'settings',
  'parameterLocks',
  'paramLocks',
  'equipped',
  'inventory',
  'spells',
  'tecniche',
  'lingue',
  'conoscenze',
  'professioni',
  'active_turn_effect',
]);

const RESOURCE_STAT_KEYS = new Set([
  'gold',
  'hpCurrent',
  'hpTotal',
  'manaCurrent',
  'manaTotal',
  'essenzaCurrent',
  'essenzaTotal',
  'shieldCurrent',
  'shieldTotal',
  'barrieraCurrent',
  'barrieraTotal',
  'barriera',
]);

const GRIGLIATA_SETTING_FIELDS = Object.freeze([
  'drawColorKey',
  'shareLiveInteractions',
  'grigliataMuted',
  'hiddenGrigliataBackgrounds',
  'hiddenGrigliataTokens',
]);

const isPlainObject = (value) => (
  value !== null
  && typeof value === 'object'
  && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
);

const canonicalize = (value, {inArray = false} = {}) => {
  if (value === undefined) return inArray ? {$type: 'undefined'} : undefined;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return {$type: 'number', value: 'NaN'};
    if (value === Number.POSITIVE_INFINITY) return {$type: 'number', value: 'Infinity'};
    if (value === Number.NEGATIVE_INFINITY) return {$type: 'number', value: '-Infinity'};
    if (Object.is(value, -0)) return {$type: 'number', value: '-0'};
    return value;
  }
  if (typeof value === 'bigint') return {$type: 'integer', value: value.toString()};
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return {$type: 'bytes', value: Buffer.from(value).toString('base64')};
  }
  if (value instanceof Date) return {$type: 'timestamp', value: value.toISOString()};
  if (Array.isArray(value)) return value.map((entry) => canonicalize(entry, {inArray: true}));

  if (typeof value?.toDate === 'function' && Number.isFinite(value?.seconds)) {
    return {
      $type: 'timestamp',
      seconds: String(value.seconds),
      nanoseconds: Number(value.nanoseconds || 0),
    };
  }
  if (typeof value?.path === 'string' && value?.firestore) {
    return {$type: 'reference', path: value.path};
  }
  if (Number.isFinite(value?.latitude) && Number.isFinite(value?.longitude)) {
    return {$type: 'geopoint', latitude: value.latitude, longitude: value.longitude};
  }

  const result = {};
  for (const key of Object.keys(value || {}).sort()) {
    const normalized = canonicalize(value[key]);
    if (normalized !== undefined) result[key] = normalized;
  }
  return result;
};

const canonicalStringify = (value) => JSON.stringify(canonicalize(value));
const canonicalHash = (value) => crypto.createHash('sha256')
  .update(canonicalStringify(value))
  .digest('hex');

const cloneValue = (value) => {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (isPlainObject(value)) return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, cloneValue(entry)])
  );
  return value;
};

const normalizeName = (value) => String(value || '')
  .normalize('NFKD')
  .replace(/\p{M}/gu, '')
  .toLowerCase()
  .replace(/\s+/g, ' ')
  .trim();

const normalizeDocumentId = (value) => {
  const candidate = typeof value === 'string' ? value.trim() : '';
  if (!candidate || candidate === '.' || candidate === '..' || candidate.includes('/')) return '';
  return candidate.slice(0, 512);
};

const normalizePersonalContentId = (value) => {
  const candidate = typeof value === 'string' ? value.trim() : '';
  return PERSONAL_CONTENT_ID_PATTERN.test(candidate) ? candidate : '';
};

const normalizeLegacyInstanceId = (value) => {
  const candidate = typeof value === 'string' ? value.trim() : '';
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(candidate) ? candidate : '';
};

const stableId = (prefix, value) => `${prefix}_${canonicalHash(value).slice(0, 32)}`;

const withoutInstanceMetadata = (entry) => {
  if (!isPlainObject(entry)) {
    const value = typeof entry === 'string' ? entry.trim() : '';
    return {id: value, name: value};
  }
  const result = cloneValue(entry);
  delete result._instance;
  delete result.qty;
  delete result.quantity;
  return result;
};

const inventoryName = (entry) => {
  if (typeof entry === 'string') return entry;
  return entry?.General?.Nome || entry?.name || entry?.displayName || entry?.id || '';
};

const inventoryType = (entry) => {
  if (!isPlainObject(entry)) return 'legacy';
  return String(entry.type ?? entry.item_type ?? entry.kind ?? 'legacy').trim().toLowerCase() || 'legacy';
};

const inventoryQuantity = (entry) => {
  const numeric = Number(entry?.qty ?? entry?.quantity ?? 1);
  return Number.isFinite(numeric) ? Math.max(1, Math.floor(Math.abs(numeric))) : 1;
};

const buildInventoryDocuments = (uid, legacyInventory) => {
  const entries = Array.isArray(legacyInventory) ? legacyInventory : [];
  const documents = [];
  const usedIds = new Set();
  const occurrences = new Map();

  entries.forEach((entry, legacyIndex) => {
    const type = inventoryType(entry);
    const quantity = inventoryQuantity(entry);
    const snapshot = withoutInstanceMetadata(entry);
    const snapshotHash = canonicalHash(snapshot);
    const catalogItemId = normalizeDocumentId(snapshot?.id ?? snapshot?.itemId);
    const occurrence = occurrences.get(snapshotHash) || 0;
    occurrences.set(snapshotHash, occurrence + 1);
    const unitCount = type === 'varie' ? 1 : quantity;

    for (let unitOrdinal = 0; unitOrdinal < unitCount; unitOrdinal += 1) {
      const preferredId = normalizeLegacyInstanceId(entry?._instance?.instanceId);
      const fallbackId = `legacy_${snapshotHash.slice(0, 24)}_${occurrence + 1}_${unitOrdinal + 1}`;
      let inventoryId = preferredId
        ? (unitOrdinal === 0 ? preferredId : `${preferredId}_${unitOrdinal + 1}`)
        : fallbackId;
      let collision = 1;
      while (usedIds.has(inventoryId)) {
        collision += 1;
        inventoryId = `${fallbackId}_${collision}`;
      }
      usedIds.add(inventoryId);

      const acquiredAt = entry?._instance?.acquiredAt || null;
      const pricePaid = Number(entry?._instance?.pricePaid);
      const data = {
        schemaVersion: MODEL_VERSION,
        revision: 1,
        kind: type,
        quantity: type === 'varie' ? quantity : 1,
        catalogItemId: catalogItemId || null,
        catalogVersion: entry?._instance?.catalogVersion || null,
        displayName: String(inventoryName(entry)).trim(),
        normalizedName: normalizeName(inventoryName(entry)),
        acquiredAt,
        pricePaid: Number.isFinite(pricePaid) ? pricePaid : 0,
        source: entry?._instance?.source || 'legacy',
        acquisitionSnapshot: cloneValue(snapshot),
        acquisitionHash: snapshotHash,
        currentSnapshot: cloneValue(snapshot),
        currentHash: snapshotHash,
        currentRevision: 1,
        migration: {
          index: legacyIndex,
          unit: unitOrdinal,
          originalInstanceId: entry?._instance?.instanceId ?? null,
        },
        legacyManaged: true,
      };
      documents.push({
        id: inventoryId,
        path: `users/${uid}/inventory/${inventoryId}`,
        data,
      });
    }
  });
  return documents;
};

const snapshotComparableHash = (entry) => canonicalHash(withoutInstanceMetadata(entry));

const buildEquipmentDocument = (uid, legacyEquipment, inventoryDocuments) => {
  const slots = {};
  const additionalInventoryDocuments = [];
  const usedInventoryIds = new Set();
  const candidatesByCatalogId = new Map();

  for (const document of inventoryDocuments) {
    const key = document.data.catalogItemId || '';
    if (!candidatesByCatalogId.has(key)) candidatesByCatalogId.set(key, []);
    candidatesByCatalogId.get(key).push(document);
  }

  for (const [slot, equipped] of Object.entries(isPlainObject(legacyEquipment) ? legacyEquipment : {}).sort()) {
    if (equipped == null || equipped === '') {
      slots[slot] = null;
      continue;
    }
    const instanceId = normalizeDocumentId(equipped?._instance?.instanceId);
    let match = instanceId
      ? inventoryDocuments.find((document) => document.id === instanceId)
      : null;
    const catalogItemId = normalizeDocumentId(
      typeof equipped === 'string' ? equipped : (equipped?.id || equipped?._instance?.itemId)
    );
    if (!match) {
      const candidates = candidatesByCatalogId.get(catalogItemId) || [];
      const equippedHash = snapshotComparableHash(equipped);
      match = candidates.find((candidate) => (
        !usedInventoryIds.has(candidate.id)
        && candidate.data.acquisitionHash === equippedHash
      )) || candidates.find((candidate) => !usedInventoryIds.has(candidate.id));
    }
    if (!match) {
      const snapshot = withoutInstanceMetadata(equipped);
      const snapshotHash = canonicalHash(snapshot);
      const instance = isPlainObject(equipped?._instance) ? equipped._instance : {};
      const requestedId = normalizeLegacyInstanceId(instance.instanceId);
      const slotSuffix = normalizeName(slot).replace(/[^a-z0-9]+/g, '_') || 'slot';
      const baseId = requestedId || `preserved_${snapshotHash.slice(0, 24)}_${slotSuffix}`;
      let id = baseId;
      let collision = 1;
      const allIds = new Set([
        ...inventoryDocuments.map((document) => document.id),
        ...additionalInventoryDocuments.map((document) => document.id),
      ]);
      while (allIds.has(id)) {
        collision += 1;
        id = `${baseId}_${collision}`;
      }
      match = {
        id,
        path: `users/${uid}/inventory/${id}`,
        data: {
          schemaVersion: MODEL_VERSION,
          revision: 1,
          kind: inventoryType(equipped),
          quantity: 1,
          catalogItemId: catalogItemId || null,
          catalogVersion: instance.catalogVersion ?? null,
          displayName: String(inventoryName(equipped)).trim(),
          normalizedName: normalizeName(inventoryName(equipped)),
          acquiredAt: instance.acquiredAt ?? null,
          pricePaid: Number.isFinite(Number(instance.pricePaid)) ? Number(instance.pricePaid) : 0,
          source: String(instance.source || '').trim() || 'legacy',
          acquisitionSnapshot: cloneValue(snapshot),
          acquisitionHash: snapshotHash,
          currentSnapshot: cloneValue(snapshot),
          currentHash: snapshotHash,
          currentRevision: 1,
          migration: {
            unmatchedEquipmentSlot: slot,
            originalInstanceId: instance.instanceId ?? null,
          },
          legacyManaged: true,
        },
      };
      additionalInventoryDocuments.push(match);
    }
    slots[slot] = match.id;
    usedInventoryIds.add(match.id);
  }

  const belt = isPlainObject(legacyEquipment?.cintura) ? legacyEquipment.cintura : null;
  const rawCapacity = Number(belt?.Specific?.slotCintura);
  return {
    document: {
      path: `users/${uid}/state/equipment`,
      data: {
        schemaVersion: MODEL_VERSION,
        revision: 1,
        slots,
        beltCapacity: Number.isFinite(rawCapacity) ? rawCapacity : 0,
      },
    },
    additionalInventoryDocuments,
  };
};

const contentEntries = (legacyContent) => {
  if (Array.isArray(legacyContent)) return legacyContent.map((value, index) => [String(index), value]);
  if (isPlainObject(legacyContent)) return Object.entries(legacyContent);
  return [];
};

const buildPersonalContentDocuments = (uid, kind, legacyContent) => {
  const collectionName = kind === 'spell' ? 'spells' : 'tecniche';
  const documents = [];
  const reservations = [];
  const issues = [];
  const usedIds = new Set();
  const usedExactNames = new Map();

  contentEntries(legacyContent).forEach(([legacyKey, rawValue], legacyIndex) => {
    const value = isPlainObject(rawValue) ? cloneValue(rawValue) : {value: cloneValue(rawValue)};
    const nameCandidate = value.nome ?? value.name
      ?? (Number.isInteger(Number(legacyKey)) ? '' : legacyKey);
    const displayName = typeof nameCandidate === 'string' ? nameCandidate.trim() : '';
    const requestedContentId = typeof value.id === 'string' ? value.id.trim() : '';
    let contentId = normalizePersonalContentId(requestedContentId)
      || stableId(kind, {displayName, legacyIndex, legacyKey, value});
    if (requestedContentId && !normalizePersonalContentId(requestedContentId)) {
      issues.push({
        severity: 'warning',
        code: 'personal-content-id-replaced',
        kind,
        legacyIndex,
      });
    }
    if (usedIds.has(contentId)) contentId = stableId(kind, {contentId, legacyIndex, legacyKey});
    usedIds.add(contentId);
    const exactNameHash = crypto.createHash('sha256')
      .update(`${kind}\0${displayName}`)
      .digest('hex');
    if (!displayName) {
      issues.push({
        severity: 'error',
        code: 'personal-content-name-missing',
        kind,
        legacyIndex,
      });
    } else if (usedExactNames.has(exactNameHash)) {
      issues.push({
        severity: 'error',
        code: 'personal-content-exact-name-duplicate',
        kind,
        legacyIndex,
      });
    } else {
      usedExactNames.set(exactNameHash, contentId);
    }
    const data = {
      ...value,
      id: contentId,
      schemaVersion: MODEL_VERSION,
      revision: 1,
      displayName,
      normalizedName: normalizeName(displayName),
      migration: {legacyIndex, legacyKey},
      legacyManaged: true,
    };
    documents.push({path: `users/${uid}/${collectionName}/${contentId}`, data});
    if (displayName && usedExactNames.get(exactNameHash) === contentId) {
      reservations.push({
        path: `users/${uid}/content_names/${exactNameHash}`,
        data: {
          schemaVersion: MODEL_VERSION,
          kind,
          contentId,
          exactName: displayName,
          legacyManaged: true,
        },
      });
    }
  });
  const idsByLocation = new Map(documents.map(({data}) => [
    `${data.migration.legacyIndex}\0${data.migration.legacyKey}`,
    data.id,
  ]));
  const identityEntries = contentEntries(legacyContent).map(
    ([legacyKey, rawValue], legacyIndex) => {
      const id = idsByLocation.get(`${legacyIndex}\0${legacyKey}`);
      const value = isPlainObject(rawValue)
        ? cloneValue(rawValue)
        : {value: cloneValue(rawValue)};
      return [legacyKey, id ? {...value, id} : value];
    }
  );
  const identityContent = Array.isArray(legacyContent)
    ? identityEntries.map(([, value]) => value)
    : (isPlainObject(legacyContent)
      ? Object.fromEntries(identityEntries)
      : cloneValue(legacyContent));
  return {
    documents,
    reservations,
    issues,
    identityContent,
    identitiesStable: canonicalHash({value: identityContent}) === canonicalHash({value: legacyContent}),
  };
};

const sizeIssue = (path, data, maximumBytes) => {
  const byteSize = Buffer.byteLength(canonicalStringify(data), 'utf8');
  if (byteSize > maximumBytes) return {severity: 'error', code: 'document-too-large', path, byteSize, maximumBytes};
  if (byteSize > maximumBytes * 0.8) return {severity: 'warning', code: 'document-near-limit', path, byteSize, maximumBytes};
  return null;
};

const buildUserV2Plan = (uid, legacyData = {}) => {
  if (!normalizeDocumentId(uid)) throw new Error('A valid Firestore user document ID is required.');
  const stats = isPlainObject(legacyData.stats) ? legacyData.stats : {};
  const resourceStats = {};
  const progressionStats = {};
  for (const [key, value] of Object.entries(stats)) {
    if (key === 'barriera') continue;
    (RESOURCE_STAT_KEYS.has(key) ? resourceStats : progressionStats)[key] = cloneValue(value);
  }
  if (stats.barriera !== undefined) {
    if (resourceStats.barrieraCurrent === undefined) {
      resourceStats.barrieraCurrent = cloneValue(stats.barriera);
    }
    if (resourceStats.barrieraTotal === undefined) {
      resourceStats.barrieraTotal = cloneValue(stats.barriera);
    }
  }

  const shell = {modelVersion: MODEL_VERSION};
  for (const field of SHELL_FIELDS) {
    if (legacyData[field] !== undefined) shell[field] = cloneValue(legacyData[field]);
  }
  shell.summary = {level: Number.isFinite(Number(stats.level)) ? Number(stats.level) : 1};

  const progression = {
    schemaVersion: MODEL_VERSION,
    revision: 1,
    stats: progressionStats,
    Parametri: cloneValue(legacyData.Parametri || {}),
    AltriParametri: cloneValue(legacyData.AltriParametri || {}),
    flags: cloneValue(legacyData.flags || {}),
  };
  const resources = {
    schemaVersion: MODEL_VERSION,
    revision: 1,
    stats: resourceStats,
    active_turn_effect: cloneValue(legacyData.active_turn_effect || {}),
  };
  const settings = {
    schemaVersion: MODEL_VERSION,
    revision: 1,
    settings: cloneValue(isPlainObject(legacyData.settings) ? legacyData.settings : {}),
    parameterLocks: cloneValue(
      isPlainObject(legacyData.parameterLocks) ? legacyData.parameterLocks : {}
    ),
    paramLocks: cloneValue(
      isPlainObject(legacyData.paramLocks) ? legacyData.paramLocks : {}
    ),
    grigliata: Object.fromEntries(
      GRIGLIATA_SETTING_FIELDS
        .filter((field) => legacyData[field] !== undefined)
        .map((field) => [field, cloneValue(legacyData[field])])
    ),
  };
  const profileContent = {
    schemaVersion: MODEL_VERSION,
    revision: 1,
    lingue: cloneValue(legacyData.lingue || {}),
    conoscenze: cloneValue(legacyData.conoscenze || {}),
    professioni: cloneValue(legacyData.professioni || {}),
  };

  const inventoryDocuments = buildInventoryDocuments(uid, legacyData.inventory);
  const equipment = buildEquipmentDocument(uid, legacyData.equipped, inventoryDocuments);
  inventoryDocuments.push(...equipment.additionalInventoryDocuments);
  const spells = buildPersonalContentDocuments(uid, 'spell', legacyData.spells);
  const techniques = buildPersonalContentDocuments(uid, 'tecnica', legacyData.tecniche);

  const documents = [
    {path: `users/${uid}`, data: shell},
    {path: `users/${uid}/state/progression`, data: progression},
    {path: `users/${uid}/state/resources`, data: resources},
    {path: `users/${uid}/state/settings`, data: settings},
    equipment.document,
    {path: `users/${uid}/state/profileContent`, data: profileContent},
    ...inventoryDocuments.map(({path, data}) => ({path, data})),
    ...spells.documents,
    ...techniques.documents,
    ...spells.reservations,
    ...techniques.reservations,
  ].sort((left, right) => left.path.localeCompare(right.path));

  const issues = [...spells.issues, ...techniques.issues];
  for (const document of documents) {
    const maximum = document.path === `users/${uid}`
      ? SHELL_MAX_BYTES
      : (/\/state\//.test(document.path) ? STATE_MAX_BYTES : ENTRY_MAX_BYTES);
    const issue = sizeIssue(document.path.replace(uid, '{uid}'), document.data, maximum);
    if (issue) issues.push(issue);
  }

  return {
    modelVersion: MODEL_VERSION,
    sourceHash: canonicalHash(legacyData),
    targetHash: canonicalHash(documents),
    documents,
    issues,
    legacyContentIdentities: {
      spells: spells.identityContent,
      tecniche: techniques.identityContent,
    },
    legacyContentIdentitiesStable: spells.identitiesStable && techniques.identitiesStable,
    counts: {
      documents: documents.length,
      inventory: inventoryDocuments.length,
      spells: spells.documents.length,
      tecniche: techniques.documents.length,
      reservations: spells.reservations.length + techniques.reservations.length,
    },
  };
};

const documentsByPath = (documents = []) => new Map(documents.map((document) => [document.path, document.data]));

const materializeLegacyUser = (uid, documents) => {
  const byPath = documents instanceof Map ? documents : documentsByPath(documents);
  const shell = cloneValue(byPath.get(`users/${uid}`) || {});
  const progression = byPath.get(`users/${uid}/state/progression`) || {};
  const resources = byPath.get(`users/${uid}/state/resources`) || {};
  const settings = cloneValue(byPath.get(`users/${uid}/state/settings`) || {});
  const equipment = byPath.get(`users/${uid}/state/equipment`) || {};
  const profileContent = byPath.get(`users/${uid}/state/profileContent`) || {};
  delete shell.modelVersion;
  delete shell.summary;
  const legacySettings = cloneValue(settings.settings || {});
  const grigliataSettings = cloneValue(settings.grigliata || {});

  const inventory = [...byPath.entries()]
    .filter(([path]) => path.startsWith(`users/${uid}/inventory/`))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, data]) => {
      const snapshot = cloneValue(data?.currentSnapshot ?? data?.acquisitionSnapshot ?? {});
      if (isPlainObject(snapshot)) {
        snapshot.qty = Number(data?.quantity) || 1;
        snapshot._instance = {
          ...(isPlainObject(snapshot._instance) ? snapshot._instance : {}),
          instanceId: path.split('/').pop(),
          acquiredAt: data?.acquiredAt ?? null,
          pricePaid: data?.pricePaid ?? null,
          source: data?.source || 'v2-reverse',
        };
      }
      return snapshot;
    });

  const contentMap = (collectionName) => {
    const result = {};
    for (const [, data] of [...byPath.entries()]
      .filter(([path]) => path.startsWith(`users/${uid}/${collectionName}/`))
      .sort(([left], [right]) => left.localeCompare(right))) {
      const value = cloneValue(data);
      const key = String(value.displayName || value.nome || value.name || '').trim();
      if (!key) throw new Error(`Cannot reverse ${collectionName}: exact name is missing.`);
      if (Object.prototype.hasOwnProperty.call(result, key)) {
        throw new Error(`Cannot reverse ${collectionName}: duplicate exact name.`);
      }
      delete value.schemaVersion;
      delete value.revision;
      delete value.displayName;
      delete value.normalizedName;
      delete value.migration;
      delete value.legacyManaged;
      delete value.legacySourceHash;
      delete value.legacySourceUpdateTime;
      delete value.createdAt;
      delete value.updatedAt;
      delete value.updatedBy;
      result[key] = value;
    }
    return result;
  };

  const legacyEquipment = {};
  for (const [slot, inventoryId] of Object.entries(equipment.slots || {})) {
    if (!inventoryId) {
      legacyEquipment[slot] = null;
      continue;
    }
    const data = byPath.get(`users/${uid}/inventory/${inventoryId}`);
    legacyEquipment[slot] = cloneValue(data?.currentSnapshot ?? data?.acquisitionSnapshot ?? inventoryId);
  }

  return {
    ...shell,
    stats: {...cloneValue(progression.stats || {}), ...cloneValue(resources.stats || {})},
    Parametri: cloneValue(progression.Parametri || {}),
    AltriParametri: cloneValue(progression.AltriParametri || {}),
    flags: cloneValue(progression.flags || shell.flags || {}),
    active_turn_effect: cloneValue(resources.active_turn_effect || {}),
    settings: legacySettings,
    parameterLocks: cloneValue(settings.parameterLocks || {}),
    paramLocks: cloneValue(settings.paramLocks || {}),
    ...grigliataSettings,
    equipped: legacyEquipment,
    inventory,
    spells: contentMap('spells'),
    tecniche: contentMap('tecniche'),
    lingue: cloneValue(profileContent.lingue || {}),
    conoscenze: cloneValue(profileContent.conoscenze || {}),
    professioni: cloneValue(profileContent.professioni || {}),
  };
};

const buildArchiveDocuments = (uid, legacyData) => {
  const domainPayloads = {
    shell: Object.fromEntries(Object.entries(legacyData || {}).filter(([key]) => !LEGACY_DOMAIN_FIELDS.has(key))),
    progression: {
      stats: Object.fromEntries(Object.entries(legacyData?.stats || {}).filter(([key]) => !RESOURCE_STAT_KEYS.has(key))),
      Parametri: legacyData?.Parametri || {},
      AltriParametri: legacyData?.AltriParametri || {},
    },
    resources: {
      stats: Object.fromEntries(Object.entries(legacyData?.stats || {}).filter(([key]) => RESOURCE_STAT_KEYS.has(key))),
      active_turn_effect: legacyData?.active_turn_effect || {},
    },
    settings: legacyData?.settings || {},
    equipment: legacyData?.equipped || {},
    inventory: legacyData?.inventory || [],
    personalContent: {
      spells: legacyData?.spells || {},
      tecniche: legacyData?.tecniche || {},
      lingue: legacyData?.lingue || {},
      conoscenze: legacyData?.conoscenze || {},
      professioni: legacyData?.professioni || {},
    },
  };
  const domains = Object.entries(domainPayloads).map(([domain, payload]) => ({
    path: `migration_state/user-data-v2/archives/${uid}/domains/${domain}`,
    data: {schemaVersion: MODEL_VERSION, domain, payload: cloneValue(payload), payloadHash: canonicalHash(payload)},
  }));
  return [
    {
      path: `migration_state/user-data-v2/archives/${uid}`,
      data: {
        schemaVersion: MODEL_VERSION,
        sourceHash: canonicalHash(legacyData),
        domainHashes: Object.fromEntries(domains.map((document) => [document.data.domain, document.data.payloadHash])),
      },
    },
    ...domains,
  ];
};

module.exports = {
  ENTRY_MAX_BYTES,
  LEGACY_DOMAIN_FIELDS,
  MODEL_VERSION,
  RESOURCE_STAT_KEYS,
  SHELL_MAX_BYTES,
  STATE_MAX_BYTES,
  buildArchiveDocuments,
  buildEquipmentDocument,
  buildInventoryDocuments,
  buildPersonalContentDocuments,
  buildUserV2Plan,
  canonicalHash,
  canonicalStringify,
  canonicalize,
  materializeLegacyUser,
  normalizeDocumentId,
  normalizeName,
  normalizePersonalContentId,
  PERSONAL_CONTENT_ID_PATTERN,
};
