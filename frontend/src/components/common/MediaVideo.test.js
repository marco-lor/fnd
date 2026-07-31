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
  path: `media_assets/v1/signed-in/user/${canonicalAssetId(id)}/${canonicalGeneration(id)}/original`,
  generation: canonicalGeneration(id),
  bytes: 4,
  contentType: 'video/mp4',
  width: 1920,
  height: 1080,
});

const versionedVideo = (original) => ({
  schemaVersion: 1,
  state: 'ready',
  kind: 'map-video',
  original,
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

  test('resolves only canonical server video originals with a safe legacy URL fallback', () => {
    const original = descriptor('resolved');
    const result = resolveMediaVideoAsset({
      imageUrl: 'https://legacy.example/map.mp4',
      media: versionedVideo(original),
    }, {compatibilityMode: 'derivative-read'});

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
      media: versionedVideo({
          ...original,
          contentType: 'image/svg+xml',
      }),
    }, {compatibilityMode: 'derivative-read'}).candidates).toHaveLength(0);
    expect(resolveMediaVideoAsset({
      General: {
        media: versionedVideo(original),
      },
    }, {compatibilityMode: 'derivative-read'}).path).toBe(original.path);
    expect(resolveMediaVideoAsset({
      media: versionedVideo({
          ...original,
          path: `media/v1/map-video/user/${canonicalAssetId('resolved')}/original/source.mp4`,
      }),
    }, {compatibilityMode: 'derivative-read'}).candidates).toHaveLength(0);
    expect(resolveMediaVideoAsset({
      media: versionedVideo({
          ...original,
          contentType: 'video/webm',
      }),
    }, {compatibilityMode: 'derivative-read'}).contentType).toBe('video/webm');
    expect(resolveMediaVideoAsset({
      imageUrl: 'data:video/webm;base64,AAAA',
    }).url).toBe('data:video/webm;base64,AAAA');
    expect(resolveMediaVideoAsset({
      video_url: 'https://legacy.example/preserved.mp4',
      media: versionedVideo(original),
    }, {compatibilityMode: 'shadow'}).url)
      .toBe('https://legacy.example/preserved.mp4');
    expect(resolveMediaVideoAsset({
      media: versionedVideo(original),
    }, {compatibilityMode: 'legacy'})).toEqual(expect.objectContaining({
      path: original.path,
      selectedVariant: 'original',
    }));
  });

  test('loads an authenticated MP4 lease and releases it on replacement and unmount', async () => {
    const runtime = configureRuntime();
    const first = descriptor('first');
    const second = descriptor('second');
    const view = render(
      <MediaVideo
        compatibilityMode="derivative-read"
        media={{media: versionedVideo(first)}}
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
        compatibilityMode="derivative-read"
        media={{media: versionedVideo(second)}}
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
        compatibilityMode="derivative-read"
        media={{
          imageUrl: 'https://legacy.example/fallback.mp4',
          media: versionedVideo(original),
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
        compatibilityMode="derivative-read"
        media={{
          imageUrl: 'https://legacy.example/fallback.mp4',
          media: versionedVideo({url: 'https://canonical.example/original.mp4'}),
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
