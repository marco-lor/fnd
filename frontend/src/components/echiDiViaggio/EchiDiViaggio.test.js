import React from 'react';
import { render, screen } from '@testing-library/react';
import EchiDiViaggio from './EchiDiViaggio';
import { useAuth } from '../../AuthContext';
import { useShellLayout } from '../common/shellLayout';
import NpcSidebar from './NpcSidebar';
import { useMapEditing } from './MapEditor';

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

jest.mock('firebase/firestore', () => ({
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
    useMapEditing
      .mockReturnValueOnce(buildMapEditingState())
      .mockReturnValueOnce(buildMapEditingState());
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
