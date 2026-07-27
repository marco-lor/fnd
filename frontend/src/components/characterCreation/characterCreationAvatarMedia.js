const ATTENTION_STATUSES = new Set([
  'attached-result-unknown',
  'attach-acknowledgement-unknown',
]);

export const task07ProfileRevision = (profile) => (
  Number.isSafeInteger(profile?.task07MediaRevision)
  && profile.task07MediaRevision >= 0
    ? profile.task07MediaRevision
    : 0
);

export const runCharacterCreationAvatarV1Write = async ({
  actorUid,
  expectedRevision,
  file,
  finalizeCharacter,
  ownerUid = actorUid,
  prepareEntity,
  previousAssetId = null,
  rollbackPreparedEntity,
  runConsumerUpload,
  runWithReceipt,
  signal,
}) => {
  if (
    typeof runConsumerUpload !== 'function'
    || typeof runWithReceipt !== 'function'
    || typeof finalizeCharacter !== 'function'
  ) {
    throw new TypeError('Character Creation avatar orchestration is incomplete.');
  }

  return runWithReceipt({
    actorUid,
    ownerUid,
    entityId: ownerUid,
    kind: 'avatar',
    file,
    expectedRevision,
    previousAssetId,
    signal,
    invoke: async ({ operationId, signal: operationSignal }) => {
      const outcome = await runConsumerUpload({
        file,
        ownerUid,
        entityId: ownerUid,
        operationId,
        kind: 'avatar',
        previousAssetId,
        expectedRevision,
        prepareEntity,
        rollbackPreparedEntity,
        signal: operationSignal,
      });
      if (ATTENTION_STATUSES.has(outcome?.status)) return outcome;

      try {
        await finalizeCharacter();
      } catch (error) {
        // Attachment is already confirmed. Returning the adapter's committed
        // attention status keeps the durable receipt and prevents a second
        // upload while Character Creation retries only its final profile write.
        return {
          ...outcome,
          handled: true,
          status: 'attached-result-unknown',
          characterFinalizationFailed: true,
          error: error?.message || 'Character completion could not be saved.',
        };
      }
      return outcome;
    },
  });
};
