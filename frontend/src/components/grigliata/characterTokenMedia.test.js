import {
  normalizeTask07CharacterMediaResponse,
  resolveTask07CharacterCanonicalMedia,
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
});
