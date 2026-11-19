import React from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { TokenNode } from './grigliataBoardTokenUi';
import {
  __configurePrivateMediaAssetsForTests,
  __resetPrivateMediaAssetsForTests,
  acquirePrivateMediaAsset,
  getPrivateMediaAssetCacheSnapshot,
} from '../common/privateMediaAssets';
import {
  __configureImageAssetRegistryForTests,
  __getImageAssetRegistryStats,
  __resetImageAssetRegistry,
} from '../common/imageAssets/imageAssetRegistry';

jest.mock('react-konva', () => {
  const ReactModule = require('react');
  const passthrough = (type) => {
    const Component = ({ children, name }) => ReactModule.createElement(
      'div',
      { 'data-konva-type': type, 'data-name': name || '' },
      children
    );
    Component.displayName = type;
    return Component;
  };
  const KonvaImage = ({ image, name }) => ReactModule.createElement('div', {
    'data-konva-type': 'Image',
    'data-testid': `konva-image-${name || ''}`,
    'data-drawable': image?.testKey || '',
  });
  return {
    Circle: passthrough('Circle'),
    Group: passthrough('Group'),
    Image: KonvaImage,
    Line: passthrough('Line'),
    Rect: passthrough('Rect'),
    Text: passthrough('Text'),
  };
});

jest.mock('../../data/media/useTask07MediaReadMode', () => ({
  __esModule: true,
  default: () => 'derivative-read',
}));

const PORTRAIT_PATH = `media_assets/v1/signed-in/owner/m_${'b'.repeat(40)}/7/thumbnail`;
const portraitDescriptor = (overrides = {}) => ({
  path: PORTRAIT_PATH,
  generation: '7',
  bytes: 8,
  contentType: 'image/webp',
  width: 1024,
  height: 1024,
  ...overrides,
});
const mapDescriptor = {
  path: `media_assets/v1/signed-in/owner/m_${'c'.repeat(40)}/9/original`,
  generation: '9',
  bytes: 64,
  contentType: 'image/webp',
  width: 64,
  height: 64,
};

const buildToken = (tokenId, thumbnail = portraitDescriptor(), imageUrl = '') => ({
  tokenId,
  id: tokenId,
  ownerUid: 'owner',
  tokenType: 'character',
  label: tokenId,
  imageUrl,
  media: {
    kind: 'avatar',
    schemaVersion: 1,
    state: 'ready',
    variants: { thumbnail },
  },
  placed: true,
  col: 0,
  row: 0,
  isVisibleToPlayers: true,
  isDead: false,
  statuses: [],
});

const POSITION = { x: 0, y: 0, size: 70 };

const Board = ({ tokens, portraitMaxEdge }) => (
  <>
    {tokens.map((token) => (
      <div key={token.tokenId} data-testid={`wrap-${token.tokenId}`}>
        <TokenNode token={token} position={POSITION} portraitMaxEdge={portraitMaxEdge} />
      </div>
    ))}
  </>
);

const portraitOf = (tokenId) => within(screen.getByTestId(`wrap-${tokenId}`))
  .queryByTestId('konva-image-token-portrait')?.getAttribute('data-drawable') || '';

describe('token portrait drawable reuse', () => {
  const originalImage = window.Image;
  let authSession;
  let revokedUrls;
  let decodedSrcs;
  let pendingDecodes;
  let manualDecode;
  let getBlob;
  let createObjectURL;

  const decode = (image) => {
    if (revokedUrls.has(image.src)) {
      image.onerror?.(new Error(`revoked ${image.src}`));
      return;
    }
    image.naturalWidth = 1024;
    image.naturalHeight = 1024;
    image.onload?.();
  };
  const flushDecodes = async () => {
    await act(async () => {
      pendingDecodes.splice(0).forEach(decode);
    });
  };

  beforeEach(() => {
    authSession = { actor: 'viewer', generation: 3 };
    revokedUrls = new Set();
    decodedSrcs = [];
    pendingDecodes = [];
    manualDecode = false;
    class MockImage {
      set src(value) {
        this.currentSrc = value;
        decodedSrcs.push(value);
        if (manualDecode) pendingDecodes.push(this);
        else Promise.resolve().then(() => decode(this));
      }

      get src() {
        return this.currentSrc;
      }

      removeAttribute() {
        this.currentSrc = '';
      }
    }
    window.Image = MockImage;
    __resetImageAssetRegistry();
    __configureImageAssetRegistryForTests({
      createBoundedDrawable: (image, { maxEdge, src }) => ({
        width: maxEdge,
        height: maxEdge,
        dataset: {},
        testKey: `canvas:${src}:${maxEdge}`,
      }),
    });

    let urlCount = 0;
    getBlob = jest.fn(async (_ref, size) => ({ size, type: 'image/webp' }));
    createObjectURL = jest.fn((blob) => {
      urlCount += 1;
      return `blob:token-${blob.size}-${urlCount}`;
    });
    __configurePrivateMediaAssetsForTests({
      maxCacheBytes: 64,
      maxRecords: 8,
      loadStorageApi: jest.fn(async () => ({
        storage: {},
        ref: (_storage, path) => ({ path }),
        getBlob,
      })),
      createObjectURL,
      revokeObjectURL: jest.fn((url) => revokedUrls.add(url)),
      getAuthSession: () => ({ ...authSession }),
    });
  });

  afterEach(() => {
    __resetPrivateMediaAssetsForTests();
    __resetImageAssetRegistry();
    window.Image = originalImage;
  });

  const portraitFetchCount = () => getBlob.mock.calls
    .filter(([objectRef]) => objectRef.path === PORTRAIT_PATH).length;

  // Token A decodes the portrait and returns its lease; then the active map
  // fills the private cache, evicting the portrait blob and revoking its URL.
  const showFirstTokenThenFillCacheWithMap = async (rerenderTokens) => {
    const view = render(<Board tokens={rerenderTokens.slice(0, 1)} />);
    await waitFor(() => expect(portraitOf('token-a')).toBe('canvas:blob:token-8-1:512'));
    await waitFor(() => expect(getPrivateMediaAssetCacheSnapshot().records)
      .toEqual([expect.objectContaining({ path: PORTRAIT_PATH, refCount: 0 })]));
    const mapLease = acquirePrivateMediaAsset(mapDescriptor);
    await act(async () => {
      await mapLease.promise;
    });
    expect(revokedUrls.has('blob:token-8-1')).toBe(true);
    return { view, mapLease };
  };

  test('staggered tokens reuse one authorized bounded drawable after its blob URL was revoked', async () => {
    const tokens = [buildToken('token-a'), buildToken('token-b'), buildToken('token-c')];
    const { view, mapLease } = await showFirstTokenThenFillCacheWithMap(tokens);

    view.rerender(<Board tokens={tokens.slice(0, 2)} />);
    await waitFor(() => expect(portraitOf('token-b')).toBe('canvas:blob:token-8-1:512'));
    view.rerender(<Board tokens={tokens} />);
    await waitFor(() => expect(portraitOf('token-c')).toBe('canvas:blob:token-8-1:512'));

    // One download, one object URL and one decode for all three tokens.
    expect(portraitFetchCount()).toBe(1);
    expect(createObjectURL).toHaveBeenCalledTimes(2); // portrait + map
    expect(decodedSrcs).toEqual(['blob:token-8-1']);
    expect(__getImageAssetRegistryStats()).toMatchObject({ boundedRecordCount: 1 });

    // Even after the first token unmounts, its drawable stays shared.
    view.rerender(<Board tokens={tokens.slice(1)} />);
    expect(portraitOf('token-b')).toBe('canvas:blob:token-8-1:512');
    expect(portraitOf('token-c')).toBe('canvas:blob:token-8-1:512');
    view.unmount();
    mapLease.release();
  });

  test('a changed auth scope never reuses the drawable and downloads under the new scope', async () => {
    const tokens = [buildToken('token-a'), buildToken('token-b')];
    const { view, mapLease } = await showFirstTokenThenFillCacheWithMap(tokens);

    authSession = { actor: 'viewer', generation: 4 };
    view.rerender(<Board tokens={tokens} />);
    await waitFor(() => expect(portraitOf('token-b')).toMatch(/^canvas:blob:token-8-3:512$/));
    expect(portraitOf('token-a')).toBe('canvas:blob:token-8-1:512');
    expect(portraitFetchCount()).toBe(2);
    view.unmount();
    mapLease.release();
  });

  test.each([false, true])('a same-uid generation change never hands prior-scope cached bytes or drawable to a fresh token (old record held: %s)', async (holdOldRecord) => {
    const tokens = [buildToken('token-a'), buildToken('token-b')];
    const view = render(<Board tokens={tokens.slice(0, 1)} />);
    await waitFor(() => expect(portraitOf('token-a')).toBe('canvas:blob:token-8-1:512'));
    // The old-scope blob is still cached (nothing evicted it).
    await waitFor(() => expect(getPrivateMediaAssetCacheSnapshot().records)
      .toEqual([expect.objectContaining({ path: PORTRAIT_PATH, status: 'ready', refCount: 0 })]));
    const heldLease = holdOldRecord
      ? acquirePrivateMediaAsset(portraitDescriptor(), { maxDrawableEdge: 512 })
      : null;
    if (heldLease) await act(async () => { await heldLease.promise; });

    authSession = { actor: 'viewer', generation: 4 };
    view.rerender(<Board tokens={tokens} />);
    await waitFor(() => expect(portraitOf('token-b')).toBe('canvas:blob:token-8-2:512'));
    expect(portraitOf('token-a')).toBe('canvas:blob:token-8-1:512');
    expect(portraitFetchCount()).toBe(2);
    expect(decodedSrcs).toEqual(['blob:token-8-1', 'blob:token-8-2']);

    // A held old-scope record keeps its URL for its holder until released.
    expect(revokedUrls.has('blob:token-8-1')).toBe(!holdOldRecord);
    heldLease?.release();
    expect(revokedUrls.has('blob:token-8-1')).toBe(true);
    // The token still showing the old-scope drawable keeps it (decoded).
    expect(portraitOf('token-a')).toBe('canvas:blob:token-8-1:512');
    view.unmount();
  });

  test('changed metadata for the same immutable path is not reused', async () => {
    const tokens = [
      buildToken('token-a'),
      buildToken('token-b', portraitDescriptor({ width: 1000 })),
    ];
    const { view, mapLease } = await showFirstTokenThenFillCacheWithMap(tokens);

    view.rerender(<Board tokens={tokens} />);
    await waitFor(() => expect(portraitFetchCount()).toBe(2));
    expect(portraitOf('token-b')).not.toBe('canvas:blob:token-8-1:512');
    view.unmount();
    mapLease.release();
  });

  test('a failed authorization disables reuse and keeps the resolver fallback order', async () => {
    const tokens = [
      buildToken('token-a'),
      buildToken('token-b', portraitDescriptor(), 'https://example.test/legacy-b.png'),
    ];
    const { view, mapLease } = await showFirstTokenThenFillCacheWithMap(tokens);

    // An ordinary consumer's new authenticated fetch of the same bytes fails.
    mapLease.release();
    getBlob.mockImplementationOnce(async () => {
      throw Object.assign(new Error('denied'), { code: 'storage/unauthorized' });
    });
    const denied = acquirePrivateMediaAsset(portraitDescriptor());
    await act(async () => {
      await expect(denied.promise).rejects.toThrow('denied');
    });
    denied.release();

    view.rerender(<Board tokens={tokens} />);
    await waitFor(() => expect(portraitOf('token-b'))
      .toBe('canvas:https://example.test/legacy-b.png:512'));
    expect(portraitOf('token-a')).toBe('canvas:blob:token-8-1:512');
    view.unmount();
  });

  test.each(['', 'https://example.test/allowed-legacy.png'])('a denied resolution change discards the old portrait (fallback %s)', async (legacyUrl) => {
    const tokens = [buildToken('token-a', portraitDescriptor(), legacyUrl)];
    const {view, mapLease} = await showFirstTokenThenFillCacheWithMap(tokens);
    try {
      authSession.generation += 1;
      getBlob.mockRejectedValueOnce(Object.assign(new Error('denied'), {code: 'storage/unauthorized'}));
      await act(async () => { view.rerender(<Board tokens={tokens} portraitMaxEdge={256} />); });
      expect(portraitFetchCount()).toBe(2);
      expect(portraitOf('token-a')).toBe(legacyUrl ? `canvas:${legacyUrl}:256` : '');
    } finally {
      view.unmount();
      mapLease.release();
    }
  });

  test('a new portrait resolution keeps the previous picture until the new drawable decodes', async () => {
    const tokens = [buildToken('token-a')];
    const view = render(<Board tokens={tokens} portraitMaxEdge={512} />);
    await waitFor(() => expect(portraitOf('token-a')).toBe('canvas:blob:token-8-1:512'));

    manualDecode = true;
    view.rerender(<Board tokens={tokens} portraitMaxEdge={256} />);
    await waitFor(() => expect(pendingDecodes).toHaveLength(1));
    expect(portraitOf('token-a')).toBe('canvas:blob:token-8-1:512');
    expect(getPrivateMediaAssetCacheSnapshot().records).toEqual([
      expect.objectContaining({ path: PORTRAIT_PATH, drawableEdge: 256 }),
    ]);

    await flushDecodes();
    await waitFor(() => expect(portraitOf('token-a')).toBe('canvas:blob:token-8-1:256'));
    expect(portraitFetchCount()).toBe(1);
    view.unmount();
  });

  test('invalid or missing portraitMaxEdge falls back to 512', async () => {
    const tokens = [buildToken('token-a')];
    const view = render(<Board tokens={tokens} portraitMaxEdge="not-a-number" />);
    await waitFor(() => expect(portraitOf('token-a')).toBe('canvas:blob:token-8-1:512'));
    view.unmount();
  });
});
