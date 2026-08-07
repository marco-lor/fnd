import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import MediaImage, {
  hasMediaAsset,
  resolveMediaAsset,
} from './MediaImage';
import {
  __configurePrivateMediaAssetsForTests,
  __resetPrivateMediaAssetsForTests,
} from './privateMediaAssets';

const mediaEntity = {
  imageUrl: 'https://private.example/original-legacy.jpg',
  imageWidth: 1600,
  imageHeight: 900,
  media: {
    schemaVersion: 1,
    state: 'ready',
    original: {
      url: 'https://private.example/original.jpg',
      width: 1600,
      height: 900,
    },
    variants: {
      thumbnail: {
        url: 'https://private.example/thumbnail.webp',
        width: 160,
        height: 90,
      },
      card: {
        url: 'https://private.example/card.webp',
        width: 640,
        height: 360,
      },
      board: {
        url: 'https://private.example/board.webp',
        width: 1280,
        height: 720,
      },
    },
  },
};

const PRIVATE_IMAGE_ASSET_ID = `m_${'a'.repeat(40)}`;
const PRIVATE_IMAGE_SOURCE_GENERATION = '7';
const PRIVATE_IMAGE_GENERATIONS = Object.freeze({
  original: '1',
  thumbnail: '2',
  thumbnail2x: '3',
  card: '4',
});
const PRIVATE_IMAGE_WIDTHS = Object.freeze({
  original: 320,
  thumbnail: 64,
  thumbnail2x: 128,
  card: 256,
});
const privateDescriptor = (name, bytes = 4) => ({
  path: name === 'original'
    ? `media_assets/v1/signed-in/user/${PRIVATE_IMAGE_ASSET_ID}/${PRIVATE_IMAGE_SOURCE_GENERATION}/original`
    : `media_assets/v1/signed-in/user/${PRIVATE_IMAGE_ASSET_ID}/${PRIVATE_IMAGE_SOURCE_GENERATION}/${name}`,
  generation: PRIVATE_IMAGE_GENERATIONS[name],
  bytes,
  contentType: 'image/webp',
  width: PRIVATE_IMAGE_WIDTHS[name],
  height: PRIVATE_IMAGE_WIDTHS[name],
});

describe('MediaImage', () => {
  const previousIntersectionObserver = global.IntersectionObserver;
  const previousDevicePixelRatio = window.devicePixelRatio;
  let observerCallback;
  let disconnect;
  let observe;

  beforeEach(() => {
    disconnect = jest.fn();
    observe = jest.fn();
    observerCallback = null;
    global.IntersectionObserver = jest.fn((callback) => {
      observerCallback = callback;
      return { disconnect, observe };
    });
  });

  afterEach(() => {
    global.IntersectionObserver = previousIntersectionObserver;
    Object.defineProperty(window, 'devicePixelRatio', {
      configurable: true,
      value: previousDevicePixelRatio,
    });
    __resetPrivateMediaAssetsForTests();
  });

  test('selects canonical derivatives with variant-specific safe fallbacks', () => {
    expect(resolveMediaAsset(mediaEntity, {
      compatibilityMode: 'derivative-read',
      variant: 'thumbnail',
    })).toEqual(
      expect.objectContaining({
        selectedVariant: 'thumbnail',
        url: 'https://private.example/thumbnail.webp',
        width: 160,
        height: 90,
      })
    );
    expect(resolveMediaAsset(mediaEntity, {
      compatibilityMode: 'derivative-read',
      variant: 'card',
    }).url)
      .toBe('https://private.example/card.webp');
    expect(resolveMediaAsset(mediaEntity, {
      compatibilityMode: 'derivative-read',
      variant: 'board',
    }).url)
      .toBe('https://private.example/board.webp');
    expect(resolveMediaAsset({
      media: {
        schemaVersion: 1,
        state: 'ready',
        original: { url: 'https://private.example/fallback.png', width: 100, height: 50 },
        variants: {},
      },
    }, {
      compatibilityMode: 'derivative-read',
      variant: 'board',
    })).toEqual(expect.objectContaining({
      selectedVariant: 'original',
      url: 'https://private.example/fallback.png',
    }));
    expect(hasMediaAsset({ imageUrl: 'https://private.example/legacy.png' })).toBe(true);
  });

  test('keeps legacy and shadow readers on preserved URLs and enables only ready derivatives', () => {
    const versioned = {
      media: {
        schemaVersion: 1,
        state: 'ready',
        kind: 'avatar',
        original: {
          url: 'https://private.example/large-original.png',
          width: 4096,
          height: 4096,
        },
        variants: {
          thumbnail: {
            url: 'https://private.example/avatar-thumbnail.webp',
            width: 64,
            height: 64,
          },
        },
      },
      imageUrl: 'https://private.example/legacy-original.png',
    };

    const strictAsset = resolveMediaAsset(versioned, {
      compatibilityMode: 'derivative-read',
      variant: 'thumbnail',
    });
    expect(strictAsset.candidates.map(({ variant }) => variant)).toEqual([
      'thumbnail',
      'legacy',
    ]);
    expect(strictAsset.srcSet).toContain('avatar-thumbnail.webp 64w');
    expect(strictAsset.srcSet).not.toContain('large-original.png');
    expect(strictAsset.srcSet).not.toContain('legacy-original.png');

    const processingAsset = resolveMediaAsset({
      ...versioned,
      media: { ...versioned.media, state: 'processing' },
    }, {
      compatibilityMode: 'derivative-read',
      variant: 'thumbnail',
    });
    expect(processingAsset.candidates.map(({ variant }) => variant)).toEqual(['legacy']);

    const shadowAsset = resolveMediaAsset({
      ...versioned,
      media: { ...versioned.media, state: 'shadow' },
    }, {
      compatibilityMode: 'shadow',
      variant: 'thumbnail',
    });
    expect(shadowAsset.candidates.map(({ variant }) => variant)).toEqual(['legacy']);

    const explicitLegacyAsset = resolveMediaAsset(versioned, {
      compatibilityMode: 'legacy',
      variant: 'thumbnail',
    });
    expect(explicitLegacyAsset.candidates.map(({ variant }) => variant)).toEqual(['legacy']);
    expect(resolveMediaAsset(versioned, {variant: 'thumbnail'}).url)
      .toBe('https://private.example/legacy-original.png');

    const v1OnlyRollback = resolveMediaAsset({media: versioned.media}, {
      compatibilityMode: 'legacy',
      variant: 'thumbnail',
    });
    expect(v1OnlyRollback.candidates.map(({variant}) => variant)).toEqual(['original']);
    expect(v1OnlyRollback.url).toBe('https://private.example/large-original.png');
  });

  test('canonical-only reads verified derivatives without any legacy fallback', () => {
    const strictEntity = {
      imageUrl: 'https://private.example/original-legacy.jpg',
      media: {
        schemaVersion: 1,
        state: 'ready',
        kind: 'avatar',
        placeholder: { url: 'https://private.example/legacy-placeholder.jpg' },
        original: privateDescriptor('original'),
        variants: {
          card: {
            ...privateDescriptor('card'),
            downloadUrl: 'https://private.example/card-legacy.webp',
          },
          thumbnail: privateDescriptor('thumbnail'),
        },
      },
    };
    const result = resolveMediaAsset(strictEntity, {
      compatibilityMode: 'canonical-only',
      variant: 'card',
    });
    expect(result.candidates.map(({variant}) => variant)).toEqual(['card']);
    expect(result.candidates.every(({url}) => url === '')).toBe(true);
    expect(result.placeholderUrl).toBe('');
    expect(resolveMediaAsset({
      imageUrl: 'https://private.example/legacy-only.jpg',
    }, {
      compatibilityMode: 'canonical-only',
      variant: 'card',
    }).candidates).toHaveLength(0);
  });

  test('canonical-only never attaches a persisted legacy URL to the DOM', () => {
    render(
      <MediaImage
        compatibilityMode="canonical-only"
        media={{image_url: 'https://firebasestorage.example/legacy-only.jpg'}}
        mediaPurpose="item"
        src="https://firebasestorage.example/legacy-only.jpg"
        loading="eager"
        alt="Strict legacy-only item"
        fallback={<span>Canonical image unavailable</span>}
      />
    );

    expect(screen.queryByAltText('Strict legacy-only item')).not.toBeInTheDocument();
    expect(screen.getByText('Canonical image unavailable')).toBeInTheDocument();
  });

  test('pending mode does not attach a legacy image URL', () => {
    render(
      <MediaImage
        compatibilityMode="pending"
        media={{imageUrl: 'https://private.example/must-not-load.jpg'}}
        loading="eager"
        alt="Pending media control"
      />
    );
    expect(screen.getByAltText('Pending media control')).not.toHaveAttribute('src');
    expect(resolveMediaAsset(mediaEntity, {
      compatibilityMode: 'pending',
      variant: 'card',
    }).candidates).toHaveLength(0);
  });

  test('maps legacy board preview requests onto approved gallery density variants', () => {
    const result = resolveMediaAsset({
      media: {
        schemaVersion: 1,
        state: 'ready',
        kind: 'map',
        original: {
          url: 'https://private.example/full-map.png',
          width: 3840,
          height: 2160,
        },
        variants: {
          gallery: {
            url: 'https://private.example/map-gallery.webp',
            width: 384,
            height: 216,
          },
          gallery2x: {
            url: 'https://private.example/map-gallery-2x.webp',
            width: 768,
            height: 432,
          },
          board: {
            url: 'https://private.example/old-board.webp',
            width: 2560,
            height: 1440,
          },
        },
      },
    }, {
      compatibilityMode: 'derivative-read',
      variant: 'board',
    });

    expect(result.candidates.map(({ variant }) => variant)).toEqual([
      'gallery',
      'gallery2x',
    ]);
    expect(result.srcSet).not.toContain('full-map.png');
    expect(result.srcSet).not.toContain('old-board.webp');
  });

  test('uses a verified map-video poster for thumbnail rendering', () => {
    const result = resolveMediaAsset({
      media: {
        schemaVersion: 1,
        state: 'ready',
        kind: 'map-video',
        original: { url: 'https://private.example/map.mp4' },
        variants: {
          poster: {
            url: 'https://private.example/map-poster.webp',
            width: 320,
            height: 180,
          },
        },
      },
    }, {
      compatibilityMode: 'derivative-read',
      variant: 'thumbnail',
    });
    expect(result).toEqual(expect.objectContaining({
      selectedVariant: 'poster',
      url: 'https://private.example/map-poster.webp',
    }));
  });

  test('rejects executable and protocol-relative persisted media URLs', () => {
    expect(hasMediaAsset({ imageUrl: 'javascript:alert(1)' })).toBe(false);
    expect(hasMediaAsset({ imageUrl: '//untrusted.example/image.png' })).toBe(false);
  });

  test('selects a path-only authoritative descriptor without treating its path as a URL', () => {
    const thumbnail = privateDescriptor('thumbnail');
    const result = resolveMediaAsset({
      media: {
        schemaVersion: 1,
        state: 'ready',
        kind: 'avatar',
        original: privateDescriptor('original'),
        variants: { thumbnail },
      },
    }, {
      compatibilityMode: 'derivative-read',
      variant: 'thumbnail',
    });

    expect(result).toEqual(expect.objectContaining({
      url: '',
      path: thumbnail.path,
      generation: thumbnail.generation,
      selectedVariant: 'thumbnail',
      width: 64,
      height: 64,
    }));
    expect(result.candidates[0]).toEqual(expect.objectContaining({
      privateAsset: expect.objectContaining({
        path: thumbnail.path,
        generation: thumbnail.generation,
      }),
    }));
    expect(hasMediaAsset({
      media: {
        schemaVersion: 1,
        state: 'ready',
        kind: 'avatar',
        variants: {thumbnail},
      },
    })).toBe(true);
    expect(resolveMediaAsset({
      General: {
        media: {
          schemaVersion: 1,
          state: 'ready',
          kind: 'avatar',
          variants: {thumbnail},
        },
      },
    }, {
      compatibilityMode: 'derivative-read',
      variant: 'thumbnail',
    })).toEqual(expect.objectContaining({
      path: thumbnail.path,
      generation: thumbnail.generation,
    }));
  });

  test('performs zero private imports or fetches while path-only media is offscreen', async () => {
    const storage = { name: 'authenticated-storage' };
    const ref = jest.fn((_storage, path) => ({ path }));
    const getBlob = jest.fn(async () => new Blob(['data'], { type: 'image/webp' }));
    const loadStorageApi = jest.fn(async () => ({ storage, ref, getBlob }));
    const createObjectURL = jest.fn(() => 'blob:authenticated-thumbnail');
    __configurePrivateMediaAssetsForTests({
      loadStorageApi,
      createObjectURL,
      revokeObjectURL: jest.fn(),
    });
    const view = render(
      <MediaImage
        compatibilityMode="derivative-read"
        media={{
          media: {
            schemaVersion: 1,
            state: 'ready',
            kind: 'avatar',
            variants: {thumbnail: privateDescriptor('thumbnail')},
          },
        }}
        variant="thumbnail"
        alt="Private thumbnail"
      />
    );
    const image = screen.getByAltText('Private thumbnail');

    expect(image).not.toHaveAttribute('src');
    expect(loadStorageApi).not.toHaveBeenCalled();
    expect(ref).not.toHaveBeenCalled();
    expect(getBlob).not.toHaveBeenCalled();

    act(() => {
      observerCallback([{ isIntersecting: true, intersectionRatio: 1 }]);
    });

    await waitFor(() => {
      expect(image).toHaveAttribute('src', 'blob:authenticated-thumbnail');
    });
    expect(loadStorageApi).toHaveBeenCalledTimes(1);
    expect(ref).toHaveBeenCalledWith(
      storage,
      privateDescriptor('thumbnail').path
    );
    expect(getBlob).toHaveBeenCalledWith(
      { path: privateDescriptor('thumbnail').path },
      4
    );
    expect(image).not.toHaveAttribute('srcset');
    view.unmount();
  });

  test('fetches exactly one private 1x/2x candidate selected from rendered size and DPR', async () => {
    Object.defineProperty(window, 'devicePixelRatio', {
      configurable: true,
      value: 2,
    });
    const storage = { name: 'authenticated-storage' };
    const ref = jest.fn((_storage, path) => ({ path }));
    const getBlob = jest.fn(async () => new Blob(['data'], { type: 'image/webp' }));
    __configurePrivateMediaAssetsForTests({
      loadStorageApi: jest.fn(async () => ({ storage, ref, getBlob })),
      createObjectURL: jest.fn(() => 'blob:authenticated-thumbnail-2x'),
      revokeObjectURL: jest.fn(),
    });

    render(
      <MediaImage
        compatibilityMode="derivative-read"
        media={{
          media: {
            schemaVersion: 1,
            state: 'ready',
            kind: 'avatar',
            variants: {
              thumbnail: privateDescriptor('thumbnail'),
              thumbnail2x: privateDescriptor('thumbnail2x'),
            },
          },
        }}
        variant="thumbnail"
        loading="eager"
        width={56}
        height={56}
        alt="Density selected avatar"
      />
    );

    await waitFor(() => {
      expect(screen.getByAltText('Density selected avatar'))
        .toHaveAttribute('src', 'blob:authenticated-thumbnail-2x');
    });
    expect(getBlob).toHaveBeenCalledTimes(1);
    expect(ref).toHaveBeenCalledWith(storage, privateDescriptor('thumbnail2x').path);
  });

  test('falls through a rejected private descriptor to the next approved density variant', async () => {
    const storage = { name: 'authenticated-storage' };
    const ref = jest.fn((_storage, path) => ({ path }));
    const getBlob = jest.fn(async ({ path }) => (
      path.endsWith('/thumbnail')
        ? new Blob(['bad'], { type: 'image/webp' })
        : new Blob(['good'], { type: 'image/webp' })
    ));
    const onError = jest.fn();
    __configurePrivateMediaAssetsForTests({
      loadStorageApi: jest.fn(async () => ({ storage, ref, getBlob })),
      createObjectURL: jest.fn(() => 'blob:validated-card'),
      revokeObjectURL: jest.fn(),
    });

    render(
      <MediaImage
        compatibilityMode="derivative-read"
        media={{
          media: {
            schemaVersion: 1,
            state: 'ready',
            kind: 'avatar',
            variants: {
              thumbnail: privateDescriptor('thumbnail', 4),
              thumbnail2x: privateDescriptor('thumbnail2x', 4),
            },
          },
        }}
        variant="thumbnail"
        loading="eager"
        alt="Validated fallback"
        onError={onError}
      />
    );

    const image = screen.getByAltText('Validated fallback');
    await waitFor(() => {
      expect(image).toHaveAttribute('src', 'blob:validated-card');
    });
    expect(getBlob).toHaveBeenCalledTimes(2);
    expect(image).toHaveAttribute('data-media-variant', 'thumbnail2x');
    expect(onError).not.toHaveBeenCalled();
  });

  test('attaches lazy media only inside the observer margin and detaches it outside', () => {
    const view = render(
      <MediaImage
        compatibilityMode="derivative-read"
        media={{
          ...mediaEntity,
          media: {
            ...mediaEntity.media,
            placeholder: { url: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' },
          },
        }}
        variant="card"
        alt="Card portrait"
        sizes="(max-width: 640px) 100vw, 320px"
      />
    );

    const image = screen.getByAltText('Card portrait');
    expect(image).not.toHaveAttribute('src');
    expect(image).not.toHaveAttribute('srcset');
    expect(image).toHaveAttribute('loading', 'lazy');
    expect(image).toHaveAttribute('decoding', 'async');
    expect(image).toHaveAttribute('width', '640');
    expect(image).toHaveAttribute('height', '360');
    expect(image).toHaveAttribute('data-media-state', 'deferred');
    expect(observe).toHaveBeenCalledWith(image);

    act(() => {
      observerCallback([{ isIntersecting: true, intersectionRatio: 1 }]);
    });

    expect(image).toHaveAttribute('src', 'https://private.example/card.webp');
    expect(image.getAttribute('srcset')).toContain('thumbnail.webp 160w');
    expect(image.getAttribute('srcset')).toContain('card.webp 640w');
    expect(disconnect).not.toHaveBeenCalled();

    act(() => {
      observerCallback([{ isIntersecting: false, intersectionRatio: 0 }]);
    });

    expect(image).not.toHaveAttribute('src');
    expect(image).not.toHaveAttribute('srcset');
    expect(image).toHaveAttribute('data-media-state', 'deferred');

    act(() => {
      observerCallback([{ isIntersecting: true, intersectionRatio: 1 }]);
    });

    expect(image).toHaveAttribute('src', 'https://private.example/card.webp');
    view.unmount();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  test('falls through broken priority URLs before rendering a supplied error fallback', async () => {
    render(
      <MediaImage
        compatibilityMode="derivative-read"
        media={mediaEntity}
        variant="board"
        loading="eager"
        fetchPriority="high"
        alt="Board"
        fallback={<span>Unable to load board</span>}
      />
    );
    const image = screen.getByAltText('Board');
    expect(image).toHaveAttribute('src', 'https://private.example/board.webp');
    expect(image).toHaveAttribute('fetchpriority', 'high');
    fireEvent.error(image);
    await waitFor(() => {
      expect(image).toHaveAttribute('src', 'https://private.example/original.jpg');
    });
    expect(screen.queryByText('Unable to load board')).not.toBeInTheDocument();
    fireEvent.error(image);
    await waitFor(() => {
      expect(image).toHaveAttribute('src', 'https://private.example/original-legacy.jpg');
    });
    expect(screen.queryByText('Unable to load board')).not.toBeInTheDocument();
    fireEvent.error(image);
    expect(screen.getByText('Unable to load board')).toBeInTheDocument();
  });
});
