import {
  installStaticChunkRecovery,
  STATIC_CHUNK_RECOVERY_EPOCH,
} from './staticChunkRecovery';

describe('static chunk cache recovery', () => {
  let cleanup;

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    document.head.replaceChildren();
  });

  test('cache-busts same-origin JavaScript chunks before insertion', () => {
    cleanup = installStaticChunkRecovery({
      documentObject: document,
      locationHref: 'https://fatins.web.app/grigliata',
    });
    const script = document.createElement('script');
    script.src = 'https://fatins.web.app/static/js/6965.dfeacee0.chunk.js';

    document.head.appendChild(script);

    const resolved = new URL(script.src);
    expect(resolved.searchParams.get('fnd-chunk-recovery'))
      .toBe(STATIC_CHUNK_RECOVERY_EPOCH);
  });

  test('cache-busts same-origin stylesheet chunks before insertion', () => {
    cleanup = installStaticChunkRecovery({
      documentObject: document,
      locationHref: 'https://fatins.web.app/grigliata',
    });
    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = 'https://fatins.web.app/static/css/route-test.12345678.chunk.css';

    document.head.appendChild(stylesheet);

    const resolved = new URL(stylesheet.href);
    expect(resolved.searchParams.get('fnd-chunk-recovery'))
      .toBe(STATIC_CHUNK_RECOVERY_EPOCH);
  });

  test.each([
    'https://fatins.web.app/static/js/main.af35b933.js',
    'https://fatins.web.app/static/css/main.239a1547.css',
    'https://example.com/static/js/6965.dfeacee0.chunk.js',
  ])('leaves non-chunk or cross-origin assets unchanged: %s', (source) => {
    cleanup = installStaticChunkRecovery({
      documentObject: document,
      locationHref: 'https://fatins.web.app/grigliata',
    });
    const script = document.createElement('script');
    script.src = source;

    document.head.appendChild(script);

    expect(script.src).toBe(source);
  });

  test('installs once and restores the original insertion behavior', () => {
    const originalAppendChild = document.head.appendChild;
    cleanup = installStaticChunkRecovery({
      documentObject: document,
      locationHref: 'https://fatins.web.app/grigliata',
    });
    const firstPatchedAppendChild = document.head.appendChild;
    const duplicateCleanup = installStaticChunkRecovery({
      documentObject: document,
      locationHref: 'https://fatins.web.app/grigliata',
    });

    expect(document.head.appendChild).toBe(firstPatchedAppendChild);
    expect(duplicateCleanup).toBe(cleanup);

    cleanup();
    cleanup = undefined;
    expect(document.head.appendChild).toBe(originalAppendChild);
  });
});
