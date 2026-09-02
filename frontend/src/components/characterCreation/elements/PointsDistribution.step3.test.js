import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import PointsDistribution from './PointsDistribution';
import { getVarie } from '../../../data/configRepository';
import {
  runWithDurableOperationIntent,
} from '../../../data/functions/backendOperationIntentStore';
import { isDefinitiveUserDataCommandError } from '../../../data/userData/userDataCommands';

const progressionFixture = {
  Parametri: {
    Base: { Forza: { Base: 1, Anima: 0, Tot: 1 } },
    Combattimento: { Attacco: { Base: 1, Anima: 0, Tot: 1 } },
  },
  stats: {
    basePointsAvailable: 2,
    basePointsSpent: 0,
    negativeBaseStatCount: 0,
    combatTokensAvailable: 3,
    combatTokensSpent: 0,
  },
};

jest.mock('../../../AuthContext', () => ({
  useAuthSession: () => ({ user: { uid: 'player-a' } }),
}));
jest.mock('../../../data/userData/userDataHooks', () => ({
  useProgression: () => ({
    data: progressionFixture,
  }),
}));
jest.mock('../../../data/userData/userDataCommands', () => ({
  spendCharacterPoint: jest.fn(),
  isDefinitiveUserDataCommandError: jest.fn(),
}));
jest.mock('../../../data/functions/backendOperationIntentStore', () => ({
  runWithDurableOperationIntent: jest.fn(),
}));
jest.mock('../../../data/configRepository', () => ({
  getVarie: jest.fn(),
}));

describe('PointsDistribution shared-data boundary', () => {
  beforeEach(() => getVarie.mockReset());

  test('uses the route snapshot for combat costs without starting a config read', () => {
    render(
      <PointsDistribution
        varieData={{ cost_params_combat: { Attacco: 7 } }}
      />
    );

    expect(screen.getByText('7')).toBeInTheDocument();
    expect(getVarie).not.toHaveBeenCalled();
  });

  test('keeps malformed or absent cost data safe with a zero-cost fallback', () => {
    render(<PointsDistribution varieData={{ cost_params_combat: [] }} />);

    const combatRow = within(screen.getAllByRole('table')[1])
      .getByRole('row', { name: /Attacco/ });
    expect(within(combatRow).getAllByRole('cell')[4]).toHaveTextContent('0');
    expect(getVarie).not.toHaveBeenCalled();
  });

  test('passes the definitive classifier and releases the point lock after failure', async () => {
    jest.useFakeTimers();
    try {
      const failure = new Error('point write failed');
      runWithDurableOperationIntent.mockRejectedValueOnce(failure);
      const onBusyChange = jest.fn();
      render(
        <PointsDistribution
          varieData={{ cost_params_combat: {} }}
          onBusyChange={onBusyChange}
        />
      );
      const row = within(screen.getAllByRole('table')[0])
        .getByRole('row', { name: /Forza/ });
      const plus = within(row).getByRole('button', { name: '+' });

      await act(async () => {
        fireEvent.click(plus);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(runWithDurableOperationIntent).toHaveBeenCalledWith(expect.objectContaining({
        isDefinitiveError: isDefinitiveUserDataCommandError,
      }));
      expect(onBusyChange).toHaveBeenLastCalledWith(false);
      expect(plus).not.toBeDisabled();
    } finally {
      jest.useRealTimers();
    }
  });
});
