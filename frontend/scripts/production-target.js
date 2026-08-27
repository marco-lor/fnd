'use strict';

// This module preserves the production-target API used by existing guarded
// operator tools. The complete branch-aware mapping lives in
// firebase-environment.js so production, staging, and performance cannot drift.
const {
  FIREBASE_ENVIRONMENT_NAMES,
  FIREBASE_ENVIRONMENTS,
  FIREBASE_HOSTING_TARGET,
  getFirebaseEnvironment,
  resolveBranchName,
  resolveEnvironmentFromProcess,
  resolveEnvironmentSelection,
} = require('./firebase-environment');

const PRODUCTION_ENVIRONMENT = getFirebaseEnvironment('production');
const PRODUCTION_PROJECT_ID = PRODUCTION_ENVIRONMENT.projectId;
const PRODUCTION_STORAGE_BUCKET = PRODUCTION_ENVIRONMENT.storageBucket;
const PRODUCTION_HOSTING_SITE = PRODUCTION_ENVIRONMENT.hostingSite;
const PRIMARY_CALLABLE_REGION = 'europe-west8';
const CALLABLE_AUDIT_REGIONS = Object.freeze([
  'europe-west8',
  'europe-west1',
]);

module.exports = Object.freeze({
  CALLABLE_AUDIT_REGIONS,
  FIREBASE_ENVIRONMENT_NAMES,
  FIREBASE_ENVIRONMENTS,
  FIREBASE_HOSTING_TARGET,
  PRIMARY_CALLABLE_REGION,
  PRODUCTION_HOSTING_SITE,
  PRODUCTION_PROJECT_ID,
  PRODUCTION_STORAGE_BUCKET,
  getFirebaseEnvironment,
  resolveBranchName,
  resolveEnvironmentFromProcess,
  resolveEnvironmentSelection,
});
