import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import PlayerInfo from './playerInfo';
import { subscribeUserDomain } from '../../../data/userData/userDataRepository';
import { adjustGold } from '../../../data/userData/userDataCommands';
import { getDocs, onSnapshot } from '../../../performance/firestore';

const mockRenders = new Map();
jest.mock('../../../AuthContext', () => ({useAuthSession: () => ({repositoryAccessGeneration: 0})}));
jest.mock('../../firebaseConfig', () => ({db: {}}));
jest.mock('../../../data/userDirectoryRepository', () => ({}));
jest.mock('../../../data/userData/managerSummaryRepository', () => ({}));
jest.mock('../../../data/userData/userDataRepository', () => ({subscribeUserDomain: jest.fn()}));
jest.mock('../../../data/userData/userDataCommands', () => ({adjustGold: jest.fn(), updateResource: jest.fn()}));
jest.mock('../../../performance/firestore', () => ({collection: (_db, ...path) => path.join('/'), query: (ref) => ref, orderBy: jest.fn(), limit: jest.fn(), onSnapshot: jest.fn(), getDocs: jest.fn()}));
jest.mock('./playerInfo/sections/PlayerInfoActionsRow', () => ({users, onAddSpell}) => {
  const uid = users[0].id; mockRenders.set(uid, (mockRenders.get(uid) || 0) + 1);
  return <button onClick={() => onAddSpell(uid)}>Add spell {uid}</button>;
});
jest.mock('./playerInfo/sections/PlayerInfoInventoryRow', () => ({users, onOpenGoldOverlay}) => <button onClick={() => onOpenGoldOverlay(users[0].id, 1)}>Gold {users[0].id}</button>);
jest.mock('./lazyPlayerInfoOverlays', () => ({
  GoldAdjustmentOverlay: ({onChange, onConfirm}) => <div><input aria-label="Gold amount" onChange={(event) => onChange(event.target.value)} /><button onClick={onConfirm}>Confirm gold</button></div>,
  AddSpellOverlay: ({onClose}) => <button onClick={() => onClose(true)}>Save spell</button>,
}));

test('visible card ownership, max3, unchanged row renders, saves and collapse/unmount', async () => {
  const active = new Set();
  subscribeUserDomain.mockImplementation((uid, domain, observer) => {
    const key = `${uid}:${domain}`; active.add(key);
    observer.next(domain === 'inventory' ? [] : {});
    return () => active.delete(key);
  });
  onSnapshot.mockImplementation((key, next) => { active.add(key); next({forEach: () => {}}); return () => active.delete(key); });
  adjustGold.mockResolvedValue({});
  const users = ['a', 'b', 'c', 'd'].map((id) => ({id, label: id, characterId: id, stats: {gold: 0}, settings: {}}));
  const view = render(<PlayerInfo users={users} />);
  expect(active.size).toBe(0);
  fireEvent.click(screen.getAllByRole('button', {name: 'Espandi'})[0]);
  fireEvent.click(screen.getAllByRole('button', {name: 'Espandi'})[0]);
  fireEvent.click(screen.getAllByRole('button', {name: 'Espandi'})[0]);
  expect(active.size).toBe(15);
  expect(screen.getByRole('button', {name: 'Espandi'})).toBeDisabled();
  const rendersB = mockRenders.get('b');
  const subscriptions = subscribeUserDomain.mock.calls.length;
  view.rerender(<PlayerInfo users={[{...users[0], stats: {gold: 3}}, ...users.slice(1)]} />);
  expect(mockRenders.get('b')).toBe(rendersB);
  expect(subscribeUserDomain).toHaveBeenCalledTimes(subscriptions);
  fireEvent.click(screen.getByRole('button', {name: 'Gold a'}));
  fireEvent.change(screen.getByLabelText('Gold amount'), {target: {value: '5'}});
  fireEvent.click(screen.getByRole('button', {name: 'Confirm gold'}));
  await waitFor(() => expect(adjustGold).toHaveBeenCalledWith(expect.objectContaining({userId: 'a', delta: 5})));
  fireEvent.click(screen.getByRole('button', {name: 'Add spell a'}));
  fireEvent.click(screen.getByRole('button', {name: 'Save spell'}));
  await act(async () => {});
  expect(getDocs).not.toHaveBeenCalled();
  expect(subscribeUserDomain).toHaveBeenCalledTimes(subscriptions);
  for (const button of screen.getAllByRole('button', {name: 'Comprimi'})) fireEvent.click(button);
  expect(active.size).toBe(0);
  fireEvent.click(screen.getAllByRole('button', {name: 'Espandi'})[0]);
  expect(active.size).toBe(5);
  view.unmount(); expect(active.size).toBe(0);
});

test('a failed detail domain stays visible after other domains succeed and can retry in place', () => {
  const observers = [];
  const stops = [];
  subscribeUserDomain.mockImplementation((_uid, domain, observer) => {
    observers.push({domain, observer});
    const stop = jest.fn(); stops.push(stop); return stop;
  });
  onSnapshot.mockImplementation((_key, next) => { next({forEach: () => {}}); return jest.fn(); });
  const view = render(<PlayerInfo users={[{id: 'retry-player', label: 'Retry', stats: {}, settings: {}}]} />);
  fireEvent.click(screen.getByRole('button', {name: 'Espandi'}));
  act(() => {
    observers[1].observer.error(new Error('Inventory unavailable'));
    observers.filter((_entry, index) => index !== 1).forEach(({observer}) => observer.next({}));
  });
  expect(screen.getByRole('alert')).toHaveTextContent('Inventory unavailable');
  fireEvent.click(screen.getByRole('button', {name: 'Retry player details'}));
  expect(subscribeUserDomain).toHaveBeenCalledTimes(8);
  stops.slice(0, 4).forEach((stop) => expect(stop).toHaveBeenCalledTimes(1));
  act(() => observers.slice(4).forEach(({domain, observer}) => observer.next(domain === 'inventory' ? [] : {})));
  expect(screen.queryByText('Inventory unavailable')).not.toBeInTheDocument();
  view.unmount();
  stops.forEach((stop) => expect(stop).toHaveBeenCalledTimes(1));
});
