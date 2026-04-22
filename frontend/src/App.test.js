import React from 'react';
import { render, screen } from '@testing-library/react';

jest.mock('react-router-dom', () => ({
  __esModule: true,
  Routes: ({ children }) => <div data-testid="routes">{children}</div>,
  Route: ({ element = null, children = null }) => (
    <div data-testid="route-element">
      {element}
      {children}
    </div>
  ),
  Navigate: ({ to }) => <div data-testid={`navigate-${to.replace(/[^a-z0-9]+/gi, '-')}`} />,
  Outlet: () => <div data-testid="route-outlet" />,
}), { virtual: true });

jest.mock('./AuthContext', () => ({
  AuthProvider: ({ children }) => <div data-testid="auth-provider">{children}</div>,
  useAuth: jest.fn(() => ({
    user: null,
    userData: null,
  })),
}));

jest.mock('./components/Login', () => () => <div>Login Page</div>);
jest.mock('./components/characterCreation/CharacterCreation', () => () => <div>Character Creation Page</div>);
jest.mock('./components/home/Home', () => () => <div>Home Page</div>);
jest.mock('./components/bazaar/Bazaar', () => () => <div>Bazaar Page</div>);
jest.mock('./components/dmDashboard/DMDashboard', () => () => <div>DM Dashboard Page</div>);
jest.mock('./components/foesHub/FoesHub', () => () => <div>Foes Hub Page</div>);
jest.mock('./components/tecnicheSpell/TecnicheSpell', () => () => <div>Tecniche Spell Page</div>);
jest.mock('./components/combatTool/combatPage', () => () => <div>Combat Page</div>);
jest.mock('./components/admin/adminPage', () => () => <div>Admin Page</div>);
jest.mock('./components/codex/Codex', () => () => <div>Codex Page</div>);
jest.mock('./components/echiDiViaggio/EchiDiViaggio', () => () => <div>Echi di Viaggio Page</div>);
jest.mock('./components/grigliata/GrigliataPage', () => () => <div>Grigliata Page</div>);
jest.mock('./components/common/Layout', () => ({ children }) => <div data-testid="layout">{children}</div>);

test('renders the routed app inside the auth provider', () => {
  const App = require('./App').default;

  render(<App />);

  expect(screen.getByTestId('auth-provider')).toBeInTheDocument();
  expect(screen.getByTestId('routes')).toBeInTheDocument();
  expect(screen.getAllByTestId('route-element').length).toBeGreaterThan(0);
  expect(screen.getByText('Login Page')).toBeInTheDocument();
  expect(screen.getByText('Grigliata Page')).toBeInTheDocument();
});
