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
const {getFirebaseEnvironment} = require('../firebase-environment');
const {resolveOperatorTarget} = require('../firebase-operator-target');

const PERFORMANCE_ENVIRONMENT = getFirebaseEnvironment('performance');
const DEMO_PROJECT_ID = PERFORMANCE_ENVIRONMENT.projectId;
const DEMO_HOSTING_SITE = PERFORMANCE_ENVIRONMENT.hostingSite;
const DEMO_STORAGE_BUCKET = PERFORMANCE_ENVIRONMENT.storageBucket;
const REPORT_SCHEMA_VERSION = 4;
const PLAN_VERSION = 5;
const CANONICAL_AUDIT_VERSION = 1;
const RECEIPT_COLLECTION = 'task07_media_backfill_receipts';
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 50;
const DEFAULT_MAX_PAGES = 20;
const MAX_MAX_PAGES = 100;
const MIGRATION_CONCURRENCY = 1;
// A Firestore page is bounded by root documents. Catalog and foe roots expand
// into renderer-active embedded media records, so bound that expansion
// separately instead of incorrectly treating it as additional Firestore rows.
const MAX_EXPANDED_MEDIA_RECORDS_PER_ROOT = 401;
const DEFAULT_POLL_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_PLACEMENT_REFERENCES = 500;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const OPERATIONS = new Set([
  'backfill',
  'verify',
  'rollback',
  'canonical-audit',
]);
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

const storageReferenceFromValue = (value) => {
  const text = asString(value);
  if (!text || /^(?:blob|data):/i.test(text)) return null;
  if (!text.includes('://')) {
    return {
      bucket: '',
      loopback: false,
      path: text.replace(/^\/+/, ''),
      url: false,
    };
  }
  try {
    const parsed = new URL(text);
    const loopback = LOOPBACK_HOSTS.has(parsed.hostname);
    if (parsed.hostname === 'firebasestorage.googleapis.com' || loopback) {
      const match = parsed.pathname.match(/\/b\/([^/]+)\/o\/(.+)$/);
      if (!match) return null;
      return {
        bucket: decodeURIComponent(match[1]),
        loopback,
        path: decodeURIComponent(match[2]).replace(/^\/+/, ''),
        url: true,
      };
    }
    if (parsed.hostname === 'storage.googleapis.com') {
      const parts = parsed.pathname.split('/').filter(Boolean);
      if (parts.length < 2) return null;
      return {
        bucket: decodeURIComponent(parts[0]),
        loopback: false,
        path: decodeURIComponent(parts.slice(1).join('/')).replace(/^\/+/, ''),
        url: true,
      };
    }
    return null;
  } catch {
    return null;
  }
};

const storagePathFromValue = (value, {
  expectedBucket = '',
  allowLoopback = false,
} = {}) => {
  const reference = storageReferenceFromValue(value);
  if (!reference?.path) return '';
  if (!reference.url) return reference.path;
  if (!expectedBucket || reference.bucket !== expectedBucket ||
    (reference.loopback && allowLoopback !== true)) return '';
  return reference.path;
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

const collectMediaPaths = (value, storageContext = {}) => {
  const result = new Set();
  const visit = (entry, key = '') => {
    if (typeof entry === 'string') {
      if (/^(?:imagePath|imageUrl|image_url|posterPath|posterUrl|videoUrl|video_url|audioPath|audioUrl|storagePath|path|url)$/i
        .test(key)) {
        const storagePath = storagePathFromValue(entry, storageContext);
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

const VIDEO_REFERENCE_PATTERN =
  /(?:^data:video\/|\.(?:mp4|webm|mov|m4v|ogv)(?:[?#].*)?$)/i;

const declaresVideoReference = (value) => {
  if (typeof value === 'string') {
    return VIDEO_REFERENCE_PATTERN.test(value.trim());
  }
  if (!isRecord(value)) return false;
  const contentType = normalizeContentType(
    value.contentType || value.mime || value.original?.contentType
  );
  const kind = asString(value.kind || value.purpose).toLowerCase();
  if (contentType.startsWith('video/') || kind.endsWith('-video')) return true;
  return ['url', 'downloadUrl', 'imageUrl', 'image_url', 'path', 'storagePath']
    .some((field) => declaresVideoReference(value[field]));
};

const rendererVideoLegacyProjection = (data) => {
  const value = isRecord(data) ? data : {};
  const ambiguousVideoValue = (candidate) => (
    declaresVideoReference(candidate) ? candidate : undefined
  );
  const media = declaresVideoReference(value.media) ? value.media : undefined;
  return {
    video_url: value.video_url,
    videoUrl: value.videoUrl,
    videoMedia: value.videoMedia,
    // `url` and `downloadUrl` are the resolver's generic video fallbacks. An
    // image-specific alias is video intent only when it names a video object;
    // this prevents image-only spell art from being invented as a video.
    url: value.url,
    downloadUrl: value.downloadUrl,
    imageUrl: ambiguousVideoValue(value.imageUrl),
    image_url: ambiguousVideoValue(value.image_url),
    media,
    General: {
      video_url: value.General?.video_url,
      videoUrl: value.General?.videoUrl,
      videoMedia: value.General?.videoMedia,
      url: value.General?.url,
      downloadUrl: value.General?.downloadUrl,
      imageUrl: ambiguousVideoValue(value.General?.imageUrl),
      image_url: ambiguousVideoValue(value.General?.image_url),
      media: declaresVideoReference(value.General?.media) ?
        value.General.media : undefined,
    },
  };
};

const declaresRendererVideoMedia = (data) => {
  const value = isRecord(data) ? data : {};
  const explicitVideoDescriptor = [
    value.videoMedia,
    value.General?.videoMedia,
  ].some((candidate) => (
    candidate !== null && candidate !== undefined && candidate !== ''
  ));
  const explicitVideoAlias = [
    value.videoUrl,
    value.video_url,
    value.General?.videoUrl,
    value.General?.video_url,
  ].some((candidate) => (
    candidate !== null && candidate !== undefined && candidate !== ''
  ));
  const genericRendererFallback = [
    value.url,
    value.downloadUrl,
    value.imageUrl,
    value.image_url,
    value.General?.url,
    value.General?.downloadUrl,
    value.General?.imageUrl,
    value.General?.image_url,
    value.media,
    value.General?.media,
  ].some(declaresVideoReference);
  return explicitVideoDescriptor || explicitVideoAlias || genericRendererFallback;
};

const mediaReferenceProjectionForKind = (data, kind) => {
  const imageUrlFields = (value) => ({
    url: value?.url,
    downloadUrl: value?.downloadUrl,
    imageUrl: value?.imageUrl,
    image_url: value?.image_url,
  });
  const videoUrlFields = (value) => ({
    url: value?.url,
    downloadUrl: value?.downloadUrl,
    videoUrl: value?.videoUrl,
    video_url: value?.video_url,
    imageUrl: value?.imageUrl,
    image_url: value?.image_url,
  });
  if (kind === 'item') {
    return {
      ...imageUrlFields(data),
      imagePath: data?.imagePath,
      media: data?.media,
      General: {
        ...imageUrlFields(data?.General),
        imagePath: data?.General?.imagePath,
        media: data?.General?.media,
      },
    };
  }
  if (kind === 'technique' || kind === 'spell') {
    return {
      ...imageUrlFields(data),
      imagePath: data?.imagePath,
      media: data?.media,
      General: {
        ...imageUrlFields(data?.General),
        imagePath: data?.General?.imagePath,
        media: data?.General?.media,
      },
    };
  }
  if (kind === 'technique-video' || kind === 'spell-video') {
    return {
      ...videoUrlFields(data),
      videoMedia: data?.videoMedia,
      media: data?.media,
      General: {
        ...videoUrlFields(data?.General),
        videoMedia: data?.General?.videoMedia,
        media: data?.General?.media,
      },
    };
  }
  if (kind === 'music') {
    return {
      url: data?.url,
      downloadUrl: data?.downloadUrl,
      audioPath: data?.audioPath,
      audioUrl: data?.audioUrl,
      media: data?.media,
      General: {
        url: data?.General?.url,
        downloadUrl: data?.General?.downloadUrl,
        audioPath: data?.General?.audioPath,
        audioUrl: data?.General?.audioUrl,
        media: data?.General?.media,
      },
    };
  }
  if (kind === 'map-video') {
    return {
      ...videoUrlFields(data),
      imagePath: data?.imagePath,
      videoMedia: data?.videoMedia,
      media: data?.media,
      posterPath: data?.posterPath,
      posterUrl: data?.posterUrl,
      General: {
        ...videoUrlFields(data?.General),
        imagePath: data?.General?.imagePath,
        videoMedia: data?.General?.videoMedia,
        media: data?.General?.media,
        posterPath: data?.General?.posterPath,
        posterUrl: data?.General?.posterUrl,
      },
    };
  }
  return {
    ...imageUrlFields(data),
    imagePath: data?.imagePath,
    videoUrl: data?.videoUrl,
    posterPath: data?.posterPath,
    posterUrl: data?.posterUrl,
    media: data?.media,
    General: {
      ...imageUrlFields(data?.General),
      imagePath: data?.General?.imagePath,
      posterPath: data?.General?.posterPath,
      posterUrl: data?.General?.posterUrl,
      media: data?.General?.media,
    },
  };
};

const legacyPathProjectionForKind = (data, kind) => {
  if (kind === 'item') {
    return {
      image_url: data?.image_url,
      imagePath: data?.imagePath,
      imageUrl: data?.imageUrl,
      media: data?.media,
      General: {
        image_url: data?.General?.image_url,
        media: data?.General?.media,
      },
    };
  }
  if (kind === 'technique' || kind === 'spell') {
    return {
      url: data?.url,
      downloadUrl: data?.downloadUrl,
      image_url: data?.image_url,
      imagePath: data?.imagePath,
      imageUrl: data?.imageUrl,
      media: data?.media,
      General: {
        url: data?.General?.url,
        downloadUrl: data?.General?.downloadUrl,
        image_url: data?.General?.image_url,
        imagePath: data?.General?.imagePath,
        imageUrl: data?.General?.imageUrl,
        media: data?.General?.media,
      },
    };
  }
  if (kind === 'technique-video' || kind === 'spell-video') {
    return rendererVideoLegacyProjection(data);
  }
  if (kind === 'music') {
    return {
      audioPath: data?.audioPath,
      audioUrl: data?.audioUrl,
      media: data?.media,
    };
  }
  return {
    image_url: data?.image_url,
    imagePath: data?.imagePath,
    imageUrl: data?.imageUrl,
    videoUrl: data?.videoUrl,
    posterPath: data?.posterPath,
    posterUrl: data?.posterUrl,
    media: data?.media,
  };
};

const legacyPathsForKind = (data, kind, storageContext = {}) => (
  collectMediaPaths(legacyPathProjectionForKind(data, kind), storageContext)
);

const MEDIA_REFERENCE_KEY_PATTERN =
  /^(?:imagePath|imageUrl|image_url|posterPath|posterUrl|videoUrl|video_url|audioPath|audioUrl|storagePath|path|url|downloadUrl)$/i;

const mediaReferenceDeclarationsForKind = (
  data,
  kind,
  storageContext = {}
) => {
  const declarations = [];
  const visit = (entry, key = '', fieldPath = '') => {
    if (MEDIA_REFERENCE_KEY_PATTERN.test(key)) {
      if (typeof entry === 'string') {
        const value = entry.trim();
        if (value) declarations.push({
          fieldPath,
          value,
          storagePath: storagePathFromValue(value, storageContext),
        });
      } else if (entry !== null && entry !== undefined) {
        declarations.push({
          fieldPath,
          value: canonicalize(entry),
          storagePath: '',
        });
      }
      return;
    }
    if (Array.isArray(entry)) {
      entry.forEach((nested, index) => visit(
        nested,
        key,
        `${fieldPath}[${index}]`
      ));
      return;
    }
    if (!isRecord(entry)) return;
    Object.entries(entry).forEach(([nestedKey, nested]) => {
      if (['media', 'videoMedia'].includes(nestedKey) &&
        Number(nested?.schemaVersion) === 1) return;
      visit(
        nested,
        nestedKey,
        fieldPath ? `${fieldPath}.${nestedKey}` : nestedKey
      );
    });
  };
  visit(mediaReferenceProjectionForKind(data, kind));
  return declarations.sort((left, right) => (
    left.fieldPath.localeCompare(right.fieldPath) ||
    String(left.value).localeCompare(String(right.value))
  ));
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

const referenceScopeFor = (record) => (
  record.kind === 'item' || record?.nestedTarget?.kind === 'catalog-item-spell'
) ?
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

const targetKindFor = (
  kind,
  referenceScope,
  commonTechnique = false,
  nestedTarget = null
) => {
  if (nestedTarget?.kind) return nestedTarget.kind;
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
  commonTechnique = false,
  nestedTarget = null
) => {
  if (nestedTarget?.kind === 'catalog-item-spell') return `items/${entityId}`;
  if (['foe-technique', 'foe-spell'].includes(nestedTarget?.kind)) {
    return `foes/${entityId}`;
  }
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

const audienceFor = (
  kind,
  referenceScope,
  commonTechnique = false,
  nestedTarget = null
) => {
  if (nestedTarget?.kind === 'catalog-item-spell') return 'signed-in';
  if (['foe-technique', 'foe-spell'].includes(nestedTarget?.kind)) {
    return 'dm-only';
  }
  if (kind === 'foe') return 'dm-only';
  if (commonTechnique) return 'signed-in';
  if ((kind === 'item' && referenceScope === 'user-inventory') ||
    ['technique', 'technique-video', 'spell', 'spell-video'].includes(kind)) {
    return 'owner-manager';
  }
  return 'signed-in';
};

const roleAuthorizes = (kind, referenceScope, role, nestedTarget = null) => {
  if (nestedTarget?.kind === 'catalog-item-spell' ||
    ['foe-technique', 'foe-spell'].includes(nestedTarget?.kind)) {
    return ['dm', 'webmaster'].includes(role);
  }
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

const PERSONAL_OWNER_SOURCE_KEYS = new Set([
  'avatars',
  'inventory-items',
  'technique-art',
  'technique-video',
  'spell-art',
  'spell-video',
]);

const ownerFromPersonalTargetPath = (sourceKey, targetPath, entityId) => {
  const escapedEntityId = entityId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = {
    avatars: /^users\/([^/]+)$/,
    'inventory-items': new RegExp(
      `^users/([^/]+)/inventory/${escapedEntityId}$`
    ),
    'technique-art': new RegExp(
      `^users/([^/]+)/tecniche/${escapedEntityId}$`
    ),
    'technique-video': new RegExp(
      `^users/([^/]+)/tecniche/${escapedEntityId}$`
    ),
    'spell-art': new RegExp(
      `^users/([^/]+)/spells/${escapedEntityId}$`
    ),
    'spell-video': new RegExp(
      `^users/([^/]+)/spells/${escapedEntityId}$`
    ),
  };
  return asString(patterns[sourceKey]?.exec(targetPath)?.[1]);
};

const canonicalAuditOwner = ({
  record,
  sourceKey,
  targetPath,
  entityId,
  catalogOwnerUid,
  attachedOwnerUid,
}) => {
  const explicitOwnerUid = asString(record.ownerUid);
  const issues = [];
  let ownerUid = '';
  let ownerResolution = 'missing';
  if (PERSONAL_OWNER_SOURCE_KEYS.has(sourceKey)) {
    ownerUid = ownerFromPersonalTargetPath(sourceKey, targetPath, entityId);
    ownerResolution = ownerUid ? 'target-path' : 'missing';
    if (!ownerUid || explicitOwnerUid !== ownerUid) {
      issues.push('canonical-owner-target-mismatch');
    }
  } else if (['custom-token-templates', 'foe-tokens'].includes(sourceKey)) {
    ownerUid = explicitOwnerUid;
    ownerResolution = ownerUid ? 'explicit' : 'missing';
    const targetOwnerUid = asString(record.data?.ownerUid);
    if (!ownerUid || !targetOwnerUid || targetOwnerUid !== ownerUid) {
      issues.push('canonical-owner-target-mismatch');
    }
  } else {
    ownerUid = asString(attachedOwnerUid) || explicitOwnerUid;
    ownerResolution = asString(attachedOwnerUid) ?
      'attached-manifest' : ownerUid ? 'explicit' : 'missing';
    if (!ownerUid && GLOBAL_FALLBACK_OWNER_SOURCES.has(sourceKey)) {
      ownerUid = asString(catalogOwnerUid);
      ownerResolution = ownerUid ? 'verified-global-fallback' : 'missing';
    }
  }
  if (!ownerUid) issues.push('missing-owner');
  return {issues, ownerResolution, ownerUid};
};

const targetSlotForKind = (kind, nestedTarget = null) => (
  nestedTarget?.slot ||
  (['technique-video', 'spell-video'].includes(kind) ? 'videoMedia' : 'media')
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

const rawEmbeddedBindingFor = (data, nestedTarget) => {
  if (!isRecord(nestedTarget)) return null;
  const binding = data?.task07EmbeddedMedia?.[nestedTarget.entryId];
  return isRecord(binding) ? binding : null;
};

const embeddedBindingFor = (data, nestedTarget) => {
  const binding = rawEmbeddedBindingFor(data, nestedTarget);
  return binding?.targetKind === nestedTarget?.kind ? binding : null;
};

const nestedTargetBindingIdentity = (value) => isRecord(value) ? {
  schemaVersion: value.schemaVersion,
  kind: value.kind,
  entryId: value.entryId,
  slot: value.slot,
} : null;

const nestedTargetBindingMatches = (left, right) => canonicalHash(
  nestedTargetBindingIdentity(left)
) === canonicalHash(nestedTargetBindingIdentity(right));

const nestedEntryFor = (data, nestedTarget) => {
  if (!isRecord(data) || !isRecord(nestedTarget)) return null;
  const entries = nestedTarget.kind === 'catalog-item-spell' ?
    Object.entries(isRecord(data.General?.spells) ? data.General.spells : {}) :
    (Array.isArray(data[
      nestedTarget.kind === 'foe-technique' ? 'tecniche' : 'spells'
    ]) ? data[
      nestedTarget.kind === 'foe-technique' ? 'tecniche' : 'spells'
    ].map((entry, index) => [String(index), entry]) : []);
  const matches = entries.filter(([, entry]) => (
    isRecord(entry) && asString(entry.task07MediaEntryId) ===
      nestedTarget.entryId
  ));
  const crossKindEntries = nestedTarget.kind === 'foe-technique' ?
    (Array.isArray(data.spells) ? data.spells : []) :
    (nestedTarget.kind === 'foe-spell' && Array.isArray(data.tecniche) ?
      data.tecniche : []);
  const crossKindConflict = crossKindEntries.some((entry) => (
    isRecord(entry) && asString(entry.task07MediaEntryId) ===
      nestedTarget.entryId
  ));
  if (matches.length > 1 || crossKindConflict) {
    return {conflict: true, entry: null};
  }
  if (matches.length === 1) {
    return {conflict: false, entry: matches[0][1]};
  }
  const fallback = nestedTarget.kind === 'catalog-item-spell' ?
    data.General?.spells?.[nestedTarget.entryKey] :
    data[
      nestedTarget.kind === 'foe-technique' ? 'tecniche' : 'spells'
    ]?.[nestedTarget.entryIndex];
  if (!isRecord(fallback)) return {conflict: false, entry: null};
  const storedEntryId = asString(fallback.task07MediaEntryId);
  return {
    conflict: Boolean(storedEntryId && storedEntryId !== nestedTarget.entryId),
    entry: fallback,
  };
};

const bindingDataFor = (data, record) => (
  record?.nestedTarget ?
    embeddedBindingFor(data, record.nestedTarget) || {} :
    data
);

const previousAssetIdFromData = (data, kind, nestedTarget = null) => {
  const slot = targetSlotForKind(kind, nestedTarget);
  const binding = nestedTarget ? embeddedBindingFor(data, nestedTarget) || {} : data;
  const candidates = [
    binding?.[slot]?.assetId,
    !nestedTarget && slot === 'media' ? data?.General?.media?.assetId : null,
  ].map(asString).filter((value) => /^m_[a-f0-9]{40}$/.test(value));
  const unique = [...new Set(candidates)];
  return unique.length === 1 ? unique[0] : null;
};

const expectedRevisionFromData = (data, kind, nestedTarget = null) => {
  const field = revisionFieldForKind(kind);
  const binding = nestedTarget ? embeddedBindingFor(data, nestedTarget) || {} : data;
  return Number.isSafeInteger(binding?.[field]) && Number(binding[field]) >= 0 ?
    Number(binding[field]) :
    0;
};

const targetMediaFingerprint = (data, kind, record = {}) => {
  const nestedTarget = isRecord(record.nestedTarget) ? record.nestedTarget : null;
  if (nestedTarget) {
    const resolution = nestedEntryFor(data, nestedTarget);
    const entry = isRecord(resolution?.entry) ? resolution.entry : {};
    const binding = embeddedBindingFor(data, nestedTarget) || {};
    const slot = targetSlotForKind(kind, nestedTarget);
    const revisionField = revisionFieldForSlot(slot);
    const updatedAtField = updatedAtFieldForSlot(slot);
    return canonicalHash({
      nestedTarget,
      entryConflict: resolution?.conflict === true,
      sourcePaths: legacyPathsForKind(entry, kind),
      mediaReferenceDeclarations: mediaReferenceDeclarationsForKind(entry, kind),
      descriptorDeclarations: canonicalDescriptorSelection({
        kind,
        data: {[slot]: binding[slot]},
      }).declarations.map(({fieldPath, value}) => ({fieldPath, value})),
      previousAssetId: previousAssetIdFromData(data, kind, nestedTarget),
      expectedRevision: expectedRevisionFromData(data, kind, nestedTarget),
      updatedAt: binding[updatedAtField] ?? null,
      deletionState: data.deletionState ?? null,
      pendingDeletion: data.pendingDeletion === true,
      deleted: data.deleted === true,
      revisionField,
    });
  }
  return canonicalHash({
    targetSlot: targetSlotForKind(kind),
    sourcePaths: legacyPathsForKind(data, kind),
    mediaReferenceDeclarations: mediaReferenceDeclarationsForKind(data, kind),
    descriptorDeclarations: canonicalDescriptorSelection({kind, data})
      .declarations.map(({fieldPath, value}) => ({fieldPath, value})),
    previousAssetId: previousAssetIdFromData(data, kind),
    expectedRevision: expectedRevisionFromData(data, kind),
    assetType: ['map', 'map-video'].includes(kind) ?
      asString(data?.assetType) :
      null,
  });
};

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
    nestedTarget: input.nestedTarget || null,
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
      input.commonTechnique,
      input.nestedTarget
    ),
    audienceScope: audienceFor(
      input.kind,
      input.referenceScope,
      input.commonTechnique,
      input.nestedTarget
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
  canonicalAuditVersion: report.operation === 'canonical-audit' ?
    report.canonicalAuditVersion :
    undefined,
  projectId: report.projectId,
  storageBucket: report.storageBucket,
  sourceKeys: report.sourceKeys,
  catalogOwnerUid: report.catalogOwnerUid,
  expectedCandidates: report.expectedCandidates,
  mode: report.mode,
  complete: report.complete,
  scan: report.scan,
  counts: report.counts,
  scope: report.scope || null,
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
  scope = null,
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
    ...(operation === 'canonical-audit' ? {
      canonicalAuditVersion: CANONICAL_AUDIT_VERSION,
    } : {}),
    projectId,
    storageBucket,
    sourceKeys: [...sourceKeys],
    catalogOwnerUid,
    expectedCandidates,
    mode: 'dry-run',
    complete: Boolean(complete),
    scan,
    counts,
    ...(scope ? {scope} : {}),
    entries,
    excluded,
  };
  return {...report, planFingerprint: computePlanFingerprint(report)};
};

const declaredDescriptor = (container, key, fieldPath) => {
  if (!isRecord(container) || !hasOwn(container, key)) return null;
  const value = container[key];
  if (value === null || value === undefined || value === '') return null;
  return {fieldPath, value, validObject: isRecord(value)};
};

const canonicalDescriptorSelection = (record) => {
  const rootData = isRecord(record?.data) ? record.data : {};
  const data = isRecord(record?.nestedTarget) ?
    rawEmbeddedBindingFor(rootData, record.nestedTarget) || {} :
    isRecord(record?.mediaData) ? record.mediaData : rootData;
  const kind = asString(record?.kind);
  const videoRenderer = [
    'map-video', 'technique-video', 'spell-video',
  ].includes(kind);
  const primary = videoRenderer ? [
    declaredDescriptor(data, 'videoMedia', 'videoMedia'),
    declaredDescriptor(data.General, 'videoMedia', 'General.videoMedia'),
  ] : [
    declaredDescriptor(data, 'media', 'media'),
    declaredDescriptor(data.General, 'media', 'General.media'),
  ];
  const fallback = videoRenderer ? [
    declaredDescriptor(data, 'media', 'media'),
    declaredDescriptor(data.General, 'media', 'General.media'),
  ] : [];
  const primaryDeclarations = primary.filter(Boolean);
  const fallbackDeclarations = fallback.filter(Boolean);
  const primaryDescriptors = primaryDeclarations
    .filter(({validObject}) => validObject)
    .map(({value}) => value);
  const selectedDeclarations = videoRenderer &&
    !primaryDescriptors.length ? fallbackDeclarations : primaryDeclarations;
  const validatedDeclarations = videoRenderer &&
    !primaryDescriptors.length ?
    [...primaryDeclarations, ...fallbackDeclarations] :
    primaryDeclarations;
  const descriptors = selectedDeclarations
    .filter(({validObject}) => validObject)
    .map(({value}) => value);
  const declarations = [
    ...primaryDeclarations,
    ...fallbackDeclarations,
  ];
  const descriptor = descriptors[0] || null;
  const issues = [];
  validatedDeclarations.filter(({validObject}) => !validObject).forEach(() => {
    issues.push('canonical-descriptor-malformed');
  });
  if (new Set(descriptors.map(canonicalHash)).size > 1) {
    issues.push('canonical-descriptor-conflict');
  }
  return {declarations, descriptor, issues};
};

const canonicalDescriptorForRecord = (record) => (
  canonicalDescriptorSelection(record).descriptor
);

const canonicalBackfillTargetState = (record) => {
  const kind = asString(record?.kind);
  const rootData = isRecord(record?.data) ? record.data : {};
  const mediaData = isRecord(record?.mediaData) ? record.mediaData : rootData;
  const attached = canonicalDescriptorSelection(record);
  const direct = isRecord(record?.nestedTarget) ?
    canonicalDescriptorSelection({kind, data: mediaData}) : attached;
  const descriptor = attached.descriptor;
  const valid = attached.issues.length === 0 &&
    isRecord(descriptor) &&
    descriptor.schemaVersion === 1 &&
    /^m_[a-f0-9]{40}$/.test(asString(descriptor.assetId)) &&
    asString(descriptor.kind) === kind &&
    asString(descriptor.state) === 'ready';
  const invalid = attached.declarations.length > 0 && !valid;
  const directNested = isRecord(record?.nestedTarget) &&
    direct.declarations.length > 0;
  return {
    descriptor,
    valid,
    invalid: invalid || (!attached.declarations.length && directNested),
    directNested,
  };
};

const canonicalBackfillExclusion = ({
  record,
  sourceKey,
  kind,
  data,
  legacyPaths,
  descriptor,
}) => {
  const nestedTarget = isRecord(record.nestedTarget) ? record.nestedTarget : null;
  const core = {
    schemaVersion: 1,
    reason: 'already-canonical',
    sourceKey,
    kind,
    entityId: asString(record.entityId),
    ownerUid: asString(record.ownerUid),
    targetPath: asString(record.targetPath),
    targetVersion: asString(record.targetVersion),
    targetSlot: targetSlotForKind(kind, nestedTarget),
    nestedTarget,
    assetId: asString(descriptor?.assetId),
    descriptorFingerprint: canonicalHash(descriptor),
    targetFingerprint: targetMediaFingerprint(record.data, kind, record),
    legacyPaths: [...legacyPaths].sort(),
    legacyGeneralImageUrlProof: generalImageUrlProof(data, kind),
  };
  const exclusionHash = canonicalHash(core);
  return {
    exclusionId: `x_${exclusionHash.slice(0, 40)}`,
    ...core,
    exclusionHash,
  };
};

const canonicalAuditExclusion = (record, descriptor, legacyPaths) => {
  const sourceFoeProof = isRecord(record.sourceFoeProof) ?
    record.sourceFoeProof :
    null;
  const core = {
    schemaVersion: 1,
    reason: 'unplaced-foe-token-root',
    sourceKey: 'foe-tokens',
    kind: 'token',
    entityId: asString(record.entityId),
    ownerUid: asString(record.ownerUid),
    targetPath: asString(record.targetPath),
    targetVersion: asString(record.targetVersion),
    targetFingerprint: targetMediaFingerprint(record.data || {}, 'token'),
    placementReferenceCount: Number(record.placementReferenceCount),
    placementReferenceHash: asString(record.placementReferenceHash),
    sourceFoeProof,
    sourceFoeFingerprint: sourceFoeProof ?
      canonicalHash(sourceFoeProof) :
      '',
    canonicalAssetId: exactAttachedAssetId(record.data || {}, 'media'),
    canonicalDescriptorFingerprint: descriptor ?
      canonicalHash(descriptor) :
      null,
    legacyPaths: [...legacyPaths].sort(),
  };
  const exclusionHash = canonicalHash(core);
  return {
    exclusionId: `x_${exclusionHash.slice(0, 40)}`,
    ...core,
    exclusionHash,
  };
};

const validCanonicalAuditExclusion = (entry) => {
  if (!isRecord(entry)) return false;
  const {exclusionId, exclusionHash, ...core} = entry;
  return entry.schemaVersion === 1 &&
    entry.reason === 'unplaced-foe-token-root' &&
    entry.sourceKey === 'foe-tokens' &&
    entry.kind === 'token' &&
    asString(entry.entityId) !== '' &&
    entry.targetPath === `grigliata_tokens/${entry.entityId}` &&
    asString(entry.targetVersion) !== '' &&
    Number(entry.placementReferenceCount) === 0 &&
    /^[a-f0-9]{64}$/.test(asString(entry.placementReferenceHash)) &&
    entry.sourceFoeProof?.scanned === true &&
    typeof entry.sourceFoeProof?.exists === 'boolean' &&
    /^foes\/[^/]+$/.test(asString(
      entry.sourceFoeProof?.referencePath
    )) &&
    /^[a-f0-9]{64}$/.test(asString(
      entry.sourceFoeProof?.dataFingerprint
    )) &&
    /^[a-f0-9]{64}$/.test(asString(entry.sourceFoeFingerprint)) &&
    (entry.canonicalAssetId === null ||
      /^m_[a-f0-9]{40}$/.test(asString(entry.canonicalAssetId))) &&
    (entry.canonicalDescriptorFingerprint === null ||
      /^[a-f0-9]{64}$/.test(asString(
        entry.canonicalDescriptorFingerprint
      ))) &&
    Array.isArray(entry.legacyPaths) &&
    entry.legacyPaths.every((value) => asString(value) === value) &&
    /^[a-f0-9]{64}$/.test(asString(exclusionHash)) &&
    exclusionId === `x_${exclusionHash.slice(0, 40)}` &&
    canonicalHash(core) === exclusionHash;
};

const manifestProjectionForAudit = (data) => ({
  schemaVersion: data?.schemaVersion,
  policyVersion: data?.policyVersion,
  assetId: data?.assetId,
  generation: data?.generation,
  state: data?.state,
  purpose: data?.purpose,
  audience: data?.audience,
  ownerUid: data?.ownerUid,
  actorUid: data?.actorUid,
  targetKind: data?.targetKind,
  targetId: data?.targetId,
  previousAssetId: data?.previousAssetId ?? null,
  requestHash: data?.requestHash,
  plan: data?.plan,
  generated: data?.generated,
  attachment: isRecord(data?.attachment) ? {
    referencePath: data.attachment.referencePath,
    targetSlot: data.attachment.targetSlot,
    nestedTarget: data.attachment.nestedTarget ?? null,
    revision: data.attachment.revision,
  } : data?.attachment,
});

const expectedCanonicalMediaFromManifest = (manifest) => ({
  schemaVersion: 1,
  contractVersion: mediaPolicy.policyVersion,
  assetId: manifest.assetId,
  kind: manifest.purpose,
  state: 'ready',
  generation: manifest.generated?.generation,
  audience: manifest.audience,
  ownerUid: manifest.ownerUid,
  original: manifest.generated?.original,
  variants: manifest.generated?.variants,
  processing: {
    authoritative: true,
    fallbackCode: null,
  },
});

const CANONICAL_OBJECT_DESCRIPTOR_FIELDS = Object.freeze([
  'bytes',
  'cacheControl',
  'checksum',
  'contentType',
  'durationMs',
  'generation',
  'height',
  'orientationDegrees',
  'path',
  'role',
  'width',
].sort());
const CANONICAL_OBJECT_METADATA_FIELDS = Object.freeze([
  'task07AssetId',
  'task07Checksum',
  'task07ContractVersion',
  'task07EntityId',
  'task07Kind',
  'task07OwnerUid',
  'task07Role',
].sort());
const VALID_ORIENTATIONS = new Set([0, 90, 180, 270]);

const plannedCanonicalVariantDimensions = (source, contract) => {
  if (!Number.isSafeInteger(source?.width) || source.width <= 0 ||
    !Number.isSafeInteger(source?.height) || source.height <= 0) return null;
  if (contract.fit === 'cover') {
    return {
      width: Math.min(source.width, contract.width),
      height: Math.min(source.height, contract.height),
    };
  }
  const scale = Math.min(
    contract.width / source.width,
    contract.height / source.height,
    1
  );
  return {
    width: Math.max(1, Math.round(source.width * scale)),
    height: Math.max(1, Math.round(source.height * scale)),
  };
};

const canonicalObjectPolicyIssues = ({descriptor, kind, role, source}) => {
  const issues = [];
  const contract = mediaPolicy.purposes[kind];
  if (!contract || !isRecord(descriptor)) {
    return ['canonical-object-policy-mismatch'];
  }
  if (canonicalHash(Object.keys(descriptor).sort()) !==
    canonicalHash(CANONICAL_OBJECT_DESCRIPTOR_FIELDS) ||
    descriptor.role !== role ||
    !/^[1-9][0-9]*$/.test(asString(descriptor.generation)) ||
    !Number.isSafeInteger(descriptor.bytes) || descriptor.bytes <= 0 ||
    !/^[a-f0-9]{64}$/.test(asString(descriptor.checksum)) ||
    descriptor.cacheControl !== mediaPolicy.privateCacheControl ||
    !VALID_ORIENTATIONS.has(descriptor.orientationDegrees)) {
    issues.push('canonical-object-policy-mismatch');
  }
  const contentType = normalizeContentType(descriptor.contentType);
  if (role === 'original') {
    if (!contract.contentTypes.includes(contentType) ||
      descriptor.bytes > contract.maxBytes) {
      issues.push('canonical-original-policy-mismatch');
    }
    if (contract.mediaType === 'audio') {
      if (!Number.isSafeInteger(descriptor.width) || descriptor.width < 0 ||
        !Number.isSafeInteger(descriptor.height) || descriptor.height < 0) {
        issues.push('canonical-original-policy-mismatch');
      }
    } else if (!Number.isSafeInteger(descriptor.width) ||
      descriptor.width <= 0 || !Number.isSafeInteger(descriptor.height) ||
      descriptor.height <= 0 ||
      (contract.maxWidth !== null && descriptor.width > contract.maxWidth) ||
      (contract.maxHeight !== null && descriptor.height > contract.maxHeight) ||
      (contract.maxPixels !== null &&
        descriptor.width * descriptor.height > contract.maxPixels)) {
      issues.push('canonical-original-policy-mismatch');
    }
    if (contract.mediaType === 'image') {
      if (descriptor.durationMs !== null) {
        issues.push('canonical-original-policy-mismatch');
      }
    } else if (!Number.isSafeInteger(descriptor.durationMs) ||
      descriptor.durationMs <= 0 ||
      (contract.maxDurationMs !== null &&
        descriptor.durationMs > contract.maxDurationMs)) {
      issues.push('canonical-original-policy-mismatch');
    }
  } else {
    const variant = contract.variants?.[role];
    const expectedDimensions = variant ?
      plannedCanonicalVariantDimensions(source, variant) :
      null;
    if (!variant || contentType !== 'image/webp' ||
      descriptor.bytes > (variant?.maxBytes ?? 0) ||
      descriptor.durationMs !== null || descriptor.orientationDegrees !== 0 ||
      !expectedDimensions || descriptor.width !== expectedDimensions.width ||
      descriptor.height !== expectedDimensions.height) {
      issues.push('canonical-variant-policy-mismatch');
    }
  }
  return [...new Set(issues)];
};

const canonicalObjectIssues = ({
  descriptor,
  inspection,
  assetId,
  ownerUid,
  entityId,
  kind,
  audience,
  sourceGeneration,
  role,
  source,
}) => {
  if (!isRecord(descriptor) || !isRecord(inspection) ||
    inspection.exists !== true) return ['canonical-object-missing'];
  const issues = canonicalObjectPolicyIssues({
    descriptor,
    kind,
    role,
    source,
  });
  const expectedSuffix = role === 'original' ? 'original' : role;
  const expectedPath = `media_assets/v1/${audience}/${ownerUid}/` +
    `${assetId}/${sourceGeneration}/${expectedSuffix}`;
  const metadata = isRecord(inspection.customMetadata) ?
    inspection.customMetadata :
    {};
  const expectedMetadata = {
    task07AssetId: assetId,
    task07Checksum: asString(descriptor.checksum),
    task07ContractVersion: String(mediaPolicy.policyVersion),
    task07EntityId: entityId,
    task07Kind: kind,
    task07OwnerUid: ownerUid,
    task07Role: role,
  };
  if (descriptor.path !== expectedPath || inspection.path !== expectedPath ||
    String(descriptor.generation || '') !==
      String(inspection.generation || '') ||
    normalizeContentType(descriptor.contentType) !==
      normalizeContentType(inspection.contentType) ||
    Number(descriptor.bytes) !== Number(inspection.bytes) ||
    asString(descriptor.cacheControl) !== mediaPolicy.privateCacheControl ||
    asString(inspection.cacheControl) !== mediaPolicy.privateCacheControl ||
    asString(inspection.contentDisposition) !== 'inline' ||
    canonicalHash(Object.keys(metadata).sort()) !==
      canonicalHash(CANONICAL_OBJECT_METADATA_FIELDS) ||
    Object.entries(expectedMetadata).some(([key, value]) => (
      metadata[key] !== value
    ))) {
    issues.push('canonical-object-contract-mismatch');
  }
  if (asString(inspection.sha256) !== asString(descriptor.checksum)) {
    issues.push('canonical-object-checksum-mismatch');
  }
  return [...new Set(issues)];
};

const validatedStoredTask07Plan = (value) => {
  try {
    return loadCompiledTask07Contracts()
      .core.asStoredTask07MediaUploadPlan(value);
  } catch {
    return null;
  }
};

const storedTask07PlanMatchesRebuild = (stored, rebuilt) => (
  isRecord(stored) && isRecord(rebuilt) &&
  canonicalHash({...stored, commonTechnique: stored.commonTechnique === true}) ===
    canonicalHash({...rebuilt, commonTechnique: rebuilt.commonTechnique === true})
);

const buildCanonicalMediaAudit = async (
  records,
  {
    projectId = DEMO_PROJECT_ID,
    storageBucket = `${projectId}.appspot.com`,
    sourceKeys = SOURCE_KEYS,
    catalogOwnerUid = '',
    expectedCandidates = null,
    inspectCanonicalRecord = async () => ({
      manifest: {exists: false, version: '', data: null},
      objects: [],
      legacyObjects: [],
    }),
    readOwner = async () => null,
    scan = {complete: true, pageSize: DEFAULT_PAGE_SIZE, maxPages: 1},
  } = {}
) => {
  const entries = [];
  const excluded = [];
  const seenTargets = new Set();
  const ownerCache = new Map();
  const storageContext = {
    expectedBucket: storageBucket,
    allowLoopback: projectId === DEMO_PROJECT_ID,
  };
  for (const record of records) {
    const kind = asString(record.kind);
    const sourceKey = sourceKeyForRecord(record);
    const entityId = asString(record.entityId);
    if (!SUPPORTED_KINDS.has(kind) || !SOURCE_KEY_SET.has(sourceKey) ||
      !sourceKeys.includes(sourceKey) || !entityId) continue;
    const rootData = isRecord(record.data) ? record.data : {};
    const data = isRecord(record.mediaData) ? record.mediaData : rootData;
    const commonTechnique = commonTechniqueForRecord(record);
    const referenceScope = referenceScopeFor(record);
    const targetPath = asString(record.targetPath);
    const nestedTarget = isRecord(record.nestedTarget) ? record.nestedTarget : null;
    const targetSlot = targetSlotForKind(kind, nestedTarget);
    const descriptorSelection = canonicalDescriptorSelection(record);
    const descriptor = descriptorSelection.descriptor;
    const directNestedDescriptorSelection = nestedTarget ?
      canonicalDescriptorSelection({kind, data}) :
      {declarations: [], descriptor: null, issues: []};
    const mediaReferenceDeclarations = mediaReferenceDeclarationsForKind(
      data,
      kind,
      storageContext
    );
    const mediaReferencePaths = [...new Set(mediaReferenceDeclarations
      .map(({storagePath}) => storagePath)
      .filter(Boolean))].sort();
    const legacyPaths = mediaReferencePaths
      .filter((value) => !isCanonicalTask07Path(value));
    const videoSlot = ['technique-video', 'spell-video'].includes(kind);
    const hasVideoDescriptor = descriptorSelection.declarations.some(
      ({fieldPath}) => ['videoMedia', 'General.videoMedia'].includes(fieldPath)
    );
    const hasExplicitVideoReference = mediaReferenceDeclarations.some(
      ({fieldPath}) => /(?:^|\.)(?:videoUrl|video_url)$/.test(fieldPath)
    );
    const fallbackMediaDeclarations = descriptorSelection.declarations
      .filter(({fieldPath}) => ['media', 'General.media'].includes(fieldPath));
    const fallbackDeclaresVideo = fallbackMediaDeclarations.some(({value}) => (
      asString(value?.kind).endsWith('-video') ||
      normalizeContentType(value?.contentType).startsWith('video/') ||
      normalizeContentType(value?.original?.contentType).startsWith('video/')
    ));
    const hasGenericVideoReference = mediaReferenceDeclarations.some(
      ({fieldPath}) => (
        /(?:^|\.)(?:url|downloadUrl|imageUrl|image_url)$/.test(fieldPath)
      )
    ) && (!fallbackMediaDeclarations.length || fallbackDeclaresVideo);
    const hasMedia = videoSlot ?
      Boolean(
        hasVideoDescriptor || hasExplicitVideoReference ||
        hasGenericVideoReference || fallbackDeclaresVideo
      ) :
      Boolean(
        descriptorSelection.declarations.length ||
        directNestedDescriptorSelection.declarations.length ||
        mediaReferenceDeclarations.length
      );
    if (!hasMedia) continue;
    if (sourceKey === 'foe-tokens' &&
      Number(record.placementReferenceCount) === 0) {
      excluded.push(canonicalAuditExclusion(
        record,
        descriptor,
        legacyPaths
      ));
      continue;
    }
    const targetIdentity = [
      targetPath,
      entityId,
      nestedTarget?.kind || '',
      nestedTarget?.entryId || '',
      targetSlot,
    ].join('\u0000');
    if (seenTargets.has(targetIdentity)) continue;
    seenTargets.add(targetIdentity);
    const inspection = await inspectCanonicalRecord(record);
    const manifest = isRecord(inspection?.manifest) ?
      inspection.manifest :
      {exists: false, version: '', data: null};
    const manifestData = isRecord(manifest.data) ? manifest.data : {};
    const assetId = descriptor ? asString(descriptor.assetId) : '';
    const targetVersion = asString(record.targetVersion);
    const targetRevision = expectedRevisionFromData(rootData, kind, nestedTarget);
    const expectedTargetKind = targetKindFor(
      kind,
      referenceScope,
      commonTechnique,
      nestedTarget
    );
    const expectedAudience = audienceFor(
      kind,
      referenceScope,
      commonTechnique,
      nestedTarget
    );
    const ownerResolution = canonicalAuditOwner({
      record,
      sourceKey,
      targetPath,
      entityId,
      catalogOwnerUid,
      attachedOwnerUid: manifestData.ownerUid,
    });
    const ownerUid = ownerResolution.ownerUid;
    if (!ownerCache.has(ownerUid)) {
      ownerCache.set(ownerUid, ownerUid ? await readOwner(ownerUid) : null);
    }
    const owner = ownerCache.get(ownerUid);
    const ownerRole = asString(owner?.role).toLowerCase();
    const ownerVersion = asString(owner?.version);
    const expectedTargetPath = targetPathFor(
      kind,
      ownerUid,
      entityId,
      referenceScope,
      commonTechnique,
      nestedTarget
    );
    const issues = [
      ...descriptorSelection.issues.map((code) => issue(code)),
      ...ownerResolution.issues.map((code) => issue(code)),
    ];
    if (nestedTarget) {
      if (!descriptorSelection.declarations.length &&
        directNestedDescriptorSelection.declarations.length) {
        issues.push(issue('nested-canonical-descriptor-outside-registry'));
      }
      const nestedResolution = nestedEntryFor(rootData, nestedTarget);
      if (!isRecord(nestedResolution?.entry) ||
        nestedResolution?.conflict === true) {
        issues.push(issue('canonical-nested-target-conflict'));
      }
      const rawBinding = rootData?.task07EmbeddedMedia?.[
        nestedTarget.entryId
      ];
      if (isRecord(rawBinding) && rawBinding.targetKind !== nestedTarget.kind) {
        issues.push(issue('canonical-nested-binding-kind-mismatch'));
      }
    }
    if (mediaReferenceDeclarations.some(({storagePath}) => !storagePath)) {
      issues.push(issue('media-reference-unclassifiable'));
    }
    if (!descriptor) issues.push(issue('canonical-descriptor-missing'));
    if (!targetPath || !targetVersion) {
      issues.push(issue('canonical-target-binding-missing'));
    }
    if (!expectedTargetPath || targetPath !== expectedTargetPath) {
      issues.push(issue('canonical-target-identity-mismatch'));
    }
    if (descriptor && asString(descriptor.ownerUid) !== ownerUid) {
      issues.push(issue('canonical-owner-binding-mismatch'));
    }
    if (ownerUid && (!owner?.exists || owner?.deletionState === 'pending')) {
      issues.push(issue('owner-not-active'));
    }
    if (ownerUid && owner?.exists &&
      !roleAuthorizes(kind, referenceScope, ownerRole, nestedTarget)) {
      issues.push(issue('owner-role-not-authorized'));
    }
    if (ownerResolution.ownerResolution === 'verified-global-fallback' &&
      ownerRole !== 'webmaster') {
      issues.push(issue('fallback-owner-not-webmaster'));
    }
    if (rootData.deletionState === 'pending' ||
      rootData.pendingDeletion === true || rootData.deleted === true) {
      issues.push(issue('target-unavailable'));
    }
    if (!/^m_[a-f0-9]{40}$/.test(assetId) || targetRevision < 1) {
      issues.push(issue('canonical-target-contract-mismatch'));
    }
    const plan = isRecord(manifestData.plan) ? manifestData.plan : {};
    const validatedPlan = validatedStoredTask07Plan(plan);
    const attachment = isRecord(manifestData.attachment) ?
      manifestData.attachment :
      {};
    if (manifest.exists !== true || !asString(manifest.version)) {
      issues.push(issue('canonical-manifest-missing'));
    } else if (manifestData.schemaVersion !== 1 ||
      manifestData.policyVersion !== mediaPolicy.policyVersion ||
      manifestData.assetId !== assetId ||
      manifestData.state !== 'attached' ||
      manifestData.purpose !== kind ||
      manifestData.audience !== expectedAudience ||
      manifestData.ownerUid !== ownerUid ||
      manifestData.targetKind !== expectedTargetKind ||
      manifestData.targetId !== entityId ||
      manifestData.actorUid !== plan.actorUid ||
      manifestData.requestHash !== plan.requestHash ||
      (manifestData.previousAssetId ?? null) !==
        (plan.previousAssetId ?? null) ||
      !validatedPlan || !storedTask07PlanMatchesRebuild(plan, validatedPlan) ||
      plan.schemaVersion !== 1 ||
      plan.contractVersion !== mediaPolicy.policyVersion ||
      plan.policyVersion !== mediaPolicy.policyVersion ||
      plan.assetId !== assetId ||
      plan.kind !== kind ||
      plan.targetKind !== expectedTargetKind ||
      plan.ownerUid !== ownerUid ||
      plan.ownerKey !== ownerUid ||
      plan.entityId !== entityId ||
      Boolean(plan.commonTechnique) !== commonTechnique ||
      !nestedTargetBindingMatches(plan.nestedTarget, nestedTarget) ||
      (plan.referenceScope ?? null) !== referenceScope ||
      plan.audienceScope !== expectedAudience ||
      attachment.referencePath !== targetPath ||
      attachment.targetSlot !== targetSlot ||
      !nestedTargetBindingMatches(attachment.nestedTarget, nestedTarget) ||
      Number(attachment.revision) !== targetRevision) {
      issues.push(issue('canonical-manifest-contract-mismatch'));
    }
    const generated = isRecord(manifestData.generated) ?
      manifestData.generated :
      {};
    if (asString(manifestData.generation) !==
      asString(generated.generation)) {
      issues.push(issue('canonical-manifest-contract-mismatch'));
    }
    const expectedVariants = Object.keys(
      mediaPolicy.purposes[kind]?.variants || {}
    ).sort();
    const actualVariants = isRecord(generated.variants) ?
      Object.keys(generated.variants).sort() :
      [];
    if (!/^[1-9][0-9]*$/.test(asString(generated.generation)) ||
      !isRecord(generated.original) ||
      canonicalHash(actualVariants) !== canonicalHash(expectedVariants) ||
      !descriptor || canonicalHash(descriptor) !== canonicalHash(
        expectedCanonicalMediaFromManifest(manifestData)
      )) {
      issues.push(issue('canonical-generated-contract-mismatch'));
    }
    const inspectedObjects = new Map(
      (Array.isArray(inspection?.objects) ? inspection.objects : [])
        .map((object) => [asString(object?.path), object])
    );
    const generatedObjects = [
      ['original', generated.original],
      ...expectedVariants.map((variant) => [
        variant,
        generated.variants?.[variant],
      ]),
    ];
    const objectProofs = generatedObjects.map(([role, object]) => {
      const objectInspection = inspectedObjects.get(asString(object?.path));
      const objectIssues = canonicalObjectIssues({
        descriptor: object,
        inspection: objectInspection,
        assetId,
        ownerUid,
        entityId,
        kind,
        audience: expectedAudience,
        sourceGeneration: asString(generated.generation),
        role,
        source: generated.original,
      });
      objectIssues.forEach((code) => issues.push(issue(code)));
      return {
        role,
        path: asString(object?.path),
        descriptorFingerprint: canonicalHash(object ?? null),
        objectFingerprint: canonicalHash(objectInspection ?? null),
        validationErrors: objectIssues,
        verified: objectIssues.length === 0,
      };
    });
    const inspectedLegacy = new Map(
      (Array.isArray(inspection?.legacyObjects) ?
        inspection.legacyObjects : [])
        .map((object) => [asString(object?.path), object])
    );
    const legacySources = legacyPaths.sort().map((legacyPath) => {
      const normalized = normalizeSourceObject(
        legacyPath,
        inspectedLegacy.get(legacyPath)
      );
      if (!normalized.exists ||
        !Number.isSafeInteger(normalized.bytes) || normalized.bytes <= 0 ||
        !/^[1-9][0-9]*$/.test(normalized.generation)) {
        issues.push(issue('legacy-source-object-missing'));
      }
      return {
        ...normalized,
        fingerprint: sourceObjectFingerprint(normalized),
      };
    });
    const sourceFoeProof = isRecord(record.sourceFoeProof) ?
      record.sourceFoeProof :
      null;
    if (sourceKey === 'foe-tokens' && (
      !Number.isSafeInteger(Number(record.placementReferenceCount)) ||
      Number(record.placementReferenceCount) < 1 ||
      !/^[a-f0-9]{64}$/.test(asString(
        record.placementReferenceHash
      )) || sourceFoeProof?.scanned !== true ||
      !/^foes\/[^/]+$/.test(asString(sourceFoeProof?.referencePath)) ||
      !/^[a-f0-9]{64}$/.test(asString(
        sourceFoeProof?.dataFingerprint
      )))) {
      issues.push(issue('foe-token-relationship-proof-missing'));
    }
    const manifestProjection = manifestProjectionForAudit(manifestData);
    const core = {
      sourceKey,
      kind,
      commonTechnique,
      nestedTarget,
      referenceScope,
      entityId,
      ownerUid,
      ownerResolution: ownerResolution.ownerResolution,
      ownerRole,
      ownerVersion,
      targetPath,
      targetVersion,
      targetSlot,
      targetRevision,
      targetFingerprint: targetMediaFingerprint(rootData, kind, record),
      assetId,
      manifestPath: assetId ? `media_assets/${assetId}` : '',
      manifestVersion: asString(manifest.version),
      manifestFingerprint: canonicalHash(manifestProjection),
      descriptorFingerprint: canonicalHash(descriptor ?? null),
      objectProofs,
      legacySources,
      placementReferenceCount: sourceKey === 'foe-tokens' ?
        Number(record.placementReferenceCount) :
        null,
      placementReferenceHash: sourceKey === 'foe-tokens' ?
        asString(record.placementReferenceHash) :
        null,
      sourceFoeFingerprint: sourceKey === 'foe-tokens' ?
        canonicalHash(sourceFoeProof) :
        null,
    };
    const auditHash = canonicalHash(core);
    entries.push({
      auditId: `a_${auditHash.slice(0, 40)}`,
      ...core,
      auditHash,
      status: issues.length ? 'blocked' : 'verified',
      issues,
    });
  }
  entries.sort((left, right) => (
    left.targetPath.localeCompare(right.targetPath) ||
    left.entityId.localeCompare(right.entityId) ||
    left.targetSlot.localeCompare(right.targetSlot)
  ));
  excluded.sort((left, right) => (
    left.targetPath.localeCompare(right.targetPath) ||
    left.entityId.localeCompare(right.entityId)
  ));
  return finalizeReport({
    operation: 'canonical-audit',
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
  const invalidMediaReferences = new Set();
  const storageContext = {
    expectedBucket: storageBucket,
    allowLoopback: projectId === DEMO_PROJECT_ID,
  };
  for (const record of records) {
    const kind = asString(record.kind);
    const sourceKey = sourceKeyForRecord(record);
    const commonTechnique = commonTechniqueForRecord(record);
    const entityId = asString(record.entityId);
    if (!SUPPORTED_KINDS.has(kind) || !SOURCE_KEY_SET.has(sourceKey) ||
      !sourceKeys.includes(sourceKey) || !entityId) continue;
    const rootData = isRecord(record.data) ? record.data : {};
    const data = isRecord(record.mediaData) ? record.mediaData : rootData;
    const nestedTarget = isRecord(record.nestedTarget) ? record.nestedTarget : null;
    const referenceScope = referenceScopeFor(record);
    const mediaReferenceDeclarations = mediaReferenceDeclarationsForKind(
      data,
      kind,
      storageContext
    );
    mediaReferenceDeclarations
      .filter(({storagePath}) => !storagePath)
      .forEach(({fieldPath, value}) => invalidMediaReferences.add(
        canonicalHash({sourceKey, entityId, kind, fieldPath, value})
      ));
    const candidatePaths = legacyPathsForKind(data, kind, storageContext)
      .filter((sourcePath) => !isCanonicalTask07Path(sourcePath));
    const canonicalState = canonicalBackfillTargetState(record);
    if (candidatePaths.length && canonicalState.valid) {
      excluded.push(canonicalBackfillExclusion({
        record,
        sourceKey,
        kind,
        data,
        legacyPaths: candidatePaths,
        descriptor: canonicalState.descriptor,
      }));
      continue;
    }
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
          commonTechnique,
          nestedTarget
        );
      const dedupeKey = [
        kind, referenceScope, targetPath, entityId,
        nestedTarget?.entryId || '', nestedTarget?.slot || '', sourcePath,
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
          targetFingerprint: targetMediaFingerprint(rootData, kind, record),
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
      if (canonicalState.invalid) {
        issues.push(issue(canonicalState.directNested ?
          'nested-canonical-descriptor-outside-registry' :
          'existing-canonical-descriptor-invalid'));
      }
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
        !roleAuthorizes(kind, referenceScope, role, nestedTarget)) {
        issues.push(issue('owner-role-not-authorized'));
      }
      if (ownerResolution === 'verified-global-fallback' &&
        role !== 'webmaster') {
        issues.push(issue('fallback-owner-not-webmaster'));
      }
      if (!targetPath) issues.push(issue('unsupported-target'));
      if (rootData.deletionState === 'pending' ||
        rootData.pendingDeletion === true ||
        rootData.deleted === true) {
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
          nestedTarget,
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
        nestedTarget,
        referenceScope,
        ownerUid,
        entityId,
        targetPath,
        targetVersion: asString(record.targetVersion),
        targetFingerprint: targetMediaFingerprint(rootData, kind, record),
        targetSlot: targetSlotForKind(kind, nestedTarget),
        expectedRevision: expectedRevisionFromData(rootData, kind, nestedTarget),
        previousAssetId: previousAssetIdFromData(rootData, kind, nestedTarget),
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
        nestedTarget,
        referenceScope,
        ownerUid,
        ownerResolution,
        entityId,
        targetPath,
        targetVersion: asString(record.targetVersion),
        targetFingerprint: targetMediaFingerprint(rootData, kind, record),
        targetSlot: targetSlotForKind(kind, nestedTarget),
        expectedRevision: expectedRevisionFromData(rootData, kind, nestedTarget),
        previousAssetId: previousAssetIdFromData(rootData, kind, nestedTarget),
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
      entry.nestedTarget?.entryId || '',
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
      entry.nestedTarget?.entryId || '',
      entry.targetSlot,
    ].join('\u0000');
    if (pathsByTarget.get(targetSlotKey).size <= 1) return;
    entry.issues.push(issue('ambiguous-legacy-media-reference'));
    entry.status = 'blocked';
  });
  excluded.sort((left, right) => (
    left.targetPath.localeCompare(right.targetPath) ||
    asString(left.sourcePath).localeCompare(asString(right.sourcePath)) ||
    left.exclusionId.localeCompare(right.exclusionId)
  ));
  entries.sort((left, right) => (
    left.targetPath.localeCompare(right.targetPath) ||
    left.sourcePath.localeCompare(right.sourcePath) ||
    left.receiptId.localeCompare(right.receiptId)
  ));
  const effectiveScan = {
    ...scan,
    complete: scan.complete === true && invalidMediaReferences.size === 0,
    invalidMediaReferences: invalidMediaReferences.size,
  };
  return finalizeReport({
    operation: 'backfill',
    projectId,
    storageBucket,
    sourceKeys,
    catalogOwnerUid,
    expectedCandidates,
    complete: effectiveScan.complete,
    scan: effectiveScan,
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
      const rootRecordCount = Number(page?.rootRecordCount ?? page?.records?.length);
      const expandedLimit = Math.max(1, rootRecordCount) *
        MAX_EXPANDED_MEDIA_RECORDS_PER_ROOT;
      if (!isRecord(page) || !Array.isArray(page.records) ||
        !Number.isSafeInteger(rootRecordCount) || rootRecordCount < 0 ||
        rootRecordCount > pageSize || page.records.length > expandedLimit) {
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
  approvedBackfillReport = null,
}) => {
  if (!['verify', 'rollback'].includes(operation)) {
    throw new TypeError('Receipt plans support only verify or rollback.');
  }
  let scope = null;
  let approvedEntriesById = null;
  let loaded;
  if (approvedBackfillReport) {
    assertApprovedBackfillScope(approvedBackfillReport, {
      projectId,
      storageBucket,
      sourceKeys,
      catalogOwnerUid,
      expectedCandidates,
    });
    const approvedEntries = approvedBackfillReport.entries;
    if (approvedEntries.length > MAX_PAGE_SIZE * MAX_MAX_PAGES ||
      typeof backend.readReceiptsByIds !== 'function') {
      throw new Error('Approved receipt verification scope is not bounded.');
    }
    const receiptIds = approvedEntries.map(({receiptId}) => asString(receiptId));
    approvedEntriesById = new Map(
      approvedEntries.map((entry) => [asString(entry.receiptId), entry])
    );
    const found = await backend.readReceiptsByIds(receiptIds);
    const foundById = new Map(found.map((receipt) => [
      asString(receipt.receiptId || receipt.id),
      receipt,
    ]));
    loaded = {
      records: receiptIds.map((receiptId) => (
        foundById.get(receiptId) || {
          ...approvedEntriesById.get(receiptId),
          id: receiptId,
          receiptId,
          __receiptMissing: true,
        }
      )),
      scan: {
        complete: true,
        pageSize,
        maxPages,
        concurrency: MIGRATION_CONCURRENCY,
        pagesBySource: {
          approvedBackfillReceipts: Math.ceil(receiptIds.length / pageSize),
        },
        truncatedSources: [],
      },
    };
    scope = {
      schemaVersion: 1,
      type: 'approved-backfill-plan',
      planFingerprint: approvedBackfillReport.planFingerprint,
      receiptIdsHash: canonicalHash(receiptIds),
      expectedReceipts: receiptIds.length,
    };
  } else {
    loaded = await loadPaged({
      sourceKeys: ['receipts'],
      readPage: backend.readReceiptPage,
      pageSize,
      maxPages,
    });
  }
  const entries = [];
  const receipts = exactSourceKeys(sourceKeys) ?
    loaded.records :
    loaded.records.filter((receipt) => (
      sourceKeys.includes(sourceKeyForReceipt(receipt))
    ));
  for (const receipt of receipts) {
    const receiptId = asString(receipt.receiptId || receipt.id);
    const sourceKey = sourceKeyForReceipt(receipt);
    const inspection = receipt.__receiptMissing === true ? {} :
      await backend.inspectReceipt(receipt);
    const issues = [];
    const approvedEntry = approvedEntriesById?.get(receiptId) || null;
    if (receipt.__receiptMissing === true) {
      issues.push(issue('receipt-missing'));
    }
    if (scope && receipt.__receiptMissing !== true && (
      receipt.approvedPlanFingerprint !== scope.planFingerprint ||
      !approvedEntry ||
      receipt.subjectHash !== approvedEntry.subjectHash ||
      receipt.assetId !== approvedEntry.assetId ||
      receipt.targetPath !== approvedEntry.targetPath ||
      receipt.targetSlot !== approvedEntry.targetSlot
    )) {
      issues.push(issue('receipt-approved-plan-mismatch'));
    }
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
      (receipt.nestedTarget && inspection.nestedEntryPresent !== true) ||
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
      (receipt.nestedTarget && inspection.nestedEntryPresent !== true) ||
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
      nestedTarget: isRecord(receipt.nestedTarget) ?
        receipt.nestedTarget : null,
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
        ...(receipt.nestedTarget ? {
          nestedEntryPresent: inspection.nestedEntryPresent === true,
        } : {}),
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
    scope,
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
  approvedBackfillReport = null,
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
  if (operation === 'canonical-audit') {
    const loaded = await loadLegacyMediaRecords(backend, {
      pageSize,
      maxPages,
      sourceKeys,
    });
    return buildCanonicalMediaAudit(loaded.records, {
      projectId,
      storageBucket,
      sourceKeys,
      catalogOwnerUid,
      expectedCandidates,
      scan: loaded.scan,
      inspectCanonicalRecord: backend.inspectCanonicalRecord,
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
    approvedBackfillReport,
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
    approvedBackfillReportPath: '',
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
      '--environment',
      '--site',
      '--bucket',
      '--auth',
      '--confirm-project',
      '--source',
      '--catalog-owner-uid',
      '--confirm-catalog-owner-uid',
      '--expected-candidates',
      '--approve-fingerprint',
      '--report',
      '--checkpoint',
      '--approved-backfill-report',
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
      if (argument === '--environment') options.environmentName = value;
      if (argument === '--site') options.hostingSite = value;
      if (argument === '--bucket') options.storageBucket = value;
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
      if (argument === '--approved-backfill-report') {
        options.approvedBackfillReportPath = path.resolve(value);
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
  if (['verify', 'canonical-audit'].includes(options.operation) &&
    options.execute) {
    throw new TypeError(
      `${options.operation} is always read-only.`
    );
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
  if (options.approvedBackfillReportPath && options.operation !== 'verify') {
    throw new TypeError(
      '--approved-backfill-report is supported only with --operation verify.'
    );
  }
  if (options.operation === 'verify' &&
    options.projectId === PRODUCTION_PROJECT_ID &&
    !options.approvedBackfillReportPath) {
    throw new TypeError(
      'Live receipt verification requires --approved-backfill-report.'
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

const validAlreadyCanonicalExclusion = (entry) => {
  if (!isRecord(entry)) return false;
  const {exclusionId, exclusionHash, ...core} = entry;
  return entry.schemaVersion === 1 &&
    entry.reason === 'already-canonical' &&
    SOURCE_KEY_SET.has(entry.sourceKey) &&
    SUPPORTED_KINDS.has(entry.kind) &&
    asString(entry.entityId) !== '' &&
    asString(entry.targetPath) !== '' &&
    asString(entry.targetVersion) !== '' &&
    ['media', 'videoMedia'].includes(entry.targetSlot) &&
    /^m_[a-f0-9]{40}$/.test(asString(entry.assetId)) &&
    /^[a-f0-9]{64}$/.test(asString(entry.descriptorFingerprint)) &&
    /^[a-f0-9]{64}$/.test(asString(entry.targetFingerprint)) &&
    Array.isArray(entry.legacyPaths) && entry.legacyPaths.length > 0 &&
    entry.legacyPaths.every((value) => (
      asString(value) && !isCanonicalTask07Path(value)
    )) &&
    /^[a-f0-9]{64}$/.test(asString(exclusionHash)) &&
    exclusionId === `x_${exclusionHash.slice(0, 40)}` &&
    canonicalHash(core) === exclusionHash;
};

const validBackfillExclusion = (entry) => (
  validFoeTokenExclusion(entry) || validAlreadyCanonicalExclusion(entry)
);

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
    !report.excluded.every(validBackfillExclusion) ||
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
      entry.reason === 'unplaced-foe-token-root' ?
        entry.sourceKey !== 'foe-tokens' :
        entry.reason !== 'already-canonical'
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

const assertApprovedBackfillScope = (report, options) => {
  if (!isRecord(report) || report.operation !== 'backfill' ||
    !Number.isSafeInteger(report.expectedCandidates) ||
    report.expectedCandidates < 0 ||
    report.expectedCandidates !== options.expectedCandidates) {
    throw new Error(
      'Receipt verification requires the exact count-bound backfill plan.'
    );
  }
  return assertApprovedReport(report, {
    operation: 'backfill',
    projectId: options.projectId,
    sourceKeys: options.sourceKeys,
    catalogOwnerUid: options.catalogOwnerUid,
    expectedCandidates: options.expectedCandidates,
    approveFingerprint: report.planFingerprint,
  });
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
      data,
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
      data,
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
      data,
    };
  }
  if (sourceKey === 'backgrounds') {
    return {
      kind: data.assetType === 'video' ||
        normalizeContentType(data.contentType).startsWith('video/') ||
        declaresRendererVideoMedia(data) ?
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
      data,
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

const restoreCompatibilityFieldsIntoData = (current, beforeFields) => {
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

const backfillTargetFenceIssue = ({
  targetExists,
  targetAvailable,
  targetFingerprintMatches,
  legacyReferenceMatches,
  legacyGeneralImageUrlMatches,
  previousAssetMatches,
}) => {
  if (!targetExists || !targetFingerprintMatches) {
    return 'Media target changed after planning. Re-plan.';
  }
  if (!targetAvailable) return 'Media target is no longer available.';
  if (!legacyReferenceMatches) {
    return 'Legacy media reference changed after planning.';
  }
  if (!legacyGeneralImageUrlMatches) {
    return 'Legacy General.image_url changed after planning.';
  }
  if (!previousAssetMatches) {
    return 'Previous media reference changed after planning.';
  }
  return null;
};

const buildNestedRollbackRegistry = ({
  current,
  nestedTarget,
  beforeFields,
  revision,
  timestamp,
}) => {
  if (!isRecord(nestedTarget) ||
    !['catalog-item-spell', 'foe-technique', 'foe-spell']
      .includes(nestedTarget.kind) ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(
      asString(nestedTarget.entryId)
    ) ||
    !['media', 'videoMedia'].includes(nestedTarget.slot)) {
    throw new Error('Rollback receipt contains an invalid nested target.');
  }
  const root = isRecord(current) ? current : {};
  const registry = isRecord(root.task07EmbeddedMedia) ?
    root.task07EmbeddedMedia : {};
  const binding = isRecord(registry[nestedTarget.entryId]) ?
    registry[nestedTarget.entryId] : {};
  const restored = restoreCompatibilityFieldsIntoData(binding, beforeFields);
  const revisionField = revisionFieldForSlot(nestedTarget.slot);
  const updatedAtField = updatedAtFieldForSlot(nestedTarget.slot);
  return {
    ...registry,
    [nestedTarget.entryId]: {
      ...restored,
      targetKind: nestedTarget.kind,
      [revisionField]: revision,
      [updatedAtField]: timestamp,
    },
  };
};

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

const deterministicNestedEntryId = ({
  sourceKey,
  entityId,
  targetKind,
  locator,
  entry,
}) => {
  const existing = asString(entry?.task07MediaEntryId);
  if (/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(existing)) return existing;
  return `n_${canonicalHash({
    sourceKey,
    entityId,
    targetKind,
    locator: String(locator),
  }).slice(0, 40)}`;
};

const entryDeclaresMediaForSlot = (entry, kind, binding = {}) => {
  if (!isRecord(entry)) return false;
  if (kind === 'spell-video') {
    const descriptors = [
      entry.videoMedia,
      entry.General?.videoMedia,
      binding.videoMedia,
    ].filter((value) => value !== undefined && value !== null && value !== '');
    const explicitUrls = mediaReferenceDeclarationsForKind(
      rendererVideoLegacyProjection(entry),
      kind
    ).length > 0;
    const fallback = [entry.media, entry.General?.media, binding.media]
      .filter(isRecord)
      .some((value) => (
        asString(value.kind).endsWith('-video') ||
        normalizeContentType(value.contentType).startsWith('video/') ||
        normalizeContentType(value.original?.contentType).startsWith('video/')
      ));
    return descriptors.length > 0 || explicitUrls || fallback;
  }
  return mediaReferenceDeclarationsForKind(entry, kind).length > 0 ||
    canonicalDescriptorSelection({kind, data: entry}).declarations.length > 0 ||
    canonicalDescriptorSelection({kind, data: binding}).declarations.length > 0;
};

const nestedMediaRecordsForRecord = (record) => {
  if (!isRecord(record) || !isRecord(record.data)) return [];
  const records = [];
  if (record.sourceKey === 'catalog-items' ||
    (record.kind === 'item' && record.referenceScope === 'global-catalog')) {
    const spells = isRecord(record.data.General?.spells) ?
      record.data.General.spells : {};
    Object.entries(spells).forEach(([entryKey, entry]) => {
      if (!isRecord(entry)) return;
      const entryId = deterministicNestedEntryId({
        sourceKey: 'catalog-items',
        entityId: record.entityId,
        targetKind: 'catalog-item-spell',
        locator: entryKey,
        entry,
      });
      const binding = rawEmbeddedBindingFor(record.data, {
        entryId,
        kind: 'catalog-item-spell',
      }) || {};
      [
        {kind: 'spell', slot: 'media'},
        {kind: 'spell-video', slot: 'videoMedia'},
      ].forEach(({kind, slot}) => {
        if (!entryDeclaresMediaForSlot(entry, kind, binding)) return;
        records.push({
          ...record,
          kind,
          sourceKey: 'catalog-items',
          referenceScope: 'global-catalog',
          mediaData: entry,
          nestedTarget: {
            schemaVersion: 1,
            kind: 'catalog-item-spell',
            entryId,
            entryKey,
            entryIndex: null,
            slot,
          },
        });
      });
    });
  }
  if (record.sourceKey === 'foes' || record.kind === 'foe') {
    [
      {field: 'tecniche', targetKind: 'foe-technique'},
      {field: 'spells', targetKind: 'foe-spell'},
    ].forEach(({field, targetKind}) => {
      const entries = Array.isArray(record.data[field]) ?
        record.data[field] : [];
      entries.forEach((entry, entryIndex) => {
        const provisionalEntryId = deterministicNestedEntryId({
          sourceKey: 'foes',
          entityId: record.entityId,
          targetKind,
          locator: entryIndex,
          entry,
        });
        const binding = rawEmbeddedBindingFor(
          record.data,
          {entryId: provisionalEntryId, kind: targetKind}
        ) || {};
        if (!isRecord(entry) ||
          !entryDeclaresMediaForSlot(entry, 'foe', binding)) return;
        const entryId = deterministicNestedEntryId({
          sourceKey: 'foes',
          entityId: record.entityId,
          targetKind,
          locator: entryIndex,
          entry,
        });
        records.push({
          ...record,
          kind: 'foe',
          sourceKey: 'foes',
          mediaData: entry,
          nestedTarget: {
            schemaVersion: 1,
            kind: targetKind,
            entryId,
            entryKey: null,
            entryIndex,
            slot: 'media',
          },
        });
      });
    });
  }
  return records;
};

const expandMediaRecords = (record) => [
  record,
  ...nestedMediaRecordsForRecord(record),
];

const exactAttachedAssetId = (data, targetSlot = 'media') => (
  /^m_[a-f0-9]{40}$/.test(asString(data?.[targetSlot]?.assetId)) ?
    asString(data[targetSlot].assetId) :
    null
);

const targetDataForBinding = (data, binding) => {
  const root = isRecord(data) ? data : {};
  if (isRecord(binding?.nestedTarget)) {
    return isRecord(
      root.task07EmbeddedMedia?.[binding.nestedTarget.entryId]
    ) ? root.task07EmbeddedMedia[binding.nestedTarget.entryId] : {};
  }
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
    const rootRecordCount = records.length;
    records = records.flatMap(expandMediaRecords);
    return {
      records,
      rootRecordCount,
      cursor: page.at(-1) || null,
      hasMore: snapshot.docs.length > pageSize,
    };
  };

  const readSourceObject = async (
    sourcePath,
    {includeSha256 = false} = {}
  ) => {
    try {
      const [metadata] = await bucket.file(sourcePath).getMetadata();
      let sha256 = '';
      if (includeSha256) {
        const digest = crypto.createHash('sha256');
        const generation = String(metadata.generation || '');
        const immutableObject = bucket.file(sourcePath, generation ? {
          generation,
        } : undefined);
        for await (const chunk of immutableObject.createReadStream()) {
          digest.update(chunk);
        }
        sha256 = digest.digest('hex');
      }
      return {
        exists: true,
        path: sourcePath,
        contentType: metadata.contentType,
        bytes: Number(metadata.size),
        generation: String(metadata.generation || ''),
        checksum: String(
          metadata.md5Hash ||
          metadata.crc32c ||
          metadata.metageneration ||
          ''
        ),
        ...(includeSha256 ? {sha256} : {}),
        cacheControl: String(metadata.cacheControl || ''),
        contentDisposition: String(metadata.contentDisposition || ''),
        customMetadata: isRecord(metadata.metadata) ?
          {...metadata.metadata} :
          {},
      };
    } catch (error) {
      if ([404, '404'].includes(error?.code)) {
        return {exists: false, path: sourcePath};
      }
      throw error;
    }
  };

  const inspectCanonicalRecord = async (record) => {
    const kind = asString(record?.kind);
    const data = isRecord(record?.mediaData) ? record.mediaData :
      isRecord(record?.data) ? record.data : {};
    const descriptor = canonicalDescriptorForRecord(record);
    const assetId = descriptor ? asString(descriptor.assetId) : '';
    const manifest = /^m_[a-f0-9]{40}$/.test(assetId) ?
      await db.doc(`media_assets/${assetId}`).get() :
      null;
    const objectDescriptors = descriptor ? [
      descriptor.original,
      ...Object.values(isRecord(descriptor.variants) ?
        descriptor.variants : {}),
    ].filter(isRecord) : [];
    const legacyPaths = [...new Set(mediaReferenceDeclarationsForKind(
      data,
      kind,
      {
        expectedBucket: storageBucket,
        allowLoopback: projectId === DEMO_PROJECT_ID,
      }
    ).map(({storagePath}) => storagePath).filter(Boolean))]
      .filter((value) => !isCanonicalTask07Path(value))
      .sort();
    const [objects, legacyObjects] = await Promise.all([
      Promise.all(objectDescriptors.map((object) => (
        readSourceObject(asString(object.path), {includeSha256: true})
      ))),
      Promise.all(legacyPaths.map(readSourceObject)),
    ]);
    return {
      manifest: manifest ? {
        exists: manifest.exists,
        version: manifest.exists ? snapshotVersion(manifest) : '',
        data: manifest.exists ? manifest.data() || {} : null,
      } : {exists: false, version: '', data: null},
      objects,
      legacyObjects,
    };
  };

  const readOwner = async (ownerUid) => {
    const snapshot = await db.doc(`users/${ownerUid}`).get();
    return {
      exists: snapshot.exists,
      role: asString(snapshot.get('role')).toLowerCase(),
      deletionState: asString(snapshot.get('deletionState')),
      version: snapshot.exists ? snapshotVersion(snapshot) : '',
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

  const readReceiptsByIds = async (receiptIds) => {
    const records = [];
    for (let index = 0; index < receiptIds.length; index += 100) {
      const batchIds = receiptIds.slice(index, index + 100);
      const snapshots = batchIds.length ? await db.getAll(
        ...batchIds.map((receiptId) => (
          db.doc(`${RECEIPT_COLLECTION}/${receiptId}`)
        ))
      ) : [];
      snapshots.forEach((snapshot) => {
        if (snapshot.exists) {
          records.push({id: snapshot.id, ...snapshot.data()});
        }
      });
    }
    return records;
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
    const rootTargetData = target.data() || {};
    const targetData = targetDataForBinding(rootTargetData, receipt);
    const nestedResolution = isRecord(receipt.nestedTarget) ?
      nestedEntryFor(rootTargetData, receipt.nestedTarget) : null;
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
      nestedEntryPresent: nestedResolution ?
        nestedResolution.conflict !== true &&
          isRecord(nestedResolution.entry) : true,
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
      nestedTarget: entry.nestedTarget,
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
      canonicalHash(receipt.get('nestedTarget') ?? null) !==
        canonicalHash(entry.nestedTarget ?? null) ||
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
      const rootTargetData = target.data() || {};
      const targetData = targetDataForBinding(rootTargetData, entry);
      const ownerRole = asString(owner.get('role')).toLowerCase();
      if (!owner.exists || owner.get('deletionState') === 'pending' ||
        !compiled.core.isTask07MediaRequestAuthorized({
          kind: plan.kind,
          actorUid: plan.actorUid,
          ownerUid: plan.ownerUid,
          referenceScope: plan.referenceScope,
          actorRole: ownerRole,
          targetKind: plan.targetKind,
        })) {
        throw new Error('Media owner is no longer active and authorized.');
      }
      if (receipt.exists && !manifest.exists) {
        throw new Error('Receipt exists without its Task 07 manifest.');
      }
      if (receipt.exists && receipt.get('state') === 'attached' &&
        !recoveryCandidate) {
        const attachment = isRecord(manifest.get('attachment')) ?
          manifest.get('attachment') : {};
        const attachedRevision = Number(receipt.get('attachedRevision'));
        if (manifest.get('state') !== 'attached' ||
          exactAttachedAssetId(targetData, entry.targetSlot) !== entry.assetId ||
          Number(targetData[revisionFieldForSlot(entry.targetSlot)]) !==
            attachedRevision ||
          attachment.referencePath !== entry.targetPath ||
          attachment.targetSlot !== entry.targetSlot ||
          Number(attachment.revision) !== attachedRevision) {
          throw new Error(
            'Attached receipt no longer matches its exact target and manifest.'
          );
        }
        return;
      }
      if (receipt.exists && receipt.get('state') !== 'intent' &&
        !recoveryCandidate) {
        throw new Error('Existing Task 07 receipt is not resumable.');
      }
      const mediaSourceData = entry.nestedTarget ?
        nestedEntryFor(rootTargetData, entry.nestedTarget)?.entry || {} :
        targetData;
      const targetFenceIssue = backfillTargetFenceIssue({
        targetExists: target.exists,
        targetAvailable: !(
          target.get('deletionState') === 'pending' ||
          target.get('pendingDeletion') === true ||
          target.get('deleted') === true ||
          targetData.deletionState === 'pending' ||
          targetData.pendingDeletion === true ||
          targetData.deleted === true
        ),
        targetFingerprintMatches:
          targetMediaFingerprint(rootTargetData, entry.kind, entry) ===
            entry.targetFingerprint,
        legacyReferenceMatches: legacyPathsForKind(
          mediaSourceData,
          entry.kind,
          {
            expectedBucket: storageBucket,
            allowLoopback: projectId === DEMO_PROJECT_ID,
          }
        ).includes(entry.sourcePath),
        legacyGeneralImageUrlMatches: canonicalHash(generalImageUrlProof(
          targetData,
          entry.kind
        )) === canonicalHash(entry.legacyGeneralImageUrlProof ?? null),
        previousAssetMatches:
          exactAttachedAssetId(targetData, entry.targetSlot) ===
            entry.previousAssetId,
      });
      if (targetFenceIssue) throw new Error(targetFenceIssue);
      if (manifest.exists && (
        manifest.get('requestHash') !== plan.requestHash ||
        manifest.get('actorUid') !== entry.ownerUid
      )) {
        throw new Error('Task 07 asset identity is already bound.');
      }
      if (receipt.exists && !recoveryCandidate) return;
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
      nestedTarget: entry.nestedTarget,
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
      if (entry.nestedTarget) {
        transaction.update(targetRef, {
          task07EmbeddedMedia: buildNestedRollbackRegistry({
            current: target.data() || {},
            nestedTarget: entry.nestedTarget,
            beforeFields: receipt.get('beforeFields'),
            revision,
            timestamp: now,
          }),
        });
      } else if (entry.commonTechnique) {
        transaction.set(targetRef, {
          [entry.entityId]: {
            ...restoreCompatibilityFieldsIntoData(
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
            ...(entry.nestedTarget ? {nestedTarget: entry.nestedTarget} : {}),
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
    inspectCanonicalRecord,
    readOwner,
    verifyCatalogOwner,
    readReceiptPage,
    readReceiptsByIds,
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
  'Task 07 legacy-media migration, active canonical audit, and rollback.',
  '',
  'Usage:',
  `  node scripts/task07/media-derivative-backfill.js --environment performance --project ${DEMO_PROJECT_ID} --site ${DEMO_HOSTING_SITE} --bucket ${DEMO_STORAGE_BUCKET}`,
  '    [--operation backfill|verify|rollback|canonical-audit]',
  '    [--report <path>]',
  '    [--approved-backfill-report <count-bound-plan>  # verify only]',
  '    [--page-size 1..50] [--max-pages 1..100] [--json]',
  `  node scripts/task07/media-derivative-backfill.js --environment performance --project ${DEMO_PROJECT_ID} --site ${DEMO_HOSTING_SITE} --bucket ${DEMO_STORAGE_BUCKET}`,
  '    --operation backfill|rollback --execute',
  '    --approve-fingerprint <sha256> --report <reviewed-plan>',
  '    [--checkpoint <path>] [--resume]',
  '',
  `  node scripts/task07/media-derivative-backfill.js --environment production --project ${PRODUCTION_PROJECT_ID} --site ${PRODUCTION_PROJECT_ID} --bucket ${PRODUCTION_STORAGE_BUCKET}`,
  `    --auth firebase-cli --allow-live-project --confirm-project ${PRODUCTION_PROJECT_ID}`,
  '    --catalog-owner-uid <verified-webmaster-uid>',
  '    --confirm-catalog-owner-uid <same-uid>',
  ...SOURCE_KEYS.map((sourceKey) => `    --source ${sourceKey}`),
  '    [--expected-candidates <reviewed-count>]',
  '    [--operation backfill|verify|rollback|canonical-audit]',
  '    [--report <path>]',
  '',
  'Safety:',
  '  - Planning, verification, and canonical-audit are read-only.',
  `  - Live access is allowed only for ${PRODUCTION_PROJECT_ID}.`,
  `  - Emulator behavior remains restricted to ${DEMO_PROJECT_ID} loopback hosts.`,
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
  resolveOperatorTarget({options, allowPerformance: true});
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
      const approvedBackfillReport = options.approvedBackfillReportPath ?
        readJson(
          options.approvedBackfillReportPath,
          'Approved Task 07 backfill plan'
        ) : null;
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
        approvedBackfillReport,
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
  CANONICAL_AUDIT_VERSION,
  DEFAULT_MAX_PAGES,
  DEFAULT_PAGE_SIZE,
  DEMO_PROJECT_ID,
  DEMO_HOSTING_SITE,
  DEMO_STORAGE_BUCKET,
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
  buildCanonicalMediaAudit,
  backfillTargetFenceIssue,
  buildLegacyMediaBackfillPlan,
  buildLegacyMapBackfillMarker,
  buildNestedRollbackRegistry,
  buildMigrationPlan,
  buildReceiptOperationPlan,
  canonicalHash,
  canonicalObjectIssues,
  collectMediaPaths,
  computePlanFingerprint,
  createAdminBackend,
  executeMigrationPlan,
  expandMediaRecords,
  exactSourceKeys,
  expectedStorageBucket,
  generalImageUrlProof,
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
};
