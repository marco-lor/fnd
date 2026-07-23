import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { onAuthStateChanged } from 'firebase/auth';
import { AuthProvider, useProfileState } from './AuthContext';
import {
  __getRepositoryRuntimeStateForTests,
  __resetRepositoryRuntimeForTests,
} from './data/repositoryRuntime';
import { useResources } from './data/userData/userDataHooks';
import { doc, labelFirestoreTarget, onSnapshot } from './performance/firestore';

let authNext;
const physicalSubscriptions = [];

jest.mock('./components/firebaseConfig', () => ({ auth: {}, db: {} }));

jest.mock('firebase/auth', () => ({
  onAuthStateChanged: jest.fn(),
  signOut: jest.fn(() => Promise.resolve()),
}));

jest.mock('./performance/firestore', () => ({
  collection: jest.fn((_db, ...segments) => ({ path: segments.join('/') })),
  doc: jest.fn((_db, ...segments) => ({ path: segments.join('/') })),
  documentId: jest.fn(() => '__name__'),
  labelFirestoreTarget: jest.fn((target) => target),
  limit: jest.fn((value) => ({ type: 'limit', value })),
  onSnapshot: jest.fn(),
  orderBy: jest.fn((field) => ({ type: 'orderBy', field })),
  query: jest.fn((base) => base),
}));

const emitDocument = (path, data) => {
  const snapshot = {
    exists: () => data !== null,
    data: () => data,
  };
  [...physicalSubscriptions]
    .filter((subscription) => subscription.path === path && !subscription.closed)
    .forEach((subscription) => subscription.observer.next(snapshot));
};

const ProfileProbe = () => {
  const { userData, profileStatus } = useProfileState();
  const resources = useResources();
  return (
    <div>
      <span data-testid="profile-status">{profileStatus}</span>
      <span data-testid="profile-role">{userData?.role || 'none'}</span>
      <span data-testid="resource-status">{resources.status}</span>
      <span data-testid="resource-gold">{resources.data?.stats?.gold ?? 'none'}</span>
    </div>
  );
};

describe('AuthProvider repository-runtime integration', () => {
  beforeEach(() => {
    __resetRepositoryRuntimeForTests();
    physicalSubscriptions.length = 0;
    jest.clearAllMocks();
    doc.mockImplementation((_db, ...segments) => ({ path: segments.join('/') }));
    labelFirestoreTarget.mockImplementation((target) => target);
    onAuthStateChanged.mockImplementation((_auth, next) => {
      authNext = next;
      return jest.fn();
    });
    onSnapshot.mockImplementation((target, observer) => {
      const subscription = {
        path: target.path,
        observer,
        closed: false,
        unsubscribe: jest.fn(() => { subscription.closed = true; }),
      };
      physicalSubscriptions.push(subscription);
      return subscription.unsubscribe;
    });
  });

  afterEach(() => {
    __resetRepositoryRuntimeForTests();
  });

  test('profile access-scope changes preserve auth snapshots while ordinary aggregate listeners invalidate', async () => {
    const view = render(<AuthProvider><ProfileProbe /></AuthProvider>);
    act(() => authNext({ uid: 'user-1', email: 'hero@example.com' }));
    expect(physicalSubscriptions).toHaveLength(2);
    const authProfileSubscription = physicalSubscriptions[0];
    const initialDomainSubscription = physicalSubscriptions[1];

    act(() => emitDocument('users/user-1', {
      role: 'players',
      stats: { level: 2, gold: 10 },
    }));
    expect(screen.getByTestId('profile-role')).toHaveTextContent('player');
    expect(authProfileSubscription.unsubscribe).not.toHaveBeenCalled();
    expect(initialDomainSubscription.unsubscribe).toHaveBeenCalledTimes(1);
    expect(physicalSubscriptions).toHaveLength(3);

    act(() => emitDocument('users/user-1', {
      role: 'players',
      stats: { level: 2, gold: 10 },
    }));
    expect(screen.getByTestId('resource-status')).toHaveTextContent('fresh');
    expect(screen.getByTestId('resource-gold')).toHaveTextContent('10');
    const playerDomainSubscription = physicalSubscriptions[2];

    act(() => emitDocument('users/user-1', {
      role: 'dm',
      stats: { level: 3, gold: 20 },
    }));

    expect(screen.getByTestId('profile-status')).toHaveTextContent('fresh');
    expect(screen.getByTestId('profile-role')).toHaveTextContent('dm');
    expect(authProfileSubscription.unsubscribe).not.toHaveBeenCalled();
    expect(playerDomainSubscription.unsubscribe).toHaveBeenCalledTimes(1);
    expect(physicalSubscriptions).toHaveLength(4);

    act(() => emitDocument('users/user-1', {
      role: 'dm',
      stats: { level: 3, gold: 20 },
    }));
    expect(screen.getByTestId('resource-status')).toHaveTextContent('fresh');
    expect(screen.getByTestId('resource-gold')).toHaveTextContent('20');
    expect(physicalSubscriptions[3].unsubscribe).not.toHaveBeenCalled();
    expect(__getRepositoryRuntimeStateForTests()).toEqual(expect.objectContaining({
      actorUid: 'user-1',
      subscriptionCount: 2,
    }));

    view.unmount();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(authProfileSubscription.unsubscribe).toHaveBeenCalledTimes(1);
    expect(physicalSubscriptions[3].unsubscribe).toHaveBeenCalledTimes(1);
  });
});
