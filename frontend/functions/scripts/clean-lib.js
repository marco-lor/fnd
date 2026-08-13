const fs = require('node:fs');
const path = require('node:path');

const functionsRoot = path.resolve(__dirname, '..');
const libRoot = path.resolve(functionsRoot, 'lib');

if (path.dirname(libRoot) !== functionsRoot || path.basename(libRoot) !== 'lib') {
  throw new Error(`Refusing to clean an unexpected Functions output path: ${libRoot}`);
}

fs.rmSync(libRoot, {force: true, maxRetries: 3, recursive: true, retryDelay: 100});
