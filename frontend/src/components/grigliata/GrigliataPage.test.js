import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import GrigliataPage from './GrigliataPage';
import { useAuth } from '../../AuthContext';
import {
  GRIGLIATA_LIVE_INTERACTION_STALE_MS,
  GRIGLIATA_LIVE_INTERACTION_THROTTLE_MS,
} from './liveInteractions';
import { preloadImageAssets, scheduleImageAssetPreload } from './imageAssetRegistry';
import { readAudioFileMetadata } from './music';

const mockDeleteGrigliataCustomTokenCallable = jest.fn(() => Promise.resolve({ data: { success: true } }));
const mockSpawnGrigliataFoeTokenCallable = jest.fn(() => Promise.resolve({ data: { success: true, tokenId: 'foe-token-1' } }));

function mockInvokeDeleteGrigliataCustomTokenCallable(...args) {
  return mockDeleteGrigliataCustomTokenCallable(...args);
}

function mockInvokeSpawnGrigliataFoeTokenCallable(...args) {
  return mockSpawnGrigliataFoeTokenCallable(...args);
}

const mockFirestoreState = {
  collections: {},
  docs: {},
};

const mockFirestoreListeners = [];
const mockBatchInstances = [];

const mockBuildCollectionTarget = (path) => ({ kind: 'collection', path });
const mockBuildDocTarget = (...segments) => ({ kind: 'doc', path: segments.join('/'), id: segments[segments.length - 1] });
const mockBuildWhereConstraint = (field, op, value) => ({ kind: 'where', field, op, value });
const mockBuildQueryTarget = (base, constraints) => ({ kind: 'query', base, constraints });

const mockCreateDocSnapshot = (path, data) => ({
  id: path.split('/').slice(-1)[0],
  exists: () => !!data,
  data: () => (data || {}),
});

const mockCreateQuerySnapshot = (path, items) => ({
  empty: items.length === 0,
  size: items.length,
  docs: items.map((item) => ({
    id: item.id,
    data: () => {
      const { id, ...rest } = item;
      return rest;
    },
    ref: { path: `${path}/${item.id}` },
  })),
});

const mockApplyQueryConstraints = (items, constraints) => (
  (constraints || []).reduce((filteredItems, constraint) => {
    if (constraint?.kind !== 'where' || constraint.op !== '==') {
      return filteredItems;
    }

    return filteredItems.filter((item) => item?.[constraint.field] === constraint.value);
  }, items)
);

const mockBuildSnapshotForTarget = (target) => {
  if (target?.kind === 'doc') {
    return mockCreateDocSnapshot(target.path, mockFirestoreState.docs[target.path]);
  }

  if (target?.kind === 'query') {
    const basePath = target.base?.path || '';
    const items = mockFirestoreState.collections[basePath] || [];
    return mockCreateQuerySnapshot(basePath, mockApplyQueryConstraints(items, target.constraints));
  }

  if (target?.kind === 'collection') {
    const items = mockFirestoreState.collections[target.path] || [];
    return mockCreateQuerySnapshot(target.path, items);
  }

  return mockCreateQuerySnapshot('', []);
};

const mockNotifyFirestoreListeners = () => {
  mockFirestoreListeners.forEach((listener) => {
    listener.onNext(mockBuildSnapshotForTarget(listener.target));
  });
};

const setCollectionData = (path, items) => {
  mockFirestoreState.collections[path] = items;
  Object.keys(mockFirestoreState.docs)
    .filter((docPath) => docPath.startsWith(`${path}/`))
    .forEach((docPath) => {
      delete mockFirestoreState.docs[docPath];
    });
  (items || []).forEach((item) => {
    if (!item?.id) return;
    const { id, ...rest } = item;
    mockFirestoreState.docs[`${path}/${id}`] = rest;
  });
  mockNotifyFirestoreListeners();
};

const setDocData = (path, value) => {
  mockFirestoreState.docs[path] = value;
  mockNotifyFirestoreListeners();
};

jest.mock('../../AuthContext', () => ({
  useAuth: jest.fn(),
}));

jest.mock('../firebaseConfig', () => ({
  db: {},
  functions: {},
  storage: {},
}));

jest.mock('firebase/functions', () => ({
  httpsCallable: jest.fn((functions, functionName) => {
    if (functionName === 'deleteGrigliataCustomToken') {
      return mockInvokeDeleteGrigliataCustomTokenCallable;
    }

    if (functionName === 'spawnGrigliataFoeToken') {
      return mockInvokeSpawnGrigliataFoeTokenCallable;
    }

    return jest.fn();
  }),
}));

jest.mock('firebase/storage', () => ({
  deleteObject: jest.fn(() => Promise.resolve()),
  getDownloadURL: jest.fn(() => Promise.resolve('https://example.com/uploaded-map.png')),
  ref: jest.fn((storage, path) => ({ storage, path })),
  uploadBytes: jest.fn(() => Promise.resolve()),
}));

jest.mock('firebase/firestore', () => ({
  addDoc: jest.fn(() => Promise.resolve()),
  arrayRemove: jest.fn((value) => ({ __type: 'arrayRemove', value })),
  arrayUnion: jest.fn((value) => ({ __type: 'arrayUnion', value })),
  collection: jest.fn((db, path) => mockBuildCollectionTarget(path)),
  deleteDoc: jest.fn(() => Promise.resolve()),
  deleteField: jest.fn(() => ({ __type: 'deleteField' })),
  doc: jest.fn((db, ...segments) => mockBuildDocTarget(...segments)),
  documentId: jest.fn(() => '__name__'),
  getDoc: jest.fn((target) => Promise.resolve(mockBuildSnapshotForTarget(target))),
  getDocs: jest.fn((target) => Promise.resolve(mockBuildSnapshotForTarget(target))),
  limit: jest.fn((value) => ({ kind: 'limit', value })),
  onSnapshot: jest.fn((target, onNext) => {
    const listener = { target, onNext };
    mockFirestoreListeners.push(listener);
    onNext(mockBuildSnapshotForTarget(target));

    return () => {
      const listenerIndex = mockFirestoreListeners.indexOf(listener);
      if (listenerIndex >= 0) {
        mockFirestoreListeners.splice(listenerIndex, 1);
      }
    };
  }),
  orderBy: jest.fn((field) => ({ kind: 'orderBy', field })),
  query: jest.fn((base, ...constraints) => mockBuildQueryTarget(base, constraints)),
  serverTimestamp: jest.fn(() => ({ __type: 'serverTimestamp' })),
  setDoc: jest.fn(() => Promise.resolve()),
  startAfter: jest.fn((value) => ({ kind: 'startAfter', value })),
  updateDoc: jest.fn(() => Promise.resolve()),
  where: jest.fn((field, op, value) => mockBuildWhereConstraint(field, op, value)),
  writeBatch: jest.fn(() => {
    const batch = {
      delete: jest.fn(),
      set: jest.fn(),
      update: jest.fn(),
      commit: jest.fn(() => Promise.resolve()),
    };
    mockBatchInstances.push(batch);
    return batch;
  }),
}));

jest.mock('./BackgroundGalleryPanel', () => jest.fn(() => <div data-testid="background-gallery-panel" />));
jest.mock('./MapCalibrationPanel', () => jest.fn(() => <div data-testid="map-calibration-panel" />));
jest.mock('./imageAssetRegistry', () => ({
  preloadImageAssets: jest.fn(() => Promise.resolve([])),
  scheduleImageAssetPreload: jest.fn(() => jest.fn()),
}));
jest.mock('./music', () => {
  const actual = jest.requireActual('./music');

  return {
    ...actual,
    readAudioFileMetadata: jest.fn(() => Promise.resolve({ durationMs: 12_345 })),
  };
});
jest.mock('./GrigliataBoard', () => {
  const React = require('react');

    return function MockGrigliataBoard(props) {
    React.useEffect(() => (
      () => {
        props.onSharedInteractionChange?.(null);
      }
    ), [props.onSharedInteractionChange]);

    return (
      <div data-testid="grigliata-board">
        <div data-testid="board-sharing-state">{String(props.isInteractionSharingEnabled)}</div>
        <div data-testid="board-shared-count">{String(props.sharedInteractions?.length || 0)}</div>
        <div data-testid="board-aoe-count">{String(props.aoeFigures?.length || 0)}</div>
        <div data-testid="board-token-count">{String(props.tokens?.length || 0)}</div>
        <div data-testid="board-aoe-tool">{props.activeAoeFigureType || ''}</div>
        <div data-testid="board-draw-color">{props.drawTheme?.key || ''}</div>
        <button type="button" onClick={() => props.onSelectMouseTool?.()}>
          select mouse tool
        </button>
        <button type="button" onClick={() => props.onToggleInteractionSharing?.()}>
          toggle interaction sharing
        </button>
        <button
          type="button"
          disabled={props.isDeactivateActiveBackgroundDisabled}
          onClick={() => props.onDeactivateActiveBackground?.()}
        >
          deactivate active background
        </button>
        <button
          type="button"
          disabled={props.isMusicMutePending}
          onClick={() => props.onToggleMusicMuted?.()}
        >
          {props.isMusicMuted ? 'Unmute Music' : 'Mute Music'}
        </button>
        <button type="button" onClick={() => props.onChangeAoeFigureType?.('circle')}>
          activate circle tool
        </button>
        <button
          type="button"
          onClick={async () => {
            const didCreateFigure = await props.onCreateAoEFigure?.({
              figureType: 'circle',
              originCell: { col: 1, row: 1 },
              targetCell: { col: 3, row: 1 },
            });

            if (didCreateFigure) {
              props.onSelectMouseTool?.();
            }
          }}
        >
          create aoe circle
        </button>
        <button type="button" onClick={() => props.onMoveAoEFigure?.(
          'map-1__user-1__circle__1',
          {
            figureType: 'circle',
            originCell: { col: 2, row: 1 },
            targetCell: { col: 4, row: 1 },
          }
        )}>
          move aoe circle
        </button>
        <button type="button" onClick={() => props.onDeleteAoEFigures?.(['map-1__user-1__circle__1'])}>
          delete aoe circle
        </button>
        <button type="button" onClick={() => props.onChangeDrawColor?.('nova-teal')}>
          emit draw color nova teal
        </button>
        <button type="button" onClick={() => props.onChangeDrawColor?.('solar-amber')}>
          emit draw color solar amber
        </button>
        <button
          type="button"
          onClick={() => props.onSharedInteractionChange?.({
            type: 'measure',
            source: 'free',
            anchorCells: [{ col: 1, row: 1 }],
            liveEndCell: { col: 3, row: 1 },
          })}
        >
          emit interaction a
        </button>
        <button
          type="button"
          onClick={() => props.onSharedInteractionChange?.({
            type: 'measure',
            source: 'free',
            anchorCells: [{ col: 1, row: 1 }],
            liveEndCell: { col: 4, row: 1 },
          })}
        >
          emit interaction b
        </button>
        <button
          type="button"
          onClick={() => props.onSharedInteractionChange?.({
            type: 'aoe',
            source: 'aoe-create',
            figureType: 'circle',
            originCell: { col: 1, row: 1 },
            targetCell: { col: 3, row: 1 },
          })}
        >
          emit aoe interaction
        </button>
        <button
          type="button"
          onClick={() => props.onSharedInteractionChange?.({
            type: 'ping',
            source: 'free',
            point: { x: 320, y: 180 },
            startedAtMs: 1_713_100_000_250,
          })}
        >
          emit ping interaction
        </button>
        <button type="button" onClick={() => props.onSetSelectedTokensVisibility?.(['user-2'], false)}>
          hide selected token
        </button>
        <button
          type="button"
          onClick={() => props.onSetSelectedTokensVisibility?.(['user-2', 'user-3', 'user-4', 'user-5', 'user-6'], false)}
        >
          hide five selected tokens
        </button>
        <button type="button" onClick={() => props.onSetSelectedTokensDeadState?.(['user-2'], true)}>
          mark selected token dead
        </button>
        <button type="button" onClick={() => props.onUpdateTokenStatuses?.('user-1', ['burning', 'marked'])}>
          update selected token statuses
        </button>
        <button
          type="button"
          onClick={() => props.onDropCurrentToken?.({ tokenId: 'user-1', ownerUid: 'user-1' }, { x: 140, y: 140 })}
        >
          drop current token
        </button>
        <button
          type="button"
          onClick={() => props.onDropCurrentToken?.({ type: 'grigliata-foe-library-token', foeId: 'foe-1', ownerUid: 'user-1' }, { x: 140, y: 140 })}
        >
          drop foe library token
        </button>
        <button
          type="button"
          onClick={() => props.onMoveTokens?.([
            {
              tokenId: 'user-1',
              backgroundId: 'map-1',
              ownerUid: 'user-1',
              col: 4,
              row: 5,
            },
          ])}
        >
          move token placement
        </button>
        <button
          type="button"
          onClick={() => props.onDeleteTokens?.(['foe-token-1'])}
        >
          delete foe token placement
        </button>
        <button
          type="button"
          onClick={() => props.onDeleteTokens?.(['user-2', 'user-3', 'user-4', 'user-5', 'user-6'])}
        >
          delete five token placements
        </button>
        <button
          type="button"
          onClick={() => props.onSelectedTokenIdsChange?.(['foe-token-1'])}
        >
          select foe token
        </button>
        <button type="button" onClick={() => props.onSharedInteractionChange?.(null)}>
          clear interaction
        </button>
      </div>
    );
  };
});

describe('GrigliataPage', () => {
  let firestore;

  beforeEach(() => {
    jest.useFakeTimers();
    Object.defineProperty(window, 'scrollTo', {
      writable: true,
      value: jest.fn(),
    });
    window.localStorage.clear();
    mockFirestoreListeners.splice(0, mockFirestoreListeners.length);
    mockBatchInstances.splice(0, mockBatchInstances.length);
    mockFirestoreState.collections = {
      grigliata_backgrounds: [
        {
          id: 'map-1',
          name: 'Sunken Ruins',
          grid: { cellSizePx: 70, offsetXPx: 0, offsetYPx: 0 },
          isGridVisible: true,
        },
        {
          id: 'map-2',
          name: 'Iron Keep',
          grid: { cellSizePx: 70, offsetXPx: 0, offsetYPx: 0 },
          isGridVisible: true,
        },
      ],
      grigliata_tokens: [],
      grigliata_token_placements: [],
      grigliata_aoe_figures: [],
      grigliata_live_interactions: [],
      grigliata_music_tracks: [],
      foes: [],
    };
    mockFirestoreState.docs = {
      'grigliata_state/current': {
        activeBackgroundId: 'map-1',
      },
      'grigliata_music_playback/current': {
        status: 'stopped',
        trackId: '',
        trackName: '',
        audioUrl: '',
        durationMs: 0,
        offsetMs: 0,
        volume: 0.65,
        startedAt: null,
        commandId: '',
        updatedBy: '',
      },
    };

    useAuth.mockReturnValue({
      user: {
        uid: 'user-1',
        email: 'user-1@example.com',
      },
      userData: {
        role: 'player',
        settings: {
          grigliata_draw_color: 'ion-cyan',
          grigliata_share_interactions: false,
        },
        imageUrl: '',
        imagePath: '',
      },
      loading: false,
    });

    firestore = require('firebase/firestore');
    firestore.addDoc.mockClear().mockResolvedValue(undefined);
    firestore.arrayRemove.mockClear().mockImplementation((value) => ({ __type: 'arrayRemove', value }));
    firestore.arrayUnion.mockClear().mockImplementation((value) => ({ __type: 'arrayUnion', value }));
    firestore.collection.mockClear().mockImplementation((db, path) => mockBuildCollectionTarget(path));
    firestore.deleteDoc.mockClear().mockResolvedValue(undefined);
    firestore.deleteField.mockClear().mockImplementation(() => ({ __type: 'deleteField' }));
    firestore.doc.mockClear().mockImplementation((db, ...segments) => mockBuildDocTarget(...segments));
    firestore.documentId.mockClear().mockImplementation(() => '__name__');
    firestore.getDoc.mockClear().mockImplementation((target) => Promise.resolve(mockBuildSnapshotForTarget(target)));
    firestore.getDocs.mockClear().mockImplementation((target) => Promise.resolve(mockBuildSnapshotForTarget(target)));
    firestore.limit.mockClear().mockImplementation((value) => ({ kind: 'limit', value }));
    firestore.onSnapshot.mockClear().mockImplementation((target, onNext) => {
      const listener = { target, onNext };
      mockFirestoreListeners.push(listener);
      onNext(mockBuildSnapshotForTarget(target));

      return () => {
        const listenerIndex = mockFirestoreListeners.indexOf(listener);
        if (listenerIndex >= 0) {
          mockFirestoreListeners.splice(listenerIndex, 1);
        }
      };
    });
    firestore.orderBy.mockClear().mockImplementation((field) => ({ kind: 'orderBy', field }));
    firestore.query.mockClear().mockImplementation((base, ...constraints) => mockBuildQueryTarget(base, constraints));
    firestore.serverTimestamp.mockClear().mockImplementation(() => ({ __type: 'serverTimestamp' }));
    firestore.setDoc.mockClear().mockResolvedValue(undefined);
    firestore.startAfter.mockClear().mockImplementation((value) => ({ kind: 'startAfter', value }));
    firestore.updateDoc.mockClear().mockResolvedValue(undefined);
    firestore.where.mockClear().mockImplementation((field, op, value) => mockBuildWhereConstraint(field, op, value));
    firestore.writeBatch.mockClear().mockImplementation(() => {
      const batch = {
        delete: jest.fn(),
        set: jest.fn(),
        update: jest.fn(),
        commit: jest.fn(() => Promise.resolve()),
      };
      mockBatchInstances.push(batch);
      return batch;
    });

    const storageApi = require('firebase/storage');
    storageApi.deleteObject.mockClear().mockResolvedValue(undefined);
    storageApi.getDownloadURL.mockClear().mockResolvedValue('https://example.com/uploaded-map.png');
    storageApi.ref.mockClear().mockImplementation((storage, path) => ({ storage, path }));
    storageApi.uploadBytes.mockClear().mockResolvedValue(undefined);

    preloadImageAssets.mockClear().mockResolvedValue([]);
    scheduleImageAssetPreload.mockClear().mockImplementation(() => jest.fn());

    readAudioFileMetadata.mockClear().mockResolvedValue({ durationMs: 12_345 });
    mockDeleteGrigliataCustomTokenCallable.mockClear().mockResolvedValue({ data: { success: true } });
    mockSpawnGrigliataFoeTokenCallable.mockClear().mockResolvedValue({ data: { success: true, tokenId: 'foe-token-1' } });
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  const setManagerAuth = () => {
    useAuth.mockReturnValue({
      user: {
        uid: 'user-1',
        email: 'user-1@example.com',
      },
      userData: {
        role: 'dm',
        settings: {
          grigliata_draw_color: 'ion-cyan',
          grigliata_share_interactions: false,
        },
        imageUrl: '',
        imagePath: '',
      },
      loading: false,
    });
  };

  const getLastCommittedBatch = () => (
    [...mockBatchInstances].reverse().find((batch) => batch.commit.mock.calls.length > 0)
  );

  test('preloads the active battlemap, visible board tokens, and the tray portrait for players', async () => {
    mockFirestoreState.collections.grigliata_backgrounds = [
      {
        id: 'map-1',
        name: 'Sunken Ruins',
        imageUrl: 'https://example.com/map-1.png',
        grid: { cellSizePx: 70, offsetXPx: 0, offsetYPx: 0 },
        isGridVisible: true,
      },
      {
        id: 'map-2',
        name: 'Iron Keep',
        imageUrl: 'https://example.com/map-2.png',
        grid: { cellSizePx: 70, offsetXPx: 0, offsetYPx: 0 },
        isGridVisible: true,
      },
    ];
    mockFirestoreState.collections.grigliata_tokens = [
      {
        id: 'user-2',
        ownerUid: 'user-2',
        label: 'Orc Raider',
        imageUrl: 'https://example.com/orc-raider.png',
      },
    ];
    mockFirestoreState.collections.grigliata_token_placements = [
      {
        id: 'map-1__user-2',
        backgroundId: 'map-1',
        tokenId: 'user-2',
        ownerUid: 'user-2',
        label: 'Orc Raider',
        imageUrl: 'https://example.com/orc-raider.png',
        col: 2,
        row: 4,
        isVisibleToPlayers: true,
      },
    ];

    useAuth.mockReturnValue({
      user: {
        uid: 'user-1',
        email: 'user-1@example.com',
      },
      userData: {
        role: 'player',
        settings: {
          grigliata_draw_color: 'ion-cyan',
          grigliata_share_interactions: false,
        },
        imageUrl: 'https://example.com/player-tray.png',
        imagePath: 'characters/player-tray.png',
      },
      loading: false,
    });

    render(<GrigliataPage />);

    expect(firestore.query).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'grigliata_tokens' }),
      expect.objectContaining({ kind: 'where', field: 'ownerUid', op: '==', value: 'user-1' })
    );

    await waitFor(() => {
      expect(
        preloadImageAssets.mock.calls.some(([urls]) => (
          Array.isArray(urls)
          && urls.length === 3
          && urls.includes('https://example.com/map-1.png')
          && urls.includes('https://example.com/orc-raider.png')
          && urls.includes('https://example.com/player-tray.png')
        ))
      ).toBe(true);
    });

    expect(scheduleImageAssetPreload).not.toHaveBeenCalled();
  });

  test('waits for the DM gallery tab before scheduling deferred battleground preloads', async () => {
    setManagerAuth();
    mockFirestoreState.collections.grigliata_backgrounds = [
      {
        id: 'map-1',
        name: 'Sunken Ruins',
        imageUrl: 'https://example.com/map-1.png',
        grid: { cellSizePx: 70, offsetXPx: 0, offsetYPx: 0 },
        isGridVisible: true,
      },
      {
        id: 'map-2',
        name: 'Iron Keep',
        imageUrl: 'https://example.com/map-2.png',
        grid: { cellSizePx: 70, offsetXPx: 0, offsetYPx: 0 },
        isGridVisible: true,
      },
    ];

    render(<GrigliataPage />);

    await waitFor(() => {
      expect(preloadImageAssets).toHaveBeenCalledWith(['https://example.com/map-1.png']);
    });

    expect(scheduleImageAssetPreload).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('tab', { name: /dm gallery/i }));

    await waitFor(() => {
      expect(scheduleImageAssetPreload).toHaveBeenCalledWith(['https://example.com/map-2.png']);
    });
  });

  test('limits deferred DM gallery preloads to a bounded batch', async () => {
    setManagerAuth();
    mockFirestoreState.collections.grigliata_backgrounds = Array.from({ length: 8 }, (_, index) => ({
      id: `map-${index + 1}`,
      name: `Map ${index + 1}`,
      imageUrl: `https://example.com/map-${index + 1}.png`,
      grid: { cellSizePx: 70, offsetXPx: 0, offsetYPx: 0 },
      isGridVisible: true,
    }));

    render(<GrigliataPage />);

    fireEvent.click(screen.getByRole('tab', { name: /dm gallery/i }));

    await waitFor(() => {
      expect(scheduleImageAssetPreload).toHaveBeenCalled();
    });

    const lastScheduledUrls = scheduleImageAssetPreload.mock.calls[
      scheduleImageAssetPreload.mock.calls.length - 1
    ][0];

    expect(lastScheduledUrls).toHaveLength(6);
    expect(lastScheduledUrls).not.toContain('https://example.com/map-1.png');
  });

  test('publishes only when sharing is enabled and a live interaction exists', async () => {
    render(<GrigliataPage />);

    fireEvent.click(screen.getByRole('button', { name: /emit interaction a/i }));
    await act(async () => {
      jest.advanceTimersByTime(GRIGLIATA_LIVE_INTERACTION_THROTTLE_MS);
    });
    expect(firestore.setDoc).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /toggle interaction sharing/i }));

    await act(async () => {
      jest.advanceTimersByTime(GRIGLIATA_LIVE_INTERACTION_THROTTLE_MS);
    });

    await waitFor(() => {
      expect(firestore.setDoc).toHaveBeenCalledTimes(1);
    });

    expect(firestore.setDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'grigliata_live_interactions/map-1__user-1' }),
      expect.objectContaining({
        backgroundId: 'map-1',
        ownerUid: 'user-1',
        type: 'measure',
        source: 'free',
        colorKey: 'ion-cyan',
        anchorCells: [{ col: 1, row: 1 }],
        liveEndCell: { col: 3, row: 1 },
        updatedBy: 'user-1',
      })
    );
  });

        test('syncs the current user token profile from the page layer and scrubs legacy placement fields', async () => {
          setCollectionData('grigliata_tokens', [{
            id: 'user-1',
            ownerUid: 'user-1',
            characterId: '',
            label: 'Legacy Token',
            imageUrl: '',
            imagePath: '',
            placed: true,
            col: 3,
            row: 4,
          }]);

          render(<GrigliataPage />);

          await waitFor(() => {
            expect(firestore.setDoc).toHaveBeenCalledWith(
              expect.objectContaining({ path: 'grigliata_tokens/user-1' }),
              expect.objectContaining({
                ownerUid: 'user-1',
                characterId: '',
                label: 'user-1',
                imageUrl: '',
                imagePath: '',
                tokenType: 'character',
                imageSource: 'profile',
                placed: { __type: 'deleteField' },
                col: { __type: 'deleteField' },
                row: { __type: 'deleteField' },
              }),
              { merge: true }
            );
          });
        });

  test('places the current token with an explicit dead-state flag', async () => {
    useAuth.mockReturnValue({
      user: {
        uid: 'user-1',
        email: 'user-1@example.com',
      },
      userData: {
        role: 'player',
        settings: {
          grigliata_draw_color: 'ion-cyan',
          grigliata_share_interactions: false,
        },
        imageUrl: 'https://example.com/token.png',
        imagePath: 'grigliata/tokens/user-1.png',
      },
      loading: false,
    });

    render(<GrigliataPage />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /drop current token/i }));
    });

    await waitFor(() => {
      expect(mockBatchInstances).toHaveLength(1);
      expect(mockBatchInstances[0].commit).toHaveBeenCalledTimes(1);
    });

    expect(mockBatchInstances[0].set).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'grigliata_token_placements/map-1__user-1' }),
      expect.objectContaining({
        backgroundId: 'map-1',
        tokenId: 'user-1',
        ownerUid: 'user-1',
        label: 'user-1',
        imageUrl: 'https://example.com/token.png',
        isVisibleToPlayers: true,
        isDead: false,
        updatedBy: 'user-1',
      }),
      { merge: true }
    );
  });

  test('preserves existing dead state and statuses when moving a placement', async () => {
    act(() => {
      setCollectionData('grigliata_token_placements', [
        {
          id: 'map-1__user-1',
          backgroundId: 'map-1',
          ownerUid: 'user-1',
          col: 1,
          row: 2,
          isVisibleToPlayers: true,
          isDead: true,
          statuses: ['burning'],
        },
      ]);
    });

    render(<GrigliataPage />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /move token placement/i }));
    });

    await waitFor(() => {
      expect(mockBatchInstances).toHaveLength(1);
      expect(mockBatchInstances[0].commit).toHaveBeenCalledTimes(1);
    });

    expect(mockBatchInstances[0].set).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'grigliata_token_placements/map-1__user-1' }),
      expect.objectContaining({
        backgroundId: 'map-1',
        tokenId: 'user-1',
        ownerUid: 'user-1',
        label: 'user-1',
        imageUrl: '',
        col: 4,
        row: 5,
        isVisibleToPlayers: true,
        isDead: true,
        statuses: ['burning'],
        updatedBy: 'user-1',
      }),
      { merge: true }
    );
  });

  test('backfills legacy placement docs that are missing isDead', async () => {
    setManagerAuth();

    act(() => {
      setCollectionData('grigliata_token_placements', [
        {
          id: 'map-1__user-2',
          backgroundId: 'map-1',
          ownerUid: 'user-2',
          col: 3,
          row: 4,
          isVisibleToPlayers: true,
        },
      ]);
    });

    render(<GrigliataPage />);

    await waitFor(() => {
      expect(mockBatchInstances).toHaveLength(1);
      expect(mockBatchInstances[0].commit).toHaveBeenCalledTimes(1);
    });

    expect(mockBatchInstances[0].set).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'grigliata_token_placements/map-1__user-2' }),
      expect.objectContaining({
        isDead: false,
        updatedBy: 'user-1',
      }),
      { merge: true }
    );

    expect(firestore.setDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'grigliata_state/current' }),
      expect.objectContaining({
        legacyPlacementDeadStateCleanupCompletedAt: { __type: 'serverTimestamp' },
        updatedBy: 'user-1',
      }),
      { merge: true }
    );
  });

  test('applies selected-token visibility changes from the board actions', async () => {
    setManagerAuth();

    act(() => {
      setCollectionData('grigliata_token_placements', [
        {
          id: 'map-1__user-2',
          backgroundId: 'map-1',
          ownerUid: 'user-2',
          col: 3,
          row: 4,
          isVisibleToPlayers: true,
          isDead: true,
          statuses: ['burning'],
        },
      ]);
    });

    render(<GrigliataPage />);
    await waitFor(() => {
      expect(screen.getByTestId('board-token-count')).toHaveTextContent('1');
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /hide selected token/i }));
    });

    await waitFor(() => {
      expect(getLastCommittedBatch()).toBeDefined();
    });

    const committedBatch = getLastCommittedBatch();
    expect(committedBatch.commit).toHaveBeenCalledTimes(1);
    expect(committedBatch.set).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'grigliata_token_placements/map-1__user-2' }),
      expect.objectContaining({
        backgroundId: 'map-1',
        tokenId: 'user-2',
        ownerUid: 'user-2',
        label: 'user-2',
        imageUrl: '',
        col: 3,
        row: 4,
        isVisibleToPlayers: false,
        isDead: true,
        statuses: ['burning'],
        updatedBy: 'user-1',
      }),
      { merge: true }
    );
    expect(committedBatch.set).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'users/user-2' }),
      {
        settings: {
          grigliata_hidden_token_ids_by_background: {
            'map-1': { __type: 'arrayUnion', value: 'user-2' },
          },
          grigliata_hidden_background_ids: { __type: 'arrayUnion', value: 'map-1' },
        },
      },
      { merge: true }
    );
  });

  test('splits bulk selected-token visibility changes into multiple safe batches', async () => {
    setManagerAuth();

    act(() => {
      setCollectionData('grigliata_token_placements', ['user-2', 'user-3', 'user-4', 'user-5', 'user-6'].map((ownerUid, index) => ({
        id: `map-1__${ownerUid}`,
        backgroundId: 'map-1',
        ownerUid,
        col: index + 1,
        row: index + 2,
        isVisibleToPlayers: true,
        isDead: false,
        statuses: [],
      })));
    });

    render(<GrigliataPage />);
    await waitFor(() => {
      expect(screen.getByTestId('board-token-count')).toHaveTextContent('5');
    });

    mockBatchInstances.splice(0, mockBatchInstances.length);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /hide five selected tokens/i }));
    });

    await waitFor(() => {
      const committedBatches = mockBatchInstances.filter((batch) => batch.commit.mock.calls.length > 0);
      expect(committedBatches).toHaveLength(2);
    });

    const committedBatches = mockBatchInstances.filter((batch) => batch.commit.mock.calls.length > 0);
    expect(committedBatches[0].set).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'grigliata_token_placements/map-1__user-2' }),
      expect.objectContaining({ isVisibleToPlayers: false }),
      { merge: true }
    );
    expect(committedBatches[1].set).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'grigliata_token_placements/map-1__user-6' }),
      expect.objectContaining({ isVisibleToPlayers: false }),
      { merge: true }
    );
  });

  test('applies selected-token dead-state changes from the board actions', async () => {
    setManagerAuth();

    act(() => {
      setCollectionData('grigliata_token_placements', [
        {
          id: 'map-1__user-2',
          backgroundId: 'map-1',
          ownerUid: 'user-2',
          col: 5,
          row: 6,
          isVisibleToPlayers: false,
          isDead: false,
          statuses: ['sleeping'],
        },
      ]);
    });

    render(<GrigliataPage />);
    await waitFor(() => {
      expect(screen.getByTestId('board-token-count')).toHaveTextContent('1');
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /mark selected token dead/i }));
    });

    await waitFor(() => {
      expect(getLastCommittedBatch()).toBeDefined();
    });

    const committedBatch = getLastCommittedBatch();
    expect(committedBatch.commit).toHaveBeenCalledTimes(1);
    expect(committedBatch.set).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'grigliata_token_placements/map-1__user-2' }),
      expect.objectContaining({
        backgroundId: 'map-1',
        tokenId: 'user-2',
        ownerUid: 'user-2',
        label: 'user-2',
        imageUrl: '',
        col: 5,
        row: 6,
        isVisibleToPlayers: false,
        isDead: true,
        statuses: ['sleeping'],
        updatedBy: 'user-1',
      }),
      { merge: true }
    );
  });

  test('updates selected token statuses from the board actions without dropping placement state', async () => {
    setManagerAuth();

    act(() => {
      setCollectionData('grigliata_token_placements', [
        {
          id: 'map-1__user-1',
          backgroundId: 'map-1',
          ownerUid: 'user-1',
          col: 2,
          row: 3,
          isVisibleToPlayers: false,
          isDead: true,
          statuses: ['sleeping'],
        },
      ]);
    });

    render(<GrigliataPage />);
    await waitFor(() => {
      expect(screen.getByTestId('board-token-count')).toHaveTextContent('1');
    });
    firestore.setDoc.mockClear();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /update selected token statuses/i }));
    });

    await waitFor(() => {
      expect(firestore.setDoc).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'grigliata_token_placements/map-1__user-1' }),
        expect.objectContaining({
          backgroundId: 'map-1',
          tokenId: 'user-1',
          ownerUid: 'user-1',
          label: 'user-1',
          imageUrl: '',
          col: 2,
          row: 3,
          isVisibleToPlayers: false,
          isDead: true,
          statuses: ['burning', 'marked'],
          updatedBy: 'user-1',
        }),
        { merge: true }
      );
    });
  });

  test('creates a custom token from the token tab and uploads its image', async () => {
    const file = new File(['wolf'], 'wolf.png', { type: 'image/png' });
    const storageApi = require('firebase/storage');

    render(<GrigliataPage />);

    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Summoned Wolf' },
    });
    fireEvent.change(screen.getByLabelText('Image'), {
      target: { files: [file] },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /create token/i }));
    });

    await waitFor(() => {
      expect(storageApi.uploadBytes).toHaveBeenCalledTimes(1);
      expect(firestore.addDoc).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'grigliata_tokens' }),
        expect.objectContaining({
          ownerUid: 'user-1',
          label: 'Summoned Wolf',
          tokenType: 'custom',
          imageSource: 'uploaded',
          createdBy: 'user-1',
          updatedBy: 'user-1',
        })
      );
    });

    expect(storageApi.ref).toHaveBeenCalledWith(
      {},
      expect.stringMatching(/^grigliata\/tokens\/user-1\/summoned_wolf_/i)
    );
  });

  test('disables a custom tray token when the per-token hidden map marks it hidden on the active background', async () => {
    useAuth.mockReturnValue({
      user: {
        uid: 'user-1',
        email: 'user-1@example.com',
      },
      userData: {
        role: 'player',
        settings: {
          grigliata_draw_color: 'ion-cyan',
          grigliata_share_interactions: false,
          grigliata_hidden_token_ids_by_background: {
            'map-1': ['token-2'],
          },
        },
        imageUrl: '',
        imagePath: '',
      },
      loading: false,
    });

    setCollectionData('grigliata_tokens', [{
      id: 'token-2',
      ownerUid: 'user-1',
      tokenType: 'custom',
      imageSource: 'uploaded',
      label: 'Wolf',
      imageUrl: 'https://example.com/wolf.png',
      imagePath: 'grigliata/tokens/user-1/wolf.png',
    }]);

    render(<GrigliataPage />);

    await waitFor(() => {
      expect(screen.getByText('Wolf')).toBeInTheDocument();
    });

    expect(screen.getAllByText('Hidden on Sunken Ruins by the DM')[0]).toBeInTheDocument();
    expect(screen.getByText('Wolf').closest('[draggable]')).toHaveAttribute('draggable', 'false');
  });

  test('deletes a custom token through the callable cleanup flow', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);

    setCollectionData('grigliata_tokens', [{
      id: 'token-2',
      ownerUid: 'user-1',
      tokenType: 'custom',
      imageSource: 'uploaded',
      label: 'Wolf',
      imageUrl: 'https://example.com/wolf.png',
      imagePath: 'grigliata/tokens/user-1/wolf.png',
    }]);

    render(<GrigliataPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /delete wolf/i })).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /delete wolf/i }));
    });

    await waitFor(() => {
      expect(mockDeleteGrigliataCustomTokenCallable).toHaveBeenCalledWith({ tokenId: 'token-2' });
    });

    confirmSpy.mockRestore();
  });

  test('hides the dm character tray entry while keeping custom token controls visible', async () => {
    useAuth.mockReturnValue({
      user: {
        uid: 'user-1',
        email: 'marcodm@example.com',
      },
      userData: {
        role: 'dm',
        settings: {
          grigliata_draw_color: 'ion-cyan',
          grigliata_share_interactions: false,
        },
        imageUrl: 'https://example.com/marco.png',
        imagePath: 'characters/marco.png',
      },
      loading: false,
    });
    setCollectionData('grigliata_tokens', [{
      id: 'user-1',
      ownerUid: 'user-1',
      tokenType: 'character',
      imageSource: 'profile',
      label: 'MarcoDM',
      imageUrl: 'https://example.com/marco.png',
      imagePath: 'characters/marco.png',
    }, {
      id: 'token-2',
      ownerUid: 'user-1',
      tokenType: 'custom',
      imageSource: 'uploaded',
      label: 'Wolf',
      imageUrl: 'https://example.com/wolf.png',
      imagePath: 'grigliata/tokens/user-1/wolf.png',
    }]);

    render(<GrigliataPage />);

    await waitFor(() => {
      expect(screen.getByText('Wolf')).toBeInTheDocument();
    });

    expect(screen.getByText('Foes Hub')).toBeInTheDocument();
    expect(screen.getByText('Add Custom Token')).toBeInTheDocument();
    expect(screen.queryByText('MarcoDM')).not.toBeInTheDocument();
  });

  test('shows the DM foes hub subsection inside the tokens tab and lets it collapse and reopen', async () => {
    setManagerAuth();
    setCollectionData('foes', [{
      id: 'foe-1',
      name: 'Test One',
      category: 'Beast',
      rank: 'Elite',
      dadoAnima: 'd10',
      stats: { level: 10, hpTotal: 60, hpCurrent: 60, manaTotal: 20, manaCurrent: 20 },
    }]);

    render(<GrigliataPage />);

    const toggle = await screen.findByTestId('foe-library-toggle');

    expect(await screen.findByText('Foes Hub')).toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('foe-library-content')).toBeInTheDocument();
    expect(screen.getByText('Test One')).toBeInTheDocument();
    expect(screen.getByText('Add Custom Token')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(toggle);
      jest.advanceTimersByTime(400);
    });

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await waitFor(() => {
      expect(screen.queryByTestId('foe-library-content')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Foes Hub')).toBeInTheDocument();
    expect(screen.queryByLabelText('Search Foes')).not.toBeInTheDocument();
    expect(screen.getByText('Add Custom Token')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(toggle);
    });

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByTestId('foe-library-content')).toBeInTheDocument();
    expect(screen.getByLabelText('Search Foes')).toBeInTheDocument();
    expect(screen.getByText('Test One')).toBeInTheDocument();
  });

  test('persists the DM foes hub collapsed state across remounts', async () => {
    setManagerAuth();
    setCollectionData('foes', [{
      id: 'foe-1',
      name: 'Test One',
      category: 'Beast',
      rank: 'Elite',
      dadoAnima: 'd10',
      stats: { level: 10, hpTotal: 60, hpCurrent: 60, manaTotal: 20, manaCurrent: 20 },
    }]);

    const storageKey = 'grigliata.foeLibraryCollapsed.user-1';
    const { unmount } = render(<GrigliataPage />);
    const toggle = await screen.findByTestId('foe-library-toggle');

    await act(async () => {
      fireEvent.click(toggle);
      jest.advanceTimersByTime(400);
    });

    await waitFor(() => {
      expect(window.localStorage.getItem(storageKey)).toBe('true');
    });
    await waitFor(() => {
      expect(screen.queryByTestId('foe-library-content')).not.toBeInTheDocument();
    });

    unmount();

    render(<GrigliataPage />);

    const restoredToggle = await screen.findByTestId('foe-library-toggle');
    expect(restoredToggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('foe-library-content')).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(restoredToggle);
    });

    await waitFor(() => {
      expect(window.localStorage.getItem(storageKey)).toBe('false');
    });
    expect(restoredToggle).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByTestId('foe-library-content')).toBeInTheDocument();
  });

  test('spawns a foe token when a foes hub library payload is dropped onto the board', async () => {
    setManagerAuth();

    render(<GrigliataPage />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /drop foe library token/i }));
    });

    await waitFor(() => {
      expect(mockSpawnGrigliataFoeTokenCallable).toHaveBeenCalledWith({
        foeId: 'foe-1',
        backgroundId: 'map-1',
        col: 2,
        row: 2,
      });
    });
  });

  test('shows and updates the selected foe token details for the DM', async () => {
    setManagerAuth();
    setCollectionData('grigliata_tokens', [{
      id: 'foe-token-1',
      ownerUid: 'user-1',
      tokenType: 'foe',
      imageSource: 'foesHub',
      label: 'Test One',
      imageUrl: 'https://example.com/foe.png',
      imagePath: 'foes/test-one.png',
      foeSourceId: 'foe-1',
      category: 'Beast',
      rank: 'Elite',
      dadoAnima: 'd10',
      notes: 'Alpha foe',
      stats: { level: 10, hpTotal: 60, hpCurrent: 60, manaTotal: 20, manaCurrent: 20 },
      Parametri: {
        Base: { Forza: { Tot: 7 } },
        Combattimento: { Attacco: { Tot: 5 } },
      },
      spells: [{ name: 'Hex', effetti: 'Slow' }],
      tecniche: [{ name: 'Claw', danni: '2d6' }],
    }]);
    setCollectionData('grigliata_token_placements', [{
      id: 'map-1__foe-token-1',
      backgroundId: 'map-1',
      tokenId: 'foe-token-1',
      ownerUid: 'user-1',
      label: 'Test One',
      imageUrl: 'https://example.com/foe.png',
      col: 2,
      row: 2,
      isVisibleToPlayers: true,
      isDead: false,
      statuses: [],
    }]);

    render(<GrigliataPage />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /select foe token/i }));
    });

    expect(await screen.findByText('Selected Foe')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Test One')).toBeInTheDocument();
    expect(screen.getByText('Claw')).toBeInTheDocument();
    expect(screen.getByText('Hex')).toBeInTheDocument();

    mockBatchInstances.splice(0, mockBatchInstances.length);

    fireEvent.change(screen.getByLabelText('Foe Name'), { target: { value: 'Test One Prime' } });
    fireEvent.change(screen.getByLabelText('Current HP'), { target: { value: '42' } });
    fireEvent.change(screen.getByLabelText('Dado Anima'), { target: { value: 'd12' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /save foe/i }));
    });

    const batch = getLastCommittedBatch();
    expect(batch).toBeTruthy();
    expect(batch.set).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'grigliata_tokens/foe-token-1' }),
      expect.objectContaining({
        label: 'Test One Prime',
        dadoAnima: 'd12',
        stats: expect.objectContaining({ hpCurrent: 42, hpTotal: 60 }),
      }),
      { merge: true }
    );
    expect(batch.set).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'grigliata_token_placements/map-1__foe-token-1' }),
      expect.objectContaining({ label: 'Test One Prime' }),
      { merge: true }
    );
  });

  test('deletes the foe token profile together with its active placement', async () => {
    setManagerAuth();
    setCollectionData('grigliata_tokens', [{
      id: 'foe-token-1',
      ownerUid: 'user-1',
      tokenType: 'foe',
      imageSource: 'foesHub',
      label: 'Test One',
      imageUrl: 'https://example.com/foe.png',
      imagePath: 'foes/test-one.png',
      foeSourceId: 'foe-1',
      stats: { level: 10, hpTotal: 60, hpCurrent: 60, manaTotal: 20, manaCurrent: 20 },
      Parametri: {},
      spells: [],
      tecniche: [],
    }]);
    setCollectionData('grigliata_token_placements', [{
      id: 'map-1__foe-token-1',
      backgroundId: 'map-1',
      tokenId: 'foe-token-1',
      ownerUid: 'user-1',
      label: 'Test One',
      imageUrl: 'https://example.com/foe.png',
      col: 2,
      row: 2,
      isVisibleToPlayers: true,
      isDead: false,
      statuses: [],
    }]);

    render(<GrigliataPage />);
    mockBatchInstances.splice(0, mockBatchInstances.length);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /delete foe token placement/i }));
    });

    await waitFor(() => {
      const deletionBatch = mockBatchInstances.find((batch) => (
        batch.delete.mock.calls.some(([ref]) => ref?.path === 'grigliata_token_placements/map-1__foe-token-1')
      ));

      expect(deletionBatch).toBeTruthy();
      expect(deletionBatch.delete).toHaveBeenCalledWith(expect.objectContaining({ path: 'grigliata_token_placements/map-1__foe-token-1' }));
      expect(deletionBatch.delete).toHaveBeenCalledWith(expect.objectContaining({ path: 'grigliata_tokens/foe-token-1' }));
    });
  });

  test('deletes a foe token profile even when the local token cache has not loaded it yet', async () => {
    setManagerAuth();
    setDocData('grigliata_tokens/foe-token-1', {
      ownerUid: 'user-1',
      tokenType: 'foe',
      imageSource: 'foesHub',
      label: 'Test One',
      imageUrl: 'https://example.com/foe.png',
      imagePath: 'foes/test-one.png',
      foeSourceId: 'foe-1',
      stats: { level: 10, hpTotal: 60, hpCurrent: 60, manaTotal: 20, manaCurrent: 20 },
      Parametri: {},
      spells: [],
      tecniche: [],
    });
    setCollectionData('grigliata_token_placements', [{
      id: 'map-1__foe-token-1',
      backgroundId: 'map-1',
      tokenId: 'foe-token-1',
      ownerUid: 'user-1',
      label: 'Test One',
      imageUrl: 'https://example.com/foe.png',
      col: 2,
      row: 2,
      isVisibleToPlayers: true,
      isDead: false,
      statuses: [],
    }]);

    render(<GrigliataPage />);
    mockBatchInstances.splice(0, mockBatchInstances.length);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /delete foe token placement/i }));
    });

    await waitFor(() => {
      expect(firestore.getDoc).toHaveBeenCalledWith(expect.objectContaining({ path: 'grigliata_tokens/foe-token-1' }));

      const deletionBatch = mockBatchInstances.find((batch) => (
        batch.delete.mock.calls.some(([ref]) => ref?.path === 'grigliata_token_placements/map-1__foe-token-1')
      ));

      expect(deletionBatch).toBeTruthy();
      expect(deletionBatch.delete).toHaveBeenCalledWith(expect.objectContaining({ path: 'grigliata_token_placements/map-1__foe-token-1' }));
      expect(deletionBatch.delete).toHaveBeenCalledWith(expect.objectContaining({ path: 'grigliata_tokens/foe-token-1' }));
    });
  });

  test('splits bulk token deletions into multiple safe batches', async () => {
    setManagerAuth();
    setCollectionData('grigliata_token_placements', ['user-2', 'user-3', 'user-4', 'user-5', 'user-6'].map((ownerUid, index) => ({
      id: `map-1__${ownerUid}`,
      backgroundId: 'map-1',
      tokenId: ownerUid,
      ownerUid,
      label: ownerUid,
      imageUrl: '',
      col: index + 2,
      row: index + 3,
      isVisibleToPlayers: true,
      isDead: false,
      statuses: [],
    })));

    render(<GrigliataPage />);
    await waitFor(() => {
      expect(screen.getByTestId('board-token-count')).toHaveTextContent('5');
    });

    mockBatchInstances.splice(0, mockBatchInstances.length);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /delete five token placements/i }));
    });

    await waitFor(() => {
      const committedBatches = mockBatchInstances.filter((batch) => batch.commit.mock.calls.length > 0);
      expect(committedBatches).toHaveLength(2);
    });

    const committedBatches = mockBatchInstances.filter((batch) => batch.commit.mock.calls.length > 0);
    expect(committedBatches[0].delete).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'grigliata_token_placements/map-1__user-2' })
    );
    expect(committedBatches[1].delete).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'grigliata_token_placements/map-1__user-6' })
    );
  });

  test('shows the music tab only for managers', () => {
    const { rerender } = render(<GrigliataPage />);

    expect(screen.queryByRole('tab', { name: /music/i })).not.toBeInTheDocument();

    setManagerAuth();
    rerender(<GrigliataPage />);

    expect(screen.getByRole('tab', { name: /music/i })).toBeInTheDocument();
  });

  test('toggles the current user Grigliata music mute preference', async () => {
    const { rerender } = render(<GrigliataPage />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^mute music$/i }));
    });

    await waitFor(() => {
      expect(firestore.updateDoc).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'users/user-1' }),
        { 'settings.grigliata_music_muted': true }
      );
    });

    firestore.updateDoc.mockClear();

    useAuth.mockReturnValue({
      user: {
        uid: 'user-1',
        email: 'user-1@example.com',
      },
      userData: {
        role: 'player',
        settings: {
          grigliata_draw_color: 'ion-cyan',
          grigliata_share_interactions: false,
          grigliata_music_muted: true,
        },
        imageUrl: '',
        imagePath: '',
      },
      loading: false,
    });

    rerender(<GrigliataPage />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^unmute music$/i }));
    });

    await waitFor(() => {
      expect(firestore.updateDoc).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'users/user-1' }),
        { 'settings.grigliata_music_muted': false }
      );
    });
  });

  test('shows an error when the current user music mute preference cannot be updated', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    firestore.updateDoc.mockRejectedValueOnce(new Error('write failed'));

    try {
      render(<GrigliataPage />);

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /^mute music$/i }));
      });

      await waitFor(() => {
        expect(screen.getByText(/unable to update your grigliata music setting right now/i)).toBeInTheDocument();
      });
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  test('uploads a music track and persists its metadata', async () => {
    setManagerAuth();
    const storageApi = require('firebase/storage');

    render(<GrigliataPage />);

    fireEvent.click(screen.getByRole('tab', { name: /music/i }));

    const file = new File(['audio-bytes'], 'battle-theme.mp3', { type: 'audio/mpeg' });
    Object.defineProperty(file, 'size', { value: 2048 });

    fireEvent.change(screen.getByLabelText(/music track file/i), {
      target: { files: [file] },
    });

    expect(screen.getByDisplayValue('battle theme')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /add track/i }));
    });

    await waitFor(() => {
      expect(readAudioFileMetadata).toHaveBeenCalledWith(file);
    });

    expect(storageApi.ref).toHaveBeenCalledWith(
      {},
      expect.stringMatching(/^grigliata\/music\/user-1\/battle_theme_\d+\.mp3$/)
    );
    expect(storageApi.uploadBytes).toHaveBeenCalled();

    await waitFor(() => {
      expect(firestore.addDoc).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'grigliata_music_tracks' }),
        expect.objectContaining({
          name: 'battle theme',
          fileName: 'battle-theme.mp3',
          audioUrl: 'https://example.com/uploaded-map.png',
          audioPath: expect.stringMatching(/^grigliata\/music\/user-1\/battle_theme_\d+\.mp3$/),
          contentType: 'audio/mpeg',
          sizeBytes: 2048,
          durationMs: 12_345,
          createdBy: 'user-1',
          updatedBy: 'user-1',
        })
      );
    });
  });

  test('derives a music track extension from the MIME type when the filename has none', async () => {
    setManagerAuth();
    const storageApi = require('firebase/storage');

    render(<GrigliataPage />);

    fireEvent.click(screen.getByRole('tab', { name: /music/i }));

    const file = new File(['audio-bytes'], 'battle-theme', { type: 'audio/mpeg' });
    Object.defineProperty(file, 'size', { value: 2048 });

    fireEvent.change(screen.getByLabelText(/music track file/i), {
      target: { files: [file] },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /add track/i }));
    });

    await waitFor(() => {
      expect(storageApi.ref).toHaveBeenCalledWith(
        {},
        expect.stringMatching(/^grigliata\/music\/user-1\/battle_theme_\d+\.mp3$/)
      );
    });
  });

  test('cleans up an uploaded music file when metadata persistence fails', async () => {
    setManagerAuth();
    const storageApi = require('firebase/storage');
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    firestore.addDoc.mockRejectedValueOnce(new Error('write failed'));

    render(<GrigliataPage />);

    fireEvent.click(screen.getByRole('tab', { name: /music/i }));

    const file = new File(['audio-bytes'], 'ambience.mp3', { type: 'audio/mpeg' });
    Object.defineProperty(file, 'size', { value: 1024 });

    fireEvent.change(screen.getByLabelText(/music track file/i), {
      target: { files: [file] },
    });

    try {
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /add track/i }));
      });

      await waitFor(() => {
        expect(firestore.addDoc).toHaveBeenCalled();
      });

      expect(storageApi.ref).toHaveBeenCalledWith(
        {},
        expect.stringMatching(/^grigliata\/music\/user-1\/ambience_\d+\.mp3$/)
      );

      await waitFor(() => {
        expect(storageApi.deleteObject).toHaveBeenCalled();
      });

      await waitFor(() => {
        expect(screen.getByText(/failed to upload the selected audio track/i)).toBeInTheDocument();
      });
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  test('plays, pauses, resumes, and stops shared music playback', async () => {
    setManagerAuth();
    jest.setSystemTime(new Date('2026-04-15T18:00:10.000Z'));

    act(() => {
      setCollectionData('grigliata_music_tracks', [
        {
          id: 'track-1',
          name: 'Battle Theme',
          fileName: 'battle-theme.mp3',
          audioUrl: 'https://example.com/audio/battle-theme.mp3',
          audioPath: 'grigliata/music/user-1/battle-theme.mp3',
          contentType: 'audio/mpeg',
          sizeBytes: 2048,
          durationMs: 120_000,
        },
      ]);
    });

    render(<GrigliataPage />);

    fireEvent.click(screen.getByRole('tab', { name: /music/i }));
    firestore.setDoc.mockClear();

    const volumeSlider = screen.getByRole('slider', { name: /shared music volume/i });

    await act(async () => {
      fireEvent.change(volumeSlider, { target: { value: '35' } });
      fireEvent.mouseUp(volumeSlider);
    });

    await waitFor(() => {
      expect(firestore.setDoc).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'grigliata_music_playback/current' }),
        expect.objectContaining({
          status: 'stopped',
          trackId: '',
          volume: 0.35,
          updatedBy: 'user-1',
        })
      );
    });
    firestore.setDoc.mockClear();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^play battle theme$/i }));
    });

    await waitFor(() => {
      expect(firestore.setDoc).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'grigliata_music_playback/current' }),
        expect.objectContaining({
          status: 'playing',
          trackId: 'track-1',
          trackName: 'Battle Theme',
          audioUrl: 'https://example.com/audio/battle-theme.mp3',
          durationMs: 120_000,
          offsetMs: 0,
          volume: 0.35,
          startedAt: { __type: 'serverTimestamp' },
          updatedBy: 'user-1',
          commandId: expect.any(String),
        })
      );
    });
    firestore.setDoc.mockClear();

    act(() => {
      setDocData('grigliata_music_playback/current', {
        status: 'playing',
        trackId: 'track-1',
        trackName: 'Battle Theme',
        audioUrl: 'https://example.com/audio/battle-theme.mp3',
        durationMs: 120_000,
        offsetMs: 2_000,
        volume: 0.35,
        startedAt: { toMillis: () => Date.now() - 5_000 },
        commandId: 'cmd-play',
        updatedBy: 'user-1',
      });
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^pause battle theme$/i })).not.toBeDisabled();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^pause battle theme$/i }));
    });

    await waitFor(() => {
      expect(firestore.setDoc).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'grigliata_music_playback/current' }),
        expect.objectContaining({
          status: 'paused',
          trackId: 'track-1',
          offsetMs: 7_000,
          volume: 0.35,
          startedAt: null,
          updatedBy: 'user-1',
          commandId: expect.any(String),
        })
      );
    });
    firestore.setDoc.mockClear();

    act(() => {
      setDocData('grigliata_music_playback/current', {
        status: 'paused',
        trackId: 'track-1',
        trackName: 'Battle Theme',
        audioUrl: 'https://example.com/audio/battle-theme.mp3',
        durationMs: 120_000,
        offsetMs: 7_000,
        volume: 0.35,
        startedAt: null,
        commandId: 'cmd-pause',
        updatedBy: 'user-1',
      });
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^resume battle theme$/i })).not.toBeDisabled();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^resume battle theme$/i }));
    });

    await waitFor(() => {
      expect(firestore.setDoc).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'grigliata_music_playback/current' }),
        expect.objectContaining({
          status: 'playing',
          trackId: 'track-1',
          offsetMs: 7_000,
          volume: 0.35,
          startedAt: { __type: 'serverTimestamp' },
          updatedBy: 'user-1',
          commandId: expect.any(String),
        })
      );
    });
    firestore.setDoc.mockClear();

    act(() => {
      setDocData('grigliata_music_playback/current', {
        status: 'playing',
        trackId: 'track-1',
        trackName: 'Battle Theme',
        audioUrl: 'https://example.com/audio/battle-theme.mp3',
        durationMs: 120_000,
        offsetMs: 7_000,
        volume: 0.35,
        startedAt: { toMillis: () => Date.now() - 1_000 },
        commandId: 'cmd-resume',
        updatedBy: 'user-1',
      });
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^stop battle theme$/i })).not.toBeDisabled();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^stop battle theme$/i }));
    });

    await waitFor(() => {
      expect(firestore.setDoc).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'grigliata_music_playback/current' }),
        expect.objectContaining({
          status: 'stopped',
          trackId: '',
          trackName: '',
          audioUrl: '',
          durationMs: 0,
          offsetMs: 0,
          volume: 0.35,
          startedAt: null,
          updatedBy: 'user-1',
          commandId: expect.any(String),
        })
      );
    });
  });

  test('stops shared playback before deleting the active music track', async () => {
    setManagerAuth();
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);

    act(() => {
      setCollectionData('grigliata_music_tracks', [
        {
          id: 'track-1',
          name: 'Battle Theme',
          fileName: 'battle-theme.mp3',
          audioUrl: 'https://example.com/audio/battle-theme.mp3',
          audioPath: 'grigliata/music/user-1/battle-theme.mp3',
          contentType: 'audio/mpeg',
          sizeBytes: 2048,
          durationMs: 120_000,
        },
      ]);
      setDocData('grigliata_music_playback/current', {
        status: 'playing',
        trackId: 'track-1',
        trackName: 'Battle Theme',
        audioUrl: 'https://example.com/audio/battle-theme.mp3',
        durationMs: 120_000,
        offsetMs: 0,
        volume: 0.42,
        startedAt: { toMillis: () => Date.now() - 1_000 },
        commandId: 'cmd-active',
        updatedBy: 'user-1',
      });
    });

    render(<GrigliataPage />);

    fireEvent.click(screen.getByRole('tab', { name: /music/i }));
    firestore.setDoc.mockClear();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^delete battle theme$/i }));
    });

    await waitFor(() => {
      expect(firestore.setDoc).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'grigliata_music_playback/current' }),
        expect.objectContaining({
          status: 'stopped',
          trackId: '',
          audioUrl: '',
          volume: 0.42,
        })
      );
    });

    await waitFor(() => {
      expect(firestore.deleteDoc).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'grigliata_music_tracks/track-1' })
      );
    });

    confirmSpy.mockRestore();
  });

  test('throttles live interaction publishes and keeps only the latest pending payload', async () => {
    render(<GrigliataPage />);

    fireEvent.click(screen.getByRole('button', { name: /toggle interaction sharing/i }));
    fireEvent.click(screen.getByRole('button', { name: /emit interaction a/i }));
    fireEvent.click(screen.getByRole('button', { name: /emit interaction b/i }));

    await act(async () => {
      jest.advanceTimersByTime(GRIGLIATA_LIVE_INTERACTION_THROTTLE_MS - 1);
    });

    expect(firestore.setDoc).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(1);
    });

    await waitFor(() => {
      expect(firestore.setDoc).toHaveBeenCalledTimes(1);
    });

    expect(firestore.setDoc.mock.calls[0][1]).toEqual(expect.objectContaining({
      liveEndCell: { col: 4, row: 1 },
    }));
  });

  test('publishes ping interactions through the shared interaction pipeline even when sharing is disabled', async () => {
    render(<GrigliataPage />);

    fireEvent.click(screen.getByRole('button', { name: /emit ping interaction/i }));

    await act(async () => {
      jest.advanceTimersByTime(GRIGLIATA_LIVE_INTERACTION_THROTTLE_MS);
    });

    await waitFor(() => {
      expect(firestore.setDoc).toHaveBeenCalledTimes(1);
    });

    expect(firestore.setDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'grigliata_live_interactions/map-1__user-1' }),
      expect.objectContaining({
        backgroundId: 'map-1',
        ownerUid: 'user-1',
        type: 'ping',
        source: 'free',
        colorKey: 'ion-cyan',
        point: { x: 320, y: 180 },
        startedAtMs: 1_713_100_000_250,
        updatedBy: 'user-1',
      })
    );

    fireEvent.click(screen.getByRole('button', { name: /clear interaction/i }));

    await waitFor(() => {
      expect(firestore.deleteDoc).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'grigliata_live_interactions/map-1__user-1' })
      );
    });
  });

  test('deletes the shared interaction when the live interaction ends', async () => {
    render(<GrigliataPage />);

    fireEvent.click(screen.getByRole('button', { name: /toggle interaction sharing/i }));
    fireEvent.click(screen.getByRole('button', { name: /emit interaction a/i }));

    await act(async () => {
      jest.advanceTimersByTime(GRIGLIATA_LIVE_INTERACTION_THROTTLE_MS);
    });

    fireEvent.click(screen.getByRole('button', { name: /clear interaction/i }));

    await waitFor(() => {
      expect(firestore.deleteDoc).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'grigliata_live_interactions/map-1__user-1' })
      );
    });
  });

  test('deletes the shared interaction when sharing is toggled off', async () => {
    render(<GrigliataPage />);

    fireEvent.click(screen.getByRole('button', { name: /toggle interaction sharing/i }));
    fireEvent.click(screen.getByRole('button', { name: /emit interaction a/i }));

    await act(async () => {
      jest.advanceTimersByTime(GRIGLIATA_LIVE_INTERACTION_THROTTLE_MS);
    });

    fireEvent.click(screen.getByRole('button', { name: /toggle interaction sharing/i }));

    await waitFor(() => {
      expect(firestore.deleteDoc).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'grigliata_live_interactions/map-1__user-1' })
      );
    });
  });

  test('deletes the shared interaction when the active background changes', async () => {
    render(<GrigliataPage />);

    fireEvent.click(screen.getByRole('button', { name: /toggle interaction sharing/i }));
    fireEvent.click(screen.getByRole('button', { name: /emit interaction a/i }));

    await act(async () => {
      jest.advanceTimersByTime(GRIGLIATA_LIVE_INTERACTION_THROTTLE_MS);
    });

    act(() => {
      setDocData('grigliata_state/current', {
        activeBackgroundId: 'map-2',
      });
    });

    await waitFor(() => {
      expect(firestore.deleteDoc).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'grigliata_live_interactions/map-1__user-1' })
      );
    });
  });

  test('deactivates the active background without modifying background documents', async () => {
    setManagerAuth();
    render(<GrigliataPage />);

    firestore.setDoc.mockClear();
    firestore.updateDoc.mockClear();
    firestore.deleteDoc.mockClear();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /deactivate active background/i }));
    });

    await waitFor(() => {
      expect(firestore.setDoc).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'grigliata_state/current' }),
        expect.objectContaining({
          activeBackgroundId: '',
          updatedAt: { __type: 'serverTimestamp' },
          updatedBy: 'user-1',
        }),
        { merge: true }
      );
    });

    expect(firestore.updateDoc).not.toHaveBeenCalled();
    expect(firestore.deleteDoc).not.toHaveBeenCalled();
  });

  test('deletes the shared interaction on unmount', async () => {
    const rendered = render(<GrigliataPage />);

    fireEvent.click(screen.getByRole('button', { name: /toggle interaction sharing/i }));
    fireEvent.click(screen.getByRole('button', { name: /emit interaction a/i }));

    await act(async () => {
      jest.advanceTimersByTime(GRIGLIATA_LIVE_INTERACTION_THROTTLE_MS);
    });

    rendered.unmount();

    await waitFor(() => {
      expect(firestore.deleteDoc).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'grigliata_live_interactions/map-1__user-1' })
      );
    });
  });

  test('persists the interaction sharing toggle and syncs owned AoE visibility', async () => {
    act(() => {
      setCollectionData('grigliata_aoe_figures', [
        {
          id: 'map-1__user-1__circle__1',
          backgroundId: 'map-1',
          ownerUid: 'user-1',
          figureType: 'circle',
          slot: 1,
          originCell: { col: 1, row: 1 },
          targetCell: { col: 3, row: 1 },
          colorKey: 'ion-cyan',
          isVisibleToPlayers: false,
        },
        {
          id: 'map-2__user-1__square__1',
          backgroundId: 'map-2',
          ownerUid: 'user-1',
          figureType: 'square',
          slot: 1,
          originCell: { col: 2, row: 2 },
          targetCell: { col: 4, row: 4 },
          colorKey: 'nova-teal',
          isVisibleToPlayers: false,
        },
      ]);
    });

    render(<GrigliataPage />);

    fireEvent.click(screen.getByRole('button', { name: /toggle interaction sharing/i }));

    await waitFor(() => {
      expect(firestore.updateDoc).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'users/user-1' }),
        { 'settings.grigliata_share_interactions': true }
      );
    });

    await waitFor(() => {
      const lastBatch = mockBatchInstances[mockBatchInstances.length - 1];
      expect(lastBatch.set).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'grigliata_aoe_figures/map-2__user-1__square__1' }),
        expect.objectContaining({
          isVisibleToPlayers: true,
          updatedBy: 'user-1',
        }),
        { merge: true }
      );
    });
  });

  test('publishes a shared AoE preview when sharing is enabled', async () => {
    render(<GrigliataPage />);

    fireEvent.click(screen.getByRole('button', { name: /toggle interaction sharing/i }));
    fireEvent.click(screen.getByRole('button', { name: /emit aoe interaction/i }));

    await act(async () => {
      jest.advanceTimersByTime(100);
    });

    await waitFor(() => {
      expect(firestore.setDoc).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'grigliata_live_interactions/map-1__user-1' }),
        expect.objectContaining({
          backgroundId: 'map-1',
          ownerUid: 'user-1',
          type: 'aoe',
          source: 'aoe-create',
          figureType: 'circle',
          originCell: { col: 1, row: 1 },
          targetCell: { col: 3, row: 1 },
          updatedBy: 'user-1',
        })
      );
    });
  });

  test('updates the local draw color immediately and persists it after the debounce window', async () => {
    render(<GrigliataPage />);

    expect(screen.getByTestId('board-draw-color')).toHaveTextContent('ion-cyan');

    fireEvent.click(screen.getByRole('button', { name: /emit draw color nova teal/i }));

    expect(screen.getByTestId('board-draw-color')).toHaveTextContent('nova-teal');
    expect(firestore.updateDoc).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(299);
    });
    expect(firestore.updateDoc).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(1);
    });

    await waitFor(() => {
      expect(firestore.updateDoc).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'users/user-1' }),
        { 'settings.grigliata_draw_color': 'nova-teal' }
      );
    });
  });

  test('keeps only the latest pending draw color preference when selections change quickly', async () => {
    render(<GrigliataPage />);

    fireEvent.click(screen.getByRole('button', { name: /emit draw color nova teal/i }));
    fireEvent.click(screen.getByRole('button', { name: /emit draw color solar amber/i }));

    expect(screen.getByTestId('board-draw-color')).toHaveTextContent('solar-amber');

    await act(async () => {
      jest.advanceTimersByTime(300);
    });

    await waitFor(() => {
      expect(firestore.updateDoc).toHaveBeenCalledTimes(1);
    });

    expect(firestore.updateDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'users/user-1' }),
      { 'settings.grigliata_draw_color': 'solar-amber' }
    );
  });

  test('returns to mouse selection when the board requests the default tool', () => {
    render(<GrigliataPage />);

    fireEvent.click(screen.getByRole('button', { name: /activate circle tool/i }));
    expect(screen.getByTestId('board-aoe-tool')).toHaveTextContent('circle');

    fireEvent.click(screen.getByRole('button', { name: /select mouse tool/i }));
    expect(screen.getByTestId('board-aoe-tool')).toHaveTextContent('');
  });

  test('ignores stale remote interactions before passing them to the board', async () => {
    render(<GrigliataPage />);

    act(() => {
      setCollectionData('grigliata_live_interactions', [
        {
          id: 'map-1__fresh-user',
          backgroundId: 'map-1',
          ownerUid: 'fresh-user',
          type: 'measure',
          source: 'free',
          colorKey: 'solar-amber',
          anchorCells: [{ col: 1, row: 1 }],
          liveEndCell: { col: 2, row: 1 },
          updatedAt: { toMillis: () => Date.now() },
          updatedBy: 'fresh-user',
        },
        {
          id: 'map-1__stale-user',
          backgroundId: 'map-1',
          ownerUid: 'stale-user',
          type: 'measure',
          source: 'free',
          colorKey: 'warp-violet',
          anchorCells: [{ col: 1, row: 1 }],
          liveEndCell: { col: 5, row: 1 },
          updatedAt: { toMillis: () => Date.now() - GRIGLIATA_LIVE_INTERACTION_STALE_MS - 1 },
          updatedBy: 'stale-user',
        },
      ]);
    });

    expect(screen.getByTestId('board-shared-count')).toHaveTextContent('1');
  });

  test('subscribes players to visible AoE figures plus their own hidden ones', () => {
    act(() => {
      setCollectionData('grigliata_aoe_figures', [
        {
          id: 'map-1__other-user__circle__1',
          backgroundId: 'map-1',
          ownerUid: 'other-user',
          figureType: 'circle',
          slot: 1,
          originCell: { col: 1, row: 1 },
          targetCell: { col: 2, row: 1 },
          colorKey: 'solar-amber',
          isVisibleToPlayers: true,
        },
        {
          id: 'map-1__user-1__square__1',
          backgroundId: 'map-1',
          ownerUid: 'user-1',
          figureType: 'square',
          slot: 1,
          originCell: { col: 2, row: 2 },
          targetCell: { col: 4, row: 4 },
          colorKey: 'nova-teal',
          isVisibleToPlayers: false,
        },
        {
          id: 'map-1__other-user__cone__1',
          backgroundId: 'map-1',
          ownerUid: 'other-user',
          figureType: 'cone',
          slot: 1,
          originCell: { col: 5, row: 5 },
          targetCell: { col: 6, row: 5 },
          colorKey: 'warp-violet',
          isVisibleToPlayers: false,
        },
      ]);
    });

    render(<GrigliataPage />);

    expect(screen.getByTestId('board-aoe-count')).toHaveTextContent('2');
  });

  test('creates a deterministic AoE figure doc for the current user', async () => {
    render(<GrigliataPage />);

    fireEvent.click(screen.getByRole('button', { name: /activate circle tool/i }));
    expect(screen.getByTestId('board-aoe-tool')).toHaveTextContent('circle');

    fireEvent.click(screen.getByRole('button', { name: /create aoe circle/i }));

    await waitFor(() => {
      expect(firestore.setDoc).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'grigliata_aoe_figures/map-1__user-1__circle__1' }),
        expect.objectContaining({
          backgroundId: 'map-1',
          ownerUid: 'user-1',
          figureType: 'circle',
          slot: 1,
          originCell: { col: 1, row: 1 },
          targetCell: { col: 3, row: 1 },
          colorKey: 'ion-cyan',
          isVisibleToPlayers: false,
          createdBy: 'user-1',
          updatedBy: 'user-1',
        })
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId('board-aoe-tool')).toHaveTextContent('');
    });
  });

  test('moves and deletes an existing AoE figure through page handlers', async () => {
    act(() => {
      setCollectionData('grigliata_aoe_figures', [
        {
          id: 'map-1__user-1__circle__1',
          backgroundId: 'map-1',
          ownerUid: 'user-1',
          figureType: 'circle',
          slot: 1,
          originCell: { col: 1, row: 1 },
          targetCell: { col: 3, row: 1 },
          colorKey: 'ion-cyan',
          isVisibleToPlayers: false,
        },
      ]);
    });

    render(<GrigliataPage />);

    fireEvent.click(screen.getByRole('button', { name: /move aoe circle/i }));

    await waitFor(() => {
      expect(firestore.updateDoc).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'grigliata_aoe_figures/map-1__user-1__circle__1' }),
        expect.objectContaining({
          originCell: { col: 2, row: 1 },
          targetCell: { col: 4, row: 1 },
          isVisibleToPlayers: false,
          updatedBy: 'user-1',
        })
      );
    });

    fireEvent.click(screen.getByRole('button', { name: /delete aoe circle/i }));

    await waitFor(() => {
      const lastBatch = mockBatchInstances[mockBatchInstances.length - 1];
      expect(lastBatch.delete).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'grigliata_aoe_figures/map-1__user-1__circle__1' })
      );
    });
  });

  test('blocks the sixth AoE figure of the same type on the same map', async () => {
    act(() => {
      setCollectionData('grigliata_aoe_figures', [
        1, 2, 3, 4, 5,
      ].map((slot) => ({
        id: `map-1__user-1__circle__${slot}`,
        backgroundId: 'map-1',
        ownerUid: 'user-1',
        figureType: 'circle',
        slot,
        originCell: { col: slot, row: 1 },
        targetCell: { col: slot + 1, row: 1 },
        colorKey: 'ion-cyan',
        isVisibleToPlayers: false,
      })));
    });

    render(<GrigliataPage />);

    fireEvent.click(screen.getByRole('button', { name: /activate circle tool/i }));
    expect(screen.getByTestId('board-aoe-tool')).toHaveTextContent('circle');

    fireEvent.click(screen.getByRole('button', { name: /create aoe circle/i }));

    expect(firestore.setDoc).not.toHaveBeenCalledWith(
      expect.objectContaining({ path: 'grigliata_aoe_figures/map-1__user-1__circle__6' }),
      expect.anything()
    );
    expect(screen.getByTestId('board-aoe-tool')).toHaveTextContent('circle');
    expect(screen.getByText(/at most 5 circle templates on this map/i)).toBeInTheDocument();
  });
});
