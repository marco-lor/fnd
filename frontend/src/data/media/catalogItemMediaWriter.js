import { isTask07MediaV1WriteEnabled } from './mediaFeatureFlags';
import { runTask07ControlledWriterUpload } from './mediaWriterAdapter';
import {
  buildTask07NestedMediaTarget,
  task07EmbeddedMediaBinding,
  withoutTask07EmbeddedMediaProjection,
  withTask07EmbeddedMedia,
} from './embeddedMediaProjection';
import { runTask07NestedMediaWriter } from './embeddedMedia';
import { runTask07EmbeddedOperationSequence } from './embeddedMediaRetry';
import {
  getTask07MediaStatus,
  retireTask07MediaAsset,
} from './mediaPipeline';
import { getTask07PreviousAssetId } from './mediaConsumerAdapter';

export const task07CatalogItemImageEditorState = (item = {}, {
  objectUrl = '',
  removed = false,
} = {}) => {
  const legacyUrl = typeof item?.General?.image_url === 'string'
    ? item.General.image_url.trim()
    : '';
  const assetId = getTask07PreviousAssetId(item);
  const localUrl = typeof objectUrl === 'string' ? objectUrl : '';
  return {
    assetId,
    compatibilityMode: localUrl ? 'legacy' : 'auto',
    hasImage: Boolean(localUrl || (!removed && (assetId || legacyUrl))),
    media: localUrl ? { imageUrl: localUrl } : item,
    src: localUrl || (!removed ? legacyUrl : '') || null,
  };
};

export const retireTask07CatalogItemImage = async (
  currentItem,
  {
    getStatus = getTask07MediaStatus,
    retire = retireTask07MediaAsset,
  } = {}
) => {
  const assetId = getTask07PreviousAssetId(currentItem);
  if (!assetId) return {assetId: null, handled: false, status: 'absent'};
  try {
    const retirement = await retire(assetId);
    return {assetId, handled: true, retirement, status: 'retired'};
  } catch (retirementError) {
    const status = await getStatus(assetId).catch(() => null);
    if (!status || status.attached === true ||
      !['superseded', 'deleted'].includes(status.state)) {
      throw retirementError;
    }
    return {assetId, handled: true, retirement: status, status: 'retired'};
  }
};

/**
 * A Task07-backed create persists the canonical manifest after preparation,
 * so its prepared catalog document must not introduce an empty legacy alias.
 */
export const withTask07CatalogLegacyImageField = (item, {
  editMode = false,
  imageUrl = null,
  task07V1Write = false,
} = {}) => {
  const nextItem = {
    ...item,
    General: { ...(item?.General || {}) },
  };
  if (task07V1Write && !editMode && imageUrl == null) {
    delete nextItem.General.image_url;
  } else {
    nextItem.General.image_url = imageUrl;
  }
  return nextItem;
};

export const isTask07CatalogItemWriterEnabled = async ({
  actorUid,
  role,
  file,
  inventoryEditMode = false,
}) => Boolean(
  file
  && actorUid
  && !inventoryEditMode
  && await isTask07MediaV1WriteEnabled({
    purpose: 'item',
    role,
    uid: actorUid,
  })
);

export const runTask07CatalogItemWriter = ({
  actorUid,
  role,
  itemId,
  file,
  currentItem,
  prepareEntity,
  rollbackPreparedEntity,
  signal,
}) => runTask07ControlledWriterUpload({
  actorUid,
  role,
  ownerUid: actorUid,
  entityId: itemId,
  kind: 'item',
  referenceScope: 'global-catalog',
  file,
  target: currentItem || {},
  enabled: true,
  prepareEntity,
  rollbackPreparedEntity,
  signal,
});

export const task07CatalogEmbeddedSpellEditorState = (item = {}) => {
  const linkedSpells = [];
  const customSpells = [];
  Object.entries(item?.General?.spells || {}).forEach(([name, value]) => {
    if (value === true) {
      linkedSpells.push(name);
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      customSpells.push({
        spellData: withTask07EmbeddedMedia(
          item,
          value,
          'catalog-item-spell'
        ),
        imageFile: null,
        videoFile: null,
        imageRemoved: false,
        videoRemoved: false,
      });
    }
  });
  return {customSpells, linkedSpells};
};

export const prepareTask07CatalogEmbeddedSpells = async ({
  actorUid,
  role,
  itemId,
  currentItem = {},
  customSpells = [],
}) => {
  const hasFiles = customSpells.some((entry) =>
    entry?.imageFile || entry?.videoFile
  );
  const enabled = hasFiles && await isTask07MediaV1WriteEnabled({
    purpose: 'spell',
    role,
    uid: actorUid,
  });
  if (hasFiles && !enabled) {
    throw new Error(
      'Embedded spell media requires the canonical Task 07 writer.'
    );
  }
  const operations = [];
  const spells = {};
  customSpells.forEach((customSpell) => {
    const spell = withoutTask07EmbeddedMediaProjection(
      customSpell?.spellData || {}
    );
    const entryKey = String(spell.Nome || '').trim();
    const target = buildTask07NestedMediaTarget({
      parent: currentItem,
      entry: spell,
      entityId: itemId,
      targetKind: 'catalog-item-spell',
      entryKey,
    });
    const entry = {
      ...spell,
      ...(enabled || spell.task07MediaEntryId
        || task07EmbeddedMediaBinding(
          currentItem,
          {...spell, task07MediaEntryId: target.entryId},
          'catalog-item-spell'
        )
        ? {task07MediaEntryId: target.entryId}
        : {}),
    };
    const binding = task07EmbeddedMediaBinding(
      currentItem,
      entry,
      'catalog-item-spell'
    );
    if (customSpell?.imageFile) {
      operations.push({
        action: 'upload',
        entry,
        entryKey,
        file: customSpell.imageFile,
        kind: 'spell',
        slot: 'media',
      });
    } else if (binding?.media?.assetId && customSpell?.imageRemoved === true) {
      operations.push({action: 'retire', assetId: binding.media.assetId});
    }
    if (customSpell?.videoFile) {
      operations.push({
        action: 'upload',
        entry,
        entryKey,
        file: customSpell.videoFile,
        kind: 'spell-video',
        slot: 'videoMedia',
      });
    } else if (binding?.videoMedia?.assetId &&
      customSpell?.videoRemoved === true) {
      operations.push({action: 'retire', assetId: binding.videoMedia.assetId});
    }
    spells[entryKey] = entry;
  });
  const retainedEntryIds = new Set(Object.values(spells)
    .map((entry) => entry?.task07MediaEntryId)
    .filter(Boolean));
  Object.values(currentItem?.General?.spells || {}).forEach((entry) => {
    if (!entry || typeof entry !== 'object'
      || retainedEntryIds.has(entry.task07MediaEntryId)) return;
    const binding = task07EmbeddedMediaBinding(
      currentItem,
      entry,
      'catalog-item-spell'
    );
    if (binding?.media?.assetId) {
      operations.push({action: 'retire', assetId: binding.media.assetId});
    }
    if (binding?.videoMedia?.assetId) {
      operations.push({action: 'retire', assetId: binding.videoMedia.assetId});
    }
  });
  return {enabled, operations, spells};
};

export const runTask07CatalogEmbeddedMediaOperations = async ({
  actorUid,
  role,
  itemId,
  currentItem = {},
  completedOperationKeys = new Set(),
  operations = [],
  signal,
}) => {
  return runTask07EmbeddedOperationSequence({
    completedKeys: completedOperationKeys,
    operations,
    parentId: itemId,
    execute: async (operation) => {
    if (operation.action === 'retire') {
      try {
        await retireTask07MediaAsset(operation.assetId);
      } catch (retirementError) {
        const status = await getTask07MediaStatus(operation.assetId)
          .catch(() => null);
        if (!status || status.attached === true
          || !['superseded', 'deleted'].includes(status.state)) {
          throw retirementError;
        }
      }
      return;
    }
    return runTask07NestedMediaWriter({
      actorUid,
      role,
      ownerUid: actorUid,
      entityId: itemId,
      parent: currentItem,
      entry: operation.entry,
      targetKind: 'catalog-item-spell',
      entryKey: operation.entryKey,
      slot: operation.slot,
      kind: operation.kind,
      file: operation.file,
      signal,
    });
    },
  });
};
