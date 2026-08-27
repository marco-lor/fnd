#!/usr/bin/env node

'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const {
  FIREBASE_HOSTING_TARGET,
  requiredValue,
  resolveBranchName,
  resolveEnvironmentSelection,
} = require('./firebase-environment');
const {
  HOSTING_RELEASE_ENVIRONMENT,
  withForcedEnvironment,
} = require('./forced-release-environment');

const frontendRoot = path.resolve(__dirname, '..');
const FIREBASE_CONFIG_PATH = path.join(frontendRoot, 'firebase.json');
const FIREBASE_CLI_PATH = path.join(
  frontendRoot,
  'node_modules',
  'firebase-tools',
  'lib',
  'bin',
  'firebase.js'
);

const usage = [
  'Usage: node scripts/firebase-deploy.js',
  '  --environment production|staging',
  '  --project <project-id>',
  '  --site <hosting-site>',
  '  --bucket <storage-bucket>',
  '  --only <firebase-selector>[,<firebase-selector>...]',
].join('\n');

const parseArguments = (args = process.argv.slice(2)) => {
  const options = {
    environmentName: '',
    projectId: '',
    hostingSite: '',
    storageBucket: '',
    only: [],
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help' || argument === '-h') {
      options.help = true;
      continue;
    }
    if (['--environment', '--project', '--site', '--bucket', '--only'].includes(argument)) {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`Missing value for ${argument}.`);
      }
      index += 1;
      if (argument === '--environment') options.environmentName = value;
      if (argument === '--project') options.projectId = value;
      if (argument === '--site') options.hostingSite = value;
      if (argument === '--bucket') options.storageBucket = value;
      if (argument === '--only') {
        options.only.push(...value.split(',').map((selector) => selector.trim()).filter(Boolean));
      }
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  if (options.help) return options;
  requiredValue(options.environmentName, 'Firebase environment');
  requiredValue(options.projectId, 'Firebase project');
  requiredValue(options.hostingSite, 'Firebase Hosting site');
  requiredValue(options.storageBucket, 'Firebase Storage bucket');
  if (!options.only.length) throw new Error('Explicit --only selector is required.');
  return options;
};

const normalizeSelectors = (selectors, hostingTarget = FIREBASE_HOSTING_TARGET) => (
  selectors.map((selector) => {
    if (selector === 'hosting') return `hosting:${hostingTarget}`;
    if (selector.startsWith('hosting:') && selector !== `hosting:${hostingTarget}`) {
      throw new Error(
        `Hosting selector must use the explicit shared target hosting:${hostingTarget}.`
      );
    }
    return selector;
  })
);

const buildChildEnvironment = ({
  sourceEnvironment = process.env,
  selection,
  branchName,
} = {}) => withForcedEnvironment(sourceEnvironment, {
  ...HOSTING_RELEASE_ENVIRONMENT,
  FND_FIREBASE_ENVIRONMENT: selection.name,
  FND_FIREBASE_AUTH_DOMAIN: selection.authDomain,
  FND_FIREBASE_PROJECT_ID: selection.projectId,
  FND_FIREBASE_HOSTING_SITE: selection.hostingSite,
  FND_FIREBASE_STORAGE_BUCKET: selection.storageBucket,
  FND_GIT_BRANCH: branchName,
  REACT_APP_FND_ENVIRONMENT: selection.name,
  REACT_APP_FND_FIREBASE_AUTH_DOMAIN: selection.authDomain,
  REACT_APP_FND_FIREBASE_PROJECT_ID: selection.projectId,
  REACT_APP_FND_FIREBASE_HOSTING_SITE: selection.hostingSite,
  REACT_APP_FND_FIREBASE_STORAGE_BUCKET: selection.storageBucket,
});

const resolveDeploymentSelection = ({options, branchName}) => {
  const selection = resolveEnvironmentSelection({
    branchName,
    environmentName: options.environmentName,
    hostingSite: options.hostingSite,
    projectId: options.projectId,
    storageBucket: options.storageBucket,
  });
  if (!selection.deployable) {
    throw new Error(
      `Firebase environment ${selection.name} is reserved for performance workflows and cannot be deployed.`
    );
  }
  return selection;
};

const buildFirebaseInvocation = ({
  branchName,
  environment = process.env,
  firebaseCommand = 'deploy',
  commandArgs = [],
  commandPrefixArgs = [],
  firebaseCli = FIREBASE_CLI_PATH,
  fsImpl = fs,
  options,
  configPath = FIREBASE_CONFIG_PATH,
} = {}) => {
  if (!options) throw new Error('Explicit Firebase deployment options are required.');
  const selection = resolveDeploymentSelection({options, branchName});
  if (!fsImpl.existsSync(firebaseCli)) {
    throw new Error(`Firebase CLI not found: ${firebaseCli}`);
  }
  const selectors = normalizeSelectors(options.only, selection.hostingTarget).join(',');
  const selectorArguments = firebaseCommand === 'deploy'
    ? ['--only', selectors]
    : [];
  return {
    command: process.execPath,
    args: [
      firebaseCli,
      firebaseCommand,
      ...commandPrefixArgs,
      '--config',
      configPath,
      '--project',
      selection.projectId,
      ...selectorArguments,
      ...commandArgs,
    ],
    configPath,
    environment: buildChildEnvironment({
      sourceEnvironment: environment,
      selection,
      branchName,
    }),
    selection,
  };
};

const resolveChildExitCode = (result) => {
  if (result?.error) throw result.error;
  return result?.status === 0 ? 0 : 1;
};

const readGitBranchOutput = ({
  environment = process.env,
  execFileSyncImpl = childProcess.execFileSync,
} = {}) => {
  if (
    environment.FND_GIT_BRANCH
    || environment.GITHUB_HEAD_REF
    || environment.GITHUB_REF_NAME
    || environment.BRANCH_NAME
  ) return '';
  try {
    return execFileSyncImpl('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: frontendRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (_error) {
    return '';
  }
};

const main = () => {
  const options = parseArguments();
  if (options.help) {
    console.log(usage);
    return;
  }
  const environment = process.env;
  const branchName = resolveBranchName({
    environment,
    gitBranchOutput: readGitBranchOutput({environment}),
  });
  const invocation = buildFirebaseInvocation({
    branchName,
    environment,
    options,
  });
  const result = childProcess.spawnSync(
    invocation.command,
    invocation.args,
    {
      cwd: frontendRoot,
      env: invocation.environment,
      shell: false,
      stdio: 'inherit',
    }
  );
  process.exitCode = resolveChildExitCode(result);
};

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message || error);
    console.error(usage);
    process.exitCode = 1;
  }
}

module.exports = {
  FIREBASE_CLI_PATH,
  FIREBASE_CONFIG_PATH,
  buildChildEnvironment,
  buildFirebaseInvocation,
  main,
  normalizeSelectors,
  parseArguments,
  readGitBranchOutput,
  resolveChildExitCode,
  resolveDeploymentSelection,
  usage,
};
