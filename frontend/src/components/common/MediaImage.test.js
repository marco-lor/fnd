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
const PRIVATE_IMAGE_GENERATIONS = Object.freeze({
  original: '1',
  thumbnail: '2',
  card: '3',
});
const privateDescriptor = (name, bytes = 4) => ({
  path: name === 'original'
    ? `media/v1/avatar/user/${PRIVATE_IMAGE_ASSET_ID}/original/source.webp`
    : `media/v1/avatar/user/${PRIVATE_IMAGE_ASSET_ID}/derivatives/v1/${name}.webp`,
  generation: PRIVATE_IMAGE_GENERATIONS[name],
  bytes,
  contentType: 'image/webp',
  width: name === 'thumbnail' ? 96 : 320,
  height: name === 'thumbnail' ? 96 : 320,
});

describe('MediaImage', () => {
  const previousIntersectionObserver = global.IntersectionObserver;
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
    __resetPrivateMediaAssetsForTests();
  });

  test('selects canonical derivatives with variant-specific safe fallbacks', () => {
    expect(resolveMediaAsset(mediaEntity, { variant: 'thumbnail' })).toEqual(
      expect.objectContaining({
        selectedVariant: 'thumbnail',
        url: 'https://private.example/thumbnail.webp',
        width: 160,
        height: 90,
      })
    );
    expect(resolveMediaAsset(mediaEntity, { variant: 'card' }).url)
      .toBe('https://private.example/card.webp');
    expect(resolveMediaAsset(mediaEntity, { variant: 'board' }).url)
      .toBe('https://private.example/board.webp');
    expect(resolveMediaAsset({
      media: {
        original: { url: 'https://private.example/fallback.png', width: 100, height: 50 },
        variants: {},
      },
    }, { variant: 'board' })).toEqual(expect.objectContaining({
      selectedVariant: 'original',
      url: 'https://private.example/fallback.png',
    }));
    expect(hasMediaAsset({ imageUrl: 'https://private.example/legacy.png' })).toBe(true);
  });

  test('uses a verified map-video poster for thumbnail rendering', () => {
    const result = resolveMediaAsset({
      media: {
        schemaVersion: 1,
        original: { url: 'https://private.example/map.mp4' },
        variants: {
          poster: {
            url: 'https://private.example/map-poster.webp',
            width: 320,
            height: 180,
          },
        },
      },
    }, { variant: 'thumbnail' });
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
        original: privateDescriptor('original'),
        variants: { thumbnail },
      },
    }, { variant: 'thumbnail' });

    expect(result).toEqual(expect.objectContaining({
      url: '',
      path: thumbnail.path,
      generation: thumbnail.generation,
      selectedVariant: 'thumbnail',
      width: 96,
      height: 96,
    }));
    expect(result.candidates[0]).toEqual(expect.objectContaining({
      privateAsset: expect.objectContaining({
        path: thumbnail.path,
        generation: thumbnail.generation,
      }),
    }));
    expect(hasMediaAsset({ media: { variants: { thumbnail } } })).toBe(true);
    expect(resolveMediaAsset({
      General: {
        media: { variants: { thumbnail } },
      },
    }, { variant: 'thumbnail' })).toEqual(expect.objectContaining({
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
        media={{ media: { variants: { thumbnail: privateDescriptor('thumbnail') } } }}
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

  test('falls through a rejected private descriptor to the next declared variant', async () => {
    const storage = { name: 'authenticated-storage' };
    const ref = jest.fn((_storage, path) => ({ path }));
    const getBlob = jest.fn(async ({ path }) => (
      path.endsWith('/thumbnail.webp')
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
        media={{
          media: {
            variants: {
              thumbnail: privateDescriptor('thumbnail', 4),
              card: privateDescriptor('card', 4),
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
    expect(image).toHaveAttribute('data-media-variant', 'card');
    expect(onError).not.toHaveBeenCalled();
  });

  test('attaches lazy media only inside the observer margin and detaches it outside', () => {
    const view = render(
      <MediaImage
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
