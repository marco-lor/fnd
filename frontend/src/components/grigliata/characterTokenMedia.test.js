import {
  normalizeTask07CharacterMediaResponse,
  normalizeTask07PlacedTokenMediaResponse,
  resolveTask07CharacterCanonicalMedia,
  resolveTask07PlacedCanonicalMedia,
} from './characterTokenMedia';

const avatarMedia = (ownerUid = 'peer-1') => {
  const assetId = `m_${'a'.repeat(40)}`;
  const prefix = `media_assets/v1/signed-in/${ownerUid}/${assetId}/7`;
  const descriptor = (name, contentType = 'image/webp') => ({
    path: `${prefix}/${name}`,
    generation: '7',
    bytes: 100,
    contentType,
    width: 96,
    height: 96,
    downloadUrl: `https://legacy.example/${name}`,
  });
  return {
    schemaVersion: 1,
    contractVersion: 1,
    assetId,
    kind: 'avatar',
    state: 'ready',
    generation: '7',
    audience: 'signed-in',
    ownerUid,
    original: descriptor('original', 'image/png'),
    variants: {
      thumbnail: descriptor('thumbnail'),
      thumbnail2x: descriptor('thumbnail2x'),
      card: descriptor('card'),
    },
    imageUrl: 'https://legacy.example/root.png',
  };
};

const tokenMedia = (ownerUid = 'peer-2') => ({
  ...avatarMedia(ownerUid),
  assetId: `m_${'b'.repeat(40)}`,
  kind: 'token',
  original: {
    ...avatarMedia(ownerUid).original,
    path: `media_assets/v1/signed-in/${ownerUid}/m_${'b'.repeat(40)}/7/original`,
  },
  variants: Object.fromEntries(Object.entries(avatarMedia(ownerUid).variants)
    .map(([variant, descriptor]) => [variant, {
      ...descriptor,
      path: `media_assets/v1/signed-in/${ownerUid}/m_${'b'.repeat(40)}/7/${variant}`,
    }])),
});

describe('Task 07 character-token canonical media resolver', () => {
  test('deduplicates bounded token IDs and unwraps the callable response', async () => {
    const invoke = jest.fn().mockResolvedValue({
      data: {
        schemaVersion: 1,
        entries: [{
          tokenId: 'token-1',
          media: avatarMedia(),
        }],
      },
    });

    await expect(resolveTask07CharacterCanonicalMedia([
      ' token-1 ',
      'token-1',
      'bad/id',
    ], { invoke })).resolves.toMatchObject({
      'token-1': {
        kind: 'avatar',
        ownerUid: 'peer-1',
      },
    });
    expect(invoke).toHaveBeenCalledWith({ tokenIds: ['token-1'] });
  });

  test('strips every embedded legacy URL from a valid avatar descriptor', () => {
    const normalized = normalizeTask07CharacterMediaResponse({
      schemaVersion: 1,
      entries: [{
        tokenId: 'token-1',
        media: avatarMedia(),
      }],
    });

    expect(JSON.stringify(normalized)).not.toContain('https://');
    expect(normalized['token-1'].variants.thumbnail.path)
      .toContain('/thumbnail');
  });

  test('fails closed on wrong owner, path, state, or response schema', () => {
    const base = avatarMedia();
    const entries = [
      {
        tokenId: 'wrong-owner',
        media: { ...base, ownerUid: '' },
      },
      {
        tokenId: 'wrong-path',
        media: {
          ...base,
          variants: {
            ...base.variants,
            thumbnail: {
              ...base.variants.thumbnail,
              path: 'media_assets/v1/signed-in/other/path',
            },
          },
        },
      },
      {
        tokenId: 'processing',
        media: { ...base, state: 'processing' },
      },
    ];

    expect(normalizeTask07CharacterMediaResponse({
      schemaVersion: 1,
      entries,
    })).toEqual({});
    expect(normalizeTask07CharacterMediaResponse({
      schemaVersion: 2,
      entries: [{ tokenId: 'token-1', media: base }],
    })).toEqual({});
  });

  test('resolves sanitized avatar and custom-token media for visible placements', async () => {
    const invoke = jest.fn().mockResolvedValue({
      data: {
        schemaVersion: 1,
        entries: [
          {tokenId: 'character-1', media: avatarMedia('character-1')},
          {tokenId: 'custom-1', media: tokenMedia('custom-owner')},
        ],
      },
    });

    await expect(resolveTask07PlacedCanonicalMedia({
      backgroundId: 'map-1',
      tokenIds: ['character-1', 'custom-1'],
    }, {invoke})).resolves.toEqual(expect.objectContaining({
      'character-1': expect.objectContaining({kind: 'avatar'}),
      'custom-1': expect.objectContaining({kind: 'token'}),
    }));
    expect(invoke).toHaveBeenCalledWith({
      backgroundId: 'map-1',
      tokenIds: ['character-1', 'custom-1'],
    });
    expect(JSON.stringify(normalizeTask07PlacedTokenMediaResponse(
      await invoke.mock.results[0].value
    ))).not.toContain('https://');
  });

  test('resolves every placement through bounded 60-ID chunks without silent loss', async () => {
    const tokenIds = Array.from({ length: 125 }, (_, index) => `character-${index}`);
    let activeInvocations = 0;
    let maxActiveInvocations = 0;
    const invoke = jest.fn(async ({ tokenIds: chunk }) => {
      activeInvocations += 1;
      maxActiveInvocations = Math.max(maxActiveInvocations, activeInvocations);
      await Promise.resolve();
      activeInvocations -= 1;
      return {
        data: {
          schemaVersion: 1,
          entries: [
            ...chunk.map((tokenId) => ({ tokenId, media: avatarMedia(tokenId) })),
            { tokenId: 'unexpected-token', media: avatarMedia('unexpected-token') },
          ],
        },
      };
    });

    const result = await resolveTask07PlacedCanonicalMedia({
      backgroundId: 'map-1',
      tokenIds,
    }, { invoke });

    expect(invoke).toHaveBeenCalledTimes(3);
    expect(invoke.mock.calls.map(([payload]) => payload.tokenIds.length)).toEqual([60, 60, 5]);
    expect(invoke.mock.calls.every(([payload]) => payload.backgroundId === 'map-1')).toBe(true);
    expect(maxActiveInvocations).toBeLessThanOrEqual(2);
    expect(Object.keys(result)).toHaveLength(125);
    expect(result['character-124']).toEqual(expect.objectContaining({ ownerUid: 'character-124' }));
    expect(result['unexpected-token']).toBeUndefined();
  });

  test('rejects an entire multi-chunk result when any bounded callable fails', async () => {
    const invoke = jest.fn(async ({ tokenIds }) => {
      if (tokenIds.includes('character-60')) throw new Error('chunk failed');
      return {
        data: {
          schemaVersion: 1,
          entries: tokenIds.map((tokenId) => ({ tokenId, media: avatarMedia(tokenId) })),
        },
      };
    });

    await expect(resolveTask07CharacterCanonicalMedia(
      Array.from({ length: 61 }, (_, index) => `character-${index}`),
      { invoke }
    )).rejects.toThrow('chunk failed');
  });
});
