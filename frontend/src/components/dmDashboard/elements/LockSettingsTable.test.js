import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import LockSettingsTable from './LockSettingsTable';
import { updateUserSettings } from '../../../data/userData/userDataCommands';
import { callBackendOperationAndWait } from '../../../data/functions/backendOperationClient';
import { runWithDurableOperationIntent } from '../../../data/functions/backendOperationIntentStore';

jest.mock('../../firebaseConfig', () => ({
  auth: { currentUser: { uid: 'dm-1' } },
}));

jest.mock('../../../data/functions/callableRegistry', () => ({
  getCallable: jest.fn(() => jest.fn()),
}));

jest.mock('../../../data/functions/backendOperationClient', () => ({
  callBackendOperationAndWait: jest.fn(() => Promise.resolve({ status: 'completed' })),
}));

jest.mock('../../../data/functions/backendOperationIntentStore', () => ({
  runWithDurableOperationIntent: jest.fn(({ invoke }) => invoke('operation-123')),
}));

jest.mock('../../../data/userData/userDataCommands', () => ({
  updateUserSettings: jest.fn(() => Promise.resolve({ success: true })),
}));

const users = [{
  id: 'player-1',
  characterId: 'Aria',
  stats: {
    level: 2,
    basePointsAvailable: 1,
    basePointsSpent: 2,
    combatTokensAvailable: 3,
    combatTokensSpent: 4,
  },
  settings: {
    keep_me: true,
    lock_param_base: false,
    lock_param_combat: false,
  },
}];

describe('LockSettingsTable Task05 commands', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    runWithDurableOperationIntent.mockImplementation(({ invoke }) => (
      invoke('operation-123')
    ));
  });

  test('a single toggle sends only the requested parameter lock', async () => {
    render(<LockSettingsTable users={users} canEdit />);
    const row = screen.getByText('Lock Parametri Base').closest('tr');
    fireEvent.click(within(row).getAllByRole('button')[1]);

    await waitFor(() => expect(updateUserSettings).toHaveBeenCalledTimes(1));
    expect(updateUserSettings).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'player-1',
      patch: {
        settings: {
          lock_param_base: true,
        },
      },
      retryKey: expect.any(String),
    }));
  });

  test('bulk toggles always use the durable backend operation', async () => {
    render(<LockSettingsTable users={users} canEdit />);
    const row = screen.getByText('Lock Parametri Base').closest('tr');
    fireEvent.click(within(row).getAllByRole('button')[0]);

    await waitFor(() => expect(runWithDurableOperationIntent).toHaveBeenCalledTimes(1));
    expect(runWithDurableOperationIntent).toHaveBeenCalledWith(expect.objectContaining({
      actorUid: 'dm-1',
      kind: 'set-parameter-locks',
      intent: { field: 'lock_param_base', value: true },
    }));
    expect(callBackendOperationAndWait).toHaveBeenCalledWith(
      expect.any(Function),
      { field: 'lock_param_base', value: true },
      { operationId: 'operation-123' }
    );
  });
});
