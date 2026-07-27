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
  schemaVersion: 1,
  revision: 1,
  volume: 0.65,
  sessions: [],
  sourceHash: 'a'.repeat(64),
  updatedAt: new Date('2026-07-27T00:00:00.000Z'),
};

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

test('staging rejects wrong bytes, MIME, cache policy, and custom metadata', async () => {
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
    sourceMetadata(manifest, {cacheControl: 'public, max-age=3600'})
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
  await assertFails(getMetadata(ref(webmaster, pathOf(FIXTURES.dmOnly))));

  await assertFails(uploadString(
    ref(owner, pathOf(FIXTURES.signedIn)),
    'client-overwrite',
    'raw',
    {contentType: 'image/png'}
  ));
  await assertFails(deleteObject(ref(dm, pathOf(FIXTURES.dmOnly))));
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
