import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import DMDashboard from './DMDashboard';
import { getCallable } from '../../data/functions/callableRegistry';
import { callBackendOperationAndWait } from '../../data/functions/backendOperationClient';
import { runWithDurableOperationIntent } from '../../data/functions/backendOperationIntentStore';

jest.mock('../../AuthContext', () => ({
  useAuth: () => ({
    user: { uid: 'dm-user' },
    userData: { role: 'dm' },
  }),
}));

jest.mock('react-router-dom', () => ({
  useNavigate: () => jest.fn(),
}), { virtual: true });

jest.mock('../common/shellLayout', () => ({
  useShellLayout: () => ({ topInset: 0 }),
}));

jest.mock('../../data/userData/managerUserData', () => {
  const users = [{
      id: 'player-1',
      characterId: 'MarcoTEST',
      settings: {},
      stats: { level: 6 },
  }];
  return {
    useManagerUserData: () => ({
      users,
      loading: false,
      error: null,
    }),
  };
});

jest.mock('./elements/playerInfo', () => ({ users, onLevelUpOne }) => (
  <button type="button" onClick={() => onLevelUpOne(users[0].id)}>Level Up</button>
));

jest.mock('./elements/LockSettingsTable', () => () => <div>Lock table</div>);

jest.mock('../../data/userData/userDataCommands', () => ({
  updateProgression: jest.fn(),
}));

jest.mock('../../data/functions/callableRegistry', () => ({
  getCallable: jest.fn((name) => jest.fn(async (payload) => ({ name, payload }))),
}));

jest.mock('../../data/functions/backendOperationClient', () => ({
  callBackendOperationAndWait: jest.fn(async (callable, payload, { operationId }) => {
    await callable({ ...payload, operationId });
    return { progress: { succeeded: 1 } };
  }),
}));

jest.mock('../../data/functions/backendOperationIntentStore', () => ({
  runWithDurableOperationIntent: jest.fn(({ invoke }) => invoke('operation-123')),
}));

const levelUpAllCallable = getCallable.mock.results[0].value;
const levelUpUserCallable = getCallable.mock.results[1].value;

describe('DM dashboard V2 level-up routing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    levelUpAllCallable.mockResolvedValue({});
    levelUpUserCallable.mockResolvedValue({});
    callBackendOperationAndWait.mockImplementation(async (callable, payload, { operationId }) => {
      await callable({ ...payload, operationId });
      return { progress: { succeeded: 1 } };
    });
    runWithDurableOperationIntent.mockImplementation(({ invoke }) => invoke('operation-123'));
  });

  test('single-player level up supplies a durable V2 operation identity', async () => {
    render(<DMDashboard />);

    fireEvent.click(await screen.findByRole('button', { name: 'Level Up' }));
    const dialog = await screen.findByRole('dialog', { name: 'Level up MarcoTEST?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Level Up' }));

    await waitFor(() => expect(runWithDurableOperationIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUid: 'dm-user',
        kind: 'level-up-user',
        intent: { userId: 'player-1' },
      })
    ));
    expect(levelUpUserCallable).toHaveBeenCalledWith({
      userId: 'player-1',
      operationId: 'operation-123',
    });
  });

  test('level up all always uses the enabled bounded operation', async () => {
    render(<DMDashboard />);

    fireEvent.click(screen.getByRole('button', { name: 'Level Up All' }));
    const dialog = await screen.findByRole('dialog', { name: 'Level up all players?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Level Up All' }));

    await waitFor(() => expect(runWithDurableOperationIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUid: 'dm-user',
        kind: 'level-up-all',
        intent: { scope: 'all-users' },
      })
    ));
    expect(callBackendOperationAndWait).toHaveBeenCalledWith(
      levelUpAllCallable,
      {},
      { operationId: 'operation-123' }
    );
  });
});
