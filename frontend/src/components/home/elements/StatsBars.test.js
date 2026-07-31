import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { useAuthSession } from '../../../AuthContext';
import { useResources } from '../../../data/userData/userDataHooks';
import { isUserDataCommandStageResolved } from '../../../data/userData/userDataCommandRouting';
import StatsBars from './StatsBars';

jest.mock('../../../AuthContext', () => ({ useAuthSession: jest.fn() }));
jest.mock('../../../data/userData/userDataHooks', () => ({ useResources: jest.fn() }));
jest.mock('../../../data/userData/userDataCommands', () => ({ updateResource: jest.fn() }));
jest.mock('../../../data/userData/legacyUserDataCommands', () => ({ legacyUpdateResource: jest.fn() }));
jest.mock('../../../data/userData/userDataCommandRouting', () => ({
  isUserDataCommandStageResolved: jest.fn(() => true),
  runVersionedUserDataCommand: jest.fn(),
}));

const readyResources = {
  data: {
    stats: {
      hpCurrent: 8,
      hpTotal: 10,
      manaCurrent: 5,
      manaTotal: 10,
      essenzaCurrent: 2,
      essenzaTotal: 5,
      barrieraCurrent: 0,
      barrieraTotal: 0,
    },
  },
  status: 'fresh',
  stage: 'legacy-read',
};

describe('StatsBars auth-scoped overlays', () => {
  beforeEach(() => {
    isUserDataCommandStageResolved.mockReturnValue(true);
    useAuthSession.mockReturnValue({
      user: { uid: 'user-1' },
      repositoryAccessGeneration: 0,
    });
    useResources.mockReturnValue(readyResources);
  });

  test('closes the custom resource modal on a UID/access-generation change', () => {
    const { rerender } = render(<StatsBars />);
    fireEvent.click(screen.getByTitle('Aggiungi HP (valore custom)'));
    expect(screen.getByText('Inserisci il valore da aggiungere')).toBeInTheDocument();

    useAuthSession.mockReturnValue({
      user: { uid: 'user-2' },
      repositoryAccessGeneration: 1,
    });
    rerender(<StatsBars />);

    expect(screen.queryByText('Inserisci il valore da aggiungere')).not.toBeInTheDocument();
  });

  test('closes the barrier activation modal on a UID/access-generation change', () => {
    const { rerender } = render(<StatsBars />);
    fireEvent.click(screen.getByTitle('Attiva Barriera'));
    expect(screen.getByRole('heading', { name: 'Attiva Barriera' })).toBeInTheDocument();

    useAuthSession.mockReturnValue({
      user: { uid: 'user-2' },
      repositoryAccessGeneration: 1,
    });
    rerender(<StatsBars />);

    expect(screen.queryByRole('heading', { name: 'Attiva Barriera' })).not.toBeInTheDocument();
  });
});
