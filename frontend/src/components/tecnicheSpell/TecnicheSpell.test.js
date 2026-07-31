import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { useAuth, useAuthSession } from '../../AuthContext';
import {
  usePersonalSpells,
  usePersonalTechniques,
  useProgression,
  useResources,
} from '../../data/userData/userDataHooks';
import TecnicheSpell from './TecnicheSpell';

jest.mock('../../AuthContext', () => ({
  useAuth: jest.fn(),
  useAuthSession: jest.fn(),
}));
jest.mock('../../data/userData/userDataHooks', () => ({
  usePersonalSpells: jest.fn(),
  usePersonalTechniques: jest.fn(),
  useProgression: jest.fn(),
  useResources: jest.fn(),
}));
jest.mock('../../data/configRepository', () => ({
  getCommonTechniques: () => new Promise(() => {}),
}));
jest.mock('./FilterPanel', () => ({ __esModule: true, default: () => null }));
jest.mock('./elements/personalMediaEditor', () => ({
  __esModule: true,
  default: ({ itemName }) => <div data-testid="personal-media-editor">{itemName}</div>,
}));
jest.mock('./elements/tecniche_side', () => ({
  __esModule: true,
  default: ({ userData, onEditPersonalTecnica }) => (
    <div>
      <div data-testid="technique-user-data">
        {userData?.uid || 'no-uid'}:{userData?.stats?.level || 'no-level'}:{userData?.stats?.manaCurrent ?? 'no-mana'}
      </div>
      <button type="button" onClick={() => onEditPersonalTecnica('Fendente', { name: 'Fendente' })}>
        Edit technique
      </button>
    </div>
  ),
}));
jest.mock('./elements/spell_side', () => ({ __esModule: true, default: () => null }));

describe('TecnicheSpell user-domain composition', () => {
  beforeEach(() => {
    useAuth.mockReturnValue({
      user: { uid: 'user-1', email: 'hero@example.com' },
      userData: {
        characterId: 'Aster',
        stats: { level: 99, manaCurrent: 99 },
      },
    });
    useAuthSession.mockReturnValue({ repositoryAccessGeneration: 0 });
    usePersonalTechniques.mockReturnValue({ data: {}, status: 'fresh' });
    usePersonalSpells.mockReturnValue({ data: {}, status: 'fresh' });
  });

  test('does not overlay legacy root stats when a selected V2 domain is missing', () => {
    useProgression.mockReturnValue({ data: null, status: 'missing' });
    useResources.mockReturnValue({ data: null, status: 'missing' });

    render(<TecnicheSpell />);

    expect(screen.getByTestId('technique-user-data')).toHaveTextContent('no-uid:no-level:no-mana');
    expect(screen.getByRole('status')).toHaveTextContent('non sono disponibili');
    expect(screen.queryByText('99')).not.toBeInTheDocument();
  });

  test('combines progression with the resources-domain mana in V2 reads', () => {
    useProgression.mockReturnValue({
      data: { stats: { level: 7 }, Parametri: { Special: {} } },
      status: 'fresh',
    });
    useResources.mockReturnValue({
      data: { stats: { manaCurrent: 12, manaTotal: 20 } },
      status: 'fresh',
    });

    render(<TecnicheSpell />);

    expect(screen.getByTestId('technique-user-data')).toHaveTextContent('user-1:7:12');
    expect(screen.queryByText('99')).not.toBeInTheDocument();
  });

  test('closes a personal editor immediately when the UID/access generation changes', () => {
    useProgression.mockReturnValue({ data: { stats: { level: 7 } }, status: 'fresh' });
    useResources.mockReturnValue({ data: { stats: { manaCurrent: 12 } }, status: 'fresh' });

    const { rerender } = render(<TecnicheSpell />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit technique' }));
    expect(screen.getByTestId('personal-media-editor')).toHaveTextContent('Fendente');

    useAuth.mockReturnValue({
      user: { uid: 'user-2', email: 'other@example.com' },
      userData: { characterId: 'Borin' },
    });
    useAuthSession.mockReturnValue({ repositoryAccessGeneration: 1 });
    rerender(<TecnicheSpell />);

    expect(screen.queryByTestId('personal-media-editor')).not.toBeInTheDocument();
  });
});
