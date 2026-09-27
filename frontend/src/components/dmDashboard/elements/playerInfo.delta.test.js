import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import PlayerInfo from './playerInfo';
import { __resetUserDataCommandsForTests } from '../../../data/userData/userDataCommands';

const mockCommand = jest.fn();
jest.mock('../../../data/functions/callableRegistry', () => ({getCallable: () => (...args) => mockCommand(...args), __resetCallableRegistryForTests: () => {}}));
jest.mock('../../../AuthContext', () => ({useAuthSession: () => ({repositoryAccessGeneration: 0})}));
jest.mock('../../firebaseConfig', () => ({db: {}}));
jest.mock('../../../data/userDirectoryRepository', () => ({}));
jest.mock('../../../data/userData/managerSummaryRepository', () => ({}));
jest.mock('../../../data/userData/userDataRepository', () => ({subscribeUserDomain: jest.fn()}));
jest.mock('../../../performance/firestore', () => ({collection: jest.fn(), query: jest.fn(), orderBy: jest.fn(), limit: jest.fn(), onSnapshot: jest.fn(), getDocs: jest.fn()}));
jest.mock('./lazyPlayerInfoOverlays', () => ({}));
jest.mock('../../bazaar/lazyBazaarEditors', () => ({}));
const player = (hpCurrent) => ({id: 'target', label: 'Target', stats: {hpCurrent, hpTotal: 20}, settings: {}});

beforeEach(() => { __resetUserDataCommandsForTests(); jest.clearAllMocks(); });

test('each intentional delta reaches the backend while earlier acknowledgements are pending', async () => {
  let resolve;
  mockCommand.mockReturnValue(new Promise((done) => { resolve = done; }));
  const view = render(<PlayerInfo users={[player(10)]} canEditVitals />);
  fireEvent.click(screen.getAllByRole('button', {name: '+', exact: true})[0]);
  view.rerender(<PlayerInfo users={[player(11)]} canEditVitals />);
  fireEvent.click(screen.getAllByRole('button', {name: '+', exact: true})[0]);
  fireEvent.click(screen.getAllByRole('button', {name: 'Δ', exact: true})[0]);
  fireEvent.change(screen.getByRole('spinbutton'), {target: {value: '1'}});
  fireEvent.click(screen.getByRole('button', {name: 'Apply', exact: true}));
  expect(mockCommand).toHaveBeenCalledTimes(3);
  expect(new Set(mockCommand.mock.calls.map(([request]) => request.operationId)).size).toBe(3);
  mockCommand.mock.calls.forEach(([request]) => expect(request).toMatchObject({userId: 'target', resource: 'hp', mode: 'delta', value: 1, floorAtZero: true}));
  await act(async () => resolve({data: {newValue: 13}}));
});

test('an ambiguous delta failure has an explicit retry that retains only that action identity', async () => {
  mockCommand.mockRejectedValueOnce(new Error('connection lost')).mockResolvedValue({data: {newValue: 12}});
  render(<PlayerInfo users={[player(10)]} canEditVitals />);
  fireEvent.click(screen.getAllByRole('button', {name: '+', exact: true})[0]);
  const retry = await screen.findByRole('button', {name: 'Retry HP +1'});
  const failedId = mockCommand.mock.calls[0][0].operationId;
  fireEvent.click(screen.getAllByRole('button', {name: '+', exact: true})[0]);
  await waitFor(() => expect(mockCommand).toHaveBeenCalledTimes(2));
  expect(mockCommand.mock.calls[1][0].operationId).not.toBe(failedId);
  fireEvent.click(retry);
  await waitFor(() => expect(screen.queryByRole('button', {name: 'Retry HP +1'})).not.toBeInTheDocument());
  expect(mockCommand).toHaveBeenCalledTimes(3);
  expect(mockCommand.mock.calls[2][0].operationId).toBe(failedId);
});
