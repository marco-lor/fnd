#!/usr/bin/env node

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const FIREBASE_TOOLS_VERSION = '15.16.0';
const UPSTREAM_FIX_COMMIT =
  'b34f5127a9448d6ae6347d75b04415cd5c0ce8a4';
const PATCH_FILE_NAME = `firebase-tools+${FIREBASE_TOOLS_VERSION}.patch`;
const VULNERABLE_RUNTIME_MARKERS = Object.freeze([
  'const serializedRuntimeActionResponse = buf.toString("utf-8").trim();',
  'rap = JSON.parse(serializedRuntimeActionResponse);',
]);
const PATCHED_RUNTIME_MARKERS = Object.freeze([
  'this._stdoutBuffer = "";',
  'this.handleRuntimeStdout(buf.toString("utf-8"));',
  'const lines = this._stdoutBuffer.split("\\n");',
]);

const resolvePatchPaths = ({
  frontendRoot = path.resolve(__dirname, '..'),
} = {}) => ({
  firebasePackage: path.join(
    frontendRoot,
    'node_modules',
    'firebase-tools',
    'package.json'
  ),
  patchCli: path.join(
    frontendRoot,
    'node_modules',
    'patch-package',
    'index.js'
  ),
  patchFile: path.join(frontendRoot, 'patches', PATCH_FILE_NAME),
  runtime: path.join(
    frontendRoot,
    'node_modules',
    'firebase-tools',
    'lib',
    'emulator',
    'storage',
    'rules',
    'runtime.js'
  ),
});

const classifyRuntimeSource = (source) => {
  const text = String(source || '');
  if (PATCHED_RUNTIME_MARKERS.every((marker) => text.includes(marker))) {
    return 'patched';
  }
  if (VULNERABLE_RUNTIME_MARKERS.every((marker) => text.includes(marker))) {
    return 'vulnerable';
  }
  return 'unknown';
};

const inspectFirebaseToolsInstall = ({
  frontendRoot,
  fsImpl = fs,
} = {}) => {
  const paths = resolvePatchPaths({frontendRoot});
  if (!fsImpl.existsSync(paths.firebasePackage)) {
    return {paths, state: 'absent', version: null};
  }

  let packageData;
  try {
    packageData = JSON.parse(
      fsImpl.readFileSync(paths.firebasePackage, 'utf8')
    );
  } catch (error) {
    throw new Error(
      `Cannot read installed firebase-tools metadata: ${error.message}`
    );
  }
  if (!fsImpl.existsSync(paths.runtime)) {
    return {
      paths,
      state: 'unknown',
      version: String(packageData.version || ''),
    };
  }
  return {
    paths,
    state: classifyRuntimeSource(
      fsImpl.readFileSync(paths.runtime, 'utf8')
    ),
    version: String(packageData.version || ''),
  };
};

const assertFirebaseStorageRuntimePatched = (options = {}) => {
  const inspection = inspectFirebaseToolsInstall(options);
  if (inspection.state === 'absent') {
    throw new Error(
      'firebase-tools is not installed. Run npm install in frontend/.'
    );
  }
  if (inspection.version !== FIREBASE_TOOLS_VERSION) {
    throw new Error(
      'The Firebase Storage emulator patch is pinned to firebase-tools '
      + `${FIREBASE_TOOLS_VERSION}, but ${inspection.version || 'unknown'} `
      + 'is installed. Run npm ci in frontend/.'
    );
  }
  if (inspection.state !== 'patched') {
    throw new Error(
      'The Firebase Storage emulator stdout-framing patch is not applied. '
      + 'Run npm install in frontend/ with lifecycle scripts enabled before '
      + 'starting emulators.'
    );
  }
  return inspection;
};

const applyFirebaseToolsPatch = ({
  frontendRoot = path.resolve(__dirname, '..'),
  fsImpl = fs,
  spawnSyncImpl = childProcess.spawnSync,
  log = console.log,
} = {}) => {
  const inspection = inspectFirebaseToolsInstall({frontendRoot, fsImpl});
  if (inspection.state === 'absent') {
    log(
      'firebase-tools is absent; skipping its development-only emulator patch.'
    );
    return inspection;
  }
  if (inspection.version !== FIREBASE_TOOLS_VERSION) {
    throw new Error(
      'Refusing to patch firebase-tools '
      + `${inspection.version || 'unknown'}; expected exactly `
      + `${FIREBASE_TOOLS_VERSION}.`
    );
  }
  if (inspection.state === 'patched') {
    log(
      `Firebase Storage emulator patch ${UPSTREAM_FIX_COMMIT.slice(0, 8)} `
      + 'is already applied.'
    );
    return inspection;
  }
  if (inspection.state !== 'vulnerable') {
    throw new Error(
      'Refusing to patch an unrecognized firebase-tools Storage runtime.'
    );
  }
  if (!fsImpl.existsSync(inspection.paths.patchFile)) {
    throw new Error(
      `Required dependency patch is missing: ${inspection.paths.patchFile}`
    );
  }
  if (!fsImpl.existsSync(inspection.paths.patchCli)) {
    throw new Error(
      'patch-package is required when firebase-tools is installed. '
      + 'Run npm install in frontend/.'
    );
  }

  const result = spawnSyncImpl(
    process.execPath,
    [inspection.paths.patchCli, '--error-on-fail'],
    {
      cwd: frontendRoot,
      stdio: 'inherit',
      shell: false,
    }
  );
  if (result.error) {
    throw new Error(
      `Could not start patch-package: ${result.error.message}`
    );
  }
  if (result.status !== 0) {
    throw new Error(
      `patch-package failed with exit code ${result.status ?? 'unknown'}.`
    );
  }

  const patched = assertFirebaseStorageRuntimePatched({
    frontendRoot,
    fsImpl,
  });
  log(
    `Applied Firebase Storage emulator fix from upstream ${UPSTREAM_FIX_COMMIT}.`
  );
  return patched;
};

if (require.main === module) {
  try {
    applyFirebaseToolsPatch();
  } catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  FIREBASE_TOOLS_VERSION,
  PATCHED_RUNTIME_MARKERS,
  UPSTREAM_FIX_COMMIT,
  VULNERABLE_RUNTIME_MARKERS,
  applyFirebaseToolsPatch,
  assertFirebaseStorageRuntimePatched,
  classifyRuntimeSource,
  inspectFirebaseToolsInstall,
  resolvePatchPaths,
};
