#!/usr/bin/env node

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  createFirebaseCliAdminCredential,
} = require('./firebase-cli-admin-credential');
const {PRODUCTION_PROJECT_ID} = require('./production-target');

const APP_CHECK_SERVICE_AGENT_ROLE = 'roles/firebaseappcheck.serviceAgent';
const BUILD_APP_ID_ENVIRONMENT_VARIABLE = 'FATINS_FIREBASE_APP_ID';
const BUILD_SITE_KEY_ENVIRONMENT_VARIABLE = 'REACT_APP_RECAPTCHA_ENTERPRISE_SITE_KEY';
const FRONTEND_ROOT = path.resolve(__dirname, '..');
const PRODUCTION_ENVIRONMENT_FILES = Object.freeze([
  '.env.production.local',
  '.env.local',
  '.env.production',
  '.env',
]);
const REQUIRED_HOSTING_DOMAINS = Object.freeze([
  'fatin-test.web.app',
  'fatin-test.firebaseapp.com',
]);
const REQUIRED_SERVICE_NAMES = Object.freeze([
  'firebaseappcheck.googleapis.com',
  'recaptchaenterprise.googleapis.com',
]);

const printHelp = () => {
  console.log([
    'Verify production Firebase App Check APIs, IAM, app binding, and web-key settings.',
    '',
    'Usage:',
    '  node scripts/verify-app-check-production.js --project fatin-test',
    '    --auth firebase-cli --allow-live-project --confirm-project fatin-test',
    '',
    'This command is read-only and refuses every other live project.',
  ].join('\n'));
};

const parseEnvironmentFile = (contents = '') => {
  const parsed = {};
  for (const rawLine of String(contents).replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;

    let value = match[2].trim();
    const quotedValue = value.match(/^(['"])(.*?)\1(?:\s+#.*)?$/);
    if (quotedValue) {
      value = quotedValue[2];
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }
    parsed[match[1]] = value;
  }
  return parsed;
};

const findEnvironmentValue = (environment, variableName, platform = process.platform) => {
  if (Object.prototype.hasOwnProperty.call(environment || {}, variableName)) {
    return {found: true, value: environment[variableName]};
  }
  if (platform === 'win32') {
    const normalizedName = variableName.toUpperCase();
    const entry = Object.entries(environment || {}).find(
      ([candidate]) => candidate.toUpperCase() === normalizedName
    );
    if (entry) return {found: true, value: entry[1]};
  }
  return {found: false, value: undefined};
};

const resolveProductionBuildConfiguration = ({
  environment = process.env,
  environmentFileContents = [],
  platform = process.platform,
} = {}) => {
  const parsedFiles = environmentFileContents.map(parseEnvironmentFile);
  const resolveValue = (variableName) => {
    const inherited = findEnvironmentValue(environment, variableName, platform);
    if (inherited.found) return String(inherited.value ?? '').trim();
    for (const parsedFile of parsedFiles) {
      if (Object.prototype.hasOwnProperty.call(parsedFile, variableName)) {
        return String(parsedFile[variableName] ?? '').trim();
      }
    }
    return '';
  };

  const appId = resolveValue(BUILD_APP_ID_ENVIRONMENT_VARIABLE);
  const siteKey = resolveValue(BUILD_SITE_KEY_ENVIRONMENT_VARIABLE);
  const missingVariables = [];
  if (!appId) missingVariables.push(BUILD_APP_ID_ENVIRONMENT_VARIABLE);
  if (!siteKey) missingVariables.push(BUILD_SITE_KEY_ENVIRONMENT_VARIABLE);
  if (missingVariables.length) {
    throw new Error(
      `Production build configuration is missing: ${missingVariables.join(', ')}.`
    );
  }
  return {appId, siteKey};
};

const loadProductionBuildConfiguration = ({
  environment = process.env,
  frontendRoot = FRONTEND_ROOT,
  fsImpl = fs,
} = {}) => {
  const environmentFileContents = PRODUCTION_ENVIRONMENT_FILES.flatMap((fileName) => {
    const filePath = path.join(frontendRoot, fileName);
    return fsImpl.existsSync(filePath) ? [fsImpl.readFileSync(filePath, 'utf8')] : [];
  });
  return resolveProductionBuildConfiguration({environment, environmentFileContents});
};

const parseArguments = (args = []) => {
  const parsed = {
    allowLiveProject: false,
    authMode: '',
    confirmProject: '',
    help: false,
    projectId: '',
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help' || argument === '-h') {
      parsed.help = true;
      continue;
    }
    if (argument === '--allow-live-project') {
      parsed.allowLiveProject = true;
      continue;
    }
    if (['--project', '--auth', '--confirm-project'].includes(argument)) {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`Missing value for ${argument}.`);
      }
      index += 1;
      if (argument === '--project') parsed.projectId = value;
      if (argument === '--auth') parsed.authMode = value;
      if (argument === '--confirm-project') parsed.confirmProject = value;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  if (!parsed.help && !parsed.projectId) {
    throw new Error('Explicit --project <project-id> is required.');
  }
  return parsed;
};

const assertSafeTarget = (options, environment = process.env) => {
  if (environment.FIRESTORE_EMULATOR_HOST) {
    throw new Error('Production App Check verification refuses Firestore emulator context.');
  }
  for (const variableName of [
    'GCLOUD_PROJECT',
    'GOOGLE_CLOUD_PROJECT',
    'FIREBASE_PROJECT_ID',
    'PROJECT_ID',
  ]) {
    const inheritedProject = environment[variableName];
    if (inheritedProject && inheritedProject !== options.projectId) {
      throw new Error(
        `${variableName}=${inheritedProject} does not match --project ${options.projectId}.`
      );
    }
  }
  if (options.projectId !== PRODUCTION_PROJECT_ID) {
    throw new Error(`This verifier accepts only live project ${PRODUCTION_PROJECT_ID}.`);
  }
  if (
    options.allowLiveProject !== true
    || options.confirmProject !== PRODUCTION_PROJECT_ID
  ) {
    throw new Error(
      `Live verification requires --allow-live-project and exact --confirm-project ${PRODUCTION_PROJECT_ID}.`
    );
  }
  if (options.authMode !== 'firebase-cli') {
    throw new Error(`Live ${PRODUCTION_PROJECT_ID} verification requires --auth firebase-cli.`);
  }
  return {live: true, projectId: options.projectId};
};

const fetchJson = async ({
  accessToken,
  body,
  fetchImpl = globalThis.fetch,
  method = 'GET',
  url,
}) => {
  const response = await fetchImpl(url, {
    method,
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${accessToken}`,
      ...(body === undefined ? {} : {'content-type': 'application/json'}),
    },
    ...(body === undefined ? {} : {body: JSON.stringify(body)}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const apiMessage = typeof payload?.error?.message === 'string'
      ? `: ${payload.error.message}`
      : '';
    throw new Error(
      `Google API request failed with HTTP ${response.status} at ${new URL(url).hostname}${apiMessage}`
    );
  }
  return payload;
};

const verifyAppCheckPrerequisites = async ({
  accessToken,
  appId,
  expectedSiteKey,
  fetchImpl = globalThis.fetch,
  projectId,
  requiredHostingDomains = REQUIRED_HOSTING_DOMAINS,
}) => {
  if (!String(appId || '').trim() || !String(expectedSiteKey || '').trim()) {
    throw new Error('App Check verification requires the production build app ID and site key.');
  }

  const project = await fetchJson({
    accessToken,
    fetchImpl,
    url: `https://cloudresourcemanager.googleapis.com/v1/projects/${encodeURIComponent(projectId)}`,
  });
  const projectNumber = String(project?.projectNumber ?? '');
  if (!/^\d+$/.test(projectNumber)) {
    throw new Error('Cloud Resource Manager did not return a valid project number.');
  }

  const serviceStates = await Promise.all(REQUIRED_SERVICE_NAMES.map(async (serviceName) => {
    const service = await fetchJson({
      accessToken,
      fetchImpl,
      url: `https://serviceusage.googleapis.com/v1/projects/${projectNumber}/services/${serviceName}`,
    });
    return [serviceName, service?.state];
  }));
  const disabledServices = serviceStates
    .filter(([, state]) => state !== 'ENABLED')
    .map(([serviceName]) => serviceName);

  const iamPolicy = await fetchJson({
    accessToken,
    body: {options: {requestedPolicyVersion: 1}},
    fetchImpl,
    method: 'POST',
    url: `https://cloudresourcemanager.googleapis.com/v1/projects/${encodeURIComponent(projectId)}:getIamPolicy`,
  });
  const expectedMember = `serviceAccount:service-${projectNumber}@gcp-sa-firebaseappcheck.iam.gserviceaccount.com`;
  const serviceAgentRoleBound = Array.isArray(iamPolicy?.bindings)
    && iamPolicy.bindings.some((binding) => (
      binding?.role === APP_CHECK_SERVICE_AGENT_ROLE
      && Array.isArray(binding?.members)
      && binding.members.includes(expectedMember)
      && binding.condition == null
    ));

  const appCheckConfig = await fetchJson({
    accessToken,
    fetchImpl,
    url: `https://firebaseappcheck.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/apps/${encodeURIComponent(appId)}/recaptchaEnterpriseConfig`,
  });
  const registeredSiteKey = typeof appCheckConfig?.siteKey === 'string'
    ? appCheckConfig.siteKey.trim()
    : '';
  const webAppConfigBound = Boolean(registeredSiteKey);
  const siteKeyMatchesBuild = webAppConfigBound && registeredSiteKey === expectedSiteKey;

  let recaptchaKey = null;
  if (registeredSiteKey) {
    recaptchaKey = await fetchJson({
      accessToken,
      fetchImpl,
      url: `https://recaptchaenterprise.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/keys/${encodeURIComponent(registeredSiteKey)}`,
    });
  }
  const webSettings = recaptchaKey?.webSettings;
  const registeredWebKey = Boolean(webSettings && typeof webSettings === 'object');
  const scoreIntegrationConfigured = registeredWebKey
    && webSettings.integrationType === 'SCORE';
  const allowedDomains = Array.isArray(webSettings?.allowedDomains)
    ? webSettings.allowedDomains
    : [];
  const requiredDomainsAllowed = registeredWebKey && (
    webSettings.allowAllDomains === true
    || requiredHostingDomains.every((domain) => allowedDomains.includes(domain))
  );

  const failures = [];
  if (disabledServices.length) {
    failures.push(`disabled service(s): ${disabledServices.join(', ')}`);
  }
  if (!serviceAgentRoleBound) {
    failures.push(`missing ${APP_CHECK_SERVICE_AGENT_ROLE} binding`);
  }
  if (!webAppConfigBound) {
    failures.push('missing reCAPTCHA Enterprise binding for the production web app');
  } else if (!siteKeyMatchesBuild) {
    failures.push('registered App Check site key does not match the production build');
  }
  if (!registeredWebKey) {
    failures.push('registered App Check key is not a reCAPTCHA Enterprise web key');
  } else {
    if (!scoreIntegrationConfigured) {
      failures.push('registered App Check web key is not configured for SCORE integration');
    }
    if (!requiredDomainsAllowed) {
      failures.push('registered App Check web key does not allow every production Hosting domain');
    }
  }
  if (failures.length) {
    throw new Error(`App Check production prerequisites failed: ${failures.join('; ')}.`);
  }

  return {
    apiEnabled: true,
    recaptchaEnterpriseApiEnabled: true,
    registeredWebKey: true,
    requiredDomainsAllowed: true,
    scoreIntegrationConfigured: true,
    serviceAgentRoleBound: true,
    siteKeyMatchesBuild: true,
    webAppConfigBound: true,
  };
};

const main = async () => {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  assertSafeTarget(options);
  const buildConfiguration = loadProductionBuildConfiguration();
  const credential = await createFirebaseCliAdminCredential({
    projectId: options.projectId,
  });
  const token = await credential.getAccessToken();
  const appCheck = await verifyAppCheckPrerequisites({
    accessToken: token.access_token,
    appId: buildConfiguration.appId,
    expectedSiteKey: buildConfiguration.siteKey,
    projectId: options.projectId,
  });
  console.log(JSON.stringify({
    appCheck,
    projectId: options.projectId,
    ready: true,
  }, null, 2));
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  });
}

module.exports = {
  APP_CHECK_SERVICE_AGENT_ROLE,
  BUILD_APP_ID_ENVIRONMENT_VARIABLE,
  BUILD_SITE_KEY_ENVIRONMENT_VARIABLE,
  PRODUCTION_ENVIRONMENT_FILES,
  REQUIRED_HOSTING_DOMAINS,
  REQUIRED_SERVICE_NAMES,
  assertSafeTarget,
  fetchJson,
  loadProductionBuildConfiguration,
  parseArguments,
  parseEnvironmentFile,
  resolveProductionBuildConfiguration,
  verifyAppCheckPrerequisites,
};
