const TASK07_ASSET_ID_PATTERN = /^m_[a-f0-9]{40}$/;

const TASK07_FOE_TRANSPORT_FIELDS = new Set([
  'media',
  'mediaUpdatedAt',
  'task07MediaRevision',
  'task07VideoMediaRevision',
  'videoMedia',
  'videoMediaUpdatedAt',
]);

const isRecord = (value) => (
  Boolean(value && typeof value === 'object' && !Array.isArray(value))
);

const hasOwn = (value, key) => (
  Object.prototype.hasOwnProperty.call(value, key)
);

const isRevision = (value) => (
  Number.isSafeInteger(value) && value >= 0
);

const stableValue = (value) => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isRecord(value)) return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = stableValue(value[key]);
    return result;
  }, {});
};

const descriptorsMatch = (left, right) => (
  JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right))
);

const storagePathFromValue = (value) => {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  if (!normalized) return '';
  if (!/^https?:\/\//i.test(normalized)) return normalized;
  const encodedPath = normalized.split('/o/')[1]?.split('?')[0] || '';
  if (!encodedPath) return '';
  try {
    return decodeURIComponent(encodedPath);
  } catch {
    return '';
  }
};

const getPersistedStoragePaths = (item) => {
  if (!isRecord(item)) return [];
  return [...new Set([
    'imagePath',
    'imageUrl',
    'image_url',
    'url',
    'downloadUrl',
  ].map((field) => storagePathFromValue(item[field])).filter(Boolean))];
};

export const isClientDeletableFoeStoragePath = (path) => {
  if (typeof path !== 'string') return false;
  const normalized = path.trim();
  if (!normalized.startsWith('foes/') || normalized.includes('\\')) return false;
  if (normalized.startsWith('foes/task07-operations/')) return false;
  return normalized.split('/').every((part) => (
    Boolean(part) && part !== '.' && part !== '..'
  ));
};

export const deleteFoeDocumentThenCleanupStorage = async ({
  deleteFoeDocument,
  deleteStoragePath,
  paths,
}) => {
  await deleteFoeDocument();
  return Promise.allSettled(
    [...new Set(Array.isArray(paths) ? paths : [])]
      .filter(isClientDeletableFoeStoragePath)
      .map((path) => deleteStoragePath(path))
  );
};

export const resolveFoeMediaBinding = (foe) => {
  const root = isRecord(foe) ? foe : {};
  const general = isRecord(root.General) ? root.General : {};
  const descriptors = [];
  let malformed = false;
  let conflict = false;
  const rootRevisionIsExplicit = hasOwn(root, 'task07MediaRevision');
  const generalRevisionIsExplicit = hasOwn(general, 'task07MediaRevision');
  const rootRevision = root.task07MediaRevision;
  const generalRevision = general.task07MediaRevision;

  [
    ['root', root],
    ['general', general],
  ].forEach(([location, container]) => {
    if (!hasOwn(container, 'media') || container.media == null) return;
    if (!isRecord(container.media)) {
      malformed = true;
      return;
    }
    const assetId = typeof container.media.assetId === 'string'
      ? container.media.assetId.trim()
      : '';
    if (!TASK07_ASSET_ID_PATTERN.test(assetId)) {
      malformed = true;
      return;
    }
    descriptors.push({
      assetId,
      descriptor: container.media,
      location,
    });
  });

  if (rootRevisionIsExplicit && !isRevision(rootRevision)) {
    conflict = true;
  }
  if (descriptors.length === 2) {
    if (!descriptorsMatch(descriptors[0].descriptor, descriptors[1].descriptor)) {
      conflict = true;
    }
    if (generalRevisionIsExplicit && !isRevision(generalRevision)) {
      conflict = true;
    }
    if (
      rootRevisionIsExplicit
      && generalRevisionIsExplicit
      && isRevision(rootRevision)
      && isRevision(generalRevision)
      && rootRevision !== generalRevision
    ) {
      conflict = true;
    }
  }

  const assetIds = [...new Set(descriptors.map(({assetId}) => assetId))];
  if (malformed) {
    return {
      assetId: null,
      descriptors,
      revision: isRevision(rootRevision) ? rootRevision : 0,
      status: 'malformed',
    };
  }
  if (conflict || assetIds.length > 1) {
    return {
      assetId: null,
      descriptors,
      revision: isRevision(rootRevision) ? rootRevision : 0,
      status: 'conflict',
    };
  }
  if (assetIds.length === 1) {
    return {
      assetId: assetIds[0],
      descriptors,
      revision: isRevision(rootRevision) ? rootRevision : 0,
      status: 'canonical',
    };
  }
  return {
    assetId: null,
    descriptors: [],
    revision: isRevision(rootRevision) ? rootRevision : 0,
    status: 'none',
  };
};

export const collectClientDeletableFoeMainStoragePaths = (foe) => {
  const root = isRecord(foe) ? foe : {};
  const general = isRecord(root.General) ? root.General : {};
  return [...new Set(
    [root, general]
      .flatMap(getPersistedStoragePaths)
      .filter(isClientDeletableFoeStoragePath)
  )];
};

export const shouldClientDeleteFoeMainStorageObject = (foe) => (
  collectClientDeletableFoeMainStoragePaths(foe).length > 0
);

const hasTask07DuplicateState = (foe) => {
  const root = isRecord(foe) ? foe : {};
  const general = isRecord(root.General) ? root.General : {};
  const nested = [
    ...(Array.isArray(root.tecniche) ? root.tecniche : []),
    ...(Array.isArray(root.spells) ? root.spells : []),
  ];
  return [root, general, ...nested].some((container) => {
    if (!isRecord(container)) return false;
    if (
      (hasOwn(container, 'media') && container.media != null)
      || (hasOwn(container, 'videoMedia') && container.videoMedia != null)
    ) return true;
    return [
      'imagePath',
      'imageUrl',
      'image_url',
      'url',
      'downloadUrl',
      'videoPath',
      'videoUrl',
      'video_url',
    ].some((field) => {
      const value = container[field];
      return typeof value === 'string'
        ? Boolean(value.trim())
        : value != null;
    });
  });
};

export const shouldUseDurableFoeDuplication = (
  foe,
  { force = false } = {}
) => Boolean(
  force
  || resolveFoeMediaBinding(foe).status !== 'none'
  || hasTask07DuplicateState(foe)
);

const DEFINITIVE_FOE_DUPLICATION_ERROR_CODES = new Set([
  'failed-precondition',
  'invalid-argument',
  'not-found',
  'already-exists',
]);

export const isDefinitiveFoeDuplicationError = (error) => {
  const code = typeof error?.code === 'string'
    ? error.code.replace(/^functions\//, '')
    : '';
  return DEFINITIVE_FOE_DUPLICATION_ERROR_CODES.has(code);
};

export const collectClientDeletableFoeStoragePaths = (foe) => {
  const paths = new Set(collectClientDeletableFoeMainStoragePaths(foe));
  const addPath = (item) => {
    getPersistedStoragePaths(item).forEach((path) => {
      if (isClientDeletableFoeStoragePath(path)) paths.add(path);
    });
  };

  // Canonical objects are server-owned. A canonical foe can still retain a
  // legacy rollback object under foes/** at root or General, which remains
  // client-owned.
  (Array.isArray(foe?.tecniche) ? foe.tecniche : []).forEach(addPath);
  (Array.isArray(foe?.spells) ? foe.spells : []).forEach(addPath);

  return [...paths];
};

export const buildCanonicalFoeClientPayload = (
  payload,
  { omitMainImageFields = false } = {}
) => {
  const source = isRecord(payload) ? payload : {};
  return Object.fromEntries(Object.entries(source).filter(([key]) => (
    key !== 'General'
    && key !== 'id'
    && !TASK07_FOE_TRANSPORT_FIELDS.has(key)
    && (!omitMainImageFields || !['imagePath', 'imageUrl'].includes(key))
  )));
};

export const classifyFoeImageSave = ({
  currentFoe,
  hasImageFile = false,
  initialFoe = null,
  removeImage = false,
  task07WriteEnabled = false,
}) => {
  const changesMainImage = Boolean(hasImageFile || removeImage);
  const currentBinding = resolveFoeMediaBinding(currentFoe);
  const initialBinding = resolveFoeMediaBinding(initialFoe);
  let binding = currentBinding;

  if (initialBinding.status === 'malformed' || initialBinding.status === 'conflict') {
    binding = initialBinding;
  } else if (initialBinding.status === 'canonical') {
    if (hasImageFile && currentFoe && currentBinding.status === 'none') {
      return {
        binding: currentBinding,
        code: 'canonical-media-changed',
        message: 'This foe image changed while the editor was open. Reopen it before replacing or removing the image.',
        mode: 'blocked',
      };
    }
    if (!currentFoe || currentBinding.status === 'none') {
      // A missing live binding is the expected retry shape after retirement
      // succeeded but its acknowledgement was lost. It also keeps ordinary
      // edits on the canonical-sanitized payload path instead of reattaching
      // stale modal transport fields.
      binding = initialBinding;
    } else if (currentBinding.status === 'canonical') {
      const sameDescriptor = descriptorsMatch(
        initialBinding.descriptors[0]?.descriptor,
        currentBinding.descriptors[0]?.descriptor
      );
      const sameBinding = initialBinding.assetId === currentBinding.assetId
        && initialBinding.revision === currentBinding.revision
        && sameDescriptor;
      if (changesMainImage && !sameBinding) {
        return {
          binding: currentBinding,
          code: 'canonical-media-changed',
          message: 'This foe image changed while the editor was open. Reopen it before replacing or removing the image.',
          mode: 'blocked',
        };
      }
      if (sameBinding) binding = initialBinding;
    }
  }

  if (changesMainImage && binding.status === 'malformed') {
    return {
      binding,
      code: 'canonical-media-malformed',
      message: 'Canonical foe media is malformed and must be repaired before changing the image.',
      mode: 'blocked',
    };
  }
  if (changesMainImage && binding.status === 'conflict') {
    return {
      binding,
      code: 'canonical-media-conflict',
      message: 'This foe has conflicting canonical image references. Reopen it after the media state is repaired.',
      mode: 'blocked',
    };
  }
  if (removeImage && binding.status === 'canonical') {
    return {binding, code: null, message: '', mode: 'canonical-remove'};
  }
  if (hasImageFile && binding.status === 'canonical' && !task07WriteEnabled) {
    return {
      binding,
      code: 'canonical-replacement-disabled',
      message: 'Canonical foe image replacement is unavailable until Task 07 foe writes are enabled.',
      mode: 'blocked',
    };
  }
  if (hasImageFile && task07WriteEnabled) {
    return {binding, code: null, message: '', mode: 'canonical-upload'};
  }
  if (removeImage) {
    return {binding, code: null, message: '', mode: 'legacy-remove'};
  }
  if (hasImageFile) {
    return {binding, code: null, message: '', mode: 'legacy-upload'};
  }
  return {binding, code: null, message: '', mode: 'ordinary'};
};
