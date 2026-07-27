import {
  buildTask07CustomTokenCreateIntentKey,
  buildTask07CustomTokenTemplatePayload,
  isTask07CustomTokenImageSupported,
  resolveTask07CustomTokenMediaProjection,
  resolveTask07CustomTokenTarget,
  runTask07CustomTokenProjectionBridge,
  runTask07CustomTokenMediaWrite,
} from './customTokenMedia';

const assetId = `m_${'a'.repeat(40)}`;
const previousAssetId = `m_${'b'.repeat(40)}`;

describe('Task 07 Grigliata custom-token media helper', () => {
  test('accepts only an owned template with an exact bounded revision', () => {
    const token = {
      id: 'token-1',
      ownerUid: 'user-1',
      tokenType: 'custom',
      customTokenRole: 'template',
      customTemplateId: 'token-1',
      task07MediaRevision: 3,
    };

    expect(resolveTask07CustomTokenTarget({
      token,
      tokenId: 'token-1',
      actorUid: 'user-1',
    })).toEqual({
      entityId: 'token-1',
      ownerUid: 'user-1',
      expectedRevision: 3,
    });
    expect(resolveTask07CustomTokenTarget({
      token: { ...token, customTokenRole: 'instance' },
      tokenId: 'token-1',
      actorUid: 'user-1',
    })).toBeNull();
    expect(resolveTask07CustomTokenTarget({
      token: { ...token, task07MediaRevision: Date.now() },
      tokenId: 'token-1',
      actorUid: 'user-1',
    })).toBeNull();
    expect(resolveTask07CustomTokenTarget({
      token,
      tokenId: 'token-1',
      actorUid: 'another-user',
    })).toBeNull();
    expect(resolveTask07CustomTokenTarget({
      token: { ...token, media: { assetId } },
      tokenId: 'token-1',
      actorUid: 'user-1',
    })).toBeNull();
  });

  test('routes only token-policy content types into the v1 writer', () => {
    expect(isTask07CustomTokenImageSupported({ type: 'image/png' })).toBe(true);
    expect(isTask07CustomTokenImageSupported({ type: 'IMAGE/WEBP' })).toBe(true);
    expect(isTask07CustomTokenImageSupported({ type: 'image/gif' })).toBe(false);
    expect(isTask07CustomTokenImageSupported({ type: 'image/svg+xml' })).toBe(false);
  });

  test('keeps create intent stable for identical in-memory form state', () => {
    const input = {
      label: ' Scout ',
      file: {
        name: 'scout.png',
        type: 'image/png',
        size: 123,
        lastModified: 456,
      },
      notes: 'ready',
      hpTotal: 10,
      manaTotal: 2,
      shieldTotal: 1,
    };

    expect(buildTask07CustomTokenCreateIntentKey(input))
      .toBe(buildTask07CustomTokenCreateIntentKey({ ...input }));
    expect(buildTask07CustomTokenCreateIntentKey({ ...input, hpTotal: 11 }))
      .not.toBe(buildTask07CustomTokenCreateIntentKey(input));
  });

  test('builds a canonical-ready template target without a legacy reference', () => {
    const payload = buildTask07CustomTokenTemplatePayload({
      tokenId: 'token-1',
      ownerUid: 'user-1',
      label: 'Scout',
      notes: 'ready',
      hpTotal: 10,
      manaTotal: 2,
      shieldTotal: 1,
      createdAt: 'created-at',
      updatedAt: 'updated-at',
    });

    expect(payload).toMatchObject({
      ownerUid: 'user-1',
      tokenType: 'custom',
      customTokenRole: 'template',
      customTemplateId: 'token-1',
      imageUrl: '',
      imagePath: '',
      stats: {
        hpTotal: 10,
        hpCurrent: 10,
        manaTotal: 2,
        manaCurrent: 2,
        shieldTotal: 1,
        shieldCurrent: 1,
      },
    });
    expect(payload).not.toHaveProperty('media');
    expect(payload).not.toHaveProperty('task07MediaRevision');
  });

  test('can retain a transitional legacy projection for non-owner board readers', () => {
    const payload = buildTask07CustomTokenTemplatePayload({
      tokenId: 'token-1',
      ownerUid: 'user-1',
      label: 'Scout',
      imageUrl: 'https://legacy.example/token.png',
      imagePath: 'grigliata/tokens/user-1/token.png',
      notes: '',
      hpTotal: 1,
      manaTotal: 0,
      shieldTotal: 0,
      createdAt: null,
      updatedAt: null,
    });

    expect(payload).toMatchObject({
      imageUrl: 'https://legacy.example/token.png',
      imagePath: 'grigliata/tokens/user-1/token.png',
    });
  });

  test('projects canonical template media onto a related instance without crossing owners', () => {
    const media = { assetId, state: 'ready' };
    const template = {
      id: 'template-1',
      ownerUid: 'user-1',
      tokenType: 'custom',
      customTokenRole: 'template',
      imageUrl: 'legacy-template-url',
      imagePath: 'legacy-template-path',
      media,
    };
    const instance = {
      id: 'instance-1',
      ownerUid: 'user-1',
      tokenType: 'custom',
      customTokenRole: 'instance',
      customTemplateId: 'template-1',
    };
    const profilesByTokenId = new Map([['template-1', template]]);

    expect(resolveTask07CustomTokenMediaProjection({
      profile: instance,
      profilesByTokenId,
    })).toEqual({
      imageUrl: 'legacy-template-url',
      imagePath: 'legacy-template-path',
      media,
    });
    expect(resolveTask07CustomTokenMediaProjection({
      profile: { ...instance, ownerUid: 'user-2' },
      profilesByTokenId,
    })).toEqual({ imageUrl: '', imagePath: '', media: null });
  });

  test('reuses a legacy projection across ambiguous canonical retries and publishes after attach', async () => {
    const state = {};
    const events = [];
    const uploadLegacyProjection = jest.fn(async () => {
      events.push('legacy-upload');
      return { imageUrl: 'legacy-url', imagePath: 'legacy-path' };
    });
    const attachCanonical = jest.fn()
      .mockImplementationOnce(async () => {
        events.push('canonical-attention');
        return { status: 'attach-acknowledgement-unknown', assetId };
      })
      .mockImplementationOnce(async () => {
        events.push('canonical-complete');
        return { status: 'complete', assetId };
      });
    const publishLegacyProjection = jest.fn(async () => {
      events.push('legacy-publish');
    });
    const outcomeNeedsAttention = (outcome) => (
      outcome?.status === 'attach-acknowledgement-unknown'
    );

    await expect(runTask07CustomTokenProjectionBridge({
      state,
      uploadLegacyProjection,
      attachCanonical,
      publishLegacyProjection,
      outcomeNeedsAttention,
    })).resolves.toMatchObject({ complete: false });
    await expect(runTask07CustomTokenProjectionBridge({
      state,
      uploadLegacyProjection,
      attachCanonical,
      publishLegacyProjection,
      outcomeNeedsAttention,
    })).resolves.toMatchObject({ complete: true });

    expect(uploadLegacyProjection).toHaveBeenCalledTimes(1);
    expect(attachCanonical).toHaveBeenCalledTimes(2);
    expect(publishLegacyProjection).toHaveBeenCalledTimes(1);
    expect(events).toEqual([
      'legacy-upload',
      'canonical-attention',
      'canonical-complete',
      'legacy-publish',
    ]);
    expect(state).toMatchObject({
      mediaAttached: true,
      canonicalAssetId: assetId,
      legacyImage: { imageUrl: 'legacy-url', imagePath: 'legacy-path' },
    });
  });

  test('retries projection publication without uploading or attaching again', async () => {
    const state = {
      legacyImage: { imageUrl: 'legacy-url', imagePath: 'legacy-path' },
      mediaAttached: true,
      canonicalAssetId: assetId,
    };
    const uploadLegacyProjection = jest.fn();
    const attachCanonical = jest.fn();
    const publishLegacyProjection = jest.fn().mockResolvedValue(undefined);

    await runTask07CustomTokenProjectionBridge({
      state,
      uploadLegacyProjection,
      attachCanonical,
      publishLegacyProjection,
      outcomeNeedsAttention: () => false,
    });

    expect(uploadLegacyProjection).not.toHaveBeenCalled();
    expect(attachCanonical).not.toHaveBeenCalled();
    expect(publishLegacyProjection).toHaveBeenCalledWith(state.legacyImage);
  });

  test('forwards retained receipt CAS values and always releases operation ownership', async () => {
    const release = jest.fn();
    const signal = new AbortController().signal;
    const operationOwner = {
      start: jest.fn(() => ({ signal, release })),
    };
    const runTask07ConsumerUpload = jest.fn().mockResolvedValue({ status: 'complete' });
    const runWithTask07MediaOperationReceipt = jest.fn(async (input) => input.invoke({
      operationId: 'task07:token:r4.a0:0123456789012345678901234567890123456789',
      expectedRevision: 4,
      previousAssetId,
      signal,
    }));
    const prepareEntity = jest.fn();

    await expect(runTask07CustomTokenMediaWrite({
      adapter: { runTask07ConsumerUpload, runWithTask07MediaOperationReceipt },
      operationOwner,
      actorUid: 'user-1',
      ownerUid: 'user-1',
      tokenId: 'token-1',
      file: { name: 'token.png', type: 'image/png', size: 12 },
      expectedRevision: 5,
      previousAssetId: assetId,
      prepareEntity,
    })).resolves.toEqual({ status: 'complete' });

    expect(runTask07ConsumerUpload).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'token',
      entityId: 'token-1',
      expectedRevision: 4,
      previousAssetId,
      prepareEntity,
      signal,
    }));
    expect(release).toHaveBeenCalledTimes(1);
  });
});
