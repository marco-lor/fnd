const MAX_TASK07_MEDIA_REVISION = 0x7fffffff;
const TASK07_TOKEN_ASSET_ID_PATTERN = /^m_[a-f0-9]{40}$/;
const TASK07_TOKEN_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const normalizeString = (value) => (
  typeof value === 'string' ? value.trim() : ''
);

const readEntityMedia = (entity) => {
  if (entity?.media && typeof entity.media === 'object' && !Array.isArray(entity.media)) {
    return entity.media;
  }
  if (
    entity?.General?.media
    && typeof entity.General.media === 'object'
    && !Array.isArray(entity.General.media)
  ) {
    return entity.General.media;
  }
  return null;
};

const hasSafeTask07TokenMediaShape = (token, ownerUid) => {
  const media = readEntityMedia(token);
  if (!media) return true;

  return (
    media.schemaVersion === 1
    && media.contractVersion === 1
    && TASK07_TOKEN_ASSET_ID_PATTERN.test(normalizeString(media.assetId))
    && media.kind === 'token'
    && media.state === 'ready'
    && normalizeString(media.ownerUid) === ownerUid
    && typeof media?.original?.path === 'string'
    && Boolean(media.original.path.trim())
  );
};

export const isTask07CustomTokenImageSupported = (file) => (
  TASK07_TOKEN_CONTENT_TYPES.has(normalizeString(file?.type).toLowerCase())
);

export const resolveTask07CustomTokenTarget = ({
  token,
  tokenId,
  actorUid,
}) => {
  const normalizedTokenId = normalizeString(tokenId);
  const normalizedActorUid = normalizeString(actorUid);
  const ownerUid = normalizeString(token?.ownerUid);
  const templateId = normalizeString(token?.customTemplateId) || normalizedTokenId;
  const rawRevision = token?.task07MediaRevision;
  const expectedRevision = rawRevision == null ? 0 : rawRevision;

  if (
    !normalizedTokenId
    || !normalizedActorUid
    || !token
    || token.tokenType !== 'custom'
    || token.customTokenRole === 'instance'
    || templateId !== normalizedTokenId
    || !ownerUid
    || ownerUid !== normalizedActorUid
    || !hasSafeTask07TokenMediaShape(token, ownerUid)
    || !Number.isSafeInteger(expectedRevision)
    || expectedRevision < 0
    || expectedRevision > MAX_TASK07_MEDIA_REVISION
  ) {
    return null;
  }

  return {
    entityId: normalizedTokenId,
    ownerUid,
    expectedRevision,
  };
};

// This key is kept only in component memory. It lets an acknowledgement-unknown
// create retry reuse the exact random Firestore target while the form remains
// mounted, without persisting labels, notes, file names, or entity IDs.
export const buildTask07CustomTokenCreateIntentKey = ({
  label,
  file,
  notes,
  hpTotal,
  manaTotal,
  shieldTotal,
}) => JSON.stringify({
  label: normalizeString(label),
  file: {
    name: typeof file?.name === 'string' ? file.name : '',
    type: normalizeString(file?.type).toLowerCase(),
    size: Number.isSafeInteger(file?.size) ? file.size : -1,
    lastModified: Number.isSafeInteger(file?.lastModified) ? file.lastModified : 0,
  },
  notes: typeof notes === 'string' ? notes : '',
  hpTotal,
  manaTotal,
  shieldTotal,
});

export const buildTask07CustomTokenTemplatePayload = ({
  tokenId,
  ownerUid,
  label,
  imageUrl = '',
  imagePath = '',
  notes,
  hpTotal,
  manaTotal,
  shieldTotal,
  createdAt,
  updatedAt,
}) => ({
  ownerUid,
  characterId: '',
  label,
  imageUrl,
  imagePath,
  tokenType: 'custom',
  customTokenRole: 'template',
  customTemplateId: tokenId,
  imageSource: 'uploaded',
  notes,
  stats: {
    hpTotal,
    hpCurrent: hpTotal,
    manaTotal,
    manaCurrent: manaTotal,
    shieldTotal,
    shieldCurrent: shieldTotal,
  },
  createdAt,
  createdBy: ownerUid,
  updatedAt,
  updatedBy: ownerUid,
});

export const resolveTask07CustomTokenMediaProjection = ({
  profile,
  profilesByTokenId,
}) => {
  const profileId = normalizeString(profile?.id);
  const templateId = normalizeString(profile?.customTemplateId);
  let template = null;

  if (
    profile?.tokenType === 'custom'
    && templateId
    && templateId !== profileId
    && profilesByTokenId?.get
  ) {
    const candidate = profilesByTokenId.get(templateId) || null;
    if (
      candidate?.tokenType === 'custom'
      && candidate?.customTokenRole !== 'instance'
      && normalizeString(candidate.ownerUid) === normalizeString(profile.ownerUid)
    ) {
      template = candidate;
    }
  }

  return {
    imageUrl: normalizeString(profile?.imageUrl) || normalizeString(template?.imageUrl),
    imagePath: normalizeString(profile?.imagePath) || normalizeString(template?.imagePath),
    media: readEntityMedia(profile) || readEntityMedia(template),
  };
};

export const runTask07CustomTokenProjectionBridge = async ({
  state,
  uploadLegacyProjection,
  attachCanonical,
  publishLegacyProjection,
  outcomeNeedsAttention,
}) => {
  if (
    !state
    || typeof state !== 'object'
    || typeof uploadLegacyProjection !== 'function'
    || typeof attachCanonical !== 'function'
    || typeof outcomeNeedsAttention !== 'function'
    || (
      publishLegacyProjection != null
      && typeof publishLegacyProjection !== 'function'
    )
  ) {
    throw new TypeError('Task 07 custom-token projection bridge is invalid.');
  }

  if (!state.legacyImage) {
    state.legacyImage = await uploadLegacyProjection();
  }

  let outcome = null;
  if (state.mediaAttached !== true) {
    outcome = await attachCanonical(state.legacyImage);
    if (outcomeNeedsAttention(outcome)) {
      return { complete: false, outcome, state };
    }
    state.mediaAttached = true;
    state.canonicalAssetId = normalizeString(outcome?.assetId);
  }

  if (publishLegacyProjection) {
    await publishLegacyProjection(state.legacyImage);
  }

  return { complete: true, outcome, state };
};

export const runTask07CustomTokenMediaWrite = async ({
  adapter,
  operationOwner,
  actorUid,
  ownerUid,
  tokenId,
  file,
  expectedRevision,
  previousAssetId,
  prepareEntity,
  rollbackPreparedEntity,
}) => {
  if (
    typeof adapter?.runWithTask07MediaOperationReceipt !== 'function'
    || typeof adapter?.runTask07ConsumerUpload !== 'function'
    || typeof operationOwner?.start !== 'function'
  ) {
    throw new TypeError('Task 07 custom-token media dependencies are unavailable.');
  }

  const operationLease = operationOwner.start(
    'Custom-token media upload was replaced.'
  );
  try {
    return await adapter.runWithTask07MediaOperationReceipt({
      actorUid,
      ownerUid,
      entityId: tokenId,
      kind: 'token',
      file,
      expectedRevision,
      previousAssetId,
      signal: operationLease.signal,
      invoke: ({
        operationId,
        expectedRevision: receiptExpectedRevision,
        previousAssetId: receiptPreviousAssetId,
        signal,
      }) => adapter.runTask07ConsumerUpload({
        file,
        ownerUid,
        entityId: tokenId,
        operationId,
        kind: 'token',
        previousAssetId: receiptPreviousAssetId,
        expectedRevision: receiptExpectedRevision,
        prepareEntity,
        ...(rollbackPreparedEntity ? { rollbackPreparedEntity } : {}),
        signal,
      }),
    });
  } finally {
    operationLease.release();
  }
};
