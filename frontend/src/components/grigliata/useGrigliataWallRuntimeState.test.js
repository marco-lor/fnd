import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import useGrigliataWallRuntimeState from './useGrigliataWallRuntimeState';

const mockBuildDocTarget = (...segments) => ({
  kind: 'doc',
  path: segments.join('/'),
  id: segments[segments.length - 1],
});

let mockDocData = {};

jest.mock('../firebaseConfig', () => ({
  db: {},
}));

jest.mock('firebase/firestore', () => ({
  doc: jest.fn((db, ...segments) => mockBuildDocTarget(...segments)),
  onSnapshot: jest.fn((target, onNext) => {
    onNext({
      id: target.id,
      exists: () => !!mockDocData[target.path],
      data: () => mockDocData[target.path] || {},
    });

    return jest.fn();
  }),
}));

const HookProbe = ({ backgroundId = '', currentUserId = '' }) => {
  const { wallRuntimeState, isWallRuntimeStateReady } = useGrigliataWallRuntimeState({
    backgroundId,
    currentUserId,
  });

  return (
    <div>
      <div data-testid="ready">{String(isWallRuntimeStateReady)}</div>
      <div data-testid="background-id">{wallRuntimeState?.backgroundId || ''}</div>
      <div data-testid="open-state">{String(wallRuntimeState?.segments?.['wall-2']?.isOpen || false)}</div>
      <div data-testid="segment-count">{String(Object.keys(wallRuntimeState?.segments || {}).length)}</div>
    </div>
  );
};

describe('useGrigliataWallRuntimeState', () => {
  let firestore;

  beforeEach(() => {
    mockDocData = {};
    firestore = require('firebase/firestore');
    firestore.doc.mockClear().mockImplementation((db, ...segments) => mockBuildDocTarget(...segments));
    firestore.onSnapshot.mockClear().mockImplementation((target, onNext) => {
      onNext({
        id: target.id,
        exists: () => !!mockDocData[target.path],
        data: () => mockDocData[target.path] || {},
      });

      return jest.fn();
    });
  });

  test('does not subscribe without a signed-in user and active background', () => {
    render(<HookProbe backgroundId="map-1" currentUserId="" />);

    expect(firestore.onSnapshot).not.toHaveBeenCalled();
    expect(screen.getByTestId('ready')).toHaveTextContent('false');
  });

  test('subscribes to sanitized runtime wall state for signed-in viewers', async () => {
    mockDocData['grigliata_wall_state/map-1'] = {
      backgroundId: 'map-1',
      segments: {
        'wall-2': {
          isOpen: true,
          updatedBy: 'dm-1',
        },
      },
      updatedBy: 'dm-1',
    };

    render(<HookProbe backgroundId="map-1" currentUserId="player-1" />);

    await waitFor(() => {
      expect(screen.getByTestId('ready')).toHaveTextContent('true');
    });
    expect(firestore.onSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'grigliata_wall_state/map-1' }),
      expect.any(Function),
      expect.any(Function)
    );
    expect(screen.getByTestId('background-id')).toHaveTextContent('map-1');
    expect(screen.getByTestId('open-state')).toHaveTextContent('true');
    expect(screen.getByTestId('segment-count')).toHaveTextContent('1');
  });

  test('normalizes malformed snapshots to null while becoming ready', async () => {
    mockDocData['grigliata_wall_state/map-1'] = {
      backgroundId: 'map-1',
      segments: {
        'wall-2': { isOpen: 'yes' },
      },
    };

    render(<HookProbe backgroundId="map-1" currentUserId="player-1" />);

    await waitFor(() => {
      expect(screen.getByTestId('ready')).toHaveTextContent('true');
    });
    expect(screen.getByTestId('background-id')).toHaveTextContent('');
    expect(screen.getByTestId('segment-count')).toHaveTextContent('0');
  });

  test('ignores a stale wall-state callback after switching maps', async () => {
    const listeners = [];
    firestore.onSnapshot.mockImplementation((target, onNext, onError) => {
      const listener = { target, onNext, onError };
      listeners.push(listener);
      return jest.fn();
    });
    const buildSnapshot = (backgroundId, isOpen) => ({
      id: backgroundId,
      exists: () => true,
      data: () => ({
        backgroundId,
        segments: {
          'wall-2': {
            isOpen,
            updatedBy: 'dm-1',
          },
        },
        updatedBy: 'dm-1',
      }),
    });
    const findListener = (backgroundId) => listeners.find((listener) => (
      listener.target?.path === `grigliata_wall_state/${backgroundId}`
    ));

    const { rerender } = render(
      <HookProbe backgroundId={'map-1'} currentUserId={'player-1'} />
    );
    await waitFor(() => {
      expect(findListener('map-1')).toBeDefined();
    });
    const mapOneListener = findListener('map-1');
    act(() => {
      mapOneListener.onNext(buildSnapshot('map-1', true));
    });
    await waitFor(() => {
      expect(screen.getByTestId('ready')).toHaveTextContent('true');
      expect(screen.getByTestId('background-id')).toHaveTextContent('map-1');
      expect(screen.getByTestId('open-state')).toHaveTextContent('true');
    });

    rerender(<HookProbe backgroundId={'map-2'} currentUserId={'player-1'} />);
    await waitFor(() => {
      expect(findListener('map-2')).toBeDefined();
    });
    act(() => {
      findListener('map-2').onNext(buildSnapshot('map-2', false));
    });
    await waitFor(() => {
      expect(screen.getByTestId('ready')).toHaveTextContent('true');
      expect(screen.getByTestId('background-id')).toHaveTextContent('map-2');
      expect(screen.getByTestId('open-state')).toHaveTextContent('false');
    });

    act(() => {
      mapOneListener.onNext(buildSnapshot('map-1', true));
    });
    expect(screen.getByTestId('ready')).toHaveTextContent('true');
    expect(screen.getByTestId('background-id')).toHaveTextContent('map-2');
    expect(screen.getByTestId('open-state')).toHaveTextContent('false');
  });
});
