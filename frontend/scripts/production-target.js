'use strict';

// This module is the single reviewed binding between guarded release/migration
// tooling and the live Firebase project. Operators must still supply the exact
// --project/--confirm-project pair, Firebase CLI authentication, and a fresh
// approved fingerprint for every mutating command.
const PRODUCTION_PROJECT_ID = 'fatins';
const PRODUCTION_STORAGE_BUCKET = 'fatins.firebasestorage.app';
const PRODUCTION_HOSTING_SITE = 'fatins';
const PRIMARY_CALLABLE_REGION = 'europe-west8';
const CALLABLE_AUDIT_REGIONS = Object.freeze([
  'europe-west8',
  'europe-west1',
  'us-central1',
]);

module.exports = Object.freeze({
  CALLABLE_AUDIT_REGIONS,
  PRIMARY_CALLABLE_REGION,
  PRODUCTION_HOSTING_SITE,
  PRODUCTION_PROJECT_ID,
  PRODUCTION_STORAGE_BUCKET,
});
