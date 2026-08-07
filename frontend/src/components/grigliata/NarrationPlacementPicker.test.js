import React from 'react';
import { render, waitFor } from '@testing-library/react';
import NarrationPlacementPicker from './NarrationPlacementPicker';

jest.mock('../../data/media/useTask07MediaReadMode', () => ({
  __esModule: true,
  default: () => 'derivative-read',
}));

describe('NarrationPlacementPicker media thumbnails', () => {
  test('uses descriptor thumbnails and video posters while retaining safe legacy image fallback', async () => {
    const descriptorThumbnailUrl = 'https://example.com/descriptor-thumbnail.webp';
    const legacyImageUrl = 'https://example.com/legacy-map.png';
    const videoPosterUrl = 'https://example.com/video-poster.webp';
    const videoOriginalUrl = 'https://example.com/video-original.mp4';
    const backgrounds = [
      {
        id: 'descriptor-map',
        name: 'Descriptor Map',
        media: {
          kind: 'map',
          schemaVersion: 1,
          state: 'ready',
          variants: {
            gallery: {
              url: descriptorThumbnailUrl,
              width: 320,
              height: 180,
            },
          },
        },
      },
      {
        id: 'legacy-map',
        name: 'Legacy Map',
        imageUrl: legacyImageUrl,
      },
    ];
    const placements = [
      {
        id: 'placement-descriptor',
        backgroundId: 'descriptor-map',
        x: 0,
        y: 0,
        width: 1280,
        height: 720,
      },
      {
        id: 'placement-legacy',
        backgroundId: 'legacy-map',
        x: 1280,
        y: 0,
        width: 1280,
        height: 720,
      },
    ];
    const { container } = render(
      <NarrationPlacementPicker
        isOpen
        background={{
          id: 'video-map',
          name: 'Video Map',
          assetType: 'video',
          imageUrl: videoOriginalUrl,
          media: {
            kind: 'map-video',
            schemaVersion: 1,
            state: 'ready',
            original: {
              url: videoOriginalUrl,
              contentType: 'video/mp4',
            },
            variants: {
              poster: {
                url: videoPosterUrl,
                width: 320,
                height: 180,
              },
            },
          },
        }}
        backgrounds={backgrounds}
        placements={placements}
        onClose={jest.fn()}
        onSelectPlacement={jest.fn()}
      />
    );

    await waitFor(() => {
      const imageSources = Array.from(container.querySelectorAll('img'))
        .map((image) => image.getAttribute('src'));
      expect(imageSources).toEqual(expect.arrayContaining([
        descriptorThumbnailUrl,
        legacyImageUrl,
        videoPosterUrl,
      ]));
    });

    const imagesBySource = new Map(
      Array.from(container.querySelectorAll('img'))
        .map((image) => [image.getAttribute('src'), image])
    );
    expect(imagesBySource.get(descriptorThumbnailUrl)).toHaveAttribute('width', '168');
    expect(imagesBySource.get(descriptorThumbnailUrl)).toHaveAttribute('height', '168');
    expect(imagesBySource.get(legacyImageUrl)).toHaveAttribute('width', '168');
    expect(imagesBySource.get(legacyImageUrl)).toHaveAttribute('height', '168');
    expect(imagesBySource.get(videoPosterUrl)).toHaveAttribute('width', '40');
    expect(imagesBySource.get(videoPosterUrl)).toHaveAttribute('height', '40');
    expect(imagesBySource.has(videoOriginalUrl)).toBe(false);
    expect(container.querySelector('video')).toBeNull();
  });
});
