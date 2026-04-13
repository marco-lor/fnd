import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import GrigliataPage from './GrigliataPage';
import { useAuth } from '../../AuthContext';
import { GRIGLIATA_LIVE_INTERACTION_STALE_MS } from './liveInteractions';

const mockFirestoreState = {
  collections: {},
  docs: {},
};

const mockFirestoreListeners = [];

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
  storage: {},
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
  getDocs: jest.fn(() => Promise.resolve(mockCreateQuerySnapshot('', []))),
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
  writeBatch: jest.fn(() => ({
    delete: jest.fn(),
    set: jest.fn(),
    update: jest.fn(),
    commit: jest.fn(() => Promise.resolve()),
  })),
}));

jest.mock('./BackgroundGalleryPanel', () => jest.fn(() => <div data-testid="background-gallery-panel" />));
jest.mock('./MapCalibrationPanel', () => jest.fn(() => <div data-testid="map-calibration-panel" />));
jest.mock('./MyTokenTray', () => jest.fn(() => <div data-testid="my-token-tray" />));
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
        <div data-testid="board-draw-color">{props.drawTheme?.key || ''}</div>
        <button type="button" onClick={() => props.onToggleInteractionSharing?.()}>
          toggle interaction sharing
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
    mockFirestoreListeners.splice(0, mockFirestoreListeners.length);
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
      grigliata_live_interactions: [],
    };
    mockFirestoreState.docs = {
      'grigliata_state/current': {
        activeBackgroundId: 'map-1',
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
    firestore.getDocs.mockClear().mockResolvedValue(mockCreateQuerySnapshot('', []));
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
    firestore.writeBatch.mockClear().mockImplementation(() => ({
      delete: jest.fn(),
      set: jest.fn(),
      update: jest.fn(),
      commit: jest.fn(() => Promise.resolve()),
    }));
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  test('publishes only when sharing is enabled and a live interaction exists', async () => {
    render(<GrigliataPage />);

    fireEvent.click(screen.getByRole('button', { name: /toggle interaction sharing/i }));
    await act(async () => {
      jest.advanceTimersByTime(100);
    });
    expect(firestore.setDoc).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /emit interaction a/i }));

    await act(async () => {
      jest.advanceTimersByTime(99);
    });
    expect(firestore.setDoc).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(1);
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

  test('throttles live interaction publishes and keeps only the latest pending payload', async () => {
    render(<GrigliataPage />);

    fireEvent.click(screen.getByRole('button', { name: /toggle interaction sharing/i }));
    fireEvent.click(screen.getByRole('button', { name: /emit interaction a/i }));
    fireEvent.click(screen.getByRole('button', { name: /emit interaction b/i }));

    await act(async () => {
      jest.advanceTimersByTime(100);
    });

    await waitFor(() => {
      expect(firestore.setDoc).toHaveBeenCalledTimes(1);
    });

    expect(firestore.setDoc.mock.calls[0][1]).toEqual(expect.objectContaining({
      liveEndCell: { col: 4, row: 1 },
    }));
  });

  test('deletes the shared interaction when the live interaction ends', async () => {
    render(<GrigliataPage />);

    fireEvent.click(screen.getByRole('button', { name: /toggle interaction sharing/i }));
    fireEvent.click(screen.getByRole('button', { name: /emit interaction a/i }));

    await act(async () => {
      jest.advanceTimersByTime(100);
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
      jest.advanceTimersByTime(100);
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
      jest.advanceTimersByTime(100);
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

  test('deletes the shared interaction on unmount', async () => {
    const rendered = render(<GrigliataPage />);

    fireEvent.click(screen.getByRole('button', { name: /toggle interaction sharing/i }));
    fireEvent.click(screen.getByRole('button', { name: /emit interaction a/i }));

    await act(async () => {
      jest.advanceTimersByTime(100);
    });

    rendered.unmount();

    await waitFor(() => {
      expect(firestore.deleteDoc).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'grigliata_live_interactions/map-1__user-1' })
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
});
