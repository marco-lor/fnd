const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const {
  INDEX_CACHE_CONTROL,
  RUNTIME_CONFIG_PATH,
  SECURITY_HEADERS,
  SERVER_ID,
  STATIC_CACHE_CONTROL,
  classifyBuildEntry,
  createBuildSnapshot,
  createDeterministicBuildServer,
  parseSingleByteRange,
} = require('./deterministic-static-server');

const createBuildFixture = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fnd-deterministic-static-'));
  const buildDirectory = path.join(root, 'build');
  const javascriptDirectory = path.join(buildDirectory, 'static', 'js');
  const cssDirectory = path.join(buildDirectory, 'static', 'css');
  const mediaDirectory = path.join(buildDirectory, 'static', 'media');
  fs.mkdirSync(javascriptDirectory, { recursive: true });
  fs.mkdirSync(cssDirectory, { recursive: true });
  fs.mkdirSync(mediaDirectory, { recursive: true });
  const index = Buffer.from('<!doctype html><html><body>deterministic shell</body></html>', 'utf8');
  const javascript = Buffer.from('const deterministicValue = "fnd";\n'.repeat(250), 'utf8');
  const css = Buffer.from('body{color:#fff}', 'utf8');
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'utf8');
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  fs.writeFileSync(path.join(buildDirectory, 'index.html'), index);
  fs.writeFileSync(path.join(javascriptDirectory, 'app.js'), javascript);
  fs.writeFileSync(path.join(cssDirectory, 'app.css'), css);
  fs.writeFileSync(path.join(mediaDirectory, 'icon.svg'), svg);
  fs.writeFileSync(path.join(mediaDirectory, 'pixel.png'), png);
  return {
    root,
    buildDirectory,
    contents: { index, javascript, css, svg, png },
  };
};

const request = ({ port, pathname = '/', method = 'GET', headers = {} }) => new Promise(
  (resolve, reject) => {
    const outbound = http.request({
      host: '127.0.0.1',
      port,
      path: pathname,
      method,
      headers: { Connection: 'close', ...headers },
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({
        statusCode: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks),
      }));
    });
    outbound.on('error', reject);
    outbound.end();
  }
);

const closeNetServer = (server) => new Promise((resolve, reject) => {
  server.close((error) => (error ? reject(error) : resolve()));
});

const bindNetServer = (port = 0) => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once('error', reject);
  server.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
    server.removeListener('error', reject);
    resolve(server);
  });
});

test('build snapshot requires index and precomputes deterministic representations', () => {
  const fixture = createBuildFixture();
  try {
    const snapshot = createBuildSnapshot({ buildDirectory: fixture.buildDirectory });
    const javascript = snapshot.assets.get('/static/js/app.js');
    const css = snapshot.assets.get('/static/css/app.css');

    assert.equal(snapshot.index.path, '/index.html');
    assert.deepEqual(javascript.encodings.identity, fixture.contents.javascript);
    assert.deepEqual(
      zlib.brotliDecompressSync(javascript.encodings.br),
      fixture.contents.javascript
    );
    assert.deepEqual(zlib.gunzipSync(javascript.encodings.gzip), fixture.contents.javascript);
    assert.equal(css.encodings.br, undefined);
    assert.equal(javascript.cacheControl, STATIC_CACHE_CONTROL);
    assert.equal(snapshot.index.cacheControl, INDEX_CACHE_CONTROL);
    assert.match(javascript.etag, /^[a-f0-9]{32}$/);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('performance CSP admits owned emulator traffic without report-only policy noise', () => {
  const policy = SECURITY_HEADERS['Content-Security-Policy-Report-Only'];

  assert.match(policy, /style-src[^;]+https:\/\/fonts\.googleapis\.com/);
  assert.match(policy, /font-src[^;]+https:\/\/fonts\.gstatic\.com/);
  assert.match(policy, /img-src[^;]+http:\/\/127\.0\.0\.1:9199/);
  assert.match(policy, /media-src[^;]+http:\/\/127\.0\.0\.1:9199/);
  for (const port of [5001, 8080, 9099, 9199]) {
    assert.match(policy, new RegExp(`connect-src[^;]+http://127\\.0\\.0\\.1:${port}`));
  }
  assert.match(policy, /connect-src[^;]+https:\/\/apis\.google\.com[^;]+https:\/\/www\.google\.com/);
  assert.match(policy, /frame-src[^;]+http:\/\/127\.0\.0\.1:9099[^;]+https:\/\/www\.google\.com/);
  assert.match(policy, /(?:^|; )report-to fnd-performance-csp(?:;|$)/);
  assert.doesNotMatch(policy, /(?:^|; )frame-ancestors(?: |;|$)/);
});

test('build entry classification admits verified cloud files but rejects true symbolic links', () => {
  const reparseEntry = {
    name: 'cloud-backed.js',
    isDirectory: () => false,
    isFile: () => false,
    isSymbolicLink: () => true,
  };
  const regularCloudFile = {
    isDirectory: () => false,
    isFile: () => true,
    isSymbolicLink: () => false,
  };
  const actualSymbolicLink = {
    isDirectory: () => false,
    isFile: () => false,
    isSymbolicLink: () => true,
  };

  assert.equal(classifyBuildEntry(
    reparseEntry,
    'C:\\performance\\cloud-backed.js',
    { lstatSync: () => regularCloudFile }
  ), 'file');
  assert.throws(
    () => classifyBuildEntry(
      reparseEntry,
      'C:\\performance\\linked.js',
      { lstatSync: () => actualSymbolicLink }
    ),
    /refuses symbolic-link entry: cloud-backed\.js/
  );
});

test('build snapshot fails before binding when index or precompression is invalid', async () => {
  const fixture = createBuildFixture();
  try {
    fs.rmSync(path.join(fixture.buildDirectory, 'index.html'));
    const missingIndexServer = createDeterministicBuildServer({
      buildDirectory: fixture.buildDirectory,
      port: 0,
    });
    await assert.rejects(missingIndexServer.start(), /missing index\.html/);
    await missingIndexServer.close();

    fs.writeFileSync(
      path.join(fixture.buildDirectory, 'index.html'),
      fixture.contents.index
    );
    assert.throws(
      () => createBuildSnapshot({
        buildDirectory: fixture.buildDirectory,
        brotliCompressImpl: () => { throw new Error('compression failed closed'); },
      }),
      /compression failed closed/
    );
    assert.throws(
      () => createDeterministicBuildServer({
        buildDirectory: fixture.buildDirectory,
        runtimeConfigUpstreamUrl: 'https://example.com/fatins-runtime/firebase-client',
      }),
      /loopback HTTP host/
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('static server preserves Hosting bytes, headers, cache policy, SPA fallback, and ranges', async () => {
  const fixture = createBuildFixture();
  const server = createDeterministicBuildServer({
    buildDirectory: fixture.buildDirectory,
    port: 0,
  });
  try {
    const address = await server.start();
    const port = address.port;

    const brotli = await request({
      port,
      pathname: '/static/js/app.js?warmup=1',
      headers: { 'Accept-Encoding': 'br, gzip' },
    });
    assert.equal(brotli.statusCode, 200);
    assert.equal(brotli.headers['content-encoding'], 'br');
    assert.equal(brotli.headers['content-length'], String(brotli.body.length));
    assert.equal(brotli.headers['transfer-encoding'], undefined);
    assert.equal(brotli.headers.vary, 'Accept-Encoding');
    assert.equal(brotli.headers['cache-control'], STATIC_CACHE_CONTROL);
    assert.equal(brotli.headers['content-type'], 'application/javascript; charset=utf-8');
    assert.deepEqual(zlib.brotliDecompressSync(brotli.body), fixture.contents.javascript);

    const identity = await request({
      port,
      pathname: '/static/js/app.js',
      headers: { 'Accept-Encoding': 'identity' },
    });
    assert.equal(identity.headers['content-encoding'], undefined);
    assert.equal(identity.headers['content-length'], String(fixture.contents.javascript.length));
    assert.deepEqual(identity.body, fixture.contents.javascript);

    const smallCss = await request({
      port,
      pathname: '/static/css/app.css',
      headers: { 'Accept-Encoding': 'br' },
    });
    assert.equal(smallCss.headers['content-encoding'], undefined);
    assert.equal(smallCss.headers['content-length'], String(fixture.contents.css.length));

    const spa = await request({ port, pathname: '/home?direct=1' });
    assert.equal(spa.statusCode, 200);
    assert.equal(spa.headers['cache-control'], INDEX_CACHE_CONTROL);
    assert.equal(spa.headers['content-type'], 'text/html; charset=utf-8');
    assert.deepEqual(spa.body, fixture.contents.index);

    const unknown = await request({ port, pathname: '/static/js/missing.js' });
    assert.equal(unknown.statusCode, 200);
    assert.deepEqual(unknown.body, fixture.contents.index);

    const range = await request({
      port,
      pathname: '/static/js/app.js',
      headers: { Range: 'bytes=2-9', 'Accept-Encoding': 'br' },
    });
    assert.equal(range.statusCode, 206);
    assert.equal(range.headers['content-encoding'], undefined);
    assert.equal(
      range.headers['content-range'],
      `bytes 2-9/${fixture.contents.javascript.length}`
    );
    assert.deepEqual(range.body, fixture.contents.javascript.subarray(2, 10));

    const invalidRange = await request({
      port,
      pathname: '/static/js/app.js',
      headers: { Range: `bytes=${fixture.contents.javascript.length}-` },
    });
    assert.equal(invalidRange.statusCode, 416);
    assert.equal(
      invalidRange.headers['content-range'],
      `bytes */${fixture.contents.javascript.length}`
    );

    const head = await request({
      port,
      pathname: '/static/js/app.js',
      method: 'HEAD',
      headers: { 'Accept-Encoding': 'identity' },
    });
    assert.equal(head.statusCode, 200);
    assert.equal(head.body.length, 0);
    assert.equal(head.headers['content-length'], String(fixture.contents.javascript.length));

    const conditional = await request({
      port,
      pathname: '/static/js/app.js',
      headers: { 'If-None-Match': identity.headers.etag },
    });
    assert.equal(conditional.statusCode, 304);
    assert.equal(conditional.body.length, 0);

    const methodNotAllowed = await request({
      port,
      pathname: '/',
      method: 'POST',
    });
    assert.equal(methodNotAllowed.statusCode, 405);
    assert.equal(methodNotAllowed.headers.allow, 'GET, HEAD');

    const unsafePath = await request({
      port,
      pathname: '/%2e%2e/firebase.json',
    });
    assert.equal(unsafePath.statusCode, 400);

    assert.equal(identity.headers['x-fnd-performance-static-server'], SERVER_ID);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      assert.equal(identity.headers[name.toLowerCase()], value);
    }
  } finally {
    await server.close();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('runtime-config route alone proxies through hidden Firebase Hosting with a fixed body length', async () => {
  const fixture = createBuildFixture();
  const calls = [];
  const payload = Buffer.from(JSON.stringify({ projectId: 'demo-fnd-perf' }));
  const server = createDeterministicBuildServer({
    buildDirectory: fixture.buildDirectory,
    port: 0,
    fetchImpl: async (target, options) => {
      calls.push({
        target: String(target),
        method: options.method,
        signal: options.signal,
      });
      return new Response(payload, {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'private, max-age=0',
          'Transfer-Encoding': 'chunked',
        },
      });
    },
  });
  try {
    const { port } = await server.start();
    const proxied = await request({
      port,
      pathname: `${RUNTIME_CONFIG_PATH}?source=test`,
    });
    assert.equal(proxied.statusCode, 200);
    assert.deepEqual(proxied.body, payload);
    assert.equal(proxied.headers['content-type'], 'application/json; charset=utf-8');
    assert.equal(proxied.headers['cache-control'], 'private, max-age=0');
    assert.equal(proxied.headers['content-length'], String(payload.length));
    assert.equal(proxied.headers['transfer-encoding'], undefined);
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].target,
      `http://127.0.0.1:5002${RUNTIME_CONFIG_PATH}?source=test`
    );
    assert.equal(calls[0].method, 'GET');
    assert.ok(calls[0].signal instanceof AbortSignal);
    assert.equal(calls[0].signal.aborted, false);

    const similarSpaPath = await request({
      port,
      pathname: `${RUNTIME_CONFIG_PATH}/extra`,
    });
    assert.deepEqual(similarSpaPath.body, fixture.contents.index);
    assert.equal(calls.length, 1);
  } finally {
    await server.close();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('runtime-config proxy has a hard deadline and reports a deterministic gateway timeout', async () => {
  const fixture = createBuildFixture();
  const signals = [];
  const server = createDeterministicBuildServer({
    buildDirectory: fixture.buildDirectory,
    port: 0,
    runtimeConfigTimeoutMs: 25,
    fetchImpl: async (_target, { signal }) => {
      signals.push(signal);
      return new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    },
  });
  try {
    const { port } = await server.start();
    const response = await request({ port, pathname: RUNTIME_CONFIG_PATH });
    assert.equal(response.statusCode, 504);
    assert.match(response.body.toString('utf8'), /proxy timed out/);
    assert.equal(signals.length, 1);
    assert.equal(signals[0].aborted, true);
  } finally {
    await server.close();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('startup rejects an occupied port and close releases the owned port for immediate reuse', async () => {
  const fixture = createBuildFixture();
  const occupied = await bindNetServer();
  const occupiedPort = occupied.address().port;
  const blockedServer = createDeterministicBuildServer({
    buildDirectory: fixture.buildDirectory,
    port: occupiedPort,
  });
  try {
    await assert.rejects(blockedServer.start(), (error) => error.code === 'EADDRINUSE');
    await blockedServer.close();
  } finally {
    await closeNetServer(occupied);
  }

  const server = createDeterministicBuildServer({
    buildDirectory: fixture.buildDirectory,
    port: 0,
  });
  try {
    const { port } = await server.start();
    await server.close();
    await server.close();
    const rebound = await bindNetServer(port);
    await closeNetServer(rebound);
  } finally {
    await server.close();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('single-byte range parser rejects ambiguous or out-of-bounds ranges', () => {
  assert.deepEqual(parseSingleByteRange('bytes=2-5', 10), { start: 2, end: 5 });
  assert.deepEqual(parseSingleByteRange('bytes=-3', 10), { start: 7, end: 9 });
  assert.deepEqual(parseSingleByteRange('bytes=8-', 10), { start: 8, end: 9 });
  assert.deepEqual(parseSingleByteRange('bytes=20-', 10), { invalid: true });
  assert.deepEqual(parseSingleByteRange('bytes=1-2,4-5', 10), { invalid: true });
});
