const assert = require('node:assert/strict');
const test = require('node:test');

const {
  APP_CHECK_SERVICE_AGENT_ROLE,
  BUILD_APP_ID_ENVIRONMENT_VARIABLE,
  BUILD_SITE_KEY_ENVIRONMENT_VARIABLE,
  REQUIRED_HOSTING_DOMAINS,
  REQUIRED_SERVICE_NAMES,
  assertSafeTarget,
  parseArguments,
  parseEnvironmentFile,
  resolveProductionBuildConfiguration,
  verifyAppCheckPrerequisites,
} = require('./verify-app-check-production');

const TEST_APP_ID = '1:123456789:web:test-app';
const TEST_SITE_KEY = 'test-site-key';

const response = (payload, {ok = true, status = 200} = {}) => ({
  json: async () => payload,
  ok,
  status,
});

const createFetch = ({
  appCheckSiteKey = TEST_SITE_KEY,
  bindings = [{
    role: APP_CHECK_SERVICE_AGENT_ROLE,
    members: [
      'serviceAccount:service-123456789@gcp-sa-firebaseappcheck.iam.gserviceaccount.com',
    ],
  }],
  serviceState = 'ENABLED',
  webSettings = {
    allowAllDomains: false,
    allowedDomains: [...REQUIRED_HOSTING_DOMAINS],
    integrationType: 'SCORE',
  },
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
  if (
    url.includes('firebaseappcheck.googleapis.com/v1/projects/fatins/apps/')
    && url.endsWith('/recaptchaEnterpriseConfig')
  ) {
    assert.match(url, new RegExp(encodeURIComponent(TEST_APP_ID)));
    return response({siteKey: appCheckSiteKey});
  }
  if (url.includes('recaptchaenterprise.googleapis.com/v1/projects/fatins/keys/')) {
    assert.ok(url.endsWith(encodeURIComponent(appCheckSiteKey)));
    return response({webSettings});
  }
  throw new Error(`Unexpected URL: ${url}`);
};

const verifyOptions = (fetchImpl, overrides = {}) => ({
  accessToken: 'test-token',
  appId: TEST_APP_ID,
  expectedSiteKey: TEST_SITE_KEY,
  fetchImpl,
  projectId: 'fatins',
  ...overrides,
});

test('production build configuration follows CRA precedence without exposing values', () => {
  const parsed = parseEnvironmentFile([
    '# comment',
    `${BUILD_APP_ID_ENVIRONMENT_VARIABLE}="${TEST_APP_ID}"`,
    `${BUILD_SITE_KEY_ENVIRONMENT_VARIABLE}='file-site-key' # quoted value`,
  ].join('\n'));
  assert.equal(parsed[BUILD_APP_ID_ENVIRONMENT_VARIABLE], TEST_APP_ID);
  assert.equal(parsed[BUILD_SITE_KEY_ENVIRONMENT_VARIABLE], 'file-site-key');

  assert.deepEqual(resolveProductionBuildConfiguration({
    environment: {[BUILD_SITE_KEY_ENVIRONMENT_VARIABLE]: TEST_SITE_KEY},
    environmentFileContents: [
      `${BUILD_APP_ID_ENVIRONMENT_VARIABLE}=${TEST_APP_ID}\n${BUILD_SITE_KEY_ENVIRONMENT_VARIABLE}=ignored-file-key`,
      `${BUILD_APP_ID_ENVIRONMENT_VARIABLE}=lower-priority-app`,
    ],
  }), {
    appId: TEST_APP_ID,
    siteKey: TEST_SITE_KEY,
  });

  assert.equal(resolveProductionBuildConfiguration({
    environment: {[BUILD_SITE_KEY_ENVIRONMENT_VARIABLE.toLowerCase()]: TEST_SITE_KEY},
    environmentFileContents: [`${BUILD_APP_ID_ENVIRONMENT_VARIABLE}=${TEST_APP_ID}`],
    platform: 'win32',
  }).siteKey, TEST_SITE_KEY);

  assert.equal(resolveProductionBuildConfiguration({
    environment: {[BUILD_SITE_KEY_ENVIRONMENT_VARIABLE.toLowerCase()]: 'ignored-on-linux'},
    environmentFileContents: [
      `${BUILD_APP_ID_ENVIRONMENT_VARIABLE}=${TEST_APP_ID}\n${BUILD_SITE_KEY_ENVIRONMENT_VARIABLE}=${TEST_SITE_KEY}`,
    ],
    platform: 'linux',
  }).siteKey, TEST_SITE_KEY);
});

test('production build configuration fails closed when App Check is omitted', () => {
  assert.throws(
    () => resolveProductionBuildConfiguration({
      environment: {},
      environmentFileContents: [`${BUILD_APP_ID_ENVIRONMENT_VARIABLE}=${TEST_APP_ID}`],
    }),
    new RegExp(BUILD_SITE_KEY_ENVIRONMENT_VARIABLE)
  );
});

test('production target requires exact project, confirmation, and Firebase CLI auth', () => {
  const options = parseArguments([
    '--environment', 'production',
    '--project', 'fatins',
    '--site', 'fatins',
    '--bucket', 'fatins.firebasestorage.app',
    '--auth', 'firebase-cli',
    '--allow-live-project',
    '--confirm-project', 'fatins',
  ]);
  assert.deepEqual(assertSafeTarget(options, {FND_GIT_BRANCH: 'main'}), {
    environmentName: 'production',
    live: true,
    projectId: 'fatins',
  });
  assert.throws(
    () => assertSafeTarget({...options, projectId: 'fatin-test'}, {FND_GIT_BRANCH: 'main'}),
    /target mismatch|project.*fatins|fatin-test/i
  );
  assert.throws(
    () => assertSafeTarget({...options, allowLiveProject: false}, {FND_GIT_BRANCH: 'main'}),
    /allow-live-project/
  );
  assert.throws(
    () => assertSafeTarget({...options, authMode: 'admin'}, {FND_GIT_BRANCH: 'main'}),
    /requires --auth firebase-cli/
  );
  assert.throws(
    () => assertSafeTarget(options, {FND_GIT_BRANCH: 'main', GCLOUD_PROJECT: 'fatin-test'}),
    /does not match/
  );
});

test('staging App Check verification accepts only the devs/fatin-test target tuple', () => {
  const options = parseArguments([
    '--environment', 'staging',
    '--project', 'fatin-test',
    '--site', 'fatin-test',
    '--bucket', 'fatin-test.firebasestorage.app',
    '--auth', 'firebase-cli',
    '--allow-live-project',
    '--confirm-project', 'fatin-test',
  ]);
  assert.deepEqual(assertSafeTarget(options, {FND_GIT_BRANCH: 'devs'}), {
    environmentName: 'staging',
    live: true,
    projectId: 'fatin-test',
  });
  assert.throws(
    () => assertSafeTarget(options, {FND_GIT_BRANCH: 'main'}),
    /staging.*devs|devs.*staging/i
  );
});

test('App Check verification requires both APIs and the exact service-agent binding', async () => {
  const result = await verifyAppCheckPrerequisites({
    ...verifyOptions(createFetch()),
  });
  assert.deepEqual(result, {
    apiEnabled: true,
    recaptchaEnterpriseApiEnabled: true,
    registeredWebKey: true,
    requiredDomainsAllowed: true,
    scoreIntegrationConfigured: true,
    serviceAgentRoleBound: true,
    siteKeyMatchesBuild: true,
    webAppConfigBound: true,
  });
  assert.deepEqual(REQUIRED_SERVICE_NAMES, [
    'firebaseappcheck.googleapis.com',
    'recaptchaenterprise.googleapis.com',
  ]);
});

test('App Check verification fails closed for a disabled API', async () => {
  await assert.rejects(
    verifyAppCheckPrerequisites({
      ...verifyOptions(createFetch({serviceState: 'DISABLED'})),
    }),
    /disabled service\(s\)/
  );
});

test('App Check verification fails closed for a missing service-agent role', async () => {
  await assert.rejects(
    verifyAppCheckPrerequisites({
      ...verifyOptions(createFetch({bindings: []})),
    }),
    new RegExp(APP_CHECK_SERVICE_AGENT_ROLE.replace('/', '\\/'))
  );
});

test('App Check verification rejects a conditional service-agent binding', async () => {
  await assert.rejects(
    verifyAppCheckPrerequisites({
      ...verifyOptions(createFetch({
        bindings: [{
          role: APP_CHECK_SERVICE_AGENT_ROLE,
          members: [
            'serviceAccount:service-123456789@gcp-sa-firebaseappcheck.iam.gserviceaccount.com',
          ],
          condition: {expression: 'request.time < timestamp("2030-01-01T00:00:00Z")'},
        }],
      })),
    }),
    /missing roles\/firebaseappcheck\.serviceAgent binding/
  );
});

test('App Check verification fails when the registered key differs from the build', async () => {
  await assert.rejects(
    verifyAppCheckPrerequisites({
      ...verifyOptions(createFetch({appCheckSiteKey: 'different-registered-key'})),
    }),
    /site key does not match the production build/
  );
});

test('App Check verification requires SCORE integration and both Hosting domains', async () => {
  await assert.rejects(
    verifyAppCheckPrerequisites({
      ...verifyOptions(createFetch({
        webSettings: {
          allowAllDomains: false,
          allowedDomains: [REQUIRED_HOSTING_DOMAINS[0]],
          integrationType: 'CHECKBOX',
        },
      })),
    }),
    (error) => {
      assert.match(error.message, /SCORE integration/);
      assert.match(error.message, /every production Hosting domain/);
      return true;
    }
  );
});

test('App Check verification fails before network access without build identity', async () => {
  await assert.rejects(
    verifyAppCheckPrerequisites({
      accessToken: 'test-token',
      fetchImpl: () => {
        throw new Error('network should not be called');
      },
      projectId: 'fatins',
    }),
    /requires the production build app ID and site key/
  );
});
