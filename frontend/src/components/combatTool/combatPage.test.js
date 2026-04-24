import React from 'react';
import { render, screen } from '@testing-library/react';
import CombatPage from './combatPage';
import { useAuth } from '../../AuthContext';
import { useShellLayout } from '../common/shellLayout';

jest.mock('../../AuthContext', () => ({
  useAuth: jest.fn(),
}));

jest.mock('../common/shellLayout', () => ({
  useShellLayout: jest.fn(),
}));

jest.mock('./elements/EncounterCreator', () => jest.fn(() => <div data-testid="encounter-creator" />));
jest.mock('./elements/EncounterSidebarList', () => jest.fn(() => <div data-testid="encounter-sidebar-list" />));
jest.mock('./elements/EncounterDetails', () => jest.fn(() => <div data-testid="encounter-details" />));
jest.mock('./elements/EncounterLog', () => jest.fn(() => <div data-testid="encounter-log" />));
jest.mock('./elements/AddFoesOverlay', () => jest.fn(() => null));
jest.mock('./elements/ui', () => ({
  Section: ({ title, actions, children }) => (
    <section>
      <h2>{title}</h2>
      {actions}
      {children}
    </section>
  ),
}));

describe('CombatPage shell integration', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem('combat.leftCollapsed', 'true');

    useAuth.mockReturnValue({
      user: {
        uid: 'user-1',
      },
      userData: {
        role: 'dm',
      },
    });

    useShellLayout.mockReturnValue({
      navInlineSize: 256,
      topInset: 0,
    });
  });

  test('offsets the reopen handle by the shell nav width when collapsed', () => {
    render(<CombatPage />);

    expect(screen.getByTestId('combat-left-reopen')).toHaveStyle({
      left: '264px',
      top: '24px',
    });
  });
});