import React, { Profiler } from 'react';
import { act, render } from '@testing-library/react';
import TecnicheSpell from './TecnicheSpell';
import { useAuth, useAuthSession } from '../../AuthContext';
import { doc, collection, documentId, onSnapshot, orderBy, query, labelFirestoreTarget } from '../../performance/firestore';
import { __resetRepositoryRuntimeForTests, setRepositoryActor } from '../../data/repositoryRuntime';

jest.mock('../../AuthContext', () => ({ useAuth: jest.fn(), useAuthSession: jest.fn() }));
jest.mock('../../components/firebaseConfig', () => ({ db: {} }));
jest.mock('../../performance/firestore', () => ({
  doc: jest.fn(), collection: jest.fn(), documentId: jest.fn(), onSnapshot: jest.fn(),
  orderBy: jest.fn(), query: jest.fn(), labelFirestoreTarget: jest.fn(), getDoc: jest.fn(), updateDoc: jest.fn(),
}));
jest.mock('../../data/configRepository', () => ({ getCommonTechniques: async () => ({}) }));
jest.mock('./elements/tecniche_side', () => () => null);
jest.mock('./elements/spell_side', () => () => null);
jest.mock('./elements/personalMediaEditor', () => () => null);

test('the real four domain hooks subscribe once and one resource snapshot commits the page once', async () => {
  const subscriptions = [];
  __resetRepositoryRuntimeForTests(); setRepositoryActor('hero');
  doc.mockImplementation((_db, ...parts) => ({ path: parts.join('/') }));
  collection.mockImplementation((_db, ...parts) => ({ path: parts.join('/') }));
  query.mockImplementation(base => base); orderBy.mockImplementation(field => field);
  documentId.mockReturnValue('__name__'); labelFirestoreTarget.mockImplementation(target => target);
  const user = { uid: 'hero' };
  useAuth.mockReturnValue({ user, userData: {} });
  useAuthSession.mockReturnValue({ user, repositoryAccessGeneration: 0 });
  onSnapshot.mockImplementation((target, observer) => {
    const subscription = { path: target.path, observer, stop: jest.fn() };
    subscriptions.push(subscription);
    return subscription.stop;
  });
  const onRender = jest.fn();
  const view = render(<Profiler id="page" onRender={onRender}><TecnicheSpell /></Profiler>);
  await act(async () => { await Promise.resolve(); });
  expect(subscriptions).toHaveLength(4);
  expect(new Set(subscriptions.map(entry => entry.path)).size).toBe(4);
  expect(subscriptions.some(entry => entry.path === 'users/hero')).toBe(false);
  act(() => subscriptions.forEach(({ path, observer }) => observer.next(
    path.includes('/state/')
      ? { exists: () => true, data: () => path.endsWith('/resources') ? { stats: { manaCurrent: 10 } } : {} }
      : { docs: [], docChanges: () => [] }
  )));
  await act(async () => { await Promise.resolve(); });
  onRender.mockClear();
  const resources = subscriptions.find(entry => entry.path.endsWith('/resources'));
  act(() => resources.observer.next({ exists: () => true, data: () => ({ stats: { manaCurrent: 9 } }) }));
  expect(onRender).toHaveBeenCalledTimes(1);
  expect(subscriptions).toHaveLength(4);
  view.unmount();
  __resetRepositoryRuntimeForTests();
  subscriptions.forEach(entry => expect(entry.stop).toHaveBeenCalledTimes(1));
});
