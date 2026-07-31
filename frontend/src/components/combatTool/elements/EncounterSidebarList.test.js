import React from 'react';
import { render } from '@testing-library/react';
import { useAuth } from '../../../AuthContext';
import { onSnapshot } from '../../../performance/firestore';
import EncounterSidebarList from './EncounterSidebarList';

jest.mock('../../firebaseConfig', () => ({ db: {} }));

jest.mock('../../../AuthContext', () => ({
  useAuth: jest.fn(),
}));

jest.mock('../../../performance/firestore', () => ({
  collection: jest.fn((db, ...segments) => ({ path: segments.join('/') })),
  onSnapshot: jest.fn(),
  query: jest.fn((base, ...constraints) => ({ base, constraints })),
  where: jest.fn((field, operator, value) => ({ field, operator, value })),
}));

describe('EncounterSidebarList subscriptions', () => {
  let unsubscribes;

  beforeEach(() => {
    unsubscribes = [];
    useAuth.mockReturnValue({
      user: { uid: 'user-1' },
      userData: { characterId: 'character-1' },
    });
    onSnapshot.mockImplementation((target, onNext) => {
      onNext({ forEach: jest.fn() });
      const unsubscribe = jest.fn();
      unsubscribes.push(unsubscribe);
      return unsubscribe;
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('reuses listeners for equivalent auth objects and cleans up on primitive scope changes', () => {
    const onSelect = jest.fn();
    const { rerender, unmount } = render(
      <EncounterSidebarList isDM={false} onSelect={onSelect} selectedId={null} />
    );

    expect(onSnapshot).toHaveBeenCalledTimes(2);

    useAuth.mockReturnValue({
      user: { uid: 'user-1' },
      userData: { characterId: 'character-1' },
    });
    rerender(<EncounterSidebarList isDM={false} onSelect={onSelect} selectedId={null} />);
    expect(onSnapshot).toHaveBeenCalledTimes(2);

    useAuth.mockReturnValue({
      user: { uid: 'user-2' },
      userData: { characterId: 'character-1' },
    });
    rerender(<EncounterSidebarList isDM={false} onSelect={onSelect} selectedId={null} />);
    expect(unsubscribes[0]).toHaveBeenCalledTimes(1);
    expect(unsubscribes[1]).toHaveBeenCalledTimes(1);
    expect(onSnapshot).toHaveBeenCalledTimes(4);

    useAuth.mockReturnValue({
      user: { uid: 'user-2' },
      userData: { characterId: 'character-2' },
    });
    rerender(<EncounterSidebarList isDM={false} onSelect={onSelect} selectedId={null} />);
    expect(unsubscribes[2]).toHaveBeenCalledTimes(1);
    expect(unsubscribes[3]).toHaveBeenCalledTimes(1);
    expect(onSnapshot).toHaveBeenCalledTimes(6);

    rerender(<EncounterSidebarList isDM onSelect={onSelect} selectedId={null} />);
    expect(unsubscribes[4]).toHaveBeenCalledTimes(1);
    expect(unsubscribes[5]).toHaveBeenCalledTimes(1);
    expect(onSnapshot).toHaveBeenCalledTimes(7);

    unmount();
    expect(unsubscribes[6]).toHaveBeenCalledTimes(1);
  });
});
