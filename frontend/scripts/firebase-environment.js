'use strict';

const childProcess = require('node:child_process');

const FIREBASE_HOSTING_TARGET = 'app';

const FIREBASE_ENVIRONMENTS = Object.freeze({
  production: Object.freeze({
    name: 'production',
    branchName: 'main',
    projectId: 'fatins',
    hostingSite: 'fatins',
    hostingTarget: FIREBASE_HOSTING_TARGET,
    storageBucket: 'fatins.firebasestorage.app',
    authDomain: 'fatins.firebaseapp.com',
    hostingDomains: Object.freeze([
      'fatins.web.app',
      'fatins.firebaseapp.com',
    ]),
    deployable: true,
    appCheckRequired: true,
    runtimeConfigRequired: true,
  }),
  staging: Object.freeze({
    name: 'staging',
    branchName: 'devs',
    projectId: 'fatin-test',
    hostingSite: 'fatin-test',
    hostingTarget: FIREBASE_HOSTING_TARGET,
    storageBucket: 'fatin-test.firebasestorage.app',
    authDomain: 'fatin-test.firebaseapp.com',
    hostingDomains: Object.freeze([
      'fatin-test.web.app',
      'fatin-test.firebaseapp.com',
    ]),
    deployable: true,
    appCheckRequired: true,
    runtimeConfigRequired: true,
  }),
  performance: Object.freeze({
    name: 'performance',
    branchName: null,
    projectId: 'demo-fnd-perf',
    hostingSite: 'demo-fnd-perf',
    hostingTarget: FIREBASE_HOSTING_TARGET,
    storageBucket: 'demo-fnd-perf.appspot.com',
    authDomain: 'demo-fnd-perf.firebaseapp.com',
    hostingDomains: Object.freeze([]),
    deployable: false,
    appCheckRequired: false,
    runtimeConfigRequired: true,
  }),
});

const FIREBASE_ENVIRONMENT_NAMES = Object.freeze(
  Object.keys(FIREBASE_ENVIRONMENTS)
);

const requiredValue = (value, label) => {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`Explicit ${label} is required.`);
  return normalized;
};

const getFirebaseEnvironment = (environmentName) => {
  const name = String(environmentName ?? '').trim().toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(FIREBASE_ENVIRONMENTS, name)) {
    throw new Error(
      `Unsupported Firebase environment "${name || '<unset>'}". `
      + `Use one of: ${FIREBASE_ENVIRONMENT_NAMES.join(', ')}.`
    );
  }
  return FIREBASE_ENVIRONMENTS[name];
};

const resolveEnvironmentSelection = ({
  branchName,
  environmentName,
  hostingSite,
  projectId,
  storageBucket,
} = {}) => {
  const environment = getFirebaseEnvironment(
    requiredValue(environmentName, 'Firebase environment')
  );
  const branch = environment.branchName
    ? requiredValue(branchName, 'Git branch')
    : String(branchName ?? '').trim();
  const explicitProjectId = requiredValue(projectId, 'Firebase project');
  const explicitHostingSite = requiredValue(hostingSite, 'Firebase Hosting site');
  const explicitStorageBucket = requiredValue(storageBucket, 'Firebase Storage bucket');

  if (environment.branchName && branch !== environment.branchName) {
    throw new Error(
      `Firebase environment ${environment.name} is bound to branch `
      + `${environment.branchName}; received ${branch}.`
    );
  }

  const mismatches = [];
  if (explicitProjectId !== environment.projectId) {
    mismatches.push(
      `project expected ${environment.projectId}, received ${explicitProjectId}`
    );
  }
  if (explicitHostingSite !== environment.hostingSite) {
    mismatches.push(
      `Hosting site expected ${environment.hostingSite}, received ${explicitHostingSite}`
    );
  }
  if (explicitStorageBucket !== environment.storageBucket) {
    mismatches.push(
      `Storage bucket expected ${environment.storageBucket}, received ${explicitStorageBucket}`
    );
  }
  if (mismatches.length) {
    throw new Error(
      `Firebase environment ${environment.name} target mismatch: ${mismatches.join('; ')}.`
    );
  }

  return environment;
};

const resolveBranchName = ({
  environment = process.env,
  gitBranchOutput = '',
} = {}) => {
  const explicitBranch = environment.FND_GIT_BRANCH
    || environment.GITHUB_HEAD_REF
    || environment.GITHUB_REF_NAME
    || environment.BRANCH_NAME
    || '';
  if (String(explicitBranch).trim()) return String(explicitBranch).trim();

  const branchFromGit = String(gitBranchOutput).trim();
  if (branchFromGit && branchFromGit !== 'HEAD') return branchFromGit;
  return '';
};

const resolveCurrentBranchName = ({
  environment = process.env,
  cwd = process.cwd(),
  execFileSyncImpl = childProcess.execFileSync,
} = {}) => {
  const explicitBranch = resolveBranchName({environment});
  if (explicitBranch) return explicitBranch;
  try {
    return resolveBranchName({
      environment,
      gitBranchOutput: execFileSyncImpl(
        'git',
        ['rev-parse', '--abbrev-ref', 'HEAD'],
        {cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}
      ),
    });
  } catch (_error) {
    return '';
  }
};

const resolveEnvironmentFromProcess = ({
  environment = process.env,
  gitBranchOutput = '',
} = {}) => resolveEnvironmentSelection({
  branchName: gitBranchOutput
    ? resolveBranchName({environment, gitBranchOutput})
    : resolveCurrentBranchName({environment}),
  environmentName: environment.FND_FIREBASE_ENVIRONMENT,
  hostingSite: environment.FND_FIREBASE_HOSTING_SITE,
  projectId: environment.FND_FIREBASE_PROJECT_ID,
  storageBucket: environment.FND_FIREBASE_STORAGE_BUCKET,
});

module.exports = {
  FIREBASE_ENVIRONMENT_NAMES,
  FIREBASE_ENVIRONMENTS,
  FIREBASE_HOSTING_TARGET,
  getFirebaseEnvironment,
  requiredValue,
  resolveBranchName,
  resolveCurrentBranchName,
  resolveEnvironmentFromProcess,
  resolveEnvironmentSelection,
};
