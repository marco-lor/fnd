const assert = require('node:assert/strict');
const test = require('node:test');

const {
  APP_CHECK_SERVICE_AGENT_ROLE,
  REQUIRED_SERVICE_NAMES,
  assertSafeTarget,
  parseArguments,
  verifyAppCheckPrerequisites,
} = require('./verify-app-check-production');

const response = (payload, {ok = true, status = 200} = {}) => ({
  json: async () => payload,
  ok,
  status,
});

const createFetch = ({
  bindings = [{
    role: APP_CHECK_SERVICE_AGENT_ROLE,
    members: [
      'serviceAccount:service-123456789@gcp-sa-firebaseappcheck.iam.gserviceaccount.com',
    ],
  }],
  serviceState = 'ENABLED',
} = {}) => async (url, options = {}) => {
  if (url.endsWith('/v1/projects/fatins')) {
    return response({projectNumber: '123456789'});
  }
  if (url.includes('serviceusage.googleapis.com')) {
    return response({state: serviceState});
  }
  if (url.endsWith('/v1/projects/fatins:getIamPolicy')) {
    assert.equal(options.method, 'POST');
    assert.deepEqual(JSON.parse(options.body), {
      options: {requestedPolicyVersion: 1},
    });
    return response({bindings});
  }
  throw new Error(`Unexpected URL: ${url}`);
};

test('production target requires exact project, confirmation, and Firebase CLI auth', () => {
  const options = parseArguments([
    '--project', 'fatins',
    '--auth', 'firebase-cli',
    '--allow-live-project',
    '--confirm-project', 'fatins',
  ]);
  assert.deepEqual(assertSafeTarget(options, {}), {
    live: true,
    projectId: 'fatins',
  });
  assert.throws(
    () => assertSafeTarget({...options, projectId: 'fatin-test'}, {}),
    /only live project fatins/
  );
  assert.throws(
    () => assertSafeTarget({...options, allowLiveProject: false}, {}),
    /allow-live-project/
  );
  assert.throws(
    () => assertSafeTarget({...options, authMode: 'admin'}, {}),
    /requires --auth firebase-cli/
  );
  assert.throws(
    () => assertSafeTarget(options, {GCLOUD_PROJECT: 'fatin-test'}),
    /does not match/
  );
});

test('App Check verification requires both APIs and the exact service-agent binding', async () => {
  const result = await verifyAppCheckPrerequisites({
    accessToken: 'test-token',
    fetchImpl: createFetch(),
    projectId: 'fatins',
  });
  assert.deepEqual(result, {
    apiEnabled: true,
    recaptchaEnterpriseApiEnabled: true,
    serviceAgentRoleBound: true,
  });
  assert.deepEqual(REQUIRED_SERVICE_NAMES, [
    'firebaseappcheck.googleapis.com',
    'recaptchaenterprise.googleapis.com',
  ]);
});

test('App Check verification fails closed for a disabled API', async () => {
  await assert.rejects(
    verifyAppCheckPrerequisites({
      accessToken: 'test-token',
      fetchImpl: createFetch({serviceState: 'DISABLED'}),
      projectId: 'fatins',
    }),
    /disabled service\(s\)/
  );
});

test('App Check verification fails closed for a missing service-agent role', async () => {
  await assert.rejects(
    verifyAppCheckPrerequisites({
      accessToken: 'test-token',
      fetchImpl: createFetch({bindings: []}),
      projectId: 'fatins',
    }),
    new RegExp(APP_CHECK_SERVICE_AGENT_ROLE.replace('/', '\\/'))
  );
});

test('App Check verification rejects a conditional service-agent binding', async () => {
  await assert.rejects(
    verifyAppCheckPrerequisites({
      accessToken: 'test-token',
      fetchImpl: createFetch({
        bindings: [{
          role: APP_CHECK_SERVICE_AGENT_ROLE,
          members: [
            'serviceAccount:service-123456789@gcp-sa-firebaseappcheck.iam.gserviceaccount.com',
          ],
          condition: {expression: 'request.time < timestamp("2030-01-01T00:00:00Z")'},
        }],
      }),
      projectId: 'fatins',
    }),
    /missing roles\/firebaseappcheck\.serviceAgent binding/
  );
});
