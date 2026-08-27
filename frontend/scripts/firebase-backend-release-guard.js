#!/usr/bin/env node

const childProcess = require('node:child_process');
const {
  resolveEnvironmentFromProcess,
} = require('./firebase-environment');
const {PRODUCTION_PROJECT_ID} = require('./production-target');
const DEPLOYMENT_PLANES = new Set([
  'firestore',
  'functions',
  'hosting',
  'storage',
  'all',
]);

const usage = 'Usage: node scripts/firebase-backend-release-guard.js <firestore|functions|hosting|storage|all>';

const resolveProjectId = (environment = {}) => (
  environment.GCLOUD_PROJECT
  || environment.GOOGLE_CLOUD_PROJECT
  || environment.FIREBASE_PROJECT_ID
  || environment.PROJECT_ID
  || ''
).trim();

const resolveGitBranchOutput = ({
  environment = process.env,
  execFileSyncImpl = childProcess.execFileSync,
  cwd = process.cwd(),
} = {}) => {
  if (
    environment.FND_GIT_BRANCH
    || environment.GITHUB_HEAD_REF
    || environment.GITHUB_REF_NAME
    || environment.BRANCH_NAME
  ) {
    return '';
  }
  try {
    return execFileSyncImpl('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (_error) {
    return '';
  }
};

const guardBackendRelease = ({
  argv = process.argv.slice(2),
  environment = process.env,
  execFileSyncImpl = childProcess.execFileSync,
  cwd = process.cwd(),
  writeError = (message) => process.stderr.write(`${message}\n`),
} = {}) => {
  if (argv.length !== 1 || !DEPLOYMENT_PLANES.has(argv[0])) {
    writeError(usage);
    return 2;
  }

  const plane = argv[0];
  const projectId = resolveProjectId(environment);
  try {
    const target = resolveEnvironmentFromProcess({
      environment,
      gitBranchOutput: resolveGitBranchOutput({environment, execFileSyncImpl, cwd}),
    });
    if (!target.deployable) {
      throw new Error(
        `Firebase environment ${target.name} is reserved for performance workflows and cannot be deployed.`
      );
    }
    if (projectId !== target.projectId) {
      throw new Error(
        `Firebase CLI project ${projectId || '<unset>'} does not match explicit project ${target.projectId}.`
      );
    }
  } catch (error) {
    writeError([
      `BLOCKED: ${plane} deployment requires an explicit branch-aware Firebase target.`,
      `Received Firebase project: ${projectId || '<unset>'}.`,
      'Every other Firebase project is refused by this repository.',
      `Reason: ${error.message}`,
    ].join('\n'));
    return 1;
  }

  return 0;
};

if (require.main === module) {
  process.exitCode = guardBackendRelease();
}

module.exports = {
  DEPLOYMENT_PLANES,
  PRODUCTION_PROJECT_ID,
  guardBackendRelease,
  resolveGitBranchOutput,
  resolveProjectId,
  usage,
};
