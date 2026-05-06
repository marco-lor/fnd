import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import useGrigliataFogOfWar from './useGrigliataFogOfWar';

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

const HookProbe = ({ backgroundId = '', currentUserId = '', isManager = false }) => {
  const { fogOfWar, isFogOfWarReady } = useGrigliataFogOfWar({
    backgroundId,
    currentUserId,
    isManager,
  });

  return (
    <div>
      <div data-testid="ready">{String(isFogOfWarReady)}</div>
      <div data-testid="doc-id">{fogOfWar?.id || ''}</div>
      <div data-testid="owner">{fogOfWar?.ownerUid || ''}</div>
      <div data-testid="cell-count">{String(fogOfWar?.exploredCells?.length || 0)}</div>
    </div>
  );
};

describe('useGrigliataFogOfWar', () => {
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

  test('does not subscribe without a signed-in player and active background', () => {
    render(<HookProbe backgroundId="map-1" currentUserId="" />);

    expect(firestore.onSnapshot).not.toHaveBeenCalled();
    expect(screen.getByTestId('ready')).toHaveTextContent('false');
  });

  test('does not subscribe for normal DM view', () => {
    render(<HookProbe backgroundId="map-1" currentUserId="dm-1" isManager />);

    expect(firestore.onSnapshot).not.toHaveBeenCalled();
    expect(screen.getByTestId('ready')).toHaveTextContent('false');
  });

  test('subscribes only to the current player fog doc', async () => {
    mockDocData['grigliata_fog_of_war/map-1__user-1'] = {
      backgroundId: 'map-1',
      ownerUid: 'user-1',
      cellSizePx: 70,
      exploredCells: ['1:0', '0:0'],
      updatedBy: 'user-1',
    };
    mockDocData['grigliata_fog_of_war/map-1__user-2'] = {
      backgroundId: 'map-1',
      ownerUid: 'user-2',
      cellSizePx: 70,
      exploredCells: ['9:9'],
      updatedBy: 'user-2',
    };

    render(<HookProbe backgroundId="map-1" currentUserId="user-1" />);

    await waitFor(() => {
      expect(screen.getByTestId('ready')).toHaveTextContent('true');
    });
    expect(firestore.onSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'grigliata_fog_of_war/map-1__user-1' }),
      expect.any(Function),
      expect.any(Function)
    );
    expect(firestore.onSnapshot).not.toHaveBeenCalledWith(
      expect.objectContaining({ path: 'grigliata_fog_of_war/map-1__user-2' }),
      expect.any(Function),
      expect.any(Function)
    );
    expect(screen.getByTestId('doc-id')).toHaveTextContent('map-1__user-1');
    expect(screen.getByTestId('owner')).toHaveTextContent('user-1');
    expect(screen.getByTestId('cell-count')).toHaveTextContent('2');
  });

  test('normalizes malformed snapshots to null while becoming ready', async () => {
    mockDocData['grigliata_fog_of_war/map-1__user-1'] = {
      backgroundId: 'map-1',
      ownerUid: 'user-1',
      cellSizePx: 70,
      exploredCells: ['not-a-cell'],
      updatedBy: 'user-1',
    };

    render(<HookProbe backgroundId="map-1" currentUserId="user-1" />);

    await waitFor(() => {
      expect(screen.getByTestId('ready')).toHaveTextContent('true');
    });
    expect(screen.getByTestId('doc-id')).toHaveTextContent('');
    expect(screen.getByTestId('cell-count')).toHaveTextContent('0');
  });
});
