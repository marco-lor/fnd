import {
  buildCanonicalFoeImageRemovalPayload,
  collectClientDeletableFoeStoragePaths,
  shouldClientDeleteFoeMainStorageObject,
} from './foeMediaLifecycle';

const canonicalFoe = {
  imagePath: 'media/v1/foe/dm/m_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/original/source.png',
  media: {
    assetId: 'm_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  },
  tecniche: [{
    imagePath: 'foes/tecniche/claw.png',
  }],
  spells: [{
    imageUrl: 'https://firebasestorage.googleapis.com/v0/b/demo/o/foes%2Fspells%2Fhex.png?alt=media',
  }],
};

describe('foe media lifecycle ownership', () => {
  test('omits the canonical main path while preserving nested legacy cleanup', () => {
    expect(collectClientDeletableFoeStoragePaths(canonicalFoe)).toEqual([
      'foes/tecniche/claw.png',
      'foes/spells/hex.png',
    ]);
    expect(shouldClientDeleteFoeMainStorageObject(canonicalFoe)).toBe(false);
  });

  test('keeps the legacy main path client-deletable', () => {
    const legacyFoe = {
      imagePath: 'foes/main/legacy.png',
      tecniche: canonicalFoe.tecniche,
      spells: canonicalFoe.spells,
    };

    expect(collectClientDeletableFoeStoragePaths(legacyFoe)).toEqual([
      'foes/main/legacy.png',
      'foes/tecniche/claw.png',
      'foes/spells/hex.png',
    ]);
    expect(shouldClientDeleteFoeMainStorageObject(legacyFoe)).toBe(true);
  });

  test('uses a Firestore delete sentinel when a canonical main image is removed', () => {
    const deleteFieldSentinel = { __type: 'deleteField' };
    expect(buildCanonicalFoeImageRemovalPayload(
      {
        imageUrl: '',
        imagePath: '',
        media: canonicalFoe.media,
        name: 'Canonical foe',
      },
      canonicalFoe,
      deleteFieldSentinel
    )).toEqual({
      imageUrl: '',
      imagePath: '',
      media: deleteFieldSentinel,
      name: 'Canonical foe',
    });
  });
});
