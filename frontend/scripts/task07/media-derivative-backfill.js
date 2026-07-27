#!/usr/bin/env node

'use strict';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const SUPPORTED_KINDS = new Set(['avatar', 'item', 'npc', 'foe', 'map', 'map-video']);
const BATCH_CONCURRENCY = 8;
const DEMO_PROJECT_ID = 'demo-fnd-perf';

const asString = (value) => typeof value === 'string' ? value.trim() : '';

const storagePathFromValue = (value) => {
  const text = asString(value);
  if (!text) return '';
  if (!text.includes('://')) return text;
  try {
    const parsed = new URL(text);
    const firebaseHost = [
      'firebasestorage.googleapis.com',
      'storage.googleapis.com',
      ...LOOPBACK_HOSTS,
    ].includes(parsed.hostname);
    if (!firebaseHost) return '';
    const encoded = parsed.pathname.split('/o/')[1];
    return encoded ? decodeURIComponent(encoded) : '';
  } catch {
    return '';
  }
};

const isCanonicalTask07Path = (value) => (
  /^media\/v1\/(?:avatar|item|npc|foe|map|map-video)\/[^/]+\/m_[a-f0-9]{40}\//
    .test(storagePathFromValue(value))
);

const collectMediaPaths = (value) => {
  const result = new Set();
  const visit = (entry, key = '') => {
    if (typeof entry === 'string') {
      if (/^(?:imagePath|imageUrl|image_url|posterPath|posterUrl|videoUrl|storagePath|path|url)$/i
        .test(key)) {
        const path = storagePathFromValue(entry);
        if (path) result.add(path);
      }
      return;
    }
    if (Array.isArray(entry)) {
      entry.forEach((nested) => visit(nested, key));
      return;
    }
    if (!entry || typeof entry !== 'object') return;
    Object.entries(entry).forEach(([nestedKey, nested]) => {
      if (nestedKey === 'media' &&
        Number(nested?.schemaVersion) === 1) return;
      visit(nested, nestedKey);
    });
  };
  visit(value);
  return [...result].sort();
};

const inferOwnerFromPath = (path, kind) => {
  const parts = storagePathFromValue(path).split('/');
  if (kind === 'npc' && parts[0] === 'echi_npcs') return parts[1] || '';
  if ((kind === 'map' || kind === 'map-video') && parts[0] === 'grigliata' &&
    parts[1] === 'backgrounds') return parts[2] || '';
  if (kind === 'foe' && parts[0] === 'foes') {
    return parts[1] === 'copies' ? parts[2] || '' : parts[1] || '';
  }
  if (parts[0] === 'users') return parts[1] || '';
  return '';
};

const buildLegacyMediaBackfillPlan = (records) => {
  const entries = [];
  const seen = new Set();
  records.forEach((record) => {
    const kind = asString(record.kind);
    const entityId = asString(record.entityId);
    if (!SUPPORTED_KINDS.has(kind) || !entityId) return;
    const referenceScope = kind === 'item'
      ? (
        record.referenceScope === 'global-catalog'
          ? 'global-catalog'
          : 'user-inventory'
      )
      : null;
    const data = record.data && typeof record.data === 'object' ?
      record.data :
      {};
    const paths = collectMediaPaths(data);
    paths.forEach((sourcePath) => {
      if (isCanonicalTask07Path(sourcePath)) return;
      const contentType = asString(data.contentType)
        .split(';')[0]
        .trim()
        .toLowerCase();
      const unsupportedWebm = kind === 'map-video' &&
        (contentType === 'video/webm' || /\.webm$/i.test(sourcePath));
      const ownerUid = asString(record.ownerUid) ||
        inferOwnerFromPath(sourcePath, kind);
      const key = `${kind}\u0000${referenceScope}\u0000${entityId}\u0000${sourcePath}`;
      if (seen.has(key)) return;
      seen.add(key);
      entries.push({
        kind,
        ownerUid,
        entityId,
        referenceScope,
        sourcePath,
        status: unsupportedWebm ?
          'unsupported-webm-fallback' :
          ownerUid ? 'needs-derivatives' : 'blocked-missing-owner',
        action: unsupportedWebm ?
          'retain-legacy-original-or-convert-explicitly' :
          ownerUid ?
            'prepare-upload-finalize-commit-confirm' :
            'resolve-owner-before-backfill',
      });
    });
  });
  entries.sort((left, right) => (
    left.kind.localeCompare(right.kind) ||
    String(left.referenceScope).localeCompare(String(right.referenceScope)) ||
    left.ownerUid.localeCompare(right.ownerUid) ||
    left.entityId.localeCompare(right.entityId) ||
    left.sourcePath.localeCompare(right.sourcePath)
  ));
  return {
    schemaVersion: 1,
    operation: 'task07-media-derivative-backfill',
    mode: 'dry-run',
    counts: {
      records: records.length,
      candidates: entries.length,
      ready: entries.filter(({status}) => status === 'needs-derivatives').length,
      fallback: entries.filter(({status}) => (
        status === 'unsupported-webm-fallback'
      )).length,
      blocked: entries.filter(({status}) => status !== 'needs-derivatives').length,
    },
    entries,
  };
};

const mapWithConcurrency = async (values, concurrency, worker) => {
  const results = new Array(values.length);
  let cursor = 0;
  const run = async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(values[index], index);
    }
  };
  await Promise.all(Array.from(
    {length: Math.min(concurrency, values.length)},
    () => run()
  ));
  return results;
};

const snapshotRecords = (snapshot, buildRecord) => (
  snapshot.docs.map((document) => buildRecord(
    document.id,
    document.data() || {}
  ))
);

const loadLegacyMediaRecords = async (db) => {
  const [users, catalogItems, npcs, foes, maps] = await Promise.all([
    db.collection('users').get(),
    db.collection('items').get(),
    db.collection('echi_npcs').get(),
    db.collection('foes').get(),
    db.collection('grigliata_backgrounds').get(),
  ]);
  const records = [
    ...snapshotRecords(users, (entityId, data) => ({
      kind: 'avatar',
      ownerUid: entityId,
      entityId,
      data: {
        imagePath: data.imagePath,
        imageUrl: data.imageUrl,
        media: data.media,
      },
    })),
    ...snapshotRecords(catalogItems, (entityId, data) => ({
      kind: 'item',
      ownerUid: asString(data.ownerUid) ||
        asString(data.createdBy) ||
        asString(data.updatedBy),
      entityId,
      referenceScope: 'global-catalog',
      data,
    })),
    ...snapshotRecords(npcs, (entityId, data) => ({
      kind: 'npc',
      ownerUid: asString(data.ownerUid) ||
        asString(data.createdBy) ||
        asString(data.updatedBy),
      entityId,
      data,
    })),
    ...snapshotRecords(foes, (entityId, data) => ({
      kind: 'foe',
      ownerUid: asString(data.ownerUid) ||
        asString(data.createdBy) ||
        asString(data.updatedBy),
      entityId,
      data,
    })),
    ...snapshotRecords(maps, (entityId, data) => ({
      kind: data.assetType === 'video' ||
        asString(data.contentType) === 'video/mp4' ?
        'map-video' : 'map',
      ownerUid: asString(data.ownerUid) ||
        asString(data.createdBy) ||
        asString(data.updatedBy),
      entityId,
      data,
    })),
  ];
  const inventoryByUser = await mapWithConcurrency(
    users.docs,
    BATCH_CONCURRENCY,
    async (user) => {
      const inventory = await user.ref.collection('inventory').get();
      return snapshotRecords(inventory, (entityId, data) => ({
        kind: 'item',
        ownerUid: user.id,
        entityId,
        referenceScope: 'user-inventory',
        data,
      }));
    }
  );
  return [...records, ...inventoryByUser.flat()];
};

const parseOptions = (argv) => {
  const valueAfter = (name) => {
    const index = argv.indexOf(name);
    if (index < 0) return '';
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new TypeError(`Missing value for ${name}.`);
    }
    return value;
  };
  if (argv.includes('--write') || argv.includes('--execute')) {
    throw new TypeError(
      'Task 07 legacy media backfill is dry-run-only; write mode is unavailable.'
    );
  }
  if (argv.includes('--allow-live-read')) {
    throw new TypeError(
      'Task 07 legacy media backfill is restricted to demo-fnd-perf.'
    );
  }
  const projectId = valueAfter('--project');
  if (!projectId) throw new TypeError('--project is required.');
  return {
    projectId,
    json: argv.includes('--json'),
  };
};

const isLoopbackEmulator = (value) => {
  const text = asString(value);
  if (!text) return false;
  try {
    const parsed = new URL(text.includes('://') ? text : `http://${text}`);
    return LOOPBACK_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
};

const assertReadOnlyTarget = (options, env = process.env) => {
  const emulator = isLoopbackEmulator(env.FIRESTORE_EMULATOR_HOST);
  if (options.projectId !== DEMO_PROJECT_ID) {
    throw new TypeError(
      `Task 07 media backfill only permits ${DEMO_PROJECT_ID}.`
    );
  }
  if (!emulator) {
    throw new TypeError(
      'Task 07 media backfill requires a loopback Firestore emulator.'
    );
  }
};

const printHelp = () => {
  console.log([
    'Build a read-only Task 07 derivative backfill plan.',
    '',
    'Usage:',
    '  node scripts/task07/media-derivative-backfill.js --project <project-id> [--json]',
    '',
    'The command never writes Firestore or Storage.',
    'It only reads demo-fnd-perf through a loopback Firestore emulator.',
  ].join('\n'));
};

const main = async (argv = process.argv.slice(2)) => {
  if (argv.includes('--help') || argv.includes('-h')) {
    printHelp();
    return;
  }
  const options = parseOptions(argv);
  assertReadOnlyTarget(options);
  const admin = require('firebase-admin');
  if (!admin.apps.length) {
    admin.initializeApp({projectId: options.projectId});
  }
  const records = await loadLegacyMediaRecords(admin.firestore());
  const report = buildLegacyMediaBackfillPlan(records);
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log([
    `Task 07 media derivative backfill (dry-run, ${options.projectId})`,
    `Records inspected: ${report.counts.records}`,
    `Candidates: ${report.counts.candidates}`,
    `Ready: ${report.counts.ready}`,
    `Blocked: ${report.counts.blocked}`,
  ].join('\n'));
  report.entries.slice(0, 50).forEach((entry) => {
    console.log(
      `- ${entry.kind}/${entry.entityId}: ${entry.sourcePath} (${entry.status})`
    );
  });
  if (report.entries.length > 50) {
    console.log(`... ${report.entries.length - 50} more`);
  }
  console.log('No writes performed.');
};

if (require.main === module) {
  main().catch((error) => {
    console.error('Task 07 media backfill failed:', error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  assertReadOnlyTarget,
  buildLegacyMediaBackfillPlan,
  collectMediaPaths,
  isCanonicalTask07Path,
  loadLegacyMediaRecords,
  parseOptions,
  storagePathFromValue,
};
