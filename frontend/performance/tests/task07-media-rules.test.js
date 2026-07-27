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
  deleteField,
  doc,
  documentId,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} = require('firebase/firestore');
const {
  deleteObject,
  getMetadata,
  ref,
  uploadString,
} = require('firebase/storage');

const PROJECT_ID = 'demo-fnd-perf';
const PRIVATE_CACHE_CONTROL = 'private, max-age=31536000, immutable';
const USER_FIXTURES = Object.freeze({
  player: {uid: 'task07-rules-player', role: 'player'},
  peer: {uid: 'task07-rules-peer', role: 'player'},
  dm: {uid: 'task07-rules-dm', role: 'dm'},
  webmaster: {uid: 'task07-rules-webmaster', role: 'webmaster'},
});

const assetIdFor = (hexCharacter) => `m_${hexCharacter.repeat(40)}`;

const task07ReferencePath = ({entityId, kind, ownerUid, referenceScope}) => {
  if (kind === 'avatar') return `users/${ownerUid}`;
  if (kind === 'item' && referenceScope === 'global-catalog') {
    return `items/${entityId}`;
  }
  if (kind === 'item' && referenceScope === 'user-inventory') {
    return `users/${ownerUid}/inventory/${entityId}`;
  }
  if (kind === 'npc') return `echi_npcs/${entityId}`;
  if (kind === 'foe') return `foes/${entityId}`;
  if (kind === 'map' || kind === 'map-video') {
    return `grigliata_backgrounds/${entityId}`;
  }
  throw new TypeError(`Unsupported Task 07 rules fixture kind: ${kind}`);
};

const makeAssetFixture = ({
  actorUid,
  entityId = null,
  hexCharacter,
  kind,
  ownerUid,
  referenceScope = null,
  referencePathOverride = null,
  sourceFile = 'source.png',
  state = 'ready',
}) => {
  const assetId = assetIdFor(hexCharacter);
  const resolvedEntityId = entityId || `rules-${kind}`;
  const prefix = `media/v1/${kind}/${ownerUid}/${assetId}`;
  const originalPath = `${prefix}/original/${sourceFile}`;
  const variantNames = kind === 'map-video'
    ? ['poster']
    : kind === 'map'
      ? ['thumbnail', 'card', 'board']
      : ['thumbnail', 'card'];
  const variantPaths = Object.fromEntries(variantNames.map((variantName) => [
    variantName,
    `${prefix}/derivatives/v1/${variantName}.webp`,
  ]));
  const referencePath = task07ReferencePath({
    entityId: resolvedEntityId,
    kind,
    ownerUid,
    referenceScope,
  });

  return {
    assetId,
    kind,
    ownerUid,
    actorUid,
    originalPath,
    variantPaths,
    manifest: {
      schemaVersion: 1,
      contractVersion: 1,
      assetId,
      kind,
      ownerUid,
      actorUid,
      entityId: resolvedEntityId,
      referenceScope,
      state,
      ...(state === 'referenced'
        ? {referencePath: referencePathOverride || referencePath}
        : {}),
      plan: {
        schemaVersion: 1,
        contractVersion: 1,
        assetId,
        kind,
        actorUid,
        ownerUid,
        entityId: resolvedEntityId,
        referenceScope,
        originalPath,
        variants: variantPaths,
      },
    },
  };
};

const ASSETS = Object.freeze({
  avatar: makeAssetFixture({
    actorUid: USER_FIXTURES.player.uid,
    hexCharacter: 'a',
    kind: 'avatar',
    ownerUid: USER_FIXTURES.player.uid,
    entityId: USER_FIXTURES.player.uid,
    state: 'referenced',
  }),
  avatarWrongReference: makeAssetFixture({
    actorUid: USER_FIXTURES.player.uid,
    hexCharacter: '7',
    kind: 'avatar',
    ownerUid: USER_FIXTURES.player.uid,
    entityId: USER_FIXTURES.player.uid,
    referencePathOverride: `users/${USER_FIXTURES.peer.uid}`,
    state: 'referenced',
  }),
  avatarWrongOwner: makeAssetFixture({
    actorUid: USER_FIXTURES.peer.uid,
    hexCharacter: '8',
    kind: 'avatar',
    ownerUid: USER_FIXTURES.peer.uid,
    entityId: USER_FIXTURES.player.uid,
  }),
  avatarWrongEntity: makeAssetFixture({
    actorUid: USER_FIXTURES.player.uid,
    hexCharacter: '9',
    kind: 'avatar',
    ownerUid: USER_FIXTURES.player.uid,
    entityId: USER_FIXTURES.peer.uid,
  }),
  avatarWrongScope: makeAssetFixture({
    actorUid: USER_FIXTURES.player.uid,
    hexCharacter: '0',
    kind: 'avatar',
    ownerUid: USER_FIXTURES.player.uid,
    entityId: USER_FIXTURES.player.uid,
    referenceScope: 'global-catalog',
  }),
  item: makeAssetFixture({
    actorUid: USER_FIXTURES.dm.uid,
    hexCharacter: 'b',
    kind: 'item',
    ownerUid: USER_FIXTURES.dm.uid,
    entityId: 'task07-rules-catalog-item',
    referenceScope: 'global-catalog',
  }),
  itemReplacement: makeAssetFixture({
    actorUid: USER_FIXTURES.webmaster.uid,
    hexCharacter: '6',
    kind: 'item',
    ownerUid: USER_FIXTURES.webmaster.uid,
    entityId: 'task07-rules-catalog-item',
    referenceScope: 'global-catalog',
  }),
  privateItem: makeAssetFixture({
    actorUid: USER_FIXTURES.player.uid,
    hexCharacter: '4',
    kind: 'item',
    ownerUid: USER_FIXTURES.player.uid,
    entityId: 'task07-rules-private-item',
    referenceScope: 'user-inventory',
  }),
  npc: makeAssetFixture({
    actorUid: USER_FIXTURES.dm.uid,
    hexCharacter: 'c',
    kind: 'npc',
    ownerUid: USER_FIXTURES.dm.uid,
    entityId: 'task07-rules-media-npc',
  }),
  npcReplacement: makeAssetFixture({
    actorUid: USER_FIXTURES.webmaster.uid,
    hexCharacter: '1',
    kind: 'npc',
    ownerUid: USER_FIXTURES.webmaster.uid,
    entityId: 'task07-rules-media-npc',
  }),
  npcLegacy: makeAssetFixture({
    actorUid: USER_FIXTURES.dm.uid,
    hexCharacter: '2',
    kind: 'npc',
    ownerUid: USER_FIXTURES.dm.uid,
    entityId: 'task07-rules-legacy-npc',
  }),
  foe: makeAssetFixture({
    actorUid: USER_FIXTURES.dm.uid,
    hexCharacter: 'd',
    kind: 'foe',
    ownerUid: USER_FIXTURES.dm.uid,
    entityId: 'task07-rules-foe',
  }),
  map: makeAssetFixture({
    actorUid: USER_FIXTURES.dm.uid,
    hexCharacter: 'e',
    kind: 'map',
    ownerUid: USER_FIXTURES.dm.uid,
    entityId: 'task07-rules-map',
  }),
  mapVideo: makeAssetFixture({
    actorUid: USER_FIXTURES.dm.uid,
    hexCharacter: '5',
    kind: 'map-video',
    ownerUid: USER_FIXTURES.dm.uid,
    entityId: 'task07-rules-video',
    sourceFile: 'source.mp4',
  }),
  supersededMap: makeAssetFixture({
    actorUid: USER_FIXTURES.dm.uid,
    hexCharacter: '3',
    kind: 'map',
    ownerUid: USER_FIXTURES.dm.uid,
    entityId: 'task07-rules-state-map',
    state: 'superseded',
  }),
  prepared: makeAssetFixture({
    actorUid: USER_FIXTURES.dm.uid,
    hexCharacter: 'f',
    kind: 'npc',
    ownerUid: USER_FIXTURES.dm.uid,
    entityId: 'task07-rules-prepared-npc',
    state: 'prepared',
  }),
});

const READY_ASSETS = Object.freeze([
  ASSETS.avatar,
  ASSETS.item,
  ASSETS.privateItem,
  ASSETS.npc,
  ASSETS.foe,
  ASSETS.map,
  ASSETS.mapVideo,
]);

const mediaDescriptor = (asset, generation = '7') => ({
  schemaVersion: 1,
  contractVersion: 1,
  assetId: asset.assetId,
  kind: asset.kind,
  state: 'ready',
  original: {
    path: asset.originalPath,
    contentType: asset.kind === 'map-video' ? 'video/mp4' : 'image/png',
    bytes: 24,
    width: 512,
    height: 512,
    generation,
    durationMs: asset.kind === 'map-video' ? 60_000 : null,
    orientationDegrees: 0,
    cacheControl: PRIVATE_CACHE_CONTROL,
  },
  variants: Object.fromEntries(Object.entries(asset.variantPaths).map(
    ([variantName, variantPath]) => [
      variantName,
      {
        path: variantPath,
        contentType: 'image/webp',
        bytes: 16,
        width: variantName === 'thumbnail' ? 160 : 512,
        height: variantName === 'thumbnail' ? 160 : 512,
        generation,
        durationMs: null,
        orientationDegrees: 0,
        cacheControl: PRIVATE_CACHE_CONTROL,
      },
    ]
  )),
  processing: {
    authoritative: true,
    fallbackCode: null,
  },
});

const characterTokenDocument = (media, overrides = {}) => ({
  ownerUid: USER_FIXTURES.player.uid,
  characterId: `${USER_FIXTURES.player.uid}-character`,
  label: 'Task 07 character token',
  imageUrl: '',
  imagePath: media.original.path,
  tokenType: 'character',
  imageSource: 'profile',
  media,
  updatedAt: new Date('2026-07-25T00:00:00.000Z'),
  updatedBy: USER_FIXTURES.player.uid,
  ...overrides,
});

const task07UploadMetadata = (asset, role) => ({
  contentType: role === 'original' ? 'image/png' : 'image/webp',
  cacheControl: PRIVATE_CACHE_CONTROL,
  contentDisposition: 'inline',
  customMetadata: {
    task07AssetId: asset.assetId,
    task07ContractVersion: '1',
    task07EntityId: asset.manifest.entityId,
    task07Kind: asset.kind,
    task07OwnerUid: asset.ownerUid,
    task07Role: role,
  },
});

const npcDocument = (overrides = {}) => ({
  nome: 'Task 07 rules NPC',
  imageUrl: 'https://example.invalid/task07-rules-npc.png',
  imagePath: 'echi_npcs/task07-rules-dm/task07-rules-npc.png',
  description: 'Legacy-compatible rules fixture',
  notes: '',
  createdBy: USER_FIXTURES.dm.uid,
  createdByRole: 'dm',
  createdAt: new Date('2026-07-25T00:00:00.000Z'),
  updatedAt: new Date('2026-07-25T00:00:00.000Z'),
  ...overrides,
});

const NPC_PATHS = Object.freeze({
  legacy: 'echi_npcs/task07-rules-legacy-npc',
  withMedia: 'echi_npcs/task07-rules-media-npc',
  deniedCreate: 'echi_npcs/task07-rules-denied-npc',
});

const HIDDEN_FIXTURES = Object.freeze({
  mediaAsset: `media_assets/${ASSETS.prepared.assetId}`,
  cleanup: `media_asset_cleanup/${ASSETS.prepared.assetId}`,
});

const preparedPrefix = (
  `media/v1/${ASSETS.prepared.kind}/${ASSETS.prepared.ownerUid}`
  + `/${ASSETS.prepared.assetId}`
);
const WRONG_STORAGE_PATHS = Object.freeze([
  `${preparedPrefix}/original/not-source.png`,
  `${preparedPrefix}/derivatives/v1/thumbnail-copy.webp`,
  ASSETS.prepared.originalPath.replace(
    `/${ASSETS.prepared.ownerUid}/`,
    `/${USER_FIXTURES.player.uid}/`
  ),
]);

const CLEANUP_DOCUMENT_PATHS = Object.freeze([
  ...Object.values(USER_FIXTURES).map(({uid}) => `users/${uid}`),
  ...Object.values(ASSETS).map(({assetId}) => `media_assets/${assetId}`),
  HIDDEN_FIXTURES.cleanup,
  'media_assets/task07-rules-client-create',
  'media_asset_cleanup/task07-rules-client-create',
  ...Object.values(NPC_PATHS),
  `items/${ASSETS.item.manifest.entityId}`,
  'items/task07-rules-legacy-item',
  `foes/${ASSETS.foe.manifest.entityId}`,
  'foes/task07-rules-legacy-foe',
  `grigliata_backgrounds/${ASSETS.map.manifest.entityId}`,
  `grigliata_backgrounds/${ASSETS.mapVideo.manifest.entityId}`,
  `grigliata_backgrounds/${ASSETS.supersededMap.manifest.entityId}`,
  'grigliata_backgrounds/task07-rules-legacy-map',
  `grigliata_tokens/${USER_FIXTURES.player.uid}`,
  'grigliata_tokens/task07-rules-custom-media',
  `grigliata_token_placements/task07-rules-map__${USER_FIXTURES.player.uid}`,
]);

const CLEANUP_STORAGE_PATHS = Object.freeze([
  ...READY_ASSETS.map(({originalPath}) => originalPath),
  ASSETS.prepared.originalPath,
  ASSETS.prepared.variantPaths.thumbnail,
  ASSETS.npc.variantPaths.thumbnail,
  ASSETS.mapVideo.variantPaths.poster,
  ...WRONG_STORAGE_PATHS,
]);

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

    for (const {uid, role} of Object.values(USER_FIXTURES)) {
      await setDoc(doc(firestore, `users/${uid}`), {
        role,
        characterId: `${uid}-character`,
      });
    }

    for (const asset of Object.values(ASSETS)) {
      await setDoc(
        doc(firestore, `media_assets/${asset.assetId}`),
        {
          ...asset.manifest,
          ...(
            asset.manifest.state === 'prepared'
              ? {}
              : {media: mediaDescriptor(asset)}
          ),
        }
      );
    }

    await setDoc(doc(firestore, HIDDEN_FIXTURES.cleanup), {
      schemaVersion: 1,
      assetId: ASSETS.prepared.assetId,
      status: 'pending',
      paths: [ASSETS.prepared.originalPath],
    });

    for (const asset of READY_ASSETS) {
      await uploadString(
        ref(storage, asset.originalPath),
        `ready-${asset.kind}`,
        'raw',
        {
          contentType: asset.kind === 'map-video' ? 'video/mp4' : 'image/png',
          cacheControl: PRIVATE_CACHE_CONTROL,
        }
      );
    }
    await uploadString(
      ref(storage, ASSETS.mapVideo.variantPaths.poster),
      'ready-map-video-poster',
      'raw',
      {
        contentType: 'image/webp',
        cacheControl: PRIVATE_CACHE_CONTROL,
      }
    );
  });
});

after(async () => {
  if (!environment) return;

  await environment.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    const storage = context.storage();

    for (const objectPath of CLEANUP_STORAGE_PATHS) {
      await deleteObject(ref(storage, objectPath)).catch((error) => {
        if (error?.code !== 'storage/object-not-found') throw error;
      });
    }

    for (const documentPath of CLEANUP_DOCUMENT_PATHS) {
      await deleteDoc(doc(firestore, documentPath));
    }
  });

  await environment.cleanup();
});

test('Task 07 manifest and cleanup documents are server-only for every client', async () => {
  const contexts = [
    environment.unauthenticatedContext().firestore(),
    environment.authenticatedContext(USER_FIXTURES.player.uid).firestore(),
    environment.authenticatedContext(USER_FIXTURES.dm.uid).firestore(),
    environment.authenticatedContext(USER_FIXTURES.webmaster.uid).firestore(),
  ];

  for (const firestore of contexts) {
    await assertFails(getDoc(doc(firestore, HIDDEN_FIXTURES.mediaAsset)));
    await assertFails(getDocs(collection(firestore, 'media_assets')));
    await assertFails(setDoc(
      doc(firestore, 'media_assets/task07-rules-client-create'),
      {state: 'prepared'}
    ));
    await assertFails(updateDoc(
      doc(firestore, HIDDEN_FIXTURES.mediaAsset),
      {state: 'client-controlled'}
    ));
    await assertFails(deleteDoc(doc(firestore, HIDDEN_FIXTURES.mediaAsset)));

    await assertFails(getDoc(doc(firestore, HIDDEN_FIXTURES.cleanup)));
    await assertFails(getDocs(collection(firestore, 'media_asset_cleanup')));
    await assertFails(setDoc(
      doc(firestore, 'media_asset_cleanup/task07-rules-client-create'),
      {status: 'pending'}
    ));
    await assertFails(updateDoc(
      doc(firestore, HIDDEN_FIXTURES.cleanup),
      {status: 'complete'}
    ));
    await assertFails(deleteDoc(doc(firestore, HIDDEN_FIXTURES.cleanup)));
  }
});

test('canonical media create requires the prepared actor, exact plan, MIME, and metadata', async () => {
  const anonymous = environment.unauthenticatedContext().storage();
  const player = environment.authenticatedContext(
    USER_FIXTURES.player.uid
  ).storage();
  const dm = environment.authenticatedContext(USER_FIXTURES.dm.uid).storage();
  const webmaster = environment.authenticatedContext(
    USER_FIXTURES.webmaster.uid
  ).storage();
  const original = ref(dm, ASSETS.prepared.originalPath);
  const thumbnail = ref(dm, ASSETS.prepared.variantPaths.thumbnail);
  const originalMetadata = task07UploadMetadata(ASSETS.prepared, 'original');
  const thumbnailMetadata = task07UploadMetadata(
    ASSETS.prepared,
    'thumbnail'
  );

  await assertFails(uploadString(
    ref(anonymous, ASSETS.prepared.originalPath),
    'anonymous-source',
    'raw',
    originalMetadata
  ));
  await assertFails(uploadString(
    ref(player, ASSETS.prepared.originalPath),
    'wrong-actor-source',
    'raw',
    originalMetadata
  ));
  await assertFails(uploadString(
    ref(dm, WRONG_STORAGE_PATHS[0]),
    'wrong-original-path',
    'raw',
    originalMetadata
  ));
  await assertFails(uploadString(
    ref(dm, WRONG_STORAGE_PATHS[1]),
    'unplanned-variant',
    'raw',
    thumbnailMetadata
  ));
  await assertFails(uploadString(
    ref(dm, WRONG_STORAGE_PATHS[2]),
    'wrong-owner-segment',
    'raw',
    originalMetadata
  ));
  await assertFails(uploadString(
    original,
    'wrong-source-mime',
    'raw',
    {...originalMetadata, contentType: 'image/jpeg'}
  ));
  await assertFails(uploadString(
    original,
    'missing-custom-metadata',
    'raw',
    {
      contentType: 'image/png',
      cacheControl: PRIVATE_CACHE_CONTROL,
      contentDisposition: 'inline',
    }
  ));
  const invalidOriginalMetadata = [
    ['asset', {task07AssetId: ASSETS.avatar.assetId}],
    ['contract', {task07ContractVersion: '2'}],
    ['entity', {task07EntityId: 'other-entity'}],
    ['kind', {task07Kind: 'item'}],
    ['owner', {task07OwnerUid: USER_FIXTURES.player.uid}],
    ['role', {task07Role: 'card'}],
    ['extra', {unexpectedClientField: 'must-fail'}],
  ];
  for (const [label, customMetadataOverrides] of invalidOriginalMetadata) {
    await assertFails(uploadString(
      original,
      `wrong-${label}-metadata`,
      'raw',
      {
        ...originalMetadata,
        customMetadata: {
          ...originalMetadata.customMetadata,
          ...customMetadataOverrides,
        },
      }
    ));
  }
  await assertFails(uploadString(
    thumbnail,
    'wrong-variant-role',
    'raw',
    {
      ...thumbnailMetadata,
      customMetadata: {
        ...thumbnailMetadata.customMetadata,
        task07Role: 'card',
      },
    }
  ));

  await assertSucceeds(uploadString(
    original,
    'prepared-private-source',
    'raw',
    originalMetadata
  ));
  await assertSucceeds(uploadString(
    thumbnail,
    'prepared-private-thumbnail',
    'raw',
    thumbnailMetadata
  ));

  await assertFails(uploadString(
    original,
    'immutable-update',
    'raw',
    originalMetadata
  ));
  await assertFails(deleteObject(original));
  await assertFails(deleteObject(ref(webmaster, ASSETS.prepared.originalPath)));
  await assertFails(uploadString(
    ref(dm, ASSETS.npc.variantPaths.thumbnail),
    'ready-assets-cannot-grow',
    'raw',
    task07UploadMetadata(ASSETS.npc, 'thumbnail')
  ));
});

test('canonical storage reads enforce public, private-item, foe, and poster audiences', async () => {
  const anonymous = environment.unauthenticatedContext().storage();
  const owner = environment.authenticatedContext(
    USER_FIXTURES.player.uid
  ).storage();
  const peer = environment.authenticatedContext(
    USER_FIXTURES.peer.uid
  ).storage();
  const dm = environment.authenticatedContext(USER_FIXTURES.dm.uid).storage();
  const webmaster = environment.authenticatedContext(
    USER_FIXTURES.webmaster.uid
  ).storage();
  const signedIn = [owner, peer, dm, webmaster];

  for (const asset of [
    ASSETS.avatar,
    ASSETS.npc,
    ASSETS.map,
    ASSETS.mapVideo,
    ASSETS.item,
  ]) {
    await assertFails(getMetadata(ref(anonymous, asset.originalPath)));
    for (const storage of signedIn) {
      await assertSucceeds(getMetadata(ref(storage, asset.originalPath)));
    }
  }

  const posterPath = ASSETS.mapVideo.variantPaths.poster;
  await assertFails(getMetadata(ref(anonymous, posterPath)));
  for (const storage of signedIn) {
    await assertSucceeds(getMetadata(ref(storage, posterPath)));
  }

  const privateItemPath = ASSETS.privateItem.originalPath;
  await assertFails(getMetadata(ref(anonymous, privateItemPath)));
  await assertSucceeds(getMetadata(ref(owner, privateItemPath)));
  await assertFails(getMetadata(ref(peer, privateItemPath)));
  await assertSucceeds(getMetadata(ref(dm, privateItemPath)));
  await assertSucceeds(getMetadata(ref(webmaster, privateItemPath)));

  const foePath = ASSETS.foe.originalPath;
  await assertFails(getMetadata(ref(anonymous, foePath)));
  await assertFails(getMetadata(ref(owner, foePath)));
  await assertFails(getMetadata(ref(peer, foePath)));
  await assertSucceeds(getMetadata(ref(dm, foePath)));
  await assertFails(getMetadata(ref(webmaster, foePath)));
});

test('user avatar media is exact, owner-bound, removable, and legacy-compatible', async () => {
  const owner = environment.authenticatedContext(
    USER_FIXTURES.player.uid
  ).firestore();
  const profile = doc(owner, `users/${USER_FIXTURES.player.uid}`);
  const exactMedia = mediaDescriptor(ASSETS.avatar);

  await assertSucceeds(updateDoc(profile, {media: exactMedia}));
  await assertSucceeds(updateDoc(profile, {displayName: 'Preserves exact media'}));
  await assertFails(updateDoc(profile, {
    media: {
      ...exactMedia,
      original: {...exactMedia.original, generation: 'wrong'},
    },
  }));
  await assertFails(updateDoc(profile, {media: mediaDescriptor(ASSETS.npc)}));
  await assertFails(updateDoc(profile, {
    media: mediaDescriptor(ASSETS.avatarWrongReference),
  }));
  await assertFails(updateDoc(profile, {
    media: {
      schemaVersion: 1,
      assetId: ASSETS.avatar.assetId,
      original: {path: ASSETS.avatar.originalPath},
    },
  }));
  await assertFails(updateDoc(profile, {
    media: {schemaVersion: 2, assetId: 'legacy-avatar'},
  }));
  await assertSucceeds(updateDoc(profile, {media: deleteField()}));
  await assertSucceeds(updateDoc(profile, {media: null}));
  await assertSucceeds(updateDoc(profile, {media: deleteField()}));
});

test('character profile media is exact, owner-bound, globally readable, and never map-local', async () => {
  const anonymous = environment.unauthenticatedContext().firestore();
  const owner = environment.authenticatedContext(
    USER_FIXTURES.player.uid
  ).firestore();
  const peer = environment.authenticatedContext(
    USER_FIXTURES.peer.uid
  ).firestore();
  const exactMedia = mediaDescriptor(ASSETS.avatar);
  const profilePath = `grigliata_tokens/${USER_FIXTURES.player.uid}`;
  const placementPath = (
    `grigliata_token_placements/task07-rules-map__${USER_FIXTURES.player.uid}`
  );

  await assertSucceeds(setDoc(
    doc(owner, profilePath),
    characterTokenDocument(exactMedia)
  ));
  await assertSucceeds(setDoc(doc(owner, placementPath), {
    backgroundId: 'task07-rules-map',
    tokenId: USER_FIXTURES.player.uid,
    ownerUid: USER_FIXTURES.player.uid,
    label: 'Task 07 character token',
    imageUrl: '',
    col: 1,
    row: 1,
    isVisibleToPlayers: true,
    isDead: false,
    statuses: [],
    updatedAt: new Date('2026-07-25T00:01:00.000Z'),
    updatedBy: USER_FIXTURES.player.uid,
  }));

  await assertFails(getDoc(doc(anonymous, profilePath)));
  await assertSucceeds(getDoc(doc(peer, profilePath)));
  await assertSucceeds(getDocs(query(
    collection(peer, 'grigliata_tokens'),
    where(documentId(), 'in', [USER_FIXTURES.player.uid]),
    where('tokenType', '==', 'character')
  )));
  await assertFails(updateDoc(doc(peer, profilePath), {
    label: 'Peer cannot mutate another character profile',
    updatedAt: new Date('2026-07-25T00:02:00.000Z'),
    updatedBy: USER_FIXTURES.peer.uid,
  }));
  await assertSucceeds(updateDoc(doc(owner, profilePath), {
    label: 'Owner update preserves exact media',
    updatedAt: new Date('2026-07-25T00:03:00.000Z'),
    updatedBy: USER_FIXTURES.player.uid,
  }));
  await assertFails(updateDoc(doc(owner, profilePath), {
    media: {
      ...exactMedia,
      original: {
        ...exactMedia.original,
        generation: '999',
      },
    },
    updatedAt: new Date('2026-07-25T00:04:00.000Z'),
    updatedBy: USER_FIXTURES.player.uid,
  }));
  for (const invalidPlanAsset of [
    ASSETS.avatarWrongOwner,
    ASSETS.avatarWrongEntity,
    ASSETS.avatarWrongScope,
    ASSETS.avatarWrongReference,
  ]) {
    await assertFails(updateDoc(doc(owner, profilePath), {
      media: mediaDescriptor(invalidPlanAsset),
      updatedAt: new Date('2026-07-25T00:04:10.000Z'),
      updatedBy: USER_FIXTURES.player.uid,
    }));
  }
  await assertFails(updateDoc(doc(owner, profilePath), {
    media: {schemaVersion: 2, assetId: 'legacy-character-avatar'},
    updatedAt: new Date('2026-07-25T00:04:20.000Z'),
    updatedBy: USER_FIXTURES.player.uid,
  }));
  await assertFails(updateDoc(doc(owner, profilePath), {
    foeSourceId: 'foe-details-must-not-leak-through-character-queries',
    updatedAt: new Date('2026-07-25T00:04:30.000Z'),
    updatedBy: USER_FIXTURES.player.uid,
  }));
  await assertFails(updateDoc(doc(owner, placementPath), {
    media: exactMedia,
    updatedAt: new Date('2026-07-25T00:05:00.000Z'),
    updatedBy: USER_FIXTURES.player.uid,
  }));
  await assertFails(setDoc(
    doc(owner, 'grigliata_tokens/task07-rules-custom-media'),
    {
      ownerUid: USER_FIXTURES.player.uid,
      characterId: '',
      label: 'Custom media must remain outside Task 07 profile projection',
      imageUrl: '',
      imagePath: '',
      tokenType: 'custom',
      customTokenRole: 'template',
      customTemplateId: 'task07-rules-custom-media',
      imageSource: 'uploaded',
      media: exactMedia,
      notes: '',
      stats: {},
      updatedAt: new Date('2026-07-25T00:06:00.000Z'),
      updatedBy: USER_FIXTURES.player.uid,
    }
  ));
});

test('global item media binds nested General.media to its exact catalog plan', async () => {
  const player = environment.authenticatedContext(
    USER_FIXTURES.player.uid
  ).firestore();
  const dm = environment.authenticatedContext(USER_FIXTURES.dm.uid).firestore();
  const item = doc(dm, `items/${ASSETS.item.manifest.entityId}`);
  const exactMedia = mediaDescriptor(ASSETS.item);
  const replacementMedia = mediaDescriptor(ASSETS.itemReplacement, '8');

  await assertSucceeds(setDoc(
    doc(dm, 'items/task07-rules-legacy-item'),
    {General: {Nome: 'Legacy item', image_url: 'legacy.png'}}
  ));
  await assertFails(setDoc(doc(player, `items/${ASSETS.item.manifest.entityId}`), {
    General: {Nome: 'Player cannot write catalog media', media: exactMedia},
  }));
  await assertSucceeds(setDoc(item, {
    item_type: 'weapon',
    General: {Nome: 'Bound catalog item', media: exactMedia},
  }));
  await assertSucceeds(updateDoc(item, {catalogNote: 'Preserves exact media'}));
  await assertFails(updateDoc(item, {
    media: mediaDescriptor(ASSETS.privateItem),
  }));
  await assertFails(updateDoc(item, {
    media: {
      schemaVersion: 1,
      assetId: ASSETS.item.assetId,
      original: {path: ASSETS.item.originalPath},
    },
  }));
  await assertFails(updateDoc(item, {
    'General.media': {schemaVersion: 2, assetId: 'legacy-item-image'},
  }));
  await assertFails(updateDoc(item, {
    media: replacementMedia,
  }));
  await assertSucceeds(updateDoc(item, {
    media: exactMedia,
  }));
  await assertSucceeds(updateDoc(item, {
    'General.media': exactMedia,
  }));
  await assertSucceeds(updateDoc(item, {
    media: deleteField(),
    'General.media': deleteField(),
  }));
});

test('user-inventory media remains server-owned for owners and operators', async () => {
  const contexts = [
    environment.authenticatedContext(USER_FIXTURES.player.uid).firestore(),
    environment.authenticatedContext(USER_FIXTURES.dm.uid).firestore(),
    environment.authenticatedContext(USER_FIXTURES.webmaster.uid).firestore(),
  ];
  const inventoryPath = (
    `users/${USER_FIXTURES.player.uid}/inventory/`
    + ASSETS.privateItem.manifest.entityId
  );
  const exactMedia = mediaDescriptor(ASSETS.privateItem);

  for (const firestore of contexts) {
    await assertFails(setDoc(doc(firestore, inventoryPath), {
      item_type: 'weapon',
      General: {
        Nome: 'Server-owned private item',
        media: exactMedia,
      },
    }));
  }
});

test('foe media binds to the exact DM-only entity and permits removal or legacy data', async () => {
  const dm = environment.authenticatedContext(USER_FIXTURES.dm.uid).firestore();
  const webmaster = environment.authenticatedContext(
    USER_FIXTURES.webmaster.uid
  ).firestore();
  const foe = doc(dm, `foes/${ASSETS.foe.manifest.entityId}`);
  const exactMedia = mediaDescriptor(ASSETS.foe);

  await assertFails(setDoc(doc(webmaster, `foes/${ASSETS.foe.manifest.entityId}`), {
    name: 'Webmaster cannot create foes',
    media: exactMedia,
  }));
  await assertSucceeds(setDoc(foe, {name: 'Bound foe', media: exactMedia}));
  await assertSucceeds(updateDoc(foe, {rank: 'Preserves exact media'}));
  await assertFails(updateDoc(foe, {media: mediaDescriptor(ASSETS.map)}));
  await assertFails(updateDoc(foe, {
    media: {contractVersion: 1, original: {path: ASSETS.foe.originalPath}},
  }));
  await assertFails(updateDoc(foe, {
    media: {schemaVersion: 2, assetId: 'legacy-foe-image'},
  }));
  await assertSucceeds(updateDoc(foe, {media: deleteField()}));
  await assertSucceeds(setDoc(
    doc(dm, 'foes/task07-rules-legacy-foe'),
    {name: 'Legacy foe', imagePath: 'foes/legacy.png'}
  ));
});

test('map and map-video media bind exact references and reject stale states', async () => {
  const dm = environment.authenticatedContext(USER_FIXTURES.dm.uid).firestore();
  const webmaster = environment.authenticatedContext(
    USER_FIXTURES.webmaster.uid
  ).firestore();
  const map = doc(dm, `grigliata_backgrounds/${ASSETS.map.manifest.entityId}`);
  const video = doc(
    dm,
    `grigliata_backgrounds/${ASSETS.mapVideo.manifest.entityId}`
  );
  const exactMap = mediaDescriptor(ASSETS.map);
  const exactVideo = mediaDescriptor(ASSETS.mapVideo);

  await assertFails(setDoc(doc(
    webmaster,
    `grigliata_backgrounds/${ASSETS.map.manifest.entityId}`
  ), {name: 'Webmaster cannot manage maps', media: exactMap}));
  await assertSucceeds(setDoc(map, {
    name: 'Bound map',
    General: {media: exactMap},
  }));
  await assertSucceeds(updateDoc(map, {galleryFolderId: ''}));
  await assertSucceeds(setDoc(video, {
    name: 'Bound video',
    media: exactVideo,
  }));
  await assertFails(updateDoc(video, {media: exactMap}));
  await assertFails(setDoc(
    doc(dm, `grigliata_backgrounds/${ASSETS.supersededMap.manifest.entityId}`),
    {
      name: 'Superseded media cannot become a live reference',
      media: mediaDescriptor(ASSETS.supersededMap),
    }
  ));
  await assertFails(updateDoc(map, {
    'General.media': {schemaVersion: 2, assetId: 'legacy-map-image'},
  }));
  await assertSucceeds(updateDoc(map, {'General.media': deleteField()}));
  await assertSucceeds(setDoc(
    doc(dm, 'grigliata_backgrounds/task07-rules-legacy-map'),
    {name: 'Legacy map', imagePath: 'maps/legacy.png'}
  ));
});

test('NPC rules keep legacy documents valid and gate optional media mutations', async () => {
  const player = environment.authenticatedContext(
    USER_FIXTURES.player.uid
  ).firestore();
  const dm = environment.authenticatedContext(USER_FIXTURES.dm.uid).firestore();
  const webmaster = environment.authenticatedContext(
    USER_FIXTURES.webmaster.uid
  ).firestore();
  const legacyNpc = doc(dm, NPC_PATHS.legacy);
  const firstMedia = mediaDescriptor(ASSETS.npc);
  const replacementMedia = mediaDescriptor(ASSETS.npcReplacement);
  const mismatchedReplacementMedia = mediaDescriptor(ASSETS.npcReplacement, '8');
  const legacyNpcMedia = mediaDescriptor(ASSETS.npcLegacy);
  const mediaNpc = doc(webmaster, NPC_PATHS.withMedia);

  await assertSucceeds(setDoc(legacyNpc, npcDocument()));
  await assertSucceeds(setDoc(
    mediaNpc,
    npcDocument({
      nome: 'Task 07 media NPC',
      media: firstMedia,
      createdBy: USER_FIXTURES.webmaster.uid,
      createdByRole: 'webmaster',
    })
  ));
  await assertFails(setDoc(
    doc(player, NPC_PATHS.deniedCreate),
    npcDocument({createdBy: USER_FIXTURES.player.uid})
  ));

  await assertSucceeds(updateDoc(doc(player, NPC_PATHS.legacy), {
    description: 'Player text edit on the legacy schema',
    updatedAt: new Date('2026-07-25T00:01:00.000Z'),
  }));
  await assertFails(updateDoc(legacyNpc, {
    media: firstMedia,
    updatedAt: new Date('2026-07-25T00:01:30.000Z'),
  }));
  await assertFails(updateDoc(doc(player, NPC_PATHS.legacy), {
    media: legacyNpcMedia,
    updatedAt: new Date('2026-07-25T00:02:00.000Z'),
  }));
  await assertSucceeds(updateDoc(legacyNpc, {
    media: legacyNpcMedia,
    updatedAt: new Date('2026-07-25T00:03:00.000Z'),
  }));
  await assertSucceeds(updateDoc(doc(player, NPC_PATHS.legacy), {
    description: 'Player text edit preserves Task 07 media',
    updatedAt: new Date('2026-07-25T00:04:00.000Z'),
  }));
  await assertFails(updateDoc(doc(player, NPC_PATHS.withMedia), {
    media: replacementMedia,
    updatedAt: new Date('2026-07-25T00:05:00.000Z'),
  }));
  await assertFails(updateDoc(mediaNpc, {
    media: mismatchedReplacementMedia,
    updatedAt: new Date('2026-07-25T00:05:30.000Z'),
  }));
  await assertSucceeds(updateDoc(mediaNpc, {
    media: replacementMedia,
    updatedAt: new Date('2026-07-25T00:06:00.000Z'),
  }));
  await assertFails(updateDoc(mediaNpc, {
    media: firstMedia,
    General: {media: replacementMedia},
    updatedAt: new Date('2026-07-25T00:06:30.000Z'),
  }));
  await assertFails(updateDoc(mediaNpc, {
    media: {
      schemaVersion: 1,
      assetId: ASSETS.npc.assetId,
      original: {path: ASSETS.npc.originalPath},
    },
    updatedAt: new Date('2026-07-25T00:07:00.000Z'),
  }));
  await assertFails(updateDoc(mediaNpc, {
    media: {
      schemaVersion: 2,
      assetId: 'legacy-npc-image',
    },
    updatedAt: new Date('2026-07-25T00:07:30.000Z'),
  }));
  await assertSucceeds(updateDoc(mediaNpc, {
    media: deleteField(),
    updatedAt: new Date('2026-07-25T00:08:00.000Z'),
  }));
});
