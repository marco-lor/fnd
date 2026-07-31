import { isTask07MediaV1WriteEnabled } from './mediaFeatureFlags';
import { runTask07ControlledWriterUpload } from './mediaWriterAdapter';

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
