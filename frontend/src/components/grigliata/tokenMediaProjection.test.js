import {
  resolveTask07BoardTokenCanonicalMedia,
} from './tokenMediaProjection';

const canonicalMedia = (seed, kind, ownerUid = 'owner-1') => ({
  schemaVersion: 1,
  contractVersion: 1,
  assetId: `m_${seed.repeat(40)}`,
  kind,
  state: 'ready',
  ownerUid,
  original: {
    path: `media_assets/v1/signed-in/${ownerUid}/m_${seed.repeat(40)}/1/original`,
  },
});

describe('Task 07 Grigliata board token media projection', () => {
  test('uses related user avatar media for a peer and never treats its legacy URL as canonical', () => {
    const avatar = canonicalMedia('a', 'avatar', 'peer-1');
    const profile = {
      ownerUid: 'peer-1',
      imageUrl: 'https://legacy.example/peer.png',
    };

    expect(resolveTask07BoardTokenCanonicalMedia({
      tokenType: 'character',
      profile,
      characterMedia: avatar,
    })).toBe(avatar);
    expect(resolveTask07BoardTokenCanonicalMedia({
      tokenType: 'character',
      profile,
      characterMedia: null,
    })).toBeNull();
  });

  test('prefers a foe token canonical copy ahead of its linked foe source', () => {
    const tokenMedia = canonicalMedia('b', 'token', 'dm-1');
    const sourceMedia = canonicalMedia('c', 'foe', 'dm-1');

    expect(resolveTask07BoardTokenCanonicalMedia({
      tokenType: 'foe',
      profile: { media: tokenMedia, foeSourceId: 'foe-1' },
      foeSource: { media: sourceMedia },
    })).toBe(tokenMedia);
  });

  test('uses only a proven ready foe-source canonical descriptor as fallback', () => {
    const sourceMedia = canonicalMedia('d', 'foe', 'dm-1');
    const input = {
      tokenType: 'foe',
      profile: {
        imageUrl: 'https://legacy.example/token.png',
        foeSourceId: 'foe-1',
      },
    };

    expect(resolveTask07BoardTokenCanonicalMedia({
      ...input,
      foeSource: {
        imageUrl: 'https://legacy.example/source.png',
        media: sourceMedia,
      },
    })).toBe(sourceMedia);
    expect(resolveTask07BoardTokenCanonicalMedia({
      ...input,
      foeSource: {
        imageUrl: 'https://legacy.example/source.png',
        media: { ...sourceMedia, state: 'processing' },
      },
    })).toBeNull();
  });

  test('keeps custom instances on their template canonical projection', () => {
    const templateMedia = canonicalMedia('e', 'token', 'player-1');

    expect(resolveTask07BoardTokenCanonicalMedia({
      tokenType: 'custom',
      profile: { customTokenRole: 'instance' },
      customTokenProjection: { media: templateMedia },
    })).toBe(templateMedia);
  });

  test('rejects incomplete canonical-looking objects', () => {
    expect(resolveTask07BoardTokenCanonicalMedia({
      tokenType: 'foe',
      profile: {
        media: {
          assetId: `m_${'f'.repeat(40)}`,
          kind: 'token',
          state: 'ready',
        },
      },
    })).toBeNull();
  });
});
