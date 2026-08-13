'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  AUDIT_REGIONS,
  PRODUCTION_PROJECT_ID,
  PRODUCTION_WRITE_REGION,
  REQUIRED_CALLABLES,
  REQUIRED_CALLABLES_BY_REGION,
  assertApprovedPlan,
  assessInvokerPolicy,
  buildPolicyPlan,
  executePolicyPlan,
  parseArguments,
  selectManagedCallables,
} = require('./callable-invoker-policy');

const PROJECT_ID = PRODUCTION_PROJECT_ID;
const REGION = PRODUCTION_WRITE_REGION;
const serviceNameFor = (functionId, region = REGION) => (
  `projects/${PROJECT_ID}/locations/${region}/services/${functionId.toLowerCase()}`
);
const functionFor = (functionId, region = REGION) => ({
  name: `projects/${PROJECT_ID}/locations/${region}/functions/${functionId}`,
  labels: {'deployment-callable': 'true'},
  serviceConfig: {service: serviceNameFor(functionId, region)},
});
const publicPolicy = (extraBindings = []) => ({
  bindings: [
    ...extraBindings,
    {role: 'roles/run.invoker', members: ['allUsers']},
  ],
  etag: 'public-etag',
  version: 3,
});
const privatePolicy = (extraBindings = []) => ({
  bindings: [...extraBindings],
  etag: 'private-etag',
  version: 3,
});

const createManifest = () => ({
  schemaVersion: 1,
  supportedRegions: [REGION, 'europe-west1'],
  callables: Object.fromEntries(REQUIRED_CALLABLES.map((entry) => [
    entry.logicalKey,
    {
      functionId: entry.logicalKey,
      region: REGION,
      owner: entry.owner,
      compatibilityAliasOf: entry.compatibilityAliasOf,
    },
  ])),
});

const addRegionCallables = (manifest, region) => {
  REQUIRED_CALLABLES_BY_REGION[region].forEach((entry) => {
    manifest.callables[entry.logicalKey] = {
      functionId: entry.logicalKey,
      region,
      owner: entry.owner,
      compatibilityAliasOf: entry.compatibilityAliasOf,
    };
  });
  return manifest;
};

const createBackend = ({policies, functions = null, setter = null} = {}) => {
  const calls = [];
  const policyMap = new Map(Object.entries(policies || {}));
  return {
    calls,
    policies: policyMap,
    listFunctions: async () => ({
      functions: functions || REQUIRED_CALLABLES.map(({logicalKey}) => (
        functionFor(logicalKey)
      )),
      unreachable: [],
    }),
    getIamPolicy: async (serviceName) => structuredClone(policyMap.get(serviceName)),
    setInvokerUpdate: async (projectId, serviceName, invoker) => {
      calls.push({projectId, serviceName, invoker});
      if (setter) return setter({policyMap, projectId, serviceName, invoker});
      const existing = policyMap.get(serviceName);
      policyMap.set(serviceName, {
        ...existing,
        bindings: [
          ...(existing.bindings || []).filter(({role}) => role !== 'roles/run.invoker'),
          {role: 'roles/run.invoker', members: ['allUsers']},
        ],
        etag: `${existing.etag}-updated`,
        version: 3,
      });
    },
  };
};

const allPolicies = (replacement = {}) => Object.fromEntries(
  REQUIRED_CALLABLES.map(({logicalKey}) => [
    serviceNameFor(logicalKey),
    replacement[logicalKey] || publicPolicy(),
  ])
);

test('CLI is dry-run by default and is hard-locked to production', () => {
  const options = parseArguments([
    '--project', PROJECT_ID,
    '--region', REGION,
  ]);
  assert.equal(options.execute, false);
  assert.equal(options.check, false);
  assert.throws(
    () => parseArguments(['--project', 'fatin-test', '--region', REGION]),
    /accepts only project fatins/
  );
  assert.throws(
    () => parseArguments(['--project', PROJECT_ID, '--region', 'asia-east1']),
    /audits only regions/
  );
  assert.deepEqual(AUDIT_REGIONS, [
    'europe-west8',
    'europe-west1',
  ]);
  assert.equal(parseArguments([
    '--project', PROJECT_ID,
    '--region', 'europe-west1',
    '--check',
  ]).check, true);
});

test('execution requires exact project confirmation and plan fingerprint', () => {
  assert.throws(
    () => parseArguments([
      '--project', PROJECT_ID,
      '--region', REGION,
      '--execute',
      '--approve-fingerprint', 'a'.repeat(64),
    ]),
    /allow-live-project/
  );
  assert.throws(
    () => parseArguments([
      '--project', PROJECT_ID,
      '--region', REGION,
      '--execute',
      '--allow-live-project',
      '--confirm-project', PROJECT_ID,
      '--approve-fingerprint', 'not-a-fingerprint',
    ]),
    /exact SHA-256/
  );
  const options = parseArguments([
    '--project', PROJECT_ID,
    '--region', REGION,
    '--execute',
    '--allow-live-project',
    '--confirm-project', PROJECT_ID,
    '--approve-fingerprint', 'a'.repeat(64),
  ]);
  assert.equal(options.execute, true);
  assert.throws(
    () => parseArguments([
      '--project', PROJECT_ID,
      '--region', 'europe-west1',
      '--execute',
      '--allow-live-project',
      '--confirm-project', PROJECT_ID,
      '--approve-fingerprint', 'a'.repeat(64),
    ]),
    /execution is hard-locked to fatins\/europe-west8/i
  );
  assert.throws(
    () => parseArguments([
      '--project', PROJECT_ID,
      '--region', REGION,
      '--check',
      '--execute',
      '--allow-live-project',
      '--confirm-project', PROJECT_ID,
      '--approve-fingerprint', 'a'.repeat(64),
    ]),
    /mutually exclusive/
  );
});

test('manifest selection is exact and owner-validated in every audit region', () => {
  const manifest = addRegionCallables(createManifest(), 'europe-west1');
  const selected = selectManagedCallables(manifest);
  assert.equal(selected.length, 38);
  assert.deepEqual(
    selected.map(({logicalKey}) => logicalKey),
    REQUIRED_CALLABLES.map(({logicalKey}) => logicalKey)
  );
  assert.deepEqual(
    selectManagedCallables(manifest, 'europe-west1').map(({logicalKey}) => logicalKey),
    REQUIRED_CALLABLES_BY_REGION['europe-west1'].map(({logicalKey}) => logicalKey)
  );
  manifest.callables.task05AdjustGold.owner = 'admin';
  assert.throws(() => selectManagedCallables(manifest), /unexpected owner/);
});

test('secondary-region plans are read-only and execution remains west8-only', async () => {
  const region = 'europe-west1';
  const expected = REQUIRED_CALLABLES_BY_REGION[region];
  const policies = Object.fromEntries(expected.map(({logicalKey}) => [
    serviceNameFor(logicalKey, region),
    publicPolicy(),
  ]));
  const backend = createBackend({
    policies,
    functions: expected.map(({logicalKey}) => functionFor(logicalKey, region)),
  });
  const plan = await buildPolicyPlan({
    backend,
    manifest: addRegionCallables(createManifest(), region),
    projectId: PROJECT_ID,
    region,
  });
  assert.deepEqual(plan.counts, {blocked: 0, ready: 5, repair: 0});
  assert.equal(plan.clean, true);
  await assert.rejects(
    () => executePolicyPlan({backend, manifest: createManifest(), plan}),
    /execution is hard-locked to fatins\/europe-west8/i
  );
  assert.equal(backend.calls.length, 0);
});

test('compatibility alias identity is part of manifest validation', () => {
  const manifest = createManifest();
  manifest.callables.task07ConfirmMediaReference.compatibilityAliasOf = null;
  assert.throws(() => selectManagedCallables(manifest), /unexpected compatibility alias/);
});

test('policy assessment fails closed on IAM shapes the Firebase helper cannot safely repair', () => {
  assert.equal(assessInvokerPolicy({bindings: []}).state, 'repair');
  assert.equal(assessInvokerPolicy(publicPolicy()).state, 'ready');
  assert.deepEqual(
    assessInvokerPolicy({
      bindings: [{
        role: 'roles/run.invoker',
        members: ['allUsers'],
        condition: {title: 'conditional'},
      }],
    }),
    {state: 'blocked', reason: 'conditional-invoker-binding', members: []}
  );
  assert.equal(assessInvokerPolicy({
    bindings: [
      {role: 'roles/run.invoker', members: ['allUsers']},
      {role: 'roles/run.invoker', members: ['user:test@example.com']},
    ],
  }).reason, 'multiple-invoker-bindings');
});

test('dry-run plan is deterministic and reports only the one repairable managed drift', async () => {
  const unrelated = {role: 'roles/viewer', members: ['user:auditor@example.com']};
  const backend = createBackend({
    policies: allPolicies({
      task05AdjustGold: privatePolicy([unrelated]),
    }),
    functions: [
      ...REQUIRED_CALLABLES.map(({logicalKey}) => functionFor(logicalKey)),
      functionFor('deleteGrigliataCustomToken'),
    ],
  });
  const first = await buildPolicyPlan({
    backend,
    manifest: createManifest(),
    projectId: PROJECT_ID,
    region: REGION,
  });
  const second = await buildPolicyPlan({
    backend,
    manifest: createManifest(),
    projectId: PROJECT_ID,
    region: REGION,
  });
  assert.equal(first.planFingerprint, second.planFingerprint);
  assert.deepEqual(first.counts, {blocked: 0, ready: 37, repair: 1});
  assert.equal(first.clean, false);
  assert.equal(first.entries.find(({functionId}) => (
    functionId === 'task05AdjustGold'
  )).state, 'repair');
  assert.equal(first.entries.some(({functionId}) => (
    functionId === 'deleteGrigliataCustomToken'
  )), false);
});

test('missing or non-callable deployments block the whole plan before writes', async () => {
  const functions = REQUIRED_CALLABLES
    .filter(({logicalKey}) => logicalKey !== 'task05AdjustGold')
    .map(({logicalKey}) => functionFor(logicalKey));
  functions.find(({name}) => name.endsWith('/task05PurchaseItem')).labels = {};
  const backend = createBackend({policies: allPolicies(), functions});
  const plan = await buildPolicyPlan({
    backend,
    manifest: createManifest(),
    projectId: PROJECT_ID,
    region: REGION,
  });
  assert.equal(plan.counts.blocked, 2);
  assert.match(plan.blockers.join('\n'), /task05AdjustGold/);
  assert.match(plan.blockers.join('\n'), /task05PurchaseItem/);
  await assert.rejects(
    () => executePolicyPlan({backend, manifest: createManifest(), plan}),
    /no IAM writes were attempted/
  );
  assert.equal(backend.calls.length, 0);
});

test('approval binds the exact current dry-run report and fingerprint', async () => {
  const backend = createBackend({
    policies: allPolicies({task05AdjustGold: privatePolicy()}),
  });
  const plan = await buildPolicyPlan({
    backend,
    manifest: createManifest(),
    projectId: PROJECT_ID,
    region: REGION,
  });
  assert.doesNotThrow(() => assertApprovedPlan({
    approved: structuredClone(plan),
    current: plan,
    approveFingerprint: plan.planFingerprint,
  }));
  const changed = structuredClone(plan);
  changed.entries[0].serviceName = serviceNameFor('another-service');
  assert.throws(() => assertApprovedPlan({
    approved: changed,
    current: plan,
    approveFingerprint: plan.planFingerprint,
  }), /does not exactly match/);
});

test('execution updates only planned drift, preserves unrelated IAM, and fully re-verifies', async () => {
  const unrelated = {
    role: 'roles/logging.viewer',
    members: ['serviceAccount:audit@fatins.iam.gserviceaccount.com'],
  };
  const backend = createBackend({
    policies: allPolicies({
      task05AdjustGold: privatePolicy([unrelated]),
    }),
  });
  const manifest = createManifest();
  const plan = await buildPolicyPlan({
    backend,
    manifest,
    projectId: PROJECT_ID,
    region: REGION,
  });
  const result = await executePolicyPlan({backend, manifest, plan});
  assert.deepEqual(result.updated, ['task05AdjustGold']);
  assert.deepEqual(backend.calls, [{
    projectId: PROJECT_ID,
    serviceName: serviceNameFor('task05AdjustGold'),
    invoker: ['public'],
  }]);
  assert.deepEqual(
    backend.policies.get(serviceNameFor('task05AdjustGold')).bindings[0],
    unrelated
  );
  assert.equal(result.finalPlan.clean, true);
  assert.deepEqual(result.finalPlan.counts, {blocked: 0, ready: 38, repair: 0});
});

test('execution refuses stale IAM and verifies the write result', async () => {
  const manifest = createManifest();
  const staleBackend = createBackend({
    policies: allPolicies({task05AdjustGold: privatePolicy()}),
  });
  const stalePlan = await buildPolicyPlan({
    backend: staleBackend,
    manifest,
    projectId: PROJECT_ID,
    region: REGION,
  });
  staleBackend.policies.set(
    serviceNameFor('task05AdjustGold'),
    privatePolicy([{role: 'roles/viewer', members: ['user:changed@example.com']}])
  );
  await assert.rejects(
    () => executePolicyPlan({backend: staleBackend, manifest, plan: stalePlan}),
    /changed before write/
  );
  assert.equal(staleBackend.calls.length, 0);

  const noOpBackend = createBackend({
    policies: allPolicies({task05AdjustGold: privatePolicy()}),
    setter: async () => {},
  });
  const noOpPlan = await buildPolicyPlan({
    backend: noOpBackend,
    manifest,
    projectId: PROJECT_ID,
    region: REGION,
  });
  await assert.rejects(
    () => executePolicyPlan({backend: noOpBackend, manifest, plan: noOpPlan}),
    /Post-write public-invoker verification failed/
  );
});

test('Firebase Functions postdeploy runs every strict read-only IAM check', () => {
  const firebaseConfig = JSON.parse(fs.readFileSync(
    path.resolve(__dirname, '..', 'firebase.json'),
    'utf8'
  ));
  const functionsConfig = Array.isArray(firebaseConfig.functions)
    ? firebaseConfig.functions[0]
    : firebaseConfig.functions;
  assert.deepEqual(functionsConfig.postdeploy, [
    'node "$PROJECT_DIR/scripts/callable-invoker-policy.js" --project fatins --region europe-west8 --check',
    'node "$PROJECT_DIR/scripts/callable-invoker-policy.js" --project fatins --region europe-west1 --check',
  ]);
});
