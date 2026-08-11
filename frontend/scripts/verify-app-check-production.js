#!/usr/bin/env node

'use strict';

const {
  createFirebaseCliAdminCredential,
} = require('./firebase-cli-admin-credential');
const {PRODUCTION_PROJECT_ID} = require('./production-target');

const APP_CHECK_SERVICE_AGENT_ROLE = 'roles/firebaseappcheck.serviceAgent';
const REQUIRED_SERVICE_NAMES = Object.freeze([
  'firebaseappcheck.googleapis.com',
  'recaptchaenterprise.googleapis.com',
]);

const printHelp = () => {
  console.log([
    'Verify the production APIs and IAM required by Firebase App Check.',
    '',
    'Usage:',
    '  node scripts/verify-app-check-production.js --project fatins',
    '    --auth firebase-cli --allow-live-project --confirm-project fatins',
    '',
    'This command is read-only and refuses every other live project.',
  ].join('\n'));
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
  fetchImpl = globalThis.fetch,
  projectId,
}) => {
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

  const failures = [];
  if (disabledServices.length) {
    failures.push(`disabled service(s): ${disabledServices.join(', ')}`);
  }
  if (!serviceAgentRoleBound) {
    failures.push(`missing ${APP_CHECK_SERVICE_AGENT_ROLE} binding`);
  }
  if (failures.length) {
    throw new Error(`App Check production prerequisites failed: ${failures.join('; ')}.`);
  }

  return {
    apiEnabled: true,
    recaptchaEnterpriseApiEnabled: true,
    serviceAgentRoleBound: true,
  };
};

const main = async () => {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  assertSafeTarget(options);
  const credential = await createFirebaseCliAdminCredential({
    projectId: options.projectId,
  });
  const token = await credential.getAccessToken();
  const appCheck = await verifyAppCheckPrerequisites({
    accessToken: token.access_token,
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
  REQUIRED_SERVICE_NAMES,
  assertSafeTarget,
  fetchJson,
  parseArguments,
  verifyAppCheckPrerequisites,
};
