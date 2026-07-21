import React from 'react';
import { render, screen } from '@testing-library/react';
import { collection, onSnapshot } from '../../performance/firestore';
import { useMapEditing } from './MapEditor';

jest.mock('../firebaseConfig', () => ({ db: {} }));

jest.mock('../../performance/firestore', () => ({
  addDoc: jest.fn(() => Promise.resolve()),
  collection: jest.fn((db, ...segments) => ({ path: segments.join('/') })),
  deleteDoc: jest.fn(() => Promise.resolve()),
  doc: jest.fn((db, ...segments) => ({ path: segments.join('/') })),
  onSnapshot: jest.fn(),
  updateDoc: jest.fn(() => Promise.resolve()),
}));

const MapEditingHarness = ({ collectionPath }) => {
  const { markers } = useMapEditing({
    user: { uid: 'user-1' },
    canEdit: true,
    collectionPath,
  });

  return <div data-testid="marker-count">{markers.length}</div>;
};

describe('useMapEditing collection subscription', () => {
  let unsubscribes;

  beforeEach(() => {
    unsubscribes = [];
    collection.mockImplementation((db, ...segments) => ({ path: segments.join('/') }));
    onSnapshot.mockImplementation((target, onNext) => {
      onNext({ docs: [] });
      const unsubscribe = jest.fn();
      unsubscribes.push(unsubscribe);
      return unsubscribe;
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('does not resubscribe for an equivalent path array and cleans up when the path changes', () => {
    const { rerender, unmount } = render(
      <MapEditingHarness collectionPath={['maps', 'public', 'markers']} />
    );

    expect(screen.getByTestId('marker-count')).toHaveTextContent('0');
    expect(onSnapshot).toHaveBeenCalledTimes(1);
    expect(collection).toHaveBeenCalledWith(expect.anything(), 'maps', 'public', 'markers');

    rerender(<MapEditingHarness collectionPath={['maps', 'public', 'markers']} />);
    expect(onSnapshot).toHaveBeenCalledTimes(1);

    rerender(<MapEditingHarness collectionPath={['maps', 'private', 'markers']} />);
    expect(unsubscribes[0]).toHaveBeenCalledTimes(1);
    expect(onSnapshot).toHaveBeenCalledTimes(2);
    expect(collection).toHaveBeenLastCalledWith(expect.anything(), 'maps', 'private', 'markers');

    unmount();
    expect(unsubscribes[1]).toHaveBeenCalledTimes(1);
  });
});
