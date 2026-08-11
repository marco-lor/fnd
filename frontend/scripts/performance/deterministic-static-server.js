const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const zlib = require('zlib');

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 5000;
const RUNTIME_CONFIG_PATH = '/fatins-runtime/firebase-client';
const DEFAULT_RUNTIME_CONFIG_UPSTREAM_URL =
  'http://127.0.0.1:5002/fatins-runtime/firebase-client';
const COMPRESSION_THRESHOLD_BYTES = 1024;
const STATIC_CACHE_CONTROL = 'public, max-age=0, must-revalidate';
const INDEX_CACHE_CONTROL = 'no-cache, max-age=0, must-revalidate';
const DAILY_CACHE_CONTROL = 'public, max-age=86400, must-revalidate';
const SERVER_ID = 'deterministic-build-v1';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const SECURITY_HEADERS = Object.freeze({
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy-Report-Only': [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.gstatic.com https://apis.google.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob: https://firebasestorage.googleapis.com https://storage.googleapis.com http://127.0.0.1:9199",
    "media-src 'self' blob: https://firebasestorage.googleapis.com https://storage.googleapis.com http://127.0.0.1:9199",
    "connect-src 'self' https://*.googleapis.com https://apis.google.com https://www.google.com https://*.firebaseio.com https://*.firebaseapp.com https://*.firebaseinstallations.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://firestore.googleapis.com https://firebase.googleapis.com https://firebasestorage.googleapis.com https://*.cloudfunctions.net wss://*.firebaseio.com http://127.0.0.1:5001 http://127.0.0.1:8080 http://127.0.0.1:9099 http://127.0.0.1:9199",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-src 'self' http://127.0.0.1:9099 https://www.google.com",
    'report-to fnd-performance-csp',
  ].join('; '),
});
const MIME_TYPES = Object.freeze({
  '.avif': 'image/avif',
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.ogg': 'audio/ogg',
  '.otf': 'font/otf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml; charset=utf-8',
});
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'content-encoding',
  'content-length',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

const normalizeError = (error) => (
  error instanceof Error ? error : new Error(String(error))
);

const assertLoopbackRuntimeConfigUrl = (candidate) => {
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch (_error) {
    throw new Error('Runtime-config upstream must be a valid loopback HTTP URL.');
  }
  if (
    parsed.protocol !== 'http:'
    || !LOOPBACK_HOSTS.has(parsed.hostname)
    || parsed.username
    || parsed.password
    || parsed.pathname !== RUNTIME_CONFIG_PATH
  ) {
    throw new Error(
      `Runtime-config upstream must use ${RUNTIME_CONFIG_PATH} on a loopback HTTP host.`
    );
  }
  parsed.hash = '';
  return parsed;
};

const contentTypeForPath = (filePath) => (
  MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream'
);

const isCompressibleContentType = (contentType) => (
  contentType.startsWith('text/')
  || contentType.startsWith('application/javascript')
  || contentType.startsWith('application/json')
  || contentType.startsWith('application/xml')
  || contentType.startsWith('image/svg+xml')
);

const cacheControlForPath = (assetPath) => {
  if (assetPath.startsWith('/static/')) return STATIC_CACHE_CONTROL;
  if (assetPath === '/index.html') return INDEX_CACHE_CONTROL;
  if (['/favicon.ico', '/logo192.png', '/logo512.png'].includes(assetPath)) {
    return DAILY_CACHE_CONTROL;
  }
  return 'no-cache';
};

const classifyBuildEntry = (entry, absolutePath, fsImpl = fs) => {
  let isDirectory = entry.isDirectory();
  let isFile = entry.isFile();
  if (entry.isSymbolicLink()) {
    const entryStat = fsImpl.lstatSync(absolutePath);
    if (entryStat.isSymbolicLink()) {
      throw new Error(`Performance build snapshot refuses symbolic-link entry: ${entry.name}`);
    }
    // OneDrive cloud-file reparse points are reported as symbolic Dirents on
    // Windows even though lstat identifies the hydrated entry as a regular
    // file or directory. Accept only that verified regular shape.
    isDirectory = entryStat.isDirectory();
    isFile = entryStat.isFile();
  }
  if (isDirectory) return 'directory';
  if (isFile) return 'file';
  return null;
};

const collectBuildFiles = (directory, relativeDirectory = '', fsImpl = fs) => {
  const entries = fsImpl.readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name));
  return entries.flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    const relativePath = path.join(relativeDirectory, entry.name);
    const entryKind = classifyBuildEntry(entry, absolutePath, fsImpl);
    if (entryKind === 'directory') {
      return collectBuildFiles(absolutePath, relativePath, fsImpl);
    }
    if (entryKind !== 'file') return [];
    return [{ absolutePath, relativePath }];
  });
};

const createBuildSnapshot = ({
  buildDirectory,
  fsImpl = fs,
  brotliCompressImpl = (contents) => zlib.brotliCompressSync(contents, {
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: 4,
    },
  }),
  gzipCompressImpl = (contents) => zlib.gzipSync(contents),
} = {}) => {
  if (!buildDirectory) throw new TypeError('buildDirectory is required.');
  const absoluteBuildDirectory = path.resolve(buildDirectory);
  const indexPath = path.join(absoluteBuildDirectory, 'index.html');
  if (!fsImpl.existsSync(indexPath) || !fsImpl.statSync(indexPath).isFile()) {
    throw new Error(`Performance build snapshot is missing index.html: ${indexPath}`);
  }

  const assets = new Map();
  for (const { absolutePath, relativePath } of collectBuildFiles(
    absoluteBuildDirectory,
    '',
    fsImpl
  )) {
    const body = fsImpl.readFileSync(absolutePath);
    const stat = fsImpl.statSync(absolutePath);
    const assetPath = `/${relativePath.split(path.sep).join('/')}`;
    const contentType = contentTypeForPath(relativePath);
    const encodings = { identity: body };
    if (
      body.length >= COMPRESSION_THRESHOLD_BYTES
      && isCompressibleContentType(contentType)
    ) {
      encodings.br = brotliCompressImpl(body);
      encodings.gzip = gzipCompressImpl(body);
    }
    assets.set(assetPath, Object.freeze({
      path: assetPath,
      contentType,
      cacheControl: cacheControlForPath(assetPath),
      etag: crypto.createHash('md5').update(body).digest('hex'),
      lastModified: new Date(stat.mtimeMs).toUTCString(),
      size: body.length,
      encodings: Object.freeze(encodings),
    }));
  }

  return Object.freeze({
    assets,
    buildDirectory: absoluteBuildDirectory,
    index: assets.get('/index.html'),
  });
};

const parseAcceptEncoding = (headerValue) => {
  const qualityByEncoding = new Map();
  String(headerValue || '').split(',').forEach((candidate) => {
    const [rawName, ...parameters] = candidate.trim().split(';');
    const name = rawName.toLowerCase();
    if (!name) return;
    let quality = 1;
    const qualityParameter = parameters
      .map((parameter) => parameter.trim())
      .find((parameter) => parameter.startsWith('q='));
    if (qualityParameter) {
      const parsed = Number(qualityParameter.slice(2));
      quality = Number.isFinite(parsed) ? parsed : 0;
    }
    qualityByEncoding.set(name, Math.max(0, Math.min(1, quality)));
  });
  const qualityFor = (name) => (
    qualityByEncoding.has(name)
      ? qualityByEncoding.get(name)
      : qualityByEncoding.get('*') || 0
  );
  return { qualityFor };
};

const chooseRepresentation = (asset, acceptEncoding, { forceIdentity = false } = {}) => {
  if (forceIdentity) return { body: asset.encodings.identity, encoding: null };
  const { qualityFor } = parseAcceptEncoding(acceptEncoding);
  const candidates = [
    { name: 'br', quality: qualityFor('br') },
    { name: 'gzip', quality: qualityFor('gzip') },
  ].filter(({ name, quality }) => quality > 0 && asset.encodings[name]);
  candidates.sort((left, right) => right.quality - left.quality);
  const selected = candidates[0];
  return selected
    ? { body: asset.encodings[selected.name], encoding: selected.name }
    : { body: asset.encodings.identity, encoding: null };
};

const parseSingleByteRange = (headerValue, size) => {
  if (!headerValue) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(headerValue).trim());
  if (!match || (!match[1] && !match[2])) return { invalid: true };
  let start;
  let end;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) return { invalid: true };
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }
  if (
    !Number.isInteger(start)
    || !Number.isInteger(end)
    || start < 0
    || end < start
    || start >= size
  ) {
    return { invalid: true };
  }
  return { start, end: Math.min(end, size - 1) };
};

const applySharedHeaders = (response) => {
  Object.entries(SECURITY_HEADERS).forEach(([name, value]) => response.setHeader(name, value));
  response.setHeader('X-FND-Performance-Static-Server', SERVER_ID);
};

const requestIsNotModified = (request, asset) => {
  const ifNoneMatch = request.headers['if-none-match'];
  if (ifNoneMatch) {
    return String(ifNoneMatch).split(',').map((value) => value.trim().replace(/^W\//, ''))
      .some((value) => value === '*' || value.replace(/^"|"$/g, '') === asset.etag);
  }
  const ifModifiedSince = Date.parse(request.headers['if-modified-since'] || '');
  return Number.isFinite(ifModifiedSince)
    && ifModifiedSince >= Date.parse(asset.lastModified);
};

const sendAsset = (request, response, asset) => {
  applySharedHeaders(response);
  response.setHeader('Cache-Control', asset.cacheControl);
  response.setHeader('Content-Type', asset.contentType);
  response.setHeader('ETag', asset.etag);
  response.setHeader('Last-Modified', asset.lastModified);
  response.setHeader('Vary', 'Accept-Encoding');
  response.setHeader('Accept-Ranges', 'bytes');

  if (requestIsNotModified(request, asset)) {
    response.statusCode = 304;
    response.end();
    return;
  }

  const range = parseSingleByteRange(request.headers.range, asset.size);
  if (range?.invalid) {
    response.statusCode = 416;
    response.setHeader('Content-Range', `bytes */${asset.size}`);
    response.setHeader('Content-Length', '0');
    response.end();
    return;
  }

  let representation = chooseRepresentation(
    asset,
    request.headers['accept-encoding'],
    { forceIdentity: Boolean(range) }
  );
  if (range) {
    response.statusCode = 206;
    response.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${asset.size}`);
    representation = {
      body: representation.body.subarray(range.start, range.end + 1),
      encoding: null,
    };
  } else {
    response.statusCode = 200;
  }
  if (representation.encoding) {
    response.setHeader('Content-Encoding', representation.encoding);
  }
  response.setHeader('Content-Length', String(representation.body.length));
  if (request.method === 'HEAD') {
    response.end();
    return;
  }
  response.end(representation.body);
};

const parseRequestTarget = (rawTarget) => {
  const target = String(rawTarget || '/');
  const rawPath = target.split('?')[0].split('#')[0];
  let decodedRawPath;
  try {
    decodedRawPath = decodeURIComponent(rawPath);
  } catch (_error) {
    throw new Error('Request path is not valid URL encoding.');
  }
  if (
    decodedRawPath.includes('\0')
    || decodedRawPath.includes('\\')
    || decodedRawPath.split('/').some((segment) => segment === '..')
  ) {
    throw new Error('Request path contains an unsafe segment.');
  }
  const parsed = new URL(target, 'http://127.0.0.1');
  return {
    pathname: decodeURIComponent(parsed.pathname),
    search: parsed.search,
  };
};

const sendPlainResponse = (response, statusCode, message, extraHeaders = {}) => {
  const body = Buffer.from(message, 'utf8');
  applySharedHeaders(response);
  response.statusCode = statusCode;
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', 'text/plain; charset=utf-8');
  Object.entries(extraHeaders).forEach(([name, value]) => response.setHeader(name, value));
  response.setHeader('Content-Length', String(body.length));
  response.end(body);
};

const copyUpstreamHeaders = (upstreamResponse, response) => {
  if (!upstreamResponse?.headers || typeof upstreamResponse.headers.entries !== 'function') return;
  for (const [name, value] of upstreamResponse.headers.entries()) {
    if (!HOP_BY_HOP_HEADERS.has(name.toLowerCase())) {
      response.setHeader(name, value);
    }
  }
};

const createDeterministicBuildServer = ({
  buildDirectory,
  host = DEFAULT_HOST,
  port = DEFAULT_PORT,
  runtimeConfigUpstreamUrl = DEFAULT_RUNTIME_CONFIG_UPSTREAM_URL,
  runtimeConfigTimeoutMs = 10_000,
  fetchImpl = global.fetch,
  createServerImpl = (handler) => http.createServer(handler),
  createBuildSnapshotImpl = createBuildSnapshot,
} = {}) => {
  if (!buildDirectory) throw new TypeError('buildDirectory is required.');
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new TypeError('port must be an integer between 0 and 65535.');
  }
  if (!Number.isFinite(runtimeConfigTimeoutMs) || runtimeConfigTimeoutMs <= 0) {
    throw new TypeError('runtimeConfigTimeoutMs must be a positive finite number.');
  }
  if (typeof fetchImpl !== 'function' || typeof createServerImpl !== 'function') {
    throw new TypeError('fetchImpl and createServerImpl must be functions.');
  }
  const upstream = assertLoopbackRuntimeConfigUrl(runtimeConfigUpstreamUrl);
  let snapshot;
  let server;
  let startPromise;
  let closePromise;
  let state = 'idle';
  const sockets = new Set();
  const activeProxyControllers = new Set();

  const proxyRuntimeConfig = async (request, response, search) => {
    const controller = new AbortController();
    activeProxyControllers.add(controller);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, runtimeConfigTimeoutMs);
    timer.unref?.();
    try {
      const target = new URL(upstream);
      target.search = search;
      const upstreamResponse = await fetchImpl(target, {
        method: request.method,
        headers: {
          accept: request.headers.accept || '*/*',
          'user-agent': request.headers['user-agent'] || 'fnd-performance-static-server',
        },
        signal: controller.signal,
      });
      const body = request.method === 'HEAD'
        ? Buffer.alloc(0)
        : Buffer.from(await upstreamResponse.arrayBuffer());
      if (response.destroyed || response.writableEnded) return;
      applySharedHeaders(response);
      response.statusCode = upstreamResponse.status;
      copyUpstreamHeaders(upstreamResponse, response);
      if (!response.hasHeader('Cache-Control')) response.setHeader('Cache-Control', 'no-store');
      response.setHeader('Content-Length', String(body.length));
      response.end(body);
    } catch (error) {
      if (response.destroyed || response.writableEnded || state === 'closing' || state === 'closed') {
        return;
      }
      sendPlainResponse(
        response,
        timedOut ? 504 : 502,
        timedOut
          ? 'Performance runtime-config proxy timed out.'
          : `Performance runtime-config proxy failed: ${normalizeError(error).message}`
      );
    } finally {
      clearTimeout(timer);
      activeProxyControllers.delete(controller);
    }
  };

  const handleRequest = async (request, response) => {
    if (!['GET', 'HEAD'].includes(request.method)) {
      sendPlainResponse(response, 405, 'Method not allowed.', { Allow: 'GET, HEAD' });
      return;
    }
    let target;
    try {
      target = parseRequestTarget(request.url);
    } catch (error) {
      sendPlainResponse(response, 400, normalizeError(error).message);
      return;
    }
    if (target.pathname === RUNTIME_CONFIG_PATH) {
      await proxyRuntimeConfig(request, response, target.search);
      return;
    }
    const requestedAsset = snapshot.assets.get(target.pathname);
    if (!requestedAsset && target.pathname.startsWith('/static/')) {
      sendPlainResponse(response, 404, 'Static asset not found.', {
        'Cache-Control': STATIC_CACHE_CONTROL,
      });
      return;
    }
    const asset = requestedAsset || snapshot.index;
    sendAsset(request, response, asset);
  };

  const start = () => {
    if (startPromise) return startPromise;
    if (state !== 'idle') {
      return Promise.reject(new Error(`Performance static server cannot start from state ${state}.`));
    }
    state = 'starting';
    startPromise = Promise.resolve().then(async () => {
      snapshot = createBuildSnapshotImpl({ buildDirectory });
      server = createServerImpl((request, response) => {
        Promise.resolve(handleRequest(request, response)).catch((error) => {
          if (!response.destroyed && !response.writableEnded) {
            sendPlainResponse(response, 500, `Performance static server failed: ${normalizeError(error).message}`);
          }
        });
      });
      server.on('connection', (socket) => {
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
      });
      await new Promise((resolve, reject) => {
        const onError = (error) => {
          server.removeListener('listening', onListening);
          reject(error);
        };
        const onListening = () => {
          server.removeListener('error', onError);
          resolve();
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen({ host, port, exclusive: true });
      });
      state = 'listening';
      return server.address();
    }).catch((error) => {
      state = 'failed';
      throw error;
    });
    return startPromise;
  };

  const close = () => {
    if (closePromise) return closePromise;
    state = 'closing';
    activeProxyControllers.forEach((controller) => controller.abort());
    closePromise = new Promise((resolve, reject) => {
      if (!server || !server.listening) {
        sockets.forEach((socket) => socket.destroy());
        resolve();
        return;
      }
      server.close((error) => {
        if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') {
          reject(error);
          return;
        }
        resolve();
      });
      server.closeIdleConnections?.();
      server.closeAllConnections?.();
      sockets.forEach((socket) => socket.destroy());
    }).finally(() => {
      state = 'closed';
    });
    return closePromise;
  };

  return {
    address: () => server?.address() || null,
    close,
    start,
  };
};

module.exports = {
  COMPRESSION_THRESHOLD_BYTES,
  DEFAULT_RUNTIME_CONFIG_UPSTREAM_URL,
  INDEX_CACHE_CONTROL,
  RUNTIME_CONFIG_PATH,
  SECURITY_HEADERS,
  SERVER_ID,
  STATIC_CACHE_CONTROL,
  classifyBuildEntry,
  createBuildSnapshot,
  createDeterministicBuildServer,
  parseSingleByteRange,
};
