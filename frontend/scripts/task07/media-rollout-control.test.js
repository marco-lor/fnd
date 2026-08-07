'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const mediaPolicy = require('../../functions/src/mediaPolicy.json');
const {
  PRODUCTION_STORAGE_BUCKET,
  PLAN_VERSION,
  POLICY_HASH,
  REPORT_SCHEMA_VERSION,
  SOURCE_KEYS,
  computePlanFingerprint,
} = require('./media-derivative-backfill');
const {
  CANONICAL_ONLY_CONTROL,
  LEGACY_CONTROL,
  V1_WRITE_CONTROL,
  assertApprovedPlan,
  assertFreshVerification,
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
  validateVerificationReport,
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
      imagePath: 'characters/character-owner.png',
    }, {
      id: 'placement-custom',
      tokenId: 'custom-instance',
      ownerUid: 'custom-owner',
      imagePath: 'grigliata/tokens/custom.png',
    }, {
      id: 'placement-foe',
      tokenId: 'foe-token',
      ownerUid: 'dm-one',
      imagePath: 'foes/foe-token.png',
    }],
  })
);

const baseArgs = (extra = []) => [
  '--project', 'fatins',
  '--mode', 'legacy',
  '--auth', 'firebase-cli',
  '--allow-live-project',
  '--confirm-project', 'fatins',
  '--webmaster-uid', UID,
  '--confirm-webmaster-uid', UID,
  ...extra,
];

const verifiedEntry = ({
  receiptId = 'r_verified',
  sourceKey = 'catalog-items',
  targetPath = '',
} = {}) => ({
  receiptId,
  sourceKey,
  subjectHash: 'a'.repeat(64),
  assetId: `m_${'b'.repeat(40)}`,
  previousAssetId: null,
  targetPath: targetPath || (
    sourceKey === 'catalog-items' ? 'items/item' : 'users/user'
  ),
  targetSlot: 'media',
  receiptState: 'attached',
  proofs: {
    generatedObjectsPresent: true,
    legacySourceUnchanged: true,
    legacyGeneralImageUrlUnchanged: true,
    itemOriginalGenerated: true,
    itemCardGenerated: true,
    itemCard2xGenerated: true,
    placementReferenceCount: sourceKey === 'foe-tokens' ? 1 : null,
    placementReferenceHash: sourceKey === 'foe-tokens' ? 'd'.repeat(64) : null,
    sourceFoeFingerprint: sourceKey === 'foe-tokens' ? 'e'.repeat(64) : null,
  },
  inspectionHash: 'c'.repeat(64),
  status: 'verified',
  issues: [],
});

const verificationReport = (entries = [verifiedEntry()]) => {
  const report = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    planVersion: PLAN_VERSION,
    policyVersion: mediaPolicy.policyVersion,
    policyHash: POLICY_HASH,
    operation: 'verify',
    projectId: 'fatins',
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
      pagesBySource: {receipts: 1},
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
    '--project', 'fatin-test', '--mode', 'legacy',
  ]), /accepts only project fatins/);
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
    '--verification-report', 'verification.json',
    '--verification-fingerprint', 'd'.repeat(64),
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
    projectId: 'fatins',
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

test('zero-error all-source verification binds every immutable proof', () => {
  const report = verificationReport();
  const evidence = validateVerificationReport({
    report,
    fingerprint: report.planFingerprint,
    expectedCandidates: 1,
    webmasterUid: UID,
  });
  assert.equal(evidence.verifiedReceipts, 1);
  assert.deepEqual(evidence.sourceKeys, SOURCE_KEYS);
  assert.match(evidence.proofHash, /^[a-f0-9]{64}$/);
  for (const proof of [
    'generatedObjectsPresent',
    'legacySourceUnchanged',
    'legacyGeneralImageUrlUnchanged',
    'itemOriginalGenerated',
    'itemCardGenerated',
    'itemCard2xGenerated',
  ]) {
    const brokenEntry = verifiedEntry();
    brokenEntry.proofs[proof] = false;
    const broken = verificationReport([brokenEntry]);
    assert.throws(() => validateVerificationReport({
      report: broken,
      fingerprint: broken.planFingerprint,
      expectedCandidates: 1,
      webmasterUid: UID,
    }), /zero-error, all-source/);
  }
});

test('token activation proves relational paths, root receipts, and nested non-rendering', () => {
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
  const report = verificationReport([
    verifiedEntry({
      receiptId: 'r_custom',
      sourceKey: 'custom-token-templates',
    }),
    verifiedEntry({receiptId: 'r_foe', sourceKey: 'foe-tokens'}),
  ]);
  report.entries[0].targetPath = 'grigliata_tokens/custom-template';
  report.entries[1].targetPath = 'grigliata_tokens/foe-token';
  const evidence = assertTokenActivationCoverage({
    coverage,
    verificationReport: report,
  });
  assert.equal(evidence.counts.nestedFoeLegacyOccurrences, 1);
  assert.match(evidence.relationshipHash, /^[a-f0-9]{64}$/);
  assert.match(evidence.placementReferenceHash, /^[a-f0-9]{64}$/);
  assert.match(evidence.receiptTargetsHash, /^[a-f0-9]{64}$/);
  assert.match(evidence.runtimeProofHash, /^[a-f0-9]{64}$/);
});

test('token activation fails closed on runtime or receipt coverage gaps', () => {
  const runtimeBlocked = tokenCoverageFixture({
    ...completeRuntimeProof,
    characterTokensResolveUserCanonical: false,
  });
  assert.ok(runtimeBlocked.issues.includes(
    'token-runtime-relational-proof-missing'
  ));
  assert.throws(() => assertTokenActivationCoverage({
    coverage: runtimeBlocked,
    verificationReport: verificationReport([]),
  }), /token coverage is blocked/);

  const coverage = tokenCoverageFixture();
  assert.throws(() => assertTokenActivationCoverage({
    coverage,
    verificationReport: verificationReport([
      verifiedEntry({sourceKey: 'custom-token-templates'}),
    ]),
  }), /token-receipt-coverage-mismatch/);
});

test('music activation binds every current track to one verified receipt', () => {
  const tracks = Array.from({length: 7}, (_, index) => ({
    id: `track-${index + 1}`,
    createdBy: 'dm-one',
    audioPath: `grigliata/music/track-${index + 1}.mp3`,
    media: canonicalMedia(String(index + 1)),
  }));
  const coverage = evaluateMusicCoverage({tracks});
  const report = verificationReport(tracks.map((track, index) => (
    verifiedEntry({
      receiptId: `r_music_${index + 1}`,
      sourceKey: 'music-tracks',
      targetPath: `grigliata_music_tracks/${track.id}`,
    })
  )));
  const evidence = assertMusicActivationCoverage({
    coverage,
    verificationReport: report,
  });
  assert.deepEqual(evidence.counts, {tracks: 7, canonicalTracks: 7});
  assert.match(evidence.relationshipHash, /^[a-f0-9]{64}$/);
  assert.match(evidence.receiptTargetsHash, /^[a-f0-9]{64}$/);

  const missingReceipt = verificationReport(report.entries.slice(1));
  assert.throws(() => assertMusicActivationCoverage({
    coverage,
    verificationReport: missingReceipt,
  }), /music-receipt-coverage-mismatch/);
  assert.throws(() => assertMusicActivationCoverage({
    coverage: evaluateMusicCoverage({
      tracks: tracks.map((track, index) => (
        index === 0 ? {...track, media: null} : track
      )),
    }),
    verificationReport: report,
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
  const tokenReport = verificationReport([
    verifiedEntry({
      receiptId: 'r_custom',
      sourceKey: 'custom-token-templates',
      targetPath: 'grigliata_tokens/custom-template',
    }),
    verifiedEntry({
      receiptId: 'r_foe',
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
  const musicReport = verificationReport([verifiedEntry({
    receiptId: 'r_music',
    sourceKey: 'music-tracks',
    targetPath: 'grigliata_music_tracks/track-one',
  })]);
  const verificationEvidence = {
    tokenCoverage: assertTokenActivationCoverage({
      coverage: tokenCoverage,
      verificationReport: tokenReport,
    }),
    musicCoverage: assertMusicActivationCoverage({
      coverage: musicCoverage,
      verificationReport: musicReport,
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

test('verification rejects source, count, owner, fingerprint, and freshness drift', () => {
  const report = verificationReport();
  const cases = [
    {...report, sourceKeys: SOURCE_KEYS.slice(1)},
    {...report, expectedCandidates: 2},
    {...report, catalogOwnerUid: 'other'},
    {...report, counts: {...report.counts, errors: 1}},
  ];
  for (const value of cases) {
    value.planFingerprint = computePlanFingerprint(value);
    assert.throws(() => validateVerificationReport({
      report: value,
      fingerprint: value.planFingerprint,
      expectedCandidates: 1,
      webmasterUid: UID,
    }), /zero-error, all-source/);
  }
  assert.throws(() => validateVerificationReport({
    report,
    fingerprint: 'f'.repeat(64),
    expectedCandidates: 1,
    webmasterUid: UID,
  }), /zero-error, all-source/);
  assert.equal(assertFreshVerification({reviewed: report, fresh: report}), report);
  assert.throws(() => assertFreshVerification({
    reviewed: report,
    fresh: {...report, entries: []},
  }), /stale/);
});

test('fingerprinted control plans bind current state and verification evidence', () => {
  const report = verificationReport();
  const evidence = validateVerificationReport({
    report,
    fingerprint: report.planFingerprint,
    expectedCandidates: 1,
    webmasterUid: UID,
  });
  const plan = buildPlan({
    projectId: 'fatins',
    mode: 'canonical-only',
    snapshot: {exists: false, data: null, updateTime: null},
    verificationEvidence: evidence,
  });
  assert.equal(plan.beforeKind, 'legacy');
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
    projectId: 'fatins',
    mode: 'legacy',
    snapshot: {
      exists: true,
      data: CANONICAL_ONLY_CONTROL,
      updateTime: '2026-08-01T00:00:00.000Z',
    },
  });
  assert.deepEqual(rollback.afterControl, LEGACY_CONTROL);
  assert.equal(rollback.verificationEvidence, null);
  const writeStage = buildPlan({
    projectId: 'fatins',
    mode: 'v1-write',
    snapshot: {exists: false, data: null, updateTime: null},
  });
  assert.equal(writeStage.beforeKind, 'legacy');
  assert.deepEqual(writeStage.afterControl, V1_WRITE_CONTROL);
});

test('control plan refuses malformed and already-selected control states', () => {
  assert.throws(() => buildPlan({
    projectId: 'fatins',
    mode: 'canonical-only',
    snapshot: {exists: true, data: {mode: 'v1-write'}, updateTime: null},
    verificationEvidence: {verifiedReceipts: 1},
  }), /malformed/);
  assert.throws(() => buildPlan({
    projectId: 'fatins',
    mode: 'canonical-only',
    snapshot: {exists: true, data: CANONICAL_ONLY_CONTROL, updateTime: null},
    verificationEvidence: {verifiedReceipts: 1},
  }), /already canonical-only/);
  assert.throws(() => buildPlan({
    projectId: 'fatins',
    mode: 'legacy',
    snapshot: {exists: false, data: null, updateTime: null},
  }), /already legacy/);
  assert.throws(() => buildPlan({
    projectId: 'fatins',
    mode: 'v1-write',
    snapshot: {
      exists: true,
      data: V1_WRITE_CONTROL,
      updateTime: null,
    },
  }), /already v1-write/);
  assert.throws(() => buildPlan({
    projectId: 'fatins',
    mode: 'v1-write',
    snapshot: {
      exists: true,
      data: CANONICAL_ONLY_CONTROL,
      updateTime: null,
    },
  }), /only from exact legacy/);
});
