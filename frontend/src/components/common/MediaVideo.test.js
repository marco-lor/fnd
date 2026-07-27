import React from 'react';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import MediaVideo, { resolveMediaVideoAsset } from './MediaVideo';
import {
  __configurePrivateMediaAssetsForTests,
  __resetPrivateMediaAssetsForTests,
  getPrivateMediaAssetCacheSnapshot,
} from './privateMediaAssets';

const canonicalAssetId = (id) => {
  const hex = Array.from(String(id))
    .map((character) => character.charCodeAt(0).toString(16))
    .join('')
    .padEnd(40, '0')
    .slice(0, 40);
  return `m_${hex}`;
};
const canonicalGeneration = (id) => String(
  Array.from(String(id)).reduce((total, character) => total + character.charCodeAt(0), 1)
);

const descriptor = (id) => ({
  path: `media/v1/map-video/user/${canonicalAssetId(id)}/original/source.mp4`,
  generation: canonicalGeneration(id),
  bytes: 4,
  contentType: 'video/mp4',
  width: 1920,
  height: 1080,
});

const configureRuntime = ({ getBlob } = {}) => {
  const storage = { name: 'authenticated-storage' };
  const ref = jest.fn((_storage, path) => ({ path }));
  const fetchBlob = jest.fn(getBlob || (async () => (
    new Blob(['data'], { type: 'video/mp4' })
  )));
  const loadStorageApi = jest.fn(async () => ({
    storage,
    ref,
    getBlob: fetchBlob,
  }));
  const createObjectURL = jest.fn((blob) => (
    `blob:private-video-${blob.size}-${createObjectURL.mock.calls.length}`
  ));
  const revokeObjectURL = jest.fn();
  __configurePrivateMediaAssetsForTests({
    loadStorageApi,
    createObjectURL,
    revokeObjectURL,
  });
  return {
    storage,
    ref,
    getBlob: fetchBlob,
    loadStorageApi,
    createObjectURL,
    revokeObjectURL,
  };
};

describe('MediaVideo', () => {
  afterEach(() => {
    __resetPrivateMediaAssetsForTests();
  });

  test('resolves only canonical MP4 original descriptors with a safe legacy URL fallback', () => {
    const original = descriptor('resolved');
    const result = resolveMediaVideoAsset({
      imageUrl: 'https://legacy.example/map.mp4',
      media: { original },
    });

    expect(result).toEqual(expect.objectContaining({
      path: original.path,
      generation: original.generation,
      contentType: 'video/mp4',
      url: '',
    }));
    expect(result.candidates).toEqual([
      expect.objectContaining({
        privateAsset: expect.objectContaining({ path: original.path }),
      }),
      expect.objectContaining({
        url: 'https://legacy.example/map.mp4',
        privateAsset: null,
      }),
    ]);
    expect(resolveMediaVideoAsset({
      imageUrl: 'javascript:alert(1)',
    }).candidates).toHaveLength(0);
    expect(resolveMediaVideoAsset({
      media: {
        original: {
          ...original,
          contentType: 'image/svg+xml',
        },
      },
    }).candidates).toHaveLength(0);
    expect(resolveMediaVideoAsset({
      General: {
        media: { original },
      },
    }).path).toBe(original.path);
    expect(resolveMediaVideoAsset({
      media: {
        original: {
          ...original,
          path: 'media/v1/map-video/user/resolved/original.mp4',
        },
      },
    }).candidates).toHaveLength(0);
  });

  test('loads an authenticated MP4 lease and releases it on replacement and unmount', async () => {
    const runtime = configureRuntime();
    const first = descriptor('first');
    const second = descriptor('second');
    const view = render(
      <MediaVideo
        media={{ media: { original: first } }}
        aria-label="Private map preview"
      />
    );
    const video = screen.getByLabelText('Private map preview');

    await waitFor(() => {
      expect(video).toHaveAttribute('src', 'blob:private-video-4-1');
    });
    expect(runtime.getBlob).toHaveBeenCalledWith({ path: first.path }, 4);
    expect(getPrivateMediaAssetCacheSnapshot().records).toEqual([
      expect.objectContaining({ path: first.path, refCount: 1 }),
    ]);

    view.rerender(
      <MediaVideo
        media={{ media: { original: second } }}
        aria-label="Private map preview"
      />
    );
    await waitFor(() => {
      expect(video).toHaveAttribute('src', 'blob:private-video-4-2');
    });
    expect(getPrivateMediaAssetCacheSnapshot().records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: first.path, refCount: 0 }),
        expect.objectContaining({ path: second.path, refCount: 1 }),
      ])
    );

    view.unmount();
    expect(getPrivateMediaAssetCacheSnapshot().records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: second.path, refCount: 0 }),
      ])
    );
  });

  test('falls back to a safe legacy URL when authenticated validation fails', async () => {
    const runtime = configureRuntime({
      getBlob: async () => new Blob(['data'], { type: 'image/webp' }),
    });
    const original = descriptor('invalid-private');
    render(
      <MediaVideo
        media={{
          imageUrl: 'https://legacy.example/fallback.mp4',
          media: { original },
        }}
        aria-label="Fallback map preview"
      />
    );

    const video = screen.getByLabelText('Fallback map preview');
    await waitFor(() => {
      expect(video).toHaveAttribute('src', 'https://legacy.example/fallback.mp4');
    });
    expect(runtime.getBlob).toHaveBeenCalledTimes(1);
  });

  test('advances URL candidates on DOM errors before reporting a final failure', async () => {
    const onError = jest.fn();
    render(
      <MediaVideo
        media={{
          imageUrl: 'https://legacy.example/fallback.mp4',
          media: {
            original: { url: 'https://canonical.example/original.mp4' },
          },
        }}
        aria-label="URL fallback preview"
        onError={onError}
      />
    );
    const video = screen.getByLabelText('URL fallback preview');
    expect(video).toHaveAttribute('src', 'https://canonical.example/original.mp4');

    fireEvent.error(video);
    await waitFor(() => {
      expect(video).toHaveAttribute('src', 'https://legacy.example/fallback.mp4');
    });
    expect(onError).not.toHaveBeenCalled();

    fireEvent.error(video);
    await waitFor(() => {
      expect(onError).toHaveBeenCalledTimes(1);
    });
    expect(video).not.toHaveAttribute('src');
  });
});
