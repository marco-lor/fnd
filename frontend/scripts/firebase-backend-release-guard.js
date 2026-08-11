#!/usr/bin/env node

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

const guardBackendRelease = ({
  argv = process.argv.slice(2),
  environment = process.env,
  writeError = (message) => process.stderr.write(`${message}\n`),
} = {}) => {
  if (argv.length !== 1 || !DEPLOYMENT_PLANES.has(argv[0])) {
    writeError(usage);
    return 2;
  }

  const plane = argv[0];
  const projectId = resolveProjectId(environment);
  if (projectId !== PRODUCTION_PROJECT_ID) {
    writeError([
      `BLOCKED: ${plane} deployment must target exactly ${PRODUCTION_PROJECT_ID}.`,
      `Received Firebase project: ${projectId || '<unset>'}.`,
      'Every other Firebase project is refused by this production repository.',
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
  resolveProjectId,
  usage,
};
