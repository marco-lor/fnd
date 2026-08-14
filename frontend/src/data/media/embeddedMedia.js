import { runTask07ControlledWriterUpload } from './mediaWriterAdapter';
import { buildTask07NestedMediaTarget } from './embeddedMediaProjection';

export {
  buildTask07NestedMediaTarget,
  mintTask07EmbeddedMediaEntryId,
  task07EmbeddedMediaBinding,
  task07EmbeddedMediaEntryId,
  withoutTask07EmbeddedMediaProjection,
  withTask07EmbeddedMedia,
} from './embeddedMediaProjection';

export const runTask07NestedMediaWriter = ({
  actorUid,
  role,
  ownerUid,
  entityId,
  parent,
  entry,
  targetKind,
  entryKey = null,
  entryIndex = null,
  slot = 'media',
  kind,
  file,
  signal,
  onProgress,
}) => {
  const target = buildTask07NestedMediaTarget({
    parent,
    entry,
    entityId,
    targetKind,
    entryKey,
    entryIndex,
    slot,
  });
  return runTask07ControlledWriterUpload({
    actorUid,
    role,
    ownerUid,
    entityId,
    kind,
    nestedTarget: target.nestedTarget,
    referenceScope: targetKind === 'catalog-item-spell'
      ? 'global-catalog'
      : null,
    file,
    target: target.binding,
    enabled: true,
    signal,
    onProgress,
  });
};
