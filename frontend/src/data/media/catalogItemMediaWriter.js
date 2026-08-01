import { isTask07MediaV1WriteEnabled } from './mediaFeatureFlags';
import { runTask07ControlledWriterUpload } from './mediaWriterAdapter';

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
