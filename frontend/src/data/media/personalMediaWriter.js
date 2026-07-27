import { auth } from '../../components/firebaseConfig';
import { mutatePersonalContent } from '../userData/userDataCommands';
import {
  readUserDataRole,
  readUserOwnedDataDocument,
} from '../userData/userDataRepository';
import {
  buildTask07DetachRetryKey,
  buildTask07PrepareRetryKey,
  getTask07PreviousAssetIdForKind,
  runTask07ControlledWriterUpload,
} from './mediaWriterAdapter';
import { isTask07MediaV1WriteEnabled } from './mediaFeatureFlags';
import {
  task07ConsumerNeedsAttention,
} from './mediaConsumerAdapter';
import { throwIfTask07Aborted } from './mediaErrors';
import { retireTask07MediaAsset } from './mediaPipeline';

const PERSONAL_MEDIA_CONFIG = Object.freeze({
  spells: {
    commandKind: 'spell',
    imageKind: 'spell',
    videoKind: 'spell-video',
  },
  tecniche: {
    commandKind: 'tecnica',
    imageKind: 'technique',
    videoKind: 'technique-video',
  },
});

const TASK07_PERSONAL_TRANSPORT_FIELDS = new Set([
  'media',
  'mediaUpdatedAt',
  'task07MediaRevision',
  'task07VideoMediaRevision',
  'videoMedia',
  'videoMediaUpdatedAt',
]);

const stripTask07PersonalTransport = (value) => Object.fromEntries(
  Object.entries(value && typeof value === 'object' ? value : {})
    .filter(([key]) => !TASK07_PERSONAL_TRANSPORT_FIELDS.has(key))
);

const canonicalContentId = (value) => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(normalized)
    ? normalized
    : null;
};

const loadExistingTarget = async (userId, collectionKey, contentId) => {
  if (!contentId) return null;
  return readUserOwnedDataDocument(userId, collectionKey, contentId);
};

const rollbackPreparedTarget = async ({
  before,
  commandKind,
  contentId,
  userId,
  retryKey,
}) => {
  if (!before) {
    return mutatePersonalContent({
      userId,
      kind: commandKind,
      action: 'delete',
      contentId,
      retryKey: `${retryKey}:rollback-delete`,
    });
  }
  const data = stripTask07PersonalTransport(before.data);
  const name = String(
    before.data.displayName || before.data.Nome || before.data.name || ''
  ).trim();
  return mutatePersonalContent({
    userId,
    kind: commandKind,
    action: 'upsert',
    contentId,
    name,
    data,
    retryKey: `${retryKey}:rollback-upsert`,
  });
};

const requestedPersonalKinds = ({
  config,
  imageFile,
  videoFile,
  removeImage,
  removeVideo,
}) => [
  ...((imageFile || removeImage) ? [config.imageKind] : []),
  ...((videoFile || removeVideo) ? [config.videoKind] : []),
];

const canonicalDetachRequests = ({
  beforeData,
  config,
  imageFile,
  videoFile,
  removeImage,
  removeVideo,
}) => [
  ...((removeImage && !imageFile)
    ? [{
      assetId: getTask07PreviousAssetIdForKind(
        beforeData,
        config.imageKind
      ),
      kind: config.imageKind,
    }]
    : []),
  ...((removeVideo && !videoFile)
    ? [{
      assetId: getTask07PreviousAssetIdForKind(
        beforeData,
        config.videoKind
      ),
      kind: config.videoKind,
    }]
    : []),
].filter(({ assetId }) => Boolean(assetId));

const recordTargetRollback = (error, result) => {
  if (error && typeof error === 'object') error.targetRollback = result;
};

/**
 * Returns null without writing when this actor/change set is not fully enabled
 * for Task 07. Otherwise it prepares the stable Task 05 V2 target and attaches
 * or retires each selected canonical slot through the shared Task 07 boundary.
 */
export const tryPersistTask07PersonalMedia = async ({
  userId,
  collectionKey,
  originalEntity,
  entryData,
  imageFile,
  videoFile,
  removeImage = false,
  removeVideo = false,
  signal,
}) => {
  const config = PERSONAL_MEDIA_CONFIG[collectionKey];
  const actorUid = auth.currentUser?.uid || '';
  if (!config || !actorUid || !signal) return null;

  const requestedKinds = requestedPersonalKinds({
    config,
    imageFile,
    videoFile,
    removeImage,
    removeVideo,
  });
  if (!requestedKinds.length) return null;

  const role = await readUserDataRole(actorUid);
  if (!role) return null;
  for (const purpose of requestedKinds) {
    if (!await isTask07MediaV1WriteEnabled({
      purpose,
      role,
      uid: actorUid,
    })) {
      return null;
    }
  }

  const requestedContentId = canonicalContentId(
    originalEntity?._task05ContentId || originalEntity?.id
  );
  const originalDetachRequests = canonicalDetachRequests({
    beforeData: originalEntity || {},
    config,
    imageFile,
    videoFile,
    removeImage,
    removeVideo,
  });
  if (!requestedContentId && originalDetachRequests.length) {
    const error = new Error(
      'Canonical personal media requires a stable Task 05 content target.'
    );
    error.code = 'task07-stable-target-required';
    throw error;
  }

  const firstFile = imageFile || videoFile;
  const firstKind = imageFile ? config.imageKind : config.videoKind;
  if (!firstFile && !requestedContentId) return null;
  const uploadRetryKey = firstFile
    ? buildTask07PrepareRetryKey({
      kind: firstKind,
      ownerUid: userId,
      entityHint: requestedContentId || entryData?.Nome || entryData?.name,
      file: firstFile,
    })
    : null;
  const contentId = requestedContentId
    || canonicalContentId(
      `content_${config.commandKind}_${uploadRetryKey.slice(-16)}`
    );
  const before = await loadExistingTarget(userId, collectionKey, contentId);
  const beforeData = before?.data || {};
  const detachRequests = canonicalDetachRequests({
    beforeData,
    config,
    imageFile,
    videoFile,
    removeImage,
    removeVideo,
  });
  const operations = [
    ...(imageFile ? [{
      file: imageFile,
      kind: config.imageKind,
    }] : []),
    ...(videoFile ? [{
      file: videoFile,
      kind: config.videoKind,
    }] : []),
  ];
  if (!operations.length && !detachRequests.length) return null;

  const retryKey = uploadRetryKey || buildTask07DetachRetryKey({
    kind: detachRequests[0].kind,
    ownerUid: userId,
    entityId: contentId,
    assetId: detachRequests[0].assetId,
  });
  const prepareTarget = async () => {
    const prepared = await mutatePersonalContent({
      userId,
      kind: config.commandKind,
      action: 'upsert',
      contentId,
      name: entryData.Nome || entryData.name,
      data: stripTask07PersonalTransport(entryData),
      retryKey: `${retryKey}:prepare`,
    });
    const resolvedContentId = canonicalContentId(prepared?.contentId);
    if (!resolvedContentId || resolvedContentId !== contentId) {
      throw new Error(
        'Task 05 returned an unexpected personal-content identity.'
      );
    }
  };
  const rollback = () => rollbackPreparedTarget({
    before,
    commandKind: config.commandKind,
    contentId,
    userId,
    retryKey,
  });

  const outcomes = [];
  for (let index = 0; index < operations.length; index += 1) {
    const operation = operations[index];
    const outcome = await runTask07ControlledWriterUpload({
      actorUid,
      role,
      ownerUid: userId,
      entityId: contentId,
      kind: operation.kind,
      file: operation.file,
      target: beforeData,
      enabled: true,
      signal,
      ...(index === 0 ? {
        prepareEntity: prepareTarget,
        rollbackPreparedEntity: rollback,
      } : {}),
    });
    outcomes.push(outcome);
    if (task07ConsumerNeedsAttention(outcome)) {
      return {
        contentId,
        data: entryData,
        name: String(entryData.Nome || entryData.name || '').trim(),
        outcomes,
        task07: true,
      };
    }
  }

  let directlyPrepared = false;
  let detachCommitted = false;
  try {
    if (!operations.length) {
      await prepareTarget();
      directlyPrepared = true;
    }
    for (const detach of detachRequests) {
      throwIfTask07Aborted(signal);
      const retirement = await retireTask07MediaAsset(detach.assetId);
      detachCommitted = true;
      outcomes.push({
        assetId: detach.assetId,
        handled: true,
        kind: detach.kind,
        retirement,
        status: 'retired',
      });
      throwIfTask07Aborted(signal);
    }
  } catch (error) {
    if (directlyPrepared && !detachCommitted) {
      try {
        await rollback();
        recordTargetRollback(error, { ok: true });
      } catch (rollbackError) {
        recordTargetRollback(error, {
          ok: false,
          error: rollbackError,
        });
      }
    }
    throw error;
  }

  return {
    contentId,
    data: entryData,
    name: String(entryData.Nome || entryData.name || '').trim(),
    outcomes,
    task07: true,
  };
};
