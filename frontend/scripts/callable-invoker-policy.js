#!/usr/bin/env node

'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  CALLABLE_AUDIT_REGIONS: AUDIT_REGIONS,
  PRIMARY_CALLABLE_REGION: PRODUCTION_WRITE_REGION,
  PRODUCTION_PROJECT_ID,
} = require('./production-target');
const REPORT_SCHEMA_VERSION = 1;
const INVOKER_ROLE = 'roles/run.invoker';
const PUBLIC_MEMBER = 'allUsers';
const FRONTEND_ROOT = path.resolve(__dirname, '..');
const MANIFEST_PATH = path.join(
  FRONTEND_ROOT,
  'src',
  'data',
  'functions',
  'callableManifest.json'
);
const DEFAULT_REPORT_PATH = path.join(
  FRONTEND_ROOT,
  'performance-results',
  'callable-invoker-policy-plan.json'
);

// Each region is an explicit allowlist. Adding a callable still requires an
// exact owner/alias review here. clientFirebaseConfig is intentionally absent:
// it is an onRequest endpoint used by the Hosting runtime-config rewrite, not
// an httpsCallable endpoint, and is audited separately from this manifest.
const REQUIRED_CALLABLES = Object.freeze([
  Object.freeze({
    logicalKey: 'deleteUser',
    owner: 'admin',
    compatibilityAliasOf: null,
  }),
  Object.freeze({
    logicalKey: 'updateUserRole',
    owner: 'admin',
    compatibilityAliasOf: null,
  }),
  Object.freeze({
    logicalKey: 'levelUpAll',
    owner: 'progression',
    compatibilityAliasOf: null,
  }),
  Object.freeze({
    logicalKey: 'levelUpUser',
    owner: 'progression',
    compatibilityAliasOf: null,
  }),
  Object.freeze({
    logicalKey: 'spendCharacterPointV2',
    owner: 'progression',
    compatibilityAliasOf: null,
  }),
  Object.freeze({
    logicalKey: 'task05PurchaseItem',
    owner: 'user-data-v2',
    compatibilityAliasOf: null,
  }),
  Object.freeze({
    logicalKey: 'task05AdjustGold',
    owner: 'user-data-v2',
    compatibilityAliasOf: null,
  }),
  Object.freeze({
    logicalKey: 'task05UpdateResource',
    owner: 'user-data-v2',
    compatibilityAliasOf: null,
  }),
  Object.freeze({
    logicalKey: 'task05UpdateGrigliataCharacterResources',
    owner: 'user-data-v2',
    compatibilityAliasOf: null,
  }),
  Object.freeze({
    logicalKey: 'task05SetEquipment',
    owner: 'user-data-v2',
    compatibilityAliasOf: null,
  }),
  Object.freeze({
    logicalKey: 'task05MutateInventory',
    owner: 'user-data-v2',
    compatibilityAliasOf: null,
  }),
  Object.freeze({
    logicalKey: 'task05MutatePersonalContent',
    owner: 'user-data-v2',
    compatibilityAliasOf: null,
  }),
  Object.freeze({
    logicalKey: 'task05UpdateProfile',
    owner: 'user-data-v2',
    compatibilityAliasOf: null,
  }),
  Object.freeze({
    logicalKey: 'task05UpdateSettings',
    owner: 'user-data-v2',
    compatibilityAliasOf: null,
  }),
  Object.freeze({
    logicalKey: 'task05UpdateProfileContent',
    owner: 'user-data-v2',
    compatibilityAliasOf: null,
  }),
  Object.freeze({
    logicalKey: 'task05UpdateProgression',
    owner: 'user-data-v2',
    compatibilityAliasOf: null,
  }),
  Object.freeze({
    logicalKey: 'task05PrepareConsumable',
    owner: 'user-data-v2',
    compatibilityAliasOf: null,
  }),
  Object.freeze({
    logicalKey: 'task05CommitConsumable',
    owner: 'user-data-v2',
    compatibilityAliasOf: null,
  }),
  Object.freeze({
    logicalKey: 'task05ListAdminUsers',
    owner: 'user-data-v2',
    compatibilityAliasOf: null,
  }),
  Object.freeze({
    logicalKey: 'task05CharacterCreation',
    owner: 'user-data-v2',
    compatibilityAliasOf: null,
  }),
  Object.freeze({
    logicalKey: 'task05ConsumeTurnEffects',
    owner: 'user-data-v2',
    compatibilityAliasOf: null,
  }),
  Object.freeze({
    logicalKey: 'task07ResolveCharacterMedia',
    owner: 'media-lifecycle',
    compatibilityAliasOf: null,
  }),
  Object.freeze({
    logicalKey: 'task07PrepareMediaUpload',
    owner: 'media-lifecycle',
    compatibilityAliasOf: null,
  }),
  Object.freeze({
    logicalKey: 'task07GetMediaStatus',
    owner: 'media-lifecycle',
    compatibilityAliasOf: null,
  }),
  Object.freeze({
    logicalKey: 'task07AttachMediaAsset',
    owner: 'media-lifecycle',
    compatibilityAliasOf: null,
  }),
  Object.freeze({
    logicalKey: 'task07ConfirmMediaReference',
    owner: 'media-lifecycle',
    compatibilityAliasOf: 'task07AttachMediaAsset',
  }),
  Object.freeze({
    logicalKey: 'task07AbandonMediaAsset',
    owner: 'media-lifecycle',
    compatibilityAliasOf: null,
  }),
  Object.freeze({
    logicalKey: 'task07RetireMediaAsset',
    owner: 'media-lifecycle',
    compatibilityAliasOf: null,
  }),
  Object.freeze({
    logicalKey: 'task07RetryMediaCleanup',
    owner: 'media-lifecycle',
    compatibilityAliasOf: null,
  }),
  Object.freeze({
    logicalKey: 'task07PrepareFoeMediaRetirement',
    owner: 'foe-media-retirement',
    compatibilityAliasOf: null,
  }),
  Object.freeze({
    logicalKey: 'task07CommitFoeMediaRetirement',
    owner: 'foe-media-retirement',
    compatibilityAliasOf: null,
  }),
  Object.freeze({
    logicalKey: 'task07AbandonFoeMediaRetirement',
    owner: 'foe-media-retirement',
    compatibilityAliasOf: null,
  }),
  Object.freeze({
    logicalKey: 'setAllParameterLocks',
    owner: 'backend-operations',
    compatibilityAliasOf: null,
  }),
  Object.freeze({
    logicalKey: 'deleteNpcV2',
    owner: 'backend-operations',
    compatibilityAliasOf: null,
  }),
  Object.freeze({
    logicalKey: 'deleteEncounterV2',
    owner: 'backend-operations',
    compatibilityAliasOf: null,
  }),
  Object.freeze({
    logicalKey: 'getBackendOperationStatus',
    owner: 'backend-operations',
    compatibilityAliasOf: null,
  }),
  Object.freeze({
    logicalKey: 'resumeBackendOperation',
    owner: 'backend-operations',
    compatibilityAliasOf: null,
  }),
  Object.freeze({
    logicalKey: 'duplicateFoeWithAssetsV2',
    owner: 'foes',
    compatibilityAliasOf: null,
  }),
]);

const REQUIRED_CALLABLES_BY_REGION = Object.freeze({
  [PRODUCTION_WRITE_REGION]: REQUIRED_CALLABLES,
  'europe-west1': Object.freeze([
    Object.freeze({
      logicalKey: 'duplicateFoeWithAssets',
      owner: 'foes',
      compatibilityAliasOf: 'duplicateFoeWithAssetsV2',
    }),
    Object.freeze({
      logicalKey: 'deleteGrigliataCustomToken',
      owner: 'grigliata',
      compatibilityAliasOf: null,
    }),
    Object.freeze({
      logicalKey: 'spawnGrigliataCustomTokenInstance',
      owner: 'grigliata',
      compatibilityAliasOf: null,
    }),
    Object.freeze({
      logicalKey: 'spawnGrigliataFoeToken',
      owner: 'grigliata',
      compatibilityAliasOf: null,
    }),
    Object.freeze({
      logicalKey: 'updateGrigliataCustomTokenTemplate',
      owner: 'grigliata',
      compatibilityAliasOf: null,
    }),
  ]),
  'us-central1': Object.freeze([
    Object.freeze({
      logicalKey: 'spendCharacterPoint',
      owner: 'progression-legacy',
      compatibilityAliasOf: 'spendCharacterPointV2',
    }),
  ]),
});

const printHelp = () => console.log([
  `Callable public-invoker verifier/reconciler for production ${PRODUCTION_PROJECT_ID}.`,
  '',
  'Usage:',
  '  node scripts/callable-invoker-policy.js',
  `    --project ${PRODUCTION_PROJECT_ID} --region <audited-region> [--check] [--report <path>]`,
  '  node scripts/callable-invoker-policy.js',
  `    --project ${PRODUCTION_PROJECT_ID} --region ${PRODUCTION_WRITE_REGION} --execute`,
  `    --allow-live-project --confirm-project ${PRODUCTION_PROJECT_ID}`,
  '    --approve-fingerprint <sha256> [--report <path>]',
  '',
  'Safety:',
  '  - Dry-run is the default and writes a deterministic local plan.',
  '  - --check is read-only and exits non-zero on any drift or blocker.',
  '  - Read-only audit regions: europe-west8, europe-west1, us-central1.',
  `  - Writes remain hard-locked to ${PRODUCTION_PROJECT_ID}/${PRODUCTION_WRITE_REGION}.`,
  '  - Execution requires the exact current dry-run fingerprint.',
  '  - Only exact reviewed manifest callables for the selected region are managed.',
  '  - Unrelated IAM bindings are retained and verified after every update.',
].join('\n'));

const parseArguments = (args = []) => {
  const options = {
    allowLiveProject: false,
    approveFingerprint: '',
    check: false,
    confirmProject: '',
    execute: false,
    help: false,
    projectId: '',
    region: '',
    reportPath: DEFAULT_REPORT_PATH,
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help' || argument === '-h') options.help = true;
    else if (argument === '--check') options.check = true;
    else if (argument === '--execute') options.execute = true;
    else if (argument === '--allow-live-project') options.allowLiveProject = true;
    else if ([
      '--project',
      '--region',
      '--report',
      '--approve-fingerprint',
      '--confirm-project',
    ].includes(argument)) {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`Missing value for ${argument}.`);
      }
      index += 1;
      if (argument === '--project') options.projectId = value;
      if (argument === '--region') options.region = value;
      if (argument === '--report') options.reportPath = path.resolve(value);
      if (argument === '--approve-fingerprint') options.approveFingerprint = value;
      if (argument === '--confirm-project') options.confirmProject = value;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (options.help) return options;
  if (options.projectId !== PRODUCTION_PROJECT_ID) {
    throw new Error(`This production operator accepts only project ${PRODUCTION_PROJECT_ID}.`);
  }
  if (!AUDIT_REGIONS.includes(options.region)) {
    throw new Error(
      `This isolated operator audits only regions: ${AUDIT_REGIONS.join(', ')}.`
    );
  }
  if (options.check && options.execute) {
    throw new Error('--check and --execute are mutually exclusive.');
  }
  if (options.execute) {
    if (options.region !== PRODUCTION_WRITE_REGION) {
      throw new Error(`Policy execution is hard-locked to ${PRODUCTION_PROJECT_ID}/${PRODUCTION_WRITE_REGION}.`);
    }
    if (!options.allowLiveProject || options.confirmProject !== PRODUCTION_PROJECT_ID) {
      throw new Error(
        `Execution requires --allow-live-project and exact --confirm-project ${PRODUCTION_PROJECT_ID}.`
      );
    }
    if (!/^[a-f0-9]{64}$/i.test(options.approveFingerprint)) {
      throw new Error('--execute requires an exact SHA-256 --approve-fingerprint.');
    }
  }
  return options;
};

const assertSafeEnvironment = (options, environment = process.env) => {
  for (const variable of ['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT']) {
    if (environment[variable] && environment[variable] !== options.projectId) {
      throw new Error(`${variable} does not match the explicit --project.`);
    }
  }
  if (environment.FUNCTIONS_EMULATOR || environment.FIREBASE_EMULATOR_HUB) {
    throw new Error('Callable IAM policy operations cannot run against emulators.');
  }
  return {
    projectId: options.projectId,
    region: options.region,
  };
};

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      if (value[key] !== undefined) result[key] = canonicalize(value[key]);
      return result;
    }, {});
  }
  return value;
};

const canonicalHash = (value) => crypto
  .createHash('sha256')
  .update(JSON.stringify(canonicalize(value)))
  .digest('hex');

const readManifest = (manifestPath = MANIFEST_PATH) => (
  JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
);

const selectManagedCallables = (manifest, region = PRODUCTION_WRITE_REGION) => {
  if (!manifest || manifest.schemaVersion !== 1) {
    throw new Error('callableManifest.json must use schemaVersion 1.');
  }
  if (!AUDIT_REGIONS.includes(region)) {
    throw new Error(`Unsupported callable audit region: ${region}.`);
  }
  if (!Array.isArray(manifest.supportedRegions)
    || !manifest.supportedRegions.includes(region)) {
    throw new Error(`Callable manifest must support ${region}.`);
  }
  const callables = manifest.callables || {};
  return REQUIRED_CALLABLES_BY_REGION[region].map((expected) => {
    const descriptor = callables[expected.logicalKey];
    if (!descriptor) {
      throw new Error(`Managed callable is missing from the manifest: ${expected.logicalKey}.`);
    }
    if (descriptor.functionId !== expected.logicalKey) {
      throw new Error(`Managed callable has unexpected functionId: ${expected.logicalKey}.`);
    }
    if (descriptor.region !== region) {
      throw new Error(`Managed callable has unexpected region: ${expected.logicalKey}.`);
    }
    if (descriptor.owner !== expected.owner) {
      throw new Error(`Managed callable has unexpected owner: ${expected.logicalKey}.`);
    }
    if (descriptor.compatibilityAliasOf !== expected.compatibilityAliasOf) {
      throw new Error(
        `Managed callable has unexpected compatibility alias: ${expected.logicalKey}.`
      );
    }
    return Object.freeze({
      logicalKey: expected.logicalKey,
      functionId: descriptor.functionId,
      owner: descriptor.owner,
      region: descriptor.region,
      compatibilityAliasOf: descriptor.compatibilityAliasOf,
    });
  });
};

const parseFunctionName = (name) => {
  const match = /^projects\/([^/]+)\/locations\/([^/]+)\/functions\/([^/]+)$/.exec(
    String(name || '')
  );
  if (!match) return null;
  return {projectId: match[1], region: match[2], functionId: match[3]};
};

const isExpectedServiceName = (serviceName, projectId, region) => (
  new RegExp(
    `^projects\\/${projectId}\\/locations\\/${region}\\/services\\/[a-z0-9-]+$`
  ).test(String(serviceName || ''))
);

const normalizeMembers = (members) => (
  [...new Set(members)].sort((left, right) => left.localeCompare(right))
);

const unrelatedIamFingerprint = (policy) => canonicalHash({
  auditConfigs: Array.isArray(policy?.auditConfigs) ? policy.auditConfigs : [],
  bindings: (Array.isArray(policy?.bindings) ? policy.bindings : [])
    .filter((binding) => binding?.role !== INVOKER_ROLE),
});

const assessInvokerPolicy = (policy) => {
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
    return {state: 'blocked', reason: 'malformed-iam-policy', members: []};
  }
  if (policy.bindings !== undefined && !Array.isArray(policy.bindings)) {
    return {state: 'blocked', reason: 'malformed-iam-bindings', members: []};
  }
  const invokerBindings = (policy.bindings || [])
    .filter((binding) => binding?.role === INVOKER_ROLE);
  if (invokerBindings.length > 1) {
    return {state: 'blocked', reason: 'multiple-invoker-bindings', members: []};
  }
  if (invokerBindings[0]?.condition) {
    return {state: 'blocked', reason: 'conditional-invoker-binding', members: []};
  }
  const rawMembers = invokerBindings[0]?.members || [];
  if (!Array.isArray(rawMembers) || rawMembers.some((member) => typeof member !== 'string')) {
    return {state: 'blocked', reason: 'malformed-invoker-members', members: []};
  }
  const members = normalizeMembers(rawMembers);
  const ready = members.length === 1 && members[0] === PUBLIC_MEMBER;
  return {
    state: ready ? 'ready' : 'repair',
    reason: ready ? null : 'public-invoker-missing',
    members,
  };
};

const relevantUnreachableRegions = (unreachable, region) => (
  (Array.isArray(unreachable) ? unreachable : [])
    .map((value) => String(value))
    .filter((value) => value === region || value.endsWith(`/locations/${region}`))
    .sort()
);

const buildPolicyPlan = async ({
  backend,
  manifest,
  projectId = PRODUCTION_PROJECT_ID,
  region = PRODUCTION_WRITE_REGION,
}) => {
  if (projectId !== PRODUCTION_PROJECT_ID || !AUDIT_REGIONS.includes(region)) {
    throw new Error(`Policy planning is hard-locked to ${PRODUCTION_PROJECT_ID} reviewed audit regions.`);
  }
  const managed = selectManagedCallables(manifest, region);
  const listing = await backend.listFunctions(projectId);
  const deployedById = new Map();
  const duplicateIds = new Set();
  for (const deployed of listing.functions || []) {
    const parsed = parseFunctionName(deployed.name);
    if (!parsed || parsed.projectId !== projectId || parsed.region !== region) continue;
    if (deployedById.has(parsed.functionId)) duplicateIds.add(parsed.functionId);
    deployedById.set(parsed.functionId, deployed);
  }

  const blockers = relevantUnreachableRegions(listing.unreachable, region)
    .map((unreachableRegion) => `Cloud Functions region is unreachable: ${unreachableRegion}.`);
  const entries = [];
  for (const descriptor of managed) {
    const deployed = deployedById.get(descriptor.functionId);
    const base = {...descriptor};
    if (duplicateIds.has(descriptor.functionId)) {
      blockers.push(`Duplicate deployed function: ${descriptor.functionId}.`);
      entries.push({...base, state: 'blocked', reason: 'duplicate-function'});
      continue;
    }
    if (!deployed) {
      blockers.push(`Managed callable is not deployed: ${descriptor.functionId}.`);
      entries.push({...base, state: 'blocked', reason: 'function-not-deployed'});
      continue;
    }
    if (deployed.labels?.['deployment-callable'] !== 'true') {
      blockers.push(`Managed endpoint is not labeled callable: ${descriptor.functionId}.`);
      entries.push({...base, state: 'blocked', reason: 'not-a-callable'});
      continue;
    }
    const serviceName = deployed.serviceConfig?.service || '';
    if (!isExpectedServiceName(serviceName, projectId, region)) {
      blockers.push(`Managed callable has an unsafe Cloud Run service path: ${descriptor.functionId}.`);
      entries.push({...base, state: 'blocked', reason: 'unsafe-service-path'});
      continue;
    }
    const policy = await backend.getIamPolicy(serviceName);
    const assessment = assessInvokerPolicy(policy);
    if (assessment.state === 'blocked') {
      blockers.push(
        `Managed callable has unsupported IAM shape: ${descriptor.functionId} (${assessment.reason}).`
      );
    }
    entries.push({
      ...base,
      serviceName,
      state: assessment.state,
      reason: assessment.reason,
      currentInvokerMembers: assessment.members,
      policyFingerprint: canonicalHash(policy),
      unrelatedIamFingerprint: unrelatedIamFingerprint(policy),
    });
  }

  const counts = entries.reduce((result, entry) => {
    result[entry.state] += 1;
    return result;
  }, {blocked: 0, ready: 0, repair: 0});
  const subject = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    projectId,
    region,
    desiredInvoker: PUBLIC_MEMBER,
    entries,
    blockers,
    counts,
  };
  return {
    mode: 'dry-run',
    ...subject,
    clean: counts.ready === managed.length,
    planFingerprint: canonicalHash(subject),
  };
};

const writeJsonAtomic = (filePath, value) => {
  fs.mkdirSync(path.dirname(filePath), {recursive: true});
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, filePath);
};

const assertApprovedPlan = ({approved, current, approveFingerprint}) => {
  if (approved?.mode !== 'dry-run'
    || approved?.planFingerprint !== approveFingerprint
    || current?.planFingerprint !== approveFingerprint
    || canonicalHash(approved) !== canonicalHash(current)) {
    throw new Error('Approved IAM plan does not exactly match current deployed state. Re-plan.');
  }
  if (current.blockers.length > 0) {
    throw new Error('IAM reconciliation is blocked; resolve every plan blocker first.');
  }
  if (current.counts.repair === 0) {
    throw new Error('IAM reconciliation has no changes to apply.');
  }
};

const executePolicyPlan = async ({backend, manifest, plan}) => {
  if (plan.projectId !== PRODUCTION_PROJECT_ID || plan.region !== PRODUCTION_WRITE_REGION) {
    throw new Error(`Policy execution is hard-locked to ${PRODUCTION_PROJECT_ID}/${PRODUCTION_WRITE_REGION}.`);
  }
  if (plan.blockers.length > 0) {
    throw new Error('IAM reconciliation is blocked; no IAM writes were attempted.');
  }
  const updated = [];
  for (const entry of plan.entries.filter(({state}) => state === 'repair')) {
    const currentPolicy = await backend.getIamPolicy(entry.serviceName);
    if (canonicalHash(currentPolicy) !== entry.policyFingerprint) {
      throw new Error(`IAM policy changed before write for ${entry.functionId}. Re-plan.`);
    }
    await backend.setInvokerUpdate(
      PRODUCTION_PROJECT_ID,
      entry.serviceName,
      ['public']
    );
    const verifiedPolicy = await backend.getIamPolicy(entry.serviceName);
    const verified = assessInvokerPolicy(verifiedPolicy);
    if (verified.state !== 'ready') {
      throw new Error(`Post-write public-invoker verification failed for ${entry.functionId}.`);
    }
    if (unrelatedIamFingerprint(verifiedPolicy) !== entry.unrelatedIamFingerprint) {
      throw new Error(`Post-write unrelated IAM verification failed for ${entry.functionId}.`);
    }
    updated.push(entry.functionId);
  }
  const finalPlan = await buildPolicyPlan({
    backend,
    manifest,
    projectId: PRODUCTION_PROJECT_ID,
    region: PRODUCTION_WRITE_REGION,
  });
  if (!finalPlan.clean || finalPlan.blockers.length > 0 || finalPlan.counts.repair > 0) {
    throw new Error('Final callable IAM verification is not clean.');
  }
  return {updated, finalPlan};
};

const createFirebaseToolsBackend = async ({projectId, cwd = FRONTEND_ROOT}) => {
  const auth = require('firebase-tools/lib/auth');
  const {requireAuth} = require('firebase-tools/lib/requireAuth');
  const cloudfunctionsv2 = require('firebase-tools/lib/gcp/cloudfunctionsv2');
  const run = require('firebase-tools/lib/gcp/run');
  const account = auth.selectAccount(undefined, cwd);
  if (!account) {
    throw new Error('No Firebase CLI account is logged in. Run firebase login first.');
  }
  const options = {cwd, project: projectId};
  auth.setActiveAccount(options, account);
  await requireAuth(options, true);
  return {
    getIamPolicy: (serviceName) => run.getIamPolicy(serviceName),
    listFunctions: (targetProjectId) => cloudfunctionsv2.listAllFunctions(targetProjectId),
    setInvokerUpdate: (targetProjectId, serviceName, invoker) => (
      run.setInvokerUpdate(targetProjectId, serviceName, invoker)
    ),
  };
};

const summarize = (plan, extra = {}) => ({
  ...extra,
  projectId: plan.projectId,
  region: plan.region,
  managedCallableCount: plan.entries.length,
  counts: plan.counts,
  clean: plan.clean,
  blockers: plan.blockers,
  planFingerprint: plan.planFingerprint,
});

const main = async ({
  args = process.argv.slice(2),
  environment = process.env,
  backendFactory = createFirebaseToolsBackend,
  manifest = null,
} = {}) => {
  const options = parseArguments(args);
  if (options.help) {
    printHelp();
    return {help: true};
  }
  assertSafeEnvironment(options, environment);
  const resolvedManifest = manifest || readManifest();
  const backend = await backendFactory({projectId: options.projectId});
  const plan = await buildPolicyPlan({
    backend,
    manifest: resolvedManifest,
    projectId: options.projectId,
    region: options.region,
  });

  if (options.check) {
    console.log(JSON.stringify(summarize(plan, {mode: 'check'}), null, 2));
    if (!plan.clean) process.exitCode = 1;
    return plan;
  }
  if (!options.execute) {
    writeJsonAtomic(options.reportPath, plan);
    console.log(JSON.stringify(summarize(plan, {
      mode: 'dry-run',
      reportPath: options.reportPath,
    }), null, 2));
    if (plan.blockers.length > 0) process.exitCode = 1;
    return plan;
  }

  const approved = JSON.parse(fs.readFileSync(options.reportPath, 'utf8'));
  assertApprovedPlan({
    approved,
    current: plan,
    approveFingerprint: options.approveFingerprint,
  });
  const result = await executePolicyPlan({
    backend,
    manifest: resolvedManifest,
    plan,
  });
  console.log(JSON.stringify(summarize(result.finalPlan, {
    mode: 'execute',
    updated: result.updated,
  }), null, 2));
  return result;
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  });
}

module.exports = {
  AUDIT_REGIONS,
  DEFAULT_REPORT_PATH,
  REQUIRED_CALLABLES,
  REQUIRED_CALLABLES_BY_REGION,
  PRODUCTION_PROJECT_ID,
  PRODUCTION_WRITE_REGION,
  assertApprovedPlan,
  assertSafeEnvironment,
  assessInvokerPolicy,
  buildPolicyPlan,
  canonicalHash,
  executePolicyPlan,
  main,
  parseArguments,
  selectManagedCallables,
  unrelatedIamFingerprint,
};
