import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import useGrigliataLightingMetadata from './useGrigliataLightingMetadata';

const mockBuildDocTarget = (...segments) => ({
  kind: 'doc',
  path: segments.join('/'),
  id: segments[segments.length - 1],
});

jest.mock('../firebaseConfig', () => ({
  db: {},
}));

jest.mock('firebase/firestore', () => ({
  doc: jest.fn((db, ...segments) => mockBuildDocTarget(...segments)),
  onSnapshot: jest.fn(() => jest.fn()),
}));

const HookProbe = ({ backgroundId = '', currentUserId = '', isManager = false }) => {
  const { lightingMetadata, isLightingMetadataReady } = useGrigliataLightingMetadata({
    backgroundId,
    currentUserId,
    isManager,
  });

  return (
    <div>
      <div data-testid={'ready'}>{String(isLightingMetadataReady)}</div>
      <div data-testid={'metadata-id'}>{lightingMetadata?.id || ''}</div>
      <div data-testid={'light-count'}>{String(lightingMetadata?.lights?.length || 0)}</div>
    </div>
  );
};

describe('useGrigliataLightingMetadata', () => {
  let firestore;

  beforeEach(() => {
    firestore = require('firebase/firestore');
    firestore.doc.mockClear().mockImplementation((db, ...segments) => mockBuildDocTarget(...segments));
    firestore.onSnapshot.mockClear().mockImplementation(() => jest.fn());
  });

  test('does not subscribe outside signed-in manager view', () => {
    render(<HookProbe backgroundId={'map-1'} currentUserId={'player-1'} />);

    expect(firestore.onSnapshot).not.toHaveBeenCalled();
    expect(screen.getByTestId('ready')).toHaveTextContent('false');
  });

  test('ignores a stale lighting-metadata callback after switching maps', async () => {
    const listeners = [];
    firestore.onSnapshot.mockImplementation((target, onNext, onError) => {
      const listener = { target, onNext, onError };
      listeners.push(listener);
      return jest.fn();
    });
    const buildSnapshot = (backgroundId, lightCount) => ({
      id: backgroundId,
      exists: () => true,
      data: () => ({
        backgroundId,
        lights: Array.from({ length: lightCount }, (_, index) => ({ id: `${backgroundId}-${index}` })),
      }),
    });
    const findListener = (backgroundId) => listeners.find((listener) => (
      listener.target?.path === `grigliata_background_lighting/${backgroundId}`
    ));

    const { rerender } = render(
      <HookProbe backgroundId={'map-1'} currentUserId={'dm-1'} isManager />
    );
    await waitFor(() => {
      expect(findListener('map-1')).toBeDefined();
    });
    const mapOneListener = findListener('map-1');
    act(() => {
      mapOneListener.onNext(buildSnapshot('map-1', 2));
    });
    await waitFor(() => {
      expect(screen.getByTestId('ready')).toHaveTextContent('true');
      expect(screen.getByTestId('metadata-id')).toHaveTextContent('map-1');
      expect(screen.getByTestId('light-count')).toHaveTextContent('2');
    });

    rerender(<HookProbe backgroundId={'map-2'} currentUserId={'dm-1'} isManager />);
    await waitFor(() => {
      expect(findListener('map-2')).toBeDefined();
    });
    act(() => {
      findListener('map-2').onNext(buildSnapshot('map-2', 1));
    });
    await waitFor(() => {
      expect(screen.getByTestId('ready')).toHaveTextContent('true');
      expect(screen.getByTestId('metadata-id')).toHaveTextContent('map-2');
      expect(screen.getByTestId('light-count')).toHaveTextContent('1');
    });

    act(() => {
      mapOneListener.onNext(buildSnapshot('map-1', 3));
    });
    expect(screen.getByTestId('ready')).toHaveTextContent('true');
    expect(screen.getByTestId('metadata-id')).toHaveTextContent('map-2');
    expect(screen.getByTestId('light-count')).toHaveTextContent('1');
  });
});
