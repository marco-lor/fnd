import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { useAuthSession } from '../AuthContext';
import { useEchiNpcs } from './useEchiNpcs';
import { subscribeEchiNpcs } from './echiNpcsRepository';

jest.mock('../AuthContext', () => ({ useAuthSession: jest.fn() }));
jest.mock('./echiNpcsRepository', () => ({ subscribeEchiNpcs: jest.fn() }));
let session;
let subscriptions;
let renders;
function Probe() {
  const result = useEchiNpcs();
  renders.push(result);
  return <div>{result.npcs.map((npc) => npc.nome).join(',')}</div>;
}
const projection = (nome) => { const npc = { id: 'guide', nome }; return { items: [npc], byId: { guide: npc } }; };
const current = () => renders.at(-1);
beforeEach(() => {
  session = { user: { uid: 'first' }, repositoryAccessGeneration: 0 };
  subscriptions = [];
  renders = [];
  useAuthSession.mockImplementation(() => session);
  subscribeEchiNpcs.mockImplementation((observer, options) => {
    const subscription = { observer, options, unsubscribe: jest.fn() };
    subscriptions.push(subscription);
    return subscription.unsubscribe;
  });
});
afterEach(cleanup);

test.each(['account', 'access', 'logout'])('masks both projections immediately on %s change and ignores stale callbacks', (change) => {
  const view = render(<Probe />);
  act(() => subscriptions[0].observer.next(projection('Secret')));
  expect(current().npcs[0].nome).toBe('Secret');
  const renderBoundary = renders.length;
  if (change === 'account') session = { ...session, user: { uid: 'second' } };
  if (change === 'access') session = { ...session, repositoryAccessGeneration: 1 };
  if (change === 'logout') session = { ...session, user: null };
  view.rerender(<Probe />);
  for (const result of renders.slice(renderBoundary)) {
    expect(result.npcs).toEqual([]);
    expect(result.npcById).toEqual({});
  }
  expect(current().npcLoading).toBe(change !== 'logout');
  expect(subscriptions[0].unsubscribe).toHaveBeenCalledTimes(1);
  act(() => {
    subscriptions[0].observer.next(projection('Late secret'));
    subscriptions[0].observer.error(new Error('late error'));
  });
  expect(current().npcs).toEqual([]);
  expect(current().npcError).toBe('');
  if (change !== 'logout') {
    act(() => subscriptions[1].observer.next(projection('New scope')));
    expect(current().npcById.guide).toBe(current().npcs[0]);
    expect(current().npcs[0].nome).toBe('New scope');
  }
});

test('equivalent user objects do not resubscribe; terminal errors clear both consumers and unmount suppresses callbacks', () => {
  const view = render(<Probe />);
  const data = projection('Guide');
  act(() => subscriptions[0].observer.next(data));
  const fresh = current();
  session = { ...session, user: { uid: 'first', displayName: 'Updated profile' } };
  view.rerender(<Probe />);
  expect(subscriptions).toHaveLength(1);
  expect(current()).toBe(fresh);
  act(() => subscriptions[0].observer.error(new Error('permission-denied')));
  expect(current()).toEqual({ npcs: [], npcById: {}, npcLoading: false, npcError: 'Unable to load NPC list.' });
  view.unmount();
  const count = renders.length;
  act(() => {
    subscriptions[0].observer.next(data);
    subscriptions[0].observer.error(new Error('late'));
  });
  expect(renders).toHaveLength(count);
});

test('an unauthenticated route does not subscribe and a successful new scope clears the prior read failure', () => {
  session.user = null;
  const view = render(<Probe />);
  expect(subscriptions).toHaveLength(0);
  expect(current().npcLoading).toBe(false);
  session.user = { uid: 'first' };
  view.rerender(<Probe />);
  act(() => subscriptions[0].observer.error(new Error('offline failure')));
  session.repositoryAccessGeneration += 1;
  view.rerender(<Probe />);
  act(() => subscriptions[1].observer.next(projection('Recovered')));
  expect(current().npcError).toBe('');
  expect(current().npcLoading).toBe(false);
});
