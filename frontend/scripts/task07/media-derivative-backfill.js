#!/usr/bin/env node

'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const {createRequire} = require('node:module');
const path = require('node:path');
const {pipeline} = require('node:stream/promises');
const mediaPolicy = require('../../functions/src/mediaPolicy.json');
const {
  createFirebaseCliAdcFile,
} = require('../firebase-cli-admin-credential');
const {
  PRODUCTION_PROJECT_ID,
  PRODUCTION_STORAGE_BUCKET,
} = require('../production-target');

const DEMO_PROJECT_ID = 'demo-fnd-perf';
const REPORT_SCHEMA_VERSION = 4;
const PLAN_VERSION = 4;
const RECEIPT_COLLECTION = 'task07_media_backfill_receipts';
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 50;
const DEFAULT_MAX_PAGES = 20;
const MAX_MAX_PAGES = 100;
const MIGRATION_CONCURRENCY = 1;
const DEFAULT_POLL_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_PLACEMENT_REFERENCES = 500;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const OPERATIONS = new Set(['backfill', 'verify', 'rollback']);
const AUTH_MODES = new Set(['admin', 'firebase-cli']);
const SUPPORTED_KINDS = new Set([
  'avatar', 'item', 'npc', 'foe', 'token',
  'technique', 'technique-video', 'spell', 'spell-video',
  'map', 'map-video', 'music',
]);
const SOURCE_KEYS = Object.freeze([
  'avatars',
  'catalog-items',
  'inventory-items',
  'npcs',
  'foes',
  'custom-token-templates',
  'foe-tokens',
  'common-technique-art',
  'common-technique-video',
  'technique-art',
  'technique-video',
  'spell-art',
  'spell-video',
  'backgrounds',
  'music-tracks',
]);
const SOURCE_KEY_SET = new Set(SOURCE_KEYS);
const GLOBAL_FALLBACK_OWNER_SOURCES = new Set([
  'catalog-items',
  'npcs',
  'foes',
  'common-technique-art',
  'common-technique-video',
  'backgrounds',
  'music-tracks',
]);
const TARGET_COMPATIBILITY_FIELDS = Object.freeze([
  'media',
  'imagePath',
  'imageUrl',
  'imageWidth',
  'imageHeight',
  'contentType',
  'sizeBytes',
  'assetType',
  'durationMs',
  'videoMedia',
  'audioPath',
  'audioUrl',
]);
const DEFAULT_RESULTS_DIRECTORY = path.resolve(
  __dirname,
  '..',
  '..',
  'performance-results'
);
const requireFromFunctions = createRequire(path.resolve(
  __dirname,
  '..',
  '..',
  'functions',
  'package.json'
));

const asString = (value) => typeof value === 'string' ? value.trim() : '';
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const isRecord = (value) => (
  Boolean(value && typeof value === 'object' && !Array.isArray(value))
);

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => [key, canonicalize(entry)]));
};

const canonicalHash = (value) => crypto.createHash('sha256')
  .update(JSON.stringify(canonicalize(value)))
  .digest('hex');

const POLICY_HASH = canonicalHash(mediaPolicy);
const LEGACY_MAP_RECOVERY_ERROR_CODES = new Set([
  'source-image-decode-failed',
  'source-dimension-budget-exceeded',
]);

const buildLegacyMapBackfillMarker = (entry, binding, plan) => (
  entry.kind === 'map' && entry.sourceKey === 'backgrounds' ? {
    schemaVersion: 1,
    kind: 'legacy-map-backfill',
    reportSchemaVersion: REPORT_SCHEMA_VERSION,
    planVersion: PLAN_VERSION,
    policyVersion: mediaPolicy.policyVersion,
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
  } : null
);

const legacyMapRecoveryIssue = ({
  receipt,
  manifest,
  cleanup,
  marker,
  plan,
}) => {
  if (!marker) return 'legacy-map-marker-required';
  const existingReceiptMarker = receipt.legacyBackfill;
  const existingManifestMarker = manifest.legacyBackfill;
  if (receipt.state !== 'intent') return 'receipt-not-intent';
  if (receipt.sourceGeneration !== undefined &&
    receipt.sourceGeneration !== marker.sourceGeneration) {
    return 'receipt-source-generation-mismatch';
  }
  if (existingReceiptMarker !== undefined &&
    canonicalHash(existingReceiptMarker) !== canonicalHash(marker)) {
    return 'receipt-marker-mismatch';
  }
  const recoveryAttempts = receipt.legacyMapRecoveryAttempts ?? 0;
  if (recoveryAttempts !== 0) return 'recovery-already-attempted';
  if (manifest.state !== 'deleted') return 'manifest-not-deleted';
  if (!LEGACY_MAP_RECOVERY_ERROR_CODES.has(asString(manifest.error?.code)) ||
    manifest.error?.retryable !== false) {
    return 'manifest-error-not-recoverable';
  }
  if (manifest.assetId !== marker.assetId ||
    manifest.requestHash !== plan.requestHash ||
    manifest.actorUid !== marker.ownerUid ||
    canonicalHash(manifest.plan) !== canonicalHash(plan) ||
    manifest.attachment !== null ||
    manifest.generated !== undefined ||
    manifest.source !== undefined) {
    return 'manifest-binding-mismatch';
  }
  if (existingManifestMarker !== undefined &&
    canonicalHash(existingManifestMarker) !== canonicalHash(marker)) {
    return 'manifest-marker-mismatch';
  }
  if (cleanup.state !== 'complete' ||
    cleanup.assetId !== marker.assetId ||
    cleanup.reason !== manifest.error.code) {
    return 'cleanup-not-complete';
  }
  return null;
};

const defaultResultPath = (operation, suffix) => path.join(
  DEFAULT_RESULTS_DIRECTORY,
  `task07-media-${operation}-${suffix}.json`
);

const writeJsonAtomic = (filePath, value) => {
  fs.mkdirSync(path.dirname(filePath), {recursive: true});
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, filePath);
};

const readJson = (filePath, label) => {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} not found: ${filePath}`);
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`${label} is not valid JSON.`, {cause: error});
  }
};

const storagePathFromValue = (value) => {
  const text = asString(value);
  if (!text) return '';
  if (!text.includes('://')) return text.replace(/^\/+/, '');
  try {
    const parsed = new URL(text);
    if (![
      'firebasestorage.googleapis.com',
      'storage.googleapis.com',
      ...LOOPBACK_HOSTS,
    ].includes(parsed.hostname)) return '';
    const encoded = parsed.pathname.split('/o/')[1];
    if (encoded) return decodeURIComponent(encoded).replace(/^\/+/, '');
    if (parsed.hostname === 'storage.googleapis.com') {
      const parts = parsed.pathname.split('/').filter(Boolean);
      return parts.length >= 2 ?
        decodeURIComponent(parts.slice(1).join('/')) :
        '';
    }
    return '';
  } catch {
    return '';
  }
};

const isCanonicalTask07Path = (value) => {
  const storagePath = storagePathFromValue(value);
  return (
    /^media_assets\/v1\/(?:signed-in|owner-manager|dm-only)\/[^/]+\/m_[a-f0-9]{40}\/[1-9][0-9]*\/(?:original|thumbnail|thumbnail2x|card|card2x|gallery|gallery2x|poster|poster2x)$/
      .test(storagePath) ||
    /^media\/v1\/(?:avatar|item|npc|foe|token|technique|technique-video|spell|spell-video|map|map-video|music)\/[^/]+\/m_[a-f0-9]{40}\//
      .test(storagePath)
  );
};

const isReservedTask07Path = (value) => (
  /^(?:media_assets|media_uploads)\//.test(storagePathFromValue(value))
);

const collectMediaPaths = (value) => {
  const result = new Set();
  const visit = (entry, key = '') => {
    if (typeof entry === 'string') {
      if (/^(?:imagePath|imageUrl|image_url|posterPath|posterUrl|videoUrl|video_url|audioPath|audioUrl|storagePath|path|url)$/i
        .test(key)) {
        const storagePath = storagePathFromValue(entry);
        if (storagePath) result.add(storagePath);
      }
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
  return [...result].sort();
};

const legacyPathsForKind = (data, kind) => {
  if (kind === 'item') {
    return collectMediaPaths({
      image_url: data?.image_url,
      imagePath: data?.imagePath,
      imageUrl: data?.imageUrl,
      media: data?.media,
      General: {
        image_url: data?.General?.image_url,
        media: data?.General?.media,
      },
    });
  }
  if (kind === 'technique' || kind === 'spell') {
    return collectMediaPaths({
      image_url: data?.image_url,
      imagePath: data?.imagePath,
      imageUrl: data?.imageUrl,
      media: data?.media,
    });
  }
  if (kind === 'technique-video' || kind === 'spell-video') {
    return collectMediaPaths({
      video_url: data?.video_url,
      videoUrl: data?.videoUrl,
      videoMedia: data?.videoMedia,
    });
  }
  if (kind === 'music') {
    return collectMediaPaths({
      audioPath: data?.audioPath,
      audioUrl: data?.audioUrl,
      media: data?.media,
    });
  }
  return collectMediaPaths({
    image_url: data?.image_url,
    imagePath: data?.imagePath,
    imageUrl: data?.imageUrl,
    videoUrl: data?.videoUrl,
    posterPath: data?.posterPath,
    posterUrl: data?.posterUrl,
    media: data?.media,
  });
};

const inferOwnerFromPath = (storagePath, kind) => {
  const parts = storagePathFromValue(storagePath).split('/');
  if (kind === 'npc' && parts[0] === 'echi_npcs') return parts[1] || '';
  if ((kind === 'map' || kind === 'map-video') &&
    parts[0] === 'grigliata' && parts[1] === 'backgrounds') {
    return parts[2] || '';
  }
  if (kind === 'foe' && parts[0] === 'foes') {
    // Only personal copies encode an owner. Global foe filenames do not.
    return parts[1] === 'copies' ? parts[2] || '' : '';
  }
  if (parts[0] === 'users') return parts[1] || '';
  return '';
};

const normalizeContentType = (value) => asString(value)
  .split(';')[0]
  .trim()
  .toLowerCase();

const normalizeSourceObject = (sourcePath, value) => {
  if (!isRecord(value) || value.exists === false) {
    return {
      exists: false,
      path: sourcePath,
      contentType: '',
      bytes: 0,
      generation: '',
      checksum: '',
    };
  }
  return {
    exists: true,
    path: sourcePath,
    contentType: normalizeContentType(value.contentType),
    bytes: Number(value.bytes ?? value.size),
    generation: asString(value.generation),
    checksum: asString(
      value.checksum || value.md5Hash || value.crc32c || value.metageneration
    ),
  };
};

const sourceObjectFingerprint = (source) => canonicalHash({
  path: source.path,
  contentType: source.contentType,
  bytes: source.bytes,
  generation: source.generation,
  checksum: source.checksum,
});

const referenceScopeFor = (record) => record.kind === 'item' ?
  (
    record.referenceScope === 'global-catalog' ?
      'global-catalog' :
      'user-inventory'
  ) :
  null;

const commonTechniqueForRecord = (record) => (
  record?.commonTechnique === true ||
  ['common-technique-art', 'common-technique-video']
    .includes(asString(record?.sourceKey))
);

const targetKindFor = (kind, referenceScope, commonTechnique = false) => {
  if (kind === 'avatar') return 'profile';
  if (kind === 'item') {
    return referenceScope === 'global-catalog' ?
      'catalog-item' :
      'user-inventory';
  }
  if (kind === 'npc') return 'npc';
  if (kind === 'foe') return 'foe';
  if (kind === 'token') return 'grigliata-token';
  if (kind === 'technique' || kind === 'technique-video') {
    return commonTechnique ? 'common-technique' : 'user-technique';
  }
  if (kind === 'spell' || kind === 'spell-video') return 'user-spell';
  if (kind === 'map' || kind === 'map-video') {
    return 'grigliata-background';
  }
  if (kind === 'music') return 'grigliata-music-track';
  return '';
};

const targetPathFor = (
  kind,
  ownerUid,
  entityId,
  referenceScope,
  commonTechnique = false
) => {
  if (kind === 'avatar') return `users/${ownerUid}`;
  if (kind === 'item' && referenceScope === 'global-catalog') {
    return `items/${entityId}`;
  }
  if (kind === 'item' && referenceScope === 'user-inventory') {
    return `users/${ownerUid}/inventory/${entityId}`;
  }
  if (kind === 'npc') return `echi_npcs/${entityId}`;
  if (kind === 'foe') return `foes/${entityId}`;
  if (kind === 'token') return `grigliata_tokens/${entityId}`;
  if (kind === 'technique' || kind === 'technique-video') {
    if (commonTechnique) return 'utils/tecniche_common';
    return `users/${ownerUid}/tecniche/${entityId}`;
  }
  if (kind === 'spell' || kind === 'spell-video') {
    return `users/${ownerUid}/spells/${entityId}`;
  }
  if (kind === 'map' || kind === 'map-video') {
    return `grigliata_backgrounds/${entityId}`;
  }
  if (kind === 'music') return `grigliata_music_tracks/${entityId}`;
  return '';
};

const audienceFor = (kind, referenceScope, commonTechnique = false) => {
  if (kind === 'foe') return 'dm-only';
  if (commonTechnique) return 'signed-in';
  if ((kind === 'item' && referenceScope === 'user-inventory') ||
    ['technique', 'technique-video', 'spell', 'spell-video'].includes(kind)) {
    return 'owner-manager';
  }
  return 'signed-in';
};

const roleAuthorizes = (kind, referenceScope, role) => {
  if (kind === 'avatar') return true;
  if (kind === 'item' && referenceScope === 'user-inventory') return true;
  if (kind === 'item' && referenceScope === 'global-catalog') {
    return ['dm', 'webmaster'].includes(role);
  }
  if (kind === 'npc') return ['dm', 'webmaster'].includes(role);
  if (kind === 'token') return true;
  if (['technique', 'technique-video', 'spell', 'spell-video']
    .includes(kind)) return true;
  if (['foe', 'map', 'map-video', 'music'].includes(kind)) {
    return ['dm', 'webmaster'].includes(role);
  }
  return false;
};

const targetSlotForKind = (kind) => (
  ['technique-video', 'spell-video'].includes(kind) ? 'videoMedia' : 'media'
);

const revisionFieldForKind = (kind) => (
  targetSlotForKind(kind) === 'videoMedia' ?
    'task07VideoMediaRevision' :
    'task07MediaRevision'
);

const updatedAtFieldForKind = (kind) => (
  targetSlotForKind(kind) === 'videoMedia' ?
    'videoMediaUpdatedAt' :
    'mediaUpdatedAt'
);

const previousAssetIdFromData = (data, kind) => {
  const slot = targetSlotForKind(kind);
  const candidates = [
    data?.[slot]?.assetId,
    slot === 'media' ? data?.General?.media?.assetId : null,
  ].map(asString).filter((value) => /^m_[a-f0-9]{40}$/.test(value));
  const unique = [...new Set(candidates)];
  return unique.length === 1 ? unique[0] : null;
};

const expectedRevisionFromData = (data, kind) => {
  const field = revisionFieldForKind(kind);
  return Number.isSafeInteger(data?.[field]) && Number(data[field]) >= 0 ?
    Number(data[field]) :
    0;
};

const targetMediaFingerprint = (data, kind) => canonicalHash({
  targetSlot: targetSlotForKind(kind),
  sourcePaths: legacyPathsForKind(data, kind),
  previousAssetId: previousAssetIdFromData(data, kind),
  expectedRevision: expectedRevisionFromData(data, kind),
  assetType: ['map', 'map-video'].includes(kind) ?
    asString(data?.assetType) :
    null,
});

const sourceKeyForRecord = (record) => {
  const explicit = asString(record?.sourceKey);
  if (SOURCE_KEY_SET.has(explicit)) return explicit;
  if (record?.kind === 'avatar') return 'avatars';
  if (record?.kind === 'item') {
    return referenceScopeFor(record) === 'global-catalog' ?
      'catalog-items' :
      'inventory-items';
  }
  if (record?.kind === 'npc') return 'npcs';
  if (record?.kind === 'foe') return 'foes';
  if (record?.kind === 'token' && record?.tokenMigrationClass === 'custom') {
    return 'custom-token-templates';
  }
  if (record?.kind === 'token' && record?.tokenMigrationClass === 'foe') {
    return 'foe-tokens';
  }
  if (record?.kind === 'technique' && record?.commonTechnique === true) {
    return 'common-technique-art';
  }
  if (record?.kind === 'technique-video' &&
    record?.commonTechnique === true) {
    return 'common-technique-video';
  }
  if (record?.kind === 'technique') return 'technique-art';
  if (record?.kind === 'technique-video') return 'technique-video';
  if (record?.kind === 'spell') return 'spell-art';
  if (record?.kind === 'spell-video') return 'spell-video';
  if (['map', 'map-video'].includes(record?.kind)) return 'backgrounds';
  if (record?.kind === 'music') return 'music-tracks';
  return '';
};

const sourceKeyForReceipt = (receipt) => sourceKeyForRecord({
  sourceKey: receipt?.sourceKey,
  kind: receipt?.kind,
  referenceScope: receipt?.referenceScope,
});

const generalImageUrlProof = (data, kind) => {
  if (kind !== 'item') return null;
  const general = isRecord(data?.General) ? data.General : {};
  const descriptor = hasOwn(general, 'image_url') ?
    {exists: true, value: general.image_url} :
    {exists: false};
  return {
    exists: descriptor.exists,
    valueHash: canonicalHash(descriptor),
  };
};

const exactSourceKeys = (values) => (
  Array.isArray(values) &&
  values.length === SOURCE_KEYS.length &&
  SOURCE_KEYS.every((sourceKey, index) => values[index] === sourceKey)
);

const buildServerPlanProjection = (input) => {
  const operationId = `task07-backfill-${canonicalHash({
    projectId: input.projectId,
    kind: input.kind,
    commonTechnique: input.commonTechnique === true,
    targetPath: input.targetPath,
    sourceFingerprint: input.sourceFingerprint,
    policyHash: POLICY_HASH,
  }).slice(0, 64)}`;
  const assetId = `m_${crypto.createHash('sha256')
    .update(`${input.ownerUid}\u0000${operationId}`)
    .digest('hex')
    .slice(0, 40)}`;
  return {
    assetId,
    operationId,
    targetKind: targetKindFor(
      input.kind,
      input.referenceScope,
      input.commonTechnique
    ),
    audienceScope: audienceFor(
      input.kind,
      input.referenceScope,
      input.commonTechnique
    ),
    sourcePath: `media_uploads/${input.ownerUid}/${assetId}/source`,
  };
};

const issue = (code, severity = 'error') => ({code, severity});

const planFingerprintCore = (report) => ({
  schemaVersion: report.schemaVersion,
  planVersion: report.planVersion,
  policyVersion: report.policyVersion,
  policyHash: report.policyHash,
  operation: report.operation,
  projectId: report.projectId,
  storageBucket: report.storageBucket,
  sourceKeys: report.sourceKeys,
  catalogOwnerUid: report.catalogOwnerUid,
  expectedCandidates: report.expectedCandidates,
  mode: report.mode,
  complete: report.complete,
  scan: report.scan,
  counts: report.counts,
  entries: report.entries,
  excluded: report.excluded,
});

const computePlanFingerprint = (report) => canonicalHash(
  planFingerprintCore(report)
);

const finalizeReport = ({
  operation,
  projectId,
  storageBucket = `${projectId}.appspot.com`,
  sourceKeys = SOURCE_KEYS,
  catalogOwnerUid = '',
  expectedCandidates = null,
  complete,
  scan,
  entries,
  excluded = [],
  records = 0,
}) => {
  const counts = {
    records,
    candidates: entries.length,
    excluded: excluded.length,
    discovered: entries.length + excluded.length,
    executable: entries.filter(({status}) => (
      ['ready', 'rollback-ready'].includes(status)
    )).length,
    skipped: entries.filter(({status}) => (
      ['already-rolled-back', 'verified', 'verified-rolled-back'].includes(status)
    )).length,
    errors: entries.filter(({issues}) => (
      issues.some(({severity}) => severity === 'error')
    )).length,
  };
  const report = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    planVersion: PLAN_VERSION,
    policyVersion: mediaPolicy.policyVersion,
    policyHash: POLICY_HASH,
    operation,
    projectId,
    storageBucket,
    sourceKeys: [...sourceKeys],
    catalogOwnerUid,
    expectedCandidates,
    mode: 'dry-run',
    complete: Boolean(complete),
    scan,
    counts,
    entries,
    excluded,
  };
  return {...report, planFingerprint: computePlanFingerprint(report)};
};

const buildLegacyMediaBackfillPlan = async (
  records,
  {
    projectId = DEMO_PROJECT_ID,
    storageBucket = `${projectId}.appspot.com`,
    sourceKeys = SOURCE_KEYS,
    catalogOwnerUid = '',
    expectedCandidates = null,
    readSourceObject = async () => null,
    readOwner = async () => null,
    scan = {complete: true, pageSize: DEFAULT_PAGE_SIZE, maxPages: 1},
  } = {}
) => {
  const entries = [];
  const excluded = [];
  const seen = new Set();
  const ownerCache = new Map();
  for (const record of records) {
    const kind = asString(record.kind);
    const sourceKey = sourceKeyForRecord(record);
    const commonTechnique = commonTechniqueForRecord(record);
    const entityId = asString(record.entityId);
    if (!SUPPORTED_KINDS.has(kind) || !SOURCE_KEY_SET.has(sourceKey) ||
      !sourceKeys.includes(sourceKey) || !entityId) continue;
    const data = isRecord(record.data) ? record.data : {};
    const referenceScope = referenceScopeFor(record);
    const candidatePaths = legacyPathsForKind(data, kind)
      .filter((sourcePath) => !isCanonicalTask07Path(sourcePath));
    for (const sourcePath of candidatePaths) {
      const explicitOwnerUid = asString(record.ownerUid);
      const inferredOwnerUid = commonTechnique ||
        sourceKey === 'music-tracks' ?
        '' :
        inferOwnerFromPath(sourcePath, kind);
      const mayUseFallback = GLOBAL_FALLBACK_OWNER_SOURCES.has(sourceKey);
      const ownerUid = explicitOwnerUid || inferredOwnerUid ||
        (mayUseFallback ? asString(catalogOwnerUid) : '');
      const ownerResolution = explicitOwnerUid ? 'explicit' :
        inferredOwnerUid ? 'legacy-path' :
          ownerUid ? 'verified-global-fallback' : 'missing';
      const targetPath = asString(record.targetPath) ||
        targetPathFor(
          kind,
          ownerUid,
          entityId,
          referenceScope,
          commonTechnique
        );
      const dedupeKey = [
        kind, referenceScope, targetPath, entityId, sourcePath,
      ].join('\u0000');
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      const source = normalizeSourceObject(
        sourcePath,
        await readSourceObject(sourcePath, record)
      );
      const placementReferenceCount = Number(record.placementReferenceCount);
      const placementReferenceHash = asString(record.placementReferenceHash);
      const sourceFoeProof = isRecord(record.sourceFoeProof) ?
        record.sourceFoeProof :
        null;
      const sourceFoeFingerprint = sourceFoeProof ?
        canonicalHash(sourceFoeProof) :
        '';
      if (sourceKey === 'foe-tokens' && placementReferenceCount === 0) {
        const exclusionCore = {
          schemaVersion: 1,
          reason: 'unplaced-foe-token-root',
          sourceKey,
          kind,
          entityId,
          ownerUid: asString(record.ownerUid),
          targetPath: asString(record.targetPath),
          targetVersion: asString(record.targetVersion),
          targetFingerprint: targetMediaFingerprint(data, kind),
          placementReferenceCount,
          placementReferenceHash,
          sourceFoeProof,
          sourceFoeFingerprint,
          sourcePath,
          sourceExists: source.exists,
          sourceContentType: source.contentType,
          sourceBytes: source.bytes,
          sourceGeneration: source.generation,
          sourceChecksum: source.checksum,
          sourceFingerprint: sourceObjectFingerprint(source),
        };
        const exclusionHash = canonicalHash(exclusionCore);
        excluded.push({
          exclusionId: `x_${exclusionHash.slice(0, 40)}`,
          ...exclusionCore,
          exclusionHash,
        });
        continue;
      }
      if (!ownerCache.has(ownerUid)) {
        ownerCache.set(ownerUid, ownerUid ? await readOwner(ownerUid) : null);
      }
      const owner = ownerCache.get(ownerUid);
      const role = asString(owner?.role).toLowerCase();
      const issues = [];
      const contract = mediaPolicy.purposes[kind];
      if (sourceKey === 'foe-tokens' && (
        !Number.isSafeInteger(placementReferenceCount) ||
        placementReferenceCount < 1 ||
        !/^[a-f0-9]{64}$/.test(placementReferenceHash)
      )) {
        issues.push(issue('placement-reference-proof-missing'));
      }
      if (sourceKey === 'foe-tokens' && (
        sourceFoeProof?.scanned !== true ||
        typeof sourceFoeProof?.exists !== 'boolean' ||
        sourceFoeProof?.referencePath !==
          `foes/${asString(data.foeSourceId)}` ||
        !/^[a-f0-9]{64}$/.test(asString(
          sourceFoeProof?.dataFingerprint
        )) ||
        !/^[a-f0-9]{64}$/.test(sourceFoeFingerprint)
      )) {
        issues.push(issue('source-foe-proof-missing'));
      }
      if (!ownerUid) issues.push(issue('missing-owner'));
      if (ownerUid && (!owner?.exists || owner?.deletionState === 'pending')) {
        issues.push(issue('owner-not-active'));
      }
      if (ownerUid && owner?.exists &&
        !roleAuthorizes(kind, referenceScope, role)) {
        issues.push(issue('owner-role-not-authorized'));
      }
      if (ownerResolution === 'verified-global-fallback' &&
        role !== 'webmaster') {
        issues.push(issue('fallback-owner-not-webmaster'));
      }
      if (!targetPath) issues.push(issue('unsupported-target'));
      if (data.deletionState === 'pending' ||
        data.pendingDeletion === true ||
        data.deleted === true) {
        issues.push(issue('target-unavailable'));
      }
      if (['map', 'map-video'].includes(kind)) {
        const expectedAssetType = kind === 'map-video' ? 'video' : 'image';
        const declaredAssetType = asString(data.assetType).toLowerCase();
        if (declaredAssetType && declaredAssetType !== expectedAssetType) {
          issues.push(issue('target-media-purpose-invalid'));
        }
      }
      if (isReservedTask07Path(sourcePath)) {
        issues.push(issue('reserved-task07-source-path'));
      }
      if (!source.exists) issues.push(issue('source-object-missing'));
      if (source.exists && !contract.contentTypes.includes(source.contentType)) {
        issues.push(issue('source-content-type-not-allowed'));
      }
      if (source.exists && (
        !Number.isSafeInteger(source.bytes) ||
        source.bytes <= 0 ||
        source.bytes > contract.maxBytes
      )) {
        issues.push(issue('source-byte-budget-invalid'));
      }
      if (source.exists && !/^[1-9][0-9]*$/.test(source.generation)) {
        issues.push(issue('source-generation-invalid'));
      }
      if (!asString(record.targetVersion)) {
        issues.push(issue('target-version-missing'));
      }
      const sourceFingerprint = sourceObjectFingerprint(source);
      const serverPlan = ownerUid && targetPath ?
        buildServerPlanProjection({
          projectId,
          kind,
          commonTechnique,
          referenceScope,
          ownerUid,
          targetPath,
          sourceFingerprint,
        }) :
        {
          assetId: '',
          operationId: '',
          targetKind: '',
          audienceScope: '',
          sourcePath: '',
        };
      const subjectHash = canonicalHash({
        projectId,
        policyHash: POLICY_HASH,
        kind,
        commonTechnique,
        referenceScope,
        ownerUid,
        entityId,
        targetPath,
        targetVersion: asString(record.targetVersion),
        targetFingerprint: targetMediaFingerprint(data, kind),
        targetSlot: targetSlotForKind(kind),
        expectedRevision: expectedRevisionFromData(data, kind),
        previousAssetId: previousAssetIdFromData(data, kind),
        sourceFingerprint,
        sourceKey,
        ownerResolution,
        placementReferenceCount: sourceKey === 'foe-tokens' ?
          placementReferenceCount : null,
        placementReferenceHash: sourceKey === 'foe-tokens' ?
          placementReferenceHash : null,
        sourceFoeFingerprint: sourceKey === 'foe-tokens' ?
          sourceFoeFingerprint : null,
        legacyGeneralImageUrlProof: generalImageUrlProof(data, kind),
      });
      entries.push({
        receiptId: `r_${subjectHash.slice(0, 40)}`,
        subjectHash,
        kind,
        sourceKey,
        commonTechnique,
        referenceScope,
        ownerUid,
        ownerResolution,
        entityId,
        targetPath,
        targetVersion: asString(record.targetVersion),
        targetFingerprint: targetMediaFingerprint(data, kind),
        targetSlot: targetSlotForKind(kind),
        expectedRevision: expectedRevisionFromData(data, kind),
        previousAssetId: previousAssetIdFromData(data, kind),
        sourcePath,
        sourceContentType: source.contentType,
        sourceBytes: source.bytes,
        sourceGeneration: source.generation,
        sourceChecksum: source.checksum,
        sourceFingerprint,
        placementReferenceCount: sourceKey === 'foe-tokens' ?
          placementReferenceCount : null,
        placementReferenceHash: sourceKey === 'foe-tokens' ?
          placementReferenceHash : null,
        sourceFoeProof: sourceKey === 'foe-tokens' ? sourceFoeProof : null,
        sourceFoeFingerprint: sourceKey === 'foe-tokens' ?
          sourceFoeFingerprint : null,
        legacyGeneralImageUrlProof: generalImageUrlProof(data, kind),
        assetId: serverPlan.assetId,
        operationId: serverPlan.operationId,
        stagingPath: serverPlan.sourcePath,
        targetKind: serverPlan.targetKind,
        audienceScope: serverPlan.audienceScope,
        status: issues.length ? 'blocked' : 'ready',
        issues,
      });
    }
  }
  const pathsByTarget = new Map();
  entries.forEach((entry) => {
    const targetSlotKey = [
      entry.targetPath,
      entry.entityId,
      entry.targetSlot,
    ].join('\u0000');
    if (!pathsByTarget.has(targetSlotKey)) {
      pathsByTarget.set(targetSlotKey, new Set());
    }
    pathsByTarget.get(targetSlotKey).add(entry.sourcePath);
  });
  entries.forEach((entry) => {
    const targetSlotKey = [
      entry.targetPath,
      entry.entityId,
      entry.targetSlot,
    ].join('\u0000');
    if (pathsByTarget.get(targetSlotKey).size <= 1) return;
    entry.issues.push(issue('ambiguous-legacy-media-reference'));
    entry.status = 'blocked';
  });
  excluded.sort((left, right) => (
    left.targetPath.localeCompare(right.targetPath) ||
    left.sourcePath.localeCompare(right.sourcePath) ||
    left.exclusionId.localeCompare(right.exclusionId)
  ));
  entries.sort((left, right) => (
    left.targetPath.localeCompare(right.targetPath) ||
    left.sourcePath.localeCompare(right.sourcePath) ||
    left.receiptId.localeCompare(right.receiptId)
  ));
  return finalizeReport({
    operation: 'backfill',
    projectId,
    storageBucket,
    sourceKeys,
    catalogOwnerUid,
    expectedCandidates,
    complete: scan.complete,
    scan,
    entries,
    excluded,
    records: records.length,
  });
};

const loadPaged = async ({
  sourceKeys,
  readPage,
  pageSize = DEFAULT_PAGE_SIZE,
  maxPages = DEFAULT_MAX_PAGES,
}) => {
  const records = [];
  const pagesBySource = {};
  const truncatedSources = [];
  for (const sourceKey of sourceKeys) {
    let cursor = null;
    let exhausted = false;
    pagesBySource[sourceKey] = 0;
    while (!exhausted && pagesBySource[sourceKey] < maxPages) {
      const page = await readPage(sourceKey, cursor, pageSize);
      if (!isRecord(page) || !Array.isArray(page.records) ||
        page.records.length > pageSize) {
        throw new Error(`Invalid bounded page returned for ${sourceKey}.`);
      }
      records.push(...page.records);
      pagesBySource[sourceKey] += 1;
      exhausted = page.hasMore !== true;
      if (!exhausted) {
        if (page.cursor == null || page.cursor === cursor) {
          throw new Error(`Pagination cursor did not advance for ${sourceKey}.`);
        }
        cursor = page.cursor;
      }
    }
    if (!exhausted) truncatedSources.push(sourceKey);
  }
  return {
    records,
    scan: {
      complete: truncatedSources.length === 0,
      pageSize,
      maxPages,
      concurrency: MIGRATION_CONCURRENCY,
      pagesBySource,
      truncatedSources,
    },
  };
};

const loadLegacyMediaRecords = async (
  backend,
  {
    pageSize = DEFAULT_PAGE_SIZE,
    maxPages = DEFAULT_MAX_PAGES,
    sourceKeys = SOURCE_KEYS,
  } = {}
) => loadPaged({
  sourceKeys,
  readPage: backend.readLegacyPage,
  pageSize,
  maxPages,
});

const buildReceiptOperationPlan = async ({
  backend,
  operation,
  projectId = DEMO_PROJECT_ID,
  storageBucket = `${projectId}.appspot.com`,
  sourceKeys = SOURCE_KEYS,
  catalogOwnerUid = '',
  expectedCandidates = null,
  pageSize = DEFAULT_PAGE_SIZE,
  maxPages = DEFAULT_MAX_PAGES,
}) => {
  if (!['verify', 'rollback'].includes(operation)) {
    throw new TypeError('Receipt plans support only verify or rollback.');
  }
  const loaded = await loadPaged({
    sourceKeys: ['receipts'],
    readPage: backend.readReceiptPage,
    pageSize,
    maxPages,
  });
  const entries = [];
  const receipts = exactSourceKeys(sourceKeys) ?
    loaded.records :
    loaded.records.filter((receipt) => (
      sourceKeys.includes(sourceKeyForReceipt(receipt))
    ));
  for (const receipt of receipts) {
    const receiptId = asString(receipt.receiptId || receipt.id);
    const sourceKey = sourceKeyForReceipt(receipt);
    const inspection = await backend.inspectReceipt(receipt);
    const issues = [];
    if (receipt.schemaVersion !== REPORT_SCHEMA_VERSION ||
      receipt.planVersion !== PLAN_VERSION ||
      receipt.policyVersion !== mediaPolicy.policyVersion ||
      receipt.policyHash !== POLICY_HASH ||
      !SOURCE_KEY_SET.has(sourceKey) ||
      !sourceKeys.includes(sourceKey) ||
      !asString(receipt.sourcePath) ||
      !/^[a-f0-9]{64}$/.test(asString(receipt.sourceFingerprint)) ||
      typeof receipt.commonTechnique !== 'boolean' ||
      !asString(receipt.entityId) ||
      (receipt.commonTechnique === true &&
        receipt.targetPath !== 'utils/tecniche_common') ||
      !['media', 'videoMedia'].includes(receipt.targetSlot) ||
      !/^[a-f0-9]{64}$/.test(asString(receipt.subjectHash)) ||
      (sourceKey === 'foe-tokens' && (
        !Number.isSafeInteger(receipt.placementReferenceCount) ||
        receipt.placementReferenceCount < 1 ||
        !/^[a-f0-9]{64}$/.test(asString(
          receipt.placementReferenceHash
        )) ||
        receipt.sourceFoeProof?.scanned !== true ||
        typeof receipt.sourceFoeProof?.exists !== 'boolean' ||
        !/^foes\/[^/]+$/.test(asString(
          receipt.sourceFoeProof?.referencePath
        )) ||
        !/^[a-f0-9]{64}$/.test(asString(receipt.sourceFoeFingerprint))
      ))) {
      issues.push(issue('receipt-contract-mismatch'));
    }
    const attached = receipt.state === 'attached';
    const rolledBack = receipt.state === 'rolled-back';
    if (!attached && !rolledBack) issues.push(issue('receipt-not-terminal'));
    if (attached && (
      inspection.manifestState !== 'attached' ||
      inspection.targetAssetId !== receipt.assetId ||
      Number(inspection.targetRevision) !== Number(receipt.attachedRevision) ||
      inspection.generatedObjectsPresent !== true ||
      inspection.legacySourceUnchanged !== true ||
      inspection.legacyGeneralImageUrlUnchanged !== true ||
      (sourceKey === 'foe-tokens' && (
        inspection.placementReferenceCount !==
          receipt.placementReferenceCount ||
        inspection.placementReferenceHash !== receipt.placementReferenceHash ||
        inspection.sourceFoeFingerprint !== receipt.sourceFoeFingerprint
      )) ||
      (receipt.kind === 'item' && (
        inspection.itemOriginalGenerated !== true ||
        inspection.itemCardGenerated !== true ||
        inspection.itemCard2xGenerated !== true
      ))
    )) {
      issues.push(issue('attached-receipt-drift'));
    }
    if (rolledBack && (
      inspection.targetAssetId !== (receipt.previousAssetId || null) ||
      !['cleanup-pending', 'deleted'].includes(inspection.manifestState) ||
      inspection.legacySourceUnchanged !== true ||
      inspection.legacyGeneralImageUrlUnchanged !== true ||
      (sourceKey === 'foe-tokens' && (
        inspection.placementReferenceCount !==
          receipt.placementReferenceCount ||
        inspection.placementReferenceHash !== receipt.placementReferenceHash ||
        inspection.sourceFoeFingerprint !== receipt.sourceFoeFingerprint
      ))
    )) {
      issues.push(issue('rolled-back-receipt-drift'));
    }
    const inspectionHash = canonicalHash(inspection);
    let status = 'blocked';
    if (!issues.length && operation === 'verify') {
      status = attached ? 'verified' : 'verified-rolled-back';
    }
    if (!issues.length && operation === 'rollback') {
      status = attached ? 'rollback-ready' : 'already-rolled-back';
    }
    entries.push({
      receiptId,
      sourceKey,
      subjectHash: asString(receipt.subjectHash),
      kind: asString(receipt.kind),
      entityId: asString(receipt.entityId),
      commonTechnique: receipt.commonTechnique === true,
      assetId: asString(receipt.assetId),
      previousAssetId: asString(receipt.previousAssetId) || null,
      targetPath: asString(receipt.targetPath),
      targetSlot: receipt.targetSlot === 'videoMedia' ?
        'videoMedia' :
        'media',
      receiptState: asString(receipt.state),
      proofs: {
        generatedObjectsPresent: inspection.generatedObjectsPresent === true,
        legacySourceUnchanged: inspection.legacySourceUnchanged === true,
        legacyGeneralImageUrlUnchanged:
          inspection.legacyGeneralImageUrlUnchanged === true,
        itemOriginalGenerated: inspection.itemOriginalGenerated === true,
        itemCardGenerated: inspection.itemCardGenerated === true,
        itemCard2xGenerated: inspection.itemCard2xGenerated === true,
        placementReferenceCount: sourceKey === 'foe-tokens' ?
          inspection.placementReferenceCount : null,
        placementReferenceHash: sourceKey === 'foe-tokens' ?
          asString(inspection.placementReferenceHash) : null,
        sourceFoeFingerprint: sourceKey === 'foe-tokens' ?
          asString(inspection.sourceFoeFingerprint) : null,
      },
      inspectionHash,
      status,
      issues,
    });
  }
  entries.sort((left, right) => left.receiptId.localeCompare(right.receiptId));
  return finalizeReport({
    operation,
    projectId,
    storageBucket,
    sourceKeys,
    catalogOwnerUid,
    expectedCandidates,
    complete: loaded.scan.complete,
    scan: loaded.scan,
    entries,
    records: receipts.length,
  });
};

const buildMigrationPlan = async ({
  backend,
  operation,
  projectId,
  storageBucket,
  sourceKeys = SOURCE_KEYS,
  catalogOwnerUid = '',
  expectedCandidates = null,
  pageSize,
  maxPages,
}) => {
  if (operation === 'backfill') {
    const loaded = await loadLegacyMediaRecords(backend, {
      pageSize,
      maxPages,
      sourceKeys,
    });
    return buildLegacyMediaBackfillPlan(loaded.records, {
      projectId,
      storageBucket,
      sourceKeys,
      catalogOwnerUid,
      expectedCandidates,
      scan: loaded.scan,
      readSourceObject: backend.readSourceObject,
      readOwner: backend.readOwner,
    });
  }
  return buildReceiptOperationPlan({
    backend,
    operation,
    projectId,
    storageBucket,
    sourceKeys,
    catalogOwnerUid,
    expectedCandidates,
    pageSize,
    maxPages,
  });
};

const parsePositiveInteger = (value, name, maximum) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new TypeError(`${name} must be an integer from 1 to ${maximum}.`);
  }
  return parsed;
};

const parseNonNegativeInteger = (value, name, maximum = 1000000) => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maximum) {
    throw new TypeError(`${name} must be an integer from 0 to ${maximum}.`);
  }
  return parsed;
};

const parseOptions = (argv = []) => {
  const options = {
    operation: 'backfill',
    projectId: '',
    authMode: 'admin',
    allowLiveProject: false,
    confirmProject: '',
    sourceKeys: [],
    sourcesExplicit: false,
    catalogOwnerUid: '',
    confirmCatalogOwnerUid: '',
    expectedCandidates: null,
    execute: false,
    approveFingerprint: '',
    reportPath: '',
    checkpointPath: '',
    resume: false,
    pageSize: DEFAULT_PAGE_SIZE,
    maxPages: DEFAULT_MAX_PAGES,
    pollTimeoutMs: DEFAULT_POLL_TIMEOUT_MS,
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') options.help = true;
    else if (argument === '--execute' || argument === '--apply') {
      options.execute = true;
    } else if (argument === '--resume') options.resume = true;
    else if (argument === '--json') options.json = true;
    else if (argument === '--allow-live-project') {
      options.allowLiveProject = true;
    } else if (argument === '--write' || argument === '--allow-live-read') {
      throw new TypeError(`${argument} is not supported by Task 07 backfill.`);
    } else if ([
      '--operation',
      '--project',
      '--auth',
      '--confirm-project',
      '--source',
      '--catalog-owner-uid',
      '--confirm-catalog-owner-uid',
      '--expected-candidates',
      '--approve-fingerprint',
      '--report',
      '--checkpoint',
      '--page-size',
      '--max-pages',
      '--poll-timeout-ms',
    ].includes(argument)) {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new TypeError(`Missing value for ${argument}.`);
      }
      index += 1;
      if (argument === '--operation') options.operation = value;
      if (argument === '--project') options.projectId = value;
      if (argument === '--auth') options.authMode = value;
      if (argument === '--confirm-project') options.confirmProject = value;
      if (argument === '--source') {
        options.sourceKeys.push(value);
        options.sourcesExplicit = true;
      }
      if (argument === '--catalog-owner-uid') {
        options.catalogOwnerUid = value;
      }
      if (argument === '--confirm-catalog-owner-uid') {
        options.confirmCatalogOwnerUid = value;
      }
      if (argument === '--expected-candidates') {
        options.expectedCandidates = parseNonNegativeInteger(
          value,
          '--expected-candidates'
        );
      }
      if (argument === '--approve-fingerprint') {
        options.approveFingerprint = value;
      }
      if (argument === '--report') options.reportPath = path.resolve(value);
      if (argument === '--checkpoint') {
        options.checkpointPath = path.resolve(value);
      }
      if (argument === '--page-size') {
        options.pageSize = parsePositiveInteger(
          value,
          '--page-size',
          MAX_PAGE_SIZE
        );
      }
      if (argument === '--max-pages') {
        options.maxPages = parsePositiveInteger(
          value,
          '--max-pages',
          MAX_MAX_PAGES
        );
      }
      if (argument === '--poll-timeout-ms') {
        options.pollTimeoutMs = parsePositiveInteger(
          value,
          '--poll-timeout-ms',
          DEFAULT_POLL_TIMEOUT_MS
        );
        if (options.pollTimeoutMs < 1000) {
          throw new TypeError('--poll-timeout-ms must be at least 1000.');
        }
      }
    } else {
      throw new TypeError(`Unknown argument: ${argument}`);
    }
  }
  if (!options.help && !options.projectId) {
    throw new TypeError('--project is required.');
  }
  if (!OPERATIONS.has(options.operation)) {
    throw new TypeError(`Unsupported operation: ${options.operation}`);
  }
  if (!AUTH_MODES.has(options.authMode)) {
    throw new TypeError('--auth must be exactly admin or firebase-cli.');
  }
  if (options.sourceKeys.some((sourceKey) => !SOURCE_KEY_SET.has(sourceKey))) {
    throw new TypeError(
      `--source must be one of: ${SOURCE_KEYS.join(', ')}.`
    );
  }
  const requestedSources = new Set(options.sourceKeys);
  if (requestedSources.size !== options.sourceKeys.length) {
    throw new TypeError('Each --source may be specified only once.');
  }
  options.sourceKeys = options.sourcesExplicit ?
    SOURCE_KEYS.filter((sourceKey) => requestedSources.has(sourceKey)) :
    [...SOURCE_KEYS];
  if (options.operation === 'verify' && options.execute) {
    throw new TypeError('Verification is always read-only.');
  }
  if (options.resume && !options.execute) {
    throw new TypeError('--resume requires --execute or --apply.');
  }
  if (options.execute &&
    !/^[a-f0-9]{64}$/.test(options.approveFingerprint)) {
    throw new TypeError(
      'Execution requires an exact --approve-fingerprint.'
    );
  }
  if (options.execute && options.expectedCandidates === null) {
    throw new TypeError(
      'Execution requires the reviewed --expected-candidates count.'
    );
  }
  options.reportPath ||= defaultResultPath(options.operation, 'plan');
  options.checkpointPath ||= defaultResultPath(options.operation, 'checkpoint');
  return options;
};

const parseLoopbackEmulatorHost = (value) => {
  const text = asString(value);
  if (!text || text.includes('://')) return null;
  try {
    const parsed = new URL(`http://${text}`);
    if (!parsed.port || parsed.username || parsed.password ||
      parsed.search || parsed.hash ||
      (parsed.pathname && parsed.pathname !== '/') ||
      !LOOPBACK_HOSTS.has(parsed.hostname)) return null;
    return parsed;
  } catch {
    return null;
  }
};

const assertSafeTarget = (options, env = process.env) => {
  if (![DEMO_PROJECT_ID, PRODUCTION_PROJECT_ID].includes(options.projectId)) {
    throw new TypeError(
      `Task 07 media backfill permits only ${DEMO_PROJECT_ID} or ` +
      `${PRODUCTION_PROJECT_ID}; every other live project is refused.`
    );
  }
  for (const variable of ['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT']) {
    if (env[variable] && env[variable] !== options.projectId) {
      throw new TypeError(
        `${variable} does not match the explicit --project.`
      );
    }
  }
  const firestoreEmulator = parseLoopbackEmulatorHost(
    env.FIRESTORE_EMULATOR_HOST
  );
  const storageEmulator = parseLoopbackEmulatorHost(
    env.FIREBASE_STORAGE_EMULATOR_HOST
  );
  const functionsEmulator = parseLoopbackEmulatorHost(
    env.FUNCTIONS_EMULATOR_HOST
  );
  if (options.projectId === PRODUCTION_PROJECT_ID) {
    if (env.FIRESTORE_EMULATOR_HOST ||
      env.FIREBASE_STORAGE_EMULATOR_HOST ||
      env.FUNCTIONS_EMULATOR_HOST) {
      throw new TypeError(
        `Live ${PRODUCTION_PROJECT_ID} migration refuses all emulator host variables.`
      );
    }
    if (!options.allowLiveProject ||
      options.confirmProject !== PRODUCTION_PROJECT_ID) {
      throw new TypeError(
        `Live ${PRODUCTION_PROJECT_ID} access requires --allow-live-project and exact ` +
        `--confirm-project ${PRODUCTION_PROJECT_ID}.`
      );
    }
    if (options.authMode !== 'firebase-cli') {
      throw new TypeError(
        `Live ${PRODUCTION_PROJECT_ID} access requires --auth firebase-cli.`
      );
    }
    if (!options.sourcesExplicit || !exactSourceKeys(options.sourceKeys)) {
      throw new TypeError(
        `Live ${PRODUCTION_PROJECT_ID} access requires every supported source as an ` +
        'explicit repeated --source.'
      );
    }
    if (!/^[A-Za-z0-9._:@-]{1,128}$/.test(options.catalogOwnerUid) ||
      options.confirmCatalogOwnerUid !== options.catalogOwnerUid) {
      throw new TypeError(
        `Live ${PRODUCTION_PROJECT_ID} access requires --catalog-owner-uid and exact ` +
        '--confirm-catalog-owner-uid.'
      );
    }
    return {
      projectId: options.projectId,
      storageBucket: PRODUCTION_STORAGE_BUCKET,
      live: true,
      concurrency: MIGRATION_CONCURRENCY,
    };
  }
  if (!firestoreEmulator) {
    throw new TypeError(
      'Task 07 media backfill requires a loopback Firestore emulator.'
    );
  }
  if (!storageEmulator) {
    throw new TypeError(
      'Task 07 media backfill requires a loopback Storage emulator.'
    );
  }
  if (options.execute && options.operation === 'backfill' &&
    !functionsEmulator) {
    throw new TypeError(
      'Task 07 backfill execution requires a loopback Functions emulator.'
    );
  }
  return {
    projectId: options.projectId,
    storageBucket: `${options.projectId}.appspot.com`,
    live: false,
    concurrency: MIGRATION_CONCURRENCY,
  };
};

const assertReadOnlyTarget = assertSafeTarget;

const expectedStorageBucket = (projectId) => (
  projectId === PRODUCTION_PROJECT_ID ?
    PRODUCTION_STORAGE_BUCKET :
    `${projectId}.appspot.com`
);

const assertCandidateCountBinding = (report, expectedCandidates, {
  required = false,
} = {}) => {
  if (expectedCandidates === null || expectedCandidates === undefined) {
    if (required) {
      throw new Error('The reviewed --expected-candidates binding is required.');
    }
    return report;
  }
  if (report.expectedCandidates !== expectedCandidates ||
    report.counts?.candidates !== expectedCandidates ||
    report.entries?.length !== expectedCandidates) {
    throw new Error(
      `Task 07 candidate count changed: expected ${expectedCandidates}, ` +
      `found ${report.counts?.candidates ?? 'unknown'}. Re-plan.`
    );
  }
  return report;
};

const validFoeTokenExclusion = (entry) => {
  if (!isRecord(entry)) return false;
  const {exclusionId, exclusionHash, ...core} = entry;
  return entry.schemaVersion === 1 &&
    entry.reason === 'unplaced-foe-token-root' &&
    entry.sourceKey === 'foe-tokens' &&
    entry.kind === 'token' &&
    asString(entry.entityId) !== '' &&
    asString(entry.targetPath) === `grigliata_tokens/${entry.entityId}` &&
    asString(entry.targetVersion) !== '' &&
    entry.placementReferenceCount === 0 &&
    /^[a-f0-9]{64}$/.test(asString(entry.placementReferenceHash)) &&
    entry.sourceFoeProof?.scanned === true &&
    typeof entry.sourceFoeProof?.exists === 'boolean' &&
    /^foes\/[^/]+$/.test(asString(entry.sourceFoeProof?.referencePath)) &&
    /^[a-f0-9]{64}$/.test(asString(
      entry.sourceFoeProof?.dataFingerprint
    )) &&
    /^[a-f0-9]{64}$/.test(asString(entry.sourceFoeFingerprint)) &&
    /^[a-f0-9]{64}$/.test(asString(entry.sourceFingerprint)) &&
    typeof entry.sourceExists === 'boolean' &&
    /^[a-f0-9]{64}$/.test(asString(exclusionHash)) &&
    exclusionId === `x_${exclusionHash.slice(0, 40)}` &&
    canonicalHash(core) === exclusionHash;
};

const assertApprovedReport = (report, options) => {
  if (!isRecord(report) ||
    report.schemaVersion !== REPORT_SCHEMA_VERSION ||
    report.planVersion !== PLAN_VERSION ||
    report.policyVersion !== mediaPolicy.policyVersion ||
    report.policyHash !== POLICY_HASH ||
    report.operation !== options.operation ||
    report.projectId !== options.projectId ||
    report.storageBucket !== expectedStorageBucket(options.projectId) ||
    !Array.isArray(report.sourceKeys) ||
    !Array.isArray(options.sourceKeys) ||
    canonicalHash(report.sourceKeys) !== canonicalHash(options.sourceKeys) ||
    report.catalogOwnerUid !== options.catalogOwnerUid ||
    report.expectedCandidates !== options.expectedCandidates ||
    report.mode !== 'dry-run' ||
    report.complete !== true ||
    report.scan?.complete !== true ||
    report.scan?.concurrency !== MIGRATION_CONCURRENCY ||
    !Number.isInteger(report.scan?.pageSize) ||
    report.scan.pageSize < 1 ||
    report.scan.pageSize > MAX_PAGE_SIZE ||
    !Number.isInteger(report.scan?.maxPages) ||
    report.scan.maxPages < 1 ||
    report.scan.maxPages > MAX_MAX_PAGES ||
    !Array.isArray(report.scan?.truncatedSources) ||
    report.scan.truncatedSources.length !== 0 ||
    report.counts?.errors !== 0 ||
    !Array.isArray(report.entries) ||
    !Array.isArray(report.excluded) ||
    report.counts?.candidates !== report.entries.length ||
    report.counts?.excluded !== report.excluded.length ||
    report.counts?.discovered !==
      report.entries.length + report.excluded.length ||
    !report.excluded.every(validFoeTokenExclusion) ||
    report.planFingerprint !== computePlanFingerprint(report)) {
    throw new Error(
      'Execution requires the exact completed, error-free Task 07 plan.'
    );
  }
  assertCandidateCountBinding(report, options.expectedCandidates, {
    required: true,
  });
  if (options.projectId === PRODUCTION_PROJECT_ID && (
    !exactSourceKeys(report.sourceKeys) ||
    report.storageBucket !== PRODUCTION_STORAGE_BUCKET ||
    report.entries.some((entry) => (
      !SOURCE_KEY_SET.has(entry.sourceKey) ||
      (entry.ownerResolution === 'verified-global-fallback' &&
        entry.ownerUid !== options.catalogOwnerUid)
    )) ||
    report.excluded.some((entry) => (
      entry.sourceKey !== 'foe-tokens'
    ))
  )) {
    throw new Error('The live Task 07 plan escaped its all-source binding.');
  }
  if (options.approveFingerprint !== report.planFingerprint) {
    throw new Error(
      '--approve-fingerprint must exactly match the reviewed plan.'
    );
  }
  return report;
};

const assertCheckpoint = (checkpoint, report, options) => {
  const cursorIndex = Array.isArray(report?.entries) ?
    report.entries.findIndex(({receiptId}) => (
      receiptId === checkpoint?.lastReceiptId
    )) :
    -1;
  const emptyComplete = report?.entries?.length === 0 &&
    checkpoint?.lastReceiptId === '' &&
    checkpoint?.processed === 0 &&
    checkpoint?.complete === true;
  const positioned = cursorIndex >= 0 &&
    checkpoint?.processed === cursorIndex + 1 &&
    checkpoint?.complete === (cursorIndex === report.entries.length - 1);
  if (!isRecord(checkpoint) ||
    checkpoint.schemaVersion !== REPORT_SCHEMA_VERSION ||
    checkpoint.planVersion !== PLAN_VERSION ||
    checkpoint.policyVersion !== mediaPolicy.policyVersion ||
    checkpoint.policyHash !== POLICY_HASH ||
    checkpoint.mode !== 'execute' ||
    checkpoint.operation !== options.operation ||
    checkpoint.projectId !== options.projectId ||
    checkpoint.planFingerprint !== report.planFingerprint ||
    typeof checkpoint.lastReceiptId !== 'string' ||
    !Number.isSafeInteger(checkpoint.processed) ||
    checkpoint.processed < 0 ||
    (!emptyComplete && !positioned)) {
    throw new Error(
      'Checkpoint does not match the exact approved Task 07 plan.'
    );
  }
  return checkpoint;
};

const executeMigrationPlan = async ({
  backend,
  options,
  report,
  onCheckpoint = async () => {},
}) => {
  assertApprovedReport(report, options);
  const allowedStatus = options.operation === 'backfill' ?
    new Set(['ready']) :
    new Set(['rollback-ready', 'already-rolled-back']);
  if (report.entries.some(({status}) => !allowedStatus.has(status))) {
    throw new Error('Task 07 execution is blocked by non-executable entries.');
  }
  const sourceFoeReceiptByTarget = new Map();
  report.entries.filter(({sourceKey}) => sourceKey === 'foes')
    .forEach(({targetPath, receiptId}) => {
      sourceFoeReceiptByTarget.set(
        targetPath,
        sourceFoeReceiptByTarget.has(targetPath) ? null : receiptId
      );
    });
  let startIndex = 0;
  let processed = 0;
  if (options.resumeCheckpoint) {
    assertCheckpoint(options.resumeCheckpoint, report, options);
    if (options.resumeCheckpoint.complete) {
      return {processed: options.resumeCheckpoint.processed, complete: true};
    }
    const index = report.entries.findIndex(({receiptId}) => (
      receiptId === options.resumeCheckpoint.lastReceiptId
    ));
    if (index < 0) {
      throw new Error('Checkpoint cursor is absent from the approved plan.');
    }
    startIndex = index + 1;
    processed = options.resumeCheckpoint.processed;
  }
  if (!report.entries.length) {
    const checkpoint = {
      schemaVersion: REPORT_SCHEMA_VERSION,
      planVersion: PLAN_VERSION,
      policyVersion: mediaPolicy.policyVersion,
      policyHash: POLICY_HASH,
      mode: 'execute',
      operation: options.operation,
      projectId: options.projectId,
      planFingerprint: report.planFingerprint,
      lastReceiptId: '',
      processed: 0,
      complete: true,
    };
    await onCheckpoint(checkpoint);
    return {processed: 0, complete: true};
  }
  for (let index = startIndex; index < report.entries.length; index += 1) {
    const entry = report.entries[index];
    let result;
    if (options.operation === 'backfill') {
      result = await backend.applyBackfillEntry(entry, {
        planFingerprint: report.planFingerprint,
        pollTimeoutMs: options.pollTimeoutMs,
        sourceFoeBackfillReceiptId: entry.sourceKey === 'foe-tokens' ?
          sourceFoeReceiptByTarget.get(
            asString(entry.sourceFoeProof?.referencePath)
          ) || null : null,
      });
    } else if (entry.status === 'already-rolled-back') {
      result = {verified: true, idempotent: true};
    } else {
      result = await backend.rollbackEntry(entry, {
        planFingerprint: report.planFingerprint,
      });
    }
    if (result?.verified !== true) {
      throw new Error(
        `Post-write verification failed for receipt ${entry.receiptId}.`
      );
    }
    processed += 1;
    await onCheckpoint({
      schemaVersion: REPORT_SCHEMA_VERSION,
      planVersion: PLAN_VERSION,
      policyVersion: mediaPolicy.policyVersion,
      policyHash: POLICY_HASH,
      mode: 'execute',
      operation: options.operation,
      projectId: options.projectId,
      planFingerprint: report.planFingerprint,
      lastReceiptId: entry.receiptId,
      processed,
      complete: index === report.entries.length - 1,
    });
  }
  return {processed, complete: processed === report.entries.length};
};

const stagingActionForManifest = (state, retryable) => {
  const normalized = asString(state);
  if (['ready', 'attached'].includes(normalized)) return 'complete';
  if (['intent', 'uploaded'].includes(normalized) ||
    (normalized === 'failed' && retryable === true)) return 'stage';
  if (normalized === 'processing') return 'poll';
  if (['failed', 'rejected', 'cancelled'].includes(normalized)) {
    throw new Error(
      `Task 07 processor stopped in ${normalized || 'unknown'} state.`
    );
  }
  throw new Error(`Task 07 manifest has unexpected ${normalized} state.`);
};

const snapshotVersion = (snapshot) => {
  const timestamp = snapshot?.updateTime;
  const seconds = Number(timestamp?.seconds ?? timestamp?._seconds);
  const nanoseconds = Number(timestamp?.nanoseconds ?? timestamp?._nanoseconds);
  return Number.isInteger(seconds) && Number.isInteger(nanoseconds) ?
    `${seconds}:${String(nanoseconds).padStart(9, '0')}` :
    '';
};

const recordFromSnapshot = (sourceKey, snapshot) => {
  const data = snapshot.data() || {};
  if (sourceKey === 'avatars') {
    return {
      kind: 'avatar',
      ownerUid: snapshot.id,
      entityId: snapshot.id,
      targetPath: snapshot.ref.path,
      targetVersion: snapshotVersion(snapshot),
      data: {
        imagePath: data.imagePath,
        imageUrl: data.imageUrl,
        media: data.media,
        task07MediaRevision: data.task07MediaRevision,
        deletionState: data.deletionState,
        pendingDeletion: data.pendingDeletion,
        deleted: data.deleted,
      },
    };
  }
  if (sourceKey === 'catalog-items') {
    return {
      kind: 'item',
      ownerUid: asString(data.ownerUid) ||
        asString(data.createdBy) ||
        asString(data.updatedBy),
      entityId: snapshot.id,
      referenceScope: 'global-catalog',
      targetPath: snapshot.ref.path,
      targetVersion: snapshotVersion(snapshot),
      data,
    };
  }
  if (sourceKey === 'inventory-items') {
    return {
      kind: 'item',
      ownerUid: snapshot.ref.parent.parent?.id || '',
      entityId: snapshot.id,
      referenceScope: 'user-inventory',
      targetPath: snapshot.ref.path,
      targetVersion: snapshotVersion(snapshot),
      data,
    };
  }
  if (sourceKey === 'npcs') {
    return {
      kind: 'npc',
      ownerUid: asString(data.ownerUid) ||
        asString(data.createdBy) ||
        asString(data.updatedBy),
      entityId: snapshot.id,
      targetPath: snapshot.ref.path,
      targetVersion: snapshotVersion(snapshot),
      data,
    };
  }
  if (sourceKey === 'foes') {
    return {
      kind: 'foe',
      ownerUid: asString(data.ownerUid) ||
        asString(data.createdBy) ||
        asString(data.updatedBy),
      entityId: snapshot.id,
      targetPath: snapshot.ref.path,
      targetVersion: snapshotVersion(snapshot),
      data,
    };
  }
  if (['custom-token-templates', 'foe-tokens'].includes(sourceKey)) {
    const tokenMigrationClass = sourceKey === 'foe-tokens' ? 'foe' : 'custom';
    return {
      kind: 'token',
      sourceKey,
      tokenMigrationClass,
      ownerUid: asString(data.ownerUid),
      entityId: snapshot.id,
      targetPath: snapshot.ref.path,
      targetVersion: snapshotVersion(snapshot),
      data: {
        ownerUid: data.ownerUid,
        tokenType: data.tokenType,
        foeSourceId: data.foeSourceId,
        customTokenRole: data.customTokenRole,
        customTemplateId: data.customTemplateId,
        image_url: data.image_url,
        imagePath: data.imagePath,
        imageUrl: data.imageUrl,
        media: data.media,
        task07MediaRevision: data.task07MediaRevision,
        deletionState: data.deletionState,
        pendingDeletion: data.pendingDeletion,
        deleted: data.deleted,
      },
    };
  }
  if (['technique-art', 'technique-video'].includes(sourceKey)) {
    const video = sourceKey === 'technique-video';
    return {
      kind: video ? 'technique-video' : 'technique',
      ownerUid: snapshot.ref.parent.parent?.id || '',
      entityId: snapshot.id,
      targetPath: snapshot.ref.path,
      targetVersion: snapshotVersion(snapshot),
      data: video ? {
        video_url: data.video_url,
        videoUrl: data.videoUrl,
        videoMedia: data.videoMedia,
        task07VideoMediaRevision: data.task07VideoMediaRevision,
        deletionState: data.deletionState,
        pendingDeletion: data.pendingDeletion,
        deleted: data.deleted,
      } : {
        image_url: data.image_url,
        imagePath: data.imagePath,
        imageUrl: data.imageUrl,
        media: data.media,
        task07MediaRevision: data.task07MediaRevision,
        deletionState: data.deletionState,
        pendingDeletion: data.pendingDeletion,
        deleted: data.deleted,
      },
    };
  }
  if (['spell-art', 'spell-video'].includes(sourceKey)) {
    const video = sourceKey === 'spell-video';
    return {
      kind: video ? 'spell-video' : 'spell',
      ownerUid: snapshot.ref.parent.parent?.id || '',
      entityId: snapshot.id,
      targetPath: snapshot.ref.path,
      targetVersion: snapshotVersion(snapshot),
      data: video ? {
        video_url: data.video_url,
        videoUrl: data.videoUrl,
        videoMedia: data.videoMedia,
        task07VideoMediaRevision: data.task07VideoMediaRevision,
        deletionState: data.deletionState,
        pendingDeletion: data.pendingDeletion,
        deleted: data.deleted,
      } : {
        image_url: data.image_url,
        imagePath: data.imagePath,
        imageUrl: data.imageUrl,
        media: data.media,
        task07MediaRevision: data.task07MediaRevision,
        deletionState: data.deletionState,
        pendingDeletion: data.pendingDeletion,
        deleted: data.deleted,
      },
    };
  }
  if (sourceKey === 'backgrounds') {
    return {
      kind: data.assetType === 'video' ||
        normalizeContentType(data.contentType).startsWith('video/') ?
        'map-video' :
        'map',
      ownerUid: asString(data.ownerUid) ||
        asString(data.createdBy) ||
        asString(data.updatedBy),
      entityId: snapshot.id,
      targetPath: snapshot.ref.path,
      targetVersion: snapshotVersion(snapshot),
      data,
    };
  }
  if (sourceKey === 'music-tracks') {
    return {
      kind: 'music',
      sourceKey,
      ownerUid: asString(data.createdBy) ||
        asString(data.updatedBy),
      entityId: snapshot.id,
      targetPath: snapshot.ref.path,
      targetVersion: snapshotVersion(snapshot),
      data: {
        ownerUid: data.ownerUid,
        createdBy: data.createdBy,
        updatedBy: data.updatedBy,
        audioPath: data.audioPath,
        audioUrl: data.audioUrl,
        media: data.media,
        task07MediaRevision: data.task07MediaRevision,
        deletionState: data.deletionState,
        pendingDeletion: data.pendingDeletion,
        deleted: data.deleted,
      },
    };
  }
  throw new Error(`Unknown legacy media source: ${sourceKey}`);
};

const commonTechniqueRecord = ({
  sourceKey,
  entityId,
  data,
  targetVersion,
}) => {
  const video = sourceKey === 'common-technique-video';
  return {
    kind: video ? 'technique-video' : 'technique',
    sourceKey,
    commonTechnique: true,
    ownerUid: asString(data.ownerUid) ||
      asString(data.createdBy) ||
      asString(data.updatedBy),
    entityId,
    targetPath: 'utils/tecniche_common',
    targetVersion,
    data,
  };
};

const compatibilityFieldsForKind = (kind) => (
  ['technique', 'technique-video', 'spell', 'spell-video'].includes(kind) ?
    [targetSlotForKind(kind)] :
    TARGET_COMPATIBILITY_FIELDS.filter((field) => field !== 'videoMedia')
);

const captureCompatibilityFields = (data, kind) => Object.fromEntries(
  compatibilityFieldsForKind(kind).map((field) => [
    field,
    hasOwn(data, field) ?
      {exists: true, value: data[field]} :
      {exists: false},
  ])
);

const approvedSourceFoeBackfillMatches = ({
  currentData,
  expectedProof,
  receipt,
  manifest,
  sourceReceiptId,
  planFingerprint,
}) => {
  if (!isRecord(currentData) || !isRecord(expectedProof) ||
    !isRecord(receipt) || !isRecord(manifest) ||
    !/^r_[a-f0-9]{40}$/.test(asString(sourceReceiptId)) ||
    expectedProof.exists !== true ||
    !/^foes\/[^/]+$/.test(asString(expectedProof.referencePath)) ||
    !/^[a-f0-9]{64}$/.test(asString(expectedProof.dataFingerprint)) ||
    receipt.receiptId !== sourceReceiptId ||
    receipt.schemaVersion !== REPORT_SCHEMA_VERSION ||
    receipt.planVersion !== PLAN_VERSION ||
    receipt.policyVersion !== mediaPolicy.policyVersion ||
    receipt.policyHash !== POLICY_HASH ||
    receipt.approvedPlanFingerprint !== planFingerprint ||
    receipt.state !== 'attached' ||
    receipt.sourceKey !== 'foes' || receipt.kind !== 'foe' ||
    receipt.commonTechnique !== false ||
    receipt.targetPath !== expectedProof.referencePath ||
    receipt.previousAssetId !== null ||
    !/^m_[a-f0-9]{40}$/.test(asString(receipt.assetId)) ||
    !Number.isSafeInteger(receipt.attachedRevision) ||
    receipt.attachedRevision < 1 ||
    currentData.media?.assetId !== receipt.assetId ||
    currentData.task07MediaRevision !== receipt.attachedRevision ||
    manifest.assetId !== receipt.assetId ||
    manifest.state !== 'attached' ||
    manifest.attachment?.referencePath !== expectedProof.referencePath ||
    manifest.attachment?.targetSlot !== 'media' ||
    manifest.plan?.kind !== 'foe' ||
    manifest.plan?.entityId !== receipt.entityId) return false;
  const beforeFields = receipt.beforeFields;
  const expectedFields = compatibilityFieldsForKind('foe').sort();
  if (!isRecord(beforeFields) ||
    Object.keys(beforeFields).sort().join(',') !== expectedFields.join(',')) {
    return false;
  }
  const reconstructed = {...currentData};
  delete reconstructed.media;
  delete reconstructed.task07MediaRevision;
  delete reconstructed.mediaUpdatedAt;
  for (const field of expectedFields) {
    const descriptor = beforeFields[field];
    if (!isRecord(descriptor) || typeof descriptor.exists !== 'boolean') {
      return false;
    }
    if (descriptor.exists === true) {
      if (!hasOwn(descriptor, 'value')) return false;
      reconstructed[field] = descriptor.value;
    } else {
      delete reconstructed[field];
    }
  }
  return canonicalHash(reconstructed) === expectedProof.dataFingerprint;
};

const exactAttachedAssetId = (data, targetSlot = 'media') => (
  /^m_[a-f0-9]{40}$/.test(asString(data?.[targetSlot]?.assetId)) ?
    asString(data[targetSlot].assetId) :
    null
);

const targetDataForBinding = (data, binding) => {
  const root = isRecord(data) ? data : {};
  if (binding?.commonTechnique !== true &&
    binding?.targetKind !== 'common-technique') return root;
  const entityId = asString(binding?.entityId);
  return entityId && isRecord(root[entityId]) ? root[entityId] : {};
};

const revisionFieldForSlot = (targetSlot) => (
  targetSlot === 'videoMedia' ?
    'task07VideoMediaRevision' :
    'task07MediaRevision'
);

const updatedAtFieldForSlot = (targetSlot) => (
  targetSlot === 'videoMedia' ? 'videoMediaUpdatedAt' : 'mediaUpdatedAt'
);

const loadCompiledTask07Contracts = () => {
  const filenames = [
    'mediaAssetLifecycleCore.js',
    'mediaContracts.js',
    'mediaTargetAdapters.js',
  ];
  const paths = filenames.map((filename) => path.resolve(
    __dirname,
    '..',
    '..',
    'functions',
    'lib',
    filename
  ));
  if (!paths.every(fs.existsSync)) {
    throw new Error(
      'Task 07 Functions must be built before backfill execution.'
    );
  }
  return {
    core: require(paths[0]),
    contracts: require(paths[1]),
    adapters: require(paths[2]),
  };
};

const loadTask07AdminSdk = () => ({
  app: requireFromFunctions('firebase-admin/app'),
  auth: requireFromFunctions('firebase-admin/auth'),
  firestore: requireFromFunctions('firebase-admin/firestore'),
  storage: requireFromFunctions('firebase-admin/storage'),
});

const createAdminBackend = async (input, legacyAuthMode = 'admin') => {
  const backendOptions = typeof input === 'string' ? {
    projectId: input,
    storageBucket: expectedStorageBucket(input),
    authMode: legacyAuthMode,
  } : input;
  const projectId = backendOptions.projectId;
  const storageBucket = backendOptions.storageBucket ||
    expectedStorageBucket(projectId);
  const authMode = backendOptions.authMode || 'admin';
  const adminSdk = loadTask07AdminSdk();
  const {deleteApp, initializeApp} = adminSdk.app;
  const {getAuth} = adminSdk.auth;
  const {
    FieldPath,
    FieldValue,
    Timestamp,
    getFirestore,
  } = adminSdk.firestore;
  const {getStorage} = adminSdk.storage;
  const previousAdcPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const temporaryAdc = authMode === 'firebase-cli' ?
    await createFirebaseCliAdcFile({projectId}) :
    null;
  if (temporaryAdc) {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = temporaryAdc.filePath;
  }
  let app;
  try {
    app = initializeApp({
      projectId,
      storageBucket,
    }, `task07-media-backfill-${process.pid}-${Date.now()}`);
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
  const bucket = getStorage(app).bucket();
  const firebaseAuth = getAuth(app);
  let placementIndexPromise = null;

  const sourceFoeProof = (foeSourceId, snapshot = null) => ({
    scanned: true,
    referencePath: foeSourceId ? `foes/${foeSourceId}` : '',
    exists: snapshot?.exists === true,
    version: snapshot?.exists === true ? snapshotVersion(snapshot) : '',
    dataFingerprint: canonicalHash(
      snapshot?.exists === true ? snapshot.data() || {} : null
    ),
  });

  const loadPlacementIndex = async () => {
    if (placementIndexPromise) return placementIndexPromise;
    placementIndexPromise = (async () => {
      const snapshot = await db.collection('grigliata_token_placements')
        .orderBy(FieldPath.documentId())
        .limit(MAX_PLACEMENT_REFERENCES + 1)
        .get();
      if (snapshot.docs.length > MAX_PLACEMENT_REFERENCES) {
        throw new Error(
          `Placement proof exceeds the reviewed bound of ` +
          `${MAX_PLACEMENT_REFERENCES}.`
        );
      }
      const byTokenId = new Map();
      for (const document of snapshot.docs) {
        const data = document.data() || {};
        const explicitTokenId = asString(data.tokenId);
        const backgroundId = asString(data.backgroundId);
        const prefix = backgroundId ? `${backgroundId}__` : '';
        const inferredTokenId = prefix && document.id.startsWith(prefix) ?
          document.id.slice(prefix.length) :
          '';
        if (explicitTokenId && inferredTokenId &&
          explicitTokenId !== inferredTokenId) {
          throw new Error(
            `Placement ${document.ref.path} has conflicting token identity.`
          );
        }
        const tokenId = explicitTokenId || inferredTokenId;
        if (!tokenId) continue;
        if (!byTokenId.has(tokenId)) byTokenId.set(tokenId, []);
        byTokenId.get(tokenId).push({
          placementId: document.id,
          backgroundId,
          tokenId,
        });
      }
      for (const references of byTokenId.values()) {
        references.sort((left, right) => (
          left.placementId.localeCompare(right.placementId)
        ));
      }
      return byTokenId;
    })();
    return placementIndexPromise;
  };

  const placementProofQuery = () => (
    db.collection('grigliata_token_placements')
      .orderBy(FieldPath.documentId())
      .limit(MAX_PLACEMENT_REFERENCES + 1)
  );

  const placementProofForDocuments = (documents, expectedTokenId) => {
    if (documents.length > MAX_PLACEMENT_REFERENCES) {
      throw new Error(
        `Placement proof exceeds the reviewed bound of ` +
        `${MAX_PLACEMENT_REFERENCES}.`
      );
    }
    const references = [];
    for (const document of documents) {
      const data = document.data() || {};
      const explicitTokenId = asString(data.tokenId);
      const backgroundId = asString(data.backgroundId);
      const prefix = backgroundId ? `${backgroundId}__` : '';
      const inferredTokenId = prefix && document.id.startsWith(prefix) ?
        document.id.slice(prefix.length) :
        '';
      if (explicitTokenId && inferredTokenId &&
        explicitTokenId !== inferredTokenId) {
        throw new Error(
          `Placement ${document.ref.path} has conflicting token identity.`
        );
      }
      const tokenId = explicitTokenId || inferredTokenId;
      if (tokenId !== expectedTokenId) continue;
      references.push({placementId: document.id, backgroundId, tokenId});
    }
    references.sort((left, right) => (
      left.placementId.localeCompare(right.placementId)
    ));
    return {
      count: references.length,
      hash: canonicalHash(references),
    };
  };

  const collectionForSource = (sourceKey) => {
    if (sourceKey === 'avatars') return db.collection('users');
    if (sourceKey === 'catalog-items') return db.collection('items');
    if (sourceKey === 'inventory-items') return db.collectionGroup('inventory');
    if (sourceKey === 'npcs') return db.collection('echi_npcs');
    if (sourceKey === 'foes') return db.collection('foes');
    if (['custom-token-templates', 'foe-tokens'].includes(sourceKey)) {
      return db.collection('grigliata_tokens');
    }
    if (['technique-art', 'technique-video'].includes(sourceKey)) {
      return db.collectionGroup('tecniche');
    }
    if (['spell-art', 'spell-video'].includes(sourceKey)) {
      return db.collectionGroup('spells');
    }
    if (sourceKey === 'backgrounds') {
      return db.collection('grigliata_backgrounds');
    }
    if (sourceKey === 'music-tracks') {
      return db.collection('grigliata_music_tracks');
    }
    throw new Error(`Unknown legacy media source: ${sourceKey}`);
  };

  const readLegacyPage = async (sourceKey, cursor, pageSize) => {
    if (['common-technique-art', 'common-technique-video']
      .includes(sourceKey)) {
      const snapshot = await db.doc('utils/tecniche_common').get();
      const data = snapshot.data() || {};
      const keys = Object.keys(data)
        .filter((key) => isRecord(data[key]))
        .sort((left, right) => left.localeCompare(right));
      const start = cursor ?
        keys.findIndex((key) => key.localeCompare(cursor) > 0) :
        0;
      const startIndex = start < 0 ? keys.length : start;
      const pageKeys = keys.slice(startIndex, startIndex + pageSize);
      return {
        records: pageKeys.map((entityId) => commonTechniqueRecord({
          sourceKey,
          entityId,
          data: data[entityId],
          targetVersion: snapshotVersion(snapshot),
        })),
        cursor: pageKeys.at(-1) || null,
        hasMore: startIndex + pageKeys.length < keys.length,
      };
    }
    let query = collectionForSource(sourceKey)
      .orderBy(FieldPath.documentId())
      .limit(pageSize + 1);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    const page = snapshot.docs.slice(0, pageSize);
    const documents = page
        .filter((document) => {
          if (!['custom-token-templates', 'foe-tokens'].includes(sourceKey)) {
            return true;
          }
          const data = document.data() || {};
          if (sourceKey === 'foe-tokens') return data.tokenType === 'foe';
          return data.tokenType === 'custom' &&
            data.customTokenRole !== 'instance' &&
            asString(data.customTemplateId) === document.id;
        });
    let records = documents.map((document) => (
      recordFromSnapshot(sourceKey, document)
    ));
    if (sourceKey === 'foe-tokens') {
      const placementIndex = await loadPlacementIndex();
      const foeSourceIds = [...new Set(documents
        .map((document) => asString(document.get('foeSourceId')))
        .filter(Boolean))];
      const sourceSnapshots = foeSourceIds.length ?
        await db.getAll(...foeSourceIds.map((foeId) => db.doc(`foes/${foeId}`))) :
        [];
      const sourcesById = new Map(
        sourceSnapshots.map((source) => [source.id, source])
      );
      records = records.map((record, index) => {
        const document = documents[index];
        const foeSourceId = asString(document.get('foeSourceId'));
        const references = placementIndex.get(document.id) || [];
        return {
          ...record,
          placementReferenceCount: references.length,
          placementReferenceHash: canonicalHash(references),
          sourceFoeProof: sourceFoeProof(
            foeSourceId,
            sourcesById.get(foeSourceId) || null
          ),
        };
      });
    }
    return {
      records,
      cursor: page.at(-1) || null,
      hasMore: snapshot.docs.length > pageSize,
    };
  };

  const readSourceObject = async (sourcePath) => {
    try {
      const [metadata] = await bucket.file(sourcePath).getMetadata();
      return {
        exists: true,
        contentType: metadata.contentType,
        bytes: Number(metadata.size),
        generation: String(metadata.generation || ''),
        checksum: String(
          metadata.md5Hash ||
          metadata.crc32c ||
          metadata.metageneration ||
          ''
        ),
      };
    } catch (error) {
      if ([404, '404'].includes(error?.code)) return {exists: false};
      throw error;
    }
  };

  const readOwner = async (ownerUid) => {
    const snapshot = await db.doc(`users/${ownerUid}`).get();
    return {
      exists: snapshot.exists,
      role: asString(snapshot.get('role')).toLowerCase(),
      deletionState: asString(snapshot.get('deletionState')),
    };
  };

  const verifyCatalogOwner = async (ownerUid) => {
    const [owner, account] = await Promise.all([
      readOwner(ownerUid),
      firebaseAuth.getUser(ownerUid),
    ]);
    if (!owner.exists || owner.deletionState === 'pending' ||
      owner.role !== 'webmaster' || account.disabled === true ||
      account.uid !== ownerUid) {
      throw new Error(
        'The confirmed catalog fallback owner is not an active cloned ' +
        'webmaster in both Firestore and Firebase Authentication.'
      );
    }
    return {
      uid: ownerUid,
      role: owner.role,
      authEnabled: true,
    };
  };

  const readReceiptPage = async (_sourceKey, cursor, pageSize) => {
    let query = db.collection(RECEIPT_COLLECTION)
      .orderBy(FieldPath.documentId())
      .limit(pageSize + 1);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    const page = snapshot.docs.slice(0, pageSize);
    return {
      records: page.map((document) => ({
        id: document.id,
        ...document.data(),
      })),
      cursor: page.at(-1) || null,
      hasMore: snapshot.docs.length > pageSize,
    };
  };

  const generatedObjectPresent = async (descriptor) => {
    if (!isRecord(descriptor) || !asString(descriptor.path) ||
      !asString(descriptor.generation)) return false;
    try {
      const [metadata] = await bucket.file(descriptor.path).getMetadata();
      return String(metadata.generation || '') ===
        String(descriptor.generation || '');
    } catch {
      return false;
    }
  };

  const inspectGeneratedObjects = async (manifest, kind) => {
    if (!manifest.exists) return {
      generatedObjectsPresent: false,
      itemOriginalGenerated: kind !== 'item',
      itemCardGenerated: kind !== 'item',
      itemCard2xGenerated: kind !== 'item',
    };
    const generated = manifest.get('generated');
    const descriptors = [
      generated?.original,
      ...Object.values(generated?.variants || {}),
    ].filter((descriptor) => isRecord(descriptor));
    const presence = await Promise.all(
      descriptors.map(generatedObjectPresent)
    );
    const originalPresent = await generatedObjectPresent(generated?.original);
    const itemOriginalGenerated = kind !== 'item' || originalPresent;
    const itemCardGenerated = kind !== 'item' ||
      await generatedObjectPresent(generated?.variants?.card);
    const itemCard2xGenerated = kind !== 'item' ||
      await generatedObjectPresent(generated?.variants?.card2x);
    return {
      generatedObjectsPresent: originalPresent && descriptors.length > 0 &&
        presence.every(Boolean),
      itemOriginalGenerated,
      itemCardGenerated,
      itemCard2xGenerated,
    };
  };

  const inspectReceipt = async (receipt) => {
    const targetSlot = receipt.targetSlot === 'videoMedia' ?
      'videoMedia' :
      'media';
    const [target, manifest] = await db.getAll(
      db.doc(receipt.targetPath),
      db.doc(`media_assets/${receipt.assetId}`)
    );
    const generatedProof = await inspectGeneratedObjects(
      manifest,
      asString(receipt.kind)
    );
    const currentSource = normalizeSourceObject(
      asString(receipt.sourcePath),
      await readSourceObject(asString(receipt.sourcePath))
    );
    const targetData = targetDataForBinding(target.data(), receipt);
    const currentGeneralProof = generalImageUrlProof(
      targetData,
      asString(receipt.kind)
    );
    let placementProof = null;
    let currentSourceFoeProof = null;
    let currentSourceFoeFingerprint = null;
    if (sourceKeyForReceipt(receipt) === 'foe-tokens') {
      const sourceFoePath = asString(receipt.sourceFoeProof?.referencePath);
      const validSourceFoePath = /^foes\/[^/]+$/.test(sourceFoePath);
      const placementSnapshot = await placementProofQuery().get();
      placementProof = placementProofForDocuments(
        placementSnapshot.docs,
        asString(receipt.entityId)
      );
      if (validSourceFoePath) {
        const sourceFoeSnapshot = await db.doc(sourceFoePath).get();
        currentSourceFoeProof = sourceFoeProof(
          sourceFoePath.split('/').at(-1),
          sourceFoeSnapshot
        );
        currentSourceFoeFingerprint = canonicalHash(currentSourceFoeProof);
        const sourceReceiptId = asString(
          receipt.sourceFoeBackfillReceiptId
        );
        if (currentSourceFoeFingerprint !== receipt.sourceFoeFingerprint &&
          /^r_[a-f0-9]{40}$/.test(sourceReceiptId)) {
          const sourceReceipt = await db.doc(
            `${RECEIPT_COLLECTION}/${sourceReceiptId}`
          ).get();
          const sourceAssetId = asString(sourceReceipt.get('assetId'));
          const sourceManifest = /^m_[a-f0-9]{40}$/.test(sourceAssetId) ?
            await db.doc(`media_assets/${sourceAssetId}`).get() : null;
          if (sourceManifest && approvedSourceFoeBackfillMatches({
            currentData: sourceFoeSnapshot.data() || {},
            expectedProof: receipt.sourceFoeProof,
            receipt: sourceReceipt.data() || {},
            manifest: sourceManifest.data() || {},
            sourceReceiptId,
            planFingerprint: receipt.approvedPlanFingerprint,
          })) {
            currentSourceFoeFingerprint = receipt.sourceFoeFingerprint;
          }
        }
      }
    }
    return {
      manifestState: asString(manifest.get('state')),
      targetAssetId: exactAttachedAssetId(targetData, targetSlot) || null,
      targetRevision:
        Number(targetData[revisionFieldForSlot(targetSlot)]) || 0,
      ...generatedProof,
      legacySourceUnchanged:
        sourceObjectFingerprint(currentSource) === receipt.sourceFingerprint,
      legacyGeneralImageUrlUnchanged:
        canonicalHash(currentGeneralProof) ===
          canonicalHash(receipt.legacyGeneralImageUrlProof ?? null),
      placementReferenceCount: placementProof?.count ?? null,
      placementReferenceHash: placementProof?.hash ?? null,
      sourceFoeFingerprint: currentSourceFoeProof ?
        currentSourceFoeFingerprint : null,
    };
  };

  const entrySourceStillMatches = async (entry) => {
    const current = normalizeSourceObject(
      entry.sourcePath,
      await readSourceObject(entry.sourcePath)
    );
    if (sourceObjectFingerprint(current) !== entry.sourceFingerprint) {
      throw new Error(
        `Legacy source changed for receipt ${entry.receiptId}. Re-plan.`
      );
    }
  };

  const buildPlan = (entry, compiled) => {
    const plan = compiled.core.buildTask07MediaUploadPlan({
      actorUid: entry.ownerUid,
      ownerUid: entry.ownerUid,
      entityId: entry.entityId,
      commonTechnique: entry.commonTechnique,
      referenceScope: entry.referenceScope,
      previousAssetId: entry.previousAssetId,
      operationId: entry.operationId,
      kind: entry.kind,
      sourceContentType: entry.sourceContentType,
      sourceBytes: entry.sourceBytes,
    });
    if (plan.assetId !== entry.assetId ||
      plan.sourcePath !== entry.stagingPath ||
      plan.targetKind !== entry.targetKind ||
      plan.commonTechnique !== entry.commonTechnique ||
      plan.audienceScope !== entry.audienceScope ||
      compiled.core.task07MediaReferencePath(plan) !== entry.targetPath) {
      throw new Error('Approved entry no longer matches server contracts.');
    }
    return plan;
  };

  const assertReceiptBinding = (receipt, entry, binding) => {
    if (!receipt.exists) return;
    if (receipt.get('schemaVersion') !== REPORT_SCHEMA_VERSION ||
      receipt.get('planVersion') !== PLAN_VERSION ||
      receipt.get('policyVersion') !== mediaPolicy.policyVersion ||
      receipt.get('policyHash') !== POLICY_HASH ||
      receipt.get('approvedPlanFingerprint') !== binding.planFingerprint ||
      receipt.get('subjectHash') !== entry.subjectHash ||
      receipt.get('assetId') !== entry.assetId ||
      receipt.get('targetPath') !== entry.targetPath ||
      receipt.get('targetSlot') !== entry.targetSlot ||
      receipt.get('sourceKey') !== entry.sourceKey ||
      receipt.get('entityId') !== entry.entityId ||
      receipt.get('commonTechnique') !== entry.commonTechnique ||
      receipt.get('ownerUid') !== entry.ownerUid ||
      receipt.get('sourcePath') !== entry.sourcePath ||
      (receipt.get('sourceGeneration') !== undefined &&
        receipt.get('sourceGeneration') !== entry.sourceGeneration) ||
      receipt.get('sourceFingerprint') !== entry.sourceFingerprint ||
      receipt.get('placementReferenceCount') !==
        entry.placementReferenceCount ||
      receipt.get('placementReferenceHash') !== entry.placementReferenceHash ||
      receipt.get('sourceFoeFingerprint') !== entry.sourceFoeFingerprint ||
      (entry.sourceKey === 'foe-tokens' &&
        receipt.get('sourceFoeBackfillReceiptId') !==
          (binding.sourceFoeBackfillReceiptId || null)) ||
      canonicalHash(receipt.get('sourceFoeProof') ?? null) !==
        canonicalHash(entry.sourceFoeProof ?? null) ||
      canonicalHash(receipt.get('legacyGeneralImageUrlProof') ?? null) !==
        canonicalHash(entry.legacyGeneralImageUrlProof ?? null)) {
      throw new Error('Existing Task 07 receipt has a different binding.');
    }
  };

  const createIntentAndReceipt = async (entry, binding, compiled, plan) => {
    const receiptRef = db.doc(`${RECEIPT_COLLECTION}/${entry.receiptId}`);
    const manifestRef = db.doc(`media_assets/${entry.assetId}`);
    const cleanupRef = db.doc(`media_asset_cleanup/${entry.assetId}`);
    const targetRef = db.doc(entry.targetPath);
    const ownerRef = db.doc(`users/${entry.ownerUid}`);
    const legacyBackfill = buildLegacyMapBackfillMarker(
      entry,
      binding,
      plan
    );
    await db.runTransaction(async (transaction) => {
      let currentPlacementProof = null;
      let currentSourceFoeProof = null;
      let currentSourceFoeSnapshot = null;
      let sourceFoeBackfillReceipt = null;
      let sourceFoeBackfillManifest = null;
      if (entry.sourceKey === 'foe-tokens') {
        const placementSnapshot = await transaction.get(placementProofQuery());
        currentPlacementProof = placementProofForDocuments(
          placementSnapshot.docs,
          entry.entityId
        );
        currentSourceFoeSnapshot = await transaction.get(
          db.doc(entry.sourceFoeProof.referencePath)
        );
        currentSourceFoeProof = sourceFoeProof(
          entry.sourceFoeProof.referencePath.split('/').at(-1),
          currentSourceFoeSnapshot
        );
        const sourceReceiptId = asString(
          binding.sourceFoeBackfillReceiptId
        );
        if (/^r_[a-f0-9]{40}$/.test(sourceReceiptId)) {
          sourceFoeBackfillReceipt = await transaction.get(
            db.doc(`${RECEIPT_COLLECTION}/${sourceReceiptId}`)
          );
          const sourceAssetId = asString(
            sourceFoeBackfillReceipt.get('assetId')
          );
          if (/^m_[a-f0-9]{40}$/.test(sourceAssetId)) {
            sourceFoeBackfillManifest = await transaction.get(
              db.doc(`media_assets/${sourceAssetId}`)
            );
          }
        }
      }
      const [receipt, manifest, target, owner, cleanup] =
        await transaction.getAll(
        receiptRef,
        manifestRef,
        targetRef,
        ownerRef,
        cleanupRef
      );
      assertReceiptBinding(receipt, entry, binding);
      const directSourceFoeMatch = currentSourceFoeProof &&
        canonicalHash(currentSourceFoeProof) === entry.sourceFoeFingerprint;
      const approvedSourceFoeMatch = entry.sourceKey === 'foe-tokens' &&
        !directSourceFoeMatch && currentSourceFoeSnapshot?.exists === true &&
        sourceFoeBackfillReceipt?.exists === true &&
        sourceFoeBackfillManifest?.exists === true &&
        approvedSourceFoeBackfillMatches({
          currentData: currentSourceFoeSnapshot.data() || {},
          expectedProof: entry.sourceFoeProof,
          receipt: sourceFoeBackfillReceipt.data() || {},
          manifest: sourceFoeBackfillManifest.data() || {},
          sourceReceiptId: binding.sourceFoeBackfillReceiptId,
          planFingerprint: binding.planFingerprint,
        });
      if (entry.sourceKey === 'foe-tokens' && (
        currentPlacementProof.count !== entry.placementReferenceCount ||
        currentPlacementProof.hash !== entry.placementReferenceHash ||
        (!directSourceFoeMatch && !approvedSourceFoeMatch)
      )) {
        throw new Error(
          'Foe-token placement or source relationship changed. Re-plan.'
        );
      }
      const recoveryCandidate = receipt.exists && manifest.exists &&
        manifest.get('state') === 'deleted';
      if (receipt.exists && !recoveryCandidate) {
        if (!manifest.exists) {
          throw new Error('Receipt exists without its Task 07 manifest.');
        }
        return;
      }
      const targetData = targetDataForBinding(target.data(), entry);
      if (!target.exists ||
        targetMediaFingerprint(targetData, entry.kind) !==
          entry.targetFingerprint) {
        throw new Error('Media target changed after planning. Re-plan.');
      }
      if (target.get('deletionState') === 'pending' ||
        target.get('pendingDeletion') === true ||
        target.get('deleted') === true ||
        targetData.deletionState === 'pending' ||
        targetData.pendingDeletion === true ||
        targetData.deleted === true) {
        throw new Error('Media target is no longer available.');
      }
      if (!legacyPathsForKind(targetData, entry.kind)
        .includes(entry.sourcePath)) {
        throw new Error('Legacy media reference changed after planning.');
      }
      if (canonicalHash(generalImageUrlProof(
        targetData,
        entry.kind
      )) !== canonicalHash(entry.legacyGeneralImageUrlProof ?? null)) {
        throw new Error('Legacy General.image_url changed after planning.');
      }
      const ownerRole = asString(owner.get('role')).toLowerCase();
      if (!owner.exists || owner.get('deletionState') === 'pending' ||
        !compiled.core.isTask07MediaRequestAuthorized({
          kind: plan.kind,
          actorUid: plan.actorUid,
          ownerUid: plan.ownerUid,
          referenceScope: plan.referenceScope,
          actorRole: ownerRole,
        })) {
        throw new Error('Media owner is no longer active and authorized.');
      }
      if (exactAttachedAssetId(targetData, entry.targetSlot) !==
        entry.previousAssetId) {
        throw new Error('Previous media reference changed after planning.');
      }
      if (manifest.exists && (
        manifest.get('requestHash') !== plan.requestHash ||
        manifest.get('actorUid') !== entry.ownerUid
      )) {
        throw new Error('Task 07 asset identity is already bound.');
      }
      const now = Timestamp.now();
      const cleanupAfter = Timestamp.fromMillis(
        Date.now() + mediaPolicy.retention.unattachedHours * 60 * 60 * 1000
      );
      const manifestData = {
        schemaVersion: compiled.contracts.MEDIA_SCHEMA_VERSION,
        policyVersion: compiled.contracts.MEDIA_CONTRACT_VERSION,
        assetId: plan.assetId,
        generation: null,
        state: 'intent',
        purpose: plan.kind,
        audience: plan.audienceScope,
        ownerUid: plan.ownerUid,
        actorUid: plan.actorUid,
        targetKind: plan.targetKind,
        targetId: plan.entityId,
        previousAssetId: plan.previousAssetId,
        requestHash: plan.requestHash,
        plan,
        source: {
          path: plan.sourcePath,
          mime: plan.sourceContentType,
          bytes: plan.sourceBytes,
        },
        variants: {},
        attachment: null,
        retention: {cleanupAfter},
        error: {code: null, retryable: false, attempts: 0},
        ...(legacyBackfill ? {legacyBackfill} : {}),
        createdAt: now,
        updatedAt: now,
      };
      if (recoveryCandidate) {
        const recoveryIssue = legacyMapRecoveryIssue({
          receipt: receipt.data() || {},
          manifest: manifest.data() || {},
          cleanup: cleanup.data() || {},
          marker: legacyBackfill,
          plan,
        });
        if (recoveryIssue) {
          throw new Error(
            `Legacy map recovery refused: ${recoveryIssue}.`
          );
        }
        transaction.set(manifestRef, manifestData, {merge: false});
        transaction.delete(cleanupRef);
        transaction.update(receiptRef, {
          legacyBackfill,
          legacyMapRecoveryAttempts: 1,
          sourceGeneration: entry.sourceGeneration,
          updatedAt: now,
        });
        return;
      }
      if (!manifest.exists) {
        transaction.create(manifestRef, manifestData);
      } else if (legacyBackfill) {
        transaction.update(manifestRef, {legacyBackfill, updatedAt: now});
      }
      transaction.create(receiptRef, {
        schemaVersion: REPORT_SCHEMA_VERSION,
        planVersion: PLAN_VERSION,
        policyVersion: mediaPolicy.policyVersion,
        policyHash: POLICY_HASH,
        receiptId: entry.receiptId,
        subjectHash: entry.subjectHash,
        approvedPlanFingerprint: binding.planFingerprint,
        assetId: entry.assetId,
        previousAssetId: entry.previousAssetId,
        targetPath: entry.targetPath,
        targetSlot: entry.targetSlot,
        kind: entry.kind,
        sourceKey: entry.sourceKey,
        entityId: entry.entityId,
        commonTechnique: entry.commonTechnique,
        referenceScope: entry.referenceScope,
        ownerUid: entry.ownerUid,
        ownerResolution: entry.ownerResolution,
        sourcePath: entry.sourcePath,
        sourceGeneration: entry.sourceGeneration,
        sourceFingerprint: entry.sourceFingerprint,
        placementReferenceCount: entry.placementReferenceCount,
        placementReferenceHash: entry.placementReferenceHash,
        sourceFoeProof: entry.sourceFoeProof,
        sourceFoeFingerprint: entry.sourceFoeFingerprint,
        sourceFoeBackfillReceiptId: entry.sourceKey === 'foe-tokens' ?
          binding.sourceFoeBackfillReceiptId || null : null,
        legacyGeneralImageUrlProof: entry.legacyGeneralImageUrlProof,
        beforeFields: captureCompatibilityFields(targetData, entry.kind),
        state: 'intent',
        ...(legacyBackfill ? {
          legacyBackfill,
          legacyMapRecoveryAttempts: 0,
        } : {}),
        createdAt: now,
        updatedAt: now,
      });
    });
  };

  const stageSource = async (entry, compiled, pollTimeoutMs) => {
    const manifestRef = db.doc(`media_assets/${entry.assetId}`);
    let manifest = await manifestRef.get();
    if (['ready', 'attached'].includes(asString(manifest.get('state')))) return;
    const destination = bucket.file(entry.stagingPath);
    const [existed] = await destination.exists();
    const state = asString(manifest.get('state'));
    const shouldStage = stagingActionForManifest(
      state,
      manifest.get('error.retryable')
    ) === 'stage';
    if (existed && shouldStage) {
      await destination.delete({ignoreNotFound: true});
    }
    if (shouldStage) {
      const source = bucket.file(entry.sourcePath, {
        generation: entry.sourceGeneration,
        preconditionOpts: {ifGenerationMatch: entry.sourceGeneration},
      });
      const upload = destination.createWriteStream({
        resumable: false,
        validation: 'crc32c',
        metadata: {
          contentType: entry.sourceContentType,
          cacheControl: compiled.contracts.MEDIA_STAGING_CACHE_CONTROL,
          contentDisposition: 'inline',
          metadata: compiled.contracts.buildTask07PrivateStorageMetadata({
            assetId: entry.assetId,
            entityId: entry.entityId,
            kind: entry.kind,
            ownerUid: entry.ownerUid,
            role: 'source',
          }),
        },
      });
      await pipeline(source.createReadStream(), upload);
    }
    const deadline = Date.now() + pollTimeoutMs;
    while (Date.now() < deadline) {
      manifest = await manifestRef.get();
      const currentState = asString(manifest.get('state'));
      if (['ready', 'attached'].includes(currentState)) return;
      if (['rejected', 'cancelled'].includes(currentState) ||
        (currentState === 'failed' &&
          manifest.get('error.retryable') !== true)) {
        throw new Error(
          `Task 07 processor stopped in ${currentState || 'unknown'} state.`
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error('Task 07 processor timed out before producing derivatives.');
  };

  const applyBackfillEntry = async (entry, binding) => {
    await entrySourceStillMatches(entry);
    const compiled = loadCompiledTask07Contracts();
    const plan = buildPlan(entry, compiled);
    await createIntentAndReceipt(entry, binding, compiled, plan);
    await stageSource(entry, compiled, binding.pollTimeoutMs);
    const owner = await readOwner(entry.ownerUid);
    const attached = await compiled.adapters
      .attachTask07ReadyAssetTransaction({
        db,
        actorUid: entry.ownerUid,
        actorRole: owner.role,
        assetId: entry.assetId,
        expectedRevision: entry.expectedRevision,
      });
    const receiptRef = db.doc(`${RECEIPT_COLLECTION}/${entry.receiptId}`);
    await db.runTransaction(async (transaction) => {
      const [receipt, manifest, target] = await transaction.getAll(
        receiptRef,
        db.doc(`media_assets/${entry.assetId}`),
        db.doc(entry.targetPath)
      );
      assertReceiptBinding(receipt, entry, binding);
      if (receipt.get('state') === 'attached') return;
      const targetData = targetDataForBinding(target.data(), entry);
      if (manifest.get('state') !== 'attached' ||
        attached.targetSlot !== entry.targetSlot ||
        exactAttachedAssetId(targetData, entry.targetSlot) !== entry.assetId ||
        Number(targetData[revisionFieldForSlot(entry.targetSlot)]) !==
          attached.revision) {
        throw new Error('Post-attach receipt verification failed.');
      }
      transaction.update(receiptRef, {
        state: 'attached',
        attachedRevision: attached.revision,
        updatedAt: Timestamp.now(),
      });
    });
    const receipt = (await receiptRef.get()).data() || {};
    const inspection = await inspectReceipt(receipt);
    return {
      verified: receipt.state === 'attached' &&
        inspection.manifestState === 'attached' &&
        inspection.targetAssetId === entry.assetId &&
        inspection.generatedObjectsPresent === true &&
        inspection.legacySourceUnchanged === true &&
        inspection.legacyGeneralImageUrlUnchanged === true &&
        (entry.kind !== 'item' || (
          inspection.itemOriginalGenerated === true &&
          inspection.itemCardGenerated === true &&
          inspection.itemCard2xGenerated === true
        )),
      idempotent: attached.attached === false,
    };
  };

  const restoreFieldPatch = (beforeFields) => {
    const patch = {};
    Object.entries(beforeFields || {}).forEach(([field, descriptor]) => {
      if (!TARGET_COMPATIBILITY_FIELDS.includes(field)) {
        throw new Error('Rollback receipt contains an unsupported target field.');
      }
      patch[field] = descriptor?.exists === true ?
        descriptor.value :
        FieldValue.delete();
    });
    return patch;
  };

  const restoreFieldsIntoData = (current, beforeFields) => {
    const restored = {...(isRecord(current) ? current : {})};
    Object.entries(beforeFields || {}).forEach(([field, descriptor]) => {
      if (!TARGET_COMPATIBILITY_FIELDS.includes(field)) {
        throw new Error('Rollback receipt contains an unsupported target field.');
      }
      if (descriptor?.exists === true) {
        restored[field] = descriptor.value;
      } else {
        delete restored[field];
      }
    });
    return restored;
  };

  const rollbackEntry = async (entry) => {
    const receiptRef = db.doc(`${RECEIPT_COLLECTION}/${entry.receiptId}`);
    const receiptBefore = await receiptRef.get();
    if (!receiptBefore.exists) throw new Error('Rollback receipt not found.');
    const beforeData = receiptBefore.data() || {};
    const inspection = await inspectReceipt(beforeData);
    if (canonicalHash(inspection) !== entry.inspectionHash) {
      throw new Error('Rollback target changed after planning. Re-plan.');
    }
    const manifestRef = db.doc(`media_assets/${entry.assetId}`);
    const targetRef = db.doc(entry.targetPath);
    const previousRef = entry.previousAssetId ?
      db.doc(`media_assets/${entry.previousAssetId}`) :
      null;
    await db.runTransaction(async (transaction) => {
      const snapshots = await transaction.getAll(
        receiptRef,
        manifestRef,
        targetRef,
        ...(previousRef ? [previousRef] : [])
      );
      const [receipt, manifest, target, previous] = snapshots;
      if (receipt.get('state') === 'rolled-back') return;
      const targetData = targetDataForBinding(target.data(), entry);
      if (receipt.get('state') !== 'attached' ||
        receipt.get('entityId') !== entry.entityId ||
        receipt.get('commonTechnique') !== entry.commonTechnique ||
        manifest.get('state') !== 'attached' ||
        exactAttachedAssetId(targetData, entry.targetSlot) !== entry.assetId) {
        throw new Error('Rollback preconditions no longer match.');
      }
      const now = Timestamp.now();
      const revisionField = revisionFieldForSlot(entry.targetSlot);
      const updatedAtField = updatedAtFieldForSlot(entry.targetSlot);
      const revision = (Number(targetData[revisionField]) || 0) + 1;
      if (entry.commonTechnique) {
        transaction.set(targetRef, {
          [entry.entityId]: {
            ...restoreFieldsIntoData(
              targetData,
              receipt.get('beforeFields')
            ),
            [revisionField]: revision,
            [updatedAtField]: now,
          },
        }, {merge: true});
      } else {
        transaction.update(targetRef, {
          ...restoreFieldPatch(receipt.get('beforeFields')),
          [revisionField]: revision,
          [updatedAtField]: now,
        });
      }
      transaction.update(manifestRef, {
        state: 'cleanup-pending',
        attachment: null,
        retention: {cleanupAfter: now},
        updatedAt: now,
      });
      transaction.set(db.doc(`media_asset_cleanup/${entry.assetId}`), {
        schemaVersion: 1,
        assetId: entry.assetId,
        state: 'pending',
        reason: 'backfill-rollback',
        attempts: 0,
        cleanupAfter: now,
        createdAt: now,
        updatedAt: now,
      }, {merge: false});
      if (previousRef) {
        if (!previous?.exists) {
          throw new Error('Previous media manifest is unavailable.');
        }
        transaction.update(previousRef, {
          state: 'attached',
          attachment: {
            referencePath: entry.targetPath,
            targetSlot: entry.targetSlot,
            revision,
            attachedAt: now,
          },
          retention: FieldValue.delete(),
          supersededByAssetId: FieldValue.delete(),
          updatedAt: now,
        });
        transaction.delete(
          db.doc(`media_asset_cleanup/${entry.previousAssetId}`)
        );
      }
      transaction.update(receiptRef, {
        state: 'rolled-back',
        rollbackRevision: revision,
        updatedAt: now,
      });
    });
    const receiptAfter = (await receiptRef.get()).data() || {};
    const after = await inspectReceipt(receiptAfter);
    return {
      verified: receiptAfter.state === 'rolled-back' &&
        after.targetAssetId === (entry.previousAssetId || null) &&
        ['cleanup-pending', 'deleted'].includes(after.manifestState) &&
        after.legacySourceUnchanged === true &&
        after.legacyGeneralImageUrlUnchanged === true,
      idempotent: receiptBefore.get('state') === 'rolled-back',
    };
  };

  return {
    readLegacyPage,
    readSourceObject,
    readOwner,
    verifyCatalogOwner,
    readReceiptPage,
    inspectReceipt,
    applyBackfillEntry,
    rollbackEntry,
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

const printHelp = () => console.log([
  'Task 07 legacy-media migration plan, verification, and rollback.',
  '',
  'Usage:',
  '  node scripts/task07/media-derivative-backfill.js --project demo-fnd-perf',
  '    [--operation backfill|verify|rollback] [--report <path>]',
  '    [--page-size 1..50] [--max-pages 1..100] [--json]',
  '  node scripts/task07/media-derivative-backfill.js --project demo-fnd-perf',
  '    --operation backfill|rollback --execute',
  '    --approve-fingerprint <sha256> --report <reviewed-plan>',
  '    [--checkpoint <path>] [--resume]',
  '',
  `  node scripts/task07/media-derivative-backfill.js --project ${PRODUCTION_PROJECT_ID}`,
  `    --auth firebase-cli --allow-live-project --confirm-project ${PRODUCTION_PROJECT_ID}`,
  '    --catalog-owner-uid <verified-webmaster-uid>',
  '    --confirm-catalog-owner-uid <same-uid>',
  ...SOURCE_KEYS.map((sourceKey) => `    --source ${sourceKey}`),
  '    [--expected-candidates <reviewed-count>]',
  '    [--operation backfill|verify|rollback] [--report <path>]',
  '',
  'Safety:',
  '  - Planning and verification are read-only and are the default.',
  `  - Live access is allowed only for ${PRODUCTION_PROJECT_ID}.`,
  '  - Emulator behavior remains restricted to demo-fnd-perf loopback hosts.',
  `  - Live access is hard-locked to ${PRODUCTION_PROJECT_ID} and ${PRODUCTION_STORAGE_BUCKET}.`,
  '  - Live access requires Firebase CLI temporary ADC and every source.',
  '  - The confirmed webmaster is only a fallback for ownerless global media.',
  '  - Demo backfill execution also requires the loopback Functions emulator.',
  '  - Writes are serial and require the exact reviewed plan fingerprint.',
  '  - Checkpoints and emulator receipts make interrupted work resumable.',
].join('\n'));

const main = async (argv = process.argv.slice(2)) => {
  const options = parseOptions(argv);
  if (options.help) {
    printHelp();
    return;
  }
  const target = assertSafeTarget(options);
  const backend = await createAdminBackend({
    projectId: options.projectId,
    storageBucket: target.storageBucket,
    authMode: options.authMode,
  });
  try {
    if (target.live) {
      await backend.verifyCatalogOwner(options.catalogOwnerUid);
    }
    if (!options.execute) {
      const report = await buildMigrationPlan({
        backend,
        operation: options.operation,
        projectId: options.projectId,
        storageBucket: target.storageBucket,
        sourceKeys: options.sourceKeys,
        catalogOwnerUid: options.catalogOwnerUid,
        expectedCandidates: options.expectedCandidates,
        pageSize: options.pageSize,
        maxPages: options.maxPages,
      });
      assertCandidateCountBinding(report, options.expectedCandidates);
      writeJsonAtomic(options.reportPath, report);
      const output = options.json ? report : {
        mode: 'dry-run',
        operation: options.operation,
        projectId: options.projectId,
        storageBucket: report.storageBucket,
        sourceKeys: report.sourceKeys,
        expectedCandidates: report.expectedCandidates,
        live: target.live,
        complete: report.complete,
        counts: report.counts,
        planFingerprint: report.planFingerprint,
        reportPath: options.reportPath,
      };
      console.log(JSON.stringify(output, null, 2));
      return;
    }
    const report = assertApprovedReport(
      readJson(options.reportPath, 'Reviewed Task 07 plan'),
      options
    );
    if (options.resume) {
      options.resumeCheckpoint = assertCheckpoint(
        readJson(options.checkpointPath, 'Task 07 checkpoint'),
        report,
        options
      );
    } else if (fs.existsSync(options.checkpointPath)) {
      throw new Error(
        'Checkpoint already exists; use --resume or choose another path.'
      );
    }
    const result = await executeMigrationPlan({
      backend,
      options,
      report,
      onCheckpoint: async (checkpoint) => (
        writeJsonAtomic(options.checkpointPath, checkpoint)
      ),
    });
    console.log(JSON.stringify({
      mode: 'execute',
      operation: options.operation,
      projectId: options.projectId,
      live: target.live,
      complete: result.complete,
      processed: result.processed,
      planFingerprint: report.planFingerprint,
      checkpointPath: options.checkpointPath,
    }, null, 2));
  } finally {
    await backend.close();
  }
};

if (require.main === module) {
  main().catch((error) => {
    console.error('Task 07 media backfill failed:', error?.message || error);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_MAX_PAGES,
  DEFAULT_PAGE_SIZE,
  DEMO_PROJECT_ID,
  PRODUCTION_PROJECT_ID,
  PRODUCTION_STORAGE_BUCKET,
  MAX_MAX_PAGES,
  MAX_PAGE_SIZE,
  MIGRATION_CONCURRENCY,
  PLAN_VERSION,
  POLICY_HASH,
  REPORT_SCHEMA_VERSION,
  SOURCE_KEYS,
  assertApprovedReport,
  approvedSourceFoeBackfillMatches,
  assertCandidateCountBinding,
  assertCheckpoint,
  assertReadOnlyTarget,
  assertSafeTarget,
  buildLegacyMediaBackfillPlan,
  buildLegacyMapBackfillMarker,
  buildMigrationPlan,
  buildReceiptOperationPlan,
  canonicalHash,
  collectMediaPaths,
  computePlanFingerprint,
  createAdminBackend,
  executeMigrationPlan,
  exactSourceKeys,
  expectedStorageBucket,
  generalImageUrlProof,
  isCanonicalTask07Path,
  loadLegacyMediaRecords,
  loadPaged,
  loadTask07AdminSdk,
  legacyMapRecoveryIssue,
  parseOptions,
  stagingActionForManifest,
  storagePathFromValue,
};
