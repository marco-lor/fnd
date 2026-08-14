const ENTRY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const TARGET_KINDS = new Set([
  'catalog-item-spell',
  'foe-technique',
  'foe-spell',
]);
const PROJECTED_MEDIA_FIELDS = [
  'media',
  'videoMedia',
  'task07MediaRevision',
  'task07VideoMediaRevision',
  'mediaUpdatedAt',
  'videoMediaUpdatedAt',
];

const isRecord = (value) => Boolean(
  value && typeof value === 'object' && !Array.isArray(value)
);

const stableDigest = (value) => {
  const text = String(value);
  return [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35]
    .map((seed) => {
      let hash = seed;
      for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
      }
      return (hash >>> 0).toString(16).padStart(8, '0');
    })
    .join('');
};

let fallbackEntryIdSequence = 0;

export const mintTask07EmbeddedMediaEntryId = () => {
  const cryptoApi = typeof window !== 'undefined' ? window.crypto : null;
  if (typeof cryptoApi?.randomUUID === 'function') {
    return `n_${cryptoApi.randomUUID().replace(/-/g, '')}`;
  }
  if (typeof cryptoApi?.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    cryptoApi.getRandomValues(bytes);
    return `n_${[...bytes]
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('')}`;
  }
  fallbackEntryIdSequence += 1;
  return `n_${stableDigest([
    Date.now(),
    fallbackEntryIdSequence,
    typeof window !== 'undefined' && typeof window.performance?.now === 'function'
      ? window.performance.now()
      : 0,
    Math.random(),
  ].join('\u0000'))}`;
};

export const task07EmbeddedMediaEntryId = ({
  entry,
  entityId,
  targetKind,
  locator,
}) => {
  const existing = typeof entry?.task07MediaEntryId === 'string'
    ? entry.task07MediaEntryId.trim()
    : '';
  if (ENTRY_ID_PATTERN.test(existing)) return existing;
  if (!TARGET_KINDS.has(targetKind) || !String(entityId || '').trim()) {
    throw new TypeError('Task 07 embedded media identity is invalid.');
  }
  const digest = stableDigest(JSON.stringify({
    entityId: String(entityId).trim(),
    locator: String(locator),
    targetKind,
  }));
  return `n_${digest}`;
};

export const task07EmbeddedMediaBinding = (
  parent,
  entry,
  expectedTargetKind
) => {
  const entryId = typeof entry?.task07MediaEntryId === 'string'
    ? entry.task07MediaEntryId.trim()
    : '';
  const registry = isRecord(parent?.task07EmbeddedMedia)
    ? parent.task07EmbeddedMedia
    : {};
  const binding = ENTRY_ID_PATTERN.test(entryId) && isRecord(registry[entryId])
    ? registry[entryId]
    : null;
  return binding
    && TARGET_KINDS.has(expectedTargetKind)
    && binding.targetKind === expectedTargetKind
    ? binding
    : null;
};

export const withTask07EmbeddedMedia = (parent, entry, expectedTargetKind) => {
  const binding = task07EmbeddedMediaBinding(
    parent,
    entry,
    expectedTargetKind
  );
  if (!binding) return entry;
  const {targetKind: _targetKind, ...canonicalFields} = binding;
  return {...entry, ...canonicalFields};
};

export const withoutTask07EmbeddedMediaProjection = (entry = {}) => {
  const persistent = {...entry};
  PROJECTED_MEDIA_FIELDS.forEach((field) => delete persistent[field]);
  return persistent;
};

export const buildTask07NestedMediaTarget = ({
  parent,
  entry,
  entityId,
  targetKind,
  entryKey = null,
  entryIndex = null,
  slot = 'media',
}) => {
  const catalog = targetKind === 'catalog-item-spell';
  const foe = targetKind === 'foe-technique' || targetKind === 'foe-spell';
  if ((!catalog && !foe)
    || (catalog && (typeof entryKey !== 'string' || !entryKey.trim()
      || entryIndex !== null))
    || (foe && (!Number.isSafeInteger(entryIndex) || entryIndex < 0
      || entryIndex > 99 || entryKey !== null || slot !== 'media'))
    || !['media', 'videoMedia'].includes(slot)) {
    throw new TypeError('Task 07 nested media target is invalid.');
  }
  const entryId = task07EmbeddedMediaEntryId({
    entry,
    entityId,
    targetKind,
    locator: catalog ? entryKey.trim() : entryIndex,
  });
  const binding = task07EmbeddedMediaBinding(
    parent,
    {...entry, task07MediaEntryId: entryId},
    targetKind
  ) || {};
  return {
    entryId,
    binding,
    nestedTarget: {
      schemaVersion: 1,
      kind: targetKind,
      entryId,
      entryKey: catalog ? entryKey.trim() : null,
      entryIndex: foe ? entryIndex : null,
      slot,
    },
  };
};
