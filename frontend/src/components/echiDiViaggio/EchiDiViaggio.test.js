import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import EchiDiViaggio from './EchiDiViaggio';
import { useAuth } from '../../AuthContext';
import { useShellLayout } from '../common/shellLayout';
import NpcSidebar from './NpcSidebar';
import { useMapEditing } from './MapEditor';
import { onSnapshot } from '../../performance/firestore';

jest.mock('../../AuthContext', () => ({
  useAuth: jest.fn(),
}));

jest.mock('../common/shellLayout', () => ({
  useShellLayout: jest.fn(),
}));

jest.mock('../backgrounds/GlobalAuroraBackground', () => () => <div data-testid="global-aurora-background" />);

jest.mock('./NpcSidebar', () => jest.fn(() => <div data-testid="npc-sidebar" />));

jest.mock('./MapEditor', () => ({
  MapEditorControls: jest.fn(({ title }) => <div>{title}</div>),
  MapMarkerModal: jest.fn(() => null),
  renderMarkerIcon: jest.fn(() => <div data-testid="marker-icon" />),
  useMapEditing: jest.fn(),
}));

jest.mock('../firebaseConfig', () => ({
  db: {},
}));
jest.mock('../firebaseStorage', () => ({ storage: {} }));

jest.mock('../../performance/firestore', () => ({
  collection: jest.fn((db, path) => ({ path })),
  onSnapshot: jest.fn((target, onNext) => {
    onNext({ docs: [] });
    return () => {};
  }),
}));

const buildMapEditingState = () => ({
  markers: [],
  editMode: false,
  showModal: false,
  setShowModal: jest.fn(),
  markerText: '',
  setMarkerText: jest.fn(),
  setNewMarkerData: jest.fn(),
  handleMapDrop: jest.fn(),
  handleAddMarkerAtDrop: jest.fn(),
  handleSaveMarker: jest.fn(),
  handleDeleteMarker: jest.fn(),
  handleMoveMarker: jest.fn(),
});

describe('EchiDiViaggio', () => {
  beforeEach(() => {
    useAuth.mockReturnValue({
      user: {
        uid: 'user-1',
        email: 'user-1@example.com',
      },
      userData: {
        role: 'dm',
      },
      loading: false,
    });
    useShellLayout.mockReturnValue({
      topInset: 96,
    });
    useMapEditing.mockReset();
    useMapEditing.mockReturnValue(buildMapEditingState());
    onSnapshot.mockImplementation((target, onNext) => {
      onNext({ docs: [] });
      return () => {};
    });
  });

  test('opens an edge marker with keyboard focus in a viewport-bounded portal outside map clipping', () => {
    const state = buildMapEditingState();
    state.markers = [{ id: 'edge-marker', mapId: 'art', x: 0, y: 0, text: 'Edge lookout', iconType: 'pin' }];
    useMapEditing.mockImplementation(({ collectionPath }) => collectionPath[0] === 'map_markers' ? state : buildMapEditingState());
    const { container } = render(<EchiDiViaggio />);
    const marker = screen.getByRole('button', { name: /Edge lookout/ });
    act(() => marker.focus());
    const popup = screen.getByRole('dialog', { name: /Edge lookout/ });
    expect(popup).toHaveTextContent('Edge lookout');
    expect(document.body).toContainElement(popup);
    expect(container).not.toContainElement(popup);
    expect(popup).toHaveStyle({ position: 'fixed', overflowY: 'auto' });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: /Edge lookout/ })).not.toBeInTheDocument();
    expect(marker).toHaveFocus();
    fireEvent.focus(marker);
    expect(screen.queryByRole('dialog', { name: /Edge lookout/ })).not.toBeInTheDocument();
    fireEvent.click(marker);
    expect(screen.getByRole('dialog', { name: /Edge lookout/ })).toHaveFocus();
  });

  test('keeps NPC final notes available when focus enters a marker popup and cleans up on unmount', () => {
    jest.useFakeTimers();
    try {
      const state = buildMapEditingState();
      state.markers = [{ id: 'npc-marker', mapId: 'art', x: 100, y: 100, npcId: 'guide', markerType: 'npc' }];
      useMapEditing.mockImplementation(({ collectionPath }) => collectionPath[0] === 'map_markers' ? state : buildMapEditingState());
      onSnapshot.mockImplementation((target, onNext) => {
        onNext({ docs: [{ id: 'guide', data: () => ({ nome: 'Guide', notes: 'Last marker note' }) }] });
        return () => {};
      });
      const { unmount } = render(<EchiDiViaggio />);
      const marker = screen.getByRole('button', { name: /Guide/ });
      act(() => marker.focus());
      const popup = screen.getByRole('dialog', { name: /Guide/ });
      expect(popup).toHaveTextContent('Last marker note');
      act(() => popup.focus());
      fireEvent.mouseLeave(marker);
      act(() => jest.advanceTimersByTime(300));
      expect(popup).toHaveFocus();
      expect(popup).toBeInTheDocument();
      unmount();
      act(() => jest.runOnlyPendingTimers());
      expect(popup).not.toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });

  test('a marker closes after Escape in its portal, explicit reopening and outside focus without another marker leave', () => {
    jest.useFakeTimers();
    try {
      const state = buildMapEditingState();
      state.markers = [{ id: 'edge-marker', mapId: 'art', x: 0, y: 0, text: 'Edge lookout', iconType: 'pin' }];
      useMapEditing.mockImplementation(({ collectionPath }) => collectionPath[0] === 'map_markers' ? state : buildMapEditingState());
      render(<><button type="button">Outside marker controls</button><EchiDiViaggio /></>);
      const marker = screen.getByRole('button', { name: /Edge lookout/ });
      fireEvent.mouseEnter(marker);
      const popup = screen.getByRole('dialog', { name: /Edge lookout/ });
      fireEvent.mouseLeave(marker, { relatedTarget: popup });
      fireEvent.mouseEnter(popup, { relatedTarget: marker });
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(popup).not.toBeInTheDocument();
      fireEvent.click(marker);
      expect(screen.getByRole('dialog', { name: /Edge lookout/ })).toHaveFocus();
      act(() => screen.getByRole('button', { name: 'Outside marker controls' }).focus());
      act(() => jest.advanceTimersByTime(300));
      expect(screen.queryByRole('dialog', { name: /Edge lookout/ })).not.toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });

  test('uses shell metrics for sticky offsets instead of querying the legacy navbar', () => {
    const querySelectorSpy = jest.spyOn(document, 'querySelector');

    render(<EchiDiViaggio />);

    expect(screen.getByText('Mappa Artistica')).toBeInTheDocument();
    expect(NpcSidebar).toHaveBeenCalled();
    expect(NpcSidebar.mock.calls.at(-1)[0]).toEqual(expect.objectContaining({
      stickyOffset: 104,
    }));
    expect(querySelectorSpy).not.toHaveBeenCalledWith('[data-navbar]');

    querySelectorSpy.mockRestore();
  });
});
