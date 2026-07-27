const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  checkMediaPolicyParity,
  findMediaBoundaryOffenders,
  firstPolicyDifference,
} = require('./check-media-boundaries');

const write = (root, relativePath, contents) => {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
};

test('requires structurally exact client and Functions policy copies', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fnd-media-policy-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const clientPath = path.join(root, 'client.json');
  const functionsPath = path.join(root, 'functions.json');
  fs.writeFileSync(clientPath, JSON.stringify({ policyVersion: 1, purposes: { avatar: { maxBytes: 5 } } }));
  fs.writeFileSync(functionsPath, JSON.stringify({ purposes: { avatar: { maxBytes: 5 } }, policyVersion: 1 }, null, 2));

  assert.deepEqual(checkMediaPolicyParity({
    clientPolicyPath: clientPath,
    functionsPolicyPath: functionsPath,
  }), []);

  fs.writeFileSync(functionsPath, JSON.stringify({ policyVersion: 1, purposes: { avatar: { maxBytes: 6 } } }));
  assert.match(checkMediaPolicyParity({
    clientPolicyPath: clientPath,
    functionsPolicyPath: functionsPath,
  })[0], /\$\.purposes\.avatar\.maxBytes differs/);
  assert.match(firstPolicyDifference([1], [1, 2]), /different array lengths/);
});

test('allows browser object URLs, Storage operations, and reserved paths only in reviewed adapters', (context) => {
  const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fnd-media-boundaries-'));
  context.after(() => fs.rmSync(sourceRoot, { recursive: true, force: true }));

  write(
    sourceRoot,
    'components/common/useObjectUrl.js',
    'export const lease = (file) => URL.createObjectURL(file);\n'
  );
  write(
    sourceRoot,
    'components/common/legacyMediaStorage.js',
    "deleteObject(ref(storage, path));\nif (path.startsWith('media_assets/v1/')) throw new Error();\n"
  );
  write(
    sourceRoot,
    'data/media/mediaUpload.js',
    "uploadBytesResumable(ref(storage, 'media_uploads/u/a/source'), file);\n"
  );
  write(
    sourceRoot,
    'data/media/mediaPaths.js',
    "export const generatedRoot = 'media_assets/v1/';\n"
  );
  write(
    sourceRoot,
    'components/Offender.jsx',
    [
      "const preview = URL.createObjectURL(file);",
      'await deleteObject(ref(storage, oldPath));',
      "const path = 'media_assets/v1/signed-in/u/a/1/original';",
      '',
    ].join('\n')
  );
  write(
    sourceRoot,
    'components/Offender.test.js',
    "URL.createObjectURL(file); deleteObject(ref(storage, 'media_assets/v1/test'));\n"
  );
  write(
    sourceRoot,
    'data/media/browserDerivative.js',
    'const bitmap = await createImageBitmap(file);\ncanvas.toBlob(resolve);\n'
  );

  assert.deepEqual(
    findMediaBoundaryOffenders(sourceRoot).map(({ kind, line }) => ({ kind, line })),
    [
      { kind: 'raw-object-url', line: 1 },
      { kind: 'direct-storage-operation', line: 2 },
      { kind: 'generated-or-staging-path', line: 3 },
      { kind: 'browser-derivative-generation', line: 1 },
      { kind: 'browser-derivative-generation', line: 2 },
    ]
  );
});

test('rejects original variants in reviewed list consumers and public media cache headers', (context) => {
  const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fnd-media-list-boundaries-'));
  context.after(() => fs.rmSync(sourceRoot, { recursive: true, force: true }));

  write(
    sourceRoot,
    'components/common/navbar.js',
    '<MediaImage variant="original" />\n'
  );
  write(
    sourceRoot,
    'components/UnsafeCache.js',
    "const metadata = { cacheControl: 'public, max-age=31536000' };\n"
  );
  write(
    sourceRoot,
    'components/grigliata/GrigliataBoard.js',
    '<MediaImage variant="original" />\n'
  );

  assert.deepEqual(
    findMediaBoundaryOffenders(sourceRoot).map(({ kind, line }) => ({ kind, line })),
    [
      { kind: 'original-source-in-list', line: 1 },
      { kind: 'unsafe-public-cache-control', line: 1 },
    ]
  );
});
