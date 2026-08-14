'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const mediaPolicy = require('../../functions/src/mediaPolicy.json');
const {
  CANONICAL_AUDIT_VERSION,
  PRODUCTION_STORAGE_BUCKET,
  PLAN_VERSION,
  POLICY_HASH,
  REPORT_SCHEMA_VERSION,
  SOURCE_KEYS,
  canonicalHash,
  computePlanFingerprint,
} = require('./media-derivative-backfill');
const {
  CANONICAL_ONLY_CONTROL,
  LEGACY_CONTROL,
  V1_WRITE_CONTROL,
  assertApprovedPlan,
  assertCanonicalBindingSnapshotsFresh,
  assertFreshCanonicalAudit,
  assertMusicActivationCoverage,
  assertMusicStreamActivationReady,
  assertRuntimeCoverageFresh,
  assertSafeTarget,
  assertTokenActivationCoverage,
  buildPlan,
  controlKind,
  evaluateMusicCoverage,
  evaluateMusicStreamReadiness,
  evaluateTokenCoverage,
  parseArguments,
  validateCanonicalAuditReport,
  waitForMusicStreamActivationReady,
} = require('./media-rollout-control');

const UID = 'test-webmaster-uid';
const canonicalMedia = (seed) => ({
  schemaVersion: 1,
  contractVersion: 1,
  state: 'ready',
  assetId: `m_${seed.repeat(40).slice(0, 40)}`,
  original: {path: `media_assets/${seed}/original`},
});
const firebaseStorageUrl = (
  objectPath,
  bucket = PRODUCTION_STORAGE_BUCKET
) => (
  `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/` +
  `${encodeURIComponent(objectPath)}?alt=media`
);

const completeRuntimeProof = {
  schemaVersion: 1,
  characterTokensResolveUserCanonical: true,
  customInstancesResolveTemplateCanonical: true,
  foeTokensPreferOwnCanonical: true,
  placementsResolveTokenCanonical: true,
  foeNestedLegacyMediaCanonicalOnly: 'non-rendering',
};

const tokenCoverageFixture = (runtimeProof = completeRuntimeProof) => (
  evaluateTokenCoverage({
    runtimeProof,
    users: [{
      id: 'character-owner',
      imagePath: 'characters/character-owner.png',
      media: canonicalMedia('a'),
    }],
    tokens: [{
      id: 'character-token',
      tokenType: 'character',
      ownerUid: 'character-owner',
      characterId: 'character-owner',
      imagePath: 'characters/character-owner.png',
    }, {
      id: 'custom-template',
      tokenType: 'custom',
      ownerUid: 'custom-owner',
      customTokenRole: 'template',
      customTemplateId: 'custom-template',
      imagePath: 'grigliata/tokens/custom.png',
      media: canonicalMedia('b'),
    }, {
      id: 'custom-instance',
      tokenType: 'custom',
      ownerUid: 'custom-owner',
      customTokenRole: 'instance',
      customTemplateId: 'custom-template',
      imagePath: 'grigliata/tokens/custom.png',
    }, {
      id: 'foe-token',
      tokenType: 'foe',
      ownerUid: 'dm-one',
      imagePath: 'foes/foe-token.png',
      media: canonicalMedia('c'),
      tecniche: [{image_url: 'foes/nested-technique.png'}],
    }, {
      id: 'foe-token-unplaced',
      tokenType: 'foe',
      ownerUid: 'dm-one',
      imagePath: 'foes/unplaced.png',
      tecniche: [],
      // Deliberately legacy-only: unplaced roots are preserved exclusions.
    }],
    placements: [{
      id: 'placement-character',
      tokenId: 'character-token',
      ownerUid: 'character-owner',
    }, {
      id: 'placement-custom',
      tokenId: 'custom-instance',
      ownerUid: 'custom-owner',
    }, {
      id: 'placement-foe',
      tokenId: 'foe-token',
      ownerUid: 'dm-one',
      imagePath: 'foes/foe-token.png',
    }],
  })
);

const baseArgs = (extra = []) => [
  '--project', 'fatin-test',
  '--mode', 'legacy',
  '--auth', 'firebase-cli',
  '--allow-live-project',
  '--confirm-project', 'fatin-test',
  '--webmaster-uid', UID,
  '--confirm-webmaster-uid', UID,
  ...extra,
];

const auditedEntry = ({
  sourceKey = 'catalog-items',
  targetPath = '',
} = {}) => {
  const resolvedTarget = targetPath || (
    sourceKey === 'catalog-items' ? 'items/item' :
      sourceKey === 'music-tracks' ?
        'grigliata_music_tracks/track' :
        ['custom-token-templates', 'foe-tokens'].includes(sourceKey) ?
          `grigliata_tokens/${sourceKey}` :
          'users/user'
  );
  const seed = canonicalHash({sourceKey, resolvedTarget});
  const assetId = `m_${seed.slice(0, 40)}`;
  const core = {
    sourceKey,
    kind: sourceKey === 'music-tracks' ? 'music' :
      ['custom-token-templates', 'foe-tokens'].includes(sourceKey) ?
        'token' : 'item',
    commonTechnique: false,
    referenceScope: sourceKey === 'catalog-items' ? 'global-catalog' : null,
    entityId: resolvedTarget.split('/').at(-1),
    ownerUid: UID,
    ownerResolution: 'explicit',
    ownerRole: 'webmaster',
    ownerVersion: '9:000000001',
    targetPath: resolvedTarget,
    targetVersion: '10:000000001',
    targetSlot: 'media',
    targetRevision: 1,
    targetFingerprint: 'a'.repeat(64),
    assetId,
    manifestPath: `media_assets/${assetId}`,
    manifestVersion: '11:000000002',
    manifestFingerprint: 'b'.repeat(64),
    descriptorFingerprint: 'c'.repeat(64),
    objectProofs: [{
      role: 'original',
      path: `media_assets/v1/signed-in/${UID}/${assetId}/1/original`,
      descriptorFingerprint: 'd'.repeat(64),
      objectFingerprint: 'e'.repeat(64),
      validationErrors: [],
      verified: true,
    }],
    legacySources: [],
    placementReferenceCount: sourceKey === 'foe-tokens' ? 1 : null,
    placementReferenceHash: sourceKey === 'foe-tokens' ?
      'f'.repeat(64) : null,
    sourceFoeFingerprint: sourceKey === 'foe-tokens' ?
      '1'.repeat(64) : null,
  };
  const auditHash = canonicalHash(core);
  return {
    auditId: `a_${auditHash.slice(0, 40)}`,
    ...core,
    auditHash,
    status: 'verified',
    issues: [],
  };
};

const canonicalAuditReport = (entries = [auditedEntry()]) => {
  const report = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    planVersion: PLAN_VERSION,
    policyVersion: mediaPolicy.policyVersion,
    policyHash: POLICY_HASH,
    operation: 'canonical-audit',
    canonicalAuditVersion: CANONICAL_AUDIT_VERSION,
    projectId: 'fatin-test',
    storageBucket: PRODUCTION_STORAGE_BUCKET,
    sourceKeys: [...SOURCE_KEYS],
    catalogOwnerUid: UID,
    expectedCandidates: entries.length,
    mode: 'dry-run',
    complete: true,
    scan: {
      complete: true,
      pageSize: 25,
      maxPages: 20,
      concurrency: 1,
      pagesBySource: Object.fromEntries(SOURCE_KEYS.map((key) => [key, 1])),
      truncatedSources: [],
    },
    counts: {
      records: entries.length,
      candidates: entries.length,
      excluded: 0,
      discovered: entries.length,
      executable: 0,
      skipped: entries.length,
      errors: 0,
    },
    entries,
    excluded: [],
  };
  return {...report, planFingerprint: computePlanFingerprint(report)};
};

test('CLI is dry-run by default and hard-locks the isolated project', () => {
  const options = parseArguments(baseArgs());
  assert.equal(options.execute, false);
  assert.equal(options.authMode, 'firebase-cli');
  assert.throws(() => parseArguments([
    '--project', 'wrong-project', '--mode', 'legacy',
  ]), /accepts only project fatin-test/);
  assert.throws(() => parseArguments(baseArgs([
    '--mode', 'derivative-read',
  ])), /--mode must be exactly/);
  assert.equal(parseArguments(baseArgs([
    '--mode', 'v1-write',
  ])).mode, 'v1-write');
  assert.throws(() => parseArguments(baseArgs([
    '--mode', 'canonical-only',
  ])), /canonical-only requires/);
});

test('canonical-only CLI binds reviewed verification and execution hashes', () => {
  const options = parseArguments(baseArgs([
    '--mode', 'canonical-only',
    '--canonical-audit-report', 'canonical-audit.json',
    '--canonical-audit-fingerprint', 'd'.repeat(64),
    '--expected-candidates', '7',
  ]));
  assert.equal(options.expectedCandidates, 7);
  assert.equal(options.execute, false);
  assert.throws(() => parseArguments(baseArgs([
    '--execute',
  ])), /approve-fingerprint/);
  assert.equal(parseArguments(baseArgs([
    '--execute',
    '--approve-fingerprint', 'e'.repeat(64),
  ])).execute, true);
});

test('live target requires exact project, CLI auth, UID, and no emulators', () => {
  const options = parseArguments(baseArgs());
  assert.deepEqual(assertSafeTarget(options, {}), {
    live: true,
    projectId: 'fatin-test',
    storageBucket: PRODUCTION_STORAGE_BUCKET,
  });
  assert.throws(() => assertSafeTarget({...options, authMode: 'admin'}, {}),
    /--auth firebase-cli/);
  assert.throws(() => assertSafeTarget({
    ...options,
    confirmWebmasterUid: 'different',
  }, {}), /exact --confirm-webmaster-uid/);
  assert.throws(() => assertSafeTarget(options, {
    FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:9199',
  }), /refuses all emulator/);
});

test('control contracts are exact v1-write, canonical-only, and legacy', () => {
  assert.deepEqual(V1_WRITE_CONTROL, {
    schemaVersion: 1,
    policyVersion: mediaPolicy.policyVersion,
    mode: 'v1-write',
    enabledPurposes: ['*'],
    enabledRoles: ['*'],
    enabledUids: ['*'],
  });
  assert.deepEqual(CANONICAL_ONLY_CONTROL, {
    schemaVersion: 1,
    policyVersion: mediaPolicy.policyVersion,
    mode: 'canonical-only',
    enabledPurposes: ['*'],
    enabledRoles: ['*'],
    enabledUids: ['*'],
  });
  assert.deepEqual(LEGACY_CONTROL, {
    schemaVersion: 1,
    policyVersion: mediaPolicy.policyVersion,
    mode: 'legacy',
    enabledPurposes: [],
    enabledRoles: [],
    enabledUids: [],
  });
  assert.equal(controlKind(CANONICAL_ONLY_CONTROL), 'canonical-only');
  assert.equal(controlKind(V1_WRITE_CONTROL), 'v1-write');
  assert.equal(controlKind(LEGACY_CONTROL), 'legacy');
  assert.equal(controlKind({mode: 'v1-write'}), 'malformed');
});

test('zero-error active audit binds every immutable proof and version', () => {
  const report = canonicalAuditReport();
  const evidence = validateCanonicalAuditReport({
    report,
    fingerprint: report.planFingerprint,
    expectedCandidates: 1,
    webmasterUid: UID,
  });
  assert.equal(evidence.auditedTargets, 1);
  assert.deepEqual(evidence.sourceKeys, SOURCE_KEYS);
  assert.match(evidence.proofHash, /^[a-f0-9]{64}$/);
  for (const breakEntry of [
    (entry) => { entry.objectProofs[0].verified = false; },
    (entry) => { entry.targetVersion = ''; },
    (entry) => { entry.manifestVersion = ''; },
    (entry) => { entry.descriptorFingerprint = ''; },
  ]) {
    const brokenEntry = auditedEntry();
    breakEntry(brokenEntry);
    const broken = canonicalAuditReport([brokenEntry]);
    assert.throws(() => validateCanonicalAuditReport({
      report: broken,
      fingerprint: broken.planFingerprint,
      expectedCandidates: 1,
      webmasterUid: UID,
    }), /zero-error, all-source/);
  }
});

test('transaction fence rejects target, manifest, or owner version drift', () => {
  const report = canonicalAuditReport();
  const evidence = validateCanonicalAuditReport({
    report,
    fingerprint: report.planFingerprint,
    expectedCandidates: 1,
    webmasterUid: UID,
  });
  const snapshots = evidence.bindingDocuments.map((binding) => {
    const [seconds, nanoseconds] = binding.version.split(':').map(Number);
    return {
      exists: true,
      ref: {path: binding.path},
      updateTime: {seconds, nanoseconds},
    };
  });
  assert.deepEqual(
    evidence.bindingDocuments.filter(({type}) => type === 'owner'),
    [{type: 'owner', path: `users/${UID}`, version: '9:000000001'}]
  );
  assert.equal(assertCanonicalBindingSnapshotsFresh({
    bindings: evidence.bindingDocuments,
    snapshots,
  }), true);
  assert.throws(() => assertCanonicalBindingSnapshotsFresh({
    bindings: evidence.bindingDocuments,
    snapshots: snapshots.map((snapshot, index) => index === 0 ? {
      ...snapshot,
      updateTime: {seconds: 99, nanoseconds: 0},
    } : snapshot),
  }), /changed after audit/);
});

test('token activation proves relational paths, audited roots, and nested non-rendering', () => {
  const coverage = tokenCoverageFixture();
  assert.deepEqual(coverage.issues, []);
  assert.deepEqual(coverage.counts, {
    tokens: 5,
    characterTokens: 1,
    customTemplates: 1,
    customInstances: 1,
    foeTokens: 2,
    placedFoeTokens: 1,
    unplacedFoeTokens: 1,
    placements: 3,
    nestedFoeLegacyOccurrences: 1,
    nestedFoeLegacyUniquePaths: 1,
  });
  const report = canonicalAuditReport([
    auditedEntry({
      sourceKey: 'custom-token-templates',
      targetPath: 'grigliata_tokens/custom-template',
    }),
    auditedEntry({
      sourceKey: 'foe-tokens',
      targetPath: 'grigliata_tokens/foe-token',
    }),
  ]);
  const evidence = assertTokenActivationCoverage({
    coverage,
    auditReport: report,
  });
  assert.equal(evidence.counts.nestedFoeLegacyOccurrences, 1);
  assert.match(evidence.relationshipHash, /^[a-f0-9]{64}$/);
  assert.match(evidence.placementReferenceHash, /^[a-f0-9]{64}$/);
  assert.match(evidence.auditTargetsHash, /^[a-f0-9]{64}$/);
  assert.match(evidence.runtimeProofHash, /^[a-f0-9]{64}$/);
});

test('token activation fails closed on runtime or audit coverage gaps', () => {
  const runtimeBlocked = tokenCoverageFixture({
    ...completeRuntimeProof,
    characterTokensResolveUserCanonical: false,
  });
  assert.ok(runtimeBlocked.issues.includes(
    'token-runtime-relational-proof-missing'
  ));

  const stalePlacement = evaluateTokenCoverage({
    runtimeProof: completeRuntimeProof,
    storageContext: {
      expectedBucket: PRODUCTION_STORAGE_BUCKET,
      allowLoopback: false,
    },
    tokens: [{
      id: 'placed-foe',
      tokenType: 'foe',
      ownerUid: 'dm-one',
      imageUrl: firebaseStorageUrl('foes/current.png'),
      media: canonicalMedia('d'),
    }],
    placements: [{
      id: 'map-one__placed-foe',
      backgroundId: 'map-one',
      tokenId: 'placed-foe',
      ownerUid: 'dm-one',
      imageUrl: firebaseStorageUrl('foes/stale.png'),
    }],
  });
  assert.ok(stalePlacement.issues.includes('placement-token-path-mismatch'));
  const foreignPlacement = evaluateTokenCoverage({
    runtimeProof: completeRuntimeProof,
    storageContext: {
      expectedBucket: PRODUCTION_STORAGE_BUCKET,
      allowLoopback: false,
    },
    tokens: [{
      id: 'placed-foe',
      tokenType: 'foe',
      ownerUid: 'dm-one',
      imageUrl: firebaseStorageUrl('foes/current.png'),
      media: canonicalMedia('e'),
    }],
    placements: [{
      id: 'map-one__placed-foe',
      backgroundId: 'map-one',
      tokenId: 'placed-foe',
      ownerUid: 'dm-one',
      imageUrl: firebaseStorageUrl(
        'foes/stale.png',
        'foreign-project.firebasestorage.app'
      ),
    }],
  });
  assert.ok(foreignPlacement.issues.includes(
    'placement-media-reference-invalid'
  ));
  assert.throws(() => assertTokenActivationCoverage({
    coverage: runtimeBlocked,
    auditReport: canonicalAuditReport([]),
  }), /token coverage is blocked/);

  const coverage = tokenCoverageFixture();
  assert.throws(() => assertTokenActivationCoverage({
    coverage,
    auditReport: canonicalAuditReport([
      auditedEntry({sourceKey: 'custom-token-templates'}),
    ]),
  }), /token-audit-coverage-mismatch/);
});

test('music activation binds every current track to one audited target', () => {
  const tracks = Array.from({length: 7}, (_, index) => ({
    id: `track-${index + 1}`,
    createdBy: 'dm-one',
    audioPath: `grigliata/music/track-${index + 1}.mp3`,
    media: canonicalMedia(String(index + 1)),
  }));
  const coverage = evaluateMusicCoverage({tracks});
  const report = canonicalAuditReport(tracks.map((track) => (
    auditedEntry({
      sourceKey: 'music-tracks',
      targetPath: `grigliata_music_tracks/${track.id}`,
    })
  )));
  const evidence = assertMusicActivationCoverage({
    coverage,
    auditReport: report,
  });
  assert.deepEqual(evidence.counts, {tracks: 7, canonicalTracks: 7});
  assert.match(evidence.relationshipHash, /^[a-f0-9]{64}$/);
  assert.match(evidence.auditTargetsHash, /^[a-f0-9]{64}$/);

  const missingReceipt = canonicalAuditReport(report.entries.slice(1));
  assert.throws(() => assertMusicActivationCoverage({
    coverage,
    auditReport: missingReceipt,
  }), /music-audit-coverage-mismatch/);
  assert.throws(() => assertMusicActivationCoverage({
    coverage: evaluateMusicCoverage({
      tracks: tracks.map((track, index) => (
        index === 0 ? {...track, media: null} : track
      )),
    }),
    auditReport: report,
  }), /music-track-canonical-missing/);
});

test('post-activation music stream is canonical v2 and legacy-free', async () => {
  const media = {
    ...canonicalMedia('9'),
    kind: 'music',
    generation: '123',
    audience: 'signed-in',
    ownerUid: 'dm-one',
    original: {
      path: `media_assets/v1/signed-in/dm-one/` +
        `m_${'9'.repeat(40)}/123/original`,
      contentType: 'audio/mpeg',
      bytes: 1024,
      durationMs: 60000,
      width: 0,
      height: 0,
      generation: '456',
    },
  };
  const ready = {
    schemaVersion: 2,
    controlMode: 'canonical-only',
    revision: 3,
    sourceHash: 'a'.repeat(64),
    updatedAt: {seconds: 1},
    volume: 0.65,
    sessions: [{
      id: 'track-one',
      status: 'playing',
      trackId: 'track-one',
      trackName: 'Track One',
      mediaAssetId: media.assetId,
      media,
      durationMs: 60000,
      offsetMs: 0,
      loop: false,
      startedAtMs: 1000,
      updatedAtMs: 1000,
    }],
  };
  assert.equal(evaluateMusicStreamReadiness(ready).ready, true);
  const evidence = assertMusicStreamActivationReady(ready);
  assert.deepEqual(evidence.counts, {sessions: 1});
  assert.match(evidence.relationshipHash, /^[a-f0-9]{64}$/);

  assert.equal(evaluateMusicStreamReadiness({
    ...ready,
    controlMode: 'legacy',
  }).ready, false);
  assert.equal(evaluateMusicStreamReadiness({
    ...ready,
    sessions: [{
      ...ready.sessions[0],
      audioUrl: 'https://example.test/legacy.mp3',
    }],
  }).issues.includes('music-stream-legacy-audio-present'), true);
  assert.equal(evaluateMusicStreamReadiness({
    ...ready,
    sessions: [{...ready.sessions[0], mediaAssetId: `m_${'8'.repeat(40)}`}],
  }).issues.includes('music-stream-canonical-media-missing'), true);

  let elapsed = 0;
  let reads = 0;
  const waited = await waitForMusicStreamActivationReady({
    readStream: async () => (++reads === 1 ? null : ready),
    timeoutMs: 20,
    pollMs: 10,
    now: () => elapsed,
    sleep: async (milliseconds) => { elapsed += milliseconds; },
  });
  assert.equal(reads, 2);
  assert.deepEqual(waited.counts, {sessions: 1});
  await assert.rejects(() => waitForMusicStreamActivationReady({
    readStream: async () => null,
    timeoutMs: 20,
    pollMs: 10,
    now: () => elapsed,
    sleep: async (milliseconds) => { elapsed += milliseconds; },
  }), /control was written.*timed out/i);
});

test('transaction-time runtime proof rejects placement or music drift', () => {
  const tokenCoverage = tokenCoverageFixture();
  const tokenReport = canonicalAuditReport([
    auditedEntry({
      sourceKey: 'custom-token-templates',
      targetPath: 'grigliata_tokens/custom-template',
    }),
    auditedEntry({
      sourceKey: 'foe-tokens',
      targetPath: 'grigliata_tokens/foe-token',
    }),
  ]);
  const tracks = [{
    id: 'track-one',
    createdBy: 'dm-one',
    audioPath: 'grigliata/music/track-one.mp3',
    media: canonicalMedia('9'),
  }];
  const musicCoverage = evaluateMusicCoverage({tracks});
  const musicReport = canonicalAuditReport([auditedEntry({
    sourceKey: 'music-tracks',
    targetPath: 'grigliata_music_tracks/track-one',
  })]);
  const verificationEvidence = {
    tokenCoverage: assertTokenActivationCoverage({
      coverage: tokenCoverage,
      auditReport: tokenReport,
    }),
    musicCoverage: assertMusicActivationCoverage({
      coverage: musicCoverage,
      auditReport: musicReport,
    }),
  };
  assert.doesNotThrow(() => assertRuntimeCoverageFresh({
    verificationEvidence,
    tokenCoverage,
    musicCoverage,
  }));
  assert.throws(() => assertRuntimeCoverageFresh({
    verificationEvidence,
    tokenCoverage: {
      ...tokenCoverage,
      placementReferenceHash: '0'.repeat(64),
    },
    musicCoverage,
  }), /changed after approval/);
  assert.throws(() => assertRuntimeCoverageFresh({
    verificationEvidence,
    tokenCoverage,
    musicCoverage: evaluateMusicCoverage({tracks: []}),
  }), /changed after approval/);
  assert.throws(() => assertRuntimeCoverageFresh({
    verificationEvidence,
    tokenCoverage,
    musicCoverage: evaluateMusicCoverage({
      tracks: [{
        ...tracks[0],
        media: {
          ...tracks[0].media,
          original: {
            ...tracks[0].media.original,
            path: 'media_assets/tampered-but-nonempty/original',
          },
        },
      }],
    }),
  }), /changed after approval/);
});

test('active audit rejects source, count, owner, fingerprint, and freshness drift', () => {
  const report = canonicalAuditReport();
  assert.notEqual(computePlanFingerprint({
    ...report,
    canonicalAuditVersion: CANONICAL_AUDIT_VERSION + 1,
  }), report.planFingerprint);
  const cases = [
    {...report, canonicalAuditVersion: CANONICAL_AUDIT_VERSION + 1},
    {...report, sourceKeys: SOURCE_KEYS.slice(1)},
    {...report, expectedCandidates: 2},
    {...report, catalogOwnerUid: 'other'},
    {...report, counts: {...report.counts, errors: 1}},
  ];
  for (const value of cases) {
    value.planFingerprint = computePlanFingerprint(value);
    assert.throws(() => validateCanonicalAuditReport({
      report: value,
      fingerprint: value.planFingerprint,
      expectedCandidates: 1,
      webmasterUid: UID,
    }), /zero-error, all-source/);
  }
  assert.throws(() => validateCanonicalAuditReport({
    report,
    fingerprint: 'f'.repeat(64),
    expectedCandidates: 1,
    webmasterUid: UID,
  }), /zero-error, all-source/);
  assert.equal(assertFreshCanonicalAudit({reviewed: report, fresh: report}), report);
  assert.throws(() => assertFreshCanonicalAudit({
    reviewed: report,
    fresh: {...report, entries: []},
  }), /stale/);
});

test('active audit accepts global ownership bound by the attached manifest', () => {
  const original = auditedEntry();
  const {auditId, auditHash, status, issues, ...core} = original;
  const attachedCore = {...core, ownerResolution: 'attached-manifest'};
  const attachedHash = canonicalHash(attachedCore);
  const report = canonicalAuditReport([{
    auditId: `a_${attachedHash.slice(0, 40)}`,
    ...attachedCore,
    auditHash: attachedHash,
    status,
    issues,
  }]);
  assert.doesNotThrow(() => validateCanonicalAuditReport({
    report,
    fingerprint: report.planFingerprint,
    expectedCandidates: 1,
    webmasterUid: UID,
  }));
});

test('fingerprinted control plans bind current state and canonical evidence', () => {
  const report = canonicalAuditReport();
  const evidence = validateCanonicalAuditReport({
    report,
    fingerprint: report.planFingerprint,
    expectedCandidates: 1,
    webmasterUid: UID,
  });
  const plan = buildPlan({
    projectId: 'fatin-test',
    mode: 'canonical-only',
    snapshot: {
      exists: true,
      data: V1_WRITE_CONTROL,
      updateTime: '2026-08-01T00:00:00.000Z',
    },
    verificationEvidence: evidence,
  });
  assert.equal(plan.beforeKind, 'v1-write');
  assert.deepEqual(plan.afterControl, CANONICAL_ONLY_CONTROL);
  assert.doesNotThrow(() => assertApprovedPlan({
    approved: plan,
    current: plan,
    fingerprint: plan.planFingerprint,
  }));
  assert.throws(() => assertApprovedPlan({
    approved: plan,
    current: {...plan, beforeUpdateTime: 'changed'},
    fingerprint: plan.planFingerprint,
  }), /no longer matches/);
  const rollback = buildPlan({
    projectId: 'fatin-test',
    mode: 'v1-write',
    snapshot: {
      exists: true,
      data: CANONICAL_ONLY_CONTROL,
      updateTime: '2026-08-01T00:00:00.000Z',
    },
  });
  assert.deepEqual(rollback.afterControl, V1_WRITE_CONTROL);
  assert.equal(rollback.verificationEvidence, null);
  const writeStage = buildPlan({
    projectId: 'fatin-test',
    mode: 'v1-write',
    snapshot: {exists: false, data: null, updateTime: null},
  });
  assert.equal(writeStage.beforeKind, 'legacy');
  assert.deepEqual(writeStage.afterControl, V1_WRITE_CONTROL);
});

test('control plan refuses malformed and already-selected control states', () => {
  assert.throws(() => buildPlan({
    projectId: 'fatin-test',
    mode: 'canonical-only',
    snapshot: {exists: false, data: null, updateTime: null},
    verificationEvidence: {auditedTargets: 1},
  }), /exact active v1-write/);
  assert.throws(() => buildPlan({
    projectId: 'fatin-test',
    mode: 'canonical-only',
    snapshot: {exists: true, data: LEGACY_CONTROL, updateTime: null},
    verificationEvidence: {auditedTargets: 1},
  }), /exact active v1-write/);
  assert.throws(() => buildPlan({
    projectId: 'fatin-test',
    mode: 'canonical-only',
    snapshot: {exists: true, data: {mode: 'v1-write'}, updateTime: null},
    verificationEvidence: {auditedTargets: 1},
  }), /malformed/);
  assert.throws(() => buildPlan({
    projectId: 'fatin-test',
    mode: 'canonical-only',
    snapshot: {exists: true, data: CANONICAL_ONLY_CONTROL, updateTime: null},
    verificationEvidence: {auditedTargets: 1},
  }), /already canonical-only/);
  assert.throws(() => buildPlan({
    projectId: 'fatin-test',
    mode: 'legacy',
    snapshot: {exists: false, data: null, updateTime: null},
  }), /legacy rollback is not supported/);
  assert.throws(() => buildPlan({
    projectId: 'fatin-test',
    mode: 'v1-write',
    snapshot: {
      exists: true,
      data: V1_WRITE_CONTROL,
      updateTime: null,
    },
  }), /already v1-write/);
  const safeReadRollback = buildPlan({
    projectId: 'fatin-test',
    mode: 'v1-write',
    snapshot: {
      exists: true,
      data: CANONICAL_ONLY_CONTROL,
      updateTime: null,
    },
  });
  assert.equal(safeReadRollback.beforeKind, 'canonical-only');
  assert.deepEqual(safeReadRollback.afterControl, V1_WRITE_CONTROL);
  assert.throws(() => buildPlan({
    projectId: 'fatin-test',
    mode: 'v1-write',
    snapshot: {
      exists: true,
      data: {
        ...CANONICAL_ONLY_CONTROL,
        enabledUids: ['partial'],
      },
      updateTime: null,
    },
  }), /canonical-only rollback state/);
});
