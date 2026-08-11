const CHUNK_CACHE_PARAMETER = 'fnd-chunk-recovery';

export const STATIC_CHUNK_RECOVERY_EPOCH = '2026-08-11.1';

const installations = new WeakMap();

const isRecoverableChunkUrl = (url, applicationUrl) => (
  url.origin === applicationUrl.origin
  && /^\/static\/(?:js\/[^/]+\.chunk\.js|css\/[^/]+\.chunk\.css)$/.test(url.pathname)
);

const getChunkSourceProperty = (node) => {
  if (node?.tagName === 'SCRIPT') return 'src';
  if (node?.tagName === 'LINK' && node.rel === 'stylesheet') return 'href';
  return '';
};

export const installStaticChunkRecovery = ({
  cacheEpoch = STATIC_CHUNK_RECOVERY_EPOCH,
  documentObject = typeof document === 'undefined' ? null : document,
  locationHref = typeof window === 'undefined' ? '' : window.location.href,
} = {}) => {
  const head = documentObject?.head;
  if (!head || !locationHref || !cacheEpoch) return () => {};

  const existing = installations.get(head);
  if (existing) return existing.cleanup;

  let applicationUrl;
  try {
    applicationUrl = new URL(locationHref);
  } catch (_error) {
    return () => {};
  }

  const originalAppendChild = head.appendChild;
  const patchedAppendChild = function appendChildWithChunkRecovery(node) {
    const sourceProperty = getChunkSourceProperty(node);
    if (sourceProperty && typeof node[sourceProperty] === 'string' && node[sourceProperty]) {
      try {
        const chunkUrl = new URL(node[sourceProperty], applicationUrl);
        if (isRecoverableChunkUrl(chunkUrl, applicationUrl)) {
          chunkUrl.searchParams.set(CHUNK_CACHE_PARAMETER, cacheEpoch);
          node[sourceProperty] = chunkUrl.toString();
        }
      } catch (_error) {
        // Preserve the browser's native handling for malformed or non-URL sources.
      }
    }
    return originalAppendChild.call(this, node);
  };

  const cleanup = () => {
    if (head.appendChild === patchedAppendChild) {
      head.appendChild = originalAppendChild;
    }
    installations.delete(head);
  };

  head.appendChild = patchedAppendChild;
  installations.set(head, {cleanup});
  return cleanup;
};
