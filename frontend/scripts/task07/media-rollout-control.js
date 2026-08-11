#!/usr/bin/env node

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const mediaPolicy = require('../../functions/src/mediaPolicy.json');
const {
  createFirebaseCliAdcFile,
} = require('../firebase-cli-admin-credential');
const {
  PLAN_VERSION: MIGRATION_PLAN_VERSION,
  POLICY_HASH,
  PRODUCTION_PROJECT_ID,
  PRODUCTION_STORAGE_BUCKET,
  REPORT_SCHEMA_VERSION: MIGRATION_REPORT_SCHEMA_VERSION,
  SOURCE_KEYS,
  assertCandidateCountBinding,
  buildMigrationPlan,
  canonicalHash,
  collectMediaPaths,
  computePlanFingerprint,
  createAdminBackend: createMigrationBackend,
  exactSourceKeys,
  storagePathFromValue,
} = require('./media-derivative-backfill');
const TOKEN_RUNTIME_COVERAGE = require('./token-runtime-coverage.json');

const CONTROL_PATH = 'utils/task07_media';
const CONTROL_PLAN_SCHEMA_VERSION = 1;
const CONTROL_MODES = new Set(['v1-write', 'canonical-only', 'legacy']);
const AUTH_MODES = new Set(['admin', 'firebase-cli']);
const DEFAULT_REPORT_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  'performance-results',
  'task07-media-rollout-control-plan.json'
);

const LEGACY_CONTROL = Object.freeze({
  schemaVersion: 1,
  policyVersion: mediaPolicy.policyVersion,
  mode: 'legacy',
  enabledPurposes: Object.freeze([]),
  enabledRoles: Object.freeze([]),
  enabledUids: Object.freeze([]),
});

const V1_WRITE_CONTROL = Object.freeze({
  schemaVersion: 1,
  policyVersion: mediaPolicy.policyVersion,
  mode: 'v1-write',
  enabledPurposes: Object.freeze(['*']),
  enabledRoles: Object.freeze(['*']),
  enabledUids: Object.freeze(['*']),
});

const CANONICAL_ONLY_CONTROL = Object.freeze({
  schemaVersion: 1,
  policyVersion: mediaPolicy.policyVersion,
  mode: 'canonical-only',
  enabledPurposes: Object.freeze(['*']),
  enabledRoles: Object.freeze(['*']),
  enabledUids: Object.freeze(['*']),
});

const isRecord = (value) => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
);

const TOKEN_COVERAGE_SCHEMA_VERSION = 1;
const MUSIC_COVERAGE_SCHEMA_VERSION = 1;
const MUSIC_STREAM_READINESS_SCHEMA_VERSION = 1;
const MUSIC_STREAM_SCHEMA_VERSION = 2;
const MUSIC_STREAM_READY_TIMEOUT_MS = 2 * 60 * 1000;
const MUSIC_STREAM_READY_POLL_MS = 1000;
const TOKEN_COVERAGE_MAX_DOCUMENTS = 500;
const TOKEN_RECEIPT_SOURCES = new Set([
  'custom-token-templates',
  'foe-tokens',
]);

const canonicalMediaReady = (entity) => {
  const descriptor = isRecord(entity?.media) ? entity.media : null;
  return descriptor?.schemaVersion === 1 &&
    descriptor?.contractVersion === 1 &&
    descriptor?.state === 'ready' &&
    /^m_[a-f0-9]{40}$/.test(String(descriptor?.assetId || '')) &&
    typeof descriptor?.original?.path === 'string' &&
    descriptor.original.path.trim().length > 0;
};

const canonicalMediaHash = (entity) => canonicalMediaReady(entity) ?
  canonicalHash(entity.media) :
  null;

const mainLegacyPaths = (entity) => collectMediaPaths({
  imagePath: entity?.imagePath,
  imageUrl: entity?.imageUrl,
  image_url: entity?.image_url,
  General: {
    imagePath: entity?.General?.imagePath,
    imageUrl: entity?.General?.imageUrl,
    image_url: entity?.General?.image_url,
  },
});

const samePaths = (first, second) => (
  canonicalHash([...first].sort()) === canonicalHash([...second].sort())
);
const byId = (first, second) => String(first?.id || '')
  .localeCompare(String(second?.id || ''));

const countLegacyMediaOccurrences = (value) => {
  let count = 0;
  const visit = (entry, key = '') => {
    if (typeof entry === 'string') {
      if (/^(?:imagePath|imageUrl|image_url|posterPath|posterUrl|videoUrl|video_url|audioPath|audioUrl|storagePath|path|url)$/i
        .test(key) && storagePathFromValue(entry)) count += 1;
      return;
    }
    if (Array.isArray(entry)) {
      entry.forEach((nested) => visit(nested, key));
      return;
    }
    if (!isRecord(entry)) return;
    Object.entries(entry).forEach(([nestedKey, nested]) => {
      if (['media', 'videoMedia'].includes(nestedKey) &&
        Number(nested?.schemaVersion) === 1) return;
      visit(nested, nestedKey);
    });
  };
  visit(value);
  return count;
};

const placementTokenId = (placement) => {
  const explicit = String(placement?.tokenId || '').trim();
  const backgroundId = String(placement?.backgroundId || '').trim();
  const placementId = String(placement?.id || '').trim();
  const prefix = backgroundId ? `${backgroundId}__` : '';
  const inferred = prefix && placementId.startsWith(prefix) ?
    placementId.slice(prefix.length) :
    '';
  return {
    tokenId: explicit || inferred,
    conflict: Boolean(explicit && inferred && explicit !== inferred),
  };
};

const evaluateTokenCoverage = ({
  tokens = [],
  placements = [],
  users = [],
  runtimeProof = TOKEN_RUNTIME_COVERAGE,
}) => {
  const issues = new Set();
  const tokenById = new Map(tokens.map((entry) => [entry.id, entry]));
  const userById = new Map(users.map((entry) => [entry.id, entry]));
  const customTemplates = tokens.filter((entry) => (
    entry.tokenType === 'custom' &&
    entry.customTokenRole !== 'instance' &&
    String(entry.customTemplateId || '').trim() === entry.id
  ));
  const customTemplateById = new Map(
    customTemplates.map((entry) => [entry.id, entry])
  );
  const customInstances = tokens.filter((entry) => (
    entry.tokenType === 'custom' && !customTemplateById.has(entry.id)
  ));
  const characterTokens = tokens.filter(({tokenType}) => (
    tokenType === 'character'
  ));
  const foeTokens = tokens.filter(({tokenType}) => tokenType === 'foe');
  const placementReferences = placements.map((placement) => ({
    id: String(placement.id || '').trim(),
    backgroundId: String(placement.backgroundId || '').trim(),
    ...placementTokenId(placement),
  })).sort(byId);
  if (placementReferences.some(({conflict}) => conflict)) {
    issues.add('placement-token-identity-conflict');
  }
  const placedTokenIds = new Set(
    placementReferences.map(({tokenId}) => tokenId).filter(Boolean)
  );
  const classified = new Set([
    ...customTemplates,
    ...customInstances,
    ...characterTokens,
    ...foeTokens,
  ].map(({id}) => id));
  if (classified.size !== tokens.length) issues.add('unclassified-token');

  customTemplates.forEach((template) => {
    if (!canonicalMediaReady(template)) {
      issues.add('custom-template-canonical-missing');
    }
  });
  customInstances.forEach((instance) => {
    const template = customTemplateById.get(
      String(instance.customTemplateId || '').trim()
    );
    if (!template) {
      issues.add('custom-instance-template-missing');
      return;
    }
    if (String(instance.ownerUid || '').trim() !==
      String(template.ownerUid || '').trim()) {
      issues.add('custom-instance-template-owner-mismatch');
    }
    if (!samePaths(mainLegacyPaths(instance), mainLegacyPaths(template))) {
      issues.add('custom-instance-template-path-mismatch');
    }
  });
  characterTokens.forEach((token) => {
    const characterId = String(token.characterId || '').trim();
    const ownerUid = String(token.ownerUid || '').trim();
    const user = userById.get(characterId) || userById.get(ownerUid);
    if (!characterId || !ownerUid || !user) {
      issues.add('character-token-user-missing');
      return;
    }
    if (!canonicalMediaReady(user)) {
      issues.add('character-user-canonical-missing');
    }
    if (!samePaths(mainLegacyPaths(token), mainLegacyPaths(user))) {
      issues.add('character-token-user-path-mismatch');
    }
  });
  const placedFoeTokens = foeTokens.filter(({id}) => placedTokenIds.has(id));
  const unplacedFoeTokens = foeTokens.filter(({id}) => !placedTokenIds.has(id));
  placedFoeTokens.forEach((token) => {
    if (!canonicalMediaReady(token)) issues.add('foe-token-canonical-missing');
  });
  placements.forEach((placement) => {
    const token = tokenById.get(placementTokenId(placement).tokenId);
    if (!token) {
      issues.add('placement-token-missing');
      return;
    }
    if (String(placement.ownerUid || '').trim() !==
      String(token.ownerUid || '').trim()) {
      issues.add('placement-token-owner-mismatch');
    }
    if (!samePaths(mainLegacyPaths(placement), mainLegacyPaths(token))) {
      issues.add('placement-token-path-mismatch');
    }
  });

  const nestedFoeLegacyPaths = foeTokens.flatMap((token) => (
    collectMediaPaths({
      tecniche: token.tecniche,
      spells: token.spells,
    })
  ));
  const nestedFoeLegacyOccurrences = foeTokens.reduce((total, token) => (
    total + countLegacyMediaOccurrences({
      tecniche: token.tecniche,
      spells: token.spells,
    })
  ), 0);
  if (runtimeProof?.schemaVersion !== TOKEN_COVERAGE_SCHEMA_VERSION ||
    runtimeProof.characterTokensResolveUserCanonical !== true ||
    runtimeProof.customInstancesResolveTemplateCanonical !== true ||
    runtimeProof.foeTokensPreferOwnCanonical !== true ||
    runtimeProof.placementsResolveTokenCanonical !== true) {
    issues.add('token-runtime-relational-proof-missing');
  }
  if (nestedFoeLegacyPaths.length > 0 &&
    runtimeProof?.foeNestedLegacyMediaCanonicalOnly !== 'non-rendering') {
    issues.add('foe-nested-media-runtime-proof-missing');
  }

  return {
    issues: [...issues].sort(),
    counts: {
      tokens: tokens.length,
      characterTokens: characterTokens.length,
      customTemplates: customTemplates.length,
      customInstances: customInstances.length,
      foeTokens: foeTokens.length,
      placedFoeTokens: placedFoeTokens.length,
      unplacedFoeTokens: unplacedFoeTokens.length,
      placements: placements.length,
      nestedFoeLegacyOccurrences,
      nestedFoeLegacyUniquePaths: new Set(nestedFoeLegacyPaths).size,
    },
    requiredReceiptTargets: [
      ...customTemplates,
      ...placedFoeTokens,
    ].map(({id}) => `grigliata_tokens/${id}`).sort(),
    runtimeProofHash: canonicalHash(runtimeProof),
    placementReferenceHash: canonicalHash(placementReferences),
    relationshipHash: canonicalHash({
      tokens: [...tokens].sort(byId).map((entry) => ({
        id: entry.id,
        tokenType: entry.tokenType,
        ownerUid: entry.ownerUid,
        characterId: entry.characterId,
        customTemplateId: entry.customTemplateId,
        paths: mainLegacyPaths(entry),
        canonical: canonicalMediaReady(entry),
        canonicalMediaHash: canonicalMediaHash(entry),
      })),
      placements: [...placements].sort(byId).map((entry) => ({
        id: entry.id,
        backgroundId: entry.backgroundId,
        tokenId: placementTokenId(entry).tokenId,
        ownerUid: entry.ownerUid,
        paths: mainLegacyPaths(entry),
      })),
      users: [...users].sort(byId).map((entry) => ({
        id: entry.id,
        paths: mainLegacyPaths(entry),
        canonical: canonicalMediaReady(entry),
        canonicalMediaHash: canonicalMediaHash(entry),
      })),
    }),
  };
};

const assertTokenActivationCoverage = ({coverage, verificationReport}) => {
  const tokenReceiptTargets = (verificationReport?.entries || [])
    .filter((entry) => TOKEN_RECEIPT_SOURCES.has(entry.sourceKey))
    .map(({targetPath}) => targetPath)
    .sort();
  const requiredReceiptTargets = [...coverage.requiredReceiptTargets].sort();
  const issues = [...coverage.issues];
  if (!samePaths(tokenReceiptTargets, requiredReceiptTargets)) {
    issues.push('token-receipt-coverage-mismatch');
  }
  if (issues.length) {
    throw new Error(
      `canonical-only token coverage is blocked: ${[...new Set(issues)]
        .sort().join(', ')}.`
    );
  }
  return {
    schemaVersion: TOKEN_COVERAGE_SCHEMA_VERSION,
    counts: coverage.counts,
    relationshipHash: coverage.relationshipHash,
    placementReferenceHash: coverage.placementReferenceHash,
    receiptTargetsHash: canonicalHash(tokenReceiptTargets),
    runtimeProofHash: coverage.runtimeProofHash,
  };
};

const musicLegacyPaths = (track) => collectMediaPaths({
  audioPath: track?.audioPath,
  audioUrl: track?.audioUrl,
});

const evaluateMusicCoverage = ({tracks = []} = {}) => {
  const issues = new Set();
  const ids = new Set();
  tracks.forEach((track) => {
    const id = String(track?.id || '').trim();
    if (!id || ids.has(id)) issues.add('music-track-identity-invalid');
    ids.add(id);
    if (!canonicalMediaReady(track)) {
      issues.add('music-track-canonical-missing');
    }
  });
  const requiredReceiptTargets = tracks
    .map(({id}) => `grigliata_music_tracks/${id}`)
    .sort();
  return {
    issues: [...issues].sort(),
    counts: {
      tracks: tracks.length,
      canonicalTracks: tracks.filter(canonicalMediaReady).length,
    },
    requiredReceiptTargets,
    relationshipHash: canonicalHash([...tracks].sort(byId).map((track) => ({
      id: track.id,
      ownerUid: track.ownerUid,
      createdBy: track.createdBy,
      updatedBy: track.updatedBy,
      legacyPaths: musicLegacyPaths(track),
      canonical: canonicalMediaReady(track),
      assetId: track.media?.assetId || null,
      canonicalMediaHash: canonicalMediaHash(track),
    }))),
  };
};

const assertMusicActivationCoverage = ({coverage, verificationReport}) => {
  const receiptTargets = (verificationReport?.entries || [])
    .filter((entry) => entry.sourceKey === 'music-tracks')
    .map(({targetPath}) => targetPath)
    .sort();
  const issues = [...coverage.issues];
  if (!samePaths(receiptTargets, coverage.requiredReceiptTargets)) {
    issues.push('music-receipt-coverage-mismatch');
  }
  if (issues.length) {
    throw new Error(
      `canonical-only music coverage is blocked: ${[...new Set(issues)]
        .sort().join(', ')}.`
    );
  }
  return {
    schemaVersion: MUSIC_COVERAGE_SCHEMA_VERSION,
    counts: coverage.counts,
    relationshipHash: coverage.relationshipHash,
    receiptTargetsHash: canonicalHash(receiptTargets),
  };
};

const evaluateMusicStreamReadiness = (stream) => {
  const issues = new Set();
  const data = isRecord(stream) ? stream : {};
  if (!isRecord(stream)) issues.add('music-stream-missing');
  if (data.schemaVersion !== MUSIC_STREAM_SCHEMA_VERSION) {
    issues.add('music-stream-schema-invalid');
  }
  if (data.controlMode !== 'canonical-only') {
    issues.add('music-stream-control-mode-stale');
  }
  if (!/^[a-f0-9]{64}$/.test(String(data.sourceHash || ''))) {
    issues.add('music-stream-source-hash-invalid');
  }
  if (!Number.isSafeInteger(data.revision) || data.revision < 1) {
    issues.add('music-stream-revision-invalid');
  }
  if (data.updatedAt == null) {
    issues.add('music-stream-updated-at-missing');
  }
  if (typeof data.volume !== 'number' || !Number.isFinite(data.volume) ||
    data.volume < 0 || data.volume > 1) {
    issues.add('music-stream-volume-invalid');
  }
  const sessions = Array.isArray(data.sessions) ? data.sessions : [];
  if (!Array.isArray(data.sessions)) {
    issues.add('music-stream-sessions-invalid');
  }
  if (sessions.length > 4) issues.add('music-stream-session-cap-exceeded');
  sessions.forEach((session) => {
    if (!isRecord(session)) {
      issues.add('music-stream-session-invalid');
      return;
    }
    if (Object.prototype.hasOwnProperty.call(session, 'audioUrl')) {
      issues.add('music-stream-legacy-audio-present');
    }
    const activeStatus = ['playing', 'paused'].includes(session.status);
    const durationMs = session.durationMs;
    const validDuration = Number.isSafeInteger(durationMs) &&
      durationMs >= 1 &&
      durationMs <= mediaPolicy.purposes.music.maxDurationMs;
    if (!activeStatus || typeof session.id !== 'string' ||
      !session.id.trim() || typeof session.trackId !== 'string' ||
      !session.trackId.trim() || typeof session.trackName !== 'string' ||
      !session.trackName.trim() || session.trackName.length > 256 ||
      !validDuration || !Number.isSafeInteger(session.offsetMs) ||
      session.offsetMs < 0 || session.offsetMs > durationMs ||
      typeof session.loop !== 'boolean' ||
      !Number.isSafeInteger(session.updatedAtMs) || session.updatedAtMs < 1 ||
      (session.status === 'playing' ?
        !Number.isSafeInteger(session.startedAtMs) ||
          session.startedAtMs < 1 :
        session.startedAtMs !== 0)) {
      issues.add('music-stream-session-invalid');
    }
    const mediaAssetId = String(session.mediaAssetId || '').trim();
    const media = isRecord(session.media) ? session.media : {};
    const original = isRecord(media.original) ? media.original : {};
    const ownerUid = String(media.ownerUid || '').trim();
    const generation = String(media.generation || '').trim();
    if (!canonicalMediaReady(session) ||
      !/^m_[a-f0-9]{40}$/.test(mediaAssetId) ||
      media.assetId !== mediaAssetId) {
      issues.add('music-stream-canonical-media-missing');
    }
    if (media.kind !== 'music' || media.audience !== 'signed-in' ||
      !ownerUid || !/^[1-9][0-9]*$/.test(generation)) {
      issues.add('music-stream-canonical-scope-invalid');
    }
    if (original.path !==
        `media_assets/v1/signed-in/${ownerUid}/${mediaAssetId}/` +
          `${generation}/original` ||
      !mediaPolicy.purposes.music.contentTypes.includes(
        String(original.contentType || '').toLowerCase()
      ) ||
      !Number.isSafeInteger(original.bytes) || original.bytes < 1 ||
      original.bytes > mediaPolicy.purposes.music.maxBytes ||
      !Number.isSafeInteger(original.durationMs) ||
      original.durationMs !== durationMs ||
      original.width !== 0 || original.height !== 0 ||
      !/^[1-9][0-9]*$/.test(String(original.generation || ''))) {
      issues.add('music-stream-canonical-original-invalid');
    }
  });
  return {
    ready: issues.size === 0,
    issues: [...issues].sort(),
    counts: {sessions: sessions.length},
    relationshipHash: canonicalHash({
      controlMode: data.controlMode,
      revision: data.revision,
      sourceHash: data.sourceHash,
      sessions,
    }),
  };
};

const assertMusicStreamActivationReady = (stream) => {
  const readiness = evaluateMusicStreamReadiness(stream);
  if (!readiness.ready) {
    throw new Error(
      `canonical-only music stream is not ready: ${readiness.issues
        .join(', ')}.`
    );
  }
  return {
    schemaVersion: MUSIC_STREAM_READINESS_SCHEMA_VERSION,
    counts: readiness.counts,
    relationshipHash: readiness.relationshipHash,
  };
};

const waitForMusicStreamActivationReady = async ({
  readStream,
  timeoutMs = MUSIC_STREAM_READY_TIMEOUT_MS,
  pollMs = MUSIC_STREAM_READY_POLL_MS,
  now = Date.now,
  sleep = (milliseconds) => new Promise((resolve) => (
    setTimeout(resolve, milliseconds)
  )),
}) => {
  if (typeof readStream !== 'function' ||
    !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 ||
    !Number.isSafeInteger(pollMs) || pollMs < 1 || pollMs > timeoutMs) {
    throw new TypeError('Music stream readiness polling bounds are invalid.');
  }
  const startedAt = now();
  let latest = evaluateMusicStreamReadiness(null);
  while (now() - startedAt <= timeoutMs) {
    const stream = await readStream();
    latest = evaluateMusicStreamReadiness(stream);
    if (latest.ready) return assertMusicStreamActivationReady(stream);
    const remaining = timeoutMs - (now() - startedAt);
    if (remaining <= 0) break;
    await sleep(Math.min(pollMs, remaining));
  }
  throw new Error(
    'Canonical-only control was written, but the bounded music-stream ' +
    `readiness check timed out: ${latest.issues.join(', ')}. ` +
    'Use the reviewed legacy rollback if the projector does not recover.'
  );
};

const assertRuntimeCoverageFresh = ({
  verificationEvidence,
  tokenCoverage,
  musicCoverage,
}) => {
  const tokenEvidence = assertTokenActivationCoverage({
    coverage: tokenCoverage,
    verificationReport: {entries: tokenCoverage.requiredReceiptTargets.map(
      (targetPath) => ({sourceKey: targetPath.includes('grigliata_tokens/') ?
        'custom-token-templates' : '', targetPath})
    )},
  });
  const musicEvidence = assertMusicActivationCoverage({
    coverage: musicCoverage,
    verificationReport: {entries: musicCoverage.requiredReceiptTargets.map(
      (targetPath) => ({sourceKey: 'music-tracks', targetPath})
    )},
  });
  if (canonicalHash(tokenEvidence) !==
      canonicalHash(verificationEvidence?.tokenCoverage) ||
    canonicalHash(musicEvidence) !==
      canonicalHash(verificationEvidence?.musicCoverage)) {
    throw new Error(
      'Canonical-only runtime coverage changed after approval. Re-plan.'
    );
  }
  return {tokenCoverage: tokenEvidence, musicCoverage: musicEvidence};
};

const parseNonNegativeInteger = (value, name, maximum = 1000000) => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maximum) {
    throw new Error(`${name} must be an integer from 0 to ${maximum}.`);
  }
  return parsed;
};

const parseArguments = (args = []) => {
  const options = {
    allowLiveProject: false,
    approveFingerprint: '',
    authMode: 'firebase-cli',
    confirmProject: '',
    confirmWebmasterUid: '',
    execute: false,
    expectedCandidates: null,
    help: false,
    mode: '',
    projectId: '',
    reportPath: DEFAULT_REPORT_PATH,
    verificationFingerprint: '',
    verificationReportPath: '',
    webmasterUid: '',
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help' || argument === '-h') options.help = true;
    else if (argument === '--execute') options.execute = true;
    else if (argument === '--allow-live-project') {
      options.allowLiveProject = true;
    } else if ([
      '--project',
      '--mode',
      '--auth',
      '--confirm-project',
      '--webmaster-uid',
      '--confirm-webmaster-uid',
      '--expected-candidates',
      '--verification-report',
      '--verification-fingerprint',
      '--report',
      '--approve-fingerprint',
    ].includes(argument)) {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`Missing value for ${argument}.`);
      }
      index += 1;
      if (argument === '--project') options.projectId = value;
      if (argument === '--mode') options.mode = value;
      if (argument === '--auth') options.authMode = value;
      if (argument === '--confirm-project') options.confirmProject = value;
      if (argument === '--webmaster-uid') options.webmasterUid = value;
      if (argument === '--confirm-webmaster-uid') {
        options.confirmWebmasterUid = value;
      }
      if (argument === '--expected-candidates') {
        options.expectedCandidates = parseNonNegativeInteger(
          value,
          '--expected-candidates'
        );
      }
      if (argument === '--verification-report') {
        options.verificationReportPath = path.resolve(value);
      }
      if (argument === '--verification-fingerprint') {
        options.verificationFingerprint = value;
      }
      if (argument === '--report') options.reportPath = path.resolve(value);
      if (argument === '--approve-fingerprint') {
        options.approveFingerprint = value;
      }
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (options.help) return options;
  if (options.projectId !== PRODUCTION_PROJECT_ID) {
    throw new Error(
      `This production operator accepts only project ${PRODUCTION_PROJECT_ID}.`
    );
  }
  if (!CONTROL_MODES.has(options.mode)) {
    throw new Error(
      '--mode must be exactly v1-write, canonical-only, or legacy.'
    );
  }
  if (!AUTH_MODES.has(options.authMode)) {
    throw new Error('--auth must be exactly admin or firebase-cli.');
  }
  if (options.mode === 'canonical-only' && (
    !options.verificationReportPath ||
    !/^[a-f0-9]{64}$/i.test(options.verificationFingerprint) ||
    options.expectedCandidates === null
  )) {
    throw new Error(
      'canonical-only requires --verification-report, exact ' +
      '--verification-fingerprint, and --expected-candidates.'
    );
  }
  if (options.execute && !/^[a-f0-9]{64}$/i.test(
    options.approveFingerprint
  )) {
    throw new Error(
      '--execute requires an exact SHA-256 --approve-fingerprint.'
    );
  }
  return options;
};

const assertSafeTarget = (options, environment = process.env) => {
  for (const variable of ['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT']) {
    if (environment[variable] && environment[variable] !== options.projectId) {
      throw new Error(`${variable} does not match the explicit --project.`);
    }
  }
  if (environment.FIRESTORE_EMULATOR_HOST ||
    environment.FIREBASE_STORAGE_EMULATOR_HOST ||
    environment.FUNCTIONS_EMULATOR_HOST) {
    throw new Error('Media rollout control refuses all emulator hosts.');
  }
  if (!options.allowLiveProject ||
    options.confirmProject !== PRODUCTION_PROJECT_ID) {
    throw new Error(
      'Live control access requires --allow-live-project and exact ' +
      `--confirm-project ${PRODUCTION_PROJECT_ID}.`
    );
  }
  if (options.authMode !== 'firebase-cli') {
    throw new Error('Live control access requires --auth firebase-cli.');
  }
  if (!/^[A-Za-z0-9._:@-]{1,128}$/.test(options.webmasterUid) ||
    options.confirmWebmasterUid !== options.webmasterUid) {
    throw new Error(
      'Live control access requires --webmaster-uid and exact ' +
      '--confirm-webmaster-uid.'
    );
  }
  return {
    live: true,
    projectId: PRODUCTION_PROJECT_ID,
    storageBucket: PRODUCTION_STORAGE_BUCKET,
  };
};

const readJson = (filePath, label) => {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error(`${label} not found: ${filePath || '(missing path)'}`);
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`${label} is not valid JSON.`, {cause: error});
  }
};

const writeJsonAtomic = (filePath, value) => {
  fs.mkdirSync(path.dirname(filePath), {recursive: true});
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, filePath);
};

const exactStringArray = (value, expected) => (
  Array.isArray(value) &&
  value.length === expected.length &&
  expected.every((entry, index) => value[index] === entry)
);

const controlKind = (value) => {
  if (!isRecord(value)) return 'malformed';
  if (canonicalHash(value) === canonicalHash(LEGACY_CONTROL)) return 'legacy';
  if (canonicalHash(value) === canonicalHash(V1_WRITE_CONTROL)) {
    return 'v1-write';
  }
  if (canonicalHash(value) === canonicalHash(CANONICAL_ONLY_CONTROL)) {
    return 'canonical-only';
  }
  if (value.schemaVersion !== 1 ||
    value.policyVersion !== mediaPolicy.policyVersion ||
    ![
      'legacy',
      'shadow',
      'derivative-read',
      'v1-write',
      'canonical-only',
    ].includes(value.mode) ||
    !Array.isArray(value.enabledPurposes) ||
    !Array.isArray(value.enabledRoles) ||
    !Array.isArray(value.enabledUids)) {
    return 'malformed';
  }
  return 'partial-rollout';
};

const validateVerificationReport = ({
  report,
  fingerprint,
  expectedCandidates,
  webmasterUid,
}) => {
  const validEntries = Array.isArray(report?.entries) &&
    report.entries.length === expectedCandidates &&
    report.entries.every((entry) => (
      SOURCE_KEYS.includes(entry.sourceKey) &&
      entry.status === 'verified' &&
      entry.proofs?.generatedObjectsPresent === true &&
      entry.proofs?.legacySourceUnchanged === true &&
      entry.proofs?.legacyGeneralImageUrlUnchanged === true &&
      (!['catalog-items', 'inventory-items'].includes(entry.sourceKey) || (
        entry.proofs?.itemOriginalGenerated === true &&
        entry.proofs?.itemCardGenerated === true &&
        entry.proofs?.itemCard2xGenerated === true
      ))
      && (entry.sourceKey !== 'foe-tokens' || (
        Number.isSafeInteger(entry.proofs?.placementReferenceCount) &&
        entry.proofs.placementReferenceCount >= 1 &&
        /^[a-f0-9]{64}$/.test(String(
          entry.proofs?.placementReferenceHash || ''
        )) &&
        /^[a-f0-9]{64}$/.test(String(entry.proofs?.sourceFoeFingerprint || ''))
      ))
    ));
  if (!isRecord(report) ||
    report.schemaVersion !== MIGRATION_REPORT_SCHEMA_VERSION ||
    report.planVersion !== MIGRATION_PLAN_VERSION ||
    report.policyVersion !== mediaPolicy.policyVersion ||
    report.policyHash !== POLICY_HASH ||
    report.operation !== 'verify' ||
    report.projectId !== PRODUCTION_PROJECT_ID ||
    report.storageBucket !== PRODUCTION_STORAGE_BUCKET ||
    !exactSourceKeys(report.sourceKeys) ||
    report.catalogOwnerUid !== webmasterUid ||
    report.expectedCandidates !== expectedCandidates ||
    report.mode !== 'dry-run' ||
    report.complete !== true ||
    report.scan?.complete !== true ||
    !Number.isInteger(report.scan?.pageSize) ||
    report.scan.pageSize < 1 ||
    report.scan.pageSize > 50 ||
    !Number.isInteger(report.scan?.maxPages) ||
    report.scan.maxPages < 1 ||
    report.scan.maxPages > 100 ||
    report.scan?.concurrency !== 1 ||
    !exactStringArray(report.scan?.truncatedSources, []) ||
    report.counts?.candidates !== expectedCandidates ||
    report.counts?.excluded !== 0 ||
    report.counts?.discovered !== expectedCandidates ||
    report.counts?.errors !== 0 ||
    !Array.isArray(report.excluded) ||
    report.excluded.length !== 0 ||
    report.planFingerprint !== computePlanFingerprint(report) ||
    report.planFingerprint !== fingerprint ||
    !validEntries) {
    throw new Error(
      'canonical-only requires the exact fresh, complete, zero-error, ' +
      'all-source Task 07 verification report.'
    );
  }
  return {
    migrationPlanFingerprint: report.planFingerprint,
    expectedCandidates,
    verifiedReceipts: report.entries.length,
    sourceKeys: [...report.sourceKeys],
    proofHash: canonicalHash(report.entries.map((entry) => ({
      receiptId: entry.receiptId,
      sourceKey: entry.sourceKey,
      inspectionHash: entry.inspectionHash,
      proofs: entry.proofs,
    }))),
  };
};

const assertFreshVerification = ({reviewed, fresh}) => {
  if (canonicalHash(reviewed) !== canonicalHash(fresh)) {
    throw new Error(
      'The reviewed verification report is stale. Re-run verification.'
    );
  }
  return fresh;
};

const buildPlan = ({
  projectId,
  mode,
  snapshot,
  verificationEvidence = null,
}) => {
  const beforeControl = snapshot.exists ? snapshot.data : null;
  const beforeKind = snapshot.exists ? controlKind(beforeControl) : 'legacy';
  if (snapshot.exists && beforeKind === 'malformed') {
    throw new Error('The current Task 07 control document is malformed.');
  }
  const afterControl = mode === 'canonical-only' ?
    CANONICAL_ONLY_CONTROL :
    mode === 'v1-write' ? V1_WRITE_CONTROL : LEGACY_CONTROL;
  if (beforeKind === mode) {
    throw new Error(`Task 07 control is already ${mode}.`);
  }
  if (mode === 'v1-write' && beforeKind !== 'legacy') {
    throw new Error('v1-write may be enabled only from exact legacy state.');
  }
  if (mode === 'canonical-only' && !verificationEvidence) {
    throw new Error('canonical-only requires verified migration evidence.');
  }
  const subject = {
    schemaVersion: CONTROL_PLAN_SCHEMA_VERSION,
    projectId,
    controlPath: CONTROL_PATH,
    requestedMode: mode,
    beforeExists: snapshot.exists,
    beforeUpdateTime: snapshot.updateTime || null,
    beforeControlHash: canonicalHash(beforeControl),
    beforeKind,
    afterControl,
    verificationEvidence: mode === 'canonical-only' ?
      verificationEvidence :
      null,
  };
  return {...subject, planFingerprint: canonicalHash(subject)};
};

const assertApprovedPlan = ({approved, current, fingerprint}) => {
  if (!/^[a-f0-9]{64}$/i.test(fingerprint) ||
    approved?.planFingerprint !== fingerprint ||
    canonicalHash(approved) !== canonicalHash(current)) {
    throw new Error(
      'Approved rollout plan no longer matches current state. Re-plan.'
    );
  }
  return approved;
};

const createBackend = async ({projectId, authMode}) => {
  const {deleteApp, initializeApp} = require('firebase-admin/app');
  const {getAuth} = require('firebase-admin/auth');
  const {FieldPath, getFirestore} = require('firebase-admin/firestore');
  const previousAdcPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const temporaryAdc = authMode === 'firebase-cli' ?
    await createFirebaseCliAdcFile({projectId}) :
    null;
  if (temporaryAdc) {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = temporaryAdc.filePath;
  }
  let app;
  try {
    app = initializeApp(
      {projectId, storageBucket: PRODUCTION_STORAGE_BUCKET},
      `task07-media-control-${process.pid}-${Date.now()}`
    );
  } catch (error) {
    if (previousAdcPath === undefined) {
      delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    } else {
      process.env.GOOGLE_APPLICATION_CREDENTIALS = previousAdcPath;
    }
    temporaryAdc?.cleanup();
    throw error;
  }
  const db = getFirestore(app);
  const firebaseAuth = getAuth(app);
  const reference = db.doc(CONTROL_PATH);
  const musicStreamReference = db.doc('grigliata_music_stream/current');
  const snapshotData = (snapshot) => ({
    exists: snapshot.exists,
    data: snapshot.exists ? snapshot.data() : null,
    updateTime: snapshot.updateTime?.toDate?.().toISOString() || null,
  });
  const verifyWebmaster = async (uid) => {
    const [user, account] = await Promise.all([
      db.doc(`users/${uid}`).get(),
      firebaseAuth.getUser(uid),
    ]);
    if (!user.exists ||
      String(user.get('role') || '').trim().toLowerCase() !== 'webmaster' ||
      user.get('deletionState') === 'pending' ||
      account.uid !== uid || account.disabled === true) {
      throw new Error(
        'The confirmed operator is not an active cloned webmaster in both ' +
        'Firestore and Firebase Authentication.'
      );
    }
  };
  const readBoundedCollection = async (collectionName) => {
    const snapshot = await db.collection(collectionName)
      .orderBy(FieldPath.documentId())
      .limit(TOKEN_COVERAGE_MAX_DOCUMENTS + 1)
      .get();
    if (snapshot.docs.length > TOKEN_COVERAGE_MAX_DOCUMENTS) {
      throw new Error(
        `Token coverage scan exceeded ${TOKEN_COVERAGE_MAX_DOCUMENTS} ` +
        `documents in ${collectionName}.`
      );
    }
    return snapshot.docs.map((document) => ({
      id: document.id,
      ...document.data(),
    }));
  };
  const readBoundedCollectionInTransaction = async (
    transaction,
    collectionName
  ) => {
    const snapshot = await transaction.get(
      db.collection(collectionName)
        .orderBy(FieldPath.documentId())
        .limit(TOKEN_COVERAGE_MAX_DOCUMENTS + 1)
    );
    if (snapshot.docs.length > TOKEN_COVERAGE_MAX_DOCUMENTS) {
      throw new Error(
        `Runtime coverage scan exceeded ${TOKEN_COVERAGE_MAX_DOCUMENTS} ` +
        `documents in ${collectionName}.`
      );
    }
    return snapshot.docs.map((document) => ({
      id: document.id, ...document.data(),
    }));
  };
  return {
    read: async () => snapshotData(await reference.get()),
    readTokenCoverage: async () => evaluateTokenCoverage({
      tokens: await readBoundedCollection('grigliata_tokens'),
      placements: await readBoundedCollection('grigliata_token_placements'),
      users: await readBoundedCollection('users'),
      runtimeProof: TOKEN_RUNTIME_COVERAGE,
    }),
    readMusicCoverage: async () => evaluateMusicCoverage({
      tracks: await readBoundedCollection('grigliata_music_tracks'),
    }),
    verifyWebmaster,
    write: async ({approvedPlan, mode, verificationEvidence}) => (
      db.runTransaction(async (transaction) => {
        if (mode === 'canonical-only') {
          const tokens = await readBoundedCollectionInTransaction(
            transaction,
            'grigliata_tokens'
          );
          const placements = await readBoundedCollectionInTransaction(
            transaction,
            'grigliata_token_placements'
          );
          const users = await readBoundedCollectionInTransaction(
            transaction,
            'users'
          );
          const tracks = await readBoundedCollectionInTransaction(
            transaction,
            'grigliata_music_tracks'
          );
          assertRuntimeCoverageFresh({
            verificationEvidence,
            tokenCoverage: evaluateTokenCoverage({
              tokens,
              placements,
              users,
              runtimeProof: TOKEN_RUNTIME_COVERAGE,
            }),
            musicCoverage: evaluateMusicCoverage({tracks}),
          });
        }
        const snapshot = await transaction.get(reference);
        const currentPlan = buildPlan({
          projectId,
          mode,
          snapshot: snapshotData(snapshot),
          verificationEvidence,
        });
        assertApprovedPlan({
          approved: approvedPlan,
          current: currentPlan,
          fingerprint: approvedPlan.planFingerprint,
        });
        transaction.set(
          reference,
          mode === 'canonical-only' ?
            CANONICAL_ONLY_CONTROL :
            mode === 'v1-write' ? V1_WRITE_CONTROL : LEGACY_CONTROL,
          {merge: false}
        );
        return currentPlan;
      })
    ),
    waitForMusicStreamReady: async () => waitForMusicStreamActivationReady({
      readStream: async () => {
        const snapshot = await musicStreamReference.get();
        return snapshot.exists ? snapshot.data() : null;
      },
    }),
    close: async () => {
      try {
        await deleteApp(app);
      } finally {
        if (previousAdcPath === undefined) {
          delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
        } else {
          process.env.GOOGLE_APPLICATION_CREDENTIALS = previousAdcPath;
        }
        temporaryAdc?.cleanup();
      }
    },
  };
};

const refreshVerification = async ({options, reviewedReport}) => {
  const backend = await createMigrationBackend({
    projectId: PRODUCTION_PROJECT_ID,
    storageBucket: PRODUCTION_STORAGE_BUCKET,
    authMode: options.authMode,
  });
  try {
    await backend.verifyCatalogOwner(options.webmasterUid);
    const fresh = await buildMigrationPlan({
      backend,
      operation: 'verify',
      projectId: PRODUCTION_PROJECT_ID,
      storageBucket: PRODUCTION_STORAGE_BUCKET,
      sourceKeys: SOURCE_KEYS,
      catalogOwnerUid: options.webmasterUid,
      expectedCandidates: options.expectedCandidates,
      pageSize: reviewedReport.scan.pageSize,
      maxPages: reviewedReport.scan.maxPages,
    });
    assertCandidateCountBinding(fresh, options.expectedCandidates, {
      required: true,
    });
    return assertFreshVerification({reviewed: reviewedReport, fresh});
  } finally {
    await backend.close();
  }
};

const printHelp = () => console.log([
  `Guarded Media V2 rollout control for production ${PRODUCTION_PROJECT_ID}.`,
  '',
  'Usage:',
  `  node scripts/task07/media-rollout-control.js --project ${PRODUCTION_PROJECT_ID}`,
  '    --mode v1-write|canonical-only|legacy --auth firebase-cli',
  `    --allow-live-project --confirm-project ${PRODUCTION_PROJECT_ID}`,
  '    --webmaster-uid <uid> --confirm-webmaster-uid <same-uid>',
  '    [--verification-report <zero-error-all-source-report>]',
  '    [--verification-fingerprint <sha256>]',
  '    [--expected-candidates <reviewed-count>]',
  '    [--report <control-plan>]',
  '    [--execute --approve-fingerprint <control-plan-sha256>]',
  '',
  'v1-write enables the temporary all-source migration write stage.',
  'canonical-only writes the strict canonical-only mode with wildcard',
  'purpose, role, and UID',
  'allowlists only after a fresh all-source verification. legacy is the',
  'explicit rollback. Token templates/foe roots, character/custom/placement',
  'relationships, and nested-foe non-rendering are re-audited before writes.',
  'Production and emulator targets are always refused.',
].join('\n'));

const main = async (argv = process.argv.slice(2)) => {
  const options = parseArguments(argv);
  if (options.help) return printHelp();
  const target = assertSafeTarget(options);
  let verificationEvidence = null;
  let verificationReport = null;
  if (options.mode === 'canonical-only') {
    const reviewed = readJson(
      options.verificationReportPath,
      'Task 07 verification report'
    );
    validateVerificationReport({
      report: reviewed,
      fingerprint: options.verificationFingerprint,
      expectedCandidates: options.expectedCandidates,
      webmasterUid: options.webmasterUid,
    });
    const fresh = await refreshVerification({options, reviewedReport: reviewed});
    verificationReport = fresh;
    verificationEvidence = validateVerificationReport({
      report: fresh,
      fingerprint: options.verificationFingerprint,
      expectedCandidates: options.expectedCandidates,
      webmasterUid: options.webmasterUid,
    });
  }
  const backend = await createBackend(options);
  try {
    await backend.verifyWebmaster(options.webmasterUid);
    if (options.mode === 'canonical-only') {
      const tokenCoverage = assertTokenActivationCoverage({
        coverage: await backend.readTokenCoverage(),
        verificationReport,
      });
      const musicCoverage = assertMusicActivationCoverage({
        coverage: await backend.readMusicCoverage(),
        verificationReport,
      });
      verificationEvidence = {
        ...verificationEvidence,
        tokenCoverage,
        musicCoverage,
      };
    }
    const plan = buildPlan({
      projectId: options.projectId,
      mode: options.mode,
      snapshot: await backend.read(),
      verificationEvidence,
    });
    if (!options.execute) {
      writeJsonAtomic(options.reportPath, plan);
      console.log(JSON.stringify({
        mode: 'dry-run',
        live: target.live,
        beforeKind: plan.beforeKind,
        requestedMode: plan.requestedMode,
        planFingerprint: plan.planFingerprint,
        reportPath: options.reportPath,
      }, null, 2));
      return;
    }
    const approved = readJson(options.reportPath, 'Media rollout plan');
    assertApprovedPlan({
      approved,
      current: plan,
      fingerprint: options.approveFingerprint,
    });
    await backend.write({
      approvedPlan: approved,
      mode: options.mode,
      verificationEvidence,
    });
    const musicStreamReadiness = options.mode === 'canonical-only' ?
      await backend.waitForMusicStreamReady() :
      null;
    console.log(JSON.stringify({
      mode: 'execute',
      live: target.live,
      beforeKind: plan.beforeKind,
      requestedMode: plan.requestedMode,
      planFingerprint: plan.planFingerprint,
      ...(musicStreamReadiness ? {musicStreamReadiness} : {}),
    }, null, 2));
  } finally {
    await backend.close();
  }
};

if (require.main === module) {
  main().catch((error) => {
    console.error('Task 07 media rollout control failed:', error?.message || error);
    process.exitCode = 1;
  });
}

module.exports = {
  CANONICAL_ONLY_CONTROL,
  CONTROL_PATH,
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
};
