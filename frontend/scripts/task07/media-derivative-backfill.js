#!/usr/bin/env node

'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {pipeline} = require('node:stream/promises');
const mediaPolicy = require('../../functions/src/mediaPolicy.json');

const DEMO_PROJECT_ID = 'demo-fnd-perf';
const REPORT_SCHEMA_VERSION = 2;
const PLAN_VERSION = 2;
const RECEIPT_COLLECTION = 'task07_media_backfill_receipts';
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 50;
const DEFAULT_MAX_PAGES = 20;
const MAX_MAX_PAGES = 100;
const MIGRATION_CONCURRENCY = 1;
const DEFAULT_POLL_TIMEOUT_MS = 10 * 60 * 1000;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const OPERATIONS = new Set(['backfill', 'verify', 'rollback']);
const SUPPORTED_KINDS = new Set([
  'avatar', 'item', 'npc', 'foe',
  'technique', 'technique-video', 'spell', 'spell-video',
  'map', 'map-video',
]);
const SOURCE_KEYS = Object.freeze([
  'avatars',
  'catalog-items',
  'inventory-items',
  'npcs',
  'foes',
  'technique-art',
  'technique-video',
  'spell-art',
  'spell-video',
  'backgrounds',
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
]);
const DEFAULT_RESULTS_DIRECTORY = path.resolve(
  __dirname,
  '..',
  '..',
  'performance-results'
);

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
    /^media\/v1\/(?:avatar|item|npc|foe|technique|technique-video|spell|spell-video|map|map-video)\/[^/]+\/m_[a-f0-9]{40}\//
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
      if (/^(?:imagePath|imageUrl|image_url|posterPath|posterUrl|videoUrl|video_url|storagePath|path|url)$/i
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
    return parts[1] === 'copies' ? parts[2] || '' : parts[1] || '';
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

const targetKindFor = (kind, referenceScope) => {
  if (kind === 'avatar') return 'profile';
  if (kind === 'item') {
    return referenceScope === 'global-catalog' ?
      'catalog-item' :
      'user-inventory';
  }
  if (kind === 'npc') return 'npc';
  if (kind === 'foe') return 'foe';
  if (kind === 'technique' || kind === 'technique-video') {
    return 'user-technique';
  }
  if (kind === 'spell' || kind === 'spell-video') return 'user-spell';
  if (kind === 'map' || kind === 'map-video') {
    return 'grigliata-background';
  }
  return '';
};

const targetPathFor = (kind, ownerUid, entityId, referenceScope) => {
  if (kind === 'avatar') return `users/${ownerUid}`;
  if (kind === 'item' && referenceScope === 'global-catalog') {
    return `items/${entityId}`;
  }
  if (kind === 'item' && referenceScope === 'user-inventory') {
    return `users/${ownerUid}/inventory/${entityId}`;
  }
  if (kind === 'npc') return `echi_npcs/${entityId}`;
  if (kind === 'foe') return `foes/${entityId}`;
  if (kind === 'technique' || kind === 'technique-video') {
    return `users/${ownerUid}/tecniche/${entityId}`;
  }
  if (kind === 'spell' || kind === 'spell-video') {
    return `users/${ownerUid}/spells/${entityId}`;
  }
  if (kind === 'map' || kind === 'map-video') {
    return `grigliata_backgrounds/${entityId}`;
  }
  return '';
};

const audienceFor = (kind, referenceScope) => {
  if (kind === 'foe') return 'dm-only';
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
  if (['technique', 'technique-video', 'spell', 'spell-video']
    .includes(kind)) return true;
  if (['foe', 'map', 'map-video'].includes(kind)) return role === 'dm';
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

const buildServerPlanProjection = (input) => {
  const operationId = `task07-backfill-${canonicalHash({
    projectId: input.projectId,
    kind: input.kind,
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
    targetKind: targetKindFor(input.kind, input.referenceScope),
    audienceScope: audienceFor(input.kind, input.referenceScope),
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
  mode: report.mode,
  complete: report.complete,
  scan: report.scan,
  counts: report.counts,
  entries: report.entries,
});

const computePlanFingerprint = (report) => canonicalHash(
  planFingerprintCore(report)
);

const finalizeReport = ({
  operation,
  projectId,
  complete,
  scan,
  entries,
  records = 0,
}) => {
  const counts = {
    records,
    candidates: entries.length,
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
    mode: 'dry-run',
    complete: Boolean(complete),
    scan,
    counts,
    entries,
  };
  return {...report, planFingerprint: computePlanFingerprint(report)};
};

const buildLegacyMediaBackfillPlan = async (
  records,
  {
    projectId = DEMO_PROJECT_ID,
    readSourceObject = async () => null,
    readOwner = async () => null,
    scan = {complete: true, pageSize: DEFAULT_PAGE_SIZE, maxPages: 1},
  } = {}
) => {
  const entries = [];
  const seen = new Set();
  const ownerCache = new Map();
  for (const record of records) {
    const kind = asString(record.kind);
    const entityId = asString(record.entityId);
    if (!SUPPORTED_KINDS.has(kind) || !entityId) continue;
    const data = isRecord(record.data) ? record.data : {};
    const referenceScope = referenceScopeFor(record);
    const candidatePaths = legacyPathsForKind(data, kind)
      .filter((sourcePath) => !isCanonicalTask07Path(sourcePath));
    for (const sourcePath of candidatePaths) {
      const ownerUid = asString(record.ownerUid) ||
        inferOwnerFromPath(sourcePath, kind);
      const targetPath = asString(record.targetPath) ||
        targetPathFor(kind, ownerUid, entityId, referenceScope);
      const dedupeKey = [
        kind, referenceScope, targetPath, sourcePath,
      ].join('\u0000');
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      const source = normalizeSourceObject(
        sourcePath,
        await readSourceObject(sourcePath, record)
      );
      if (!ownerCache.has(ownerUid)) {
        ownerCache.set(ownerUid, ownerUid ? await readOwner(ownerUid) : null);
      }
      const owner = ownerCache.get(ownerUid);
      const role = asString(owner?.role).toLowerCase();
      const issues = [];
      const contract = mediaPolicy.purposes[kind];
      if (!ownerUid) issues.push(issue('missing-owner'));
      if (ownerUid && (!owner?.exists || owner?.deletionState === 'pending')) {
        issues.push(issue('owner-not-active'));
      }
      if (ownerUid && owner?.exists &&
        !roleAuthorizes(kind, referenceScope, role)) {
        issues.push(issue('owner-role-not-authorized'));
      }
      if (!targetPath) issues.push(issue('unsupported-target'));
      if (data.deletionState === 'pending' ||
        data.pendingDeletion === true ||
        data.deleted === true) {
        issues.push(issue('target-unavailable'));
      }
      if (['map', 'map-video'].includes(kind)) {
        const expectedAssetType = kind === 'map-video' ? 'video' : 'image';
        if (data.assetType !== expectedAssetType) {
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
      });
      entries.push({
        receiptId: `r_${subjectHash.slice(0, 40)}`,
        subjectHash,
        kind,
        referenceScope,
        ownerUid,
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
    const targetSlotKey = `${entry.targetPath}\u0000${entry.targetSlot}`;
    if (!pathsByTarget.has(targetSlotKey)) {
      pathsByTarget.set(targetSlotKey, new Set());
    }
    pathsByTarget.get(targetSlotKey).add(entry.sourcePath);
  });
  entries.forEach((entry) => {
    const targetSlotKey = `${entry.targetPath}\u0000${entry.targetSlot}`;
    if (pathsByTarget.get(targetSlotKey).size <= 1) return;
    entry.issues.push(issue('ambiguous-legacy-media-reference'));
    entry.status = 'blocked';
  });
  entries.sort((left, right) => (
    left.targetPath.localeCompare(right.targetPath) ||
    left.sourcePath.localeCompare(right.sourcePath) ||
    left.receiptId.localeCompare(right.receiptId)
  ));
  return finalizeReport({
    operation: 'backfill',
    projectId,
    complete: scan.complete,
    scan,
    entries,
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
  } = {}
) => loadPaged({
  sourceKeys: SOURCE_KEYS,
  readPage: backend.readLegacyPage,
  pageSize,
  maxPages,
});

const buildReceiptOperationPlan = async ({
  backend,
  operation,
  projectId = DEMO_PROJECT_ID,
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
  for (const receipt of loaded.records) {
    const receiptId = asString(receipt.receiptId || receipt.id);
    const inspection = await backend.inspectReceipt(receipt);
    const issues = [];
    if (receipt.schemaVersion !== REPORT_SCHEMA_VERSION ||
      receipt.planVersion !== PLAN_VERSION ||
      receipt.policyVersion !== mediaPolicy.policyVersion ||
      receipt.policyHash !== POLICY_HASH ||
      !['media', 'videoMedia'].includes(receipt.targetSlot) ||
      !/^[a-f0-9]{64}$/.test(asString(receipt.subjectHash))) {
      issues.push(issue('receipt-contract-mismatch'));
    }
    const attached = receipt.state === 'attached';
    const rolledBack = receipt.state === 'rolled-back';
    if (!attached && !rolledBack) issues.push(issue('receipt-not-terminal'));
    if (attached && (
      inspection.manifestState !== 'attached' ||
      inspection.targetAssetId !== receipt.assetId ||
      Number(inspection.targetRevision) !== Number(receipt.attachedRevision) ||
      inspection.generatedObjectsPresent !== true
    )) {
      issues.push(issue('attached-receipt-drift'));
    }
    if (rolledBack && (
      inspection.targetAssetId !== (receipt.previousAssetId || null) ||
      !['cleanup-pending', 'deleted'].includes(inspection.manifestState)
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
      subjectHash: asString(receipt.subjectHash),
      assetId: asString(receipt.assetId),
      previousAssetId: asString(receipt.previousAssetId) || null,
      targetPath: asString(receipt.targetPath),
      targetSlot: receipt.targetSlot === 'videoMedia' ?
        'videoMedia' :
        'media',
      receiptState: asString(receipt.state),
      inspectionHash,
      status,
      issues,
    });
  }
  entries.sort((left, right) => left.receiptId.localeCompare(right.receiptId));
  return finalizeReport({
    operation,
    projectId,
    complete: loaded.scan.complete,
    scan: loaded.scan,
    entries,
    records: loaded.records.length,
  });
};

const buildMigrationPlan = async ({
  backend,
  operation,
  projectId,
  pageSize,
  maxPages,
}) => {
  if (operation === 'backfill') {
    const loaded = await loadLegacyMediaRecords(backend, {pageSize, maxPages});
    return buildLegacyMediaBackfillPlan(loaded.records, {
      projectId,
      scan: loaded.scan,
      readSourceObject: backend.readSourceObject,
      readOwner: backend.readOwner,
    });
  }
  return buildReceiptOperationPlan({
    backend,
    operation,
    projectId,
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

const parseOptions = (argv = []) => {
  const options = {
    operation: 'backfill',
    projectId: '',
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
    else if (argument === '--write' || argument === '--allow-live-read') {
      throw new TypeError(`${argument} is not supported by Task 07 backfill.`);
    } else if ([
      '--operation',
      '--project',
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
  if (options.projectId !== DEMO_PROJECT_ID) {
    throw new TypeError(
      `Task 07 media backfill only permits ${DEMO_PROJECT_ID}.`
    );
  }
  for (const variable of ['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT']) {
    if (env[variable] && env[variable] !== options.projectId) {
      throw new TypeError(
        `${variable} does not match the explicit --project.`
      );
    }
  }
  if (!parseLoopbackEmulatorHost(env.FIRESTORE_EMULATOR_HOST)) {
    throw new TypeError(
      'Task 07 media backfill requires a loopback Firestore emulator.'
    );
  }
  if (!parseLoopbackEmulatorHost(env.FIREBASE_STORAGE_EMULATOR_HOST)) {
    throw new TypeError(
      'Task 07 media backfill requires a loopback Storage emulator.'
    );
  }
  if (options.execute && options.operation === 'backfill' &&
    !parseLoopbackEmulatorHost(env.FUNCTIONS_EMULATOR_HOST)) {
    throw new TypeError(
      'Task 07 backfill execution requires a loopback Functions emulator.'
    );
  }
  return {
    projectId: options.projectId,
    live: false,
    concurrency: MIGRATION_CONCURRENCY,
  };
};

const assertReadOnlyTarget = assertSafeTarget;

const assertApprovedReport = (report, options) => {
  if (!isRecord(report) ||
    report.schemaVersion !== REPORT_SCHEMA_VERSION ||
    report.planVersion !== PLAN_VERSION ||
    report.policyVersion !== mediaPolicy.policyVersion ||
    report.policyHash !== POLICY_HASH ||
    report.operation !== options.operation ||
    report.projectId !== options.projectId ||
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
    report.planFingerprint !== computePlanFingerprint(report)) {
    throw new Error(
      'Execution requires the exact completed, error-free Task 07 plan.'
    );
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
  throw new Error(`Unknown legacy media source: ${sourceKey}`);
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

const exactAttachedAssetId = (data, targetSlot = 'media') => (
  /^m_[a-f0-9]{40}$/.test(asString(data?.[targetSlot]?.assetId)) ?
    asString(data[targetSlot].assetId) :
    null
);

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

const createAdminBackend = (projectId) => {
  const {deleteApp, initializeApp} = require('firebase-admin/app');
  const {
    FieldPath,
    FieldValue,
    Timestamp,
    getFirestore,
  } = require('firebase-admin/firestore');
  const {getStorage} = require('firebase-admin/storage');
  const app = initializeApp({
    projectId,
    storageBucket: `${projectId}.appspot.com`,
  }, `task07-media-backfill-${process.pid}-${Date.now()}`);
  const db = getFirestore(app);
  const bucket = getStorage(app).bucket();

  const collectionForSource = (sourceKey) => {
    if (sourceKey === 'avatars') return db.collection('users');
    if (sourceKey === 'catalog-items') return db.collection('items');
    if (sourceKey === 'inventory-items') return db.collectionGroup('inventory');
    if (sourceKey === 'npcs') return db.collection('echi_npcs');
    if (sourceKey === 'foes') return db.collection('foes');
    if (['technique-art', 'technique-video'].includes(sourceKey)) {
      return db.collectionGroup('tecniche');
    }
    if (['spell-art', 'spell-video'].includes(sourceKey)) {
      return db.collectionGroup('spells');
    }
    if (sourceKey === 'backgrounds') {
      return db.collection('grigliata_backgrounds');
    }
    throw new Error(`Unknown legacy media source: ${sourceKey}`);
  };

  const readLegacyPage = async (sourceKey, cursor, pageSize) => {
    let query = collectionForSource(sourceKey)
      .orderBy(FieldPath.documentId())
      .limit(pageSize + 1);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    const page = snapshot.docs.slice(0, pageSize);
    return {
      records: page.map((document) => (
        recordFromSnapshot(sourceKey, document)
      )),
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

  const generatedObjectsPresent = async (manifest) => {
    if (!manifest.exists) return false;
    const generated = manifest.get('generated');
    const descriptors = [
      generated?.original,
      ...Object.values(generated?.variants || {}),
    ].filter((descriptor) => isRecord(descriptor));
    if (!descriptors.length) return false;
    for (const descriptor of descriptors) {
      try {
        const [metadata] = await bucket.file(descriptor.path).getMetadata();
        if (String(metadata.generation || '') !==
          String(descriptor.generation || '')) return false;
      } catch {
        return false;
      }
    }
    return true;
  };

  const inspectReceipt = async (receipt) => {
    const targetSlot = receipt.targetSlot === 'videoMedia' ?
      'videoMedia' :
      'media';
    const [target, manifest] = await db.getAll(
      db.doc(receipt.targetPath),
      db.doc(`media_assets/${receipt.assetId}`)
    );
    return {
      manifestState: asString(manifest.get('state')),
      targetAssetId: exactAttachedAssetId(target.data(), targetSlot) || null,
      targetRevision: Number(target.get(revisionFieldForSlot(targetSlot))) || 0,
      generatedObjectsPresent: await generatedObjectsPresent(manifest),
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
      plan.audienceScope !== entry.audienceScope ||
      compiled.core.task07MediaReferencePath(plan) !== entry.targetPath) {
      throw new Error('Approved entry no longer matches server contracts.');
    }
    return plan;
  };

  const assertReceiptBinding = (receipt, entry) => {
    if (!receipt.exists) return;
    if (receipt.get('schemaVersion') !== REPORT_SCHEMA_VERSION ||
      receipt.get('planVersion') !== PLAN_VERSION ||
      receipt.get('policyVersion') !== mediaPolicy.policyVersion ||
      receipt.get('policyHash') !== POLICY_HASH ||
      receipt.get('subjectHash') !== entry.subjectHash ||
      receipt.get('assetId') !== entry.assetId ||
      receipt.get('targetPath') !== entry.targetPath ||
      receipt.get('targetSlot') !== entry.targetSlot) {
      throw new Error('Existing Task 07 receipt has a different binding.');
    }
  };

  const createIntentAndReceipt = async (entry, binding, compiled, plan) => {
    const receiptRef = db.doc(`${RECEIPT_COLLECTION}/${entry.receiptId}`);
    const manifestRef = db.doc(`media_assets/${entry.assetId}`);
    const targetRef = db.doc(entry.targetPath);
    const ownerRef = db.doc(`users/${entry.ownerUid}`);
    await db.runTransaction(async (transaction) => {
      const [receipt, manifest, target, owner] = await transaction.getAll(
        receiptRef,
        manifestRef,
        targetRef,
        ownerRef
      );
      assertReceiptBinding(receipt, entry);
      if (receipt.exists) {
        if (!manifest.exists) {
          throw new Error('Receipt exists without its Task 07 manifest.');
        }
        return;
      }
      if (!target.exists ||
        targetMediaFingerprint(target.data() || {}, entry.kind) !==
          entry.targetFingerprint) {
        throw new Error('Media target changed after planning. Re-plan.');
      }
      if (target.get('deletionState') === 'pending' ||
        target.get('pendingDeletion') === true ||
        target.get('deleted') === true) {
        throw new Error('Media target is no longer available.');
      }
      if (!legacyPathsForKind(target.data() || {}, entry.kind)
        .includes(entry.sourcePath)) {
        throw new Error('Legacy media reference changed after planning.');
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
      if (exactAttachedAssetId(target.data(), entry.targetSlot) !==
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
      if (!manifest.exists) {
        transaction.create(manifestRef, {
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
          createdAt: now,
          updatedAt: now,
        });
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
        sourceFingerprint: entry.sourceFingerprint,
        beforeFields: captureCompatibilityFields(target.data() || {}, entry.kind),
        state: 'intent',
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
    throw new Error('Task 07 processor timed out in the local emulator.');
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
      assertReceiptBinding(receipt, entry);
      if (receipt.get('state') === 'attached') return;
      if (manifest.get('state') !== 'attached' ||
        attached.targetSlot !== entry.targetSlot ||
        exactAttachedAssetId(target.data(), entry.targetSlot) !== entry.assetId ||
        Number(target.get(revisionFieldForSlot(entry.targetSlot))) !==
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
        inspection.generatedObjectsPresent === true,
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
      if (receipt.get('state') !== 'attached' ||
        manifest.get('state') !== 'attached' ||
        exactAttachedAssetId(target.data(), entry.targetSlot) !== entry.assetId) {
        throw new Error('Rollback preconditions no longer match.');
      }
      const now = Timestamp.now();
      const revisionField = revisionFieldForSlot(entry.targetSlot);
      const updatedAtField = updatedAtFieldForSlot(entry.targetSlot);
      const revision = (Number(target.get(revisionField)) || 0) + 1;
      transaction.update(targetRef, {
        ...restoreFieldPatch(receipt.get('beforeFields')),
        [revisionField]: revision,
        [updatedAtField]: now,
      });
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
        ['cleanup-pending', 'deleted'].includes(after.manifestState),
      idempotent: receiptBefore.get('state') === 'rolled-back',
    };
  };

  return {
    readLegacyPage,
    readSourceObject,
    readOwner,
    readReceiptPage,
    inspectReceipt,
    applyBackfillEntry,
    rollbackEntry,
    close: async () => deleteApp(app),
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
  'Safety:',
  '  - Planning and verification are read-only and are the default.',
  '  - Firebase access is restricted to demo-fnd-perf loopback emulators.',
  '  - Backfill execution also requires the loopback Functions emulator.',
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
  const backend = createAdminBackend(options.projectId);
  try {
    if (!options.execute) {
      const report = await buildMigrationPlan({
        backend,
        operation: options.operation,
        projectId: options.projectId,
        pageSize: options.pageSize,
        maxPages: options.maxPages,
      });
      writeJsonAtomic(options.reportPath, report);
      const output = options.json ? report : {
        mode: 'dry-run',
        operation: options.operation,
        projectId: options.projectId,
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
  MAX_MAX_PAGES,
  MAX_PAGE_SIZE,
  MIGRATION_CONCURRENCY,
  PLAN_VERSION,
  POLICY_HASH,
  REPORT_SCHEMA_VERSION,
  assertApprovedReport,
  assertCheckpoint,
  assertReadOnlyTarget,
  assertSafeTarget,
  buildLegacyMediaBackfillPlan,
  buildMigrationPlan,
  buildReceiptOperationPlan,
  canonicalHash,
  collectMediaPaths,
  computePlanFingerprint,
  createAdminBackend,
  executeMigrationPlan,
  isCanonicalTask07Path,
  loadLegacyMediaRecords,
  loadPaged,
  parseOptions,
  stagingActionForManifest,
  storagePathFromValue,
};
