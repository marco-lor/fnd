'use strict';

const fs = require('fs');
const path = require('path');

const frontendRoot = path.resolve(__dirname, '..', '..');
const sourceRoot = path.join(frontendRoot, 'src');
const functionsSourceRoot = path.join(frontendRoot, 'functions', 'src');
const registryRelativePath = path.join('src', 'data', 'functions', 'callableRegistry.js');
const compatibilityModuleRelativePath = path.join('src', 'components', 'firebaseFunctions.js');
const manifestPath = path.join(
  sourceRoot,
  'data',
  'functions',
  'callableManifest.json'
);

const toPosix = (value) => value.split(path.sep).join('/');

const walkJavaScript = (directory) => fs.readdirSync(directory, { withFileTypes: true })
  .flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return walkJavaScript(absolutePath);
    return /\.(?:js|jsx)$/.test(entry.name) ? [absolutePath] : [];
  });

const collectOnCallExports = () => fs.readdirSync(functionsSourceRoot)
  .filter((filename) => filename.endsWith('.ts'))
  .flatMap((filename) => {
    const source = fs.readFileSync(path.join(functionsSourceRoot, filename), 'utf8');
    return [...source.matchAll(/\bexport\s+const\s+([A-Za-z0-9_]+)\s*=\s*onCall\b/g)]
      .map((match) => match[1]);
  });

const checkCallableRegistry = () => {
  const failures = [];
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const supportedRegions = new Set(manifest.supportedRegions || []);
  const callables = manifest.callables || {};
  const logicalKeys = new Set(Object.keys(callables));

  if (manifest.schemaVersion !== 1) {
    failures.push('callableManifest.json must use schemaVersion 1.');
  }

  for (const [logicalKey, descriptor] of Object.entries(callables)) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(logicalKey)) {
      failures.push(`Invalid callable logical key: ${logicalKey}`);
    }
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(descriptor.functionId || '')) {
      failures.push(`Invalid functionId for ${logicalKey}.`);
    }
    if (!supportedRegions.has(descriptor.region)) {
      failures.push(`Unsupported region for ${logicalKey}: ${descriptor.region}`);
    }
    if (typeof descriptor.owner !== 'string' || !descriptor.owner.trim()) {
      failures.push(`Missing owner for ${logicalKey}.`);
    }
    if (
      descriptor.compatibilityAliasOf !== null
      && !logicalKeys.has(descriptor.compatibilityAliasOf)
    ) {
      failures.push(
        `Unknown compatibilityAliasOf for ${logicalKey}: ${descriptor.compatibilityAliasOf}`
      );
    }
  }

  const sourceCallableIds = new Set(collectOnCallExports());
  const manifestedFunctionIds = new Set(
    Object.values(callables).map(({ functionId }) => functionId)
  );
  for (const functionId of sourceCallableIds) {
    if (!manifestedFunctionIds.has(functionId)) {
      failures.push(`Callable export is missing from the manifest: ${functionId}`);
    }
  }
  for (const functionId of manifestedFunctionIds) {
    if (!sourceCallableIds.has(functionId)) {
      failures.push(`Manifest functionId is not an exported callable: ${functionId}`);
    }
  }

  for (const absolutePath of walkJavaScript(sourceRoot)) {
    const relativePath = path.relative(frontendRoot, absolutePath);
    const normalizedPath = toPosix(relativePath);
    if (/\.test\.(?:js|jsx)$/.test(normalizedPath)) continue;

    const source = fs.readFileSync(absolutePath, 'utf8');
    if (
      relativePath !== registryRelativePath
      && /(?:from\s+['"]firebase\/functions['"]|require\(\s*['"]firebase\/functions['"]\s*\))/.test(source)
    ) {
      failures.push(
        `${normalizedPath} imports firebase/functions directly; use callableRegistry.`
      );
    }
    if (
      relativePath !== compatibilityModuleRelativePath
      && /(?:from\s+['"][^'"]*firebaseFunctions['"]|require\(\s*['"][^'"]*firebaseFunctions['"]\s*\))/.test(source)
    ) {
      failures.push(
        `${normalizedPath} imports the legacy firebaseFunctions service; use callableRegistry.`
      );
    }

    for (const match of source.matchAll(/\bgetCallable\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      if (!logicalKeys.has(match[1])) {
        failures.push(
          `${normalizedPath} references an unregistered callable key: ${match[1]}`
        );
      }
    }
  }

  if (failures.length) {
    throw new Error(`Callable registry check failed:\n- ${failures.join('\n- ')}`);
  }

  return {
    callableCount: logicalKeys.size,
    regions: [...supportedRegions],
  };
};

if (require.main === module) {
  try {
    const result = checkCallableRegistry();
    console.log(
      `Callable registry check passed (${result.callableCount} callables, `
      + `${result.regions.length} regions).`
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  checkCallableRegistry,
};
