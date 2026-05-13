import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import useGrigliataFogOfWar from './useGrigliataFogOfWar';
import {
  FOG_RASTER_MASK_ENCODING,
  FOG_RASTER_PROFILE_ID,
  encodeFogRasterMaskBase64,
  createEmptyFogRasterMaskBytes,
} from './fogRasterMemory';

const mockBuildDocTarget = (...segments) => ({
  kind: 'doc',
  path: segments.join('/'),
  id: segments[segments.length - 1],
});

let mockDocData = {};
let mockCollectionData = {};

jest.mock('../firebaseConfig', () => ({
  db: {},
}));

jest.mock('firebase/firestore', () => ({
  collection: jest.fn((db, path) => ({ kind: 'collection', path })),
  doc: jest.fn((db, ...segments) => mockBuildDocTarget(...segments)),
  query: jest.fn((base, ...constraints) => ({ kind: 'query', base, constraints })),
  where: jest.fn((field, op, value) => ({ kind: 'where', field, op, value })),
  onSnapshot: jest.fn((target, onNext) => {
    if (target?.kind === 'query') {
      const items = mockCollectionData[target.base.path] || [];
      const filteredItems = target.constraints.reduce((currentItems, constraint) => (
        constraint?.kind === 'where' && constraint.op === '=='
          ? currentItems.filter((item) => item?.[constraint.field] === constraint.value)
          : currentItems
      ), items);
      onNext({
        docs: filteredItems.map((item) => ({
          id: item.id,
          data: () => {
            const { id, ...rest } = item;
            return rest;
          },
        })),
      });
    } else {
      onNext({
        id: target.id,
        exists: () => !!mockDocData[target.path],
        data: () => mockDocData[target.path] || {},
      });
    }

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
      <div data-testid="memory-tile-count">{String(fogOfWar?.memoryTiles?.length || 0)}</div>
    </div>
  );
};

describe('useGrigliataFogOfWar', () => {
  let firestore;

  beforeEach(() => {
    mockDocData = {};
    mockCollectionData = {};
    firestore = require('firebase/firestore');
    firestore.collection.mockClear().mockImplementation((db, path) => ({ kind: 'collection', path }));
    firestore.doc.mockClear().mockImplementation((db, ...segments) => mockBuildDocTarget(...segments));
    firestore.query.mockClear().mockImplementation((base, ...constraints) => ({ kind: 'query', base, constraints }));
    firestore.where.mockClear().mockImplementation((field, op, value) => ({ kind: 'where', field, op, value }));
    firestore.onSnapshot.mockClear().mockImplementation((target, onNext) => {
      if (target?.kind === 'query') {
        const items = mockCollectionData[target.base.path] || [];
        const filteredItems = target.constraints.reduce((currentItems, constraint) => (
          constraint?.kind === 'where' && constraint.op === '=='
            ? currentItems.filter((item) => item?.[constraint.field] === constraint.value)
            : currentItems
        ), items);
        onNext({
          docs: filteredItems.map((item) => ({
            id: item.id,
            data: () => {
              const { id, ...rest } = item;
              return rest;
            },
          })),
        });
      } else {
        onNext({
          id: target.id,
          exists: () => !!mockDocData[target.path],
          data: () => mockDocData[target.path] || {},
        });
      }

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

  test('subscribes to current player raster memory tiles', async () => {
    const maskBytes = createEmptyFogRasterMaskBytes();
    maskBytes[0] = 1;
    mockCollectionData.grigliata_fog_memory_tiles = [{
      id: 'map-1__user-1__fog-raster-c8-s16-v1__0:0',
      backgroundId: 'map-1',
      ownerUid: 'user-1',
      tileKey: '0:0',
      tileCol: 0,
      tileRow: 0,
      rasterProfileId: FOG_RASTER_PROFILE_ID,
      tileSizeCells: 8,
      samplesPerCell: 16,
      cellSizePx: 70,
      offsetXPx: 0,
      offsetYPx: 0,
      maskEncoding: FOG_RASTER_MASK_ENCODING,
      maskBase64: encodeFogRasterMaskBase64(maskBytes),
      updatedBy: 'user-1',
    }, {
      id: 'map-1__user-2__fog-raster-c8-s16-v1__0:0',
      backgroundId: 'map-1',
      ownerUid: 'user-2',
      tileKey: '0:0',
      tileCol: 0,
      tileRow: 0,
      rasterProfileId: FOG_RASTER_PROFILE_ID,
      tileSizeCells: 8,
      samplesPerCell: 16,
      cellSizePx: 70,
      offsetXPx: 0,
      offsetYPx: 0,
      maskEncoding: FOG_RASTER_MASK_ENCODING,
      maskBase64: encodeFogRasterMaskBase64(maskBytes),
      updatedBy: 'user-2',
    }];

    render(<HookProbe backgroundId="map-1" currentUserId="user-1" />);

    await waitFor(() => {
      expect(screen.getByTestId('ready')).toHaveTextContent('true');
    });
    expect(firestore.collection).toHaveBeenCalledWith(expect.anything(), 'grigliata_fog_memory_tiles');
    expect(firestore.where).toHaveBeenCalledWith('backgroundId', '==', 'map-1');
    expect(firestore.where).toHaveBeenCalledWith('ownerUid', '==', 'user-1');
    expect(firestore.where).toHaveBeenCalledWith('rasterProfileId', '==', FOG_RASTER_PROFILE_ID);
    expect(screen.getByTestId('memory-tile-count')).toHaveTextContent('1');
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
