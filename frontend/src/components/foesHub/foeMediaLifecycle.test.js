import {
  buildCanonicalFoeClientPayload,
  classifyFoeImageSave,
  collectClientDeletableFoeMainStoragePaths,
  collectClientDeletableFoeStoragePaths,
  deleteFoeDocumentThenCleanupStorage,
  isClientDeletableFoeStoragePath,
  isDefinitiveFoeDuplicationError,
  resolveFoeMediaBinding,
  shouldClientDeleteFoeMainStorageObject,
  shouldUseDurableFoeDuplication,
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
    expect(isClientDeletableFoeStoragePath('foes/../media_assets/a')).toBe(false);
    expect(isClientDeletableFoeStoragePath('foes\\other.png')).toBe(false);
  });

  test('keeps immutable Task 07 operation uploads server-owned after edit', () => {
    const operationPath =
      'foes/task07-operations/dm/receipt/foe/spells-0/digest.png';
    expect(isClientDeletableFoeStoragePath(operationPath)).toBe(false);
    expect(collectClientDeletableFoeStoragePaths({
      spells: [{imagePath: operationPath}],
    })).toEqual([]);
  });

  test('deletes the foe document before best-effort legacy cleanup', async () => {
    const calls = [];
    const result = await deleteFoeDocumentThenCleanupStorage({
      deleteFoeDocument: async () => calls.push('firestore'),
      deleteStoragePath: async (path) => calls.push(path),
      paths: ['foes/main.png', 'foes/spells/hex.png'],
    });

    expect(calls).toEqual([
      'firestore',
      'foes/main.png',
      'foes/spells/hex.png',
    ]);
    expect(result.every(({status}) => status === 'fulfilled')).toBe(true);
  });

  test('does not delete storage when the foe document deletion fails', async () => {
    const failure = new Error('firestore unavailable');
    const deleteStoragePath = jest.fn();

    await expect(deleteFoeDocumentThenCleanupStorage({
      deleteFoeDocument: async () => { throw failure; },
      deleteStoragePath,
      paths: ['foes/main.png'],
    })).rejects.toBe(failure);
    expect(deleteStoragePath).not.toHaveBeenCalled();
  });

  test('omits all Task 07 transport and the General map from canonical edits', () => {
    expect(buildCanonicalFoeClientPayload({
      id: 'foe-id',
      imageUrl: 'https://legacy.example/foe.png',
      imagePath: 'foes/legacy.png',
      media: canonicalFoe.media,
      mediaUpdatedAt: {seconds: 1},
      task07MediaRevision: 4,
      videoMedia: {assetId: 'm_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'},
      task07VideoMediaRevision: 2,
      videoMediaUpdatedAt: {seconds: 2},
      General: {media: canonicalFoe.media, privateValue: 'preserve-on-server'},
      name: 'Canonical foe',
    })).toEqual({
      imageUrl: 'https://legacy.example/foe.png',
      imagePath: 'foes/legacy.png',
      name: 'Canonical foe',
    });
    expect(buildCanonicalFoeClientPayload({
      imageUrl: 'https://legacy.example/foe.png',
      imagePath: 'foes/legacy.png',
      name: 'Canonical foe',
    }, {omitMainImageFields: true})).toEqual({name: 'Canonical foe'});
  });

  test.each([
    ['root', canonicalFoe, 'canonical', canonicalFoe.media.assetId],
    ['General', {General: {media: canonicalFoe.media}}, 'canonical', canonicalFoe.media.assetId],
    ['both-same', {
      media: canonicalFoe.media,
      General: {media: {...canonicalFoe.media}},
    }, 'canonical', canonicalFoe.media.assetId],
    ['none', {name: 'Legacy'}, 'none', null],
    ['malformed', {General: {media: {assetId: 'bad'}}}, 'malformed', null],
    ['conflict', {
      media: canonicalFoe.media,
      General: {media: {assetId: 'm_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'}},
    }, 'conflict', null],
  ])('resolves %s media binding without hiding conflicts', (
    _label,
    foe,
    status,
    assetId
  ) => {
    expect(resolveFoeMediaBinding(foe)).toMatchObject({status, assetId});
  });

  test('fails closed on mirrored descriptor or explicit revision conflicts', () => {
    expect(resolveFoeMediaBinding({
      media: canonicalFoe.media,
      task07MediaRevision: 3,
      General: {
        media: {...canonicalFoe.media, state: 'different'},
        task07MediaRevision: 3,
      },
    })).toMatchObject({status: 'conflict', assetId: null, revision: 3});
    expect(resolveFoeMediaBinding({
      media: canonicalFoe.media,
      task07MediaRevision: 3,
      General: {
        media: {...canonicalFoe.media},
        task07MediaRevision: 4,
      },
    })).toMatchObject({status: 'conflict', assetId: null, revision: 3});
  });

  test('uses the root revision and defaults a General-only binding to revision zero', () => {
    expect(resolveFoeMediaBinding({
      media: canonicalFoe.media,
      task07MediaRevision: 5,
    })).toMatchObject({status: 'canonical', revision: 5});
    expect(resolveFoeMediaBinding({
      General: {
        media: canonicalFoe.media,
        task07MediaRevision: 8,
      },
    })).toMatchObject({status: 'canonical', revision: 0});
  });

  test('classifies canonical removal and blocks unsafe image changes', () => {
    expect(classifyFoeImageSave({
      currentFoe: {General: {media: canonicalFoe.media}},
      removeImage: true,
    })).toMatchObject({
      mode: 'canonical-remove',
      binding: {assetId: canonicalFoe.media.assetId},
    });
    expect(classifyFoeImageSave({
      currentFoe: canonicalFoe,
      hasImageFile: true,
      task07WriteEnabled: false,
    })).toMatchObject({
      mode: 'blocked',
      code: 'canonical-replacement-disabled',
    });
    expect(classifyFoeImageSave({
      currentFoe: {
        media: canonicalFoe.media,
        General: {media: {assetId: 'm_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'}},
      },
      removeImage: true,
    })).toMatchObject({
      mode: 'blocked',
      code: 'canonical-media-conflict',
    });
  });

  test('routes enabled uploads and legacy mutations without behavior drift', () => {
    expect(classifyFoeImageSave({
      currentFoe: canonicalFoe,
      hasImageFile: true,
      task07WriteEnabled: true,
    }).mode).toBe('canonical-upload');
    expect(classifyFoeImageSave({
      currentFoe: {imagePath: 'foes/main/legacy.png'},
      hasImageFile: true,
      task07WriteEnabled: false,
    }).mode).toBe('legacy-upload');
    expect(classifyFoeImageSave({
      currentFoe: {imagePath: 'foes/main/legacy.png'},
      removeImage: true,
    }).mode).toBe('legacy-remove');
  });

  test('cleans only legacy foes paths, including canonical rollback fallbacks', () => {
    expect(collectClientDeletableFoeStoragePaths({
      ...canonicalFoe,
      imagePath: 'foes/main/canonical-fallback.png',
      tecniche: [
        {imagePath: 'media_assets/v1/dm-only/dm/asset/generation/thumbnail'},
        {imagePath: 'foes/tecniche/legacy.png'},
      ],
    })).toEqual([
      'foes/main/canonical-fallback.png',
      'foes/tecniche/legacy.png',
      'foes/spells/hex.png',
    ]);
    expect(shouldClientDeleteFoeMainStorageObject({
      ...canonicalFoe,
      imagePath: 'foes/main/canonical-fallback.png',
    })).toBe(true);
  });

  test('cleans General-only legacy fallbacks without touching canonical paths', () => {
    const foe = {
      media: canonicalFoe.media,
      imagePath: 'media_assets/v1/dm-only/dm/asset/generation/original',
      General: {
        media: {...canonicalFoe.media},
        imagePath: 'foes/main/general-fallback.png',
        downloadUrl:
          'https://firebasestorage.googleapis.com/v0/b/demo/o/foes%2Fmain%2Falternate.png?alt=media',
        url:
          'https://firebasestorage.googleapis.com/v0/b/demo/o/media_assets%2Fcanonical.png?alt=media',
      },
    };

    expect(collectClientDeletableFoeMainStoragePaths(foe)).toEqual([
      'foes/main/general-fallback.png',
      'foes/main/alternate.png',
    ]);
    expect(collectClientDeletableFoeStoragePaths(foe)).toEqual([
      'foes/main/general-fallback.png',
      'foes/main/alternate.png',
    ]);
    expect(shouldClientDeleteFoeMainStorageObject(foe)).toBe(true);
  });

  test('uses live media state while retaining only safe retirement retry identity', () => {
    const liveCanonical = {
      media: canonicalFoe.media,
      task07MediaRevision: 2,
    };
    expect(classifyFoeImageSave({
      currentFoe: liveCanonical,
      initialFoe: {imagePath: 'foes/main/legacy.png'},
      removeImage: true,
    })).toMatchObject({
      mode: 'canonical-remove',
      binding: {assetId: canonicalFoe.media.assetId, revision: 2},
    });

    const initialCanonical = {
      media: canonicalFoe.media,
      task07MediaRevision: 1,
    };
    expect(classifyFoeImageSave({
      currentFoe: {name: 'Already retired', task07MediaRevision: 2},
      initialFoe: initialCanonical,
      removeImage: true,
    })).toMatchObject({
      mode: 'canonical-remove',
      binding: {assetId: canonicalFoe.media.assetId, revision: 1},
    });
    expect(classifyFoeImageSave({
      currentFoe: {name: 'Already retired', task07MediaRevision: 2},
      initialFoe: initialCanonical,
    })).toMatchObject({
      mode: 'ordinary',
      binding: {status: 'canonical', assetId: canonicalFoe.media.assetId},
    });
    expect(classifyFoeImageSave({
      currentFoe: {name: 'Already retired', task07MediaRevision: 2},
      hasImageFile: true,
      initialFoe: initialCanonical,
      task07WriteEnabled: true,
    })).toMatchObject({
      mode: 'blocked',
      code: 'canonical-media-changed',
    });

    expect(classifyFoeImageSave({
      currentFoe: {
        media: canonicalFoe.media,
        General: {
          media: {assetId: 'm_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'},
        },
      },
      initialFoe: {imagePath: 'foes/main/legacy.png'},
      removeImage: true,
    })).toMatchObject({
      mode: 'blocked',
      code: 'canonical-media-conflict',
    });

    expect(classifyFoeImageSave({
      currentFoe: {
        media: {
          ...canonicalFoe.media,
          assetId: 'm_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        },
        task07MediaRevision: 2,
      },
      initialFoe: initialCanonical,
      removeImage: true,
    })).toMatchObject({
      mode: 'blocked',
      code: 'canonical-media-changed',
    });
  });

  test('routes canonical and malformed Task 07 state through durable duplication', () => {
    expect(shouldUseDurableFoeDuplication(canonicalFoe)).toBe(true);
    expect(shouldUseDurableFoeDuplication({
      General: { media: canonicalFoe.media },
    })).toBe(true);
    expect(shouldUseDurableFoeDuplication({ media: {} })).toBe(true);
    expect(shouldUseDurableFoeDuplication({
      imagePath: 'media_assets/v1/dm-only/dm/bad',
    })).toBe(true);
    expect(shouldUseDurableFoeDuplication({
      imagePath: 'foes/main/legacy.png',
    })).toBe(true);
    expect(shouldUseDurableFoeDuplication({
      tecniche: [{imageUrl: 'https://legacy.example/technique.png'}],
    })).toBe(true);
    expect(shouldUseDurableFoeDuplication({
      spells: [{media: {}}],
    })).toBe(true);
    expect(shouldUseDurableFoeDuplication({
      General: {videoUrl: 'https://legacy.example/video.mp4'},
    })).toBe(true);
    expect(shouldUseDurableFoeDuplication({name: 'No media'})).toBe(false);
    expect(shouldUseDurableFoeDuplication({}, { force: true })).toBe(true);
  });

  test.each([
    'failed-precondition',
    'functions/failed-precondition',
    'invalid-argument',
    'functions/invalid-argument',
    'not-found',
    'functions/not-found',
    'already-exists',
    'functions/already-exists',
  ])('classifies %s as a definitive duplication error', (code) => {
    expect(isDefinitiveFoeDuplicationError({code})).toBe(true);
  });

  test.each([
    'unavailable',
    'functions/deadline-exceeded',
    'internal',
    'functions/unknown',
    'aborted',
    'functions/unauthenticated',
    'permission-denied',
    'custom-code',
    '',
  ])('retains duplication recovery identity for %s', (code) => {
    expect(isDefinitiveFoeDuplicationError({code})).toBe(false);
  });

  test('retains duplication recovery identity for errors without a code', () => {
    expect(isDefinitiveFoeDuplicationError(new Error('offline'))).toBe(false);
    expect(isDefinitiveFoeDuplicationError(null)).toBe(false);
  });
});
