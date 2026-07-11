import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import useImageAsset, { useImageAssetSnapshot } from '../common/imageAssets/useImageAsset';
import { __resetImageAssetRegistry, ensureImageAsset } from '../common/imageAssets/imageAssetRegistry';

function ImageAssetSnapshotProbe({ src }) {
  const snapshot = useImageAssetSnapshot(src);
  const image = useImageAsset(src);

  return (
    <div>
      <div data-testid="snapshot-status">{snapshot.status}</div>
      <div data-testid="snapshot-image-present">{String(!!snapshot.image)}</div>
      <div data-testid="snapshot-image-src">{snapshot.image?.src || ''}</div>
      <div data-testid="image-present">{String(!!image)}</div>
      <div data-testid="snapshot-error-present">{String(!!snapshot.error)}</div>
    </div>
  );
}

describe('useImageAsset', () => {
  const originalImage = global.Image;
  let imageConstructorCallCount = 0;

  beforeEach(() => {
    imageConstructorCallCount = 0;

    class MockImage {
      constructor() {
        imageConstructorCallCount += 1;
        this.complete = false;
        this.naturalWidth = 0;
        this.naturalHeight = 0;
      }

      set src(value) {
        this._src = value;

        Promise.resolve().then(() => {
          if (value.includes('broken')) {
            this.onerror?.(new Error('broken image'));
            return;
          }

          this.complete = true;
          this.naturalWidth = 320;
          this.naturalHeight = 180;
          this.onload?.();
        });
      }

      get src() {
        return this._src;
      }
    }

    global.Image = MockImage;
    __resetImageAssetRegistry();
  });

  afterEach(() => {
    __resetImageAssetRegistry();
    global.Image = originalImage;
  });

  test('exposes loading and loaded snapshots while keeping the default hook image API intact', async () => {
    render(<ImageAssetSnapshotProbe src="https://example.com/map.png" />);

    expect(screen.getByTestId('snapshot-status')).toHaveTextContent('loading');
    expect(screen.getByTestId('snapshot-image-present')).toHaveTextContent('false');
    expect(screen.getByTestId('image-present')).toHaveTextContent('false');

    await waitFor(() => {
      expect(screen.getByTestId('snapshot-status')).toHaveTextContent('loaded');
    });

    expect(screen.getByTestId('snapshot-image-present')).toHaveTextContent('true');
    expect(screen.getByTestId('image-present')).toHaveTextContent('true');
    expect(screen.getByTestId('snapshot-error-present')).toHaveTextContent('false');
    expect(imageConstructorCallCount).toBe(1);
  });

  test('returns the idle empty snapshot for a blank src without starting subscriptions or loads', async () => {
    const { rerender, unmount } = render(<ImageAssetSnapshotProbe src="" />);

    expect(screen.getByTestId('snapshot-status')).toHaveTextContent('idle');
    expect(screen.getByTestId('snapshot-image-present')).toHaveTextContent('false');
    expect(screen.getByTestId('image-present')).toHaveTextContent('false');
    expect(screen.getByTestId('snapshot-error-present')).toHaveTextContent('false');
    expect(imageConstructorCallCount).toBe(0);

    rerender(<ImageAssetSnapshotProbe src="   " />);

    expect(screen.getByTestId('snapshot-status')).toHaveTextContent('idle');
    expect(imageConstructorCallCount).toBe(0);

    await act(async () => {
      unmount();
    });

    expect(imageConstructorCallCount).toBe(0);
  });

  test('reuses a loaded image synchronously after unmount and remount', async () => {
    const src = 'https://example.com/cached-map.png';
    const firstView = render(<ImageAssetSnapshotProbe src={src} />);

    await waitFor(() => {
      expect(screen.getByTestId('snapshot-status')).toHaveTextContent('loaded');
    });

    firstView.unmount();
    render(<ImageAssetSnapshotProbe src={src} />);

    expect(screen.getByTestId('snapshot-status')).toHaveTextContent('loaded');
    expect(screen.getByTestId('snapshot-image-src')).toHaveTextContent(src);
    expect(imageConstructorCallCount).toBe(1);
  });

  test('switches directly to the current cached source without exposing the previous image', async () => {
    const firstSrc = 'https://example.com/map-a.png';
    const secondSrc = 'https://example.com/map-b.png';
    await Promise.all([ensureImageAsset(firstSrc), ensureImageAsset(secondSrc)]);

    const { rerender } = render(<ImageAssetSnapshotProbe src={firstSrc} />);
    expect(screen.getByTestId('snapshot-image-src')).toHaveTextContent(firstSrc);

    rerender(<ImageAssetSnapshotProbe src={secondSrc} />);

    expect(screen.getByTestId('snapshot-status')).toHaveTextContent('loaded');
    expect(screen.getByTestId('snapshot-image-src')).toHaveTextContent(secondSrc);
  });
});
