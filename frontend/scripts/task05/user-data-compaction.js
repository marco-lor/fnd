#!/usr/bin/env node

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  canonicalHash,
  canonicalStringify,
} = require('./user-data-model');
const {
  createFirebaseCliAdcFile,
} = require('../firebase-cli-admin-credential');
const {PRODUCTION_PROJECT_ID} = require('../production-target');
const {
  DRAIN_ID_PATTERN,
  scopeFingerprint,
} = require('./user-data-cutover');

const COMPACTION_SCHEMA_VERSION = 1;
const CUTOVER_SCHEMA_VERSION = 1;
const MIGRATION_REPORT_SCHEMA_VERSION = 2;
const MODEL_VERSION = 2;
const CONFIG_PATH = 'app_config/user_data_v2';
const COMPLETION_LOCK_FIELD = 'userDataCompletionLock';
const CUTOVER_ATTESTATION_ROOT = 'migration_state/user-data-v2/cutovers';
// Keep physical-compaction archives separate from the additive migration
// archive format. Either archive is immutable, and a prior migration archive
// must never be overwritten or reinterpreted as a compaction archive.
const ARCHIVE_ROOT = 'migration_state/user-data-v2/root_compaction_archives';
const ARCHIVE_FIELDS_COLLECTION = 'root_fields';
const ARCHIVE_KIND = 'task05-user-data-legacy-root-compaction-archive';
const REPORT_KIND = 'task05-user-data-legacy-root-compaction-plan';
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const AUTH_MODES = new Set(['admin', 'firebase-cli']);
const DEFAULT_RESULTS_DIRECTORY = path.resolve(__dirname, '..', '..', 'performance-results');
const MAX_ARCHIVE_DOCUMENT_BYTES = 900 * 1024;
const MAX_TRANSACTION_WRITES = 500;

// The root document remains the V2 identity/profile shell. Only fields whose
// authoritative owner moved into V2 state/collection documents are removed.
// `flags` deliberately remains on the shell because login and character
// creation use it before the other domains are attached.
const LEGACY_ROOT_FIELDS = Object.freeze([
  'stats',
  'Parametri',
  'AltriParametri',
  'inventory',
  'equipped',
  'beltCapacity',
  'slotCintura',
  'spells',
  'tecniche',
  'lingue',
  'conoscenze',
  'professioni',
  'active_turn_effect',
  'settings',
  'parameterLocks',
  'paramLocks',
  'drawColorKey',
  'shareLiveInteractions',
  'grigliataMuted',
  'hiddenGrigliataBackgrounds',
  'hiddenGrigliataTokens',
]);

const REQUIRED_STATE_DOCUMENTS = Object.freeze([
  'progression',
  'resources',
  'settings',
  'equipment',
  'profileContent',
]);

const V2_DYNAMIC_COLLECTIONS = Object.freeze([
  'inventory',
  'spells',
  'tecniche',
  'content_names',
]);

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const timestampParts = (value) => {
  if (!value || typeof value !== 'object') return null;
  const seconds = Number(value.seconds ?? value._seconds);
  const nanoseconds = Number(value.nanoseconds ?? value._nanoseconds);
  if (
    !Number.isInteger(seconds)
    || !Number.isInteger(nanoseconds)
    || nanoseconds < 0
    || nanoseconds > 999999999
  ) return null;
  return {seconds, nanoseconds};
};
const sameTimestamp = (left, right) => {
  const leftParts = timestampParts(left);
  const rightParts = timestampParts(right);
  return !!leftParts && !!rightParts
    && leftParts.seconds === rightParts.seconds
    && leftParts.nanoseconds === rightParts.nanoseconds;
};
const cloneValue = (value) => {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (!isRecord(value)) return value;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneValue(entry)]));
};

const defaultPath = (name) => path.join(DEFAULT_RESULTS_DIRECTORY, `task05-${name}.json`);
const subjectHash = (projectId, uid) => canonicalHash({projectId, uid});
const archiveMarkerPath = (uid) => `${ARCHIVE_ROOT}/${uid}`;
const archiveFieldId = (field) => `f_${canonicalHash(field).slice(0, 40)}`;
const archiveFieldPath = (uid, field) => (
  `${archiveMarkerPath(uid)}/${ARCHIVE_FIELDS_COLLECTION}/${archiveFieldId(field)}`
);

const writeJsonAtomic = (filePath, value) => {
  fs.mkdirSync(path.dirname(filePath), {recursive: true});
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporaryPath, filePath);
};

const readJson = (filePath, label) => {
  if (!filePath || !fs.existsSync(filePath)) throw new Error(`${label} not found.`);
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`${label} is not valid JSON.`, {cause: error});
  }
};

const legacyRootData = (root = {}) => Object.fromEntries(
  LEGACY_ROOT_FIELDS
    .filter((field) => hasOwn(root, field))
    .map((field) => [field, cloneValue(root[field])])
);

const compactedShellData = (root = {}) => Object.fromEntries(
  Object.entries(root)
    .filter(([field]) => !LEGACY_ROOT_FIELDS.includes(field))
    .map(([field, value]) => [field, cloneValue(value)])
);

const hashDocumentSet = (documents = []) => canonicalHash(
  [...documents]
    .map(({path: documentPath, data}) => ({path: documentPath, data}))
    .sort((left, right) => left.path.localeCompare(right.path))
);

const archiveDocumentSize = (document) => Buffer.byteLength(
  canonicalStringify(document.data),
  'utf8'
);

const buildCompactionArchiveDocuments = (uid, root = {}) => {
  const rootFieldNames = Object.keys(root).sort();
  const legacy = legacyRootData(root);
  const shell = compactedShellData(root);
  const fieldDocuments = rootFieldNames.map((field) => {
    const value = cloneValue(root[field]);
    return {
      path: archiveFieldPath(uid, field),
      data: {
        schemaVersion: COMPACTION_SCHEMA_VERSION,
        kind: 'task05-user-data-root-field-archive',
        field,
        value,
        valueHash: canonicalHash(value),
      },
    };
  });
  const marker = {
    path: archiveMarkerPath(uid),
    data: {
      schemaVersion: MODEL_VERSION,
      compactionSchemaVersion: COMPACTION_SCHEMA_VERSION,
      kind: ARCHIVE_KIND,
      sourceHash: canonicalHash(root),
      shellHash: canonicalHash(shell),
      legacyPayloadHash: canonicalHash(legacy),
      rootFields: rootFieldNames,
      legacyFields: Object.keys(legacy).sort(),
      fieldHashes: Object.fromEntries(fieldDocuments.map(({data}) => [data.field, data.valueHash])),
    },
  };
  const documents = [marker, ...fieldDocuments].sort((left, right) => left.path.localeCompare(right.path));
  const oversized = documents
    .map((document) => ({path: document.path, byteSize: archiveDocumentSize(document)}))
    .filter(({byteSize}) => byteSize > MAX_ARCHIVE_DOCUMENT_BYTES);
  return {
    exceedsTransactionWriteLimit: documents.length + 1 > MAX_TRANSACTION_WRITES,
    documents,
    legacy,
    marker: marker.data,
    oversized,
    root: cloneValue(root),
    shell,
  };
};

const parseCompactionArchive = (uid, archive = {}) => {
  const markerDocument = archive.marker;
  const fieldDocuments = Array.isArray(archive.fields) ? archive.fields : [];
  if (!markerDocument?.exists) {
    return {
      exists: false,
      issues: fieldDocuments.length > 0
        ? [{severity: 'error', code: 'compaction-archive-marker-missing'}]
        : [],
    };
  }
  const marker = markerDocument.data || {};
  const issues = [];
  if (
    marker.kind !== ARCHIVE_KIND
    || marker.schemaVersion !== MODEL_VERSION
    || marker.compactionSchemaVersion !== COMPACTION_SCHEMA_VERSION
    || !Array.isArray(marker.rootFields)
    || !Array.isArray(marker.legacyFields)
    || !isRecord(marker.fieldHashes)
    || !SHA256_PATTERN.test(String(marker.sourceHash || ''))
    || !SHA256_PATTERN.test(String(marker.shellHash || ''))
    || !SHA256_PATTERN.test(String(marker.legacyPayloadHash || ''))
  ) {
    issues.push({severity: 'error', code: 'compaction-archive-marker-invalid'});
    return {exists: true, issues};
  }
  const rootFields = [...marker.rootFields];
  const uniqueRootFields = [...new Set(rootFields)].sort();
  if (
    rootFields.some((field) => typeof field !== 'string' || field.length === 0)
    || marker.legacyFields.some((field) => typeof field !== 'string' || field.length === 0)
    || canonicalHash(rootFields) !== canonicalHash(uniqueRootFields)
    || marker.legacyFields.some((field) => !LEGACY_ROOT_FIELDS.includes(field))
    || canonicalHash(marker.legacyFields) !== canonicalHash([...new Set(marker.legacyFields)].sort())
  ) {
    issues.push({severity: 'error', code: 'compaction-archive-field-list-invalid'});
    return {exists: true, issues};
  }
  const byField = new Map();
  for (const document of fieldDocuments) {
    const data = document?.data || {};
    if (
      !document?.exists
      || data.kind !== 'task05-user-data-root-field-archive'
      || data.schemaVersion !== COMPACTION_SCHEMA_VERSION
      || typeof data.field !== 'string'
      || document.path !== archiveFieldPath(uid, data.field)
      || !SHA256_PATTERN.test(String(data.valueHash || ''))
      || data.valueHash !== canonicalHash(data.value)
      || byField.has(data.field)
    ) {
      issues.push({severity: 'error', code: 'compaction-archive-field-invalid'});
      continue;
    }
    byField.set(data.field, cloneValue(data.value));
  }
  if (
    byField.size !== uniqueRootFields.length
    || uniqueRootFields.some((field) => !byField.has(field))
    || Object.keys(marker.fieldHashes).sort().some((field, index) => field !== uniqueRootFields[index])
  ) {
    issues.push({severity: 'error', code: 'compaction-archive-field-set-mismatch'});
  }
  const root = Object.fromEntries(uniqueRootFields
    .filter((field) => byField.has(field))
    .map((field) => [field, byField.get(field)]));
  const expected = buildCompactionArchiveDocuments(uid, root);
  if (
    marker.sourceHash !== canonicalHash(root)
    || marker.shellHash !== canonicalHash(compactedShellData(root))
    || marker.legacyPayloadHash !== canonicalHash(legacyRootData(root))
    || hashDocumentSet(expected.documents) !== hashDocumentSet([
      {path: archiveMarkerPath(uid), data: marker},
      ...fieldDocuments.map(({path: documentPath, data}) => ({path: documentPath, data})),
    ])
  ) {
    issues.push({severity: 'error', code: 'compaction-archive-hash-mismatch'});
  }
  return {
    exists: true,
    documents: expected.documents,
    issues,
    legacy: expected.legacy,
    marker,
    root,
    shell: expected.shell,
  };
};

const configIssues = (config) => {
  const issues = [];
  if (!isRecord(config)) return [{severity: 'error', code: 'rollout-config-missing'}];
  const mode = config.mode ?? config.stage;
  if (mode !== 'new-only') issues.push({severity: 'error', code: 'rollout-not-new-only'});
  if (hasOwn(config, 'mode') && hasOwn(config, 'stage') && config.mode !== config.stage) {
    issues.push({severity: 'error', code: 'rollout-stage-alias-conflict'});
  }
  if (
    config.userOverrides !== undefined
    && (!isRecord(config.userOverrides) || Object.keys(config.userOverrides).length !== 0)
  ) {
    issues.push({severity: 'error', code: 'rollout-user-overrides-present'});
  }
  if (config.legacyDrain !== undefined && !isRecord(config.legacyDrain)) {
    issues.push({severity: 'error', code: 'rollout-drain-malformed'});
  } else if (isRecord(config.legacyDrain)) {
    const users = config.legacyDrain.users;
    if (Object.keys(config.legacyDrain).some((key) => !['global', 'users'].includes(key))) {
      issues.push({severity: 'error', code: 'rollout-drain-unsupported-field'});
    }
    if (hasOwn(config.legacyDrain, 'global')) {
      issues.push({severity: 'error', code: 'rollout-global-drain-present'});
    }
    if (users !== undefined && (!isRecord(users) || Object.keys(users).length !== 0)) {
      issues.push({severity: 'error', code: 'rollout-user-drain-present'});
    }
  }
  if (hasOwn(config, COMPLETION_LOCK_FIELD)) {
    issues.push({severity: 'error', code: 'rollout-completion-lock-present'});
  }
  return issues;
};

const activeDeletionJob = (snapshot) => {
  if (!snapshot?.exists) return false;
  return snapshot.data?.stage !== 'completed';
};

const v2CollectionCounts = (bundle) => Object.fromEntries(
  V2_DYNAMIC_COLLECTIONS.map((collectionId) => [
    collectionId,
    Array.isArray(bundle.collections?.[collectionId])
      ? bundle.collections[collectionId].length
      : 0,
  ])
);

const summarizeVerificationSubjects = (subjects) => canonicalHash(
  subjects
    .map((entry) => ({
      cleanupFingerprint: entry.cleanupFingerprint,
      currentHash: entry.currentHash,
      issues: entry.issues,
      legacyProjectionHash: entry.legacyProjectionHash,
      sourceHash: entry.sourceHash,
      sourceVersionHash: entry.sourceVersionHash,
      subjectHash: entry.subjectHash,
      targetHash: entry.targetHash,
    }))
    .sort((left, right) => left.subjectHash.localeCompare(right.subjectHash))
);

const validateCompletedCutoverEvidence = ({
  attestationSnapshot,
  cutoverId,
  projectId,
  verificationReport,
}) => {
  const issues = [];
  const attestation = attestationSnapshot?.exists ? attestationSnapshot.data || {} : null;
  const expectedScopeFingerprint = scopeFingerprint({
    scope: 'global',
    globalStage: 'new-only',
    overrides: new Map(),
  });
  if (
    !isRecord(attestation)
    || attestation.schemaVersion !== CUTOVER_SCHEMA_VERSION
    || attestation.projectId !== projectId
    || attestation.scope !== 'global'
    || attestation.drainId !== cutoverId
    || attestation.status !== 'completed'
    || attestation.originalStage !== 'new-read-dual-write'
    || attestation.scopeFingerprint !== expectedScopeFingerprint
    || hasOwn(attestation, 'subjectHash')
    || !timestampParts(attestation.closedAt)
    || !timestampParts(attestation.completedAt)
    || [
      'sealVerificationFingerprint',
      'sealReportDigest',
      'sealSubjectsFingerprint',
      'completionVerificationFingerprint',
      'completionReportDigest',
      'completionSubjectsFingerprint',
    ].some((field) => !SHA256_PATTERN.test(String(attestation?.[field] || '')))
  ) {
    issues.push({severity: 'error', code: 'completed-cutover-attestation-invalid'});
  }

  const subjects = Array.isArray(verificationReport?.subjects)
    ? verificationReport.subjects
    : [];
  const subjectHashes = new Set();
  const malformedSubject = subjects.some((entry) => {
    const invalid = (
      !isRecord(entry)
      || [
        'subjectHash',
        'sourceHash',
        'sourceVersionHash',
        'legacyProjectionHash',
        'targetHash',
        'currentHash',
        'cleanupFingerprint',
      ].some((field) => !SHA256_PATTERN.test(String(entry?.[field] || '')))
      || entry.currentHash !== entry.targetHash
      || entry.issues?.errors !== 0
      || entry.issues?.warnings !== 0
      || subjectHashes.has(entry.subjectHash)
    );
    if (!invalid) subjectHashes.add(entry.subjectHash);
    return invalid;
  });
  const verificationSubjectsFingerprint = malformedSubject
    ? canonicalHash(null)
    : summarizeVerificationSubjects(subjects);
  if (
    !isRecord(verificationReport)
    || verificationReport.schemaVersion !== MIGRATION_REPORT_SCHEMA_VERSION
    || verificationReport.modelVersion !== MODEL_VERSION
    || verificationReport.mode !== 'dry-run'
    || verificationReport.operation !== 'verify'
    || verificationReport.projectId !== projectId
    || verificationReport.complete !== true
    || !SHA256_PATTERN.test(String(verificationReport.planFingerprint || ''))
    || verificationReport.counts?.users !== subjects.length
    || verificationReport.counts?.errors !== 0
    || verificationReport.counts?.warnings !== 0
    || verificationReport.counts?.writesRequired !== 0
    || Number(verificationReport.counts?.cleanupDocuments || 0) !== 0
    || Number(verificationReport.counts?.deletionConflicts || 0) !== 0
    || malformedSubject
    || verificationReport.drain?.scope !== 'global'
    || verificationReport.drain?.drainId !== cutoverId
    || verificationReport.drain?.rolloutStage !== 'new-only'
    || verificationReport.drain?.scopeFingerprint !== expectedScopeFingerprint
    || !sameTimestamp(verificationReport.drain?.closedAt, attestation?.closedAt)
    || verificationReport.drainEvidence?.deletionConflicts !== 0
    || (Array.isArray(verificationReport.drainEvidence?.codes)
      && verificationReport.drainEvidence.codes.length > 0)
    || verificationReport.planFingerprint !== attestation?.completionVerificationFingerprint
    || canonicalHash(verificationReport) !== attestation?.completionReportDigest
    || verificationSubjectsFingerprint !== attestation?.completionSubjectsFingerprint
  ) {
    issues.push({severity: 'error', code: 'completed-cutover-verification-invalid'});
  }

  const publicEvidence = {
    cutoverIdHash: canonicalHash({projectId, cutoverId}),
    attestationFingerprint: canonicalHash(attestation),
    verificationFingerprint: String(attestation?.completionVerificationFingerprint || ''),
    reportDigest: canonicalHash(verificationReport),
    subjectsFingerprint: verificationSubjectsFingerprint,
    verifiedSubjects: subjects.length,
  };
  return {
    attestation,
    cutoverId,
    issues,
    public: publicEvidence,
    subjectHashes,
  };
};

const v2StructureIssues = (bundle) => {
  const issues = [];
  const root = bundle.root?.data || {};
  if (root.modelVersion !== MODEL_VERSION) {
    issues.push({severity: 'error', code: 'root-model-version-not-v2'});
  }
  if (root.deletionState === 'pending' || activeDeletionJob(bundle.deletionJob)) {
    issues.push({severity: 'error', code: 'user-deletion-active'});
  }
  for (const stateId of REQUIRED_STATE_DOCUMENTS) {
    const state = bundle.states?.[stateId];
    if (!state?.exists) issues.push({severity: 'error', code: 'v2-state-document-missing'});
    else if (state.data?.schemaVersion !== MODEL_VERSION) {
      issues.push({severity: 'error', code: 'v2-state-schema-invalid'});
    }
  }
  for (const collectionId of V2_DYNAMIC_COLLECTIONS) {
    const documents = bundle.collections?.[collectionId];
    if (!Array.isArray(documents)) {
      issues.push({severity: 'error', code: 'v2-collection-read-missing'});
      continue;
    }
    if (documents.some((document) => document.data?.schemaVersion !== MODEL_VERSION)) {
      issues.push({severity: 'error', code: 'v2-collection-schema-invalid'});
    }
  }
  return issues;
};

const approvalSubject = (entry) => ({
  subjectHash: entry.public.subjectHash,
  sourceHash: entry.sourceHash,
  legacyPayloadHash: entry.legacyPayloadHash,
  archiveFingerprint: entry.archiveFingerprint,
  archiveDocuments: entry.expectedArchiveDocuments.length,
  legacyFields: [...entry.legacyFields],
  v2CollectionCounts: {...entry.v2CollectionCounts},
  v2StateDocuments: entry.v2StateDocuments,
});

const approvalCore = (report) => ({
  schemaVersion: report.schemaVersion,
  kind: report.kind,
  projectId: report.projectId,
  configFingerprint: report.configFingerprint,
  cutoverEvidence: report.cutoverEvidence,
  legacyRootFields: report.legacyRootFields,
  subjects: (report.subjects || []).map((subject) => ({
    subjectHash: subject.subjectHash,
    sourceHash: subject.sourceHash,
    legacyPayloadHash: subject.legacyPayloadHash,
    archiveFingerprint: subject.archiveFingerprint,
    archiveDocuments: subject.archiveDocuments,
    legacyFields: subject.legacyFields,
    v2CollectionCounts: subject.v2CollectionCounts,
    v2StateDocuments: subject.v2StateDocuments,
  })),
});

const buildCompactionPlan = async ({
  backend,
  cutoverId,
  cutoverVerificationReport,
  generatedAt = new Date().toISOString(),
  projectId,
  requireCompacted = false,
}) => {
  const [configSnapshot, attestationSnapshot] = await Promise.all([
    backend.readConfig(),
    backend.readCutoverAttestation(cutoverId),
  ]);
  const config = configSnapshot?.exists ? configSnapshot.data || {} : null;
  const cutover = validateCompletedCutoverEvidence({
    attestationSnapshot,
    cutoverId,
    projectId,
    verificationReport: cutoverVerificationReport,
  });
  const globalIssues = [...configIssues(config), ...cutover.issues];
  const roots = await backend.listUsers();
  const entries = [];

  for (const rootSnapshot of roots) {
    const uid = rootSnapshot.id;
    const bundle = await backend.readUserBundle(uid, rootSnapshot);
    const root = bundle.root?.data || {};
    const issues = [...v2StructureIssues(bundle)];
    const currentLegacy = legacyRootData(root);
    const archive = parseCompactionArchive(uid, bundle.archive);
    issues.push(...archive.issues);
    let currentState;
    let sourceRoot;
    let expectedArchiveDocuments;

    if (Object.keys(currentLegacy).length > 0) {
      currentState = 'pending';
      const expected = buildCompactionArchiveDocuments(uid, root);
      sourceRoot = expected.root;
      expectedArchiveDocuments = expected.documents;
      if (expected.oversized.length > 0) {
        issues.push({severity: 'error', code: 'compaction-archive-document-too-large'});
      }
      if (expected.exceedsTransactionWriteLimit) {
        issues.push({severity: 'error', code: 'compaction-transaction-write-limit'});
      }
      if (archive.exists && (
        archive.issues.length > 0
        || hashDocumentSet(archive.documents) !== hashDocumentSet(expected.documents)
      )) {
        issues.push({severity: 'error', code: 'compaction-archive-conflict'});
      }
      if (requireCompacted) {
        issues.push({severity: 'error', code: 'legacy-root-fields-still-present'});
      }
    } else if (archive.exists && archive.issues.length === 0) {
      currentState = 'compacted';
      sourceRoot = archive.root;
      expectedArchiveDocuments = archive.documents;
    } else {
      currentState = 'native-v2';
      sourceRoot = cloneValue(root);
      expectedArchiveDocuments = [];
    }

    const legacy = legacyRootData(sourceRoot);
    const publicSubjectHash = subjectHash(projectId, uid);
    if (Object.keys(legacy).length > 0 && !cutover.subjectHashes.has(publicSubjectHash)) {
      issues.push({severity: 'error', code: 'legacy-subject-not-in-completed-cutover'});
    }
    const collectionCounts = v2CollectionCounts(bundle);
    const collectionDocuments = Object.values(collectionCounts)
      .reduce((total, count) => total + count, 0);
    const stateDocuments = Object.values(bundle.states || {})
      .filter((state) => state?.exists).length;
    const entry = {
      uid,
      archiveFingerprint: expectedArchiveDocuments.length
        ? hashDocumentSet(expectedArchiveDocuments)
        : canonicalHash(null),
      expectedArchiveDocuments,
      legacyFields: Object.keys(legacy).sort(),
      legacyPayloadHash: canonicalHash(legacy),
      sourceHash: canonicalHash(sourceRoot),
      v2CollectionCounts: collectionCounts,
      v2StateDocuments: stateDocuments,
      public: {
        subjectHash: publicSubjectHash,
        currentState,
        sourceHash: canonicalHash(sourceRoot),
        legacyPayloadHash: canonicalHash(legacy),
        archiveFingerprint: expectedArchiveDocuments.length
          ? hashDocumentSet(expectedArchiveDocuments)
          : canonicalHash(null),
        legacyFields: Object.keys(legacy).sort(),
        legacyFieldCount: Object.keys(legacy).length,
        archiveDocuments: expectedArchiveDocuments.length,
        v2CollectionCounts: collectionCounts,
        v2StateDocuments: stateDocuments,
        v2CollectionDocuments: collectionDocuments,
        issues,
      },
    };
    entries.push(entry);
  }

  entries.sort((left, right) => left.uid.localeCompare(right.uid));
  const subjects = entries.map((entry) => ({...approvalSubject(entry), ...entry.public}));
  const errors = globalIssues.length + subjects.reduce(
    (total, subject) => total + subject.issues.filter(({severity}) => severity === 'error').length,
    0
  );
  const counts = {
    users: subjects.length,
    pending: subjects.filter(({currentState}) => currentState === 'pending').length,
    compacted: subjects.filter(({currentState}) => currentState === 'compacted').length,
    nativeV2: subjects.filter(({currentState}) => currentState === 'native-v2').length,
    legacyFields: subjects.reduce((total, subject) => total + subject.legacyFieldCount, 0),
    archiveDocuments: subjects.reduce((total, subject) => total + subject.archiveDocuments, 0),
    v2StateDocuments: subjects.reduce((total, subject) => total + subject.v2StateDocuments, 0),
    v2CollectionDocuments: subjects.reduce(
      (total, subject) => total + subject.v2CollectionDocuments,
      0
    ),
    errors,
  };
  const report = {
    schemaVersion: COMPACTION_SCHEMA_VERSION,
    kind: REPORT_KIND,
    mode: requireCompacted ? 'verification' : 'dry-run',
    generatedAt,
    projectId,
    configFingerprint: canonicalHash(config),
    cutoverEvidence: cutover.public,
    legacyRootFields: [...LEGACY_ROOT_FIELDS],
    globalIssues,
    subjects,
    counts,
  };
  report.planFingerprint = canonicalHash(approvalCore(report));
  return {config, cutover, entries, report};
};

const assertApprovedReport = ({approvedFingerprint, approvedReport, projectId}) => {
  if (!isRecord(approvedReport) || approvedReport.kind !== REPORT_KIND) {
    throw new Error('Approved compaction report has the wrong format.');
  }
  if (
    approvedReport.mode !== 'dry-run'
    || approvedReport.projectId !== projectId
    || approvedReport.counts?.errors !== 0
    || approvedReport.planFingerprint !== canonicalHash(approvalCore(approvedReport))
    || approvedReport.planFingerprint !== approvedFingerprint
  ) {
    throw new Error('Approved compaction report or fingerprint does not match the dry-run plan.');
  }
  return approvedReport;
};

const assertCheckpoint = ({checkpoint, planFingerprint, projectId}) => {
  if (!checkpoint) return null;
  if (
    checkpoint.schemaVersion !== COMPACTION_SCHEMA_VERSION
    || checkpoint.kind !== 'task05-user-data-legacy-root-compaction-checkpoint'
    || checkpoint.projectId !== projectId
    || checkpoint.planFingerprint !== planFingerprint
    || typeof checkpoint.lastDocumentId !== 'string'
  ) {
    throw new Error('Resume checkpoint does not match the approved compaction plan.');
  }
  return checkpoint;
};

const executeCompactionPlan = async ({
  backend,
  checkpoint = null,
  onCheckpoint = async () => {},
  plan,
  projectId,
}) => {
  let startIndex = 0;
  let processed = 0;
  if (checkpoint?.lastDocumentId) {
    const checkpointIndex = plan.entries.findIndex(({uid}) => uid === checkpoint.lastDocumentId);
    if (checkpointIndex < 0) throw new Error('Checkpoint cursor is absent from the approved plan.');
    startIndex = checkpointIndex + 1;
    processed = Number(checkpoint.processed) || startIndex;
  }
  for (let index = startIndex; index < plan.entries.length; index += 1) {
    const entry = plan.entries[index];
    if (entry.public.currentState === 'pending') {
      await backend.compactUser({
        configFingerprint: plan.report.configFingerprint,
        cutoverAttestationFingerprint: plan.cutover.public.attestationFingerprint,
        cutoverId: plan.cutover.cutoverId,
        entry,
        planFingerprint: plan.report.planFingerprint,
      });
    } else {
      await backend.verifyUser({entry});
    }
    processed = index + 1;
    await onCheckpoint({
      schemaVersion: COMPACTION_SCHEMA_VERSION,
      kind: 'task05-user-data-legacy-root-compaction-checkpoint',
      projectId,
      planFingerprint: plan.report.planFingerprint,
      lastDocumentId: entry.uid,
      processed,
      complete: processed === plan.entries.length,
    });
  }
  return {complete: processed === plan.entries.length, processed};
};

const parseEmulatorHost = (value) => {
  if (!value || typeof value !== 'string' || value.includes('://')) return null;
  try {
    const parsed = new URL(`http://${value}`);
    if (!parsed.port || parsed.username || parsed.password || parsed.search || parsed.hash) return null;
    if (parsed.pathname && parsed.pathname !== '/') return null;
    return parsed;
  } catch (_error) {
    return null;
  }
};

const assertSafeTarget = (options, env = process.env) => {
  for (const variable of ['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT']) {
    if (env[variable] && env[variable] !== options.projectId) {
      throw new Error(`${variable} does not match the explicit --project.`);
    }
  }
  const emulatorHost = env.FIRESTORE_EMULATOR_HOST;
  const emulator = parseEmulatorHost(emulatorHost);
  if (emulatorHost && !emulator) {
    throw new Error('FIRESTORE_EMULATOR_HOST must be a valid host:port value.');
  }
  if (emulator) {
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(emulator.hostname)) {
      throw new Error('Only a loopback Firestore emulator is allowed.');
    }
    if (!options.projectId.startsWith('demo-')) {
      throw new Error('Firestore emulator compaction requires a demo-* project.');
    }
    return {live: false};
  }
  if (
    options.projectId !== PRODUCTION_PROJECT_ID
    || !options.allowLiveProject
    || options.confirmProject !== options.projectId
    || options.authMode !== 'firebase-cli'
  ) {
    throw new Error(
      `Live compaction is hard-locked to ${PRODUCTION_PROJECT_ID}, Firebase CLI auth, `
      + 'and exact --allow-live-project/--confirm-project acknowledgement.'
    );
  }
  return {live: true};
};

const printHelp = () => console.log([
  'Task 05 User Data V2 legacy-root compaction.',
  '',
  'Dry-run:',
  '  node scripts/task05/user-data-compaction.js --project <project>',
  '    --cutover-id <completed-global-cutover-id>',
  '    --cutover-verification-report <sealed-verification-report>',
  '    [--auth admin|firebase-cli] [--report <path>] [--verify]',
  '    [--allow-live-project --confirm-project <project>]',
  '',
  'Execute:',
  '  node scripts/task05/user-data-compaction.js --project <project>',
  '    --cutover-id <completed-global-cutover-id>',
  '    --cutover-verification-report <sealed-verification-report>',
  '    --execute --approved-report <path> --approve-fingerprint <sha256>',
  '    [--checkpoint <path>] [--resume] [--result <path>]',
  '    [--auth admin|firebase-cli] [--allow-live-project --confirm-project <project>]',
  '',
  'Safety:',
  '  - Requires the exact completed global cutover and its durably bound clean verification.',
  '  - Requires clean global new-only, zero overrides/drains/locks, and complete V2 schemas.',
  '  - Archives the exact original root per field in the same transaction as deletion.',
  '  - Deletes only the explicit legacy allowlist; the identity/profile shell remains.',
  '  - Reports redact UIDs; checkpoint cursors remain in the ignored results directory.',
  `  - Live access is hard-locked to ${PRODUCTION_PROJECT_ID}.`,
].join('\n'));

const parseArguments = (args = []) => {
  const options = {
    allowLiveProject: false,
    approveFingerprint: '',
    approvedReportPath: '',
    authMode: 'admin',
    checkpointPath: '',
    confirmProject: '',
    cutoverId: '',
    cutoverVerificationReportPath: '',
    execute: false,
    help: false,
    projectId: '',
    reportPath: '',
    resultPath: '',
    resume: false,
    verify: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help' || argument === '-h') options.help = true;
    else if (argument === '--execute') options.execute = true;
    else if (argument === '--allow-live-project') options.allowLiveProject = true;
    else if (argument === '--resume') options.resume = true;
    else if (argument === '--verify') options.verify = true;
    else if ([
      '--approve-fingerprint',
      '--approved-report',
      '--auth',
      '--checkpoint',
      '--confirm-project',
      '--cutover-id',
      '--cutover-verification-report',
      '--project',
      '--report',
      '--result',
    ].includes(argument)) {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${argument}.`);
      index += 1;
      if (argument === '--approve-fingerprint') options.approveFingerprint = value;
      if (argument === '--approved-report') options.approvedReportPath = path.resolve(value);
      if (argument === '--auth') options.authMode = value;
      if (argument === '--checkpoint') options.checkpointPath = path.resolve(value);
      if (argument === '--confirm-project') options.confirmProject = value;
      if (argument === '--cutover-id') options.cutoverId = value;
      if (argument === '--cutover-verification-report') {
        options.cutoverVerificationReportPath = path.resolve(value);
      }
      if (argument === '--project') options.projectId = value;
      if (argument === '--report') options.reportPath = path.resolve(value);
      if (argument === '--result') options.resultPath = path.resolve(value);
    } else throw new Error(`Unknown argument: ${argument}`);
  }
  if (options.help) return options;
  if (!options.projectId) throw new Error('Explicit --project is required.');
  if (!DRAIN_ID_PATTERN.test(options.cutoverId) || !options.cutoverVerificationReportPath) {
    throw new Error('Exact --cutover-id and --cutover-verification-report are required.');
  }
  if (!AUTH_MODES.has(options.authMode)) throw new Error('--auth must be exactly admin or firebase-cli.');
  if (options.verify && options.execute) throw new Error('--verify cannot be combined with --execute.');
  if (options.resume && !options.execute) throw new Error('--resume is valid only with --execute.');
  if (options.execute) {
    if (!options.approvedReportPath || !SHA256_PATTERN.test(options.approveFingerprint)) {
      throw new Error('--execute requires --approved-report and an exact --approve-fingerprint.');
    }
  } else if (options.approvedReportPath || options.approveFingerprint) {
    throw new Error('Approval arguments are valid only with --execute.');
  }
  options.reportPath ||= defaultPath(options.verify ? 'compaction-verify' : 'compaction-plan');
  options.resultPath ||= defaultPath('compaction-execute');
  options.checkpointPath ||= defaultPath('compaction-checkpoint');
  return options;
};

const archiveSnapshotFromFirestore = (marker, fields) => ({
  marker: {
    exists: marker.exists,
    path: marker.ref.path,
    data: marker.exists ? marker.data() : undefined,
  },
  fields: fields.docs.map((document) => ({
    exists: true,
    path: document.ref.path,
    data: document.data(),
  })),
});

const createAdminBackend = async (projectId, authMode = 'admin') => {
  const previousCredentials = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const temporaryAdc = authMode === 'firebase-cli'
    ? await createFirebaseCliAdcFile({projectId, cwd: path.resolve(__dirname, '..', '..')})
    : null;
  if (temporaryAdc) process.env.GOOGLE_APPLICATION_CREDENTIALS = temporaryAdc.filePath;
  let app = null;
  let cleaned = false;
  let FieldPath;
  let FieldValue;
  let firestore;
  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    try {
      if (app) await app.delete();
    } finally {
      try {
        temporaryAdc?.cleanup();
      } finally {
        if (previousCredentials === undefined) delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
        else process.env.GOOGLE_APPLICATION_CREDENTIALS = previousCredentials;
      }
    }
  };
  try {
    const admin = require('firebase-admin');
    const appName = `task05-compaction-${process.pid}-${Date.now()}`;
    app = admin.initializeApp({projectId}, appName);
    firestore = app.firestore();
    ({FieldPath, FieldValue} = require('firebase-admin/firestore'));
  } catch (error) {
    try {
      await cleanup();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Compaction backend initialization and cleanup failed.');
    }
    throw error;
  }
  const configReference = firestore.doc(CONFIG_PATH);

  const readArchive = async (uid) => {
    const markerReference = firestore.doc(archiveMarkerPath(uid));
    const [marker, fields] = await Promise.all([
      markerReference.get(),
      markerReference.collection(ARCHIVE_FIELDS_COLLECTION).get(),
    ]);
    return archiveSnapshotFromFirestore(marker, fields);
  };

  const readUserBundle = async (uid, suppliedRoot = null) => {
    const rootReference = firestore.doc(`users/${uid}`);
    const stateReferences = REQUIRED_STATE_DOCUMENTS.map((stateId) => (
      firestore.doc(`users/${uid}/state/${stateId}`)
    ));
    const [root, stateSnapshots, collectionSnapshots, archive, deletionJob] = await Promise.all([
      suppliedRoot?.ref ? Promise.resolve(suppliedRoot) : rootReference.get(),
      firestore.getAll(...stateReferences),
      Promise.all(V2_DYNAMIC_COLLECTIONS.map((collectionId) => (
        rootReference.collection(collectionId).get()
      ))),
      readArchive(uid),
      firestore.doc(`user_deletion_jobs/${uid}`).get(),
    ]);
    return {
      root: {exists: root.exists, data: root.exists ? root.data() : undefined},
      states: Object.fromEntries(stateSnapshots.map((snapshot, index) => [
        REQUIRED_STATE_DOCUMENTS[index],
        {exists: snapshot.exists, data: snapshot.exists ? snapshot.data() : undefined},
      ])),
      collections: Object.fromEntries(collectionSnapshots.map((snapshot, index) => [
        V2_DYNAMIC_COLLECTIONS[index],
        snapshot.docs.map((document) => ({data: document.data()})),
      ])),
      archive,
      deletionJob: {
        exists: deletionJob.exists,
        data: deletionJob.exists ? deletionJob.data() : undefined,
      },
    };
  };

  const verifyUser = async ({entry}) => {
    const bundle = await readUserBundle(entry.uid);
    const issues = v2StructureIssues(bundle);
    if (issues.length) throw new Error('V2 structure changed during compaction.');
    if (
      Object.values(bundle.states || {}).filter((state) => state?.exists).length
        !== entry.v2StateDocuments
      || canonicalHash(v2CollectionCounts(bundle)) !== canonicalHash(entry.v2CollectionCounts)
    ) {
      throw new Error('V2 document counts changed during compaction.');
    }
    const currentLegacy = legacyRootData(bundle.root.data || {});
    if (entry.legacyFields.length > 0) {
      const archive = parseCompactionArchive(entry.uid, bundle.archive);
      if (
        Object.keys(currentLegacy).length !== 0
        || !archive.exists
        || archive.issues.length > 0
        || hashDocumentSet(archive.documents) !== entry.archiveFingerprint
      ) {
        throw new Error('Post-compaction archive or root verification failed.');
      }
    } else if (Object.keys(currentLegacy).length !== 0) {
      throw new Error('A native V2 root gained legacy fields during compaction.');
    }
  };

  const compactUser = async ({
    configFingerprint,
    cutoverAttestationFingerprint,
    cutoverId,
    entry,
  }) => {
    const rootReference = firestore.doc(`users/${entry.uid}`);
    const archiveReference = firestore.doc(archiveMarkerPath(entry.uid));
    const cutoverReference = firestore.doc(`${CUTOVER_ATTESTATION_ROOT}/${cutoverId}`);
    const deletionJobReference = firestore.doc(`user_deletion_jobs/${entry.uid}`);
    const stateReferences = REQUIRED_STATE_DOCUMENTS.map((stateId) => (
      firestore.doc(`users/${entry.uid}/state/${stateId}`)
    ));
    await firestore.runTransaction(async (transaction) => {
      const fixedSnapshots = await transaction.getAll(
        configReference,
        cutoverReference,
        rootReference,
        deletionJobReference,
        archiveReference,
        ...stateReferences
      );
      const [config, cutoverAttestation, root, deletionJob, archiveMarker, ...states] = fixedSnapshots;
      const [archiveFields, ...collectionSnapshots] = await Promise.all([
        transaction.get(archiveReference.collection(ARCHIVE_FIELDS_COLLECTION)),
        ...V2_DYNAMIC_COLLECTIONS.map((collectionId) => (
          transaction.get(rootReference.collection(collectionId))
        )),
      ]);
      if (!config.exists || canonicalHash(config.data() || {}) !== configFingerprint || configIssues(config.data()).length) {
        throw new Error('Rollout configuration changed after compaction approval.');
      }
      if (
        !cutoverAttestation.exists
        || canonicalHash(cutoverAttestation.data() || {}) !== cutoverAttestationFingerprint
      ) {
        throw new Error('Completed cutover attestation changed after compaction approval.');
      }
      if (!root.exists || canonicalHash(root.data() || {}) !== entry.sourceHash) {
        throw new Error('User root changed after compaction approval.');
      }
      if (root.get('deletionState') === 'pending' || activeDeletionJob({
        exists: deletionJob.exists,
        data: deletionJob.exists ? deletionJob.data() : undefined,
      })) {
        throw new Error('User deletion became active during compaction.');
      }
      if (root.get('modelVersion') !== MODEL_VERSION || states.some((state) => (
        !state.exists || state.get('schemaVersion') !== MODEL_VERSION
      ))) {
        throw new Error('Required V2 state changed after compaction approval.');
      }
      const transactionCollectionCounts = Object.fromEntries(
        collectionSnapshots.map((snapshot, index) => [
          V2_DYNAMIC_COLLECTIONS[index],
          snapshot.size,
        ])
      );
      if (
        canonicalHash(transactionCollectionCounts) !== canonicalHash(entry.v2CollectionCounts)
        || collectionSnapshots.some((snapshot) => snapshot.docs.some(
          (document) => document.get('schemaVersion') !== MODEL_VERSION
        ))
      ) {
        throw new Error('V2 collection state changed after compaction approval.');
      }
      const currentLegacy = legacyRootData(root.data() || {});
      if (
        canonicalHash(currentLegacy) !== entry.legacyPayloadHash
        || canonicalHash(Object.keys(currentLegacy).sort()) !== canonicalHash(entry.legacyFields)
      ) {
        throw new Error('Legacy root payload changed after compaction approval.');
      }
      const currentArchive = archiveSnapshotFromFirestore(archiveMarker, archiveFields);
      const parsedArchive = parseCompactionArchive(entry.uid, currentArchive);
      if (archiveMarker.exists || !archiveFields.empty) {
        if (
          !parsedArchive.exists
          || parsedArchive.issues.length > 0
          || hashDocumentSet(parsedArchive.documents) !== entry.archiveFingerprint
        ) {
          throw new Error('Existing compaction archive conflicts with the approved plan.');
        }
      } else {
        entry.expectedArchiveDocuments.forEach((document) => {
          transaction.create(firestore.doc(document.path), document.data);
        });
      }
      transaction.update(rootReference, Object.fromEntries(
        entry.legacyFields.map((field) => [field, FieldValue.delete()])
      ));
    });
    await verifyUser({entry});
  };

  return {
    readConfig: async () => {
      const snapshot = await configReference.get();
      return {exists: snapshot.exists, data: snapshot.exists ? snapshot.data() : undefined};
    },
    readCutoverAttestation: async (cutoverId) => {
      const snapshot = await firestore.doc(`${CUTOVER_ATTESTATION_ROOT}/${cutoverId}`).get();
      return {exists: snapshot.exists, data: snapshot.exists ? snapshot.data() : undefined};
    },
    listUsers: async () => {
      const documents = [];
      let cursor = null;
      do {
        let query = firestore.collection('users').orderBy(FieldPath.documentId()).limit(100);
        if (cursor) query = query.startAfter(cursor);
        const snapshot = await query.get();
        documents.push(...snapshot.docs);
        cursor = snapshot.docs.length === 100 ? snapshot.docs[snapshot.docs.length - 1] : null;
      } while (cursor);
      return documents;
    },
    readUserBundle,
    compactUser,
    verifyUser,
    close: cleanup,
  };
};

const main = async (args = process.argv.slice(2), env = process.env) => {
  const options = parseArguments(args);
  if (options.help) {
    printHelp();
    return;
  }
  const target = assertSafeTarget(options, env);
  const cutoverVerificationReport = readJson(
    options.cutoverVerificationReportPath,
    'Completed cutover verification report'
  );
  const backend = await createAdminBackend(options.projectId, options.authMode);
  try {
    const plan = await buildCompactionPlan({
      backend,
      cutoverId: options.cutoverId,
      cutoverVerificationReport,
      projectId: options.projectId,
      requireCompacted: options.verify,
    });
    if (!options.execute) {
      writeJsonAtomic(options.reportPath, plan.report);
      console.log(JSON.stringify({
        mode: plan.report.mode,
        live: target.live,
        counts: plan.report.counts,
        planFingerprint: plan.report.planFingerprint,
        reportPath: options.reportPath,
      }, null, 2));
      if (plan.report.counts.errors > 0) process.exitCode = 2;
      return;
    }

    const approvedReport = readJson(options.approvedReportPath, 'Approved compaction report');
    assertApprovedReport({
      approvedFingerprint: options.approveFingerprint,
      approvedReport,
      projectId: options.projectId,
    });
    if (
      plan.report.counts.errors !== 0
      || plan.report.planFingerprint !== approvedReport.planFingerprint
    ) {
      throw new Error('Current compaction plan changed after approval. Re-plan before writing.');
    }
    const checkpoint = options.resume
      ? assertCheckpoint({
        checkpoint: readJson(options.checkpointPath, 'Compaction checkpoint'),
        planFingerprint: plan.report.planFingerprint,
        projectId: options.projectId,
      })
      : null;
    if (!options.resume && fs.existsSync(options.checkpointPath)) {
      throw new Error('Checkpoint already exists. Use --resume or choose a new checkpoint path.');
    }
    const execution = await executeCompactionPlan({
      backend,
      checkpoint,
      plan,
      projectId: options.projectId,
      onCheckpoint: async (nextCheckpoint) => writeJsonAtomic(options.checkpointPath, nextCheckpoint),
    });
    const verification = await buildCompactionPlan({
      backend,
      cutoverId: options.cutoverId,
      cutoverVerificationReport,
      projectId: options.projectId,
      requireCompacted: true,
    });
    if (
      verification.report.counts.errors !== 0
      || verification.report.counts.pending !== 0
      || verification.report.planFingerprint !== plan.report.planFingerprint
    ) {
      throw new Error('Final compaction verification failed. Preserve the checkpoint and archives.');
    }
    const result = {
      schemaVersion: COMPACTION_SCHEMA_VERSION,
      kind: 'task05-user-data-legacy-root-compaction-result',
      mode: 'execute',
      projectId: options.projectId,
      planFingerprint: plan.report.planFingerprint,
      verificationFingerprint: verification.report.planFingerprint,
      counts: verification.report.counts,
      processed: execution.processed,
      complete: execution.complete,
    };
    writeJsonAtomic(options.resultPath, result);
    console.log(JSON.stringify({
      mode: 'execute',
      live: target.live,
      complete: result.complete,
      processed: result.processed,
      counts: result.counts,
      planFingerprint: result.planFingerprint,
      checkpointPath: options.checkpointPath,
      resultPath: options.resultPath,
    }, null, 2));
  } finally {
    await backend.close();
  }
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  });
}

module.exports = {
  ARCHIVE_KIND,
  COMPACTION_SCHEMA_VERSION,
  LEGACY_ROOT_FIELDS,
  REPORT_KIND,
  REQUIRED_STATE_DOCUMENTS,
  V2_DYNAMIC_COLLECTIONS,
  approvalCore,
  assertApprovedReport,
  assertCheckpoint,
  assertSafeTarget,
  buildCompactionArchiveDocuments,
  buildCompactionPlan,
  compactedShellData,
  configIssues,
  executeCompactionPlan,
  hashDocumentSet,
  legacyRootData,
  parseArguments,
  parseCompactionArchive,
  summarizeVerificationSubjects,
  validateCompletedCutoverEvidence,
  v2CollectionCounts,
  v2StructureIssues,
};
