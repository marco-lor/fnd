'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {createRequire} = require('node:module');

const {
  MIGRATION_CONCURRENCY,
  PRODUCTION_STORAGE_BUCKET,
  PLAN_VERSION,
  POLICY_HASH,
  REPORT_SCHEMA_VERSION,
  SOURCE_KEYS,
  approvedSourceFoeBackfillMatches,
  assertApprovedReport,
  assertCheckpoint,
  assertSafeTarget,
  buildCanonicalMediaAudit,
  backfillTargetFenceIssue,
  buildLegacyMediaBackfillPlan,
  buildLegacyMapBackfillMarker,
  buildNestedRollbackRegistry,
  buildReceiptOperationPlan,
  canonicalHash,
  collectMediaPaths,
  computePlanFingerprint,
  executeMigrationPlan,
  expandMediaRecords,
  isCanonicalTask07Path,
  loadLegacyMediaRecords,
  loadPaged,
  loadTask07AdminSdk,
  legacyMapRecoveryIssue,
  parseOptions,
  nestedMediaRecordsForRecord,
  nestedTargetBindingMatches,
  recordFromSnapshot,
  stagingActionForManifest,
  storagePathFromValue,
  validCanonicalAuditExclusion,
} = require('./media-derivative-backfill');

test('migration and compiled adapters share one Firebase Admin runtime', () => {
  const adapterRequire = createRequire(require.resolve(
    '../../functions/lib/mediaTargetAdapters.js'
  ));
  const migrationFirestore = loadTask07AdminSdk().firestore;
  const adapterFirestore = adapterRequire('firebase-admin/firestore');
  assert.equal(migrationFirestore, adapterFirestore);
  assert.equal(migrationFirestore.Timestamp, adapterFirestore.Timestamp);
  assert.equal(migrationFirestore.FieldValue, adapterFirestore.FieldValue);
});

const source = ({
  contentType = 'image/png',
  bytes = 1024,
  generation = '7',
  checksum = 'checksum-7',
} = {}) => ({
  exists: true,
  contentType,
  bytes,
  generation,
  checksum,
});

const activeOwner = (role = 'player') => ({
  exists: true,
  role,
  deletionState: '',
  version: '9:000000001',
});

const canonicalAuditFixture = () => {
  const assetId = `m_${'a'.repeat(40)}`;
  const ownerUid = 'dm-owner';
  const entityId = 'video-map';
  const sourceGeneration = '123';
  const descriptor = (role, overrides = {}) => {
    const path = `media_assets/v1/signed-in/${ownerUid}/${assetId}/` +
      `${sourceGeneration}/${role}`;
    return {
      path,
      contentType: role === 'original' ? 'video/mp4' : 'image/webp',
      bytes: role === 'original' ? 2048 : 512,
      width: role === 'original' ? 1920 : 384,
      height: role === 'original' ? 1080 : 216,
      durationMs: role === 'original' ? 12000 : null,
      orientationDegrees: 0,
      checksum: role === 'original' ? '1'.repeat(64) :
        role === 'poster' ? '2'.repeat(64) : '3'.repeat(64),
      role,
      generation: role === 'original' ? '501' :
        role === 'poster' ? '502' : '503',
      cacheControl: 'private, max-age=31536000, immutable',
      ...overrides,
    };
  };
  const original = descriptor('original');
  const poster = descriptor('poster');
  const poster2x = descriptor('poster2x', {width: 768, height: 432});
  const media = {
    schemaVersion: 1,
    contractVersion: 1,
    assetId,
    kind: 'map-video',
    state: 'ready',
    generation: sourceGeneration,
    audience: 'signed-in',
    ownerUid,
    original,
    variants: {poster, poster2x},
    processing: {authoritative: true, fallbackCode: null},
  };
  const plan = {
    schemaVersion: 1,
    contractVersion: 1,
    policyVersion: 1,
    assetId,
    kind: 'map-video',
    targetKind: 'grigliata-background',
    actorUid: ownerUid,
    ownerUid,
    ownerKey: ownerUid,
    entityId,
    commonTechnique: false,
    referenceScope: null,
    audienceScope: 'signed-in',
    previousAssetId: null,
    operationId: 'operation-video-map',
    sourceContentType: 'video/mp4',
    sourceBytes: original.bytes,
    sourcePath: `media_uploads/${ownerUid}/${assetId}/source`,
    requestHash: '4'.repeat(64),
  };
  const manifest = {
    schemaVersion: 1,
    policyVersion: 1,
    assetId,
    generation: sourceGeneration,
    state: 'attached',
    purpose: 'map-video',
    audience: 'signed-in',
    ownerUid,
    actorUid: ownerUid,
    targetKind: 'grigliata-background',
    targetId: entityId,
    previousAssetId: null,
    requestHash: plan.requestHash,
    plan,
    generated: {generation: sourceGeneration, original, variants: {
      poster,
      poster2x,
    }},
    attachment: {
      referencePath: `grigliata_backgrounds/${entityId}`,
      targetSlot: 'media',
      revision: 1,
    },
  };
  const compiled = require('../../functions/lib/mediaAssetLifecycleCore.js');
  const completePlan = compiled.buildTask07MediaUploadPlan({
    actorUid: ownerUid,
    ownerUid,
    entityId,
    operationId: plan.operationId,
    kind: 'map-video',
    sourceContentType: 'video/mp4',
    sourceBytes: original.bytes,
    commonTechnique: false,
  });
  const generatedAssetId = completePlan.assetId;
  [media, original, poster, poster2x].forEach((value) => {
    if (value.assetId) value.assetId = generatedAssetId;
  });
  for (const object of [original, poster, poster2x]) {
    object.path = object.path.replace(assetId, generatedAssetId);
  }
  manifest.assetId = generatedAssetId;
  manifest.plan = completePlan;
  manifest.requestHash = completePlan.requestHash;
  manifest.previousAssetId = completePlan.previousAssetId;
  media.assetId = generatedAssetId;
  const objectInspection = (object) => ({
    exists: true,
    path: object.path,
    contentType: object.contentType,
    bytes: object.bytes,
    generation: object.generation,
    checksum: 'gcs-checksum',
    sha256: object.checksum,
    cacheControl: object.cacheControl,
    contentDisposition: 'inline',
    customMetadata: {
      task07AssetId: generatedAssetId,
      task07ContractVersion: '1',
      task07EntityId: entityId,
      task07Kind: 'map-video',
      task07OwnerUid: ownerUid,
      task07Role: object.role,
      task07Checksum: object.checksum,
    },
  });
  return {
    record: {
      kind: 'map-video',
      ownerUid,
      entityId,
      targetPath: `grigliata_backgrounds/${entityId}`,
      targetVersion: '10:000000001',
      data: {
        assetType: 'video',
        contentType: 'video/mp4',
        media,
        task07MediaRevision: 1,
      },
    },
    inspection: {
      manifest: {
        exists: true,
        version: '11:000000002',
        data: manifest,
      },
      objects: [original, poster, poster2x].map(objectInspection),
      legacyObjects: [],
    },
  };
};

test('canonical audit includes canonical-only video and exact object bindings',
  async () => {
    const fixture = canonicalAuditFixture();
    const report = await buildCanonicalMediaAudit([fixture.record], {
      projectId: 'fatins',
      sourceKeys: ['backgrounds'],
      inspectCanonicalRecord: async () => fixture.inspection,
      readOwner: async () => activeOwner('dm'),
    });
    assert.equal(report.operation, 'canonical-audit');
    assert.equal(report.counts.candidates, 1);
    assert.equal(report.counts.errors, 0);
    assert.equal(report.entries[0].kind, 'map-video');
    assert.equal(report.entries[0].status, 'verified');
    assert.equal(report.entries[0].objectProofs.length, 3);
    assert.deepEqual(report.entries[0].objectProofs.map(
      ({validationErrors}) => validationErrors
    ), [[], [], []]);
    assert.equal(report.entries[0].legacySources.length, 0);
  });

test('canonical audit blocks missing immutable objects and legacy sources',
  async () => {
    const fixture = canonicalAuditFixture();
    fixture.record.data.imagePath = 'grigliata/backgrounds/dm-owner/old.mp4';
    fixture.inspection.objects[0] = {
      exists: false,
      path: fixture.inspection.objects[0].path,
    };
    fixture.inspection.legacyObjects = [{
      exists: false,
      path: fixture.record.data.imagePath,
    }];
    const report = await buildCanonicalMediaAudit([fixture.record], {
      sourceKeys: ['backgrounds'],
      inspectCanonicalRecord: async () => fixture.inspection,
      readOwner: async () => activeOwner('dm'),
    });
    assert.equal(report.counts.errors, 1);
    assert.ok(report.entries[0].issues.some(({code}) => (
      code === 'canonical-object-missing'
    )));
    assert.ok(report.entries[0].issues.some(({code}) => (
      code === 'legacy-source-object-missing'
    )));
  });

test('canonical audit mirrors root then General descriptor precedence',
  async () => {
    const fixture = canonicalAuditFixture();
    fixture.record.data.General = {media: fixture.record.data.media};
    delete fixture.record.data.media;
    const report = await buildCanonicalMediaAudit([fixture.record], {
      sourceKeys: ['backgrounds'],
      inspectCanonicalRecord: async () => fixture.inspection,
      readOwner: async () => activeOwner('dm'),
    });
    assert.equal(report.counts.candidates, 1);
    assert.equal(report.counts.errors, 0);
    assert.equal(report.entries[0].descriptorFingerprint,
      canonicalHash(fixture.record.data.General.media));
  });

test('canonical audit blocks conflicting image slots with error severity',
  async () => {
    const fixture = canonicalAuditFixture();
    fixture.record.data.General = {media: {
      ...fixture.record.data.media,
      assetId: `m_${'b'.repeat(40)}`,
    }};
    const report = await buildCanonicalMediaAudit([fixture.record], {
      sourceKeys: ['backgrounds'],
      inspectCanonicalRecord: async () => fixture.inspection,
      readOwner: async () => activeOwner('dm'),
    });
    assert.equal(report.counts.errors, 1);
    assert.deepEqual(report.entries[0].issues, [{
      code: 'canonical-descriptor-conflict',
      severity: 'error',
    }]);
  });

test('map-video audit follows videoMedia precedence and blocks malformed primary',
  async () => {
    const precedence = canonicalAuditFixture();
    precedence.record.data.videoMedia = {
      ...precedence.record.data.media,
      assetId: `m_${'b'.repeat(40)}`,
    };
    const precedenceReport = await buildCanonicalMediaAudit([
      precedence.record,
    ], {
      sourceKeys: ['backgrounds'],
      inspectCanonicalRecord: async () => precedence.inspection,
      readOwner: async () => activeOwner('dm'),
    });
    assert.equal(precedenceReport.counts.errors, 1);
    assert.equal(precedenceReport.entries[0].descriptorFingerprint,
      canonicalHash(precedence.record.data.videoMedia));
    assert.ok(precedenceReport.entries[0].issues.some(({code}) => (
      code === 'canonical-manifest-contract-mismatch'
    )));

    const malformed = canonicalAuditFixture();
    malformed.record.data.videoMedia = 'broken';
    const malformedReport = await buildCanonicalMediaAudit([
      malformed.record,
    ], {
      sourceKeys: ['backgrounds'],
      inspectCanonicalRecord: async () => malformed.inspection,
      readOwner: async () => activeOwner('dm'),
    });
    assert.equal(malformedReport.counts.errors, 1);
    assert.equal(malformedReport.entries[0].descriptorFingerprint,
      canonicalHash(malformed.record.data.media));
    assert.ok(malformedReport.entries[0].issues.some(({code, severity}) => (
      code === 'canonical-descriptor-malformed' && severity === 'error'
    )));
  });

test('canonical audit fails closed on malformed and external declarations',
  async () => {
    const malformed = canonicalAuditFixture();
    malformed.record.data.media = 'broken';
    const externalRecords = [];
    const addExternal = ({kind = 'map', root = true, field, value}) => {
      const fixture = canonicalAuditFixture();
      const entityId = `external-${externalRecords.length + 1}`;
      fixture.record.kind = kind;
      fixture.record.entityId = entityId;
      fixture.record.targetPath = `grigliata_backgrounds/${entityId}`;
      fixture.record.data = {
        assetType: kind === 'map-video' ? 'video' : 'image',
        contentType: kind === 'map-video' ? 'video/mp4' : 'image/png',
        task07MediaRevision: kind === 'map' ? 1 : undefined,
        task07VideoMediaRevision: kind === 'map-video' ? 1 : undefined,
        ...(root ? {[field]: value} : {General: {[field]: value}}),
      };
      externalRecords.push(fixture.record);
    };
    for (const root of [true, false]) {
      for (const field of ['url', 'downloadUrl', 'imageUrl', 'image_url']) {
        addExternal({root, field, value: `https://example.com/${field}.png`});
      }
      for (const field of [
        'url', 'downloadUrl', 'videoUrl', 'video_url', 'imageUrl', 'image_url',
      ]) {
        addExternal({
          kind: 'map-video',
          root,
          field,
          value: `https://example.com/${field}.mp4`,
        });
      }
    }
    addExternal({
      kind: 'map-video',
      root: false,
      field: 'videoMedia',
      value: {downloadUrl: 'https://example.com/nested-video.mp4'},
    });
    const report = await buildCanonicalMediaAudit([
      malformed.record,
      ...externalRecords,
    ], {
      sourceKeys: ['backgrounds'],
      inspectCanonicalRecord: async () => ({
        manifest: {exists: false, version: '', data: null},
        objects: [],
        legacyObjects: [],
      }),
      readOwner: async () => activeOwner('dm'),
    });
    assert.equal(report.counts.candidates, 22);
    assert.equal(report.counts.errors, 22);
    const codes = report.entries.map(({issues}) => (
      new Set(issues.map(({code}) => code))
    ));
    assert.ok(codes.some((entry) => (
      entry.has('canonical-descriptor-malformed') &&
      entry.has('canonical-descriptor-missing')
    )));
    assert.ok(codes.some((entry) => (
      entry.has('media-reference-unclassifiable')
    )));
    assert.equal(codes.filter((entry) => (
      entry.has('media-reference-unclassifiable')
    )).length, externalRecords.length);
  });

test('snapshot records retain every renderer-supported fallback declaration',
  () => {
    const snapshot = ({id, path, data, ownerUid = ''}) => ({
      id,
      data: () => data,
      updateTime: {seconds: 10, nanoseconds: 1},
      ref: {
        path,
        parent: {parent: ownerUid ? {id: ownerUid} : null},
      },
    });
    const avatar = recordFromSnapshot('avatars', snapshot({
      id: 'player-a',
      path: 'users/player-a',
      data: {General: {downloadUrl: 'https://example.test/avatar.png'}},
    }));
    const token = recordFromSnapshot('custom-token-templates', snapshot({
      id: 'token-a',
      path: 'grigliata_tokens/token-a',
      data: {
        ownerUid: 'player-a',
        tokenType: 'custom',
        customTemplateId: 'token-a',
        General: {url: 'https://example.test/token.png'},
      },
    }));
    const spellVideo = recordFromSnapshot('spell-video', snapshot({
      id: 'spell-a',
      path: 'users/player-a/spells/spell-a',
      ownerUid: 'player-a',
      data: {
        General: {
          videoMedia: {downloadUrl: 'https://example.test/spell.mp4'},
        },
      },
    }));
    const music = recordFromSnapshot('music-tracks', snapshot({
      id: 'track-a',
      path: 'grigliata_music_tracks/track-a',
      data: {
        createdBy: 'dm-a',
        General: {audioUrl: 'https://example.test/track.mp3'},
      },
    }));
    assert.equal(avatar.data.General.downloadUrl,
      'https://example.test/avatar.png');
    assert.equal(token.data.General.url, 'https://example.test/token.png');
    assert.equal(spellVideo.data.General.videoMedia.downloadUrl,
      'https://example.test/spell.mp4');
    assert.equal(music.data.General.audioUrl,
      'https://example.test/track.mp3');
  });

test('background snapshot classification fails closed on renderer video declarations',
  () => {
    const snapshot = (data, id = 'background-a') => ({
      id,
      data: () => data,
      updateTime: {seconds: 10, nanoseconds: 1},
      ref: {path: `grigliata_backgrounds/${id}`},
    });
    [
      {videoMedia: {assetId: 'bad'}},
      {General: {videoMedia: {assetId: 'bad'}}},
      {General: {videoUrl: 'https://example.test/video.mp4'}},
      {General: {url: 'https://example.test/video.mp4'}},
    ].forEach((data, index) => {
      assert.equal(
        recordFromSnapshot('backgrounds', snapshot(data, `background-${index}`)).kind,
        'map-video'
      );
    });
    assert.equal(recordFromSnapshot('backgrounds', snapshot({
      General: {imageUrl: 'https://example.test/image.png'},
    }, 'image')).kind, 'map');
  });

test('personal video audit catches generic General fallback without art media',
  async () => {
    const record = {
      kind: 'spell-video',
      sourceKey: 'spell-video',
      ownerUid: 'player-a',
      entityId: 'spell-a',
      targetPath: 'users/player-a/spells/spell-a',
      targetVersion: '10:000000001',
      data: {
        General: {downloadUrl: 'https://example.test/spell.mp4'},
        task07VideoMediaRevision: 1,
      },
    };
    const report = await buildCanonicalMediaAudit([record], {
      sourceKeys: ['spell-video'],
      inspectCanonicalRecord: async () => ({
        manifest: {exists: false, version: '', data: null},
        objects: [],
        legacyObjects: [],
      }),
      readOwner: async () => activeOwner('player'),
    });
    assert.equal(report.counts.candidates, 1);
    assert.equal(report.counts.errors, 1);
    assert.ok(report.entries[0].issues.some(({code}) => (
      code === 'media-reference-unclassifiable'
    )));
  });

test('canonical audit enforces media budgets, checksums, and private metadata',
  async () => {
    const fixture = canonicalAuditFixture();
    const original = fixture.record.data.media.original;
    original.contentType = 'text/plain';
    original.bytes = 999999999;
    original.checksum = '';
    const inspected = fixture.inspection.objects[0];
    inspected.contentType = original.contentType;
    inspected.bytes = original.bytes;
    inspected.customMetadata.task07Checksum = original.checksum;
    inspected.customMetadata.firebaseStorageDownloadTokens = 'public-token';
    const report = await buildCanonicalMediaAudit([fixture.record], {
      sourceKeys: ['backgrounds'],
      inspectCanonicalRecord: async () => fixture.inspection,
      readOwner: async () => activeOwner('dm'),
    });
    assert.equal(report.counts.errors, 1);
    const codes = new Set(report.entries[0].issues.map(({code}) => code));
    assert.ok(codes.has('canonical-object-policy-mismatch'));
    assert.ok(codes.has('canonical-original-policy-mismatch'));
    assert.ok(codes.has('canonical-object-contract-mismatch'));
    assert.equal(report.entries[0].objectProofs[0].verified, false);
  });

test('canonical audit rejects bytes whose independent SHA-256 mismatches',
  async () => {
    const fixture = canonicalAuditFixture();
    fixture.inspection.objects[0].sha256 = 'f'.repeat(64);
    const report = await buildCanonicalMediaAudit([fixture.record], {
      sourceKeys: ['backgrounds'],
      inspectCanonicalRecord: async () => fixture.inspection,
      readOwner: async () => activeOwner('dm'),
    });
    assert.equal(report.counts.errors, 1);
    assert.ok(report.entries[0].issues.some(({code}) => (
      code === 'canonical-object-checksum-mismatch'
    )));
    assert.equal(report.entries[0].objectProofs[0].verified, false);
  });

test('canonical audit rejects incomplete or internally drifted stored plans',
  async () => {
    const mutations = [
      (fixture) => {
        fixture.inspection.manifest.data.plan.requestHash = '9'.repeat(64);
      },
      (fixture) => {
        fixture.inspection.manifest.data.plan.sourcePath = 'wrong/source';
      },
      (fixture) => {
        fixture.inspection.manifest.data.plan.actorUid = 'other-manager';
      },
      (fixture) => {
        fixture.inspection.manifest.data.plan.previousAssetId =
          `m_${'d'.repeat(40)}`;
      },
      (fixture) => {
        fixture.inspection.manifest.data.generation = '999';
      },
    ];
    for (const mutate of mutations) {
      const fixture = canonicalAuditFixture();
      mutate(fixture);
      const report = await buildCanonicalMediaAudit([fixture.record], {
        sourceKeys: ['backgrounds'],
        inspectCanonicalRecord: async () => fixture.inspection,
        readOwner: async () => activeOwner('dm'),
      });
      assert.equal(report.counts.errors, 1);
      assert.ok(report.entries[0].issues.some(({code}) => (
        code === 'canonical-manifest-contract-mismatch'
      )));
    }
  });

test('canonical audit derives personal ownership from the target path',
  async () => {
    const fixture = canonicalAuditFixture();
    const targetOwnerUid = 'player-a';
    const claimedOwnerUid = 'player-b';
    const media = fixture.record.data.media;
    fixture.record.kind = 'spell-video';
    fixture.record.sourceKey = 'spell-video';
    fixture.record.ownerUid = claimedOwnerUid;
    fixture.record.targetPath =
      `users/${targetOwnerUid}/spells/${fixture.record.entityId}`;
    fixture.record.data = {
      videoMedia: media,
      media: {
        schemaVersion: 1,
        assetId: `m_${'f'.repeat(40)}`,
        kind: 'spell',
        state: 'ready',
      },
      task07VideoMediaRevision: 1,
    };
    media.kind = 'spell-video';
    media.audience = 'owner-manager';
    media.ownerUid = claimedOwnerUid;
    const generatedObjects = [
      media.original,
      ...Object.values(media.variants),
    ];
    generatedObjects.forEach((object) => {
      object.path = object.path.replace(
        '/signed-in/dm-owner/',
        `/owner-manager/${claimedOwnerUid}/`
      );
    });
    const manifest = fixture.inspection.manifest.data;
    manifest.purpose = 'spell-video';
    manifest.audience = 'owner-manager';
    manifest.ownerUid = claimedOwnerUid;
    manifest.targetKind = 'user-spell';
    manifest.attachment.referencePath = fixture.record.targetPath;
    manifest.attachment.targetSlot = 'videoMedia';
    Object.assign(manifest.plan, {
      kind: 'spell-video',
      targetKind: 'user-spell',
      actorUid: claimedOwnerUid,
      ownerUid: claimedOwnerUid,
      ownerKey: claimedOwnerUid,
      audienceScope: 'owner-manager',
    });
    fixture.inspection.objects.forEach((object, index) => {
      object.path = generatedObjects[index].path;
      Object.assign(object.customMetadata, {
        task07Kind: 'spell-video',
        task07OwnerUid: claimedOwnerUid,
      });
    });
    const report = await buildCanonicalMediaAudit([fixture.record], {
      sourceKeys: ['spell-video'],
      inspectCanonicalRecord: async () => fixture.inspection,
      readOwner: async (ownerUid) => ({
        ...activeOwner('player'),
        ownerUid,
      }),
    });
    assert.equal(report.counts.errors, 1);
    assert.equal(report.entries[0].ownerUid, targetOwnerUid);
    const codes = new Set(report.entries[0].issues.map(({code}) => code));
    assert.ok(codes.has('canonical-owner-target-mismatch'));
    assert.ok(codes.has('canonical-owner-binding-mismatch'));
    assert.equal(codes.has('canonical-descriptor-conflict'), false);
  });

test('canonical audit follows the current attached manager for global media',
  async () => {
    const fixture = canonicalAuditFixture();
    fixture.record.ownerUid = 'former-manager';
    const report = await buildCanonicalMediaAudit([fixture.record], {
      sourceKeys: ['backgrounds'],
      inspectCanonicalRecord: async () => fixture.inspection,
      readOwner: async (uid) => uid === 'dm-owner' ?
        activeOwner('dm') : null,
    });
    assert.equal(report.counts.errors, 0);
    assert.equal(report.entries[0].ownerUid, 'dm-owner');
    assert.equal(report.entries[0].ownerResolution, 'attached-manifest');
  });

test('canonical audit preserves hashed non-rendering foe-root exclusions',
  async () => {
    const record = {
      kind: 'token',
      sourceKey: 'foe-tokens',
      tokenMigrationClass: 'foe',
      ownerUid: 'dm-owner',
      entityId: 'unplaced-foe',
      targetPath: 'grigliata_tokens/unplaced-foe',
      targetVersion: '12:000000003',
      placementReferenceCount: 0,
      placementReferenceHash: canonicalHash([]),
      sourceFoeProof: {
        scanned: true,
        exists: true,
        referencePath: 'foes/source-foe',
        dataFingerprint: '5'.repeat(64),
      },
      data: {
        foeSourceId: 'source-foe',
        imagePath: 'foes/unplaced.png',
      },
    };
    const report = await buildCanonicalMediaAudit([record], {
      sourceKeys: ['foe-tokens'],
      inspectCanonicalRecord: async () => {
        throw new Error('non-rendering exclusion must not be inspected');
      },
    });
    assert.equal(report.counts.candidates, 0);
    assert.equal(report.counts.excluded, 1);
    assert.equal(validCanonicalAuditExclusion(report.excluded[0]), true);
  });

test('legacy map recovery marker is plan-bound and one-shot', () => {
  const entry = {
    receiptId: `r_${'1'.repeat(40)}`,
    subjectHash: '2'.repeat(64),
    assetId: `m_${'3'.repeat(40)}`,
    ownerUid: 'manager-a',
    entityId: 'map-a',
    targetPath: 'grigliata_backgrounds/map-a',
    sourceKey: 'backgrounds',
    kind: 'map',
    sourcePath: 'grigliata/backgrounds/manager-a/map.jpg',
    sourceGeneration: '7',
    sourceFingerprint: '4'.repeat(64),
  };
  const binding = {planFingerprint: '5'.repeat(64)};
  const plan = {
    assetId: entry.assetId,
    actorUid: entry.ownerUid,
    requestHash: '6'.repeat(64),
    kind: 'map',
  };
  const marker = buildLegacyMapBackfillMarker(entry, binding, plan);
  assert.deepEqual(marker, {
    schemaVersion: 1,
    kind: 'legacy-map-backfill',
    reportSchemaVersion: REPORT_SCHEMA_VERSION,
    planVersion: PLAN_VERSION,
    policyVersion: 1,
    policyHash: POLICY_HASH,
    receiptId: entry.receiptId,
    subjectHash: entry.subjectHash,
    approvedPlanFingerprint: binding.planFingerprint,
    assetId: entry.assetId,
    requestHash: plan.requestHash,
    ownerUid: entry.ownerUid,
    entityId: entry.entityId,
    targetPath: entry.targetPath,
    sourcePath: entry.sourcePath,
    sourceGeneration: entry.sourceGeneration,
    sourceFingerprint: entry.sourceFingerprint,
  });
  assert.equal(buildLegacyMapBackfillMarker(
    {...entry, kind: 'avatar', sourceKey: 'avatars'},
    binding,
    plan
  ), null);

  const receipt = {state: 'intent'};
  const manifest = {
    state: 'deleted',
    assetId: marker.assetId,
    requestHash: plan.requestHash,
    actorUid: marker.ownerUid,
    plan,
    attachment: null,
    error: {code: 'source-image-decode-failed', retryable: false},
  };
  const cleanup = {
    state: 'complete',
    assetId: marker.assetId,
    reason: manifest.error.code,
  };
  const issue = (overrides = {}) => legacyMapRecoveryIssue({
    receipt,
    manifest,
    cleanup,
    marker,
    plan,
    ...overrides,
  });
  assert.equal(issue(), null);
  assert.equal(issue({receipt: {
    ...receipt,
    legacyBackfill: {...marker, sourceFingerprint: '7'.repeat(64)},
  }}), 'receipt-marker-mismatch');
  assert.equal(issue({receipt: {
    ...receipt,
    legacyMapRecoveryAttempts: 1,
  }}), 'recovery-already-attempted');
  assert.equal(issue({manifest: {
    ...manifest,
    error: {code: 'processor-internal-failure', retryable: false},
  }}), 'manifest-error-not-recoverable');
  assert.equal(issue({cleanup: {...cleanup, state: 'pending'}}),
    'cleanup-not-complete');
  assert.equal(issue({manifest: {...manifest, generated: {}}}),
    'manifest-binding-mismatch');
});

test('source foe proof accepts only exact approved backfill reconstruction', () => {
  const sourceReceiptId = `r_${'a'.repeat(40)}`;
  const assetId = `m_${'b'.repeat(40)}`;
  const planFingerprint = 'c'.repeat(64);
  const original = {
    name: 'Foe',
    stats: {hp: 20},
    imagePath: 'foes/foe.png',
    imageUrl: '',
  };
  const compatibilityFields = [
    'media', 'imagePath', 'imageUrl', 'imageWidth', 'imageHeight',
    'contentType', 'sizeBytes', 'assetType', 'durationMs',
    'audioPath', 'audioUrl',
  ];
  const beforeFields = Object.fromEntries(compatibilityFields.map((field) => [
    field,
    Object.prototype.hasOwnProperty.call(original, field) ?
      {exists: true, value: original[field]} : {exists: false},
  ]));
  const current = {
    ...original,
    media: {assetId},
    task07MediaRevision: 1,
    mediaUpdatedAt: {seconds: 1, nanoseconds: 2},
  };
  const expectedProof = {
    scanned: true,
    referencePath: 'foes/source-foe',
    exists: true,
    version: '1:000000001',
    dataFingerprint: canonicalHash(original),
  };
  const receipt = {
    receiptId: sourceReceiptId,
    schemaVersion: REPORT_SCHEMA_VERSION,
    planVersion: PLAN_VERSION,
    policyVersion: 1,
    policyHash: POLICY_HASH,
    approvedPlanFingerprint: planFingerprint,
    state: 'attached',
    sourceKey: 'foes',
    kind: 'foe',
    commonTechnique: false,
    targetPath: expectedProof.referencePath,
    entityId: 'source-foe',
    previousAssetId: null,
    assetId,
    attachedRevision: 1,
    beforeFields,
  };
  const manifest = {
    assetId,
    state: 'attached',
    attachment: {
      referencePath: expectedProof.referencePath,
      targetSlot: 'media',
    },
    plan: {kind: 'foe', entityId: receipt.entityId},
  };
  const matches = (overrides = {}) => approvedSourceFoeBackfillMatches({
    currentData: current,
    expectedProof,
    receipt,
    manifest,
    sourceReceiptId,
    planFingerprint,
    ...overrides,
  });
  assert.equal(matches(), true);
  assert.equal(matches({currentData: {
    ...current,
    stats: {hp: 19},
  }}), false);
  assert.equal(matches({receipt: {
    ...receipt,
    approvedPlanFingerprint: 'd'.repeat(64),
  }}), false);
  const incompleteBefore = {...beforeFields};
  delete incompleteBefore.imagePath;
  assert.equal(matches({receipt: {
    ...receipt,
    beforeFields: incompleteBefore,
  }}), false);
  assert.equal(matches({
    currentData: current,
    expectedProof: {
      ...expectedProof,
      dataFingerprint: canonicalHash({...original, image_url: 'legacy'}),
    },
  }), false);
});

const avatarRecord = (id, imagePath = `characters/${id}.png`) => ({
  kind: 'avatar',
  ownerUid: id,
  entityId: id,
  targetPath: `users/${id}`,
  targetVersion: `10:00000000${id.length}`,
  data: {imagePath},
});

const liveArgs = ({uid = 'test-webmaster-uid', extra = []} = {}) => [
  '--project', 'fatins',
  '--auth', 'firebase-cli',
  '--allow-live-project',
  '--confirm-project', 'fatins',
  '--catalog-owner-uid', uid,
  '--confirm-catalog-owner-uid', uid,
  ...SOURCE_KEYS.flatMap((sourceKey) => ['--source', sourceKey]),
  ...extra,
];

const planFor = async (records, overrides = {}) => (
  buildLegacyMediaBackfillPlan(records, {
    readSourceObject: async () => source(),
    readOwner: async () => activeOwner(),
    scan: {
      complete: true,
      pageSize: 2,
      maxPages: 5,
      concurrency: 1,
      pagesBySource: {fixtures: 1},
      truncatedSources: [],
    },
    ...overrides,
  })
);

const executionOptions = (report, overrides = {}) => {
  if (report.expectedCandidates === null) {
    report.expectedCandidates = report.counts.candidates;
    report.planFingerprint = computePlanFingerprint(report);
  }
  return {
    projectId: 'demo-fnd-perf',
    operation: report.operation,
    execute: true,
    approveFingerprint: report.planFingerprint,
    sourceKeys: report.sourceKeys,
    catalogOwnerUid: report.catalogOwnerUid,
    expectedCandidates: report.expectedCandidates,
    pollTimeoutMs: 1000,
    ...overrides,
  };
};

test('nested catalog extraction does not invent video from an image alias',
  async () => {
    const record = {
      kind: 'item',
      sourceKey: 'catalog-items',
      ownerUid: '',
      entityId: 'chain',
      referenceScope: 'global-catalog',
      targetPath: 'items/chain',
      targetVersion: '41:000000001',
      data: {
        General: {
          spells: {
            Grab: {image_url: 'spells/grab.webp'},
          },
        },
      },
    };
    const nested = nestedMediaRecordsForRecord(record);
    assert.equal(nested.length, 1);
    assert.equal(nested[0].kind, 'spell');
    assert.equal(nested[0].nestedTarget.slot, 'media');
    const report = await planFor(expandMediaRecords(record), {
      catalogOwnerUid: 'verified-webmaster',
      readOwner: async () => activeOwner('webmaster'),
    });
    assert.equal(report.counts.executable, 1);
    assert.equal(report.counts.errors, 0);
    assert.equal(report.entries[0].sourcePath, 'spells/grab.webp');
    assert.equal(report.entries[0].targetKind, 'catalog-item-spell');
  });

test('nested catalog extraction keeps art and explicit video independent', () => {
  const nested = nestedMediaRecordsForRecord({
    kind: 'item',
    sourceKey: 'catalog-items',
    entityId: 'wand',
    targetPath: 'items/wand',
    data: {
      General: {
        spells: {
          Spark: {
            image_url: 'spells/spark.webp',
            video_url: 'spells/spark.mp4',
          },
        },
      },
    },
  });
  assert.deepEqual(nested.map(({kind}) => kind), ['spell', 'spell-video']);
  assert.equal(nested[0].nestedTarget.entryId,
    nested[1].nestedTarget.entryId);
  assert.deepEqual(nested.map(({nestedTarget}) => nestedTarget.slot),
    ['media', 'videoMedia']);
});

test('nested catalog video discovery mirrors generic renderer URL fields',
  async () => {
    const videoPath = 'spells/spark-generic.mp4';
    const record = {
      kind: 'item',
      sourceKey: 'catalog-items',
      ownerUid: '',
      entityId: 'generic-video-wand',
      referenceScope: 'global-catalog',
      targetPath: 'items/generic-video-wand',
      targetVersion: '42:000000001',
      data: {
        General: {spells: {Spark: {General: {url: videoPath}}}},
      },
    };
    const nested = nestedMediaRecordsForRecord(record);
    assert.deepEqual(nested.map(({kind}) => kind), ['spell', 'spell-video']);
    const videoRecord = nested.find(({kind}) => kind === 'spell-video');
    const report = await planFor([videoRecord], {
      catalogOwnerUid: 'verified-webmaster',
      readOwner: async () => activeOwner('webmaster'),
      readSourceObject: async () => source({contentType: 'video/mp4'}),
    });
    assert.equal(report.counts.executable, 1);
    assert.equal(report.entries[0].sourcePath, videoPath);

    const downloadRecord = {
      ...record,
      entityId: 'generic-download-video-wand',
      targetPath: 'items/generic-download-video-wand',
      data: {General: {spells: {Spark: {
        downloadUrl: 'spells/spark-download.webm',
      }}}},
    };
    assert.ok(nestedMediaRecordsForRecord(downloadRecord)
      .some(({kind}) => kind === 'spell-video'));
  });

test('nested audit rejects entry IDs reused across foe media kinds',
  async () => {
    const sharedEntryId = 'shared-entry';
    const record = {
      kind: 'foe',
      sourceKey: 'foes',
      ownerUid: 'dm-owner',
      entityId: 'malformed-foe',
      targetPath: 'foes/malformed-foe',
      targetVersion: '45:000000001',
      data: {
        tecniche: [{
          name: 'Technique',
          imagePath: 'foes/tecniche/technique.webp',
          task07MediaEntryId: sharedEntryId,
        }],
        spells: [{
          name: 'Spell',
          imagePath: 'foes/spells/spell.webp',
          task07MediaEntryId: sharedEntryId,
        }],
        task07EmbeddedMedia: {
          [sharedEntryId]: {
            targetKind: 'foe-technique',
            media: {
              schemaVersion: 1,
              assetId: `m_${'a'.repeat(40)}`,
              kind: 'foe',
              state: 'ready',
            },
            task07MediaRevision: 1,
          },
        },
      },
    };
    const report = await buildCanonicalMediaAudit(expandMediaRecords(record), {
      sourceKeys: ['foes'],
      inspectCanonicalRecord: async () => ({
        manifest: {exists: false, version: '', data: null},
        objects: [],
        legacyObjects: [],
      }),
      readOwner: async () => activeOwner('dm'),
    });
    assert.equal(report.counts.candidates, 2);
    assert.equal(report.counts.errors, 2);
    assert.deepEqual(new Set(report.entries.map(
      ({nestedTarget}) => nestedTarget.kind
    )), new Set(['foe-technique', 'foe-spell']));
    report.entries.forEach(({issues}) => {
      assert.ok(issues.some(({code}) => (
        code === 'canonical-nested-target-conflict'
      )));
    });
    assert.ok(report.entries.find(({nestedTarget}) => (
      nestedTarget.kind === 'foe-spell'
    )).issues.some(({code}) => (
      code === 'canonical-nested-binding-kind-mismatch'
    )));
  });

test('nested discovery includes registry-only canonical catalog and foe media',
  () => {
    const asset = (character) => ({
      schemaVersion: 1,
      assetId: `m_${character.repeat(40)}`,
      kind: 'foe',
      state: 'ready',
    });
    const catalog = nestedMediaRecordsForRecord({
      kind: 'item',
      sourceKey: 'catalog-items',
      entityId: 'registry-item',
      referenceScope: 'global-catalog',
      data: {
        General: {spells: {Shield: {
          Nome: 'Shield',
          task07MediaEntryId: 'catalog-registry-entry',
        }}},
        task07EmbeddedMedia: {
          'catalog-registry-entry': {
            targetKind: 'catalog-item-spell',
            media: {...asset('a'), kind: 'spell'},
            videoMedia: {...asset('b'), kind: 'spell-video'},
          },
        },
      },
    });
    assert.deepEqual(catalog.map(({kind}) => kind), ['spell', 'spell-video']);

    const foe = nestedMediaRecordsForRecord({
      kind: 'foe',
      sourceKey: 'foes',
      entityId: 'registry-foe',
      data: {
        tecniche: [{
          name: 'Slash',
          task07MediaEntryId: 'foe-registry-entry',
        }],
        task07EmbeddedMedia: {
          'foe-registry-entry': {
            targetKind: 'foe-technique',
            media: asset('c'),
          },
        },
      },
    });
    assert.equal(foe.length, 1);
    assert.equal(foe[0].nestedTarget.kind, 'foe-technique');
  });

test('nested discovery emits registry-only wrong-kind bindings for fail-closed audit',
  async () => {
    const asset = {
      schemaVersion: 1,
      assetId: `m_${'d'.repeat(40)}`,
      kind: 'foe',
      state: 'ready',
    };
    const catalogRecord = {
      kind: 'item',
      sourceKey: 'catalog-items',
      referenceScope: 'global-catalog',
      ownerUid: 'dm-owner',
      entityId: 'catalog-wrong-kind',
      targetPath: 'items/catalog-wrong-kind',
      targetVersion: '10:000000001',
      data: {
        General: {spells: {Entry: {task07MediaEntryId: 'entry'}}},
        task07EmbeddedMedia: {
          entry: {targetKind: 'foe-spell', media: asset},
        },
      },
    };
    const foeRecord = {
      kind: 'foe',
      sourceKey: 'foes',
      ownerUid: 'dm-owner',
      entityId: 'foe-wrong-kind',
      targetPath: 'foes/foe-wrong-kind',
      targetVersion: '10:000000001',
      data: {
        spells: [{task07MediaEntryId: 'entry'}],
        task07EmbeddedMedia: {
          entry: {targetKind: 'foe-technique', media: asset},
        },
      },
    };
    const records = [
      ...expandMediaRecords(catalogRecord),
      ...expandMediaRecords(foeRecord),
    ];
    const report = await buildCanonicalMediaAudit(records, {
      sourceKeys: ['catalog-items', 'foes'],
      catalogOwnerUid: 'dm-owner',
      inspectCanonicalRecord: async () => ({
        manifest: {exists: false, version: '', data: null},
        objects: [],
        legacyObjects: [],
      }),
      readOwner: async () => activeOwner('dm'),
    });
    const nestedEntries = report.entries.filter(({nestedTarget}) => nestedTarget);
    assert.equal(nestedEntries.length, 2);
    nestedEntries.forEach(({issues}) => assert.ok(issues.some(({code}) => (
      code === 'canonical-nested-binding-kind-mismatch'
    ))));
  });

test('nested audit fails closed on direct descriptors outside the registry',
  async () => {
    const direct = {
      schemaVersion: 1,
      assetId: `m_${'d'.repeat(40)}`,
      kind: 'spell',
      state: 'ready',
    };
    const catalogRoot = {
      kind: 'item',
      sourceKey: 'catalog-items',
      entityId: 'direct-catalog-media',
      referenceScope: 'global-catalog',
      targetPath: 'items/direct-catalog-media',
      targetVersion: '46:000000001',
      data: {General: {spells: {Spark: {General: {media: direct}}}}},
    };
    const foeRoot = {
      kind: 'foe',
      sourceKey: 'foes',
      ownerUid: 'dm-owner',
      entityId: 'direct-foe-media',
      targetPath: 'foes/direct-foe-media',
      targetVersion: '47:000000001',
      data: {spells: [{name: 'Spark', media: {...direct, kind: 'foe'}}]},
    };
    const records = [catalogRoot, foeRoot].flatMap(expandMediaRecords);
    const nested = records.filter(({nestedTarget}) => nestedTarget);
    assert.equal(nested.length, 2);
    const report = await buildCanonicalMediaAudit(records, {
      sourceKeys: ['catalog-items', 'foes'],
      catalogOwnerUid: 'verified-webmaster',
      inspectCanonicalRecord: async () => ({
        manifest: {exists: false, version: '', data: null},
        objects: [],
        legacyObjects: [],
      }),
      readOwner: async (uid) => activeOwner(
        uid === 'verified-webmaster' ? 'webmaster' : 'dm'
      ),
    });
    assert.equal(report.counts.candidates, 2);
    assert.equal(report.counts.errors, 2);
    report.entries.forEach(({issues}) => assert.ok(issues.some(({code}) => (
      code === 'canonical-descriptor-missing'
    ))));
  });

test('nested audit identity survives catalog rename and foe reorder locators', () => {
  const stored = {
    schemaVersion: 1,
    kind: 'catalog-item-spell',
    entryId: 'stable-spell',
    entryKey: 'Old name',
    entryIndex: null,
    slot: 'media',
  };
  assert.equal(nestedTargetBindingMatches(stored, {
    ...stored,
    entryKey: 'Renamed spell',
  }), true);
  assert.equal(nestedTargetBindingMatches({
    schemaVersion: 1,
    kind: 'foe-technique',
    entryId: 'stable-technique',
    entryKey: null,
    entryIndex: 0,
    slot: 'media',
  }, {
    schemaVersion: 1,
    kind: 'foe-technique',
    entryId: 'stable-technique',
    entryKey: null,
    entryIndex: 3,
    slot: 'media',
  }), true);
  assert.equal(nestedTargetBindingMatches(stored, {
    ...stored,
    entryId: 'different-spell',
  }), false);
});

test('nested rollback restores only the reviewed catalog or foe binding', () => {
  const catalogTarget = {
    task07EmbeddedMedia: {
      spellA: {
        targetKind: 'catalog-item-spell',
        media: {assetId: `m_${'a'.repeat(40)}`},
        task07MediaRevision: 4,
      },
      untouched: {targetKind: 'catalog-item-spell', marker: true},
    },
  };
  const restoredCatalog = buildNestedRollbackRegistry({
    current: catalogTarget,
    nestedTarget: {
      kind: 'catalog-item-spell', entryId: 'spellA', slot: 'media',
    },
    beforeFields: {media: {exists: false}},
    revision: 5,
    timestamp: 'catalog-time',
  });
  assert.equal(restoredCatalog.spellA.media, undefined);
  assert.equal(restoredCatalog.spellA.task07MediaRevision, 5);
  assert.equal(restoredCatalog.spellA.mediaUpdatedAt, 'catalog-time');
  assert.deepEqual(restoredCatalog.untouched,
    catalogTarget.task07EmbeddedMedia.untouched);

  const previous = {assetId: `m_${'b'.repeat(40)}`};
  const restoredFoe = buildNestedRollbackRegistry({
    current: {task07EmbeddedMedia: {
      techniqueA: {
        targetKind: 'foe-technique',
        media: {assetId: `m_${'c'.repeat(40)}`},
        task07MediaRevision: 2,
      },
    }},
    nestedTarget: {
      kind: 'foe-technique', entryId: 'techniqueA', slot: 'media',
    },
    beforeFields: {media: {exists: true, value: previous}},
    revision: 3,
    timestamp: 'foe-time',
  });
  assert.deepEqual(restoredFoe.techniqueA.media, previous);
  assert.equal(restoredFoe.techniqueA.task07MediaRevision, 3);
  assert.equal(restoredFoe.techniqueA.targetKind, 'foe-technique');
});

test('backfill path parsing strips Firebase tokens and foreign URLs', () => {
  const storagePath = 'characters/avatar_user-a.png';
  const url = `https://firebasestorage.googleapis.com/v0/b/demo/o/` +
    `${encodeURIComponent(storagePath)}?alt=media&token=must-not-leak`;
  const demoContext = {expectedBucket: 'demo', allowLoopback: false};
  assert.equal(storagePathFromValue(url, demoContext), storagePath);
  assert.deepEqual(
    collectMediaPaths({imageUrl: url}, demoContext),
    [storagePath]
  );
  assert.equal(
    storagePathFromValue('https://example.com/private/object.png'),
    ''
  );
});

test('Storage URL provenance is exact and live scans reject loopback', () => {
  const storagePath = 'shared/same.png';
  const encodedPath = encodeURIComponent(storagePath);
  const liveContext = {
    expectedBucket: PRODUCTION_STORAGE_BUCKET,
    allowLoopback: false,
  };
  const correct = `https://firebasestorage.googleapis.com/v0/b/` +
    `${PRODUCTION_STORAGE_BUCKET}/o/${encodedPath}?alt=media`;
  const foreign = `https://firebasestorage.googleapis.com/v0/b/` +
    `fatin-test.firebasestorage.app/o/${encodedPath}?alt=media`;
  const foreignGcs = `https://storage.googleapis.com/` +
    `fatin-test.firebasestorage.app/${storagePath}`;
  const loopback = `http://127.0.0.1:9199/v0/b/` +
    `${PRODUCTION_STORAGE_BUCKET}/o/${encodedPath}?alt=media`;
  const demoLoopback = `http://127.0.0.1:9199/v0/b/` +
    `demo-fnd-perf.appspot.com/o/${encodedPath}?alt=media`;

  assert.equal(storagePathFromValue(correct, liveContext), storagePath);
  assert.equal(storagePathFromValue(foreign, liveContext), '');
  assert.equal(storagePathFromValue(foreignGcs, liveContext), '');
  assert.equal(storagePathFromValue(loopback, liveContext), '');
  assert.equal(storagePathFromValue(demoLoopback, {
    expectedBucket: 'demo-fnd-perf.appspot.com',
    allowLoopback: true,
  }), storagePath);
  assert.equal(storagePathFromValue(demoLoopback, {
    expectedBucket: 'other.appspot.com',
    allowLoopback: true,
  }), '');
  assert.equal(storagePathFromValue(correct), '');
});

test('foreign-bucket references cannot become executable backfill sources', async () => {
  const path = 'shared/same.png';
  const foreign = `https://firebasestorage.googleapis.com/v0/b/` +
    `fatin-test.firebasestorage.app/o/${encodeURIComponent(path)}?alt=media`;
  const record = {
    ...avatarRecord('player-one'),
    data: {imageUrl: foreign},
  };
  const options = {
    projectId: 'fatins',
    storageBucket: PRODUCTION_STORAGE_BUCKET,
    sourceKeys: ['avatars'],
    readSourceObject: async () => {
      assert.fail('foreign-bucket object must never be read');
    },
    readOwner: async () => activeOwner(),
    scan: {complete: true, pageSize: 25, maxPages: 1},
  };
  const backfill = await buildLegacyMediaBackfillPlan([record], options);
  assert.equal(backfill.entries.length, 0);
  assert.equal(backfill.complete, false);
  assert.equal(backfill.scan.invalidMediaReferences, 1);

  const audit = await buildCanonicalMediaAudit([record], {
    ...options,
    inspectCanonicalRecord: async () => ({
      manifest: {exists: false, version: '', data: null},
      objects: [],
      legacyObjects: [],
    }),
  });
  assert.equal(audit.entries.length, 1);
  assert.ok(audit.entries[0].issues.some(
    ({code}) => code === 'media-reference-unclassifiable'
  ));
});

test('both current and compatibility Task 07 generated paths are excluded', () => {
  const assetId = `m_${'1'.repeat(40)}`;
  const current = `media_assets/v1/signed-in/player/${assetId}/7/original`;
  const compatibility = `media/v1/foe/dm/${assetId}/original/source.png`;
  const tokenCompatibility =
    `media/v1/token/player/${assetId}/original/source.png`;
  assert.equal(isCanonicalTask07Path(current), true);
  assert.equal(isCanonicalTask07Path(compatibility), true);
  assert.equal(isCanonicalTask07Path(tokenCompatibility), true);
  assert.deepEqual(collectMediaPaths({
    media: {
      schemaVersion: 1,
      original: {path: current},
    },
    imagePath: current,
    nested: {imagePath: 'legacy/image.png'},
  }), ['legacy/image.png', current]);
});

test('backfill plan is deterministic, deduplicated, and contract-bound', async () => {
  const records = [
    {
      ...avatarRecord('player-one'),
      data: {
        imagePath: 'characters/player-one.png',
        imageUrl: 'characters/player-one.png',
      },
    },
    {
      kind: 'npc',
      ownerUid: '',
      entityId: 'npc-one',
      targetPath: 'echi_npcs/npc-one',
      targetVersion: '11:000000001',
      data: {imagePath: 'legacy/unowned-npc.png'},
    },
    {
      kind: 'map',
      ownerUid: '',
      entityId: 'map-one',
      targetPath: 'grigliata_backgrounds/map-one',
      targetVersion: '12:000000001',
      data: {
        imagePath: 'grigliata/backgrounds/dm-one/map.png',
        assetType: 'image',
      },
    },
  ];
  const options = {
    readSourceObject: async () => source(),
    readOwner: async (uid) => (
      uid === 'dm-one' ? activeOwner('dm') : activeOwner()
    ),
    scan: {
      complete: true,
      pageSize: 25,
      maxPages: 20,
      concurrency: 1,
      pagesBySource: {fixtures: 1},
      truncatedSources: [],
    },
  };
  const first = await buildLegacyMediaBackfillPlan(records, options);
  const second = await buildLegacyMediaBackfillPlan(records, options);
  assert.equal(first.planVersion, PLAN_VERSION);
  assert.equal(first.policyHash, POLICY_HASH);
  assert.equal(first.planFingerprint, second.planFingerprint);
  assert.equal(first.planFingerprint, computePlanFingerprint(first));
  assert.deepEqual(first.counts, {
    records: 3,
    candidates: 3,
    excluded: 0,
    discovered: 3,
    executable: 2,
    skipped: 0,
    errors: 1,
  });
  const map = first.entries.find(({entityId}) => entityId === 'map-one');
  assert.equal(map.ownerUid, 'dm-one');
  assert.match(map.assetId, /^m_[a-f0-9]{40}$/);
  assert.equal(
    map.stagingPath,
    `media_uploads/dm-one/${map.assetId}/source`
  );
  const npc = first.entries.find(({entityId}) => entityId === 'npc-one');
  assert.equal(npc.status, 'blocked');
  assert.ok(npc.issues.some(({code}) => code === 'missing-owner'));
  assert.ok(first.entries.every((entry) => !('imageUrl' in entry)));
});

test('root target planning does not absorb nested personal media', async () => {
  const report = await planFor([{
    ...avatarRecord('nested-owner'),
    data: {
      imagePath: 'characters/nested-owner.png',
      spells: {
        Spark: {image_url: 'users/nested-owner/spark.png'},
      },
    },
  }]);
  assert.equal(report.entries.length, 1);
  assert.equal(report.entries[0].sourcePath,
    'characters/nested-owner.png');
  assert.equal(report.entries[0].status, 'ready');
});

test('source generation, policy type, and size are fail-closed', async () => {
  const records = [
    avatarRecord('missing-generation', 'legacy/a.png'),
    avatarRecord('gif', 'legacy/a.gif'),
    avatarRecord('oversize', 'legacy/huge.png'),
    {
      kind: 'map-video',
      ownerUid: 'dm-one',
      entityId: 'video',
      targetPath: 'grigliata_backgrounds/video',
      targetVersion: '20:000000001',
      data: {imagePath: 'legacy/video.webm', assetType: 'video'},
    },
  ];
  const report = await planFor(records, {
    readSourceObject: async (storagePath) => {
      if (storagePath.endsWith('a.png')) return source({generation: ''});
      if (storagePath.endsWith('.gif')) {
        return source({contentType: 'image/gif'});
      }
      if (storagePath.endsWith('huge.png')) {
        return source({bytes: 6 * 1024 * 1024});
      }
      return source({contentType: 'video/webm', bytes: 4096});
    },
    readOwner: async (uid) => (
      uid === 'dm-one' ? activeOwner('dm') : activeOwner()
    ),
  });
  assert.equal(report.counts.executable, 1);
  assert.equal(report.counts.errors, 3);
  assert.equal(
    report.entries.find(({entityId}) => entityId === 'video').status,
    'ready'
  );
});

test('personal technique art and video are independent executable slots', async () => {
  const target = {
    ownerUid: 'player-one',
    entityId: 'technique-one',
    targetPath: 'users/player-one/tecniche/technique-one',
    targetVersion: '30:000000001',
  };
  const report = await planFor([{
    ...target,
    kind: 'technique',
    data: {image_url: 'users/player-one/technique.png'},
  }, {
    ...target,
    kind: 'technique-video',
    data: {video_url: 'users/player-one/technique.mp4'},
  }], {
    readSourceObject: async (storagePath) => (
      storagePath.endsWith('.mp4') ?
        source({contentType: 'video/mp4', bytes: 4096}) :
        source()
    ),
  });
  assert.equal(report.counts.executable, 2);
  assert.equal(report.counts.errors, 0);
  assert.deepEqual(
    report.entries.map(({targetSlot}) => targetSlot).sort(),
    ['media', 'videoMedia']
  );
  assert.ok(report.entries.every(({targetKind}) => (
    targetKind === 'user-technique'
  )));
});

test('common technique map entries bind independent art and video slots', async () => {
  const commonTarget = {
    commonTechnique: true,
    ownerUid: '',
    targetPath: 'utils/tecniche_common',
    targetVersion: '31:000000001',
  };
  const report = await planFor([{
    ...commonTarget,
    sourceKey: 'common-technique-art',
    kind: 'technique',
    entityId: 'tecnica-a',
    data: {
      label: 'Tecnica A',
      image_url: 'legacy/common/tecnica-a.png',
      video_url: 'legacy/common/tecnica-a.mp4',
    },
  }, {
    ...commonTarget,
    sourceKey: 'common-technique-video',
    kind: 'technique-video',
    entityId: 'tecnica-a',
    data: {
      label: 'Tecnica A',
      image_url: 'legacy/common/tecnica-a.png',
      video_url: 'legacy/common/tecnica-a.mp4',
    },
  }, {
    ...commonTarget,
    sourceKey: 'common-technique-art',
    kind: 'technique',
    entityId: 'tecnica-b',
    data: {
      label: 'Tecnica B',
      image_url: 'legacy/common/tecnica-b.png',
    },
  }], {
    catalogOwnerUid: 'verified-webmaster',
    readOwner: async () => activeOwner('webmaster'),
    readSourceObject: async (storagePath) => (
      storagePath.endsWith('.mp4') ?
        source({contentType: 'video/mp4', bytes: 4096}) :
        source()
    ),
  });

  assert.equal(report.counts.executable, 3);
  assert.equal(report.counts.errors, 0);
  assert.ok(report.entries.every((entry) => (
    entry.commonTechnique === true &&
    entry.targetKind === 'common-technique' &&
    entry.targetPath === 'utils/tecniche_common' &&
    entry.ownerUid === 'verified-webmaster' &&
    entry.ownerResolution === 'verified-global-fallback' &&
    entry.audienceScope === 'signed-in'
  )));
  assert.deepEqual(
    report.entries
      .filter(({entityId}) => entityId === 'tecnica-a')
      .map(({targetSlot}) => targetSlot)
      .sort(),
    ['media', 'videoMedia']
  );
  assert.equal(
    report.entries.filter(({entityId}) => entityId === 'tecnica-b').length,
    1
  );
});

test('token planning includes only custom templates and foe-token root media', async () => {
  const report = await planFor([{
    kind: 'token',
    tokenMigrationClass: 'custom',
    ownerUid: 'player-one',
    entityId: 'custom-template-one',
    targetPath: 'grigliata_tokens/custom-template-one',
    targetVersion: '32:000000001',
    data: {
      tokenType: 'custom',
      customTokenRole: 'template',
      customTemplateId: 'custom-template-one',
      imagePath: 'grigliata/tokens/player-one/custom.png',
      nested: {imagePath: 'must/not/be/planned.png'},
    },
  }, {
    kind: 'token',
    tokenMigrationClass: 'foe',
    ownerUid: 'dm-one',
    entityId: 'foe-token-one',
    targetPath: 'grigliata_tokens/foe-token-one',
    targetVersion: '33:000000001',
    placementReferenceCount: 1,
    placementReferenceHash: '1'.repeat(64),
    sourceFoeProof: {
      scanned: true,
      referencePath: 'foes/foe-source-one',
      exists: true,
      version: '31:000000001',
      dataFingerprint: '2'.repeat(64),
    },
    data: {
      tokenType: 'foe',
      foeSourceId: 'foe-source-one',
      imagePath: 'foes/token-main.png',
      tecniche: [{image_url: 'foes/nested-technique.png'}],
      spells: [{video_url: 'foes/nested-spell.mp4'}],
    },
  }, {
    kind: 'token',
    ownerUid: 'player-two',
    entityId: 'character-token-one',
    targetPath: 'grigliata_tokens/character-token-one',
    targetVersion: '34:000000001',
    data: {tokenType: 'character', imagePath: 'characters/player-two.png'},
  }], {
    readOwner: async (uid) => activeOwner(uid === 'dm-one' ? 'dm' : 'player'),
  });

  assert.equal(report.counts.executable, 2);
  assert.equal(report.counts.errors, 0);
  assert.deepEqual(
    report.entries.map(({sourceKey}) => sourceKey).sort(),
    ['custom-token-templates', 'foe-tokens']
  );
  assert.ok(report.entries.every(({targetKind, audienceScope}) => (
    targetKind === 'grigliata-token' && audienceScope === 'signed-in'
  )));
  assert.equal(report.entries.some(({sourcePath}) => (
    sourcePath.includes('nested')
  )), false);
});

test('unplaced foe-token roots are signed exclusions, never executable receipts', async () => {
  const foeRecord = ({id, placed, sourceExists}) => ({
    kind: 'token',
    sourceKey: 'foe-tokens',
    tokenMigrationClass: 'foe',
    ownerUid: 'dm-one',
    entityId: id,
    targetPath: `grigliata_tokens/${id}`,
    targetVersion: `40:00000000${id.length}`,
    placementReferenceCount: placed ? 1 : 0,
    placementReferenceHash: placed ? '3'.repeat(64) : '4'.repeat(64),
    sourceFoeProof: {
      scanned: true,
      referencePath: `foes/source-${id}`,
      exists: sourceExists,
      version: sourceExists ? '39:000000001' : '',
      dataFingerprint: sourceExists ? '5'.repeat(64) : '6'.repeat(64),
    },
    data: {
      tokenType: 'foe',
      foeSourceId: `source-${id}`,
      imagePath: `foes/${id}.png`,
    },
  });
  const records = [
    foeRecord({id: 'unplaced-source-missing', placed: false, sourceExists: false}),
    foeRecord({id: 'unplaced-source-present', placed: false, sourceExists: true}),
    foeRecord({id: 'placed-source-present', placed: true, sourceExists: true}),
  ];
  const report = await planFor(records, {
    readOwner: async () => activeOwner('dm'),
    readSourceObject: async (storagePath) => (
      storagePath.includes('unplaced-source-missing') ?
        {exists: false} :
        source()
    ),
  });

  assert.equal(report.counts.records, 3);
  assert.equal(report.counts.candidates, 1);
  assert.equal(report.counts.excluded, 2);
  assert.equal(report.counts.discovered, 3);
  assert.equal(report.counts.executable, 1);
  assert.deepEqual(report.entries.map(({entityId}) => entityId), [
    'placed-source-present',
  ]);
  assert.deepEqual(report.excluded.map(({entityId}) => entityId), [
    'unplaced-source-missing',
    'unplaced-source-present',
  ]);
  assert.equal(report.excluded[0].sourceExists, false);
  assert.equal(report.excluded[1].sourceFoeProof.exists, true);
  assert.ok(report.excluded.every((entry) => (
    entry.reason === 'unplaced-foe-token-root' &&
    entry.placementReferenceCount === 0 &&
    /^[a-f0-9]{64}$/.test(entry.exclusionHash)
  )));

  const options = executionOptions(report);
  assert.equal(assertApprovedReport(report, options), report);
  const tampered = {
    ...report,
    excluded: report.excluded.map((entry, index) => (
      index === 0 ? {...entry, placementReferenceHash: 'f'.repeat(64)} : entry
    )),
  };
  assert.throws(
    () => assertApprovedReport(tampered, options),
    /exact completed/
  );
});

test('music migration plans all tracks as signed-in canonical media receipts', async () => {
  const records = Array.from({length: 7}, (_, index) => ({
    kind: 'music',
    sourceKey: 'music-tracks',
    ownerUid: index === 0 ? '' : 'dm-one',
    entityId: `track-${index + 1}`,
    targetPath: `grigliata_music_tracks/track-${index + 1}`,
    targetVersion: `50:00000000${index + 1}`,
    data: {
      audioPath: `grigliata/music/track-${index + 1}.mp3`,
    },
  }));
  const report = await planFor(records, {
    catalogOwnerUid: 'fallback-webmaster',
    readOwner: async (uid) => activeOwner(
      uid === 'fallback-webmaster' ? 'webmaster' : 'dm'
    ),
    readSourceObject: async () => source({
      contentType: 'audio/mpeg',
      bytes: 4096,
    }),
  });

  assert.equal(report.counts.candidates, 7);
  assert.equal(report.counts.excluded, 0);
  assert.equal(report.counts.executable, 7);
  assert.ok(report.entries.every((entry) => (
    entry.sourceKey === 'music-tracks' &&
    entry.kind === 'music' &&
    entry.targetKind === 'grigliata-music-track' &&
    entry.targetPath === `grigliata_music_tracks/${entry.entityId}` &&
    entry.targetSlot === 'media' &&
    entry.audienceScope === 'signed-in'
  )));
  assert.equal(report.entries[0].ownerUid, 'fallback-webmaster');
  assert.equal(
    report.entries[0].ownerResolution,
    'verified-global-fallback'
  );
});

test('foe receipt verification binds current placement and source proof', async () => {
  const receipt = {
    receiptId: 'r_foe_relationship',
    schemaVersion: REPORT_SCHEMA_VERSION,
    planVersion: PLAN_VERSION,
    policyVersion: 1,
    policyHash: POLICY_HASH,
    subjectHash: '7'.repeat(64),
    assetId: `m_${'8'.repeat(40)}`,
    previousAssetId: null,
    kind: 'token',
    sourceKey: 'foe-tokens',
    entityId: 'placed-foe-token',
    commonTechnique: false,
    ownerUid: 'dm-one',
    sourcePath: 'foes/placed.png',
    sourceFingerprint: '9'.repeat(64),
    sourceFoeProof: {
      scanned: true,
      referencePath: 'foes/source-foe',
      exists: true,
      version: '60:000000001',
      dataFingerprint: 'a'.repeat(64),
    },
    sourceFoeFingerprint: 'b'.repeat(64),
    placementReferenceCount: 1,
    placementReferenceHash: 'c'.repeat(64),
    legacyGeneralImageUrlProof: null,
    targetPath: 'grigliata_tokens/placed-foe-token',
    targetSlot: 'media',
    state: 'attached',
    attachedRevision: 1,
  };
  const inspection = {
    manifestState: 'attached',
    targetAssetId: receipt.assetId,
    targetRevision: 1,
    generatedObjectsPresent: true,
    legacySourceUnchanged: true,
    legacyGeneralImageUrlUnchanged: true,
    itemOriginalGenerated: true,
    itemCardGenerated: true,
    itemCard2xGenerated: true,
    placementReferenceCount: 1,
    placementReferenceHash: receipt.placementReferenceHash,
    sourceFoeFingerprint: receipt.sourceFoeFingerprint,
  };
  const build = (currentInspection) => buildReceiptOperationPlan({
    backend: {
      readReceiptPage: async () => ({
        records: [receipt], cursor: null, hasMore: false,
      }),
      inspectReceipt: async () => currentInspection,
    },
    operation: 'verify',
    pageSize: 5,
    maxPages: 1,
  });
  assert.equal((await build(inspection)).entries[0].status, 'verified');
  assert.equal((await build({
    ...inspection,
    placementReferenceCount: 0,
  })).entries[0].status, 'blocked');
  assert.equal((await build({
    ...inspection,
    sourceFoeFingerprint: 'd'.repeat(64),
  })).entries[0].status, 'blocked');
});

test('bounded pagination is serial and reports truncation', async () => {
  let active = 0;
  let maxActive = 0;
  const calls = [];
  const loaded = await loadPaged({
    sourceKeys: ['a', 'b'],
    pageSize: 2,
    maxPages: 2,
    readPage: async (sourceKey, cursor) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      calls.push([sourceKey, cursor]);
      await Promise.resolve();
      active -= 1;
      const page = cursor == null ? 0 : Number(cursor);
      return {
        records: [`${sourceKey}-${page}-1`, `${sourceKey}-${page}-2`],
        cursor: page + 1,
        hasMore: true,
      };
    },
  });
  assert.equal(MIGRATION_CONCURRENCY, 1);
  assert.equal(maxActive, 1);
  assert.equal(calls.length, 4);
  assert.equal(loaded.records.length, 8);
  assert.equal(loaded.scan.complete, false);
  assert.deepEqual(loaded.scan.truncatedSources, ['a', 'b']);
});

test('legacy record loader visits each source with bounded serial pages', async () => {
  const sourceKeys = [];
  const loaded = await loadLegacyMediaRecords({
    readLegacyPage: async (sourceKey, _cursor, pageSize) => {
      sourceKeys.push(sourceKey);
      assert.equal(pageSize, 3);
      return {records: [], cursor: null, hasMore: false};
    },
  }, {pageSize: 3, maxPages: 1});
  assert.deepEqual(sourceKeys, SOURCE_KEYS);
  assert.equal(loaded.scan.complete, true);
  assert.equal(loaded.scan.concurrency, 1);
});

test('CLI defaults to planning and gates every execution fingerprint', () => {
  const planned = parseOptions([
    '--project', 'demo-fnd-perf',
    '--page-size', '4',
    '--max-pages', '3',
  ]);
  assert.equal(planned.operation, 'backfill');
  assert.equal(planned.execute, false);
  assert.equal(planned.pageSize, 4);
  assert.equal(planned.maxPages, 3);
  assert.throws(() => parseOptions([]), /--project is required/);
  assert.throws(() => parseOptions([
    '--project', 'demo-fnd-perf', '--write',
  ]), /not supported/);
  assert.throws(() => parseOptions([
    '--project', 'demo-fnd-perf', '--execute',
  ]), /approve-fingerprint/);
  assert.throws(() => parseOptions([
    '--project', 'demo-fnd-perf',
    '--operation', 'verify',
    '--execute',
    '--approve-fingerprint', 'a'.repeat(64),
  ]), /always read-only/);
  const applied = parseOptions([
    '--project', 'demo-fnd-perf',
    '--operation', 'rollback',
    '--apply',
    '--approve-fingerprint', 'a'.repeat(64),
    '--expected-candidates', '0',
  ]);
  assert.equal(applied.execute, true);
  assert.equal(applied.operation, 'rollback');
  assert.throws(() => parseOptions(liveArgs({extra: [
    '--operation', 'verify',
  ]})), /requires --approved-backfill-report/);
  const liveVerify = parseOptions(liveArgs({extra: [
    '--operation', 'verify',
    '--approved-backfill-report', 'approved-backfill.json',
  ]}));
  assert.match(liveVerify.approvedBackfillReportPath,
    /approved-backfill\.json$/);
  assert.throws(() => parseOptions([
    '--project', 'demo-fnd-perf',
    '--operation', 'rollback',
    '--approved-backfill-report', 'approved-backfill.json',
  ]), /supported only.*verify/);
});

test('staging retries only intents and retryable failures', () => {
  assert.equal(stagingActionForManifest('intent', false), 'stage');
  assert.equal(stagingActionForManifest('failed', true), 'stage');
  assert.equal(stagingActionForManifest('processing', false), 'poll');
  assert.equal(stagingActionForManifest('ready', false), 'complete');
  assert.throws(() => stagingActionForManifest('failed', false),
    /stopped in failed/);
  assert.throws(() => stagingActionForManifest('cancelled', true),
    /stopped in cancelled/);
});

test('Firebase target preserves demo emulators and hard-locks live fatins', () => {
  const base = {
    projectId: 'demo-fnd-perf',
    operation: 'backfill',
    execute: false,
  };
  const emulatorEnv = {
    FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
    FIREBASE_STORAGE_EMULATOR_HOST: 'localhost:9199',
  };
  assert.deepEqual(assertSafeTarget(base, emulatorEnv), {
    projectId: 'demo-fnd-perf',
    storageBucket: 'demo-fnd-perf.appspot.com',
    live: false,
    concurrency: 1,
  });
  assert.throws(() => assertSafeTarget(
    {...base, projectId: 'fatins'},
    emulatorEnv
  ), /Live fatins migration refuses all emulator/);
  assert.throws(() => assertSafeTarget(base, {
    ...emulatorEnv,
    FIREBASE_STORAGE_EMULATOR_HOST: 'storage.example.com:9199',
  }), /loopback Storage emulator/);
  assert.throws(() => assertSafeTarget({...base, execute: true}, emulatorEnv),
    /loopback Functions emulator/);
  assert.doesNotThrow(() => assertSafeTarget({...base, execute: true}, {
    ...emulatorEnv,
    FUNCTIONS_EMULATOR_HOST: '127.0.0.1:5001',
  }));
  const live = parseOptions(liveArgs());
  assert.deepEqual(assertSafeTarget(live, {}), {
    projectId: 'fatins',
    storageBucket: PRODUCTION_STORAGE_BUCKET,
    live: true,
    concurrency: 1,
  });
  assert.throws(() => assertSafeTarget({...live, confirmProject: 'wrong-project'}, {}),
    /exact --confirm-project fatins/);
  assert.throws(() => assertSafeTarget({...live, authMode: 'admin'}, {}),
    /--auth firebase-cli/);
  assert.throws(() => assertSafeTarget({
    ...live,
    sourceKeys: SOURCE_KEYS.slice(1),
  }, {}), /every supported source/);
  assert.throws(() => assertSafeTarget(live, {
    FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
  }), /refuses all emulator/);
});

test('verified webmaster fallback never overrides explicit or personal owners', async () => {
  const fallbackUid = 'fallback-webmaster';
  const report = await planFor([{
    kind: 'item',
    sourceKey: 'catalog-items',
    ownerUid: '',
    entityId: 'ownerless-catalog',
    referenceScope: 'global-catalog',
    targetPath: 'items/ownerless-catalog',
    targetVersion: '1:000000001',
    data: {General: {image_url: 'catalog/ownerless.png'}},
  }, {
    kind: 'npc',
    sourceKey: 'npcs',
    ownerUid: 'explicit-dm',
    entityId: 'explicit-npc',
    targetPath: 'echi_npcs/explicit-npc',
    targetVersion: '2:000000001',
    data: {imagePath: 'npcs/explicit.png'},
  }, {
    kind: 'item',
    sourceKey: 'inventory-items',
    ownerUid: 'personal-owner',
    entityId: 'personal-item',
    referenceScope: 'user-inventory',
    targetPath: 'users/personal-owner/inventory/personal-item',
    targetVersion: '3:000000001',
    data: {General: {image_url: 'users/personal-owner/item.png'}},
  }], {
    catalogOwnerUid: fallbackUid,
    readOwner: async (uid) => activeOwner(
      uid === fallbackUid ? 'webmaster' :
        uid === 'explicit-dm' ? 'dm' : 'player'
    ),
  });
  const byEntity = Object.fromEntries(
    report.entries.map((entry) => [entry.entityId, entry])
  );
  assert.equal(byEntity['ownerless-catalog'].ownerUid, fallbackUid);
  assert.equal(
    byEntity['ownerless-catalog'].ownerResolution,
    'verified-global-fallback'
  );
  assert.equal(byEntity['explicit-npc'].ownerUid, 'explicit-dm');
  assert.equal(byEntity['explicit-npc'].ownerResolution, 'explicit');
  assert.equal(byEntity['personal-item'].ownerUid, 'personal-owner');
  assert.equal(byEntity['personal-item'].ownerResolution, 'explicit');
  assert.equal(report.counts.errors, 0);
});

test('global foes use webmaster fallback while personal copies infer owner',
  async () => {
    const fallbackUid = 'fallback-webmaster';
    const report = await planFor([{
      kind: 'foe',
      sourceKey: 'foes',
      ownerUid: '',
      entityId: 'global-foe',
      targetPath: 'foes/global-foe',
      targetVersion: '4:000000001',
      data: {imagePath: 'foes/shared-foe.webp'},
    }, {
      kind: 'foe',
      sourceKey: 'foes',
      ownerUid: '',
      entityId: 'personal-copy',
      targetPath: 'foes/personal-copy',
      targetVersion: '5:000000001',
      data: {imagePath: 'foes/copies/copy-dm/copy.webp'},
    }], {
      catalogOwnerUid: fallbackUid,
      readSourceObject: async () => source({contentType: 'image/webp'}),
      readOwner: async (uid) => activeOwner(
        uid === fallbackUid ? 'webmaster' : 'dm'
      ),
    });
    const byEntity = Object.fromEntries(
      report.entries.map((entry) => [entry.entityId, entry])
    );
    assert.equal(byEntity['global-foe'].ownerUid, fallbackUid);
    assert.equal(
      byEntity['global-foe'].ownerResolution,
      'verified-global-fallback'
    );
    assert.equal(byEntity['personal-copy'].ownerUid, 'copy-dm');
    assert.equal(byEntity['personal-copy'].ownerResolution, 'legacy-path');
    assert.equal(report.counts.errors, 0);
  });

test('legacy maps may omit assetType but explicit purpose mismatches fail',
  async () => {
    const report = await planFor([{
      kind: 'map',
      sourceKey: 'backgrounds',
      ownerUid: 'dm-one',
      entityId: 'legacy-map',
      targetPath: 'grigliata_backgrounds/legacy-map',
      targetVersion: '6:000000001',
      data: {
        imagePath: 'grigliata/backgrounds/dm-one/legacy-map.jpg',
      },
    }, {
      kind: 'map',
      sourceKey: 'backgrounds',
      ownerUid: 'dm-one',
      entityId: 'mismatched-map',
      targetPath: 'grigliata_backgrounds/mismatched-map',
      targetVersion: '7:000000001',
      data: {
        imagePath: 'grigliata/backgrounds/dm-one/mismatched-map.jpg',
        assetType: 'video',
      },
    }], {
      readOwner: async () => activeOwner('dm'),
      readSourceObject: async () => source({contentType: 'image/jpeg'}),
    });
    const byEntity = Object.fromEntries(
      report.entries.map((entry) => [entry.entityId, entry])
    );
    assert.equal(byEntity['legacy-map'].status, 'ready');
    assert.equal(byEntity['mismatched-map'].status, 'blocked');
    assert.ok(byEntity['mismatched-map'].issues.some(
      ({code}) => code === 'target-media-purpose-invalid'
    ));
    assert.equal(report.counts.executable, 1);
    assert.equal(report.counts.errors, 1);
  });

test('approval rejects tampering, incomplete scans, and policy drift', async () => {
  const report = await planFor([avatarRecord('approved')]);
  const options = executionOptions(report);
  assert.equal(assertApprovedReport(report, options), report);
  assert.throws(() => assertApprovedReport({
    ...report,
    entries: [{...report.entries[0], sourceBytes: 999}],
  }, options), /exact completed/);
  const incomplete = {
    ...report,
    complete: false,
  };
  incomplete.planFingerprint = computePlanFingerprint(incomplete);
  assert.throws(() => assertApprovedReport(
    incomplete,
    {...options, approveFingerprint: incomplete.planFingerprint}
  ), /exact completed/);
  assert.throws(() => assertApprovedReport(report, {
    ...options,
    approveFingerprint: 'f'.repeat(64),
  }), /exactly match/);
  const wrongCount = {
    ...report,
    expectedCandidates: report.expectedCandidates + 1,
  };
  wrongCount.planFingerprint = computePlanFingerprint(wrongCount);
  assert.throws(() => assertApprovedReport(wrongCount, {
    ...options,
    expectedCandidates: wrongCount.expectedCandidates,
    approveFingerprint: wrongCount.planFingerprint,
  }), /expected .* found|exact completed/);
});

test('execution is strictly serial and checkpoints only verified receipts', async () => {
  const report = await planFor([
    avatarRecord('a'),
    avatarRecord('b'),
  ]);
  let active = 0;
  let maxActive = 0;
  const applied = [];
  const checkpoints = [];
  const result = await executeMigrationPlan({
    backend: {
      applyBackfillEntry: async (entry) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        applied.push(entry.receiptId);
        await Promise.resolve();
        active -= 1;
        return {verified: true};
      },
    },
    options: executionOptions(report),
    report,
    onCheckpoint: async (checkpoint) => checkpoints.push(checkpoint),
  });
  assert.equal(maxActive, 1);
  assert.deepEqual(applied, report.entries.map(({receiptId}) => receiptId));
  assert.equal(checkpoints.length, 2);
  assert.equal(checkpoints[0].complete, false);
  assert.equal(checkpoints[1].complete, true);
  assert.deepEqual(result, {processed: 2, complete: true});
});

test('resume refuses a legacy reference changed after receipt creation', () => {
  const base = {
    targetExists: true,
    targetAvailable: true,
    targetFingerprintMatches: true,
    legacyReferenceMatches: true,
    legacyGeneralImageUrlMatches: true,
    previousAssetMatches: true,
  };
  assert.equal(backfillTargetFenceIssue(base), null);
  assert.match(backfillTargetFenceIssue({
    ...base,
    legacyReferenceMatches: false,
  }), /Legacy media reference changed/);
  assert.match(backfillTargetFenceIssue({
    ...base,
    targetFingerprintMatches: false,
  }), /changed after planning/);
});

test('backfill preserves attached canonical media and blocks malformed descriptors',
  async () => {
    const ready = {
      schemaVersion: 1,
      assetId: `m_${'a'.repeat(40)}`,
      kind: 'avatar',
      state: 'ready',
    };
    const canonicalRecord = {
      ...avatarRecord('canonical-owner'),
      data: {
        imagePath: 'characters/canonical-owner-stale.png',
        media: ready,
        task07MediaRevision: 3,
      },
    };
    const secondCanonicalRecord = {
      ...avatarRecord('canonical-owner-2'),
      // Deliberately share the target path so the exclusion comparator must
      // handle the absent sourcePath before reaching the exclusion ID.
      targetPath: canonicalRecord.targetPath,
      data: {
        imagePath: 'characters/canonical-owner-2-stale.png',
        media: {
          ...ready,
          assetId: `m_${'b'.repeat(40)}`,
        },
        task07MediaRevision: 2,
      },
    };
    const malformedRecord = {
      ...avatarRecord('malformed-owner'),
      data: {
        imagePath: 'characters/malformed-owner.png',
        media: {...ready, assetId: 'not-canonical'},
      },
    };
    const report = await planFor([
      secondCanonicalRecord,
      canonicalRecord,
      malformedRecord,
    ]);
    const reversedReport = await planFor([
      canonicalRecord,
      secondCanonicalRecord,
      malformedRecord,
    ]);
    assert.equal(report.counts.excluded, 2);
    assert.deepEqual(
      report.excluded.map(({exclusionId}) => exclusionId),
      reversedReport.excluded.map(({exclusionId}) => exclusionId)
    );
    assert.deepEqual(
      new Set(report.excluded.map(({entityId}) => entityId)),
      new Set(['canonical-owner', 'canonical-owner-2'])
    );
    assert.ok(report.excluded.every(({sourcePath}) => sourcePath === undefined));
    const preserved = report.excluded.find(({entityId}) => (
      entityId === 'canonical-owner'
    ));
    assert.equal(preserved.reason, 'already-canonical');
    assert.equal(preserved.assetId, ready.assetId);
    assert.deepEqual(preserved.legacyPaths,
      ['characters/canonical-owner-stale.png']);
    assert.equal(report.counts.candidates, 1);
    assert.equal(report.counts.executable, 0);
    assert.equal(report.counts.errors, 1);
    assert.ok(report.entries[0].issues.some(({code}) => (
      code === 'existing-canonical-descriptor-invalid'
    )));
  });

test('live approval accepts hashed already-canonical exclusions', async () => {
  const catalogOwnerUid = 'verified-webmaster';
  const report = await buildLegacyMediaBackfillPlan([{
    kind: 'avatar',
    sourceKey: 'avatars',
    ownerUid: 'canonical-owner',
    entityId: 'canonical-owner',
    targetPath: 'users/canonical-owner',
    targetVersion: '52:000000001',
    data: {
      imagePath: 'characters/canonical-owner-stale.png',
      media: {
        schemaVersion: 1,
        assetId: `m_${'b'.repeat(40)}`,
        kind: 'avatar',
        state: 'ready',
      },
      task07MediaRevision: 2,
    },
  }], {
    projectId: 'fatins',
    storageBucket: PRODUCTION_STORAGE_BUCKET,
    sourceKeys: SOURCE_KEYS,
    catalogOwnerUid,
    readOwner: async () => activeOwner('player'),
    readSourceObject: async () => source(),
    scan: {
      complete: true,
      pageSize: 25,
      maxPages: 100,
      concurrency: 1,
      pagesBySource: Object.fromEntries(SOURCE_KEYS.map((key) => [key, 1])),
      truncatedSources: [],
    },
  });
  report.expectedCandidates = 0;
  report.planFingerprint = computePlanFingerprint(report);
  const options = executionOptions(report, {
    projectId: 'fatins',
    sourceKeys: SOURCE_KEYS,
    catalogOwnerUid,
    expectedCandidates: 0,
  });
  assert.equal(assertApprovedReport(report, options), report);
  const tampered = structuredClone(report);
  tampered.excluded[0].assetId = `m_${'c'.repeat(40)}`;
  assert.throws(() => assertApprovedReport(tampered, options), /exact completed/);
});

test('bounded pagination permits bounded nested expansion per root page',
  async () => {
    const pageSize = 25;
    const roots = Array.from({length: pageSize}, (_, index) => `root-${index}`);
    const expanded = roots.flatMap((root) => [root, `${root}-nested`]);
    const loaded = await loadPaged({
      sourceKeys: ['catalog-items'],
      pageSize,
      maxPages: 1,
      readPage: async () => ({
        records: expanded,
        rootRecordCount: roots.length,
        cursor: null,
        hasMore: false,
      }),
    });
    assert.equal(loaded.records.length, pageSize * 2);
    assert.equal(loaded.scan.complete, true);
  });

test('execution derives foe-token source receipts from the approved plan',
  async () => {
    const report = await planFor([{
      kind: 'foe',
      sourceKey: 'foes',
      ownerUid: 'dm-one',
      entityId: 'source-foe',
      targetPath: 'foes/source-foe',
      targetVersion: '70:000000001',
      data: {imagePath: 'foes/source.png'},
    }, {
      kind: 'token',
      sourceKey: 'foe-tokens',
      tokenMigrationClass: 'foe',
      ownerUid: 'dm-one',
      entityId: 'placed-token',
      targetPath: 'grigliata_tokens/placed-token',
      targetVersion: '71:000000001',
      placementReferenceCount: 1,
      placementReferenceHash: 'd'.repeat(64),
      sourceFoeProof: {
        scanned: true,
        referencePath: 'foes/source-foe',
        exists: true,
        version: '70:000000001',
        dataFingerprint: 'e'.repeat(64),
      },
      data: {
        tokenType: 'foe',
        foeSourceId: 'source-foe',
        imagePath: 'foes/source.png',
      },
    }], {
      readOwner: async () => activeOwner('dm'),
    });
    const bindings = [];
    await executeMigrationPlan({
      backend: {
        applyBackfillEntry: async (entry, binding) => {
          bindings.push({entry, binding});
          return {verified: true};
        },
      },
      options: executionOptions(report),
      report,
    });
    const source = report.entries.find(({sourceKey}) => sourceKey === 'foes');
    const token = bindings.find(({entry}) => entry.sourceKey === 'foe-tokens');
    assert.equal(token.binding.sourceFoeBackfillReceiptId, source.receiptId);
    assert.equal(token.binding.planFingerprint, report.planFingerprint);
  });

test('checkpoint resume continues after the exact durable receipt cursor', async () => {
  const report = await planFor([
    avatarRecord('a'),
    avatarRecord('b'),
  ]);
  const options = executionOptions(report);
  const firstCheckpoint = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    planVersion: PLAN_VERSION,
    policyVersion: report.policyVersion,
    policyHash: POLICY_HASH,
    mode: 'execute',
    operation: 'backfill',
    projectId: 'demo-fnd-perf',
    planFingerprint: report.planFingerprint,
    lastReceiptId: report.entries[0].receiptId,
    processed: 1,
    complete: false,
  };
  options.resumeCheckpoint = firstCheckpoint;
  assert.equal(assertCheckpoint(firstCheckpoint, report, options),
    firstCheckpoint);
  const applied = [];
  const result = await executeMigrationPlan({
    backend: {
      applyBackfillEntry: async (entry) => {
        applied.push(entry.receiptId);
        return {verified: true};
      },
    },
    options,
    report,
  });
  assert.deepEqual(applied, [report.entries[1].receiptId]);
  assert.deepEqual(result, {processed: 2, complete: true});
  assert.throws(() => assertCheckpoint({
    ...firstCheckpoint,
    policyHash: '0'.repeat(64),
  }, report, options), /does not match/);
  assert.throws(() => assertCheckpoint({
    ...firstCheckpoint,
    processed: 2,
  }, report, options), /does not match/);
});

test('post-write failure never advances a checkpoint', async () => {
  const report = await planFor([avatarRecord('failure')]);
  const checkpoints = [];
  await assert.rejects(executeMigrationPlan({
    backend: {
      applyBackfillEntry: async () => ({verified: false}),
    },
    options: executionOptions(report),
    report,
    onCheckpoint: async (checkpoint) => checkpoints.push(checkpoint),
  }), /Post-write verification failed/);
  assert.deepEqual(checkpoints, []);
});

test('receipt verification and rollback plans bind current inspection', async () => {
  const receipt = {
    id: 'r_receipt',
    receiptId: 'r_receipt',
    schemaVersion: REPORT_SCHEMA_VERSION,
    planVersion: PLAN_VERSION,
    policyVersion: 1,
    policyHash: POLICY_HASH,
    subjectHash: 'a'.repeat(64),
    assetId: `m_${'b'.repeat(40)}`,
    previousAssetId: null,
    kind: 'item',
    sourceKey: 'catalog-items',
    entityId: 'catalog-item',
    commonTechnique: false,
    referenceScope: 'global-catalog',
    ownerUid: 'webmaster',
    sourcePath: 'legacy/catalog-item.png',
    sourceFingerprint: '1'.repeat(64),
    legacyGeneralImageUrlProof: {
      exists: true,
      valueHash: '2'.repeat(64),
    },
    targetPath: 'items/catalog-item',
    targetSlot: 'media',
    state: 'attached',
    attachedRevision: 4,
  };
  const backend = {
    readReceiptPage: async () => ({
      records: [receipt],
      cursor: null,
      hasMore: false,
    }),
    inspectReceipt: async () => ({
      manifestState: 'attached',
      targetAssetId: receipt.assetId,
      targetRevision: 4,
      generatedObjectsPresent: true,
      legacySourceUnchanged: true,
      legacyGeneralImageUrlUnchanged: true,
      itemOriginalGenerated: true,
      itemCardGenerated: true,
      itemCard2xGenerated: true,
    }),
  };
  const verify = await buildReceiptOperationPlan({
    backend,
    operation: 'verify',
    pageSize: 5,
    maxPages: 1,
  });
  assert.equal(verify.entries[0].status, 'verified');
  assert.deepEqual(verify.entries[0].proofs, {
    generatedObjectsPresent: true,
    legacySourceUnchanged: true,
    legacyGeneralImageUrlUnchanged: true,
    itemOriginalGenerated: true,
    itemCardGenerated: true,
    itemCard2xGenerated: true,
    placementReferenceCount: null,
    placementReferenceHash: null,
    sourceFoeFingerprint: null,
  });
  assert.equal(verify.counts.errors, 0);
  const rollback = await buildReceiptOperationPlan({
    backend,
    operation: 'rollback',
    pageSize: 5,
    maxPages: 1,
  });
  assert.equal(rollback.entries[0].status, 'rollback-ready');
  assert.equal(rollback.counts.executable, 1);
  assert.notEqual(rollback.entries[0].inspectionHash, '');
});

test('receipt verification scopes exactly to the approved current backfill',
  async () => {
    const approved = await planFor([avatarRecord('scoped-owner')]);
    approved.expectedCandidates = approved.counts.candidates;
    approved.planFingerprint = computePlanFingerprint(approved);
    const planned = approved.entries[0];
    const attachedRevision = Number(planned.expectedRevision) + 1;
    const receipt = {
      ...planned,
      schemaVersion: REPORT_SCHEMA_VERSION,
      planVersion: PLAN_VERSION,
      policyVersion: approved.policyVersion,
      policyHash: approved.policyHash,
      approvedPlanFingerprint: approved.planFingerprint,
      state: 'attached',
      attachedRevision,
    };
    let requestedIds = [];
    const backend = {
      readReceiptsByIds: async (ids) => {
        requestedIds = [...ids];
        return [receipt];
      },
      inspectReceipt: async () => ({
        manifestState: 'attached',
        targetAssetId: receipt.assetId,
        targetRevision: attachedRevision,
        generatedObjectsPresent: true,
        legacySourceUnchanged: true,
        legacyGeneralImageUrlUnchanged: true,
        itemOriginalGenerated: true,
        itemCardGenerated: true,
        itemCard2xGenerated: true,
      }),
    };
    const report = await buildReceiptOperationPlan({
      backend,
      operation: 'verify',
      expectedCandidates: 1,
      approvedBackfillReport: approved,
    });
    assert.deepEqual(requestedIds, [planned.receiptId]);
    assert.equal(report.counts.candidates, 1);
    assert.equal(report.counts.errors, 0);
    assert.equal(report.scope.type, 'approved-backfill-plan');
    assert.equal(report.scope.planFingerprint, approved.planFingerprint);

    const missing = await buildReceiptOperationPlan({
      backend: {...backend, readReceiptsByIds: async () => []},
      operation: 'verify',
      expectedCandidates: 1,
      approvedBackfillReport: approved,
    });
    assert.equal(missing.counts.errors, 1);
    assert.ok(missing.entries[0].issues.some(({code}) => (
      code === 'receipt-missing'
    )));
  });

test('drifted receipts block verification and rollback execution', async () => {
  const receipt = {
    receiptId: 'r_drifted',
    schemaVersion: REPORT_SCHEMA_VERSION,
    planVersion: PLAN_VERSION,
    policyVersion: 1,
    policyHash: POLICY_HASH,
    subjectHash: 'c'.repeat(64),
    assetId: `m_${'d'.repeat(40)}`,
    previousAssetId: null,
    kind: 'avatar',
    sourceKey: 'avatars',
    entityId: 'player',
    commonTechnique: false,
    ownerUid: 'player',
    sourcePath: 'legacy/avatar.png',
    sourceFingerprint: '3'.repeat(64),
    legacyGeneralImageUrlProof: null,
    targetPath: 'users/player',
    targetSlot: 'media',
    state: 'attached',
    attachedRevision: 2,
  };
  const report = await buildReceiptOperationPlan({
    backend: {
      readReceiptPage: async () => ({
        records: [receipt],
        cursor: null,
        hasMore: false,
      }),
      inspectReceipt: async () => ({
        manifestState: 'attached',
        targetAssetId: null,
        targetRevision: 2,
        generatedObjectsPresent: true,
        legacySourceUnchanged: true,
        legacyGeneralImageUrlUnchanged: true,
        itemOriginalGenerated: true,
        itemCardGenerated: true,
        itemCard2xGenerated: true,
      }),
    },
    operation: 'rollback',
    pageSize: 5,
    maxPages: 1,
  });
  assert.equal(report.entries[0].status, 'blocked');
  assert.equal(report.counts.errors, 1);
  await assert.rejects(executeMigrationPlan({
    backend: {rollbackEntry: async () => ({verified: true})},
    options: executionOptions(report),
    report,
  }), /exact completed, error-free/);
});

test('item verification fails closed when any immutable or derivative proof is missing', async () => {
  const receipt = {
    receiptId: 'r_item_proof',
    schemaVersion: REPORT_SCHEMA_VERSION,
    planVersion: PLAN_VERSION,
    policyVersion: 1,
    policyHash: POLICY_HASH,
    subjectHash: '7'.repeat(64),
    assetId: `m_${'8'.repeat(40)}`,
    previousAssetId: null,
    kind: 'item',
    sourceKey: 'catalog-items',
    entityId: 'item-proof',
    commonTechnique: false,
    referenceScope: 'global-catalog',
    ownerUid: 'webmaster',
    sourcePath: 'legacy/item.png',
    sourceFingerprint: '9'.repeat(64),
    legacyGeneralImageUrlProof: {exists: true, valueHash: 'a'.repeat(64)},
    targetPath: 'items/item-proof',
    targetSlot: 'media',
    state: 'attached',
    attachedRevision: 1,
  };
  for (const failedProof of [
    'legacySourceUnchanged',
    'legacyGeneralImageUrlUnchanged',
    'itemOriginalGenerated',
    'itemCardGenerated',
    'itemCard2xGenerated',
  ]) {
    const inspection = {
      manifestState: 'attached',
      targetAssetId: receipt.assetId,
      targetRevision: 1,
      generatedObjectsPresent: true,
      legacySourceUnchanged: true,
      legacyGeneralImageUrlUnchanged: true,
      itemOriginalGenerated: true,
      itemCardGenerated: true,
      itemCard2xGenerated: true,
      [failedProof]: false,
    };
    const report = await buildReceiptOperationPlan({
      backend: {
        readReceiptPage: async () => ({
          records: [receipt], cursor: null, hasMore: false,
        }),
        inspectReceipt: async () => inspection,
      },
      operation: 'verify',
      pageSize: 5,
      maxPages: 1,
    });
    assert.equal(report.entries[0].status, 'blocked', failedProof);
    assert.equal(report.counts.errors, 1, failedProof);
  }
});

test('already rolled-back receipts remain idempotent during rollback apply', async () => {
  const receipt = {
    receiptId: 'r_done',
    schemaVersion: REPORT_SCHEMA_VERSION,
    planVersion: PLAN_VERSION,
    policyVersion: 1,
    policyHash: POLICY_HASH,
    subjectHash: 'e'.repeat(64),
    assetId: `m_${'f'.repeat(40)}`,
    previousAssetId: null,
    kind: 'avatar',
    sourceKey: 'avatars',
    entityId: 'player',
    commonTechnique: false,
    ownerUid: 'player',
    sourcePath: 'legacy/avatar.png',
    sourceFingerprint: '4'.repeat(64),
    legacyGeneralImageUrlProof: null,
    targetPath: 'users/player',
    targetSlot: 'media',
    state: 'rolled-back',
  };
  const report = await buildReceiptOperationPlan({
    backend: {
      readReceiptPage: async () => ({
        records: [receipt],
        cursor: null,
        hasMore: false,
      }),
      inspectReceipt: async () => ({
        manifestState: 'cleanup-pending',
        targetAssetId: null,
        targetRevision: 3,
        generatedObjectsPresent: true,
        legacySourceUnchanged: true,
        legacyGeneralImageUrlUnchanged: true,
        itemOriginalGenerated: true,
        itemCardGenerated: true,
        itemCard2xGenerated: true,
      }),
    },
    operation: 'rollback',
    pageSize: 5,
    maxPages: 1,
  });
  let rollbackCalls = 0;
  const result = await executeMigrationPlan({
    backend: {
      rollbackEntry: async () => {
        rollbackCalls += 1;
        return {verified: true};
      },
    },
    options: executionOptions(report),
    report,
  });
  assert.equal(report.entries[0].status, 'already-rolled-back');
  assert.equal(rollbackCalls, 0);
  assert.deepEqual(result, {processed: 1, complete: true});
});
