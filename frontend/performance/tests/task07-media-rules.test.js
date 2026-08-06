const fs = require('fs');
const path = require('path');
const {after, before, test} = require('node:test');
const {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} = require('@firebase/rules-unit-testing');
const {
  collection,
  deleteField,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
} = require('firebase/firestore');
const {
  deleteObject,
  getMetadata,
  ref,
  uploadString,
} = require('firebase/storage');

const PROJECT_ID = 'demo-fnd-perf';
const PRIVATE_CACHE = 'private, max-age=31536000, immutable';
const STAGING_CACHE = 'private, no-store';
const USERS = {
  owner: {uid: 'task07-owner', role: 'player'},
  peer: {uid: 'task07-peer', role: 'player'},
  dm: {uid: 'task07-dm', role: 'dm'},
  webmaster: {uid: 'task07-webmaster', role: 'webmaster'},
};
const assetId = (character) => `m_${character.repeat(40)}`;

const makeManifest = ({
  asset,
  actorUid,
  audience,
  entityId,
  kind,
  ownerUid,
  state,
  referenceScope = null,
  sourceBytes = 8,
  sourceGeneration = '7',
}) => {
  const sourcePath = `media_uploads/${ownerUid}/${asset}/source`;
  const ownerKey = ownerUid;
  const originalPath = (
    `media_assets/v1/${audience}/${ownerKey}/${asset}/`
    + `${sourceGeneration}/original`
  );
  const targetKind = kind === 'avatar'
    ? 'profile'
    : kind === 'foe'
      ? 'foe'
      : 'catalog-item';
  const plan = {
    schemaVersion: 1,
    contractVersion: 1,
    policyVersion: 1,
    assetId: asset,
    kind,
    targetKind,
    actorUid,
    ownerUid,
    ownerKey,
    entityId,
    referenceScope,
    audienceScope: audience,
    previousAssetId: null,
    operationId: `rules_${asset.slice(-8)}`,
    sourceContentType: 'image/png',
    sourceBytes,
    sourcePath,
    originalPath: sourcePath,
    variants: {},
    passthrough: false,
    requestHash: 'a'.repeat(64),
  };
  const original = {
    path: originalPath,
    contentType: 'image/png',
    bytes: sourceBytes,
    width: 128,
    height: 128,
    durationMs: null,
    orientationDegrees: 0,
    checksum: 'b'.repeat(64),
    role: 'original',
    generation: '11',
    cacheControl: PRIVATE_CACHE,
  };
  return {
    schemaVersion: 1,
    policyVersion: 1,
    assetId: asset,
    generation: state === 'intent' ? null : sourceGeneration,
    state,
    purpose: kind,
    audience,
    ownerUid,
    actorUid,
    targetKind,
    targetId: entityId,
    previousAssetId: null,
    requestHash: plan.requestHash,
    plan,
    source: {
      path: sourcePath,
      mime: 'image/png',
      bytes: sourceBytes,
    },
    ...(state === 'intent'
      ? {}
      : {
        generated: {
          generation: sourceGeneration,
          original,
          variants: {},
        },
      }),
    attachment: null,
    retention: {cleanupAfter: new Date('2099-01-01T00:00:00.000Z')},
    error: {code: null, retryable: false, attempts: 0},
    createdAt: new Date('2026-07-27T00:00:00.000Z'),
    updatedAt: new Date('2026-07-27T00:00:00.000Z'),
  };
};

const FIXTURES = {
  intent: makeManifest({
    asset: assetId('a'),
    actorUid: USERS.owner.uid,
    audience: 'signed-in',
    entityId: USERS.owner.uid,
    kind: 'avatar',
    ownerUid: USERS.owner.uid,
    state: 'intent',
  }),
  signedIn: makeManifest({
    asset: assetId('b'),
    actorUid: USERS.owner.uid,
    audience: 'signed-in',
    entityId: USERS.owner.uid,
    kind: 'avatar',
    ownerUid: USERS.owner.uid,
    state: 'ready',
  }),
  ownerManager: makeManifest({
    asset: assetId('c'),
    actorUid: USERS.owner.uid,
    audience: 'owner-manager',
    entityId: 'private-item',
    kind: 'item',
    ownerUid: USERS.owner.uid,
    referenceScope: 'user-inventory',
    state: 'attached',
  }),
  dmOnly: makeManifest({
    asset: assetId('d'),
    actorUid: USERS.dm.uid,
    audience: 'dm-only',
    entityId: 'private-foe',
    kind: 'foe',
    ownerUid: USERS.dm.uid,
    state: 'ready',
  }),
};

const MUSIC_STREAM_FIXTURE = {
  schemaVersion: 2,
  controlMode: 'canonical-only',
  revision: 1,
  volume: 0.65,
  sessions: [],
  sourceHash: 'a'.repeat(64),
  updatedAt: new Date('2026-07-27T00:00:00.000Z'),
};

const FOE_OPERATION_FIXTURE = (() => {
  const receiptId = 'f'.repeat(48);
  const foeId = 'task07-operation-foe';
  const slot = 'spells-0';
  const digest = 'c'.repeat(64);
  const fileName = `${digest}.png`;
  const operationId = 'foe-retirement-rules-0001';
  const path = [
    'foes',
    'task07-operations',
    USERS.webmaster.uid,
    receiptId,
    foeId,
    slot,
    fileName,
  ].join('/');
  const metadata = {
    task07ActorUid: USERS.webmaster.uid,
    task07AssetId: FIXTURES.dmOnly.assetId,
    task07Bytes: '8',
    task07Digest: digest,
    task07FoeId: foeId,
    task07OperationId: operationId,
    task07ReceiptId: receiptId,
    task07Slot: slot,
  };
  return {
    receiptId,
    path,
    uploadMetadata: {
      contentType: 'image/png',
      cacheControl: PRIVATE_CACHE,
      contentDisposition: 'inline',
      customMetadata: metadata,
    },
    receipt: {
      schemaVersion: 1,
      actorUid: USERS.webmaster.uid,
      operationId,
      assetId: FIXTURES.dmOnly.assetId,
      foeId,
      status: 'pending',
      uploadsBySlot: {
        [slot]: {
          path,
          fileName,
          bytes: 8,
          contentType: 'image/png',
          digest,
          metadata,
        },
      },
    },
  };
})();

const sourceMetadata = (manifest, overrides = {}) => ({
  contentType: manifest.plan.sourceContentType,
  cacheControl: STAGING_CACHE,
  contentDisposition: 'inline',
  customMetadata: {
    task07AssetId: manifest.assetId,
    task07ContractVersion: '1',
    task07EntityId: manifest.plan.entityId,
    task07Kind: manifest.plan.kind,
    task07OwnerUid: manifest.ownerUid,
    task07Role: 'source',
    ...(overrides.customMetadata || {}),
  },
  ...Object.fromEntries(
    Object.entries(overrides).filter(([key]) => key !== 'customMetadata')
  ),
});

let environment;

before(async () => {
  environment = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      host: '127.0.0.1',
      port: 8080,
      rules: fs.readFileSync(
        path.resolve(__dirname, '..', '..', 'firestore.rules'),
        'utf8'
      ),
    },
    storage: {
      host: '127.0.0.1',
      port: 9199,
      rules: fs.readFileSync(
        path.resolve(__dirname, '..', '..', 'storage.rules'),
        'utf8'
      ),
    },
  });
  await environment.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    const storage = context.storage();
    for (const user of Object.values(USERS)) {
      await setDoc(doc(firestore, `users/${user.uid}`), {
        role: user.role,
        deletionState: null,
      });
    }
    await setDoc(
      doc(firestore, 'grigliata_music_stream/current'),
      MUSIC_STREAM_FIXTURE
    );
    await setDoc(
      doc(firestore, 'grigliata_music_stream/private-copy'),
      MUSIC_STREAM_FIXTURE
    );
    await setDoc(doc(
      firestore,
      `task07_foe_media_operations/${FOE_OPERATION_FIXTURE.receiptId}`
    ), FOE_OPERATION_FIXTURE.receipt);
    for (const manifest of Object.values(FIXTURES)) {
      await setDoc(
        doc(firestore, `media_assets/${manifest.assetId}`),
        manifest
      );
      if (manifest.generated) {
        await uploadString(
          ref(storage, manifest.generated.original.path),
          '12345678',
          'raw',
          {
            contentType: 'image/png',
            cacheControl: PRIVATE_CACHE,
            contentDisposition: 'inline',
          }
        );
      }
    }
    await setDoc(doc(firestore, `users/${USERS.owner.uid}`), {
      role: USERS.owner.role,
      deletionState: null,
      displayName: 'Task 07 owner',
      media: {
        schemaVersion: 1,
        contractVersion: 1,
        assetId: FIXTURES.signedIn.assetId,
        kind: 'avatar',
        state: 'ready',
        generation: '7',
        audience: 'signed-in',
        ownerUid: USERS.owner.uid,
        original: FIXTURES.signedIn.generated.original,
        variants: {},
        processing: {authoritative: true, fallbackCode: null},
      },
      task07MediaRevision: 1,
      mediaUpdatedAt: new Date('2026-07-27T00:00:00.000Z'),
    });
  });
});

after(async () => {
  if (!environment) return;
  await environment.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    const storage = context.storage();
    for (const manifest of Object.values(FIXTURES)) {
      if (manifest.generated) {
        await deleteObject(ref(
          storage,
          manifest.generated.original.path
        )).catch(() => undefined);
      }
      await deleteObject(ref(
        storage,
        manifest.plan.sourcePath
      )).catch(() => undefined);
      await deleteDoc(doc(
        firestore,
        `media_assets/${manifest.assetId}`
      ));
    }
    for (const user of Object.values(USERS)) {
      await deleteDoc(doc(firestore, `users/${user.uid}`));
    }
    await deleteDoc(doc(firestore, 'grigliata_music_stream/current'));
    await deleteDoc(doc(firestore, 'grigliata_music_stream/private-copy'));
    await deleteObject(ref(
      storage,
      FOE_OPERATION_FIXTURE.path
    )).catch(() => undefined);
    await deleteObject(ref(
      storage,
      'foes/task07-rules-generic.png'
    )).catch(() => undefined);
    await deleteDoc(doc(
      firestore,
      `task07_foe_media_operations/${FOE_OPERATION_FIXTURE.receiptId}`
    ));
  });
  await environment.cleanup();
});

test('music stream permits only signed-in current-document gets', async () => {
  const anonymous = environment.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(
    anonymous,
    'grigliata_music_stream/current'
  )));
  for (const {uid} of Object.values(USERS)) {
    const firestore = environment.authenticatedContext(uid).firestore();
    await assertSucceeds(getDoc(doc(
      firestore,
      'grigliata_music_stream/current'
    )));
    await assertFails(getDoc(doc(
      firestore,
      'grigliata_music_stream/private-copy'
    )));
    await assertFails(getDocs(collection(
      firestore,
      'grigliata_music_stream'
    )));
  }
});

test('music stream remains server-owned for every privileged client role', async () => {
  for (const uid of [USERS.dm.uid, USERS.webmaster.uid]) {
    const firestore = environment.authenticatedContext(uid).firestore();
    const stream = doc(firestore, 'grigliata_music_stream/current');
    await assertFails(setDoc(stream, MUSIC_STREAM_FIXTURE));
    await assertFails(updateDoc(stream, {volume: 0.2}));
    await assertFails(deleteDoc(stream));
  }
});

test('canonical-only music writes bind tracks and cannot introduce legacy URLs', async () => {
  const trackId = 'task07-music-track';
  const newTrackId = 'task07-music-new';
  const legacyTrackId = 'task07-music-legacy';
  const mediaAssetId = assetId('9');
  const timestamp = new Date('2026-08-01T00:00:00.000Z');
  const baseTrack = {
    name: 'Canonical track',
    fileName: 'canonical.mp3',
    audioUrl: 'https://legacy.example/canonical.mp3',
    audioPath: 'grigliata/music/task07-dm/canonical.mp3',
    contentType: 'audio/mpeg',
    sizeBytes: 4096,
    durationMs: 120000,
    createdAt: timestamp,
    createdBy: USERS.dm.uid,
    updatedAt: timestamp,
    updatedBy: USERS.dm.uid,
  };
  const media = {
    schemaVersion: 1,
    contractVersion: 1,
    assetId: mediaAssetId,
    kind: 'music',
    state: 'ready',
    generation: '7',
    audience: 'signed-in',
    ownerUid: USERS.dm.uid,
    original: {
      path: `media_assets/v1/signed-in/${USERS.dm.uid}/${mediaAssetId}/7/original`,
      contentType: 'audio/mpeg',
      bytes: 4096,
      durationMs: 120000,
      width: 0,
      height: 0,
      generation: '9',
    },
  };
  await environment.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    await setDoc(doc(firestore, 'utils/task07_media'), {
      schemaVersion: 1,
      policyVersion: 1,
      mode: 'canonical-only',
      enabledPurposes: ['*'],
      enabledRoles: ['*'],
      enabledUids: ['*'],
    });
    await setDoc(doc(firestore, `grigliata_music_tracks/${trackId}`), {
      ...baseTrack,
      media,
      task07MediaRevision: 1,
      mediaUpdatedAt: timestamp,
    });
  });

  const dm = environment.authenticatedContext(USERS.dm.uid).firestore();
  const track = doc(dm, `grigliata_music_tracks/${trackId}`);
  const newTrack = doc(dm, `grigliata_music_tracks/${newTrackId}`);
  const legacyTrack = doc(dm, `grigliata_music_tracks/${legacyTrackId}`);
  try {
    await assertSucceeds(updateDoc(track, {musicFolderId: 'combat'}));
    await assertFails(updateDoc(track, {
      audioUrl: 'https://legacy.example/replacement.mp3',
    }));
    await assertSucceeds(setDoc(newTrack, {
      ...baseTrack,
      name: 'New canonical source',
      audioUrl: '',
      audioPath: '',
    }));
    await assertFails(setDoc(legacyTrack, {
      ...baseTrack,
      name: 'Forbidden legacy source',
    }));

    const canonicalSession = {
      status: 'paused',
      trackId,
      trackName: 'Canonical track',
      audioUrl: '',
      mediaAssetId,
      durationMs: 120000,
      offsetMs: 2000,
      loop: false,
      startedAt: null,
      startedAtMs: 0,
      commandId: 'music_rules_canonical',
      updatedAt: timestamp,
      updatedBy: USERS.dm.uid,
    };
    const session = doc(dm, `grigliata_music_playback_sessions/${trackId}`);
    await assertSucceeds(setDoc(session, canonicalSession));
    await assertFails(setDoc(session, {
      ...canonicalSession,
      audioUrl: 'https://legacy.example/canonical.mp3',
      mediaAssetId: '',
    }));
    await assertFails(setDoc(session, {
      ...canonicalSession,
      mediaAssetId: assetId('8'),
    }));

    const playback = doc(dm, 'grigliata_music_playback/current');
    await assertSucceeds(setDoc(playback, {
      status: 'paused',
      trackId,
      trackName: 'Canonical track',
      audioUrl: '',
      mediaAssetId,
      durationMs: 120000,
      offsetMs: 2000,
      volume: 0.65,
      startedAt: null,
      commandId: 'music_rules_state',
      updatedAt: timestamp,
      updatedBy: USERS.dm.uid,
    }));
    await assertFails(setDoc(playback, {
      status: 'playing',
      trackId,
      trackName: 'Canonical track',
      audioUrl: 'https://legacy.example/canonical.mp3',
      mediaAssetId: '',
      durationMs: 120000,
      offsetMs: 2000,
      volume: 0.65,
      startedAt: timestamp,
      commandId: 'music_rules_legacy_state',
      updatedAt: timestamp,
      updatedBy: USERS.dm.uid,
    }));
    await assertSucceeds(setDoc(playback, {
      status: 'stopped',
      trackId: '',
      trackName: '',
      audioUrl: '',
      mediaAssetId: '',
      durationMs: 0,
      offsetMs: 0,
      volume: 0.65,
      startedAt: null,
      commandId: 'music_rules_stopped',
      updatedAt: timestamp,
      updatedBy: USERS.dm.uid,
    }));
  } finally {
    await environment.withSecurityRulesDisabled(async (context) => {
      const firestore = context.firestore();
      for (const pathName of [
        `grigliata_music_playback_sessions/${trackId}`,
        'grigliata_music_playback/current',
        `grigliata_music_tracks/${trackId}`,
        `grigliata_music_tracks/${newTrackId}`,
        `grigliata_music_tracks/${legacyTrackId}`,
        'utils/task07_media',
      ]) {
        await deleteDoc(doc(firestore, pathName));
      }
    });
  }
});

test('Task 07 ledgers and cleanup records remain server-only', async () => {
  const clients = [
    environment.unauthenticatedContext().firestore(),
    ...Object.values(USERS).map(({uid}) => (
      environment.authenticatedContext(uid).firestore()
    )),
  ];
  for (const firestore of clients) {
    await assertFails(getDoc(doc(
      firestore,
      `media_assets/${FIXTURES.intent.assetId}`
    )));
    await assertFails(getDocs(collection(firestore, 'media_assets')));
    await assertFails(setDoc(doc(
      firestore,
      `media_asset_cleanup/${FIXTURES.intent.assetId}`
    ), {state: 'pending'}));
  }
});

test('ordinary target edits preserve immutable Task 07 server fields', async () => {
  const timestamp = new Date('2026-07-27T00:00:00.000Z');
  const canonicalMedia = {
    assetId: assetId('e'),
    schemaVersion: 1,
    state: 'ready',
  };
  const seededTargets = [
    {
      path: `grigliata_tokens/task07-token-rules`,
      uid: USERS.dm.uid,
      data: {
        ownerUid: USERS.dm.uid,
        label: 'Token before',
        imageUrl: 'https://legacy.test/token.png',
        imagePath: 'grigliata_tokens/token.png',
        tokenType: 'custom',
        customTokenRole: 'template',
        customTemplateId: 'task07-token-rules',
        imageSource: 'uploaded',
        media: canonicalMedia,
        task07MediaRevision: 1,
        mediaUpdatedAt: timestamp,
        createdAt: timestamp,
        createdBy: USERS.dm.uid,
        updatedAt: timestamp,
        updatedBy: USERS.dm.uid,
      },
      safePatch: {label: 'Token after', updatedAt: new Date('2026-07-27T00:01:00.000Z')},
    },
    {
      path: 'echi_npcs/task07-npc-rules',
      uid: USERS.dm.uid,
      data: {
        nome: 'NPC',
        imageUrl: 'https://legacy.test/npc.png',
        imagePath: 'echi_npcs/npc.png',
        media: canonicalMedia,
        task07MediaRevision: 1,
        mediaUpdatedAt: timestamp,
        description: 'Before',
        notes: '',
        createdBy: USERS.dm.uid,
        createdByRole: 'dm',
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      safePatch: {description: 'After', updatedAt: new Date('2026-07-27T00:01:00.000Z')},
    },
    {
      path: 'items/task07-item-rules',
      uid: USERS.dm.uid,
      data: {
        name: 'Item before',
        media: canonicalMedia,
        task07MediaRevision: 1,
        mediaUpdatedAt: timestamp,
      },
      safePatch: {name: 'Item after'},
    },
    {
      path: 'foes/task07-foe-rules',
      uid: USERS.dm.uid,
      data: {
        name: 'Foe before',
        media: canonicalMedia,
        task07MediaRevision: 1,
        mediaUpdatedAt: timestamp,
      },
      safePatch: {name: 'Foe after'},
    },
    {
      path: 'foes/task07-general-foe-rules',
      uid: USERS.dm.uid,
      data: {
        name: 'General foe before',
        General: {
          label: 'Preserved metadata',
          media: canonicalMedia,
          task07MediaRevision: 1,
          mediaUpdatedAt: timestamp,
          videoMedia: {...canonicalMedia, assetId: assetId('8')},
          task07VideoMediaRevision: 1,
          videoMediaUpdatedAt: timestamp,
        },
      },
      safePatch: {name: 'General foe after'},
    },
    {
      path: 'grigliata_backgrounds/task07-background-rules',
      uid: USERS.dm.uid,
      data: {
        name: 'Map before',
        media: canonicalMedia,
        task07MediaRevision: 1,
        mediaUpdatedAt: timestamp,
        videoMedia: {...canonicalMedia, assetId: assetId('f')},
        task07VideoMediaRevision: 1,
        videoMediaUpdatedAt: timestamp,
      },
      safePatch: {name: 'Map after'},
    },
  ];

  await environment.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    for (const target of seededTargets) {
      await setDoc(doc(firestore, target.path), target.data);
    }
  });

  try {
    const owner = environment.authenticatedContext(USERS.owner.uid).firestore();
    const profile = doc(owner, `users/${USERS.owner.uid}`);
    await assertSucceeds(updateDoc(profile, {displayName: 'Task 07 owner updated'}));
    await assertFails(updateDoc(profile, {task07MediaRevision: 2}));
    await assertFails(updateDoc(profile, {
      videoMedia: {...canonicalMedia, assetId: assetId('9')},
    }));

    for (const target of seededTargets) {
      const firestore = environment.authenticatedContext(target.uid).firestore();
      const targetRef = doc(firestore, target.path);
      await assertSucceeds(updateDoc(targetRef, target.safePatch));
      await assertFails(updateDoc(targetRef, {task07MediaRevision: 2}));
      await assertFails(updateDoc(targetRef, {
        videoMedia: {...canonicalMedia, assetId: assetId('9')},
      }));
    }

    const dm = environment.authenticatedContext(USERS.dm.uid).firestore();
    await assertFails(updateDoc(doc(dm, 'foes/task07-foe-rules'), {
      media: deleteField(),
      task07MediaRevision: deleteField(),
      mediaUpdatedAt: deleteField(),
      imagePath: deleteField(),
      imageUrl: '',
    }));
    await assertFails(updateDoc(doc(dm, 'foes/task07-general-foe-rules'), {
      'General.media': deleteField(),
      'General.imagePath': deleteField(),
      'General.imageUrl': deleteField(),
    }));
    const generalFoe = doc(dm, 'foes/task07-general-foe-rules');
    for (const patch of [
      {'General.task07MediaRevision': 2},
      {'General.mediaUpdatedAt': new Date('2026-07-27T00:02:00.000Z')},
      {'General.videoMedia': {...canonicalMedia, assetId: assetId('7')}},
      {'General.task07VideoMediaRevision': 2},
      {'General.videoMediaUpdatedAt': new Date('2026-07-27T00:02:00.000Z')},
      {'General.task07MediaRevision': deleteField()},
      {'General.videoMedia': deleteField()},
    ]) {
      await assertFails(updateDoc(generalFoe, patch));
    }
    await assertFails(updateDoc(doc(dm, 'foes/task07-foe-rules'), {
      'General.videoMedia': {...canonicalMedia, assetId: assetId('7')},
    }));
    await assertFails(setDoc(doc(dm, 'foes/task07-client-general-control-create'), {
      name: 'Rejected nested client control field',
      General: {task07MediaRevision: 0},
    }));
    await assertFails(setDoc(doc(dm, 'items/task07-client-control-create'), {
      name: 'Rejected client control field',
      task07MediaRevision: 0,
    }));
  } finally {
    await environment.withSecurityRulesDisabled(async (context) => {
      const firestore = context.firestore();
      for (const target of seededTargets) {
        await deleteDoc(doc(firestore, target.path));
      }
    });
  }
});

test('only the manifest actor can create the exact immutable staging source', async () => {
  const owner = environment.authenticatedContext(USERS.owner.uid).storage();
  const peer = environment.authenticatedContext(USERS.peer.uid).storage();
  const anonymous = environment.unauthenticatedContext().storage();
  const path = FIXTURES.intent.plan.sourcePath;
  const metadata = sourceMetadata(FIXTURES.intent);
  await assertFails(uploadString(ref(anonymous, path), '12345678', 'raw', metadata));
  await assertFails(uploadString(ref(peer, path), '12345678', 'raw', metadata));
  await assertFails(uploadString(
    ref(owner, `${path}/extra`),
    '12345678',
    'raw',
    metadata
  ));
  await assertSucceeds(uploadString(ref(owner, path), '12345678', 'raw', metadata));
  await assertFails(uploadString(ref(owner, path), '12345678', 'raw', metadata));
  await assertFails(getMetadata(ref(owner, path)));
  await assertFails(deleteObject(ref(owner, path)));
});

test('staging rejects wrong bytes, MIME, disposition, and custom metadata', async () => {
  const owner = environment.authenticatedContext(USERS.owner.uid).storage();
  const manifest = makeManifest({
    asset: assetId('e'),
    actorUid: USERS.owner.uid,
    audience: 'signed-in',
    entityId: USERS.owner.uid,
    kind: 'avatar',
    ownerUid: USERS.owner.uid,
    state: 'intent',
  });
  await environment.withSecurityRulesDisabled(async (context) => {
    await setDoc(
      doc(context.firestore(), `media_assets/${manifest.assetId}`),
      manifest
    );
  });
  const target = ref(owner, manifest.plan.sourcePath);
  await assertFails(uploadString(
    target,
    'short',
    'raw',
    sourceMetadata(manifest)
  ));
  await assertFails(uploadString(
    target,
    '12345678',
    'raw',
    sourceMetadata(manifest, {contentType: 'image/jpeg'})
  ));
  await assertFails(uploadString(
    target,
    '12345678',
    'raw',
    sourceMetadata(manifest, {contentDisposition: 'attachment'})
  ));
  await assertFails(uploadString(
    target,
    '12345678',
    'raw',
    sourceMetadata(manifest, {
      customMetadata: {task07Role: 'original'},
    })
  ));
  await environment.withSecurityRulesDisabled(async (context) => {
    await deleteDoc(doc(
      context.firestore(),
      `media_assets/${manifest.assetId}`
    ));
  });
});

test('foe operation paths are receipt-bound, immutable, and server-deletable', async () => {
  const dm = environment.authenticatedContext(USERS.dm.uid).storage();
  const peer = environment.authenticatedContext(USERS.peer.uid).storage();
  const webmaster = environment.authenticatedContext(USERS.webmaster.uid).storage();
  const target = ref(webmaster, FOE_OPERATION_FIXTURE.path);
  await assertFails(uploadString(
    ref(dm, FOE_OPERATION_FIXTURE.path),
    '12345678',
    'raw',
    FOE_OPERATION_FIXTURE.uploadMetadata
  ));
  await assertFails(uploadString(
    ref(peer, FOE_OPERATION_FIXTURE.path),
    '12345678',
    'raw',
    FOE_OPERATION_FIXTURE.uploadMetadata
  ));
  await assertFails(uploadString(
    ref(webmaster, `${FOE_OPERATION_FIXTURE.path}/bypass.png`),
    '12345678',
    'raw',
    FOE_OPERATION_FIXTURE.uploadMetadata
  ));
  await assertFails(uploadString(
    target,
    '12345678',
    'raw',
    {
      ...FOE_OPERATION_FIXTURE.uploadMetadata,
      customMetadata: {
        ...FOE_OPERATION_FIXTURE.uploadMetadata.customMetadata,
        arbitrary: 'rejected',
      },
    }
  ));
  await assertSucceeds(uploadString(
    target,
    '12345678',
    'raw',
    FOE_OPERATION_FIXTURE.uploadMetadata
  ));
  await assertSucceeds(getMetadata(target));
  await assertFails(uploadString(
    target,
    '12345678',
    'raw',
    FOE_OPERATION_FIXTURE.uploadMetadata
  ));
  await assertFails(deleteObject(ref(peer, FOE_OPERATION_FIXTURE.path)));
  await assertFails(deleteObject(target));

  const generic = ref(dm, 'foes/task07-rules-generic.png');
  await assertSucceeds(uploadString(generic, 'first', 'raw', {
    contentType: 'image/png',
  }));
  await assertSucceeds(uploadString(generic, 'second', 'raw', {
    contentType: 'image/png',
  }));
  await assertSucceeds(deleteObject(generic));

  const nestedGeneric = ref(dm, 'foes/legacy/task07-rules-generic.png');
  await assertSucceeds(uploadString(nestedGeneric, 'legacy', 'raw', {
    contentType: 'image/png',
  }));
  await assertSucceeds(deleteObject(nestedGeneric));
});

test('generated paths are read-only and enforce signed-in audiences', async () => {
  const anonymous = environment.unauthenticatedContext().storage();
  const owner = environment.authenticatedContext(USERS.owner.uid).storage();
  const peer = environment.authenticatedContext(USERS.peer.uid).storage();
  const dm = environment.authenticatedContext(USERS.dm.uid).storage();
  const webmaster = environment.authenticatedContext(
    USERS.webmaster.uid
  ).storage();
  const pathOf = (manifest) => manifest.generated.original.path;

  await assertFails(getMetadata(ref(anonymous, pathOf(FIXTURES.signedIn))));
  for (const storage of [owner, peer, dm, webmaster]) {
    await assertSucceeds(getMetadata(ref(storage, pathOf(FIXTURES.signedIn))));
  }

  await assertSucceeds(getMetadata(ref(owner, pathOf(FIXTURES.ownerManager))));
  await assertFails(getMetadata(ref(peer, pathOf(FIXTURES.ownerManager))));
  await assertSucceeds(getMetadata(ref(dm, pathOf(FIXTURES.ownerManager))));
  await assertSucceeds(getMetadata(ref(webmaster, pathOf(FIXTURES.ownerManager))));

  await assertFails(getMetadata(ref(owner, pathOf(FIXTURES.dmOnly))));
  await assertFails(getMetadata(ref(peer, pathOf(FIXTURES.dmOnly))));
  await assertSucceeds(getMetadata(ref(dm, pathOf(FIXTURES.dmOnly))));
  await assertSucceeds(getMetadata(ref(webmaster, pathOf(FIXTURES.dmOnly))));

  await assertFails(uploadString(
    ref(owner, pathOf(FIXTURES.signedIn)),
    'client-overwrite',
    'raw',
    {contentType: 'image/png'}
  ));
  await assertFails(deleteObject(ref(dm, pathOf(FIXTURES.dmOnly))));
});

test('map gallery and video poster derivatives are readable by signed-in users', async () => {
  const createVariantFixture = ({asset, kind, variant}) => {
    const manifest = makeManifest({
      asset,
      actorUid: USERS.dm.uid,
      audience: 'signed-in',
      entityId: `task07-${kind}-derivative`,
      kind,
      ownerUid: USERS.dm.uid,
      state: 'attached',
    });
    const variantPath = manifest.generated.original.path.replace(
      '/original',
      `/${variant}`
    );
    manifest.plan.variants = {[variant]: variantPath};
    manifest.generated.variants = {
      [variant]: {
        ...manifest.generated.original,
        path: variantPath,
        contentType: 'image/webp',
        role: variant,
      },
    };
    return manifest;
  };
  const manifests = [
    createVariantFixture({
      asset: assetId('e'),
      kind: 'map',
      variant: 'gallery',
    }),
    createVariantFixture({
      asset: assetId('f'),
      kind: 'map-video',
      variant: 'poster',
    }),
  ];

  await environment.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    const storage = context.storage();
    for (const manifest of manifests) {
      await setDoc(doc(firestore, `media_assets/${manifest.assetId}`), manifest);
      const descriptor = Object.values(manifest.generated.variants)[0];
      await uploadString(ref(storage, descriptor.path), '12345678', 'raw', {
        contentType: descriptor.contentType,
        cacheControl: PRIVATE_CACHE,
        contentDisposition: 'inline',
      });
    }
  });

  try {
    const anonymous = environment.unauthenticatedContext().storage();
    const signedIn = [
      USERS.owner,
      USERS.peer,
      USERS.dm,
      USERS.webmaster,
    ].map((user) => environment.authenticatedContext(user.uid).storage());

    for (const manifest of manifests) {
      const descriptor = Object.values(manifest.generated.variants)[0];
      await assertFails(getMetadata(ref(anonymous, descriptor.path)));
      for (const storage of signedIn) {
        await assertSucceeds(getMetadata(ref(storage, descriptor.path)));
      }
    }
  } finally {
    await environment.withSecurityRulesDisabled(async (context) => {
      const firestore = context.firestore();
      const storage = context.storage();
      for (const manifest of manifests) {
        const descriptor = Object.values(manifest.generated.variants)[0];
        await deleteObject(ref(storage, descriptor.path)).catch(() => undefined);
        await deleteDoc(doc(firestore, `media_assets/${manifest.assetId}`));
      }
    });
  }
});

test('intent state and copied generated paths remain unreadable', async () => {
  const owner = environment.authenticatedContext(USERS.owner.uid).storage();
  const forgedPath = (
    `media_assets/v1/signed-in/${FIXTURES.intent.ownerUid}/`
    + `${FIXTURES.intent.assetId}/7/original`
  );
  await assertFails(getMetadata(ref(owner, forgedPath)));
  await assertFails(getMetadata(ref(
    owner,
    FIXTURES.signedIn.generated.original.path.replace('/7/', '/8/')
  )));
});

test('browser entity writes cannot introduce or replace Task 07 media', async () => {
  const owner = environment.authenticatedContext(USERS.owner.uid).firestore();
  const profile = doc(owner, `users/${USERS.owner.uid}`);
  await assertSucceeds(updateDoc(profile, {displayName: 'Ordinary edit'}));
  await assertFails(updateDoc(profile, {
    media: {
      ...((await getDoc(profile)).data().media),
      assetId: FIXTURES.intent.assetId,
    },
  }));
  await assertFails(updateDoc(profile, {media: null}));
});
